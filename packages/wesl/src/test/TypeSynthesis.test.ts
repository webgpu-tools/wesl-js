import { expect, test } from "vitest";
import { initType } from "./TypeTestUtil.ts";

test("integer literal is abstract-int", () => {
  expect(initType("const a = 1;", "a")).toBe("abstract-int");
  expect(initType("const a = 0x1F;", "a")).toBe("abstract-int");
});

test("float literals are abstract-float", () => {
  expect(initType("const a = 1.5;", "a")).toBe("abstract-float");
  expect(initType("const a = 1e3;", "a")).toBe("abstract-float");
});

test("suffixed literals are concrete", () => {
  expect(initType("const a = 1u;", "a")).toBe("u32");
  expect(initType("const a = 1i;", "a")).toBe("i32");
  expect(initType("const a = 1.5f;", "a")).toBe("f32");
  expect(initType("const a = 2f;", "a")).toBe("f32");
  expect(initType("const a = 1.5h;", "a")).toBe("f16");
  expect(initType("const a = true;", "a")).toBe("bool");
});

test("let materializes abstract types, const keeps them", () => {
  const src = "fn f() { let x = 1; let y = x; }";
  expect(initType(src, "y")).toBe("i32");
  expect(initType("const c = 1; const d = c;", "d")).toBe("abstract-int");
});

test("annotated decl uses its declared type", () => {
  expect(initType("const c: f32 = 1; const d = c;", "d")).toBe("f32");
});

test("override and var materialize their initializers", () => {
  const src = "override o = 1.5; fn f() { let y = o; }";
  expect(initType(src, "y")).toBe("f32");
  const vsrc = "var<private> v = vec2(0.5, 1.5); fn f() { let y = v; }";
  expect(initType(vsrc, "y")).toBe("vec2<f32>");
});

test("vector constructors infer element type from args", () => {
  const src = "fn f() { let v = vec3(1, 2, 3); let y = v; }";
  expect(initType(src, "y")).toBe("vec3<i32>"); // let materialized
  expect(initType("const v = vec3(1.0, 2.0, 3.0);", "v")).toBe(
    "vec3<abstract-float>",
  );
  expect(initType("const v = vec3f(0.0, 0.0, 0.0);", "v")).toBe("vec3<f32>");
  expect(initType("const v = vec2h();", "v")).toBe("vec2<f16>");
  expect(initType("const v = vec3<f32>(0.0);", "v")).toBe("vec3<f32>");
});

test("swizzles and vector indexing", () => {
  const src = `
    const v = vec3(1.0, 2.0, 3.0);
    const s = v.xy;
    const r = v.rgb;
    const e = v.z;
    const i = v[0];`;
  expect(initType(src, "s")).toBe("vec2<abstract-float>");
  expect(initType(src, "r")).toBe("vec3<abstract-float>");
  expect(initType(src, "e")).toBe("abstract-float");
  expect(initType(src, "i")).toBe("abstract-float");
});

test("matrix constructors and matrix arithmetic", () => {
  expect(initType("const m = mat2x2(1.0, 2.0, 3.0, 4.0);", "m")).toBe(
    "mat2x2<abstract-float>",
  );
  const mulVec = "fn f(m: mat2x3<f32>, v: vec2f) { let r = m * v; }";
  expect(initType(mulVec, "r")).toBe("vec3<f32>");
  const vecMul = "fn f(m: mat2x3<f32>, v: vec3f) { let r = v * m; }";
  expect(initType(vecMul, "r")).toBe("vec2<f32>");
  const matMul = "fn f(a: mat2x3<f32>, b: mat4x2<f32>) { let r = a * b; }";
  expect(initType(matMul, "r")).toBe("mat4x3<f32>");
  const scalarMul = "fn f(m: mat2x2<f32>) { let r = m * 2.0; }";
  expect(initType(scalarMul, "r")).toBe("mat2x2<f32>");
});

test("binary arithmetic promotes abstract operands", () => {
  expect(initType("const a = 1 + 2;", "a")).toBe("abstract-int");
  expect(initType("const a = 1 + 2.0;", "a")).toBe("abstract-float");
  expect(initType("fn f() { let a = 1u + 1; }", "a")).toBe("u32");
  expect(initType("fn f(x: f32) { let a = x * 2; }", "a")).toBe("f32");
});

test("vector-scalar arithmetic keeps the vector shape", () => {
  const src = "fn f(v: vec3f) { let a = v * 2.0; let b = 2.0 * v; }";
  expect(initType(src, "a")).toBe("vec3<f32>");
  expect(initType(src, "b")).toBe("vec3<f32>");
});

test("comparisons produce bool with the operand shape", () => {
  const src = "fn f(v: vec2f) { let c = v == v; let d = 1 < 2; }";
  expect(initType(src, "c")).toBe("vec2<bool>");
  expect(initType(src, "d")).toBe("bool");
});

test("shift keeps the left operand type", () => {
  expect(initType("fn f(a: u32) { let s = a << 2u; }", "s")).toBe("u32");
});

