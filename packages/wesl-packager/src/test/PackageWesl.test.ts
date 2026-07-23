import fs, { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rimraf } from "rimraf";
import { expect, test } from "vitest";
import { packagerCli } from "../PackagerCli.ts";
import { expectDirMatch } from "./ExpectDirMatch.ts";

const testDir = dirname(fileURLToPath(import.meta.url));

test("package two wgsl files into one bundle", async () => {
  const projectDir = path.join(testDir, "wesl-package");
  const distDir = path.join(projectDir, "dist");
  const srcDir = path.join(projectDir, "src");
  await rimraf(distDir);
  await mkdir(distDir);
  await packageCli(
    `--projectDir ${projectDir} 
     --baseDir ${srcDir} 
     --updatePackageJson false
     --src ${srcDir}/*.w[eg]sl
     --outDir ${distDir}`,
  );
  const contents = await readFile(path.join(distDir, "weslBundle.js"), "utf8");
  const normalized = contents.replace(/\r\n/g, "\n"); // normalize line endings to LF
  expect(normalized).toMatchInlineSnapshot(`
    "export const weslBundle = {
      name: "test_wesl_package",
      edition: "2026_pre",
      modules: {
        "util.wgsl": "fn foo() {}",
        "lib.wesl": "import package::util;\\n",
      },
    };

    export default weslBundle;
    "
  `);
});

/** set to true for manual review of test results */
const saveTestDir = false;

test("package multi ", async () => {
  // create a copy of multi_package in a temporary directory so we can mutate it
  let workDir: string;
  if (saveTestDir) {
    workDir = "/tmp/testing_multi";
    await rimraf(workDir);
    await mkdir(workDir);
  } else {
    workDir = await fs.mkdtemp(
      path.join(tmpdir(), "wesl-packager-test-multi-"),
    );
  }

  try {
    const multiDir = path.join(testDir, "multi_package");
    await fs.cp(multiDir, workDir, {
      recursive: true,
      preserveTimestamps: true,
    });
    replaceInFile(path.join(workDir, "package.json"), {
      multi_pkg_src: "multi_pkg",
    });

    const distDir = path.join(workDir, "dist");
    // run wesl-packager in temporary directory
    await packageCli(
      `--projectDir ${workDir}
      --src ${workDir}/shaders/**/*.wesl
      --updatePackageJson
      --multiBundle
      --baseDir ${workDir}/shaders
      --outDir ${distDir}`,
    );

    const expectDir = path.join(testDir, "../../../test_pkg/multi_pkg");
    expectDirMatch(workDir, expectDir);
  } finally {
    if (!saveTestDir) {
      await rimraf(workDir);
    }
  }
});

test("error if the package name isn't usable in shader code", async () => {
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "wesl-packager-name-"));
  try {
    await mkdir(path.join(workDir, "shaders"));
    const pkgJson = `{ "name": "3d-utils", "private": true }\n`;
    await fs.writeFile(path.join(workDir, "package.json"), pkgJson);
    await fs.writeFile(path.join(workDir, "shaders", "lib.wesl"), "fn f() {}");

    const run = packageCli(
      `--projectDir ${workDir}
       --baseDir ${workDir}/shaders
       --src ${workDir}/shaders/*.wesl
       --updatePackageJson false
       --outDir ${workDir}/dist`,
    );
    await expect(run).rejects.toThrow(/unusable in shader code/);
  } finally {
    await rimraf(workDir);
  }
});

function packageCli(argsLine: string): Promise<void> {
  return packagerCli(argsLine.split(/\s+/));
}

/** Rewrite a file, replacing specified strings.  */
async function replaceInFile(
  filePath: string,
  replacements: Record<string, string>,
): Promise<void> {
  let content = await readFile(filePath, "utf8");
  // content = content.replace(/\r\n/g, "\n"); // normalize line endings to LF
  for (const [search, replace] of Object.entries(replacements)) {
    content = content.replaceAll(search, replace);
  }
  await fs.writeFile(filePath, content, "utf8");
}
