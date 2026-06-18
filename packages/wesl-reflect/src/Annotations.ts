import type { AbstractElem, HasAttributes, StandardAttribute } from "wesl";

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

/** Extract string params from an annotation's UnknownExpressionElem params. */
export function annotationParams(attr: StandardAttribute): string[] {
  return attr.params?.map(expr => exprToString(expr.contents)) ?? [];
}

/** Extract numeric params from an annotation. */
export function numericParams(attr: StandardAttribute): number[] {
  return annotationParams(attr).map(Number);
}

/** Extract the string value from an expression's contents. */
function exprToString(contents: AbstractElem[]): string {
  for (const child of contents) {
    if (child.kind === "literal") return child.value;
    if (child.kind === "name") return child.name;
    if (child.kind === "ref") return child.ident.originalName;
    if (child.kind === "text") {
      // skip whitespace-only text (e.g. the gap before a structured literal)
      const text = child.srcModule.src.slice(child.start, child.end).trim();
      if (text) return text;
    }
  }
  return "";
}
