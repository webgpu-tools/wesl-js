import type {
  AssignElem,
  AssignOp,
  AttributeElem,
  BreakElem,
  CallElem,
  ContinueElem,
  DecrementElem,
  DiscardElem,
  EmptyElem,
  ExpressionElem,
  IncrementElem,
  PhonyTarget,
  ReturnElem,
  Statement,
} from "../AbstractElems.ts";
import type { Span } from "../Span.ts";
import { beginElem, finishContents, finishElem } from "./ContentsHelpers.ts";
import { parseExpression } from "./ParseExpression.ts";
import { getStartWithAttributes } from "./ParseStatement.ts";
import {
  attachAttributes,
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
): Statement | null {
  const { stream } = ctx;
  const startPos = getStartWithAttributes(attributes, stream.checkpoint());

  return (
    parseReturnStmt(ctx, startPos, attributes) ||
    parseBreakStmt(ctx, startPos, attributes) ||
    parseContinueStmt(ctx, startPos, attributes) ||
    parseDiscardStmt(ctx, startPos, attributes) ||
    parseEmptyStmt(stream, startPos) ||
    parsePhonyAssignment(ctx, startPos, attributes) ||
    parseExpressionStmt(ctx, startPos, attributes)
  );
}

/** Match an assignment operator, capturing its value and span. */
export function parseAssignmentOp(stream: WeslStream): AssignOp | null {
  const token = stream.nextIf(({ text }) => assignmentOps.has(text));
  if (!token) return null;
  return { value: token.text as AssignOp["value"], span: token.span };
}

/** Match '++' or '--', returning its text and span (or null if absent). */
export function parseIncDecOp(
  stream: WeslStream,
): { op: "++" | "--"; span: Span } | null {
  const token = stream.nextIf(({ text }) => text === "++" || text === "--");
  if (!token) return null;
  return { op: token.text as "++" | "--", span: token.span };
}

/** Grammar: ( '=' | compound_assignment_operator ) expression. Returns op + rhs. */
export function parseAssignmentRhs(
  ctx: ParsingContext,
): { op: AssignOp; rhs: ExpressionElem } | null {
  const op = parseAssignmentOp(ctx.stream);
  if (!op) return null;
  const rhs = expectExpression(
    ctx,
    "Expected expression after assignment operator",
  );
  return { op, rhs };
}

/** Grammar: return_statement : 'return' expression? ';' */
function parseReturnStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): ReturnElem | null {
  const { stream } = ctx;
  if (!stream.matchText("return")) return null;
  beginElem(ctx, "return", attributes);
  const value = parseContentExpression(ctx) ?? undefined;
  expect(stream, ";", "return statement");
  const elem = finishElem("return", startPos, ctx, { value });
  attachAttributes(elem, attributes);
  return elem;
}

/**
 * Grammar: break_statement : 'break' ';'
 * Grammar: break_if_statement : 'break' 'if' expression ';'
 */
function parseBreakStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): BreakElem | null {
  const { stream } = ctx;
  if (!stream.matchText("break")) return null;
  beginElem(ctx, "break", attributes);
  let condition: ExpressionElem | undefined;
  if (stream.matchText("if")) {
    condition = expectExpression(ctx, "Expected condition after 'break if'");
  }
  expect(stream, ";", "break statement");
  const elem = finishElem("break", startPos, ctx, { condition });
  attachAttributes(elem, attributes);
  return elem;
}

/** Grammar: continue_statement : 'continue' ';' */
function parseContinueStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): ContinueElem | null {
  const { stream } = ctx;
  if (!stream.matchText("continue")) return null;
  beginElem(ctx, "continue", attributes);
  expect(stream, ";", "continue statement");
  const elem = finishElem("continue", startPos, ctx, {});
  attachAttributes(elem, attributes);
  return elem;
}

/** Grammar: 'discard' ';' */
function parseDiscardStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): DiscardElem | null {
  const { stream } = ctx;
  if (!stream.matchText("discard")) return null;
  beginElem(ctx, "discard", attributes);
  expect(stream, ";", "discard statement");
  const elem = finishElem("discard", startPos, ctx, {});
  attachAttributes(elem, attributes);
  return elem;
}

/** Parse empty statement (just ';'). Spans the ';' so it emits no extra text. */
function parseEmptyStmt(stream: WeslStream, start: number): EmptyElem | null {
  if (!stream.matchText(";")) return null;
  const end = stream.checkpoint();
  return { kind: "empty", start, end, contents: [] };
}

/** Grammar: assignment_statement : '_' '=' expression ';' (phony assignment) */
function parsePhonyAssignment(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): AssignElem | null {
  const { stream } = ctx;
  const underscore = stream.matchText("_");
  if (!underscore) return null;
  const lhs: PhonyTarget = { kind: "phony", span: underscore.span };
  const op = parseAssignmentOp(stream);
  if (!op) throwParseError(stream, "Expected assignment operator after '_'");
  beginElem(ctx, "assign", attributes);
  const rhs = expectExpression(
    ctx,
    "Expected expression after assignment operator",
  );
  expect(stream, ";", "assignment");
  const elem = finishElem("assign", startPos, ctx, { lhs, op, rhs });
  attachAttributes(elem, attributes);
  return elem;
}

/**
 * Parses expression statements: assignments, increments/decrements, or function calls.
 * Grammar: ( assignment_statement | increment_statement | decrement_statement | call_phrase ) ';'
 */
function parseExpressionStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): AssignElem | IncrementElem | DecrementElem | CallElem | null {
  const { stream } = ctx;
  beginElem(ctx, "assign", attributes);
  const expr = parseExpression(ctx);
  if (!expr) {
    finishContents(ctx, startPos, startPos);
    stream.reset(startPos);
    return null;
  }
  ctx.addElem(expr);

  const incDec = parseIncDecOp(stream);
  if (incDec) {
    expect(stream, ";", "expression");
    const kind = incDec.op === "++" ? "increment" : "decrement";
    const elem = finishElem(kind, startPos, ctx, { target: expr });
    attachAttributes(elem, attributes);
    return elem;
  }

  const assign = parseAssignmentRhs(ctx);
  expect(stream, ";", "expression");
  if (assign) {
    const elem = finishElem("assign", startPos, ctx, {
      lhs: expr,
      op: assign.op,
      rhs: assign.rhs,
    });
    attachAttributes(elem, attributes);
    return elem;
  }

  if (expr.kind !== "call-expression") {
    throwParseError(stream, "Expected call, assignment, or increment");
  }
  const elem = finishElem("call", startPos, ctx, { call: expr });
  attachAttributes(elem, attributes);
  return elem;
}
