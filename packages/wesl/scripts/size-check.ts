#!/usr/bin/env node
// Measures realistic bundle size: what users pay when importing `link` from the package.
// Measures the published `dist` build, so the number reflects code we actually ship
// (debug flags and parser error messages included).
// Uses terser for minification. tsdown's built-in minifier (Oxc) is ~0.6% larger
// and still in alpha, but we may switch to it later.
//
// If a baseline copy of the repo exists at <repo>/_baseline (created by
// `pnpm bench:baseline <version>` in wesl-bench), the baseline's wesl is also
// measured and a delta is printed.

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { build } from "vite";

const scriptDir = import.meta.dirname;
const currentWesl = resolve(scriptDir, "..");
const repoRoot = resolve(scriptDir, "../../..");
const baselineWesl = resolve(repoRoot, "_baseline/packages/wesl");
const tmpRoot = resolve(currentWesl, ".size-check-tmp");

interface Sizes {
  raw: number;
  gzip: number;
  brotli: number;
}

async function main() {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });

  const current = await measure(currentWesl, "current");
  const baseline = existsSync(baselineWesl)
    ? await measure(baselineWesl, "baseline")
    : null;

  console.log();
  reportSize("Raw   ", current.raw, baseline?.raw);
  reportSize("Gzip  ", current.gzip, baseline?.gzip);
  reportSize("Brotli", current.brotli, baseline?.brotli);
  console.log();

  if (baseline) {
    const info = baselineVersionInfo();
    if (info) console.log(`Baseline: ${info}\n`);
  } else {
    console.log(
      `Tip: run \`pnpm bench:baseline <version>\` in wesl-bench to enable size diffs.\n`,
    );
  }

  rmSync(tmpRoot, { recursive: true, force: true });
}

/** Build (if needed) and bundle the wesl package at `weslDir`, returning sizes. */
async function measure(weslDir: string, label: string): Promise<Sizes> {
  const distDir = resolve(weslDir, "dist");
  if (!existsSync(resolve(distDir, "index.js"))) {
    console.log(`Building ${label}...`);
    execSync("pnpm build", { cwd: weslDir, stdio: "inherit" });
  }

  const outDir = resolve(tmpRoot, label);
  mkdirSync(outDir, { recursive: true });
  const entryFile = resolve(outDir, "entry.ts");
  writeFileSync(
    entryFile,
    `import { link } from ${JSON.stringify(`${distDir}/index.js`)};\nexport { link };\n`,
  );

  const outFile = "out.js";
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      lib: { entry: entryFile, formats: ["es"], fileName: () => outFile },
      outDir,
      emptyOutDir: false,
      minify: "terser",
      sourcemap: false,
      rollupOptions: { external: [] },
    },
  });

  const outPath = resolve(outDir, outFile);
  const bytes = readFileSync(outPath);
  return {
    raw: statSync(outPath).size,
    gzip: gzipSync(bytes).length,
    brotli: brotliCompressSync(bytes).length,
  };
}

/** Print one size line with byte resolution and an optional delta vs baseline. */
function reportSize(label: string, size: number, baseline?: number): void {
  const bytes = size.toLocaleString("en-US").padStart(8);
  const kB = (size / 1024).toFixed(2).padStart(7);
  let delta = "";
  if (baseline !== undefined) {
    const diff = size - baseline;
    const sign = diff > 0 ? "+" : diff < 0 ? "" : " ";
    const pct = baseline === 0 ? 0 : (diff / baseline) * 100;
    delta = `   ${sign}${diff.toLocaleString("en-US")} B (${sign}${pct.toFixed(2)}%)`;
  }
  console.log(`${label}: ${bytes} B  (${kB} kB)${delta}`);
}

/** Read baseline git version info written by `pnpm bench:baseline`. */
function baselineVersionInfo(): string | null {
  const file = resolve(repoRoot, "_baseline/.baseline-version");
  if (!existsSync(file)) return null;
  const { hash, date, ref } = JSON.parse(readFileSync(file, "utf8"));
  return `${hash} (${date})${ref && ref !== hash ? ` [${ref}]` : ""}`;
}

main().catch(console.error);
