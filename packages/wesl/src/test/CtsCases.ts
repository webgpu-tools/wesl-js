import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  abstractIntMin,
  type ConstValue,
  i32MinBig,
} from "../types/ConstValues.ts";
import type { ScalarKind } from "../types/Types.ts";

/**
 * The WebGPU CTS expression case tables, as a const-evaluation oracle.
 *
 * The CTS builds these tables in TypeScript (no GPU involved): each case pairs
 * inputs with an expected value or an accuracy interval, computed by the CTS's
 * own floating point library. The abstract-float and abstract-int tables are
 * const-only by construction, since abstract numerics never reach a GPU.
 *
 * `cts/transpiler/tools/dump_cases` dumps them to the JSON checked into the cts
 * fork under dumps/cases/; see that tool for the wire format. This module decodes
 * them, synthesizes the WGSL that exercises each case, and checks a result
 * against an expectation.
 */

/** A case list: inputs and an expectation share one shape across the list. */
export interface CaseList {
  /** type of each input, e.g. ["abstract-float", "vec3<abstract-float>"] */
  inputs: string[];
  expectation: ExpKind;
  /** cases before sampling and before dropping unconstrained ones */
  total: number;
  skipped: number;
  cases: [Payload[], Payload][];
}

export interface CaseFile {
  cache: string;
  lists: Record<string, CaseList>;
  /** "keep" for a checked-in keep-set file, "corpus" for the generated sample */
  origin: string;
}

/**
 * A list's expectation schema, shared by every case. Tagged on `kind`: `value`
 * matches exactly, `interval` accepts anything inside the accuracy bounds, and
 * `anyOf` passes if any one option matches. A single `interval` covers scalar,
 * vector, and matrix results -- the dimensionality lives in the payload nesting,
 * not the tag.
 */
export type ExpKind =
  | { kind: "value"; type: string }
  | { kind: "interval"; precision: FpKind }
  | { kind: "anyOf"; option: ExpKind };
export type Payload = Num | Payload[];

type FpKind = "abstract" | "f32" | "f16";

/** A number, a bool, or "inf" / "-inf" / "nan" / "-0" / a big decimal integer. */
type Num = number | string | boolean;

type Shape =
  | { kind: "binary"; op: string }
  | { kind: "unary"; op: string }
  | { kind: "assign"; type?: string }
  | { kind: "call"; name: string; member?: string };

/**
 * Cases where we knowingly differ from the CTS, keyed by "<cache> <list>" and
 * matched on the JSON of a case's inputs. Kept tiny and explicit: a divergence
 * belongs here only with a reason, never to quiet an unexplained failure.
 */
export const divergences: Record<string, Record<string, string>> = {
  // Both are the same disagreement: the magnitude of the most negative
  // abstract-int is one past the positive maximum, so negating (or taking the
  // absolute value of) it overflows 64 bits. The CTS expects the value wrapped,
  // because its own abstract-int is an i64 (it stores through a BigInt64Array).
  //
  // WGSL calls the overflow a shader-creation error, so we decline to fold it
  // (`abstractIntResult`) rather than invent a value. Wrapping would mean
  // folding an expression the spec says cannot exist.
  "unary/ai_arithmetic negation": {
    '["-9223372036854775808"]': "negation overflows the 64-bit abstract-int",
  },
  "abs abstract_int": {
    '["-9223372036854775808"]': "abs overflows the 64-bit abstract-int",
  },
};

/** The tiny curated keep-set, always checked in and always run. */
const keepDir = path.resolve(import.meta.dirname, "../../cts-keep/cases");

/** The sampled corpus: an explicit WESL_CTS_CASES dump, else the dumps checked
 * into the cts fork; see `dump_cases --max 0` for a full scratch dump. */
const corpusDir =
  process.env.WESL_CTS_CASES ??
  path.resolve(import.meta.dirname, "../../../../cts/dumps/cases");

const floatSuffix: Record<string, string> = {
  "abstract-float": "",
  f32: "f",
  f16: "h",
};

const comparisonOp: Record<string, string> = {
  equals: "==",
  not_equals: "!=",
  less_than: "<",
  less_equals: "<=",
  greater_than: ">",
  greater_equals: ">=",
};

const arithmeticOp: Record<string, string> = {
  addition: "+",
  subtraction: "-",
  multiplication: "*",
  division: "/",
  remainder: "%",
};

/** Smallest positive normal value: below it (and above zero) lies the subnormal range. */
const subnormalMin: Partial<Record<ScalarKind, number>> = {
  "abstract-float": 2 ** -1022,
  f32: 2 ** -126,
  f16: 2 ** -14,
};

