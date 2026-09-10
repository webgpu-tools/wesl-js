import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    projects: [
      "packages/*",
      "packages/wesl-plugin/test/*",
      "!packages/**/.claude",
      "!packages/wgsl-studio", // uses vscode-test, not vitest
    ],
    exclude: ["_baseline/**"],
  },
});
