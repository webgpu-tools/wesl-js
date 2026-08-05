import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  LinkParams,
  ModuleResolver,
  WeslBundle,
  WeslJsPlugin,
} from "wesl";
import { CompositeResolver, link, RecordResolver } from "wesl";
import {
  dependencyBundles,
  FileModuleResolver,
  findWeslToml,
  readPackageJson,
  resolveProjectDir,
} from "wesl-tooling";

export interface ShaderContext {
  /** Dependency bundles for the shader. */
  libs: WeslBundle[];

  /** Package name for module resolution. */
  packageName?: string;

  /** File resolver for lazy loading (when useSourceShaders is true).
   * Shared across compileShader calls. */
  fileResolver?: ModuleResolver;
}

export interface ResolveContextParams {
  /** WESL/WGSL shader source code. */
  src: string;

  /** Project directory for resolving dependencies. */
  projectDir?: string;

  /** Use source shaders instead of built bundles. Default: true. */
  useSourceShaders?: boolean;

  /** Virtual lib names to exclude from dependency resolution. */
  virtualLibNames?: string[];
}

export interface CompileShaderParams {
  /** Project directory for resolving shader dependencies.
   * Used to locate installed npm shader libraries.
   * Optional: defaults to searching upward from cwd for package.json or wesl.toml. */
  projectDir?: string;

  /** GPU device to use for shader compilation. */
  device: GPUDevice;

  /** WESL/WGSL shader source code to compile. */
  src: string;

  /** Conditions for conditional compilation.
   * Used to control `@if` directives in the shader. */
  conditions?: LinkParams["conditions"];

  /** Constants for shader compilation.
   * Injects host-provided values via the `constants::` namespace. */
  constants?: LinkParams["constants"];

  /** Virtual libraries to include in the shader.
   * Allows dynamic generation of shader code at runtime. */
  virtualLibs?: LinkParams["virtualLibs"];

  /** Additional WESL bundles to include.
   * These are merged with auto-discovered dependencies. */
  libs?: WeslBundle[];

  /** Override the package name for module resolution.
   * Used to ensure package:: references resolve correctly. */
  packageName?: string;

  /** Use source shaders from current package instead of built bundles.
   * Default: true for faster iteration during development.
   * Set to false or use TEST_BUNDLES=true environment variable to test built bundles.
   *
   * Precedence: explicit parameter > TEST_BUNDLES env var > default (true)
   */
  useSourceShaders?: boolean;

  /** Pre-resolved shader context. Skips dependency resolution if provided. */
  shaderContext?: ShaderContext;

  /** WESL linker plugins (e.g. annotatedResourcesPlugin). */
  plugins?: WeslJsPlugin[];
}

/**
 * Compiles a WESL shader source string into a GPUShaderModule with automatic dependency resolution.
 *
 * Parses the shader source to detect references to shader packages, then automatically
 * includes the required npm package bundles. By default, loads source shaders from the
 * current package for fast iteration without requiring rebuilds.
 *
 * @returns Compiled GPUShaderModule ready for use in render or compute pipelines
 * @throws Error if shader compilation fails with compilation error details
 */
export async function compileShader(
  params: CompileShaderParams,
): Promise<GPUShaderModule> {
  const { device, src, conditions, constants, virtualLibs, libs = [] } = params;
  const ctx =
    params.shaderContext ??
    (await resolveShaderContext({
      src,
      projectDir: params.projectDir,
      useSourceShaders: params.useSourceShaders,
      virtualLibNames: virtualLibs ? Object.keys(virtualLibs) : [],
    }));

  const allLibs = [...ctx.libs, ...libs].filter(Boolean) as WeslBundle[];
  const resolver = buildResolver(ctx, src);
  const linkParams: Pick<LinkParams, "resolver" | "libs" | "weslSrc"> = resolver
    ? { resolver, libs: allLibs }
    : { weslSrc: { main: src }, libs: allLibs };

  const linked = await link({
    ...linkParams,
    rootModuleName: "main",
    virtualLibs,
    conditions,
    constants,
    packageName: params.packageName ?? ctx.packageName,
    config: params.plugins ? { plugins: params.plugins } : undefined,
    weslExtensions: { doBlocks: true }, // applies to the weslSrc fallback path
  });
  const module = linked.createShaderModule(device);

  await verifyCompilation(module);
  return module;
}

/** Resolve project context for shader compilation: bundles, resolver, and package name. */
export async function resolveShaderContext(
  params: ResolveContextParams,
): Promise<ShaderContext> {
  const { src, useSourceShaders = !process.env.TEST_BUNDLES } = params;
  const { virtualLibNames = [] } = params;
  const projectDir = await resolveProjectDir(params.projectDir);
  const packageName = await getPackageName(projectDir);

  const libs = await dependencyBundles(
    { main: src },
    projectDir,
    packageName,
    !useSourceShaders, // include current package when testing bundles
    virtualLibNames,
    { doBlocks: true },
  );

  const fileResolver = useSourceShaders
    ? await createProjectResolver(projectDir, packageName)
    : undefined;

  return { libs, packageName, fileResolver };
}

/** Create a project resolver for loading modules from the filesystem.
 * Handles wesl.toml configuration and creates FileModuleResolver with correct baseDir.
 *
 * @param projectDir Project directory (defaults to cwd)
 * @param packageName Package name for module resolution (optional)
 * @returns FileModuleResolver configured for the project
 */
export async function createProjectResolver(
  projectDir?: string,
  packageName?: string,
): Promise<ModuleResolver> {
  const resolved = await resolveProjectDir(projectDir);
  const projectPath = fileURLToPath(resolved);
  const tomlInfo = await findWeslToml(projectPath);
  const baseDir = path.isAbsolute(tomlInfo.resolvedRoot)
    ? tomlInfo.resolvedRoot
    : path.join(projectPath, tomlInfo.resolvedRoot);

  return new FileModuleResolver(baseDir, packageName);
}

/** Build a resolver from a ShaderContext and main source.
 * Returns undefined if context has no fileResolver (bundle-only mode). */
export function buildResolver(
  ctx: ShaderContext,
  src: string,
): ModuleResolver | undefined {
  if (!ctx.fileResolver) return undefined;
  const mainResolver = new RecordResolver(
    { main: src },
    { packageName: ctx.packageName, weslExtensions: { doBlocks: true } },
  );
  return new CompositeResolver([mainResolver, ctx.fileResolver]);
}

/** Verify shader compilation succeeded, throw on errors. */
async function verifyCompilation(module: GPUShaderModule): Promise<void> {
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(msg => msg.type === "error");
  if (errors.length > 0) {
    const messages = errors
      .map(e => `${e.lineNum}:${e.linePos} ${e.message}`)
      .join("\n");
    throw new Error(`Shader compilation failed:\n${messages}`);
  }
}

/** Read package name from package.json, normalized for WGSL identifiers. */
async function getPackageName(projectDir: string): Promise<string | undefined> {
  try {
    const pkg = await readPackageJson(projectDir);
    const name = pkg.name as string;
    return name.replace(/-/g, "_");
  } catch {
    return undefined;
  }
}
