import type {
  AbstractElem,
  AbstractElemBase,
  AssignElem,
  AttributeElem,
  BlockElem,
  CommentElem,
  DeclIdentElem,
  DirectiveElem,
  ExpressionElem,
  FnElem,
  ForElem,
  IfElem,
  ModuleElem,
  NameElem,
  RefIdentElem,
  Statement,
  StructElem,
  StructMemberElem,
  SwitchClauseElem,
  SwitchElem,
  SyntheticElem,
  TypedDeclElem,
  TypeRefElem,
  WhileElem,
} from "./AbstractElems.ts";
import { assertThatDebug, assertUnreachable } from "./Assertions.ts";
import { failIdentElem } from "./ClickableError.ts";
import { filterValidElements } from "./Conditions.ts";
import { identToString } from "./debug/ScopeToString.ts";
import type { Conditions, DeclIdent, Ident } from "./Scope.ts";
import type { SrcMapBuilder } from "./SrcMap.ts";
import { wgslStandardAttributes } from "./StandardTypes.ts";

export interface EmitParams {
  srcBuilder: SrcMapBuilder;
  rootElems: readonly AbstractElem[];
  conditions: Conditions;
  /** are we extracting or copying the root module */
  extracting?: boolean;
  /** if true, rootElems are already validated (e.g., from findValidRootDecls) */
  skipConditionalFiltering?: boolean;
}

/** Passed to the emitters. */
interface EmitContext {
  srcBuilder: SrcMapBuilder;
  conditions: Conditions;
  extracting: boolean;
  /** Current block nesting depth, for statement indentation. */
  indent: number;
}

/** Declarations emitted structurally (var/let/const/override/gvar/alias/assert),
 *  in either local-statement or root-declaration position. */
type ValueDeclElem = Extract<
  AbstractElem,
  { kind: "var" | "gvar" | "let" | "const" | "override" | "alias" | "assert" }
>;

/** Statement kinds that emitStatement must not follow with a ';': compound
 *  statements take none, locals already carry their own, empty needs none. */
const noSemicolon = new Set<Statement["kind"]>([
  "block",
  "if",
  "for",
  "while",
  "loop",
  "continuing",
  "switch",
  "empty",
  "var",
  "let",
  "const",
  "assert",
]);

/** Traverse the AST, starting from root elements, emitting WGSL for each. */
export function lowerAndEmit(params: EmitParams): void {
  const { srcBuilder, rootElems, conditions } = params;
  const { extracting = true, skipConditionalFiltering = false } = params;

  const emitContext: EmitContext = {
    conditions,
    srcBuilder,
    extracting,
    indent: 0,
  };
  const validElements = skipConditionalFiltering
    ? rootElems
    : filterValidElements(rootElems, conditions);
  for (const e of validElements) lowerAndEmitElem(e, emitContext);
}

/** Format a diagnostic control as "(severity, rule)" for @diagnostic text. */
export function diagnosticControlToString(
  severity: NameElem,
  rule: [NameElem, NameElem | null],
): string {
  const ruleStr = rule[0].name + (rule[1] !== null ? "." + rule[1].name : "");
  return `(${severity.name}, ${ruleStr})`;
}

/** Render an expression back to WGSL source text (template args elided as <...>). */
export function expressionToString(elem: ExpressionElem): string {
  const { kind } = elem;
  switch (kind) {
    case "binary-expression": {
      const left = expressionToString(elem.left);
      const right = expressionToString(elem.right);
      return `${left} ${elem.operator.value} ${right}`;
    }
    case "unary-expression":
      return `${elem.operator.value}${expressionToString(elem.expression)}`;
    case "ref":
      return elem.ident.originalName;
    case "literal":
      return elem.value;
    case "parenthesized-expression":
      return `(${expressionToString(elem.expression)})`;
    case "component-expression":
      return `${expressionToString(elem.base)}[${elem.access}]`;
    case "component-member-expression":
      return `${expressionToString(elem.base)}.${elem.access}`;
    case "call-expression": {
      const fn = elem.function;
      const name =
        fn.kind === "ref" ? fn.ident.originalName : fn.name.originalName;
      const targs = elem.templateArgs ? `<...>` : "";
      const args = elem.arguments.map(expressionToString).join(", ");
      return `${name}${targs}(${args})`;
    }
    case "type":
      return elem.name.originalName;
    default:
      assertUnreachable(kind);
  }
}

