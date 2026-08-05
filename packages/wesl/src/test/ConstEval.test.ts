import { expect, test } from "vitest";
import { initValue } from "./TypeTestUtil.ts";

test("abstract-int arithmetic is exact bigint", () => {
  expect(initValue("const a = 1 + 2 * 3;", "a")).toBe("7 : abstract-int");
  expect(initValue("const a = 0x7fffffff + 1;", "a")).toBe(
    "2147483648 : abstract-int",
  );
});

test("abstract-int is bounded to 64 bits", () => {
  const max = "9223372036854775807";
  expect(initValue(`const a = ${max};`, "a")).toBe(`${max} : abstract-int`);
  // i64 min is only spellable as a subtraction: the literal 2^63 is out of range
  expect(initValue(`const a = -${max} - 1;`, "a")).toBe(
    "-9223372036854775808 : abstract-int",
  );
  expect(initValue("const a = 9223372036854775808;", "a")).toBe("null");
  // products stay exact right up to the bound
  expect(initValue("const a = 3037000499 * 3037000499;", "a")).toBe(
    "9223372030926249001 : abstract-int",
  );
});

test("abstract-int overflow is not const-evaluable", () => {
  const max = "9223372036854775807";
  expect(initValue(`const a = ${max} + 1;`, "a")).toBe("null");
  expect(initValue(`const a = ${max} * 2;`, "a")).toBe("null");
  expect(initValue("const a = 1 << 100;", "a")).toBe("null");
  expect(initValue("const a = 1 << 63;", "a")).toBe("null"); // 2^63 is one past max
  expect(initValue(`const a = -(-${max} - 1);`, "a")).toBe("null"); // -min
  expect(initValue(`const a = abs(-${max} - 1);`, "a")).toBe("null");
  expect(initValue(`const a = (-${max} - 1) / -1;`, "a")).toBe("null");
});

test("abstract-int division truncates toward zero", () => {
  expect(initValue("const a = 7 / 2;", "a")).toBe("3 : abstract-int");
  expect(initValue("const a = (0 - 7) / 2;", "a")).toBe("-3 : abstract-int");
  expect(initValue("const a = 7 % 2;", "a")).toBe("1 : abstract-int");
  // % takes the sign of the left operand
  expect(initValue("const a = (0 - 7) % 2;", "a")).toBe("-1 : abstract-int");
});

test("division or remainder by zero is not const-evaluable", () => {
  expect(initValue("const a = 1 / 0;", "a")).toBe("null");
  expect(initValue("const a = 1.0 / 0.0;", "a")).toBe("null");
  expect(initValue("const a = 1 % 0;", "a")).toBe("null");
  expect(initValue("const a = 1i % 0i;", "a")).toBe("null");
});

test("i32 and u32 arithmetic wraps", () => {
  expect(initValue("const a = 2147483647i + 1i;", "a")).toBe(
    "-2147483648 : i32",
  );
  expect(initValue("const a = 0u - 1u;", "a")).toBe("4294967295 : u32");
  expect(initValue("const a = 32768i * 65536i;", "a")).toBe(
    "-2147483648 : i32",
  );
});

test("f32 arithmetic rounds to f32 per operation", () => {
  expect(initValue("const a = 16777216f + 1f;", "a")).toBe("16777216 : f32");
  expect(initValue("const a = 0.5 + 0.25;", "a")).toBe("0.75 : abstract-float");
});

test("const decls convert to their annotated type", () => {
  expect(initValue("const c: f32 = 1; const d = c;", "d")).toBe("1 : f32");
  expect(initValue("const c: i32 = 4294967296; const d = c;", "d")).toBe(
    "null", // out of i32 range
  );
});

test("const references chain", () => {
  expect(initValue("const c = 2; const d = c * 3;", "d")).toBe(
    "6 : abstract-int",
  );
});

test("unary operators", () => {
  expect(initValue("const a = -5;", "a")).toBe("-5 : abstract-int");
  expect(initValue("const a = !true;", "a")).toBe("false : bool");
  expect(initValue("const a = ~0;", "a")).toBe("-1 : abstract-int");
  expect(initValue("const a = ~0u;", "a")).toBe("4294967295 : u32");
});

test("shifts: >> is arithmetic on i32, logical on u32", () => {
  expect(initValue("const a = 1 << 10;", "a")).toBe("1024 : abstract-int");
  expect(initValue("const a = 0x80000000u >> 31u;", "a")).toBe("1 : u32");
  expect(initValue("const a = (0i - 8i) >> 1u;", "a")).toBe("-4 : i32");
  expect(initValue("const a = 1u << 31u;", "a")).toBe("2147483648 : u32");
});

