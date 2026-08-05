import {
  freshResolver,
  linkRegistry,
  RecordResolver,
} from "../../../../_baseline/packages/wesl/src/index.ts";
import type { WeslSource } from "../LoadExamples.ts";

interface RelinkState {
  resolver: RecordResolver;
  rootModuleName: string;
}

/** Baseline repeat-link: older wesl versions mutate ASTs during binding, so
 * correct relinking requires freshResolver (re-parse per link). */
export function setup(source: WeslSource): RelinkState {
  const resolver = new RecordResolver(source.weslSrc);
  const rootModuleName = source.rootModule;
  linkRegistry({ resolver: freshResolver(resolver), rootModuleName });
  return { resolver, rootModuleName };
}

export function run(state: RelinkState): void {
  const resolver = freshResolver(state.resolver);
  linkRegistry({ resolver, rootModuleName: state.rootModuleName });
}
