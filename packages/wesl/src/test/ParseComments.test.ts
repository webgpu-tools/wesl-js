import { expect, test } from "vitest";
import { astToString } from "../debug/ASTtoString.ts";
import { expectNoLog } from "./LogCatcher.ts";
import { parseWESL } from "./TestUtil.ts";

test("parse fn with line comment", () => {
  const src = `
    fn binaryOp() { // binOpImpl
    }`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn binaryOp()
        decl %binaryOp
        block inner['// binOpImpl']"
  `);
});

test("parse empty line comment", () => {
  const src = `
  var workgroupThreads= 4;                          // 
  `;
  expectNoLog(() => parseWESL(src));
});

test("parse line comment with #replace", () => {
  const src = `
  const workgroupThreads= 4;                          // #replace 4=workgroupThreads
  `;
  expectNoLog(() => parseWESL(src));
});

test("attach leading and trailing comments to a statement", () => {
  const src = `
    fn f() {
      // leading
      let x = 1; // trailing
    }`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn f()
        decl %f
        block
          let %x before['// leading'] after['// trailing']
            typeDecl %x
              decl %x
            literal literal(1)"
  `);
});

test("split comments between two statements", () => {
  const src = `
    fn f() {
      let x = 1; // after x
      // before y
      let y = 2;
    }`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn f()
        decl %f
        block
          let %x after['// after x']
            typeDecl %x
              decl %x
            literal literal(1)
          let %y before['// before y']
            typeDecl %y
              decl %y
            literal literal(2)"
  `);
});

test("attach a dangling comment before the closing brace", () => {
  const src = `
    fn f() {
      let x = 1;
      // dangling
    }`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn f()
        decl %f
        block
          let %x after['// dangling']
            typeDecl %x
              decl %x
            literal literal(1)"
  `);
});

test("preserve a blank line above a module declaration comment", () => {
  const src = `const x = 1;

// y comment
const y = 2;`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      const %x
        typeDecl %x
          decl %x
        literal literal(1)
      const %y before['// y comment'(blank)]
        typeDecl %y
          decl %y
        literal literal(2)"
  `);
});
