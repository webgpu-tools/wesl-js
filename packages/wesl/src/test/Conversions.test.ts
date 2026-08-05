import { expect, test } from "vitest";
import { builtinFnType } from "../types/BuiltinSignatures.ts";
import {
  commonType,
  concretize,
  conversionRank,
} from "../types/Conversions.ts";
import {
  abstractFloat,
  abstractInt,
  arrayType,
  f16Type,
  f32Type,
  i32Type,
  typeToString,
  u32Type,
  unknownType,
  vecType,
} from "../types/Types.ts";

test("scalar conversion ranks follow the WGSL spec", () => {
  expect(conversionRank(abstractFloat, f32Type)).toBe(1);
  expect(conversionRank(abstractFloat, f16Type)).toBe(2);
  expect(conversionRank(abstractInt, i32Type)).toBe(3);
  expect(conversionRank(abstractInt, u32Type)).toBe(4);
  expect(conversionRank(abstractInt, abstractFloat)).toBe(5);
  expect(conversionRank(abstractInt, f32Type)).toBe(6);
  expect(conversionRank(abstractInt, f16Type)).toBe(7);
  expect(conversionRank(f32Type, f32Type)).toBe(0);
});

test("concrete types never convert implicitly", () => {
  expect(conversionRank(f32Type, f16Type)).toBeUndefined();
  expect(conversionRank(i32Type, f32Type)).toBeUndefined();
  expect(conversionRank(i32Type, u32Type)).toBeUndefined();
  expect(conversionRank(f32Type, abstractFloat)).toBeUndefined();
});

test("vectors and arrays convert by element", () => {
  expect(conversionRank(vecType(2, abstractInt), vecType(2, f32Type))).toBe(6);
  expect(
    conversionRank(vecType(2, abstractInt), vecType(3, f32Type)),
  ).toBeUndefined();
  expect(conversionRank(arrayType(abstractInt, 2), arrayType(i32Type, 2))).toBe(
    3,
  );
  expect(
    conversionRank(arrayType(abstractInt, 2), arrayType(i32Type, 3)),
  ).toBeUndefined();
});

test("unknown matches everything at rank 0", () => {
  expect(conversionRank(unknownType, f32Type)).toBe(0);
  expect(conversionRank(vecType(2, f32Type), unknownType)).toBe(0);
});

test("concretize materializes abstract numerics to defaults", () => {
  expect(typeToString(concretize(abstractInt))).toBe("i32");
  expect(typeToString(concretize(vecType(2, abstractFloat)))).toBe("vec2<f32>");
  expect(typeToString(concretize(arrayType(abstractInt, 3)))).toBe(
    "array<i32, 3>",
  );
  expect(concretize(f32Type)).toBe(f32Type); // concrete types pass through
});

test("commonType picks the convertible direction", () => {
  expect(commonType(abstractInt, f32Type)).toBe(f32Type);
  expect(commonType(f32Type, abstractInt)).toBe(f32Type);
  expect(commonType(abstractInt, abstractFloat)).toBe(abstractFloat);
  expect(commonType(i32Type, u32Type)).toBeUndefined();
});

test("the abstract frexp result struct converts to its concrete forms", () => {
  const abstract = builtinFnType("frexp", [abstractFloat]);
  const f32Result = builtinFnType("frexp", [f32Type]);

  // ranked like the abstract float it holds: 1 to f32, 2 to f16
  expect(conversionRank(abstract, f32Result)).toBe(1);
  expect(conversionRank(abstract, builtinFnType("frexp", [f16Type]))).toBe(2);
  expect(conversionRank(f32Result, abstract)).toBeUndefined();
  expect(
    conversionRank(abstract, builtinFnType("modf", [f32Type])),
  ).toBeUndefined();

  expect(typeToString(concretize(abstract))).toBe("__frexp_result_f32");
  expect(concretize(f32Result)).toBe(f32Result);
});