/** Trace through refersTo links until we find the declaration. */
export function findDecl(ident: Ident): DeclIdent {
  let i: Ident | undefined = ident;
  do {
    if (i.kind === "decl") return i;
    i = i.refersTo;
  } while (i);

  // TODO show source position if this can happen in a non buggy linker.
  throw new Error(`unresolved identifer: ${ident.originalName}`);
}

function lowerAndEmitElem(e: AbstractElem, ctx: EmitContext): void {
  switch (e.kind) {
    case "import":
      return; // import statements are dropped from emitted text
    case "do":
      return; // do blocks are CPU-only, dropped from emitted text

    case "name":
      emitName(e, ctx);
      return;
    case "synthetic":
      emitSynthetic(e, ctx);
      return;

    case "ref":
      emitRefIdent(e, ctx);
      return;
    case "decl":
      emitDeclIdent(e, ctx);
      return;

    case "literal":
    case "binary-expression":
    case "unary-expression":
    case "call-expression":
    case "parenthesized-expression":
    case "component-expression":
    case "component-member-expression":
      emitExpression(e, ctx);
      return;

    case "param":
      emitAttributes(e.attributes, ctx);
      emitTypedDecl(e.name, ctx);
      return;
    case "typeDecl":
      emitTypedDecl(e, ctx);
      return;
    case "member":
      emitMember(e, ctx);
      return;

    case "expression":
      emitExpression(e.expression, ctx);
      return;

    // Switch clauses are normally emitted structurally by emitSwitch; handle the
    // standalone case (e.g. a clause reached via a container walk) the same way.
    case "switch-clause":
      emitSwitchClause(e, ctx);
      return;

    case "type":
      emitTypeRef(e, ctx);
      return;

    case "module":
      emitModule(e, ctx);
      return;

    case "var":
    case "let":
    case "block":
    case "if":
    case "for":
    case "while":
    case "loop":
    case "continuing":
    case "switch":
    case "return":
    case "break":
    case "continue":
    case "discard":
    case "assign":
    case "increment":
    case "decrement":
    case "call":
    case "empty":
      emitStatement(e, ctx);
      return;

    case "override":
    case "const":
    case "assert":
    case "alias":
    case "gvar":
      emitRootDecl(e, ctx);
      return;

    case "fn":
      emitRootElemNl(ctx);
      emitFn(e, ctx);
      return;

    case "struct":
      emitRootElemNl(ctx);
      emitStruct(e, ctx);
      return;

    case "attribute":
      emitAttribute(e, ctx);
      return;

    case "directive":
      // each top-level directive on its own line (no source TextElems separate them)
      ctx.srcBuilder.addNl();
      emitDirective(e, ctx);
      return;

    default:
      assertUnreachable(e);
  }
}

function emitName(e: NameElem, ctx: EmitContext): void {
  ctx.srcBuilder.add(e.name, e.start, e.end);
}

function emitSynthetic(e: SyntheticElem, ctx: EmitContext): void {
  const { text } = e;
  ctx.srcBuilder.addSynthetic(text, text, 0, text.length);
}

function emitRefIdent(e: RefIdentElem, ctx: EmitContext): void {
  if (e.ident.std) {
    ctx.srcBuilder.add(e.ident.originalName, e.start, e.end);
  } else {
    ctx.srcBuilder.add(displayName(findDecl(e.ident)), e.start, e.end);
  }
}

