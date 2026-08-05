import { conversionRank } from "./Conversions.ts";
import {
  boolType,
  type ScalarKind,
  type ScalarType,
  sameType,
  scalarType,
  type Type,
  vecType,
} from "./Types.ts";

/**
 * Values produced by const-evaluation, and the conversions between them.
 *
 * Abstract-int computes as bigint (exact, no wrapping until materialization,
 * with range checks when converting); abstract-float computes as f64.
 * Concrete i32/u32 arithmetic wraps like the GPU; f32 and f16 round each
 * operation to their own width (nearest-even, per spec).
 */
export type ConstValue = ScalarValue | CompositeValue;

export interface ScalarValue {
  kind: "scalar";
  type: ScalarType;
  /** bigint for abstract-int, boolean for bool, number otherwise */
  value: number | bigint | boolean;
}

/** A vector, matrix, array, or struct value. Matrix elements are column
 * vectors; struct elements follow declared member order. */
export interface CompositeValue {
  kind: "composite";
  type: Type;
  elements: ConstValue[];
}

/** WGSL's abstract-int is 64-bit signed. */
export const abstractIntMin = -(2n ** 63n);
export const abstractIntMax = 2n ** 63n - 1n;

/** allocation guard for large const arrays */
const maxArrayElems = 65536;

/** Concrete integer limits: i32 spans [-0x80000000, 0x7fffffff], u32 spans
 * [0, 0xffffffff]. */
const i32Min = -2147483648;

/** The same limits as bigints, for the abstract-int range checks (abstract-int
 * computes as bigint). i32MinBig is exported: the CTS case tables need it to
 * spell the most negative i32 literal. */
export const i32MinBig = BigInt(i32Min);
const i32Max = 2147483647;
const u32Max = 4294967295;
const i32MaxBig = BigInt(i32Max);
const u32MaxBig = BigInt(u32Max);

/** The largest i32/u32 values an f32 can represent: the type max with the
 * bits below f32's 24-bit significand cleared (0x7fffff80, 0xffffff00). */
const i32MaxInF32 = 2147483520;
const u32MaxInF32 = 4294967040;

const f32Scratch = new DataView(new ArrayBuffer(4));

/** f32 layout: 23 fraction bits, exponent bias 127. f16: 10 fraction bits,
 * smallest normal exponent -14 (subnormals share that spacing). */
const f32FractBits = 23;
const f32ExpBias = 127;
const f16FractBits = 10;
const f16MinExp = -14;

/** largest finite f16 value: (2 - 2**-10) * 2**15 */
const f16Max = 65504;

export function scalarValue(
  type: ScalarType,
  value: number | bigint | boolean,
): ScalarValue {
  return { kind: "scalar", type, value };
}

export function boolValue(value: boolean): ScalarValue {
  return scalarValue(boolType, value);
}

/**
 * An abstract-int result, or null if it leaves the 64-bit range.
 *
 * Overflowing an abstract-int is a shader-creation error, and we decline to fold
 * rather than reject: an unbounded exact bigint would let `const_assert` and
 * array sizes be built on values the spec says cannot exist. Every abstract-int
 * producer goes through here, so all abstract-int values in hand are in range.
 */
export function abstractIntResult(n: bigint): bigint | null {
  return n < abstractIntMin || n > abstractIntMax ? null : n;
}

/** Numeric scalar value as a JS number (undefined for bools/composites). */
export function scalarToNumber(v: ConstValue): number | undefined {
  if (v.kind !== "scalar" || typeof v.value === "boolean") return undefined;
  return Number(v.value);
}

/** A literal's source text as a const value (null if unsupported or out of range). */
export function literalValue(text: string): ConstValue | null {
  if (text === "true" || text === "false")
    return scalarValue(boolType, text === "true");
  const suffix = text[text.length - 1];
  const hex = text[0] === "0" && (text[1] === "x" || text[1] === "X");
  const hexFloat = hex && /[pP.]/.test(text);
  if (hexFloat) return null; // TODO hex float literals unsupported

  if (suffix === "i" || suffix === "u") {
    const big = BigInt(text.slice(0, -1)); // literals are non-negative (minus is a unary op)
    if (big > (suffix === "i" ? i32MaxBig : u32MaxBig)) return null;
    return scalarValue(scalarType(suffix === "i" ? "i32" : "u32"), Number(big));
  }
  // trailing f/h on a hex int is a hex digit, not a suffix (hex floats have p)
  if ((suffix === "f" || suffix === "h") && !hex) {
    const kind = suffix === "f" ? "f32" : "f16";
    const n = quantize(Number.parseFloat(text), kind);
    if (!Number.isFinite(n)) return null; // overflows the target width
    return scalarValue(scalarType(kind), n);
  }
  if (hex || !/[.eE]/.test(text)) {
    // literals are non-negative, so i64 min is spelled (-9223372036854775807 - 1)
    const big = abstractIntResult(BigInt(text));
    return big === null ? null : scalarValue(scalarType("abstract-int"), big);
  }
  const f = Number.parseFloat(text);
  return Number.isFinite(f)
    ? scalarValue(scalarType("abstract-float"), f)
    : null;
}

