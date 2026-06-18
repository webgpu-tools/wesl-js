import type { AttributeElem, StatementElem } from "../AbstractElems.ts";
import { beginElem, finishContents } from "./ContentsHelpers.ts";
import { parseExpression } from "./ParseExpression.ts";
import {
  finishBlockStatement,
  getStartWithAttributes,
} from "./ParseStatement.ts";
import {
  expect,
  expectExpression,
  parseContentExpression,
  throwParseError,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";
import type { WeslStream } from "./WeslStream.ts";

const assignmentOps = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<=",
  ">>=",
]);

/**
 * Grammar: return_statement : 'return' expression?
 * Grammar: break_statement : 'break' | 'break' 'if' expression
 * Grammar: continue_statement : 'continue'
 * Grammar: variable_updating_statement : assignment_statement | increment_statement | decrement_statement
 * Grammar: func_call_statement : call_phrase
 */
export function parseSimpleStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): StatementElem | null {
  const { stream } = ctx;
  const startPos = getStartWithAttributes(attributes, stream.checkpoint());

  return (
    parseReturnStmt(ctx, startPos, attributes) ||
    parseBreakStmt(ctx, startPos, attributes) ||
    parseKeywordStmt(ctx, startPos, attributes, "continue") ||
    parseKeywordStmt(ctx, startPos, attributes, "discard") ||
    parseEmptyStmt(stream, startPos) ||
    parsePhonyAssignment(ctx, startPos, attributes) ||
    parseExpressionStmt(ctx, startPos, attributes)
  );
}

/** Grammar: assignment_statement : lhs_expression ( '=' | compound_assignment_operator ) expression */
export function parseAssignmentOperator(stream: WeslStream): boolean {
  return !!stream.nextIf(({ text }) => assignmentOps.has(text));
}

/** Grammar: ( '=' | compound_assignment_operator ) expression (rhs of assignment_statement) */
export function parseAssignmentRhs(ctx: ParsingContext): boolean {
  if (!parseAssignmentOperator(ctx.stream)) return false;
  expectExpression(ctx, "Expected expression after assignment operator");
  return true;
}

/** Grammar: increment_statement : lhs_expression '++' ; decrement_statement : lhs_expression '--' */
export function parseIncDecOperator(stream: WeslStream): boolean {
  return !!stream.nextIf(({ text }) => text === "++" || text === "--");
}

/** Grammar: return_statement : 'return' expression? ';' */
function parseReturnStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): StatementElem | null {
  const { stream } = ctx;
  if (!stream.matchText("return")) return null;
  beginElem(ctx, "statement", attributes);
  parseContentExpression(ctx); // null for bare 'return;'
  expect(stream, ";", "return statement");
  return finishBlockStatement(startPos, ctx, attributes);
}

/**
 * Grammar: break_statement : 'break' ';'
 * Grammar: break_if_statement : 'break' 'if' expression ';'
 */
function parseBreakStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): StatementElem | null {
  const { stream } = ctx;
  if (!stream.matchText("break")) return null;
  beginElem(ctx, "statement", attributes);
  if (stream.matchText("if")) {
    expectExpression(ctx, "Expected condition after 'break if'");
  }
  expect(stream, ";", "break statement");
  return finishBlockStatement(startPos, ctx, attributes);
}

/** Grammar: continue_statement : 'continue' ';' also handles 'discard' */
function parseKeywordStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes: AttributeElem[] | undefined,
  keyword: string,
): StatementElem | null {
  const { stream } = ctx;
  if (!stream.matchText(keyword)) return null;
  beginElem(ctx, "statement", attributes);
  expect(stream, ";", `${keyword} statement`);
  return finishBlockStatement(startPos, ctx, attributes);
}

/** Parse empty statement (just ';'). */
function parseEmptyStmt(
  stream: WeslStream,
  start: number,
): StatementElem | null {
  if (!stream.matchText(";")) return null;
  const end = stream.checkpoint();
  return { kind: "statement", start, end, contents: [] };
}

/** Grammar: assignment_statement : '_' '=' expression ';' (phony assignment) */
function parsePhonyAssignment(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): StatementElem | null {
  const { stream } = ctx;
  if (!stream.matchText("_")) return null;
  if (!parseAssignmentOperator(stream))
    throwParseError(stream, "Expected assignment operator after '_'");
  beginElem(ctx, "statement", attributes);
  expectExpression(ctx, "Expected expression after assignment operator");
  expect(stream, ";", "assignment");
  return finishBlockStatement(startPos, ctx, attributes);
}

/**
 * Parses expression statements: assignments, increments/decrements, or function calls.
 * Grammar: ( assignment_statement | increment_statement | decrement_statement | call_phrase ) ';'
 */
function parseExpressionStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): StatementElem | null {
  const { stream } = ctx;
  beginElem(ctx, "statement", attributes);
  const expr = parseExpression(ctx);
  if (!expr) {
    finishContents(ctx, startPos, startPos);
    stream.reset(startPos);
    return null;
  }
  ctx.addElem(expr);

  if (!parseIncDecOperator(stream)) parseAssignmentRhs(ctx);
  expect(stream, ";", "expression");
  return finishBlockStatement(startPos, ctx, attributes);
}
