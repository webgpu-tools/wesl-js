import { scanDependencies } from "wesl-tooling/dependencies";
import type { PersistedProject } from "./Share.ts";

const virtualPackages = new Set(["env", "constants"]);

/** Find external packages imported or referenced by the project source. */
export function dependencyNames(project: PersistedProject): string[] {
  const { weslSrc } = project;
  if (!weslSrc) return [];
  const packageName = project.packageName ?? "package";
  try {
    const paths = scanDependencies(weslSrc, {
      packageName,
      weslExtensions: project.weslExtensions,
    });
    const packages = paths
      .map(path => path[0])
      .filter(name => !isLocalPackage(name, packageName));
    return [...new Set(packages)].sort();
  } catch {
    return [];
  }
}

function isLocalPackage(name: string, packageName: string): boolean {
  return (
    name === "package" ||
    name === "super" ||
    name === packageName ||
    virtualPackages.has(name)
  );
}
