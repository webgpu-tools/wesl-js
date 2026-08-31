import {
  linkRegistry,
  RecordResolver,
} from "../../../../_baseline/packages/wesl/src/index.ts";
import type { WeslSource } from "../LoadExamples.ts";

interface RelinkState {
  resolver: RecordResolver;
  rootModuleName: string;
}

/** Baseline repeat-link, mirroring variants/relink.ts. Kept as a copy (not
 * shared) so this file can track an older baseline API independently.
 * Note: baselines that predate immutable post-parse ASTs mutate ASTs during
 * binding, so sharing the resolver across links would mismeasure there; only
 * compare against baselines with immutable ASTs. */
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
