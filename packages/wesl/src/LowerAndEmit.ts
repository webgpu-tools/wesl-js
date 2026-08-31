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
import { type LinkBindings, outputName, refTarget } from "./BindIdents.ts";
import { failIdentElem } from "./ClickableError.ts";
import { filterValidElements } from "./Conditions.ts";
import { identToString } from "./debug/ScopeToString.ts";
import type { Conditions, DeclIdent } from "./Scope.ts";
import type { SrcMapBuilder } from "./SrcMap.ts";
import { wgslStandardAttributes } from "./StandardTypes.ts";

export interface EmitParams {
  srcBuilder: SrcMapBuilder;
  rootElems: readonly AbstractElem[];
  conditions: Conditions;
  /** binding results for the link (ref targets, mangled names) */
  bindings: LinkBindings;
  /** are we extracting or copying the root module */
  extracting?: boolean;
  /** if true, rootElems are already validated (e.g., from findValidRootDecls) */
  skipConditionalFiltering?: boolean;
}

/** Passed to the emitters. */
interface EmitContext {
  srcBuilder: SrcMapBuilder;
  conditions: Conditions;
  bindings: LinkBindings;
  extracting: boolean;
  /** Current block nesting depth, for statement indentation. */
  indent: number;
  /** Plugin attributes to emit alongside elem attributes, if any plugin added some. */
  addedAttributes?: Map<AbstractElem, AttributeElem[]>;
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
  const { srcBuilder, rootElems, conditions, bindings } = params;
  const { extracting = true, skipConditionalFiltering = false } = params;

  const { addedAttributes } = bindings;
  const emitContext: EmitContext = {
    conditions,
    srcBuilder,
    bindings,
    extracting,
    indent: 0,
    addedAttributes: addedAttributes.size ? addedAttributes : undefined,
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
      emitElemAttributes(e, ctx);
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
      emitRootLeading(e, ctx);
      emitFn(e, ctx);
      emitTrailingComments(e, ctx);
      return;

    case "struct":
      emitRootElemNl(ctx);
      emitRootLeading(e, ctx);
      emitStruct(e, ctx);
      emitTrailingComments(e, ctx);
      return;

    case "attribute":
      emitAttribute(e, ctx);
      return;

    case "directive":
      // each top-level directive on its own line (no source TextElems separate them)
      ctx.srcBuilder.addNl();
      emitRootLeading(e, ctx);
      emitDirective(e, ctx);
      emitTrailingComments(e, ctx);
      return;

    default:
      assertUnreachable(e);
  }
}

function emitName(e: NameElem, ctx: EmitContext): void {
  ctx.srcBuilder.add(e.name, e.start);
}

/** Emit generated text that has no user source, mapped to itself. */
function emitSynthetic(e: SyntheticElem, ctx: EmitContext): void {
  const { text } = e;
  ctx.srcBuilder.addSynthetic(text, text, 0);
}

function emitRefIdent(e: RefIdentElem, ctx: EmitContext): void {
  const { bindings } = ctx;
  const target = refTarget(e.ident, bindings);
  if (target === "std") {
    // standard WGSL ident (like sin, or u32), emitted as-is
    ctx.srcBuilder.add(e.ident.originalName, e.start);
  } else if (target === "unbound") {
    failIdentElem(e, `unresolved identifier: '${e.ident.originalName}'`);
  } else {
    ctx.srcBuilder.add(displayName(target, bindings), e.start);
  }
}

function emitDeclIdent(e: DeclIdentElem, ctx: EmitContext): void {
  ctx.srcBuilder.add(displayName(e.ident, ctx.bindings), e.start);
}

/** Emit an expression with any comments attached to it. Comments inside an
 *  expression (e.g. `foo(1, /* x *\/ 2)`) ride on the relevant sub-node and are
 *  emitted inline around it here. */
function emitExpression(e: ExpressionElem, ctx: EmitContext): void {
  emitInlineLeading(e, ctx);
  emitExpressionCore(e, ctx);
  emitInlineTrailing(e, ctx);
}

/** Emit an elem's attributes, followed by any a plugin added for this link. */
function emitElemAttributes(
  e: AbstractElem & { attributes?: AttributeElem[] },
  ctx: EmitContext,
): void {
  emitAttributes(e.attributes, ctx);
  emitAttributes(ctx.addedAttributes?.get(e), ctx);
}

/** Emit a declared identifier with its optional `: type` annotation. */
function emitTypedDecl(name: TypedDeclElem, ctx: EmitContext): void {
  emitInlineLeading(name, ctx);
  emitDeclIdent(name.decl, ctx);
  if (name.typeRef) {
    ctx.srcBuilder.appendNext(": ");
    emitTypeRef(name.typeRef, ctx);
  }
  emitInlineTrailing(name, ctx);
}

/** Emit a struct member from its typed fields: `[attrs] name: type`. */
function emitMember(member: StructMemberElem, ctx: EmitContext): void {
  emitElemAttributes(member, ctx);
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
  emitElemAttributes(e, ctx);
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
  emitRootLeading(e, ctx);
  emitValueDecl(e, ctx);
  emitTrailingComments(e, ctx);
}

