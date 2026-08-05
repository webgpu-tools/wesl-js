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
import { markAttempt, recoverListItem } from "./ParseRecovery.ts";
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
import type { WeslToken } from "./WeslStream.ts";

interface CompoundOptions {
  loopBody?: boolean;
  noScope?: boolean; // for function bodies (scope shared with params)
}

// Experimental: declarations in conditional blocks visible in outer scope.
// e.g. @if(X) { let y = 1; } makes y visible outside the block.
// see https://github.com/webgpu-tools/wesl-spec/issues/158
const conditionalBlockFeature = true;

/** Tokens that begin a statement, so one bounds a failed statement's skip. */
const statementStartKeywords = new Set([
  "let",
  "var",
  "const",
  "const_assert",
  "if",
  "switch",
  "loop",
  "for",
  "while",
  "return",
  "break",
  "continue",
  "continuing",
  "discard",
]);

/** Keywords that begin module-level declarations but can never appear in a
 * statement. One of these during a failed statement's skip means a stray `{`
 * consumed the enclosing block's real closing `}` and the scan escaped the
 * function, so it bounds at any depth (and parseBlockStatements bails).
 * `diagnostic` is omitted: it also names an attribute, so it can legitimately
 * appear inside a statement. */
const moduleOnlyKeywords = new Set([
  "fn",
  "struct",
  "override",
  "alias",
  "import",
  "enable",
  "requires",
  "do",
]);

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
  // check depth before consuming the brace, so a too-deep block's `{` is
  // still ahead of the recovery skip and the text stays brace-balanced
  const brace = ctx.stream.peek();
  if (brace?.text !== "{") return null;
  ctx.enterNesting();
  try {
    ctx.stream.nextToken(); // consume the peeked '{'
    const startPos = getStartWithAttributes(attributes, brace.span[0]);

    const skipScope =
      options?.noScope ||
      (conditionalBlockFeature && hasConditionalAttr(attributes));
    if (!skipScope) ctx.pushScope();
    const body = parseBlockStatements(ctx, options?.loopBody);
    if (!skipScope) ctx.popScope();

    return finishStatement("block", startPos, ctx, { body }, attributes);
  } finally {
    ctx.exitNesting();
  }
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

/** @return true for a keyword that only occurs at module level (like `fn`). */
export function atModuleKeyword(token: WeslToken): boolean {
  return token.kind === "keyword" && moduleOnlyKeywords.has(token.text);
}

function hasConditionalAttr(attributes?: AttributeElem[]): boolean {
  return !!attributes && hasConditionalAttribute(attributes);
}

/**
 * Grammar: statement* '}' (after '{' consumed). Loop bodies may end with continuing.
 *
 * A statement with a syntax error is dropped and parsing resumes at the next
 * statement, so the rest of the block (and the enclosing function) survives.
 */
function parseBlockStatements(
  ctx: ParsingContext,
  loopBody?: boolean,
): Statement[] {
  const { stream } = ctx;
  const body: Statement[] = [];
  let afterContinuing = false;
  while (true) {
    let attempt = markAttempt(ctx);
    try {
      // inside the try: matching '}' peeks, which throws on an unlexable token
      if (stream.matchText("}")) break;
      const stmt = parseStatement(ctx);
      if (!stmt) throwParseError(stream, "Expected statement or '}'");
      // recovery from a missing '}' resumes the loop, so a broken loop body can
      // parse statements past its continuing. Drop them: continuing is last by
      // grammar, and their idents are in the scope tree either way.
      if (!afterContinuing) body.push(stmt);
      if (loopBody && stmt.kind === "continuing") {
        afterContinuing = true;
        attempt = markAttempt(ctx); // the statement is kept; don't roll it back
        expect(stream, "}", "continuing block");
        break;
      }
    } catch (e) {
      // bail at a module-only keyword: a stray '{' swallowed the block's real
      // closing '}', so module-level recovery must restart at that declaration
      recoverListItem(ctx, e, attempt, atStatementBoundary, atModuleKeyword);
      stream.matchText(";"); // consume the terminator, if that's what we synced on
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

/** @return true if the token ends a failed statement's skip: the statement's own
 * `;`, the enclosing block's `}`, the next statement's start (a statement
 * keyword or an attribute `@`), or - at any depth - a module-only keyword. */
function atStatementBoundary(token: WeslToken, depth: number): boolean {
  if (atModuleKeyword(token)) return true;
  if (depth !== 0) return false;
  if (token.kind === "keyword") return statementStartKeywords.has(token.text);
  return token.text === ";" || token.text === "}" || token.text === "@";
}
