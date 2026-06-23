import type {
  AttributeElem,
  StructElem,
  StructMemberElem,
} from "../AbstractElems.ts";
import { parseAttributeList } from "./ParseAttribute.ts";
import { finishStatement, getStartWithAttributes } from "./ParseStatement.ts";
import { parseSimpleTypeRef } from "./ParseType.ts";
import {
  attrsOrUndef,
  createDeclIdentElem,
  expect,
  expectWord,
  linkDeclIdentElem,
  makeNameElem,
  parseCommaList,
  throwParseError,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";

/**
 * Grammar: struct_decl : 'struct' ident struct_body_decl
 * Grammar: struct_body_decl : '{' struct_member ( ',' struct_member )* ','? '}'
 */
export function parseStructDecl(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): StructElem | null {
  const { stream } = ctx;
  const structToken = stream.matchText("struct");
  if (!structToken) return null;

  const start = getStartWithAttributes(attributes, structToken.span[0]);
  const nameToken = expectWord(stream, "Expected identifier after 'struct'");

  const identElem = createDeclIdentElem(ctx, nameToken, true);
  ctx.saveIdent(identElem.ident);

  expect(stream, "{", "struct name");

  ctx.pushScope();
  const members = parseCommaList(ctx, parseStructMember);
  identElem.ident.dependentScope = ctx.currentScope();
  ctx.popScope();

  expect(stream, "}", "struct member");

  const params = { name: identElem, members };
  const elem = finishStatement("struct", start, ctx, params, attributes);
  linkDeclIdentElem(identElem, elem);
  return elem;
}

/** Grammar: struct_member : attribute* member_ident ':' type_specifier */
function parseStructMember(ctx: ParsingContext): StructMemberElem | null {
  const { stream } = ctx;
  const checkpoint = stream.checkpoint();
  const attrs = parseAttributeList(ctx);

  const nameToken = stream.matchKind("word");
  if (!nameToken) {
    stream.reset(checkpoint);
    return null;
  }
  const attributes = attrsOrUndef(attrs);

  const start = getStartWithAttributes(attributes, nameToken.span[0]);
  const name = makeNameElem(nameToken);
  expect(stream, ":", "struct member name");

  const typeRef = parseSimpleTypeRef(ctx);
  if (!typeRef) throwParseError(stream, "Expected type after ':'");

  return finishStatement("member", start, ctx, { name, typeRef }, attributes);
}
