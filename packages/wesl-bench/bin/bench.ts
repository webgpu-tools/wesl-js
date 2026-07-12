#!/usr/bin/env -S node --expose-gc --allow-natives-syntax
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BenchMatrix,
  gcSections,
  getBaselineVersion,
  getCurrentGitVersion,
  runBenchCli,
  runsSection,
} from "benchforge";
import { baselineDir, hasBaselineModule } from "../src/BaselineVariations.ts";
import type { WeslSource } from "../src/LoadExamples.ts";
import { ensureBevyFixture } from "../src/LoadExamples.ts";
import { locSection } from "../src/LocSection.ts";
import { meanTimeSection } from "../src/MeanTimeSection.ts";

const fixturesDir = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "fixtures",
);

await runBenchCli({
  // Run-settings bundles; --equiv-margin per preset comes from --calibrate at
  // that preset's batches/duration/warmup. Explicit CLI flags override these.
  // quick: cold-start-inclusive mean (each batch resets the heap). warm: skips
  // the per-batch warmup ramp for steady-state hot-loop throughput and a
  // steadier noise floor. Both calibrate to 0.5%. validate: one iteration per
  // benchmark, timings meaningless -- just checks that every case+variant runs.
  presets: {
    validate: { batches: 1, iterations: 1, "equiv-margin": 0 },
    quick: {
      batches: 100,
      duration: 0.1,
      "equiv-margin": 0.5,
      "calibrate-runs": 10,
    },
    warm: {
      batches: 100,
      duration: 0.1,
      warmup: 20,
      "equiv-margin": 0.5,
      "calibrate-runs": 10,
    },
    thorough: {
      batches: 200,
      duration: 0.5,
      "equiv-margin": 0.3,
      "calibrate-runs": 20,
    },
  },
  defaultPreset: "quick",
  configure: y =>
    y
      .option("baseline", {
        type: "boolean",
        default: false,
        describe: "Compare against baseline version in _baseline/ directory",
      })
      .default("gc-stats", true),
  build: async args => {
    await ensureBevyFixture(fixturesDir);
    const hasBaseline = args.baseline && hasBaselineModule();
    if (args.baseline && !hasBaseline) {
      console.warn(
        "--baseline: no baseline found. Run `pnpm bench:baseline <version>` first.",
      );
    }
    const matrix: BenchMatrix<WeslSource> = {
      name: "WESL",
      variantDir: new URL("../src/variants/", import.meta.url).href,
      casesModule: new URL("../src/Cases.ts", import.meta.url).href,
      baselineDir: hasBaseline
        ? new URL("../src/baseline/", import.meta.url).href
        : undefined,
    };
    const sections = [
      locSection,
      ...gcSections(args),
      meanTimeSection,
      runsSection,
    ];
    return {
      suite: { name: "WESL Benchmarks", matrices: [matrix] },
      sections,
      currentVersion: getCurrentGitVersion(),
      baselineVersion: args.baseline
        ? (getBaselineVersion(baselineDir) ?? { hash: "unknown", date: "" })
        : undefined,
    };
  },
});
