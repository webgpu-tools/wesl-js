import { LanguageSupport, LRLanguage } from "@codemirror/language";
import { type Diagnostic, linter } from "@codemirror/lint";
import { parser, weslHighlighting } from "lezer-wesl";
import {
  type BindResults,
  bindIdents,
  CompositeResolver,
  type Conditions,
  createLibraryResolvers,
  type ModuleResolver,
  RecordResolver,
  type UnboundRef,
  type WeslAST,
  type WeslBundle,
  type Diagnostic as WeslDiagnostic,
  WeslParseError,
} from "wesl";

export interface WeslLintConfig {
  /** Get all sources keyed by module path (e.g., "package::main"). */
  getSources: () => Record<string, string>;

  /** Root module to validate (e.g., "package::main"). */
  rootModule: () => string;

  /** Runtime conditions for @if conditional compilation. */
  conditions?: () => Conditions;

  /** Package name alias (enables `import mypkg::foo` alongside `import package::foo`). */
  packageName?: () => string | undefined;

  /** External diagnostics (e.g., GPU compilation errors from wgsl-play). */
  getExternalDiagnostics?: () => Diagnostic[];

  /** Get pre-loaded library bundles. */
  getLibs?: () => WeslBundle[];

  /** Fetch libraries on-demand for unresolved external packages. */
  fetchLibs?: (packageNames: string[]) => Promise<WeslBundle[]>;

  /** Package names to ignore when checking unbound externals (e.g. virtual modules). */
  ignorePackages?: () => string[];

  /** GPU validation of linked WGSL. Called after WESL lint passes with no errors. */
  gpuValidate?: () => Promise<Diagnostic[]>;
}

export const weslLanguage = LRLanguage.define({
  name: "wesl",
  parser: parser.configure({ props: [weslHighlighting] }),
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
});

export function wesl(): LanguageSupport {
  return new LanguageSupport(weslLanguage);
}

/** Create a linter that validates WESL using the canonical parser. */
export function createWeslLinter(config: WeslLintConfig) {
  return linter(async () => lintAndFetch(config), { delay: 300 });
}

/** Lint once, fetch missing externals if needed, re-lint with new libs. @internal */
export async function lintAndFetch(
  config: WeslLintConfig,
): Promise<Diagnostic[]> {
  const libs = config.getLibs?.() ?? [];
  const ignored = new Set(config.ignorePackages?.() ?? []);
  let result = lintPass(config, libs, ignored);
  let { diagnostics, externals, weslErrorCount } = result;

  if (config.fetchLibs && externals.length) {
    const newLibs = await config.fetchLibs(externals);
    if (newLibs.length) {
      result = lintPass(config, [...libs, ...newLibs], ignored);
      ({ diagnostics, weslErrorCount } = result);
    }
  }

  if (weslErrorCount === 0 && config.gpuValidate) {
    try {
      const gpuDiags = await config.gpuValidate();
      diagnostics.push(...gpuDiags);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      diagnostics.push({
        from: 0,
        to: 0,
        severity: "warning",
        message: `GPU validation skipped: ${msg}`,
        source: "WebGPU",
      });
    }
  }

  return diagnostics;
}

