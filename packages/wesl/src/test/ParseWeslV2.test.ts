import { expect, test } from "vitest";
import { astToString } from "../debug/ASTtoString.ts";
import { importToString } from "../debug/ImportToString.ts";
import { parseTest, parseTestRaw } from "./TestUtil.ts";

test("parse empty string", () => {
  const ast = parseTest("");
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`"module"`);
});

test("parse fn foo() { }", () => {
  const src = "fn foo() { }";
  const ast = parseTest(src);
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn foo()
        decl %foo
        block
          text '{ }'"
  `);
});

test("parse fn with calls", () => {
  const src = "fn foo() { foo(); bar(); }";
  const ast = parseTest(src);
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn foo()
        decl %foo
        block
          text '{'
          call
            text ' '
            call-expression call
            text ';'
          call
            text ' '
            call-expression call
            text ';'
          text ' }'"
  `);
});

test("parse unicode ident", () => {
  // List taken straight from the examples at https://www.w3.org/TR/WGSL/#identifiers
  const src = `
  fn Δέλτα(){} 
  fn réflexion(){} 
  fn Кызыл(){} 
  fn 𐰓𐰏𐰇(){} 
  fn 朝焼け(){}
  fn سلام(){} 
  fn 검정(){} 
  fn שָׁלוֹם(){}
  fn गुलाबी(){}
  fn փիրուզ(){}
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchSnapshot();
});

test("parse global var", () => {
  const src = `var x: i32 = 1;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      gvar %x : i32
        text 'var '
        typeDecl %x : i32
          decl %x
          text ': '
          type i32
            ref i32
        text ' = '
        literal literal(1)
        text ';'"
  `);
});

test("parse alias", () => {
  const src = `alias Num = i32;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      alias %Num=i32
        text 'alias '
        decl %Num
        text ' = '
        type i32
          ref i32
        text ';'"
  `);
});

test("parse const", () => {
  const src = `const y = 11u;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      const %y
        text 'const '
        typeDecl %y
          decl %y
        text ' = '
        literal literal(11u)
        text ';'"
  `);
});

test("parse override ", () => {
  const src = `override z: f32;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      override %z : f32
        text 'override '
        typeDecl %z : f32
          decl %z
          text ': '
          type f32
            ref f32
        text ';'"
  `);
});

test("parse const_assert", () => {
  const src = `const_assert x < y;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      assert
        text 'const_assert '
        binary-expression binop(<)
        text ';'"
  `);
});

test("parse struct", () => {
  const src = `struct foo { bar: i32, zip: u32, } ;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      struct foo
        text 'struct '
        decl %foo
        text ' { '
        member bar: i32
          name bar
          text ': '
          type i32
            ref i32
        text ', '
        member zip: u32
          name zip
          text ': '
          type u32
            ref u32
        text ', }'
      text ' ;'"
  `);
});

test("parse global diagnostic", () => {
  const src = `
    diagnostic(off,derivative_uniformity);

    fn main() {}
    `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      directive diagnostic(off, derivative_uniformity)
      text '

        '
      fn main()
        decl %main
        block
          text '{}'
      text '
        '"
  `);
});

test("parse @attribute before fn", () => {
  const src = `@compute fn main() {} `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main() @compute
        attribute @compute
        decl %main
        block
          text '{}'
      text ' '"
  `);
});

test("parse @compute @workgroup_size(a, b, 1) before fn", () => {
  const src = `
    @compute 
    @workgroup_size(a, b, 1) 
    fn main() {}
    `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      fn main() @compute @workgroup_size
        attribute @compute
        attribute @workgroup_size(ref a, ' ' ref b, ' ' literal literal(1))
        decl %main
        block
          text '{}'
      text '
        '"
  `);
});

test("parse top level var", () => {
  const src = `
    @group(0) @binding(0) var<uniform> u: Uniforms;      

    fn main() {}
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      gvar %u : Uniforms @group @binding
        attribute @group(literal literal(0))
        text ' '
        attribute @binding(literal literal(0))
        text ' var<uniform> '
        typeDecl %u : Uniforms
          decl %u
          text ': '
          type Uniforms
            ref Uniforms
        text ';'
      text '      

        '
      fn main()
        decl %main
        block
          text '{}'
      text '
      '"
  `);
});

