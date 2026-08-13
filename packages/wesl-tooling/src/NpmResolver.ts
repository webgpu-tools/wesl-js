import { resolve } from "import-meta-resolve";
import { npmNameVariations } from "wesl/core";

/** Find longest resolvable npm subpath from WESL module path segments.
 *
 * A WESL statement containing a WESL module path like 'import foo__bar::baz::elem;' references
 * an npm package, an export within that package, a module within the WeslBundle,
 * and an element within the WESL module.
 * This function returns the npm package and export portion from the module path.
 * The return value is usable to dynamically import the corresponding weslBundle.js file.
 *
 * Translation from a WESL module path to an npm package path involves:
 * - Mapping WESL package names to their npm counterparts (e.g., 'foo__bar' -> '@foo/bar')
 * - Probing to find the longest valid export subpath within the package
 *   - package.json allows export subpaths, so 'mypkg::gpu' could be 'mypkg/gpu' or just 'mypkg' in npm
 * - Probing to handle variations in package naming
 *   - foo_bar could be foo-bar in npm
 *
 * Note that the resolution is based on package.json.
 * The resolved file itself may not exist yet. (e.g. dist/weslBundle.js may not have been built yet)
 *
 * @param mPath - Module path segments
 * @param importerURL - Base URL for resolution (e.g., 'file:///path/to/project/')
 * @returns Longest resolvable subpath (e.g., 'foo/bar/baz' or 'foo')
 */
export function npmResolveWESL(
  mPath: string[],
  importerURL: string,
): string | undefined {
  // Try longest subpaths first
  for (const subPath of exportSubpaths(mPath)) {
    // Try npm name variations to handle sanitized package names
    for (const npmPath of npmNameVariations(subPath)) {
      if (tryResolve(npmPath, importerURL)) {
        return npmPath;
      }
    }
  }
  return undefined;
}

/** Try Node.js module resolution.
 * @return undefined if unresolvable. */
function tryResolve(path: string, importerURL: string): string | undefined {
  try {
    return resolve(path, importerURL);
  } catch {
    return undefined;
  }
}

/** Yield possible export subpaths from module path, longest first.
 * Drops the last segment (element name) and iterates down. */
function* exportSubpaths(mPath: string[]): Generator<string> {
  const longest = mPath.length - 1;
  for (let i = longest; i >= 0; i--) {
    yield mPath.slice(0, i).join("/");
  }
}