/** Parse, bind, collect diagnostics and discover missing externals. */
function lintPass(
  config: WeslLintConfig,
  libs: WeslBundle[],
  ignored: Set<string>,
): { diagnostics: Diagnostic[]; externals: string[]; weslErrorCount: number } {
  const sources = config.getSources();
  const rootModule = config.rootModule();
  const diagnostics: Diagnostic[] = [];
  let externals: string[] = [];
  let weslErrorCount = 0;

  try {
    const resolver = buildResolver(sources, libs, config.packageName?.());
    const rootAst = resolver.resolveModule(rootModule);
    if (rootAst) {
      // parsing recovers at decl boundaries, so every syntax error is reported
      const parseDiags = rootAst.diagnostics.map(weslToDiagnostic);
      diagnostics.push(...parseDiags);
      const result = bindIdents({
        resolver,
        rootAst,
        conditions: config.conditions?.(),
        accumulateUnbound: true,
        // syntax errors are already reported above; bind the valid decls anyway
        lenient: true,
      });
      const unbound = unboundDiagnostics(result, rootModule, ignored);
      diagnostics.push(...unbound);
      const parseErrors = parseDiags.filter(d => d.severity === "error");
      weslErrorCount = parseErrors.length + unbound.length;
      // Binding is sync by design: collect all missing packages from the bind
      // results so lintAndFetch can fetch them in one batch and re-lint.
      externals = findMissingPackages(rootAst, result, resolver, ignored, libs);
    }
  } catch (e: unknown) {
    const diag = errorToDiagnostic(e);
    if (diag) {
      diagnostics.push(diag);
      weslErrorCount++;
    }
  }

  diagnostics.push(...(config.getExternalDiagnostics?.() ?? []));
  return { diagnostics, externals, weslErrorCount };
}

function buildResolver(
  sources: Record<string, string>,
  libs: WeslBundle[],
  packageName?: string,
): ModuleResolver {
  const record = new RecordResolver(sources, { packageName });
  if (libs.length === 0) return record;
  // flatten each bundle's transitive dependencies, matching link()'s resolver
  const resolvers = [record, ...createLibraryResolvers(libs)];
  return new CompositeResolver(resolvers);
}

/** Convert a wesl compiler diagnostic to a CodeMirror lint diagnostic. */
function weslToDiagnostic(d: WeslDiagnostic): Diagnostic {
  const { start: from, end: to, severity, message } = d;
  return { from, to, severity, message };
}

/** Convert unbound refs to diagnostics, skipping ignored packages. */
function unboundDiagnostics(
  result: BindResults,
  rootModule: string,
  ignored: Set<string>,
): Diagnostic[] {
  return (result.unbound ?? [])
    .filter(
      ref =>
        ref.srcModule.modulePath === rootModule &&
        !(ref.path.length > 1 && ignored.has(ref.path[0])),
    )
    .map(unboundToDiagnostic);
}

/** Find external package names not yet loaded, from unresolved imports and unbound refs. */
function findMissingPackages(
  rootAst: WeslAST,
  result: BindResults,
  resolver: ModuleResolver,
  ignored: Set<string>,
  libs: WeslBundle[],
): string[] {
  const loaded = new Set(libs.map(b => b.name));
  const skip = (r: string) =>
    !isExternalRoot(r) || ignored.has(r) || loaded.has(r);

  // imports that don't resolve to a known module
  const fromImports = rootAst.imports
    .filter(imp => {
      const root = imp.segments[0]?.name;
      if (!root || skip(root)) return false;
      const modPath = imp.segments.map(s => s.name).join("::");
      return !resolver.resolveModule(modPath);
    })
    .map(imp => imp.segments[0].name);

  // inline path references (e.g. foo::bar) that didn't bind
  const fromUnbound = (result.unbound ?? [])
    .filter(ref => ref.path.length > 1 && !skip(ref.path[0]))
    .map(ref => ref.path[0]);

  return [...new Set([...fromImports, ...fromUnbound])];
}

function errorToDiagnostic(e: unknown): Diagnostic | undefined {
  if (!(e instanceof WeslParseError)) return undefined;
  const [from, to] = e.span;
  return {
    from,
    to,
    severity: "error",
    message: (e.cause as Error)?.message ?? e.message,
  };
}

function unboundToDiagnostic(ref: UnboundRef): Diagnostic {
  return {
    from: ref.start,
    to: ref.end,
    severity: "error",
    message: `unresolved identifier '${ref.path.join("::")}'`,
  };
}

function isExternalRoot(root: string): boolean {
  return root !== "package" && root !== "super";
}
