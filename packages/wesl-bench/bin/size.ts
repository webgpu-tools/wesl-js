#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Bundle-size report for tracked entry points: the runtime linker surface
// (wesl/link, wesl/types, wesl/all) and the product bundles (wgsl-play,
// wgsl-edit). The full report goes to size-report/latest.md + sizes.json
// (gitignored; run it when you want a snapshot -- nothing regenerates it on
// prepush/CI); the console gets a one-line headline.
//
//   bin/size.ts               build, measure, snapshot
//   bin/size.ts --no-build    measure existing artifacts only
//   bin/size.ts --baseline    also diff wesl slices vs _baseline/ (bench:baseline)
//
// Sizing model (both bundled + minified in-process, what a consumer ships):
//   slices  - a named import surface from wesl's published dist.
//   product - the component entry, plus a per-package attribution of what fills
//             it (codemirror, lezer, the linker, ...).

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  type Attribution,
  measureProduct,
  measureSlice,
  type Sizes,
} from "../src/SizeTracking.ts";

interface SlicePoint {
  point: string;
  role: string;
  names: string[] | "*";
}
interface ProductPoint {
  point: string;
  role: string;
  pkgDir: string;
  entry: string;
}
interface PointResult {
  point: string;
  role: string;
  kind: "slice" | "product";
  pkgDir?: string;
  sizes: Sizes;
  baseline?: Sizes;
  attribution?: Attribution;
}

const repoRoot = resolve(import.meta.dirname, "../../..");
const reportDir = resolve(import.meta.dirname, "../size-report");

const slices: SlicePoint[] = [
  { point: "wesl/link", role: "headline linker", names: ["link"] },
  {
    point: "wesl/types",
    role: "type API",
    names: ["typeOfExpr", "evalConstExpr", "checkModule", "conversionRank"],
  },
  { point: "wesl/all", role: "tree-shake upper bound", names: "*" },
];

const products: ProductPoint[] = [
  {
    point: "wgsl-play",
    role: "product bundle",
    pkgDir: "wgsl-play",
    entry: "packages/wgsl-play/src/index.ts",
  },
  {
    point: "wgsl-edit",
    role: "product bundle",
    pkgDir: "wgsl-edit",
    entry: "packages/wgsl-edit/src/index.ts",
  },
];

/** External packages listed per product, largest first. */
const topPkgCount = 12;

const weslDist = resolve(repoRoot, "packages/wesl/dist/index.js");
const baselineDist = resolve(repoRoot, "_baseline/packages/wesl/dist/index.js");

await main();

async function main(): Promise<void> {
  const { doBuild, doBaseline } = parseFlags(process.argv.slice(2));
  if (doBuild) ensureBuilds();
  if (!existsSync(weslDist)) {
    throw new Error(`${weslDist} not built; run without --no-build`);
  }
  const haveBaseline = doBaseline && ensureBaseline(doBuild);

  const results = await measurePoints(haveBaseline);
  writeSnapshot(results, formatReport(results));
  console.log(summary(results));
}

/** Parse and validate CLI flags. */
function parseFlags(argv: string[]): {
  doBuild: boolean;
  doBaseline: boolean;
} {
  const flags = new Set(argv);
  const known = ["--no-build", "--baseline"];
  const unknown = [...flags].filter(f => !known.includes(f));
  if (unknown.length) {
    throw new Error(
      `unknown flags: ${unknown.join(" ")} (expected: ${known.join(" ")})`,
    );
  }
  return {
    doBuild: !flags.has("--no-build"),
    doBaseline: flags.has("--baseline"),
  };
}

/** The console take-away: brotli kB per point (with baseline deltas), and where the report went. */
function summary(results: PointResult[]): string {
  const points = results
    .map(r => {
      const base = r.baseline
        ? ` (${signed((r.sizes.brotli - r.baseline.brotli) / 1024)})`
        : "";
      return `${r.point} ${kb(r.sizes.brotli)}${base}`;
    })
    .join(", ");
  const report = relative(process.cwd(), resolve(reportDir, "latest.md"));
  return `brotli kB: ${points}\nreport: ${report} (+ sizes.json)`;
}

/**
 * Build what the report measures: wesl's published build for the slices, and
 * lezer-wesl's generated grammar (`src/parser.js`) that wgsl-edit bundles from
 * source. The products themselves are bundled in-process from their entries, so
 * their tsdown `dist` is not built or measured.
 */
function ensureBuilds(): void {
  run("pnpm --filter lezer-wesl build");
  run("pnpm --filter wesl build");
}

function run(cmd: string): void {
  execSync(cmd, { cwd: repoRoot, stdio: "inherit" });
}

/** Ensure _baseline's wesl build exists so slices can diff against it. */
function ensureBaseline(doBuild: boolean): boolean {
  if (existsSync(baselineDist)) return true;
  const baseWesl = resolve(repoRoot, "_baseline/packages/wesl");
  if (!existsSync(baseWesl)) {
    console.warn(
      "--baseline: no _baseline/ found. Run `pnpm bench:baseline <ref>` first.",
    );
    return false;
  }
  if (!doBuild) {
    console.warn("--baseline: baseline not built; rerun without --no-build.");
    return false;
  }
  try {
    execSync("pnpm build", { cwd: baseWesl, stdio: "inherit" });
  } catch {
    console.warn("--baseline: baseline build failed; skipping baseline.");
    return false;
  }
  return existsSync(baselineDist);
}

