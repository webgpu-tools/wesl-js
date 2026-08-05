/**
 * Parser Scope Tests
 *
 * What matters: scope structure (partial vs regular, nesting, contents)
 * What doesn't matter: exact scope ID numbers
 */

import { expect, test } from "vitest";
import { scopeToString } from "../debug/ScopeToString.ts";
import { findValidRootDecls } from "../RootDeclarations.ts";
import { parseWESL } from "./TestUtil.ts";

test("scope from simple fn", () => {
  const src = `
    fn main() {
      var x: i32 = 1;
    }
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %main 
      { 
        { %x 
          { i32 } #3
        } #2
      } #1
    } #0"
  `);
});

test("two fns", () => {
  const src = `
    fn foo() {}
    fn bar() {}
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %foo 
      { 
        {  } #2
      } #1
      %bar 
      { 
        {  } #4
      } #3
    } #0"
  `);
});

test("two fns, one with a decl", () => {
  const src = `
    fn foo() {
      var a:u32;
    }
    fn bar() {}
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %foo 
      { 
        { %a 
          { u32 } #3
        } #2
      } #1
      %bar 
      { 
        {  } #5
      } #4
    } #0"
  `);
});

test("fn ref", () => {
  const src = `
    fn foo() {
      bar();
    }
    fn bar() {}
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %foo 
      { 
        { bar } #2
      } #1
      %bar 
      { 
        {  } #4
      } #3
    } #0"
  `);
});

test("struct", () => {
  const src = `
    struct A {
      a: B,
    }
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %A 
      { B } #1
    } #0"
  `);
});

test("alias", () => {
  const src = `
    alias A = B;
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %A 
      { B } #1
    } #0"
  `);
});

test("builtin scope", () => {
  const src = `fn main( @builtin(vertex_index) a: u32) { }`;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %main 
      { 
        { %a 
          { u32 } #3
        } #2
      } #1
    } #0"
  `);
});

test("builtin enums", () => {
  const src = `struct read { a: vec2f } var<storage, read_write> storage_buffer: read;`;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %read 
      { vec2f } #1
      -{ %storage_buffer 
        { read } #3
      } #2
    } #0"
  `);
});

test("texture_storage_2d", () => {
  const src = `
    @binding(3) @group(0) var tex_out : texture_storage_2d<rgba8unorm, write>;
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ 
      -{ %tex_out 
        { texture_storage_2d rgba8unorm write } #2
      } #1
    } #0"
  `);
});

test("ptr 2 params", () => {
  const src = `
    fn foo(ptr: ptr<private, u32>) { }
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %foo 
      { 
        { %ptr 
          { ptr private u32 } #3
        } #2
      } #1
    } #0"
  `);
});

test("ptr 3 params", () => {
  const src = `
    fn foo(ptr: ptr<storage, array<u32, 128>, read>) { }
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %foo 
      { 
        { %ptr 
          { ptr storage array u32 read } #3
        } #2
      } #1
    } #0"
  `);
});

test("scope from fn with reference", () => {
  const src = `
    fn main() {
      var x: i32 = 1;
      x++;
    }
  `;
  const { rootScope } = parseWESL(src);

  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %main 
      { 
        { %x 
          { i32 } #3
          x
        } #2
      } #1
    } #0"
  `);
});

test("switch", () => {
  const src = `
    fn main() {
      var code = 1u;
      switch ( code ) {
        case 5u: { if 1 > 0 { var x = 7;} }
        default: { break; }
      }
    }`;
  const { rootScope } = parseWESL(src);

  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %main 
      { 
        { %code code 
          { 
            { %x } #4
          } #3
          {  } #5
        } #2
      } #1
    } #0"
  `);
});

test("for()", () => {
  const src = `
    fn main() {
      var i = 1.0;
      for (var i = 0; i < 10; i++) { }
    }`;
  const { rootScope } = parseWESL(src);

  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %main 
      { 
        { %i 
          { %i i i 
            {  } #4
          } #3
        } #2
      } #1
    } #0"
  `);
});

test("fn with param", () => {
  const src = `
    fn main(i: i32) {
      var x = 10 + i;
      for (var i = 0; i < x; i++) { }
    }`;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %main 
      { 
        { %i 
          { i32 } #3
          %x i 
          { %i i x i 
            {  } #5
          } #4
        } #2
      } #1
    } #0"
  `);
});

test("fn decl scope", () => {
  const src = `
    fn main(i: i32) {
      var x = i;
    }`;
  const { rootScope } = parseWESL(src);
  const decls = findValidRootDecls(rootScope, {});
  const mainIdent = decls[0];
  expect(scopeToString(mainIdent.dependentScope!)).toMatchInlineSnapshot(
    `
    "{ 
      { %i 
        { i32 } #3
        %x i
      } #2
    } #1"
  `,
  );
});

