import type { AbstractElem } from "../AbstractElems.ts";
import { errorDiagnostic } from "../Diagnostics.ts";
import { ParseError } from "../ParseError.ts";
import type { WeslParseContext, WeslParseState } from "../ParseWESL.ts";
import {
  type DeclIdent,
  emptyScope,
  type Ident,
  nextIdentId,
  type RefIdent,
  type Scope,
  type SrcModule,
} from "../Scope.ts";
import type { WeslStream } from "./WeslStream.ts";

/** Opt-in toggles for not-yet-spec'd WESL/WGSL features (for prototyping). */
export interface WeslExtensions {
  /** Parse `do name(...) { ... }` blocks. */
  doBlocks?: boolean;
}

export interface ParseOptions {
  /** Enable parsing of experimental, not-yet-spec'd syntax extensions. */
  weslExtensions?: WeslExtensions;
}

/**
 * Bound on recursive nesting (blocks, parenthesized expressions, else-if
 * chains, import trees), so pathologically nested input fails with a
 * recoverable ParseError instead of overflowing the JS stack.
 *
 * WGSL programs are limited to 127 nested statements, and Tint's parser stops
 * recursion at 128, so 384 accepts far more than any shader that could run.
 * The shallowest measured overflow (nested braces) is at ~1200 levels, leaving
 * ~3x stack headroom for callers that invoke the parser from deep call stacks.
 */
export const maxNesting = 384;

/** Error message when maxNesting is exceeded (the import parser reports it
 * too, from its own depth count). */
export const nestedTooDeeply = "Syntax nested too deeply";

/** Context for parsers to build AST and manage scopes. */
export class ParsingContext {
  src: string;
  srcModule: SrcModule;
  stream: WeslStream;
  state: WeslParseState;
  options: ParseOptions;

  constructor(
    stream: WeslStream,
    state: WeslParseState,
    options?: ParseOptions,
  ) {
    this.stream = stream;
    this.state = state;
    this.srcModule = state.stable.srcModule;
    this.src = this.srcModule.src;
    this.options = options ?? {};
  }

  position(): number {
    return this.stream.checkpoint();
  }

  /** Nesting depth of recursive constructs, bounded by maxNesting. */
  nesting = 0;

  /** Enter a recursive construct (block, paren expression, else-if link).
   * Callers pair this with exitNesting in a finally block.
   * @throws ParseError when input is nested too deeply to parse recursively. */
  enterNesting(): void {
    if (this.nesting >= maxNesting) {
      const pos = this.stream.checkpoint();
      const span = this.stream.peek()?.span;
      throw new ParseError(nestedTooDeeply, span ?? [pos, pos]);
    }
    this.nesting++;
  }

  exitNesting(): void {
    this.nesting--;
  }

  currentScope(): Scope {
    return this.state.context.scope;
  }

  /** Append a top-level declaration to the module, in source order. */
  addModuleDecl(elem: AbstractElem): void {
    this.state.stable.moduleElem.decls.push(elem);
  }

  /** Record a recovered syntax error. */
  addError(message: string, start: number, end: number): void {
    this.state.stable.diagnostics.push(errorDiagnostic(message, start, end));
  }

  pushScope(kind: Scope["kind"] = "scope"): void {
    const { scope } = this.state.context;
    const newScope = emptyScope(scope, kind);
    scope.contents.push(newScope);
    this.state.context.scope = newScope;
  }

  popScope(): Scope {
    const weslContext = this.state.context as WeslParseContext;
    const completedScope = weslContext.scope;
    if (completedScope.parent) {
      weslContext.scope = completedScope.parent;
    }
    return completedScope;
  }

  isModuleScope(): boolean {
    let scope = this.currentScope();
    while (scope.kind === "partial" && scope.parent) {
      scope = scope.parent;
    }
    return scope.parent === null;
  }

  /** Attribute name being parsed (for marking refs in attr params). */
  parsingAttrParam?: string;

  createRefIdent(name: string): RefIdent {
    const ref: RefIdent = {
      kind: "ref",
      originalName: name,
      ast: this.state.stable,
      id: nextIdentId(),
      refIdentElem: null as any, // linked by caller
    };
    if (this.parsingAttrParam) ref.attrParam = this.parsingAttrParam;
    return ref;
  }

  createDeclIdent(name: string, isGlobal = false): DeclIdent {
    return {
      kind: "decl",
      originalName: name,
      containingScope: this.state.context.scope,
      isGlobal,
      id: nextIdentId(),
      srcModule: this.srcModule,
      declElem: null as any, // linked by caller
    };
  }

  saveIdent(ident: Ident): void {
    this.state.context.scope.contents.push(ident);
  }
}