/** The keep-set plus the sampled corpus, each file tagged with its origin. */
export function caseFiles(): CaseFile[] {
  return [...readCaseDir(keepDir, "keep"), ...readCaseDir(corpusDir, "corpus")];
}

/** The WGSL under test for one case list, or null if we don't model this cache. */
export function caseSource(
  cache: string,
  list: string,
  cases: [Payload[], Payload][],
  inTypes: string[],
): string | null {
  const shape = caseShape(cache, list);
  if (!shape) return null;

  const decls = cases.map(([inputs], i) => {
    const args = inputs.map((p, j) => literal(p, inTypes[j]));
    if (shape.kind === "call") {
      const call = `${shape.name}(${args.join(", ")})`;
      const expr = shape.member ? `${call}.${shape.member}` : call;
      return `const ${resultName(i)} = ${expr};`;
    }
    if (shape.kind === "binary") {
      return `const ${resultName(i)} = ${args[0]} ${shape.op} ${args[1]};`;
    }
    if (shape.kind === "unary") {
      // parenthesized: a negative literal is itself a unary minus, and '--' lexes
      // as the decrement operator
      return `const ${resultName(i)} = ${shape.op}(${args[0]});`;
    }
    // An assignment case tests the implicit conversion to the declared type,
    // which const-eval applies when the decl is referenced, not in the init.
    if (!shape.type) return `const ${resultName(i)} = ${args[0]};`;
    return (
      `const in${i} : ${shape.type} = ${args[0]};\n` +
      `const ${resultName(i)} = in${i};`
    );
  });

  const f16 =
    inTypes.some(t => t.includes("f16")) ||
    (shape.kind === "assign" && shape.type === "f16");
  return (f16 ? "enable f16;\n" : "") + decls.join("\n");
}

export function resultName(i: number): string {
  return `out${i}`;
}

/**
 * One case rendered as a single human line, e.g.
 *   binary/af_addition [scalar]:  -1.5 + 2.0  ==  0.5    (abstract-float, exact)
 * The const-eval oracle prints it in failure messages, and dump_cases seeds its
 * worked examples from it, so the two stay tied to the wire format. The
 * expression reuses the same caseShape + literal machinery as caseSource.
 */
export function caseToString(
  cache: string,
  list: string,
  inTypes: string[],
  exp: ExpKind,
  [inputs, expected]: [Payload[], Payload],
): string {
  const shape = caseShape(cache, list);
  const lhs = shape ? caseExpr(shape, inputs, inTypes) : JSON.stringify(inputs);
  const rhs = showExpected(expected, exp);
  return `${cache} [${list}]:  ${lhs}  ==  ${rhs}    (${annotate(exp, expected)})`;
}

/** Whether `got` satisfies the case's expectation; a message when it doesn't. */
export function checkExpectation(
  got: ConstValue | null,
  expected: Payload,
  kind: ExpKind,
): string | null {
  if (!got) return "not const-evaluable";

  if (kind.kind === "anyOf") {
    const options = expected as Payload[];
    const fails = options.map(o => checkExpectation(got, o, kind.option));
    if (fails.some(f => f === null)) return null;
    return `${show(got)} matched none of ${options.map(o => JSON.stringify(o)).join(" | ")}`;
  }

  if (kind.kind === "value") {
    const want = expected;
    return sameValue(got, want, kind.type)
      ? null
      : `expected ${kind.type} ${JSON.stringify(want)}, got ${show(got)}`;
  }

  // The interval kind accepts anything inside the accuracy bounds; the payload
  // nesting carries the scalar / vector / matrix shape, flattened on both sides.
  const scalars = flatScalars(got);
  const bounds = flatIntervals(expected);
  if (!scalars) return `expected float values, got ${show(got)}`;
  if (scalars.length !== bounds.length) {
    return `expected ${bounds.length} components, got ${scalars.length}`;
  }
  const bad = scalars.findIndex(
    (n, i) => !contains(bounds[i], n, kind.precision),
  );
  if (bad < 0) return null;
  const [lo, hi] = bounds[bad];
  return `component ${bad} = ${scalars[bad]} outside [${lo}, ${hi}]`;
}

/** The case files under `dir`, in a stable order, tagged with `origin`.
 * manifest.json is the src-tree stamp, not a case file, so it is skipped. */
function readCaseDir(dir: string, origin: string): CaseFile[] {
  if (!existsSync(dir)) return [];
  const paths: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort()) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".json") && entry.name !== "manifest.json")
        paths.push(p);
    }
  };
  walk(dir);
  return paths.map(f => ({
    ...(JSON.parse(readFileSync(f, "utf8")) as CaseFile),
    origin,
  }));
}

