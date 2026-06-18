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
  if (!result.includes("WESL")) throw new Error("Missing matrix name");
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

// --list resolves the matrix cases/variants without running any benchmark,
// so it's a fast check that wesl-bench is wired into benchforge correctly.
test("--list shows matrix cases and variants", () => {
  const result = execSync(
    `node --expose-gc --experimental-strip-types ${benchPath} --list`,
    { encoding: "utf8" },
  );

  if (!result.includes("WESL")) throw new Error("Missing matrix name");
  for (const variant of ["link", "parse", "tokenize", "wgsl-reflect"]) {
    if (!result.includes(variant))
      throw new Error(`Missing variant: ${variant}`);
  }
});
