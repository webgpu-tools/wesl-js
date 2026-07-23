# WESL Package Structures

WESL packages are distributed on npm as JavaScript packages,
with WESL source code stored as strings inside
JavaScript objects that implement the WeslBundle interface.
Each WeslBundle can contain multiple WESL modules.
An npm package can export multiple WeslBundles using the
`package.json` `exports` subpath mechanism. 

## WeslBundle JavaScript Interface

**Key fields**:
- `name`: Sanitized npm package name
- `modules`: Map of relative file paths to WESL/WGSL code strings
- `dependencies`: Array of imported WeslBundle objects

See [WeslBundle.ts](src/WeslBundle.ts) for the complete interface definition.

**Example weslBundle.js**

Here's an example bundle file (for `lygia::math::permute`):

```javascript
import lygia_math_mod289 from "lygia/math/mod289";

export const weslBundle = {
  name: "lygia",
  edition: "2026_pre",
  modules: {
    "math/permute.wesl":
      "import lygia::math::mod289::{mod289, mod289_2, mod289_3, mod289_4};\n\n/*\ncontributors: [Stefan Gustavson, Ian McEwan]\ndescription: permute\n*/\n\nfn permute(x: f32) -> f32 { return mod289(((x * 34.0) + 1.0) * x); }\nfn permute2(x: vec2f) -> vec2f { return mod289_2(((x * 34.0) + 1.0) * x); }\nfn permute3(x: vec3f) -> vec3f { return mod289_3(((x * 34.0) + 1.0) * x); }\nfn permute4(x: vec4f) -> vec4f { return mod289_4(((x * 34.0) + 1.0) * x); }\n",
  },
  dependencies: [lygia_math_mod289],
};

export default weslBundle;
```

**Dependencies**

The `dependencies` field references other WeslBundles, which can be in separate files or npm packages. JavaScript import statements connect weslBundle.js files across any installed npm package.

WESL source code can import:
- Modules within the same bundle (via `modules` keys)
- Modules from other bundles (via `dependencies`)
- Bundles from the same or different npm packages

## Single-Bundle npm Packages

The simplest way to assemble a WESL/WGSL package is to
create a single weslBundle for all shader modules. 

**Example**: random_wgsl

```
random_wgsl/
├── shaders/
│   └── lib.wgsl
├── dist/
│   └── weslBundle.js          # all modules in one bundle
└── package.json
    exports: {
      ".": "./dist/weslBundle.js"
    }
```

Single bundle mode is the default for `wesl-packager` and is
recommended for most shader libraries.

## Multi-Bundle npm Packages

Library authors can also assemble a WESL/WGSL package
with multiple weslBundles. 

**Example**: lygia

```
lygia/
├── dist/
│   ├── color/
│   │   ├── hueShift/weslBundle.js      # one bundle per source file
│   │   └── space/
│   │       ├── rgb2hsl/weslBundle.js
│   │       └── hsl2rgb/weslBundle.js
│   ├── sdf/
│   │   └── boxSDF/weslBundle.js
│   ├── math/
│   │   └── cubic/weslBundle.js
│   └── ... (190+ total bundles)
└── package.json
    exports: {
      "./*": "./dist/*/weslBundle.js"
    }
```

Use `wesl-packager --multiBundle` to package one weslBundle per
source file. 


**Key characteristics**:
- One weslBundle.js per source file
- Enables build-time tree-shaking: bundler plugins (Vite, Rollup, Webpack) include only the weslBundles statically referenced by application shaders

**Limitation**: Static analysis uses default values for `@if` conditions. If your library relies on `@if` configuration that affects which modules are imported, prefer single bundle mode to ensure all necessary modules are available.