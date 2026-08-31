#!/usr/bin/env -S node --expose-gc --allow-natives-syntax
import {
  type BenchMatrix,
  gcSections,
  getBaselineVersion,
  getCurrentGitVersion,
  runBenchCli,
  runsSection,
} from "benchforge";
import { baselineDir, hasBaselineModule } from "../src/BaselineVariations.ts";
import { ensureBevyFixture, type WeslSource } from "../src/LoadExamples.ts";
import { locSection } from "../src/LocSection.ts";
import { meanTimeSection } from "../src/MeanTimeSection.ts";

await runBenchCli({
  presets: {
    validate: { batches: 1, iterations: 1, "equiv-margin": 0 },
    profile: {
      batches: 50,
      iterations: 100,
      warmup: 50,
      "equiv-margin": 0,
      profile: true,
    },
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
      .default("gc-stats", true)
      .default("profile-rows", 50),
  build: async args => {
    await ensureBevyFixture();
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
