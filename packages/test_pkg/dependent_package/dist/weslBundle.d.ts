export interface WeslBundle {
  /** name of the package, e.g. random_wgsl */
  name: string;

  /** wesl edition of the code e.g. 2026_pre */
  edition: string;

  /** map of wesl/wgsl modules:
   *    keys are file paths, relative to package root (e.g. "./lib.wgsl")
   *    values are wgsl/wesl code strings
   */
  modules: Record<string, string>;

  /** packages referenced by this package */
  dependencies?: WeslBundle[];
}

export declare const weslBundle: WeslBundle;
export default weslBundle;
