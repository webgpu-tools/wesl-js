import { expect, test } from "vitest";
import { link } from "../Linker.ts";
import { withLoggerAsync } from "../Logging.ts";

const noLog = () => {};

/** Link with custom file names and expect it to throw */
async function expectLinkFails(
  weslSrc: Record<string, string>,
  rootModuleName: string,
  errorPattern?: RegExp,
): Promise<void> {
  await withLoggerAsync(noLog, async () => {
    try {
      await link({ weslSrc, rootModuleName });
      expect.fail("Expected link to throw, but it succeeded");
    } catch (e) {
      if (errorPattern && e instanceof Error) {
        expect(e.message).toMatch(errorPattern);
      }
    }
  });
}

// The first segment of an import path must be:
// - `super` (parent module)
// - `package` (current package root)
// - A known package name (registered externally via package.json, or wesl.toml or virutal pkg)
test("import without package:: or super:: prefix should fail", async () => {
  const weslSrc = {
    "./main.wesl": `
      import common::u;
      fn main() { u(); }
    `,
    "./common.wesl": `
      fn u() { }
    `,
  };
  await expectLinkFails(weslSrc, "main", /module not found|unresolved/i);
});

test("inline reference without package:: or super:: prefix should fail", async () => {
  const weslSrc = {
    "./main.wesl": `
      fn main() { myutils::helper(); }
    `,
    "./myutils.wesl": `
      fn helper() { }
    `,
  };
  await expectLinkFails(weslSrc, "main", /module not found/i);
});

test("reference to non-imported symbol from sibling module should fail", async () => {
  const weslSrc = {
    "./main.wesl": `
      import package::common::u;
      fn main() {
        u();
        let x = EPSILON;
      }
    `,
    "./common.wesl": `
      const EPSILON = 0.001;
      fn u() { }
    `,
  };
  await expectLinkFails(weslSrc, "main", /unresolved identifier.*EPSILON/i);
});

test("a missing export blames the export, not the module", async () => {
  const weslSrc = {
    "./main.wesl": `
      import package::common::missing;
      fn main() { missing(); }
    `,
    "./common.wesl": `
      fn u() { }
    `,
  };
  const pattern = /no exported 'missing' in module 'package::common'/;
  await expectLinkFails(weslSrc, "main", pattern);
});

test("an export excluded by conditions reads as a missing export", async () => {
  const weslSrc = {
    "./main.wesl": `
      import package::common::u;
      fn main() { u(); }
    `,
    "./common.wesl": `
      @if(DEBUG) fn u() { }
    `,
  };
  const pattern = /no exported 'u' in module 'package::common'/;
  await expectLinkFails(weslSrc, "main", pattern);
});
