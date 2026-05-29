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
  configure: y =>
    y.option("baseline", {
      type: "boolean",
      default: false,
      describe: "Compare against baseline version in _baseline/ directory",
    }),
  build: async args => {
    await ensureBevyFixture(fixturesDir);
    const hasBaseline = args.baseline && hasBaselineModule();
    if (args.baseline && !hasBaseline) {
      console.warn(
        "--baseline: no baseline found. Run `pnpm bench:baseline <version>` first.",
      );
    }
    const matrix: BenchMatrix<WeslSource> = {
      name: "WESL Parser",
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
      reportOptions: { variantTitle: "name" },
      currentVersion: getCurrentGitVersion(),
      baselineVersion: args.baseline
        ? (getBaselineVersion(baselineDir) ?? { hash: "unknown", date: "" })
        : undefined,
    };
  },
});