/** How to build the expression under test, per cache (and per list, where the
 * list name carries the operator). Caches we don't model return null. */
function caseShape(cache: string, list: string): Shape | null {
  switch (cache) {
    case "binary/af_addition":
      return { kind: "binary", op: "+" };
    case "binary/af_subtraction":
      return { kind: "binary", op: "-" };
    case "binary/af_multiplication":
      return { kind: "binary", op: "*" };
    case "binary/af_division":
      return { kind: "binary", op: "/" };
    case "binary/af_remainder":
      return { kind: "binary", op: "%" };
    case "binary/af_logical": {
      const op = comparisonOp[list];
      return op ? { kind: "binary", op } : null;
    }
    case "binary/ai_arithmetic": {
      const op = arithmeticOp[list.split("_")[0]];
      return op ? { kind: "binary", op } : null;
    }
    case "unary/af_arithmetic":
    case "unary/ai_arithmetic":
      return list === "negation" ? { kind: "unary", op: "-" } : null;
    case "unary/af_assignment":
    case "unary/ai_assignment":
      // 'abstract' keeps the abstract type; the others convert to a concrete one
      return { kind: "assign", type: list === "abstract" ? undefined : list };
    case "frexp":
    case "modf": {
      // these return a two-member struct, and a case list tests one member of
      // it: 'f32_vec2_exp' expects the exp of frexp(vec2<f32>)
      const member = list.split("_").pop();
      return { kind: "call", name: cache, member };
    }
    default:
      // The builtin caches are named for the builtin itself ('abs', 'atan2'),
      // where the operator caches are path-named ('binary/af_addition'). Arity
      // comes from the case's inputs, so builtins need no table of their own.
      return cache.includes("/") ? null : { kind: "call", name: cache };
  }
}

/** A WGSL literal (or vector/matrix constructor) denoting a case input. */
function literal(p: Payload, type: string): string {
  // a matrix constructor takes its elements column-major, which is the order the
  // payload already nests them in
  const composite = /^(vec[234]|mat[234]x[234])<(.+)>$/.exec(type);
  if (composite) {
    const elems = (p as Payload[]).flat().map(e => literal(e, composite[2]));
    return `${composite[1]}(${elems.join(", ")})`;
  }
  if (type === "bool") return String(p);

  const n = decodeNum(p);
  if (type === "abstract-int") return intLiteral(n as bigint, "");
  if (type === "i32") return intLiteral(BigInt(n as number), "i");
  if (type === "u32") return `${n}u`;

  const x = Number(n);
  if (!Number.isFinite(x)) throw new Error(`no float literal for ${p}`);
  const suffix = floatSuffix[type];
  if (suffix === undefined) throw new Error(`unsupported input type ${type}`);
  // String(-0) is "0", so the sign has to be put back by hand
  const text = Object.is(x, -0) ? "-0" : String(x);
  // an abstract float literal needs a '.' or an exponent, or it lexes as an int
  if (suffix === "") return /[.eE]/.test(text) ? text : `${text}.0`;
  return `${text}${suffix}`;
}

/** The WGSL expression under test for one case (no surrounding decl). */
function caseExpr(shape: Shape, inputs: Payload[], inTypes: string[]): string {
  const args = inputs.map((p, j) => literal(p, inTypes[j]));
  switch (shape.kind) {
    case "binary":
      return `${args[0]} ${shape.op} ${args[1]}`;
    case "unary":
      return `${shape.op}(${args[0]})`;
    case "assign":
      return args[0]; // the value; the conversion to `type` is what is tested
    case "call": {
      const call = `${shape.name}(${args.join(", ")})`;
      return shape.member ? `${call}.${shape.member}` : call;
    }
  }
}

/** The expected side of a case as text: a bare value, an interval, or the
 * alternatives of an anyOf joined with " | ". */
function showExpected(expected: Payload, exp: ExpKind): string {
  if (exp.kind === "anyOf") {
    const options = expected as Payload[];
    return options.map(o => showExpected(o, exp.option)).join(" | ");
  }
  if (exp.kind === "value") return showValue(expected);
  return showInterval(expected);
}

/** The trailing annotation: the value's type, or the interval's precision plus
 * "exact" when every bound is zero-width. */
function annotate(exp: ExpKind, expected: Payload): string {
  if (exp.kind === "value") return exp.type;
  if (exp.kind === "anyOf") {
    return annotate(exp.option, (expected as Payload[])[0]);
  }
  const exact = flatIntervals(expected).every(([lo, hi]) => lo === hi);
  const precision =
    exp.precision === "abstract" ? "abstract-float" : exp.precision;
  return exact ? `${precision}, exact` : precision;
}

