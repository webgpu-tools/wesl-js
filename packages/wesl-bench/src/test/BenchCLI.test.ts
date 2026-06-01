import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { baselineDir } from "../BaselineVariations.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const benchPath = join(__dirname, "../../bin/bench.ts");

test("runs without errors", () => {
  const result = execSync(
    `node --expose-gc --experimental-strip-types ${benchPath} --profile`,
    { encoding: "utf8" },
  );

  if (!result.includes("bevy_env_map"))
    throw new Error("Missing benchmark name");
  if (!result.includes("link")) throw new Error("Missing link variant");
});

test.skip("supports --baseline flag", { timeout: 30000 }, () => {
  const hasBaseline = existsSync(baselineDir);

  if (!hasBaseline) {
    console.log("Skipping baseline test - no _baseline directory");
    return;
  }

  const result = execSync(
    `node --expose-gc --experimental-strip-types ${benchPath} --profile --baseline`,
    { encoding: "utf8" },
  );

  // Baseline shows confidence intervals like "[-6.0%, +9.2%]"
  if (!result.includes("[")) throw new Error("Missing baseline CI intervals");
});

test("supports variant filter", { timeout: 30000 }, () => {
  const result = execSync(
    `node --expose-gc --experimental-strip-types ${benchPath} --profile --filter "/link"`,
    { encoding: "utf8" },
  );

  if (!result.includes("link")) throw new Error("Missing link variant");
});
