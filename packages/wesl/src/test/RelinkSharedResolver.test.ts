import { expect, test } from "vitest";
import { discoverModules, findUnboundIdents } from "wesl";
import { link } from "../Linker.ts";
import { RecordResolver } from "../ModuleResolver.ts";

/** Relinking with a shared resolver must match fresh-parse links exactly:
 * binding results live in a per-link table, not in the shared ASTs. */

const conditionalSrc = {
  "main.wesl": `
    import package::util::helper;

    @if(FANCY) fn main() -> i32 { return helper(); }
    @else      fn main() -> i32 { return 0; }
  `,
  "util.wesl": `
    @if(FANCY) fn helper() -> i32 { return 1; }
    @else      fn helper() -> i32 { return 2; }

    fn unused() -> i32 { return 3; }
  `,
};

/** Two files that both declare `dup`, forcing mangling in the link. */
const manglingSrc = {
  "main.wesl": `
    import package::file1;

    fn dup() -> i32 { return 1; }
    fn main() -> i32 { return dup() + file1::dup(); }
  `,
  "file1.wesl": `
    fn dup() -> i32 { return 2; }
  `,
};

async function freshLink(
  weslSrc: Record<string, string>,
  conditions = {},
): Promise<string> {
  return (await link({ weslSrc, rootModuleName: "main", conditions })).dest;
}

test("one resolver, links with different conditions match fresh-parse links", async () => {
  const resolver = new RecordResolver(conditionalSrc);
  const linkWith = async (conditions: Record<string, boolean>) =>
    (await link({ resolver, rootModuleName: "main", conditions })).dest;

  const fancy = await linkWith({ FANCY: true });
  const plain = await linkWith({ FANCY: false });
  const fancyAgain = await linkWith({ FANCY: true });

  expect(fancy).toBe(await freshLink(conditionalSrc, { FANCY: true }));
  expect(plain).toBe(await freshLink(conditionalSrc, { FANCY: false }));
  expect(fancyAgain).toBe(fancy);

  expect(fancy).toContain("return 1");
  expect(plain).not.toContain("helper");
});

test("discovery followed by link on the same resolver leaves no residue", async () => {
  const resolver = new RecordResolver(conditionalSrc);

  // discovery binds across all conditional branches; it must not affect
  // a later real link that reuses the same parsed ASTs
  findUnboundIdents(resolver);
  discoverModules(conditionalSrc, resolver, "package::main");

  const linked = await link({
    resolver,
    rootModuleName: "main",
    conditions: { FANCY: false },
  });
  expect(linked.dest).toBe(await freshLink(conditionalSrc, { FANCY: false }));
});

test("sequential links reusing ASTs keep mangling and tree-shaking identical", async () => {
  const resolver = new RecordResolver(manglingSrc);
  const first = await link({ resolver, rootModuleName: "main" });
  const second = await link({ resolver, rootModuleName: "main" });

  expect(second.dest).toBe(first.dest);
  expect(first.dest).toBe(await freshLink(manglingSrc));
});
