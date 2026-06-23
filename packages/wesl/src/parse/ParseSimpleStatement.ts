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
import { parseExpression } from "./ParseExpression.ts";
import { finishStatement, getStartWithAttributes } from "./ParseStatement.ts";
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
  const value = parseContentExpression(ctx) ?? undefined;
  expect(stream, ";", "return statement");
  return finishStatement("return", startPos, ctx, { value }, attributes);
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
  let condition: ExpressionElem | undefined;
  if (stream.matchText("if")) {
    condition = expectExpression(ctx, "Expected condition after 'break if'");
  }
  expect(stream, ";", "break statement");
  return finishStatement("break", startPos, ctx, { condition }, attributes);
}

/** Grammar: continue_statement : 'continue' ';' */
function parseContinueStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): ContinueElem | null {
  const { stream } = ctx;
  if (!stream.matchText("continue")) return null;
  expect(stream, ";", "continue statement");
  return finishStatement("continue", startPos, ctx, {}, attributes);
}

/** Grammar: 'discard' ';' */
function parseDiscardStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): DiscardElem | null {
  const { stream } = ctx;
  if (!stream.matchText("discard")) return null;
  expect(stream, ";", "discard statement");
  return finishStatement("discard", startPos, ctx, {}, attributes);
}

/** Parse empty statement (just ';'). Spans the ';' so it emits no extra text. */
function parseEmptyStmt(stream: WeslStream, start: number): EmptyElem | null {
  if (!stream.matchText(";")) return null;
  const end = stream.checkpoint();
  return { kind: "empty", start, end };
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
  // WGSL phony assignment uses only `=`, never a compound operator.
  const eq = stream.matchText("=");
  if (!eq) throwParseError(stream, "Expected '=' after '_'");
  const op: AssignOp = { value: "=", span: eq.span };
  const rhs = expectExpression(ctx, "Expected expression after '_ ='");
  expect(stream, ";", "assignment");
  return finishStatement("assign", startPos, ctx, { lhs, op, rhs }, attributes);
}

/** Grammar: ( assignment_statement | increment_statement | decrement_statement | call_phrase ) ';' */
function parseExpressionStmt(
  ctx: ParsingContext,
  startPos: number,
  attributes?: AttributeElem[],
): AssignElem | IncrementElem | DecrementElem | CallElem | null {
  const { stream } = ctx;
  const expr = parseExpression(ctx);
  if (!expr) {
    stream.reset(startPos);
    return null;
  }

  const incDec = parseIncDecOp(stream);
  if (incDec) {
    expect(stream, ";", "expression");
    const kind = incDec.op === "++" ? "increment" : "decrement";
    return finishStatement(kind, startPos, ctx, { target: expr }, attributes);
  }

  const assign = parseAssignmentRhs(ctx);
  expect(stream, ";", "expression");
  if (assign) {
    const params = { lhs: expr, op: assign.op, rhs: assign.rhs };
    return finishStatement("assign", startPos, ctx, params, attributes);
  }

  if (expr.kind !== "call-expression") {
    throwParseError(stream, "Expected call, assignment, or increment");
  }
  return finishStatement("call", startPos, ctx, { call: expr }, attributes);
}
