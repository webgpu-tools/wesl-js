import path from "node:path";
import {
  createUnplugin,
  type ExternalIdResult,
  type Thenable,
  type TransformResult,
  type UnpluginBuildContext,
  type UnpluginContext,
  type UnpluginContextMeta,
  type UnpluginOptions,
} from "unplugin";
import type { Conditions, RecordResolver } from "wesl/core";
import type { WeslToml, WeslTomlInfo } from "wesl-tooling";
import { linkBuildExtension } from "./extensions/LinkExtension.ts";
import { staticBuildExtension } from "./extensions/StaticExtension.ts";
import { buildApi } from "./PluginApi.ts";
import type { PluginExtension } from "./PluginExtension.ts";
import type { WeslPluginOptions } from "./WeslPluginOptions.ts";

export type { WeslToml, WeslTomlInfo };

/** Cache for a single plugin instance (one wesl.toml / shader project). */
interface PluginCache {
  registry?: RecordResolver;
  weslToml?: WeslTomlInfo;
}

type Resolver = (
  this: UnpluginBuildContext & UnpluginContext,
  id: string,
  importer: string | undefined,
  options: { isEntry: boolean },
) => Thenable<string | ExternalIdResult | null | undefined>;

type Loader = (
  this: UnpluginBuildContext & UnpluginContext,
  id: string,
) => Thenable<TransformResult>;

/** Shared state threaded through plugin functions. */
export interface PluginContext {
  cache: PluginCache;
  options: WeslPluginOptions;
  meta: UnpluginContextMeta;
  /** path to wesl.toml file (relative to cwd) */
  weslToml?: string;
}

type DebugLog = (msg: string, data?: Record<string, unknown>) => void;

const builtinExtensions = [staticBuildExtension, linkBuildExtension];

/** Bundler plugin for WESL files, triggered by ?link or ?static import suffixes. */
export function weslPlugin(
  options: WeslPluginOptions | undefined,
  meta: UnpluginContextMeta,
): UnpluginOptions {
  const o = options ?? {};
  const extensions = [...builtinExtensions, ...(o.extensions ?? [])];
  const opts = { ...o, extensions };
  const cache: PluginCache = {};
  const context: PluginContext = { cache, meta, options: opts };
  const log = opts.debug ? debugLog : noopLog;

  log("init", { extensions: opts.extensions.map(e => e.extensionName) });

  return {
    name: "wesl-plugin",
    resolveId: buildResolver(opts, context, log),
    load: buildLoader(context, log),
    watchChange(id, _change) {
      log("watchChange", { id });
      // The cache is shared for multiple imports
      if (id.endsWith("wesl.toml")) cache.weslToml = undefined;
      cache.registry = undefined;
    },
  };
}

function pluginNames(options: WeslPluginOptions): string[] {
  return options.extensions?.map(p => p.extensionName) ?? [];
}

function pluginsByName(
  options: WeslPluginOptions,
): Record<string, PluginExtension> {
  const entries = options.extensions?.map(p => [p.extensionName, p]) ?? [];
  return Object.fromEntries(entries);
}

/** Match .wesl/.wgsl imports with query params. Bundlers may append extra params. */
const pluginMatch = /(^^)?(?<baseId>.*\.w[eg]sl)\?(?<query>.+)$/;

const resolvedPrefix = "^^";

/** Reserved query param names (not treated as conditions). */
const reservedParams = new Set(["include"]);

interface ParsedQuery {
  pluginName: string;
  conditions?: Conditions;
  options?: Record<string, string>;
}

/** Parse query string into plugin name, conditions, and options. */
function parsePluginQuery(
  query: string,
  suffixes: string[],
): ParsedQuery | null {
  const segments = query.split("&");
  const pluginName = suffixes.find(s => segments.includes(s));
  if (!pluginName) return null;

  const isBundlerParam = (s: string) => s === "import" || /^t=\d+/.test(s);
  const userSegments = segments.filter(
    s => s !== pluginName && !isBundlerParam(s),
  );

  const conditions: Record<string, boolean> = {};
  const options: Record<string, string> = {};

  for (const seg of userSegments) {
    const eqIdx = seg.indexOf("=");
    if (eqIdx === -1) {
      conditions[seg] = true; // bare name like "FUN" ==> condition true
    } else {
      const key = seg.slice(0, eqIdx);
      const val = seg.slice(eqIdx + 1);
      if (reservedParams.has(key)) options[key] = val;
      else conditions[key] = val !== "false";
    }
  }

  const hasConds = Object.keys(conditions).length > 0;
  const hasOpts = Object.keys(options).length > 0;
  return {
    pluginName,
    conditions: hasConds ? conditions : undefined,
    options: hasOpts ? options : undefined,
  };
}

/** Build the resolveId hook for virtual module imports (?static, ?link, etc). */
function buildResolver(
  options: WeslPluginOptions,
  context: PluginContext,
  log: DebugLog,
): Resolver {
  const suffixes = pluginNames(options);
  return resolver;

  // With pure query-param syntax, Vite resolves paths natively.
  // The resolver is still needed for non-Vite bundlers that may not handle query params.
  function resolver(
    this: UnpluginBuildContext & UnpluginContext,
    id: string,
    importer: string | undefined,
  ): string | null {
    if (id.startsWith(resolvedPrefix)) return id;
    if (id === context.weslToml) return id;

    const match = id.match(pluginMatch);
    const query = match?.groups?.query;
    if (!query) return null;

    const parsed = parsePluginQuery(query, suffixes);
    log("resolveId", { id, matched: !!parsed, suffixes });
    if (!parsed) return null;

    const baseId = match.groups!.baseId;
    const importerDir = path.dirname(importer!);
    const pathToShader = path.join(importerDir, baseId);
    const result = resolvedPrefix + pathToShader + "?" + query;
    log("resolveId resolved", { result });
    return result;
  }
}

/** Build the load hook that emits JS for virtual module imports. */
function buildLoader(context: PluginContext, log: DebugLog): Loader {
  const { options } = context;
  const suffixes = pluginNames(options);
  const pluginsMap = pluginsByName(options);
  return loader;

  async function loader(
    this: UnpluginBuildContext & UnpluginContext,
    id: string,
  ) {
    const match = id.match(pluginMatch);
    const query = match?.groups?.query;
    if (!query) return null;

    const parsed = parsePluginQuery(query, suffixes);
    log("load", { id, matched: parsed?.pluginName ?? null });
    if (!parsed) return null;

    const buildPluginApi = buildApi(context, this);
    const plugin = pluginsMap[parsed.pluginName];
    const rawPath = match.groups!.baseId;
    const shaderPath = rawPath.startsWith(resolvedPrefix)
      ? rawPath.slice(resolvedPrefix.length)
      : rawPath;

    const { conditions, options: opts } = parsed;
    log("load emitting", { shaderPath, conditions, options: opts });
    return await plugin.emitFn(shaderPath, buildPluginApi, conditions, opts);
  }
}

function fmtDebugData(data?: Record<string, unknown>): string {
  return data ? " " + JSON.stringify(data) : "";
}

function debugLog(msg: string, data?: Record<string, unknown>): void {
  console.error(`[wesl-plugin] ${msg}${fmtDebugData(data)}`);
}

function noopLog(): void {}

export const unplugin = createUnplugin(weslPlugin);
export default unplugin;
