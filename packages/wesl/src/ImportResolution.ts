import type { BindContext, FoundDecl, UnboundRef } from "./BindIdents.ts";
import { failIdent } from "./ClickableError.ts";
import { filterValidElements } from "./Conditions.ts";
import { type FlatImport, flattenTreeImport } from "./FlattenTreeImport.ts";
import { declsOfKind } from "./LinkerUtil.ts";
import { resolveModulePath } from "./ModulePathUtil.ts";
import { throwOnParseError, type WeslAST } from "./ParseWESL.ts";
import { getValidRootDecls } from "./RootDeclarations.ts";
import type { RefIdent, SrcModule } from "./Scope.ts";
import { stdWgsl } from "./StandardTypes.ts";
import { last } from "./Util.ts";

/**
 * Cross module reference resolution for the binding pass.
 *
 * A ref that finds no declaration in its own module is matched against the
 * module's import statements (or read as a fully qualified path), and the
 * resulting module path is resolved to an exported root declaration.
 */

/** Match a ref ident to a declaration in another module via import or qualified ident.
 * @return the exported decl; "unbound" when the ref matched an import or qualified
 *   path that didn't resolve (recorded in ctx.unbound) - a failed import still
 *   shadows any std WGSL name; undefined when no import matched at all
 *   (non-std names are still recorded in ctx.unbound). */
export function findQualifiedImport(
  refIdent: RefIdent,
  ctx: BindContext,
): FoundDecl | "unbound" | undefined {
  const { unbound } = ctx;
  const flatImps = flatImports(refIdent.ast, ctx);
  const identParts = refIdent.originalName.split("::");
  const pathParts =
    matchingImport(identParts, flatImps) ?? qualifiedIdent(identParts);

  if (!pathParts) {
    if (unbound && !stdWgsl(refIdent.originalName)) {
      pushUnbound(unbound, identParts, refIdent);
    }
    return undefined;
  }

  const found = findExport(pathParts, refIdent.ast.srcModule, ctx);
  if ("decl" in found) return found;

  if (unbound) {
    pushUnbound(unbound, pathParts, refIdent);
    return "unbound";
  }
  failIdent(refIdent, missMessage(found, pathParts)); // throws
}

/** Flattened form of a module's import tree, cached per link.
 * (Discovery mode flattens all imports, ignoring conditions.) */
function flatImports(ast: WeslAST, ctx: BindContext): FlatImport[] {
  const cached = ctx.bindings.flatImports.get(ast);
  if (cached) return cached;

  const importElems = declsOfKind(ast.moduleElem, "import");
  const validImportElems = ctx.discoveryMode
    ? importElems
    : filterValidElements(importElems, ctx.conditions);
  const flat = validImportElems.flatMap(elem =>
    flattenTreeImport(elem.imports),
  );
  ctx.bindings.flatImports.set(ast, flat);
  return flat;
}

/** Find an import statement that matches a provided identifier. */
function matchingImport(
  identParts: string[],
  imports: FlatImport[],
): string[] | undefined {
  const flat = imports.find(f => f.importPath.at(-1) === identParts[0]);
  if (flat) return [...flat.modulePath, ...identParts.slice(1)];
}

/** @return identParts if it's a qualified path (has ::). */
function qualifiedIdent(identParts: string[]): string[] | undefined {
  if (identParts.length > 1) return identParts;
}

/** Add an unbound reference with position info. */
function pushUnbound(
  unbound: UnboundRef[],
  path: string[],
  refIdent: RefIdent,
): void {
  const { srcModule, start, end } = refIdent.refIdentElem;
  unbound.push({ path, srcModule, start, end });
}

/** Which leg of the export lookup failed, with the module path it looked in. */
interface ExportMiss {
  missing: "module" | "export";
  modulePath: string;
}

/** @return an exported root declIdent for the provided path,
 * or which leg of the lookup failed. */
function findExport(
  pathParts: string[],
  srcModule: SrcModule,
  ctx: BindContext,
): FoundDecl | ExportMiss {
  const srcParts = srcModule.modulePath.split("::");
  const fqParts = resolveModulePath(pathParts, srcParts);
  const modulePath = fqParts.slice(0, -1).join("::");

  const moduleAst = ctx.resolver.resolveModule(modulePath);
  if (!moduleAst) return { missing: "module", modulePath };
  if (!ctx.lenient) throwOnParseError(moduleAst);

  const name = last(pathParts)!;
  const validDecls = getValidRootDecls(moduleAst.rootScope, ctx);
  const decl = validDecls.find(d => d.originalName === name);
  if (decl) return { decl, moduleAst };
  return { missing: "export", modulePath };
}

/** Error text for a failed export lookup, naming the leg that failed.
 * (Root decls are filtered by the link's conditions, so a decl excluded by an
 * @if reads as a missing export.) */
function missMessage(miss: ExportMiss, pathParts: string[]): string {
  const { missing, modulePath } = miss;
  if (missing === "module")
    return `module not found for '${pathParts.join("::")}'`;
  return `no exported '${last(pathParts)}' in module '${modulePath}'`;
}
