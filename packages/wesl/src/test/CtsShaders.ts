import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
  BinaryExpression,
  ExpressionElem,
  ModuleElem,
} from "../AbstractElems.ts";
import { stdEnumerant, stdType } from "../StandardTypes.ts";
import { checkModule } from "../types/Bidirectional.ts";
import { evalConstExpr } from "../types/ConstEval.ts";
import { type TypeContext, typeOfExpr } from "../types/TypeSynthesis.ts";
import { elemsOfKind, typeTest } from "./TypeTestUtil.ts";

/**
 * The WebGPU CTS shader validation corpus, as a no-false-rejection oracle.
 *
 * Every shader here is one the CTS asserts a WGSL implementation must accept.
 * Per the project direction wesl does not aim to reject invalid WGSL, so the
 * "did we catch the error" half of the validation suite is out of scope -- but
 * the other half is exactly what a partial type checker has to get right:
 *
 *   a shader the spec calls valid must parse, must bind, and must not make the
 *   type core throw.
 *
 * Valid WGSL also pins down two things const evaluation cannot be wrong about:
 * a `const` initializer must be const-evaluable, and a `const_assert` in a
 * shader that compiles must evaluate to `true`. Those are answers we can get
 * wrong, not merely fail to produce, so they are checked as failures. Where we
 * simply cannot evaluate (an unimplemented builtin, say), that is a gap: it is
 * counted and reported, not failed, since a partial evaluator is allowed to
 * give up but is never allowed to lie.
 *
 * `cts/transpiler/tools/dump_shaders` writes the JSON checked into the cts fork
 * under dumps/shaders/; see that tool for the wire format.
 */

export interface Shader {
  /**
   * The CTS test parameters that generated this shader. Nothing here reads it --
   * checkShader looks at `code` only; it is kept so a failing shader can be
   * traced back to the CTS test case that produced it. See dump_shaders for the
   * wire format.
   */
  params: unknown;
  code: string;
}

export interface SpecShaders {
  /** shaders the spec recorded, before dedup and sampling */
  total: number;
  /** distinct sources among them */
  unique: number;
  shaders: Shader[];
}

export interface ShaderFile {
  /** the top level validation group, e.g. 'const_assert' */
  group: string;
  specs: Record<string, SpecShaders>;
  /** "keep" for a checked-in keep-set file, "corpus" for the sampled corpus */
  origin: string;
}

/** What replaying one shader through the front end found. */
export interface ShaderResult {
  /** a hard failure: we rejected, crashed on, or misjudged valid WGSL */
  failure: string | null;
  /** expressions whose type we could not synthesize */
  unknownTypes: number;
  expressions: number;
  /** const decls and const_asserts we could not evaluate */
  constGaps: number;
  constExprs: number;
  /** untyped value expressions attributed to their construct key -> count */
  untypedConstructs: Map<string, number>;
  /** un-evaluated const expressions attributed to their construct key -> count */
  unevaluatedConstructs: Map<string, number>;
}

/** A running by-construct tally of one gap category across the corpus: how many
 * gaps each construct accounts for, and the specs it shows up in. */
export interface GapTally {
  /** construct key -> total gap count */
  gaps: Map<string, number>;
  /** construct key -> set of spec names the construct was a gap in */
  specs: Map<string, Set<string>>;
}

/** Why a construct is allowed to be a gap: `skip` is out of scope by design,
 * `todo` is something we want and have not built yet. */
export interface Triage {
  status: "skip" | "todo";
  reason: string;
}

/** How much of the corpus the front end understood, for the report header. */
export interface GapTotals {
  expressions: number;
  unknownTypes: number;
  constExprs: number;
  constGaps: number;
}

/**
 * Every construct the corpus reports a gap for, with a reason. A gap is
 * tolerated only if it is named here, so a new one shows up as a test failure
 * rather than as a slightly worse number: fix it, or record why it stays.
 * Keyed by the construct keys `constructKey` produces.
 */
