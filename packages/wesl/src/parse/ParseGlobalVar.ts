import type {
  AliasElem,
  AttributeElem,
  ConstAssertElem,
  ExpressionElem,
  GlobalVarElem,
  NameElem,
} from "../AbstractElems.ts";
import { beginElem } from "./ContentsHelpers.ts";
import { finishStatement, getStartWithAttributes } from "./ParseStatement.ts";
import { parseSimpleTypeRef } from "./ParseType.ts";
import {
  createDeclIdentElem,
  expect,
  expectExpression,
  expectWord,
  linkDeclIdent,
  linkDeclIdentElem,
  makeNameElem,
  throwParseError,
} from "./ParseUtil.ts";
import { parseTypedDecl } from "./ParseValueDeclaration.ts";
import type { ParsingContext } from "./ParsingContext.ts";

/**
 * Grammar: global_variable_decl : attribute* variable_decl ( '=' expression )?
 * Grammar: variable_decl : 'var' template_list? optionally_typed_ident
 */
export function parseGlobalVarDecl(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): GlobalVarElem | null {
  const { stream } = ctx;
  const varToken = stream.matchText("var");
  if (!varToken) return null;

  const startPos = getStartWithAttributes(attributes, varToken.span[0]);
  ctx.pushScope("partial");
  beginElem(ctx, "gvar", attributes);

  const template = parseTemplateList(ctx);

  const typedDecl = parseTypedDecl(ctx);
  if (!typedDecl) throwParseError(stream, "Expected identifier after 'var'");
  ctx.addElem(typedDecl);

  let init: ExpressionElem | undefined;
  if (stream.matchText("=")) {
    init = expectExpression(ctx);
  }
  expect(stream, ";", "var declaration");

  typedDecl.decl.ident.dependentScope = ctx.currentScope();
  ctx.popScope();

  const varElem = finishStatement(
    "gvar",
    startPos,
    ctx,
    { name: typedDecl, template, init },
    attributes,
  );
  linkDeclIdent(typedDecl, varElem);
  return varElem;
}

/** Grammar: 'alias' ident '=' type_specifier */
export function parseAliasDecl(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): AliasElem | null {
  const { stream } = ctx;
  const aliasToken = stream.matchText("alias");
  if (!aliasToken) return null;

  const startPos = getStartWithAttributes(attributes, aliasToken.span[0]);
  beginElem(ctx, "alias", attributes);

  const nameToken = expectWord(stream, "Expected identifier after 'alias'");

  const declIdentElem = createDeclIdentElem(ctx, nameToken, true);
  ctx.addElem(declIdentElem);
  ctx.saveIdent(declIdentElem.ident);

  expect(stream, "=", "alias name");
  ctx.pushScope();

  const typeRef = parseSimpleTypeRef(ctx);
  if (!typeRef)
    throwParseError(stream, "Expected type after '=' in alias declaration");
  ctx.addElem(typeRef);

  declIdentElem.ident.dependentScope = ctx.currentScope();
  ctx.popScope();

  expect(stream, ";", "alias declaration");

  const aliasElem = finishStatement(
    "alias",
    startPos,
    ctx,
    { name: declIdentElem, typeRef },
    attributes,
  );
  linkDeclIdentElem(declIdentElem, aliasElem);
  return aliasElem;
}

/** Grammar: 'const_assert' expression */
export function parseConstAssert(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): ConstAssertElem | null {
  const assertToken = ctx.stream.matchText("const_assert");
  if (!assertToken) return null;

  const startPos = getStartWithAttributes(attributes, assertToken.span[0]);
  beginElem(ctx, "assert", attributes);
  const expression = expectExpression(ctx);
  expect(ctx.stream, ";", "const_assert expression");

  return finishStatement("assert", startPos, ctx, { expression }, attributes);
}

/**
 * Parse an optional var template list `<storage, read_write>`. The entries are
 * predeclared enumerants (address space / access mode), not user idents, so they
 * are captured as unbound NameElems.
 */
export function parseTemplateList(ctx: ParsingContext): NameElem[] | undefined {
  const { stream } = ctx;
  if (!stream.nextTemplateStartToken()) return undefined;

  const names: NameElem[] = [];
  while (true) {
    const next = stream.peek();
    if (!next) throwParseError(stream, "Unclosed template in var declaration");
    if (next.text.startsWith(">")) {
      stream.nextTemplateEndToken();
      return names;
    }
    const word = stream.matchKind("word");
    if (word) names.push(makeNameElem(word));
    else stream.nextToken(); // skip comma separator
  }
}
