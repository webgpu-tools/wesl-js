import type {
  Attribute,
  AttributeElem,
  BuiltinAttribute,
  DiagnosticAttribute,
  DiagnosticRule,
  ElifAttribute,
  ElseAttribute,
  IfAttribute,
  InterpolateAttribute,
  NameElem,
  StandardAttribute,
  TranslateTimeExpressionElem,
  UnknownExpressionElem,
} from "../AbstractElems.ts";
import { ParseError } from "../ParseError.ts";
import { parseExpression } from "./ParseExpression.ts";
import {
  expect,
  expectWord,
  makeNameElem,
  parseCommaList,
  parseManyEager,
  throwParseError,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";

/** Grammar: attribute * */
export function parseAttributeList(ctx: ParsingContext): AttributeElem[] {
  // perf, not semantics: parseManyEager returns [] here anyway, but this runs
  // before every statement and declaration and most have no attributes
  if (ctx.stream.peek()?.text !== "@") return [];
  return parseManyEager(ctx, parseAttribute);
}

/** WESL Grammar: if_attribute : '@if' '(' translate_time_expression ')' */
export function parseIfAttribute(ctx: ParsingContext): IfAttribute | null {
  return parseConditionalAttribute(ctx, "if", makeIfAttribute);
}

/** WESL Grammar: else_attribute : '@else' */
export function parseElseAttribute(ctx: ParsingContext): ElseAttribute | null {
  if (!ctx.stream.matchSequence("@", "else")) return null;
  return makeElseAttribute();
}

/** WESL Grammar: elif_attribute : '@elif' '(' translate_time_expression ')' */
export function parseElifAttribute(ctx: ParsingContext): ElifAttribute | null {
  return parseConditionalAttribute(ctx, "elif", makeElifAttribute);
}

/** Parse WESL conditional attributes (@if, @elif, @else) */
export function parseWeslConditional(
  ctx: ParsingContext,
): AttributeElem | null {
  const { stream } = ctx;
  const peeked = stream.peek();
  if (peeked?.text !== "@") return null;
  // start at the '@' token, not at the stream cursor: the cursor sits before
  // any leading comments, which would then land inside the elem's span and be
  // lost to AttachComments rather than attached to it
  const startPos = peeked.start;

  const attr =
    parseIfAttribute(ctx) ?? parseElifAttribute(ctx) ?? parseElseAttribute(ctx);
  if (!attr) return null;
  return attributeElem(attr, startPos, stream.position());
}

/**
 * Grammar: attribute :
 *   '@' ident_pattern_token argument_expression_list ?
 *   | align_attr | binding_attr | blend_src_attr | builtin_attr | const_attr
 *   | diagnostic_attr | group_attr | id_attr | interpolate_attr | invariant_attr
 *   | location_attr | must_use_attr | size_attr | workgroup_size_attr
 *   | vertex_attr | fragment_attr | compute_attr
 * WESL extensions: @if, @elif, @else
 */
function parseAttribute(ctx: ParsingContext): AttributeElem | null {
  if (ctx.stream.peek()?.text !== "@") return null;

  return parseWeslConditional(ctx) ?? parseStandardAttribute(ctx);
}

/** Parse `@if(expr)` or `@elif(expr)` conditional attributes. */
function parseConditionalAttribute<T>(
  ctx: ParsingContext,
  keyword: string,
  makeAttr: (expr: TranslateTimeExpressionElem) => T,
): T | null {
  const { stream } = ctx;
  const startPos = stream.position();
  if (!stream.matchSequence("@", keyword)) return null;

  expect(stream, "(", `@${keyword}`);
  // Past `@keyword(` we're committed: a missing/invalid condition is a hard
  // parse error, not a backtrack (the stream is already advanced past `(`).
  const expr = parseExpression(ctx, true);
  if (!expr) throwParseError(stream, `Expected expression after @${keyword}(`);

  stream.matchText(",");
  expect(stream, ")", `@${keyword} expression`);

  // TODO remove translate-time once we drop v1
  const translateTimeExpr: TranslateTimeExpressionElem = {
    kind: "translate-time-expression",
    expression: expr,
    start: startPos,
    end: stream.position(),
  };
  return makeAttr(translateTimeExpr);
}

function makeIfAttribute(param: TranslateTimeExpressionElem): IfAttribute {
  return { kind: "@if", param } as const;
}

function makeElseAttribute(): ElseAttribute {
  return { kind: "@else" } as const;
}

function makeElifAttribute(param: TranslateTimeExpressionElem): ElifAttribute {
  return { kind: "@elif", param } as const;
}

function attributeElem(
  attribute: Attribute,
  start: number,
  end: number,
): AttributeElem {
  return { kind: "attribute", attribute, start, end };
}

/** Parse a standard attribute (not @if/@elif/@else) */
function parseStandardAttribute(ctx: ParsingContext): AttributeElem | null {
  const { stream } = ctx;
  const atToken = stream.matchText("@");
  if (!atToken) return null;
  // the '@' itself, not the cursor before it: leading comments must stay
  // outside the elem's span (see parseWeslConditional)
  const startPos = atToken.start;

  // `@` can begin nothing but an attribute, so a bad name is a hard error here.
  // Backtracking would instead surface a mispointed error at the caller, and in
  // a struct body it would cost the whole struct: a member that doesn't match
  // ends the member list, so the struct's closing '}' then fails to parse.
  const nameToken = stream.peek();
  if (nameToken?.kind !== "word" && nameToken?.kind !== "keyword") {
    throwParseError(stream, "Expected attribute name after '@'");
  }

  stream.nextToken();
  const name = nameToken.text;

  if (name === "builtin") return parseBuiltinAttribute(ctx, startPos);
  if (name === "interpolate") return parseInterpolateAttribute(ctx, startPos);
  if (name === "diagnostic") return parseDiagnosticAttribute(ctx, startPos);

  let params: UnknownExpressionElem[] | undefined;
  if (stream.matchText("(")) {
    ctx.parsingAttrParam = name;
    params = parseAttributeParams(ctx);
    ctx.parsingAttrParam = undefined;
    expect(stream, ")", "attribute parameters");
  }

  if (name === "must_use" && params !== undefined) {
    throw new ParseError("@must_use does not accept parameters", [
      startPos,
      stream.position(),
    ]);
  }

  const stdAttr: StandardAttribute = { kind: "@attribute", name, params };
  return attributeElem(stdAttr, startPos, stream.position());
}

function parseBuiltinAttribute(
  ctx: ParsingContext,
  startPos: number,
): AttributeElem {
  const { stream } = ctx;
  expect(stream, "(", "@builtin");
  const nameToken = expectWord(stream, "Expected identifier in @builtin");
  stream.matchText(","); // attrib_end : ','? ')'
  expect(stream, ")", "@builtin parameter");

  const builtinAttr: BuiltinAttribute = {
    kind: "@builtin",
    param: makeNameElem(nameToken),
  };

  return attributeElem(builtinAttr, startPos, stream.position());
}

function parseInterpolateAttribute(
  ctx: ParsingContext,
  startPos: number,
): AttributeElem {
  const { stream } = ctx;
  expect(stream, "(", "@interpolate");
  const params = parseCommaList(ctx, parseNameElem);
  expect(stream, ")", "@interpolate parameters");

  const interpolateAttr: InterpolateAttribute = {
    kind: "@interpolate",
    params,
  };
  return attributeElem(interpolateAttr, startPos, stream.position());
}

/** @diagnostic(severity, rule) or @diagnostic(severity, namespace.rule) */
function parseDiagnosticAttribute(
  ctx: ParsingContext,
  startPos: number,
): AttributeElem {
  const { stream } = ctx;

  expect(stream, "(", "@diagnostic");
  const severityToken = expectWord(stream, "Expected severity in @diagnostic");
  const severity = makeNameElem(severityToken);

  expect(stream, ",", "@diagnostic severity");
  const firstToken = expectWord(stream, "Expected rule in @diagnostic");
  const firstName = makeNameElem(firstToken);

  let rule: DiagnosticRule;
  if (stream.matchText(".")) {
    const secondToken = expectWord(stream, "Expected rule after namespace");
    rule = [firstName, makeNameElem(secondToken)];
  } else {
    rule = [firstName, null];
  }
  stream.matchText(","); // attrib_end : ','? ')'
  expect(stream, ")", "@diagnostic parameters");

  const kind = "@diagnostic";
  const diagnosticAttr: DiagnosticAttribute = { kind, severity, rule };
  return attributeElem(diagnosticAttr, startPos, stream.position());
}

/** Parse attribute params as expressions to capture identifier refs. */
function parseAttributeParams(ctx: ParsingContext): UnknownExpressionElem[] {
  return parseCommaList(ctx, parseAttrParam);
}

function parseNameElem(ctx: ParsingContext): NameElem {
  const nameToken = expectWord(ctx.stream, "Expected identifier");
  return makeNameElem(nameToken);
}

function parseAttrParam(ctx: ParsingContext): UnknownExpressionElem {
  const { stream } = ctx;
  const start = stream.position();
  const expression = parseExpression(ctx);
  if (!expression) throwParseError(stream, "Expected attribute parameter");
  return { kind: "expression", expression, start, end: stream.position() };
}
