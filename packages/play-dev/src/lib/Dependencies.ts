import { findUnboundIdents, RecordResolver } from "wesl";
import type { PersistedProject } from "./Share.ts";

const virtualPackages = new Set(["env", "constants"]);

/** Find external packages imported or referenced by the project source. */
export function dependencyNames(project: PersistedProject): string[] {
  const { weslSrc } = project;
  if (!weslSrc) return [];
  const packageName = project.packageName ?? "package";
  try {
    const resolver = new RecordResolver(weslSrc, {
      packageName,
      weslExtensions: project.weslExtensions,
    });
    const referenced = findUnboundIdents(resolver)
      .filter(path => path.length > 1)
      .map(path => path[0]);
    const imported = [...resolver.allModules()].flatMap(([, ast]) => {
      return ast.imports.flatMap(imp => {
        const root = imp.segments[0]?.name;
        return root ? [root] : [];
      });
    });
    const packages = [...referenced, ...imported].filter(
      name => !isLocalPackage(name, packageName),
    );
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