/** Convert a value to a type via the implicit conversion relation
 * (abstract numerics only), with range checks. Null if not convertible. */
export function convertValue(v: ConstValue, dest: Type): ConstValue | null {
  if (sameType(v.type, dest)) return v;
  if (dest.kind === "unknown") return v; // unknown imposes no conversion
  if (conversionRank(v.type, dest) === undefined) return null;
  if (v.kind === "scalar")
    return dest.kind === "scalar" ? convertScalar(v, dest) : null;

  const destElems = compositeElemTypes(dest, v.elements.length);
  if (!destElems) return null;
  const elements: ConstValue[] = [];
  for (let i = 0; i < v.elements.length; i++) {
    const converted = convertValue(v.elements[i], destElems[i]);
    if (!converted) return null;
    elements.push(converted);
  }
  return { kind: "composite", type: dest, elements };
}

/** Implicit scalar conversion with range checks (abstract sources only). */
export function convertScalar(
  s: ScalarValue,
  target: ScalarType,
): ScalarValue | null {
  if (s.type.scalar === target.scalar) return s;
  const { value } = s;
  if (s.type.scalar === "abstract-int" && typeof value === "bigint") {
    switch (target.scalar) {
      case "i32":
        if (value < i32MinBig || value > i32MaxBig) return null;
        return scalarValue(target, Number(value));
      case "u32":
        if (value < 0n || value > u32MaxBig) return null;
        return scalarValue(target, Number(value));
      case "abstract-float": {
        const n = Number(value);
        return Number.isFinite(n) ? scalarValue(target, n) : null;
      }
      case "f32":
      case "f16": {
        const n = quantize(Number(value), target.scalar);
        return Number.isFinite(n) ? scalarValue(target, n) : null;
      }
      default:
        return null;
    }
  }
  if (s.type.scalar === "abstract-float" && typeof value === "number") {
    if (target.scalar === "f32" || target.scalar === "f16") {
      const n = quantize(value, target.scalar);
      return Number.isFinite(n) ? scalarValue(target, n) : null;
    }
    return null;
  }
  return null;
}

/** Explicit scalar conversion (constructor semantics): int-to-int
 * reinterprets bits; float-to-int truncates and clamps to the target range
 * (per spec, not wrapping); out-of-range abstract-int is an error (null). */
export function castScalar(
  s: ScalarValue,
  target: ScalarType,
): ScalarValue | null {
  const { value } = s;
  switch (target.scalar) {
    case "bool":
      if (typeof value === "boolean") return s;
      return boolValue(typeof value === "bigint" ? value !== 0n : value !== 0);
    case "i32":
    case "u32": {
      const unsigned = target.scalar === "u32";
      if (typeof value === "boolean") return scalarValue(target, Number(value));
      if (typeof value === "bigint") return convertScalar(s, target); // range-checked
      const src = s.type.scalar;
      if (src === "i32" || src === "u32")
        return scalarValue(target, unsigned ? value >>> 0 : value | 0);
      if (Number.isNaN(value)) return null; // indeterminate per spec
      // clamp to the target range; an f32/f16 source clamps to the largest
      // i32/u32 an f32 can represent (infinities clamp too; f16 values are far
      // smaller). abstract-float is f64, which covers every i32/u32 exactly.
      const f32Src = src === "f32" || src === "f16";
      const u32Hi = f32Src ? u32MaxInF32 : u32Max;
      const i32Hi = f32Src ? i32MaxInF32 : i32Max;
      const hi = unsigned ? u32Hi : i32Hi;
      const lo = unsigned ? 0 : i32Min;
      const clamped = Math.min(Math.max(Math.trunc(value), lo), hi);
      return scalarValue(target, clamped);
    }
    case "f32":
    case "f16": {
      if (typeof value === "boolean") return scalarValue(target, Number(value));
      const n = quantize(Number(value), target.scalar);
      return Number.isFinite(n) ? scalarValue(target, n) : null;
    }
    case "abstract-int":
      return typeof value === "bigint" ? s : null;
    case "abstract-float": {
      if (typeof value === "boolean") return null;
      const n = Number(value);
      return Number.isFinite(n) ? scalarValue(target, n) : null;
    }
  }
}

