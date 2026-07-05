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
