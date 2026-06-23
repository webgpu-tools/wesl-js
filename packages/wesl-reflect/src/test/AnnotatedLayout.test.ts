import { expect, test } from "vitest";
import { bindAndTransform, RecordResolver, type StructElem } from "wesl";
import { annotatedLayout } from "../AnnotatedLayout.ts";
import {
  autoAnnotation,
  colorAnnotation,
  isUniformsStruct,
  rangeAnnotation,
  toggleAnnotation,
} from "../UniformAnnotations.ts";

/** Parse and bind WESL source, return all structs. */
function bindModules(weslSrc: Record<string, string>): StructElem[] {
  const resolver = new RecordResolver(weslSrc, { debugWeslRoot: "test" });
  bindAndTransform({ rootModuleName: "test", resolver });
  return [...resolver.allModules()].flatMap(([, ast]) =>
    ast.moduleElem.decls.filter((e): e is StructElem => e.kind === "struct"),
  );
}

function findStruct(src: string, name = "S"): StructElem {
  const structs = bindModules({ "./test.wesl": src });
  return structs.find(s => s.name.ident.originalName === name)!;
}

// --- isUniformsStruct ---

test("@uniforms struct detected", () => {
  const s = findStruct(`@uniforms struct S { time: f32 }`);
  expect(isUniformsStruct(s)).toBe(true);
});

test("plain struct not @uniforms", () => {
  const s = findStruct(`struct S { time: f32 }`);
  expect(isUniformsStruct(s)).toBe(false);
});

// --- rangeAnnotation ---

test("@range with all params", () => {
  const s = findStruct(`struct S { @range(1.0, 20.0, 0.5, 5.0) freq: f32 }`);
  expect(rangeAnnotation(s.members[0])).toEqual({
    min: 1,
    max: 20,
    step: 0.5,
    initial: 5,
  });
});

test("@range defaults initial to min", () => {
  const s = findStruct(`struct S { @range(2.0, 10.0) x: f32 }`);
  const r = rangeAnnotation(s.members[0])!;
  expect(r.initial).toBe(2);
  expect(r.step).toBeUndefined();
});

// --- colorAnnotation ---

test("@color extracts rgb", () => {
  const s = findStruct(`struct S { @color(0.2, 0.5, 1.0) tint: vec3f }`);
  expect(colorAnnotation(s.members[0])).toEqual({ initial: [0.2, 0.5, 1.0] });
});

// --- toggleAnnotation ---

test("@toggle default 0", () => {
  const s = findStruct(`struct S { @toggle invert: u32 }`);
  expect(toggleAnnotation(s.members[0])).toEqual({ initial: 0 });
});

test("@toggle(1)", () => {
  const s = findStruct(`struct S { @toggle(1) invert: u32 }`);
  expect(toggleAnnotation(s.members[0])).toEqual({ initial: 1 });
});

// --- autoAnnotation ---

test("@auto infers name from field", () => {
  const s = findStruct(`struct S { @auto time: f32 }`);
  expect(autoAnnotation(s.members[0])).toEqual({ autoName: "time" });
});

test("@auto(mouse_pos) explicit name", () => {
  const s = findStruct(`struct S { @auto(mouse_pos) mp: vec2f }`);
  expect(autoAnnotation(s.members[0])).toEqual({ autoName: "mouse_pos" });
});

// --- annotatedLayout ---

test("classifies mixed struct", () => {
  const s = findStruct(`
    @uniforms struct S {
      @auto resolution: vec2f,
      @auto time: f32,
      @range(0.0, 1.0, 0.5) slider: f32,
      @color(1.0, 0.0, 0.0) tint: vec3f,
      @toggle flip: u32,
      plain_data: vec4f,
    }
  `);
  const layout = annotatedLayout(s);
  expect(layout.structName).toBe("S");
  expect(layout.controls).toHaveLength(3);
  expect(layout.fields).toHaveLength(3);

  // controls
  expect(layout.controls[0].kind).toBe("range");
  expect(layout.controls[0].name).toBe("slider");
  expect(layout.controls[1].kind).toBe("color");
  expect(layout.controls[1].name).toBe("tint");
  expect(layout.controls[2].kind).toBe("toggle");
  expect(layout.controls[2].name).toBe("flip");

  // fields
  expect(layout.fields[0]).toMatchObject({
    kind: "auto",
    name: "resolution",
    autoName: "resolution",
  });
  expect(layout.fields[1]).toMatchObject({
    kind: "auto",
    name: "time",
    autoName: "time",
  });
  expect(layout.fields[2]).toMatchObject({ kind: "plain", name: "plain_data" });
});

test("layout offsets are correct", () => {
  const s = findStruct(`
    struct S {
      @auto resolution: vec2f,
      @auto time: f32,
      @range(0.0, 10.0) x: f32,
    }
  `);
  const layout = annotatedLayout(s);
  expect(layout.fields[0]).toMatchObject({
    name: "resolution",
    offset: 0,
    size: 8,
  });
  expect(layout.fields[1]).toMatchObject({ name: "time", offset: 8, size: 4 });
  expect(layout.controls[0]).toMatchObject({ name: "x", offset: 12, size: 4 });
  expect(layout.layout.bufferSize).toBe(16);
});

test("empty struct produces empty controls and fields", () => {
  const s = findStruct(`struct S {}`);
  const layout = annotatedLayout(s);
  expect(layout.controls).toHaveLength(0);
  expect(layout.fields).toHaveLength(0);
});
