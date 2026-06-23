import type {
  AttributeElem,
  BlockElem,
  ElemKindMap,
  HasAttributes,
  Statement,
} from "../AbstractElems.ts";
import { findMap } from "../Util.ts";
import { parseAttributeList } from "./ParseAttribute.ts";
import { parseIfStatement, parseSwitchStatement } from "./ParseControlFlow.ts";
import { parseConstAssert } from "./ParseGlobalVar.ts";
import { parseLetDecl, parseLocalVarDecl } from "./ParseLocalVar.ts";
import {
  parseContinuingStatement,
  parseForStatement,
  parseLoopStatement,
  parseWhileStatement,
} from "./ParseLoop.ts";
import { parseSimpleStatement } from "./ParseSimpleStatement.ts";
import {
  attachAttributes,
  attrsOrUndef,
  conditionalAttribute,
  expect,
  hasConditionalAttribute,
  throwParseError,
} from "./ParseUtil.ts";
import { parseConstDecl } from "./ParseValueDeclaration.ts";
import type { ParsingContext } from "./ParsingContext.ts";

interface CompoundOptions {
  loopBody?: boolean;
  noScope?: boolean; // for function bodies (scope shared with params)
}

// Experimental: declarations in conditional blocks visible in outer scope.
// e.g. @if(X) { let y = 1; } makes y visible outside the block.
// see https://github.com/webgpu-tools/wesl-spec/issues/158
const conditionalBlockFeature = true;

/** Function bodies share scope with parameters (per WGSL spec). */
export function parseFunctionBody(ctx: ParsingContext): BlockElem | null {
  return parseCompoundStatement(ctx, undefined, { noScope: true });
}

/**
 * Grammar: '{' statement* '}' (attributes parsed by caller)
 * For loop bodies: '{' statement* continuing_statement? '}'
 */
export function parseCompoundStatement(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
  options?: CompoundOptions,
): BlockElem | null {
  const brace = ctx.stream.matchText("{");
  if (!brace) return null;

  const startPos = getStartWithAttributes(attributes, brace.span[0]);

  const skipScope =
    options?.noScope ||
    (conditionalBlockFeature && hasConditionalAttr(attributes));
  if (!skipScope) ctx.pushScope();
  const body = parseBlockStatements(ctx, options?.loopBody);
  if (!skipScope) ctx.popScope();

  return finishStatement("block", startPos, ctx, { body }, attributes);
}

/** Grammar: attribute* compound_statement (for control flow bodies) */
export function expectCompound(
  ctx: ParsingContext,
  errorMsg: string,
  loopBody?: boolean,
): BlockElem {
  const attrs = parseAttributeList(ctx);
  const options = loopBody ? { loopBody } : undefined;
  const block = parseCompoundStatement(ctx, attrsOrUndef(attrs), options);
  if (!block) throwParseError(ctx.stream, errorMsg);
  return block;
}

/** Get start position from first attribute, or keyword position. */
export function getStartWithAttributes(
  attributes: AttributeElem[] | undefined,
  keywordPos: number,
): number {
  return attributes?.[0]?.start ?? keywordPos;
}

/** Match keyword and return the statement's start position (or null if no match). */
export function beginStatement(
  ctx: ParsingContext,
  keyword: string,
  attributes?: AttributeElem[],
): number | null {
  const token = ctx.stream.matchText(keyword);
  if (!token) return null;
  // Start at the keyword token, not any leading comment, so a preceding comment
  // falls in the gap before the statement and attaches as leading.
  return getStartWithAttributes(attributes, token.span[0]);
}

/** Build a statement element from its typed fields and attach its attributes. */
export function finishStatement<K extends keyof ElemKindMap>(
  kind: K,
  start: number,
  ctx: ParsingContext,
  params: Omit<ElemKindMap[K], "kind" | "start" | "end">,
  attributes?: AttributeElem[],
): ElemKindMap[K] {
  const end = ctx.stream.checkpoint();
  const elem = { kind, start, end, ...params } as ElemKindMap[K];
  attachAttributes(elem as HasAttributes, attributes);
  return elem;
}

function hasConditionalAttr(attributes?: AttributeElem[]): boolean {
  return !!attributes && hasConditionalAttribute(attributes);
}

/** Grammar: statement* '}' (after '{' consumed). Loop bodies may end with continuing. */
function parseBlockStatements(
  ctx: ParsingContext,
  loopBody?: boolean,
): Statement[] {
  const { stream } = ctx;
  const body: Statement[] = [];
  while (true) {
    if (stream.matchText("}")) break;
    const stmt = parseStatement(ctx);
    if (!stmt) throwParseError(stream, "Expected statement or '}'");
    body.push(stmt);
    if (loopBody && stmt.kind === "continuing") {
      expect(stream, "}", "continuing block");
      break;
    }
  }
  return body;
}

/**
 * Grammar: statement :
 *   ';' | return_statement ';' | if_statement | switch_statement | loop_statement
 *   | for_statement | while_statement | func_call_statement ';'
 *   | variable_or_value_statement ';' | break_statement ';' | continue_statement ';'
 *   | 'discard' ';' | variable_updating_statement ';' | compound_statement
 *   | const_assert_statement ';'
 */
function parseStatement(ctx: ParsingContext): Statement | null {
  const { stream } = ctx;
  const startPos = stream.checkpoint();
  const attributes = parseAttributeList(ctx);

  const token = stream.peek();
  if (!token || token.text === "}") {
    stream.reset(startPos);
    return null;
  }

  const hasConditional =
    attributes.length > 0 && hasConditionalAttribute(attributes);
  if (hasConditional) ctx.pushScope("partial");

  const parsers = [
    parseLocalVarDecl,
    parseLetDecl,
    parseConstDecl,
    parseConstAssert,
    parseCompoundStatement,
    parseIfStatement,
    parseSwitchStatement,
    parseForStatement,
    parseWhileStatement,
    parseLoopStatement,
    parseContinuingStatement,
    parseSimpleStatement,
  ];
  const stmt = findMap(parsers, p => p(ctx, attrsOrUndef(attributes)));

  // Always pop the partial scope we pushed, even on the no-match path, so the
  // scope stack stays balanced; only a matched statement gets the condition.
  if (hasConditional) {
    const partialScope = ctx.popScope();
    if (stmt) partialScope.condAttribute = conditionalAttribute(attributes);
  }
  return stmt ? (stmt as Statement) : null;
}
