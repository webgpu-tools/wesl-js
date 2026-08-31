import { moduleToRelativePath, normalizeDebugRoot } from "./ModulePathUtil.ts";
import {
  parseSrcModule,
  type WeslAST,
  type WeslExtensions,
} from "./ParseWESL.ts";
import { normalize, noSuffix } from "./PathUtil.ts";
import type { WeslBundle } from "./WeslBundle.ts";

/** Resolves module paths to parsed ASTs. Implementations may cache or load lazily. */
export interface ModuleResolver {
  /** Resolve module path (e.g., "package::foo::bar") to AST, or undefined if not found. */
  resolveModule(modulePath: string): WeslAST | undefined;
}

/** Module resolver that supports batch enumeration of all modules. */
export interface BatchModuleResolver extends ModuleResolver {
  /** Return all modules, parsing them on-demand if needed. */
  allModules(): Iterable<[string, WeslAST]>;
}

export interface RecordResolverOptions {
  /** Recognize this name as alias for package:: (e.g., "lygia" makes lygia::foo resolve locally) */
  packageName?: string;
  /** Debug path prefix for error messages */
  debugWeslRoot?: string;
  /** Enable experimental, not-yet-spec'd syntax extensions while parsing. */
  weslExtensions?: WeslExtensions;
  /** Preserve source comments through linking (default true). */
  keepComments?: boolean;
}

const libRegex = /^lib\.w[eg]sl$/i;

/** Module resolver for in-memory source records. Lazy by default. */
export class RecordResolver implements BatchModuleResolver {
  readonly astCache = new Map<string, WeslAST>();
  readonly sources: Record<string, string>;
  readonly packageName: string;
  readonly debugWeslRoot: string;
  readonly weslExtensions?: WeslExtensions;
  readonly keepComments?: boolean;

  constructor(
    sources: Record<string, string>,
    options: RecordResolverOptions = {},
  ) {
    const { packageName = "package", debugWeslRoot, weslExtensions } = options;
    this.sources = sources;
    this.packageName = packageName;
    this.debugWeslRoot = normalizeDebugRoot(debugWeslRoot);
    this.weslExtensions = weslExtensions;
    this.keepComments = options.keepComments;
  }

  resolveModule(modulePath: string): WeslAST | undefined {
    const cached = this.astCache.get(modulePath);
    if (cached) return cached;

    const source = this.findSource(modulePath);
    if (source === undefined) return undefined;

    const debugFilePath = this.modulePathToDebugPath(modulePath);
    const ast = parseSrcModule(
      { modulePath, debugFilePath, src: source },
      { weslExtensions: this.weslExtensions, keepComments: this.keepComments },
    );
    this.astCache.set(modulePath, ast);
    return ast;
  }

  private findSource(modulePath: string): string | undefined {
    if (this.sources[modulePath] !== undefined) return this.sources[modulePath];

    const filePath = this.moduleToFilePath(modulePath);
    if (filePath === undefined) return undefined;
    return findInVariants(this.sources, filePath);
  }

  /** Convert module path to file path, or undefined if not local. */
  private moduleToFilePath(modulePath: string): string | undefined {
    return moduleToRelativePath(modulePath, this.packageName);
  }

  private modulePathToDebugPath(modulePath: string): string {
    const filePath = this.moduleToFilePath(modulePath) ?? modulePath;
    return this.debugWeslRoot + filePath + ".wesl";
  }

  /** Parse all modules and return entries. */
  allModules(): Iterable<[string, WeslAST]> {
    for (const filePath of Object.keys(this.sources)) {
      const treatLibAsRoot = this.packageName !== "package";
      const modulePath = fileToModulePath(
        filePath,
        this.packageName,
        treatLibAsRoot,
      );
      this.resolveModule(modulePath);
    }
    return this.astCache.entries();
  }
}

/** Composite resolver that tries each resolver in order until one succeeds. */
export class CompositeResolver implements ModuleResolver {
  readonly resolvers: ModuleResolver[];

  constructor(resolvers: ModuleResolver[]) {
    this.resolvers = resolvers;
  }

  resolveModule(modulePath: string): WeslAST | undefined {
    for (const resolver of this.resolvers) {
      const ast = resolver.resolveModule(modulePath);
      if (ast) return ast;
    }
    return undefined;
  }
}

/** Lazy resolver for WeslBundle library modules. */
export class BundleResolver implements ModuleResolver {
  private readonly astCache = new Map<string, WeslAST>();
  private readonly sources: Record<string, string>;
  private readonly packageName: string;
  private readonly debugWeslRoot: string;
  /** Preserve source comments while parsing (default true). */
  private readonly keepComments?: boolean;

