import { expect, test } from "vitest";
import { publicDecl, RecordResolver } from "wesl";
import { bindIdents } from "../BindIdents.ts";
import { scopeToStringLong } from "../debug/ScopeToString.ts";
import { bindTest, parseTest } from "./TestUtil.ts";

test("nested scopes binding", () => {
  const src = `
    fn main() {
      let bar = 72;
      if (true) {
        if (true) {
          let new_bar = bar; // Should be 72!
        }
        let bar = 5;
      }
    }
  `;

  const { bound, resolver } = bindTest(src);
  const { bindings } = bound.transformedAst;
  const ast = resolver.resolveModule("package::test")!;

  expect(scopeToStringLong(ast.rootScope, bindings)).toMatchInlineSnapshot(`
    "{ %main(main)   
      { 
        { %bar #1  
          { 
            { %new_bar #2  bar #3 -> %bar #1  } #4
            %bar #4 
          } #3
        } #2
      } #1
    } #0"
  `);
});

test("@location attribute const", () => {
  const src = `
    const pos = 0;

    @fragment
    fn fragmentMain(@location(0) pos : vec3f) -> @location(pos) vec4f {
      let x = pos;
    }
  `;
  const { bound, resolver } = bindTest(src);
  const { bindings } = bound.transformedAst;
  const ast = resolver.resolveModule("package::test")!;
  expect(scopeToStringLong(ast.rootScope, bindings)).toMatchInlineSnapshot(`
    "{ 
      -{ %pos(pos)   } #1
      %fragmentMain(fragmentMain) #1  
      { 
        { %pos #2  
          { vec3f #3 -> std } #4
          %x #6  pos #7 -> %pos #2 
        } #3
        pos #4 -> %pos(pos)   vec4f #5 -> std
      } #2
    } #0"
  `);
});

test("collect unbound references", async () => {
  const main = `
    import pkg1::bar;
    import pkg2::foo;

    const w = 7;

    fn main() {
      let x = foo; // Unbound reference
      let y = bar::baz; // Unbound reference
      let z = w; // Bound reference
    }
   `;

  const resolver = new RecordResolver({ main });
  const rootAst = resolver.resolveModule("package::main")!;
  const bindResult = bindIdents({ resolver, rootAst, accumulateUnbound: true });

  const expected = ["pkg1::bar::baz", "pkg2::foo"];
  const expectedPaths = expected.map(s => s.split("::")).sort();
  const unboundPaths = bindResult.unbound?.map(ref => ref.path).sort();
  expect(unboundPaths).deep.equal(expectedPaths);
});

test("publicDecl finds valid conditional declaration", () => {
  const src = `
    @if(FOO)
    fn testFn() { let a = 0; }
    @else
    fn testFn() { let a = 1; }

    fn otherFn() { }
  `;

  const ast = parseTest(src);
  const conditions = {}; // FOO is false

  // First call should find @else function
  const decl1 = publicDecl(ast.rootScope, "testFn", conditions);
  expect(decl1).toBeDefined();
  expect(decl1!.originalName).toBe("testFn");

  // Repeated calls return the same decl object from the scope tree
  const decl2 = publicDecl(ast.rootScope, "testFn", conditions);
  expect(decl2).toBe(decl1);

  // Should find other declarations too
  const otherDecl = publicDecl(ast.rootScope, "otherFn", conditions);
  expect(otherDecl).toBeDefined();
  expect(otherDecl!.originalName).toBe("otherFn");
});
