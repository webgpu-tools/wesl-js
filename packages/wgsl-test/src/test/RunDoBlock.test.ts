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

@test
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

@test
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

@test
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

@test
do test_recurse() { a(); }
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_recurse" }),
  ).rejects.toThrow(/recursion depth/);
});

test("a terminating recursive do block runs once per level", async () => {
  // reduce-style halving: each level bumps data[0] once, then recurses on
  // count/2 until count <= 1, so 8 -> 4 -> 2 -> 1 records 4 passes.
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn step() { data[0] = data[0] + 1u; }

do reduce(count: u32) {
  step(1, 1, 1);
  if count > 1u { reduce(count / 2u); }
}

@test
do test_reduce() { reduce(8u); }
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_reduce",
  });
  expect(result.data).toEqual([4]);
});

test("a do block binds its call arguments to its params", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_one(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

do dispatch_n(n: u32) { fill_one(n, 1, 1); }

@test
do test_args() { dispatch_n(4u); }
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_args",
  });
  expect(result.data).toEqual([1, 2, 3, 4]);
});

test("a called do block does not see the caller's locals", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn noop() { data[0] = 0u; }

do uses_x() { let y = x; noop(); }

@test
do test_scope() {
  var x = 9u;
  uses_x();
}
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_scope" }),
  ).rejects.toThrow(/unbound name 'x'/);
});

test("calling a do block with the wrong argument count is rejected", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn noop() { data[0] = 0u; }

do needs_one(n: u32) { noop(); }

@test
do test_arity() { needs_one(); }
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_arity" }),
  ).rejects.toThrow(/expected 1 argument\(s\), got 0/);
});

test("if at the do-block level conditionally drives a dispatch", async () => {
  // step writes 1 at index 0; the else branch never runs, so data[1] stays 0.
  const src = `
@buffer var<storage, read_write> data: array<u32, 2>;

@compute @workgroup_size(1) fn step(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = 1u;
}

@test
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

@test
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

@test
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

@test
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

@test
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

@test
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

test("loop continuing { break if } honors its condition", async () => {
  // bump() adds 1 to data[0] per pass. The continuing block increments i and
  // breaks once i >= 4, so the body runs 4 times => data[0] == 4. A regression
  // that treats `break if` as an unconditional break would stop after one pass.
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn bump() { data[0] = data[0] + 1u; }

@test
do test_continuing() {
  var i = 0u;
  loop {
    bump(1, 1, 1);
    continuing {
      i++;
      break if i >= 4u;
    }
  }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_continuing",
  });
  expect(result.data).toEqual([4, 0, 0, 0]);
});

test("else-if branch runs when the first condition is false", async () => {
  // dispatch width selects the branch: width 2 => only the else-if ran.
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test
do test_elif() {
  if 0u > 1u { fill_at(1, 1, 1); }
  else if 1u > 0u { fill_at(2, 1, 1); }
  else { fill_at(3, 1, 1); }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_elif",
  });
  expect(result.data).toEqual([1, 2, 0, 0]);
});

test("plain else branch runs when every condition is false", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test
do test_else() {
  if 0u > 1u { fill_at(1, 1, 1); } else { fill_at(3, 1, 1); }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_else",
  });
  expect(result.data).toEqual([1, 2, 3, 0]);
});

test("return (from a nested if) ends the do block early", async () => {
  // fill_at(1) runs, then the return short-circuits the trailing fill_at(4).
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test
do test_return() {
  fill_at(1, 1, 1);
  if 1u > 0u { return; }
  fill_at(4, 1, 1);
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_return",
  });
  expect(result.data).toEqual([1, 0, 0, 0]);
});

test("a var shadowed in a nested block leaves the outer binding intact", async () => {
  // inner `var n` shadows; the outer n stays 2, so the dispatch width is 2.
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test
do test_shadow() {
  var n = 2u;
  { var n = 4u; }
  fill_at(n, 1, 1);
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_shadow",
  });
  expect(result.data).toEqual([1, 2, 0, 0]);
});

test("mutating an outer var from a nested block is visible afterwards", async () => {
  // the nested block mutates (not re-declares) n, so n is 3 after the block.
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test
do test_nested_mut() {
  var n = 1u;
  { n += 2u; }
  fill_at(n, 1, 1);
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_nested_mut",
  });
  expect(result.data).toEqual([1, 2, 3, 0]);
});

test("a for loop with empty clauses (for(;;)) runs until break", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test
do test_empty_for() {
  var i = 1u;
  for (;;) {
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
    blockName: "test_empty_for",
  });
  expect(result.data).toEqual([1, 2, 3, 0]);
});

test("discard in a do block is rejected as fragment-only", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn step() { data[0] = 1u; }

@test
do test_discard() {
  discard;
  step(1, 1, 1);
}
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_discard" }),
  ).rejects.toThrow(/discard.*has no meaning/);
});

test("integer division by zero is rejected, not silently NaN", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn step() { data[0] = 1u; }

@test
do test_div_zero() {
  var d = 0u;
  let q = 4u / d;
  step(1, 1, 1);
}
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_div_zero" }),
  ).rejects.toThrow(/division by zero/);
});

test("a non-terminating loop fails fast at the iteration ceiling", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn step() { data[0] = 1u; }

@test
do test_infinite() {
  loop { }
}
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({
      device,
      ast,
      shaderSrc: src,
      blockName: "test_infinite",
      maxIterations: 1000,
    }),
  ).rejects.toThrow(/exceeded 1000 iterations/);
});

test("decrementing a u32 below zero wraps like subtraction", async () => {
  // `i--` at i == 0 must match `i - 1u` (4294967295), not yield -1. Observe
  // via a comparison so we don't dispatch billions of workgroups.
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test
do test_dec_wrap() {
  var i = 0u;
  i--;
  if i > 1000u { fill_at(2, 1, 1); } else { fill_at(1, 1, 1); }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_dec_wrap",
  });
  expect(result.data).toEqual([1, 2, 0, 0]);
});

test("u32 subtraction underflow wraps modulo 2^32, not to a negative", async () => {
  // `i - 1u` with i == 0 is 4294967295 in WGSL u32, not -1. Observe via a
  // comparison so we don't dispatch billions of workgroups: only the wrapped
  // (large) value is > 1000u, which selects the width-2 dispatch.
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test
do test_u32_wrap() {
  var i = 0u;
  let wrapped = i - 1u;
  if wrapped > 1000u { fill_at(2, 1, 1); } else { fill_at(1, 1, 1); }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_u32_wrap",
  });
  expect(result.data).toEqual([1, 2, 0, 0]);
});

test(">> on a negative i32 is an arithmetic (sign-extending) shift", async () => {
  // -8 >> 1 is -4 (arithmetic) in WGSL i32; a logical shift would give a large
  // positive. Observe via the sign: only the arithmetic result stays < 0.
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test
do test_shr() {
  var n = -8;
  let h = n >> 1;
  if h < 0 { fill_at(2, 1, 1); } else { fill_at(1, 1, 1); }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_shr",
  });
  expect(result.data).toEqual([1, 2, 0, 0]);
});

test("a float literal is rejected as unsupported", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn step() { data[0] = 1u; }

@test
do test_float() {
  let x = 1.5;
  step(1, 1, 1);
}
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_float" }),
  ).rejects.toThrow(/not yet supported \(WGSL numeric types\)/);
});

test("hex integer literals parse, including an uppercase digit", async () => {
  // 0x3u is 3; 0x1F is 31 (the trailing 'F' is a hex digit, not an 'f' suffix).
  const src = `
@buffer var<storage, read_write> data: array<u32, 4>;

@compute @workgroup_size(1) fn fill_at(@builtin(workgroup_id) g: vec3u) {
  data[g.x] = g.x + 1u;
}

@test
do test_hex() {
  let a = 0x3u;
  let b = 0x1F;
  if b == 31 { fill_at(a, 1, 1); }
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_hex",
  });
  expect(result.data).toEqual([1, 2, 3, 0]);
});

