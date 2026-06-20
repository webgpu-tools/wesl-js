import type {
  AssignElem,
  BinaryExpression,
  BlockElem,
  ConstElem,
  DecrementElem,
  DoBlockElem,
  ExpressionElem,
  ForElem,
  FunctionCallExpression,
  IfElem,
  IncrementElem,
  LetElem,
  Literal,
  LoopElem,
  Statement,
  UnaryExpression,
  VarElem,
  WeslAST,
  WhileElem,
} from "wesl";
import { recordComputePass } from "wesl-gpu";
import { classifyEntryPoints, type EntryPoint } from "wesl-reflect";
import { findDoBlocks } from "./DoBlockDiscovery.ts";

export interface RunDoInterpreterParams {
  ast: WeslAST;
  /** Entry point of the `do` block to execute. */
  blockName: string;
  device: GPUDevice;
  encoder: GPUCommandEncoder;
  bindGroup: GPUBindGroup;
  /** Compute pipeline per entry-point fn name; share one pipeline layout. */
  pipelines: Map<string, GPUComputePipeline>;
  /** Renderer for `@fragment` calls; required only if the block calls one. */
  renderFragment?: (entry: EntryPoint) => void;
  /** Recursion-depth ceiling. Default 256. */
  maxDepth?: number;
  /** Per-loop iteration ceiling, guarding non-terminating loops. Default 1e6. */
  maxIterations?: number;
}

/** A local binding. `let`/`const` are immutable; `var` may be reassigned. */
interface Local {
  value: number;
  mutable: boolean;
}

/** A child scope is `new Map(parent)`: it copies the entries but shares the
 *  `Local` objects by reference, so a `var` mutated in a nested block updates
 *  the outer binding, while re-declaring a name only rebinds the child's own
 *  entry (shadowing). */
type Scope = Map<string, Local>;

interface Env {
  entryPoints: Map<string, EntryPoint>;
  doBlocks: Map<string, DoBlockElem>;
  pipelines: Map<string, GPUComputePipeline>;
  encoder: GPUCommandEncoder;
  bindGroup: GPUBindGroup;
  renderFragment?: (entry: EntryPoint) => void;
  depth: number;
  maxDepth: number;
  maxIterations: number;
}

/** Thrown by `break` / `continue`, caught at the enclosing loop so the jump is
 *  loop-scoped: a `break` inside a nested `if` exits the loop, not the `if`. */
class BreakSignal {}
class ContinueSignal {}
/** Thrown by a valueless `return`, caught at the current block boundary. */
class ReturnSignal {}

/** Walk a `do` block, recording compute dispatches onto the caller's encoder.
 *  Returns when the body has been fully interpreted. Throws on any unsupported
 *  construct, naming the offending block. */
export function runDoInterpreter(p: RunDoInterpreterParams): void {
  const entryPoints = new Map(
    classifyEntryPoints(p.ast).map(e => [e.fnName, e]),
  );
  const doBlocks = new Map(findDoBlocks(p.ast).map(d => [d.name, d.block]));
  const block = doBlocks.get(p.blockName);
  if (!block) throw new Error(`do block '${p.blockName}' not found`);
  const env: Env = {
    entryPoints,
    doBlocks,
    pipelines: p.pipelines,
    encoder: p.encoder,
    bindGroup: p.bindGroup,
    renderFragment: p.renderFragment,
    depth: 0,
    maxDepth: p.maxDepth ?? 256,
    maxIterations: p.maxIterations ?? 1_000_000,
  };
  interpretDoBlock(block, env, new Map());
}

/** Interpret a do block body in a child scope, guarding recursion depth. */
function interpretDoBlock(block: DoBlockElem, env: Env, parent: Scope): void {
  if (env.depth >= env.maxDepth) {
    throw new Error(
      `do block '${block.name.name}' exceeded recursion depth ${env.maxDepth}`,
    );
  }
  env.depth++;
  try {
    runBlock(block.body, block, env, parent);
  } catch (e) {
    if (!(e instanceof ReturnSignal)) throw e; // valueless return ends the block
  } finally {
    env.depth--;
  }
}

