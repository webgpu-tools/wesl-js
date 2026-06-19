import type {
  AttributeElem,
  BlockElem,
  ElemKindMap,
  ElifAttribute,
  ElseAttribute,
  HasAttributes,
  IfAttribute,
  OpenElemKind,
  Statement,
} from "../AbstractElems.ts";
import { findMap } from "../Util.ts";
import {
  attachComments,
  beginElem,
  discardOpenElem,
} from "./ContentsHelpers.ts";
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
  expect,
  hasConditionalAttribute,
  isConditionalAttribute,
  throwParseError,
} from "./ParseUtil.ts";
import { parseConstDecl } from "./ParseValueDeclaration.ts";
import type { ParsingContext } from "./ParsingContext.ts";

type CondAttr = IfAttribute | ElifAttribute | ElseAttribute;

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
  beginElem(ctx, "block", attributes);

  const skipScope =
    options?.noScope ||
    (conditionalBlockFeature && hasConditionalAttr(attributes));
  if (!skipScope) ctx.pushScope();
  const { body, closePos } = parseBlockStatements(ctx, options?.loopBody);
  if (!skipScope) ctx.popScope();

  const block = finishStatement("block", startPos, ctx, { body }, attributes);
  attachComments(ctx, body, closePos, block);
  return block;
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

/** Match keyword and begin a statement element of `kind`. Returns start position or null. */
export function beginStatement(
  ctx: ParsingContext,
  keyword: string,
  kind: OpenElemKind,
  attributes?: AttributeElem[],
): number | null {
  const keywordPos = ctx.stream.checkpoint();
  if (!ctx.stream.matchText(keyword)) return null;
  const startPos = getStartWithAttributes(attributes, keywordPos);
  beginElem(ctx, kind, attributes);
  return startPos;
}

/** Finish a statement element from its typed fields and attach its attributes.
 *  The open elem's collected contents are discarded: statements emit and dump
 *  from their fields, not from `contents`. */
export function finishStatement<K extends keyof ElemKindMap>(
  kind: K,
  start: number,
  ctx: ParsingContext,
  params: Omit<ElemKindMap[K], "kind" | "start" | "end" | "contents">,
  attributes?: AttributeElem[],
): ElemKindMap[K] {
  const end = ctx.stream.checkpoint();
  discardOpenElem(ctx);
  const elem = { kind, start, end, ...params } as ElemKindMap[K];
  attachAttributes(elem as HasAttributes, attributes);
  return elem;
}

function hasConditionalAttr(attributes?: AttributeElem[]): boolean {
  return !!attributes && hasConditionalAttribute(attributes);
}

/** Grammar: statement* '}' (after '{' consumed). Loop bodies may end with continuing.
 *  Returns the parsed statements and the position of the closing '}', so the
 *  caller can attach comments (including ones dangling in an empty block). */
function parseBlockStatements(
  ctx: ParsingContext,
  loopBody?: boolean,
): { body: Statement[]; closePos: number } {
  const { stream } = ctx;
  const body: Statement[] = [];
  let closePos = 0;
  while (true) {
    const close = stream.matchText("}");
    if (close) {
      closePos = close.span[0];
      break;
    }
    const stmt = parseStatement(ctx);
    if (!stmt) throwParseError(stream, "Expected statement or '}'");
    ctx.addElem(stmt);
    body.push(stmt);
    if (loopBody && stmt.kind === "continuing") {
      closePos = expect(stream, "}", "continuing block").span[0];
      break;
    }
  }
  return { body, closePos };
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
  if (!stmt) return null;

  finalizeConditional(ctx, hasConditional, attributes);
  return stmt as Statement;
}

function finalizeConditional(
  ctx: ParsingContext,
  hasConditional: boolean,
  attributes: AttributeElem[],
): void {
  if (hasConditional) {
    const partialScope = ctx.popScope();
    partialScope.condAttribute = getConditionalAttribute(attributes);
  }
}

function getConditionalAttribute(
  attributes: AttributeElem[],
): CondAttr | undefined {
  const found = attributes.find(a => isConditionalAttribute(a.attribute));
  return found?.attribute as CondAttr | undefined;
}
