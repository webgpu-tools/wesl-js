import { builtinFnType } from "./BuiltinSignatures.ts";
import {
  abstractIntResult,
  boolValue,
  type ConstValue,
  componentBigints,
  componentNumbers,
  convertScalar,
  convertValue,
  f16Round,
  numericResult,
  quantize,
  roundEven,
  type ScalarValue,
  scalarToNumber,
  scalarValue,
} from "./ConstValues.ts";
import {
  elemScalar,
  type ScalarType,
  scalarType,
  type Type,
  vecType,
} from "./Types.ts";

/** Const-evaluation of builtin function calls (a pragmatic subset). */

/** big-endian, so offset 0 holds the sign and exponent bits */
const f64Scratch = new DataView(new ArrayBuffer(8));

/** abs/min/max/clamp/sign work on any numeric kind, including abstract-int. */
const numericFns: Record<
  string,
  (args: (number | bigint)[]) => number | bigint
> = {
  abs: ([a]) => (a < 0 ? -a : a),
  min: ([a, b]) => (a < b ? a : b),
  max: ([a, b]) => (a > b ? a : b),
  clamp: ([a, low, high]) => {
    if (a < low) return low;
    return a > high ? high : a;
  },
  sign: ([a]) => {
    if (typeof a !== "bigint") return Math.sign(a);
    if (a === 0n) return 0n;
    return a > 0n ? 1n : -1n;
  },
};

const floatFns: Record<string, (args: number[]) => number> = {
  acos: ([a]) => Math.acos(a),
  acosh: ([a]) => Math.acosh(a),
  asin: ([a]) => Math.asin(a),
  asinh: ([a]) => Math.asinh(a),
  atan: ([a]) => Math.atan(a),
  atanh: ([a]) => Math.atanh(a),
  atan2: ([a, b]) => Math.atan2(a, b),
  ceil: ([a]) => Math.ceil(a),
  cos: ([a]) => Math.cos(a),
  cosh: ([a]) => Math.cosh(a),
  // degrees/radians premultiply the constant: `(a * 180) / PI` overflows the
  // intermediate for near-max abstract floats whose true result is in range
  degrees: ([a]) => a * (180 / Math.PI),
  exp: ([a]) => Math.exp(a),
  exp2: ([a]) => 2 ** a,
  floor: ([a]) => Math.floor(a),
  fma: ([a, b, c]) => a * b + c,
  fract: ([a]) => a - Math.floor(a),
  inverseSqrt: ([a]) => 1 / Math.sqrt(a),
  ldexp: ([a, b]) => a * 2 ** b,
  log: ([a]) => Math.log(a),
  log2: ([a]) => Math.log2(a),
  mix: ([a, b, t]) => a * (1 - t) + b * t,
  pow: ([a, b]) => a ** b,
  quantizeToF16: ([a]) => f16Round(a),
  radians: ([a]) => a * (Math.PI / 180),
  round: ([a]) => roundEven(a),
  saturate: ([a]) => Math.min(Math.max(a, 0), 1),
  sin: ([a]) => Math.sin(a),
  sinh: ([a]) => Math.sinh(a),
  smoothstep: ([low, high, x]) => {
    const t = Math.min(Math.max((x - low) / (high - low), 0), 1);
    return t * t * (3 - 2 * t);
  },
  sqrt: ([a]) => Math.sqrt(a),
  step: ([edge, x]) => (edge <= x ? 1 : 0),
  tan: ([a]) => Math.tan(a),
  tanh: ([a]) => Math.tanh(a),
  trunc: ([a]) => Math.trunc(a),
};

