import type {
  AttributeElem,
  StructElem,
  StructMemberElem,
} from "../AbstractElems.ts";
import { beginElem } from "./ContentsHelpers.ts";
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

  beginElem(ctx, "struct", attributes);
  ctx.addElem(identElem);
  expect(stream, "{", "struct name");

  ctx.pushScope();
  const members = parseStructMembers(ctx);
  identElem.ident.dependentScope = ctx.currentScope();
  ctx.popScope();

  expect(stream, "}", "struct member");

  const elem = finishStatement(
    "struct",
    start,
    ctx,
    { name: identElem, members },
    attributes,
  );
  linkDeclIdentElem(identElem, elem);
  return elem;
}

/** Grammar: struct_body_decl : '{' struct_member (',' struct_member)* ','? '}' */
function parseStructMembers(ctx: ParsingContext): StructMemberElem[] {
  const members = parseCommaList(ctx, parseStructMember);
  for (const member of members) ctx.addElem(member);
  return members;
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
  beginElem(ctx, "member", attributes);
  const name = makeNameElem(nameToken);
  ctx.addElem(name);
  expect(stream, ":", "struct member name");

  const typeRef = parseSimpleTypeRef(ctx);
  if (!typeRef) throwParseError(stream, "Expected type after ':'");
  ctx.addElem(typeRef);

  return finishStatement("member", start, ctx, { name, typeRef }, attributes);
}
