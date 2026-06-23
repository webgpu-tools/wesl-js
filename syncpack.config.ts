import type { RcFile } from "syncpack";
export default {
  // Scope to the real workspace (mirrors pnpm-workspace.yaml). syncpack's `*`
  // matches across path separators, so without the negations below it also
  // scans gitignored artifacts like the downloaded VS Code app under
  // packages/wgsl-studio/.vscode-test, whose bundled manifests (deps newer than
  // ours, extensions named diff/yaml/typescript) pollute version analysis and
  // break `check:versions`.
  source: [
    "package.json",
    "packages/*/package.json",
    "packages/test_pkg/*/package.json",
    "packages/wesl-packager/src/test/multi_package/package.json",
    "packages/wesl-plugin/test/*/package.json",
    "examples/*/package.json",
    "!**/.vscode-test/**",
    "!**/_baseline/**",
    "!**/temp-built-test/**",
  ],
  sortFirst: [
    "name",
    "description",
    "version",
    "private",
    "author",
    "type",
    "bin",
    "files",
    "repository",
    "homepage",
    "scripts",
    "publishConfig",
    "exports",
    "main",
    "module",
    "types",
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "peerDependenciesMeta",
    "license",
    "keywords",
    "packageManager",
  ],
  versionGroups: [
    { label: "plugin is weird", packages: ["wesl-plugin"], isIgnored: true },
    {
      label: "Use workspace:x for dev dependencies on local packages",
      dependencies: ["$LOCAL"],
      dependencyTypes: ["dev"],
      pinVersion: "workspace:x",
    },
    {
      label: "Use workspace:^ for peer dependencies on local packages",
      dependencies: ["$LOCAL"],
      dependencyTypes: ["peer"],
      pinVersion: "workspace:^",
    },
    {
      label: "Use workspace:* for prod dependencies on local packages",
      dependencies: ["$LOCAL"],
      dependencyTypes: ["prod"],
      pinVersion: "workspace:*",
    },
  ],
} satisfies RcFile;
