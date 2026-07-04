#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const weslDir = path.dirname(import.meta.dirname);
const ctsDir = path.resolve(weslDir, "../../cts");
const transpilerDir = path.join(ctsDir, "transpiler/wesl");
const installDeps = process.argv.includes("--install-deps");
const verbose =
  process.argv.includes("-v") || process.argv.includes("--verbose");

if (!existsSync(ctsDir)) {
  console.error(`CTS directory not found: ${ctsDir}`);
  process.exit(1);
}

function run(cmd: string, cwd: string, ignoreExit = false): string {
  if (verbose) console.log(`> ${cmd}`);
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: "pipe" });
  } catch (e) {
    if (!ignoreExit) throw e;
    return (e as { stdout?: string }).stdout ?? "";
  }
}

function log(msg: string): void {
  if (verbose) console.log(msg);
}

function hasDeps(): boolean {
  return (
    existsSync(path.join(ctsDir, "node_modules")) &&
    existsSync(path.join(transpilerDir, "node_modules/wesl/package.json"))
  );
}

if (installDeps || !hasDeps()) {
  log("Installing CTS dependencies...");
  run("npm install", ctsDir);
  log("Installing wesl transpiler dependencies...");
  run("npm install", transpilerDir);
}

log("Building wesl...");
run("pnpm build", weslDir);

// Parsing-related tests (semantic validation is done by downstream WGSL compiler)
const testQueries = [
  "webgpu:shader,validation,parse,*",
  "webgpu:shader,validation,expression,precedence,*",
];

const gpuProvider = `${ctsDir}/transpiler/gpu_provider.ts`;
const transpiler = `${ctsDir}/transpiler/wesl/wesl_transpiler.ts`;

let totalErrors = 0;

for (const query of testQueries) {
  const safeName = query.replace(/[^a-z0-9]/gi, "_");
  const baselineFile = `/tmp/baseline-${safeName}.json`;
  const transpiledFile = `/tmp/transpiled-${safeName}.json`;

  console.log(`\n=== ${query} ===`);

  log("Running baseline...");
  run(
    `tools/run_node --gpu-provider ${gpuProvider} ` +
      `--print-json --quiet '${query}' > ${baselineFile}`,
    ctsDir,
    true,
  );

  log("Running with WESL transpiler...");
  run(
    `tools/run_node --gpu-provider ${gpuProvider} ` +
      `--shader-transpiler ${transpiler} ` +
      `--print-json --quiet '${query}' > ${transpiledFile}`,
    ctsDir,
    true,
  );

  const comparison = run(
    `transpiler/tools/compare_results.ts ${baselineFile} ${transpiledFile}`,
    ctsDir,
    true,
  );
  // Print from "** Comparison Summary **" onwards
  const summaryStart = comparison.indexOf("** Comparison Summary **");
  if (summaryStart !== -1) {
    console.log(comparison.slice(summaryStart));
  } else {
    // No summary means the runs or the comparison itself failed
    console.error(comparison);
    console.error(`Comparison produced no summary for ${query}`);
    totalErrors += 1;
  }

  // Count errors from the comparison output
  const parseErrors = comparison.match(/parse-errors:\s*(\d+)/)?.[1] ?? "0";
  const mistranslations =
    comparison.match(/mistranslations:\s*(\d+)/)?.[1] ?? "0";
  totalErrors +=
    Number.parseInt(parseErrors, 10) + Number.parseInt(mistranslations, 10);
}

if (totalErrors > 0) {
  console.error(`\nTotal transpiler errors: ${totalErrors}`);
  process.exit(1);
}