test("larger example", () => {
  const src = `
    struct UBO { width : u32, }

    struct Buffer { weights : array<f32>, }

    @binding(0) @group(0) var<uniform> ubo : UBO;
    @binding(1) @group(0) var<storage, read> buf_in : Buffer;
    @binding(2) @group(0) var<storage, read_write> buf_out : Buffer;
    @binding(3) @group(0) var tex_in : texture_2d<f32>;
    @binding(3) @group(0) var tex_out : texture_storage_2d<rgba8unorm, write>;

    @compute @workgroup_size(64)
    fn import_level(@builtin(global_invocation_id) coord : vec3u) {
      _ = &buf_in;
      let offset = coord.x + coord.y * ubo.width;
      buf_out.weights[offset] = textureLoad(tex_in, vec2i(coord.xy), 0).w;
    }

    @compute @workgroup_size(64)
    fn export_level(@builtin(global_invocation_id) coord : vec3u) {
      if (all(coord.xy < vec2u(textureDimensions(tex_out)))) {
        let dst_offset = coord.x    + coord.y    * ubo.width;
        let src_offset = coord.x*2u + coord.y*2u * ubo.width;

        let a = buf_in.weights[src_offset + 0u];
        let b = buf_in.weights[src_offset + 1u];
        let c = buf_in.weights[src_offset + 0u + ubo.width];
        let d = buf_in.weights[src_offset + 1u + ubo.width];
        let sum = dot(vec4f(a, b, c, d), vec4f(1.0));

        buf_out.weights[dst_offset] = sum / 4.0;

        let probabilities = vec4f(a, a+b, a+b+c, sum) / max(sum, 0.0001);
        textureStore(tex_out, vec2i(coord.xy), probabilities);
      }
    }
  `;

  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %UBO 
      { u32 } #1
      %Buffer 
      { array f32 } #2
      -{ %ubo 
        { UBO } #4
      } #3
      -{ %buf_in 
        { Buffer } #6
      } #5
      -{ %buf_out 
        { Buffer } #8
      } #7
      -{ %tex_in 
        { texture_2d f32 } #10
      } #9
      -{ %tex_out 
        { texture_storage_2d rgba8unorm write } #12
      } #11
      %import_level 
      { 
        { %coord 
          { vec3u } #15
          buf_in %offset coord coord ubo buf_out offset 
          textureLoad tex_in vec2i coord
        } #14
      } #13
      %export_level 
      { 
        { %coord 
          { vec3u } #18
          all coord vec2u textureDimensions tex_out 
          { %dst_offset coord coord ubo %src_offset coord coord 
            ubo %a buf_in src_offset %b buf_in src_offset %c 
            buf_in src_offset ubo %d buf_in src_offset ubo %sum 
            dot vec4f a b c d vec4f buf_out dst_offset sum 
            %probabilities vec4f a a b a b c sum max sum 
            textureStore tex_out vec2i coord probabilities} #19
        } #17
      } #16
    } #0"
  `);
});

test("scope with an attribute", () => {
  const src = `
    fn main() {
      @if(foo){ }
    }
  `;
  const { rootScope } = parseWESL(src);

  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %main 
      { 
        { 
           @if(foo) -{  } #3
        } #2
      } #1
    } #0"
  `);
});

test("partial scope", () => {
  const src = `
    fn main() {
      var x = 1;

      @if(false) y = 2;
    }
  `;
  const { rootScope } = parseWESL(src);

  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %main 
      { 
        { %x 
           @if(false) -{ y } #3
        } #2
      } #1
    } #0"
  `);
});

test("loop scope", () => {
  const src = `
    fn main() {
      let a = 7;
      loop {
        let a = 1;
        continuing {
          let a = 2;
        }
      }
    }
  `;
  const { rootScope } = parseWESL(src);

  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %main 
      { 
        { %a 
          { %a 
            { %a } #4
          } #3
        } #2
      } #1
    } #0"
  `);
});

test("nested scope test", () => {
  const src = `
    fn main() {
      let bar = 72;
      if (true) {
        if (true) {
          let new_bar = bar; // Should be 72!
        }
        let bar = 5;
      }
    }
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ %main 
      { 
        { %bar 
          { 
            { %new_bar bar } #4
            %bar
          } #3
        } #2
      } #1
    } #0"
  `);
});

test("@if fn", () => {
  const src = `
    const loc = 0;

    @if(true) @fragment
    fn fragmentMain(@location(0) p: vec3f) -> @location(loc) vec4f {
      let x = p;
    }
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ 
      -{ %loc } #1
       @if(true) -{ %fragmentMain 
        { 
          { %p 
            { vec3f } #5
            %x p
          } #4
          loc vec4f
        } #3
      } #2
    } #0"
  `);
});

test("@if const", () => {
  const src = `
    @if(true) const a = 0;
  `;
  const { rootScope } = parseWESL(src);
  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ 
       @if(true) -{ 
        -{ %a } #2
      } #1
    } #0"
  `);
});

test("var<private> a: i32;", () => {
  const src = `
    var<private> a: i32 = 0;
  `;
  const { rootScope } = parseWESL(src);

  expect(scopeToString(rootScope)).toMatchInlineSnapshot(`
    "{ 
      -{ %a 
        { i32 } #2
      } #1
    } #0"
  `);
});
