import type {
  AttributeElem,
  ExpressionElem,
  LetElem,
  VarElem,
} from "../AbstractElems.ts";
import { beginElem, finishElem } from "./ContentsHelpers.ts";
import { skipTemplateList } from "./ParseGlobalVar.ts";
import { getStartWithAttributes } from "./ParseStatement.ts";
import {
  attachAttributes,
  expect,
  expectExpression,
  linkDeclIdent,
  throwParseError,
} from "./ParseUtil.ts";
import { parseTypedDecl } from "./ParseValueDeclaration.ts";
import type { ParsingContext } from "./ParsingContext.ts";

/**
 * Grammar: variable_or_value_statement : variable_decl | variable_decl '=' expression
 * Grammar: variable_decl : 'var' template_list? optionally_typed_ident
 */
export function parseLocalVarDecl(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): VarElem | null {
  return parseVarOrLet(ctx, "var", true, false, attributes) as VarElem | null;
}

/** Grammar: 'let' optionally_typed_ident '=' expression */
export function parseLetDecl(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): LetElem | null {
  return parseVarOrLet(ctx, "let", false, true, attributes) as LetElem | null;
}

/** Shared logic for var/let declarations. */
function parseVarOrLet(
  ctx: ParsingContext,
  keyword: "var" | "let",
  hasTemplate: boolean,
  requiresInit: boolean,
  attributes?: AttributeElem[],
): VarElem | LetElem | null {
  const { stream } = ctx;
  const token = stream.matchText(keyword);
  if (!token) return null;

  const startPos = getStartWithAttributes(attributes, token.span[0]);
  beginElem(ctx, keyword, attributes);
  if (hasTemplate) skipTemplateList(ctx);

  const typedDecl = parseTypedDecl(ctx, false);
  if (!typedDecl)
    throwParseError(stream, `Expected identifier after '${keyword}'`);
  ctx.addElem(typedDecl);

  let init: ExpressionElem | undefined;
  if (requiresInit) {
    const msg = `${keyword} identifier (${keyword} requires initialization)`;
    expect(stream, "=", msg);
    init = expectExpression(ctx);
  } else if (stream.matchText("=")) {
    init = expectExpression(ctx);
  }

  expect(stream, ";", `${keyword} declaration`);

  const elem = finishElem(keyword, startPos, ctx, { name: typedDecl, init });
  attachAttributes(elem, attributes);
  linkDeclIdent(typedDecl, elem);
  return elem;
}
