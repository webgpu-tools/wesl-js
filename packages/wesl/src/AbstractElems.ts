import type { DeclIdent, RefIdent, Scope, SrcModule } from "./Scope.ts";
import type { Span } from "./Span.ts";

/**
 * AST structures describing 'interesting' parts of WESL source.
 *
 * Parts needing further analysis are pulled into these structures.
 * Uninteresting parts are 'TextElem' nodes, copied to output WGSL.
 */
export type AbstractElem = GrammarElem | SyntheticElem | ExpressionElem;

export type GrammarElem = ContainerElem | TerminalElem | DoBlockElem;

export type ContainerElem =
  | AttributeElem
  | AliasElem
  | ConstAssertElem
  | ConstElem
  | UnknownExpressionElem
  | SimpleMemberRef
  | FnElem
  | TypedDeclElem
  | GlobalVarElem
  | LetElem
  | ModuleElem
  | OverrideElem
  | FnParamElem
  | StructElem
  | StructMemberElem
  | StuffElem
  | TypeRefElem
  | VarElem
  | Statement
  | SwitchClauseElem;

/** Map from element kind string to element type, for type-safe element construction. */
export type ElemKindMap = {
  alias: AliasElem;
  assert: ConstAssertElem;
  block: BlockElem;
  const: ConstElem;
  continuing: ContinuingElem;
  if: IfElem;
  for: ForElem;
  while: WhileElem;
  loop: LoopElem;
  switch: SwitchElem;
  return: ReturnElem;
  break: BreakElem;
  continue: ContinueElem;
  discard: DiscardElem;
  assign: AssignElem;
  increment: IncrementElem;
  decrement: DecrementElem;
  call: CallElem;
  empty: EmptyElem;
  gvar: GlobalVarElem;
  let: LetElem;
  member: StructMemberElem;
  override: OverrideElem;
  param: FnParamElem;
  struct: StructElem;
  "switch-clause": SwitchClauseElem;
  type: TypeRefElem;
  var: VarElem;
};

/** Inspired by https://github.com/webgpu-tools/wesl-rs/blob/3b2434eac1b2ebda9eb8bfb25f43d8600d819872/crates/wgsl-parse/src/syntax.rs#L364 */
export type ExpressionElem =
  | Literal
  | RefIdentElem
  | TypeRefElem // template_elaborated_ident is a primary_expression
  | ParenthesizedExpression
  | ComponentExpression
  | ComponentMemberExpression
  | UnaryExpression
  | BinaryExpression
  | FunctionCallExpression;

export type TerminalElem =
  | DirectiveElem
  | DeclIdentElem //
  | NameElem
  | RefIdentElem
  | TextElem
  | ImportElem;

export type GlobalDeclarationElem =
  | AliasElem
  | ConstElem
  | DoBlockElem
  | FnElem
  | GlobalVarElem
  | OverrideElem
  | StructElem;

export type DeclarationElem =
  | GlobalDeclarationElem
  | FnParamElem
  | VarElem
  | LetElem;

export type ElemWithAttributes = Extract<AbstractElem, HasAttributes>;

export interface AbstractElemBase {
  kind: AbstractElem["kind"];
  start: number;
  end: number;
}

export interface ElemWithContentsBase extends AbstractElemBase {
  contents: AbstractElem[];
}

export interface HasAttributes {
  attributes?: AttributeElem[];
}

/* ------   Terminal Elements  (don't contain other elements)  ------   */

/** Raw text copied to linked WGSL (e.g., 'var' or '@diagnostic(off,derivative_uniformity)'). */
export interface TextElem extends AbstractElemBase {
  kind: "text";
  srcModule: SrcModule;
}

/** A name that doesn't need to be an Ident (e.g., struct member, diagnostic rule). */
export interface NameElem extends AbstractElemBase {
  kind: "name";
  name: string;
}

/** an identifier that 'refers to' a declaration (aka a symbol reference) */
export interface RefIdentElem extends AbstractElemBase {
  kind: RefIdent["kind"];
  ident: RefIdent;
  srcModule: SrcModule;
}

/** a declaration identifier (aka a symbol declaration) */
export interface DeclIdentElem extends AbstractElemBase {
  kind: DeclIdent["kind"];
  ident: DeclIdent;
  srcModule: SrcModule;
}

/** Holds an import statement, and has a span */
export interface ImportElem extends AbstractElemBase, HasAttributes {
  kind: "import";
  imports: ImportStatement;
}

/** Tree-shaped import statement: `import foo::bar::{baz, cat as neko};` */
export interface ImportStatement {
  kind: "import-statement";
  segments: ImportSegment[];
  finalSegment: ImportCollection | ImportItem;
}

