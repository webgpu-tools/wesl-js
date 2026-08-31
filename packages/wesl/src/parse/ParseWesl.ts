import type { ModuleElem } from "../AbstractElems.ts";
import { errorDiagnostic } from "../Diagnostics.ts";
import { ParseError } from "../ParseError.ts";
import type { WeslAST, WeslParseState } from "../ParseWESL.ts";
import { WeslParseError } from "../ParseWESL.ts";
import type { SrcModule } from "../Scope.ts";
import { emptyScope } from "../Scope.ts";
import { attachComments } from "./AttachComments.ts";
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
    parseModule(ctx);
    const { moduleElem, diagnostics } = state.stable;
    if (keepingComments(options)) attachComments(ctx, moduleElem);
    diagnostics.push(...checkDoBlockNames(moduleElem));
    return state.stable;
  } catch (e) {
    // parseModule recovers from syntax errors, so an error escaping here is a
    // parser bug; wrap it (keeping any recovered diagnostics) for reporting
    const message = e instanceof Error ? e.message : String(e);
    const cause = e instanceof ParseError ? e : new ParseError(message, [0, 0]);
    const diagnostics = [
      ...state.stable.diagnostics,
      errorDiagnostic(cause.message, ...cause.span),
    ];
    throw new WeslParseError({ cause, src: srcModule, diagnostics });
  }
}

/** Initialize parse state: token stream, root scope, and module element. */
function createParseState(
  srcModule: SrcModule,
  parseOptions?: ParseOptions,
): { ctx: ParsingContext; state: WeslParseState } {
  const stream = new WeslStream(srcModule.src, keepingComments(parseOptions));
  const rootScope = emptyScope(null);
  const moduleElem: ModuleElem = {
    kind: "module",
    decls: [],
    start: 0,
    end: srcModule.src.length,
  };
  const state: WeslParseState = {
    context: { scope: rootScope },
    stable: {
      srcModule,
      moduleElem,
      rootScope,
      imports: [],
      parseOptions,
      diagnostics: [],
    },
  };
  const ctx = new ParsingContext(stream, state, parseOptions);
  return { ctx, state };
}

/** @return true unless the caller opted out of comments (they default on). */
function keepingComments(options?: ParseOptions): boolean {
  return options?.keepComments !== false;
}
