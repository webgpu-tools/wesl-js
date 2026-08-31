import { _linkSync } from "../../../../_baseline/packages/wesl/src/index.ts";
import type { WeslSource } from "../LoadExamples.ts";

/** Baseline lean link, mirroring variants/link-lean.ts. Note: baselines older
 * than the keepComments/sourceMap options silently ignore them and measure the
 * default path; only compare against baselines that include the options. */
export function run(source: WeslSource): void {
  _linkSync({
    weslSrc: source.weslSrc,
    rootModuleName: source.rootModule,
    keepComments: false,
    sourceMap: false,
  });
}
