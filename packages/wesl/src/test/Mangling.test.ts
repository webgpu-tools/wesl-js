import { test } from "vitest";
import { link } from "../Linker.ts";
import { underscoreMangle } from "../Mangler.ts";
import { linkTestOpts } from "./TestUtil.ts";
import { expectTrimmedMatch } from "./TrimmedMatch.ts";

test("underscoreMangle", async () => {
  const main = `
    import package::file1::bar;
fn main() { bar(); }
  `;
  const file1 = `
    fn bar() {};
  `;

  const linked = await linkTestOpts({ mangler: underscoreMangle }, main, file1);
  const expected = `
    fn main() {
      package_file1_bar();
    }
    fn package_file1_bar() { }
  `;
  expectTrimmedMatch(linked, expected);
});

test("underscoreMangle longer ident", async () => {
  const main = `
    import package::container::file1::bar;
fn main() { bar(); }
  `;
  const file1 = `
    fn bar() {};
  `;
  const weslSrc = { "./main.wesl": main, "./container/file1.wesl": file1 };

  const linked = await link({
    mangler: underscoreMangle,
    weslSrc,
    debugWeslRoot: "main",
  });

  const expected = `
    fn main() {
      package_container_file1_bar();
    }
    fn package_container_file1_bar() { }
  `;
  expectTrimmedMatch(linked.dest, expected);
});
