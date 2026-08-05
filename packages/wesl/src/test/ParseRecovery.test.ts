import { expect, test } from "vitest";
import { astToString } from "../debug/ASTtoString.ts";
import { childScope, type Scope } from "../Scope.ts";
import { parseWESL } from "./TestUtil.ts";

/** Every ident name in the scope tree, in source order. */
function identNames(scope: Scope): string[] {
  return scope.contents.flatMap(c =>
    childScope(c) ? identNames(c) : [c.originalName],
  );
}

/** The kind of every scope in the tree below `scope`. */
function scopeKinds(scope: Scope): string[] {
  return scope.contents.flatMap(c =>
    childScope(c) ? [c.kind, ...scopeKinds(c)] : [],
  );
}

test("declarations after an error still parse", () => {
  const src = `
    fn broken() { let }
    fn ok() { }
    var<private> count: i32;
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Expected identifier after 'let'",
  ]);
  // the bad statement is dropped, but its function survives
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn broken()
        decl %broken
        block
      fn ok()
        decl %ok
        block
      gvar %count : i32
        name private
        typeDecl %count : i32
          decl %count
          type i32
            ref i32"
  `);
});

test("errors in separate declarations each get a diagnostic", () => {
  const src = `
    const a = ;
    const b = 2;
    struct S { bad!: }
    fn f() { }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.length).toBe(2);
  const declKinds = ast.moduleElem.decls.map(d => d.kind);
  expect(declKinds).toEqual(["const", "struct", "fn"]);
});

test("a bad statement doesn't cost the rest of its function", () => {
  // the '@if' after the error is a statement, not a new declaration: local
  // recovery keeps it (and 'good') in the function, with one diagnostic
  const src = `
    fn f() {
      let ;
      @if(DEBUG) let x = 1;
      good();
    }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Expected identifier after 'let'",
  ]);
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      fn f()
        decl %f
        block
          let %x @if
            attribute @if(DEBUG)
            typeDecl %x
              decl %x
            literal literal(1)
          call
            call-expression call
              ref good"
  `);
});

test("a bad switch clause doesn't cost the rest of its function", () => {
  // the switch owns its '{', so it recovers the clause itself; a block-level
  // recovery would have mistaken the switch's '}' for the function's
  const src = `
    fn f() {
      switch x {
        case 1, , : { }
        default: { }
      }
      good();
    }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Expected expression after ',' in case values",
  ]);
  const fn = astToString(ast.moduleElem.decls[0]);
  expect(fn).toContain("ref good"); // the statement after the switch survives
  expect(fn.match(/switch-clause/g)).toHaveLength(1); // only 'default' survives
});

test("a bad struct member doesn't cost the rest of the struct", () => {
  const src = "struct S { a: i32, bad!: , c: u32 }";
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Expected ':' after struct member name",
  ]);
  expect(astToString(ast.moduleElem)).toMatchInlineSnapshot(`
    "module
      struct S
        decl %S
        member a: i32
          name a
          type i32
            ref i32
        member c: u32
          name c
          type u32
            ref u32"
  `);
});

test("a missing comma between struct members doesn't cost the struct", () => {
  const src = "struct S { a: i32 @size(4) b: f32, c: u32 }";
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Expected ',' after struct member",
  ]);
  // resync lands on the '@' of the next member, so every member survives
  const struct = astToString(ast.moduleElem.decls[0]);
  expect(struct.match(/member/g)).toHaveLength(3);
});

test("a bad attribute in a struct doesn't cost the struct", () => {
  // from tint's error_resync_test.cc StructMembers case: `@-` must error as a
  // bad attribute, not silently no-match (a no-match ends the member list, so
  // the struct's '}' expect failed and dropped the whole struct)
  const src = "struct S { a: i32, @- x: i32, c: u32 }\nfn ok() { }";
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Expected attribute name after '@'",
  ]);
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["struct", "fn"]);
  const struct = astToString(ast.moduleElem.decls[0]);
  expect(struct.match(/member/g)).toHaveLength(2); // a and c survive
});

test("a bad attribute in a statement gets a precise diagnostic", () => {
  // the error costs only the attribute: the statement it decorates and the
  // rest of the body still parse
  const src = "fn f() { @- let x = 1; ok(); }";
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Expected attribute name after '@'",
  ]);
  const fn = astToString(ast.moduleElem.decls[0]);
  expect(fn).toContain("let %x");
  expect(fn).toContain("ref ok");
});

test("an error after a kept continuing statement doesn't strand its idents", () => {
  // 'bad;' fails the '}' expect after continuing, but the continuing statement
  // already parsed: its scope and idents must survive the recovery rollback
  const src = "fn f() { loop { continuing { let c = 1; } bad; } }";
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Expected '}' after continuing block",
  ]);
  expect(identNames(ast.rootScope)).toContain("c");
});

test("a recovered loop body keeps its continuing last", () => {
  // recovery resumes inside the loop body after the failed '}' expect, so
  // good() parses as one more statement: it must not land after the continuing
  const src = "fn f() { loop { continuing { } bad; good(); } }";
  const ast = parseWESL(src);
  expect(ast.diagnostics.length).toBe(1);
  expect(astToString(ast.moduleElem.decls[0])).not.toContain("good"); // dropped
  expect(identNames(ast.rootScope)).toContain("good"); // but still bindable
});

