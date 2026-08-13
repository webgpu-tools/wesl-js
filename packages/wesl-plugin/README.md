# WESL Plugin

[![NPM Version](https://img.shields.io/npm/v/wesl-plugin)](https://www.npmjs.com/package/wesl-plugin)
[![Static Badge](https://img.shields.io/badge/Read%20the%20-Docs-blue)](https://wesl-lang.dev/)

Bundler plugin for importing `.wesl` and `.wgsl` shader files in JavaScript/TypeScript.

## Install

```
npm install wesl wesl-plugin
```

## Quick Start

### Build-time linking (?static)

Link shaders at build time for the smallest application bundle size. 

```ts
// vite.config.ts
import { staticBuildExtension } from "wesl-plugin";
import viteWesl from "wesl-plugin/vite";

export default {
  plugins: [viteWesl({ extensions: [staticBuildExtension] })]
};
```

```ts
// app.ts
import wgsl from "./shaders/main.wesl?static";

const module = device.createShaderModule({ code: wgsl });
```

### Runtime linking (?link)

Link shaders at runtime when you need dynamic conditions or constants:

```ts
// vite.config.ts
import { linkBuildExtension } from "wesl-plugin";
import viteWesl from "wesl-plugin/vite";

export default {
  plugins: [viteWesl({ extensions: [linkBuildExtension] })]
};
```

```ts
// app.ts
import { createShaderModule, link } from "wesl";
import shaderConfig from "./shaders/main.wesl?link";

const linked = await link({
  ...shaderConfig,
  conditions: { MOBILE: isMobileGPU },
  constants: { num_lights: 4 }
});

const module = createShaderModule(linked, device, {});
```

## Other Bundlers

```ts
import viteWesl from "wesl-plugin/vite";
import esbuildWesl from "wesl-plugin/esbuild";
import rollupWesl from "wesl-plugin/rollup";
import webpackWesl from "wesl-plugin/webpack";
// Also: nuxt, farm, rspack, astro
```

## Extensions

Extensions enable different import suffixes:

| Extension | Suffix | Output | Use Case |
|-----------|--------|--------|----------|
| `staticBuildExtension` | `?static` | WGSL string | Build-time linking, simplest |
| `linkBuildExtension` | `?link` | LinkParams object | Runtime conditions/constants |

### Combining Extensions

```ts
import { staticBuildExtension, linkBuildExtension } from "wesl-plugin";
import viteWesl from "wesl-plugin/vite";

export default {
  plugins: [viteWesl({
    extensions: [staticBuildExtension, linkBuildExtension]
  })]
};
```

### Conditions in Import Path

For `?static`, you can specify conditions as query parameters:

```ts
import wgsl from "./app.wesl?MOBILE=true&DEBUG=false&static";
```

## Configuration (wesl.toml)

The plugin reads `wesl.toml` to find shader files and dependencies:

```toml
weslFiles = ["shaders/**/*.wesl"]
weslRoot = "shaders"
dependencies = ["auto"]  # Auto-detect from package.json
```

## Prototype Extensions

- **SimpleReflectExtension** - Demo for extension authors showing how to generate JS/TS from shader structs

## Writing Custom Extensions

```ts
import type { PluginExtension } from "wesl-plugin";

const myExtension: PluginExtension = {
  extensionName: "myfeature",  // enables ?myfeature imports
  emitFn: async (shaderPath, api, conditions, options) => {
    const sources = await api.weslSrc();
    // Return JavaScript code as a string
    return `export default ${JSON.stringify(sources)};`;
  }
};
```

See [PluginExtension.ts](https://github.com/webgpu-tools/wesl-js/blob/main/packages/wesl-plugin/src/PluginExtension.ts) for the full API.
