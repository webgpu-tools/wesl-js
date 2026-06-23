import { expect, test } from "vitest";
import { bindAndTransform, RecordResolver, type StructElem } from "wesl";
import { structLayout, typeLayout } from "../StructLayout.ts";

/** Parse and bind WESL source(s), return all structs. */
function bindModules(weslSrc: Record<string, string>): StructElem[] {
  const resolver = new RecordResolver(weslSrc, { debugWeslRoot: "test" });
  bindAndTransform({ rootModuleName: "test", resolver });
  return [...resolver.allModules()].flatMap(([, ast]) =>
    ast.moduleElem.decls.filter((e): e is StructElem => e.kind === "struct"),
  );
}

/** Parse a single struct and compute its layout. */
function layoutOf(src: string, structName = "S") {
  const allStructs = bindModules({ "./test.wesl": src });
  const s = allStructs.find(s => s.name.ident.originalName === structName)!;
  return structLayout(s);
}

test("scalar f32", () => {
  expect(typeLayout("f32")).toEqual({ alignment: 4, size: 4 });
});

test("scalar f16", () => {
  expect(typeLayout("f16")).toEqual({ alignment: 2, size: 2 });
});

test("vec2f", () => {
  expect(typeLayout("vec2f")).toEqual({ alignment: 8, size: 8 });
});

test("vec3f: align=16, size=12", () => {
  expect(typeLayout("vec3f")).toEqual({ alignment: 16, size: 12 });
});

test("vec4f", () => {
  expect(typeLayout("vec4f")).toEqual({ alignment: 16, size: 16 });
});

test("mat2x2f", () => {
  expect(typeLayout("mat2x2f")).toEqual({ alignment: 8, size: 16 });
});

test("mat4x4f", () => {
  expect(typeLayout("mat4x4f")).toEqual({ alignment: 16, size: 64 });
});

test("unknown type throws", () => {
  expect(() => typeLayout("MyStruct")).toThrow("unsupported type");
});

test("u32, vec2f: vec2f at offset 8", () => {
  const layout = layoutOf("struct S { a: u32, b: vec2f }");
  expect(layout.fields[1].offset).toBe(8);
});

test("u32, vec3f: vec3f at offset 16", () => {
  const layout = layoutOf("struct S { a: u32, b: vec3f }");
  expect(layout.fields[1].offset).toBe(16);
});

test("u32, vec4f: vec4f at offset 16", () => {
  const layout = layoutOf("struct S { a: u32, b: vec4f }");
  expect(layout.fields[1].offset).toBe(16);
});

test("vec3f, u32: u32 at offset 12 (vec3 size=12, not 16)", () => {
  const layout = layoutOf("struct S { a: vec3f, b: u32 }");
  expect(layout.fields[1].offset).toBe(12);
});

test("f32, f32, f32: offsets 0, 4, 8", () => {
  const layout = layoutOf("struct S { a: f32, b: f32, c: f32 }");
  expect(layout.fields.map(f => f.offset)).toEqual([0, 4, 8]);
});

test("vec4f, f32: f32 at offset 16", () => {
  const layout = layoutOf("struct S { a: vec4f, b: f32 }");
  expect(layout.fields[1].offset).toBe(16);
});

test("mixed: f32, vec3f, f32 => offsets 0, 16, 28, bufferSize=32", () => {
  const layout = layoutOf("struct S { a: f32, b: vec3f, c: f32 }");
  expect(layout.fields.map(f => f.offset)).toEqual([0, 16, 28]);
  expect(layout.bufferSize).toBe(32);
});

test("f32, vec3f: bufferSize=32 (tail padding)", () => {
  const layout = layoutOf("struct S { a: f32, b: vec3f }");
  expect(layout.bufferSize).toBe(32);
});

test("single f32: bufferSize=4", () => {
  const layout = layoutOf("struct S { x: f32 }");
  expect(layout.fields[0]).toEqual({ name: "x", offset: 0, size: 4 });
  expect(layout.bufferSize).toBe(4);
});

test("resolution + time + mouse layout", () => {
  const layout = layoutOf(
    "struct S { resolution: vec2f, time: f32, mouse: vec2f }",
  );
  expect(layout.fields.map(f => [f.name, f.offset])).toEqual([
    ["resolution", 0],
    ["time", 8],
    ["mouse", 16],
  ]);
  expect(layout.bufferSize).toBe(24);
});

test("array<f32, 4>: stride 4, size 16", () => {
  const layout = layoutOf("struct S { a: array<f32, 4> }");
  expect(layout.fields[0]).toEqual({ name: "a", offset: 0, size: 16 });
  expect(layout.bufferSize).toBe(16);
});

test("array<vec3f, 2>: stride 16 (not 12), size 32", () => {
  const layout = layoutOf("struct S { a: array<vec3f, 2> }");
  expect(layout.fields[0]).toEqual({ name: "a", offset: 0, size: 32 });
  expect(layout.alignment).toBe(16);
});

test("array<vec2f, 3>: stride 8, size 24", () => {
  const layout = layoutOf("struct S { a: array<vec2f, 3> }");
  expect(layout.fields[0].size).toBe(24);
});

