// @ts-nocheck - Test file uses simplified mock types
import { expect, test } from "vitest";
import type {
  AttributeElem,
  ElemWithAttributes,
  ElseAttribute,
  IfAttribute,
  Literal,
  TranslateTimeExpressionElem,
} from "../AbstractElems.ts";
import { filterValidElements } from "../Conditions.ts";

// Simple test element that implements ElemWithAttributes
interface TestElem extends ElemWithAttributes {
  kind: "alias"; // Use alias as it's simple
  testId: string;
}

function mockElem(testId: string, attributes?: AttributeElem[]): TestElem {
  return {
    kind: "alias",
    testId,
    attributes,
    start: 0,
    end: 0,
  } as TestElem;
}

function ifAttr(condition: boolean): AttributeElem {
  const literal: Literal = {
    kind: "literal",
    value: condition ? "true" : "false",
    start: 0,
    end: 0,
  };

  const translateTimeExpr: TranslateTimeExpressionElem = {
    kind: "translate-time-expression",
    expression: literal,
    start: 0,
    end: 0,
  };

  const ifAttribute: IfAttribute = {
    kind: "@if",
    param: translateTimeExpr,
  };

  return {
    kind: "attribute",
    attribute: ifAttribute,
    start: 0,
    end: 0,
  };
}

function elseAttr(): AttributeElem {
  const elseAttribute: ElseAttribute = {
    kind: "@else",
  };

  return {
    kind: "attribute",
    attribute: elseAttribute,
    start: 0,
    end: 0,
  };
}

function getNames(elements: TestElem[]): string[] {
  return elements.map(e => e.testId);
}

test("basic @if true", () => {
  const elements = [
    mockElem("a"),
    mockElem("b", [ifAttr(true)]),
    mockElem("c"),
  ];

  const result = filterValidElements(elements, {});
  expect(getNames(result)).toEqual(["a", "b", "c"]);
});

test("basic @if false", () => {
  const elements = [
    mockElem("a"),
    mockElem("b", [ifAttr(false)]),
    mockElem("c"),
  ];

  const result = filterValidElements(elements, {});
  expect(getNames(result)).toEqual(["a", "c"]);
});

test("basic @if/@else - if true", () => {
  const elements = [
    mockElem("a"),
    mockElem("b", [ifAttr(true)]),
    mockElem("c", [elseAttr()]),
    mockElem("d"),
  ];

  const result = filterValidElements(elements, {});
  expect(getNames(result)).toEqual(["a", "b", "d"]);
});

test("basic @if/@else - if false", () => {
  const elements = [
    mockElem("a"),
    mockElem("b", [ifAttr(false)]),
    mockElem("c", [elseAttr()]),
    mockElem("d"),
  ];

  const result = filterValidElements(elements, {});
  expect(getNames(result)).toEqual(["a", "c", "d"]);
});

test("multiple @if/@else chains", () => {
  const elements = [
    mockElem("a", [ifAttr(false)]),
    mockElem("b", [elseAttr()]),
    mockElem("c", [ifAttr(true)]),
    mockElem("d", [elseAttr()]),
    mockElem("e"),
  ];

  const result = filterValidElements(elements, {});
  expect(getNames(result)).toEqual(["b", "c", "e"]);
});

test("orphaned @else is ignored", () => {
  const elements = [
    mockElem("a"),
    mockElem("b", [elseAttr()]), // No preceding @if
    mockElem("c"),
  ];

  const result = filterValidElements(elements, {});
  expect(getNames(result)).toEqual(["a", "c"]);
});

test("consecutive @if statements", () => {
  const elements = [
    mockElem("a", [ifAttr(true)]),
    mockElem("b", [ifAttr(false)]),
    mockElem("c", [elseAttr()]), // Refers to second @if
    mockElem("d"),
  ];

  const result = filterValidElements(elements, {});
  expect(getNames(result)).toEqual(["a", "c", "d"]);
});

test("empty array", () => {
  const elements: TestElem[] = [];
  const result = filterValidElements(elements, {});
  expect(result).toEqual([]);
});

test("all conditional elements removed", () => {
  const elements = [
    mockElem("a", [ifAttr(false)]),
    mockElem("b", [elseAttr()]),
  ];

  const result = filterValidElements(elements, { someCondition: false });
  expect(getNames(result)).toEqual(["b"]);
});

test("complex nested attributes", () => {
  // Create a standard attribute for testing
  const standardAttr = (name: string): AttributeElem => ({
    kind: "attribute",
    attribute: { kind: "@attribute", name, params: [] },
    start: 0,
    end: 0,
  });

  const elements = [
    mockElem("a", [standardAttr("test")]),
    mockElem("b", [ifAttr(false), standardAttr("other")]),
    mockElem("c", [elseAttr(), standardAttr("other2")]),
  ];

  const result = filterValidElements(elements, {});
  expect(getNames(result)).toEqual(["a", "c"]);
});

test("@else after @else is ignored", () => {
  const elements = [
    mockElem("a", [ifAttr(true)]),
    mockElem("b", [elseAttr()]),
    mockElem("c", [elseAttr()]), // Second @else should be ignored
    mockElem("d"),
  ];

  const result = filterValidElements(elements, {});
  expect(getNames(result)).toEqual(["a", "d"]);
});
