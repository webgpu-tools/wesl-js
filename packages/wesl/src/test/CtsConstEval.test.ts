import { expect, test } from "vitest";
import type { ExpressionElem } from "../AbstractElems.ts";
import { evalConstExpr } from "../types/ConstEval.ts";
import {
  type CaseList,
  caseFiles,
  caseSource,
  caseToString,
  checkExpectation,
  divergences,
  resultName,
} from "./CtsCases.ts";
import { elemsOfKind, typeTest } from "./TypeTestUtil.ts";

/**
 * Const-evaluate the WebGPU CTS abstract-numeric case tables (see CtsCases.ts).
 *
 * One test per case list, each reporting its own failures: there are thousands
 * of cases, and a test apiece would drown the reporter. Every case in a list
 * shares an expression shape, so a list is linked once as a single module of
 * const decls, and each decl's init is then evaluated.
 */

const maxReported = 5;

for (const file of caseFiles()) {
  const label = file.origin === "keep" ? "keep " : "";
  for (const [name, list] of Object.entries(file.lists)) {
    test(`cts ${label}${file.cache} ${name}`, () => {
      const failures = runList(file.cache, name, list);
      if (failures.length === 0) return;
      const shown = failures.slice(0, maxReported).join("\n");
      const more = failures.length - maxReported;
      expect.fail(
        `${failures.length} of ${list.cases.length} cases failed:\n${shown}` +
          (more > 0 ? `\n...and ${more} more` : ""),
      );
    });
  }
}

/** Failure messages for the cases in one list, empty if they all pass. */
function runList(cache: string, name: string, list: CaseList): string[] {
  const src = caseSource(cache, name, list.cases, list.inputs);
  if (src === null) throw new Error(`no expression shape for ${cache} ${name}`);

  const { ctx, moduleElem } = typeTest(src);
  const inits = new Map<string, ExpressionElem>();
  for (const decl of elemsOfKind(moduleElem, "const")) {
    if (decl.init) inits.set(decl.name.decl.ident.originalName, decl.init);
  }

  const known = divergences[`${cache} ${name}`] ?? {};
  const failures: string[] = [];
  list.cases.forEach(([inputs, expected], i) => {
    const init = inits.get(resultName(i));
    if (!init) throw new Error(`no decl for case ${i} of ${cache} ${name}`);
    const key = JSON.stringify(inputs);
    if (key in known) return;
    const failure = checkExpectation(
      evalConstExpr(init, ctx),
      expected,
      list.expectation,
    );
    if (failure) {
      const line = caseToString(cache, name, list.inputs, list.expectation, [
        inputs,
        expected,
      ]);
      failures.push(`  ${line}\n    ${failure}`);
    }
  });
  return failures;
}
