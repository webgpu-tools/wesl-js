import type { StructElem } from "../AbstractElems.ts";

/**
 * Semantic types, separate from `TypeRefElem` syntax.
 *
 * Follows the WGSL type system, including the abstract numeric types used
 * by untyped literals (`1` is abstract-int, `1.0` is abstract-float).
 * `unknown` marks types we can't (or don't need to) determine: type
 * synthesis is unknown-tolerant, not a validator.
 */
export type Type =
  | ScalarType
  | VectorType
  | MatrixType
  | ArrayType
  | StructType
  | AtomicType
  | PtrType
  | TextureType
  | SamplerType
  | VoidType
  | UnknownType;

export type ScalarKind =
  | "bool"
  | "i32"
  | "u32"
  | "f32"
  | "f16"
  | "abstract-int"
  | "abstract-float";

export interface ScalarType {
  kind: "scalar";
  scalar: ScalarKind;
}

export interface VectorType {
  kind: "vector";
  size: 2 | 3 | 4;
  elem: ScalarType;
}

export interface MatrixType {
  kind: "matrix";
  /** number of columns (each column is a vector of `rows` elements) */
  cols: 2 | 3 | 4;
  rows: 2 | 3 | 4;
  elem: ScalarType;
}

export interface ArrayType {
  kind: "array";
  elem: Type;
  /** element count, undefined for runtime-sized arrays
   * (or when the count expression isn't const-evaluable) */
  count?: number;
}

export interface StructType {
  kind: "struct";
  name: string;
  /** members under the current link's conditions (@if-filtered) */
  members: StructMember[];

  /** Declaration this type was derived from. WGSL structs are nominal, so
   * this is what sameType() compares: two identically shaped structs declared
   * in different modules are different types. Predeclared builtin result
   * structs (frexp/modf, atomicCompareExchangeWeak) are built without a
   * declaration, so this stays optional; their name is their identity and
   * fully determines their members. */
  structElem?: StructElem;
}

export interface StructMember {
  name: string;
  type: Type;
}

export interface AtomicType {
  kind: "atomic";
  elem: ScalarType;
}

export interface PtrType {
  kind: "ptr";
  /** address space enumerant, e.g. "function", "storage" */
  space: string;
  elem: Type;
  /** access mode enumerant when written, e.g. "read_write" */
  access?: string;
}

export interface TextureType {
  kind: "texture";
  /** full type name, e.g. "texture_2d", "texture_storage_2d", "texture_depth_cube" */
  name: string;
  /** sampled type for sampled/multisampled textures, e.g. f32 for texture_2d<f32> */
  sampled?: ScalarType;
  /** texel format enumerant for storage textures, e.g. "rgba8unorm" */
  format?: string;
  /** access mode enumerant for storage textures, e.g. "write" */
  access?: string;
}

export interface SamplerType {
  kind: "sampler";
  comparison: boolean;
}

/** No value: a fn with no return type, or a builtin like textureStore.
 * Known exactly, and so matches nothing (unlike `unknown`, which matches all). */
export interface VoidType {
  kind: "void";
}

/** A type that synthesis couldn't determine. Matches everything, produces no
 * errors, so partial type checking still works on the rest of the module.
 *
 * Unknown types come from code that is wrong, perhaps mid-edit:
 *  - references to declarations we can't find
 *  - invalid expressions like vec2 + vec3
 *  - builtin calls that match no overload
 *
 * or from code that is fine but outside what the type tables describe:
 *  - declaration kinds with no value type, like WESL's do blocks
 *  - builtins from WGSL extensions we haven't written signatures for, which
 *    tracks how settled the extension is in the spec and in browsers
 *
 * Nothing distinguishes the cases at the type level. An unknown operand
 * spreads: any result whose shape depends on it is unknown too.
 */
export interface UnknownType {
  kind: "unknown";
}

export const boolType: ScalarType = { kind: "scalar", scalar: "bool" };
export const i32Type: ScalarType = { kind: "scalar", scalar: "i32" };
export const u32Type: ScalarType = { kind: "scalar", scalar: "u32" };
export const f32Type: ScalarType = { kind: "scalar", scalar: "f32" };
export const f16Type: ScalarType = { kind: "scalar", scalar: "f16" };
export const abstractInt: ScalarType = {
  kind: "scalar",
  scalar: "abstract-int",
};
export const abstractFloat: ScalarType = {
  kind: "scalar",
  scalar: "abstract-float",
};
export const voidType: VoidType = { kind: "void" };
export const unknownType: UnknownType = { kind: "unknown" };

