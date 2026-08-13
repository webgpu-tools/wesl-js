import * as fs from "node:fs";
import type { ModuleResolver, WeslAST } from "wesl/core";
import {
  moduleToRelativePath,
  normalizeDebugRoot,
  parseSrcModule,
} from "wesl/core";

/**
 * Loads WESL modules from the filesystem on demand with caching.
 *
 * Resolves module paths like `package::foo::bar` to filesystem paths
 * like `baseDir/foo/bar.wesl` or `baseDir/foo/bar.wgsl`.
 */
export class FileModuleResolver implements ModuleResolver {
  /** Cached parsed ASTs to avoid re-parsing the same module */
  readonly astCache = new Map<string, WeslAST>();

  /** Root directory containing shader source files */
  readonly baseDir: string;

  /** Package name that this resolver handles (in addition to generic "package") */
  readonly packageName: string;

  /** Optional root path for debug file paths (for browser-clickable errors) */
  readonly debugWeslRoot?: string;

  /**
   * @param baseDir - Root directory containing shader source files
   * @param packageName - Package name to resolve (defaults to "package")
   * @param debugWeslRoot - Optional root path for debug file paths. If provided, error messages
   *   will show paths relative to this root (e.g., "shaders/foo.wesl") instead of absolute
   *   filesystem paths. This is needed for clickable errors in browser dev tools.
   */
  constructor(
    baseDir: string,
    packageName = "package",
    debugWeslRoot?: string,
  ) {
    this.baseDir = baseDir;
    this.packageName = packageName;
    this.debugWeslRoot = debugWeslRoot;
  }

  /**
   * Resolves and parses a module by its import path.
   *
   * Returns cached AST if available, otherwise loads from filesystem,
   * parses, caches, and returns the AST. Returns undefined if module
   * cannot be found.
   *
   * @param modulePath - Module path like "package::foo::bar"
   * @returns Parsed AST or undefined if module not found
   */
  resolveModule(modulePath: string): WeslAST | undefined {
    const cached = this.astCache.get(modulePath);
    if (cached) return cached;

    const sourceFile = this.tryExtensions(modulePath);
    if (!sourceFile) return undefined;

    const debugFilePath = this.debugWeslRoot
      ? this.modulePathToDebugPath(modulePath)
      : sourceFile.filePath;
    const ast = parseSrcModule({
      modulePath,
      debugFilePath,
      src: sourceFile.source,
    });
    this.astCache.set(modulePath, ast);
    return ast;
  }

  /** Try .wesl first, then .wgsl */
  private tryExtensions(modulePath: string) {
    const basePath = this.moduleToFilePath(modulePath);
    if (!basePath) return undefined;

    for (const ext of [".wesl", ".wgsl"]) {
      const filePath = basePath + ext;
      const source = this.loadSource(filePath);
      if (source) return { filePath, source };
    }
    return undefined;
  }

  private loadSource(filePath: string): string | undefined {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return undefined;
    }
  }

  /** Convert module path (package::foo::bar) to filesystem path (baseDir/foo/bar) */
  private moduleToFilePath(modulePath: string): string | undefined {
    const relativePath = moduleToRelativePath(modulePath, this.packageName);
    if (!relativePath) return undefined;
    return `${this.baseDir}/${relativePath}`;
  }

  /** Convert module path to debug path for error messages */
  private modulePathToDebugPath(modulePath: string): string {
    const relative = moduleToRelativePath(modulePath, this.packageName) ?? "";
    const root = normalizeDebugRoot(this.debugWeslRoot);
    return root + relative + ".wesl";
  }
}