test("concrete shift past the bit width is not const-evaluable", () => {
  expect(initValue("const a = 1u << 32u;", "a")).toBe("null");
  expect(initValue("const a = 1i << 40u;", "a")).toBe("null");
});

test("comparisons and logical operators", () => {
  expect(initValue("const a = 3 > 2;", "a")).toBe("true : bool");
  expect(initValue("const a = 1.5 == 1.5;", "a")).toBe("true : bool");
  expect(initValue("const a = true && false;", "a")).toBe("false : bool");
  expect(initValue("const a = true || false;", "a")).toBe("true : bool");
});

test("vector arithmetic is component-wise with scalar splat", () => {
  expect(initValue("const v = vec2(1, 2) + vec2(3, 4);", "v")).toBe(
    "[4, 6] : vec2<abstract-int>",
  );
  expect(initValue("const v = vec2(1, 2) * 3;", "v")).toBe(
    "[3, 6] : vec2<abstract-int>",
  );
  expect(initValue("const v = vec2(1, 3) == vec2(1, 2);", "v")).toBe(
    "[true, false] : vec2<bool>",
  );
});

test("vector construction: splat, flatten, and explicit element types", () => {
  expect(initValue("const v = vec3(1.5);", "v")).toBe(
    "[1.5, 1.5, 1.5] : vec3<abstract-float>",
  );
  expect(initValue("const v = vec4(vec2(1, 2), 3, 4);", "v")).toBe(
    "[1, 2, 3, 4] : vec4<abstract-int>",
  );
  expect(initValue("const v = vec3<f32>(1, 2, 3);", "v")).toBe(
    "[1, 2, 3] : vec3<f32>",
  );
  expect(initValue("const v = vec2<f32>();", "v")).toBe("[0, 0] : vec2<f32>");
});

test("swizzles and indexing on const vectors", () => {
  expect(initValue("const s = vec3(1, 2, 3).zx;", "s")).toBe(
    "[3, 1] : vec2<abstract-int>",
  );
  expect(initValue("const e = vec3(1, 2, 3)[1];", "e")).toBe(
    "2 : abstract-int",
  );
});

test("scalar conversion constructors truncate and wrap", () => {
  expect(initValue("const i = i32(2.7);", "i")).toBe("2 : i32");
  expect(initValue("const u = u32(-1i);", "u")).toBe("4294967295 : u32");
  expect(initValue("const b = bool(3);", "b")).toBe("true : bool");
  expect(initValue("const f = f32(3u);", "f")).toBe("3 : f32");
});

test("float to int conversion clamps rather than wrapping", () => {
  expect(initValue("const u = u32(-1f);", "u")).toBe("0 : u32");
  expect(initValue("const i = i32(-1e10f);", "i")).toBe("-2147483648 : i32");
  // the clamp bound is the largest target value an f32 can represent, so an
  // f32 source clamps below i32/u32 max
  expect(initValue("const i = i32(1e10f);", "i")).toBe("2147483520 : i32");
  expect(initValue("const u = u32(1e10f);", "u")).toBe("4294967040 : u32");
});

test("int conversions reinterpret bits, abstract-int must be in range", () => {
  expect(initValue("const i = i32(4294967295u);", "i")).toBe("-1 : i32");
  expect(initValue("const u = u32(-1);", "u")).toBe("null");
  expect(initValue("const i = i32(2147483648);", "i")).toBe("null");
});

test("bool conversions both ways", () => {
  expect(initValue("const i = i32(true);", "i")).toBe("1 : i32");
  expect(initValue("const f = f32(false);", "f")).toBe("0 : f32");
  expect(initValue("const b = bool(0.0);", "b")).toBe("false : bool");
});

test("array values and indexing", () => {
  expect(initValue("const a = array(1, 2, 3);", "a")).toBe(
    "[1, 2, 3] : array<abstract-int, 3>",
  );
  expect(initValue("const a = array<u32, 2>(1, 2); const e = a[1];", "e")).toBe(
    "2 : u32",
  );
});

test("struct construction and member access", () => {
  const src = `
    struct S { a: i32, b: f32 }
    const s = S(1, 2.0);
    const x = s.b;`;
  expect(initValue(src, "s")).toBe("[1, 2] : S");
  expect(initValue(src, "x")).toBe("2 : f32");
});

