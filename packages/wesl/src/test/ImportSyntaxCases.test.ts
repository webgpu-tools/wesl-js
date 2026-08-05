import { expect, test } from "vitest";
import { importSyntaxCases } from "wesl-testsuite";
import { parseErrorText, parseTest } from "./TestUtil.ts";

// Shared conformance cases: `fails` sources must report at least one
// diagnostic, the rest must parse cleanly.
for (const { src, fails } of importSyntaxCases) {
  if (fails) {
    test(`fails: ${src}`, () => {
      expect(parseErrorText(src)).not.toBe("");
    });
  } else {
    test(`parses: ${src}`, () => {
      parseTest(src);
    });
  }
}
