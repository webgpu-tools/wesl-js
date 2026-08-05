import {
  abstractIntResult,
  boolValue,
  type CompositeValue,
  type ConstValue,
  convertScalar,
  quantize,
  type ScalarValue,
  scalarToNumber,
  scalarValue,
} from "./ConstValues.ts";
import { conversionRank } from "./Conversions.ts";
import { comparisonOps } from "./OpNames.ts";
import type { ScalarKind, ScalarType } from "./Types.ts";
import { vecType } from "./Types.ts";

/**
 * WGSL unary and binary operators over already-evaluated const values.
 *
 * The && and || short-circuit cases are handled by the caller, which still has
 * the unevaluated right operand; by the time an expression reaches binaryOp
 * both sides are known.
 */

/** Unary -, ~, or ! applied component-wise (& and * aren't const-expressions). */
export function unaryOp(op: string, operand: ConstValue): ConstValue | null {
  if (op === "-") return mapComponents(operand, negate);
  if (op === "~") return mapComponents(operand, bitNot);
  if (op === "!") return mapComponents(operand, logicalNot);
  return null;
}

/** Binary op on two evaluated operands, splatting a scalar against a vector. */
export function binaryOp(
  op: string,
  left: ConstValue,
  right: ConstValue,
): ConstValue | null {
  if (op === "&&" || op === "||") {
    if (left.kind !== "scalar" || typeof left.value !== "boolean") return null;
    if (right.kind === "scalar" && typeof right.value === "boolean")
      return boolValue(right.value);
    return null;
  }
  if (op === "<<" || op === ">>") return shiftValue(op, left, right);
  // TODO matrix operands (mat +- mat, mat * mat/vec/scalar) aren't evaluated;
  // zipComponents knows only scalars and vectors
  return zipComponents(left, right, (a, b) => scalarBinary(op, a, b));
}

/** Apply a scalar function to a scalar or component-wise to a vector. */
function mapComponents(
  v: ConstValue,
  f: (s: ScalarValue) => ScalarValue | null,
): ConstValue | null {
  if (v.kind === "scalar") return f(v);
  if (v.type.kind !== "vector") return null;
  const elements: ConstValue[] = [];
  for (const e of v.elements) {
    const mapped = e.kind === "scalar" ? f(e) : null;
    if (!mapped) return null;
    elements.push(mapped);
  }
  const first = elements[0];
  if (first.kind !== "scalar") return null;
  const type = vecType(v.type.size, first.type);
  return { kind: "composite", type, elements };
}

function negate(s: ScalarValue): ScalarValue | null {
  const { value, type } = s;
  if (typeof value === "boolean") return null;
  if (typeof value === "bigint") return bigintScalar(type, -value); // -min overflows
  if (type.scalar === "i32") return scalarValue(type, -value | 0);
  if (type.scalar === "u32") return scalarValue(type, -value >>> 0);
  return scalarValue(type, -value);
}

function bitNot(s: ScalarValue): ScalarValue | null {
  const { value, type } = s;
  if (typeof value === "bigint") return bigintScalar(type, ~value);
  if (typeof value !== "number") return null;
  if (type.scalar === "i32") return scalarValue(type, ~value | 0);
  if (type.scalar === "u32") return scalarValue(type, ~value >>> 0);
  return null;
}

function logicalNot(s: ScalarValue): ScalarValue | null {
  return typeof s.value === "boolean" ? boolValue(!s.value) : null;
}

/** Shift, component-wise. The two sides keep their own types (no promotion). */
function shiftValue(
  op: string,
  left: ConstValue,
  right: ConstValue,
): ConstValue | null {
  return zipComponents(left, right, (a, b) => {
    const amount = scalarToNumber(b);
    if (amount === undefined || !Number.isInteger(amount) || amount < 0)
      return null;
    const { value, type } = a;
    if (typeof value === "bigint") {
      if (amount >= 64) return null; // shift past the bit width is a const error
      const r = op === "<<" ? value << BigInt(amount) : value >> BigInt(amount);
      return bigintScalar(type, r);
    }
    if (typeof value !== "number") return null;
    if (amount >= 32) return null; // shift past the bit width is a const error
    if (type.scalar === "i32") {
      const r = op === "<<" ? (value << amount) | 0 : value >> amount;
      return scalarValue(type, r);
    }
    if (type.scalar === "u32") {
      const r = op === "<<" ? (value << amount) >>> 0 : value >>> amount;
      return scalarValue(type, r);
    }
    return null;
  });
}

/** Apply a scalar op pairwise, splatting a scalar against a vector. */
function zipComponents(
  a: ConstValue,
  b: ConstValue,
  f: (a: ScalarValue, b: ScalarValue) => ScalarValue | null,
): ConstValue | null {
  if (a.kind === "scalar" && b.kind === "scalar") return f(a, b);
  const aVec = a.kind === "composite" && a.type.kind === "vector";
  const bVec = b.kind === "composite" && b.type.kind === "vector";
  if (aVec && bVec && a.elements.length !== b.elements.length) return null;
  if (!aVec && !bVec) return null;

  const size = aVec ? a.elements.length : (b as CompositeValue).elements.length;
  const elements: ScalarValue[] = [];
  for (let i = 0; i < size; i++) {
    const ae = aVec ? (a as CompositeValue).elements[i] : a;
    const be = bVec ? (b as CompositeValue).elements[i] : b;
    if (ae.kind !== "scalar" || be.kind !== "scalar") return null;
    const r = f(ae, be);
    if (!r) return null;
    elements.push(r);
  }
  const type = vecType(size as 2 | 3 | 4, elements[0].type);
  return { kind: "composite", type, elements };
}