/** A segment in an import path: `foo` in `foo::bar`. */
export interface ImportSegment {
  kind: "import-segment";
  name: string;
}

/** A collection of import trees: `{baz, cat as neko}`. */
export interface ImportCollection {
  kind: "import-collection";
  subtrees: ImportStatement[];
}

/** A renamed item at the end of an import statement: `cat as neko`. */
export interface ImportItem {
  kind: "import-item";
  name: string;
  as?: string;
}

/* ------   Synthetic element (for transformations, not from grammar)  ------   */

/** Generated element produced after parsing and binding. */
export interface SyntheticElem {
  kind: "synthetic";
  text: string;
}

/* ------   Container Elements  (contain other elements)  ------   */

/** A declaration identifier with an optional type. */
export interface TypedDeclElem extends ElemWithContentsBase {
  kind: "typeDecl";
  decl: DeclIdentElem;
  typeRef?: TypeRefElem; // LATER Consider a variant for fn params and alias where typeRef is required
  typeScope?: Scope;
}

/** An alias statement. */
export interface AliasElem extends ElemWithContentsBase, HasAttributes {
  kind: "alias";
  name: DeclIdentElem;
  typeRef: TypeRefElem;
}

/** An attribute like '@compute' or '@binding(0)'. */
export interface AttributeElem extends ElemWithContentsBase {
  kind: "attribute";
  attribute: Attribute;
}

export type Attribute =
  | StandardAttribute
  | InterpolateAttribute
  | BuiltinAttribute
  | DiagnosticAttribute
  | IfAttribute
  | ElifAttribute
  | ElseAttribute;

export interface StandardAttribute {
  kind: "@attribute";
  name: string;
  params?: UnknownExpressionElem[];
}

export interface InterpolateAttribute {
  kind: "@interpolate";
  params: NameElem[];
}

export interface BuiltinAttribute {
  kind: "@builtin";
  param: NameElem;
}

export type DiagnosticRule = [NameElem, NameElem | null];

export interface DiagnosticAttribute {
  kind: "@diagnostic";
  severity: NameElem;
  rule: DiagnosticRule;
}

export interface IfAttribute {
  kind: "@if";
  param: TranslateTimeExpressionElem;
}

export interface ElifAttribute {
  kind: "@elif";
  param: TranslateTimeExpressionElem;
}

export interface ElseAttribute {
  kind: "@else";
}

export type ConditionalAttribute = IfAttribute | ElifAttribute | ElseAttribute;

/** A const_assert statement. */
export interface ConstAssertElem extends ElemWithContentsBase, HasAttributes {
  kind: "assert";
}

/** A const declaration. */
export interface ConstElem extends ElemWithContentsBase, HasAttributes {
  kind: "const";
  name: TypedDeclElem;
  init?: ExpressionElem;
}

/** An expression without special handling, used in attribute parameters. */
export interface UnknownExpressionElem extends ElemWithContentsBase {
  kind: "expression";
}

/** An expression that can be safely evaluated at compile time. */
export interface TranslateTimeExpressionElem {
  kind: "translate-time-expression";
  expression: ExpressionElem;
  start: number;
  end: number;
}

/** A literal value (boolean or number) in WESL source. */
export interface Literal extends AbstractElemBase {
  kind: "literal";
  value: string;
}

/** (expr) */
export interface ParenthesizedExpression extends AbstractElemBase {
  kind: "parenthesized-expression";
  expression: ExpressionElem;
}

/** `foo[expr]` */
export interface ComponentExpression extends AbstractElemBase {
  kind: "component-expression";
  base: ExpressionElem;
  access: ExpressionElem;
}

/** `foo.member` */
export interface ComponentMemberExpression extends AbstractElemBase {
  kind: "component-member-expression";
  base: ExpressionElem;
  access: NameElem;
}

/** `+foo` */
export interface UnaryExpression extends AbstractElemBase {
  kind: "unary-expression";
  operator: UnaryOperator;
  expression: ExpressionElem;
}

/** `foo + bar` */
export interface BinaryExpression extends AbstractElemBase {
  kind: "binary-expression";
  operator: BinaryOperator;
  left: ExpressionElem;
  right: ExpressionElem;
}

/** `foo<T>(arg, arg)` */
export interface FunctionCallExpression extends AbstractElemBase {
  kind: "call-expression";
  function: RefIdentElem | TypeRefElem; // template_elaborated_ident
  /** Only populated for function calls; constructor calls carry templates on `function`. */
  templateArgs?: TypeTemplateParameter[];
  arguments: ExpressionElem[];
}

