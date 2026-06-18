import type {
  AttributeElem,
  BlockElem,
  DeclIdentElem,
  FnElem,
  FnParamElem,
  GrammarElem,
  TypeRefElem,
} from "../AbstractElems.ts";
import { beginElem, finishElem } from "./ContentsHelpers.ts";
import { parseAttributeList } from "./ParseAttribute.ts";
import { getStartWithAttributes, parseFunctionBody } from "./ParseStatement.ts";
import { parseSimpleTypeRef } from "./ParseType.ts";
import {
  attachAttributes,
  createDeclIdentElem,
  expect,
  expectWord,
  linkDeclIdent,
  linkDeclIdentElem,
  throwParseError,
} from "./ParseUtil.ts";
import { parseTypedDecl } from "./ParseValueDeclaration.ts";
import type { ParsingContext } from "./ParsingContext.ts";

/**
 * Grammar: function_decl : attribute* function_header compound_statement
 * Grammar: function_header : 'fn' ident '(' param_list? ')' ( '->' attribute* template_elaborated_ident )?
 * Grammar: param_list : param ( ',' param )* ','?
 */
export function parseFnDecl(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): FnElem | null {
  const { stream } = ctx;
  const fnToken = stream.matchText("fn");
  if (!fnToken) return null;

  const startPos = getStartWithAttributes(attributes, fnToken.span[0]);
  const nameToken = expectWord(stream, "Expected identifier after 'fn'");
  const declIdentElem = createDeclIdentElem(ctx, nameToken, true);
  ctx.saveIdent(declIdentElem.ident);

  ctx.pushScope(); // dependentScope - for return attrs/type
  const dependentScope = ctx.currentScope();

  ctx.pushScope(); // bodyScope - child scope for params + body
  const params = parseFnParams(ctx);

  // Switch to dependentScope for return attrs so they resolve to module, not params
  const bodyScope = ctx.currentScope();
  ctx.state.context.scope = dependentScope;
  const { returnType, returnAttributes } = parseFnReturn(ctx);
  ctx.state.context.scope = bodyScope;

  const body = parseFunctionBody(ctx);
  if (!body) throwParseError(stream, "Expected function body");
  ctx.popScope(); // end bodyScope

  declIdentElem.ident.dependentScope = ctx.currentScope();
  ctx.popScope(); // end dependentScope

  const fnElem: FnElem = {
    kind: "fn",
    name: declIdentElem,
    params,
    body,
    returnType,
    returnAttributes,
    start: startPos,
    end: stream.checkpoint(),
    contents: buildFnContents(
      attributes,
      declIdentElem,
      params,
      returnType,
      body,
    ),
  };
  attachAttributes(fnElem, attributes);
  linkDeclIdentElem(declIdentElem, fnElem);
  return fnElem;
}

/** Grammar: '(' param_list? ')' where param_list : param ( ',' param )* ','? */
export function parseFnParams(ctx: ParsingContext): FnParamElem[] {
  const { stream } = ctx;
  const params: FnParamElem[] = [];

  expect(stream, "(", "function name");

  while (!stream.matchText(")")) {
    const param = parseFnParam(ctx);
    if (!param) throwParseError(stream, "Expected function parameter or ')'");

    params.push(param);
    if (stream.matchText(",")) continue;

    expect(stream, ")", "function parameter");
    break;
  }

  return params;
}

/** Grammar: ( '->' attribute* type_specifier )? */
function parseFnReturn(ctx: ParsingContext): {
  returnType?: TypeRefElem;
  returnAttributes?: AttributeElem[];
} {
  const { stream } = ctx;
  if (!stream.matchText("->")) return {};

  const attrs = parseAttributeList(ctx);
  const returnType = parseSimpleTypeRef(ctx);
  if (!returnType) throwParseError(stream, "Expected type after '->'");

  return { returnType, returnAttributes: attrs.length > 0 ? attrs : undefined };
}

/** Build contents array for function element */
function buildFnContents(
  attributes: AttributeElem[] | undefined,
  decl: DeclIdentElem,
  params: FnParamElem[],
  returnType: TypeRefElem | undefined,
  body: BlockElem,
): GrammarElem[] {
  const base = returnType
    ? [decl, ...params, returnType, body]
    : [decl, ...params, body];
  return attributes?.length ? [...attributes, ...base] : base;
}

/** Grammar: param : attribute* optionally_typed_ident */
function parseFnParam(ctx: ParsingContext): FnParamElem | null {
  const attributes = parseAttributeList(ctx);
  if (ctx.stream.peek()?.kind !== "word") return null;

  beginElem(ctx, "param", attributes.length ? attributes : undefined);
  const name = parseTypedDecl(ctx, false);
  if (!name)
    throw new Error("Unexpected: peek succeeded but parseTypedDecl failed");
  ctx.addElem(name);

  const startPos = getStartWithAttributes(attributes, name.start);
  const elem = finishElem("param", startPos, ctx, { name });
  linkDeclIdent(name, elem);
  attachAttributes(elem, attributes.length > 0 ? attributes : undefined);
  return elem;
}