test("parse top level override and const", () => {
  const src = `
    override x = 21;
    const y = 1;

    fn main() {}
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      override %x
        text 'override '
        typeDecl %x
          decl %x
        text ' = '
        literal literal(21)
        text ';'
      text '
        '
      const %y
        text 'const '
        typeDecl %y
          decl %y
        text ' = '
        literal literal(1)
        text ';'
      text '

        '
      fn main()
        decl %main
        block
          text '{}'
      text '
      '"
  `);
});

test("parse root level ;;", () => {
  const src = ";;";
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text ';;'"
  `);
});

test("parse simple alias", () => {
  const src = `alias NewType = OldType;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      alias %NewType=OldType
        text 'alias '
        decl %NewType
        text ' = '
        type OldType
          ref OldType
        text ';'"
  `);
});

test("parse array alias", () => {
  const src = `
    alias Points3 = array<Point, 3>;
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      alias %Points3=array<ref Point, literal literal(3)>
        text 'alias '
        decl %Points3
        text ' = '
        type array<ref Point, literal literal(3)>
          ref array
          text '<'
          ref Point
          text ', '
          literal literal(3)
          text '>'
        text ';'
      text '
      '"
  `);
});

test("fnDecl parses fn with return type", () => {
  const src = `fn foo() -> MyType { }`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn foo() -> MyType
        decl %foo
        type MyType
          ref MyType
        block
          text '{ }'"
  `);
});

test("fnDecl parses :type specifier in fn args", () => {
  const src = `
    fn foo(a: MyType) { }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      fn foo(a: MyType)
        decl %foo
        param
          typeDecl %a : MyType
            decl %a
            text ': '
            type MyType
              ref MyType
        block
          text '{ }'
      text '
      '"
  `);
});

test("fnDecl parses :type specifier in fn block", () => {
  const src = `
    fn foo() { 
      var b:MyType;
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      fn foo()
        decl %foo
        block
          text '{ 
          '
          var %b : MyType
            text 'var '
            typeDecl %b : MyType
              decl %b
              text ':'
              type MyType
                ref MyType
            text ';'
          text '
        }'
      text '
      '"
  `);
});

test("parse type in <template> in fn args", () => {
  const src = `
    fn foo(a: vec2<MyStruct>) { };`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      fn foo(a: vec2<ref MyStruct>)
        decl %foo
        param
          typeDecl %a : vec2<ref MyStruct>
            decl %a
            text ': '
            type vec2<ref MyStruct>
              ref vec2
              text '<'
              ref MyStruct
              text '>'
        block
          text '{ }'
      text ';'"
  `);
});

test("parse simple templated type", () => {
  const src = `fn main(a: array<MyStruct,4>) { }`;

  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main(a: array<ref MyStruct, literal literal(4)>)
        decl %main
        param
          typeDecl %a : array<ref MyStruct, literal literal(4)>
            decl %a
            text ': '
            type array<ref MyStruct, literal literal(4)>
              ref array
              text '<'
              ref MyStruct
              text ','
              literal literal(4)
              text '>'
        block
          text '{ }'"
  `);
});

test("parse with space before template", () => {
  const src = `fn main(a: array <MyStruct,4>) { }`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main(a: array<ref MyStruct, literal literal(4)>)
        decl %main
        param
          typeDecl %a : array<ref MyStruct, literal literal(4)>
            decl %a
            text ': '
            type array<ref MyStruct, literal literal(4)>
              ref array
              text ' <'
              ref MyStruct
              text ','
              literal literal(4)
              text '>'
        block
          text '{ }'"
  `);
});

test("parse nested template that ends with >> ", () => {
  const src = `fn main(a: vec2<array <MyStruct,4>>) { }`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main(a: vec2<array<ref MyStruct, literal literal(4)>>)
        decl %main
        param
          typeDecl %a : vec2<array<ref MyStruct, literal literal(4)>>
            decl %a
            text ': '
            type vec2<array<ref MyStruct, literal literal(4)>>
              ref vec2
              text '<'
              type array<ref MyStruct, literal literal(4)>
              text '>'
        block
          text '{ }'"
  `);
});

