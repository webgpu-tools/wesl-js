import type {
  ConstElem,
  ExpressionElem,
  FunctionCallExpression,
} from "../AbstractElems.ts";
import { refDecl } from "../BindIdents.ts";
import type { DeclIdent } from "../Scope.ts";
import { builtinValue } from "./ConstBuiltins.ts";
import { constructValue, isConstructorName } from "./ConstConstructors.ts";
import { binaryOp, unaryOp } from "./ConstOperators.ts";
import {
  boolValue,
  type ConstValue,
  convertValue,
  literalValue,
  scalarToNumber,
} from "./ConstValues.ts";
import { isSwizzle } from "./OpNames.ts";
import {
  calleeIdent,
  resolveTypeRef,
  type TypeContext,
  typeOfDecl,
  typeOfExpr,
} from "./TypeSynthesis.ts";
import { vecType } from "./Types.ts";

/**
 * WGSL const-expression evaluator.
 *
 * Walks an expression, dispatching to the operator, constructor, and builtin
 * evaluators once the operands are values (see ConstValues.ts for the value
 * model and its numeric rules).
 *
 * Returns null for anything not const-evaluable (runtime values, user
 * function calls, unsupported builtins) rather than raising errors.
 *
 * Mutually recursive with TypeSynthesis (a constructor's value needs its
 * resolved type; an array count is an expression inside a type); see the
 * import cycle note there.
 */

const swizzleIndex: Record<string, number> = {
  x: 0,
  y: 1,
  z: 2,
  w: 3,
  r: 0,
  g: 1,
  b: 2,
  a: 3,
};

/** Evaluate a const-expression, or null if it isn't const-evaluable. */
export function evalConstExpr(
  expr: ExpressionElem,
  ctx: TypeContext,
): ConstValue | null {
  switch (expr.kind) {
    case "literal":
      return literalValue(expr.value);
    case "ref": {
      const decl = refDecl(expr.ident, ctx.bindings);
      const declElem = decl?.declElem;
      if (!decl || declElem?.kind !== "const") return null;
      return constDeclValue(decl, declElem, ctx);
    }
    case "parenthesized-expression":
      return evalConstExpr(expr.expression, ctx);
    case "unary-expression": {
      const operand = evalConstExpr(expr.expression, ctx);
      return operand && unaryOp(expr.operator.value, operand);
    }
    case "binary-expression": {
      const op = expr.operator.value;
      const left = evalConstExpr(expr.left, ctx);
      if (left?.kind === "scalar" && typeof left.value === "boolean") {
        if (op === "&&" && !left.value) return boolValue(false);
        if (op === "||" && left.value) return boolValue(true);
      }
      const right = evalConstExpr(expr.right, ctx);
      if (!left || !right) return null;
      return binaryOp(op, left, right);
    }
    case "component-expression": {
      const base = evalConstExpr(expr.base, ctx);
      const index = evalConstExpr(expr.access, ctx);
      const i = index && scalarToNumber(index);
      if (base?.kind !== "composite" || i === undefined || i === null)
        return null;
      return base.elements[i] ?? null;
    }
    case "component-member-expression": {
      const base = evalConstExpr(expr.base, ctx);
      return base ? memberValue(base, expr.access.name) : null;
    }
    case "call-expression":
      return callValue(expr, ctx);
    default:
      return null;
  }
}

/** Value of a `const` declaration (converted to its annotated type, if any). */
function constDeclValue(
  decl: DeclIdent,
  elem: ConstElem,
  ctx: TypeContext,
): ConstValue | null {
  const { visitingConsts } = ctx.bindings;
  if (visitingConsts.has(decl)) return null; // cycle in erroneous source
  visitingConsts.add(decl);
  try {
    const value = elem.init && evalConstExpr(elem.init, ctx);
    if (!value) return null;
    const { typeRef } = elem.name;
    return typeRef ? convertValue(value, resolveTypeRef(typeRef, ctx)) : value;
  } finally {
    visitingConsts.delete(decl);
  }
}

/** Struct member access, or a vector swizzle (which may build a new vector). */
function memberValue(base: ConstValue, name: string): ConstValue | null {
  if (base.kind !== "composite") return null;
  const { type } = base;
  if (type.kind === "struct") {
    const index = type.members.findIndex(m => m.name === name);
    return index >= 0 ? (base.elements[index] ?? null) : null;
  }
  if (type.kind === "vector" && isSwizzle(name)) {
    const picked = [...name].map(c => base.elements[swizzleIndex[c]]);
    if (picked.some(p => !p)) return null;
    if (picked.length === 1) return picked[0];
    const resultType = vecType(picked.length as 2 | 3 | 4, type.elem);
    return { kind: "composite", type: resultType, elements: picked };
  }
  return null;
}

/** A call expression: type/struct/alias constructor or a builtin (user fns aren't const). */
function callValue(
  call: FunctionCallExpression,
  ctx: TypeContext,
): ConstValue | null {
  const fn = call.function;
  const ident = calleeIdent(fn);
  const args = call.arguments.map(a => evalConstExpr(a, ctx));

  const decl = refDecl(ident, ctx.bindings);
  if (decl) {
    const kind = decl.declElem?.kind;
    if (kind === "struct" || kind === "alias")
      return constructValue(typeOfDecl(decl, ctx), args);
    return null; // user function calls aren't const-evaluable
  }

  const name = ident.originalName;
  if (name === "bitcast") return null; // TODO bitcast is @const in the spec
  if (fn.kind === "type") return constructValue(resolveTypeRef(fn, ctx), args);
  if (isConstructorName(name))
    return constructValue(typeOfExpr(call, ctx), args);
  return builtinValue(name, args);
}
