import { cpSync, globSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import viteWesl from "wesl-plugin/vite";

// Each .html in test-page is its own page; enumerate them so
// `vite build test-page` emits the whole multi-page test site.
const pages = globSync(import.meta.dirname + "/test-page/*.html");

// The shaderRoot demos fetch .wesl files from /shaders at runtime. The dev
// server serves them straight from the source tree, but a build only emits
// imported/bundled assets, so copy the shader tree into the output.
function copyShaders(): Plugin {
  let outDir: string;
  return {
    name: "copy-test-page-shaders",
    apply: "build",
    configResolved(c) {
      // outDir comes back relative to root, so anchor it there
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const src = import.meta.dirname + "/test-page/shaders";
      cpSync(src, resolve(outDir, "shaders"), { recursive: true });
    },
  };
}

export default defineConfig({
  build: {
    // build root is test-page (a CLI arg), so this lands in
    // packages/wgsl-play/site
    outDir: "../site",
    emptyOutDir: true,
    rollupOptions: { input: pages },
    // the WESL linker + wesl-gpu runtime is one shared chunk (~560kB) that
    // every page needs; that's expected here, so lift the default 500kB warn
    chunkSizeWarningLimit: 1000,
  },
  plugins: [
    viteWesl({
      // debug: true,
      weslToml: "./test-page/wesl.toml",
    }),
    copyShaders(),
  ],
  server: {
    fs: {
      // Allow serving files from sibling packages for dev mode testing
      allow: [".."],
    },
  },
});
