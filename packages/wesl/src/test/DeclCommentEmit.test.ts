import { expect, test } from "vitest";
import { linkTest } from "./TestUtil.ts";
import { expectTrimmedMatch } from "./TrimmedMatch.ts";

// Comments attached to declaration-level nodes (module decls, struct members,
// fn signatures) survive linking. Statement- and expression-level comments are
// covered in StatementEmit / ParseComments.

test("doc comment above a function", async () => {
  const src = `
    // describe foo
    fn foo() { }
  `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("doc comment above a struct", async () => {
  const src = `
    // a point
    struct Point { x: i32 }
  `;
  const result = await linkTest(src);
  expect(result).toContain("// a point");
});

test("doc comment above a global const", async () => {
  const src = `
    // the answer
    const answer = 42;
  `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("trailing comment on a global const", async () => {
  const src = `const answer = 42; // the answer`;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("leading comment on a struct member", async () => {
  const src = `
    struct S {
      // the x field
      x: i32,
      y: i32,
    }
  `;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("trailing comment on a struct member", async () => {
  const src = `
    struct S {
      x: i32, // horizontal
      y: i32,
    }
  `;
  const result = await linkTest(src);
  expect(result).toContain("// horizontal");
});

test("comment on a sole struct member forces the multi-line form", async () => {
  const src = `struct S { /* the field */ x: i32 }`;
  const result = await linkTest(src);
  expect(result).toContain("/* the field */");
  expect(result).toContain("x: i32");
});

test("comment leading a function parameter", async () => {
  const src = `fn foo(/* count */ n: i32) { }`;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("comment trailing a function parameter", async () => {
  const src = `fn foo(n: i32 /* count */) { }`;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("comment before a function name", async () => {
  const src = `fn /* the entry point */ main() { }`;
  const result = await linkTest(src);
  expectTrimmedMatch(result, src);
});

test("comment before a struct name", async () => {
  const src = `struct /* a point */ Point { x: i32 }`;
  const result = await linkTest(src);
  expect(result).toContain("/* a point */");
});

test("comment before an alias name", async () => {
  const src = `alias /* small int */ Byte = i32;`;
  const result = await linkTest(src);
  expect(result).toContain("/* small int */");
});

test("comment before a return type", async () => {
  const src = `fn one() -> /* always one */ i32 { return 1; }`;
  const result = await linkTest(src);
  expect(result).toContain("/* always one */");
});

test("comment trailing an attribute", async () => {
  const src = `@compute /* on the gpu */ @workgroup_size(1) fn main() { }`;
  const result = await linkTest(src);
  expect(result).toContain("/* on the gpu */");
});

test("comment before a local declaration name", async () => {
  const src = `
    fn main() {
      let /* result */ x = 1;
    }
  `;
  const result = await linkTest(src);
  expect(result).toContain("/* result */");
});
