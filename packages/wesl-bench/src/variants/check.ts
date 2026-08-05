import { bindAndTransform, checkModule, RecordResolver } from "wesl";
import type { WeslSource } from "../LoadExamples.ts";

interface CheckState {
  resolver: RecordResolver;
  rootModuleName: string;
}

/** Type-check benchmark: parse once in setup, then measure bind + checkModule.
 * Read check's own share against relink (bind + emit).
 *
 * The type caches (expressionTypes / declTypes / checkedTypes) live on the
 * per-link LinkBindings and fill on demand, so run() must re-bind every
 * iteration: binding once in setup and checking a shared module would measure
 * memoized cache hits from the second iteration on, not fresh type checking. */
export function setup(source: WeslSource): CheckState {
  const resolver = new RecordResolver(source.weslSrc);
  const rootModuleName = source.rootModule;
  // warm the lazy parse cache so run() measures bind + check only
  bindAndTransform({ resolver, rootModuleName });
  return { resolver, rootModuleName };
}

export function run(state: CheckState): void {
  const { moduleElem, bindings } = bindAndTransform(state).transformedAst;
  checkModule(moduleElem, { bindings, conditions: {} });
}
