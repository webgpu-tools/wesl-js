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
        text ' const '
        typeDecl %a
          decl %a
        text ' = '
        literal literal(1)
        text ';'
      text '
    '
      const %a @elif
        attribute @elif(true)
        text ' const '
        typeDecl %a
          decl %a
        text ' = '
        literal literal(2)
        text ';'
      text '
    '
      const %a @else
        attribute @else
        text ' const '
        typeDecl %a
          decl %a
        text ' = '
        literal literal(3)
        text ';'"
  `);
});

test("parse @elif with complex condition", () => {
  const ast = parseTest("@if(foo) fn f() {}\n@elif(bar && !baz) fn f() {}");
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn f() @if
        attribute @if(foo)
        decl %f
        statement
          text '{}'
      text '
    '
      fn f() @elif
        attribute @elif(bar && !baz)
        decl %f
        statement
          text '{}'"
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
        text ' const '
        typeDecl %x
          decl %x
        text ' = '
        literal literal(1)
        text ';'
      text '
    '
      const %x @elif
        attribute @elif(b)
        text ' const '
        typeDecl %x
          decl %x
        text ' = '
        literal literal(2)
        text ';'
      text '
    '
      const %x @elif
        attribute @elif(c)
        text ' const '
        typeDecl %x
          decl %x
        text ' = '
        literal literal(3)
        text ';'
      text '
    '
      const %x @else
        attribute @else
        text ' const '
        typeDecl %x
          decl %x
        text ' = '
        literal literal(4)
        text ';'"
  `);
});

test("parse @elif on import", () => {
  const ast = parseTest(
    "@if(false) import a::val;\n@elif(true) import b::val;",
  );
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      import a::val; @if
      text '
    '
      import b::val; @elif"
  `);
});
