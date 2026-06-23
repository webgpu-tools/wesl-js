import { expect, type RunnerTestSuite } from "vitest";
import type { WgslTestSrc } from "wesl-testsuite";
import { link } from "../Linker.ts";
import { type ManglerFn, underscoreMangle } from "../Mangler.ts";
import { mapValues } from "../Util.ts";
import { expectTokenMatch } from "./TestUtil.ts";
import { trimSrc } from "./TrimmedMatch.ts";

/**
 * Link wesl sources and compare the linked wgsl against expectations.
 * These cases verify linking (imports, mangling, conditional compilation,
 * tree-shaking), not layout, so the comparison is token-based: whitespace and
 * comments are ignored, leaving line layout to the emit-specific tests.
 */
export async function testLink(
  weslSrc: Record<string, string>,
  rootModuleName: string,
  expectedWgsl: string,
  mangler?: ManglerFn,
): Promise<void> {
  const resultMap = await link({ weslSrc, rootModuleName, mangler });
  expectTokenMatch(resultMap.dest, expectedWgsl);
}

type CaseMap = Map<string, WgslTestSrc>;

/** Known formatting differences in parser output for specific test cases. */
const knownFormattingDifferences: Record<string, string> = {
  "@if on compound statement": `
    fn func() {
      {
      const foo = 10; }
    }`,
  "@if on if statement": `
    fn func() {
      if 0 < 1 {
      const foo = 10; }
    }`,
  "@if on loop statement": `
    fn func() {
      loop {
      const foo = 10; }
    }`,
  "@if on while statement": `
    fn func() {
      while true {
      const foo = 10; }
    }`,
  "@if on break statement": `
    fn foo() { while true {  break; } }
    fn bar() { while true {  } }`,
  "@if on switch statement": `
    fn func() {
      switch 0 { default: { let foo = 10; } }
    }`,
  "@if on switch clause": `
    fn func() {
      switch 0 {
        default: { let foo = 10; }
      }
    }`,
};

/** Test linking a single case from a shared test suite (ImportCases, etc.) */
export async function testFromCase(
  name: string,
  cases: CaseMap,
): Promise<void> {
  const testCase = cases.get(name);
  if (!testCase) throw new Error(`Skipping test "${name}"\nNo example found.`);

  const {
    weslSrc,
    expectedWgsl = "",
    underscoreWgsl = expectedWgsl,
  } = testCase;
  const trimmedWesl = mapValues(weslSrc, trimSrc);
  const rootName = Object.keys(weslSrc)[0];
  const expected = knownFormattingDifferences[name] || expectedWgsl;
  const underscoreExpected = knownFormattingDifferences[name] || underscoreWgsl;

  await testLink(trimmedWesl, rootName, expected);
  await testLink(trimmedWesl, rootName, underscoreExpected, underscoreMangle);
}

/** For afterAll(): verify all shared test suite cases are covered. */
export function verifyCaseCoverage(caseList: WgslTestSrc[]) {
  // biome-ignore lint/correctness/noEmptyPattern: vitest 4 requires destructuring for 1st arg
  return ({}: object, suite: RunnerTestSuite) => {
    const testNames = new Set(suite.tasks.map(t => t.name));
    const missing = caseList
      .map(c => c.name)
      .filter(name => !testNames.has(name));
    if (missing.length) {
      console.error("Missing tests for cases:", missing);
      expect("missing test: " + missing.toString()).toBe("");
    }
  };
}
