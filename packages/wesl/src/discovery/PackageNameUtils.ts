/** Package name sanitization for WESL.
 *
 * Converts typical npm package names to WGSL-safe identifiers using double-underscore encoding.
 * NPM package names can contain `@`, `/`, and `-`, which are not allowed in WGSL identifiers.
 *
 * ## Encoding Scheme
 *
 * ```
 * @     ==>  (remove)
 * /     ==>  __  (double underscore)
 * -     ==>  _   (single underscore)
 * ```
 *
 * ## Forward Mapping (npm ==> WGSL identifier)
 *
 * ```
 * my_package          ==>  my_package
 * random-wgsl         ==>  random_wgsl
 * @scope/my-pkg       ==>  scope__my_pkg
 * ```
 *
 * ## Reverse Mapping (WGSL identifier ==> npm package)
 *
 * ```
 * scope__my_pkg       ==>  try: @scope/my_pkg, @scope/my-pkg
 * random_wgsl         ==>  try: random_wgsl, random-wgsl
 * ```
 */

import { keywordOrReserved } from "../parse/Keywords.ts";
import { identPattern } from "../parse/stream/WeslLexer.ts";

/** Convert npm package name to WGSL-safe identifier using double-underscore encoding. */
export function sanitizePackageName(npmName: string): string {
  return npmName
    .replace(/^@/, "") // Remove @ prefix
    .replaceAll("/", "__") // Replace / with __ (double underscore)
    .replaceAll("-", "_"); // Replace - with _ (single underscore)
}

const wholeIdent = new RegExp(`^(?:${identPattern.source})$`, "u");

/** @return true if the name is usable as a WGSL identifier.
 * Sanitized package names that aren't valid identifiers are unreachable
 * from shader code (e.g. `3d-utils` sanitizes to `3d_utils`). */
export function validWgslIdent(name: string): boolean {
  return wholeIdent.test(name) && !keywordOrReserved.has(name);
}

/** Generate npm package name variations from sanitized WESL identifier.
 *
 * Uses double-underscore encoding to distinguish scoped vs unscoped packages:
 * - Has __ → scoped package (try @scope/pkg variants)
 * - No __ → unscoped package (try pkg variants)
 *
 * Examples:
 *   "lygia__shader_utils" → ["@lygia/shader_utils", "@lygia/shader-utils"]
 *   "random_wgsl" → ["random_wgsl", "random-wgsl"]
 */
export function* npmNameVariations(sanitizedPath: string): Generator<string> {
  const [pkg, sub] = breakAt(sanitizedPath, "/");

  let pkgName = pkg;
  let scopePrefix = "";

  if (pkg.includes("__")) {
    // presume a scoped npm package (@scope/pkg)
    const [scope, ...rest] = pkg.split("__");
    pkgName = rest.join("__"); // Rejoin in case of __ in package name (rare)
    scopePrefix = `@${scope}/`;
  }

  yield `${scopePrefix}${pkgName}${sub}`;
  yield `${scopePrefix}${pkgName.replaceAll("_", "-")}${sub}`;
}

/** Break string at first occurrence of delimiter.
 * @returns [before, after] where after includes the delimiter */
function breakAt(str: string, delimiter: string): [string, string] {
  const index = str.indexOf(delimiter);
  if (index === -1) return [str, ""];
  return [str.slice(0, index), str.slice(index)];
}
