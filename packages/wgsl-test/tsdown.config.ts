import { defineConfig } from "tsdown";

const sharedNeverBundle = [
  "../lib/weslBundle.js",
  /^node:/, // node builtins (CLI targets node22; "neutral" platform won't externalize these on its own)
  "fs",
  "module",
  "pngjs",
  "thimbleberry",
  "vitest",
  "vitest-image-snapshot",
];

export default defineConfig([
  {
    entry: ["./src/index.ts", "./src/wgslTestMain.ts"],
    target: "node22",
    clean: true,
    dts: true,
    sourcemap: true,
    platform: "neutral",
    deps: {
      neverBundle: [...sharedNeverBundle, "wesl", "wesl-gpu", "wesl-tooling"],
    },
    logLevel: "warn",
  },
  {
    // self-contained CLI for embedding in wgsl-studio extension
    entry: ["./src/runTestCli.ts"],
    target: "node22",
    clean: false,
    sourcemap: true,
    platform: "neutral",
    deps: {
      neverBundle: sharedNeverBundle,
      alwaysBundle: [/.*/], // bundle workspace deps (wesl, wesl-gpu, wesl-tooling)
      onlyBundle: false,
    },
    logLevel: "warn",
  },
]);