/** Builtins over whole vectors. A scalar argument arrives as a 1-element array. */
const vectorFns: Record<string, (vecs: number[][]) => number | number[]> = {
  length: vecs => Math.hypot(...vecs[0]),
  distance: ([a, b]) => Math.hypot(...a.map((n, i) => n - b[i])),
  normalize: ([a]) => {
    const len = Math.hypot(...a);
    return a.map(n => n / len);
  },
  cross: ([a, b]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  faceForward: ([e1, e2, e3]) =>
    dotProduct(e2, e3) < 0 ? e1 : e1.map(n => -n),
  reflect: ([e1, e2]) => {
    const d = dotProduct(e2, e1);
    return e1.map((n, i) => n - 2 * d * e2[i]);
  },
  refract: ([e1, e2, [e3]]) => {
    const d = dotProduct(e2, e1);
    const k = 1 - e3 * e3 * (1 - d * d);
    if (k < 0) return e1.map(() => 0); // total internal reflection
    const s = e3 * d + Math.sqrt(k);
    return e1.map((n, i) => e3 * n - s * e2[i]);
  },
};

/** f64 layout: 52 fraction bits, exponent bias 1023 (so the least exponent is
 * 1 - bias). frexp works in the top 16 bits: sign, 11 exponent bits, then 4
 * fraction bits. */
const f64FractBits = 52;
const f64ExpBias = 1023;
const f64MinNormal = 2 ** (1 - f64ExpBias);

/** frexp debiases by one less than the bias, landing fract in [0.5, 1)
 * instead of [1, 2). */
const fractExpBias = f64ExpBias - 1;

/** Evaluate a const-evaluable builtin call (a pragmatic subset). */
export function builtinValue(
  name: string,
  args: (ConstValue | null)[],
): ConstValue | null {
  if (args.some(a => !a)) return null;
  const values = args as ConstValue[];
  const argTypes = values.map(v => v.type);
  const retType = builtinFnType(name, argTypes);
  if (retType.kind === "unknown") return null;

  if (name === "select") return selectValue(values, retType);
  if (name === "all" || name === "any") return allAnyValue(name, values);
  if (name === "dot") return dotValue(values, retType);
  if (name === "transpose") return transposeValue(values[0], retType);
  if (name === "determinant") return determinantValue(values[0], retType);
  if (name === "frexp" || name === "modf")
    return splitValue(name, values[0], retType);
  const generic = numericFns[name];
  if (generic) return mapNumeric(values, retType, generic);
  const floatFn = floatFns[name];
  if (floatFn) return mapFloat(values, retType, floatFn);
  const vecFn = vectorFns[name];
  if (vecFn) return vectorBuiltin(values, retType, vecFn);
  // TODO remaining @const builtin families: bit manipulation (countOneBits,
  // extractBits, reverseBits, ...) and data packing (pack4x8snorm,
  // unpack2x16float, dot4U8Packed, ...); BuiltinTable already types them
  return null;
}

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, n, i) => sum + n * b[i], 0);
}

/** select(f, t, cond): a scalar cond picks one arg, a vector cond picks per lane. */
function selectValue(values: ConstValue[], retType: Type): ConstValue | null {
  const [f, t, cond] = values;
  if (cond.kind === "scalar" && typeof cond.value === "boolean")
    return convertValue(cond.value ? t : f, retType);
  if (cond.kind === "composite" && retType.kind === "vector") {
    const fv = convertValue(f, retType);
    const tv = convertValue(t, retType);
    if (fv?.kind !== "composite" || tv?.kind !== "composite") return null;
    const elements = cond.elements.map((c, i) =>
      c.kind === "scalar" && typeof c.value === "boolean"
        ? (c.value ? tv : fv).elements[i]
        : null,
    );
    if (elements.some(e => !e)) return null;
    return {
      kind: "composite",
      type: retType,
      elements: elements as ConstValue[],
    };
  }
  return null;
}

/** all()/any() over a bool scalar or bool vector. */
function allAnyValue(name: string, values: ConstValue[]): ConstValue | null {
  const [v] = values;
  if (v.kind === "scalar") return typeof v.value === "boolean" ? v : null;
  const bools = v.elements.map(e =>
    e.kind === "scalar" && typeof e.value === "boolean" ? e.value : null,
  );
  if (bools.some(b => b === null)) return null;
  const result = name === "all" ? bools.every(b => b) : bools.some(b => b);
  return boolValue(result);
}

/** dot(): summed exactly for abstract-int, wrapped for i32/u32, rounded per step for floats. */
function dotValue(values: ConstValue[], retType: Type): ConstValue | null {
  if (retType.kind !== "scalar") return null;
  const kind = retType.scalar;
  if (kind === "abstract-int") {
    const [ba, bb] = values.map(v =>
      v.kind === "composite" ? componentBigints(v) : null,
    );
    if (!ba || !bb || ba.length !== bb.length) return null;
    const sum = ba.reduce((acc, n, i) => acc + n * bb[i], 0n);
    return scalarValue(retType, sum);
  }
  const [a, b] = values.map(v =>
    v.kind === "composite" ? componentNumbers(v) : null,
  );
  if (!a || !b || a.length !== b.length) return null;
  if (kind === "i32" || kind === "u32") {
    // multiply exactly and wrap like intOp; an f64 product loses low bits above 2^53
    const unsigned = kind === "u32";
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const acc = sum + Math.imul(a[i], b[i]);
      sum = unsigned ? acc >>> 0 : acc | 0;
    }
    return scalarValue(retType, sum);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const product = numericResult(a[i] * b[i], kind);
    if (product === null) return null;
    const next = numericResult(sum + product, kind);
    if (next === null) return null;
    sum = next;
  }
  return scalarValue(retType, sum);
}

