import {
  type BindContext,
  bindIdents,
  bindIdentsRecursive,
  newLinkBindings,
  type UnboundRef,
} from "../BindIdents.ts";
import { makeLiveDecls, makeRootLiveDecls } from "../LiveDeclarations.ts";
import { minimalMangle } from "../Mangler.ts";
import {
  type BatchModuleResolver,
  fileToModulePath,
  type ModuleResolver,
} from "../ModuleResolver.ts";
import type { WeslAST } from "../ParseWESL.ts";
import { findAllRootDecls } from "../RootDeclarations.ts";
import { filterMap } from "../Util.ts";

/**
 * Find unbound package references in library sources.
 *
 * Binds local references without following cross-package imports, revealing
 * which external packages are referenced but not resolved.
 *
 * @param resolver - Module resolver that supports batch operations
 * @returns Array of unbound module paths, each as an array of path segments
 *   (e.g., [['foo', 'bar', 'baz'], ['other', 'pkg']])
 */
export function findUnboundIdents(resolver: BatchModuleResolver): string[][] {
  return findUnboundRefs(resolver).map(ref => ref.path);
}

/** Find unbound references with full position info. */
export function findUnboundRefs(resolver: BatchModuleResolver): UnboundRef[] {
  const unbound: UnboundRef[] = [];
  const bindContext: BindContext = {
    resolver,
    conditions: {},
    bindings: newLinkBindings(),
    knownDecls: new Set(),
    foundScopes: new Set(),
    globalNames: new Set(),
    globalStatements: new Map(),
    statementModules: new Set(),
    mangler: minimalMangle,
    unbound,
    lenient: true,
    dontFollowDecls: true,
    discoveryMode: true,
  };

  for (const [, ast] of resolver.allModules()) {
    const rootDecls = findAllRootDecls(ast.rootScope);
    const liveDecls = makeRootLiveDecls(rootDecls);
    // Process dependent scopes of root decls to find unbound refs in function bodies
    for (const s of filterMap(rootDecls, decl => decl.dependentScope)) {
      bindIdentsRecursive(s, bindContext, makeLiveDecls(liveDecls));
    }
    // Also process refs at root scope level
    bindIdentsRecursive(ast.rootScope, bindContext, liveDecls);
  }

  return unbound;
}

/** Thin decorator that records which modules were resolved. */
export class TrackingResolver implements ModuleResolver {
  readonly visited = new Set<string>();
  #inner: ModuleResolver;
  constructor(inner: ModuleResolver) {
    this.#inner = inner;
  }

  resolveModule(modulePath: string): WeslAST | undefined {
    const ast = this.#inner.resolveModule(modulePath);
    if (ast) this.visited.add(modulePath);
    return ast;
  }
}

/**
 * Discover reachable modules and unbound external refs from a single root.
 *
 * Traces the import graph from `rootModuleName`, returning only the reachable
 * local modules in `weslSrc` and unresolved external references in `unbound`.
 */
export function discoverModules(
  weslSrc: Record<string, string>,
  resolver: ModuleResolver,
  rootModuleName: string,
  packageName = "package",
): { weslSrc: Record<string, string>; unbound: string[][] } {
  const tracking = new TrackingResolver(resolver);
  const rootAst = tracking.resolveModule(rootModuleName);
  if (!rootAst) {
    throw new Error(`root module not found: '${rootModuleName}'`);
  }

  const result = bindIdents({
    rootAst,
    resolver: tracking,
    accumulateUnbound: true,
    lenient: true,
    discoveryMode: true,
  });

  const moduleToKey = new Map(
    Object.keys(weslSrc).map(
      key => [fileToModulePath(key, packageName, false), key] as const,
    ),
  );

  const reachable = [...tracking.visited]
    .map(m => moduleToKey.get(m))
    .filter(key => key !== undefined)
    .map(key => [key, weslSrc[key]] as const);

  const unbound = (result.unbound ?? []).map(ref => ref.path);
  return { weslSrc: Object.fromEntries(reachable), unbound };
}
