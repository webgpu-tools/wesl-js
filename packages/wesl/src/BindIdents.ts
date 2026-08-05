import type {
  AbstractElem,
  AttributeElem,
  ExpressionElem,
} from "./AbstractElems.ts";
import { assertThatDebug } from "./Assertions.ts";
import { failIdent } from "./ClickableError.ts";
import { filterValidElements, validScopeItems } from "./Conditions.ts";
import { identToString } from "./debug/ScopeToString.ts";
import type { FlatImport } from "./FlattenTreeImport.ts";
import { findQualifiedImport } from "./ImportResolution.ts";
import type { LinkRegistryParams } from "./Linker.ts";
import {
  type LiveDecls,
  makeLiveDecls,
  makeRootLiveDecls,
} from "./LiveDeclarations.ts";
import { type ManglerFn, minimalMangle } from "./Mangler.ts";
import type { ModuleResolver } from "./ModuleResolver.ts";
import { throwOnParseError, type WeslAST } from "./ParseWESL.ts";
import {
  findAllRootDecls,
  findValidRootDecls,
  getValidRootDecls,
} from "./RootDeclarations.ts";
import type {
  Conditions,
  DeclIdent,
  RefIdent,
  Scope,
  SrcModule,
} from "./Scope.ts";
import { stdWgsl, wgslStandardAttributes } from "./StandardTypes.ts";
import type { Type } from "./types/Types.ts";

/**
 * BindIdents pass: depth-first walk of the scope tree (not syntax tree),
 * linking ref idents to declarations and mangling global names.
 *
 * For each ref: search current scope upward, then check imports for external matches.
 * LiveDecls tracks visible declarations with parent links.
 * @if/@else: validScopeItems filters the scope tree, mirroring filterValidElements.
 */

/** Per-link binding facts, keyed by parse-immutable objects.
 * Parsed ASTs and scope trees are immutable after parse; every bind-time fact
 * lives here instead. Lifetime = one link = one condition set, so entries
 * never go stale across links with different conditions. */
export interface LinkBindings {
  /** Declaration each ref ident resolved to. Three states, read them with
   * refDecl() or refTarget() rather than a bare .get():
   *   DeclIdent - the ref bound to this declaration
   *   "std"     - a standard WGSL identifier (like sin, or u32)
   *   no entry  - binding never resolved this ref: either unresolvable, or
   *               skipped on purpose (condition refs and non-WGSL attribute
   *               params, which emit drops along with their attributes)
   * Stored value is the RefTarget minus "unbound", which the absent entry is. */
  refersTo: Map<RefIdent, DeclIdent | "std">;

  /** Globally unique output name for each bound global declaration.
   * (locals keep their original names and aren't recorded here) */
  mangled: Map<DeclIdent, string>;

  /** Root declarations cached per module root scope: condition-filtered,
   * or all conditional branches in discovery mode. */
  rootDecls: Map<Scope, DeclIdent[]>;

  /** Root LiveDecls, cached per module root scope. */
  rootLive: Map<Scope, LiveDecls>;

  /** Flattened import statements, cached per module. */
  flatImports: Map<WeslAST, FlatImport[]>;

  /** Attributes contributed by linker plugins, emitted after an elem's own
   * attributes. Parsed ASTs are shared across links, so plugins record here
   * rather than editing elems (see addAttributes()). */
  addedAttributes: Map<AbstractElem, AttributeElem[]>;

  /** Semantic expression types, filled on demand by typeOfExpr()
   * (binding doesn't run type synthesis). Read through typeOfExpr(): these are
   * caches, so a missing entry means not-yet-computed, not untyped. */
  expressionTypes: Map<ExpressionElem, Type>;

  /** Semantic declaration types, filled on demand by typeOfDecl().
   * Read through typeOfDecl(), as with expressionTypes. */
  declTypes: Map<DeclIdent, Type>;

