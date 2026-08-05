import type { BindContext } from "./BindIdents.ts";
import { validScopeItems } from "./Conditions.ts";
import type { Conditions, DeclIdent, Scope, ScopeItem } from "./Scope.ts";

/**
 * Collect a module's root-level declarations (the names importable from
 * other modules): condition-filtered normally, or across all conditional
 * branches in discovery mode.
 */

/** Find all conditionally valid declarations at the root level. */
export function findValidRootDecls(
  rootScope: Scope,
  conditions: Conditions,
): DeclIdent[] {
  return collectDecls(validScopeItems(rootScope, conditions));
}

/** Find all declarations at the root level, ignoring conditions. */
export function findAllRootDecls(rootScope: Scope): DeclIdent[] {
  return collectDecls(rootScope.contents);
}

/** Find a public declaration with the given original name. */
export function publicDecl(
  scope: Scope,
  name: string,
  conditions: Conditions,
): DeclIdent | undefined {
  const validDecls = findValidRootDecls(scope, conditions);
  return validDecls.find(d => d.originalName === name);
}

/** Get valid root declarations, cached per link in the bindings table.
 * (Discovery mode sees all declarations, ignoring conditions.) */
export function getValidRootDecls(
  rootScope: Scope,
  ctx: BindContext,
): DeclIdent[] {
  const { rootDecls } = ctx.bindings;
  const cached = rootDecls.get(rootScope);
  if (cached) return cached;
  const decls = ctx.discoveryMode
    ? findAllRootDecls(rootScope)
    : findValidRootDecls(rootScope, ctx.conditions);
  rootDecls.set(rootScope, decls);
  return decls;
}

/** Collect all declarations from scope items, recursing into partial scopes.
 * Recursing without re-filtering is sound: only root-level partials carry a
 * condAttribute (one per conditional decl, filtered by the caller); partials
 * nested inside them are condition-less dependent scopes from decl parsers. */
function collectDecls(items: Iterable<ScopeItem>): DeclIdent[] {
  return [...items].flatMap(item => {
    const { kind } = item;
    if (kind === "decl") return [item];
    if (kind === "partial") return collectDecls(item.contents);
    return [];
  });
}
