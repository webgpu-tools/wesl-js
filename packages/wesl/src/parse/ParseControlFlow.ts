import type {
  AttributeElem,
  BlockElem,
  ExpressionElem,
  IfElem,
  SwitchClauseElem,
  SwitchElem,
} from "../AbstractElems.ts";
import { beginElem, finishElem } from "./ContentsHelpers.ts";
import { parseAttributeList } from "./ParseAttribute.ts";
import {
  beginStatement,
  expectCompound,
  parseCompoundStatement,
} from "./ParseStatement.ts";
import {
  attachAttributes,
  expect,
  expectExpression,
  throwParseError,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";

/**
 * Grammar: if_statement : attribute* if_clause else_if_clause* else_clause?
 * Grammar: if_clause : 'if' expression compound_statement
 */
export function parseIfStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): IfElem | null {
  const startPos = beginStatement(ctx, "if", "if", attributes);
  if (startPos === null) return null;

  const condition = expectExpression(ctx, "Expected condition after 'if'");
  const body = expectCompound(ctx, "Expected '{' after if condition");
  ctx.addElem(body);
  const elseBranch = parseElseChain(ctx);

  const elem = finishElem("if", startPos, ctx, {
    condition,
    body,
    else: elseBranch,
  });
  attachAttributes(elem, attributes);
  return elem;
}

/** Grammar: switch_statement : attribute* 'switch' expression switch_body */
export function parseSwitchStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): SwitchElem | null {
  const startPos = beginStatement(ctx, "switch", "switch", attributes);
  if (startPos === null) return null;

  const selector = expectExpression(ctx, "Expected expression after 'switch'");
  const clauses = expectSwitchClauses(ctx);

  const elem = finishElem("switch", startPos, ctx, { selector, clauses });
  attachAttributes(elem, attributes);
  return elem;
}

/**
 * Grammar: else_if_clause : 'else' 'if' expression compound_statement
 * Grammar: else_clause : 'else' compound_statement
 *
 * The typed result nests (an else-if is an IfElem in the outer if's `else`),
 * but each clause body is still registered in the enclosing if's `contents`
 * (flat, as before) so emit walks them unchanged. Nested IfElems carry their
 * structure in fields only, with empty `contents`.
 */
function parseElseChain(ctx: ParsingContext): IfElem | BlockElem | undefined {
  const { stream } = ctx;
  const elseStart = stream.checkpoint();
  if (!stream.matchText("else")) return undefined;

  if (stream.matchText("if")) {
    const condition = expectExpression(
      ctx,
      "Expected expression after 'else if'",
    );
    const body = expectCompound(ctx, "Expected '{' after else if");
    ctx.addElem(body);
    const elseBranch = parseElseChain(ctx);
    const end = stream.checkpoint();
    return {
      kind: "if",
      condition,
      body,
      else: elseBranch,
      start: elseStart,
      end,
      contents: [],
    };
  }

  const body = expectCompound(ctx, "Expected '{' after else");
  ctx.addElem(body);
  return body;
}

/**
 * Grammar: switch_body : attribute* '{' switch_clause+ '}'
 * Grammar: switch_clause : case_clause | default_alone_clause
 * Grammar: case_clause : 'case' case_selectors ':'? compound_statement
 * Grammar: default_alone_clause : 'default' ':'? compound_statement
 */
function expectSwitchClauses(ctx: ParsingContext): SwitchClauseElem[] {
  const { stream } = ctx;
  parseAttributeList(ctx);
  expect(stream, "{", "switch expression");
  const clauses: SwitchClauseElem[] = [];
  while (!stream.matchText("}")) {
    const clauseStart = stream.checkpoint();
    const clauseAttrs = parseAttributeList(ctx);
    beginElem(
      ctx,
      "switch-clause",
      clauseAttrs.length ? clauseAttrs : undefined,
    );

    let selectors: (ExpressionElem | "default")[];
    let body: BlockElem;
    if (stream.matchText("case")) {
      selectors = parseCaseSelectors(ctx);
      body = parseCaseBody(ctx, "Expected '{' after case value");
    } else if (stream.matchText("default")) {
      selectors = ["default"];
      body = parseCaseBody(ctx, "Expected '{' after 'default'");
    } else {
      throwParseError(stream, "Expected 'case', 'default', or '}' in switch");
    }

    const clauseElem = finishElem("switch-clause", clauseStart, ctx, {
      selectors,
      body,
    });
    attachAttributes(clauseElem, clauseAttrs.length ? clauseAttrs : undefined);
    ctx.addElem(clauseElem);
    clauses.push(clauseElem);
  }
  return clauses;
}

/** Grammar: case_selectors : case_selector (',' case_selector)* ','? */
function parseCaseSelectors(
  ctx: ParsingContext,
): (ExpressionElem | "default")[] {
  const { stream } = ctx;
  const selectors = [expectExpression(ctx, "Expected expression after 'case'")];
  while (stream.matchText(",")) {
    selectors.push(
      expectExpression(ctx, "Expected expression after ',' in case values"),
    );
  }
  return selectors;
}

/**
 * Grammar: case_clause : 'case' case_selectors ':'? compound_statement
 * Grammar: default_alone_clause : 'default' ':'? compound_statement
 */
function parseCaseBody(ctx: ParsingContext, errorMsg: string): BlockElem {
  ctx.stream.matchText(":");

  const bodyAttrs = parseAttributeList(ctx);
  const attrs = bodyAttrs.length > 0 ? bodyAttrs : undefined;

  const body = parseCompoundStatement(ctx, attrs);
  if (!body) throwParseError(ctx.stream, errorMsg);
  ctx.addElem(body);
  return body;
}