export interface UnaryOperator {
  value: "!" | "&" | "*" | "-" | "~";
  start: number;
  end: number;
}

/** Uses span (not inline start/end) so each operator object stays in a smaller
 * V8 size class. Inline start/end uses slightly less memory overall (no separate
 * span tuple) but each object is bigger and more likely to be promoted to old
 * gen under sustained allocation pressure, triggering more major GCs and
 * ~5% slower wall time on math-heavy parse workloads (bevy_env_map/parse).
 * A rare case where allocating more bytes wins on GC. */
export interface BinaryOperator {
  value:
    | ("||" | "&&" | "+" | "-" | "*" | "/" | "%" | "==")
    | ("!=" | "<" | "<=" | ">" | ">=" | "|" | "&" | "^")
    | ("<<" | ">>");
  span: Span;
}

export type DirectiveVariant =
  | DiagnosticDirective
  | EnableDirective
  | RequiresDirective;

export interface DirectiveElem extends AbstractElemBase, HasAttributes {
  kind: "directive";
  directive: DirectiveVariant;
}

export interface DiagnosticDirective {
  kind: "diagnostic";
  severity: NameElem;
  rule: [NameElem, NameElem | null];
}

export interface EnableDirective {
  kind: "enable";
  extensions: NameElem[];
}

export interface RequiresDirective {
  kind: "requires";
  extensions: NameElem[];
}

/**
 * A `do` block: a CPU-side dispatch script (`do name(params) { ... }`).
 *
 * Module-local: its name and body idents never enter bindIdents/the scope
 * tree, and the linker drops it entirely from emitted WGSL. The parsed body
 * is retained for the interpreter, which resolves names by AST match.
 */
export interface DoBlockElem extends AbstractElemBase, HasAttributes {
  kind: "do";
  name: NameElem;
  params: FnParamElem[];
  body: BlockElem;
  attributes?: AttributeElem[];
}

/** A function declaration. */
export interface FnElem extends ElemWithContentsBase, HasAttributes {
  // LATER doesn't need contents
  kind: "fn";
  name: DeclIdentElem;
  params: FnParamElem[];
  body: BlockElem;
  returnAttributes?: AttributeElem[];
  returnType?: TypeRefElem;
}

/** A global variable declaration (at the root level). */
export interface GlobalVarElem extends ElemWithContentsBase, HasAttributes {
  kind: "gvar";
  name: TypedDeclElem;
}

/** An entire file. */
export interface ModuleElem extends ElemWithContentsBase {
  kind: "module";
}

/** An override declaration. */
export interface OverrideElem extends ElemWithContentsBase, HasAttributes {
  kind: "override";
  name: TypedDeclElem;
}

/** A parameter in a function declaration. */
export interface FnParamElem extends ElemWithContentsBase, HasAttributes {
  kind: "param";
  name: TypedDeclElem;
}

/** Simple struct references like `myStruct.bar` (for binding struct transforms). */
export interface SimpleMemberRef extends ElemWithContentsBase {
  kind: "memberRef";
  name: RefIdentElem;
  member: NameElem;
  extraComponents?: StuffElem;
}

/** A struct declaration. */
export interface StructElem extends ElemWithContentsBase, HasAttributes {
  kind: "struct";
  name: DeclIdentElem;
  members: StructMemberElem[];
  bindingStruct?: true; // used later during binding struct transformation
}

/** Generic container of other elements. */
export interface StuffElem extends ElemWithContentsBase {
  kind: "stuff";
}

/** A struct declaration marked as a binding struct. */
export interface BindingStructElem extends StructElem {
  bindingStruct: true;
  entryFn?: FnElem;
}

/** A member of a struct declaration. */
export interface StructMemberElem extends ElemWithContentsBase, HasAttributes {
  kind: "member";
  name: NameElem;
  typeRef: TypeRefElem;
  mangledVarName?: string; // root name if transformed to a var (for binding struct transformation)
}

export type TypeTemplateParameter = ExpressionElem;

/** A type reference like 'f32', 'MyStruct', or 'ptr<storage, array<f32>, read_only>'. */
export interface TypeRefElem extends ElemWithContentsBase {
  kind: "type";
  name: RefIdent;
  templateParams?: TypeTemplateParameter[];
}

/** A variable declaration. */
export interface VarElem extends ElemWithContentsBase, HasAttributes {
  kind: "var";
  name: TypedDeclElem;
  init?: ExpressionElem;
}

export interface LetElem extends ElemWithContentsBase, HasAttributes {
  kind: "let";
  name: TypedDeclElem;
  init?: ExpressionElem;
}

