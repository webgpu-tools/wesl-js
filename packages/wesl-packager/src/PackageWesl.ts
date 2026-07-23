import fs, { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Biome, Distribution } from "@biomejs/js-api";
import {
  noSuffix,
  sanitizePackageName,
  validWgslIdent,
  type WeslBundle,
} from "wesl";
import { weslBundleDeclUrl } from "wesl/bundle-decl";
import { loadModules, parseDependencies, zip } from "wesl-tooling";
import type { CliArgs } from "./PackagerCli.ts";

const weslBundleDecl = await readFile(new URL(weslBundleDeclUrl), "utf8");

const { biome, projectKey: biomeKey } = await setupBiome();

/** write weslBundle .js and .d.ts files for this shader */
export async function packageWgsl(args: CliArgs): Promise<void> {
  const { projectDir, outDir, multiBundle, baseDir, src } = args;
  const modules = await loadModules(projectDir, baseDir, src);
  const pkgJsonPath = path.join(projectDir, "package.json");
  const { name } = await loadPackageFields(pkgJsonPath);
  const shaderName = shaderPackageName(name);
  const edition = "2026_pre";

  if (args.multiBundle) {
    await writeMultiBundle(modules, shaderName, edition, projectDir, outDir);
  } else {
    const allDeps = parseDependencies(modules, projectDir);
    const deps = filterSelfDeps(allDeps, shaderName);
    const bundle: WeslBundle = { name: shaderName, edition, modules };
    await writeJsBundle(bundle, deps, outDir);
  }
  await writeTypeScriptDts(outDir);
  if (args.updatePackageJson) {
    await updatePackageJson(projectDir, outDir, multiBundle);
  }
}

/** Convert the npm package name to the name shader code will use to import it.
 * Reports the shader name, and errors if it isn't a usable WGSL identifier. */
function shaderPackageName(npmName: string): string {
  const shaderName = sanitizePackageName(npmName);
  if (!validWgslIdent(shaderName)) {
    console.error(
      `package name "${npmName}" becomes "${shaderName}" in shader code,\n` +
        `  which is not a valid WGSL identifier, so shaders can't import it.\n` +
        `  Rename the package to start with a letter and use only letters, digits, '-' and '_'.`,
    );
    throw new Error("package name unusable in shader code");
  }
  console.log(`shader code will import this package as: ${shaderName}`);
  return shaderName;
}

/** add an 'exports' entry to package.json for the wesl bundles */
async function updatePackageJson(
  projectDir: string,
  outDir: string,
  multiBundle: boolean,
): Promise<void> {
  const pkgJsonPath = path.join(projectDir, "package.json");
  const pkgJsonString = await fs.readFile(pkgJsonPath, { encoding: "utf8" });
  const pkgJson = JSON.parse(pkgJsonString);
  const exports: Record<string, any> = {};

  const distDir = path.relative(projectDir, outDir);
  if (multiBundle) {
    exports["./*"] = {
      types: `./${distDir}/weslBundle.d.ts`,
      import: `./${distDir}/*/weslBundle.js`,
    };
  } else {
    exports["."] = {
      types: `./${distDir}/weslBundle.d.ts`,
      import: `./${distDir}/weslBundle.js`,
    };
  }

  const newPkgJson = insertExports(pkgJson, exports);
  const jsonString = JSON.stringify(newPkgJson, null, 2).concat("\n");
  await fs.writeFile(pkgJsonPath, jsonString);
}

/** insert the exports field into the package.json */
function insertExports(pkgJson: any, exports: Record<string, any>): any {
  // insert the export entries into the existing package.json, after these fields (for a clean format)
  const exportsAfter = [
    "name",
    "description",
    "version",
    "private",
    "author",
    "type",
    "bin",
    "files",
    "repository",
    "homepage",
    "scripts",
  ];
  const entries = Object.entries(pkgJson);
  const index = entries.findLastIndex(([key]) => exportsAfter.includes(key));

  entries.splice(index + 1, 0, ["exports", exports]);
  return Object.fromEntries(entries);
}

