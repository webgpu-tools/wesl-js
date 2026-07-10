# WGSL Studio

Test runner for native WGSL / WESL tests.

Live shader preview of WGSL and WESL shaders.

## WESL GPU Tests

WGSL Studio includes a native test runner for GPU shader tests.
Tag functions with `@test` and use `expect` from `wgsl_test`:

```wgsl
import wgsl_test::expect;

@test fn myTest() { expect(1 == 1); }
```

Tests are discovered automatically and appear in the VS Code **Test Explorer**.
Run them from there, or use the command palette.

The native test runner can be disabled in settings
(`wgslStudio.nativeTestRunner.enabled`) if you prefer using Vitest instead.

## Quick Start

Create a fragment shader:

```wgsl
@fragment
fn main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / uniforms.size;
  return vec4f(uv, 0.5, 1.0);
}
```

Then run command **"WGSL Studio: Preview Toy Shader"** (or right-click the file).

## Built-in Uniforms

The preview provides these uniforms automatically:

- `uniforms.time` - elapsed time in seconds
- `uniforms.size` - viewport size in pixels
- `uniforms.mouse` - mouse position in pixels

See [wgsl-play](https://www.npmjs.com/package/wgsl-play) for full documentation.

## WESL Imports

The extension also supports WESL, so you can import local shader files
and shaders from npm packages.

```wgsl
import package::utils::palette;  // local file: ./utils/palette.wesl
import lygia::sdf::circleSDF;    // npm package

@fragment
fn main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / uniforms.size;
  let d = circleSDF(uv - 0.5);
  return vec4f(palette(d), 1.0);
}
```

See [wesl-lang.dev](https://wesl-lang.dev) for language documentation.