function emitDeclIdent(e: DeclIdentElem, ctx: EmitContext): void {
  ctx.srcBuilder.add(displayName(e.ident), e.start, e.end);
}

function emitExpression(e: ExpressionElem, ctx: EmitContext): void {
  const builder = ctx.srcBuilder;
  switch (e.kind) {
    case "literal":
      builder.add(e.value, e.start, e.end);
      return;
    case "ref":
      emitRefIdent(e, ctx);
      return;
    case "type":
      emitTypeRef(e, ctx);
      return;
    case "binary-expression": {
      const [start, end] = e.operator.span;
      emitExpression(e.left, ctx);
      builder.add(` ${e.operator.value} `, start, end);
      emitExpression(e.right, ctx);
      return;
    }
    case "unary-expression": {
      const { value, start, end } = e.operator;
      builder.add(value, start, end);
      emitExpression(e.expression, ctx);
      return;
    }
    case "parenthesized-expression":
      builder.appendNext("(");
      emitExpression(e.expression, ctx);
      builder.appendNext(")");
      return;
    case "call-expression":
      emitExpression(e.function, ctx);
      if (e.templateArgs) emitTemplateArgs(e.templateArgs, ctx);
      builder.appendNext("(");
      e.arguments.forEach((arg, i) => {
        if (i > 0) builder.appendNext(", ");
        emitExpression(arg, ctx);
      });
      builder.appendNext(")");
      return;
    case "component-expression":
      emitExpression(e.base, ctx);
      builder.appendNext("[");
      emitExpression(e.access, ctx);
      builder.appendNext("]");
      return;
    case "component-member-expression":
      emitExpression(e.base, ctx);
      builder.add("." + e.access.name, e.access.start, e.access.end);
      return;
    default:
      assertUnreachable(e);
  }
}

function emitAttributes(
  attributes: AttributeElem[] | undefined,
  ctx: EmitContext,
): void {
  attributes?.forEach(a => {
    const emitted = emitAttribute(a, ctx);
    if (emitted) {
      ctx.srcBuilder.add(" ", a.start, a.end);
    }
  });
}

/** Emit a declared identifier with its optional `: type` annotation. */
function emitTypedDecl(name: TypedDeclElem, ctx: EmitContext): void {
  emitDeclIdent(name.decl, ctx);
  if (name.typeRef) {
    ctx.srcBuilder.appendNext(": ");
    emitTypeRef(name.typeRef, ctx);
  }
}

/** Emit a struct member from its typed fields: `[attrs] name: type`. */
function emitMember(member: StructMemberElem, ctx: EmitContext): void {
  emitAttributes(member.attributes, ctx);
  emitName(member.name, ctx);
  ctx.srcBuilder.appendNext(": ");
  emitTypeRef(member.typeRef, ctx);
}

/** A `case sel, ...:` or `default:` clause with its `{ ... }` body. The selector
 *  colon is optional in WGSL but kept here as the canonical form. */
function emitSwitchClause(e: SwitchClauseElem, ctx: EmitContext): void {
  const builder = ctx.srcBuilder;
  emitLeadingComments(e, ctx);
  newLine(ctx);
  emitAttributes(e.attributes, ctx);
  const defaultOnly = e.selectors.length === 1 && e.selectors[0] === "default";
  if (defaultOnly) {
    builder.appendNext("default");
  } else {
    builder.appendNext("case ");
    e.selectors.forEach((sel, i) => {
      if (i > 0) builder.appendNext(", ");
      if (sel === "default") builder.appendNext("default");
      else emitExpression(sel, ctx);
    });
  }
  builder.appendNext(": ");
  emitBlock(e.body, ctx);
  emitTrailingComments(e, ctx);
}

/** Emit a type reference structurally: name plus an optional <...> arg list. */
function emitTypeRef(e: TypeRefElem, ctx: EmitContext): void {
  emitRefIdent(e.name.refIdentElem, ctx);
  if (e.templateParams) emitTemplateArgs(e.templateParams, ctx);
}

