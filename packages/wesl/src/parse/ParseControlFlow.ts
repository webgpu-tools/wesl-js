import type {
  AttributeElem,
  BlockElem,
  ExpressionElem,
  IfElem,
  SwitchClauseElem,
  SwitchElem,
} from "../AbstractElems.ts";
import { parseAttributeList } from "./ParseAttribute.ts";
import {
  beginStatement,
  expectCompound,
  finishStatement,
  getStartWithAttributes,
  parseCompoundStatement,
} from "./ParseStatement.ts";
import {
  attrsOrUndef,
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
  const startPos = beginStatement(ctx, "if", attributes);
  if (startPos === null) return null;

  const condition = expectExpression(ctx, "Expected condition after 'if'");
  const body = expectCompound(ctx, "Expected '{' after if condition");
  const elseBranch = parseElseChain(ctx);

  const params = { condition, body, else: elseBranch };
  return finishStatement("if", startPos, ctx, params, attributes);
}

/** Grammar: switch_statement : attribute* 'switch' expression switch_body */
export function parseSwitchStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): SwitchElem | null {
  const startPos = beginStatement(ctx, "switch", attributes);
  if (startPos === null) return null;

  const selector = expectExpression(ctx, "Expected expression after 'switch'");
  const { bodyAttributes, clauses } = expectSwitchClauses(ctx);

  const params = { selector, clauses, bodyAttributes };
  return finishStatement("switch", startPos, ctx, params, attributes);
}

/**
 * Grammar: else_if_clause : 'else' 'if' expression compound_statement
 * Grammar: else_clause : 'else' compound_statement
 *
 * An else-if nests as an IfElem in the outer if's `else` field; a plain else is
 * a BlockElem. Emit and the AST dump read these typed fields.
 */
function parseElseChain(ctx: ParsingContext): IfElem | BlockElem | undefined {
  const { stream } = ctx;
  const elseToken = stream.matchText("else");
  if (!elseToken) return undefined;

  if (stream.matchText("if")) {
    const condition = expectExpression(
      ctx,
      "Expected expression after 'else if'",
    );
    const body = expectCompound(ctx, "Expected '{' after else if");
    const elseBranch = parseElseChain(ctx);
    const end = stream.checkpoint();
    // Start at the 'else' keyword, not the pre-keyword position, so a comment
    // before 'else if' falls in the gap and leads the branch (matches
    // beginStatement); otherwise the nested if swallows it.
    return {
      kind: "if",
      condition,
      body,
      else: elseBranch,
      start: elseToken.span[0],
      end,
    };
  }

  return expectCompound(ctx, "Expected '{' after else");
}

/**
 * Grammar: switch_body : attribute* '{' switch_clause+ '}'
 * Grammar: switch_clause : case_clause | default_alone_clause
 * Grammar: case_clause : 'case' case_selectors ':'? compound_statement
 * Grammar: default_alone_clause : 'default' ':'? compound_statement
 */
function expectSwitchClauses(ctx: ParsingContext): {
  bodyAttributes?: AttributeElem[];
  clauses: SwitchClauseElem[];
} {
  const { stream } = ctx;
  const bodyAttrs = parseAttributeList(ctx);
  expect(stream, "{", "switch expression");
  const clauses: SwitchClauseElem[] = [];
  while (!stream.matchText("}")) {
    clauses.push(parseSwitchClause(ctx));
  }
  return { bodyAttributes: attrsOrUndef(bodyAttrs), clauses };
}

/** Parse one 'case'/'default' clause (the keyword has not yet been consumed). */
function parseSwitchClause(ctx: ParsingContext): SwitchClauseElem {
  const { stream } = ctx;
  const attrs = attrsOrUndef(parseAttributeList(ctx));

  const caseTok = stream.matchText("case");
  const keyword = caseTok ?? stream.matchText("default");
  if (!keyword) {
    throwParseError(stream, "Expected 'case', 'default', or '}' in switch");
  }
  // The clause start is the keyword token, not any leading comment, so a
  // preceding comment falls in the gap before it and attaches as leading.
  const clauseStart = getStartWithAttributes(attrs, keyword.span[0]);

  let selectors: (ExpressionElem | "default")[];
  let body: BlockElem;
  if (caseTok) {
    selectors = parseCaseSelectors(ctx);
    body = parseCaseBody(ctx, "Expected '{' after case value");
  } else {
    selectors = ["default"];
    body = parseCaseBody(ctx, "Expected '{' after 'default'");
  }

  return finishStatement(
    "switch-clause",
    clauseStart,
    ctx,
    { selectors, body },
    attrs,
  );
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

  const attrs = attrsOrUndef(parseAttributeList(ctx));
  const body = parseCompoundStatement(ctx, attrs);
  if (!body) throwParseError(ctx.stream, errorMsg);
  return body;
}