test("matrix construction from scalars and columns", () => {
  expect(initValue("const m = mat2x2<f32>(1, 2, 3, 4);", "m")).toBe(
    "[[1, 2], [3, 4]] : mat2x2<f32>",
  );
  const cols = "const m = mat2x2<f32>(vec2f(1.0, 2.0), vec2f(3.0, 4.0));";
  expect(initValue(cols, "m")).toBe("[[1, 2], [3, 4]] : mat2x2<f32>");
});

test("numeric builtins evaluate", () => {
  expect(initValue("const a = max(3, 4);", "a")).toBe("4 : abstract-int");
  expect(initValue("const a = abs(-2.5);", "a")).toBe("2.5 : abstract-float");
  expect(initValue("const a = clamp(5, 0, 3);", "a")).toBe("3 : abstract-int");
  expect(initValue("const a = sign(-3);", "a")).toBe("-1 : abstract-int");
  expect(initValue("const a = min(2u, 7u);", "a")).toBe("2 : u32");
});

test("out-of-range abstract-int arg to a concrete builtin is not const", () => {
  // 5e9 exceeds i32; like the operator path, max() here is not const-evaluable
  // rather than silently wrapping the argument to a garbage i32
  expect(initValue("const a = max(5000000000, 1i);", "a")).toBe("null");
});

test("float builtins evaluate", () => {
  expect(initValue("const a = floor(2.7);", "a")).toBe("2 : abstract-float");
  expect(initValue("const a = sqrt(4.0);", "a")).toBe("2 : abstract-float");
  expect(initValue("const a = mix(0.0, 10.0, 0.25);", "a")).toBe(
    "2.5 : abstract-float",
  );
  // WGSL round() rounds half to even
  expect(initValue("const a = round(2.5);", "a")).toBe("2 : abstract-float");
  expect(initValue("const a = round(3.5);", "a")).toBe("4 : abstract-float");
});

test("vector builtins evaluate", () => {
  expect(initValue("const a = length(vec2(3.0, 4.0));", "a")).toBe(
    "5 : abstract-float",
  );
  expect(initValue("const a = dot(vec2(1, 2), vec2(3, 4));", "a")).toBe(
    "11 : abstract-int",
  );
  const crossSrc = "const a = cross(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0));";
  expect(initValue(crossSrc, "a")).toBe("[0, 0, 1] : vec3<abstract-float>");
  expect(initValue("const a = select(1.0, 2.0, true);", "a")).toBe(
    "2 : abstract-float",
  );
  expect(initValue("const a = all(vec2(true, false));", "a")).toBe(
    "false : bool",
  );
});

test("geometric builtins evaluate", () => {
  // reflect(e1, e2) = e1 - 2 * dot(e2, e1) * e2: straight down off a flat floor
  const reflectSrc =
    "const a = reflect(vec2(0.0, -1.0), vec2(0.0, 1.0));" as const;
  expect(initValue(reflectSrc, "a")).toBe("[0, 1] : vec2<abstract-float>");

  // faceForward keeps e1 when dot(e2, e3) is negative, and flips it otherwise
  const towards =
    "const a = faceForward(vec2(1.0, 2.0), vec2(1.0, 0.0), vec2(-1.0, 0.0));";
  expect(initValue(towards, "a")).toBe("[1, 2] : vec2<abstract-float>");
  const away =
    "const a = faceForward(vec2(1.0, 2.0), vec2(1.0, 0.0), vec2(1.0, 0.0));";
  expect(initValue(away, "a")).toBe("[-1, -2] : vec2<abstract-float>");

  // refract with a ratio of 1 passes the incident vector straight through
  const refractSrc = "const a = refract(vec2(0.0, -1.0), vec2(0.0, 1.0), 1.0);";
  expect(initValue(refractSrc, "a")).toBe("[0, -1] : vec2<abstract-float>");
});

test("matrix builtins evaluate", () => {
  const t = "const a = transpose(mat2x3<f32>(1, 2, 3, 4, 5, 6));";
  expect(initValue(t, "a")).toBe("[[1, 4], [2, 5], [3, 6]] : mat3x2<f32>");

  const d = "const a = determinant(mat2x2<f32>(1, 2, 3, 4));";
  expect(initValue(d, "a")).toBe("-2 : f32");
  const d3 = "const a = determinant(mat3x3<f32>(2, 0, 0, 0, 3, 0, 0, 0, 4));";
  expect(initValue(d3, "a")).toBe("24 : f32");
});

