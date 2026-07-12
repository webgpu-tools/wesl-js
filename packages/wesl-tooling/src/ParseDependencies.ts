import { pathToFileURL } from "node:url";
import { resolve } from "import-meta-resolve";
import type { WeslBundle, WeslExtensions } from "wesl";
import { filterMap, WeslParseError } from "wesl";
import { npmResolveWESL } from "./NpmResolver.ts";
import { scanDependencies } from "./ScanDependencies.ts";

/**
 * Find package dependencies in WESL source files.
 *
 * Partially binds identifiers and returns the longest resolvable npm subpath
 * for each referenced dependency.
 *
 * For example, 'foo::bar::baz' could resolve to:
 *   - 'foo/bar' (package foo, export './bar' bundle)
 *   - 'foo' (package foo, default export)
 *
 * @param weslSrc - Record of WESL source files by path
 * @param projectDir - Project directory for resolving package imports
 * @param virtualLibNames - Virtual lib names to exclude (e.g., ['env', 'constants'])
 * @param weslExtensions - Opt-in WESL extensions to enable while parsing
 * @returns Dependency paths in npm format (e.g., 'foo/bar', 'foo')
 */
export function parseDependencies(
  weslSrc: Record<string, string>,
  projectDir: string,
  virtualLibNames: string[] = [],
  weslExtensions?: WeslExtensions,
): string[] {
  try {
    const refs = scanDependencies(weslSrc, { weslExtensions });
    return resolvePkgDeps(refs, projectDir, virtualLibNames);
  } catch (e: unknown) {
    const isParseError =
      e instanceof WeslParseError ||
      (e instanceof Error && e.cause instanceof WeslParseError);
    if (isParseError && e instanceof Error) {
      console.error(e.message, "\n");
      return [];
    }
    throw e;
  }
}

/** Resolve pre-computed unbound refs to npm dependency paths. */
export function resolvePkgDeps(
  refs: string[][],
  projectDir: string,
  virtualLibNames: string[] = [],
): string[] {
  const excludeRoots = new Set(["constants", ...virtualLibNames]);
  const pkgRefs = refs.filter(
    modulePath => modulePath.length > 1 && !excludeRoots.has(modulePath[0]),
  );
  if (pkgRefs.length === 0) return [];

  const projectURL = projectDirURL(projectDir);
  const deps = filterMap(pkgRefs, mPath => npmResolveWESL(mPath, projectURL));
  return [...new Set(deps)];
}

/**
 * Load WeslBundle instances referenced by WESL sources.
 *
 * Parses sources to find external module references, then dynamically imports
 * the corresponding weslBundle.js files.
 *
 * @param weslSrc - Record of WESL source files by path
 * @param projectDir - Project directory for resolving imports
 * @param packageName - Optional current package name
 * @param includeCurrentPackage - Include current package in results (default: false)
 * @param virtualLibNames - Virtual lib names to exclude from resolution
 * @param weslExtensions - Opt-in WESL extensions to enable while parsing
 * @returns Loaded WeslBundle instances
 */
export async function dependencyBundles(
  weslSrc: Record<string, string>,
  projectDir: string,
  packageName?: string,
  includeCurrentPackage = false,
  virtualLibNames: string[] = [],
  weslExtensions?: WeslExtensions,
): Promise<WeslBundle[]> {
  const deps = parseDependencies(
    weslSrc,
    projectDir,
    virtualLibNames,
    weslExtensions,
  );
  const filteredDeps = includeCurrentPackage
    ? deps
    : otherPackages(deps, packageName);
  const projectURL = projectDirURL(projectDir);

  const bundles = filteredDeps.map(async dep => {
    const url = resolve(dep, projectURL);
    const module = await import(url);
    return module.default as WeslBundle;
  });

  return await Promise.all(bundles);
}

/** Normalize project directory to file:// URL with trailing slash. */
function projectDirURL(projectDir: string): string {
  if (projectDir.startsWith("file://")) {
    return projectDir.endsWith("/") ? projectDir : `${projectDir}/`;
  }
  const fileUrl = pathToFileURL(projectDir).href;
  return fileUrl.endsWith("/") ? fileUrl : `${fileUrl}/`;
}

/** Exclude current package from dependency list. */
function otherPackages(deps: string[], packageName?: string): string[] {
  if (!packageName) return deps;
  return deps.filter(
    dep => dep !== packageName && !dep.startsWith(`${packageName}/`),
  );
}
