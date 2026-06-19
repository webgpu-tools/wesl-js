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
        block"
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
          call
            call-expression call
          call
            call-expression call"
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
        typeDecl %x : i32
          decl %x
          type i32
            ref i32
        literal literal(1)"
  `);
});

test("parse alias", () => {
  const src = `alias Num = i32;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      alias %Num=i32
        decl %Num
        type i32
          ref i32"
  `);
});

test("parse const", () => {
  const src = `const y = 11u;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      const %y
        typeDecl %y
          decl %y
        literal literal(11u)"
  `);
});

test("parse override ", () => {
  const src = `override z: f32;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      override %z : f32
        typeDecl %z : f32
          decl %z
          type f32
            ref f32"
  `);
});

test("parse const_assert", () => {
  const src = `const_assert x < y;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      assert
        binary-expression binop(<)"
  `);
});

test("parse struct", () => {
  const src = `struct foo { bar: i32, zip: u32, } ;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      struct foo
        decl %foo
        member bar: i32
          name bar
          type i32
            ref i32
        member zip: u32
          name zip
          type u32
            ref u32"
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
      directive diagnostic(off, derivative_uniformity)
      fn main()
        decl %main
        block"
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
        block"
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
      fn main() @compute @workgroup_size
        attribute @compute
        attribute @workgroup_size(ref a, ref b, literal literal(1))
        decl %main
        block"
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
      gvar %u : Uniforms @group @binding
        attribute @group(literal literal(0))
        attribute @binding(literal literal(0))
        name uniform
        typeDecl %u : Uniforms
          decl %u
          type Uniforms
            ref Uniforms
      fn main()
        decl %main
        block"
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
      override %x
        typeDecl %x
          decl %x
        literal literal(21)
      const %y
        typeDecl %y
          decl %y
        literal literal(1)
      fn main()
        decl %main
        block"
  `);
});

test("parse root level ;;", () => {
  const src = ";;";
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`"module"`);
});

test("parse simple alias", () => {
  const src = `alias NewType = OldType;`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      alias %NewType=OldType
        decl %NewType
        type OldType
          ref OldType"
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
      alias %Points3=array<ref Point, literal literal(3)>
        decl %Points3
        type array<ref Point, literal literal(3)>
          ref array
          ref Point
          literal literal(3)"
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
        block"
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
      fn foo(a: MyType)
        decl %foo
        param
          typeDecl %a : MyType
            decl %a
            type MyType
              ref MyType
        block"
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
      fn foo()
        decl %foo
        block
          var %b : MyType
            typeDecl %b : MyType
              decl %b
              type MyType
                ref MyType"
  `);
});

test("parse type in <template> in fn args", () => {
  const src = `
    fn foo(a: vec2<MyStruct>) { };`;
  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      fn foo(a: vec2<ref MyStruct>)
        decl %foo
        param
          typeDecl %a : vec2<ref MyStruct>
            decl %a
            type vec2<ref MyStruct>
              ref vec2
              ref MyStruct
        block"
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
            type array<ref MyStruct, literal literal(4)>
              ref array
              ref MyStruct
              literal literal(4)
        block"
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
            type array<ref MyStruct, literal literal(4)>
              ref array
              ref MyStruct
              literal literal(4)
        block"
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
            type vec2<array<ref MyStruct, literal literal(4)>>
              ref vec2
              type array<ref MyStruct, literal literal(4)>
                ref array
                ref MyStruct
                literal literal(4)
        block"
  `);
});

test("parse type in <template> in global var", () => {
  const src = `var<private> x:array<MyStruct, 8>;`;

  const ast = parseTest(src);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      gvar %x : array<ref MyStruct, literal literal(8)>
        name private
        typeDecl %x : array<ref MyStruct, literal literal(8)>
          decl %x
          type array<ref MyStruct, literal literal(8)>
            ref array
            ref MyStruct
            literal literal(8)"
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
      fn main()
        decl %main
        block
          for
            var %a
              typeDecl %a
                decl %a
              literal literal(1)
            binary-expression binop(<)
            increment
              ref a
            block"
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
      fn foo()
        decl %foo
        block"
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
      fn main(grid: vec3<ref u32>, localIndex: u32) @compute @workgroup_size
        attribute @compute
        attribute @workgroup_size(ref workgroupThreads, literal literal(1), literal literal(1))
        decl %main
        param
          attribute @builtin(global_invocation_id)
          typeDecl %grid : vec3<ref u32>
            decl %grid
            type vec3<ref u32>
              ref vec3
              ref u32
        param
          attribute @builtin(local_invocation_index)
          typeDecl %localIndex : u32
            decl %localIndex
            type u32
              ref u32
        block"
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
            type i32
              ref i32
        param
          typeDecl %y : u32
            decl %y
            type u32
              ref u32
        type f32
          ref f32
        block
          return
            literal literal(1.0)"
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
        block"
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
          call
            call-expression call"
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
          let %x : foo::bar
            typeDecl %x : foo::bar
              decl %x
              type foo::bar
                ref foo::bar
            literal literal(1)"
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
      gvar %x : foo::bar
        name private
        typeDecl %x : foo::bar
          decl %x
          type foo::bar
            ref foo::bar
      fn main()
        decl %main
        block"
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
      fn main(x: i32)
        decl %main
        param
          typeDecl %x : i32
            decl %x
            type i32
              ref i32
        block
          switch
            parenthesized-expression parens
            switch-clause
              literal literal(1)
              block
                break
            switch-clause
              block
                break"
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
      fn main(x: u32)
        decl %main
        param
          typeDecl %x : u32
            decl %x
            type u32
              ref u32
        block
          switch
            parenthesized-expression parens
            switch-clause
              literal literal(5u)
              block
                if
                  binary-expression binop(>)
                  block
            switch-clause
              block
                break"
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
      fn main()
        decl %main
        block
          var %x
            typeDecl %x
              decl %x
            call-expression call"
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
      fn main()
        decl %main
        block
          let %x
            typeDecl %x
              decl %x
            component-member-expression ."
  `);
});