/** Run a compound `{ ... }` block's statements in a fresh child scope. */
function runBlock(
  body: BlockElem,
  block: DoBlockElem,
  env: Env,
  parent: Scope,
): void {
  const scope: Scope = new Map(parent);
  for (const stmt of body.body) interpretStatement(stmt, block, env, scope);
}

/** Interpret one statement, switching on its typed kind. */
function interpretStatement(
  stmt: Statement,
  block: DoBlockElem,
  env: Env,
  scope: Scope,
): void {
  switch (stmt.kind) {
    case "let":
    case "var":
    case "const":
      bindLocal(stmt, block, scope);
      return;
    case "call":
      dispatchCall(stmt.call, block, env, scope);
      return;
    case "block":
      runBlock(stmt, block, env, scope);
      return;
    case "if":
      interpretIf(stmt, block, env, scope);
      return;
    case "for":
      interpretFor(stmt, block, env, scope);
      return;
    case "while":
      interpretWhile(stmt, block, env, scope);
      return;
    case "loop":
      interpretLoop(stmt, block, env, scope);
      return;
    case "break":
      throw new BreakSignal();
    case "continue":
      throw new ContinueSignal();
    case "return":
      if (stmt.value !== undefined) {
        throw rejection(
          block,
          "a `return` with a value",
          "Tier 7",
          "calling user WGSL functions",
        );
      }
      throw new ReturnSignal();
    case "assign":
      interpretAssign(stmt, block, scope);
      return;
    case "increment":
    case "decrement":
      interpretIncDec(stmt, block, scope);
      return;
    case "empty":
      return;
    case "discard":
      throw blockError(
        block,
        "the `discard` statement has no meaning in a do block " +
          "(`discard` terminates a fragment-shader invocation)",
      );
    default:
      throw rejection(
        block,
        `the '${stmt.kind}' statement`,
        "Tier 1+",
        "programmable scheduling",
      );
  }
}

/** if / else-if / else: else is an IfElem (else-if) or a BlockElem (plain else). */
function interpretIf(
  stmt: IfElem,
  block: DoBlockElem,
  env: Env,
  scope: Scope,
): void {
  if (truthy(evalExpr(stmt.condition, block, scope))) {
    runBlock(stmt.body, block, env, scope);
  } else if (stmt.else?.kind === "if") {
    interpretIf(stmt.else, block, env, scope);
  } else if (stmt.else) {
    runBlock(stmt.else, block, env, scope);
  }
}

/** for: own scope holds the init binding; while condition holds, run body then update. */
function interpretFor(
  stmt: ForElem,
  block: DoBlockElem,
  env: Env,
  scope: Scope,
): void {
  const loopScope: Scope = new Map(scope);
  if (stmt.init) interpretStatement(stmt.init, block, env, loopScope);
  let iterations = 0;
  while (
    stmt.condition === undefined ||
    truthy(evalExpr(stmt.condition, block, loopScope))
  ) {
    guardIterations(iterations++, block, env);
    try {
      runBlock(stmt.body, block, env, loopScope);
    } catch (e) {
      if (loopJump(e) === "break") break;
    }
    if (stmt.update) interpretStatement(stmt.update, block, env, loopScope);
  }
}

/** while: run the body while the condition holds. */
function interpretWhile(
  stmt: WhileElem,
  block: DoBlockElem,
  env: Env,
  scope: Scope,
): void {
  let iterations = 0;
  while (truthy(evalExpr(stmt.condition, block, scope))) {
    guardIterations(iterations++, block, env);
    try {
      runBlock(stmt.body, block, env, scope);
    } catch (e) {
      if (loopJump(e) === "break") break;
    }
  }
}