function show(v: ConstValue): string {
  if (v.kind === "scalar") return `${v.value} (${v.type.scalar})`;
  return `[${v.elements.map(show).join(", ")}]`;
}

/** Exact match against an expected value of the given CTS type. */
function sameValue(got: ConstValue, want: Payload, type: string): boolean {
  const vec = /^vec([234])<(.+)>$/.exec(type);
  if (vec) {
    if (got.kind !== "composite" || got.type.kind !== "vector") return false;
    const wants = want as Payload[];
    if (got.elements.length !== wants.length) return false;
    return got.elements.every((e, i) => sameValue(e, wants[i], vec[2]));
  }
  if (got.kind !== "scalar" || got.type.scalar !== type) return false;

  const expected = decodeNum(want);
  if (typeof expected === "boolean" || typeof got.value === "boolean") {
    return got.value === expected;
  }
  if (isFloatKind(got.type.scalar)) {
    const [a, b] = [Number(got.value), Number(expected)];
    return a === b || flush(a, got.type.scalar) === flush(b, got.type.scalar);
  }
  return BigInt(got.value) === BigInt(expected as number | bigint);
}

/** Numeric components of a scalar or vector value, or null if it is neither. */
function flatScalars(v: ConstValue): number[] | null {
  if (v.kind === "scalar") {
    return typeof v.value === "boolean" ? null : [Number(v.value)];
  }
  const elements = v.elements.map(flatScalars);
  return elements.some(e => !e) ? null : (elements.flat() as number[]);
}

/** Interval bounds in component order, for a scalar, vector, or matrix payload. */
function flatIntervals(p: Payload): [number, number][] {
  const first = (p as Payload[])[0];
  if (!Array.isArray(first)) {
    const [lo, hi] = (p as Payload[]).map(decodeNum) as number[];
    return [[lo, hi]];
  }
  return (p as Payload[]).flatMap(flatIntervals);
}

/** WGSL permits, but does not require, flushing subnormals to zero, so a
 * subnormal result is accepted wherever zero is (and the CTS bakes the flushed
 * form into some of its expectations). */
function contains([lo, hi]: [number, number], n: number, fp: FpKind): boolean {
  // an unbounded interval means the CTS defines no accuracy here, so NaN passes
  if (Number.isNaN(n)) {
    return lo === Number.NEGATIVE_INFINITY && hi === Number.POSITIVE_INFINITY;
  }
  if (lo <= n && n <= hi) return true;
  const kind = fp === "abstract" ? "abstract-float" : fp;
  const flushed = flush(n, kind);
  return flushed !== n && lo <= flushed && flushed <= hi;
}

function decodeNum(p: Payload): number | bigint | boolean {
  if (typeof p === "boolean" || typeof p === "number") return p;
  switch (p) {
    case "inf":
      return Number.POSITIVE_INFINITY;
    case "-inf":
      return Number.NEGATIVE_INFINITY;
    case "nan":
      return Number.NaN;
    case "-0":
      return -0;
    default:
      return BigInt(p as string); // an abstract-int too wide for a double
  }
}

/**
 * An integer literal. A negative literal is a unary minus applied to a positive
 * one, so the most negative value of a type has no direct literal form -- its
 * magnitude is one past the positive maximum, which is out of range. Spell it
 * the way the CTS does, as `(max - 1)`.
 */
function intLiteral(n: bigint, suffix: string): string {
  const min = suffix === "i" ? i32MinBig : abstractIntMin;
  if (n === min) return `(${min + 1n}${suffix} - 1)`;
  return `${n}${suffix}`;
}

/** A value payload as text: a scalar bare, a vector/matrix as a nested list. */
function showValue(p: Payload): string {
  return Array.isArray(p) ? `[${p.map(showValue).join(", ")}]` : String(p);
}

/** An interval payload as text: a zero-width [v, v] as `v`, a real one as
 * `[lo, hi]`, and vectors/matrices as nested lists of those. */
function showInterval(p: Payload): string {
  const arr = p as Payload[];
  if (Array.isArray(arr[0])) return `[${arr.map(showInterval).join(", ")}]`;
  const [lo, hi] = arr;
  return String(lo) === String(hi) ? String(lo) : `[${lo}, ${hi}]`;
}

function isFloatKind(kind: ScalarKind): boolean {
  return kind in subnormalMin;
}

/** Subnormals of the given float width flushed to zero; everything else as-is. */
function flush(n: number, kind: ScalarKind): number {
  const min = subnormalMin[kind];
  if (min === undefined || n === 0) return n;
  return Math.abs(n) < min ? 0 : n;
}