/** Emit newlines between root elements. */
function emitRootElemNl(ctx: EmitContext): void {
  ctx.srcBuilder.addNl();
  ctx.srcBuilder.addNl();
}

/** Leading comments for a root declaration, each on its own line. The inter-decl
 *  spacing already left us at a fresh line, so a newline follows each comment
 *  (rather than preceding it as in emitLeadingComments). */
function emitRootLeading(e: AbstractElemBase, ctx: EmitContext): void {
  for (const c of e.commentsBefore ?? []) {
    emitComment(c, ctx);
    newLine(ctx);
  }
}

/** Emit function explicitly to control commas between conditional parameters. */
function emitFn(e: FnElem, ctx: EmitContext): void {
  const { name, params, returnAttributes, returnType, body } = e;
  const { conditions, srcBuilder: builder } = ctx;

  emitElemAttributes(e, ctx);

  // Anchor `fn ` 3 chars before the name, where single-space `fn name` source
  // puts it. Unusual whitespace or a comment in the gap only shifts this
  // source-map anchor within the gap (never before the `fn` keyword, since at
  // least one blankspace separates it from the name).
  builder.add("fn ", name.start - 3);
  emitInlineLeading(name, ctx);
  emitDeclIdent(name, ctx);
  emitInlineTrailing(name, ctx);

  builder.appendNext("(");
  const validParams = filterValidElements(params, conditions);
  validParams.forEach((p, i) => {
    emitInlineLeading(p, ctx);
    emitElemAttributes(p, ctx);
    emitTypedDecl(p.name, ctx);
    emitInlineTrailing(p, ctx);
    if (i < validParams.length - 1) {
      builder.appendNext(", ");
    }
  });
  builder.appendNext(") ");

  if (returnType) {
    builder.appendNext("-> ");
    emitAttributes(returnAttributes, ctx);
    emitInlineLeading(returnType, ctx);
    emitTypeRef(returnType, ctx);
    builder.appendNext(" ");
  }

  emitBlock(body, ctx);
}

/** Trailing comments: kept on the element's line, after its text. */
function emitTrailingComments(e: AbstractElemBase, ctx: EmitContext): void {
  if (!e.commentsAfter) return;
  for (const c of e.commentsAfter) {
    ctx.srcBuilder.appendNext(" ");
    emitComment(c, ctx);
  }
}

/** Emit structs explicitly to control commas between conditional members. */
function emitStruct(e: StructElem, ctx: EmitContext): void {
  const { name, members, start } = e;
  const { srcBuilder, conditions } = ctx;

  const validMembers = filterValidElements(members, conditions);
  const validLength = validMembers.length;

  if (validLength === 0) {
    warnEmptyStruct(e);
    return;
  }

  emitElemAttributes(e, ctx);
  srcBuilder.add("struct ", start);
  emitInlineLeading(name, ctx);
  emitDeclIdent(name, ctx);
  emitInlineTrailing(name, ctx);

  // a member with attached comments forces the multi-line form (the one-line
  // `{ x: i32 }` form has nowhere to put an own-line comment)
  if (validLength === 1 && !hasComments(validMembers[0])) {
    srcBuilder.appendNext(" { ");
    emitMember(validMembers[0], ctx);
    srcBuilder.appendNext(" }");
    srcBuilder.addNl();
  } else {
    srcBuilder.appendNext(" {");
    srcBuilder.addNl();
    for (const m of validMembers) emitMemberLine(m, ctx);
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
    ctx.srcBuilder.add(builtinStr, e.start);
    return true;
  }

  if (kind === "@diagnostic") {
    const { severity, rule } = e.attribute;
    const diagStr = `@diagnostic${diagnosticControlToString(severity, rule)}`;
    ctx.srcBuilder.add(diagStr, e.start);
    return true;
  }

  if (kind === "@interpolate") {
    const params = e.attribute.params.map(v => v.name).join(", ");
    ctx.srcBuilder.add(`@interpolate(${params})`, e.start);
    return true;
  }

  assertUnreachable(kind);
}

function emitDirective(e: DirectiveElem, ctx: EmitContext): void {
  const { directive } = e;
  const { kind } = directive;
  if (kind === "diagnostic") {
    const diagStr = `diagnostic${diagnosticControlToString(directive.severity, directive.rule)};`;
    ctx.srcBuilder.add(diagStr, e.start);
  } else if (kind === "enable") {
    const exts = directive.extensions.map(v => v.name).join(", ");
    ctx.srcBuilder.add(`enable ${exts};`, e.start);
  } else if (kind === "requires") {
    const exts = directive.extensions.map(v => v.name).join(", ");
    ctx.srcBuilder.add(`requires ${exts};`, e.start);
  } else {
    assertUnreachable(kind);
  }
}

