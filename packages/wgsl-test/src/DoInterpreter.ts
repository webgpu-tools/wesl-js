import type {
  BinaryExpression,
  BlockElem,
  DoBlockElem,
  ExpressionElem,
  FunctionCallExpression,
  LetElem,
  Literal,
  UnaryExpression,
  VarElem,
  WeslAST,
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
}

interface Env {
  entryPoints: Map<string, EntryPoint>;
  doBlocks: Map<string, DoBlockElem>;
  pipelines: Map<string, GPUComputePipeline>;
  encoder: GPUCommandEncoder;
  bindGroup: GPUBindGroup;
  renderFragment?: (entry: EntryPoint) => void;
  depth: number;
  maxDepth: number;
}

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
  };
  interpretBlock(block, env, new Map());
}

/** Interpret a do block body in a child scope, guarding recursion depth. */
function interpretBlock(
  block: DoBlockElem,
  env: Env,
  parentScope: Map<string, number>,
): void {
  if (env.depth >= env.maxDepth) {
    throw new Error(
      `do block '${block.name.name}' exceeded recursion depth ${env.maxDepth}`,
    );
  }
  env.depth++;
  try {
    const scope = new Map(parentScope);
    for (const elem of block.body.contents) {
      interpretStatement(elem, block, env, scope);
    }
  } finally {
    env.depth--;
  }
}

/** Interpret one body statement: skip text, bind let/var locals, dispatch calls. */
function interpretStatement(
  elem: BlockElem["contents"][number],
  block: DoBlockElem,
  env: Env,
  scope: Map<string, number>,
): void {
  if (elem.kind === "text") return;
  if (elem.kind === "let" || elem.kind === "var") {
    bindLocal(elem, block, scope);
    return;
  }
  if (elem.kind === "call") {
    dispatchCall(elem.call, block, env, scope);
    return;
  }
  throw new Error(
    `do block '${block.name.name}' contains a statement unsupported by ` +
      `the interpreter (straight-line only: let/var bindings + entry-point or do calls)`,
  );
}

function bindLocal(
  decl: LetElem | VarElem,
  block: DoBlockElem,
  scope: Map<string, number>,
): void {
  const name = decl.name.decl.ident.originalName;
  if (!decl.init) {
    throw new Error(
      `do block '${block.name.name}': '${decl.kind} ${name}' has no initializer`,
    );
  }
  scope.set(name, evalExpr(decl.init, block, scope));
}

/** Dispatch a call: entry-point => GPU dispatch, do block => recurse. */
function dispatchCall(
  call: FunctionCallExpression,
  block: DoBlockElem,
  env: Env,
  scope: Map<string, number>,
): void {
  const targetName = callTargetName(call);
  if (!targetName) {
    throw new Error(
      `do block '${block.name.name}': could not resolve call target`,
    );
  }
  const args = call.arguments.map(a => evalExpr(a, block, scope));

  const entry = env.entryPoints.get(targetName);
  if (entry) {
    dispatchEntryPoint(entry, args, block, env);
    return;
  }

  const childBlock = env.doBlocks.get(targetName);
  if (childBlock) {
    interpretBlock(childBlock, env, scope);
    return;
  }

  throw new Error(
    `do block '${block.name.name}': call to undefined target '${targetName}'`,
  );
}

function evalExpr(
  expr: ExpressionElem,
  block: DoBlockElem,
  scope: Map<string, number>,
): number {
  switch (expr.kind) {
    case "literal":
      return parseLiteral(expr, block);
    case "ref": {
      const name = expr.ident.originalName;
      const value = scope.get(name);
      if (value === undefined) {
        throw new Error(
          `do block '${block.name.name}': unbound name '${name}' ` +
            "(evaluator handles only let/var locals)",
        );
      }
      return value;
    }
    case "parenthesized-expression":
      return evalExpr(expr.expression, block, scope);
    case "unary-expression":
      return evalUnary(expr, block, scope);
    case "binary-expression":
      return evalBinary(expr, block, scope);
    default:
      throw new Error(
        `do block '${block.name.name}': unsupported expression kind ` +
          `'${expr.kind}' (interpreter supports integer literals/refs/arithmetic)`,
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
      throw new Error(
        `do block '${block.name.name}': no compute pipeline for ` +
          `entry point '${entry.fnName}'`,
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
      throw new Error(
        `do block '${block.name.name}': fragment call '${entry.fnName}' ` +
          "but no renderFragment hook supplied",
      );
    }
    env.renderFragment(entry);
    return;
  }
  throw new Error(
    `do block '${block.name.name}': cannot call ${entry.stage} entry '${entry.fnName}'`,
  );
}

function parseLiteral(lit: Literal, block: DoBlockElem): number {
  const raw = lit.value.replace(/[uif]$/i, "").replace(/_/g, "");
  if (!/^[+-]?\d+$/.test(raw)) {
    throw new Error(
      `do block '${block.name.name}': non-integer literal '${lit.value}' ` +
        "(evaluator is integer-only)",
    );
  }
  return Number.parseInt(raw, 10);
}

function evalUnary(
  expr: UnaryExpression,
  block: DoBlockElem,
  scope: Map<string, number>,
): number {
  const v = evalExpr(expr.expression, block, scope);
  switch (expr.operator.value) {
    case "-":
      return -v;
    case "~":
      return ~v;
    case "!":
      return v === 0 ? 1 : 0;
    default:
      throw new Error(
        `do block '${block.name.name}': unsupported unary '${expr.operator.value}'`,
      );
  }
}

function evalBinary(
  expr: BinaryExpression,
  block: DoBlockElem,
  scope: Map<string, number>,
): number {
  const l = evalExpr(expr.left, block, scope);
  const r = evalExpr(expr.right, block, scope);
  switch (expr.operator.value) {
    case "+":
      return l + r;
    case "-":
      return l - r;
    case "*":
      return l * r;
    case "/":
      return Math.trunc(l / r);
    case "%":
      return l % r;
    default:
      throw new Error(
        `do block '${block.name.name}': unsupported binary '${expr.operator.value}' ` +
          "(interpreter supports + - * / %)",
      );
  }
}

/** Convert evaluated call args into workgroup dispatch dimensions. */
function dispatchDims(args: number[]): number | [number, number, number] {
  if (args.length === 0) return 1;
  if (args.length === 1) return args[0];
  const [x, y = 1, z = 1] = args;
  return [x, y, z];
}
