import type {
  AbstractElem,
  DeclIdentElem,
  ExpressionElem,
  HasAttributes,
  ModuleElem,
  RefIdentElem,
} from "./AbstractElems.ts";
import { srcLog } from "./Logging.ts";

/** A module's top-level declarations of a given kind, narrowed to that elem type. */
export function declsOfKind<K extends AbstractElem["kind"]>(
  moduleElem: ModuleElem,
  kind: K,
): Extract<AbstractElem, { kind: K }>[] {
  return moduleElem.decls.filter(
    (e): e is Extract<AbstractElem, { kind: K }> => e.kind === kind,
  );
}

/** Visit an elem and all its descendants, parent before children (pre-order). */
export function visitAst(
  elem: AbstractElem,
  visitor: (elem: AbstractElem) => void,
) {
  visitor(elem);
  for (const child of childElems(elem)) visitAst(child, visitor);
}

/**
 * Child elems of any AST node: the typed structural fields (attributes plus
 * body / condition / decls / ...) in source order. Returns [] for leaf elems.
 */
export function childElems(elem: AbstractElem): readonly AbstractElem[] {
  const fields = structuralFields(elem);
  if (!fields) return [];
  return [...((elem as HasAttributes).attributes ?? []), ...fields];
}

export function identElemLog(
  identElem: DeclIdentElem | RefIdentElem,
  ...messages: any[]
): void {
  srcLog(
    identElem.srcModule.src,
    [identElem.start, identElem.end],
    ...messages,
  );
}

/** The child elems held in a node's typed fields, in source order, or undefined
 *  for leaf kinds that hold no child elems. */
function structuralFields(elem: AbstractElem): AbstractElem[] | undefined {
  switch (elem.kind) {
    case "module":
      return elem.decls;
    case "var":
    case "gvar":
      return [
        ...(elem.template ?? []),
        elem.name,
        ...(elem.init ? [elem.init] : []),
      ];
    case "let":
    case "const":
    case "override":
      return [elem.name, ...(elem.init ? [elem.init] : [])];
    case "alias":
      return [elem.name, elem.typeRef];
    case "assert":
      return [elem.expression];
    case "struct":
      return [elem.name, ...elem.members];
    case "member":
      return [elem.name, elem.typeRef];
    case "type":
      return [elem.name.refIdentElem, ...(elem.templateParams ?? [])];
    case "expression":
      return [elem.expression];
    case "param":
      return [elem.name];
    case "typeDecl":
      return elem.typeRef ? [elem.decl, elem.typeRef] : [elem.decl];
    case "fn":
      return [
        elem.name,
        ...elem.params,
        ...(elem.returnType ? [elem.returnType] : []),
        elem.body,
      ];
    case "block":
      return elem.body;
    case "if":
      return [elem.condition, elem.body, ...(elem.else ? [elem.else] : [])];
    case "for":
      return [elem.init, elem.condition, elem.update, elem.body].filter(
        isDefined,
      );
    case "while":
      return [elem.condition, elem.body];
    case "loop":
    case "continuing":
      return [elem.body];
    case "switch":
      return [elem.selector, ...(elem.bodyAttributes ?? []), ...elem.clauses];
    case "switch-clause":
      return [...exprSelectors(elem.selectors), elem.body];
    case "return":
      return elem.value ? [elem.value] : [];
    case "break":
      return elem.condition ? [elem.condition] : [];
    case "assign":
      return elem.lhs.kind === "phony" ? [elem.rhs] : [elem.lhs, elem.rhs];
    case "increment":
    case "decrement":
      return [elem.target];
    case "call":
      return [elem.call];
    case "continue":
    case "discard":
    case "empty":
      return [];
    default:
      return undefined;
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** Drop the `"default"` sentinel, keeping only real case-selector expressions. */
function exprSelectors(
  selectors: (ExpressionElem | "default")[],
): ExpressionElem[] {
  return selectors.filter((s): s is ExpressionElem => s !== "default");
}