  /** Decls whose type synthesis is in flight, guarding recursive decls in
   * erroneous source (e.g. `const a = a;`). Transient walk state, not a cache:
   * each frame removes its entry in a finally, so the set is empty between
   * type queries. */
  visitingDecls: Set<DeclIdent>;

  /** Consts whose evaluation is in flight: the const-eval counterpart of
   * visitingDecls (value recursion rather than type recursion). */
  visitingConsts: Set<DeclIdent>;

  /** Expression types refined by their expected type from context,
   * filled on demand by the bidirectional checking pass. Absent where an
   * expression has no expected type; checkedTypeOf() falls back to synthesis. */
  checkedTypes: Map<ExpressionElem, Type>;
}

/** What a ref ident resolved to during binding: a declaration,
 * a standard WGSL name (like sin, or u32), or nothing. */
export type RefTarget = DeclIdent | "std" | "unbound";

/** Results returned from binding pass. */
export interface BindResults {
  /** Bind-time facts about the parsed modules (ref targets, mangled names). */
  bindings: LinkBindings;

  /** Root level names (including mangled names from conflicts). */
  globalNames: Set<string>;

  /** Global declarations referenced (to emit in link). */
  decls: DeclIdent[];

  /** Module level statements contributed by imported modules: const_asserts,
   * and the enable/requires directives the linker hoists. */
  newStatements: EmittableElem[];

  /** Unbound identifiers with position info (only if accumulateUnbound is true). */
  unbound?: UnboundRef[];
}

/** An unresolved reference with position info for error reporting. */
export interface UnboundRef {
  /** Module path that couldn't be resolved (e.g., ["package", "foo", "bar"]). */
  path: string[];

  /** Source module containing this reference. */
  srcModule: SrcModule;

  /** Start offset in the source. */
  start: number;

  /** End offset in the source. */
  end: number;
}

/** An element that can be directly emitted into the linked result. */
export interface EmittableElem {
  srcModule: SrcModule;
  elem: AbstractElem;
}

export interface BindIdentsParams
  extends Pick<LinkRegistryParams, "resolver" | "conditions" | "mangler"> {
  rootAst: WeslAST;

  /** If true, accumulate unbound identifiers into BindResults.unbound instead of throwing. */
  accumulateUnbound?: true;

  /** If true, bind on modules with parse errors instead of throwing
   * (for editors and dependency discovery, which work on partial ASTs). */
  lenient?: true;

  /** Visit all conditional branches (for dependency discovery). */
  discoveryMode?: boolean;
}

/** State used during the recursive scope tree walk to bind references to declarations. */
export interface BindContext {
  resolver: ModuleResolver;

  conditions: Conditions;

  /** Per-link binding facts accumulated by this pass. */
  bindings: LinkBindings;

  /** Decl idents discovered so far (to avoid re-traversing). */
  knownDecls: Set<DeclIdent>;

  /** Scopes already processed (avoid duplicate work). */
  foundScopes: Set<Scope>;

  /** Root level names used so far (enables manglers to pick unique names). */
  globalNames: Set<string>;

  /** Additional global statements to emit (indexed by elem for uniqueness). */
  globalStatements: Map<AbstractElem, EmittableElem>;

  /** Modules that already contributed their global statements. */
  statementModules: Set<WeslAST>;

  /** Construct unique identifier names for global declarations. */
  mangler: ManglerFn;

  /** Unbound identifiers if accumulateUnbound is true. */
  unbound?: UnboundRef[];

  /** Bind modules with parse errors instead of throwing. */
  lenient?: true;

  /** Don't follow references from declarations
   * (for library dependency detection, which searches from all modules,
   *  rather than recursively from a root like normal linking). */
  dontFollowDecls?: boolean;

  /** Visit all conditional branches (for dependency discovery). */
  discoveryMode?: boolean;
}

