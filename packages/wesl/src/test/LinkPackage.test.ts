import second from "multi_pkg/second";
import trans from "multi_pkg/transitive";
import { expect, test } from "vitest";
import { link } from "../Linker.ts";
import type { WeslBundle } from "../WeslBundle.ts";
import { expectNoLogAsync } from "./LogCatcher.ts";

// Static fixture bundle - no external package dependency needed
const hashPkg: WeslBundle = {
  name: "hash_pkg",
  edition: "2026_pre",
  modules: {
    "hash.wesl":
      "fn hashFn(v: u32) -> u32 { return v ^ (v >> 16u); }\nfn unusedFn() { }",
  },
};

test("import fn from a package bundle", async () => {
  const src = `
    import hash_pkg::hash::hashFn;

    @compute @workgroup_size(1)
    fn main() { let x = hashFn(1u); }
  `;
  const result = await expectNoLogAsync(() =>
    link({
      weslSrc: { "./main.wesl": src },
      rootModuleName: "./main.wesl",
      libs: [hashPkg],
    }),
  );
  expect(result.dest).toContain("fn hashFn");
  expect(result.dest).not.toContain("unusedFn");
});

test("import from multi_pkg/second", async () => {
  const main = `
    import multi_pkg::second::two;

    @compute @workgroupSize(1)
    fn main() {
      two();
    }
  `;
  const weslSrc = { main };
  const result = await expectNoLogAsync(async () =>
    link({ weslSrc, libs: [second] }),
  );
  expect(result.dest).toContain("fn two()");
});

test("import from multi_pkg/transitive", async () => {
  const main = `
    import multi_pkg::transitive::toDep;

    @compute @workgroupSize(1)
    fn main() {
      toDep();
    }
  `;
  const weslSrc = { main };
  const result = await expectNoLogAsync(async () =>
    link({ weslSrc, libs: [trans] }),
  );
  expect(result.dest).toContain("fn toDep()");
  expect(result.dest).toContain("fn dep()");
});
