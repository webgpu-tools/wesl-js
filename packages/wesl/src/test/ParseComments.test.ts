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

test("attach a nested block comment", () => {
  const src = `
    fn f() {
      /* outer /* inner */ outer */
      let x = 1;
    }`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn f()
        decl %f
        block
          let %x before['/* outer /* inner */ outer */']
            typeDecl %x
              decl %x
            literal literal(1)"
  `);
});

test("attach a multi-line block comment", () => {
  const src = `
    fn f() {
      /* one
         two */
      let x = 1;
    }`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn f()
        decl %f
        block
          let %x before['/* one
             two */']
            typeDecl %x
              decl %x
            literal literal(1)"
  `);
});

test("attach a leading comment to a control-flow statement", () => {
  const src = `
    fn f() {
      // before if
      if true { }
      // before for
      for (var i = 0; i < 1; i++) { }
    }`;
  const parsed = parseWESL(src);
  const out = astToString(parsed.moduleElem);
  expect(out).toContain("if before['// before if']");
  expect(out).toContain("for before['// before for']");
});

test("keep a comment between switch clauses", () => {
  const src = `
    fn f() {
      switch 0 {
        case 0: { }
        // between clauses
        default: { }
      }
    }`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn f()
        decl %f
        block
          switch
            literal literal(0)
            switch-clause
              literal literal(0)
              block
            switch-clause before['// between clauses']
              block"
  `);
});

test("attach a comment before 'else if' to the else branch", () => {
  // The else-if branch starts at the 'else' keyword, so a leading comment falls
  // in the gap and leads the branch instead of being swallowed by its condition.
  const src = `
    fn f() {
      if (a) { }
      // before else
      else if (b) { }
    }`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toContain(
    "if before['// before else']",
  );
});

test("attach an inline comment to the following call argument", () => {
  const src = `const x = max(1, /* big */ 2);`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      const %x
        typeDecl %x
          decl %x
        call-expression call
          ref max
          literal literal(1)
          literal literal(2) before['/* big */']"
  `);
});

test("attach an inline comment hugging the previous call argument", () => {
  const src = `const x = max(1 /* big */, 2);`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      const %x
        typeDecl %x
          decl %x
        call-expression call
          ref max
          literal literal(1) after['/* big */']
          literal literal(2)"
  `);
});

test("attach an inline comment between binary operands", () => {
  const src = `const x = 1 + /* mid */ 2;`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      const %x
        typeDecl %x
          decl %x
        binary-expression binop(+)
          literal literal(1)
          literal literal(2) before['/* mid */']"
  `);
});

test("attach a comment inside parentheses", () => {
  const src = `const x = ( /* inner */ 1);`;
  const parsed = parseWESL(src);
  expect(astToString(parsed.moduleElem)).toMatchInlineSnapshot(`
    "module
      const %x
        typeDecl %x
          decl %x
        parenthesized-expression parens
          literal literal(1) before['/* inner */']"
  `);
});
