import type {
  AbstractElem,
  Attribute,
  AttributeElem,
  CommentElem,
  DirectiveElem,
  DoBlockElem,
  FnElem,
  FnParamElem,
  TypedDeclElem,
  TypeRefElem,
  TypeTemplateParameter,
  UnknownExpressionElem,
} from "../AbstractElems.ts";
import { assertUnreachable } from "../Assertions.ts";
import { childElems } from "../LinkerUtil.ts";
import {
  diagnosticControlToString,
  expressionToString,
} from "../LowerAndEmit.ts";
import { importToString } from "./ImportToString.ts";
import { LineWrapper } from "./LineWrapper.ts";

const maxLineLength = 150;

export function astToString(elem: AbstractElem, indent = 0): string {
  const { kind } = elem;
  const str = new LineWrapper(indent, maxLineLength);
  str.add(kind);
  addElemFields(elem, str);
  addCommentFields(elem, str);
  const children = childElems(elem);
  if (children.length) {
    str.nl();
    const childStrings = children.map(e => astToString(e, indent + 2));
    str.addBlock(childStrings.join("\n"), false);
  }

  return str.result;
}

/** @return string representation of an attribute (for test/debug) */
export function attributeToString(attr: Attribute): string {
  const str = new LineWrapper(0, maxLineLength);
  addAttributeFields(attr, str);
  return str.result;
}

// LATER rewrite to be shorter and easier to read
function addElemFields(elem: AbstractElem, str: LineWrapper): void {
  const { kind } = elem;
  // no-op kinds (handled elsewhere or no additional fields)
  if (
    kind === "assert" ||
    kind === "expression" ||
    kind === "module" ||
    kind === "param" ||
    kind === "switch-clause"
  ) {
    return;
  }
  if (
    kind === "var" ||
    kind === "let" ||
    kind === "gvar" ||
    kind === "const" ||
    kind === "override"
  ) {
    addTypedDeclIdent(elem.name, str);
    listAttributeElems(elem.attributes, str);
  } else if (kind === "struct") {
    str.add(" " + elem.name.ident.originalName);
  } else if (kind === "member") {
    listAttributeElems(elem.attributes, str);
    str.add(` ${elem.name.name}: ${typeRefElemToString(elem.typeRef)}`);
  } else if (kind === "name") {
    str.add(" " + elem.name);
  } else if (kind === "fn") {
    addFnFields(elem, str);
  } else if (kind === "do") {
    addDoFields(elem, str);
  } else if (kind === "alias") {
    const prefix = elem.name.ident.kind === "decl" ? "%" : "";
    str.add(
      ` ${prefix}${elem.name.ident.originalName}=${typeRefElemToString(elem.typeRef)}`,
    );
  } else if (kind === "attribute") {
    addAttributeFields(elem.attribute, str);
  } else if (kind === "type") {
    str.add(" " + typeRefElemToString(elem));
  } else if (kind === "synthetic") {
    str.add(` '${elem.text}'`);
  } else if (kind === "import") {
    str.add(" " + importToString(elem.imports));
    listAttributeElems(elem.attributes, str);
  } else if (kind === "ref") {
    str.add(" " + elem.ident.originalName);
  } else if (kind === "typeDecl") {
    addTypedDeclIdent(elem, str);
  } else if (kind === "decl") {
    str.add(" %" + elem.ident.originalName);
  } else if (kind === "directive") {
    addDirective(elem, str);
  } else if (
    // statement kinds: the debug printer shows only their attributes
    kind === "block" ||
    kind === "if" ||
    kind === "for" ||
    kind === "while" ||
    kind === "loop" ||
    kind === "continuing" ||
    kind === "switch" ||
    kind === "return" ||
    kind === "break" ||
    kind === "continue" ||
    kind === "discard" ||
    kind === "assign" ||
    kind === "increment" ||
    kind === "decrement" ||
    kind === "call" ||
    kind === "empty"
  ) {
    listAttributeElems(elem.attributes, str);
  } else if (kind === "literal") {
    str.add(` literal(${elem.value})`);
  } else if (kind === "binary-expression") {
    str.add(` binop(${elem.operator.value})`);
  } else if (kind === "unary-expression") {
    str.add(` unop(${elem.operator.value})`);
  } else if (kind === "call-expression") {
    str.add(" call");
  } else if (kind === "parenthesized-expression") {
    str.add(" parens");
  } else if (kind === "component-expression") {
    str.add(" []");
  } else if (kind === "component-member-expression") {
    str.add(" .");
  } else {
    assertUnreachable(kind);
  }
}

