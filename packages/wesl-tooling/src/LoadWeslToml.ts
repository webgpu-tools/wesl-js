import fs from "node:fs/promises";
import path from "node:path";
import toml from "toml";

/** Configuration from wesl.toml */
export interface WeslToml {
  /** WESL edition (e.g. "2026_pre") */
  edition: string;

  /** glob patterns to find .wesl/.wgsl files. Relative to the toml directory. */
  include: string[];

  /** base directory for wesl files. Relative to the toml directory. */
  root: string;

  /** glob patterns to exclude directories. */
  exclude?: string[];

  /** package manager ("npm" or "cargo") */
  "package-manager"?: string;
}

/** Information about the loaded wesl.toml file and its location */
export interface WeslTomlInfo {
  /** The path to the toml file, relative to the cwd, undefined if no toml file */
  tomlFile: string | undefined;

  /** The absolute path to the directory that contains the toml.
   * Paths inside the toml are relative to this. */
  tomlDir: string;

  /** The wesl root, relative to the projectDir.
   * This lets loadModules do `path.resolve(projectDir, resolvedRoot)` */
  resolvedRoot: string;

  /** The underlying toml file */
  toml: WeslToml;
}

/** Default configuration when no wesl.toml is found */
export const defaultWeslToml: WeslToml = {
  edition: "2026_pre",
  include: ["shaders/**/*.w[eg]sl"],
  root: "shaders",
};

/**
 * Load and parse a wesl.toml file from the fs.
 * Provide default values for any required WeslToml fields.
 */
export async function loadWeslToml(tomlFile: string): Promise<WeslToml> {
  const tomlString = await fs.readFile(tomlFile, "utf-8");
  const parsed = toml.parse(tomlString) as WeslToml;
  const weslToml = { ...defaultWeslToml, ...parsed };
  return weslToml;
}

/**
 * Find and load the wesl.toml file, or use defaults if not found
 *
 * @param projectDir The directory to search for wesl.toml (typically cwd or project root)
 * @param specifiedToml Optional explicit path to a toml file
 * @returns Information about the loaded TOML configuration
 */
export async function findWeslToml(
  projectDir: string,
  specifiedToml?: string,
): Promise<WeslTomlInfo> {
  // find the wesl.toml file if it exists
  let tomlFile: string | undefined;
  if (specifiedToml) {
    await fs.access(specifiedToml);
    tomlFile = specifiedToml;
  } else {
    const tomlPath = path.join(projectDir, "wesl.toml");
    tomlFile = await fs
      .access(tomlPath)
      .then(() => tomlPath)
      .catch(() => {
        return undefined;
      });
  }

  // load the toml contents
  let parsedToml: WeslToml;
  let tomlDir: string;
  if (tomlFile) {
    parsedToml = await loadWeslToml(tomlFile);
    tomlDir = path.dirname(tomlFile);
  } else {
    parsedToml = defaultWeslToml;
    tomlDir = projectDir;
  }

  const tomlToWeslRoot = path.resolve(tomlDir, parsedToml.root);
  const projectDirAbs = path.resolve(projectDir);
  const resolvedRoot = path.relative(projectDirAbs, tomlToWeslRoot);

  return { tomlFile, tomlDir, resolvedRoot, toml: parsedToml };
}
