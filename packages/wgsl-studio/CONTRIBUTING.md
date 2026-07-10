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

Publishing to the VS Code Marketplace, with the PAT from the macOS Keychain:

```bash
VSCE_PAT=$(security find-generic-password -a "$USER" -s vsce-webgpu-tools -w) rpr publish:vsix
```

Notes:
- One VSIX covers all OSes (darwin/win32/linux).
- (`monobump` bumps the version across all packages including this one.)

### The Azure DevOps Personal Access Token 
Don't use `vsce login` -- its keytar credential store is abandoned and falls back to
storing the token clear-text in `~/.vsce`. Instead keep the PAT in the Keychain and pass
it via `VSCE_PAT` as above.

Create/regenerate the PAT:
1. https://marketplace.visualstudio.com/manage -> confirm you own the `webgpu-tools`
   publisher (personal Microsoft account lee@underneath.ca).
2. https://dev.azure.com/mighdoll/_usersSettings/tokens -> New Token, with
   **Organization: All accessible organizations** and scope **Marketplace > Manage**.
3. Store it: `security add-generic-password -U -a "$USER" -s vsce-webgpu-tools -w`
   (paste at the prompt), then verify with
   `VSCE_PAT=$(security find-generic-password -a "$USER" -s vsce-webgpu-tools -w) pnpx @vscode/vsce verify-pat webgpu-tools`.

(Auto-publishing from CI someday, but the Marketplace has no OIDC trusted publishing yet
([vsmarketplace#1422](https://github.com/microsoft/vsmarketplace/issues/1422)), and global
PATs retire 2026-12-01 in favor of Entra ID federation -- so it stays manual for now.)

## Build Configuration

The extension uses tsdown with two entry points:

1. **Extension host** (`src/extension.ts`): Node.js target, outputs to `dist/extension.mjs`
2. **WebView** (`src/webview/main.ts`): Browser target, bundles all dependencies including WgslPlay

## Dependencies

- `wesl` - Core linker types (WeslBundle)
- `wesl-tooling` - Project loading (findWeslToml, loadModules, dependencyBundles, readPackageJson)
- `wgsl-play` - Web component for shader rendering
- `wesl-gpu` - WebGPU utilities (uniforms, render pipeline)
