import { discoverModules, fileToModulePath, RecordResolver } from "wesl";
import type { PersistedProject } from "./Share.ts";

const virtualPackages = new Set(["env", "constants"]);

/** Find external packages referenced by the project's reachable source. */
export function dependencyNames(project: PersistedProject): string[] {
  const { weslSrc } = project;
  if (!weslSrc) return [];
  const packageName = project.packageName ?? "package";
  const rootModule = fileToModulePath(
    project.rootModuleName ?? "main",
    packageName,
    false,
  );
  try {
    const resolver = new RecordResolver(weslSrc, {
      packageName,
      weslExtensions: project.weslExtensions,
    });
    const { unbound } = discoverModules(
      weslSrc,
      resolver,
      rootModule,
      packageName,
    );
    const packages = unbound
      .filter(path => path.length > 1 && !virtualPackages.has(path[0]))
      .map(path => path[0]);
    return [...new Set(packages)].sort();
  } catch {
    return [];
  }
}
