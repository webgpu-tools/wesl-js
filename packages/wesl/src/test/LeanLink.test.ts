import { expect, test } from "vitest";
import { link } from "../Linker.ts";
import type { WeslBundle } from "../WeslBundle.ts";

/** a root module and an imported one, each carrying comments */
const weslSrc = {
  "main.wesl": `
    import package::util::twice;
    // main doc
    fn main() -> f32 {
      let x = 1.0; // inline note
      return twice(x);
    }
  `,
  "util.wesl": `
    /* util header */
    fn twice(x: f32) -> f32 { return x * 2.0; }
  `,
};

/** link params for the two module sources above */
const mainParams = { weslSrc, rootModuleName: "main" };

test("keepComments: false strips comments from linked output", async () => {
  const kept = await link(mainParams);
  const lean = await link({ ...mainParams, keepComments: false });

  expect(kept.dest).toContain("// main doc");
  expect(kept.dest).toContain("/* util header */");
  expect(lean.dest).not.toContain("//");
  expect(lean.dest).not.toContain("/*");
  // stripping comments doesn't drop code, in either module
  expect(lean.dest).toContain("fn twice");
  expect(lean.dest).toContain("return twice(x);");
});

test("keepComments: false also strips comments from library modules", async () => {
  const commentedPkg: WeslBundle = {
    name: "commented_pkg",
    edition: "2026_pre",
    modules: {
      "lib.wesl": `
        /* lib header */
        fn triple(x: f32) -> f32 { return x * 3.0; } // lib inline
      `,
    },
  };
  const src = {
    "main.wesl": `
      import commented_pkg::lib::triple;
      fn main() -> f32 { return triple(1.0); }
    `,
  };
  const params = { weslSrc: src, libs: [commentedPkg] };

  const kept = await link(params);
  const lean = await link({ ...params, keepComments: false });

  expect(kept.dest).toContain("/* lib header */");
  expect(lean.dest).not.toContain("/*");
  expect(lean.dest).not.toContain("//");
  expect(lean.dest).toContain("fn triple");
});

test("keepComments: false also strips comments from virtual modules", async () => {
  const virtualLibs = {
    virt: () => "/* generated */ fn helper() -> f32 { return 4.0; }",
  };
  const src = {
    "main.wesl": `
      import virt::helper;
      fn main() -> f32 { return helper(); }
    `,
  };

  const kept = await link({ weslSrc: src, virtualLibs });
  const lean = await link({ weslSrc: src, virtualLibs, keepComments: false });

  expect(kept.dest).toContain("/* generated */");
  expect(lean.dest).not.toContain("/*");
  expect(lean.dest).toContain("fn helper");
});

test("sourceMap: false keeps text but maps positions to dest identity", async () => {
  const mapped = await link(mainParams);
  const lean = await link({ ...mainParams, sourceMap: false });

  expect(lean.dest).toEqual(mapped.dest);

  // with mapping on, a position in the imported fn maps back to util.wesl
  const twicePos = mapped.dest.indexOf("fn twice") + 3; // +3 skips "fn "
  const mappedPos = mapped.sourceMap.destToSrc(twicePos);
  expect(mappedPos.src.text).toContain("util header");

  // with sourceMap: false, positions map to the dest text itself
  const leanPos = lean.sourceMap.destToSrc(twicePos);
  expect(leanPos.src).toBe(lean.sourceMap.dest);
});