/** Discovered declaration found during binding. */
export interface FoundDecl {
  decl: DeclIdent;
  /** module containing the decl */
  moduleAst: WeslAST;
}

/** Classify what a ref ident resolved to during binding. "unbound" covers
 * both genuinely unresolved refs and refs binding skips on purpose (condition
 * refs, non-WGSL attribute params); see LinkBindings.refersTo. */
export function refTarget(ident: RefIdent, bindings: LinkBindings): RefTarget {
  return bindings.refersTo.get(ident) ?? "unbound";
}

/** The declaration a ref bound to, or undefined for std and unbound refs. */
export function refDecl(
  ident: RefIdent,
  bindings: LinkBindings,
): DeclIdent | undefined {
  const target = bindings.refersTo.get(ident);
  return target === "std" ? undefined : target;
}

/** The name a declaration emits as: its mangled name if global, its original
 * name if local (the mangled table skips locals). undefined for a global that
 * binding never reached, and so never mangled. */
export function outputName(
  decl: DeclIdent,
  bindings: LinkBindings,
): string | undefined {
  if (!decl.isGlobal) return decl.originalName;
  return bindings.mangled.get(decl);
}

/** Attach attributes to an elem for this link only, e.g. a plugin adding
 * @group/@binding to a global var. They emit after the elem's own attributes. */
export function addAttributes(
  bindings: LinkBindings,
  elem: AbstractElem,
  attributes: AttributeElem[],
): void {
  const { addedAttributes } = bindings;
  const prev = addedAttributes.get(elem);
  addedAttributes.set(elem, prev ? [...prev, ...attributes] : attributes);
}

/** Create an empty per-link bindings table. */
export function newLinkBindings(): LinkBindings {
  return {
    refersTo: new Map(),
    mangled: new Map(),
    rootDecls: new Map(),
    rootLive: new Map(),
    flatImports: new Map(),
    addedAttributes: new Map(),
    expressionTypes: new Map(),
    declTypes: new Map(),
    visitingDecls: new Set(),
    visitingConsts: new Set(),
    checkedTypes: new Map(),
  };
}

/** Bind ref idents to declarations and mangle global declaration names.
 *
 * Parsing recovers from syntax errors, so erroneous modules surface here:
 * strict binding (the link() path) throws on a module with parse diagnostics,
 * while lenient binding proceeds on the partial AST. Modules are parsed lazily
 * as binding walks imports, so each one is checked as it's reached. */
export function bindIdents(params: BindIdentsParams): BindResults {
  const { rootAst, resolver, accumulateUnbound, discoveryMode } = params;
  const { conditions = {}, mangler = minimalMangle, lenient } = params;
  if (!lenient) throwOnParseError(rootAst);

  const bindings = newLinkBindings();
  const { rootScope } = rootAst;
  const rootDecls = discoveryMode
    ? findAllRootDecls(rootScope)
    : findValidRootDecls(rootScope, conditions);
  const { globalNames, knownDecls } = initRootDecls(rootDecls, bindings);

  const bindContext: BindContext = {
    resolver,
    conditions,
    bindings,
    knownDecls,
    mangler,
    foundScopes: new Set(),
    globalNames,
    globalStatements: new Map(),
    statementModules: new Set(),
    unbound: accumulateUnbound ? [] : undefined,
    lenient,
    discoveryMode,
  };

  const liveDecls = makeRootLiveDecls(rootDecls);
  // seed the per-scope caches so imports back into the root module reuse
  // these results rather than recomputing them via the cache-miss path
  bindings.rootDecls.set(rootScope, rootDecls);
  bindings.rootLive.set(rootScope, liveDecls);

  const fromRootDecls = rootDecls.flatMap(d =>
    processDependentScope(d, bindContext),
  );
  const fromRefs = bindIdentsRecursive(rootScope, bindContext, liveDecls);
  return {
    bindings,
    decls: [...fromRootDecls, ...fromRefs],
    globalNames,
    newStatements: [...bindContext.globalStatements.values()],
    unbound: bindContext.unbound,
  };
}

