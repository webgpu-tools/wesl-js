# Contributing to WGSL Studio

## Architecture

**Extension Host (Node.js)**
- `extension.ts` - Entry point, commands
- `ToyPreviewPanel` - WebView lifecycle, messaging
- `ProjectLoader` - Load local sources (via wesl.toml) + external deps (from node_modules)

**WebView (Browser sandbox)** - communicates via postMessage
- `webview/main.ts` - Uses WgslPlay component
  - WebGPU initialization and render loop
  - Shader compilation via wesl linker

## Message Protocol

**Extension -> WebView:**
```typescript
{ type: "setProject", weslSrc, rootModuleName, packageName, libs }
{ type: "control", action: "play" | "pause" | "rewind" }
```

**WebView -> Extension:**
```typescript
{ type: "ready" }
{ type: "compileError", message: string }
{ type: "initError", message: string }
```

## Development

```bash
bb build        # Build extension + webview bundles
bb dev          # Watch mode
bb typecheck    # Type check
bb test:vscode  # Run tests in a VS Code instance
```

### Extension Tests

Tests use the [VS Code Test CLI](https://github.com/microsoft/vscode-test-cli)
and run inside a real VS Code instance. Build first, then run:

```bash
bb build && bb test:vscode
```

Tests live in `src/test/` and cover extension activation, command registration,
`@test` discovery, and test execution via the VS Code test controller.

## Launching the Extension

**Option 1: Debug mode (F5)**
1. Open this folder in VS Code
2. Press F5 to launch Extension Development Host
3. Open a .wgsl/.wesl file and run "WGSL Studio: Preview Toy Shader"

**Option 2: Command line (no debugger)**
```bash
bb launch
```

## Publishing

Publishing to the VS Code Marketplace:

```bash
rpr publish:vsix
```

Notes:
- Needs a one-time `vsce login webgpu-tools` with an Azure DevOps PAT. 
- One VSIX covers all OSes (darwin/win32/linux). 
- (`monobump` bumps the version across all packages including this one.)

(auto-publishing from CI someday, but OIDC isn't supported yet: 
([vsmarketplace#1422](https://github.com/microsoft/vsmarketplace/issues/1422)).)

## Build Configuration

The extension uses tsdown with two entry points:

1. **Extension host** (`src/extension.ts`): Node.js target, outputs to `dist/extension.mjs`
2. **WebView** (`src/webview/main.ts`): Browser target, bundles all dependencies including WgslPlay

## Dependencies

- `wesl` - Core linker types (WeslBundle)
- `wesl-tooling` - Project loading (findWeslToml, loadModules, dependencyBundles, readPackageJson)
- `wgsl-play` - Web component for shader rendering
- `wesl-gpu` - WebGPU utilities (uniforms, render pipeline)
