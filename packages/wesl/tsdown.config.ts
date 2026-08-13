import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/index.ts", "src/core.ts", "src/weslBundleDeclUrl.ts"],
  target: "es2024",
  clean: true,
  platform: "neutral",
  logLevel: "warn",
});
