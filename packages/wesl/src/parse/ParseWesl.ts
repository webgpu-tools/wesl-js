import type { ModuleElem } from "../AbstractElems.ts";
import { ParseError } from "../ParseError.ts";
import type { WeslAST, WeslParseState } from "../ParseWESL.ts";
import { WeslParseError } from "../ParseWESL.ts";
import type { SrcModule } from "../Scope.ts";
import { emptyScope } from "../Scope.ts";
import {
  attachComments,
  beginElem,
  finishCollected,
} from "./ContentsHelpers.ts";
import { checkDoBlockNames, parseModule } from "./ParseModule.ts";
import { type ParseOptions, ParsingContext } from "./ParsingContext.ts";
import { WeslStream } from "./WeslStream.ts";

/** Parse a WESL source module into an AST. */
export function parseWesl(
  srcModule: SrcModule,
  options?: ParseOptions,
): WeslAST {
  const { ctx, state } = createParseState(srcModule, options);
  try {
    beginElem(ctx, "module");
    parseModule(ctx);
    const moduleElem = state.stable.moduleElem;
    moduleElem.decls = finishCollected(ctx);
    attachComments(ctx, moduleElem.decls, srcModule.src.length);
    checkDoBlockNames(moduleElem);
    return state.stable;
  } catch (e) {
    if (e instanceof ParseError) {
      throw new WeslParseError({ cause: e, src: srcModule });
    }
    // unexpected error (bug in parser), wrap for user-friendly reporting
    const message = e instanceof Error ? e.message : String(e);
    const parseError = new ParseError(message, [0, 0]);
    throw new WeslParseError({ cause: parseError, src: srcModule });
  }
}

/** Initialize parse state: token stream, root scope, and module element. */
function createParseState(
  srcModule: SrcModule,
  parseOptions?: ParseOptions,
): {
  ctx: ParsingContext;
  state: WeslParseState;
} {
  const stream = new WeslStream(srcModule.src);
  const rootScope = emptyScope(null);
  const moduleElem: ModuleElem = {
    kind: "module",
    decls: [],
    start: 0,
    end: srcModule.src.length,
  };
  const state: WeslParseState = {
    context: { scope: rootScope, openElems: [] },
    stable: { srcModule, moduleElem, rootScope, imports: [], parseOptions },
  };
  const ctx = new ParsingContext(stream, state, parseOptions);
  return { ctx, state };
}
