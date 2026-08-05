import { expect, test } from "vitest";
import {
  checkedTypeOf,
  checkModule,
  checkType,
} from "../types/Bidirectional.ts";
import {
  abstractInt,
  f32Type,
  i32Type,
  typeToString,
  unknownType,
} from "../types/Types.ts";
import {
  checkedInitType,
  checkedReturnType,
  elemsOfKind,
  initType,
  typeTest,
} from "./TypeTestUtil.ts";

/** Checked type (as a string) of the first assignment's RHS. */
function assignRhsType(src: string): string {
  const { ctx, moduleElem } = typeTest(src);
  checkModule(moduleElem, ctx);
  const [assign] = elemsOfKind(moduleElem, "assign");
  if (!assign) throw new Error("no assignment in test source");
  return typeToString(checkedTypeOf(assign.rhs, ctx));
}

/** Checked types (as strings) of every literal in the module, source order. */
function literalTypes(src: string): string[] {
  const { ctx, moduleElem } = typeTest(src);
  checkModule(moduleElem, ctx);
  const literals = elemsOfKind(moduleElem, "literal");
  return literals.map(lit => typeToString(checkedTypeOf(lit, ctx)));
}

test("checkType adopts the expected type when convertible", () => {
  expect(typeToString(checkType(i32Type, i32Type))).toBe("i32");
  // abstract-int converts to f32, so the expected type wins (materialization)
  expect(checkType(abstractInt, f32Type)).toBe(f32Type);
  // an unknown synthesized type takes any expectation
  expect(checkType(unknownType, f32Type)).toBe(f32Type);
});

test("checkType is non-validating: keeps the synthesized type when not convertible", () => {
  // concrete i32 does not implicitly convert to f32; no error, keep i32
  expect(typeToString(checkType(i32Type, f32Type))).toBe("i32");
});

test("checkType imposes no expectation for an unknown expected type", () => {
  expect(typeToString(checkType(i32Type, unknownType))).toBe("i32");
});

test("annotated let/var/const push the expected type into the initializer", () => {
  expect(checkedInitType("fn f() { let x: f32 = 1; }", "x")).toBe("f32");
  expect(checkedInitType("fn f() { var x: f32 = 1; }", "x")).toBe("f32");
  expect(checkedInitType("const c: f32 = 1;", "c")).toBe("f32");
});

test("expected type materializes abstract numerics that synthesis leaves abstract", () => {
  // forward synthesis of `1 + 2` is abstract-int; the annotation makes it f32
  expect(initType("const c = 1 + 2;", "c")).toBe("abstract-int");
  expect(checkedInitType("const c: f32 = 1 + 2;", "c")).toBe("f32");
  expect(checkedInitType("fn f() { let v: vec3f = vec3(1, 2, 3); }", "v")).toBe(
    "vec3<f32>",
  );
});

test("override and module var annotations push expected types", () => {
  expect(checkedInitType("override o: f32 = 1;", "o")).toBe("f32");
  expect(checkedInitType("var<private> v: f32 = 1;", "v")).toBe("f32");
});

test("return value expects the function's return type", () => {
  expect(checkedReturnType("fn f() -> f32 { return 1; }")).toBe("f32");
  expect(checkedReturnType("fn f() -> vec2f { return vec2(1, 2); }")).toBe(
    "vec2<f32>",
  );
});

test("plain assignment expects the target's declared type", () => {
  expect(assignRhsType("fn f() { var x: f32 = 0f; x = 1; }")).toBe("f32");
});

test("compound assignment is left to forward synthesis", () => {
  // no expected type pushed through `+=`, so `1` stays abstract-int
  expect(assignRhsType("fn f() { var x: f32 = 0f; x += 1; }")).toBe(
    "abstract-int",
  );
});

test("expected types do not propagate through call arguments", () => {
  // the `f32` annotation reaches max(...), not its abstract-int arguments
  const src = "fn f() { let m: f32 = max(1, 2); }";
  expect(literalTypes(src)).toEqual(["abstract-int", "abstract-int"]);
});

test("expected types do not propagate through operators", () => {
  // `f32` reaches `1 * 2` as a whole; the operands keep their synthesized
  // abstract types
  const src = "fn f() { let n: f32 = 1 * 2; }";
  expect(literalTypes(src)).toEqual(["abstract-int", "abstract-int"]);
});
