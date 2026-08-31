import { expect, test } from "vitest";
import { SrcMapBuilder, type SrcWithPath } from "../SrcMap.ts";

const src: SrcWithPath = {
  text: "let x = lygia::math::consts::PI;\n  let x = 7;",
  path: "test.wesl",
};

test("destToSrc maps through fragments with differing src/dest lengths", () => {
  // dest "PI;\n  let x = 7;": "PI" replaces "lygia::math::consts::PI"
  const builder = new SrcMapBuilder(src);
  builder.add("PI", 8); // dest 0-2
  builder.add(";\n  let x = 7;", 33); // dest 2-16
  const map = SrcMapBuilder.build([builder]);

  expect(map.dest.text).toBe("PI;\n  let x = 7;");
  // "x" in "let x = 7" is at dest offset 10 (inside the second fragment)
  expect(map.destToSrc(10)).toEqual({ src, position: 41 }); // 33 + (10 - 2)
});

test("multi-builder maps use global dest offsets", () => {
  const srcA: SrcWithPath = { text: "fn a() {}", path: "a.wesl" };
  const srcB: SrcWithPath = { text: "fn b() {}", path: "b.wesl" };
  const a = new SrcMapBuilder(srcA);
  a.add("fn a() {}", 0);
  const b = new SrcMapBuilder(srcB);
  b.add("fn b() {}", 0);
  const map = SrcMapBuilder.build([a, b]);

  expect(map.dest.text).toBe("fn a() {}fn b() {}");
  expect(map.destToSrc(3)).toEqual({ src: srcA, position: 3 });
  // a position in the second module maps back into b.wesl, not a.wesl
  expect(map.destToSrc(12)).toEqual({ src: srcB, position: 3 });
});

test("a token starting at a fragment boundary maps to its own fragment", () => {
  const builder = new SrcMapBuilder(src);
  builder.add("let", 0); // dest 0-3
  builder.add("x", 10); // dest 3-4, starts on the boundary
  const map = SrcMapBuilder.build([builder]);

  // half-open fragments: the boundary belongs to the token, not the glue
  expect(map.destToSrc(3)).toEqual({ src, position: 10 });
});

test("appendNext glue anchors just past the previous fragment's source", () => {
  const builder = new SrcMapBuilder(src);
  builder.add("PI", 8); // dest 0-2, source 8
  builder.appendNext("; "); // glue: anchored at 8 + 2 = 10
  const map = SrcMapBuilder.build([builder]);

  expect(map.destToSrc(2)).toEqual({ src, position: 10 });
  expect(map.destToSrc(3)).toEqual({ src, position: 11 });
});

test("a position at the end of the dest text maps to the final fragment", () => {
  // zero-length diagnostics at EOF land exactly on dest.text.length
  const builder = new SrcMapBuilder(src);
  builder.add("PI", 8); // dest 0-2
  builder.add(";", 30); // dest 2-3
  const map = SrcMapBuilder.build([builder]);

  expect(map.destToSrc(3)).toEqual({ src, position: 31 }); // EOF, not identity
});

test("destToSrc past the mapped range falls back to dest identity", () => {
  const builder = new SrcMapBuilder(src);
  builder.add("abc", 0);
  const map = SrcMapBuilder.build([builder]);

  const result = map.destToSrc(5);
  expect(result.src).toBe(map.dest);
  expect(result.position).toBe(5);
});

test("untracked builders map to dest identity", () => {
  const builder = new SrcMapBuilder(src, false); // trackPositions: false
  builder.add("abc", 0);
  const map = SrcMapBuilder.build([builder]);

  expect(map.dest.text).toBe("abc");
  const result = map.destToSrc(1);
  expect(result.src).toBe(map.dest);
  expect(result.position).toBe(1);
});

test("a gap between mapped fragments falls back to dest identity", () => {
  // an untracked builder between two tracked ones leaves a hole in the index,
  // so a dest position inside it lands before the next fragment's start
  const first = new SrcMapBuilder(src);
  first.add("ab", 0); // dest 0-2
  const untracked = new SrcMapBuilder(src, false); // trackPositions: false
  untracked.add("??", 0); // dest 2-4, unmapped
  const last = new SrcMapBuilder(src);
  last.add("cd", 10); // dest 4-6
  const map = SrcMapBuilder.build([first, untracked, last]);

  expect(map.dest.text).toBe("ab??cd");
  expect(map.destToSrc(1)).toEqual({ src, position: 1 });
  const gap = map.destToSrc(3);
  expect(gap.src).toBe(map.dest);
  expect(gap.position).toBe(3);
  expect(map.destToSrc(4)).toEqual({ src, position: 10 });
});

test("glue after a synthetic fragment anchors past the last real fragment", () => {
  const builder = new SrcMapBuilder(src);
  builder.add("PI", 8); // dest 0-2, real source 8-10
  builder.addSynthetic("const c = 1;", "const c = 1;", 0); // dest 2-14
  builder.appendNext(";"); // dest 14-15: anchored at 10, not synthetic 12
  const map = SrcMapBuilder.build([builder]);

  expect(map.destToSrc(14)).toEqual({ src, position: 10 });
});

test("addSynthetic maps to the synthetic source text", () => {
  const builder = new SrcMapBuilder(src);
  builder.add("PI", 8); // dest 0-2
  // the emitted fragment and the synthetic source text happen to be identical
  builder.addSynthetic("const c = 1;", "const c = 1;", 0); // dest 2-14
  const map = SrcMapBuilder.build([builder]);

  const result = map.destToSrc(4);
  expect(result.src.text).toBe("const c = 1;");
  expect(result.position).toBe(2); // 0 + (4 - 2)
});