/** loop: run the body until a `break`; an optional continuing block runs each pass. */
function interpretLoop(
  stmt: LoopElem,
  block: DoBlockElem,
  env: Env,
  scope: Scope,
): void {
  for (let iterations = 0; ; iterations++) {
    guardIterations(iterations, block, env);
    const loopScope: Scope = new Map(scope);
    try {
      // skip the trailing continuing node when iterating the loop body
      for (const s of stmt.body.body) {
        if (s.kind === "continuing") continue;
        interpretStatement(s, block, env, loopScope);
      }
    } catch (e) {
      if (loopJump(e) === "break") break;
    }
    if (stmt.continuing) {
      for (const s of stmt.continuing.body.body) {
        // the trailing `break if` stays in the body too; its condition is
        // replayed via breakIf below, so don't run it as a plain break here
        if (s.kind === "break") continue;
        interpretStatement(s, block, env, loopScope);
      }
      if (
        stmt.continuing.breakIf &&
        truthy(evalExpr(stmt.continuing.breakIf, block, loopScope))
      ) {
        break;
      }
    }
  }
}

/** Fail fast when a loop runs past the iteration ceiling, instead of hanging
 *  the test process on a non-terminating loop. */
function guardIterations(
  iterations: number,
  block: DoBlockElem,
  env: Env,
): void {
  if (iterations >= env.maxIterations) {
    throw blockError(
      block,
      `loop exceeded ${env.maxIterations} iterations (non-terminating loop?)`,
    );
  }
}

/** Translate a caught loop signal into the host loop's action: a BreakSignal
 *  ends the loop, a ContinueSignal resumes it; any other error propagates. */
function loopJump(e: unknown): "break" | "continue" {
  if (e instanceof BreakSignal) return "break";
  if (e instanceof ContinueSignal) return "continue";
  throw e;
}

/** Assignment / compound assignment to a scalar local named by a `ref` lhs. */
function interpretAssign(
  stmt: AssignElem,
  block: DoBlockElem,
  scope: Scope,
): void {
  const local = resolveAssignTarget(stmt.lhs, block, scope);
  const rhs = evalExpr(stmt.rhs, block, scope);
  if (stmt.op.value === "=") {
    local.value = rhs;
    return;
  }
  const op = stmt.op.value.slice(0, -1); // strip trailing '=' => binary op
  local.value = applyBinary(op, local.value, rhs, block);
}

/** `i++` / `i--` on a scalar local; u32-wraps the result. Modeled as +/- 1
 *  (not + -1) so a decrement past zero wraps as u32, matching `i - 1u`. */
function interpretIncDec(
  stmt: IncrementElem | DecrementElem,
  block: DoBlockElem,
  scope: Scope,
): void {
  const local = resolveAssignTarget(stmt.target, block, scope);
  const op = stmt.kind === "increment" ? "+" : "-";
  local.value = applyBinary(op, local.value, 1, block);
}

/** Resolve a mutable scalar local from an lhs/target expression. Rejects
 *  non-local targets (e.g. buffer writes) with a tiered message. */
function resolveAssignTarget(
  lhs: AssignElem["lhs"] | ExpressionElem,
  block: DoBlockElem,
  scope: Scope,
): Local {
  if (lhs.kind === "phony") {
    throw rejection(
      block,
      "phony assignment `_ = ...`",
      "Tier 2",
      "buffer readback",
    );
  }
  if (lhs.kind === "component-expression") {
    throw rejection(
      block,
      "writing to a buffer element `data[i] = ...`",
      "Tier 2.5",
      "CPU-to-GPU buffer writes",
    );
  }
  if (lhs.kind !== "ref") {
    throw rejection(
      block,
      `assignment to a '${lhs.kind}'`,
      "Tier 1+",
      "programmable scheduling",
    );
  }
  const name = lhs.ident.originalName;
  const local = scope.get(name);
  if (!local) {
    throw blockError(block, `assignment to unbound name '${name}'`);
  }
  if (!local.mutable) {
    throw blockError(
      block,
      `cannot reassign immutable '${name}' ` +
        "(let/const bindings are immutable; declare with 'var' to mutate)",
    );
  }
  return local;
}

/** Bind a let/var/const local. `var` is mutable; `let`/`const` are immutable. */
function bindLocal(
  decl: LetElem | VarElem | ConstElem,
  block: DoBlockElem,
  scope: Scope,
): void {
  const name = decl.name.decl.ident.originalName;
  if (!decl.init) {
    throw blockError(block, `'${decl.kind} ${name}' has no initializer`);
  }
  const value = evalExpr(decl.init, block, scope);
  scope.set(name, { value, mutable: decl.kind === "var" });
}

