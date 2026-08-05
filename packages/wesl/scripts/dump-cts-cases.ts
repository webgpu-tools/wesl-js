#!/usr/bin/env node
/**
 * Dump the CTS const-eval case tables to a directory of JSON, in the wire format
 * CtsCases.ts decodes.
 *
 * With no arguments this regenerates the checked-in dump in the cts fork
 * (`cts/dumps/cases/`) at the default caps and stamps a manifest with the src
 * tree hash it came from. Pass a scratch directory instead to dump at a
 * different size (no manifest is written there):
 *
 *   scripts/dump-cts-cases.ts --out /tmp/cts-all --max 0
 *   WESL_CTS_CASES=/tmp/cts-all pnpm exec vitest run CtsConstEval
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The operator caches. Matrix arithmetic is not const-evaluable yet, so the
 * af_matrix_* caches are left out rather than checked in as failures. */
export const operatorFilter = "^(binary|unary)/a[fi]_(?!matrix)";

/**
 * The builtin caches, which are named for the builtin itself. Excluded:
 * - bitcast: not const-evaluated by design (ConstEval.ts)
 * - derivatives, fwidth: not const-expressions
 * - pack*, unpack*: unimplemented, and the CTS has no const cases for them
 */
export const builtinFilter =
  "^(?!bitcast$|derivatives$|fwidth$|pack|unpack)[a-z][a-zA-Z0-9]*$";

// Sampled per case list. The operator lists are fewer and denser, so they carry
// a higher cap; the builtins have 3x the lists.
export const defaultOperatorMax = 100;
export const defaultBuiltinMax = 40;

export interface DumpCasesOptions {
  outDir: string;
  /** cases kept per operator list; 0 keeps all (default `defaultOperatorMax`) */
  operatorMax?: number;
  /** cases kept per builtin list; 0 keeps all (default `defaultBuiltinMax`) */
  builtinMax?: number;
}

const ctsDir = path.resolve(import.meta.dirname, "../../../cts");
const dumpCasesBin = path.join(ctsDir, "transpiler/tools/dump_cases");
const defaultDumpDir = path.join(ctsDir, "dumps/cases");

/** Write both the operator and builtin case files into `outDir`. Nothing in the
 * repo imports this after the test setup was retired; it stays the module's dump
 * entry point (used by the CLI below) rather than inlined. */
export function dumpCtsCases(opts: DumpCasesOptions): void {
  dump(opts.outDir, operatorFilter, opts.operatorMax ?? defaultOperatorMax);
  dump(opts.outDir, builtinFilter, opts.builtinMax ?? defaultBuiltinMax);
}

function dump(outDir: string, filter: string, max: number): void {
  const args = ["--out", outDir, "--filter", filter, "--max", String(max)];
  // launch via node: Windows cannot exec a shebang script
  execFileSync(process.execPath, [dumpCasesBin, ...args], { stdio: "inherit" });
}

/** Stamp the dump with the src tree it derives from, so a stale checked-in dump
 * is caught by CtsDumps.test.ts. Matches the guard's `git rev-parse HEAD:src`. */
function writeManifest(outDir: string): void {
  const sourceTree = execFileSync(
    "git",
    ["-C", ctsDir, "rev-parse", "HEAD:src"],
    { encoding: "utf8" },
  ).trim();
  const manifest = {
    sourceTree,
    operatorFilter,
    builtinFilter,
    operatorMax: defaultOperatorMax,
    builtinMax: defaultBuiltinMax,
  };
  writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function main(): void {
  const args = process.argv.slice(2);
  let outDir: string | undefined;
  let max: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outDir = args[++i];
    else if (args[i] === "--max") max = Number.parseInt(args[++i], 10);
    else usage(`unrecognized argument: ${args[i]}`);
  }

  if (outDir !== undefined) {
    // scratch dump at an explicit size, no manifest
    dumpCtsCases({ outDir, operatorMax: max, builtinMax: max });
    return;
  }
  if (max !== undefined) usage("--max only applies with --out");

  // regenerate the checked-in dump at the default caps, with its manifest
  dumpCtsCases({ outDir: defaultDumpDir });
  writeManifest(defaultDumpDir);
}

function usage(err: string): never {
  console.error(err);
  console.error("Usage: dump-cts-cases.ts [--out DIR [--max N]]");
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
