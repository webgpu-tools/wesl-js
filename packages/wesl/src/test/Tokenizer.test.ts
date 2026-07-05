import { expect, test } from "vitest";
import { WeslStream, type WeslToken } from "../parse/WeslStream";

test("tokenize empty string", () => {
  const tokenizer = new WeslStream("");
  expect(tokenizer.nextToken()).toEqual(null);
});

test("parse fn foo() { }", () => {
  const src = "fn foo() { }";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()).toEqual({
    kind: "keyword",
    text: "fn",
    span: [0, 2],
  } as WeslToken);
  expect(tokenizer.nextToken()).toEqual({
    kind: "word",
    text: "foo",
    span: [3, 6],
  } as WeslToken);
  expect(tokenizer.nextToken()).toEqual({
    kind: "symbol",
    text: "(",
    span: [6, 7],
  } as WeslToken);
  expect(tokenizer.nextToken()).toEqual({
    kind: "symbol",
    text: ")",
    span: [7, 8],
  } as WeslToken);
});

test("parse var<storage> lights : vec3<f32>", () => {
  const src = "var<storage> lights : vec3<f32>";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()).toEqual({
    kind: "keyword",
    text: "var",
    span: [0, 3],
  } as WeslToken);
  expect(tokenizer.nextToken()).toEqual({
    kind: "symbol",
    text: "<",
    span: [3, 4],
  } as WeslToken);
  expect(tokenizer.nextToken()).toEqual({
    kind: "word",
    text: "storage",
    span: [4, 11],
  } as WeslToken);
  expect(tokenizer.nextToken()).toEqual({
    kind: "symbol",
    text: ">",
    span: [11, 12],
  } as WeslToken);
  expect(tokenizer.nextToken()?.text).toEqual("lights");
  expect(tokenizer.nextToken()?.text).toEqual(":");
  expect(tokenizer.nextToken()?.text).toEqual("vec3");
  expect(tokenizer.nextToken()).toEqual({
    kind: "symbol",
    text: "<",
    span: [26, 27],
  } as WeslToken);
  expect(tokenizer.nextToken()?.text).toEqual("f32");
  expect(tokenizer.nextToken()?.text).toEqual(">");
});

test("parse >>", () => {
  const src = ">>";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()).toEqual({
    kind: "symbol",
    text: ">>",
    span: [0, 2],
  } as WeslToken);
});

test("parse >> as template", () => {
  const src = "array<foo >>";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()).toEqual({
    kind: "word",
    text: "array",
    span: [0, 5],
  } as WeslToken);
  expect(tokenizer.nextTemplateStartToken()).toEqual({
    kind: "symbol",
    text: "<",
    span: [5, 6],
  } as WeslToken);
  expect(tokenizer.nextToken()).toEqual({
    kind: "word",
    text: "foo",
    span: [6, 9],
  } as WeslToken);
  expect(tokenizer.nextTemplateEndToken()).toEqual({
    kind: "symbol",
    text: ">",
    span: [10, 11],
  } as WeslToken);
  expect(tokenizer.nextToken()).toEqual({
    kind: "symbol",
    text: ">",
    span: [11, 12],
  } as WeslToken);
  expect(tokenizer.nextToken()).toBe(null);
});

test("template discovery ignores > inside comments", () => {
  const src = "a < b /* > */ ;";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()?.text).toBe("a");
  expect(tokenizer.nextTemplateStartToken()).toBe(null);
});

test("template discovery sees comments inside template lists", () => {
  const src = "array< /* len */ f32, 4 >";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()?.text).toBe("array");
  expect(tokenizer.nextTemplateStartToken()).toEqual({
    kind: "symbol",
    text: "<",
    span: [5, 6],
  } as WeslToken);
});

test("parse skip block comment", () => {
  const src = "/* /* // */ */vec3<f32>";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()).toEqual({
    kind: "word",
    text: "vec3",
    span: [14, 18],
  } as WeslToken);
});

test("parse skip line comment", () => {
  const src = "// vec3<f32> */ a\nvec3";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()).toEqual({
    kind: "word",
    text: "vec3",
    span: [18, 22],
  } as WeslToken);
});

test("parse skip line without newline", () => {
  const src = "// foo bar";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()).toBe(null);
  expect(tokenizer.checkpoint()).toBe(src.length);
});

test("unicode mid-word falls back with correct span", () => {
  const src = "réflexion x";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()).toEqual({
    kind: "word",
    text: "réflexion",
    span: [0, 9],
  } as WeslToken);
  expect(tokenizer.nextToken()?.span).toEqual([10, 11]);
});

test("surrogate-pair ident spans count UTF-16 units", () => {
  const src = "𐰓𐰏𐰇 x";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()).toEqual({
    kind: "word",
    text: "𐰓𐰏𐰇",
    span: [0, 6],
  } as WeslToken);
  expect(tokenizer.nextToken()?.span).toEqual([7, 8]);
});

test("underscore boundary: _é word, _x word, bare _ symbol", () => {
  const under = new WeslStream("_é _x _ x");
  expect(under.nextToken()).toEqual({
    kind: "word",
    text: "_é",
    span: [0, 2],
  } as WeslToken);
  expect(under.nextToken()).toEqual({
    kind: "word",
    text: "_x",
    span: [3, 5],
  } as WeslToken);
  expect(under.nextToken()).toEqual({
    kind: "symbol",
    text: "_",
    span: [6, 7],
  } as WeslToken);
});

test("unicode blankspace separates tokens", () => {
  const src = "a\u{2028}b\u{0085}c";
  const tokenizer = new WeslStream(src);
  expect(tokenizer.nextToken()?.span).toEqual([0, 1]);
  expect(tokenizer.nextToken()?.span).toEqual([2, 3]);
  expect(tokenizer.nextToken()?.span).toEqual([4, 5]);
  expect(tokenizer.nextToken()).toBe(null);
});

test("leading-dot float and 3-char symbols", () => {
  const src = "x >>= .5 <<= 0x1p4";
  const tokenizer = new WeslStream(src);
  tokenizer.nextToken(); // x
  expect(tokenizer.nextToken()).toEqual({
    kind: "symbol",
    text: ">>=",
    span: [2, 5],
  } as WeslToken);
  expect(tokenizer.nextToken()).toEqual({
    kind: "number",
    text: ".5",
    span: [6, 8],
  } as WeslToken);
  expect(tokenizer.nextToken()?.text).toBe("<<=");
  expect(tokenizer.nextToken()).toEqual({
    kind: "number",
    text: "0x1p4",
    span: [13, 18],
  } as WeslToken);
});

test("invalid character throws", () => {
  const tokenizer = new WeslStream("a # b");
  tokenizer.nextToken();
  expect(() => tokenizer.nextToken()).toThrow(/Invalid token #/);
});
