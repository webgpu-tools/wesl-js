import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/ScanDependencies.ts"],
  target: "node22",
  clean: true,
  dts: true,
  platform: "neutral",
  deps: {
    neverBundle: [
      "wesl",
      "glob",
      "import-meta-resolve",
      "toml",
      "node:fs",
      "node:fs/promises",
      "node:path",
      "node:url",
    ],
  },
  logLevel: "warn",
});
