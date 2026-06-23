import { expect, test } from "vitest";
import { findDoBlocks, findDoBlockTests } from "../DoBlockDiscovery.ts";
import { parseTest } from "./TestSupport.ts";

const pipelineSrc = `@test do test_pipeline() {}`;

test("findDoBlocks returns all `do` blocks", () => {
  const blocks = findDoBlocks(parseTest(pipelineSrc));
  expect(blocks.map(b => b.name)).toEqual(["test_pipeline"]);
  expect(blocks[0].isTest).toBe(true);
});

test("findDoBlockTests filters @test blocks", () => {
  const tests = findDoBlockTests(parseTest(pipelineSrc));
  expect(tests.map(t => t.name)).toEqual(["test_pipeline"]);
});

test("a helper do block (no @test) is not a test", () => {
  const ast = parseTest(`
    @compute @workgroup_size(1) fn step() {}
    do helper() { step(1, 1, 1); }
    @test do real_test() { step(1, 1, 1); }
  `);
  expect(findDoBlocks(ast).map(b => b.name)).toEqual(["helper", "real_test"]);
  expect(findDoBlockTests(ast).map(t => t.name)).toEqual(["real_test"]);
});
