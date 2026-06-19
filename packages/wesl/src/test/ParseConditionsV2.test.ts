import { expect, test } from "vitest";
import { astToString } from "../debug/ASTtoString.ts";
import { parseTest } from "./TestUtil.ts";

test("parse complex condition", () => {
  const ast = parseTest("@if(true || (!foo&&!!false) )\nfn a() {}");
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn a() @if
        attribute @if(true || (!foo && !!false))
        decl %a
        block"
  `);
});

test("@if(false) enable f16", () => {
  const src = `
    @if(false) enable f16;
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      directive enable f16 @if"
  `);
});

test("@if(false) const_assert true;", () => {
  const src = `
    @if(false) const_assert true;
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      assert
        attribute @if(false)
        literal literal(true)"
  `);
});

test("@if(true) var x = 7", () => {
  const src = `
    @if(true) var x = 7;
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      gvar %x @if
        attribute @if(true)
        typeDecl %x
          decl %x
        literal literal(7)"
  `);
});

test("conditional statement", () => {
  const src = `
    fn main() {
      var x = 1;
      @if(true) x = 2 ;
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main()
        decl %main
        block
          var %x
            typeDecl %x
              decl %x
            literal literal(1)
          assign @if
            attribute @if(true)
            ref x
            literal literal(2)"
  `);
});

test("compound statement", () => {
  const src = `
    fn main() {
      @if(false) {
        let x = 1;
      }
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main()
        decl %main
        block
          block @if
            attribute @if(false)
            let %x
              typeDecl %x
                decl %x
              literal literal(1)"
  `);
});

test("conditional local var", () => {
  const src = `
    fn main() {
      @if(true) var x = 1;
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main()
        decl %main
        block
          var %x @if
            attribute @if(true)
            typeDecl %x
              decl %x
            literal literal(1)"
  `);
});

test("@if(MOBILE) const x = 1", () => {
  const src = `
    @if(MOBILE) const x = 1;
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      const %x @if
        attribute @if(MOBILE)
        typeDecl %x
          decl %x
        literal literal(1)"
  `);
});

test("@else after @if", () => {
  const src = `
    @if(false) const x = 1;
    @else const x = 2;
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      const %x @if
        attribute @if(false)
        typeDecl %x
          decl %x
        literal literal(1)
      const %x @else
        attribute @else
        typeDecl %x
          decl %x
        literal literal(2)"
  `);
});

test("@else with function", () => {
  const src = `
    @if(DEBUG) fn foo() { return 1; }
    @else fn foo() { return 2; }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn foo() @if
        attribute @if(DEBUG)
        decl %foo
        block
          return
            literal literal(1)
      fn foo() @else
        attribute @else
        decl %foo
        block
          return
            literal literal(2)"
  `);
});

test("@else with statement", () => {
  const src = `
    fn main() {
      @if(A) let x = 1.0;
      @else let x = 2.0;
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main()
        decl %main
        block
          let %x @if
            attribute @if(A)
            typeDecl %x
              decl %x
            literal literal(1.0)
          let %x @else
            attribute @else
            typeDecl %x
              decl %x
            literal literal(2.0)"
  `);
});

test("@else compound statement", () => {
  const src = `
    fn test() {
      @if(MOBILE) { let a = 1; }
      @else { let a = 2; }
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn test()
        decl %test
        block
          block @if
            attribute @if(MOBILE)
            let %a
              typeDecl %a
                decl %a
              literal literal(1)
          block @else
            attribute @else
            let %a
              typeDecl %a
                decl %a
              literal literal(2)"
  `);
});

test("@else with struct member", () => {
  const src = `
    struct Point {
      @if(DIMENSIONS_2) x: f32,
      @else x: vec3<f32>,
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      struct Point
        decl %Point
        member @if x: f32
          attribute @if(DIMENSIONS_2)
          name x
          type f32
            ref f32
        member @else x: vec3<ref f32>
          attribute @else
          name x
          type vec3<ref f32>
            ref vec3
            ref f32"
  `);
});

test("@if with import", () => {
  const src = `
    @if(DEBUG) import package::debug;
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  // Expected output once grammar supports @if on imports:
  expect(astString).toMatchInlineSnapshot(`
    "module
      import package::debug; @if"
  `);
});

test("@else with import", () => {
  const src = `
    @if(false) import package::a;
    @else import package::b;
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  // Expected output once grammar supports @if/@else on imports:
  expect(astString).toMatchInlineSnapshot(`
    "module
      import package::a; @if
      import package::b; @else"
  `);
});

test("parse @else fn", () => {
  const src = `
    @if(FOO)
    fn testFn() { let a = 0; }
    @else
    fn testFn() { let a = 1; }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(
    `
    "module
      fn testFn() @if
        attribute @if(FOO)
        decl %testFn
        block
          let %a
            typeDecl %a
              decl %a
            literal literal(0)
      fn testFn() @else
        attribute @else
        decl %testFn
        block
          let %a
            typeDecl %a
              decl %a
            literal literal(1)"
  `,
  );
});
