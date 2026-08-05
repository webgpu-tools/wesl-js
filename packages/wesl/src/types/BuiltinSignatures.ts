import { signatures } from "./BuiltinTable.ts";
import {
  matchOverloads,
  type Overload,
  parseOverload,
} from "./OverloadMatch.ts";
import { textureFnType } from "./TextureSignatures.ts";
import {
  abstractFloat,
  abstractInt,
  boolType,
  elemScalar,
  i32Type,
  isFloatScalar,
  matType,
  type ScalarKind,
  type ScalarType,
  type StructType,
  type Type,
  u32Type,
  unknownType,
  vecType,
  voidType,
} from "./Types.ts";

let parsedTable: Map<string, Overload[]> | undefined;

/** The scalar of frexp's `exp` member, per the float type it decomposes. */
const expScalar: Partial<Record<ScalarKind, ScalarType>> = {
  f32: i32Type,
  f16: i32Type,
  "abstract-float": abstractInt,
};

/** How a float scalar spells itself in a result struct name. */
const floatName: Partial<Record<ScalarKind, string>> = {
  f32: "f32",
  f16: "f16",
  "abstract-float": "abstract",
};

/** The atomic store builtins, which return nothing so they never read the
 * pointer -- just as well, since atomicStoreMin/Max take an
 * atomic<vec2<u32>>, which has no semantic type. Exact names, not an
 * `atomicStore` prefix, so an unlisted name falls through rather than
 * silently typing as void. */
const atomicStoreFns = new Set([
  "atomicStore",
  "atomicStoreMin",
  "atomicStoreMax",
]);

/**
 * Builtin function signature table: given argument types, the return type of a
 * WGSL builtin call. A candidate matches when every argument converts to its
 * parameter type with finite conversion rank, and the lowest total rank wins
 * (so `max(1, 2u)` picks u32 while `max(1, 2)` stays abstract-int). The spec
 * instead compares rank vectors by dominance, but a dominating candidate
 * always has the strictly smallest sum, so summing agrees with the spec
 * whenever the spec has a unique winner; only ambiguous (invalid) calls
 * differ, where we pick deterministically instead of erroring.
 *
 * Returns `unknown` for unlisted builtins, non-matching arguments, or unknown
 * argument types; type synthesis is unknown-tolerant, not a validator.
 */
export function builtinFnType(name: string, argTypes: Type[]): Type {
  const special = specialBuiltinType(name, argTypes);
  if (special) return special;

  const overloads = signatureTable().get(name);
  if (!overloads) return unknownType;
  if (argTypes.some(t => t.kind === "unknown")) return unknownType;
  return matchOverloads(overloads, argTypes) ?? unknownType;
}

/** Builtins whose types depend on pointer, texture, or matrix arguments.
 * The atomic/texture name prefixes are safe to dispatch on because callers
 * only reach builtins after an identifier fails to resolve to a declaration,
 * so a user function named `textureBlur` never arrives here. */
function specialBuiltinType(name: string, argTypes: Type[]): Type | undefined {
  if (name.startsWith("atomic")) return atomicFnType(name, argTypes);
  if (name.startsWith("texture")) return textureFnType(name, argTypes);
  if (name === "arrayLength") return u32Type;
  if (name === "determinant") {
    const [m] = argTypes;
    return m?.kind === "matrix" ? m.elem : unknownType;
  }
  if (name === "transpose") {
    const [m] = argTypes;
    return m?.kind === "matrix" ? matType(m.rows, m.cols, m.elem) : unknownType;
  }
  if (name === "workgroupUniformLoad") {
    const [ptr] = argTypes;
    return ptr?.kind === "ptr" ? ptr.elem : unknownType;
  }
  if (name === "frexp" || name === "modf")
    return splitResult(name, argTypes[0]);
  return undefined;
}

/** The parsed signature table (built lazily on first builtin lookup). */
function signatureTable(): Map<string, Overload[]> {
  parsedTable ??= new Map(
    Object.entries(signatures).map(([name, sig]) => [
      name,
      sig.split(";").map(parseOverload),
    ]),
  );
  return parsedTable;
}

/** Atomic builtins return the atomic's element type, read from the pointer arg. */
function atomicFnType(name: string, argTypes: Type[]): Type {
  if (atomicStoreFns.has(name)) return voidType;
  const [ptr] = argTypes;
  if (ptr?.kind !== "ptr" || ptr.elem.kind !== "atomic") return unknownType;
  const elem = ptr.elem.elem;
  if (name !== "atomicCompareExchangeWeak") return elem;
  return exchangeResult(elem);
}

/**
 * The predeclared result struct of frexp or modf, e.g. `__frexp_result_vec2_f32`
 * with members `fract: vec2<f32>, exp: vec2<i32>`, or `__modf_result_abstract`
 * with `fract: abstract-float, whole: abstract-float`.
 *
 * The structs are built rather than declared, so they carry no `structElem`;
 * their name is their identity (it fully determines the member types, so
 * sameType() compares predeclared structs by name). Their abstract forms are
 * the only structs in WGSL that convert (see conversionRank).
 */
function splitResult(name: string, arg: Type | undefined): Type {
  const argElem = arg && elemScalar(arg);
  if (!arg || !argElem) return unknownType;
  if (arg.kind !== "scalar" && arg.kind !== "vector") return unknownType;
  // the parameter is a float, so an abstract-int argument converts (`frexp(1)`)
  const elem = argElem.scalar === "abstract-int" ? abstractFloat : argElem;
  if (!isFloatScalar(elem)) return unknownType;

  const param = sameShape(arg, elem);
  const shape = arg.kind === "vector" ? `vec${arg.size}_` : "";
  const second =
    name === "modf"
      ? { name: "whole", type: param }
      : { name: "exp", type: sameShape(arg, expScalar[elem.scalar]) };
  return {
    kind: "struct",
    name: `__${name}_result_${shape}${floatName[elem.scalar]}`,
    members: [{ name: "fract", type: param }, second],
  };
}

/** `__atomic_compare_exchange_result<T>`, the predeclared struct returned by
 * atomicCompareExchangeWeak. Never abstract (T is i32 or u32), so unlike the
 * frexp/modf results it never converts. */
function exchangeResult(elem: ScalarType): StructType {
  return {
    kind: "struct",
    name: `__atomic_compare_exchange_result<${elem.scalar}>`,
    members: [
      { name: "old_value", type: elem },
      { name: "exchanged", type: boolType },
    ],
  };
}

/** A scalar or vector type reshaped to a new element type (same width). */
function sameShape(shape: Type, elem: ScalarType | undefined): Type {
  if (!elem) return unknownType;
  return shape.kind === "vector" ? vecType(shape.size, elem) : elem;
}