test("parse type in <template> in global var", () => {
  const src = `var<private> x:array<MyStruct, 8>;`;

  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      gvar %x : array<ref MyStruct, literal literal(8)>
        text 'var<private> '
        typeDecl %x : array<ref MyStruct, literal literal(8)>
          decl %x
          text ':'
          type array<ref MyStruct, literal literal(8)>
            ref array
            text '<'
            ref MyStruct
            text ', '
            literal literal(8)
            text '>'
        text ';'"
  `);
});

test("parse for(;;) {} not as a fn call", () => {
  const src = `
    fn main() {
      for (var a = 1; a < 10; a++) {}
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
          text '{'
          for
            text '
          for ('
            var %a
              text 'var '
              typeDecl %a
                decl %a
              text ' = '
              literal literal(1)
              text ';'
            text ' '
            binary-expression binop(<)
            text '; '
            ref a
            text '++) '
            block
              text '{}'
          text '
        }'
      text '
      '"
  `);
});

test("eolf followed by blank line", () => {
  const src = `
    fn foo() { }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      fn foo()
        decl %foo
        block
          text '{ }'
      text '
      '"
  `);
});

test("parse fn with attributes and suffix comma", () => {
  const src = `
  @compute
  @workgroup_size(workgroupThreads, 1, 1) 
  fn main(
      @builtin(global_invocation_id) grid: vec3<u32>,
      @builtin(local_invocation_index) localIndex: u32,  
  ) { }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
      '
      fn main(grid: vec3<ref u32>, localIndex: u32) @compute @workgroup_size
        attribute @compute
        attribute @workgroup_size(ref workgroupThreads, ' ' literal literal(1), ' ' literal literal(1))
        decl %main
        param
          attribute @builtin(global_invocation_id)
          text ' '
          typeDecl %grid : vec3<ref u32>
            decl %grid
            text ': '
            type vec3<ref u32>
              ref vec3
              text '<'
              ref u32
              text '>'
        param
          attribute @builtin(local_invocation_index)
          text ' '
          typeDecl %localIndex : u32
            decl %localIndex
            text ': '
            type u32
              ref u32
        block
          text '{ }'
      text '
      '"
  `);
});

test("parse fn", () => {
  const src = `fn foo(x: i32, y: u32) -> f32 { return 1.0; }`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn foo(x: i32, y: u32) -> f32
        decl %foo
        param
          typeDecl %x : i32
            decl %x
            text ': '
            type i32
              ref i32
        param
          typeDecl %y : u32
            decl %y
            text ': '
            type u32
              ref u32
        type f32
          ref f32
        block
          text '{'
          return
            text ' return '
            literal literal(1.0)
            text ';'
          text ' }'"
  `);
});

test("parse @attribute before fn", () => {
  const src = `@compute fn main() {} `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main() @compute
        attribute @compute
        decl %main
        block
          text '{}'
      text ' '"
  `);
});

test("import package::foo::bar;", ctx => {
  const src = ctx.task.name;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      import package::foo::bar;"
  `);
});

test("parse foo::bar(); ", () => {
  const src = "fn main() { foo::bar(); }";
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main()
        decl %main
        block
          text '{'
          call
            text ' '
            call-expression call
            text ';'
          text ' }'"
  `);
});

test("parse let x: foo::bar; ", () => {
  const src = "fn main() { let x: foo::bar = 1; }";
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main()
        decl %main
        block
          text '{ '
          let %x : foo::bar
            text 'let '
            typeDecl %x : foo::bar
              decl %x
              text ': '
              type foo::bar
                ref foo::bar
            text ' = '
            literal literal(1)
            text ';'
          text ' }'"
  `);
});