/** transpose(m): the matrix whose columns are m's rows. Values are unchanged, so
 * the scalars are rearranged rather than recomputed. */
function transposeValue(m: ConstValue, retType: Type): ConstValue | null {
  const columns = matrixColumns(m);
  const elem = elemScalar(retType);
  if (!columns || !elem || retType.kind !== "matrix") return null;

  const rows = columns[0].length;
  const columnType = vecType(columns.length as 2 | 3 | 4, elem);
  const elements: ConstValue[] = [];
  for (let r = 0; r < rows; r++) {
    elements.push({
      kind: "composite",
      type: columnType,
      elements: columns.map(col => col[r]),
    });
  }
  return { kind: "composite", type: retType, elements };
}

/** determinant(m): m must be square. Computed exactly in f64, then rounded once
 * to the result type, which lands inside the accuracy the spec allows. */
function determinantValue(m: ConstValue, retType: Type): ConstValue | null {
  const columns = matrixColumns(m);
  const elem = elemScalar(retType);
  if (!columns || !elem || retType.kind !== "scalar") return null;
  if (columns.length !== columns[0].length) return null;

  // m[row][col], from the column-major storage
  const byRow = columns[0].map((_, r) =>
    columns.map(col => scalarToNumber(col[r])),
  );
  if (byRow.some(row => row.some(n => n === undefined))) return null;

  const d = quantize(determinant(byRow as number[][]), elem.scalar);
  return Number.isFinite(d) ? scalarValue(elem, d) : null;
}

/** frexp(e) and modf(e): both split each component in two and return a
 * predeclared struct of the two parts (see BuiltinSignatures.ts), which is where
 * the member types come from. */
function splitValue(
  name: string,
  v: ConstValue,
  retType: Type,
): ConstValue | null {
  if (retType.kind !== "struct") return null;
  const components =
    v.kind === "composite" ? componentNumbers(v) : [Number(v.value)];
  if (!components) return null;

  const split = name === "frexp" ? frexp : modf;
  const parts = components.map(split);
  const [fract, second] = retType.members;
  const a = componentsValue(
    fract.type,
    parts.map(p => p[0]),
  );
  const b = componentsValue(
    second.type,
    parts.map(p => p[1]),
  );
  if (!a || !b) return null;
  return { kind: "composite", type: retType, elements: [a, b] };
}

/** Component-wise builtin over any numeric kind (bigint-exact for abstract-int). */
function mapNumeric(
  values: ConstValue[],
  retType: Type,
  f: (args: (number | bigint)[]) => number | bigint,
): ConstValue | null {
  const elem = elemScalar(retType);
  if (!elem) return null;
  return mapLanes(values, retType, lane => {
    if (lane.some(n => typeof n === "boolean")) return null;
    const numeric = lane as (number | bigint)[];
    if (elem.scalar === "abstract-int") {
      if (numeric.some(n => typeof n !== "bigint")) return null;
      const r = f(numeric);
      if (typeof r !== "bigint") return null;
      const bounded = abstractIntResult(r); // abs(min) overflows 64 bits
      return bounded === null ? null : scalarValue(elem, bounded);
    }
    // concrete result: range-check abstract-int args like the operator path, so
    // out-of-range values return null rather than silently wrapping via Number()
    const args = numeric.map(n => concreteArg(n, elem));
    if (args.some(n => n === null)) return null;
    const wrapped = numericResult(Number(f(args as number[])), elem.scalar);
    return wrapped === null ? null : scalarValue(elem, wrapped);
  });
}

/** Component-wise float builtin; arguments compute at the result's precision. */
function mapFloat(
  values: ConstValue[],
  retType: Type,
  f: (args: number[]) => number,
): ConstValue | null {
  const elem = elemScalar(retType);
  if (!elem) return null;
  return mapLanes(values, retType, lane => {
    const result = quantize(f(lane.map(Number)), elem.scalar);
    return Number.isFinite(result) ? scalarValue(elem, result) : null;
  });
}

/** Vector-consuming float builtins (length, distance, normalize, cross). */
function vectorBuiltin(
  values: ConstValue[],
  retType: Type,
  f: (vecs: number[][]) => number | number[],
): ConstValue | null {
  const elem = elemScalar(retType);
  if (!elem) return null;
  const vecs = values.map(v =>
    v.kind === "composite" ? componentNumbers(v) : [Number(v.value)],
  );
  if (vecs.some(v => v === null)) return null;
  const result = f(vecs as number[][]);

  if (typeof result === "number") {
    const q = quantize(result, elem.scalar);
    return Number.isFinite(q) ? scalarValue(elem, q) : null;
  }
  if (retType.kind !== "vector") return null;
  const elements = result.map(n => {
    const q = quantize(n, elem.scalar);
    return Number.isFinite(q) ? scalarValue(elem, q) : null;
  });
  if (elements.some(e => !e)) return null;
  return {
    kind: "composite",
    type: retType,
    elements: elements as ConstValue[],
  };
}

