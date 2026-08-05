import { type LinkBindings, type RefTarget, refTarget } from "../BindIdents.ts";
import type { Ident, Scope } from "../Scope.ts";
import { childScope } from "../Scope.ts";
import { attributeToString } from "./ASTtoString.ts";
import { LineWrapper } from "./LineWrapper.ts";

/** A debugging print of the scope tree with identifiers in nested brackets.
 * Pass bindings to include ref targets and mangled names from a link. */
export function scopeToString(
  scope: Scope,
  indent = 0,
  shortIdents = true,
  bindings?: LinkBindings,
): string {
  const { contents, kind, condAttribute } = scope;

  const str = new LineWrapper(indent);
  const attrStrings = condAttribute && attributeToString(condAttribute);
  if (attrStrings) str.add(attrStrings + " ");
  if (kind === "partial") str.add("-");
  str.add("{ ");

  const last = contents.length - 1;
  let lastWasScope = false;
  let hasBlock = false;
  contents.forEach((elem, i) => {
    if (childScope(elem)) {
      const childScope: Scope = elem;
      const childBlock = scopeToString(
        childScope,
        indent + 2,
        shortIdents,
        bindings,
      );
      if (!lastWasScope) str.nl();
      str.addBlock(childBlock);
      lastWasScope = true;
      hasBlock = true;
    } else {
      if (lastWasScope) str.add("  ");
      lastWasScope = false;
      const ident: Ident = elem;
      if (shortIdents) {
        str.add(identShortString(ident));
      } else {
        str.add(identToString(ident, bindings));
      }
      if (i < last) str.add(" ");
    }
  });

  if (!hasBlock && str.oneLine) {
    str.add(" }");
  } else {
    if (hasBlock && !lastWasScope) str.nl();
    str.add("}");
  }

  str.add(` #${scope.id}`);

  return str.result;
}

/** A debug print of the scope tree with identifiers in long form in nested brackets */
export function scopeToStringLong(
  scope: Scope,
  bindings?: LinkBindings,
): string {
  return scopeToString(scope, 0, false, bindings);
}

/** A debug print of one ident; prints its unbound form without bindings. */
export function identToString(ident?: Ident, bindings?: LinkBindings): string {
  if (!ident) return JSON.stringify(ident);
  const { kind, originalName } = ident;
  const idStr = ident.id ? `#${ident.id}` : "";
  if (kind === "ref") {
    const target = bindings && refTarget(ident, bindings);
    return `${originalName} ${idStr} -> ${refToString(target, bindings)}`;
  } else {
    const mangledName = bindings?.mangled.get(ident);
    const mangled = mangledName ? `(${mangledName})` : "";
    return `%${originalName}${mangled} ${idStr} `;
  }
}

/** name of an identifier, with decls prefixed with '%' */
function identShortString(ident: Ident): string {
  const { kind, originalName } = ident;
  const prefix = kind === "decl" ? "%" : "";
  return `${prefix}${originalName}`;
}

/** A debug print of what a ref bound to; unbound refs print like pre-link refs. */
function refToString(target?: RefTarget, bindings?: LinkBindings): string {
  if (target === "std") return "std";
  if (!target || target === "unbound") return "undefined";
  return identToString(target, bindings);
}
