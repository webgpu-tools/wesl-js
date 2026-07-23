import { expect, test } from "vitest";
import { dependencyNames } from "./Dependencies.ts";
import {
  buildGistFiles,
  gistPath,
  gistRoute,
  gistToDocument,
  moduleToFilename,
  slug,
} from "./Gist.ts";
import type { LoadedGist } from "./GitHub.ts";
import { maxTitleLength, type ShaderDocument } from "./Share.ts";

const options = { wgslPlayVersion: "0.1.0" };

function shaderDoc(
  weslSrc: Record<string, string>,
  title = "marble-prism",
): ShaderDocument {
  return { project: { weslSrc }, title };
}

function loadedGist(
  files: Record<string, string>,
  description = "marble-prism",
): LoadedGist {
  return { id: "abc123", owner: "octocat", description, files };
}

test("buildGistFiles maps module paths to .wesl filenames", () => {
  const src = { "package::main": "fn main() {}\n", "package::util": "// u\n" };
  const files = buildGistFiles(shaderDoc(src), options);
  expect(files["main.wesl"].content).toBe("fn main() {}\n");
  expect(files["util.wesl"].content).toBe("// u\n");
});

test("buildGistFiles always includes package.json and README", () => {
  const src = { "package::main": "fn main() {}\n" };
  const files = buildGistFiles(shaderDoc(src), options);
  const pkg = JSON.parse(files["package.json"].content);
  expect(pkg).toMatchObject({
    name: "marble-prism",
    description: "marble-prism",
  });
  expect(files["README.md"].content).toContain("wgsl-play.dev");
});

test("thumbnail file present only when provided", () => {
  const doc = shaderDoc({ "package::main": "fn main() {}\n" });
  expect(buildGistFiles(doc, options)["thumbnail.png.base64"]).toBeUndefined();
  const withThumbnail = { ...options, thumbnailBase64: "aGVsbG8=" };
  const files = buildGistFiles(doc, withThumbnail);
  expect(files["thumbnail.png.base64"].content).toBe("aGVsbG8=");
});

test("package.json lists external library imports as dependencies", () => {
  const src = {
    "package::main": "import random_wgsl::pcg;\nfn main() { pcg(); }\n",
  };
  const files = buildGistFiles(shaderDoc(src), options);
  const pkg = JSON.parse(files["package.json"].content);
  expect(pkg.dependencies).toEqual({ "wgsl-play": "0.1.0", random_wgsl: "*" });
});

test("local and virtual roots are not treated as dependencies", () => {
  const src = {
    "package::main":
      "import package::util::g;\nimport env::u;\nfn m() { g(); }\n",
    "package::util": "fn g() {}\n",
  };
  expect(dependencyNames({ weslSrc: src })).toEqual([]);
  const files = buildGistFiles(shaderDoc(src), options);
  const pkg = JSON.parse(files["package.json"].content);
  expect(pkg.dependencies).toEqual({ "wgsl-play": "0.1.0" });
});

test("dependencyNames is empty for unparsable source", () => {
  expect(
    dependencyNames({ weslSrc: { "package::main": "@@@ not wesl @@@" } }),
  ).toEqual([]);
});

