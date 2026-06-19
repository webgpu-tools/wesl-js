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
  const startPos = beginStatement(ctx, "for", "for", attributes);
  if (startPos === null) return null;

  ctx.pushScope();
  expect(stream, "(", "'for'");

  const init = parseForInit(ctx);
  const condition = parseContentExpression(ctx) ?? undefined;
  expect(stream, ";", "for loop condition");
  const update = parseForUpdate(ctx);
  expect(stream, ")", "for loop header");

  const body = expectCompound(ctx, "Expected '{' after for loop header");
  ctx.addElem(body);
  ctx.popScope();

  const params = { init, condition, update, body };
  return finishStatement("for", startPos, ctx, params, attributes);
}

/** Grammar: while_statement : attribute* 'while' expression compound_statement */
export function parseWhileStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): WhileElem | null {
  const startPos = beginStatement(ctx, "while", "while", attributes);
  if (startPos === null) return null;

  const condition = expectExpression(ctx, "Expected condition after 'while'");
  const body = expectCompound(ctx, "Expected '{' after while condition");
  ctx.addElem(body);

  return finishStatement(
    "while",
    startPos,
    ctx,
    { condition, body },
    attributes,
  );
}

/** Grammar: loop_statement : attribute* 'loop' attribute* '{' statement* continuing_statement? '}' */
export function parseLoopStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): LoopElem | null {
  const startPos = beginStatement(ctx, "loop", "loop", attributes);
  if (startPos === null) return null;

  const body = expectCompound(ctx, "Expected '{' after 'loop'", true);
  ctx.addElem(body);
  const continuing = body.body.find(
    (s): s is ContinuingElem => s.kind === "continuing",
  );

  return finishStatement(
    "loop",
    startPos,
    ctx,
    { body, continuing },
    attributes,
  );
}

/** Grammar: continuing_statement : 'continuing' continuing_compound_statement */
export function parseContinuingStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): ContinuingElem | null {
  const startPos = beginStatement(ctx, "continuing", "continuing", attributes);
  if (startPos === null) return null;

  const body = expectCompound(ctx, "Expected '{' after 'continuing'");
  ctx.addElem(body);
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
    ctx.addElem(varDecl);
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
function finishForUpdate(
  ctx: ParsingContext,
  expr: ExpressionElem,
): ForUpdate | undefined {
  const incDec = parseIncDecOp(ctx.stream);
  if (incDec) {
    const kind = incDec.op === "++" ? "increment" : "decrement";
    return makeForNode(ctx, kind, { target: expr });
  }
  const assign = parseAssignmentRhs(ctx);
  if (assign) {
    return makeForNode(ctx, "assign", {
      lhs: expr,
      op: assign.op,
      rhs: assign.rhs,
    });
  }
  if (expr.kind === "call-expression") {
    return makeForNode(ctx, "call", { call: expr });
  }
  return undefined;
}

/**
 * Construct a for-header sub-node (assign/increment/decrement/call) from its
 * already-parsed parts. Emit reads those typed fields, so the node keeps no
 * `contents`.
 */
function makeForNode<K extends "assign" | "increment" | "decrement" | "call">(
  ctx: ParsingContext,
  kind: K,
  params: object,
): Extract<ForUpdate, { kind: K }> {
  const start = ctx.stream.checkpoint();
  const node = { kind, ...params, start, end: start };
  return node as unknown as Extract<ForUpdate, { kind: K }>;
}
