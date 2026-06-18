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
        block
          text '{}'"
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
      text '
        '
      directive enable f16 @if
      text '
      '"
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
      text '
        '
      assert
        attribute @if(false)
        text ' const_assert '
        literal literal(true)
        text ';'
      text '
      '"
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
      text '
        '
      gvar %x @if
        attribute @if(true)
        text ' var '
        typeDecl %x
          decl %x
        text ' = '
        literal literal(7)
        text ';'
      text '
      '"
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
      text '
        '
      fn main()
        decl %main
        block
          text '{
          '
          var %x
            text 'var '
            typeDecl %x
              decl %x
            text ' = '
            literal literal(1)
            text ';'
          text '
          '
          assign @if
            attribute @if(true)
            text ' '
            ref x
            text ' = '
            literal literal(2)
            text ' ;'
          text '
        }'
      text '
      '"
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
      text '
        '
      fn main()
        decl %main
        block
          text '{
          '
          block @if
            attribute @if(false)
            text ' {
            '
            let %x
              text 'let '
              typeDecl %x
                decl %x
              text ' = '
              literal literal(1)
              text ';'
            text '
          }'
          text '
        }'
      text '
      '"
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
      text '
        '
      fn main()
        decl %main
        block
          text '{
          '
          var %x @if
            attribute @if(true)
            text ' var '
            typeDecl %x
              decl %x
            text ' = '
            literal literal(1)
            text ';'
          text '
        }'
      text '
      '"
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
      text '
        '
      const %x @if
        attribute @if(MOBILE)
        text ' const '
        typeDecl %x
          decl %x
        text ' = '
        literal literal(1)
        text ';'
      text '
      '"
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
      text '
        '
      const %x @if
        attribute @if(false)
        text ' const '
        typeDecl %x
          decl %x
        text ' = '
        literal literal(1)
        text ';'
      text '
        '
      const %x @else
        attribute @else
        text ' const '
        typeDecl %x
          decl %x
        text ' = '
        literal literal(2)
        text ';'
      text '
      '"
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
      text '
        '
      fn foo() @if
        attribute @if(DEBUG)
        decl %foo
        block
          text '{'
          return
            text ' return '
            literal literal(1)
            text ';'
          text ' }'
      text '
        '
      fn foo() @else
        attribute @else
        decl %foo
        block
          text '{'
          return
            text ' return '
            literal literal(2)
            text ';'
          text ' }'
      text '
      '"
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
      text '
        '
      fn main()
        decl %main
        block
          text '{
          '
          let %x @if
            attribute @if(A)
            text ' let '
            typeDecl %x
              decl %x
            text ' = '
            literal literal(1.0)
            text ';'
          text '
          '
          let %x @else
            attribute @else
            text ' let '
            typeDecl %x
              decl %x
            text ' = '
            literal literal(2.0)
            text ';'
          text '
        }'
      text '
      '"
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
      text '
        '
      fn test()
        decl %test
        block
          text '{
          '
          block @if
            attribute @if(MOBILE)
            text ' { '
            let %a
              text 'let '
              typeDecl %a
                decl %a
              text ' = '
              literal literal(1)
              text ';'
            text ' }'
          text '
          '
          block @else
            attribute @else
            text ' { '
            let %a
              text 'let '
              typeDecl %a
                decl %a
              text ' = '
              literal literal(2)
              text ';'
            text ' }'
          text '
        }'
      text '
      '"
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
      text '
        '
      struct Point
        text 'struct '
        decl %Point
        text ' {
          '
        member @if x: f32
          attribute @if(DIMENSIONS_2)
          text ' '
          name x
          text ': '
          type f32
            ref f32
        text ',
          '
        member @else x: vec3<ref f32>
          attribute @else
          text ' '
          name x
          text ': '
          type vec3<ref f32>
            ref vec3
            text '<'
            ref f32
            text '>'
        text ',
        }'
      text '
      '"
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
      text '
        '
      import package::debug; @if
      text '
      '"
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
      text '
        '
      import package::a; @if
      text '
        '
      import package::b; @else
      text '
      '"
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
      text '
        '
      fn testFn() @if
        attribute @if(FOO)
        decl %testFn
        block
          text '{ '
          let %a
            text 'let '
            typeDecl %a
              decl %a
            text ' = '
            literal literal(0)
            text ';'
          text ' }'
      text '
        '
      fn testFn() @else
        attribute @else
        decl %testFn
        block
          text '{ '
          let %a
            text 'let '
            typeDecl %a
              decl %a
            text ' = '
            literal literal(1)
            text ';'
          text ' }'
      text '
      '"
  `,
  );
});
