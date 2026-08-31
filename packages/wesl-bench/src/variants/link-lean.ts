import { _linkSync } from "wesl";
import type { WeslSource } from "../LoadExamples.ts";

/** Lean link: comments stripped from output and no source-map positions
 * recorded. Measures the opt-in fast path for runtime linking; compare
 * against the default `link` variant to see what the always-on comment and
 * source-map bookkeeping costs. */
export function run(source: WeslSource): void {
  _linkSync({
    weslSrc: source.weslSrc,
    rootModuleName: source.rootModule,
    keepComments: false,
    sourceMap: false,
  });
}
