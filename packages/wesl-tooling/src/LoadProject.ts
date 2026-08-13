import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sanitizePackageName, type WeslBundle } from "wesl/core";
import { loadModules } from "./LoadModules.ts";
import { findWeslToml } from "./LoadWeslToml.ts";
import { dependencyBundles } from "./ParseDependencies.ts";
import { resolveProjectDir } from "./ResolveProjectDir.ts";
import { readPackageJson } from "./Version.ts";

export interface ProjectInfo {
  weslSrc: Record<string, string>;
  rootModuleName: string;
  packageName: string;
  libs: WeslBundle[];
}

export interface LoadProjectOptions {
  /** Libraries provided at runtime, don't resolve from npm (e.g., ["test"]) */
  virtualLibs?: string[];
}

/**
 * Load everything needed to link a shader file.
 *
 * Discovers the project root, loads wesl.toml config, reads all shader modules,
 * and resolves external library dependencies from npm.
 *
 * @returns ProjectInfo with sources, libs, and module paths, or null if not in a project.
 */
export async function loadProject(
  filePath: string,
  opts: LoadProjectOptions = {},
): Promise<ProjectInfo | null> {
  const { virtualLibs = [] } = opts;

  try {
    const projectDir = fileURLToPath(await resolveProjectDir(filePath));
    const tomlInfo = await findWeslToml(projectDir);
    const packageName = await getPackageName(projectDir);
    const weslSrc = await loadModules(projectDir);
    const rawLibs = await dependencyBundles(
      weslSrc,
      projectDir,
      packageName,
      false,
      virtualLibs,
    );
    const libs = rawLibs.filter(Boolean);

    const shaderRootAbs = path.resolve(projectDir, tomlInfo.resolvedRoot);
    // path.relative returns backslashes on Windows, normalize to forward slashes
    const rootModuleName = path
      .relative(shaderRootAbs, filePath)
      .replace(/\\/g, "/");

    return { weslSrc, rootModuleName, packageName, libs };
  } catch {
    return null;
  }
}

/** Read package name from package.json, sanitized for WESL identifiers. */
export async function getPackageName(projectDir: string): Promise<string> {
  try {
    const projectUrl = pathToFileURL(projectDir).href;
    const pkg = await readPackageJson(projectUrl);
    return sanitizePackageName(pkg.name as string);
  } catch {
    return path.basename(projectDir);
  }
}
