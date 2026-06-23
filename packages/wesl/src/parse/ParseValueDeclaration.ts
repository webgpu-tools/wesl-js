import type {
  AttributeElem,
  ConstElem,
  ElemKindMap,
  ExpressionElem,
  OverrideElem,
  TypedDeclElem,
  TypeRefElem,
} from "../AbstractElems.ts";
import type { Scope } from "../Scope.ts";
import { finishStatement, getStartWithAttributes } from "./ParseStatement.ts";
import { parseSimpleTypeRef } from "./ParseType.ts";
import {
  createDeclIdentElem,
  expect,
  expectExpression,
  linkDeclIdent,
  throwParseError,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";

type ValueDeclKind = "const" | "override";

/** Grammar: 'const' optionally_typed_ident '=' expression (global or local) */
export function parseConstDecl(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): ConstElem | null {
  return parseValueDecl(ctx, "const", true, ctx.isModuleScope(), attributes);
}

/** Grammar: 'override' optionally_typed_ident ( '=' expression )? */
export function parseOverrideDecl(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): OverrideElem | null {
  return parseValueDecl(ctx, "override", false, true, attributes);
}

/** Grammar: optionally_typed_ident : ident ( ':' type_specifier )? */
export function parseTypedDecl(
  ctx: ParsingContext,
  isGlobal = true,
): TypedDeclElem | null {
  const nameToken = ctx.stream.matchKind("word");
  if (!nameToken) return null;
  const start = nameToken.span[0];

  const decl = createDeclIdentElem(ctx, nameToken, isGlobal);
  ctx.saveIdent(decl.ident);

  const { typeRef, typeScope } = parseOptionalType(ctx);

  const end = ctx.stream.checkpoint();
  return { kind: "typeDecl", decl, typeRef, typeScope, start, end };
}

/** Shared parser for const/override declarations. */
function parseValueDecl<K extends ValueDeclKind>(
  ctx: ParsingContext,
  keyword: K,
  requiresInit: boolean,
  isGlobal: boolean,
  attributes?: AttributeElem[],
): ElemKindMap[K] | null {
  const { stream } = ctx;
  const token = stream.matchText(keyword);
  if (!token) return null;

  const startPos = getStartWithAttributes(attributes, token.span[0]);
  ctx.pushScope("partial");

  const typedDecl = parseTypedDecl(ctx, isGlobal);
  if (!typedDecl)
    throwParseError(stream, `Expected identifier after '${keyword}'`);

  let init: ExpressionElem | undefined;
  if (requiresInit) {
    expect(stream, "=", `${keyword} identifier`);
    init = expectExpression(ctx);
  } else if (stream.matchText("=")) {
    init = expectExpression(ctx);
  }

  expect(stream, ";", `${keyword} declaration`);

  typedDecl.decl.ident.dependentScope = ctx.currentScope();
  ctx.popScope();

  // const/override share these fields; cast keyword to the union so the params
  // type-check against the concrete elems rather than the opaque generic K.
  const fields = { name: typedDecl, init };
  const elem = finishStatement(
    keyword as ValueDeclKind,
    startPos,
    ctx,
    fields,
    attributes,
  ) as ElemKindMap[K];
  linkDeclIdent(typedDecl, elem);
  return elem;
}

/** Parse optional ': type' annotation, managing scope for type references. */
function parseOptionalType(ctx: ParsingContext): {
  typeRef?: TypeRefElem;
  typeScope?: Scope;
} {
  if (!ctx.stream.matchText(":")) return {};

  ctx.pushScope();
  const typeRef = parseSimpleTypeRef(ctx);
  if (!typeRef) throwParseError(ctx.stream, "Expected type after ':'");
  const typeScope = ctx.currentScope();
  ctx.popScope();
  return { typeRef, typeScope };
}
