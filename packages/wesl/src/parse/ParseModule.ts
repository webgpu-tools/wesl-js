import type {
  AbstractElem,
  AttributeElem,
  ConstAssertElem,
  GlobalDeclarationElem,
  ModuleElem,
} from "../AbstractElems.ts";
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

/** Grammar: translation_unit : global_directive* ( global_decl | global_assert | ';' )* */
export function parseModule(ctx: ParsingContext): void {
  parseImports(ctx);
  parseDirectives(ctx);
  while (parseNextDeclaration(ctx)) {}
  // reject input the declaration loop couldn't consume (e.g. a directive after a
  // declaration, or stray tokens); otherwise it would be silently dropped
  if (ctx.stream.peek() !== null)
    throwParseError(ctx.stream, "Expected a declaration or directive");
}

/**
 * Reject a module that gives a `do` block a name that clashes with a fn/global
 * or with another `do` block (`do` blocks share the module's declaration
 * namespace, and runners key blocks by name so a duplicate would silently
 * shadow the earlier one). This is a small module-local pass, deliberately not
 * part of bindIdents.
 */
export function checkDoBlockNames(moduleElem: ModuleElem): void {
  const doBlocks = declsOfKind(moduleElem, "do");
  if (doBlocks.length === 0) return;

  const declNames = new Set(moduleElem.decls.map(globalDeclName));
  const seen = new Set<string>();
  for (const block of doBlocks) {
    const { name, start, end } = block.name;
    if (declNames.has(name))
      throw new ParseError(`'${name}' declared as both fn and do`, [
        start,
        end,
      ]);
    if (seen.has(name))
      throw new ParseError(`'${name}' declared as do more than once`, [
        start,
        end,
      ]);
    seen.add(name);
  }
}

/** Parse WESL import statements at the start of the module. */
function parseImports(ctx: ParsingContext): void {
  const importElems = parseWeslImports(ctx);
  for (const importElem of importElems) {
    ctx.addModuleDecl(importElem);
    ctx.state.stable.imports.push(importElem.imports);
  }
}

/** Grammar: global_directive : diagnostic_directive | enable_directive | requires_directive */
function parseDirectives(ctx: ParsingContext): void {
  const directives = parseMany(ctx, parseDirective);
  for (const elem of directives) ctx.addModuleDecl(elem);
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
