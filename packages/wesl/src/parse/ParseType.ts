import type { TypeRefElem, TypeTemplateParameter } from "../AbstractElems.ts";
import { beginElem, finishElem } from "./ContentsHelpers.ts";
import { parseExpression } from "./ParseExpression.ts";
import { parseModulePath } from "./ParseIdent.ts";
import {
  makeRefIdentElem,
  parseContentExpression,
  throwParseError,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";
import type { WeslStream } from "./WeslStream.ts";

/**
 * Grammar: type_specifier : template_elaborated_ident
 * Grammar: template_elaborated_ident : ident template_list?
 * WESL extension: qualified names with :: (e.g., pkg::Type)
 */
export function parseSimpleTypeRef(ctx: ParsingContext): TypeRefElem | null {
  const path = parseModulePath(ctx.stream);
  if (!path) return null;

  const { parts, start, end: nameEnd } = path;
  const refIdent = ctx.createRefIdent(parts.join("::"));

  beginElem(ctx, "type");

  const refIdentElem = makeRefIdentElem(ctx, refIdent, start, nameEnd);
  ctx.saveIdent(refIdent);
  ctx.addElem(refIdentElem);

  // intoContents: a declared type is emitted from this "type" elem's contents,
  // so its template params must be added there (not just the templateParams field)
  const templateParams = ctx.stream.nextTemplateStartToken()
    ? parseTemplateParams(ctx, true)
    : undefined;

  return finishElem("type", start, ctx, { name: refIdent, templateParams });
}

/**
 * Parse comma-separated template parameters until closing '>'.
 * @param intoContents add each param to the open container's contents
 *   (for declared types, which emit from contents)
 */
export function parseTemplateParams(
  ctx: ParsingContext,
  intoContents = false,
): TypeTemplateParameter[] {
  const { stream } = ctx;

  if (consumeTemplateEnd(stream)) {
    throwParseError(stream, "Empty template parameter list '<>'");
  }

  const params = [parseTemplateParam(ctx, intoContents)];
  while (stream.matchText(",")) {
    params.push(parseTemplateParam(ctx, intoContents));
  }

  if (!consumeTemplateEnd(stream))
    throwParseError(stream, "Expected '>' or ',' after template parameter");

  return params;
}

/** Consume template end token (>) if present, returning success. */
function consumeTemplateEnd(stream: WeslStream): boolean {
  if (!stream.peek()?.text.startsWith(">")) return false;
  if (!stream.nextTemplateEndToken())
    throwParseError(stream, "Expected '>' to close template parameters");
  return true;
}

/** Grammar: template_arg_expression : expression */
function parseTemplateParam(
  ctx: ParsingContext,
  intoContents: boolean,
): TypeTemplateParameter {
  // parseExpression handles template_elaborated_ident via parsePrimaryExpr
  // inTemplate prevents '>' from being parsed as comparison operator
  const opts = { inTemplate: true } as const;
  const expr = intoContents
    ? parseContentExpression(ctx, opts)
    : parseExpression(ctx, opts);
  if (expr) return expr;
  throwParseError(ctx.stream, "Expected expression in template parameters");
}