test("parse var x: foo::bar;", () => {
  const src = `
     var<private> x: foo::bar;
     fn main() { }
  `;

  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
         '
      gvar %x : foo::bar
        text 'var<private> '
        typeDecl %x : foo::bar
          decl %x
          text ': '
          type foo::bar
            ref foo::bar
        text ';'
      text '
         '
      fn main()
        decl %main
        block
          text '{ }'
      text '
      '"
  `);
});

test("parse switch statement", () => {
  const src = `
    fn main(x: i32) {
      switch (x) {
        case 1: { break; }
        default: { break; }
      }
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      fn main(x: i32)
        decl %main
        param
          typeDecl %x : i32
            decl %x
            text ': '
            type i32
              ref i32
        block
          text '{'
          switch
            text '
          switch '
            parenthesized-expression parens
            text ' {'
            switch-clause
              text '
            case '
              literal literal(1)
              text ': '
              block
                text '{'
                break
                  text ' break;'
                text ' }'
            switch-clause
              text '
            default: '
              block
                text '{'
                break
                  text ' break;'
                text ' }'
            text '
          }'
          text '
        }'
      text '
      '"
  `);
});

test("parse switch statement-2", () => {
  const src = `

    fn main(x: u32) {
      switch ( code ) {
        case 5u: { if 1 > 0 { } }
        default: { break; }
      }
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '

        '
      fn main(x: u32)
        decl %main
        param
          typeDecl %x : u32
            decl %x
            text ': '
            type u32
              ref u32
        block
          text '{'
          switch
            text '
          switch '
            parenthesized-expression parens
            text ' {'
            switch-clause
              text '
            case '
              literal literal(5u)
              text ': '
              block
                text '{'
                if
                  text ' if '
                  binary-expression binop(>)
                  text ' '
                  block
                    text '{ }'
                text ' }'
            switch-clause
              text '
            default: '
              block
                text '{'
                break
                  text ' break;'
                text ' }'
            text '
          }'
          text '
        }'
      text '
      '"
  `);
});

test("parse struct constructor in assignment", () => {
  const src = `
    fn main() {
      var x = AStruct(1u);
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
            call-expression call
            text ';'
          text '
        }'
      text '
       '"
  `);
});

test("parse struct.member (component_or_swizzle)", () => {
  const src = `
    fn main() {
        let x = u.frame;
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
          let %x
            text 'let '
            typeDecl %x
              decl %x
            text ' = '
            component-member-expression .
            text ';'
          text '
        }'
      text '
      '"
  `);
});

test("var<workgroup> work: array<u32, 128>;", ctx => {
  const ast = parseTest(ctx.task.name);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      gvar %work : array<ref u32, literal literal(128)>
        text 'var<workgroup> '
        typeDecl %work : array<ref u32, literal literal(128)>
          decl %work
          text ': '
          type array<ref u32, literal literal(128)>
            ref array
            text '<'
            ref u32
            text ', '
            literal literal(128)
            text '>'
        text ';'"
  `);
});

test("fn f() { _ = 1; }", ctx => {
  const ast = parseTest(ctx.task.name);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn f()
        decl %f
        block
          text '{'
          assign
            text ' _ = '
            literal literal(1)
            text ';'
          text ' }'"
  `);
});

test("var foo: vec2<f32 >= vec2( 0.5, -0.5);", ctx => {
  const ast = parseTest(ctx.task.name);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      gvar %foo : vec2<ref f32>
        text 'var '
        typeDecl %foo : vec2<ref f32>
          decl %foo
          text ': '
          type vec2<ref f32>
            ref vec2
            text '<'
            ref f32
            text ' >'
        text '= '
        call-expression call
        text ';'"
  `);
});

test("fn main() { var tmp: array<i32, 1 << 1>=array(1, 2); }", ctx => {
  const ast = parseTest(ctx.task.name);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn main()
        decl %main
        block
          text '{ '
          var %tmp : array<ref i32, binary-expression binop(<<)>
            text 'var '
            typeDecl %tmp : array<ref i32, binary-expression binop(<<)>
              decl %tmp
              text ': '
              type array<ref i32, binary-expression binop(<<)>
                ref array
                text '<'
                ref i32
                text ', '
                binary-expression binop(<<)
                text '>'
            text '='
            call-expression call
            text ';'
          text ' }'"
  `);
});

test("import a::b::c;", ctx => {
  const ast = parseTest(ctx.task.name);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      import a::b::c;"
  `);
});