/** Zero value for a type (WGSL zero-value constructor), or null if it has none. */
export function zeroValue(type: Type): ConstValue | null {
  switch (type.kind) {
    case "scalar":
      if (type.scalar === "bool") return boolValue(false);
      if (type.scalar === "abstract-int") return scalarValue(type, 0n);
      return scalarValue(type, 0);
    case "vector":
    case "matrix":
    case "array":
    case "struct": {
      const elemTypes = compositeElemTypes(type, undefined);
      if (!elemTypes) return null;
      const elements = elemTypes.map(zeroValue);
      if (elements.some(e => !e)) return null;
      return { kind: "composite", type, elements: elements as ConstValue[] };
    }
    default:
      return null;
  }
}

/** Round to the target float width (nearest-even). May return Infinity on
 * overflow; callers reject non-finite results as not const-evaluable. */
export function quantize(n: number, kind: ScalarKind): number {
  if (kind === "f32") return Math.fround(n);
  if (kind === "f16") return f16Round(n);
  return n;
}

/** Wrap/quantize an arithmetic result to a concrete numeric kind. */
export function numericResult(n: number, kind: ScalarKind): number | null {
  switch (kind) {
    case "i32":
      return n | 0;
    case "u32":
      return n >>> 0;
    case "f32":
    case "f16": {
      const q = quantize(n, kind);
      return Number.isFinite(q) ? q : null;
    }
    default:
      return Number.isFinite(n) ? n : null;
  }
}

/** Round to the nearest f16 value (ties to even); Infinity past the f16 max
 * (65504). Rounding f64 -> f32 -> f16 equals direct f64 -> f16 rounding: f32's
 * 24-bit significand is wide enough (>= 2*11+2) that double rounding is safe. */
export function f16Round(n: number): number {
  const f32 = Math.fround(n);
  if (f32 === 0 || !Number.isFinite(f32)) return f32;
  f32Scratch.setFloat32(0, f32);
  const exp = ((f32Scratch.getUint32(0) >>> f32FractBits) & 0xff) - f32ExpBias;
  // f16 spacing at this magnitude
  const ulp = 2 ** (Math.max(exp, f16MinExp) - f16FractBits);
  const rounded = roundEven(f32 / ulp) * ulp;
  if (Math.abs(rounded) <= f16Max) return rounded;
  return rounded < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
}

/** WGSL round(): round half to even. */
export function roundEven(x: number): number {
  const floor = Math.floor(x);
  if (x - floor !== 0.5) return Math.round(x);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Bigint components of an abstract-int vector value. */
export function componentBigints(v: CompositeValue): bigint[] | null {
  const nums = v.elements.map(e =>
    e.kind === "scalar" && typeof e.value === "bigint" ? e.value : null,
  );
  return nums.some(n => n === null) ? null : (nums as bigint[]);
}

/** Numeric components of a vector value as JS numbers. */
export function componentNumbers(v: CompositeValue): number[] | null {
  const nums = v.elements.map(e =>
    e.kind === "scalar" && typeof e.value !== "boolean"
      ? Number(e.value)
      : null,
  );
  return nums.some(n => n === null) ? null : (nums as number[]);
}

/** Element types of a composite in element order (undefined length uses the
 * type's own count; null when the type has no fixed element list). */
function compositeElemTypes(
  type: Type,
  length: number | undefined,
): Type[] | null {
  switch (type.kind) {
    case "vector":
      return Array.from({ length: type.size }, () => type.elem);
    case "matrix":
      return Array.from({ length: type.cols }, () =>
        vecType(type.rows, type.elem),
      );
    case "array": {
      const count = type.count ?? length;
      if (count === undefined || count > maxArrayElems) return null;
      return Array.from({ length: count }, () => type.elem);
    }
    case "struct":
      return type.members.map(m => m.type);
    default:
      return null;
  }
}
