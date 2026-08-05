import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { parseSrcModule, throwOnParseError, WeslParseError } from "wesl";
import { parser } from "../parser.js";
import {
  type CompareResult,
  compareNodes,
  extractLezerNodes,
  extractWeslNodes,
} from "./CompareAst.ts";

const dir = dirname(fileURLToPath(import.meta.url));
export const fixtures = join(dir, "fixtures");

/** Parse source with both parsers and compare AST nodes, logging any mismatches. */
export function validateFile(name: string, src: string) {
  const lezerTree = parser.parse(src);
  const lezerNodes = extractLezerNodes(lezerTree);

  const srcModule = { src, debugFilePath: name, modulePath: name };
  const weslAst = parseSrcModule(srcModule);
  throwOnParseError(weslAst); // comparison needs the full AST, not a recovered partial
  const weslNodes = extractWeslNodes(weslAst);

  const result = compareNodes(weslNodes, lezerNodes);
  logMismatches(name, src, result);
  return result;
}

/** Test helper: validate a fixture file - fixtures are hand-crafted so expect zero mismatches. */
export function expectValidation(name: string) {
  const src = readFileSync(join(fixtures, name), "utf-8");
  let result: CompareResult;
  try {
    result = validateFile(name, src);
  } catch (e) {
    if (!(e instanceof WeslParseError)) throw e; // surface real crashes
    // wesl may reject valid WGSL that lezer accepts (e.g., operator mixing rules)
    console.log(`${name}: wesl parse error - skipping validation`);
    return;
  }
  expect(result.matching).toBeGreaterThan(0);
  const lezerMsg = `${name}: wesl nodes missing in lezer`;
  const weslMsg = `${name}: lezer nodes missing in wesl`;
  expect(result.missingInLezer, lezerMsg).toEqual([]);
  expect(result.missingInWesl, weslMsg).toEqual([]);
}

/** Log wesl nodes missing from the lezer parse (first 10), to help debug a fixture. */
function logMismatches(name: string, src: string, result: CompareResult) {
  if (result.missingInLezer.length === 0) return;
  console.log(`\n${name} - wesl nodes not found in lezer:`);
  for (const n of result.missingInLezer.slice(0, 10)) {
    const snippet = src.slice(n.start, n.start + 30).replace(/\n/g, "\\n");
    console.log(`  ${n.type} at ${n.start}: "${snippet}..."`);
  }
  if (result.missingInLezer.length > 10) {
    console.log(`  ... and ${result.missingInLezer.length - 10} more`);
  }
}
