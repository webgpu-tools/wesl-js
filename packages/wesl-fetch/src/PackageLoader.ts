/**
 * Module Discovery Phase
 *
 * Before linking, we run a discovery phase to find and fetch all needed modules.
 * This uses a lightweight binding pass (findUnboundIdents) that walks the scope tree
 * to find module references without fully resolving them.
 *
 * Module paths (e.g., foo::bar::baz) come from import statements or inline qualified
 * references. We categorize them as:
 *   - internal: package:: and super:: paths, fetched from local URLs (shaderRoot)
 *   - external: other packages, fetched from npm
 *
 * The discovery loop uses FetchingResolver which provides:
 *   - Sync resolveModule() for findUnboundIdents compatibility
 *   - Async resolveModuleAsync() as prototype for future async BindIdents
 *
 * When wesl gets async BindIdents, the shim loop disappears and BindIdents
 * will call resolveModuleAsync directly.
 */

import type { WeslBundle } from "wesl";
import {
  fileToModulePath,
  findUnboundIdents,
  npmNameVariations,
  partition,
} from "wesl";
import type { WeslBundleFile } from "./BundleHydrator.ts";
import { bundleRegistry, hydrateBundleRegistry } from "./BundleHydrator.ts";
import { fetchBundleFilesFromNpm } from "./BundleLoader.ts";
import { FetchingResolver } from "./FetchingResolver.ts";

/** Resolved sources ready for the linker. */
export interface ResolvedSources {
  /** All sources keyed by module path. */
  weslSrc: Record<string, string>;
  libs: WeslBundle[];
  /** Module name for the root/main module. */
  rootModuleName?: string;
}

/** Options for fetchDependencies. */
export interface FetchOptions {
  /** Root path for internal imports (package::, super::). Default: "/shaders" */
  shaderRoot?: string;
  /** URL path of the source file (for super:: resolution). */
  currentPath?: string;
  /** Module path of the root source (e.g. "package::effects::main").
   * Takes precedence over currentPath; defaults to "package::main". */
  rootModuleName?: string;
  /** Pre-existing sources to include. */
  existingSources?: Record<string, string>;
  /** Fetch library packages from npm (default: true). */
  fetchLibs?: boolean;
  /** Fetch local .wesl source files via HTTP (default: true). */
  fetchSources?: boolean;
}

const virtualModules = ["constants", "env"];

/** Resolve dependencies: internal modules via HTTP, external packages from npm. */
export async function fetchDependencies(
  rootModuleSource: string,
  options?: FetchOptions,
): Promise<ResolvedSources> {
  const shaderRoot = options?.shaderRoot ?? "/shaders";
  const currentPath = options?.currentPath;
  const existingSources = options?.existingSources;
  const fetchLibs = options?.fetchLibs ?? true;
  const fetchSources = options?.fetchSources ?? true;

  const rootModuleName =
    options?.rootModuleName ??
    (currentPath ? urlToModulePath(currentPath, shaderRoot) : "package::main");
  const initialSources = {
    ...existingSources,
    [rootModuleName]: rootModuleSource,
  };
  const resolverOpts = { shaderRoot, srcModulePath: currentPath };
  const resolver = new FetchingResolver(initialSources, resolverOpts);

  const libs: WeslBundle[] = [];
  const fetched = new Set<string>();

  // Discovery loop (LATER we'll make BindIdents async, and this can go away)
  while (true) {
    findUnboundIdents(resolver);

    const unresolved = getNonVirtualUnresolved(resolver, fetched);
    if (unresolved.length === 0) break;

    const [internal, external] = partition(unresolved, isInternal);
    if (fetchSources) {
      await Promise.all(internal.map(p => resolver.resolveModuleAsync(p)));
    } else {
      for (const p of internal) fetched.add(p);
    }

    if (fetchLibs) {
      const newLibs = await fetchExternalBundles(external, fetched);
      libs.push(...newLibs);
    } else {
      for (const p of external) fetched.add(p.split("::")[0]);
    }
  }

  const weslSrc = extractWeslSrc(resolver);
  return { libs, weslSrc };
}

/** Load shader from URL, resolving all dependencies. */
export async function loadShaderFromUrl(
  url: string,
  shaderRoot = "/shaders",
): Promise<ResolvedSources> {
  const source = await fetchText(url);
  const currentPath = new URL(url, window.location.href).pathname;
  const rootModuleName = urlToModulePath(currentPath, shaderRoot);
  const { weslSrc, libs } = await fetchDependencies(source, {
    shaderRoot,
    currentPath,
  });
  return { weslSrc, libs, rootModuleName };
}

/** Fetch external package names from unresolved module paths.
 * Returns the fetched WeslBundle[]. Useful for on-demand fetching in editors. */
export async function fetchPackagesByName(
  packageNames: string[],
): Promise<WeslBundle[]> {
  const fetched = new Set<string>();
  return fetchExternalBundles(
    packageNames.map(n => `${n}::_`),
    fetched,
  );
}

/** Convert URL path to module path (e.g., "/shaders/effects/main.wesl" -> "package::effects::main"). */
function urlToModulePath(urlPath: string, shaderRoot: string): string {
  const cleanRoot = shaderRoot.replace(/\/$/, "");
  const relativePath = urlPath.replace(cleanRoot, "").replace(/^\//, "");
  return fileToModulePath(relativePath, "package", false);
}

function getNonVirtualUnresolved(
  resolver: FetchingResolver,
  fetched: Set<string>,
): string[] {
  return resolver.getUnresolved().filter(p => {
    const pkg = p.split("::")[0];
    return !virtualModules.includes(pkg) && !fetched.has(pkg);
  });
}

function isInternal(modulePath: string): boolean {
  return modulePath.startsWith("package::") || modulePath.startsWith("super::");
}

/** Fetch external packages from npm. */
async function fetchExternalBundles(
  modulePaths: string[],
  fetched: Set<string>,
): Promise<WeslBundle[]> {
  const pkgNames = [...new Set(modulePaths.map(p => p.split("::")[0]))];
  const newPkgs = pkgNames.filter(p => !fetched.has(p));
  if (newPkgs.length === 0) return [];

  for (const p of newPkgs) fetched.add(p);
  return fetchPackagesFromNpm(newPkgs);
}

/** Extract all sources from resolver (including main). */
function extractWeslSrc(resolver: FetchingResolver): Record<string, string> {
  const weslSrc: Record<string, string> = {};
  for (const [path] of resolver.allModules()) {
    if (resolver.sources[path]) {
      weslSrc[path] = resolver.sources[path];
    }
  }
  return weslSrc;
}

/** Fetch text content from URL. */
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.text();
}

/** Fetch WESL bundles from npm, auto-fetching dependencies recursively. */
async function fetchPackagesFromNpm(pkgIds: string[]): Promise<WeslBundle[]> {
  const loaded = new Set<string>();

  const promisedBundles = pkgIds.map(id => fetchOnePackage(id, loaded));
  const initialFiles = await Promise.all(promisedBundles);
  const registry = await bundleRegistry(initialFiles.flat());

  return hydrateBundleRegistry(registry, id => fetchOnePackage(id, loaded));
}

/** Fetch bundle files for a single package. */
async function fetchOnePackage(
  pkgId: string,
  loaded: Set<string>,
): Promise<WeslBundleFile[]> {
  if (loaded.has(pkgId)) return [];
  loaded.add(pkgId);

  for (const npmName of npmNameVariations(pkgId)) {
    try {
      return await fetchBundleFilesFromNpm(npmName);
    } catch {
      // Try next variation
    }
  }
  throw new Error(`Package not found: ${pkgId}`);
}