test("import package::file1::{foo, bar};", ctx => {
  const src = ctx.task.name;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      import package::file1::{foo, bar};"
  `);
});

test("import package::file1::{foo, bar};", ctx => {
  const src = ctx.task.name;
  const ast = parseTest(src);
  const imps = ast.imports.map(t => importToString(t)).join("\n");

  expect(imps).toMatchInlineSnapshot(`"package::file1::{foo, bar};"`);
});

test("import foo_bar::boo;", ctx => {
  const ast = parseTest(ctx.task.name);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      import foo_bar::boo;"
  `);
});

test(`import a::{ b };`, ctx => {
  const ast = parseTest(ctx.task.name);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      import a::{b};"
  `);
});

test(`import a::{ b, c::{d, e}, f };`, ctx => {
  const src = ctx.task.name;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);

  expect(astString).toMatchInlineSnapshot(`
    "module
      import a::{b, c::{d, e}, f};"
  `);
});

test(`parse ptr`, () => {
  const src = `
    var particles: ptr<storage, f32, read_write>;
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      gvar %particles : ptr<ref storage, ref f32, ref read_write>
        text 'var '
        typeDecl %particles : ptr<ref storage, ref f32, ref read_write>
          decl %particles
          text ': '
          type ptr<ref storage, ref f32, ref read_write>
            ref ptr
            text '<'
            ref storage
            text ', '
            ref f32
            text ', '
            ref read_write
            text '>'
        text ';'
      text '
      '"
  `);
});

test(`parse ptr with internal array`, () => {
  const src = `
    var particles: ptr<storage, array<f32>, read_write>;
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      gvar %particles : ptr<ref storage, array<ref f32>, ref read_write>
        text 'var '
        typeDecl %particles : ptr<ref storage, array<ref f32>, ref read_write>
          decl %particles
          text ': '
          type ptr<ref storage, array<ref f32>, ref read_write>
            ref ptr
            text '<'
            ref storage
            text ', '
            type array<ref f32>
            text ', '
            ref read_write
            text '>'
        text ';'
      text '
      '"
  `);
});

test(`parse binding struct`, () => {
  const src = `
    struct Bindings {
      @group(0) @binding(0) particles: ptr<storage, array<f32>, read_write>, 
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      struct Bindings
        text 'struct '
        decl %Bindings
        text ' {
          '
        member @group @binding particles: ptr<ref storage, array<ref f32>, ref read_write>
          attribute @group(literal literal(0))
          text ' '
          attribute @binding(literal literal(0))
          text ' '
          name particles
          text ': '
          type ptr<ref storage, array<ref f32>, ref read_write>
            ref ptr
            text '<'
            ref storage
            text ', '
            type array<ref f32>
            text ', '
            ref read_write
            text '>'
        text ', 
        }'
      text '
      '"
  `);
});

test(`parse struct reference`, () => {
  const src = `
    fn f() { let x = a.b[0]; };
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      fn f()
        decl %f
        block
          text '{ '
          let %x
            text 'let '
            typeDecl %x
              decl %x
            text ' = '
            component-expression []
            text ';'
          text ' }'
      text ';
      '"
  `);
});

test("member reference with extra components", () => {
  const src = `
  fn foo() {
    output[ out + 0u ] = c.p0.t0.x;
  }
 `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
      '
      fn foo()
        decl %foo
        block
          text '{'
          assign
            text '
        '
            component-expression []
            text ' = '
            component-member-expression .
            text ';'
          text '
      }'
      text '
     '"
  `);
});

test("parse let declaration", () => {
  const src = `
    fn vertexMain() {
      let char = array<u32, 2>(0, 0);
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      fn vertexMain()
        decl %vertexMain
        block
          text '{
          '
          let %char
            text 'let '
            typeDecl %char
              decl %char
            text ' = '
            call-expression call
            text ';'
          text '
        }'
      text '
      '"
  `);
});

test("parse let declaration with type", () => {
  const src = `
    fn vertexMain() {
      let char : u32 = 0;
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      fn vertexMain()
        decl %vertexMain
        block
          text '{
          '
          let %char : u32
            text 'let '
            typeDecl %char : u32
              decl %char
              text ' : '
              type u32
                ref u32
            text ' = '
            literal literal(0)
            text ';'
          text '
        }'
      text '
      '"
  `);
});