test("var<workgroup> work: array<u32, 128>;", ctx => {
  const ast = parseTest(ctx.task.name);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      gvar %work : array<ref u32, literal literal(128)>
        name workgroup
        typeDecl %work : array<ref u32, literal literal(128)>
          decl %work
          type array<ref u32, literal literal(128)>
            ref array
            ref u32
            literal literal(128)"
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
          assign
            literal literal(1)"
  `);
});

test("var foo: vec2<f32 >= vec2( 0.5, -0.5);", ctx => {
  const ast = parseTest(ctx.task.name);
  const astString = astToString(ast.moduleElem);
  expect(astString).toMatchInlineSnapshot(`
    "module
      gvar %foo : vec2<ref f32>
        typeDecl %foo : vec2<ref f32>
          decl %foo
          type vec2<ref f32>
            ref vec2
            ref f32
        call-expression call"
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
          var %tmp : array<ref i32, binary-expression binop(<<)>
            typeDecl %tmp : array<ref i32, binary-expression binop(<<)>
              decl %tmp
              type array<ref i32, binary-expression binop(<<)>
                ref array
                ref i32
                binary-expression binop(<<)
            call-expression call"
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
      gvar %particles : ptr<ref storage, ref f32, ref read_write>
        typeDecl %particles : ptr<ref storage, ref f32, ref read_write>
          decl %particles
          type ptr<ref storage, ref f32, ref read_write>
            ref ptr
            ref storage
            ref f32
            ref read_write"
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
      gvar %particles : ptr<ref storage, array<ref f32>, ref read_write>
        typeDecl %particles : ptr<ref storage, array<ref f32>, ref read_write>
          decl %particles
          type ptr<ref storage, array<ref f32>, ref read_write>
            ref ptr
            ref storage
            type array<ref f32>
              ref array
              ref f32
            ref read_write"
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
      struct Bindings
        decl %Bindings
        member @group @binding particles: ptr<ref storage, array<ref f32>, ref read_write>
          attribute @group(literal literal(0))
          attribute @binding(literal literal(0))
          name particles
          type ptr<ref storage, array<ref f32>, ref read_write>
            ref ptr
            ref storage
            type array<ref f32>
              ref array
              ref f32
            ref read_write"
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
      fn f()
        decl %f
        block
          let %x
            typeDecl %x
              decl %x
            component-expression []"
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
      fn foo()
        decl %foo
        block
          assign
            component-expression []
            component-member-expression ."
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
      fn vertexMain()
        decl %vertexMain
        block
          let %char
            typeDecl %char
              decl %char
            call-expression call"
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
      fn vertexMain()
        decl %vertexMain
        block
          let %char : u32
            typeDecl %char : u32
              decl %char
              type u32
                ref u32
            literal literal(0)"
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
      fn vertexMain()
        decl %vertexMain
        block
          let %a
            typeDecl %a
              decl %a
            ref b::c"
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
      fn vertexMain()
        decl %vertexMain
        block
          call
            call-expression call"
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
      struct Bindings
        decl %Bindings
        member @group @binding particles: ptr<ref storage, array<ref f32>, ref read_write>
          attribute @group(literal literal(0))
          attribute @binding(literal literal(0))
          name particles
          type ptr<ref storage, array<ref f32>, ref read_write>
            ref ptr
            ref storage
            type array<ref f32>
              ref array
              ref f32
            ref read_write
        member @group @binding uniforms: ptr<ref uniform, ref Uniforms>
          attribute @group(literal literal(0))
          attribute @binding(literal literal(1))
          name uniforms
          type ptr<ref uniform, ref Uniforms>
            ref ptr
            ref uniform
            ref Uniforms
        member @group @binding tex: texture_2d<ref rgba8unorm>
          attribute @group(literal literal(0))
          attribute @binding(literal literal(2))
          name tex
          type texture_2d<ref rgba8unorm>
            ref texture_2d
            ref rgba8unorm
        member @group @binding samp: sampler
          attribute @group(literal literal(0))
          attribute @binding(literal literal(3))
          name samp
          type sampler
            ref sampler"
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
      fn main()
        decl %main
        block
          assign
            component-expression []
            component-member-expression ."
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
      fn main()
        decl %main
        block
          assign
            component-expression []
            literal literal(1.0)"
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
      fn main()
        decl %main
        block
          call
            call-expression call"
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
      fn fragmentMain(pos: vec4f) @fragment -> vec4f
        attribute @fragment
        decl %fragmentMain
        param
          attribute @builtin(position)
          typeDecl %pos : vec4f
            decl %pos
            type vec4f
              ref vec4f
        type vec4f
          ref vec4f
        block
          return
            ref pos"
  `);
});
