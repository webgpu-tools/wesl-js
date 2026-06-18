import { expect, test } from "vitest";
import type { CallElem, DoBlockElem } from "../AbstractElems.ts";
import { freshResolver, RecordResolver } from "../ModuleResolver.ts";
import { linkTestOpts, parseTest } from "./TestUtil.ts";

/** `do` blocks are an opt-in WESL extension (default off). */
const doExt = { weslExtensions: { doBlocks: true } } as const;

const example1 = `
@buffer var<storage, read_write> grid: array<f32, 64>;

@compute @workgroup_size(8)
fn jacobi_step(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i > 0u && i < 63u) { grid[i] = (grid[i - 1u] + grid[i + 1u]) * 0.5; }
}

@test @entry
do test_jacobi() {
  for (var i = 0u; i < 100u; i++) { jacobi_step(8, 1, 1); }
}
`;

const example2 = `
do reduce(count: u32) {
  let groups = count / 256u;
  if groups > 1u {
    reduce_step(groups, 1, 1);
    reduce(groups);
  } else {
    reduce_step(1, 1, 1);
  }
}

@entry
do frame(u: Uniforms, @slider(1, 100) steps: u32) {
  if u.frame == 0u { init_min_max(1, 1, 1); }
  for (var i = 0u; i < steps; i++) {
    step_sim(u.resolution.x / 8u, u.resolution.y / 8u, 1);
  }
  render();
}
`;

function doBlocks(src: string): DoBlockElem[] {
  const ast = parseTest(src, doExt);
  return ast.moduleElem.contents.filter(
    (e): e is DoBlockElem => e.kind === "do",
  );
}

test("parse do block: helper + entry, params, control flow", () => {
  const blocks = doBlocks(example1);
  expect(blocks).toHaveLength(1);
  const [block] = blocks;
  expect(block.name.name).toBe("test_jacobi");
  expect(block.params).toHaveLength(0);
  expect(block.body.contents.length).toBeGreaterThan(0);
});

test("do body call-expressions expose structured .arguments", () => {
  // Expressions are first-class AST nodes, so call args are typed ExpressionElem
  // trees - the interpreter reads them directly.
  const src = `
    do tick() {
      fill(1, 1, 1);
    }
  `;
  const [block] = doBlocks(src);
  const stmt = block.body.contents.find(
    (c): c is CallElem => c.kind === "call",
  );
  expect(stmt).toBeDefined();
  const call = stmt!.call;
  expect(call.arguments).toHaveLength(3);
  expect(call.arguments.every(a => a.kind === "literal")).toBe(true);
});

test("parse do blocks: recursion, if/else, uniforms + slider params", () => {
  const blocks = doBlocks(example2);
  expect(blocks.map(b => b.name.name)).toEqual(["reduce", "frame"]);

  const [reduce, frame] = blocks;
  expect(reduce.params).toHaveLength(1);
  expect(reduce.params[0].name.decl.ident.originalName).toBe("count");

  expect(frame.params).toHaveLength(2);
  expect(frame.params.map(p => p.name.decl.ident.originalName)).toEqual([
    "u",
    "steps",
  ]);
  expect(frame.body.contents.length).toBeGreaterThan(0);
});

test("link drops the do block, keeps surrounding declarations", async () => {
  const wgsl = await linkTestOpts(doExt, example1);
  expect(wgsl).toContain("fn jacobi_step");
  expect(wgsl).toContain("grid");
  expect(wgsl).toContain("@compute");
  expect(wgsl).not.toContain("test_jacobi");
  expect(wgsl).not.toMatch(/(^|\s)do\s/);
});

test("do block body links without spurious binding errors", async () => {
  // example2 has no fn/global decls, only do blocks: a clean emit proves the
  // do bodies (u.frame, steps, step_sim, render, reduce) bypass bindIdents.
  const wgsl = await linkTestOpts(doExt, example2);
  for (const name of [
    "reduce",
    "frame",
    "step_sim",
    "render",
    "Uniforms",
    "init_min_max",
  ]) {
    expect(wgsl).not.toContain(name);
  }
});

test("error: fn and do block with the same name", () => {
  const src = `
    fn reduce() {}
    do reduce() {}
  `;
  expect(() => parseTest(src, doExt)).toThrow(/declared as both fn and do/);
});

test("default off: do block syntax is not recognized without the extension", () => {
  // Without the extension, `do` stays a reserved word and module-level `do`
  // fails to parse (no DoBlockElem is produced).
  expect(() => parseTest(example1)).toThrow();
  expect(() => parseTest("@entry do tick() {}")).toThrow();
});

test("freshResolver preserves weslExtensions across re-parse", () => {
  // Resolver reuse re-parses via parseSrcModule(ast.srcModule, ast.parseOptions);
  // the do-block extension must survive that round trip.
  const src = "@entry do tick() {}";
  const inner = new RecordResolver({ "package::main": src }, doExt);
  const wrapped = freshResolver(freshResolver(inner));
  const ast = wrapped.resolveModule("package::main")!;
  const blocks = ast.moduleElem.contents.filter(
    (e): e is DoBlockElem => e.kind === "do",
  );
  expect(blocks.map(b => b.name.name)).toEqual(["tick"]);

  // an optionless resolver stays OFF (fails to parse `do`, as before)
  const off = freshResolver(new RecordResolver({ "package::main": src }));
  expect(() => off.resolveModule("package::main")).toThrow();
});

test("regression: a normal fn named do_something is unaffected", async () => {
  const wgsl = await linkTestOpts({}, "fn do_something() {}");
  expect(wgsl).toContain("fn do_something");
});

test("regression: do as a reserved word still errors when the extension is off", () => {
  expect(() => parseTest("fn f() { do }")).toThrow(/Expected ';'/);
});
