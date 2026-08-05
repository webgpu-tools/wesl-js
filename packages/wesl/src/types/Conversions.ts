import {
  arrayType,
  f32Type,
  i32Type,
  matType,
  type ScalarKind,
  type ScalarType,
  type StructType,
  sameType,
  type Type,
  vecType,
} from "./Types.ts";

/** Conversion rank keyed by destination scalar; lower rank is the cheaper,
 * preferred conversion. Partial because an abstract source reaches only a few
 * destinations. Values are the spec's conversion-rank table (see below). */
type RankTable = Partial<Record<ScalarKind, number>>;

/** abstract-float -> concrete float, preferring the wider f32 over f16. */
const abstractFloatRanks: RankTable = { f32: 1, f16: 2 };

/** abstract-int -> numeric types, preferring i32 (its default concretization);
 * it can also land on a float, directly or via abstract-float. */
const abstractIntRanks: RankTable = {
  i32: 3,
  u32: 4,
  "abstract-float": 5,
  f32: 6,
  f16: 7,
};

/* LATER: For future WESL user overloads, conversionRank will probably want three
 * three outcomes (winner / no match / ambiguous)
 * And unknown argument types will need to be filtered. */

/**
 * WGSL conversion rank: the cost of automatically converting `src` to `dest`,
 * or undefined when no automatic conversion exists. Only the abstract numeric
 * types convert (concrete types never convert implicitly). One relation serves
 * both builtin overload resolution and expected-type unification:
 * "matches" everywhere means "equal, or converts with finite rank".
 *
 * See https://www.w3.org/TR/WGSL/#conversion-rank
 */
export function conversionRank(src: Type, dest: Type): number | undefined {
  // unknown is a wildcard (rank 0, never blocks matching) so unresolved types
  // don't cascade; builtin overload resolution filters unknown args upstream,
  // so the wildcard can't steer an overload choice
  if (src.kind === "unknown" || dest.kind === "unknown") return 0;
  if (src.kind === "scalar" && dest.kind === "scalar")
    return scalarRank(src, dest);

  if (src.kind !== dest.kind) return undefined;
  if (src.kind === "vector" && dest.kind === "vector") {
    if (src.size !== dest.size) return undefined;
    return scalarRank(src.elem, dest.elem);
  }
  if (src.kind === "matrix" && dest.kind === "matrix") {
    if (src.cols !== dest.cols || src.rows !== dest.rows) return undefined;
    return scalarRank(src.elem, dest.elem);
  }
  if (src.kind === "array" && dest.kind === "array") {
    if (src.count !== dest.count) return undefined;
    return conversionRank(src.elem, dest.elem);
  }
  if (src.kind === "struct" && dest.kind === "struct") {
    if (sameType(src, dest)) return 0;
    // user structs are nominal and never convert; they are the only structs
    // with a declaration, so structElem separates them from the predeclared
    // result structs (built by the frexp/modf/atomic builtins)
    if (src.structElem || dest.structElem) return undefined;
    return resultStructRank(src, dest);
  }
  return sameType(src, dest) ? 0 : undefined;
}

/** True if src converts to dest automatically (or is identical). */
export function convertible(src: Type, dest: Type): boolean {
  return conversionRank(src, dest) !== undefined;
}

/** True if the type contains an abstract numeric type. */
export function isAbstract(t: Type): boolean {
  switch (t.kind) {
    case "scalar":
      return t.scalar === "abstract-int" || t.scalar === "abstract-float";
    case "vector":
    case "matrix":
    case "atomic":
    case "array":
      return isAbstract(t.elem);
    case "struct":
      // only the predeclared frexp/modf results: a declared member is concrete
      return t.members.some(m => isAbstract(m.type));
    default:
      return false;
  }
}

/** Materialize abstract numerics to their default concrete types:
 * abstract-int to i32, abstract-float to f32 (recursively). */
export function concretize(t: Type): Type {
  switch (t.kind) {
    case "scalar":
      return concreteScalar(t);
    case "vector":
      return isAbstract(t.elem) ? vecType(t.size, concreteScalar(t.elem)) : t;
    case "matrix":
      return isAbstract(t.elem)
        ? matType(t.cols, t.rows, concreteScalar(t.elem))
        : t;
    case "array":
      return isAbstract(t.elem) ? arrayType(concretize(t.elem), t.count) : t;
    case "struct":
      return isAbstract(t) ? concreteStruct(t) : t;
    default:
      return t;
  }
}

/** The lower-ranked common type two types both convert to, or undefined.
 * (For matching shapes this is just the concrete/higher-ranked side:
 * abstract-int + f32 gives f32; i32 + i32 gives i32.) */
export function commonType(a: Type, b: Type): Type | undefined {
  if (a.kind === "unknown") return b; // prefer the known side
  if (b.kind === "unknown") return a;
  const aToB = conversionRank(a, b);
  const bToA = conversionRank(b, a);
  if (aToB !== undefined && bToA !== undefined) return aToB <= bToA ? b : a; // identical types
  if (aToB !== undefined) return b;
  if (bToA !== undefined) return a;
  return undefined;
}

/**
 * Rank between predeclared result structs: the one implicit struct conversion
 * WGSL has, an abstract frexp/modf result to its concrete counterpart
 * (`__frexp_result_abstract` to `__frexp_result_f32`). The spec ranks it like
 * the abstract float the struct holds -- 1 to f32, 2 to f16 -- which is the
 * rank of the leading `fract` member. Member names must also match, so a
 * frexp result never converts to a modf result.
 */
function resultStructRank(
  src: StructType,
  dest: StructType,
): number | undefined {
  if (src.members.length !== dest.members.length) return undefined;
  const ranks = src.members.map((m, i) =>
    m.name === dest.members[i].name
      ? conversionRank(m.type, dest.members[i].type)
      : undefined,
  );
  return ranks.some(r => r === undefined) ? undefined : ranks[0];
}

/** The concrete form of an abstract result struct; its name carries the float
 * type, so materializing the members renames it too. */
function concreteStruct(t: StructType): StructType {
  const members = t.members.map(m => ({ ...m, type: concretize(m.type) }));
  return { ...t, name: t.name.replace(/abstract$/, "f32"), members };
}

/** Scalar-to-scalar conversion ranks from the WGSL spec. */
function scalarRank(src: ScalarType, dest: ScalarType): number | undefined {
  if (src.scalar === dest.scalar) return 0;
  if (src.scalar === "abstract-float") return abstractFloatRanks[dest.scalar];
  if (src.scalar === "abstract-int") return abstractIntRanks[dest.scalar];
  return undefined;
}

function concreteScalar(s: ScalarType): ScalarType {
  if (s.scalar === "abstract-int") return i32Type;
  if (s.scalar === "abstract-float") return f32Type;
  return s;
}
