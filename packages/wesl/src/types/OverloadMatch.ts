import { conversionRank } from "./Conversions.ts";
import {
  abstractFloat,
  abstractInt,
  boolType,
  f16Type,
  f32Type,
  i32Type,
  isIntegerScalar,
  type ScalarType,
  type Type,
  u32Type,
  unknownType,
  vecType,
  voidType,
} from "./Types.ts";

/**
 * The signature mini-language for the builtin table (BuiltinTable.ts).
 *
 * A table entry is one or more overload clauses separated by ";", each
 * "<elemSet> <params...> -> <ret>", e.g. `mix: "f T T T -> T; f V V E -> V"`.
 * The leading letter picks the element types E ranges over (see elemSets).
 * The remaining tokens are parameter and return patterns: generic shapes
 * built from E and the clause's component count (see genericTokens), or
 * concrete WGSL types (see concreteTokens). One clause covers a family of
 * concrete overloads: "f T T T -> T" is 3 element types x 4 component counts.
 *
 * To match a call, the component count is read from the arguments, then each
 * element type in the set is tried; a candidate matches when every argument
 * converts to its parameter type with finite conversion rank, and the lowest
 * total rank across all clauses wins. builtinFnType() documents why summing
 * ranks agrees with the spec's dominance rule.
 */

/** One clause of a signature string: a family of concrete WGSL overloads
 * sharing an element type (any one of `elemSet`) and a component count.
 * `abs: "n T -> T"` is one Overload covering 6 element types x 4 component
 * counts. `params` and `ret` hold pattern tokens, not types (see `instantiate`). */
export interface Overload {
  elemSet: ScalarType[];
  params: string[];
  ret: string;
}

/** Component count of an overload's generic tokens: 1 = scalar, n = vecN. */
type ComponentCount = 1 | 2 | 3 | 4;

/** Element types an overload's E may take, by signature letter.
 * "-" is the empty set: a concrete signature with no element type.
 *
 * A set without the abstract types is how a builtin declares that abstract
 * arguments materialize at the call (the spec gives abstract overloads only to
 * const-evaluable builtins). Dropping them from the set is equivalent to the
 * spec's materialize-then-resolve: with no abstract candidate to match at rank
 * 0, conversion rank picks each abstract type's default concrete type
 * (abstract-int -> i32, abstract-float -> f32), which is what materializing
 * would have produced. */
const elemSets: Record<string, ScalarType[]> = {
  f: [abstractFloat, f32Type, f16Type],
  F: [f32Type],
  n: [abstractInt, abstractFloat, i32Type, u32Type, f32Type, f16Type],
  N: [i32Type, u32Type, f32Type, f16Type],
  s: [abstractInt, abstractFloat, i32Type, f32Type, f16Type],
  i: [abstractInt, i32Type, u32Type],
  I: [i32Type, u32Type],
  b: [boolType],
  a: [abstractInt, abstractFloat, i32Type, u32Type, f32Type, f16Type, boolType],
  "-": [],
};

/** Tokens standing for a type built from E and the component count:
 * T = E-or-vecN<E>, E = the element type, V = vecN<E>, V2/V3/V4 = fixed-size
 * vector of E, B = bool with T's component count, Ti = i32 with T's component
 * count (abstract-int when E is abstract, per ldexp's spec constraint), X =
 * any integer scalar (an index; constrains an argument, instantiates to no
 * type). */
const genericTokens = new Set("T E V V2 V3 V4 B Ti X".split(" "));

const concreteTokens: Record<string, Type> = {
  void: voidType,
  bool: boolType,
  i32: i32Type,
  u32: u32Type,
  f32: f32Type,
  f16: f16Type,
  vec2f: vecType(2, f32Type),
  vec3f: vecType(3, f32Type),
  vec4f: vecType(4, f32Type),
  vec4i: vecType(4, i32Type),
  vec2u: vecType(2, u32Type),
  vec4u: vecType(4, u32Type),
};

/** Split one "<elemSet> <params...> -> <ret>" clause into its tokens.
 * Throws on an unknown element set or token: the signature table is our own
 * constant data, so a bad token is a bug, not user input. */