/* ------   Statement Elements  ------ */

/** Any WGSL statement inside a function or block body. */
export type Statement =
  | BlockElem
  | IfElem
  | ForElem
  | WhileElem
  | LoopElem
  | ContinuingElem
  | SwitchElem
  | ReturnElem
  | BreakElem
  | ContinueElem
  | DiscardElem
  | AssignElem
  | IncrementElem
  | DecrementElem
  | CallElem
  | ConstAssertElem
  | EmptyElem
  | VarElem
  | LetElem
  | ConstElem;

/** A bare `;` statement. Spans the `;` and emits nothing; kept so the parent's
 * gap-filling does not re-insert a `;` of its own. */
export interface EmptyElem extends ElemWithContentsBase, HasAttributes {
  kind: "empty";
}

/** A `{ ... }` compound statement. */
export interface BlockElem extends ElemWithContentsBase, HasAttributes {
  kind: "block";
  body: Statement[];
}

/** An if / else-if / else chain. `else` nests: else-if is an IfElem, plain else a BlockElem. */
export interface IfElem extends ElemWithContentsBase, HasAttributes {
  kind: "if";
  condition: ExpressionElem;
  body: BlockElem;
  else?: IfElem | BlockElem;
}

/** A for loop. */
export interface ForElem extends ElemWithContentsBase, HasAttributes {
  kind: "for";
  init?: ForInit;
  condition?: ExpressionElem;
  update?: ForUpdate;
  body: BlockElem;
}

type ForInit =
  | VarElem
  | LetElem
  | ConstElem
  | AssignElem
  | IncrementElem
  | DecrementElem
  | CallElem;
type ForUpdate = AssignElem | IncrementElem | DecrementElem | CallElem;

/** A while loop. */
export interface WhileElem extends ElemWithContentsBase, HasAttributes {
  kind: "while";
  condition: ExpressionElem;
  body: BlockElem;
}

/** A loop, optionally ending with a continuing block. */
export interface LoopElem extends ElemWithContentsBase, HasAttributes {
  kind: "loop";
  body: BlockElem;
  continuing?: ContinuingElem;
}

/** A continuing block, optionally ending with `break if expr`. */
export interface ContinuingElem extends ElemWithContentsBase, HasAttributes {
  kind: "continuing";
  body: BlockElem;
  breakIf?: ExpressionElem;
}

/** A switch statement. */
export interface SwitchElem extends ElemWithContentsBase, HasAttributes {
  kind: "switch";
  selector: ExpressionElem;
  clauses: SwitchClauseElem[];
}

/** A case or default clause. `"default"` sentinel marks the default selector. */
export interface SwitchClauseElem extends ElemWithContentsBase, HasAttributes {
  kind: "switch-clause";
  selectors: (ExpressionElem | "default")[];
  body: BlockElem;
}

/** A return statement, with an optional value. */
export interface ReturnElem extends ElemWithContentsBase, HasAttributes {
  kind: "return";
  value?: ExpressionElem;
}

/** A break statement, or `break if expr`. */
export interface BreakElem extends ElemWithContentsBase, HasAttributes {
  kind: "break";
  condition?: ExpressionElem;
}

export interface ContinueElem extends ElemWithContentsBase, HasAttributes {
  kind: "continue";
}

export interface DiscardElem extends ElemWithContentsBase, HasAttributes {
  kind: "discard";
}

/** Assignment, compound assignment, or phony `_ = expr`. */
export interface AssignElem extends ElemWithContentsBase, HasAttributes {
  kind: "assign";
  lhs: ExpressionElem | PhonyTarget;
  op: AssignOp;
  rhs: ExpressionElem;
}

/** `i++` */
export interface IncrementElem extends ElemWithContentsBase, HasAttributes {
  kind: "increment";
  target: ExpressionElem;
}

/** `i--` */
export interface DecrementElem extends ElemWithContentsBase, HasAttributes {
  kind: "decrement";
  target: ExpressionElem;
}

/** A bare function call statement. */
export interface CallElem extends ElemWithContentsBase, HasAttributes {
  kind: "call";
  call: FunctionCallExpression;
}

/** The `_` discard target of a phony assignment; never enters the ident system. */
export interface PhonyTarget {
  kind: "phony";
  span: Span;
}

/** An assignment operator. Uses a span tuple (not inline start/end) to match
 * BinaryOperator's smaller V8 size class; see the note there. */
export interface AssignOp {
  value:
    | ("=" | "+=" | "-=" | "*=" | "/=" | "%=")
    | ("&=" | "|=" | "^=" | "<<=" | ">>=");
  span: Span;
}