/** Dispatch a call: entry-point => GPU dispatch, do block => recurse. */
function dispatchCall(
  call: FunctionCallExpression,
  block: DoBlockElem,
  env: Env,
  scope: Scope,
): void {
  const targetName = callTargetName(call);
  if (!targetName) {
    throw blockError(block, "could not resolve call target");
  }
  const args = call.arguments.map(a => evalExpr(a, block, scope));

  const entry = env.entryPoints.get(targetName);
  if (entry) {
    dispatchEntryPoint(entry, args, block, env);
    return;
  }

  const childBlock = env.doBlocks.get(targetName);
  if (childBlock) {
    interpretDoBlock(childBlock, env, scope);
    return;
  }

  throw blockError(block, `call to undefined target '${targetName}'`);
}

function evalExpr(
  expr: ExpressionElem,
  block: DoBlockElem,
  scope: Scope,
): number {
  switch (expr.kind) {
    case "literal":
      return parseLiteral(expr, block);
    case "ref": {
      const name = expr.ident.originalName;
      const local = scope.get(name);
      if (local === undefined) {
        throw blockError(
          block,
          `unbound name '${name}' (evaluator handles only let/var/const locals)`,
        );
      }
      return local.value;
    }
    case "parenthesized-expression":
      return evalExpr(expr.expression, block, scope);
    case "unary-expression":
      return evalUnary(expr, block, scope);
    case "binary-expression":
      return evalBinary(expr, block, scope);
    case "component-expression":
      throw rejection(
        block,
        "buffer indexing `data[i]`",
        "Tier 2",
        "buffer readback",
      );
    case "component-member-expression":
      throw rejection(
        block,
        "field/swizzle access `.x`",
        "Tier 5",
        "vectors and matrices",
      );
    case "call-expression":
      throw rejection(
        block,
        "calling a function in an expression",
        "Tier 4",
        "WGSL builtins",
      );
    default:
      throw rejection(
        block,
        `the '${expr.kind}' expression`,
        "Tier 1+",
        "programmable scheduling",
      );
  }
}

function callTargetName(call: FunctionCallExpression): string | undefined {
  const fn = call.function;
  if (fn.kind === "ref") return fn.ident.originalName;
  if (fn.kind === "type") return fn.name.originalName;
  return undefined;
}

/** Dispatch an entry point: compute records a pass, fragment calls the render hook. */
function dispatchEntryPoint(
  entry: EntryPoint,
  args: number[],
  block: DoBlockElem,
  env: Env,
): void {
  if (entry.stage === "compute") {
    const pipeline = env.pipelines.get(entry.fnName);
    if (!pipeline) {
      throw blockError(
        block,
        `no compute pipeline for entry point '${entry.fnName}'`,
      );
    }
    recordComputePass({
      encoder: env.encoder,
      pipeline,
      bindGroup: env.bindGroup,
      dispatchWorkgroups: dispatchDims(args),
    });
    return;
  }
  if (entry.stage === "fragment") {
    if (!env.renderFragment) {
      throw blockError(
        block,
        `fragment call '${entry.fnName}' but no renderFragment hook supplied`,
      );
    }
    env.renderFragment(entry);
    return;
  }
  throw blockError(block, `cannot call ${entry.stage} entry '${entry.fnName}'`);
}

/** Parse an integer literal, rejecting float literals with a tiered message. */
function parseLiteral(lit: Literal, block: DoBlockElem): number {
  if (lit.value === "true") return 1;
  if (lit.value === "false") return 0;
  const raw = lit.value.replace(/[uif]$/i, "").replace(/_/g, "");
  if (!/^[+-]?\d+$/.test(raw)) {
    throw rejection(
      block,
      `the float literal '${lit.value}'`,
      "Tier 3",
      "WGSL numeric types",
    );
  }
  return Number.parseInt(raw, 10);
}

