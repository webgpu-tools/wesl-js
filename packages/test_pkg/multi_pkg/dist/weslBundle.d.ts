export interface WeslBundle {
  /** npm package name sanitized to be a valid WESL identifier
   * (@ removed, / ==> __, - ==> _) */
  name: string;

  /** WESL edition of the code e.g. 2026_pre */
  edition: string;

  /** map of WESL/WGSL modules:
   *    keys are file paths, relative to package root (e.g. "./lib.wgsl")
   *    values are WESL/WGSL code strings
   */
  modules: Record<string, string>;

  /** packages referenced by this package */
  dependencies?: WeslBundle[];
}

export declare const weslBundle: WeslBundle;
export default weslBundle;