test("u32, array<vec3f, 1>, f32", () => {
  const layout = layoutOf("struct S { a: u32, b: array<vec3f, 1>, c: f32 }");
  expect(layout.fields.map(f => [f.name, f.offset])).toEqual([
    ["a", 0],
    ["b", 16],
    ["c", 32],
  ]);
  expect(layout.bufferSize).toBe(48);
});

test("runtime-sized array<f32>: size 0", () => {
  const layout = layoutOf("struct S { count: u32, data: array<f32> }");
  expect(layout.fields[1]).toEqual({ name: "data", offset: 4, size: 0 });
});

test("nested struct: Inner { vec3f, f32 }", () => {
  const layout = layoutOf(`
    struct Inner { position: vec3f, radius: f32 }
    struct S { inner: Inner }
  `);
  expect(layout.fields[0]).toEqual({ name: "inner", offset: 0, size: 16 });
  expect(layout.alignment).toBe(16);
});

test("nested struct with small alignment: Pair { f32, f32 }", () => {
  const layout = layoutOf(`
    struct Pair { x: f32, y: f32 }
    struct S { a: u32, b: Pair }
  `);
  // Pair: align=4, size=8. u32 at 0 (size 4), Pair at 4 (align 4)
  expect(layout.fields[1].offset).toBe(4);
  expect(layout.alignment).toBe(4);
  expect(layout.bufferSize).toBe(12);
});

test("u32 then nested Inner: Inner at offset 16", () => {
  const layout = layoutOf(`
    struct Inner { position: vec3f, radius: f32 }
    struct S { id: u32, inner: Inner }
  `);
  expect(layout.fields[1].offset).toBe(16);
});

test("array<Inner, 3>: stride 16, size 48", () => {
  const layout = layoutOf(`
    struct Inner { position: vec3f, radius: f32 }
    struct S { items: array<Inner, 3> }
  `);
  expect(layout.fields[0].size).toBe(48);
});

test("array of struct where stride != size (vec3f padding)", () => {
  const layout = layoutOf(`
    struct Small { v: vec3f }
    struct S { items: array<Small, 2> }
  `);
  // Small: align=16, size=roundUp(16,12)=16 (tail padding), stride=16
  expect(layout.fields[0].size).toBe(32);
});

test("deeply nested: A contains B contains vec3f", () => {
  const layout = layoutOf(`
    struct B { v: vec3f, w: f32 }
    struct A { b: B, extra: f32 }
    struct S { a: A }
  `);
  // B: align=16, size=16. A: B at 0(size 16), f32 at 16(size 4) => 20, align=16, bufferSize=32
  expect(layout.fields[0].size).toBe(32);
  expect(layout.alignment).toBe(16);
});

test("@align(32) f32 after f32: offset 32, bufferSize 64", () => {
  const layout = layoutOf("struct S { a: f32, @align(32) b: f32 }");
  expect(layout.fields[1].offset).toBe(32);
  expect(layout.bufferSize).toBe(64);
});

test("@size(16) u32 x4: offsets 0,16,32,48", () => {
  const layout = layoutOf(`struct S {
    @size(16) a: u32,
    @size(16) b: u32,
    @size(16) c: u32,
    @size(16) d: u32,
  }`);
  expect(layout.fields.map(f => f.offset)).toEqual([0, 16, 32, 48]);
  expect(layout.bufferSize).toBe(64);
});

test("@size on array member", () => {
  const layout = layoutOf("struct S { @size(32) a: array<f32, 2> }");
  // array<f32, 2> normally size=8, but @size(32) overrides
  expect(layout.fields[0].size).toBe(32);
  expect(layout.bufferSize).toBe(32);
});

test("mat4x4f + array<f32,4> + vec3f", () => {
  const layout = layoutOf(
    "struct S { transform: mat4x4f, weights: array<f32, 4>, position: vec3f }",
  );
  expect(layout.fields.map(f => [f.name, f.offset, f.size])).toEqual([
    ["transform", 0, 64],
    ["weights", 64, 16],
    ["position", 80, 12],
  ]);
  expect(layout.bufferSize).toBe(96);
});

test("scalars, vec3f, scalar: alignment gap before vec3f", () => {
  const layout = layoutOf(
    "struct S { flags: u32, weight: f32, normal: vec3f, index: i32 }",
  );
  expect(layout.fields.map(f => f.offset)).toEqual([0, 4, 16, 28]);
  expect(layout.bufferSize).toBe(32);
});

test("vec3f, f32, array<vec3f,1>, f32: mixed field and array vec3", () => {
  const layout = layoutOf(`struct S {
    orientation: vec3f,
    size: f32,
    direction: array<vec3f, 1>,
    scale: f32,
  }`);
  expect(layout.fields.map(f => [f.name, f.offset])).toEqual([
    ["orientation", 0],
    ["size", 12],
    ["direction", 16],
    ["scale", 32],
  ]);
  expect(layout.bufferSize).toBe(48);
});

