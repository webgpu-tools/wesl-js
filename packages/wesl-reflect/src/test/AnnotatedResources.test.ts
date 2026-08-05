import { expect, test } from "vitest";
import {
  link,
  linkWithResolver,
  parseSrcModule,
  RecordResolver,
  type WeslAST,
} from "wesl";
import {
  annotatedResourcesPlugin,
  findAnnotatedResources,
} from "../AnnotatedResources.ts";

function parse(src: string): WeslAST {
  return parseSrcModule({
    modulePath: "test",
    debugFilePath: "test.wesl",
    src,
  });
}

test("discovers @buffer var", () => {
  const ast = parse(`
@buffer var<storage, read_write> data: array<f32, 4>;
`);
  const resources = findAnnotatedResources(ast);
  expect(resources).toHaveLength(1);
  const r = resources[0];
  expect(r.kind).toBe("buffer");
  expect(r.varName).toBe("data");
  if (r.kind === "buffer") {
    expect(r.access).toBe("read_write");
    expect(r.byteSize).toBe(16);
  }
});

test("discovers @buffer read-only var", () => {
  const ast = parse(`
@buffer var<storage, read> input: array<u32, 8>;
`);
  const resources = findAnnotatedResources(ast);
  const r = resources[0];
  if (r.kind === "buffer") {
    expect(r.access).toBe("read");
    expect(r.byteSize).toBe(32);
  }
});

test("discovers @test_texture var", () => {
  const ast = parse(`
@test_texture(checkerboard, 256, 256, 16) var tex: texture_2d<f32>;
`);
  const r = findAnnotatedResources(ast)[0];
  expect(r.kind).toBe("test_texture");
  expect(r.varName).toBe("tex");
  if (r.kind === "test_texture") {
    expect(r.source).toBe("checkerboard");
    expect(r.params).toEqual([256, 256, 16]);
  }
});

test("discovers @sampler var", () => {
  const ast = parse(`
@sampler(nearest) var samp: sampler;
`);
  const r = findAnnotatedResources(ast)[0];
  expect(r.kind).toBe("sampler");
  if (r.kind === "sampler") expect(r.filter).toBe("nearest");
});

test("discovers multiple resources", () => {
  const ast = parse(`
@test_texture(gradient, 256, 256) var grad: texture_2d<f32>;
@sampler(linear) var samp: sampler;
@buffer var<storage, read_write> result: array<f32, 4>;
`);
  const resources = findAnnotatedResources(ast);
  expect(resources.map(r => r.kind)).toEqual([
    "test_texture",
    "sampler",
    "buffer",
  ]);
});

test("ignores non-annotated vars", () => {
  const ast = parse(`
@group(0) @binding(0) var<storage, read_write> existing: array<f32, 4>;
@buffer var<storage, read_write> data: array<f32, 4>;
`);
  const resources = findAnnotatedResources(ast);
  expect(resources).toHaveLength(1);
  expect(resources[0].varName).toBe("data");
});

test("buffer byte size for vec4f array", () => {
  const ast = parse(`
@buffer var<storage, read_write> data: array<vec4f, 2>;
`);
  const r = findAnnotatedResources(ast)[0];
  if (r.kind === "buffer") expect(r.byteSize).toBe(32);
});

test("plugin emits @group/@binding for all annotation kinds", async () => {
  const src = `
@buffer var<storage, read_write> data: array<f32, 4>;
@test_texture(checkerboard, 256, 256) var tex: texture_2d<f32>;
@sampler(linear) var samp: sampler;

@compute @workgroup_size(1)
fn main() {
  data[0] = textureSampleLevel(tex, samp, vec2f(0.0), 0.0).r;
}
`;
  const resources = findAnnotatedResources(parse(src));
  const linked = await link({
    weslSrc: { main: src },
    rootModuleName: "main",
    config: { plugins: [annotatedResourcesPlugin(resources, 1)] },
  });
  const out = linked.dest;
  expect(out).toMatch(
    /@group\(0\)\s*@binding\(1\)\s+var<storage, read_write> data/,
  );
  expect(out).toMatch(/@group\(0\)\s*@binding\(2\)\s+var tex: texture_2d<f32>/);
  expect(out).toMatch(/@group\(0\)\s*@binding\(3\)\s+var samp: sampler/);
  // wgsl-test annotations drop from output (non-WGSL attributes).
  expect(out).not.toContain("@buffer");
  expect(out).not.toContain("@test_texture");
  expect(out).not.toContain("@sampler");
});

test("discovers @texture(name) var with typeName", () => {
  const ast = parse(`
@texture(nebula) var photo: texture_2d<f32>;
`);
  const r = findAnnotatedResources(ast)[0];
  expect(r.kind).toBe("texture");
  if (r.kind === "texture") {
    expect(r.varName).toBe("photo");
    expect(r.source).toBe("nebula");
    expect(r.typeName).toBe("texture_2d");
  }
});

test("@texture plugin emits @group/@binding", async () => {
  const src = `
@texture(nebula) var photo: texture_2d<f32>;
@sampler(linear) var samp: sampler;

@fragment fn fs() -> @location(0) vec4f {
  return textureSample(photo, samp, vec2f(0.0));
}
`;
  const resources = findAnnotatedResources(parse(src));
  const linked = await link({
    weslSrc: { main: src },
    rootModuleName: "main",
    config: { plugins: [annotatedResourcesPlugin(resources, 1)] },
  });
  expect(linked.dest).toMatch(
    /@group\(0\)\s*@binding\(1\)\s+var photo: texture_2d<f32>/,
  );
  expect(linked.dest).not.toContain("@texture");
});

test("relinking with the plugin doesn't accumulate attributes in the ast", async () => {
  const src = `
@buffer var<storage, read_write> data: array<f32, 4>;

@compute @workgroup_size(1) fn main() { data[0] = 1.0; }
`;
  // one resolver, so both links share the same parsed (and immutable) ast
  const resolver = new RecordResolver({ main: src });
  const plugins = [
    annotatedResourcesPlugin(findAnnotatedResources(parse(src))),
  ];
  const params = { resolver, rootModuleName: "main", config: { plugins } };

  const first = await linkWithResolver(params);
  const second = await linkWithResolver(params);
  expect(second.dest).toBe(first.dest);
  expect(first.dest).toMatch(/@group\(0\)\s*@binding\(1\)\s+var<storage/);
});

test("plugin errors on @buffer with user @group/@binding", async () => {
  const src = `
@buffer @group(0) @binding(5) var<storage, read_write> data: array<f32, 4>;

@compute @workgroup_size(1) fn main() { data[0] = 1.0; }
`;
  const resources = findAnnotatedResources(parse(src));
  await expect(
    link({
      weslSrc: { main: src },
      rootModuleName: "main",
      config: { plugins: [annotatedResourcesPlugin(resources, 1)] },
    }),
  ).rejects.toThrow(/cannot be combined with user-supplied @group\/@binding/);
});