const scalarsByKind: Record<ScalarKind, ScalarType> = {
  bool: boolType,
  i32: i32Type,
  u32: u32Type,
  f32: f32Type,
  f16: f16Type,
  "abstract-int": abstractInt,
  "abstract-float": abstractFloat,
};

/** The interned ScalarType for a scalar kind. */
export function scalarType(kind: ScalarKind): ScalarType {
  return scalarsByKind[kind];
}

export function vecType(size: 2 | 3 | 4, elem: ScalarType): VectorType {
  return { kind: "vector", size, elem };
}

export function matType(
  cols: 2 | 3 | 4,
  rows: 2 | 3 | 4,
  elem: ScalarType,
): MatrixType {
  return { kind: "matrix", cols, rows, elem };
}

export function arrayType(elem: Type, count?: number): ArrayType {
  return count === undefined
    ? { kind: "array", elem }
    : { kind: "array", elem, count };
}

/** True for numeric scalars, including the abstract numerics. */
export function isNumericScalar(t: Type): t is ScalarType {
  return t.kind === "scalar" && t.scalar !== "bool";
}

export function isIntegerScalar(t: Type): t is ScalarType {
  if (t.kind !== "scalar") return false;
  const { scalar } = t;
  return scalar === "i32" || scalar === "u32" || scalar === "abstract-int";
}

export function isFloatScalar(t: Type): t is ScalarType {
  if (t.kind !== "scalar") return false;
  const { scalar } = t;
  return scalar === "f32" || scalar === "f16" || scalar === "abstract-float";
}

/** Element scalar of a scalar, vector, or matrix type (undefined otherwise). */
export function elemScalar(t: Type): ScalarType | undefined {
  if (t.kind === "scalar") return t;
  if (t.kind === "vector" || t.kind === "matrix") return t.elem;
}

/** Type equality: structural, except structs which are nominal
 * (see StructType.structElem). */
export function sameType(a: Type, b: Type): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "scalar":
      return a.scalar === (b as ScalarType).scalar;
    case "vector": {
      const v = b as VectorType;
      return a.size === v.size && sameType(a.elem, v.elem);
    }
    case "matrix": {
      const m = b as MatrixType;
      return a.cols === m.cols && a.rows === m.rows && sameType(a.elem, m.elem);
    }
    case "array": {
      const arr = b as ArrayType;
      return a.count === arr.count && sameType(a.elem, arr.elem);
    }
    case "struct": {
      // nominal: declaration identity, or name identity for predeclared
      // builtin result structs (both structElem undefined)
      const s = b as StructType;
      return a.structElem === s.structElem && a.name === s.name;
    }
    case "atomic":
      return sameType(a.elem, (b as AtomicType).elem);
    case "ptr": {
      const p = b as PtrType;
      return (
        a.space === p.space && a.access === p.access && sameType(a.elem, p.elem)
      );
    }
    case "texture": {
      const t = b as TextureType;
      return (
        a.name === t.name &&
        a.sampled?.scalar === t.sampled?.scalar &&
        a.format === t.format &&
        a.access === t.access
      );
    }
    case "sampler":
      return a.comparison === (b as SamplerType).comparison;
    case "void":
    case "unknown":
      return true;
  }
}

/** Render a type in WGSL-ish syntax (e.g. "vec3<f32>", "abstract-int"). */
export function typeToString(t: Type): string {
  switch (t.kind) {
    case "scalar":
      return t.scalar;
    case "vector":
      return `vec${t.size}<${typeToString(t.elem)}>`;
    case "matrix":
      return `mat${t.cols}x${t.rows}<${typeToString(t.elem)}>`;
    case "array": {
      const count = t.count === undefined ? "" : `, ${t.count}`;
      return `array<${typeToString(t.elem)}${count}>`;
    }
    case "struct":
      return t.name;
    case "atomic":
      return `atomic<${typeToString(t.elem)}>`;
    case "ptr": {
      const access = t.access ? `, ${t.access}` : "";
      return `ptr<${t.space}, ${typeToString(t.elem)}${access}>`;
    }
    case "texture": {
      const params = [t.format, t.access, t.sampled && typeToString(t.sampled)]
        .filter(p => p !== undefined)
        .join(", ");
      return params ? `${t.name}<${params}>` : t.name;
    }
    case "sampler":
      return t.comparison ? "sampler_comparison" : "sampler";
    case "void":
      return "void";
    case "unknown":
      return "unknown";
  }
}