/** Binary op on two scalars, promoting to a common type first, or null if invalid. */
function scalarBinary(
  op: string,
  a: ScalarValue,
  b: ScalarValue,
): ScalarValue | null {
  const promoted = promoteScalars(a, b);
  if (!promoted) return null;
  const [pa, pb, type] = promoted;

  if (comparisonOps.includes(op)) return compareScalars(op, pa, pb);
  if (typeof pa.value === "boolean" || typeof pb.value === "boolean") {
    if (typeof pa.value !== "boolean" || typeof pb.value !== "boolean")
      return null;
    if (op === "&") return boolValue(pa.value && pb.value);
    if (op === "|") return boolValue(pa.value || pb.value);
    if (op === "^") return boolValue(pa.value !== pb.value);
    return null;
  }
  if (typeof pa.value === "bigint" && typeof pb.value === "bigint") {
    const r = bigintOp(op, pa.value, pb.value);
    return r === null ? null : scalarValue(type, r);
  }
  if (typeof pa.value === "number" && typeof pb.value === "number") {
    const { scalar: kind } = type;
    const r =
      kind === "i32" || kind === "u32"
        ? intOp(op, pa.value, pb.value, kind === "u32")
        : floatOp(op, pa.value, pb.value, kind);
    return r === null ? null : scalarValue(type, r);
  }
  return null;
}

/** An abstract-int scalar, or null if the value overflows 64 bits. */
function bigintScalar(type: ScalarType, n: bigint): ScalarValue | null {
  const r = abstractIntResult(n);
  return r === null ? null : scalarValue(type, r);
}

/** Convert both scalars to their common (conversion-rank) type. */
function promoteScalars(
  a: ScalarValue,
  b: ScalarValue,
): [ScalarValue, ScalarValue, ScalarType] | null {
  let type: ScalarType;
  const aToB = conversionRank(a.type, b.type);
  const bToA = conversionRank(b.type, a.type);
  if (aToB !== undefined) type = b.type;
  else if (bToA !== undefined) type = a.type;
  else return null;

  const pa = convertScalar(a, type);
  const pb = convertScalar(b, type);
  return pa && pb ? [pa, pb, type] : null;
}

/** Comparison of two already-promoted scalars (bools compare only for == and !=). */
function compareScalars(
  op: string,
  a: ScalarValue,
  b: ScalarValue,
): ScalarValue | null {
  const av = a.value;
  const bv = b.value;
  if (typeof av === "boolean" || typeof bv === "boolean") {
    if (op === "==") return boolValue(av === bv);
    if (op === "!=") return boolValue(av !== bv);
    return null;
  }
  switch (op) {
    case "==":
      return boolValue(av === bv);
    case "!=":
      return boolValue(av !== bv);
    case "<":
      return boolValue(av < bv);
    case "<=":
      return boolValue(av <= bv);
    case ">":
      return boolValue(av > bv);
    case ">=":
      return boolValue(av >= bv);
    default:
      return null;
  }
}

/** Exact abstract-int op; null on divide by zero or 64-bit overflow.
 * The bitwise ops and % cannot leave the range if their operands are in it. */
function bigintOp(op: string, a: bigint, b: bigint): bigint | null {
  switch (op) {
    case "+":
      return abstractIntResult(a + b);
    case "-":
      return abstractIntResult(a - b);
    case "*":
      return abstractIntResult(a * b);
    case "/":
      // bigint division truncates like WGSL; min / -1 overflows
      return b === 0n ? null : abstractIntResult(a / b);
    case "%":
      return b === 0n ? null : a % b;
    case "&":
      return a & b;
    case "|":
      return a | b;
    case "^":
      return a ^ b;
    default:
      return null;
  }
}

/** Concrete integer op with i32/u32 wrapping. */
function intOp(
  op: string,
  a: number,
  b: number,
  unsigned: boolean,
): number | null {
  const wrap = (n: number) => (unsigned ? n >>> 0 : n | 0);
  switch (op) {
    case "+":
      return wrap(a + b);
    case "-":
      return wrap(a - b);
    case "*":
      return wrap(Math.imul(a, b));
    case "/":
      return b === 0 ? null : wrap(Math.trunc(a / b));
    case "%":
      return b === 0 ? null : wrap(a % b);
    case "&":
      return wrap(a & b);
    case "|":
      return wrap(a | b);
    case "^":
      return wrap(a ^ b);
    default:
      return null;
  }
}

/** Float op, rounded to the operand width after each operation. */
function floatOp(
  op: string,
  a: number,
  b: number,
  kind: ScalarKind,
): number | null {
  let r: number;
  switch (op) {
    case "+":
      r = a + b;
      break;
    case "-":
      r = a - b;
      break;
    case "*":
      r = a * b;
      break;
    case "/":
      r = a / b;
      break;
    case "%":
      r = a % b; // truncating remainder, matching WGSL float %
      break;
    default:
      return null;
  }
  const q = quantize(r, kind);
  return Number.isFinite(q) ? q : null; // overflow and 0/0 aren't const results
}