/** Recursively bind refs to decls in this scope and children. @return new declarations found */
export function bindIdentsRecursive(
  scope: Scope,
  bindContext: BindContext,
  liveDecls: LiveDecls,
): DeclIdent[] {
  const { dontFollowDecls, foundScopes } = bindContext;
  if (foundScopes.has(scope)) return [];
  foundScopes.add(scope);

  const { newGlobals, newFromChildren } = processScope(
    scope,
    bindContext,
    liveDecls,
  );
  const newFromRefs = dontFollowDecls
    ? []
    : handleDecls(newGlobals, bindContext);
  return [newGlobals, newFromChildren, newFromRefs].flat();
}

/** Initialize root declarations with mangled names and add to tracking sets. */
function initRootDecls(validRootDecls: DeclIdent[], bindings: LinkBindings) {
  for (const d of validRootDecls) bindings.mangled.set(d, d.originalName);
  const knownDecls = new Set(validRootDecls);
  const globalNames = new Set(validRootDecls.map(d => d.originalName));
  return { globalNames, knownDecls };
}

/** Process dependent scope for a single declaration. */
function processDependentScope(decl: DeclIdent, ctx: BindContext): DeclIdent[] {
  const { dependentScope } = decl;
  if (!dependentScope) return [];
  const rootDecls = rootLiveDecls(decl, ctx);
  return bindIdentsRecursive(dependentScope, ctx, makeLiveDecls(rootDecls));
}

/** Process all identifiers and subscopes in this scope. */
function processScope(
  scope: Scope,
  bindContext: BindContext,
  liveDecls: LiveDecls,
): { newGlobals: DeclIdent[]; newFromChildren: DeclIdent[] } {
  const newGlobals: DeclIdent[] = [];
  const newFromChildren: DeclIdent[] = [];

  const items = bindContext.discoveryMode
    ? scope.contents
    : validScopeItems(scope, bindContext.conditions);
  for (const child of items) {
    if (child.kind === "decl") {
      liveDecls.decls.set(child.originalName, child);
    } else if (child.kind === "ref") {
      const newDecl = handleRef(child, liveDecls, bindContext);
      if (newDecl) newGlobals.push(newDecl);
    } else {
      const newLive =
        child.kind === "scope" ? makeLiveDecls(liveDecls) : liveDecls;
      newFromChildren.push(...bindIdentsRecursive(child, bindContext, newLive));
    }
  }
  return { newGlobals, newFromChildren };
}

/** Follow new global declarations into their dependent scopes. */
function handleDecls(
  newGlobals: DeclIdent[],
  bindContext: BindContext,
): DeclIdent[] {
  return newGlobals.flatMap(decl => processDependentScope(decl, bindContext));
}

/** Given a global declIdent, return the liveDecls for its root scope. */
function rootLiveDecls(decl: DeclIdent, ctx: BindContext): LiveDecls {
  assertThatDebug(decl.isGlobal, identToString(decl));

  let scope = decl.containingScope;
  while (scope.parent) scope = scope.parent;
  assertThatDebug(scope.kind === "scope");

  const { rootLive } = ctx.bindings;
  const cached = rootLive.get(scope);
  if (cached) return cached;
  const live = makeRootLiveDecls(getValidRootDecls(scope, ctx));
  rootLive.set(scope, live);
  return live;
}

