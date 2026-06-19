import type {
  Attribute,
  AttributeElem,
  DeclarationElem,
  DeclIdentElem,
  ExpressionElem,
  NameElem,
  RefIdentElem,
  TypedDeclElem,
} from "../AbstractElems.ts";
import { ParseError } from "../ParseError.ts";
import type { RefIdent } from "../Scope.ts";
import type { Stream, Token } from "../Stream.ts";
import { type ExpressionOpts, parseExpression } from "./ParseExpression.ts";
import type { ParsingContext } from "./ParsingContext.ts";
import type { WeslStream, WeslToken } from "./WeslStream.ts";

/** Match text and throw ParseError if not found. */
export function expect(
  stream: WeslStream,
  text: string,
  context?: string,
): ReturnType<WeslStream["matchText"]> & {} {
  const token = stream.matchText(text);
  if (!token) {
    const pos = stream.checkpoint();
    const msg = context
      ? `Expected '${text}' after ${context}`
      : `Expected '${text}'`;
    throw new ParseError(msg, [pos, pos]);
  }
  return token;
}

/** Match word token and throw ParseError if not found. */
export function expectWord(
  stream: WeslStream,
  errorMsg: string,
): WeslToken<"word"> {
  const token = stream.peek();
  if (!token || token.kind !== "word") {
    throwParseError(stream, errorMsg);
  }
  stream.nextToken();
  return token as WeslToken<"word">;
}

/** Parse a required expression, adding it to the open container's contents. */
export function expectExpression(
  ctx: ParsingContext,
  errorMsg = "Expected expression",
): ExpressionElem {
  const expr = parseExpression(ctx);
  if (!expr) throwParseError(ctx.stream, errorMsg);
  ctx.addElem(expr);
  return expr;
}

/** Parse an optional expression, adding it to the open container's contents. */
export function parseContentExpression(
  ctx: ParsingContext,
  opts?: ExpressionOpts,
): ExpressionElem | null {
  const expr = parseExpression(ctx, opts);
  if (expr) ctx.addElem(expr);
  return expr;
}

/** Throw a ParseError at the current/next token position. */
export function throwParseError(stream: Stream<Token>, message: string): never {
  const weslStream = stream as WeslStream;
  const token = weslStream.peek();
  const span = token
    ? token.span
    : ([weslStream.checkpoint(), weslStream.checkpoint()] as const);
  throw new ParseError(message, span);
}

/** Parse comma-separated items. Caller handles delimiters. */
export function parseCommaList<T>(
  ctx: ParsingContext,
  parseItem: (ctx: ParsingContext) => T | null,
): T[] {
  const items: T[] = [];
  while (true) {
    const item = parseItem(ctx);
    if (item === null) break;
    items.push(item);
    if (!ctx.stream.matchText(",")) break;
  }
  return items;
}

/** Yield parsed elements until parser returns null. */
export function* parseMany<T>(
  ctx: ParsingContext,
  parse: (ctx: ParsingContext) => T | null,
): Generator<T> {
  for (let elem = parse(ctx); elem; elem = parse(ctx)) yield elem;
}

/** Create a NameElem from a word token. */
export function makeNameElem(token: WeslToken<"word">): NameElem {
  const [start, end] = token.span;
  return { kind: "name", name: token.text, start, end };
}

/** Create a DeclIdentElem from a name token. */
export function createDeclIdentElem(
  ctx: ParsingContext,
  nameToken: WeslToken<"word">,
  isGlobal: boolean,
): DeclIdentElem {
  const declIdent = ctx.createDeclIdent(nameToken.text, isGlobal);
  const [start, end] = nameToken.span;
  return {
    kind: "decl",
    ident: declIdent,
    srcModule: ctx.srcModule,
    start,
    end,
  };
}

/** Create a RefIdentElem and link it to its RefIdent. */
export function makeRefIdentElem(
  ctx: ParsingContext,
  refIdent: RefIdent,
  start: number,
  end: number,
): RefIdentElem {
  const elem: RefIdentElem = {
    kind: "ref",
    ident: refIdent,
    srcModule: ctx.srcModule,
    start,
    end,
  };
  refIdent.refIdentElem = elem;
  return elem;
}

/** @return true if the attribute is a conditional (@if, @elif, @else) */
export function isConditionalAttribute(attr: Attribute): boolean {
  const { kind } = attr;
  return kind === "@if" || kind === "@elif" || kind === "@else";
}

/** @return true if any attribute is a conditional (@if, @elif, @else) */
export function hasConditionalAttribute(attributes: AttributeElem[]): boolean {
  return attributes.some(attr => isConditionalAttribute(attr.attribute));
}

/** Attach non-empty attributes array to element. */
export function attachAttributes<T extends { attributes?: AttributeElem[] }>(
  elem: T,
  attributes?: AttributeElem[],
): void {
  if (attributes?.length) elem.attributes = attributes;
}

/** Normalize an empty attribute list to undefined (the elem's "no attributes"). */
export function attrsOrUndef(
  attrs: AttributeElem[],
): AttributeElem[] | undefined {
  return attrs.length ? attrs : undefined;
}

/** Link a DeclIdentElem's ident to its parent declaration. */
export function linkDeclIdentElem(
  declIdentElem: DeclIdentElem,
  declElem: DeclarationElem,
): void {
  declIdentElem.ident.declElem = declElem;
}

/** Link a TypedDeclElem's ident to its parent declaration. */
export function linkDeclIdent(
  typedDecl: TypedDeclElem,
  declElem: DeclarationElem,
): void {
  linkDeclIdentElem(typedDecl.decl, declElem);
}
