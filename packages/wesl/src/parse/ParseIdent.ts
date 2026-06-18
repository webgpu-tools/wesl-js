import type { RefIdentElem } from "../AbstractElems.ts";
import { makeRefIdentElem, throwParseError } from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";
import type { WeslStream, WeslToken } from "./WeslStream.ts";

export interface ParsedModulePath {
  parts: string[];
  start: number;
  end: number;
}

/** WESL keywords that cannot be used as path segment identifiers. */
export const weslKeywords = new Set([
  "as",
  "import",
  "package",
  "super",
  "self",
]);
const pathPrefixKeywords = new Set(["package", "super"]);

/** Parse qualified module path like a::b::c, returning parts and span. */
export function parseModulePath(stream: WeslStream): ParsedModulePath | null {
  const first = stream.peek();
  if (!first || !isPathSegment(first, true)) return null;

  const start = first.span[0];
  stream.nextToken();
  const parts = [first.text];

  while (stream.matchText("::")) {
    const next = stream.peek();
    if (!next || !isPathSegment(next, false))
      throwParseError(stream, "Expected identifier after '::'");
    stream.nextToken();
    parts.push(next.text);
  }

  return { parts, start, end: stream.checkpoint() };
}

/**
 * Parse identifier, possibly qualified with :: (e.g., package::bar, super::baz).
 * @param conditionRef - if true, ident gets conditionRef flag and isn't added to scope
 */
export function parseIdent(
  ctx: ParsingContext,
  conditionRef?: true,
): RefIdentElem | null {
  const path = parseModulePath(ctx.stream);
  if (!path) return null;

  const { parts, start, end } = path;
  const ident = ctx.createRefIdent(parts.join("::"));
  if (conditionRef) ident.conditionRef = true;

  const refIdentElem = makeRefIdentElem(ctx, ident, start, end);

  // conditionRef idents (@if/@elif) stay out of the scope tree entirely.
  // The RefIdentElem is never added to container contents - it lives only
  // inside the expression tree built by parseExpression.
  if (!conditionRef) ctx.saveIdent(ident);

  return refIdentElem;
}

/** Check if token is valid as a path segment (word or allowed keyword). */
function isPathSegment(token: WeslToken, isFirst: boolean): boolean {
  if (token.kind === "word") return true;
  if (token.kind !== "keyword") return false;
  if (weslKeywords.has(token.text)) {
    // package/super allowed only as first segment
    return isFirst && pathPrefixKeywords.has(token.text);
  }
  return true; // other keywords (reserved words) allowed
}