test("builtin overloads pick the lowest conversion rank", () => {
  expect(initType("const a = max(1, 2u);", "a")).toBe("u32");
  expect(initType("const a = max(1, 2);", "a")).toBe("abstract-int");
  expect(initType("const a = floor(1);", "a")).toBe("abstract-float");
  expect(initType("fn f(x: f32) { let a = clamp(x, 0.0, 1.0); }", "a")).toBe(
    "f32",
  );
});

test("ldexp ties the exponent's abstractness to e1", () => {
  // a concrete i32 exponent forces the abstract mantissa to materialize
  expect(initType("const a = ldexp(1.5, 2i);", "a")).toBe("f32");
  expect(initType("const a = ldexp(1.5, 2);", "a")).toBe("abstract-float");
  expect(initType("fn f(x: f16) { let a = ldexp(x, 2i); }", "a")).toBe("f16");
});

test("vector builtins", () => {
  expect(initType("const a = dot(vec2(1u, 2u), vec2(1u, 1u));", "a")).toBe(
    "u32",
  );
  expect(initType("fn f(v: vec3f) { let l = length(v); }", "l")).toBe("f32");
  expect(initType("fn f(v: vec3f) { let c = cross(v, v); }", "c")).toBe(
    "vec3<f32>",
  );
  expect(initType("const n = normalize(vec3(1.0, 2.0, 3.0));", "n")).toBe(
    "vec3<abstract-float>",
  );
  expect(initType("const s = select(1.0, 2.0, true);", "s")).toBe(
    "abstract-float",
  );
});

test("texture builtins use the texture argument", () => {
  const sampled = `
    var t: texture_2d<f32>;
    var s: sampler;
    fn f(uv: vec2f) { let c = textureSample(t, s, uv); }`;
  expect(initType(sampled, "c")).toBe("vec4<f32>");

  const load = `
    var t: texture_2d<u32>;
    fn f(p: vec2i) { let c = textureLoad(t, p, 0); }`;
  expect(initType(load, "c")).toBe("vec4<u32>");

  const dims = `
    var t: texture_2d<f32>;
    fn f() { let d = textureDimensions(t); }`;
  expect(initType(dims, "d")).toBe("vec2<u32>");

  const depth = `
    var t: texture_depth_2d;
    var s: sampler;
    fn f(uv: vec2f) { let c = textureSample(t, s, uv); }`;
  expect(initType(depth, "c")).toBe("f32");
});

test("sampling an unknown texture is unknown, not vec4", () => {
  // depth textures sample to f32, color to vec4; unknowable without the texture
  const src = `
    var s: sampler;
    fn f(t: f32, uv: vec2f) { let c = textureSample(t, s, uv); }`;
  expect(initType(src, "c")).toBe("unknown");
});

test("atomics and arrayLength", () => {
  const atomic = `
    var<workgroup> count: atomic<u32>;
    fn f() { let n = atomicAdd(&count, 1u); }`;
  expect(initType(atomic, "n")).toBe("u32");

  const len = `
    var<storage> arr: array<f32>;
    fn f() { let n = arrayLength(&arr); }`;
  expect(initType(len, "n")).toBe("u32");
});

test("bitcast uses its template argument", () => {
  expect(initType("fn f(x: f32) { let b = bitcast<u32>(x); }", "b")).toBe(
    "u32",
  );
});

test("data packing builtins", () => {
  expect(initType("fn f(v: vec2f) { let p = pack2x16float(v); }", "p")).toBe(
    "u32",
  );
  expect(initType("fn f(p: u32) { let v = unpack2x16float(p); }", "v")).toBe(
    "vec2<f32>",
  );
});

test("a call matching no overload is unknown, not an error", () => {
  expect(initType("fn f() { let r = max(true, 1); }", "r")).toBe("unknown");
});

test("frexp and modf return their predeclared result structs", () => {
  const frexpF32 = "fn f(x: f32) { let r = frexp(x); }";
  expect(initType(frexpF32, "r")).toBe("__frexp_result_f32");
  expect(initType("fn f(x: f32) { let r = frexp(x).fract; }", "r")).toBe("f32");
  expect(initType("fn f(x: f32) { let r = frexp(x).exp; }", "r")).toBe("i32");

  const modfVec = "fn f(v: vec3h) { let r = modf(v); }";
  expect(initType(modfVec, "r")).toBe("__modf_result_vec3_f16");
  expect(initType("fn f(v: vec3h) { let r = modf(v).whole; }", "r")).toBe(
    "vec3<f16>",
  );

  // a const keeps the abstract result struct, so its members stay abstract
  expect(initType("const e = frexp(1.0).exp;", "e")).toBe("abstract-int");
  // a let materializes it, which concretizes the members with it
  const let32 = "fn f() { let r = frexp(1.0); let e = r.exp; }";
  expect(initType(let32, "e")).toBe("i32");
});

