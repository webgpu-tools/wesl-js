import type {
  AbstractElem,
  AttributeElem,
  ConstAssertElem,
  GlobalDeclarationElem,
  ModuleElem,
} from "../AbstractElems.ts";
import { type Diagnostic, errorDiagnostic } from "../Diagnostics.ts";
import { declsOfKind } from "../LinkerUtil.ts";
import { ParseError } from "../ParseError.ts";
import { findMap } from "../Util.ts";
import { parseAttributeList } from "./ParseAttribute.ts";
import { parseDirective } from "./ParseDirective.ts";
import { parseDoBlock } from "./ParseDoBlock.ts";
import { parseFnDecl } from "./ParseFn.ts";
import {
  parseAliasDecl,
  parseConstAssert,
  parseGlobalVarDecl,
} from "./ParseGlobalVar.ts";
import { parseWeslImports } from "./ParseImport.ts";
import {
  markAttempt,
  type ParseAttempt,
  rollbackAttempt,
  skipToBoundary,
} from "./ParseRecovery.ts";
import { parseStructDecl } from "./ParseStruct.ts";
import {
  attrsOrUndef,
  conditionalAttribute,
  hasConditionalAttribute,
  parseMany,
  throwParseError,
} from "./ParseUtil.ts";
import { parseConstDecl, parseOverrideDecl } from "./ParseValueDeclaration.ts";
import type { ParsingContext } from "./ParsingContext.ts";
import type { WeslToken } from "./WeslStream.ts";

const declParsers = [
  parseConstDecl,
  parseOverrideDecl,
  parseGlobalVarDecl,
  parseAliasDecl,
  parseStructDecl,
  parseFnDecl,
  parseDoBlock,
  parseConstAssert,
];

/** Module-level tokens that likely begin a new declaration or directive. */
const declStartKeywords = new Set([
  "fn",
  "struct",
  "var",
  "const",
  "override",
  "alias",
  "const_assert",
  "import",
  "enable",
  "requires",
  "diagnostic",
  "do",
]);

/** Decl-start keywords that can also appear inside a fn body, so while a stray
 * `{` has left the skip scan nested (depth > 0) they don't mark a boundary. The
 * rest (including module-only `do`) never occur in a body, so one bounds even
 * when nested. */
const bodyLegalDeclKeywords = new Set(["var", "const", "const_assert"]);

/**
 * Grammar: translation_unit : global_directive* ( global_decl | global_assert | ';' )*
 *
 * Syntax errors don't abort the parse: each is recorded as a diagnostic and
 * parsing resumes at the next module-decl boundary, so one bad declaration
 * doesn't hide the rest of the module.
 */
export function parseModule(ctx: ParsingContext): void {
  parseHeader(ctx);
  parseDeclarations(ctx);
}

/**
 * Reject a module that gives a `do` block a name that clashes with a fn/global
 * or with another `do` block (`do` blocks share the module's declaration
 * namespace, and runners key blocks by name so a duplicate would silently
 * shadow the earlier one). This is a small module-local pass, deliberately not
 * part of bindIdents.
 */
export function checkDoBlockNames(moduleElem: ModuleElem): Diagnostic[] {
  const doBlocks = declsOfKind(moduleElem, "do");
  if (doBlocks.length === 0) return [];

  const diagnostics: Diagnostic[] = [];
  const declKinds = new Map<string, string>();
  for (const elem of moduleElem.decls) {
    const name = globalDeclName(elem);
    if (name !== undefined) {
      declKinds.set(name, elem.kind === "gvar" ? "var" : elem.kind);
    }
  }
  const seen = new Set<string>();
  for (const block of doBlocks) {
    const { name, start, end } = block.name;
    const clashKind = declKinds.get(name);
    if (clashKind) {
      const message = `'${name}' declared as both ${clashKind} and do`;
      diagnostics.push(errorDiagnostic(message, start, end));
    } else if (seen.has(name)) {
      const message = `'${name}' declared as do more than once`;
      diagnostics.push(errorDiagnostic(message, start, end));
    }
    seen.add(name);
  }
  return diagnostics;
}

/** Parse imports and directives, recovering after syntax errors. */
function parseHeader(ctx: ParsingContext): void {
  const { stream } = ctx;
  while (true) {
    const attempt = markAttempt(ctx);
    try {
      parseImports(ctx);
      parseDirectives(ctx);
      return;
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      recoverAtDeclBoundary(ctx, e, attempt);
      // no forward progress: give up on the header (defensive; tokenizer
      // errors always advance the stream, so this looks unreachable)
      if (stream.checkpoint() === attempt.start) return;
    }
  }
}