test("separator in let assignment", () => {
  const src = `
    fn vertexMain() {
      let a = b::c;
    }
  `;
  const ast = parseTestRaw(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      fn vertexMain()
        decl %vertexMain
        block
          text '{
          '
          let %a
            text 'let '
            typeDecl %a
              decl %a
            text ' = '
            ref b::c
            text ';'
          text '
        }'
      text '
      '"
  `);
});

test("separator in fn call ", () => {
  const src = `
    fn vertexMain() {
      b::c();
    }
  `;
  const ast = parseTestRaw(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      fn vertexMain()
        decl %vertexMain
        block
          text '{'
          call
            text '
          '
            call-expression call
            text ';'
          text '
        }'
      text '
      '"
  `);
});

test("binding struct", () => {
  const src = `
    struct Bindings {
      @group(0) @binding(0) particles: ptr<storage, array<f32>, read_write>, 
      @group(0) @binding(1) uniforms: ptr<uniform, Uniforms>, 
      @group(0) @binding(2) tex: texture_2d<rgba8unorm>,
      @group(0) @binding(3) samp: sampler,
    }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
        '
      struct Bindings
        text 'struct '
        decl %Bindings
        text ' {
          '
        member @group @binding particles: ptr<ref storage, array<ref f32>, ref read_write>
          attribute @group(literal literal(0))
          text ' '
          attribute @binding(literal literal(0))
          text ' '
          name particles
          text ': '
          type ptr<ref storage, array<ref f32>, ref read_write>
            ref ptr
            text '<'
            ref storage
            text ', '
            type array<ref f32>
            text ', '
            ref read_write
            text '>'
        text ', 
          '
        member @group @binding uniforms: ptr<ref uniform, ref Uniforms>
          attribute @group(literal literal(0))
          text ' '
          attribute @binding(literal literal(1))
          text ' '
          name uniforms
          text ': '
          type ptr<ref uniform, ref Uniforms>
            ref ptr
            text '<'
            ref uniform
            text ', '
            ref Uniforms
            text '>'
        text ', 
          '
        member @group @binding tex: texture_2d<ref rgba8unorm>
          attribute @group(literal literal(0))
          text ' '
          attribute @binding(literal literal(2))
          text ' '
          name tex
          text ': '
          type texture_2d<ref rgba8unorm>
            ref texture_2d
            text '<'
            ref rgba8unorm
            text '>'
        text ',
          '
        member @group @binding samp: sampler
          attribute @group(literal literal(0))
          text ' '
          attribute @binding(literal literal(3))
          text ' '
          name samp
          text ': '
          type sampler
            ref sampler
        text ',
        }'
      text '
      '"
  `);
});

test("memberRefs with extra components", () => {
  const src = `
    fn main() {
      b.particles[0] = b.uniforms.foo;
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
          text '{'
          assign
            text '
          '
            component-expression []
            text ' = '
            component-member-expression .
            text ';'
          text '
        }'
      text '
      '"
  `);
});

test("memberRef with ref in array", () => {
  const src = `
    fn main() {
      vsOut.barycenticCoord[vertNdx] = 1.0;
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
          text '{'
          assign
            text '
          '
            component-expression []
            text ' = '
            literal literal(1.0)
            text ';'
          text '
        }'
      text '
      '"
  `);
});

test("parse inline package reference", () => {
  const src = `
    fn main() {
      package::foo::bar();
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
          text '{'
          call
            text '
          '
            call-expression call
            text ';'
          text '
        }'
      text '
      '"
  `);
});

test("parse @location", () => {
  const src = `
      @fragment
      fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f { 
        return pos;
      }
  `;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      text '
          '
      fn fragmentMain(pos: vec4f) @fragment -> vec4f
        attribute @fragment
        decl %fragmentMain
        param
          attribute @builtin(position)
          text ' '
          typeDecl %pos : vec4f
            decl %pos
            text ': '
            type vec4f
              ref vec4f
        type vec4f
          ref vec4f
        block
          text '{'
          return
            text ' 
            return '
            ref pos
            text ';'
          text '
          }'
      text '
      '"
  `);
});