export const gapTriage: Record<string, Triage> = {
  ...triage(
    "todo",
    "const-evaluable bit-manipulation builtin, not yet implemented",
    [
      "call:countLeadingZeros",
      "call:countOneBits",
      "call:countTrailingZeros",
      "call:extractBits",
      "call:insertBits",
      "call:firstLeadingBit",
      "call:firstTrailingBit",
      "call:reverseBits",
    ],
  ),
  ...triage(
    "todo",
    "const-evaluable data-packing builtin, not yet implemented",
    [
      "call:pack2x16float",
      "call:pack2x16snorm",
      "call:pack2x16unorm",
      "call:pack4x8snorm",
      "call:pack4x8unorm",
      "call:pack4xI8",
      "call:pack4xI8Clamp",
      "call:pack4xU8",
      "call:pack4xU8Clamp",
      "call:unpack2x16float",
      "call:unpack2x16snorm",
      "call:unpack2x16unorm",
      "call:unpack4x8snorm",
      "call:unpack4x8unorm",
      "call:unpack4xI8",
      "call:unpack4xU8",
      "call:dot4I8Packed",
      "call:dot4U8Packed",
    ],
  ),
  ...triage("todo", "const bitcast deferred: bit reinterpretation, inf/nan", [
    "call:bitcast",
  ]),
  ...triage(
    "todo",
    "ldexp concretizes an abstract 1st arg to f32 when the exponent is i32",
    ["call:ldexp"],
  ),
  ...triage("todo", "matrix operator const-eval not implemented", [
    "binary:+:mat",
    "binary:-:mat",
    "binary:*:mat",
  ]),
  ...triage("todo", "pointer and reference types not modeled", [
    "ref",
    "unary:&",
  ]),
  ...triage("todo", "abstract-int shift past the bit width not evaluated", [
    "binary:>>",
    "binary:>>:vec",
  ]),
};

/** The tiny curated keep-set, always checked in and always run. */
const keepDir = path.resolve(import.meta.dirname, "../../cts-keep/shaders");

/** The sampled corpus: the dumps checked into the cts fork, or a fuller dump
 * named by WESL_CTS_SHADERS (see `dump_shaders --max 0` for a scratch dump). */
const corpusDir =
  process.env.WESL_CTS_SHADERS ??
  path.resolve(import.meta.dirname, "../../../../cts/dumps/shaders");

/** Where the full by-construct gap tally is written, overwritten each run. It is
 * gitignored (a derived report), so it stays greppable without a rerun. */
const gapReportPath = path.resolve(
  import.meta.dirname,
  "../../.cts-cache/gap-report.md",
);

/** The keep-set plus the sampled corpus, each file tagged with its origin. */
export function shaderFiles(): ShaderFile[] {
  return [
    ...readShaderDir(keepDir, "keep"),
    ...readShaderDir(corpusDir, "corpus"),
  ];
}

/**
 * Replay one valid shader through parse, bind, and the type core.
 *
 * Everything the front end is allowed to be unsure about is counted rather than
 * failed; only rejecting, crashing, or evaluating to a wrong answer is a
 * failure.
 */
export function checkShader(code: string): ShaderResult {
  const result: ShaderResult = {
    failure: null,
    unknownTypes: 0,
    expressions: 0,
    constGaps: 0,
    constExprs: 0,
    untypedConstructs: new Map(),
    unevaluatedConstructs: new Map(),
  };

  // Parse and bind are strict: on valid WGSL, a diagnostic or an unbound
  // identifier is itself the false rejection we are looking for, and both
  // surface as a throw.
  let ctx: TypeContext;
  let moduleElem: ModuleElem;
  try {
    ({ ctx, moduleElem } = typeTest(code));
  } catch (e) {
    result.failure = `parse/bind: ${message(e)}`;
    return result;
  }

  try {
    checkModule(moduleElem, ctx);
    typeEveryExpression(moduleElem, ctx, result);
    evalConstDecls(moduleElem, ctx, result);
    result.failure = evalConstAsserts(moduleElem, ctx, result);
  } catch (e) {
    result.failure = `type core: ${message(e)}`;
  }
  return result;
}

export function newGapTally(): GapTally {
  return { gaps: new Map(), specs: new Map() };
}

/** Fold one shader's per-construct gap counts (from a ShaderResult) into the
 * running tally, recording which spec they came from. */
export function addShaderGaps(
  tally: GapTally,
  spec: string,
  counts: Map<string, number>,
): void {
  for (const [key, count] of counts) {
    tally.gaps.set(key, (tally.gaps.get(key) ?? 0) + count);
    const specs = tally.specs.get(key) ?? new Set<string>();
    specs.add(spec);
    tally.specs.set(key, specs);
  }
}

