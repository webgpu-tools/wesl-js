import type {
  AttributeElem,
  NameElem,
  TranslateTimeExpressionElem,
  TypeRefElem,
  TypeTemplateParameter,
  UnknownExpressionElem,
} from "./AbstractElems.ts";
import { assertUnreachable } from "./Assertions.ts";
import {
  diagnosticControlToString,
  expressionToString,
  findDecl,
} from "./LowerAndEmit.ts";
import type { RefIdent } from "./Scope.ts";

// LATER DRY emitting elements like this with LowerAndEmit?

export function attributeToString(e: AttributeElem): string {
  const { kind } = e.attribute;
  // LATER emit more precise source map info by making use of all the spans
  // Like the first case does
  if (kind === "@attribute") {
    const { params } = e.attribute;
    if (params === undefined || params.length === 0) {
      return "@" + e.attribute.name;
    } else {
      const args = params.map(attrParamToString).join(", ");
      return `@${e.attribute.name}(${args})`;
    }
  } else if (kind === "@builtin") {
    return "@builtin(" + e.attribute.param.name + ")";
  } else if (kind === "@diagnostic") {
    return (
      "@diagnostic" +
      diagnosticControlToString(e.attribute.severity, e.attribute.rule)
    );
  } else if (kind === "@if") {
    return `@if(${expressionToString(e.attribute.param.expression)})`;
  } else if (kind === "@elif") {
    return `@elif(${expressionToString(e.attribute.param.expression)})`;
  } else if (kind === "@else") {
    return "@else";
  } else if (kind === "@interpolate") {
    return `@interpolate(${e.attribute.params.map(v => v.name).join(", ")})`;
  } else {
    assertUnreachable(kind);
  }
}

export function typeListToString(params: TypeTemplateParameter[]): string {
  return `<${params.map(typeParamToString).join(", ")}>`;
}

export function typeParamToString(param?: TypeTemplateParameter): string {
  if (param === undefined) return "?";
  if (param.kind === "type") return typeRefToString(param);
  return expressionToString(param);
}

export function typeRefToString(t?: TypeRefElem): string {
  if (!t) return "?";
  const { name, templateParams } = t;
  const params = templateParams ? typeListToString(templateParams) : "";
  return `${refToString(name)}${params}`;
}

/** Render a single `@attribute(...)` argument back to source text. */
function attrParamToString(
  elem: TranslateTimeExpressionElem | UnknownExpressionElem | NameElem,
): string {
  if (elem.kind === "translate-time-expression") {
    throw new Error("Not supported");
  } else if (elem.kind === "expression") {
    return expressionToString(elem.expression);
  } else if (elem.kind === "name") {
    return elem.name;
  } else {
    assertUnreachable(elem);
  }
}

function refToString(ref: RefIdent | string): string {
  if (typeof ref === "string") return ref;
  if (ref.std) return ref.originalName;
  const decl = findDecl(ref);
  return decl.mangledName || decl.originalName;
}