function emitModule(e: ModuleElem, ctx: EmitContext): void {
  // The module's typed children emit structurally, each handling its own
  // leading blank lines (emitRootElemNl / emitRootDecl); no TextElems remain.
  const validElements = filterValidElements(e.decls, ctx.conditions);
  for (const child of validElements) lowerAndEmitElem(child, ctx);
}

/** Emit one statement on its own line, with attached leading/trailing comments. */
function emitStatement(stmt: Statement, ctx: EmitContext): void {
  emitLeadingComments(stmt, ctx);
  newLine(ctx);
  emitCoreSemi(stmt, ctx);
  emitTrailingComments(stmt, ctx);
}

function emitRootDecl(
  e: Extract<
    ValueDeclElem,
    { kind: "override" | "const" | "assert" | "alias" | "gvar" }
  >,
  ctx: EmitContext,
): void {
  emitRootElemNl(ctx);
  emitValueDecl(e, ctx);
}

/** Emit newlines between root elements. */
function emitRootElemNl(ctx: EmitContext): void {
  ctx.srcBuilder.addNl();
  ctx.srcBuilder.addNl();
}

/** Emit function explicitly to control commas between conditional parameters. */
function emitFn(e: FnElem, ctx: EmitContext): void {
  const { attributes, name, params, returnAttributes, returnType, body } = e;
  const { conditions, srcBuilder: builder } = ctx;

  emitAttributes(attributes, ctx);

  builder.add("fn ", name.start - 3, name.start);
  emitDeclIdent(name, ctx);

  builder.appendNext("(");
  const validParams = filterValidElements(params, conditions);
  validParams.forEach((p, i) => {
    emitAttributes(p.attributes, ctx);
    emitTypedDecl(p.name, ctx);
    if (i < validParams.length - 1) {
      builder.appendNext(", ");
    }
  });
  builder.appendNext(") ");

  if (returnType) {
    builder.appendNext("-> ");
    emitAttributes(returnAttributes, ctx);
    emitTypeRef(returnType, ctx);
    builder.appendNext(" ");
  }

  emitBlock(body, ctx);
}

/** Emit structs explicitly to control commas between conditional members. */
function emitStruct(e: StructElem, ctx: EmitContext): void {
  const { attributes, name, members, start } = e;
  const { srcBuilder, conditions } = ctx;

  const validMembers = filterValidElements(members, conditions);
  const validLength = validMembers.length;

  if (validLength === 0) {
    warnEmptyStruct(e);
    return;
  }

  emitAttributes(attributes, ctx);
  srcBuilder.add("struct ", start, name.start);
  emitDeclIdent(name, ctx);

  if (validLength === 1) {
    srcBuilder.appendNext(" { ");
    emitMember(validMembers[0], ctx);
    srcBuilder.appendNext(" }");
    srcBuilder.addNl();
  } else {
    srcBuilder.appendNext(" {");
    srcBuilder.addNl();

    validMembers.forEach(m => {
      srcBuilder.appendNext("  ");
      emitMember(m, ctx);
      srcBuilder.appendNext(",");
      srcBuilder.addNl();
    });

    srcBuilder.appendNext("}");
    srcBuilder.addNl();
  }
}

function emitAttribute(e: AttributeElem, ctx: EmitContext): boolean {
  const { kind } = e.attribute;

  if (kind === "@if" || kind === "@elif" || kind === "@else") {
    return false; // WESL-only, dropped from WGSL
  }

  if (kind === "@attribute") {
    if (!wgslStandardAttributes.has(e.attribute.name)) {
      return false; // non-WGSL attribute, dropped from output
    }
    emitStandardAttribute(e, ctx);
    return true;
  }

  if (kind === "@builtin") {
    const builtinStr = `@builtin(${e.attribute.param.name})`;
    ctx.srcBuilder.add(builtinStr, e.start, e.end);
    return true;
  }

  if (kind === "@diagnostic") {
    const { severity, rule } = e.attribute;
    const diagStr = `@diagnostic${diagnosticControlToString(severity, rule)}`;
    ctx.srcBuilder.add(diagStr, e.start, e.end);
    return true;
  }

  if (kind === "@interpolate") {
    const params = e.attribute.params.map(v => v.name).join(", ");
    ctx.srcBuilder.add(`@interpolate(${params})`, e.start, e.end);
    return true;
  }

  assertUnreachable(kind);
}