test("dependencyNames recognizes a custom local package name", () => {
  const weslSrc = {
    "my_pkg::main": "import my_pkg::util::f;\nfn main() { f(); }",
    "my_pkg::util": "fn f() {}",
  };
  expect(dependencyNames({ weslSrc, packageName: "my_pkg" })).toEqual([]);
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

test("gistToDocument keeps only shader files and roots at main", () => {
  const doc = gistToDocument(
    loadedGist({
      "main.wesl": "fn main() {}\n",
      "fx/glow.wesl": "fn glow() {}\n",
      "package.json": "{}",
      "README.md": "# marble-prism\n",
      "thumbnail.png.base64": "aGVsbG8=",
    }),
  );
  expect(doc?.project.weslSrc).toEqual({
    "package::main": "fn main() {}\n",
    "package::fx::glow": "fn glow() {}\n",
  });
  expect(doc?.project.rootModuleName).toBe("package::main");
  expect(doc?.title).toBe("marble-prism");
});

test("gistToDocument round-trips the files buildGistFiles wrote", () => {
  const weslSrc = {
    "package::main": "import package::util::g;\nfn main() { g(); }\n",
    "package::util": "fn g() {}\n",
  };
  const files = buildGistFiles(shaderDoc(weslSrc), options);
  const contents = Object.fromEntries(
    Object.entries(files).map(([name, file]) => [name, file.content]),
  );
  const doc = gistToDocument(loadedGist(contents));
  expect(doc?.project.weslSrc).toEqual(weslSrc);
});

test("gistToDocument roots at the only shader file when main is absent", () => {
  const doc = gistToDocument(loadedGist({ "sketch.wesl": "fn s() {}\n" }));
  expect(doc?.project.rootModuleName).toBe("package::sketch");
});

test("gistToDocument rejects a gist with no shader source", () => {
  expect(gistToDocument(loadedGist({ "README.md": "# notes\n" }))).toBeNull();
});

test("gistToDocument caps an over-long description", () => {
  const doc = gistToDocument(
    loadedGist({ "main.wesl": "fn m() {}" }, "x".repeat(200)),
  );
  expect(doc?.title).toHaveLength(maxTitleLength);
});

test("gistRoute parses gist paths and rejects others", () => {
  expect(gistRoute("/gist/octocat/abc123")).toEqual({
    owner: "octocat",
    id: "abc123",
  });
  expect(gistRoute("/gist/octocat/abc123/")).toEqual({
    owner: "octocat",
    id: "abc123",
  });
  expect(gistRoute("/")).toBeNull();
  expect(gistRoute("/gist/octocat")).toBeNull();
  expect(gistRoute("/u/octocat")).toBeNull();
});

test("gistRoute decodes escapes and keeps malformed ones raw", () => {
  expect(gistRoute("/gist/octo%40cat/abc123")).toEqual({
    owner: "octo@cat",
    id: "abc123",
  });
  // A truncated link can end mid-escape; the route must not throw.
  expect(gistRoute("/gist/octocat/abc%2")).toEqual({
    owner: "octocat",
    id: "abc%2",
  });
});

test("gistPath permalinks a gist", () => {
  expect(gistPath({ owner: "octocat", id: "abc123" })).toBe(
    "/gist/octocat/abc123",
  );
});

test("gistPath round-trips reserved characters through gistRoute", () => {
  const route = { owner: "octo@cat", id: "a/b?c" };
  const path = gistPath(route);
  expect(path).toBe("/gist/octo%40cat/a%2Fb%3Fc");
  expect(gistRoute(path)).toEqual(route);
});

test("package.json carries the wesl config with the recorded root", () => {
  const doc: ShaderDocument = {
    project: {
      weslSrc: { "package::fx": "fn f() {}\n" },
      rootModuleName: "package::fx",
    },
    title: "marble-prism",
  };
  const pkg = JSON.parse(buildGistFiles(doc, options)["package.json"].content);
  expect(pkg.wesl).toEqual({
    edition: "2026_pre",
    root: ".",
    dependencies: "auto",
    main: "fx",
  });
});

test("wesl config omits main when the project has no root module", () => {
  const files = buildGistFiles(
    shaderDoc({ "package::a": "fn a() {}" }),
    options,
  );
  const pkg = JSON.parse(files["package.json"].content);
  expect(pkg.wesl.main).toBeUndefined();
});

test("gistToDocument prefers the recorded wesl.main over convention", () => {
  const doc = gistToDocument(
    loadedGist({
      "main.wesl": "fn main() {}\n",
      "alt.wesl": "fn alt() {}\n",
      "package.json": JSON.stringify({ wesl: { main: "alt" } }),
    }),
  );
  expect(doc?.project.rootModuleName).toBe("package::alt");
});

test("gistToDocument accepts wesl.main as an array, using the first entry", () => {
  const doc = gistToDocument(
    loadedGist({
      "main.wesl": "fn main() {}\n",
      "alt.wesl": "fn alt() {}\n",
      "package.json": JSON.stringify({ wesl: { main: ["alt", "main"] } }),
    }),
  );
  expect(doc?.project.rootModuleName).toBe("package::alt");
});

test("gistToDocument falls back when wesl.main names a missing module", () => {
  const doc = gistToDocument(
    loadedGist({
      "main.wesl": "fn main() {}\n",
      "package.json": JSON.stringify({ wesl: { main: "ghost" } }),
    }),
  );
  expect(doc?.project.rootModuleName).toBe("package::main");
});

test("gistToDocument tolerates a hand-mangled package.json", () => {
  const doc = gistToDocument(
    loadedGist({ "main.wesl": "fn main() {}\n", "package.json": "not{json" }),
  );
  expect(doc?.project.rootModuleName).toBe("package::main");
});

test("buildGistFiles rejects nested modules: gists have no directories", () => {
  const doc = shaderDoc({ "package::fx::glow": "fn g() {}\n" });
  expect(() => buildGistFiles(doc, options)).toThrow("nested module");
});
