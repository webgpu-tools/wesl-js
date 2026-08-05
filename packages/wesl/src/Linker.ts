import type { AbstractElem, ModuleElem } from "./AbstractElems.ts";
import {
  bindIdents,
  type EmittableElem,
  type LinkBindings,
} from "./BindIdents.ts";
import { createConstantsResolver } from "./ConstantsResolver.ts";
import { LinkedWesl } from "./LinkedWesl.ts";
import { debug } from "./Logging.ts";
import { lowerAndEmit } from "./LowerAndEmit.ts";
import type { ManglerFn } from "./Mangler.ts";
import { isWeslFile, weslFileRegex } from "./ModulePathUtil.ts";
import {
  composeResolvers,
  createLibraryResolvers,
  type ModuleResolver,
  RecordResolver,
} from "./ModuleResolver.ts";
import type { WeslAST, WeslExtensions } from "./ParseWESL.ts";
import type { Conditions, DeclIdent, SrcModule } from "./Scope.ts";
import { type SrcMap, SrcMapBuilder } from "./SrcMap.ts";
import { filterMap } from "./Util.ts";
import {
  createVirtualLibraryResolver,
  type VirtualLibraryFn,
} from "./VirtualLibraryResolver.ts";
import type { WeslBundle } from "./WeslBundle.ts";

/** Root module used for linking when none is specified. */
export const defaultRootModule = "main";

export type LinkerTransform = (boundAST: TransformedAST) => TransformedAST;

export interface WeslJsPlugin {
  transform?: LinkerTransform;
}

/** The bound root module handed to plugin transforms.
 *
 * The parsed AST is read-only: it's shared by every link of these modules, so
 * edits to it would leak into later links with other conditions or plugins.
 * Record per-link changes in `bindings` instead: addAttributes() to decorate a
 * declaration, bindings.mangled to rename one. */
export interface TransformedAST
  extends Pick<WeslAST, "srcModule" | "moduleElem"> {
  /** per-link binding facts: ref targets, mangled names, added attributes */
  bindings: LinkBindings;
  globalNames: Set<string>;
}

export interface LinkConfig {
  plugins?: WeslJsPlugin[];
}

export interface LinkParams {
  /** Module resolver for lazy loading. If provided, weslSrc is ignored. */
  resolver?: ModuleResolver;

  /** Record of module sources keyed by module path (`package::foo::bar`)
   * or relative file path (`./foo/bar.wesl`). Paths must be unix-style,
   * relative to the wesl root, and valid WGSL identifiers. */
  weslSrc?: Record<string, string>;

  /** Root module name: file path (`./main.wesl`), module path (`package::main`), or bare name (`main`).
   * For apps, the root module contains entry points (`@compute`, `@vertex`, `@fragment`).
   * For libraries, it defines the public API. */
  rootModuleName?: string;

  /** For debug logging. Will be prepended to file paths. */
  debugWeslRoot?: string;

  /** runtime conditions for conditional compiling with @if and friends */
  conditions?: Conditions;

  /** libraries available for the link */
  libs?: WeslBundle[];

  /** generate wesl from code at runtime */
  virtualLibs?: Record<string, VirtualLibraryFn>;

  /** package name for the local sources (in addition to default "package::").
   * Enables imports like `import mypkg::foo` alongside `import package::foo`.
   * Should be a valid WGSL identifier (use underscores, not hyphens or slashes). */
  packageName?: string;

  /** plugins and other configuration to use while linking */
  config?: LinkConfig;

  /** Host (ts/js) provided wgsl constants.
   * Users can import the values from wesl code via the `constants' virtual library:
   *  `import constants::num_lights;` */
  constants?: Record<string, string | number>;

  /** function to construct globally unique wgsl identifiers */
  mangler?: ManglerFn;

  /** opt-in parsing of experimental, not-yet-spec'd syntax extensions.
   * Only applied to the local source resolver built from `weslSrc`; callers
   * that supply their own `resolver` must set it on that resolver. */
  weslExtensions?: WeslExtensions;
}

/** Project config for web components and tools. */
export type WeslProject = Pick<
  LinkParams,
  | "weslSrc"
  | "rootModuleName"
  | "conditions"
  | "constants"
  | "libs"
  | "packageName"
  | "weslExtensions"
> & {
  /** Shader directory relative to project root (set by ?link from wesl.toml). */
  shaderRoot?: string;
};

