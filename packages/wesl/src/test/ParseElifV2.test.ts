import { expect, test } from "vitest";
import { astToString } from "../debug/ASTtoString.ts";
import { parseTest } from "./TestUtil.ts";

test("parse @elif basic", () => {
  const ast = parseTest(
    "@if(false) const a = 1;\n@elif(true) const a = 2;\n@else const a = 3;",
  );
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      const %a @if
        attribute @if(false)
        typeDecl %a
          decl %a
        literal literal(1)
      const %a @elif
        attribute @elif(true)
        typeDecl %a
          decl %a
        literal literal(2)
      const %a @else
        attribute @else
        typeDecl %a
          decl %a
        literal literal(3)"
  `);
});

test("parse @elif with complex condition", () => {
  const ast = parseTest("@if(foo) fn f() {}\n@elif(bar && !baz) fn f() {}");
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn f() @if
        attribute @if(foo)
        decl %f
        block
      fn f() @elif
        attribute @elif(bar && !baz)
        decl %f
        block"
  `);
});

test("parse multiple @elif", () => {
  const ast = parseTest(
    "@if(a) const x = 1;\n@elif(b) const x = 2;\n@elif(c) const x = 3;\n@else const x = 4;",
  );
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      const %x @if
        attribute @if(a)
        typeDecl %x
          decl %x
        literal literal(1)
      const %x @elif
        attribute @elif(b)
        typeDecl %x
          decl %x
        literal literal(2)
      const %x @elif
        attribute @elif(c)
        typeDecl %x
          decl %x
        literal literal(3)
      const %x @else
        attribute @else
        typeDecl %x
          decl %x
        literal literal(4)"
  `);
});

test("parse @elif on import", () => {
  const ast = parseTest(
    "@if(false) import a::val;\n@elif(true) import b::val;",
  );
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      import a::val; @if
      import b::val; @elif"
  `);
});
