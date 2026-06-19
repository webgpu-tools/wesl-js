import type {
  ComponentExpression,
  ComponentMemberExpression,
  ExpressionElem,
  Literal,
  RefIdentElem,
  TypeRefElem,
} from "../AbstractElems.ts";
import {
  makeBinaryExpression,
  makeBinaryOperator,
  makeComponentExpression,
  makeComponentMemberExpression,
  makeLiteral,
  makeUnaryExpression,
  makeUnaryOperator,
} from "./ExpressionUtil.ts";
import {
  checkOpBinding,
  getPrecedence,
  isBinaryOperator,
  type OpGroup,
} from "./OperatorBinding.ts";
import { parseCallSuffix } from "./ParseCall.ts";
import { parseIdent } from "./ParseIdent.ts";
import { parseTemplateParams } from "./ParseType.ts";
import {
  expect,
  expectWord,
  makeNameElem,
  throwParseError,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";
import type { WeslStream, WeslToken } from "./WeslStream.ts";

export interface ExpressionOpts {
  /** If true, RefIdents get conditionRef flag (for @if/@elif). */
  conditionRef?: true;
  /** If true, don't treat '>' as binary operator (for template args). */
  inTemplate?: boolean;
}

interface BinaryExprArgs {
  prec: number;
  left: ExpressionElem;
  group: OpGroup;
  condRef?: true;
  inTemplate?: boolean;
}

/**
 * Grammar: expression :
 *   relational_expression
 *   | short_circuit_or_expression '||' relational_expression
 *   | short_circuit_and_expression '&&' relational_expression
 *   | bitwise_expression
 */
export function parseExpression(
  ctx: ParsingContext,
  opts?: ExpressionOpts | true,
): ExpressionElem | null {
  // Support legacy conditionRef?: true parameter
  const { conditionRef, inTemplate } =
    opts === true ? { conditionRef: true, inTemplate: false } : (opts ?? {});
  const condRef = conditionRef ? true : undefined;

  const startExpr = parseUnaryExpression(ctx, condRef);
  if (!startExpr) return null;

  // Parse binary operators with precedence climbing
  const args: BinaryExprArgs = {
    prec: 1,
    left: startExpr,
    group: "unary",
    condRef,
    inTemplate,
  };
  return parseBinaryExpr(ctx, args).expr;
}

/**
 * Grammar: unary_expression :
 *   singular_expression | '-' unary_expression | '!' unary_expression
 *   | '~' unary_expression | '*' unary_expression | '&' unary_expression
 */
function parseUnaryExpression(
  ctx: ParsingContext,
  conditionRef?: true,
): ExpressionElem | null {
  const { stream } = ctx;
  const token = stream.peek();
  if (!token) return null;

  const unaryOps = "-!&*~";
  if (unaryOps.includes(token.text)) {
    stream.nextToken();
    const operator = makeUnaryOperator(token as WeslToken<"symbol">);
    const operand = parseUnaryExpression(ctx, conditionRef);
    if (!operand)
      throwParseError(stream, "Expected expression after unary operator");
    return makeUnaryExpression(operator, operand);
  }

  return parsePrimaryExpr(ctx, conditionRef);
}

/**
 * Parse binary operators using precedence climbing algorithm.
 *
 * For `1 + 2 * 3 - 4`:
 *  - While loop handles left-to-right at same precedence: `1+2-3` ==> `(1+2)-3`
 *  - Recursion handles tighter-binding ops on the right: `1+2*3` ==> `1+(2*3)`
 *
 * Also validates WGSL operator mixing rules (e.g. `x < y > z` is illegal).
 */
function parseBinaryExpr(
  ctx: ParsingContext,
  args: BinaryExprArgs,
): { expr: ExpressionElem; group: OpGroup } {
  const { stream } = ctx;
  const { prec: minPrecedence, left, group: leftGroup } = args;
  const { condRef, inTemplate } = args;
  let current = left;
  let currentGroup = leftGroup;

  while (true) {
    const opToken = stream.peek();
    if (!isBinaryOpInContext(opToken, inTemplate)) break;

    const precedence = getPrecedence(opToken);
    if (precedence < minPrecedence) break;
    stream.nextToken();

    // Validate operator mixing rules from WGSL 8.19
    currentGroup = checkOpBinding(stream, opToken.text, currentGroup);

    // Parse the immediate right operand
    let right = parseUnaryExpression(ctx, condRef);
    if (!right)
      throwParseError(stream, "Expected expression after binary operator");

    // If next operator binds tighter, recurse to build right subtree first
    const nextToken = stream.peek();
    if (isBinaryOpInContext(nextToken, inTemplate)) {
      const nextPrec = getPrecedence(nextToken);
      if (nextPrec > precedence) {
        const rightArgs: BinaryExprArgs = {
          prec: nextPrec,
          left: right,
          group: "unary",
          condRef,
          inTemplate,
        };
        right = parseBinaryExpr(ctx, rightArgs).expr;
      }
    }

    current = makeBinaryExpression(current, makeBinaryOperator(opToken), right);
  }
  return { expr: current, group: currentGroup };
}

/** Grammar: primary_expression : paren_expression | literal | template_elaborated_ident */
function parsePrimaryExpr(
  ctx: ParsingContext,
  conditionRef?: true,
): ExpressionElem | null {
  const expr =
    parseParenExpr(ctx, conditionRef) ||
    parseSimpleLiteral(ctx.stream) ||
    parseTemplateElaboratedIdent(ctx, conditionRef);
  if (!expr) return null;
  if (conditionRef) return expr; // no postfix operators in @if conditions

  return parsePostfixExpression(ctx, expr);
}

/** Check if token is a valid binary operator in the current context. */
function isBinaryOpInContext(
  token: WeslToken | null,
  inTemplate?: boolean,
): token is WeslToken {
  if (!isBinaryOperator(token)) return false;
  // In template context, '>' ends the template, not a comparison
  if (inTemplate && token.text.startsWith(">")) return false;
  return true;
}

/** Grammar: paren_expression : '(' expression ')' */
function parseParenExpr(
  ctx: ParsingContext,
  conditionRef?: true,
): ExpressionElem | null {
  const { stream } = ctx;
  const open = stream.matchText("(");
  if (!open) return null;

  const expression = parseExpression(ctx, conditionRef);
  if (!expression) throwParseError(stream, "Expected expression after '('");

  const close = expect(stream, ")", "expression");

  const start = open.span[0];
  const end = close.span[1];
  return { kind: "parenthesized-expression", expression, start, end };
}

/** Grammar: literal : int_literal | float_literal | bool_literal */
function parseSimpleLiteral(stream: WeslStream): Literal | null {
  const num = stream.matchKind("number");
  if (num) return makeLiteral(num as WeslToken<"number">);

  return parseBoolean(stream);
}

/**
 * Grammar: template_elaborated_ident : ident template_list?
 * Returns RefIdentElem for bare idents, TypeRefElem if templates present.
 */
function parseTemplateElaboratedIdent(
  ctx: ParsingContext,
  conditionRef?: true,
): RefIdentElem | TypeRefElem | null {
  const refIdent = parseIdent(ctx, conditionRef);
  if (!refIdent) return null;

  if (!ctx.stream.nextTemplateStartToken()) return refIdent;

  const templateParams = parseTemplateParams(ctx);
  return {
    kind: "type",
    name: refIdent.ident,
    templateParams,
    start: refIdent.start,
    end: ctx.stream.checkpoint(),
  };
}

/** Parse postfix operators: member access, indexing, function calls. */
function parsePostfixExpression(
  ctx: ParsingContext,
  base: ExpressionElem,
): ExpressionElem {
  const next = parsePostfixOp(ctx, base);
  if (next) return parsePostfixExpression(ctx, next);
  return base;
}

/** Grammar: bool_literal : 'true' | 'false' */
function parseBoolean(stream: WeslStream): Literal | null {
  const boolToken =
    stream.matchKind("keyword", "true") || stream.matchKind("keyword", "false");
  if (!boolToken) return null;

  return makeLiteral(boolToken);
}

function parsePostfixOp(
  ctx: ParsingContext,
  base: ExpressionElem,
): ExpressionElem | null {
  return (
    parseMemberAccess(ctx, base) ||
    parseIndexAccess(ctx, base) ||
    parseCallSuffix(ctx, base, parseExpression)
  );
}

/** Parse .member access */
function parseMemberAccess(
  ctx: ParsingContext,
  base: ExpressionElem,
): ComponentMemberExpression | null {
  if (!ctx.stream.matchText(".")) return null;
  const memberToken = expectWord(ctx.stream, "Expected identifier after '.'");
  return makeComponentMemberExpression(base, makeNameElem(memberToken));
}

/** Parse [index] access */
function parseIndexAccess(
  ctx: ParsingContext,
  base: ExpressionElem,
): ComponentExpression | null {
  const { stream } = ctx;
  if (!stream.matchText("[")) return null;
  // bare parseExpression: the index belongs in ComponentExpression.access,
  // not in the enclosing container's contents
  const indexExpr = parseExpression(ctx);
  if (!indexExpr) throwParseError(stream, "Expected expression in array index");
  const closeBracket = expect(stream, "]", "array index");
  return makeComponentExpression(base, indexExpr, closeBracket.span[1]);
}
