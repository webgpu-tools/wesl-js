import { expect } from "vitest";
import { type BoundAndTransformed, RecordResolver, type SrcModule } from "wesl";
import { diagnosticToString } from "../Diagnostics.ts";
import { bindAndTransform, type LinkParams, link } from "../Linker.ts";
import { withLoggerAsync } from "../Logging.ts";
import {
  type ParseOptions,
  parseSrcModule,
  type WeslAST,
} from "../ParseWESL.ts";
import type { Conditions } from "../Scope.ts";
import { expectNoLog, logCatch } from "./LogCatcher.ts";
import { stripWesl } from "./StripWesl.ts";

export type LinkTestOpts = Pick<
  LinkParams,
  | "conditions"
  | "libs"
  | "config"
  | "virtualLibs"
  | "constants"
  | "mangler"
  | "weslExtensions"
>;

interface BindTestResult {
  bound: BoundAndTransformed;
  resolver: RecordResolver;
}

/** Compare WGSL/WESL by token sequence, ignoring whitespace. */
export function expectTokenMatch(actual: string, expected: string): void {
  expect(stripWesl(actual)).toBe(stripWesl(expected));
}

/** Parse a single wesl file. */
export function parseWESL(src: string, options?: ParseOptions): WeslAST {
  const srcModule: SrcModule = {
    modulePath: "package::test",
    debugFilePath: "./test.wesl",
    src,
  };
  return parseSrcModule(srcModule, options);
}

/** Link wesl for tests. First module is ./test.wesl, rest are ./file1.wesl, etc. */
export async function linkTest(...rawWgsl: string[]): Promise<string> {
  return linkTestOpts({}, ...rawWgsl);
}

export async function linkTestOpts(opts: LinkTestOpts, ...rawWgsl: string[]) {
  const weslSrc = makeTestBundle(rawWgsl);
  const srcMap = await link({ weslSrc, rootModuleName: "test", ...opts });
  return srcMap.dest;
}

interface LogResult {
  log: string;
  result: string;
}

/** Link wesl for tests, capturing console output and swallowing exceptions
 * (callers assert on the captured log, not the thrown error). */
export async function linkWithLogQuietly(
  ...rawWgsl: string[]
): Promise<LogResult> {
  const { log, logged } = logCatch();
  let result = "??";
  try {
    result = await withLoggerAsync(log, () => linkTest(...rawWgsl));
  } catch {
    // swallow: the assertion is on the captured log
  }
  return { result, log: logged() };
}

/** Parse wesl for testing, ensuring no logged warnings and no syntax errors. */
export function parseTest(src: string, options?: ParseOptions): WeslAST {
  const ast = expectNoLog(() => parseWESL(src, options));
  expect(formatDiagnostics(ast)).toBe("");
  return ast;
}

/** Parse invalid wesl for testing, returning its formatted diagnostics. */
export function parseErrorText(src: string, options?: ParseOptions): string {
  return formatDiagnostics(parseWESL(src, options));
}

/** Parse wesl without log collection (for debugging). */
export function parseTestRaw(src: string, options?: ParseOptions): WeslAST {
  return parseWESL(src, options);
}

/** Parse and bind wesl source for testing. Returns bound result and resolver. */
export function bindTest(...rawWesl: string[]): BindTestResult {
  return bindTestSources(rawWesl);
}

/** Bind test sources (optionally under conditions), returning the bound result
 * and its resolver. First source is ./test.wesl, rest ./file1.wesl, ... */
export function bindTestSources(
  rawWesl: string[],
  conditions?: Conditions,
): BindTestResult {
  const weslSrc = makeTestBundle(rawWesl);
  const resolver = new RecordResolver(weslSrc, {
    packageName: "package",
    debugWeslRoot: "test",
  });
  const bound = bindAndTransform({
    rootModuleName: "test",
    resolver,
    conditions,
  });
  return { bound, resolver };
}

/** Synthesize test file bundle: ./test.wesl, ./file1.wesl, ./file2.wesl, etc. */
export function makeTestBundle(rawWgsl: string[]): Record<string, string> {
  const [root, ...rest] = rawWgsl;
  const restFiles = Object.fromEntries(
    rest.map((src, i) => [`./file${i + 1}.wesl`, src]),
  );
  return { "./test.wesl": root, ...restFiles };
}

function formatDiagnostics(ast: WeslAST): string {
  return ast.diagnostics
    .map(d => diagnosticToString(d, ast.srcModule))
    .join("\n");
}