/** Parse global declarations until EOF, recovering after syntax errors. */
function parseDeclarations(ctx: ParsingContext): void {
  const { stream } = ctx;
  while (true) {
    const attempt = markAttempt(ctx);
    try {
      if (stream.peek() === null) return;
      // reject input no declaration parser matched (e.g. a directive after a
      // declaration, or stray tokens); otherwise it would be silently dropped
      if (!parseNextDeclaration(ctx))
        throwParseError(stream, "Expected a declaration or directive");
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      recoverAtDeclBoundary(ctx, e, attempt);
      if (stream.checkpoint() === attempt.start) return; // wedged (unlexable input); give up
    }
  }
}

/** @return the declared name of a module-level declaration, if it has one. */
function globalDeclName(elem: AbstractElem): string | undefined {
  switch (elem.kind) {
    case "fn":
    case "struct":
    case "alias":
      return elem.name.ident.originalName;
    case "gvar":
    case "const":
    case "override":
      return elem.name.decl.ident.originalName;
    default:
      return undefined;
  }
}

/** Parse WESL import statements at the start of the module. Each import is
 * recorded as it parses, so imports before a syntax error are preserved. */
function parseImports(ctx: ParsingContext): void {
  for (const importElem of parseWeslImports(ctx)) {
    ctx.addModuleDecl(importElem);
    ctx.state.stable.imports.push(importElem.imports);
  }
}

/** Grammar: global_directive : diagnostic_directive | enable_directive | requires_directive */
function parseDirectives(ctx: ParsingContext): void {
  const directives = parseMany(ctx, parseDirective);
  for (const elem of directives) ctx.addModuleDecl(elem);
}

/** Record a syntax error and resync: drop scopes built by the failed
 * declaration and skip forward to a likely module-decl boundary. */
function recoverAtDeclBoundary(
  ctx: ParsingContext,
  error: ParseError,
  attempt: ParseAttempt,
): void {
  ctx.addError(error.message, ...error.span);
  rollbackAttempt(ctx, attempt);
  skipToBoundary(ctx.stream, attempt.start, atDeclBoundary);
}

/** Parse one declaration, return true if more may exist. */
function parseNextDeclaration(ctx: ParsingContext): boolean {
  const { stream } = ctx;
  if (stream.matchText(";")) return true;

  const attrs = parseAttributeList(ctx);
  const hasConditional = hasConditionalAttribute(attrs);
  if (hasConditional) ctx.pushScope("partial");

  const parsed = parseDecl(ctx, attrs);
  if (hasConditional && parsed) finalizeConditional(ctx, attrs);

  if (parsed) return true;
  if (attrs.length)
    throwParseError(stream, "Expected declaration after attributes");
  return false;
}

/**
 * @return true if the token likely starts a module-level declaration: a
 * decl-start keyword or an attribute `@`, outside any braces.
 *
 * A body-level error is recovered inside the body, so the skip scan mostly sees
 * balanced braces. But an error in a declaration *header* (e.g. `fn f( {`) can
 * leave a stray unmatched `{` ahead, which would otherwise swallow the rest of
 * the file. So inside a brace (depth > 0) a keyword that can't appear in a body
 * still ends the skip, while a body-legal one doesn't.
 */
function atDeclBoundary(token: WeslToken, depth: number): boolean {
  if (token.kind === "keyword") {
    if (!declStartKeywords.has(token.text)) return false;
    return depth === 0 || !bodyLegalDeclKeywords.has(token.text);
  }
  return depth === 0 && token.text === "@";
}

/** Try each declaration parser until one succeeds. */
function parseDecl(ctx: ParsingContext, attrs: AttributeElem[]): boolean {
  const elem = findMap(declParsers, p => p(ctx, attrsOrUndef(attrs)));
  if (!elem) return false;
  recordDecl(ctx, elem, attrs);
  return true;
}

/** Pop conditional scope and attach the conditional attribute. */
function finalizeConditional(
  ctx: ParsingContext,
  attrs: AttributeElem[],
): void {
  const partialScope = ctx.popScope();
  partialScope.condAttribute = conditionalAttribute(attrs);
}

/** Record a parsed declaration, extending start to include attributes. */
function recordDecl(
  ctx: ParsingContext,
  elem: GlobalDeclarationElem | ConstAssertElem,
  attrs: AttributeElem[],
): void {
  if (attrs.length && elem.start > attrs[0].start) elem.start = attrs[0].start;
  ctx.addModuleDecl(elem);
  if (elem.kind === "assert") {
    const { stable } = ctx.state;
    stable.moduleAsserts ??= [];
    stable.moduleAsserts.push(elem);
  }
}
