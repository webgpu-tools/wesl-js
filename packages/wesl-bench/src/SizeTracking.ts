// Bundle-size measurement for tracked entry points.
//
// Two kinds of point:
//  - import surfaces (`wesl/link`, `wesl/types`, `wesl/all`): bundled + minified
//    from the wesl build, modelling what a consumer's bundler pays per import.
//  - product bundles (`wgsl-play`, `wgsl-edit`): the component entry bundled +
//    minified the way a consumer ships it (validated against examples/), plus an
//    attribution of which packages fill it. (Not the tsdown `dist/*.js`, which is
//    unminified and brotlis ~1.9x larger than what a consumer actually ships.)
//
// Compression is brotli (quality 11, what a CDN serves for static assets); raw is
// the honest byte count. See bin/size.ts for the CLI that drives this.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { build, type Plugin, type Rollup } from "vite";

export interface Sizes {
  raw: number;
  brotli: number;
}

/** How a product bundle's shipped brotli splits across the packages that fill it. */
export interface Attribution {
  count: number; // distinct external packages
  externalBrotli: number; // brotli from packages other than the product's own source
  localBrotli: number; // brotli from the product's own source
  totalBrotli: number; // the shipped brotli the split sums to
  top: PkgBytes[]; // external packages, largest brotli first
}

export interface PkgBytes {
  pkg: string;
  brotli: number; // apportioned share of the shipped brotli (approx)
}

/** raw + brotli of a byte buffer. Brotli defaults to quality 11 (CDN static). */
export function compress(bytes: Buffer): Sizes {
  return { raw: bytes.length, brotli: brotliCompressSync(bytes).length };
}

/**
 * Bundle + minify a single import surface from a built wesl entry, returning the
 * cost a consumer pays for that import. `names` is a list of named exports, or
 * "*" for the whole package (`export *`, the tree-shake upper bound).
 */
export async function measureSlice(
  distEntry: string,
  names: string[] | "*",
): Promise<Sizes> {
  const src = sliceEntrySrc(distEntry, names);
  const dir = mkdtempSync(join(tmpdir(), "wesl-size-"));
  try {
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, src);
    const { code } = await bundle(entry);
    return compress(code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Bundle + minify a product's component entry the way a consumer ships it, and
 * attribute the result to the packages that fill it. `ownPkgDir` (the product's
 * directory under packages/) separates its own source from imported packages.
 */
export async function measureProduct(
  entrySrc: string,
  ownPkgDir: string,
): Promise<{ sizes: Sizes; attribution: Attribution }> {
  const { code, modules } = await bundle(entrySrc);
  const sizes = compress(code);
  return { sizes, attribution: attribute(modules, ownPkgDir, sizes.brotli) };
}

interface BundleResult {
  code: Buffer;
  modules: Record<string, Rollup.RenderedModule>;
}

/** Source of a temp entry module that re-exports `names` (or all) from a built entry. */
function sliceEntrySrc(distEntry: string, names: string[] | "*"): string {
  const from = JSON.stringify(distEntry);
  if (names === "*") return `export * from ${from};\n`;
  const list = names.join(", ");
  return `import { ${list} } from ${from};\nexport { ${list} };\n`;
}

/** Bundle + minify `entry` with vite/rollup, returning emitted code and
 * per-module sizes. Dynamic imports emit extra chunks; a consumer ships them
 * all, so every chunk counts toward the code and the attribution. */
async function bundle(entry: string): Promise<BundleResult> {
  const res = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [textAssets()],
    build: {
      lib: { entry, formats: ["es"], fileName: () => "size.js" },
      write: false,
      minify: "terser",
      cssMinify: false,
      sourcemap: false,
      rollupOptions: { external: [], onwarn() {} },
    },
  });
  const outputs = (Array.isArray(res) ? res : [res]) as Rollup.RollupOutput[];
  const chunks = outputs[0].output.filter(o => o.type === "chunk");
  if (chunks.length === 0) throw new Error(`no chunk from ${entry}`);
  const modules: Record<string, Rollup.RenderedModule> = {};
  for (const c of chunks) Object.assign(modules, c.modules);
  return { code: Buffer.from(chunks.map(c => c.code).join("\n")), modules };
}

const localKey = "(local)";

/**
 * Split a product's shipped brotli across the packages that fill it. Each
 * package's own module code is brotli'd in isolation, then all shares are scaled
 * to sum to the real shipped `targetBrotli`. This is an approximation -- the code
 * is the pre-minify rendered source, and compressing packages separately loses
 * the cross-package dictionary -- but the scaling ties the split to the headline
 * number, and it is far truer than the raw byte counts.
 */
function attribute(
  modules: Record<string, Rollup.RenderedModule>,
  ownPkgDir: string,
  targetBrotli: number,
): Attribution {
  const ownMarker = `/packages/${ownPkgDir}/`;
  const codeByPkg = new Map<string, string[]>();
  for (const [id, m] of Object.entries(modules)) {
    const isOwn = id.includes(ownMarker) && !id.includes("/node_modules/");
    const key = id.startsWith("\0") || isOwn ? localKey : packageOf(id);
    const frags = codeByPkg.get(key) ?? [];
    frags.push(m.code ?? "");
    codeByPkg.set(key, frags);
  }

  const isoBrotli = new Map<string, number>();
  for (const [key, frags] of codeByPkg) {
    const bytes = Buffer.from(frags.join("\n"));
    isoBrotli.set(key, brotliCompressSync(bytes).length);
  }
  const isoTotal = [...isoBrotli.values()].reduce((sum, b) => sum + b, 0) || 1;
  const brotliOf = (key: string) =>
    Math.round(((isoBrotli.get(key) ?? 0) * targetBrotli) / isoTotal);

  const top = [...isoBrotli.keys()]
    .filter(key => key !== localKey)
    .map(pkg => ({ pkg, brotli: brotliOf(pkg) }))
    .sort((a, b) => b.brotli - a.brotli);
  const externalBrotli = top.reduce((sum, e) => sum + e.brotli, 0);
  return {
    count: top.length,
    externalBrotli,
    localBrotli: brotliOf(localKey),
    totalBrotli: targetBrotli,
    top,
  };
}

/** Name the package a module id belongs to (node_modules dep or workspace pkg). */
function packageOf(id: string): string {
  const nm = id.lastIndexOf("/node_modules/");
  if (nm >= 0) {
    const parts = id.slice(nm + "/node_modules/".length).split("/");
    return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  const pk = id.lastIndexOf("/packages/");
  if (pk >= 0) return id.slice(pk + "/packages/".length).split("/")[0];
  return "(other)";
}

/**
 * Resolve `?raw` / `?inline` imports (svg, css) to their file text via an opaque
 * virtual id, so vite's own css/asset pipeline never claims them. Only needed for
 * the product entries; inert for the pure-JS wesl slices.
 */
function textAssets(): Plugin {
  const paths = new Map<string, string>();
  let n = 0;
  return {
    name: "size-text-assets",
    enforce: "pre",
    resolveId(source, importer) {
      const m = /\?(raw|inline)$/.exec(source);
      if (m && importer) {
        const id = `\0size-text-${n++}`;
        paths.set(id, resolve(dirname(importer), source.slice(0, m.index)));
        return id;
      }
    },
    load(id) {
      const real = paths.get(id);
      if (real)
        return `export default ${JSON.stringify(readFileSync(real, "utf8"))};`;
    },
  };
}
