import type {
  ConstAssertElem,
  ImportStatement,
  ModuleElem,
} from "./AbstractElems.ts";
import {
  type Diagnostic,
  diagnosticToString,
  errorDiagnostic,
  firstError,
} from "./Diagnostics.ts";
import { ParseError } from "./ParseError.ts";
import { parseWesl } from "./parse/ParseWesl.ts";
import type { ParseOptions, WeslExtensions } from "./parse/ParsingContext.ts";
import type { Scope, SrcModule } from "./Scope.ts";
import type { Span } from "./Span.ts";

/**
 * Result of parsing one WESL module (e.g., one .wesl file).
 *
 * The AST is constructed into three sections for the binding stage:
 *  - import statements
 *  - language elements (fn, struct, etc)
 *  - scopes
 */
export interface WeslAST {
  /** Source text for this module. */
  srcModule: SrcModule;
  /** Root module element. */
  moduleElem: ModuleElem;
  /** Root scope for this module. */
  rootScope: Scope;
  /** Imports found in this module. */
  imports: ImportStatement[];
  /** Module level const_assert statements. */
  moduleAsserts?: ConstAssertElem[];
  /** Parse options used to produce this AST (so re-parsing preserves them). */
  parseOptions?: ParseOptions;
  /** Syntax errors recovered during parsing (empty for a valid module). */
  diagnostics: Diagnostic[];
}

/** Stable and unstable state used during parsing. */
export interface WeslParseState {
  context: WeslParseContext;
  stable: StableState;
}

/** Stable values used or accumulated during parsing. */
export type StableState = WeslAST;

/** Unstable values used during parse collection. */
export interface WeslParseContext {
  scope: Scope; // current scope (points somewhere in rootScope)
}

export type { ParseOptions, WeslExtensions };

/** Human-readable error when parsing WESL fails. The message formats every
 * diagnostic from the module; `cause`/`span` reflect the first error. */
export class WeslParseError extends Error {
  span: Span;
  src: SrcModule;
  /** All diagnostics recorded for the failed module. */
  diagnostics: Diagnostic[];
  constructor(opts: {
    cause: ParseError;
    src: SrcModule;
    diagnostics?: Diagnostic[];
  }) {
    const { cause, src } = opts;
    const diagnostics = opts.diagnostics ?? [
      errorDiagnostic(cause.message, ...cause.span),
    ];
    const message = diagnostics.map(d => diagnosticToString(d, src)).join("\n");
    super(message, { cause });
    this.span = cause.span;
    this.src = src;
    this.diagnostics = diagnostics;
  }
}

/** Parse a WESL file. Syntax errors are recovered at declaration boundaries
 * and reported in the returned AST's diagnostics rather than thrown. */
export function parseSrcModule(
  srcModule: SrcModule,
  options?: ParseOptions,
): WeslAST {
  return parseWesl(srcModule, options);
}

/** Throw a WeslParseError carrying all of the module's diagnostics if any
 * are errors (the strict boundary for link()).
 * Only error severity throws: warning/info diagnostics never block a link. */
export function throwOnParseError(ast: WeslAST): void {
  const error = firstError(ast.diagnostics);
  if (!error) return;
  const cause = new ParseError(error.message, [error.start, error.end]);
  const { srcModule, diagnostics } = ast;
  throw new WeslParseError({ cause, src: srcModule, diagnostics });
}