/** Show attached leading/trailing comments to verify comment attachment. */
function addCommentFields(elem: AbstractElem, str: LineWrapper): void {
  // SyntheticElem has no source position and so carries no comments
  if (!("start" in elem)) return;
  const { commentsBefore, commentsAfter } = elem;
  if (commentsBefore?.length)
    str.add(commentsToString("before", commentsBefore));
  if (commentsAfter?.length) str.add(commentsToString("after", commentsAfter));
  if ("innerComments" in elem && elem.innerComments?.length)
    str.add(commentsToString("inner", elem.innerComments));
}

function addAttributeFields(attr: Attribute, str: LineWrapper) {
  const { kind } = attr;
  if (kind === "@attribute") {
    const { name, params } = attr;
    const paramsStr = params?.length
      ? `(${params.map(unknownExpressionToString).join(", ")})`
      : "";
    str.add(` @${name}${paramsStr}`);
  } else if (kind === "@builtin") {
    str.add(` @builtin(${attr.param.name})`);
  } else if (kind === "@diagnostic") {
    str.add(
      ` @diagnostic${diagnosticControlToString(attr.severity, attr.rule)}`,
    );
  } else if (kind === "@if" || kind === "@elif") {
    str.add(` ${kind}(${expressionToString(attr.param.expression)})`);
  } else if (kind === "@else") {
    str.add(" @else");
  } else if (kind === "@interpolate") {
    str.add(` @interpolate(${attr.params.map(v => v.name).join(", ")})`);
  } else {
    assertUnreachable(kind);
  }
}

function addTypedDeclIdent(elem: TypedDeclElem, str: LineWrapper) {
  const { decl, typeRef } = elem;
  str.add(" %" + decl.ident.originalName);
  if (typeRef) {
    str.add(" : " + typeRefElemToString(typeRef));
  }
}

/** show attribute names in short form to verify collection */
function listAttributeElems(
  attrs: AttributeElem[] | undefined,
  str: LineWrapper,
): void {
  attrs?.forEach(a => {
    str.add(" " + attributeName(a.attribute));
  });
}

function typeRefElemToString(elem: TypeRefElem): string {
  if (!elem) return "?type?";
  const nameStr =
    typeof elem.name === "string" ? elem.name : elem.name.originalName;
  const params = elem.templateParams?.map(templateParamToString).join(", ");
  return params ? `${nameStr}<${params}>` : nameStr;
}

function addFnFields(elem: FnElem, str: LineWrapper) {
  const { name, params, returnType, attributes } = elem;
  str.add(` ${name.ident.originalName}(${paramListToString(params)})`);
  listAttributeElems(attributes, str);
  if (returnType) str.add(" -> " + typeRefElemToString(returnType));
}

function addDoFields(elem: DoBlockElem, str: LineWrapper) {
  const { name, params, attributes } = elem;
  str.add(` ${name.name}(${paramListToString(params)})`);
  listAttributeElems(attributes, str);
}

function addDirective(elem: DirectiveElem, str: LineWrapper) {
  const { directive, attributes } = elem;
  const { kind } = directive;
  if (kind === "diagnostic") {
    const { severity, rule } = directive;
    const control = diagnosticControlToString(severity, rule);
    str.add(` diagnostic${control}`);
  } else if (kind === "enable" || kind === "requires") {
    str.add(` ${kind} ${directive.extensions.map(v => v.name).join(", ")}`);
  } else {
    assertUnreachable(kind);
  }
  listAttributeElems(attributes, str);
}

function commentsToString(label: string, comments: CommentElem[]): string {
  const texts = comments.map(c => {
    const text = c.srcModule.src.slice(c.start, c.end);
    return c.blankBefore ? `'${text}'(blank)` : `'${text}'`;
  });
  return ` ${label}[${texts.join(", ")}]`;
}

function unknownExpressionToString(elem: UnknownExpressionElem): string {
  return astToString(elem.expression);
}

function attributeName(attr: Attribute): string {
  return attr.kind === "@attribute" ? "@" + attr.name : attr.kind;
}

function templateParamToString(p: TypeTemplateParameter): string {
  if (typeof p === "string") return p;
  if (p.kind === "type") return typeRefElemToString(p);
  return astToString(p);
}

/** @return "name: type, ..." for a fn/do parameter list. */
function paramListToString(params: FnParamElem[]): string {
  const paramStrs = params.map(p => {
    const { originalName } = p.name.decl.ident;
    return `${originalName}: ${typeRefElemToString(p.name.typeRef!)}`;
  });
  return paramStrs.join(", ");
}
