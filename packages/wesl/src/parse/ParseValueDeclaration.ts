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
import {
  beginElem,
  discardOpenElem,
  finishContents,
} from "./ContentsHelpers.ts";
import { getStartWithAttributes } from "./ParseStatement.ts";
import { parseSimpleTypeRef } from "./ParseType.ts";
import {
  attachAttributes,
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
  return parseValueDecl(ctx, "const", true, isModuleScope(ctx), attributes);
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

  beginElem(ctx, "typeDecl");
  const decl = createDeclIdentElem(ctx, nameToken, isGlobal);
  ctx.addElem(decl);
  ctx.saveIdent(decl.ident);

  const { typeRef, typeScope } = parseOptionalType(ctx);

  const end = ctx.stream.checkpoint();
  const contents = finishContents(ctx, start, end);
  return { kind: "typeDecl", decl, typeRef, typeScope, start, end, contents };
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
  beginElem(ctx, keyword, attributes);

  const typedDecl = parseTypedDecl(ctx, isGlobal);
  if (!typedDecl)
    throwParseError(stream, `Expected identifier after '${keyword}'`);
  ctx.addElem(typedDecl);

  let init: ExpressionElem | undefined;
  if (requiresInit) {
    expect(stream, "=", `${keyword} identifier`);
    init = expectExpression(ctx);
  } else if (stream.matchText("=")) {
    init = expectExpression(ctx);
  }

  expect(stream, ";", `${keyword} declaration`);

  const endPos = stream.checkpoint();
  discardOpenElem(ctx);
  typedDecl.decl.ident.dependentScope = ctx.currentScope();
  ctx.popScope();

  const elem: ConstElem | OverrideElem = {
    kind: keyword,
    name: typedDecl,
    init,
    start: startPos,
    end: endPos,
  };
  attachAttributes(elem, attributes);
  linkDeclIdent(typedDecl, elem);
  return elem as ElemKindMap[K];
}

/** @return true if ctx is at module level (not inside fn/block) */
function isModuleScope(ctx: ParsingContext): boolean {
  let scope = ctx.currentScope();
  while (scope.kind === "partial" && scope.parent) scope = scope.parent;
  return scope.parent === null;
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
  ctx.addElem(typeRef);
  const typeScope = ctx.currentScope();
  ctx.popScope();
  return { typeRef, typeScope };
}
