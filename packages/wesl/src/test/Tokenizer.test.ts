import { expect, test } from "vitest";
import {
  WeslStream,
  type WeslToken,
  type WeslTokenKind,
} from "../parse/WeslStream";

/** @return an expected token, to compare against one from the stream */
function token(
  kind: WeslTokenKind,
  text: string,
  start: number,
  end: number,
): WeslToken {
  return { kind, text, start, end };
}

test("tokenize empty string", () => {
  const stream = new WeslStream("");
  expect(stream.nextToken()).toEqual(null);
});

test("parse fn foo() { }", () => {
  const src = "fn foo() { }";
  const stream = new WeslStream(src);
  expect(stream.nextToken()).toEqual(token("keyword", "fn", 0, 2));
  expect(stream.nextToken()).toEqual(token("word", "foo", 3, 6));
  expect(stream.nextToken()).toEqual(token("symbol", "(", 6, 7));
  expect(stream.nextToken()).toEqual(token("symbol", ")", 7, 8));
});

test("parse var<storage> lights : vec3<f32>", () => {
  const src = "var<storage> lights : vec3<f32>";
  const stream = new WeslStream(src);
  expect(stream.nextToken()).toEqual(token("keyword", "var", 0, 3));
  expect(stream.nextToken()).toEqual(token("symbol", "<", 3, 4));
  expect(stream.nextToken()).toEqual(token("word", "storage", 4, 11));
  expect(stream.nextToken()).toEqual(token("symbol", ">", 11, 12));
  expect(stream.nextToken()?.text).toEqual("lights");
  expect(stream.nextToken()?.text).toEqual(":");
  expect(stream.nextToken()?.text).toEqual("vec3");
  expect(stream.nextToken()).toEqual(token("symbol", "<", 26, 27));
  expect(stream.nextToken()?.text).toEqual("f32");
  expect(stream.nextToken()?.text).toEqual(">");
});

test("parse >>", () => {
  const src = ">>";
  const stream = new WeslStream(src);
  expect(stream.nextToken()).toEqual(token("symbol", ">>", 0, 2));
});

test("parse >> as template", () => {
  const src = "array<foo >>";
  const stream = new WeslStream(src);
  expect(stream.nextToken()).toEqual(token("word", "array", 0, 5));
  expect(stream.nextTemplateStartToken()).toEqual(token("symbol", "<", 5, 6));
  expect(stream.nextToken()).toEqual(token("word", "foo", 6, 9));
  expect(stream.nextTemplateEndToken()).toEqual(token("symbol", ">", 10, 11));
  expect(stream.nextToken()).toEqual(token("symbol", ">", 11, 12));
  expect(stream.nextToken()).toBe(null);
});

test("template discovery ignores > inside comments", () => {
  const src = "a < b /* > */ ;";
  const stream = new WeslStream(src);
  expect(stream.nextToken()?.text).toBe("a");
  expect(stream.nextTemplateStartToken()).toBe(null);
});

test("template discovery sees comments inside template lists", () => {
  const src = "array< /* len */ f32, 4 >";
  const stream = new WeslStream(src);
  expect(stream.nextToken()?.text).toBe("array");
  expect(stream.nextTemplateStartToken()).toEqual(token("symbol", "<", 5, 6));
});

test("parse skip block comment", () => {
  const src = "/* /* // */ */vec3<f32>";
  const stream = new WeslStream(src);
  expect(stream.nextToken()).toEqual(token("word", "vec3", 14, 18));
});

test("parse skip line comment", () => {
  const src = "// vec3<f32> */ a\nvec3";
  const stream = new WeslStream(src);
  expect(stream.nextToken()).toEqual(token("word", "vec3", 18, 22));
});

test("parse skip line without newline", () => {
  const src = "// foo bar";
  const stream = new WeslStream(src);
  expect(stream.nextToken()).toBe(null);
  expect(stream.position()).toBe(src.length);
});

test("unicode mid-word falls back with correct span", () => {
  const src = "réflexion x";
  const stream = new WeslStream(src);
  expect(stream.nextToken()).toEqual(token("word", "réflexion", 0, 9));
  expect(stream.nextToken()).toMatchObject({ start: 10, end: 11 });
});

test("surrogate-pair ident spans count UTF-16 units", () => {
  const src = "𐰓𐰏𐰇 x";
  const stream = new WeslStream(src);
  expect(stream.nextToken()).toEqual(token("word", "𐰓𐰏𐰇", 0, 6));
  expect(stream.nextToken()).toMatchObject({ start: 7, end: 8 });
});

test("underscore boundary: _é word, _x word, bare _ symbol", () => {
  const stream = new WeslStream("_é _x _ x");
  expect(stream.nextToken()).toEqual(token("word", "_é", 0, 2));
  expect(stream.nextToken()).toEqual(token("word", "_x", 3, 5));
  expect(stream.nextToken()).toEqual(token("symbol", "_", 6, 7));
});

test("unicode blankspace separates tokens", () => {
  const src = "a\u{2028}b\u{0085}c";
  const stream = new WeslStream(src);
  expect(stream.nextToken()).toMatchObject({ start: 0, end: 1 });
  expect(stream.nextToken()).toMatchObject({ start: 2, end: 3 });
  expect(stream.nextToken()).toMatchObject({ start: 4, end: 5 });
  expect(stream.nextToken()).toBe(null);
});

test("leading-dot float and 3-char symbols", () => {
  const src = "x >>= .5 <<= 0x1p4";
  const stream = new WeslStream(src);
  stream.nextToken(); // x
  expect(stream.nextToken()).toEqual(token("symbol", ">>=", 2, 5));
  expect(stream.nextToken()).toEqual(token("number", ".5", 6, 8));
  expect(stream.nextToken()?.text).toBe("<<=");
  expect(stream.nextToken()).toEqual(token("number", "0x1p4", 13, 18));
});

test("invalid character throws", () => {
  const stream = new WeslStream("a # b");
  stream.nextToken();
  expect(() => stream.nextToken()).toThrow(/Invalid token #/);
});