function displayName(declIdent: DeclIdent, bindings: LinkBindings): string {
  const name = outputName(declIdent, bindings);

  // every global the emitter reaches was mangled in the binding step
  assertThatDebug(
    name,
    `ERR: mangled name not found for decl ident ${identToString(declIdent)}`,
  );
  return name as string;
}

/** Leading comments on an inline node: block comments get a trailing space, line
 *  comments force a newline so the following code is not swallowed. */
function emitInlineLeading(e: AbstractElemBase, ctx: EmitContext): void {
  for (const c of e.commentsBefore ?? []) {
    emitComment(c, ctx);
    if (c.style === "line") newLine(ctx);
    else ctx.srcBuilder.appendNext(" ");
  }
}

function emitExpressionCore(e: ExpressionElem, ctx: EmitContext): void {
  const builder = ctx.srcBuilder;
  switch (e.kind) {
    case "literal":
      builder.add(e.value, e.start);
      return;
    case "ref":
      emitRefIdent(e, ctx);
      return;
    case "type":
      emitTypeRef(e, ctx);
      return;
    case "binary-expression": {
      const [start] = e.operator.span;
      emitExpression(e.left, ctx);
      builder.add(` ${e.operator.value} `, start);
      emitExpression(e.right, ctx);
      return;
    }
    case "unary-expression": {
      const { value, start } = e.operator;
      builder.add(value, start);
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
      builder.add("." + e.access.name, e.access.start);
      return;
    default:
      assertUnreachable(e);
  }
}

/** Trailing comments on an inline node: a leading space, plus a newline after a
 *  line comment so following code stays off its line. */
function emitInlineTrailing(e: AbstractElemBase, ctx: EmitContext): void {
  for (const c of e.commentsAfter ?? []) {
    ctx.srcBuilder.appendNext(" ");
    emitComment(c, ctx);
    if (c.style === "line") newLine(ctx);
  }
}

function emitAttributes(
  attributes: AttributeElem[] | undefined,
  ctx: EmitContext,
): void {
  attributes?.forEach(a => {
    emitInlineLeading(a, ctx);
    if (emitAttribute(a, ctx)) {
      emitInlineTrailing(a, ctx);
      ctx.srcBuilder.add(" ", a.start);
    }
  });
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
  emitElemAttributes(e, ctx);
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

/** Emit a comma-separated template argument list: <a, b, c>. */
function emitTemplateArgs(args: ExpressionElem[], ctx: EmitContext): void {
  ctx.srcBuilder.appendNext("<");
  args.forEach((a, i) => {
    if (i > 0) ctx.srcBuilder.appendNext(", ");
    emitExpression(a, ctx);
  });
  ctx.srcBuilder.appendNext(">");
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
  emitElemAttributes(e, ctx);
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
      emitInlineLeading(e.name, ctx);
      emitDeclIdent(e.name, ctx);
      emitInlineTrailing(e.name, ctx);
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

function emitComment(c: CommentElem, ctx: EmitContext): void {
  ctx.srcBuilder.add(c.srcModule.src.slice(c.start, c.end), c.start);
}

function warnEmptyStruct(e: StructElem): void {
  const { name, members } = e;
  const condStr = members.length ? "(with current conditions)" : "";
  const message = `struct '${name.ident.originalName}' has no members ${condStr}`;
  failIdentElem(name, message);
}

/** Whether an element carries any attached comments. */
function hasComments(e: AbstractElemBase): boolean {
  return !!(e.commentsBefore?.length || e.commentsAfter?.length);
}

/** Emit one struct member on its own line: leading comments above, `name: type,`,
 *  then trailing comments inline. */
function emitMemberLine(m: StructMemberElem, ctx: EmitContext): void {
  const builder = ctx.srcBuilder;
  for (const c of m.commentsBefore ?? []) {
    builder.appendNext("  ");
    emitComment(c, ctx);
    builder.addNl();
  }
  builder.appendNext("  ");
  emitMember(m, ctx);
  builder.appendNext(",");
  for (const c of m.commentsAfter ?? []) {
    builder.appendNext(" ");
    emitComment(c, ctx);
  }
  builder.addNl();
}

function emitStandardAttribute(e: AttributeElem, ctx: EmitContext): void {
  if (e.attribute.kind !== "@attribute") return;

  const { params } = e.attribute;
  if (!params || params.length === 0) {
    ctx.srcBuilder.add("@" + e.attribute.name, e.start);
    return;
  }

  ctx.srcBuilder.add("@" + e.attribute.name + "(", e.start);
  params.forEach((param, i) => {
    if (i > 0) ctx.srcBuilder.appendNext(", ");
    emitExpression(param.expression, ctx);
  });
  ctx.srcBuilder.add(")", params[params.length - 1].end);
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
  if (stmt.kind !== "block") emitElemAttributes(stmt, ctx);
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
    ctx.srcBuilder.add("_", e.lhs.span[0]);
  } else {
    emitExpression(e.lhs, ctx);
  }
  const [start] = e.op.span;
  ctx.srcBuilder.add(` ${e.op.value} `, start);
  emitExpression(e.rhs, ctx);
}
