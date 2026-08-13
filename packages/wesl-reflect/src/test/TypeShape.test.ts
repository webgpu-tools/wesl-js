import { expect, test } from "vitest";
import { parseSrcModule, type WeslAST } from "wesl/core";
import { decodeBuffer } from "../Decode.ts";
import { TypeShapeError, varReflection } from "../TypeShape.ts";

function parse(src: string): WeslAST {
  return parseSrcModule({
    modulePath: "test",
    debugFilePath: "test.wesl",
    src,
  });
}

test("scalar f32 array reflects with stride and length", () => {
  const ast = parse(`@buffer var<storage, read_write> r: array<f32, 8>;`);
  const v = varReflection(ast, "r");
  expect(v.addressSpace).toBe("storage");
  expect(v.accessMode).toBe("read_write");
  expect(v.byteSize).toBe(32);
  expect(v.type).toMatchObject({
    kind: "array",
    length: 8,
    stride: 4,
    size: 32,
    alignment: 4,
    elem: { kind: "scalar", type: "f32", size: 4, alignment: 4 },
  });
});

test("u32 array, read access", () => {
  const ast = parse(`@buffer var<storage, read> r: array<u32, 4>;`);
  const v = varReflection(ast, "r");
  expect(v.accessMode).toBe("read");
  expect(v.type).toMatchObject({ kind: "array", length: 4, stride: 4 });
});

test("vec3f array carries vec3 padding alignment", () => {
  const ast = parse(`@buffer var<storage, read_write> r: array<vec3f, 2>;`);
  const v = varReflection(ast, "r");
  expect(v.type).toMatchObject({
    kind: "array",
    length: 2,
    stride: 16,
    elem: { kind: "vec", n: 3, component: "f32", size: 12, alignment: 16 },
  });
});

test("struct array fields carry offsets", () => {
  const ast = parse(`
    struct Particle { pos: vec2f, vel: vec2f }
    @buffer var<storage, read_write> p: array<Particle, 4>;
  `);
  const v = varReflection(ast, "p");
  expect(v.type.kind).toBe("array");
  if (v.type.kind !== "array") return;
  const elem = v.type.elem;
  expect(elem).toMatchObject({
    kind: "struct",
    name: "Particle",
    size: 16,
    alignment: 8,
    fields: [
      {
        name: "pos",
        offset: 0,
        size: 8,
        type: { kind: "vec", n: 2, component: "f32" },
      },
      {
        name: "vel",
        offset: 8,
        size: 8,
        type: { kind: "vec", n: 2, component: "f32" },
      },
    ],
  });
});

test("nested struct resolves through registry", () => {
  const ast = parse(`
    struct Inner { x: f32, y: u32 }
    struct Outer { inner: Inner, count: i32 }
    @buffer var<storage, read_write> r: array<Outer, 2>;
  `);
  const v = varReflection(ast, "r");
  if (v.type.kind !== "array") throw new Error("expected array");
  if (v.type.elem.kind !== "struct") throw new Error("expected struct");
  expect(v.type.elem.fields.map(f => f.name)).toEqual(["inner", "count"]);
  expect(v.type.elem.fields[1].offset).toBe(8);
});

test("single struct (not array)", () => {
  const ast = parse(`
    struct Cfg { k: f32, n: u32 }
    @buffer var<storage, read_write> c: Cfg;
  `);
  const v = varReflection(ast, "c");
  expect(v.type.kind).toBe("struct");
});

test("matrices reflect with column stride", () => {
  const ast = parse(`@buffer var<storage, read_write> m: array<mat4x4f, 2>;`);
  const v = varReflection(ast, "m");
  if (v.type.kind !== "array") throw new Error("expected array");
  expect(v.type.elem).toMatchObject({
    kind: "mat",
    cols: 4,
    rows: 4,
    component: "f32",
    size: 64,
    alignment: 16,
  });
});

test("atomic<u32> reflects", () => {
  const ast = parse(`@buffer var<storage, read_write> a: atomic<u32>;`);
  const v = varReflection(ast, "a");
  expect(v.type).toMatchObject({
    kind: "atomic",
    component: "u32",
    size: 4,
    alignment: 4,
  });
});

test("runtime-sized array reflects with length 'runtime'", () => {
  const ast = parse(`@buffer var<storage, read_write> r: array<f32>;`);
  const v = varReflection(ast, "r");
  if (v.type.kind !== "array") throw new Error("expected array");
  expect(v.type.length).toBe("runtime");
  expect(v.type.stride).toBe(4);
  expect(v.byteSize).toBe(0);
});

test("group/binding attributes are picked up", () => {
  const ast = parse(`
    @group(0) @binding(2) var<uniform> u: f32;
  `);
  const v = varReflection(ast, "u");
  expect(v.group).toBe(0);
  expect(v.binding).toBe(2);
  expect(v.addressSpace).toBe("uniform");
});

test("missing var throws TypeShapeError", () => {
  const ast = parse(`@buffer var<storage, read_write> r: array<f32, 4>;`);
  expect(() => varReflection(ast, "missing")).toThrow(TypeShapeError);
});

test("decodeBuffer reads scalar array", () => {
  const ast = parse(`@buffer var<storage, read> r: array<f32, 3>;`);
  const v = varReflection(ast, "r");
  const data = new Float32Array([1.5, 2.5, 3.5]).buffer;
  expect(decodeBuffer(v.type, data)).toEqual([1.5, 2.5, 3.5]);
});

test("decodeBuffer reads struct array with vec3 padding", () => {
  const ast = parse(`
    struct P { pos: vec3f, n: u32 }
    @buffer var<storage, read> r: array<P, 2>;
  `);
  const v = varReflection(ast, "r");
  // P layout: pos at offset 0, size 12, align 16; n at offset 12, size 4, align 4. struct align 16, size 16.
  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  view.setFloat32(0, 1, true);
  view.setFloat32(4, 2, true);
  view.setFloat32(8, 3, true);
  view.setUint32(12, 99, true);
  view.setFloat32(16, 4, true);
  view.setFloat32(20, 5, true);
  view.setFloat32(24, 6, true);
  view.setUint32(28, 100, true);
  expect(decodeBuffer(v.type, buf)).toEqual([
    { pos: [1, 2, 3], n: 99 },
    { pos: [4, 5, 6], n: 100 },
  ]);
});

test("decodeBuffer reads runtime array from buffer length", () => {
  const ast = parse(`@buffer var<storage, read> r: array<u32>;`);
  const v = varReflection(ast, "r");
  const data = new Uint32Array([10, 20, 30, 40, 50]).buffer;
  expect(decodeBuffer(v.type, data)).toEqual([10, 20, 30, 40, 50]);
});