test("nested struct + array + trailing scalars", () => {
  const layout = layoutOf(`
    struct Motion { velocity: vec3f }
    struct S {
      heading: vec3f,
      radius: f32,
      path: array<vec3f, 1>,
      speed: f32,
      motion: Motion,
      drag: f32,
    }
  `);
  expect(layout.fields.map(f => [f.name, f.offset])).toEqual([
    ["heading", 0],
    ["radius", 12],
    ["path", 16],
    ["speed", 32],
    ["motion", 48],
    ["drag", 64],
  ]);
  expect(layout.bufferSize).toBe(80);
});

test("mat4x4f + multiple nested structs + vectors", () => {
  const layout = layoutOf(`
    struct Rect { x: u32, y: u32, w: u32, h: u32 }
    struct Grid { r0: u32, r1: u32, r2: u32, r3: u32, c0: u32, c1: u32, c2: u32, c3: u32 }
    struct S {
      mvp: mat4x4f, viewport: Rect, grid: Grid,
      tint: vec4f, sun: vec3f,
    }
  `);
  expect(layout.fields.map(f => [f.name, f.offset])).toEqual([
    ["mvp", 0],
    ["viewport", 64],
    ["grid", 80],
    ["tint", 112],
    ["sun", 128],
  ]);
  expect(layout.bufferSize).toBe(144);
});

test("array<vec3f, 3> then f32: multi-element stride padding", () => {
  const layout = layoutOf("struct S { a: array<vec3f, 3>, b: f32 }");
  expect(layout.fields[0].size).toBe(48);
  expect(layout.fields[1].offset).toBe(48);
  expect(layout.bufferSize).toBe(64);
});

test("f16 vectors: vec2h, vec3h", () => {
  const layout = layoutOf("struct S { a: f16, b: f16, c: vec2h, d: vec3h }");
  expect(layout.fields.map(f => f.offset)).toEqual([0, 2, 4, 8]);
  expect(layout.bufferSize).toBe(16);
});

test("cross-module: struct in another file resolved via refersTo", () => {
  const allStructs = bindModules({
    "./test.wesl": `
      import package::file1::Inner;
      struct S { id: u32, inner: Inner }
    `,
    "./file1.wesl": `
      struct Inner { position: vec3f, radius: f32 }
    `,
  });
  const s = allStructs.find(s => s.name.ident.originalName === "S")!;
  const layout = structLayout(s);
  expect(layout.fields.map(f => [f.name, f.offset])).toEqual([
    ["id", 0],
    ["inner", 16],
  ]);
  expect(layout.bufferSize).toBe(32);
});

test("cross-module: same-named structs in different modules don't collide", () => {
  const allStructs = bindModules({
    "./test.wesl": `
      import package::file1::Data;
      struct S { a: Data }
    `,
    "./file1.wesl": `
      struct Data { x: vec3f, y: f32 }
    `,
    "./file2.wesl": `
      struct Data { a: u32 }
    `,
  });
  const s = allStructs.find(s => s.name.ident.originalName === "S")!;
  const layout = structLayout(s);
  // file1::Data has vec3f+f32 ==> size=16, align=16
  expect(layout.fields[0].size).toBe(16);
  expect(layout.alignment).toBe(16);
});

test("@if filters conditional members", () => {
  const allStructs = bindModules({
    "./test.wesl": `struct S {
      a: u32,
      @if(MOBILE) b: f32,
      @if(!MOBILE) b: vec3f,
      c: f32,
    }`,
  });
  const s = allStructs.find(s => s.name.ident.originalName === "S")!;

  // MOBILE=true: a(u32), b(f32), c(f32) => offsets 0, 4, 8
  const mobile = structLayout(s, { MOBILE: true });
  expect(mobile.fields.map(f => [f.name, f.offset])).toEqual([
    ["a", 0],
    ["b", 4],
    ["c", 8],
  ]);
  expect(mobile.bufferSize).toBe(12);

  // MOBILE=false: a(u32), b(vec3f), c(f32) => offsets 0, 16, 28
  const desktop = structLayout(s, { MOBILE: false });
  expect(desktop.fields.map(f => [f.name, f.offset])).toEqual([
    ["a", 0],
    ["b", 16],
    ["c", 28],
  ]);
  expect(desktop.bufferSize).toBe(32);
});

test("@if/@else filters conditional members", () => {
  const allStructs = bindModules({
    "./test.wesl": `struct S {
      @if(false) a: u32,
      @else a: f32,
    }`,
  });
  const s = allStructs.find(s => s.name.ident.originalName === "S")!;
  const layout = structLayout(s, {});
  expect(layout.fields).toEqual([{ name: "a", offset: 0, size: 4 }]);
});

test("no conditions: all members included", () => {
  const allStructs = bindModules({
    "./test.wesl": `struct S {
      a: u32,
      @if(MOBILE) b: f32,
      c: f32,
    }`,
  });
  const s = allStructs.find(s => s.name.ident.originalName === "S")!;
  // without conditions, all members present (including conditional ones)
  const layout = structLayout(s);
  expect(layout.fields.length).toBe(3);
});
