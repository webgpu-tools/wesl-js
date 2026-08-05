#!/usr/bin/env node
/**
 * Run CTS queries through the wesl transpiler hook and diff against a baseline
 * run, to catch parse and emit regressions in the linker. (Dawn judges the
 * shaders, so this exercises the front end, not the type core.)
 *
 * Needs a real GPU adapter, so it does not run under a sandbox.
 *
 *   test-cts.ts           the fast queries, run on every prepush
 *   test-cts.ts --full    the whole validation suite, run manually
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/** Prepush queries: parse fidelity, plus the precedence cases that most often
 * catch a bad re-emit. Kept under a second or two. */
const fastQueries = [
  "webgpu:shader,validation,parse,*",
  "webgpu:shader,validation,expression,precedence,*",
];

/** The rest of the validation suite. Minutes, not seconds; run before a merge.
 * (`expression,*` subsumes the precedence query above.) */
const fullQueries = [
  "webgpu:shader,validation,parse,*",
  "webgpu:shader,validation,const_assert,*",
  "webgpu:shader,validation,expression,*",
  "webgpu:shader,validation,decl,*",
  "webgpu:shader,validation,types,*",
  "webgpu:shader,validation,statement,*",
  "webgpu:shader,validation,functions,*",
  "webgpu:shader,validation,shader_io,*",
  "webgpu:shader,validation,extension,*",
];

const weslDir = path.dirname(import.meta.dirname);
const ctsDir = path.resolve(weslDir, "../../cts");
const transpilerDir = path.join(ctsDir, "transpiler/wesl");
const divergenceFile = path.join(import.meta.dirname, "cts-divergences.txt");
const installDeps = process.argv.includes("--install-deps");
const full = process.argv.includes("--full");
const verbose =
  process.argv.includes("-v") || process.argv.includes("--verbose");

if (!existsSync(ctsDir)) {
  console.error(`CTS directory not found: ${ctsDir}`);
  process.exit(1);
}

if (installDeps || !hasDeps()) {
  log("Installing CTS dependencies...");
  run("npm install", ctsDir);
  log("Installing wesl transpiler dependencies...");
  run("npm install", transpilerDir);
}

log("Building wesl...");
run("pnpm build", weslDir);

const gpuProvider = `${ctsDir}/transpiler/gpu_provider.ts`;
const transpiler = `${ctsDir}/transpiler/wesl/wesl_transpiler.ts`;
const queries = full ? fullQueries : fastQueries;

const issues = queries.flatMap(q => compareQuery(q));
if (issues.length > 0) {
  console.error(`\n${issues.length} transpiler errors:`);
  for (const issue of issues) console.error(`  ${issue}`);
  process.exit(1);
}

/** Run one query twice, with and without the transpiler, and diff the results.
 * Returns the tests whose shaders we failed to parse or mistranslated. */
function compareQuery(query: string): string[] {
  const safeName = query.replace(/[^a-z0-9]/gi, "_");
  const baselineFile = path.join(os.tmpdir(), `baseline-${safeName}.json`);
  const transpiledFile = path.join(os.tmpdir(), `transpiled-${safeName}.json`);
  const start = Date.now();

  console.log(`\n=== ${query} ===`);

  log("Running baseline...");
  ctsRun(`--print-json --quiet '${query}' > ${baselineFile}`);

  log("Running with WESL transpiler...");
  ctsRun(
    `--shader-transpiler ${transpiler} ` +
      `--print-json --quiet '${query}' > ${transpiledFile}`,
  );

  const comparison = run(
    `transpiler/tools/compare_results.ts --ignore-file '${divergenceFile}' ` +
      `${baselineFile} ${transpiledFile}`,
    ctsDir,
    true,
  );

  const summaryStart = comparison.indexOf("** Comparison Summary **");
  if (summaryStart === -1) {
    // No summary means the runs or the comparison itself failed
    console.error(comparison);
    console.error(`Comparison produced no summary for ${query}`);
    return [query];
  }
  console.log(comparison.slice(summaryStart));
  console.log(`elapsed: ${((Date.now() - start) / 1000).toFixed(1)}s`);

  return [
    ...issueTests(comparison, "Parse Errors"),
    ...issueTests(comparison, "Mistranslations"),
  ];
}

/** The test names listed under one of compare_results' issue headings. */
function issueTests(comparison: string, heading: string): string[] {
  const start = comparison.indexOf(`** ${heading} (`);
  if (start === -1) return [];
  const lines = comparison.slice(start).split("\n").slice(1);
  const end = lines.findIndex(l => l.trim() === "");
  return lines
    .slice(0, end === -1 ? undefined : end)
    .filter(l => l.startsWith("  webgpu:"))
    .map(l => l.trim());
}

function ctsRun(args: string): void {
  run(`tools/run_node --gpu-provider ${gpuProvider} ${args}`, ctsDir, true);
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
