import path from "node:path";
import url from "node:url";
import { resolve } from "import-meta-resolve";
import { type Conditions, link, noSuffix } from "wesl/core";
import type {
  PluginExtension,
  PluginExtensionApi,
} from "../PluginExtension.ts";

/** Build extension for ?static imports: links WESL at build time, emits WGSL string. */
export const staticBuildExtension: PluginExtension = {
  extensionName: "static",
  emitFn: emitStaticJs,
};

/** Emit a JS module exporting the statically linked WGSL string. */
async function emitStaticJs(
  baseId: string,
  api: PluginExtensionApi,
  conditions?: Conditions,
  _options?: Record<string, string>,
): Promise<string> {
  const { tomlDir } = await api.weslToml();

  const tomlUrl = url.pathToFileURL(path.join(tomlDir, "wesl.toml"));
  const parentModule = tomlUrl.toString();

  const rootModule = await api.weslMain(baseId);
  const rootModuleName = noSuffix(rootModule);

  const [weslSrc, dependencies, debugWeslRoot] = await Promise.all([
    api.weslSrc(),
    api.weslDependencies(),
    api.debugWeslRoot(),
  ]);

  const libFileUrls = dependencies.map(d => resolve(d, parentModule));

  const libModules = await Promise.all(libFileUrls.map(f => import(f)));
  const libs = libModules.map(m => m.default);

  const { dest: wgsl } = await link({
    weslSrc,
    rootModuleName,
    debugWeslRoot,
    libs,
    conditions,
  });

  // JSON.stringify, not a template literal: wgsl comments may contain ` or ${
  return `
    export const wgsl = ${JSON.stringify(wgsl)};
    export default wgsl;
  `;
}
