import type { TypeRefElem, TypeTemplateParameter } from "../AbstractElems.ts";
import { parseExpression } from "./ParseExpression.ts";
import { parseModulePath } from "./ParseIdent.ts";
import { makeRefIdentElem, throwParseError } from "./ParseUtil.ts";
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

  makeRefIdentElem(ctx, refIdent, start, nameEnd);
  ctx.saveIdent(refIdent);

  const templateParams = ctx.stream.nextTemplateStartToken()
    ? parseTemplateParams(ctx)
    : undefined;

  const end = ctx.stream.checkpoint();
  return { kind: "type", name: refIdent, templateParams, start, end };
}

/** Parse comma-separated template parameters until closing '>'. */
export function parseTemplateParams(
  ctx: ParsingContext,
): TypeTemplateParameter[] {
  const { stream } = ctx;

  if (consumeTemplateEnd(stream)) {
    throwParseError(stream, "Empty template parameter list '<>'");
  }

  const params = [parseTemplateParam(ctx)];
  while (stream.matchText(",")) {
    params.push(parseTemplateParam(ctx));
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
function parseTemplateParam(ctx: ParsingContext): TypeTemplateParameter {
  // parseExpression handles template_elaborated_ident via parsePrimaryExpr
  // inTemplate prevents '>' from being parsed as comparison operator
  const expr = parseExpression(ctx, { inTemplate: true });
  if (expr) return expr;
  throwParseError(ctx.stream, "Expected expression in template parameters");
}
