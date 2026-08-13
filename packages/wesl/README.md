# WESL

[![Static Badge](https://img.shields.io/badge/Documentation-0475b6?style=for-the-badge)](https://wesl-lang.dev/)
[![NPM Version](https://img.shields.io/npm/v/wesl?style=for-the-badge)](https://www.npmjs.com/package/wesl)
[![Discord](https://img.shields.io/discord/1275293995152703488?style=for-the-badge&label=Discord)](https://discord.gg/Ty7MjWVfvh)

For documentation, see:
  **[Getting Started with JavaScript/TypeScript](https://wesl-lang.dev/docs/Getting-Started-JavaScript)**

For sample code, start with one of the wesl-js **[Examples]**.

---

_WESL is an extended version of WebGPU's [WGSL](https://www.w3.org/TR/WGSL/#intro) shading language. Everything you know from WGSL just works._

WESL adds features:

- **imports** to split shaders into modular, reusable files.
- **conditional compiliation** to configure shader variations at compile time or run time.
- **shader libraries** on npm and cargo, for community sharing of shader code modules.

This [wesl] library contains a **TypeScript** WESL linker.
[wesl] can be used at runtime or at build time to assemble WESL and WGSL modules for WebGPU.

<img style="margin:10px 0px -10px 40px" src="https://docs.google.com/drawings/d/e/2PACX-1vRKxcnMB-U-UVcDRO6N6UMJESTodUBRnV6cVrrS_XwJetucnOfYCU9ztk9veXoqLJ7DinBdDnR9EiK-/pub?w=400&amp;h=300">


## WESL Example

<pre>
<b>import</b> package::colors::chartreuse;    <b>// 1. modularize shaders in separate files</b>
<b>import</b> random_wgsl::pcg_2u_3f;         <b>// 2. use shader libraries from npm/cargo</b>

fn random_color(uv: vec2u) -> vec3f {
  var color = pcg_2u_3f(uv);

  <b>@if(DEBUG)</b> color = chartreuse;       <b>// 3. set conditions at runtime or build time</b>

  return color;
}
</pre>

## Entry points

`wesl` is the entry point for browser code. It includes the WebGPU layer
(`createShaderModule`, `requestWeslDevice`, `WeslDevice`), so it needs WebGPU
types: TypeScript 7's `DOM` lib, or the `@webgpu/types` package.

`wesl/core` is the same linker without the WebGPU layer, for code that runs
outside the browser: vite configs, cli tools, and codegen scripts. It
typechecks with `"lib": ["ESNext"]` and no WebGPU types, so a node program
doesn't need browser types to build.

```ts
import { link } from "wesl/core";  // node build script, no DOM lib needed
```

[wesl plugin]: https://www.npmjs.com/package/wesl-plugin
[examples]: https://github.com/webgpu-tools/wesl-js/tree/main/examples 
[wesl]: https://www.npmjs.com/package/wesl