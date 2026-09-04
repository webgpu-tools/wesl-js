/// <reference types="wesl-plugin/suffixes" />

// This file is copied to temp-built-test by setup-built.mts along with all other files
// in packages/built-test.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parser, weslHighlighting } from "lezer-wesl";
import { expect, expectTypeOf, test } from "vitest";
import { link } from "wesl";
import linkParams from "../shaders/main.wesl?link";

test("verify link() function works with built packages", async () => {
  const result = await link(linkParams);
  expect(result).toBeDefined();

  const wgsl = result.dest;
  expect(wgsl).toContain("fn add");
  expect(wgsl).toContain("fn compute");
});

// lezer-wesl ships a hand-written parser.d.ts for its generated parser.js;
// this guards both that the published declarations resolve (the browser
// typecheck below, skipLibCheck off) and that parser hasn't degraded to any.
test("lezer-wesl parser and highlighting work with built packages", () => {
  expectTypeOf(parser).not.toBeAny();
  expectTypeOf(weslHighlighting).not.toBeAny();
  const tree = parser.parse("fn main() { let x = 1; }");
  expect(tree.toString()).toContain("FunctionDeclaration");
});

const externalTest = process.cwd().endsWith("temp-built-test");

// prep:packed:fast re-extracts the @typescript/native-preview tgz every run,
// so this is always the first launch of a fresh native binary. macOS's initial
// verification pass (~4-5s, almost all idle wait) blows the 5s default timeout.
// Subsequent launches run in ~70ms.
test.skipIf(!externalTest)(
  "typecheck this test file",
  () => {
    execSync(`pnpm tsgo`, { stdio: "inherit" });
  },
  30_000,
);

// The two consumer shapes, both with skipLibCheck off (TypeScript's default,
// which the monorepo never uses). Node: no DOM or WebGPU types, catching a
// WebGPU global that leaked into an environment neutral package. Browser: DOM
// lib only, catching a published type that doesn't resolve on its own.
test.skipIf(!externalTest)("typecheck a node side consumer", () => {
  execSync(`pnpm run typecheck:node`, { stdio: "inherit" });
});

test.skipIf(!externalTest)("typecheck a browser side consumer", () => {
  execSync(`pnpm run typecheck:browser`, { stdio: "inherit" });
});

// All published packages - check for TypeScript exports (Node.js can't run .ts in node_modules)
const packagesToCheck = [
  "lezer-wesl",
  "wesl",
  "wesl-gpu",
  "wesl-link",
  "wesl-packager",
  "wesl-plugin",
  "wesl-tooling",
  "wgsl-edit",
  "wgsl-play",
  "wgsl-test",
  "vitest-image-snapshot",
];

test.skipIf(!externalTest)("no TypeScript files in bin entries", () => {
  const errors: string[] = [];
  for (const pkg of packagesToCheck) {
    const pkgJsonPath = `node_modules/${pkg}/package.json`;
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const bin = pkgJson.bin || {};
    for (const [name, path] of Object.entries(bin)) {
      if (typeof path === "string" && path.endsWith(".ts")) {
        errors.push(`${pkg} bin "${name}" points to TypeScript: ${path}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error("TypeScript files in bin:\n" + errors.join("\n"));
  }
});

test.skipIf(!externalTest)("no TypeScript files in package exports", () => {
  const errors: string[] = [];
  for (const pkg of packagesToCheck) {
    const pkgJsonPath = `node_modules/${pkg}/package.json`;
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const exports = pkgJson.exports || {};
    for (const [subpath, target] of Object.entries(exports)) {
      for (const path of extractImportPaths(target)) {
        if (path.endsWith(".ts") && !path.endsWith(".d.ts")) {
          errors.push(
            `${pkg} export "${subpath}" points to TypeScript: ${path}`,
          );
        }
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(
      "TypeScript files in exports (Node.js can't run .ts from node_modules):\n" +
        errors.join("\n"),
    );
  }
});

/** Extract import paths from an export target (handles string or {import: ...}) */
function extractImportPaths(target: unknown): string[] {
  if (typeof target === "string") return [target];
  if (typeof target === "object" && target !== null) {
    const t = target as Record<string, unknown>;
    const paths: string[] = [];
    if (typeof t.import === "string") paths.push(t.import);
    if (typeof t.default === "string") paths.push(t.default);
    return paths;
  }
  return [];
}