function emitDirective(e: DirectiveElem, ctx: EmitContext): void {
  const { directive } = e;
  const { kind } = directive;
  if (kind === "diagnostic") {
    const diagStr = `diagnostic${diagnosticControlToString(directive.severity, directive.rule)};`;
    ctx.srcBuilder.add(diagStr, e.start, e.end);
  } else if (kind === "enable") {
    const exts = directive.extensions.map(v => v.name).join(", ");
    ctx.srcBuilder.add(`enable ${exts};`, e.start, e.end);
  } else if (kind === "requires") {
    const exts = directive.extensions.map(v => v.name).join(", ");
    ctx.srcBuilder.add(`requires ${exts};`, e.start, e.end);
  } else {
    assertUnreachable(kind);
  }
}

function displayName(declIdent: DeclIdent): string {
  if (declIdent.isGlobal) {
    assertThatDebug(
      declIdent.mangledName,
      `ERR: mangled name not found for decl ident ${identToString(declIdent)}`,
    );
    // mangled name was set in binding step
    return declIdent.mangledName as string;
  }

  return declIdent.mangledName || declIdent.originalName;
}

/** Emit a comma-separated template argument list: <a, b, c>. */
function emitTemplateArgs(args: ExpressionElem[], ctx: EmitContext): void {
  ctx.srcBuilder.appendNext("<");
  args.forEach((a, i) => {
    if (i > 0) ctx.srcBuilder.appendNext(", ");
    emitExpression(a, ctx);
  });
  ctx.srcBuilder.appendNext(">");
}

/** Leading comments: each on its own indented line above the element. */
function emitLeadingComments(e: AbstractElemBase, ctx: EmitContext): void {
  if (!e.commentsBefore) return;
  for (const c of e.commentsBefore) {
    if (c.blankBefore) ctx.srcBuilder.addNl();
    newLine(ctx);
    emitComment(c, ctx);
  }
}

/** Start a fresh line at the current indent. */
function newLine(ctx: EmitContext): void {
  ctx.srcBuilder.addNl();
  if (ctx.indent > 0) ctx.srcBuilder.appendNext("  ".repeat(ctx.indent));
}

/** Emit a `{ ... }` block, one statement per indented line. A block with no
 *  statements collapses to `{ }` unless it holds dangling inner comments. */
function emitBlock(e: BlockElem, ctx: EmitContext): void {
  emitAttributes(e.attributes, ctx);
  const stmts = filterValidElements(e.body, ctx.conditions);
  if (stmts.length === 0 && !e.innerComments?.length) {
    ctx.srcBuilder.appendNext("{ }");
    return;
  }
  ctx.srcBuilder.appendNext("{");
  const inner = childIndent(ctx);
  for (const comment of e.innerComments ?? []) {
    newLine(inner);
    emitComment(comment, inner);
  }
  for (const stmt of stmts) emitStatement(stmt, inner);
  newLine(ctx);
  ctx.srcBuilder.appendNext("}");
}

/** Trailing comments: kept on the element's line, after its text. */
function emitTrailingComments(e: AbstractElemBase, ctx: EmitContext): void {
  if (!e.commentsAfter) return;
  for (const c of e.commentsAfter) {
    ctx.srcBuilder.appendNext(" ");
    emitComment(c, ctx);
  }
}

/** Emit a statement's syntax followed by ';' unless its kind takes none. */
function emitCoreSemi(stmt: Statement, ctx: EmitContext): void {
  emitStatementCore(stmt, ctx);
  if (!noSemicolon.has(stmt.kind)) ctx.srcBuilder.appendNext(";");
}

