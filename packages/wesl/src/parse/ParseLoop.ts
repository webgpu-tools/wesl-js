import type {
  AttributeElem,
  ContinuingElem,
  StatementElem,
} from "../AbstractElems.ts";
import { parseLocalVarDecl } from "./ParseLocalVar.ts";
import {
  parseAssignmentRhs,
  parseIncDecOperator,
} from "./ParseSimpleStatement.ts";
import {
  beginStatement,
  expectCompound,
  finishBlockStatement,
} from "./ParseStatement.ts";
import {
  expect,
  expectExpression,
  parseContentExpression,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";

/**
 * Grammar: for_statement : attribute* 'for' '(' for_header ')' compound_statement
 * Grammar: for_header : for_init? ';' expression? ';' for_update?
 */
export function parseForStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): StatementElem | null {
  const { stream } = ctx;
  const startPos = beginStatement(ctx, "for", attributes);
  if (startPos === null) return null;

  ctx.pushScope();
  expect(stream, "(", "'for'");

  parseForInit(ctx);
  parseContentExpression(ctx); // null if empty condition
  expect(stream, ";", "for loop condition");
  parseForUpdate(ctx);
  expect(stream, ")", "for loop header");

  const body = expectCompound(ctx, "Expected '{' after for loop header");
  ctx.addElem(body);
  ctx.popScope();

  return finishBlockStatement(startPos, ctx, attributes);
}

/** Grammar: while_statement : attribute* 'while' expression compound_statement */
export function parseWhileStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): StatementElem | null {
  const startPos = beginStatement(ctx, "while", attributes);
  if (startPos === null) return null;

  expectExpression(ctx, "Expected condition expression after 'while'");

  const body = expectCompound(ctx, "Expected '{' after while condition");
  ctx.addElem(body);

  return finishBlockStatement(startPos, ctx, attributes);
}

/** Grammar: loop_statement : attribute* 'loop' attribute* '{' statement* continuing_statement? '}' */
export function parseLoopStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): StatementElem | null {
  const startPos = beginStatement(ctx, "loop", attributes);
  if (startPos === null) return null;

  const body = expectCompound(ctx, "Expected '{' after 'loop'", true);
  ctx.addElem(body);

  return finishBlockStatement(startPos, ctx, attributes);
}

/** Grammar: continuing_statement : 'continuing' continuing_compound_statement */
export function parseContinuingStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): ContinuingElem | null {
  const startPos = beginStatement(ctx, "continuing", attributes, "continuing");
  if (startPos === null) return null;

  const body = expectCompound(ctx, "Expected '{' after 'continuing'");
  ctx.addElem(body);

  return finishBlockStatement(startPos, ctx, attributes, "continuing");
}

/** Grammar: for_init? ';'
 *           for_init : variable_or_value_statement | variable_updating_statement | func_call_statement
 */
function parseForInit(ctx: ParsingContext): void {
  const { stream } = ctx;
  const varDecl = parseLocalVarDecl(ctx);
  if (varDecl) {
    ctx.addElem(varDecl);
    // parseLocalVarDecl already consumed the ';'
  } else {
    parseContentExpression(ctx); // null for empty case
    expect(stream, ";", "for loop init");
  }
}

/** Grammar: for_update : variable_updating_statement | func_call_statement
 *           variable_updating_statement : assignment_statement | increment_statement | decrement_statement */
function parseForUpdate(ctx: ParsingContext): void {
  parseContentExpression(ctx);
  if (!parseIncDecOperator(ctx.stream)) parseAssignmentRhs(ctx);
}
