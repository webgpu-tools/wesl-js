import type {
  AttributeElem,
  ContinuingElem,
  ExpressionElem,
  ForElem,
  ForInit,
  ForUpdate,
  LoopElem,
  WhileElem,
} from "../AbstractElems.ts";
import { parseLocalVarDecl } from "./ParseLocalVar.ts";
import { parseAssignmentRhs, parseIncDecOp } from "./ParseSimpleStatement.ts";
import {
  beginStatement,
  expectCompound,
  finishStatement,
} from "./ParseStatement.ts";
import {
  expect,
  expectExpression,
  parseContentExpression,
  throwParseError,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";

/**
 * Grammar: for_statement : attribute* 'for' '(' for_header ')' compound_statement
 * Grammar: for_header : for_init? ';' expression? ';' for_update?
 */
export function parseForStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): ForElem | null {
  const { stream } = ctx;
  const startPos = beginStatement(ctx, "for", attributes);
  if (startPos === null) return null;

  ctx.pushScope();
  expect(stream, "(", "'for'");

  const init = parseForInit(ctx);
  const condition = parseContentExpression(ctx) ?? undefined;
  expect(stream, ";", "for loop condition");
  const update = parseForUpdate(ctx);
  expect(stream, ")", "for loop header");

  const body = expectCompound(ctx, "Expected '{' after for loop header");
  ctx.popScope();

  const params = { init, condition, update, body };
  return finishStatement("for", startPos, ctx, params, attributes);
}

/** Grammar: while_statement : attribute* 'while' expression compound_statement */
export function parseWhileStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): WhileElem | null {
  const startPos = beginStatement(ctx, "while", attributes);
  if (startPos === null) return null;

  const condition = expectExpression(ctx, "Expected condition after 'while'");
  const body = expectCompound(ctx, "Expected '{' after while condition");

  const params = { condition, body };
  return finishStatement("while", startPos, ctx, params, attributes);
}

/** Grammar: loop_statement : attribute* 'loop' attribute* '{' statement* continuing_statement? '}' */
export function parseLoopStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): LoopElem | null {
  const startPos = beginStatement(ctx, "loop", attributes);
  if (startPos === null) return null;

  const body = expectCompound(ctx, "Expected '{' after 'loop'", true);
  const continuing = body.body.find(
    (s): s is ContinuingElem => s.kind === "continuing",
  );

  const params = { body, continuing };
  return finishStatement("loop", startPos, ctx, params, attributes);
}

/** Grammar: continuing_statement : 'continuing' continuing_compound_statement */
export function parseContinuingStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): ContinuingElem | null {
  const startPos = beginStatement(ctx, "continuing", attributes);
  if (startPos === null) return null;

  const body = expectCompound(ctx, "Expected '{' after 'continuing'");
  const breakIf = body.body.find(s => s.kind === "break")?.condition;

  const params = { body, breakIf };
  return finishStatement("continuing", startPos, ctx, params, attributes);
}

/** Grammar: for_init? ';'
 *           for_init : variable_or_value_statement | variable_updating_statement | func_call_statement
 */
function parseForInit(ctx: ParsingContext): ForInit | undefined {
  const { stream } = ctx;
  const varDecl = parseLocalVarDecl(ctx);
  if (varDecl) {
    return varDecl; // parseLocalVarDecl already consumed the ';'
  }
  const expr = parseContentExpression(ctx); // null for empty case
  const update = expr ? finishForUpdate(ctx, expr) : undefined;
  expect(stream, ";", "for loop init");
  return update;
}

/** Grammar: for_update : variable_updating_statement | func_call_statement */
function parseForUpdate(ctx: ParsingContext): ForUpdate | undefined {
  const expr = parseContentExpression(ctx);
  if (!expr) return undefined;
  return finishForUpdate(ctx, expr);
}

/**
 * Build a typed for-init/for-update node from an already-parsed lhs expression,
 * consuming its trailing operator (++/-- or an assignment + rhs).
 */
function finishForUpdate(ctx: ParsingContext, expr: ExpressionElem): ForUpdate {
  const { stream } = ctx;
  const start = expr.start;
  const incDec = parseIncDecOp(stream);
  if (incDec) {
    const end = stream.checkpoint();
    if (incDec.op === "++")
      return { kind: "increment", target: expr, start, end };
    return { kind: "decrement", target: expr, start, end };
  }
  const assign = parseAssignmentRhs(ctx);
  if (assign) {
    const { op, rhs } = assign;
    const end = stream.checkpoint();
    return { kind: "assign", lhs: expr, op, rhs, start, end };
  }
  if (expr.kind === "call-expression") {
    return { kind: "call", call: expr, start, end: stream.checkpoint() };
  }
  // A bare expression (no ++/--/assignment, not a call) is not a valid for
  // init/update clause; reject it rather than silently dropping it.
  throwParseError(
    stream,
    "Expected an assignment, increment, decrement, or call in for-clause",
  );
}