/** Emit a declaration from its typed fields, including its trailing ';':
 *  `[attrs] var<...> name: T = init;`, `const name = init;`, `override n;`,
 *  `alias name = T;`, `const_assert expr;`. */
function emitValueDecl(e: ValueDeclElem, ctx: EmitContext): void {
  emitAttributes(e.attributes, ctx);
  const builder = ctx.srcBuilder;
  switch (e.kind) {
    case "var":
    case "gvar":
      builder.appendNext("var");
      if (e.template) emitVarTemplate(e.template, ctx);
      builder.appendNext(" ");
      emitTypedDecl(e.name, ctx);
      emitInit(e.init, ctx);
      break;
    case "let":
    case "const":
    case "override":
      builder.appendNext(`${e.kind} `);
      emitTypedDecl(e.name, ctx);
      emitInit(e.init, ctx);
      break;
    case "alias":
      builder.appendNext("alias ");
      emitDeclIdent(e.name, ctx);
      builder.appendNext(" = ");
      emitTypeRef(e.typeRef, ctx);
      break;
    case "assert":
      builder.appendNext("const_assert ");
      emitExpression(e.expression, ctx);
      break;
    default:
      assertUnreachable(e);
  }
  builder.appendNext(";");
}

function warnEmptyStruct(e: StructElem): void {
  const { name, members } = e;
  const condStr = members.length ? "(with current conditions)" : "";
  const message = `struct '${name.ident.originalName}' has no members ${condStr}`;
  failIdentElem(name, message);
}

function emitStandardAttribute(e: AttributeElem, ctx: EmitContext): void {
  if (e.attribute.kind !== "@attribute") return;

  const { params } = e.attribute;
  if (!params || params.length === 0) {
    ctx.srcBuilder.add("@" + e.attribute.name, e.start, e.end);
    return;
  }

  ctx.srcBuilder.add("@" + e.attribute.name + "(", e.start, params[0].start);
  params.forEach((param, i) => {
    if (i > 0) ctx.srcBuilder.appendNext(", ");
    emitExpression(param.expression, ctx);
  });
  ctx.srcBuilder.add(")", params[params.length - 1].end, e.end);
}

function emitComment(c: CommentElem, ctx: EmitContext): void {
  ctx.srcBuilder.add(c.srcModule.src.slice(c.start, c.end), c.start, c.end);
}

/** A child context indented one level deeper. */
function childIndent(ctx: EmitContext): EmitContext {
  return { ...ctx, indent: ctx.indent + 1 };
}

/** Emit a statement's syntax, without surrounding line breaks, ';', or comments. */
function emitStatementCore(stmt: Statement, ctx: EmitContext): void {
  if (
    stmt.kind === "var" ||
    stmt.kind === "let" ||
    stmt.kind === "const" ||
    stmt.kind === "assert"
  ) {
    emitValueDecl(stmt, ctx);
    return;
  }
  // a block prints its own attributes (before its '{'); everything else prints
  // them before its keyword.
  if (stmt.kind !== "block") emitAttributes(stmt.attributes, ctx);
  const builder = ctx.srcBuilder;
  switch (stmt.kind) {
    case "block":
      emitBlock(stmt, ctx);
      return;
    case "if":
      emitIf(stmt, ctx);
      return;
    case "for":
      emitFor(stmt, ctx);
      return;
    case "while":
      emitWhile(stmt, ctx);
      return;
    case "loop":
      builder.appendNext("loop ");
      emitBlock(stmt.body, ctx);
      return;
    case "continuing":
      builder.appendNext("continuing ");
      emitBlock(stmt.body, ctx);
      return;
    case "switch":
      emitSwitch(stmt, ctx);
      return;
    case "return":
      builder.appendNext("return");
      if (stmt.value) {
        builder.appendNext(" ");
        emitExpression(stmt.value, ctx);
      }
      return;
    case "break":
      builder.appendNext("break");
      if (stmt.condition) {
        builder.appendNext(" if ");
        emitExpression(stmt.condition, ctx);
      }
      return;
    case "continue":
      builder.appendNext("continue");
      return;
    case "discard":
      builder.appendNext("discard");
      return;
    case "assign":
      emitAssign(stmt, ctx);
      return;
    case "increment":
      emitExpression(stmt.target, ctx);
      builder.appendNext("++");
      return;
    case "decrement":
      emitExpression(stmt.target, ctx);
      builder.appendNext("--");
      return;
    case "call":
      emitExpression(stmt.call, ctx);
      return;
    case "empty":
      return;
    default:
      assertUnreachable(stmt);
  }
}