function evalUnary(
  expr: UnaryExpression,
  block: DoBlockElem,
  scope: Scope,
): number {
  const v = evalExpr(expr.expression, block, scope);
  switch (expr.operator.value) {
    case "-":
      return -v | 0; // unary minus is signed (i32); u32 has no negation
    case "~":
      return ~v >>> 0;
    case "!":
      return v === 0 ? 1 : 0;
    default:
      throw blockError(block, `unsupported unary '${expr.operator.value}'`);
  }
}

/** Binary op dispatch. `&&`/`||` short-circuit; comparisons/logical yield 1/0. */
function evalBinary(
  expr: BinaryExpression,
  block: DoBlockElem,
  scope: Scope,
): number {
  const op = expr.operator.value;
  const l = evalExpr(expr.left, block, scope);
  if (op === "&&")
    return truthy(l) ? boolBit(truthy(evalExpr(expr.right, block, scope))) : 0;
  if (op === "||")
    return truthy(l) ? 1 : boolBit(truthy(evalExpr(expr.right, block, scope)));
  const r = evalExpr(expr.right, block, scope);
  return applyBinary(op, l, r, block);
}

/** Apply a binary arithmetic/comparison/bitwise op to two evaluated scalars. */
function applyBinary(
  op: string,
  l: number,
  r: number,
  block: DoBlockElem,
): number {
  switch (op) {
    case "+":
      return wrapInt(l + r, l, r);
    case "-":
      return wrapInt(l - r, l, r);
    case "*":
      return wrapInt(l * r, l, r);
    case "/":
      if (r === 0) throw blockError(block, "integer division by zero");
      return wrapInt(Math.trunc(l / r), l, r);
    case "%":
      if (r === 0) throw blockError(block, "integer remainder by zero");
      return wrapInt(l % r, l, r);
    case "<":
      return boolBit(l < r);
    case "<=":
      return boolBit(l <= r);
    case ">":
      return boolBit(l > r);
    case ">=":
      return boolBit(l >= r);
    case "==":
      return boolBit(l === r);
    case "!=":
      return boolBit(l !== r);
    case "&":
      return (l & r) >>> 0;
    case "|":
      return (l | r) >>> 0;
    case "^":
      return (l ^ r) >>> 0;
    case "<<":
      return (l << r) >>> 0;
    case ">>":
      return l >>> r;
    default:
      throw new Error(`unsupported binary operator '${op}'`);
  }
}

/**
 * Wrap an integer arithmetic result at the 32-bit boundary. The interpreter
 * doesn't track signedness, so we infer it from the operands: a negative
 * operand means i32 math, so keep the signed result via `| 0`; otherwise the
 * operands are u32 and an underflowing result wraps modulo 2^32 via `>>> 0`
 * (so `0u - 1u` == 4294967295, matching WGSL). Non-integer results pass
 * through unwrapped so a stray float surfaces as-is.
 */
function wrapInt(result: number, ...operands: number[]): number {
  if (!Number.isInteger(result)) return result;
  if (operands.some(o => o < 0)) return result | 0;
  return result >>> 0;
}

/** Comparisons and logical ops yield 1/0; there is no distinct bool type yet. */
function boolBit(b: boolean): number {
  return b ? 1 : 0;
}

function truthy(v: number): boolean {
  return v !== 0;
}

/** An interpreter error scoped to a do block, prefixed with the block's name. */
function blockError(block: DoBlockElem, msg: string): Error {
  return new Error(`do block '${block.name.name}': ${msg}`);
}

/** Build a tiered rejection error: names the construct and the tier required. */
function rejection(
  block: DoBlockElem,
  construct: string,
  tier: string,
  feature: string,
): Error {
  return blockError(
    block,
    `${construct} is not yet supported (${tier}: ${feature})`,
  );
}

/** Convert evaluated call args into workgroup dispatch dimensions. */
function dispatchDims(args: number[]): number | [number, number, number] {
  if (args.length === 0) return 1;
  if (args.length === 1) return args[0];
  const [x, y = 1, z = 1] = args;
  return [x, y, z];
}
