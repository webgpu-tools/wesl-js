import { readFileSync } from "node:fs";
import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";
import viteWesl from "wesl-plugin/vite";

const wgslPlayPkg = JSON.parse(
  readFileSync(new URL("../wgsl-play/package.json", import.meta.url), "utf-8"),
);

export default defineConfig({
  plugins: [preact(), viteWesl() as Plugin],
  define: {
    __WGSL_PLAY_VERSION__: JSON.stringify(wgslPlayPkg.version),
  },
  build: {
    outDir: "dist",
    target: "es2024",
    emptyOutDir: true,
    // app bundle includes CodeMirror + wesl, ~600kB is expected; warn only on real growth
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 9111,
    strictPort: true,
    fs: { allow: [".."] },
  },
});