/** Emit a var's `<address_space[, access_mode]>` enumerant template. */
function emitVarTemplate(template: NameElem[], ctx: EmitContext): void {
  const builder = ctx.srcBuilder;
  builder.appendNext("<");
  template.forEach((name, i) => {
    if (i > 0) builder.appendNext(", ");
    emitName(name, ctx);
  });
  builder.appendNext(">");
}

/** Emit a ` = init` clause, if present. */
function emitInit(init: ExpressionElem | undefined, ctx: EmitContext): void {
  if (!init) return;
  ctx.srcBuilder.appendNext(" = ");
  emitExpression(init, ctx);
}

/** if / else-if / else: a nested IfElem prints as `else if`, a BlockElem as `else`. */
function emitIf(e: IfElem, ctx: EmitContext): void {
  const builder = ctx.srcBuilder;
  builder.appendNext("if ");
  emitExpression(e.condition, ctx);
  builder.appendNext(" ");
  emitBlock(e.body, ctx);
  if (e.else) {
    builder.appendNext(" else ");
    if (e.else.kind === "if") emitIf(e.else, ctx);
    else emitBlock(e.else, ctx);
  }
}

/** for (init; condition; update) { ... }. The init takes a ';' like any
 *  statement; the update is the last clause before ')', so it gets none. */
function emitFor(e: ForElem, ctx: EmitContext): void {
  const builder = ctx.srcBuilder;
  builder.appendNext("for (");
  if (e.init) emitCoreSemi(e.init, ctx);
  else builder.appendNext(";");
  builder.appendNext(" ");
  if (e.condition) emitExpression(e.condition, ctx);
  builder.appendNext("; ");
  if (e.update) emitStatementCore(e.update, ctx);
  builder.appendNext(") ");
  emitBlock(e.body, ctx);
}

function emitWhile(e: WhileElem, ctx: EmitContext): void {
  ctx.srcBuilder.appendNext("while ");
  emitExpression(e.condition, ctx);
  ctx.srcBuilder.appendNext(" ");
  emitBlock(e.body, ctx);
}

function emitSwitch(e: SwitchElem, ctx: EmitContext): void {
  const builder = ctx.srcBuilder;
  builder.appendNext("switch ");
  emitExpression(e.selector, ctx);
  builder.appendNext(" ");
  emitAttributes(e.bodyAttributes, ctx);
  builder.appendNext("{");
  const inner = childIndent(ctx);
  for (const clause of filterValidElements(e.clauses, ctx.conditions)) {
    emitSwitchClause(clause, inner);
  }
  newLine(ctx);
  builder.appendNext("}");
}

/** lhs op rhs, with the phony target printed as `_`. */
function emitAssign(e: AssignElem, ctx: EmitContext): void {
  if (e.lhs.kind === "phony") {
    ctx.srcBuilder.add("_", e.lhs.span[0], e.lhs.span[1]);
  } else {
    emitExpression(e.lhs, ctx);
  }
  const [start, end] = e.op.span;
  ctx.srcBuilder.add(` ${e.op.value} `, start, end);
  emitExpression(e.rhs, ctx);
}
