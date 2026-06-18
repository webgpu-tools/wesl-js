import { afterAll, beforeAll, expect, test } from "vitest";
import { runDoBlock } from "../RunDoBlock.ts";
import { runWesl } from "../TestWesl.ts";
import { destroySharedDevice, getGPUDevice } from "../WebGPUTestSetup.ts";
import { parseTest } from "./TestSupport.ts";

let device: GPUDevice;

const pipelineSrc = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1)
fn fill() { for (var i = 0u; i < 4u; i++) { data[i] = i + 1u; } }

@compute @workgroup_size(1)
fn double_it() { for (var i = 0u; i < 4u; i++) { data[i] = data[i] * 2u; } }

@test @entry
do test_pipeline() {
  fill(1, 1, 1);
  double_it(1, 1, 1);
}
`;

beforeAll(async () => {
  device = await getGPUDevice();
});

afterAll(() => {
  destroySharedDevice();
});

test("runWesl runs a simple test", async () => {
  const results = await runWesl({ device, src: pipelineSrc });
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe("test_pipeline");
  expect(results[0].passed).toBe(true);
});

test("external buffer validation: data = [2, 4, 6, 8]", async () => {
  const ast = parseTest(pipelineSrc);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: pipelineSrc,
    blockName: "test_pipeline",
  });
  expect(result.data).toEqual([2, 4, 6, 8]);
});

test("let binding evaluates and drives dispatch count", async () => {
  // fill_one writes `i+1` at index i; one element per workgroup, n workgroups.
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1)
fn fill_one(@builtin(workgroup_id) g: vec3u) { data[g.x] = g.x + 1u; }

@test @entry
do test_let() {
  let n = 4u;
  fill_one(n, 1, 1);
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_let",
  });
  expect(result.data).toEqual([1, 2, 3, 4]);
});

test("undefined entry-point call surfaces as a failure naming the block", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn defined() { data[0] = 1u; }

@test @entry
do test_missing() {
  defined(1, 1, 1);
  not_defined(1, 1, 1);
}
`;
  const results = await runWesl({ device, src });
  expect(results).toHaveLength(1);
  expect(results[0].passed).toBe(false);
  expect(results[0].message).toMatch(/test_missing/);
  expect(results[0].message).toMatch(/not_defined/);
});

test("depth guard fires at 256 for mutually-recursive straight-line do blocks", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn noop() { data[0] = 0u; }

do a() { b(); }
do b() { a(); }

@test @entry
do test_recurse() { a(); }
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_recurse" }),
  ).rejects.toThrow(/recursion depth/);
});

test("if at the do-block level conditionally drives a dispatch", async () => {
  // step writes 1 at index 0; the else branch never runs, so data[1] stays 0.
  const src = `
@buffer var<storage, read_write> data: array<u32, 2>;

@compute @workgroup_size(1) fn step(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = 1u;
}

@test @entry
do test_if() {
  if 1u > 0u { step(1, 1, 1); } else { step(2, 1, 1); }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_if",
  });
  expect(result.data).toEqual([1, 0]);
});

test("for loop drives N per-workgroup dispatches", async () => {
  // fill_at writes `i+1` at index i; each loop pass dispatches one workgroup
  // shifted by the loop counter via the workgroup id.
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test @entry
do test_for() {
  for (var i = 1u; i <= 4u; i++) { fill_at(i, 1, 1); }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_for",
  });
  expect(result.data).toEqual([1, 2, 3, 4]);
});

test("while loop dispatches until its condition fails", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test @entry
do test_while() {
  var n = 1u;
  while n <= 4u { fill_at(n, 1, 1); n += 1u; }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_while",
  });
  expect(result.data).toEqual([1, 2, 3, 4]);
});

test("mutable var + compound assignment drives the dispatch count", async () => {
  // start at 2, += 1, then ++ => 4 workgroups dispatched.
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test @entry
do test_var() {
  var n = 2u;
  n += 1u;
  n++;
  fill_at(n, 1, 1);
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_var",
  });
  expect(result.data).toEqual([1, 2, 3, 4]);
});

test("loop with break (inside a nested if) exits the loop, not the if", async () => {
  // The break is nested inside an `if` inside the loop; it must break the loop.
  // Dispatch widths 1,2,3, then break at 4 => data = [1,2,3,0].
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test @entry
do test_break() {
  var i = 1u;
  loop {
    if i > 3u { break; }
    fill_at(i, 1, 1);
    i++;
  }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_break",
  });
  expect(result.data).toEqual([1, 2, 3, 0]);
});

test("continue (inside a nested if) skips the rest of the loop body", async () => {
  // bump() adds 1 to data[0] per dispatch. continue at i == 2 skips that
  // iteration's dispatch, so 3 of the 4 iterations run => data[0] == 3.
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn bump() { data[0] = data[0] + 1u; }

@test @entry
do test_continue() {
  for (var i = 1u; i <= 4u; i++) {
    if i == 2u { continue; }
    bump(1, 1, 1);
  }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_continue",
  });
  expect(result.data).toEqual([3, 0, 0, 0]);
});

test("a float literal is rejected with a Tier 3 message", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn step() { data[0] = 1u; }

@test @entry
do test_float() {
  let x = 1.5;
  step(1, 1, 1);
}
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_float" }),
  ).rejects.toThrow(/Tier 3: WGSL numeric types/);
});

test("reassigning a let binding is rejected as immutable", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn step() { data[0] = 1u; }

@test @entry
do test_let_reassign() {
  let n = 1u;
  n = 2u;
  step(1, 1, 1);
}
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_let_reassign" }),
  ).rejects.toThrow(/cannot reassign immutable 'n'/);
});

test("writing to a buffer element is rejected as Tier 2.5", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn step() { data[0] = 1u; }

@test @entry
do test_buffer_write() {
  data[0] = 5u;
  step(1, 1, 1);
}
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_buffer_write" }),
  ).rejects.toThrow(/Tier 2\.5: CPU-to-GPU buffer writes/);
});
