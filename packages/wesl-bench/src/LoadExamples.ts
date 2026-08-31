import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchBulkTest } from "wesl-testsuite/fetch-bulk-tests";

/** source files for one benchmark case, keyed by module path */
export interface WeslSource {
  weslSrc: Record<string, string>;
  rootModule: string;
  lineCount?: number;
}

const packageDir = fileURLToPath(new URL("..", import.meta.url));

/** single .wgsl benchmark examples, in this package */
const examplesDir = join(packageDir, "wesl-examples");

/** fetched multi-file fixtures, in this package */
const fixturesDir = join(packageDir, "fixtures");

/** fetched multi-file fixtures, shared from the wesl package */
const weslFixturesDir = join(packageDir, "..", "wesl", "fixtures");

/** shader dir inside a fetched bevy-wgsl fixture (the path loading requires) */
const bevyShadersSubpath = "bevy-wgsl/src/shaders/bevy";

const bevyBulkTest = {
  name: "Bevy",
  baseDir: "bevy-wgsl",
  git: {
    url: "https://github.com/webgpu-tools/bevy-wgsl.git",
    revision: "84977ff025eaf8d92e56a9c35b815fae70eb4af0",
  },
};

/** Ensure bevy-wgsl fixture is available (fetches if needed) */
export async function ensureBevyFixture(): Promise<void> {
  // check the full shader path findBevyDir needs, so a partial fetch (the
  // repo root without the shader tree) still triggers a re-fetch
  if (existsSync(join(weslFixturesDir, bevyShadersSubpath))) {
    return; // already available via the wesl package
  }
  const fixturesUrl = pathToFileURL(`${fixturesDir}/`);
  await fetchBulkTest(bevyBulkTest, fixturesUrl);
}

// Files needed for environment_map.wesl (root + transitive deps)
const envMapFiles = [
  "./pbr/environment_map.wesl",
  "./pbr/mesh_view_bindings.wesl",
  "./pbr/mesh_view_types.wesl",
  "./pbr/lighting.wesl",
  "./pbr/clustered_forward.wesl",
];

/** @return every benchmark example, keyed by case id */
export function loadAllExamples(): Record<string, WeslSource> {
  return {
    bevy_env_map: loadBevyEnvMap(),
    rasterize_05_fine: loadFile("rasterize_05_fine.wgsl"),
    particle: loadFile("particle.wgsl"),
    unity: loadFile("unity_webgpu_000002B8376A5020.fs.wgsl"),
    tiny: loadFile("tiny.wgsl"),
    op_dense: loadFile("op_dense.wgsl"),
  };
}

/** @return bevy environment_map multi-file example */
function loadBevyEnvMap(): WeslSource {
  const bevyDir = findBevyDir();
  const weslSrc: Record<string, string> = {};
  for (const file of envMapFiles) {
    const fullPath = join(bevyDir, file.slice(2)); // remove "./"
    weslSrc[file] = readFileSync(fullPath, "utf-8");
  }
  return {
    weslSrc,
    rootModule: "./pbr/environment_map.wesl",
    lineCount: totalLines(weslSrc),
  };
}

/** @return source data for a single WESL file */
function loadFile(filename: string): WeslSource {
  const content = readFileSync(join(examplesDir, filename), "utf-8");
  const modulePath = `./${filename}`;
  const weslSrc = { [modulePath]: content };
  return { weslSrc, rootModule: modulePath, lineCount: totalLines(weslSrc) };
}

/** @return path to bevy shaders directory, checking multiple locations */
function findBevyDir(): string {
  const locations = [
    join(fixturesDir, bevyShadersSubpath),
    join(weslFixturesDir, bevyShadersSubpath),
  ];
  for (const loc of locations) {
    if (existsSync(loc)) return loc;
  }
  const tried = locations.join(", ");
  const msg = `Bevy fixture not found. Tried: ${tried}. Run 'rpr test' in the wesl package first to fetch fixtures.`;
  throw new Error(msg);
}

/** @return total lines across all source files */
function totalLines(weslSrc: Record<string, string>): number {
  return Object.values(weslSrc).reduce(
    (total, content) => total + content.split("\n").length,
    0,
  );
}