  constructor(
    bundle: WeslBundle,
    debugWeslRoot?: string,
    keepComments?: boolean,
  ) {
    this.sources = bundle.modules;
    this.packageName = bundle.name;
    this.debugWeslRoot = normalizeDebugRoot(debugWeslRoot);
    this.keepComments = keepComments;
  }

  resolveModule(modulePath: string): WeslAST | undefined {
    const pkgPrefix = this.packageName + "::";
    if (modulePath !== this.packageName && !modulePath.startsWith(pkgPrefix)) {
      return undefined;
    }

    const cached = this.astCache.get(modulePath);
    if (cached) return cached;

    const source = this.findSource(modulePath);
    if (!source) return undefined;

    const debugFilePath = this.modulePathToDebugPath(modulePath);
    const ast = parseSrcModule(
      { modulePath, debugFilePath, src: source },
      { keepComments: this.keepComments },
    );
    this.astCache.set(modulePath, ast);
    return ast;
  }

  private findSource(modulePath: string): string | undefined {
    const filePath = this.moduleToFilePath(modulePath);

    // Package root resolves to lib.wesl or lib.wgsl
    if (modulePath === this.packageName) {
      const libSrc = findInVariants(this.sources, "lib", ["wesl", "wgsl"]);
      if (libSrc) return libSrc;
    }

    return findInVariants(this.sources, filePath);
  }

  private moduleToFilePath(modulePath: string): string {
    return moduleToRelativePath(modulePath, this.packageName) ?? modulePath;
  }

  private modulePathToDebugPath(modulePath: string): string {
    const filePath = this.moduleToFilePath(modulePath);
    return this.debugWeslRoot + this.packageName + "/" + filePath + ".wesl";
  }
}

/** Compose resolvers into one that tries each in order until one succeeds.
 * Undefined entries are skipped, easing conditional composition. */
export function composeResolvers(
  ...resolvers: (ModuleResolver | undefined)[]
): ModuleResolver {
  const defined = resolvers.filter(r => r !== undefined);
  if (defined.length === 0) throw new Error("no resolvers provided");
  return defined.length === 1 ? defined[0] : new CompositeResolver(defined);
}

/** Create resolvers for library bundles and their transitive dependencies.
 * keepComments defaults to true, and applies to every bundle parsed here. */
export function createLibraryResolvers(
  libs: WeslBundle[],
  debugWeslRoot?: string,
  keepComments?: boolean,
): BundleResolver[] {
  const flattened = flattenLibraryTree(libs);
  return flattened.map(
    lib => new BundleResolver(lib, debugWeslRoot, keepComments),
  );
}

/** Convert file path to module path (e.g., "foo/bar.wesl" to "package::foo::bar"). */
export function fileToModulePath(
  filePath: string,
  packageName: string,
  treatLibAsRoot: boolean,
): string {
  if (filePath.includes("::")) return filePath;

  // Special case: lib.wesl/lib.wgsl becomes just the package name
  if (treatLibAsRoot && libRegex.test(filePath)) {
    return packageName;
  }

  const strippedPath = noSuffix(normalize(filePath));
  const moduleSuffix = strippedPath.replaceAll("/", "::");
  return packageName + "::" + moduleSuffix;
}

/** Try path variants with/without ./ prefix and extension suffixes. */
function findInVariants(
  sources: Record<string, string>,
  basePath: string,
  extensions: string[] = ["wesl", "wgsl"],
): string | undefined {
  const prefixes = ["", "./"];

  for (const prefix of prefixes) {
    const path = prefix + basePath;
    if (sources[path] !== undefined) return sources[path];

    for (const ext of extensions) {
      const withExt = `${path}.${ext}`;
      if (sources[withExt] !== undefined) return sources[withExt];
    }
  }

  return undefined;
}

/** Flatten library dependency tree, deduplicating by object identity rather than package name.
 *
 * Some packages (like Lygia) provide multiple bundles in the same npm package
 * to enable tree shaking. All bundles share the same package name, so we deduplicate
 * by object identity to keep them distinct. Also handles circular dependencies correctly. */
function flattenLibraryTree(libs: WeslBundle[]): WeslBundle[] {
  const result: WeslBundle[] = [];
  const seen = new Set<WeslBundle>();

  function visit(bundle: WeslBundle) {
    if (seen.has(bundle)) return;
    seen.add(bundle);
    result.push(bundle);
    bundle.dependencies?.forEach(visit);
  }

  libs.forEach(visit);
  return result;
}