export interface LinkRegistryParams
  extends Pick<
    LinkParams,
    "rootModuleName" | "conditions" | "config" | "mangler"
  > {
  resolver: ModuleResolver;
}

export interface BoundAndTransformed {
  transformedAst: TransformedAST;
  newDecls: DeclIdent[];
  newStatements: EmittableElem[];
}

/**
 * Link a set of WESL source modules (typically the text from .wesl files) into a single WGSL string.
 * Linking starts with a specified 'root' source module, and recursively incorporates code
 * referenced from other modules (in local files or libraries).
 *
 * Unreferenced (dead) code outside the root module is not included in the output WGSL.
 * Additionally the caller can specify conditions for to control conditional compilation.
 * Only code that is valid with the current conditions is included in the output.
 */
export async function link(params: LinkParams): Promise<LinkedWesl> {
  return new LinkedWesl(_linkSync(params));
}

/** Link using a caller-provided resolver.
 *
 * Unlike link(), no resolver building: compose sources, libraries, constants
 * and virtual libraries into a single resolver yourself (RecordResolver,
 * createLibraryResolvers, createConstantsResolver,
 * createVirtualLibraryResolver, composeResolvers). */
export async function linkWithResolver(
  params: LinkRegistryParams,
): Promise<LinkedWesl> {
  return new LinkedWesl(linkRegistry(params));
}

/** linker api for benchmarking */
export function _linkSync(params: LinkParams): SrcMap {
  const { weslSrc, libs = [], packageName, debugWeslRoot, resolver } = params;
  const { weslExtensions, virtualLibs, constants, conditions = {} } = params;
  const { rootModuleName = "main" } = params;

  if (!resolver && !weslSrc) {
    throw new Error("Either resolver or weslSrc must be provided");
  }
  const primaryResolver =
    resolver ??
    new RecordResolver(weslSrc!, {
      packageName,
      debugWeslRoot,
      weslExtensions,
    });

  // virtual modules resolve last, and constants shadow a virtualLib named 'constants'
  const rootModulePath = normalizeModuleName(rootModuleName);
  const hostPackage = rootModulePath.split("::")[0];
  const finalResolver = composeResolvers(
    primaryResolver,
    ...createLibraryResolvers(libs, debugWeslRoot),
    constants && createConstantsResolver(constants, hostPackage),
    virtualLibs &&
      createVirtualLibraryResolver(virtualLibs, {
        conditions,
        rootModulePath,
        packageName: hostPackage,
      }),
  );

  return linkRegistry({ ...params, resolver: finalResolver });
}

/** Link wesl from a registry of already parsed modules.
 *
 * This entry point is intended for users who want to link multiple times
 * from the same sources. (e.g. linking with different conditions
 * each time, or perhaps to produce multiple wgsl shaders
 * that share some sources.)
 *
 * Parsed ASTs are immutable: binding records its results in a per-link
 * table, so the same resolver (and its cached ASTs) can be shared across
 * link calls with different conditions.
 */
export function linkRegistry(params: LinkRegistryParams): SrcMap {
  const bound = bindAndTransform(params);
  const { transformedAst: ast, newDecls, newStatements } = bound;
  const builders = emitWgsl(
    ast.moduleElem,
    ast.srcModule,
    newDecls,
    newStatements,
    ast.bindings,
    params.conditions,
  );
  return SrcMapBuilder.build(builders);
}

/** Bind identifiers and apply transform plugins */
export function bindAndTransform(
  params: LinkRegistryParams,
): BoundAndTransformed {
  const { resolver, mangler, config } = params;
  const { rootModuleName = defaultRootModule, conditions = {} } = params;

  const modulePath = normalizeModuleName(rootModuleName);
  const rootAst = getRootModule(resolver, modulePath, rootModuleName);

  const bound = bindIdents({ rootAst, resolver, conditions, mangler });
  const { bindings, globalNames, decls: newDecls, newStatements } = bound;

  const transformedAst = applyTransformPlugins(
    rootAst,
    bindings,
    globalNames,
    config,
  );
  return { transformedAst, newDecls, newStatements };
}

/** Convert root module name to module path format.
 * Accepts: module path (package::foo), file path (./foo.wesl), or name (foo) */