export function parseOverload(sig: string): Overload {
  const [paramsPart, ret] = sig.split("->").map(s => s.trim());
  const [letter, ...params] = paramsPart.split(/\s+/);
  const elemSet = elemSets[letter];
  if (!elemSet) throw new Error(`unknown element set "${letter}" in: ${sig}`);
  for (const token of [...params, ret]) {
    const generic = genericTokens.has(token);
    if (!generic && !(token in concreteTokens))
      throw new Error(`unknown token "${token}" in: ${sig}`);
    // a generic token with no element set instantiates to nothing, which
    // would silently type the builtin as unknown (X needs no element type)
    if (generic && token !== "X" && !elemSet.length)
      throw new Error(`generic token "${token}" needs an element set: ${sig}`);
  }
  if (ret === "X") throw new Error(`"X" is a param-only token in: ${sig}`);
  return { elemSet, params, ret };
}

/** Try each overload; return the instantiated return type of the best match. */
export function matchOverloads(
  overloads: Overload[],
  argTypes: Type[],
): Type | undefined {
  const matches = overloads
    .map(o => matchOverload(o, argTypes))
    .filter(m => m !== undefined);
  return lowestRank(matches)?.ret;
}

/** Cheapest instantiation of one overload for these args: the component count
 * comes from the args, then each element type in the set is tried in turn.
 * An empty element set means the signature is concrete, and matches once. */
function matchOverload(
  overload: Overload,
  argTypes: Type[],
): { rank: number; ret: Type } | undefined {
  const { elemSet, params, ret } = overload;
  if (params.length !== argTypes.length) return undefined;

  const comps = argComponents(params, argTypes);
  if (comps === undefined) return undefined;

  const candidates = elemSet.length ? elemSet : [undefined]; // concrete: one pass
  const ranked = candidates.flatMap(elem => {
    const rank = totalRank(params, argTypes, elem, comps);
    return rank === undefined ? [] : [{ elem, rank }];
  });
  const best = lowestRank(ranked);
  if (!best) return undefined;
  const { elem, rank } = best;
  return { rank, ret: instantiate(ret, elem, comps) ?? unknownType };
}

/** The lowest-rank item (undefined for none); earlier wins ties, keeping
 * ambiguous overload picks deterministic. */
function lowestRank<T extends { rank: number }>(items: T[]): T | undefined {
  return items.reduce<T | undefined>(
    (a, b) => (!a || b.rank < a.rank ? b : a),
    undefined,
  );
}

/** Component count from the first count-bearing token (T/B/Ti/V). Fixed-size
 * tokens (V3, vec4f, ...) bear no count, so `cross: "f V3 V3 -> V3"` reports 1;
 * harmless, because V3 instantiates to vec3 regardless. */
function argComponents(
  params: string[],
  argTypes: Type[],
): ComponentCount | undefined {
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    const arg = argTypes[i];
    if (p === "T" || p === "B" || p === "Ti") {
      if (arg.kind === "scalar") return 1;
      if (arg.kind === "vector") return arg.size;
      return undefined;
    }
    if (p === "V") {
      if (arg.kind === "vector") return arg.size;
      return undefined;
    }
  }
  return 1; // no count-bearing params
}

/** Sum of argument conversion ranks, or undefined if any argument can't convert. */
function totalRank(
  params: string[],
  argTypes: Type[],
  elem: ScalarType | undefined,
  comps: ComponentCount,
): number | undefined {
  let total = 0;
  for (let i = 0; i < params.length; i++) {
    const arg = argTypes[i];
    if (params[i] === "X") {
      if (!isIntegerScalar(arg)) return undefined;
      continue;
    }
    const paramType = instantiate(params[i], elem, comps);
    if (!paramType) return undefined;
    const rank = conversionRank(arg, paramType);
    if (rank === undefined) return undefined;
    total += rank;
  }
  return total;
}

/** A pattern token as a concrete type, given element type and component count.
 * Tokens built from E yield no type in a concrete signature (no element type),
 * and neither does X, which constrains its argument in `totalRank` instead. */
function instantiate(
  token: string,
  elem: ScalarType | undefined,
  comps: ComponentCount,
): Type | undefined {
  if (!elem) return concreteTokens[token];
  switch (token) {
    case "T":
      return comps === 1 ? elem : vecType(comps, elem);
    case "E":
      return elem;
    case "V":
      return comps === 1 ? undefined : vecType(comps, elem);
    case "V2":
      return vecType(2, elem);
    case "V3":
      return vecType(3, elem);
    case "V4":
      return vecType(4, elem);
    case "B":
      return comps === 1 ? boolType : vecType(comps, boolType);
    case "Ti": {
      // an abstract E requires an abstract exponent (ldexp(1.5, 2i) is f32,
      // not abstract-float: concrete e2 forces e1 to materialize)
      const int = elem.scalar.startsWith("abstract") ? abstractInt : i32Type;
      return comps === 1 ? int : vecType(comps, int);
    }
    default:
      return concreteTokens[token];
  }
}