/** The column vectors of a matrix value, as scalars (null if not a matrix). */
function matrixColumns(m: ConstValue): ScalarValue[][] | null {
  if (m.kind !== "composite" || m.type.kind !== "matrix") return null;
  const columns = m.elements.map(col =>
    col.kind === "composite" &&
    col.elements.every(e => e.kind === "scalar") &&
    col.elements.length > 0
      ? (col.elements as ScalarValue[])
      : null,
  );
  if (columns.some(c => !c)) return null;
  return columns as ScalarValue[][];
}

/** Cofactor expansion along the first row (WGSL matrices are at most 4x4). */
function determinant(m: number[][]): number {
  if (m.length === 1) return m[0][0];
  if (m.length === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  let sum = 0;
  for (let c = 0; c < m.length; c++) {
    const minor = m.slice(1).map(row => row.filter((_, j) => j !== c));
    sum += (c % 2 ? -1 : 1) * m[0][c] * determinant(minor);
  }
  return sum;
}

/** e = fract * 2^exp, with |fract| in [0.5, 1). Read off the f64 exponent field
 * rather than scaling by 2^exp, which would overflow at the ends of the range.
 * Zero, infinities, and NaN return themselves with exp 0, per the spec. */
function frexp(e: number): [number, number] {
  if (e === 0 || !Number.isFinite(e)) return [e, 0];
  // a subnormal has no exponent to read, so normalize it first (exactly)
  const subnormal = Math.abs(e) < f64MinNormal;
  f64Scratch.setFloat64(0, subnormal ? e * 2 ** f64FractBits : e);
  const high = f64Scratch.getUint16(0);
  const storedExp = (high >>> 4) & 0x7ff;
  const exp = storedExp - fractExpBias - (subnormal ? f64FractBits : 0);
  // force the stored exponent to fractExpBias: the actual exponent becomes -1
  f64Scratch.setUint16(0, (high & 0x800f) | (fractExpBias << 4));
  return [f64Scratch.getFloat64(0), exp];
}

/** e = fract + whole, both with e's sign: the whole part truncates toward zero. */
function modf(e: number): [number, number] {
  const whole = Number.isFinite(e) ? Math.trunc(e) : e;
  return [e - whole, whole];
}

/** A scalar or vector value of `type` from its components (an abstract-int
 * member, like frexp's exp, takes them as bigints). */
function componentsValue(type: Type, components: number[]): ConstValue | null {
  const elem = elemScalar(type);
  if (!elem) return null;
  const scalars = components.map(n => {
    if (elem.scalar === "abstract-int") return scalarValue(elem, BigInt(n));
    const r = numericResult(n, elem.scalar);
    return r === null ? null : scalarValue(elem, r);
  });
  if (scalars.some(s => !s)) return null;
  if (type.kind !== "vector") return scalars[0];
  return { kind: "composite", type, elements: scalars as ConstValue[] };
}

/** Apply a per-lane function across the components of all args
 * (scalars splat across vector lanes). */
function mapLanes(
  values: ConstValue[],
  retType: Type,
  f: (lane: (number | bigint | boolean)[]) => ScalarValue | null,
): ConstValue | null {
  const lanes = retType.kind === "vector" ? retType.size : 1;
  const args = values.map(v => {
    if (v.kind === "scalar") return [v.value];
    const nums = v.elements.map(e => (e.kind === "scalar" ? e.value : null));
    return nums.some(n => n === null)
      ? null
      : (nums as (number | bigint | boolean)[]);
  });
  if (args.some(a => a === null)) return null;

  const results: ScalarValue[] = [];
  for (let lane = 0; lane < lanes; lane++) {
    const laneArgs = (args as (number | bigint | boolean)[][]).map(a =>
      a.length === 1 ? a[0] : a[lane],
    );
    const r = f(laneArgs);
    if (!r) return null;
    results.push(r);
  }
  if (retType.kind !== "vector") return results[0];
  return { kind: "composite", type: retType, elements: results };
}

/** An abstract-int builtin argument as a JS number for a concrete result type,
 * range-checked like the operator path (null if out of that type's range). */
function concreteArg(n: number | bigint, target: ScalarType): number | null {
  if (typeof n !== "bigint") return n;
  const converted = convertScalar(
    scalarValue(scalarType("abstract-int"), n),
    target,
  );
  return converted ? Number(converted.value) : null;
}