test("concrete-int dot multiplies exactly (no f64 precision loss)", () => {
  // 0xFFFFFFFF^2 wraps to 1 in u32; an f64 product would round it to 0
  const src = "const a = dot(vec2(4294967295u, 0u), vec2(4294967295u, 0u));";
  expect(initValue(src, "a")).toBe("1 : u32");
});

test("runtime values are not const-evaluable", () => {
  const varRef = "var<private> v = 1.0; fn f() { let y = v + 1.0; }";
  expect(initValue(varRef, "y")).toBe("null");
  const fnCall = "fn g() -> f32 { return 1.0; } fn f() { let y = g(); }";
  expect(initValue(fnCall, "y")).toBe("null");
  const overrideRef = "override o: f32; fn f() { let y = o * 2.0; }";
  expect(initValue(overrideRef, "y")).toBe("null");
});

test("alias constructors evaluate", () => {
  expect(initValue("alias V2 = vec2<f32>; const v = V2(1.0, 2.0);", "v")).toBe(
    "[1, 2] : vec2<f32>",
  );
});

test("self-referential const degrades to null", () => {
  expect(initValue("const a = a;", "a")).toBe("null");
});

test("f16 values quantize to f16 precision", () => {
  // 0.1 rounds to the nearest f16 (0x1.99ap-4), not the nearest f32
  expect(initValue("const a = f16(0.1);", "a")).toBe("0.0999755859375 : f16");
  expect(initValue("const a = 0.1h;", "a")).toBe("0.0999755859375 : f16");
  expect(initValue("const a = 65504h;", "a")).toBe("65504 : f16");
  expect(initValue("const a = quantizeToF16(0.1f);", "a")).toBe(
    "0.0999755859375 : f32",
  );
});

test("f16 overflow is not const-evaluable", () => {
  expect(initValue("const a = f16(1e6);", "a")).toBe("null");
  expect(initValue("const a = 1e6h;", "a")).toBe("null");
  expect(initValue("const c: f16 = 100000; const a = c;", "a")).toBe("null");
  // 65520 is exactly halfway to the next f16 step; ties-to-even overflows
  expect(initValue("const a = f16(65520.0);", "a")).toBe("null");
  // just below the tie still rounds down into range
  expect(initValue("const a = f16(65519.0);", "a")).toBe("65504 : f16");
});

test("f16 arithmetic rounds each operation to f16", () => {
  // 2048 + 1 is inexact in f16 (ulp is 2); ties-to-even keeps 2048
  expect(initValue("const a = 2048h + 1h;", "a")).toBe("2048 : f16");
});

test("frexp and modf split a float into a result struct", () => {
  // 24 = 0.75 * 2^5
  expect(initValue("const a = frexp(24.0).fract;", "a")).toBe(
    "0.75 : abstract-float",
  );
  expect(initValue("const a = frexp(24.0).exp;", "a")).toBe("5 : abstract-int");
  expect(initValue("const a = frexp(0.0).exp;", "a")).toBe("0 : abstract-int");
  expect(initValue("const a = frexp(vec2f(0.0, 8.0)).exp;", "a")).toBe(
    "[0, 4] : vec2<i32>",
  );

  // the whole part truncates toward zero, so both parts take the sign
  expect(initValue("const a = modf(-1.5).whole;", "a")).toBe(
    "-1 : abstract-float",
  );
  expect(initValue("const a = modf(-1.5).fract;", "a")).toBe(
    "-0.5 : abstract-float",
  );
  expect(initValue("const a = modf(vec2f(1.25, 2.5)).fract;", "a")).toBe(
    "[0.25, 0.5] : vec2<f32>",
  );
});

test("zero value constructors evaluate to zeros", () => {
  expect(initValue("const v = vec2();", "v")).toBe(
    "[0, 0] : vec2<abstract-int>",
  );
  expect(initValue("const m = mat2x2();", "m")).toBe(
    "[[0, 0], [0, 0]] : mat2x2<abstract-float>",
  );
  expect(initValue("const f = f32();", "f")).toBe("0 : f32");
  expect(initValue("const v = vec2<u32>();", "v")).toBe("[0, 0] : vec2<u32>");
});

test("frexp and modf take an abstract-int argument as a float", () => {
  expect(initValue("const a = frexp(1).fract;", "a")).toBe(
    "0.5 : abstract-float",
  );
  expect(initValue("const a = frexp(1).exp;", "a")).toBe("1 : abstract-int");
  expect(initValue("const a = modf(3).whole;", "a")).toBe("3 : abstract-float");
});
