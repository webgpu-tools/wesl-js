/** @hidden */
declare module "*?link" {
  import type { LinkParams } from "wesl/core";
  const linkParams: LinkParams;
  export default linkParams;
}

declare module "*?static" {
  const wgsl: string;
  export default wgsl;
}

/** @hidden */
declare module "*?simple_reflect" {
  import type { WeslStruct } from "wesl-reflect";
  export const structs: WeslStruct[];
}
