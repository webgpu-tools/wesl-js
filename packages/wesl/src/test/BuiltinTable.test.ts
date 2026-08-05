import { expect, test } from "vitest";
import { builtinFnType } from "../types/BuiltinSignatures.ts";
import { signatures } from "../types/BuiltinTable.ts";
import { parseOverload } from "../types/OverloadMatch.ts";
import {
  abstractFloat,
  abstractInt,
  type Type,
  typeToString,
  vecType,
} from "../types/Types.ts";

// most of the table is only reached through TypeSynthesis tests for a handful
// of builtins, so sweep every row: parseOverload throws on a bad row, but the
// table parses lazily, so a typo would otherwise hide until a runtime lookup
test("every builtin signature parses", () => {
  for (const [name, sig] of Object.entries(signatures)) {
    expect(() => sig.split(";").map(parseOverload), name).not.toThrow();
  }
});

test("subgroup builtins materialize abstract arguments", () => {
  const add = (t: Type) => typeToString(builtinFnType("subgroupAdd", [t]));
  expect(add(abstractInt)).toBe("i32");
  expect(add(abstractFloat)).toBe("f32");
  expect(typeToString(builtinFnType("quadSwapX", [vecType(2, abstractInt)]))) //
    .toBe("vec2<i32>");

  // const-evaluable builtins do have abstract overloads, and keep them
  expect(typeToString(builtinFnType("max", [abstractInt, abstractInt]))) //
    .toBe("abstract-int");
});
