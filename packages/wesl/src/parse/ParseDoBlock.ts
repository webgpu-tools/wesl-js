import type { AttributeElem, DoBlockElem } from "../AbstractElems.ts";
import type { Scope } from "../Scope.ts";
import { parseFnParams } from "./ParseFn.ts";
import { getStartWithAttributes, parseFunctionBody } from "./ParseStatement.ts";
import {
  attachAttributes,
  expectWord,
  makeNameElem,
  throwParseError,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";

/**
 * Grammar: do_block_decl : attribute* 'do' ident '(' param_list? ')' compound_statement
 *
 * `do` is a module-level declaration when the `doBlocks` extension is on;
 * otherwise it stays a reserved word. The body is parsed structurally but
 * inside a scope that is detached from the module scope graph, so its idents
 * never reach bindIdents. do blocks are module-local, resolved later by AST
 * name match.
 */
export function parseDoBlock(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): DoBlockElem | null {
  if (!ctx.options.weslExtensions?.doBlocks) return null;

  const { stream } = ctx;
  const doToken = stream.matchText("do");
  if (!doToken) return null;

  const startPos = getStartWithAttributes(attributes, doToken.start);
  const nameToken = expectWord(stream, "Expected identifier after 'do'");
  const name = makeNameElem(nameToken);

  const parentScope = ctx.currentScope();
  ctx.pushScope();
  const doScope = ctx.currentScope();

  const params = parseFnParams(ctx);
  const body = parseFunctionBody(ctx);
  if (!body) throwParseError(stream, "Expected do block body");

  ctx.popScope();
  detachScope(parentScope, doScope);

  const doBlock: DoBlockElem = {
    kind: "do",
    name,
    params,
    body,
    start: startPos,
    end: stream.position(),
  };
  attachAttributes(doBlock, attributes);
  return doBlock;
}

/** Remove a child scope from its parent so bindIdents never traverses it. */
function detachScope(parent: Scope, child: Scope): void {
  const i = parent.contents.indexOf(child);
  if (i >= 0) parent.contents.splice(i, 1);
}