export function normalizeModuleName(name: string): string {
  if (name.includes("::")) return name;
  if (name.includes("/") || isWeslFile(name)) {
    const stripped = name.replace(weslFileRegex, "").replace(/^\.\//, "");
    return "package::" + stripped.replaceAll("/", "::");
  }
  return "package::" + name;
}

/** Assemble WGSL output from prologue statements, root module, and imported declarations. */
function emitWgsl(
  rootModuleElem: ModuleElem,
  srcModule: SrcModule,
  newDecls: DeclIdent[],
  newStatements: EmittableElem[],
  bindings: LinkBindings,
  conditions: Conditions = {},
): SrcMapBuilder[] {
  const prologueBuilders = newStatements.map(s =>
    emitElem(s.srcModule, s.elem, conditions, bindings, { addNl: true }),
  );

  const rootBuilder = builderFromModule(srcModule);
  lowerAndEmit({
    srcBuilder: rootBuilder,
    rootElems: [rootModuleElem],
    conditions,
    bindings,
    extracting: false,
  });

  const declBuilders = newDecls.map(decl =>
    emitElem(decl.srcModule, decl.declElem!, conditions, bindings, {
      skipConditionalFiltering: true,
    }),
  );

  return [...prologueBuilders, rootBuilder, ...declBuilders];
}

/** Resolve root module AST or throw if not found. */
function getRootModule(
  resolver: ModuleResolver,
  modulePath: string,
  rootModuleName: string,
): WeslAST {
  const rootAst = resolver.resolveModule(modulePath);
  if (!rootAst) {
    if (debug) {
      console.log(
        `root module not found: ${modulePath} (from ${rootModuleName})`,
      );
    }
    throw new Error(`Root module not found: ${rootModuleName}`);
  }
  return rootAst;
}

/** Run registered transform plugins over the bound AST. */
function applyTransformPlugins(
  rootModule: WeslAST,
  bindings: LinkBindings,
  globalNames: Set<string>,
  config?: LinkConfig,
): TransformedAST {
  // for now only transform the root module
  const { moduleElem, srcModule } = rootModule;
  const startAst = { moduleElem, srcModule, bindings, globalNames };
  const plugins = config?.plugins ?? [];
  const transforms = filterMap(plugins, plugin => plugin.transform);
  return transforms.reduce((ast, transform) => transform(ast), startAst);
}

/** Emit a single element (prologue statement or imported declaration) into a SrcMapBuilder. */
function emitElem(
  srcModule: SrcModule,
  elem: AbstractElem,
  conditions: Conditions,
  bindings: LinkBindings,
  opts: { addNl?: boolean; skipConditionalFiltering?: boolean } = {},
): SrcMapBuilder {
  const builder = builderFromModule(srcModule);
  lowerAndEmit({
    srcBuilder: builder,
    rootElems: [elem],
    conditions,
    bindings,
    skipConditionalFiltering: opts.skipConditionalFiltering,
  });
  if (opts.addNl) builder.addNl();
  return builder;
}

function builderFromModule(srcModule: SrcModule): SrcMapBuilder {
  return new SrcMapBuilder({
    text: srcModule.src,
    path: srcModule.debugFilePath,
  });
}

/*

LATER
- distinguish between global and local declaration idents (only global ones need be uniquified)

Conditions
- conditions are attached to the AST elements where they are defined
  - only conditionally valid elements are emitted
- consolidated conditions are attached to Idents
  - only conditionally valid ref Idents are bound, and only to conditionaly valid declarations
  - a condition stack (akin to the scope stack) is maintained while parsing to attach consolidated conditions to Idents

Generics & specialization
- attach generic parameters to ref and decl Idents, effectively creating a new Ident for each specialization
- generate specialized elements at emit time, by checking the generic parameters of the decl ident

Incrementally rebuilding
- unchanged files don't need to be reparsed, only reparse dirty files.
- support reflection only mode? no need to bind idents or emit for e.g. vite/IDE plugin generating reflection types 

Parallel Processing (coarse grained via webworkers)
- Parsing each module can be done in parallel
- binding could be done partially in parallel? (esbuild doesn't parallelize here though)
  - finding the declaration for each local ident could be done in parallel by module
  - matching 
- Emitting could be easily modified to be done in partially in parallel
  - traversing the AST to list the top level elements to emit could be done serially
  - the text for each top level element could be emitted in parallel (presumably the bulk of the work)
  - the merged text can be assembled serially

*/