/** Measure every tracked slice and product, diffing slices vs baseline when present. */
async function measurePoints(haveBaseline: boolean): Promise<PointResult[]> {
  const results: PointResult[] = [];
  for (const s of slices) {
    const sizes = await measureSlice(weslDist, s.names);
    const baseline = haveBaseline
      ? await measureSlice(baselineDist, s.names)
      : undefined;
    results.push({ ...s, kind: "slice", sizes, baseline });
  }
  for (const p of products) {
    const entry = resolve(repoRoot, p.entry);
    const { sizes, attribution } = await measureProduct(entry, p.pkgDir);
    results.push({ ...p, kind: "product", sizes, attribution });
  }
  return results;
}

function formatReport(results: PointResult[]): string {
  const { hash, date } = gitInfo();
  const sliceRows = results.filter(r => r.kind === "slice");
  const productRows = results.filter(r => r.kind === "product");
  const parts = [`# Bundle sizes\n`, `${hash} (${date})\n`];
  parts.push(sliceTable(sliceRows), featureDeltas(sliceRows));
  if (productRows.length) {
    parts.push(productTable(productRows));
    for (const p of productRows) parts.push(externalsBreakdown(p));
  }
  return parts.join("\n");
}

function gitInfo(): { hash: string; date: string } {
  return {
    hash: git("git rev-parse --short HEAD"),
    date: git("git log -1 --format=%aI"),
  };
}

function sliceTable(rows: PointResult[]): string {
  const hasBase = rows.some(r => r.baseline);
  const head = hasBase
    ? "| point | role | raw | brotli | Δ brotli |\n|---|---|--:|--:|--:|"
    : "| point | role | raw | brotli |\n|---|---|--:|--:|";
  const body = rows.map(r => {
    const base = hasBase
      ? ` | ${delta(r.sizes.brotli, r.baseline?.brotli)}`
      : "";
    return `| ${r.point} | ${r.role} | ${kb(r.sizes.raw)} | ${kb(r.sizes.brotli)}${base} |`;
  });
  return `## Import surfaces (bundled + minified)\n\n${head}\n${body.join("\n")}\n`;
}

/** Marginal cost of each stage over the minimal linker, in brotli kB. */
function featureDeltas(rows: PointResult[]): string {
  const link = rows.find(r => r.point === "wesl/link")?.sizes.brotli;
  if (link === undefined) return "";
  const kbDelta = (r: PointResult) => signed((r.sizes.brotli - link) / 1024);
  const lines = rows
    .filter(r => r.point !== "wesl/link")
    .map(r => `- ${r.point} vs wesl/link: ${kbDelta(r)} kB brotli`);
  return `### Surface deltas (brotli)\n\n${lines.join("\n")}\n`;
}

function productTable(rows: PointResult[]): string {
  const head =
    "| point | raw (min) | brotli | ext % | ext pkgs |\n|---|--:|--:|--:|--:|";
  const body = rows.map(r => {
    const a = r.attribution;
    const pct = a?.totalBrotli
      ? `${((a.externalBrotli / a.totalBrotli) * 100).toFixed(0)}%`
      : "-";
    return `| ${r.point} | ${kb(r.sizes.raw)} | ${kb(r.sizes.brotli)} | ${pct} | ${a?.count ?? "-"} |`;
  });
  return (
    `## Product bundles (minified, as a consumer bundles the component)\n\n` +
    `${head}\n${body.join("\n")}\n`
  );
}

/** Per-package attribution for one product: local source vs the top imports. */
function externalsBreakdown(p: PointResult): string {
  const a = p.attribution;
  if (!a) return "";
  const pct = a.totalBrotli
    ? ((a.externalBrotli / a.totalBrotli) * 100).toFixed(0)
    : "0";
  const share = (b: number) =>
    a.totalBrotli ? `${((b / a.totalBrotli) * 100).toFixed(0)}%` : "-";
  const rows = a.top
    .slice(0, topPkgCount)
    .map(e => `| ${e.pkg} | ${kb(e.brotli)} | ${share(e.brotli)} |`)
    .join("\n");
  return (
    `### ${p.point} externals: ${pct}% of ${kb(a.totalBrotli)} kB brotli (${a.count} packages)\n\n` +
    `local (${p.pkgDir} source): ${kb(a.localBrotli)} kB brotli (${share(a.localBrotli)})\n\n` +
    `brotli~ apportions the shipped brotli by each package's compressed share.\n\n` +
    `| package | brotli~ | % |\n|---|--:|--:|\n${rows}\n`
  );
}

function git(cmd: string): string {
  try {
    return execSync(cmd, { cwd: repoRoot }).toString().trim();
  } catch {
    return "unknown";
  }
}

/** A `current - baseline` brotli delta as `+N B (+p%)`, or `-` when no baseline. */
function delta(current: number, baseline?: number): string {
  if (baseline === undefined) return "-";
  const diff = current - baseline;
  const pct = baseline === 0 ? 0 : (diff / baseline) * 100;
  return `${diff >= 0 ? "+" : ""}${diff} B (${signed(pct)}%)`;
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(2);
}

function signed(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

function writeSnapshot(results: PointResult[], report: string): void {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolve(reportDir, "latest.md"), `${report}\n`);
  const { hash, date } = gitInfo();
  const points: Record<string, unknown> = {};
  for (const r of results) {
    points[r.point] = {
      kind: r.kind,
      raw: r.sizes.raw,
      brotli: r.sizes.brotli,
      ...(r.attribution ? { external: attributionJson(r.attribution) } : {}),
    };
  }
  const json = JSON.stringify({ hash, date, points }, null, 2);
  writeFileSync(resolve(reportDir, "sizes.json"), `${json}\n`);
}

function attributionJson(a: Attribution): unknown {
  return {
    count: a.count,
    externalBrotli: a.externalBrotli,
    localBrotli: a.localBrotli,
    top: a.top.slice(0, topPkgCount),
  };
}
