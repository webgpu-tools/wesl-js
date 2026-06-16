import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import type { UnpluginBuildContext, UnpluginContext } from "unplugin";
import {
  discoverModules,
  fileToModulePath,
  freshResolver,
  RecordResolver,
} from "wesl";
import {
  findWeslToml,
  parseDependencies,
  resolvePkgDeps,
  type WeslTomlInfo,
} from "wesl-tooling";
import type { PluginExtensionApi, ProjectSources } from "./PluginExtension.ts";
import type { PluginContext } from "./WeslPlugin.ts";

/** Construct the API surface available to plugin extensions. */
export function buildApi(
  context: PluginContext,
  unpluginCtx: UnpluginBuildContext & UnpluginContext,
): PluginExtensionApi {
  const api: PluginExtensionApi = {
    weslToml: async () => getWeslToml(context, unpluginCtx),
    weslSrc: async () => loadWesl(context, unpluginCtx),
    weslRegistry: async () => getRegistry(context, unpluginCtx),
    weslMain: makeGetWeslMain(context, unpluginCtx),
    weslDependencies: async () => findDependencies(context, unpluginCtx),
    debugWeslRoot: async () => getDebugWeslRoot(context, unpluginCtx),
    scopedProject: rootModuleName =>
      getScopedProject(rootModuleName, context, unpluginCtx),
    fetchProject: (rootModuleName, options) =>
      fetchProject(api, rootModuleName, options),
  };
  return api;
}

/** Get weslSrc scoped to modules reachable from root, plus their deps. */
async function getScopedProject(
  rootModuleName: string,
  context: PluginContext,
  unpluginCtx: UnpluginBuildContext & UnpluginContext,
): Promise<ProjectSources> {
  const fullSrc = await loadWesl(context, unpluginCtx);
  const { tomlDir: projectDir } = await getWeslToml(context, unpluginCtx);

  const registry = await getRegistry(context, unpluginCtx);
  const resolver = freshResolver(registry);
  const modulePath = fileToModulePath(rootModuleName, "package", false);
  const { weslSrc, unbound } = discoverModules(fullSrc, resolver, modulePath);
  const dependencies = resolvePkgDeps(unbound, projectDir);
  return { weslSrc, dependencies };
}

/** Load and cache the wesl.toml configuration. */
export async function getWeslToml(
  context: PluginContext,
  unpluginCtx: UnpluginBuildContext & UnpluginContext,
): Promise<WeslTomlInfo> {
  const { cache } = context;
  if (cache.weslToml) return cache.weslToml;

  const tomlInfo = await findWeslToml(process.cwd(), context.options.weslToml);

  if (tomlInfo.tomlFile) {
    unpluginCtx.addWatchFile(tomlInfo.tomlFile); // The cache gets cleared by the watchChange hook
    context.weslToml = tomlInfo.tomlFile;
  }

  cache.weslToml = tomlInfo;
  return tomlInfo;
}

/** Load all wesl files and return a cached RecordResolver. */
async function getRegistry(
  context: PluginContext,
  unpluginCtx: UnpluginBuildContext & UnpluginContext,
): Promise<RecordResolver> {
  const { cache } = context;
  let { registry } = cache;
  if (registry) return registry;

  const loaded = await loadWesl(context, unpluginCtx);
  const { resolvedRoot } = await getWeslToml(context, unpluginCtx);

  registry = new RecordResolver(loaded);

  // The paths are relative to the weslRoot, but vite needs actual filesystem paths
  const fullPaths = Object.keys(loaded).map(p => path.resolve(resolvedRoot, p));

  for (const f of fullPaths) unpluginCtx.addWatchFile(f);

  cache.registry = registry;
  return registry;
}

/** Compute weslRoot relative to tomlDir, with forward slashes. */
async function getDebugWeslRoot(
  context: PluginContext,
  unpluginCtx: UnpluginBuildContext & UnpluginContext,
): Promise<string> {
  const { resolvedRoot, tomlDir } = await getWeslToml(context, unpluginCtx);
  return toUnixPath(path.relative(tomlDir, resolvedRoot));
}

/** Fetch project sources, either all or scoped to reachable modules. */
async function fetchProject(
  api: PluginExtensionApi,
  rootModuleName: string,
  options?: Record<string, string>,
): Promise<ProjectSources> {
  if (options?.include === "all") {
    const [weslSrc, dependencies] = await Promise.all([
      api.weslSrc(),
      api.weslDependencies(),
    ]);
    return { weslSrc, dependencies };
  }
  return api.scopedProject(rootModuleName);
}

/** Find dependencies by auto-detecting them from the source files. */
async function findDependencies(
  context: PluginContext,
  unpluginCtx: UnpluginBuildContext & UnpluginContext,
): Promise<string[]> {
  const { tomlDir: projectDir } = await getWeslToml(context, unpluginCtx);
  const weslSrc = await loadWesl(context, unpluginCtx);
  return parseDependencies(weslSrc, projectDir);
}

/** @return a function that resolves a shader path to a weslRoot-relative module path. */
function makeGetWeslMain(
  context: PluginContext,
  unpluginContext: UnpluginBuildContext & UnpluginContext,
): (baseId: string) => Promise<string> {
  return getWeslMain;

  /**
   * @param shaderPath is an absolute path to the shader file
   * @return the / separated path to the shader file, relative to the weslRoot
   */
  async function getWeslMain(shaderPath: string): Promise<string> {
    const { resolvedRoot } = await getWeslToml(context, unpluginContext);
    await fs.access(shaderPath); // if file doesn't exist, report now when the user problem is clear.

    const absRoot = path.join(process.cwd(), resolvedRoot);
    const weslRootToMain = path.relative(absRoot, shaderPath);
    return toUnixPath(weslRootToMain);
  }
}

/** Load wesl files referenced in wesl.toml as a path-to-contents record. */
async function loadWesl(
  context: PluginContext,
  unpluginCtx: UnpluginBuildContext & UnpluginContext,
): Promise<Record<string, string>> {
  const tomlInfo = await getWeslToml(context, unpluginCtx);
  const { resolvedRoot, tomlDir } = tomlInfo;
  const { include } = tomlInfo.toml;
  const futureFiles = include.map(g =>
    glob(g, { cwd: tomlDir, absolute: true }),
  );
  const files = (await Promise.all(futureFiles)).flat();

  for (const f of files) unpluginCtx.addWatchFile(f);

  return await loadFiles(files, resolvedRoot);
}

/** Load shader files, returning paths relative to weslRoot. */
async function loadFiles(
  files: string[],
  weslRoot: string,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    files.map(async (fullPath): Promise<[string, string]> => {
      const data = await fs.readFile(fullPath, "utf-8");
      const normalized = data.replace(/\r\n/g, "\n"); // normalize line endings to LF
      const key = toUnixPath(path.relative(weslRoot, fullPath));
      return [key, normalized];
    }),
  );
  return Object.fromEntries(entries);
}

function toUnixPath(p: string): string {
  return path.sep !== "/" ? p.replaceAll(path.sep, "/") : p;
}
