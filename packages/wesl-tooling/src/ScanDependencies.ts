import { findUnboundIdents, RecordResolver, type WeslExtensions } from "wesl";

export interface ScanDependenciesOptions {
  packageName?: string;
  weslExtensions?: WeslExtensions;
}

/** Find dependency paths referenced across WESL source files. */
export function scanDependencies(
  weslSrc: Record<string, string>,
  options: ScanDependenciesOptions = {},
): string[][] {
  const resolver = new RecordResolver(weslSrc, options);
  const paths = findUnboundIdents(resolver).filter(path => path.length > 1);
  return uniquePaths(paths);
}

function uniquePaths(paths: string[][]): string[][] {
  const unique = new Map(paths.map(path => [path.join("::"), path]));
  return [...unique.values()];
}
