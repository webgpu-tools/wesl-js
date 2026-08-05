import { linkRegistry, RecordResolver } from "wesl";
import type { WeslSource } from "../LoadExamples.ts";

interface RelinkState {
  resolver: RecordResolver;
  rootModuleName: string;
}

/** Repeat-link benchmark: parse once in setup, then measure linking alone.
 * Exercises the share-and-relink pattern (playground condition toggles,
 * vite HMR, many tests per shader file). */
export function setup(source: WeslSource): RelinkState {
  const resolver = new RecordResolver(source.weslSrc);
  const rootModuleName = source.rootModule;
  // warm the lazy parse cache so run() measures bind+emit only
  linkRegistry({ resolver, rootModuleName });
  return { resolver, rootModuleName };
}

export function run(state: RelinkState): void {
  linkRegistry(state);
}
