import type { BatchModuleResolver, WeslJsPlugin } from "wesl/core";
import type { WeslTomlInfo } from "wesl-tooling";

/** function type required for emit extensions */
export type ExtensionEmitFn = (
  /** absolute path to the shader to which the extension is attached */
  shaderPath: string,

  /** support functions available to plugin extensions */
  pluginApi: PluginExtensionApi,

  /** static conditions specified on the js import */
  conditions?: Record<string, boolean>,

  /** plugin-level options from query params (e.g., { include: "all" }) */
  options?: Record<string, string>,
) => Promise<string>;

/** an extension that runs inside the wesl-js build plugin */
export interface PluginExtension extends WeslJsPlugin {
  /** javascript imports with this suffix will trigger the plugin */
  extensionName: string;

  /** generate javascript text for js/ts importers to use.
   *   e.g. import myPluginJs from "./foo.wesl?myPlugin"; */
  emitFn: ExtensionEmitFn;
}

export interface ProjectSources {
  weslSrc: Record<string, string>;
  dependencies: string[];
}

/** api supplied to plugin extensions */
export interface PluginExtensionApi {
  weslToml: () => Promise<WeslTomlInfo>;
  weslSrc: () => Promise<Record<string, string>>;
  weslRegistry: () => Promise<BatchModuleResolver>;
  weslMain: (baseId: string) => Promise<string>;
  weslDependencies: () => Promise<string[]>;
  /** weslRoot relative to tomlDir, with forward slashes. */
  debugWeslRoot: () => Promise<string>;

  /** Get weslSrc scoped to modules reachable from a root, plus their deps. */
  scopedProject: (rootModuleName: string) => Promise<ProjectSources>;

  /** Fetch project sources, either all or scoped to reachable modules. */
  fetchProject: (
    rootModuleName: string,
    options?: Record<string, string>,
  ) => Promise<ProjectSources>;
}
