import { defineConfig } from "tsdown";
export default defineConfig({
  target: "es2024",
  clean: true,
  platform: "neutral",
  logLevel: "warn",
  dts: true,
});