/** create one bundle per source module */
async function writeMultiBundle(
  modules: Record<string, string>,
  shaderName: string,
  edition: string,
  projectDir: string,
  outDir: string,
): Promise<void> {
  for (const [moduleName, moduleSrc] of Object.entries(modules)) {
    const oneModule = { [moduleName]: moduleSrc };
    const moduleBundle: WeslBundle = {
      name: shaderName,
      edition,
      modules: oneModule,
    };
    const dependencies = parseDependencies(oneModule, projectDir);
    const bundleDirRelative = noSuffix(moduleName);
    const bundleDir = path.join(outDir, bundleDirRelative);
    await writeJsBundle(moduleBundle, dependencies, bundleDir);
  }
}

/** Write a weslBundle.js containing the bundled shader sources */
async function writeJsBundle(
  weslBundle: WeslBundle,
  dependencies: string[],
  outDir: string,
): Promise<void> {
  await mkdir(outDir, { recursive: true });

  const depNames = dependencies.map(dep => dep.replaceAll("/", "_"));
  const depsWithNames = zip(dependencies, depNames);

  const imports = depsWithNames
    .map(([dep, depName]) => {
      return `import ${depName} from "${dep}";`;
    })
    .join("\n");
  const importsStr = imports ? `${imports}\n` : "";

  const bundleString = bundleToJsString(weslBundle, depNames);

  const outString = `
    ${importsStr}
    export const weslBundle = ${bundleString}

    export default weslBundle;
  `;

  const outPath = path.join(outDir, "weslBundle.js");
  const formatted = biome.formatContent(biomeKey, outString, {
    filePath: "b.js",
  });
  await safeWrite(outPath, formatted.content);
}

/** Write weslBundle.d.ts containing the type definitions for a WeslBundle */
async function writeTypeScriptDts(outDir: string): Promise<void> {
  // TODO could we use /// <reference types="wesl"> to get the type of WeslBundle?
  const constDecl = `
    export declare const weslBundle: WeslBundle;
    export default weslBundle;
  `;
  const declText = weslBundleDecl + constDecl;
  const formatted = biome.formatContent(biomeKey, declText, {
    filePath: "t.d.ts",
  });

  const outPath = path.join(outDir, "weslBundle.d.ts");
  await safeWrite(outPath, formatted.content);
}

/** Write without truncating the file (atomic via temp+rename).
 * Skips the write entirely if content is unchanged.
 * Avoids a potential race with parallel tsc readers during `--parallel` builds. */
async function safeWrite(filePath: string, content: string): Promise<void> {
  try {
    const existing = await fs.readFile(filePath, "utf8");
    if (existing === content) return;
  } catch {}
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, content);
  await fs.rename(tmpPath, filePath);
}

/** @return the bundle plus dependencies as a JavaScript string */
function bundleToJsString(bundle: WeslBundle, dependencies: string[]): string {
  const { name, edition, modules } = bundle;
  const depsObj = dependencies.length ? { dependencies: 99 } : {};
  const obj = { name, edition, modules, ...depsObj };
  const jsonString = JSON.stringify(obj, null, 2);
  if (dependencies.length) {
    const dependenciesStr = `: [${dependencies.join(", ")}]`;
    const result = jsonString.replace(": 99", dependenciesStr);
    return result;
  } else {
    return jsonString;
  }
}

/** Filter out self-dependencies from the dependency list */
function filterSelfDeps(deps: string[], packageName: string): string[] {
  return deps.filter(
    dep => dep !== packageName && !dep.startsWith(`${packageName}/`),
  );
}

interface PkgFields {
  name: string;
}

/** parse and extract fields from package.json that we care about
 * (the name of the package) */
async function loadPackageFields(pkgJsonPath: string): Promise<PkgFields> {
  const pkgJsonString = await fs.readFile(pkgJsonPath, { encoding: "utf8" });
  const pkgJson = JSON.parse(pkgJsonString);
  const { name } = pkgJson;
  verifyField("name", name);

  function verifyField(field: string, value: any): void {
    if (value === undefined) {
      console.error(`no '${field}' field found in "${pkgJsonPath}"`);
      throw new Error("package.json incomplete");
    }
  }
  return { name };
}

/** setup biome to use as a formatter */
async function setupBiome(): Promise<{ biome: Biome; projectKey: number }> {
  const biome = await Biome.create({
    distribution: Distribution.NODE,
  });
  const { projectKey } = biome.openProject();
  biome.applyConfiguration(projectKey, {
    formatter: {
      enabled: true,
      indentStyle: "space",
      lineEnding: "lf",
      expand: "auto",
    },
  });
  return { biome, projectKey };
}
