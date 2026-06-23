import type {
  ExpressionElem,
  HasAttributes,
  StandardAttribute,
  UnknownExpressionElem,
} from "wesl";

/** Find a StandardAttribute by name on an element with attributes. */
export function findAnnotation(
  elem: HasAttributes,
  name: string,
): StandardAttribute | undefined {
  for (const a of elem.attributes ?? []) {
    const attr = a.attribute;
    if (attr.kind === "@attribute" && attr.name === name) return attr;
  }
}

/** The string value of each of an annotation's params. */
export function annotationParams(attr: StandardAttribute): string[] {
  return attr.params?.map(param => exprToString(param.expression)) ?? [];
}

/** Extract numeric params from an annotation, parsing WGSL numeric literals
 *  (suffixes like `256u`/`1.5f`, digit separators, and hex). */
export function numericParams(attr: StandardAttribute): number[] {
  return annotationParams(attr).map(wgslNumber);
}

/** The originalName of an attribute parameter that is a bare identifier ref. */
export function firstRefName(
  param: UnknownExpressionElem | undefined,
): string | undefined {
  const expr = param?.expression;
  return expr?.kind === "ref" ? expr.ident.originalName : undefined;
}

/** Extract the string value of an attribute-parameter expression. */
function exprToString(expr: ExpressionElem): string {
  if (expr.kind === "literal") return expr.value;
  if (expr.kind === "ref") return expr.ident.originalName;
  return "";
}

/** Convert a WGSL numeric literal's text to a number. Strips the `u`/`i`/`f`/`h`
 *  suffix (only `u`/`i` for hex, where `f`/`h` are digits) and `_` separators.
 *  Non-numeric text (e.g. an unresolved ref name) yields NaN. */
function wgslNumber(text: string): number {
  const t = text.replace(/_/g, "");
  if (/^[+-]?0[xX]/.test(t)) return Number(t.replace(/[uiUI]$/, ""));
  return Number(t.replace(/[uifhUIFH]$/, ""));
}
