import { expect, test } from "vitest";
import { RecordResolver } from "wesl";
import { bindIdents, outputName, refDecl, refTarget } from "../BindIdents.ts";
import {
  discoverModules,
  findUnboundIdents,
} from "../discovery/FindUnboundIdents.ts";
import {
  childScope,
  type DeclIdent,
  type RefIdent,
  type Scope,
} from "../Scope.ts";

/** one module with all three kinds of ref: bound, std wgsl, and unbound */
const src = `
  const g = 1.0;

  fn f() -> vec4f {
    return vec4f(sin(g), missing, 0, 0);
  }
`;

/** Bind one source with unbound refs allowed, returning its refs by name. */
function bindWithUnbound(src: string) {
  const resolver = new RecordResolver({ main: src });
  const rootAst = resolver.resolveModule("package::main")!;
  const { bindings, unbound } = bindIdents({
    resolver,
    rootAst,
    accumulateUnbound: true,
  });
  return { bindings, unbound, refs: refsByName(rootAst.rootScope) };
}

/** Ref idents in a scope tree, keyed by source name (first one wins). */
function refsByName(
  scope: Scope,
  refs = new Map<string, RefIdent>(),
): Map<string, RefIdent> {
  for (const item of scope.contents) {
    if (childScope(item)) refsByName(item, refs);
    else if (item.kind === "ref" && !refs.has(item.originalName))
      refs.set(item.originalName, item);
  }
  return refs;
}

/** Decl idents in a scope tree, keyed by source name (first one wins). */
function declsByName(
  scope: Scope,
  decls = new Map<string, DeclIdent>(),
): Map<string, DeclIdent> {
  for (const item of scope.contents) {
    if (childScope(item)) declsByName(item, decls);
    else if (item.kind === "decl" && !decls.has(item.originalName))
      decls.set(item.originalName, item);
  }
  return decls;
}

test("refTarget classifies bound, std, and unbound refs", () => {
  const { bindings, refs } = bindWithUnbound(src);
  const g = refs.get("g")!;

  const decl = refDecl(g, bindings);
  expect(decl?.originalName).toBe("g");
  expect(refTarget(g, bindings)).toBe(decl);

  expect(refTarget(refs.get("sin")!, bindings)).toBe("std");
  expect(refTarget(refs.get("missing")!, bindings)).toBe("unbound");
});

test("refDecl returns no declaration for std or unbound refs", () => {
  const { bindings, refs } = bindWithUnbound(src);
  expect(refDecl(refs.get("sin")!, bindings)).toBeUndefined();
  expect(refDecl(refs.get("missing")!, bindings)).toBeUndefined();
});

test('refersTo stores std refs as "std" and unbound refs not at all', () => {
  const { bindings, refs } = bindWithUnbound(src);
  const { refersTo } = bindings;

  // the tristate encoding the accessors above hide (see LinkBindings.refersTo)
  expect(refersTo.get(refs.get("sin")!)).toBe("std");
  expect(refersTo.has(refs.get("missing")!)).toBe(false);
  expect(refersTo.get(refs.get("g")!)).toBe(refDecl(refs.get("g")!, bindings));
});

test("outputName: mangled for globals, original for locals, undefined unreached", () => {
  const srcs = {
    "./main.wesl": `
      import package::util::inc;
      const g = 2.0;
      fn main() -> f32 { let local = g; return inc(local); }
    `,
    "./util.wesl": `
      const g = 1.0;
      const unused = 3.0;
      fn inc(x: f32) -> f32 { return x + g; }
    `,
  };
  const resolver = new RecordResolver(srcs);
  const rootAst = resolver.resolveModule("package::main")!;
  const { bindings } = bindIdents({ resolver, rootAst });
  const main = declsByName(rootAst.rootScope);
  const util = declsByName(resolver.resolveModule("package::util")!.rootScope);

  expect(outputName(main.get("g")!, bindings)).toBe("g");
  expect(outputName(main.get("local")!, bindings)).toBe("local");
  expect(outputName(util.get("g")!, bindings)).toBe("g0"); // conflicts with main's g
  expect(outputName(util.get("unused")!, bindings)).toBeUndefined();
});

test("findUnboundIdents binds leniently past parse errors", () => {
  const srcs = {
    "./main.wesl": `
      import package::util::helper;
      fn main() { helper(); }
    `,
    "./util.wesl": `
      import ext_pkg::dep;
      fn helper() { dep(); }
      fn broken( {
    `,
  };
  const unbound = findUnboundIdents(new RecordResolver(srcs));
  expect(unbound).toContainEqual(["ext_pkg", "dep"]);
});

test("a failed import shadows a std name instead of falling back to it", () => {
  const src = `
    import foo::sin;
    fn f() -> f32 { return sin(1.0); }
  `;
  const { bindings, refs, unbound } = bindWithUnbound(src);
  expect(refTarget(refs.get("sin")!, bindings)).toBe("unbound");
  expect(unbound?.map(u => u.path)).toContainEqual(["foo", "sin"]);
});

test("discovery finds @if-guarded decls in imported modules", () => {
  const srcs = {
    "./main.wesl": `
      import package::util::helper;
      fn main() { helper(); }
    `,
    "./util.wesl": `
      @if(feature) fn helper() { }
    `,
  };
  const resolver = new RecordResolver(srcs);
  const { unbound } = discoverModules(srcs, resolver, "package::main");
  expect(unbound).toEqual([]);
});
