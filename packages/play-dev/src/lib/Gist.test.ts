import { expect, test } from "vitest";
import { dependencyNames } from "./Dependencies.ts";
import { buildGistFiles, moduleToFilename, slug } from "./Gist.ts";
import type { ShaderDocument } from "./Share.ts";

const options = { wgslPlayVersion: "0.1.0" };

function payload(
  weslSrc: Record<string, string>,
  title = "marble-prism",
): ShaderDocument {
  return { project: { weslSrc }, title };
}

test("buildGistFiles maps module paths to .wesl filenames", () => {
  const files = buildGistFiles(
    payload({ "package::main": "fn main() {}\n", "package::util": "// u\n" }),
    options,
  );
  expect(files["main.wesl"].content).toBe("fn main() {}\n");
  expect(files["util.wesl"].content).toBe("// u\n");
});

test("buildGistFiles always includes package.json and README", () => {
  const files = buildGistFiles(
    payload({ "package::main": "fn main() {}\n" }),
    options,
  );
  const pkg = JSON.parse(files["package.json"].content);
  expect(pkg).toMatchObject({
    name: "marble-prism",
    description: "marble-prism",
  });
  expect(files["README.md"].content).toContain("wgsl-play.dev");
});

test("thumbnail file present only when provided", () => {
  const src = { "package::main": "fn main() {}\n" };
  expect(
    buildGistFiles(payload(src), options)["thumbnail.png.base64"],
  ).toBeUndefined();
  expect(
    buildGistFiles(payload(src), {
      ...options,
      thumbnailBase64: "aGVsbG8=",
    })["thumbnail.png.base64"].content,
  ).toBe("aGVsbG8=");
});

test("package.json lists external library imports as dependencies", () => {
  const src = {
    "package::main": "import random_wgsl::pcg;\nfn main() { pcg(); }\n",
  };
  const pkg = JSON.parse(
    buildGistFiles(payload(src), options)["package.json"].content,
  );
  expect(pkg.dependencies).toEqual({
    "wgsl-play": "0.1.0",
    random_wgsl: "*",
  });
});

test("local and virtual roots are not treated as dependencies", () => {
  const src = {
    "package::main":
      "import package::util::g;\nimport env::u;\nfn m() { g(); }\n",
    "package::util": "fn g() {}\n",
  };
  expect(dependencyNames({ weslSrc: src })).toEqual([]);
  const pkg = JSON.parse(
    buildGistFiles(payload(src), options)["package.json"].content,
  );
  expect(pkg.dependencies).toEqual({ "wgsl-play": "0.1.0" });
});

test("dependencyNames is empty for unparsable source", () => {
  expect(
    dependencyNames({ weslSrc: { "package::main": "@@@ not wesl @@@" } }),
  ).toEqual([]);
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

test("moduleToFilename recognizes custom local package names", () => {
  expect(moduleToFilename("my_pkg::fx::glow", "my_pkg")).toBe("fx/glow.wesl");
  expect(() => moduleToFilename("other_pkg::glow", "my_pkg")).toThrow(
    "external module key",
  );
});
