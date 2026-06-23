import { expect, test } from "vitest";
import { parseSrcModule, type WeslAST } from "wesl";
import { classifyEntryPoints } from "../EntryPoints.ts";

function parse(src: string): WeslAST {
  return parseSrcModule({
    modulePath: "test",
    debugFilePath: "test.wesl",
    src,
  });
}

test("compute-only", () => {
  const eps = classifyEntryPoints(
    parse(`
      @compute @workgroup_size(8)
      fn main() {}
    `),
  );
  expect(eps).toEqual([
    { fnName: "main", stage: "compute", workgroupSize: [8, 1, 1] },
  ]);
});

test("workgroup_size with WGSL-suffixed literals", () => {
  const eps = classifyEntryPoints(
    parse(`
      @compute @workgroup_size(8u, 2u, 4u)
      fn main() {}
    `),
  );
  expect(eps).toEqual([
    { fnName: "main", stage: "compute", workgroupSize: [8, 2, 4] },
  ]);
});

test("fragment-only", () => {
  const eps = classifyEntryPoints(
    parse(`
      @fragment fn fs() -> @location(0) vec4f { return vec4f(0.0); }
    `),
  );
  expect(eps).toEqual([{ fnName: "fs", stage: "fragment" }]);
});

test("vertex + fragment", () => {
  const eps = classifyEntryPoints(
    parse(`
      @vertex fn vs() -> @builtin(position) vec4f { return vec4f(0.0); }
      @fragment fn fs() -> @location(0) vec4f { return vec4f(0.0); }
    `),
  );
  expect(eps.map(e => e.stage)).toEqual(["vertex", "fragment"]);
});

test("compute + fragment (caller rejects, classifier reports both)", () => {
  const eps = classifyEntryPoints(
    parse(`
      @compute @workgroup_size(1) fn c() {}
      @fragment fn f() -> @location(0) vec4f { return vec4f(0.0); }
    `),
  );
  expect(eps.map(e => e.stage)).toEqual(["compute", "fragment"]);
});

test("empty module", () => {
  expect(classifyEntryPoints(parse(""))).toEqual([]);
});

test("plain fn without stage attribute is not an entry point", () => {
  const eps = classifyEntryPoints(parse(`fn helper() -> f32 { return 1.0; }`));
  expect(eps).toEqual([]);
});

test("@workgroup_size with 2 args defaults z to 1", () => {
  const eps = classifyEntryPoints(
    parse(`@compute @workgroup_size(4, 2) fn main() {}`),
  );
  expect(eps[0].workgroupSize).toEqual([4, 2, 1]);
});

test("@workgroup_size with 3 args", () => {
  const eps = classifyEntryPoints(
    parse(`@compute @workgroup_size(4, 2, 8) fn main() {}`),
  );
  expect(eps[0].workgroupSize).toEqual([4, 2, 8]);
});

test("@compute without @workgroup_size yields undefined size", () => {
  const eps = classifyEntryPoints(parse(`@compute fn main() {}`));
  expect(eps[0]).toEqual({
    fnName: "main",
    stage: "compute",
    workgroupSize: undefined,
  });
});
