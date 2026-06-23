import type { AbstractElem } from "../AbstractElems.ts";
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

  currentScope(): Scope {
    return this.state.context.scope;
  }

  /** Append a top-level declaration to the module, in source order. */
  addModuleDecl(elem: AbstractElem): void {
    this.state.stable.moduleElem.decls.push(elem);
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