test("reassigning a let binding is rejected as immutable", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn step() { data[0] = 1u; }

@test
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

test("writing to a buffer element is rejected as unsupported", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn step() { data[0] = 1u; }

@test
do test_buffer_write() {
  data[0] = 5u;
  step(1, 1, 1);
}
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_buffer_write" }),
  ).rejects.toThrow(/not yet supported \(CPU-to-GPU buffer writes\)/);
});

test("a negative dispatch dimension is rejected", async () => {
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn step() { data[0] = 1u; }

@test
do test_neg_dispatch() {
  let n = -1;
  step(n, 1, 1);
}
`;
  const ast = parseTest(src);
  await expect(
    runDoBlock({ device, ast, shaderSrc: src, blockName: "test_neg_dispatch" }),
  ).rejects.toThrow(/dispatch dimension must be a non-negative integer/);
});

test("u32 multiply wraps at 2^32 without losing precision", async () => {
  // 0x10000001 squared is 0x100000020000001; its low 32 bits end in ...0001, so
  // & 3 is 1. A lossy double multiply drops that low bit and yields 0, which
  // would dispatch 0 workgroups and leave data[0] at its cleared 0.
  const src = `
@buffer var<storage, read_write> data: array<u32, 1>;

@compute @workgroup_size(1) fn fill() { data[0] = 7u; }

@test
do test_mul_wrap() {
  let n = (0x10000001u * 0x10000001u) & 3u;
  fill(n, 1, 1);
}
`;
  const ast = parseTest(src);
  const result = await runDoBlock({
    device,
    ast,
    shaderSrc: src,
    blockName: "test_mul_wrap",
  });
  expect(result.data).toEqual([7]);
});