/** Total gaps per construct across both categories. */
export function gapCounts(
  untyped: GapTally,
  unevaluated: GapTally,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tally of [untyped, unevaluated]) {
    for (const [key, gaps] of tally.gaps) {
      counts.set(key, (counts.get(key) ?? 0) + gaps);
    }
  }
  return counts;
}

/** Write the full by-construct gap tally to gapReportPath (greppable, stable
 * order); nothing is printed and nothing gates on it. */
export function gapReport(
  untyped: GapTally,
  unevaluated: GapTally,
  totals: GapTotals,
): void {
  const observed = gapCounts(untyped, unevaluated);
  const stale = Object.keys(gapTriage).filter(key => !observed.has(key));
  const full = [
    "# CTS shader oracle gap report",
    formatTotals(totals),
    formatTally("Untyped value expressions", untyped),
    formatTally("Un-evaluated const expressions", unevaluated),
    formatStale(stale),
  ].join("\n\n");
  mkdirSync(path.dirname(gapReportPath), { recursive: true });
  writeFileSync(gapReportPath, `${full}\n`);
}

/** Every expression in the module. `type` (a template_elaborated_ident) is left
 * out: it is an ExpressionElem only in primary position, and elsewhere names a
 * type rather than a value. */
function expressions(moduleElem: ModuleElem): ExpressionElem[] {
  const kinds = [
    "literal",
    "ref",
    "parenthesized-expression",
    "component-expression",
    "component-member-expression",
    "unary-expression",
    "binary-expression",
    "call-expression",
  ] as const;
  return kinds.flatMap(kind => elemsOfKind(moduleElem, kind));
}

/** One reason shared by a list of construct keys. */
function triage(
  status: Triage["status"],
  reason: string,
  keys: string[],
): Record<string, Triage> {
  return Object.fromEntries(keys.map(key => [key, { status, reason }]));
}

/** The shader files under `dir`, in a stable order, tagged with `origin`.
 * manifest.json is the SHA stamp, not a shader file, so it is skipped. */
function readShaderDir(dir: string, origin: string): ShaderFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".json") && f !== "manifest.json")
    .sort()
    .map(f => ({
      ...(JSON.parse(readFileSync(path.join(dir, f), "utf8")) as ShaderFile),
      origin,
    }));
}

function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0];
}

/** Synthesize a type for every value expression in the module, counting the ones
 * we cannot determine. A throw here is a failure; `unknown` is only a gap. */
function typeEveryExpression(
  moduleElem: ModuleElem,
  ctx: TypeContext,
  result: ShaderResult,
): void {
  const skip = nonValueRefs(moduleElem);
  for (const expr of expressions(moduleElem)) {
    if (skip.has(expr)) continue;
    result.expressions++;
    if (typeOfExpr(expr, ctx).kind === "unknown") {
      result.unknownTypes++;
      countKey(result.untypedConstructs, constructKey(expr, ctx));
    }
  }
}

/** A `const` initializer is const-evaluable in any valid WGSL, so failing to
 * evaluate one is a gap in the evaluator (counted, not failed). */
function evalConstDecls(
  moduleElem: ModuleElem,
  ctx: TypeContext,
  result: ShaderResult,
): void {
  for (const decl of elemsOfKind(moduleElem, "const")) {
    if (!decl.init) continue;
    result.constExprs++;
    if (evalConstExpr(decl.init, ctx) === null) {
      result.constGaps++;
      countKey(result.unevaluatedConstructs, constructKey(decl.init, ctx));
    }
  }
}

/** A `const_assert` in a shader the CTS says compiles holds by construction, so
 * evaluating one to `false` means we computed a wrong answer. */
function evalConstAsserts(
  moduleElem: ModuleElem,
  ctx: TypeContext,
  result: ShaderResult,
): string | null {
  for (const assert of elemsOfKind(moduleElem, "assert")) {
    result.constExprs++;
    const value = evalConstExpr(assert.expression, ctx);
    if (value === null) {
      result.constGaps++;
      countKey(
        result.unevaluatedConstructs,
        constructKey(assert.expression, ctx),
      );
    } else if (value.kind !== "scalar" || value.value !== true) {
      return `const_assert evaluated to ${show(value)}, but the shader is valid`;
    }
  }
  return null;
}