test("a bad statement in a nested block is recovered by the inner block", () => {
  const src = `
    fn f() {
      {
        let ;
        inner();
      }
      outer();
    }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.length).toBe(1);
  const fn = astToString(ast.moduleElem.decls[0]);
  expect(fn).toContain("ref inner");
  expect(fn).toContain("ref outer");
});

test("a failed statement declaration drops its partial scope and ident", () => {
  const src = `
    fn f() {
      @if(DEBUG) const x = ;
      good();
    }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.length).toBe(1);
  // no leaked partial scope, and no leaked 'x' ident
  expect(scopeKinds(ast.rootScope)).not.toContain("partial");
  expect(identNames(ast.rootScope)).toEqual(["f", "good"]);
});

test("an unterminated switch body doesn't spin forever", () => {
  const src = "fn f() { switch x { case 1, :";
  const ast = parseWESL(src);
  expect(ast.diagnostics.length).toBe(1);
  expect(ast.moduleElem.decls).toEqual([]);
});

test("diagnostics carry position and severity", () => {
  const src = "fn broken() { let }";
  const [diagnostic] = parseWESL(src).diagnostics;
  expect(diagnostic.severity).toBe("error");
  expect(diagnostic.start).toBe(src.indexOf("}"));
});

test("unlexable character recovers", () => {
  const src = `
    fn broken() { # }
    fn ok() { }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual(["Invalid token #"]);
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["fn", "fn"]);
});

test("imports before a bad import survive", () => {
  const src = `
    import package::util::good;
    import package::broken::;
    fn main() { }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.length).toBe(1);
  expect(ast.imports.length).toBe(1);
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["import", "fn"]);
});

test("conditional declaration failure drops its partial scope", () => {
  const src = `
    @if(flag) fn broken( { }
    fn ok() { }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.length).toBe(1);
  // the failed decl's partial scope was pruned from the root scope
  const partials = ast.rootScope.contents.filter(c => c.kind === "partial");
  expect(partials).toEqual([]);
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["fn"]);
});

test("a comment before the decl after an error survives recovery", () => {
  const src = `
    @if(flag) fn broken( { }
    // keep me
    fn ok() { }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.length).toBe(1);
  const ok = ast.moduleElem.decls.find(d => d.kind === "fn");
  const comments = ok?.commentsBefore ?? [];
  expect(comments.map(c => src.slice(c.start, c.end))).toEqual(["// keep me"]);
});

test("a stray unmatched brace does not swallow the next declaration", () => {
  // `(` should have closed before `{`; the stray `{` must not make recovery
  // balance-skip to EOF and drop `ok`.
  const src = `
    @if(flag) fn broken( {
    fn ok() { }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.length).toBe(1);
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["fn"]);
});

test("a stray brace in a statement does not swallow the next declaration", () => {
  // the stray `{` after `=` desyncs the statement skip's brace depth, so the
  // scan consumes the fn's real closing `}`; without the module-keyword escape
  // it would run to EOF and drop BOTH functions
  const src = `
    fn broken() { let x = {; good(); }
    fn ok() { }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.length).toBe(1);
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["fn"]);
  expect(astToString(ast.moduleElem)).toContain("fn ok()");
});

test("a stray brace in a switch clause does not swallow the next declaration", () => {
  // same desync as above, one level deeper: the statement skip escapes the
  // clause body, so the clause loop's own skip needs the module-keyword escape
  // too, or it would run to EOF and drop BOTH functions
  const src = `
    fn broken(x: i32) { switch x { case 1: { let y = {; }
    fn ok() { }
  `;
  const ast = parseWESL(src);
  expect(ast.diagnostics.length).toBe(1);
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["fn"]);
  expect(astToString(ast.moduleElem)).toContain("fn ok()");
});

test("a stray unmatched brace does not swallow a following do block", () => {
  // `do` is a module-only declaration, so recovery must treat it as a decl
  // boundary even while a stray `{` has left the skip scan brace-nested.
  const src = `
    fn broken( {
    do blk() { }
  `;
  const ast = parseWESL(src, { weslExtensions: { doBlocks: true } });
  expect(ast.diagnostics.length).toBe(1);
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["do"]);
});

test("deeply nested braces become a diagnostic, not a stack overflow", () => {
  const depth = 2000;
  const src = `fn deep() ${"{".repeat(depth)}${"}".repeat(depth)}\nfn ok() { }`;
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Syntax nested too deeply",
  ]);
  // the over-deep body is truncated, but both functions survive
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["fn", "fn"]);
});

test("deeply nested parens become a diagnostic, not a stack overflow", () => {
  const depth = 2000;
  const parens = "(".repeat(depth) + "1" + ")".repeat(depth);
  const src = `fn f() { x = ${parens}; ok(); }\nfn g() { }`;
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Syntax nested too deeply",
  ]);
  // only the over-deep statement is dropped
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["fn", "fn"]);
  expect(astToString(ast.moduleElem)).toContain("ref ok");
});

test("an over-long else-if chain is bounded, parsing continues", () => {
  const chain = "else if a { } ".repeat(450);
  const src = `fn f() { if a { } ${chain}}\nfn g() { }`;
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Syntax nested too deeply",
  ]);
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["fn", "fn"]);
});

test("a deeply nested import tree is bounded, later decls survive", () => {
  const src = "import a::" + "{ b::".repeat(800) + "c;\nfn ok() { }";
  const ast = parseWESL(src);
  expect(ast.diagnostics.map(d => d.message)).toEqual([
    "Syntax nested too deeply",
  ]);
  expect(ast.moduleElem.decls.map(d => d.kind)).toEqual(["fn"]);
});

test("long member chains parse without recursion limits", () => {
  const src = `fn f() { x = a${".b".repeat(20_000)}; }`;
  const ast = parseWESL(src);
  expect(ast.diagnostics).toEqual([]);
});

