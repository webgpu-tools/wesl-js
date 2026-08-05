import { expect, test } from "vitest";
import {
  addShaderGaps,
  checkShader,
  gapCounts,
  gapReport,
  gapTriage,
  newGapTally,
  shaderFiles,
} from "./CtsShaders.ts";

/**
 * Replay the WebGPU CTS validation corpus: every shader the CTS asserts is
 * valid must survive parse, bind, and the type core. See CtsShaders.ts for what
 * counts as a failure and what counts as a gap.
 */

const files = shaderFiles();

for (const file of files) {
  const label = file.origin === "keep" ? "keep " : "";
  for (const [spec, { shaders }] of Object.entries(file.specs)) {
    // ~1ms per shader headroom: a full-corpus replay (WESL_CTS_SHADERS) puts
    // 50k+ shaders in one spec, far past the default 5s timeout
    test(`cts ${label}${spec}`, { timeout: 5000 + shaders.length }, () => {
      const failures = shaders
        .map(s => ({ code: s.code, failure: checkShader(s.code).failure }))
        .filter(f => f.failure !== null);

      if (failures.length === 0) return;
      const shown = failures
        .slice(0, 5)
        .map(f => `${f.failure}\n---- shader ----\n${f.code}`)
        .join("\n\n");
      expect.fail(
        `${failures.length} of ${shaders.length} valid shaders rejected\n\n${shown}`,
      );
    });
  }
}

/**
 * Not rejecting the corpus would be easy to achieve by giving up on all of it,
 * so also pin what we actually understand: every construct we leave as a gap
 * must carry a reason in `gapTriage`. A new gap then fails here instead of
 * quietly eroding a coverage number.
 */
test("cts validation corpus coverage", { timeout: 120_000 }, () => {
  let expressions = 0;
  let unknownTypes = 0;
  let constExprs = 0;
  let constGaps = 0;
  const untyped = newGapTally();
  const unevaluated = newGapTally();

  for (const file of files) {
    for (const [spec, { shaders }] of Object.entries(file.specs)) {
      for (const { code } of shaders) {
        const r = checkShader(code);
        expressions += r.expressions;
        unknownTypes += r.unknownTypes;
        constExprs += r.constExprs;
        constGaps += r.constGaps;
        addShaderGaps(untyped, spec, r.untypedConstructs);
        addShaderGaps(unevaluated, spec, r.unevaluatedConstructs);
      }
    }
  }

  // The full tally, the corpus-wide fractions, and any stale triage entries go
  // to .cts-cache/gap-report.md; nothing there gates, no console output.
  gapReport(untyped, unevaluated, {
    expressions,
    unknownTypes,
    constExprs,
    constGaps,
  });

  const untriaged = [...gapCounts(untyped, unevaluated)]
    .filter(([key]) => !gapTriage[key])
    .map(([key, count]) => `  ${key} (${count} gaps)`);

  if (untriaged.length === 0) return;
  expect.fail(
    `${untriaged.length} gap constructs have no triage entry:\n` +
      `${untriaged.join("\n")}\n\n` +
      "Fix the gap, or add a skip/todo entry with a reason to gapTriage in " +
      "CtsShaders.ts.",
  );
});
