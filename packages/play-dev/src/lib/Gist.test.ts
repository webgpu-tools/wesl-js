import { expect, test } from "vitest";
import {
  buildGistFiles,
  externalLibs,
  moduleToFilename,
  slug,
} from "./Gist.ts";
import type { ShaderDocument } from "./Share.ts";

function payload(
  weslSrc: Record<string, string>,
  title = "marble-prism",
): ShaderDocument {
  return { project: { weslSrc }, title };
}

test("buildGistFiles maps module paths to .wesl filenames", () => {
  const files = buildGistFiles(
    payload({ "package::main": "fn main() {}\n", "package::util": "// u\n" }),
  );
  expect(files["main.wesl"].content).toBe("fn main() {}\n");
  expect(files["util.wesl"].content).toBe("// u\n");
});

test("buildGistFiles always includes package.json and README", () => {
  const files = buildGistFiles(payload({ "package::main": "fn main() {}\n" }));
  const pkg = JSON.parse(files["package.json"].content);
  expect(pkg).toMatchObject({
    name: "marble-prism",
    description: "marble-prism",
  });
  expect(files["README.md"].content).toContain("wgsl-play.dev");
});

test("thumbnail file present only when provided", () => {
  const src = { "package::main": "fn main() {}\n" };
  expect(buildGistFiles(payload(src))["thumbnail.png"]).toBeUndefined();
  expect(
    buildGistFiles(payload(src), "aGVsbG8=")["thumbnail.png"].content,
  ).toBe("aGVsbG8=");
});

test("package.json lists external library imports as dependencies", () => {
  const src = {
    "package::main": "import random_wgsl::pcg;\nfn main() { pcg(); }\n",
  };
  const pkg = JSON.parse(buildGistFiles(payload(src))["package.json"].content);
  expect(pkg.dependencies).toEqual({ random_wgsl: "*" });
});

test("local and virtual roots are not treated as dependencies", () => {
  const src = {
    "package::main":
      "import package::util::g;\nimport env::u;\nfn m() { g(); }\n",
    "package::util": "fn g() {}\n",
  };
  expect(externalLibs(src)).toEqual([]);
  const pkg = JSON.parse(buildGistFiles(payload(src))["package.json"].content);
  expect(pkg.dependencies).toBeUndefined();
});

test("externalLibs is empty for unparsable source", () => {
  expect(externalLibs({ "package::main": "@@@ not wesl @@@" })).toEqual([]);
});

test("slug produces npm-safe names with a fallback", () => {
  expect(slug("Marble Prism!")).toBe("marble-prism");
  expect(slug("   ")).toBe("wgsl-shader");
});

test("moduleToFilename handles nested and bare keys", () => {
  expect(moduleToFilename("package::main")).toBe("main.wesl");
  expect(moduleToFilename("package::fx::glow")).toBe("fx/glow.wesl");
  expect(moduleToFilename("./helper.wesl")).toBe("helper.wesl");
  expect(moduleToFilename("notes")).toBe("notes.wesl");
});
