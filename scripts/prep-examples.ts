import process from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import util, { type ParseArgsConfig, parseArgs } from "node:util";
import glob from "fast-glob";

const exec = util.promisify(process.exec);

/*
 * copy the internal examples/ directory to separate projects in wesl-examples/ repo
 * - updates each example project's package.json file to reference the current version of wesl and wesl-plugin
 * - runs `pnpm install` in each example project
 */

/** ignore these when copying examples */
const examplesIgnore = [".git/", "/node_modules", "dist/", "package-lock.json"];

interface Versions {
  wesl: string;
  "wesl-plugin": string;
  "wesl-link": string;
  "wgsl-play": string;
  "wgsl-test": string;
  random_wgsl: string;
  [key: string]: string | undefined;
}

const toolsPath = path.join(fileURLToPath(import.meta.url), "../..");

main();

async function main() {
  const opts = args();
  const versions = await weslVersion();

  const targetDir = opts.targetDir || path.join(toolsPath, "../wesl-examples");

  const examplesSrc = path.join(toolsPath, "examples");
  await cleanDirectory(targetDir);
  await copyDirectory(examplesSrc, targetDir, examplesIgnore);
  await setExampleVersions(targetDir, versions);
  await updatePkgLocks(targetDir);
}

function args(): Record<string, any> {
  const config: ParseArgsConfig = {
    options: {
      workspace: {
        type: "boolean",
      },
      targetDir: {
        type: "string",
        short: "o",
      },
    },
  };
  const args = parseArgs(config);
  return args.values;
}

async function weslVersion(): Promise<Versions> {
  const wesl = await packageVersion("wesl");
  const weslPlugin = await packageVersion("wesl-plugin");
  const cli = await packageVersion("wesl-link");
  const random_wgsl = await packageVersion("random_wgsl");
  const wgslPlay = await packageVersion("wgsl-play");
  const wgslTest = await packageVersion("wgsl-test");
  console.log(`wesl version: ${wesl}`);
  console.log(`wesl-plugin version: ${weslPlugin}`);
  console.log(`wesl-link cli version: ${cli}`);
  console.log(`random_wgsl version: ${random_wgsl}`);
  console.log(`wgsl-play version: ${wgslPlay}`);
  console.log(`wgsl-test version: ${wgslTest}`);

  return {
    wesl,
    "wesl-plugin": weslPlugin,
    "wesl-link": cli,
    random_wgsl,
    "wgsl-play": wgslPlay,
    "wgsl-test": wgslTest,
  };
}

/** load the version from a package.json file in the packages/ di */
async function packageVersion(packageName: string): Promise<string> {
  const packagePath = path.join(
    toolsPath,
    `packages/${packageName}/package.json`,
  );
  const packageJson = JSON.parse(await fs.readFile(packagePath, "utf-8"));
  return packageJson.version;
}

/**
 * Copy recursively,
 * ignoring any paths that include any of the ignore strings.
 */
async function copyDirectory(
  source: string,
  destination: string,
  ignore: string[] = [],
): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, {
    recursive: true,
    preserveTimestamps: true,
    dereference: true,
    filter: src => {
      const filtering = !ignore.some(skip => src.includes(skip));
      if (!filtering) {
        // console.log(`  copying: ${src}`);
      }
      return filtering;
    },
  });
}

/** rewrite the the example package.json dependencies to set the
 * versions of wesl-js packages including wesl, wesl-plugin, and wgsl-play */
async function setExampleVersions(
  targetDir: string,
  versions: Versions,
): Promise<void> {
  const examples = await glob(targetDir + "/*/package.json");

  for (const packageJsonPath of examples) {
    const raw = await fs.readFile(packageJsonPath, { encoding: "utf8" });
    const json = JSON.parse(raw);
    patchWorkspaceDependencies(json, versions);
    await fs.writeFile(packageJsonPath, JSON.stringify(json, null, 2) + "\n");
  }
}

/** patch 'workspace:' dependencies in all package.json sections */
function patchWorkspaceDependencies(pkgJson: any, versions: Versions): void {
  const sectionNames = ["dependencies", "devDependencies", "peerDependencies"];
  const sections = sectionNames.flatMap(s => (pkgJson[s] ? [pkgJson[s]] : []));
  const name = pkgJson.name || "unknown-package";
  sections.forEach(section => {
    patchSectionDeps(section, versions, name);
  });
}

/** patch workspace dependencies in one package.json dependencies section */
function patchSectionDeps(
  section: any,
  versions: Versions,
  name: string,
): void {
  for (const [dep, version] of Object.entries(section)) {
    const versionStr = String(version);
    if (versionStr.startsWith("workspace:")) {
      if (versions[dep]) {
        section[dep] = versions[dep];
      } else {
        console.warn(
          `Warning: No version found for workspace dependency "${dep}" in ${name}.`,
        );
      }
    }
  }
}

/** run `pnpm install` to update example pnpm-lock.yaml files and download dependencies */
async function updatePkgLocks(targetDir: string): Promise<void> {
  const pkgLocks = await glob(targetDir + "/**/pnpm-lock.yaml");
  console.log(`Updating pnpm-lock.yaml files: ${pkgLocks.join(", ")}`);

  for (const pkgLockPath of pkgLocks) {
    const dir = path.dirname(pkgLockPath);
    console.log(`Updating pnpm-lock in ${dir}`);
    // run pnpm install in the directory to update the pnpm-lock.yaml
    await exec(`pnpm install`, { cwd: dir });
  }
}

/** remove all files and directories except .git */
async function cleanDirectory(targetDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const entryPath = path.join(targetDir, entry.name);
      await fs.rm(entryPath, { recursive: true, force: true });
    }
    console.log(`Cleaned directory (except .git): ${targetDir}`);
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      console.error(`Error cleaning directory ${targetDir}:`, error);
    }
  }
}
