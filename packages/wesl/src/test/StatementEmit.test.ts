import { expect, test } from "vitest";
import { linkTest } from "./TestUtil.ts";
import { expectTrimmedMatch } from "./TrimmedMatch.ts";

// Statements are emitted structurally from typed AST fields (not by copying
// source text), so these tests lock the canonical layout and confirm that
// comments attached to statements survive linking.

test("linked WGSL keeps leading and trailing body comments", async () => {
  const src = `
    fn main() {
      // leading comment
      let x = 1; // trailing comment
      let y = x;
    }
  `;
  const result = await linkTest(src);
  expect(result).toContain("// leading comment");
  expect(result).toContain("// trailing comment");
  // leading comment on its own line above the statement, trailing kept inline
  expectTrimmedMatch(result, src);
});

test("linked WGSL keeps a comment in an otherwise empty block", async () => {
  const src = `
    fn foo() {
      // fooImpl
    }
  `;
  const result = await linkTest(src);
  expect(result).toContain("// fooImpl");
  expectTrimmedMatch(result, src);
});

test("structural emit of control flow", async () => {
  const src = `
    fn main() {
      var i = 0;
      if i < 10 {
        i = i + 1;
      } else if i < 20 {
        i += 2;
      } else {
        i = 0;
      }
      for (var j = 0; j < 4; j++) {
        i = i + j;
      }
      while i > 0 {
        i = i - 1;
      }
    }
  `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("structural emit of loop, continuing, and switch", async () => {
  const src = `
    fn main() {
      var i = 0;
      loop {
        i = i + 1;
        continuing {
          break if i > 100;
        }
      }
      switch i {
        case 0, 1: {
          i = 5;
        }
        default: {
          i = 9;
        }
      }
    }
  `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});
