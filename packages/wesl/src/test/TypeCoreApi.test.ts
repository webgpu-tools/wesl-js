import { expect, test } from "vitest";
import * as wesl from "../index.ts";
import * as Bidirectional from "../types/Bidirectional.ts";
import * as BuiltinSignatures from "../types/BuiltinSignatures.ts";
import * as ConstEval from "../types/ConstEval.ts";
import * as ConstValues from "../types/ConstValues.ts";
import * as Conversions from "../types/Conversions.ts";
import * as TypeSynthesis from "../types/TypeSynthesis.ts";
import * as Types from "../types/Types.ts";

const typeCore = [
  Bidirectional,
  BuiltinSignatures,
  ConstEval,
  ConstValues,
  Conversions,
  TypeSynthesis,
  Types,
];

/** The type core modules export more than the barrel publishes, so that they
 * can share code with their siblings in types/ (numeric helpers, the overload
 * matcher). Typedoc documents whatever the barrel exports, so pin the intended
 * public surface here: a new name showing up means index.ts is leaking an
 * internal. Type-only exports (Type, ConstValue, TypeContext...) aren't
 * visible at runtime and aren't covered. */
test("the type core publishes only its curated api", () => {
  const exported = typeCore
    .flatMap(mod => Object.keys(mod))
    .filter(name => name in wesl)
    .sort();

  expect(exported).toEqual([
    "abstractFloat",
    "abstractInt",
    "arrayType",
    "boolType",
    "builtinFnType",
    "checkExpr",
    "checkFn",
    "checkModule",
    "checkedTypeOf",
    "commonType",
    "concretize",
    "conversionRank",
    "convertValue",
    "convertible",
    "elemScalar",
    "evalConstExpr",
    "f16Type",
    "f32Type",
    "i32Type",
    "isAbstract",
    "isFloatScalar",
    "isIntegerScalar",
    "isNumericScalar",
    "matType",
    "resolveTypeRef",
    "sameType",
    "scalarToNumber",
    "scalarType",
    "typeOfDecl",
    "typeOfExpr",
    "typeToString",
    "u32Type",
    "unknownType",
    "vecType",
    "voidType",
  ]);
});
