import type { SrcMap } from "./SrcMap.ts";

/**
 * Multiple WESL files that have been linked together to produce WGSL code.
 *
 * Call `createShaderModule()` from the `wesl` package entry point
 * to make the error reporting aware of the WESL code.
 */
export class LinkedWesl {
  sourceMap: SrcMap;

  constructor(sourceMap: SrcMap) {
    this.sourceMap = sourceMap;
  }

  /**
   * Use `createShaderModule()` for a better error reporting experience.
   */
  get dest() {
    return this.sourceMap.dest.text;
  }
}