test("atomicCompareExchangeWeak returns its result struct", () => {
  const src = `
    var<workgroup> count: atomic<u32>;
    fn f() {
      let r = atomicCompareExchangeWeak(&count, 0u, 1u);
      let old = r.old_value;
      let done = r.exchanged;
    }`;
  expect(initType(src, "r")).toBe("__atomic_compare_exchange_result<u32>");
  expect(initType(src, "old")).toBe("u32");
  expect(initType(src, "done")).toBe("bool");
});

test("zero value constructors take an abstract element type", () => {
  expect(initType("const v = vec4();", "v")).toBe("vec4<abstract-int>");
  expect(initType("const m = mat2x3();", "m")).toBe("mat2x3<abstract-float>");
  expect(initType("const v = vec2f();", "v")).toBe("vec2<f32>");
  expect(initType("const v = vec2<u32>();", "v")).toBe("vec2<u32>");
});

test("user function calls use the declared return type", () => {
  const src = "fn foo() -> vec2f { return vec2f(); } fn g() { let x = foo(); }";
  expect(initType(src, "x")).toBe("vec2<f32>");
  const noReturn = "fn foo() { } fn g() { let x = foo(); }";
  expect(initType(noReturn, "x")).toBe("void");
});

test("void builtins are void, not unknown", () => {
  const store =
    "fn f(p: ptr<storage, atomic<u32>>) { let r = atomicStore(p, 1u); }";
  expect(initType(store, "r")).toBe("void");
  expect(initType("fn f() { let r = workgroupBarrier(); }", "r")).toBe("void");
  // textureBarrier dispatches through textureFnType, not the signature table
  expect(initType("fn f() { let r = textureBarrier(); }", "r")).toBe("void");
});

test("struct member access and construction", () => {
  const src = `
    struct Point { pos: vec3f, w: f32 }
    fn f(p: Point) { let a = p.pos; let q = Point(vec3f(), 1.0); }`;
  expect(initType(src, "a")).toBe("vec3<f32>");
  expect(initType(src, "q")).toBe("Point");
});

test("struct members follow the link's conditions", () => {
  const src = `
    struct S { @if(BIG) size: vec4f, @else size: vec2f }
    fn f(s: S) { let m = s.size; }`;
  expect(initType(src, "m", { BIG: true })).toBe("vec4<f32>");
  expect(initType(src, "m", {})).toBe("vec2<f32>");
});

test("aliases resolve to their target type", () => {
  const src = "alias V = vec3<f32>; fn f(v: V) { let a = v.x; }";
  expect(initType(src, "a")).toBe("f32");
  const ctor = "alias V2 = vec2<f32>; const v = V2(1.0, 2.0);";
  expect(initType(ctor, "v")).toBe("vec2<f32>");
});

test("array types, including const-expression counts", () => {
  const src = `
    var<private> a: array<vec2<f32>, 4>;
    fn f() { let e = a[1]; }`;
  expect(initType(src, "e")).toBe("vec2<f32>");

  const counted = `
    const n = 2;
    fn f(a: array<f32, n * 2>) { let x = a; }`;
  expect(initType(counted, "x")).toBe("array<f32, 4>");

  expect(initType("const a = array(1, 2, 3);", "a")).toBe(
    "array<abstract-int, 3>",
  );

  // float-to-int conversion clamps (spec saturation); wrapping would go
  // negative here and reject the count entirely
  const clamped = "fn f(a: array<f32, i32(3e9)>) { let x = a; }";
  expect(initType(clamped, "x")).toBe("array<f32, 2147483647>");
});

test("pointers: address-of and deref", () => {
  expect(initType("fn f(p: ptr<function, f32>) { let v = *p; }", "v")).toBe(
    "f32",
  );
  const local = "fn g() { var x = 1.0; let p = &x; }";
  expect(initType(local, "p")).toBe("ptr<function, f32>");
  const global = "var<private> pv: vec3f; fn f() { let p = &pv; }";
  expect(initType(global, "p")).toBe("ptr<private, vec3<f32>>");
  // &(*p).field keeps the pointer's pointee space, not "function"
  const derefField =
    "struct S { x: f32 } fn f(p: ptr<storage, S>) { let q = &(*p).x; }";
  expect(initType(derefField, "q")).toBe("ptr<storage, f32>");
});

test("pointer composite access: p[i] and &p[i]", () => {
  const index = "fn f(p: ptr<function, array<f32, 4>>) { let v = p[0]; }";
  expect(initType(index, "v")).toBe("f32");
  const member =
    "struct S { x: f32 } fn f(p: ptr<storage, S>) { let v = p.x; }";
  expect(initType(member, "v")).toBe("f32");
  // the sugar forms keep the pointee's address space, like &(*p)[i]
  const addr = "fn f(p: ptr<storage, array<f32, 4>>) { let q = &p[1]; }";
  expect(initType(addr, "q")).toBe("ptr<storage, f32>");
});

test("types resolve across modules", () => {
  const root = `
    import package::file1::Light;
    fn f(l: Light) { let i = l.intensity; }`;
  const file1 = "struct Light { intensity: f32 }";
  expect(initType([root, file1], "i")).toBe("f32");
});

test("self-referential decl degrades to unknown", () => {
  expect(initType("const a = a;", "a")).toBe("unknown");
});
