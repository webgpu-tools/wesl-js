#!/usr/bin/env node
/**
 * Regenerate the checked-in CTS validation shaders in the cts fork under
 * dumps/shaders/, stamping the src tree hash into a manifest so a cts bump
 * without a regen fails visibly (CtsDumps.test.ts).
 *
 * The dump runs the CTS validation suite on a real GPU (see dump_shaders), so
 * this is an occasional, explicit step, not a test.
 *
 *   scripts/dump-cts-shaders.ts                    rebuild dumps/shaders/ (--max 25)
 *   scripts/dump-cts-shaders.ts --transcript FILE  reuse a recorded transcript
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const ctsDir = path.resolve(import.meta.dirname, "../../../cts");
const dumpShadersBin = path.join(ctsDir, "transpiler/tools/dump_shaders");
const dumpDir = path.join(ctsDir, "dumps/shaders");

/** Shaders kept per spec in the checked-in dump. */
const sampledMax = 25;

function main(): void {
  const args = process.argv.slice(2);
  const ti = args.indexOf("--transcript");
  const transcript = ti >= 0 ? args[ti + 1] : undefined;

  runDump(dumpDir, sampledMax, transcript);
  writeManifest(dumpDir);
}

function runDump(
  outDir: string,
  max: number,
  transcript: string | undefined,
): void {
  const args = ["--out", outDir, "--max", String(max)];
  if (transcript) args.push("--transcript", transcript);
  // launch via node: Windows cannot exec a shebang script
  execFileSync(process.execPath, [dumpShadersBin, ...args], {
    stdio: "inherit",
  });
}

/** Stamp the dump with the src tree it derives from, so a stale checked-in dump
 * is caught by CtsDumps.test.ts. Matches the guard's `git rev-parse HEAD:src`. */
function writeManifest(outDir: string): void {
  const sourceTree = execFileSync(
    "git",
    ["-C", ctsDir, "rev-parse", "HEAD:src"],
    { encoding: "utf8" },
  ).trim();
  const manifest = { sourceTree, max: sampledMax };
  writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

main();
