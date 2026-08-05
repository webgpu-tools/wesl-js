import { test } from "vitest";
import { expectTokenMatch, linkTest, linkTestOpts } from "./TestUtil.ts";
import { expectTrimmedMatch } from "./TrimmedMatch.ts";

test("link global var", async () => {
  const src = `var x: i32 = 1;`;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("global diagnostic directive", async () => {
  const src = `diagnostic(info, derivative_uniformity);`;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("consecutive top-level directives stay on separate lines", async () => {
  const src = `requires readonly_and_readwrite_storage_textures;\nenable f16;`;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("@diagnostic attribute on statement", async () => {
  const src = `fn foo() { @diagnostic(info, derivative_uniformity) if true { } }`;
  const result = await linkTest(src);
  expectTokenMatch(result, src);
});

test("non-WGSL attribute @test stripped from output", async () => {
  const src = `
    @test
    fn myTest() { }
  `;
  const expected = `fn myTest() { }`;
  const result = await linkTest(src);
  expectTokenMatch(result, expected);
});

test("non-WGSL attribute @test with params stripped", async () => {
  const src = `
    @test(my_test_name)
    fn myTest() { }
  `;
  const expected = `fn myTest() { }`;
  const result = await linkTest(src);
  expectTokenMatch(result, expected);
});

test("non-WGSL attribute @custom stripped from output", async () => {
  const src = `
    @custom
    fn myFn() { }
  `;
  const expected = `fn myFn() { }`;
  const result = await linkTest(src);
  expectTokenMatch(result, expected);
});

test("link an alias", async () => {
  const src = /* wgsl */ `
    alias Num = f32;

    fn main() {
      Num(1.0);
    }
  `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("link a const_assert", async () => {
  const src = `
    var x = 1;
    var y = 2;
    const_assert x < y;
  `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("link a struct", async () => {
  const src = `
    struct Point {
      x: i32,
      y: i32,
    }
  `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("link a fn", async () => {
  const src = `
    fn foo(x: i32, y: u32) -> f32 { 
      return 1.0; 
    }`;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("handle a ptr type", async () => {
  const src = `
    fn uint_bitfieldExtract_u1_i1_i1_(value: ptr<function, u32>, bits: ptr<function, i32>) -> u32 { }
  `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("struct after var", async () => {
  const src = `
    var config: TwoPassConfig;

    struct TwoPassConfig { x: u32 }
  `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("type inside fn with same name as fn", async () => {
  // illegal but shouldn't hang
  const src = `
    fn foo() {
      var a: foo;
    }
    fn bar() { }
  `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("call cross reference", async () => {
  const src = `
    fn foo() {
      bar();
    }

    fn bar() {
      foo();
    }
  `;

  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("struct self reference", async () => {
  const src = `
    struct A {
      a: A,
      b: B,
    }
    struct B { f: f32 }
  `;

  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("parse texture_storage_2d with texture format in typical type position", async () => {
  const src = "var t: texture_storage_2d<rgba8unorm, write>;";
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("struct member ref with extra component_or_swizzle", async () => {
  const src = `
    struct C { p: P }
    struct P { x: u32 }
    fn foo(c: C) {
      let a = c.p.x;
    }
 `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("empty string", async () => {
  const src = "";
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("cross-module @location attribute const", async () => {
  const main = `
    import package::file1::foo;
    fn main() { let x = foo(); }
  `;
  const file1 = `
    const loc = 0;
    fn foo() -> @location(loc) vec4f { return vec4f(); }
  `;
  const result = await linkTest(main, file1);
  const expected = `
    fn main() {
      let x = foo();
    }
    fn foo() -> @location(loc) vec4f {
      return vec4f();
    }
    const loc = 0;
  `;
  expectTrimmedMatch(result, expected);
});

test("link with library bundle (tests CompositeResolver)", async () => {
  const main = `
    import mylib::util::helper;
    fn main() { helper(); }
  `;
  // Create a library bundle with the module
  const libs = [
    {
      name: "mylib",
      edition: "2026_pre" as const,
      modules: {
        "util.wesl": `fn helper() { }`,
      },
    },
  ];
  const result = await linkTestOpts({ libs }, main);
  const expected = `
    fn main() {
      helper();
    }
    fn helper() { }
  `;
  expectTrimmedMatch(result, expected);
});

test("inline ref in array size from another module", async () => {
  const main = `
    import package::file1::SIZE;
    fn main() { var a: array<f32, SIZE>; }
  `;
  const file1 = `const SIZE = 4;`;
  const result = await linkTest(main, file1);
  const expected = `
    fn main() {
      var a: array<f32, SIZE>;
    }
    const SIZE = 4;
  `;
  expectTrimmedMatch(result, expected);
});

test("enable directive hoists from an imported module", async () => {
  const main = `import package::file1::half;
    fn main() { let x = half(); }`;
  const lib = `enable f16;
    fn half() -> f16 { return 1.0h; }`;
  const expected = `
    enable f16;
    fn main() {
      let x = half();
    }
    fn half() -> f16 {
      return 1.0h;
    }
  `;
  expectTrimmedMatch(await linkTest(main, lib), expected);
});

test("enable directives from two modules dedupe", async () => {
  const main = `import package::file1::half;
    import package::file2::quarter;
    fn main() { let x = half() + quarter(); }`;
  const lib1 = `enable f16;
    fn half() -> f16 { return 1.0h; }`;
  const lib2 = `enable f16;
    fn quarter() -> f16 { return 0.5h; }`;
  const expected = `
    enable f16;
    fn main() {
      let x = half() + quarter();
    }
    fn half() -> f16 {
      return 1.0h;
    }
    fn quarter() -> f16 {
      return 0.5h;
    }
  `;
  expectTrimmedMatch(await linkTest(main, lib1, lib2), expected);
});

test("hoisted enable skips extensions the root module declares", async () => {
  const main = `import package::file1::half;
    enable f16;
    fn main() { let x = half(); }`;
  const lib = `enable f16;
    fn half() -> f16 { return 1.0h; }`;
  const expected = `
    enable f16;
    fn main() {
      let x = half();
    }
    fn half() -> f16 {
      return 1.0h;
    }
  `;
  expectTrimmedMatch(await linkTest(main, lib), expected);
});

test("@if(false) enable does not hoist", async () => {
  const main = `import package::file1::half;
    fn main() { let x = half(); }`;
  const lib = `@if(false) enable f16;
    fn half() -> f32 { return 1.0; }`;
  const expected = `
    fn main() {
      let x = half();
    }
    fn half() -> f32 {
      return 1.0;
    }
  `;
  expectTrimmedMatch(await linkTest(main, lib), expected);
});

test("requires directive hoists from an imported module", async () => {
  const main = `import package::file1::foo;
    fn main() { foo(); }`;
  const lib = `requires readonly_and_readwrite_storage_textures;
    fn foo() { }`;
  const expected = `
    requires readonly_and_readwrite_storage_textures;
    fn main() {
      foo();
    }
    fn foo() { }
  `;
  expectTrimmedMatch(await linkTest(main, lib), expected);
});

test("enable in a tree shaken module does not hoist", async () => {
  const main = `fn main() { }`;
  const lib = `enable f16;
    fn half() -> f16 { return 1.0h; }`;
  expectTrimmedMatch(await linkTest(main, lib), `fn main() { }`);
});

test("one module's @if(false) doesn't satisfy another module's @else", async () => {
  // @if/@else chains are per module, so lib1's trailing @if(false) can't
  // enable lib2's @else. Within lib2 the @else follows an @if(true)
  // diagnostic -- a directive that never hoists, but still heads the chain --
  // so the @else isn't taken and `enable f16` stays out
  const main = `import package::file1::half;
    import package::file2::quarter;
    fn main() { let x = half() + quarter(); }`;
  const lib1 = `@if(false) enable subgroups;
    fn half() -> f32 { return 0.5; }`;
  const lib2 = `@if(true) diagnostic(off, derivative_uniformity);
    @else enable f16;
    fn quarter() -> f32 { return 0.25; }`;
  const expected = `
    fn main() {
      let x = half() + quarter();
    }
    fn half() -> f32 {
      return 0.5;
    }
    fn quarter() -> f32 {
      return 0.25;
    }
  `;
  expectTrimmedMatch(await linkTest(main, lib1, lib2), expected);
});

test("@else enable hoists when a diagnostic heads the chain", async () => {
  const main = `import package::file1::half;
    fn main() { let x = half(); }`;
  const lib = `@if(false) diagnostic(off, derivative_uniformity);
    @else enable f16;
    fn half() -> f16 { return 1.0h; }`;
  const expected = `
    enable f16;
    fn main() {
      let x = half();
    }
    fn half() -> f16 {
      return 1.0h;
    }
  `;
  expectTrimmedMatch(await linkTest(main, lib), expected);
});

test("@else const_assert in an imported module is included", async () => {
  const main = `import package::file1::half;
    fn main() { let x = half(); }`;
  const lib = `@if(false) const_assert 1 == 2;
    @else const_assert 1 == 1;
    fn half() -> f32 { return 1.0; }`;
  const expected = `
    const_assert 1 == 1;
    fn main() {
      let x = half();
    }
    fn half() -> f32 {
      return 1.0;
    }
  `;
  expectTrimmedMatch(await linkTest(main, lib), expected);
});
