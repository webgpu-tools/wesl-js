import fs from "node:fs/promises";
import { expect, test } from "vitest";
import { fetchBulkTest } from "wesl-testsuite/fetch-bulk-tests";
import { link } from "../Linker.ts";
import type { Conditions } from "../Scope.ts";
import { expectNoLogAsync } from "./LogCatcher.ts";

const fixturesDir = new URL("../../fixtures/", import.meta.url);

const bevyBulkTest = {
  name: "Bevy",
  baseDir: "bevy-wgsl",
  git: {
    url: "https://github.com/webgpu-tools/bevy-wgsl.git",
    revision: "84977ff025eaf8d92e56a9c35b815fae70eb4af0",
  },
};

// Constants needed by various Bevy modules
const bevyConstants = {
  MAX_CASCADES_PER_LIGHT: 4,
  MAX_DIRECTIONAL_LIGHTS: 4,
  PER_OBJECT_BUFFER_BATCH_SIZE: 64,
  TONEMAPPING_LUT_TEXTURE_BINDING_INDEX: 26,
  TONEMAPPING_LUT_SAMPLER_BINDING_INDEX: 27,
};

// Files that need specific conditions to link or produce non-empty output
const conditionalFiles: Record<string, Conditions> = {
  "./pbr/ssr.wesl": { DEPTH_PREPASS: true, DEFERRED_PREPASS: true },
  "./pbr/raymarch.wesl": { DEPTH_PREPASS: true },
  "./pbr/prepass_utils.wesl": { DEPTH_PREPASS: true },
  "./core_pipeline/oit.wesl": { OIT_ENABLED: true },
  "./pbr/decal/clustered.wesl": { CLUSTERED_DECALS_ARE_USABLE: true },
  "./pbr/decal/forward.wesl": { DEPTH_PREPASS: true },
  "./pbr/morph.wesl": { MORPH_TARGETS: true },
  "./pbr/irradiance_volume.wesl": { IRRADIANCE_VOLUMES_ARE_USABLE: true },
};

// LATER: binding_array is a WGSL extension not yet supported
const skipFiles = [
  "./render/bindless.wesl", // uses binding_array directly
  "./pbr/decal/clustered.wesl", // imports mesh_view_bindings which uses binding_array
];

// Files that produce empty WGSL with the default conditions: either pure
// re-export modules (imports only), or modules whose every top-level decl is
// behind an `@if` that is off by default (and whose only enabling condition
// pulls in an as-yet-unsupported WGSL extension, so we can't link it non-empty).
const emptyOutputFiles = [
  "./sprite/mesh2d_view_types.wesl", // imports only
  "./pbr/meshlet_visibility_buffer_resolve.wesl", // all decls behind @if(MESHLET_MESH_MATERIAL_PASS); enabling it needs binding_array (r64uint)
];

await fetchBulkTest(bevyBulkTest, fixturesDir);

const weslSrc = await loadBevyBundle();
const allFiles = Object.keys(weslSrc)
  .filter(f => !skipFiles.includes(f))
  .sort();

async function loadBevyBundle(): Promise<Record<string, string>> {
  const bevyDir = new URL(
    "src/shaders/bevy/",
    new URL(bevyBulkTest.baseDir + "/", fixturesDir),
  );
  const bundle: Record<string, string> = {};
  await loadDir(bevyDir, "", bundle);
  return bundle;
}

async function loadDir(
  baseUrl: URL,
  relPath: string,
  bundle: Record<string, string>,
): Promise<void> {
  const dirUrl = new URL(relPath, baseUrl);
  const entries = await fs.readdir(dirUrl, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = relPath ? `${relPath}${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await loadDir(baseUrl, entryPath + "/", bundle);
    } else if (entry.name.endsWith(".wesl")) {
      const src = await fs.readFile(new URL(entryPath, baseUrl), "utf8");
      bundle["./" + entryPath] = src;
    }
  }
}

allFiles.forEach(file => {
  test(`bevy: link ${file}`, async () => {
    const conditions = conditionalFiles[file] ?? {};
    const constants = bevyConstants;
    const rootModuleName = file;

    const result = await expectNoLogAsync(() =>
      link({ weslSrc, rootModuleName, conditions, constants }),
    );

    const wgsl = result.dest;
    if (emptyOutputFiles.includes(file)) {
      expect(wgsl).toBe("");
    } else {
      expect(wgsl.length).toBeGreaterThan(0);
    }
  });
});
