import { afterAll, type TestContext, test } from "vitest";
import { importCases } from "wesl-testsuite";
import { testFromCase, verifyCaseCoverage } from "./TestLink.ts";

// wgsl example src, indexed by name
const examplesByName = new Map(importCases.map(t => [t.name, t]));

async function caseTest(ctx: TestContext): Promise<void> {
  return testFromCase(ctx.task.name, examplesByName);
}

afterAll(verifyCaseCoverage(importCases));

test("import package::bar::foo;", ctx => caseTest(ctx));
test("main has other root elements", ctx => caseTest(ctx));
test("import foo as bar", ctx => caseTest(ctx));
test("import twice doesn't get two copies", ctx => caseTest(ctx));
test("imported fn calls support fn with root conflict", ctx => caseTest(ctx));
test("import twice with two as names", ctx => caseTest(ctx));
test("import transitive conflicts with main", ctx => caseTest(ctx));
test("multiple exports from the same module", ctx => caseTest(ctx));
test("import and resolve conflicting support function", ctx => caseTest(ctx));
test("import support fn that references another import", ctx => caseTest(ctx));
test("import support fn from two exports", ctx => caseTest(ctx));
test("import a struct", ctx => caseTest(ctx));
test("struct referenced by a fn param", ctx => caseTest(ctx));
test("import fn with support struct constructor", ctx => caseTest(ctx));
test("import a transitive struct", ctx => caseTest(ctx));
test("'import as' a struct", ctx => caseTest(ctx));
test("import a struct with name conflicting support struct", ctx =>
  caseTest(ctx));
test("copy alias to output", ctx => caseTest(ctx));
test("copy diagnostics to output", ctx => caseTest(ctx));
test("const referenced by imported fn", ctx => caseTest(ctx));
test("fn call with a separator", ctx => caseTest(ctx));
test("local var to struct", ctx => caseTest(ctx));
test("global var to struct", ctx => caseTest(ctx));
test("return type of function", ctx => caseTest(ctx));
test("import a const", ctx => caseTest(ctx));
test("import an alias", ctx => caseTest(ctx));
test("alias f32", ctx => caseTest(ctx));
test("fn f32()", ctx => caseTest(ctx));
test("circular import", ctx => caseTest(ctx));
test("inline package reference", ctx => caseTest(ctx));
test("inline super:: reference", ctx => caseTest(ctx));
test("import super::file1", ctx => caseTest(ctx));
test("declaration after subscope", ctx => caseTest(ctx));
test("uninitialized global var", ctx => caseTest(ctx));
test("uninitialized override", ctx => caseTest(ctx));
test("import var with struct type", ctx => caseTest(ctx));
test("import var<private> with struct type", ctx => caseTest(ctx));
test("const_asserts in root module are included", ctx => caseTest(ctx));
test("const_asserts in used modules are included", ctx => caseTest(ctx));
test("const_asserts in unused modules are not included", ctx => caseTest(ctx));

// LATER add case for diagnostic in non-root module (should fail?)
