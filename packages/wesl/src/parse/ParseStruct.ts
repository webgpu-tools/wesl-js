import type {
  AttributeElem,
  StructElem,
  StructMemberElem,
} from "../AbstractElems.ts";
import { parseAttributeList } from "./ParseAttribute.ts";
import {
  markAttempt,
  recoverListItem,
  skipToBoundary,
} from "./ParseRecovery.ts";
import { finishStatement, getStartWithAttributes } from "./ParseStatement.ts";
import { parseSimpleTypeRef } from "./ParseType.ts";
import {
  attrsOrUndef,
  createDeclIdentElem,
  expect,
  expectWord,
  linkDeclIdentElem,
  makeNameElem,
  throwParseError,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";
import type { WeslToken } from "./WeslStream.ts";

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

  const start = getStartWithAttributes(attributes, structToken.start);
  const nameToken = expectWord(stream, "Expected identifier after 'struct'");

  const identElem = createDeclIdentElem(ctx, nameToken, true);
  ctx.saveIdent(identElem.ident);

  expect(stream, "{", "struct name");

  ctx.pushScope();
  const members = parseStructMembers(ctx);
  identElem.ident.dependentScope = ctx.currentScope();
  ctx.popScope();

  expect(stream, "}", "struct member");

  const params = { name: identElem, members };
  const elem = finishStatement("struct", start, ctx, params, attributes);
  linkDeclIdentElem(identElem, elem);
  return elem;
}

/**
 * Grammar: struct_member ( ',' struct_member )* ','?
 *
 * The struct owns the body's `{`, so a member with a syntax error is recovered
 * here rather than at module level: the member is dropped and the struct keeps
 * its other members.
 */
function parseStructMembers(ctx: ParsingContext): StructMemberElem[] {
  const { stream } = ctx;
  const members: StructMemberElem[] = [];
  while (true) {
    let attempt = markAttempt(ctx);
    try {
      const member = parseStructMember(ctx);
      if (!member) break;
      members.push(member);
      const memberStart = attempt.start;
      attempt = markAttempt(ctx); // the member is kept; don't roll it back
      if (stream.matchText(",")) continue;
      const next = stream.peek();
      if (next === null || next.text === "}") break;
      // missing ',' between members: keep this member, resync at the next
      // (a break here would fail the '}' expect and drop the whole struct).
      // skip from memberStart, not the current position, so the unexpected
      // token itself may be the boundary (e.g. the '@' of the next member)
      ctx.addError("Expected ',' after struct member", next.start, next.end);
      skipToBoundary(stream, memberStart, atMemberBoundary);
      stream.matchText(",");
    } catch (e) {
      recoverListItem(ctx, e, attempt, atMemberBoundary);
      stream.matchText(","); // consume the separator, if that's what we synced on
    }
  }
  return members;
}

/** Grammar: struct_member : attribute* member_ident ':' type_specifier */
function parseStructMember(ctx: ParsingContext): StructMemberElem | null {
  const { stream } = ctx;
  const startPos = stream.position();
  const attrs = parseAttributeList(ctx);

  const nameToken = stream.matchKind("word");
  if (!nameToken) {
    stream.reset(startPos);
    return null;
  }
  const attributes = attrsOrUndef(attrs);

  const start = getStartWithAttributes(attributes, nameToken.start);
  const name = makeNameElem(nameToken);
  expect(stream, ":", "struct member name");

  const typeRef = parseSimpleTypeRef(ctx);
  if (!typeRef) throwParseError(stream, "Expected type after ':'");

  return finishStatement("member", start, ctx, { name, typeRef }, attributes);
}

/** @return true if the token ends a failed member's skip: the `,` before the
 * next member, the `@` starting one, or the struct body's `}`. */
function atMemberBoundary(token: WeslToken, depth: number): boolean {
  if (depth !== 0) return false;
  return token.text === "," || token.text === "}" || token.text === "@";
}
