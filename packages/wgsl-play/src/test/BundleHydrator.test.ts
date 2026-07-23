import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTarGzip } from "nanotar";
import { expect, test } from "vitest";
import type { WeslBundleFile } from "wesl-fetch";
import { loadBundlesFromFiles } from "wesl-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testPkgDir = join(__dirname, "../../../test_pkg");

async function loadBundlesFromTgz(tgzPath: string, packageName: string) {
  const gzipData = readFileSync(tgzPath);
  const entries = await parseTarGzip(new Uint8Array(gzipData));
  const bundleFiles: WeslBundleFile[] = entries
    .filter(f => f.name.endsWith("weslBundle.js"))
    .map(f => ({ packagePath: f.name, content: f.text, packageName }));
  return loadBundlesFromFiles(bundleFiles);
}

test("load single bundle from tgz", async () => {
  const tgzPath = join(testPkgDir, "dependent_package-0.0.1.tgz");
  const bundles = await loadBundlesFromTgz(tgzPath, "dependent_package");

  expect(bundles.length).toBe(1);
  const bundle = bundles[0];
  expect(bundle.name).toBe("dependent_package");
  expect(bundle.edition).toBe("2026_pre");
  expect(Object.keys(bundle.modules)).toEqual(["lib.wesl"]);
  expect(bundle.modules["lib.wesl"]).toContain("fn dep()");
});

test("load bundles with dependencies from tgz", async () => {
  // Multi_pkg has a transitive bundle that imports from dependent_package
  // Load both to verify dependency resolution across packages
  const multiTgz = join(testPkgDir, "multi_pkg-0.0.1.tgz");
  const depTgz = join(testPkgDir, "dependent_package-0.0.1.tgz");

  const multiFiles = await extractBundleFiles(multiTgz, "multi_pkg");
  const depFiles = await extractBundleFiles(depTgz, "dependent_package");

  // Load all bundles together - each file knows its package name
  const allFiles = [...depFiles, ...multiFiles];
  const allBundles = await loadBundlesFromFiles(allFiles);

  // Should get 4 bundles: 1 from dependent_package, 3 from multi_pkg
  // All bundles can now resolve because each is registered under correct package
  expect(allBundles.length).toBe(4);

  // Verify the transitive bundle successfully resolved its dependency
  const transitive = allBundles.find(b => b.modules["transitive.wesl"]);
  if (!transitive) throw new Error("transitive bundle not found");
  if (!transitive.dependencies)
    throw new Error("transitive has no dependencies");
  expect(transitive.dependencies.length).toBe(1);
  expect(transitive.dependencies[0].name).toBe("dependent_package");
});

test("circular dependencies", async () => {
  // Create two bundles that import each other
  const bundleA: WeslBundleFile = {
    packagePath: "package/dist/weslBundle.js",
    packageName: "circular_test",
    content: `
      import bundleB from "circular_test/b";
      export const weslBundle = {
        name: "circular_test",
        edition: "2026_pre",
        modules: { "a.wesl": "fn a() {}" },
        dependencies: [bundleB]
      };
    `,
  };

  const bundleB: WeslBundleFile = {
    packagePath: "package/dist/b/weslBundle.js",
    packageName: "circular_test",
    content: `
      import bundleA from "circular_test";
      export const weslBundle = {
        name: "circular_test",
        edition: "2026_pre",
        modules: { "b.wesl": "fn b() {}" },
        dependencies: [bundleA]
      };
    `,
  };

  const bundles = await loadBundlesFromFiles([bundleA, bundleB]);

  // Both bundles should evaluate successfully
  expect(bundles.length).toBe(2);

  const a = bundles.find(b => b.modules["a.wesl"]);
  const b = bundles.find(b => b.modules["b.wesl"]);

  if (!a) throw new Error("bundle a not found");
  if (!b) throw new Error("bundle b not found");

  // Verify circular references
  expect(a.dependencies?.length).toBe(1);
  expect(b.dependencies?.length).toBe(1);

  // Each bundle should reference the other
  expect(a.dependencies?.[0]).toBe(b);
  expect(b.dependencies?.[0]).toBe(a);
});

async function extractBundleFiles(
  tgzPath: string,
  packageName: string,
): Promise<WeslBundleFile[]> {
  const gzipData = readFileSync(tgzPath);
  const entries = await parseTarGzip(new Uint8Array(gzipData));
  return entries
    .filter(f => f.name.endsWith("weslBundle.js"))
    .map(f => ({ packagePath: f.name, content: f.text, packageName }));
}
