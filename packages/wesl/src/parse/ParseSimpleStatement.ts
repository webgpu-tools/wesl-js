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
import {
  beginStatement,
  finishStatement,
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
 * Grammar: discard_statement : 'discard'
 * Grammar: empty_statement : ';'
 * Grammar: variable_updating_statement : assignment_statement | increment_statement | decrement_statement
 * Grammar: func_call_statement : call_phrase
 */
export function parseSimpleStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): Statement | null {
  // Each form takes its start from its own first token (never the stream
  // position, which sits before any leading comment). Comment attachment is
  // position-keyed: a start before the comment pulls the comment inside the
  // statement, where it re-attaches to the first child - `// c` above
  // `return a;` would emit as `return // c` / `a;`.
  return (
    parseReturnStmt(ctx, attributes) ||
    parseBreakStmt(ctx, attributes) ||
    parseContinueStmt(ctx, attributes) ||
    parseDiscardStmt(ctx, attributes) ||
    parseEmptyStmt(ctx, attributes) ||
    parsePhonyAssignment(ctx, attributes) ||
    parseExpressionStmt(ctx, attributes)
  );
}

/** Match an assignment operator, capturing its value and span. */
export function parseAssignmentOp(stream: WeslStream): AssignOp | null {
  const token = stream.nextIf(({ text }) => assignmentOps.has(text));
  if (!token) return null;
  const value = token.text as AssignOp["value"];
  return { value, span: [token.start, token.end] };
}

/** Match '++' or '--', returning the operator and its span (or null if absent). */
export function parseIncDecOp(
  stream: WeslStream,
): { op: "++" | "--"; span: Span } | null {
  const token = stream.nextIf(({ text }) => text === "++" || text === "--");
  if (!token) return null;
  return { op: token.text as "++" | "--", span: [token.start, token.end] };
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
  attributes?: AttributeElem[],
): ReturnElem | null {
  const { stream } = ctx;
  const startPos = beginStatement(ctx, "return", attributes);
  if (startPos === null) return null;
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
  attributes?: AttributeElem[],
): BreakElem | null {
  const { stream } = ctx;
  const startPos = beginStatement(ctx, "break", attributes);
  if (startPos === null) return null;
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
  attributes?: AttributeElem[],
): ContinueElem | null {
  const { stream } = ctx;
  const startPos = beginStatement(ctx, "continue", attributes);
  if (startPos === null) return null;
  expect(stream, ";", "continue statement");
  return finishStatement("continue", startPos, ctx, {}, attributes);
}

/** Grammar: 'discard' ';' */
function parseDiscardStmt(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): DiscardElem | null {
  const { stream } = ctx;
  const startPos = beginStatement(ctx, "discard", attributes);
  if (startPos === null) return null;
  expect(stream, ";", "discard statement");
  return finishStatement("discard", startPos, ctx, {}, attributes);
}

/** Grammar: empty_statement : ';'. Emits nothing; the span starts at the ';'
 *  (or at its attributes) so a preceding comment stays outside the statement. */
function parseEmptyStmt(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): EmptyElem | null {
  const { stream } = ctx;
  const semi = stream.matchText(";");
  if (!semi) return null;
  const start = getStartWithAttributes(attributes, semi.start);
  // attach attributes so `@if(false) ;` is elided and keeps an
  // @if/@elif/@else sibling chain's state correct
  return finishStatement("empty", start, ctx, {}, attributes);
}

/** Grammar: assignment_statement : '_' '=' expression ';' (phony assignment) */
function parsePhonyAssignment(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): AssignElem | null {
  const { stream } = ctx;
  const underscore = stream.matchText("_");
  if (!underscore) return null;
  const startPos = getStartWithAttributes(attributes, underscore.start);
  const lhs: PhonyTarget = {
    kind: "phony",
    span: [underscore.start, underscore.end],
  };
  // WGSL phony assignment uses only `=`, never a compound operator.
  const eq = stream.matchText("=");
  if (!eq) throwParseError(stream, "Expected '=' after '_'");
  const op: AssignOp = { value: "=", span: [eq.start, eq.end] };
  const rhs = expectExpression(ctx, "Expected expression after '_ ='");
  expect(stream, ";", "assignment");
  return finishStatement("assign", startPos, ctx, { lhs, op, rhs }, attributes);
}

/** Grammar: ( assignment_statement | increment_statement | decrement_statement | call_phrase ) ';' */
function parseExpressionStmt(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): AssignElem | IncrementElem | DecrementElem | CallElem | null {
  const { stream } = ctx;
  const resetPos = stream.position();
  const expr = parseExpression(ctx);
  if (!expr) {
    stream.reset(resetPos);
    return null;
  }
  const startPos = getStartWithAttributes(attributes, expr.start);

  const incDec = parseIncDecOp(stream);
  if (incDec) {
    expect(stream, ";", "expression");
    const kind = incDec.op === "++" ? "increment" : "decrement";
    return finishStatement(kind, startPos, ctx, { target: expr }, attributes);
  }

  const assign = parseAssignmentRhs(ctx);
  if (assign) {
    expect(stream, ";", "expression");
    const params = { lhs: expr, op: assign.op, rhs: assign.rhs };
    return finishStatement("assign", startPos, ctx, params, attributes);
  }

  // reject a bare non-call expression before consuming the ';', so the error
  // points at the token after the expression rather than past the terminator
  if (expr.kind !== "call-expression") {
    throwParseError(stream, "Expected call, assignment, or increment");
  }
  expect(stream, ";", "expression");
  return finishStatement("call", startPos, ctx, { call: expr }, attributes);
}
