/** WESL module path utilities for converting between :: and / separators. */

/** Matches the file extensions that carry WESL/WGSL source. */
export const weslFileRegex = /\.(wesl|wgsl)$/;

/** True for file paths that carry WESL/WGSL source (`.wesl` / `.wgsl`). */
export function isWeslFile(path: string): boolean {
  return weslFileRegex.test(path);
}

/**
 * Convert module path segments to relative file path.
 * Resolves package:: and super:: via srcModuleParts context.
 *
 * @returns relative file path e.g., "utils/helper", or undefined if external
 */
export function modulePartsToRelativePath(
  parts: string[],
  packageName: string,
  srcModuleParts?: string[],
): string | undefined {
  const resolved = srcModuleParts
    ? resolveModulePath(parts, srcModuleParts)
    : parts;

  const rootSegment = resolved[0];
  if (rootSegment === "package" || rootSegment === packageName) {
    return resolved.slice(1).join("/");
  }
  return undefined;
}

/** String variant of modulePartsToRelativePath. */
export function moduleToRelativePath(
  modulePath: string,
  packageName: string,
  srcModulePath?: string,
): string | undefined {
  const srcParts = srcModulePath?.split("::");
  const parts = modulePath.split("::");
  return modulePartsToRelativePath(parts, packageName, srcParts);
}

/**
 * Resolve package:: and super:: to absolute module path.
 * - package:: replaced with actual package name from source module
 * - super:: climbs up the module path hierarchy
 */
export function resolveModulePath(
  parts: string[],
  srcModuleParts: string[],
): string[] {
  // Handle package:: - replace with actual package name from source module
  const resolved =
    parts[0] === "package" ? [srcModuleParts[0], ...parts.slice(1)] : parts;

  // Handle super:: - climb up the module path
  const lastSuper = resolved.lastIndexOf("super");
  if (lastSuper === -1) return resolved;
  const base = srcModuleParts.slice(0, -(lastSuper + 1));
  return [...base, ...resolved.slice(lastSuper + 1)];
}

/** Normalize debug root to end with / or be empty. */
export function normalizeDebugRoot(root?: string): string {
  if (root === undefined) return "./";
  if (root === "") return "";
  return root.endsWith("/") ? root : root + "/";
}
