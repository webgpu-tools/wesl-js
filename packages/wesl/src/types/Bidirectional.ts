import type {
  AbstractElem,
  AssignElem,
  ConstElem,
  ExpressionElem,
  FnElem,
  GlobalVarElem,
  LetElem,
  ModuleElem,
  OverrideElem,
  Statement,
  VarElem,
} from "../AbstractElems.ts";
import { convertible } from "./Conversions.ts";
import {
  resolveTypeRef,
  type TypeContext,
  typeOfExpr,
} from "./TypeSynthesis.ts";
import type { Type } from "./Types.ts";

/**
 * Bidirectional checking: where the surrounding context unambiguously expects
 * a type, push that expected type into the expression being checked.
 *
 * Expected types are introduced at a closed list of syntactic positions (the
 * RHS of an annotated let/var/const/override/gvar, a return value, and the RHS
 * of an assignment to a typed target) and never propagate through operators or
 * call arguments, so every rule stays local to one AST node.
 *
 * Strictly non-validating, like forward synthesis: an expression whose
 * synthesized type doesn't convert to the expected type keeps its synthesized
 * type rather than raising an error. The visible effect today is expected-type
 * materialization of abstract numerics (`let x: f32 = 1` checks the `1` as f32,
 * not the default i32); once generics land the same directional unification
 * resolves return-type-only type variables (`let n: f32 = snoise(v)`).
 */

type ValueDeclElem =
  | ConstElem
  | LetElem
  | VarElem
  | GlobalVarElem
  | OverrideElem;

/** Directionally check a synthesized type against an expected type: when the
 * synthesized type converts to the expected type, the expression takes the
 * expected type (this is where an abstract numeric materializes toward an
 * annotation). Non-validating: a non-convertible synthesized type is returned
 * unchanged. `unknown` expected types impose no expectation. */
export function checkType(synthesized: Type, expected: Type): Type {
  if (expected.kind === "unknown") return synthesized;
  return convertible(synthesized, expected) ? expected : synthesized;
}

/** Synthesize an expression's type, then check it against the expected type,
 * caching the checked result per link. */
export function checkExpr(
  expr: ExpressionElem,
  expected: Type,
  ctx: TypeContext,
): Type {
  const checked = checkType(typeOfExpr(expr, ctx), expected);
  ctx.bindings.checkedTypes.set(expr, checked);
  return checked;
}

/** The type of an expression accounting for its expected type from context,
 * falling back to forward synthesis where no expected type applies. Requires a
 * prior checkModule/checkFn pass to have populated the expected-type positions;
 * elsewhere it's identical to typeOfExpr. */
export function checkedTypeOf(expr: ExpressionElem, ctx: TypeContext): Type {
  return ctx.bindings.checkedTypes.get(expr) ?? typeOfExpr(expr, ctx);
}

/** Run bidirectional checking over every expected-type position in a module,
 * recording checked types for later lookup via checkedTypeOf(). */
export function checkModule(module: ModuleElem, ctx: TypeContext): void {
  for (const decl of module.decls) checkDecl(decl, ctx);
}

/** Run bidirectional checking over a single function's body. */
export function checkFn(fn: FnElem, ctx: TypeContext): void {
  const ret = fn.returnType ? resolveTypeRef(fn.returnType, ctx) : undefined;
  checkStatements(fn.body.body, ret, ctx);
}

function checkDecl(elem: AbstractElem, ctx: TypeContext): void {
  switch (elem.kind) {
    case "const":
    case "gvar":
    case "override":
    case "var":
      checkValueDecl(elem, ctx);
      break;
    case "fn":
      checkFn(elem, ctx);
      break;
    case "do":
      checkStatements(elem.body.body, undefined, ctx);
      break;
  }
}

/** `ret` is the enclosing function's return type, threaded to `return` values.
 * It flows through nested blocks but never into a call argument or a generic
 * body (WGSL has no nested functions, so no other boundary exists). */
function checkStatements(
  stmts: Statement[],
  ret: Type | undefined,
  ctx: TypeContext,
): void {
  for (const stmt of stmts) checkStatement(stmt, ret, ctx);
}

/** The RHS of an annotated value declaration expects the declared type. */
function checkValueDecl(elem: ValueDeclElem, ctx: TypeContext): void {
  const { typeRef } = elem.name;
  if (typeRef && elem.init)
    checkExpr(elem.init, resolveTypeRef(typeRef, ctx), ctx);
}

function checkStatement(
  stmt: Statement,
  ret: Type | undefined,
  ctx: TypeContext,
): void {
  switch (stmt.kind) {
    case "const":
    case "let":
    case "var":
      checkValueDecl(stmt, ctx);
      break;
    case "return":
      if (stmt.value && ret) checkExpr(stmt.value, ret, ctx);
      break;
    case "assign":
      checkAssign(stmt, ctx);
      break;
    case "block":
      checkStatements(stmt.body, ret, ctx);
      break;
    case "if":
      checkStatements(stmt.body.body, ret, ctx);
      if (stmt.else) checkStatement(stmt.else, ret, ctx);
      break;
    case "for":
      if (stmt.init) checkStatement(stmt.init, ret, ctx);
      if (stmt.update) checkStatement(stmt.update, ret, ctx);
      checkStatements(stmt.body.body, ret, ctx);
      break;
    case "while":
      checkStatements(stmt.body.body, ret, ctx);
      break;
    case "loop":
      checkStatements(stmt.body.body, ret, ctx);
      if (stmt.continuing) checkStatements(stmt.continuing.body.body, ret, ctx);
      break;
    case "switch":
      for (const clause of stmt.clauses)
        checkStatements(clause.body.body, ret, ctx);
      break;
  }
}

/** A plain `x = e` assignment expects the target's declared type. Compound
 * assignments (`+=` etc.) have their own operator conversion rules and phony
 * `_ = e` has no target type, so both are left to forward synthesis. */
function checkAssign(stmt: AssignElem, ctx: TypeContext): void {
  if (stmt.op.value !== "=" || stmt.lhs.kind === "phony") return;
  const target = typeOfExpr(stmt.lhs, ctx);
  if (target.kind !== "unknown") checkExpr(stmt.rhs, target, ctx);
}