/** The corpus-wide fractions, informational: no floor gates on them. */
function formatTotals(t: GapTotals): string {
  const typed = percent(t.expressions - t.unknownTypes, t.expressions);
  const evaluated = percent(t.constExprs - t.constGaps, t.constExprs);
  return [
    `${t.expressions} value expressions, ${typed} typed`,
    `${t.constExprs} const expressions, ${evaluated} evaluated`,
  ].join("; ");
}

/** One tally category as a plain-text table, sorted count desc then key asc so
 * diffs between runs are meaningful. An empty tally reports that rather than an
 * empty table. */
function formatTally(title: string, tally: GapTally): string {
  const rows = [...tally.gaps.entries()]
    .map(([key, gaps]) => ({
      key,
      gaps,
      specs: tally.specs.get(key)?.size ?? 0,
      status: gapTriage[key]?.status ?? "-",
    }))
    .sort((a, b) => b.gaps - a.gaps || (a.key < b.key ? -1 : 1));
  const total = rows.reduce((sum, r) => sum + r.gaps, 0);
  if (rows.length === 0) return `${title}: none.`;

  const head = `${title}: ${total} gaps across ${rows.length} constructs`;
  const cols = `  ${"count".padStart(7)}${"specs".padStart(7)}  ${"status".padEnd(6)}  construct`;
  const lines = rows.map(
    r =>
      `  ${String(r.gaps).padStart(7)}${String(r.specs).padStart(7)}  ${r.status.padEnd(6)}  ${r.key}`,
  );
  return [head, cols, ...lines].join("\n");
}

/** Triage entries no gap matched any more. Reported, never gated: the corpus is
 * sampled, so a construct can drop out of the fixtures without being fixed. */
function formatStale(keys: string[]): string {
  const title = "Triaged but not observed -- possibly done, consider pruning";
  if (keys.length === 0) return `${title}: none.`;
  const lines = keys
    .sort()
    .map(key => `  ${gapTriage[key].status.padEnd(6)}  ${key}`);
  return [`${title}: ${keys.length}`, ...lines].join("\n");
}

/**
 * Identifiers that name something other than a value, and so have no value type:
 * a callee (`f32` in `f32(y)`), a type (`f32` in `let x: f32`, or in a template
 * argument like `bitcast<f32>`), or a predeclared enumerant (`read_write` in
 * `var<storage, read_write>`). They are `ref` elems like any other, so counting
 * them as unknown would understate what the type core knows.
 */
function nonValueRefs(moduleElem: ModuleElem): Set<ExpressionElem> {
  const skip = new Set<ExpressionElem>();
  for (const call of elemsOfKind(moduleElem, "call-expression")) {
    skip.add(call.function);
  }
  for (const typeRef of elemsOfKind(moduleElem, "type")) {
    skip.add(typeRef.name.refIdentElem);
  }
  for (const ref of elemsOfKind(moduleElem, "ref")) {
    const { originalName } = ref.ident;
    if (stdType(originalName) || stdEnumerant(originalName)) skip.add(ref);
  }
  return skip;
}

function countKey(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** A stable key naming the construct a gap came from, e.g. `call:textureSample`,
 * `binary:*:mat`, `unary:-`, or a bare expression kind. Read from the AST (and
 * the synthesized operand types) only, never the sampled source text, so the
 * tally is stable across fixture regens. */
function constructKey(expr: ExpressionElem, ctx: TypeContext): string {
  switch (expr.kind) {
    case "call-expression": {
      const fn = expr.function;
      const name =
        fn.kind === "type" ? fn.name.originalName : fn.ident.originalName;
      return `call:${name}`;
    }
    case "binary-expression":
      return `binary:${expr.operator.value}${operandSuffix(expr, ctx)}`;
    case "unary-expression":
      return `unary:${expr.operator.value}`;
    default:
      return expr.kind;
  }
}

function show(v: { kind: string; value?: unknown }): string {
  return v.kind === "scalar" ? String(v.value) : v.kind;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`;
}

/** `:mat` or `:vec` when a binary operand is composite, so a row like
 * `binary:*:mat` says which operand family the gap is about; scalar (and
 * untypable) operands keep the bare key. */
function operandSuffix(expr: BinaryExpression, ctx: TypeContext): string {
  const kinds = [expr.left, expr.right].map(e => typeOfExpr(e, ctx).kind);
  if (kinds.includes("matrix")) return ":mat";
  if (kinds.includes("vector")) return ":vec";
  return "";
}