/** Resolve a ref to its declaration, mangling globals and marking std refs. */
function handleRef(
  ident: RefIdent,
  liveDecls: LiveDecls,
  bindContext: BindContext,
): DeclIdent | undefined {
  const { bindings } = bindContext;
  if (bindings.refersTo.has(ident)) return;

  // Skip binding for condition refs - they resolve via Conditions map (for now)
  if (ident.conditionRef) return;

  // Skip binding for refs in non-WGSL attribute params (e.g., @test(description))
  if (ident.attrParam && !wgslStandardAttributes.has(ident.attrParam)) return;

  const found =
    findDeclInModule(ident, liveDecls) ??
    findQualifiedImport(ident, bindContext);

  // an import that matched but didn't resolve shadows any std name;
  // the ref stays unbound until the import's package is fetched and rebound
  if (found === "unbound") return;

  if (found) {
    bindings.refersTo.set(ident, found.decl);
    return handleNewDecl(ident, found, bindContext);
  }

  if (stdWgsl(ident.originalName)) {
    bindings.refersTo.set(ident, "std");
    return;
  }

  if (!bindContext.unbound)
    failIdent(ident, `unresolved identifier '${ident.originalName}'`);
}

/** Search current scope and parent scopes for a matching declaration. */
function findDeclInModule(
  ident: RefIdent,
  liveDecls: LiveDecls,
): FoundDecl | undefined {
  const found = liveDecls.decls.get(ident.originalName);
  if (found) return { decl: found, moduleAst: ident.ast };
  if (liveDecls.parent) return findDeclInModule(ident, liveDecls.parent);
}

/** If found declaration is new, mangle its name. @return the decl if it's global. */
function handleNewDecl(
  refIdent: RefIdent,
  foundDecl: FoundDecl,
  ctx: BindContext,
): DeclIdent | undefined {
  const { decl, moduleAst } = foundDecl;
  const { knownDecls, globalStatements, statementModules } = ctx;
  if (knownDecls.has(decl)) return;

  knownDecls.add(decl);
  setMangledName(refIdent.originalName, decl, ctx);
  if (!decl.isGlobal) return;

  if (!statementModules.has(moduleAst)) {
    statementModules.add(moduleAst);
    for (const elem of importedStatements(moduleAst, ctx.conditions)) {
      globalStatements.set(elem, { srcModule: decl.srcModule, elem });
    }
  }
  return decl;
}

/** Set a globally unique mangled name for this declaration.
 * Locals keep their original names and aren't recorded in the table. */
function setMangledName(
  proposedName: string,
  decl: DeclIdent,
  ctx: BindContext,
): void {
  const { bindings, globalNames, mangler } = ctx;
  if (!decl.isGlobal) {
    globalNames.add(decl.originalName);
    return;
  }
  if (bindings.mangled.has(decl)) return;

  const sep = proposedName.lastIndexOf("::");
  const name = sep === -1 ? proposedName : proposedName.slice(sep + 2);
  const mangledName = mangler(decl, decl.srcModule, name, globalNames);
  bindings.mangled.set(decl, mangledName);
  globalNames.add(mangledName);
}

/**
 * Module level statements an imported module contributes to the link: its
 * const_asserts, and its enable/requires directives (without them the decl we
 * just pulled in won't compile, e.g. an f16 fn from an f16 library).
 *
 * Conditions are applied here, where the module's whole declaration sequence is
 * in hand, rather than per statement at emit: an @if/@elif/@else chain only
 * reads correctly in sequence, and the head of a chain may be an element that
 * never hoists (a diagnostic directive) or that emits separately (a
 * const_assert). Emit takes these statements as already valid.
 *
 * Relies on the parser recording every moduleAssert/moduleDirective element in
 * moduleElem.decls as well (ASTs are immutable after parse, so the shared
 * element identity holds).
 */
function importedStatements(
  moduleAst: WeslAST,
  conditions: Conditions,
): AbstractElem[] {
  const { moduleAsserts, moduleDirectives, moduleElem } = moduleAst;
  if (!moduleAsserts?.length && !moduleDirectives?.length) return [];

  const contributed = new Set<AbstractElem>(moduleAsserts);
  for (const elem of moduleDirectives ?? []) contributed.add(elem);
  const valid = filterValidElements(moduleElem.decls, conditions);
  return valid.filter(e => contributed.has(e));
}
