import type {
  BinaryExpression,
  ExpressionElem,
  FunctionCallExpression,
  RefIdentElem,
  StructElem,
  TypedDeclElem,
  TypeRefElem,
  TypeTemplateParameter,
  UnaryExpression,
} from "../AbstractElems.ts";
import { type LinkBindings, refDecl } from "../BindIdents.ts";
import { filterValidElements } from "../Conditions.ts";
import type { Conditions, DeclIdent, RefIdent } from "../Scope.ts";
import { builtinFnType } from "./BuiltinSignatures.ts";
import { evalConstExpr } from "./ConstEval.ts";
import { scalarToNumber } from "./ConstValues.ts";
import { commonType, concretize } from "./Conversions.ts";
import { comparisonOps, isSwizzle } from "./OpNames.ts";
import {
  abstractFloat,
  abstractInt,
  arrayType,
  boolType,
  elemScalar,
  f16Type,
  f32Type,
  i32Type,
  matType,
  type ScalarType,
  type StructType,
  type TextureType,
  type Type,
  u32Type,
  unknownType,
  vecType,
  voidType,
} from "./Types.ts";

/**
 * Forward type synthesis: "what type is this expression?"
 *
 * Runs on demand after binding, over the conditioned view of a module
 * (@if-filtered per the link's conditions). Results are recorded in the
 * per-link bindings table, so they never go stale across links with
 * different conditions. Synthesis is unknown-tolerant rather than
 * validating: anything it can't determine is `unknown`, never an error.
 *
 * Mutually recursive with ConstEval: an array count is an expression inside
 * a type (`array<f32, N * 2>`), and a constructor's value needs its resolved
 * type. Each module only calls the other from a function body, never at
 * module init, so the import cycle is safe to load in either order.
 */
export interface TypeContext {
  /** per-link binding facts; also holds the type caches */
  bindings: LinkBindings;

  /** conditions for this link (@if filtering of struct members) */
  conditions?: Conditions;
}

const scalarNames: Record<string, ScalarType> = {
  bool: boolType,
  i32: i32Type,
  u32: u32Type,
  f32: f32Type,
  f16: f16Type,
};

const suffixElems: Record<string, ScalarType> = {
  f: f32Type,
  h: f16Type,
  i: i32Type,
  u: u32Type,
};

/** The synthesized type of an expression, cached per link. */
export function typeOfExpr(expr: ExpressionElem, ctx: TypeContext): Type {
  const cached = ctx.bindings.expressionTypes.get(expr);
  if (cached) return cached;
  const found = exprType(expr, ctx);
  ctx.bindings.expressionTypes.set(expr, found);
  return found;
}

/** The declared or initializer-derived type of a declaration, cached per link.
 * `let`, `var`, and `override` initializers materialize abstract numerics to
 * their defaults; `const` keeps abstract types. */
export function typeOfDecl(decl: DeclIdent, ctx: TypeContext): Type {
  const cached = ctx.bindings.declTypes.get(decl);
  if (cached) return cached;
  const { visitingDecls } = ctx.bindings;
  if (visitingDecls.has(decl)) return unknownType; // cycle in erroneous source
  visitingDecls.add(decl);
  try {
    const found = declType(decl, ctx);
    ctx.bindings.declTypes.set(decl, found);
    return found;
  } finally {
    visitingDecls.delete(decl);
  }
}

/** Resolve a syntactic type reference to a semantic type, cached per link
 * (user structs and aliases via bindings, WGSL predeclared types by name).
 * A TypeRefElem is an ExpressionElem, so it shares the expressionTypes cache;
 * predeclared types need it most, as they rebuild nested templates like
 * array<vec4<f32>, 8> from scratch on every call. */
export function resolveTypeRef(typeRef: TypeRefElem, ctx: TypeContext): Type {
  const cached = ctx.bindings.expressionTypes.get(typeRef);
  if (cached) return cached;
  const decl = refDecl(typeRef.name, ctx.bindings);
  const found = decl
    ? typeOfDecl(decl, ctx)
    : stdTypeRef(typeRef.name.originalName, typeRef.templateParams, ctx);
  ctx.bindings.expressionTypes.set(typeRef, found);
  return found;
}

/** The callee ident of a call expression, which parses as a type reference
 * when it has template params (`vec3<f32>(..)`) and as a plain name reference
 * otherwise. Shared with ConstEval. */
export function calleeIdent(fn: RefIdentElem | TypeRefElem): RefIdent {
  return fn.kind === "type" ? fn.name : fn.ident;
}

/** @return the type of an expression (uncached) */
function exprType(expr: ExpressionElem, ctx: TypeContext): Type {
  switch (expr.kind) {
    case "literal":
      return literalType(expr.value);
    case "ref": {
      const decl = refDecl(expr.ident, ctx.bindings);
      return decl ? typeOfDecl(decl, ctx) : unknownType;
    }
    case "type":
      return resolveTypeRef(expr, ctx);
    case "parenthesized-expression":
      return typeOfExpr(expr.expression, ctx);
    case "component-expression":
      return indexType(typeOfExpr(expr.base, ctx));
    case "component-member-expression":
      return memberType(typeOfExpr(expr.base, ctx), expr.access.name, ctx);
    case "unary-expression":
      return unaryType(expr, ctx);
    case "binary-expression":
      return binaryType(expr, ctx);
    case "call-expression":
      return callType(expr, ctx);
  }
}

function declType(decl: DeclIdent, ctx: TypeContext): Type {
  const elem = decl.declElem;
  if (!elem) return unknownType;
  switch (elem.kind) {
    case "struct":
      return structType(elem, ctx);
    case "alias":
      return resolveTypeRef(elem.typeRef, ctx);
    case "const":
      return valueDeclType(elem.name, elem.init, ctx, false);
    case "let":
    case "var":
    case "gvar":
    case "override":
      return valueDeclType(elem.name, elem.init, ctx, true);
    case "param":
      return valueDeclType(elem.name, undefined, ctx, true);
    default:
      return unknownType; // fn (call sites use returnType) and do blocks
  }
}

/** A WGSL predeclared type name (with template params) as a semantic type. */
function stdTypeRef(
  name: string,
  params: TypeTemplateParameter[] | undefined,
  ctx: TypeContext,
): Type {
  const scalar = scalarNames[name];
  if (scalar) return scalar;
  const vecMat = vecMatType(name, () => templateScalar(params?.[0], ctx));
  if (vecMat) return vecMat;

  if (name === "array") {
    const elem = params?.[0] && typeFromTemplateParam(params[0], ctx);
    if (!elem) return unknownType;
    const count = params?.[1] && constCount(params[1], ctx);
    return arrayType(elem, count);
  }
  if (name === "atomic") {
    const elem = templateScalar(params?.[0], ctx);
    return elem ? { kind: "atomic", elem } : unknownType;
  }
  if (name === "ptr") {
    const space = enumerantName(params?.[0]) ?? "function";
    const elem = params?.[1] && typeFromTemplateParam(params[1], ctx);
    const access = enumerantName(params?.[2]);
    if (!elem) return unknownType;
    return access
      ? { kind: "ptr", space, elem, access }
      : { kind: "ptr", space, elem };
  }
  if (name.startsWith("texture_")) return textureTypeRef(name, params, ctx);
  if (name === "sampler") return { kind: "sampler", comparison: false };
  if (name === "sampler_comparison")
    return { kind: "sampler", comparison: true };
  return unknownType;
}

/** Untyped literals are abstract: `1` is abstract-int, `1.0` abstract-float. */
function literalType(text: string): Type {
  if (text === "true" || text === "false") return boolType;

  const suffix = text[text.length - 1];
  if (suffix === "i") return i32Type;
  if (suffix === "u") return u32Type;

  const hex = text[0] === "0" && (text[1] === "x" || text[1] === "X");
  // a trailing f/h on a hex int is a hex digit, not a suffix; an f/h suffix
  // is legal only on a hex float that spells an exponent with p
  const floatSuffix = !hex || /[pP]/.test(text);
  if (suffix === "h" && floatSuffix) return f16Type;
  if (suffix === "f" && floatSuffix) return f32Type;
  if (hex) return /[pP.]/.test(text) ? abstractFloat : abstractInt;
  return /[.eE]/.test(text) ? abstractFloat : abstractInt;
}

/** Type of `base[i]`: array element, vector element, or matrix column. */
function indexType(base: Type): Type {
  switch (base.kind) {
    case "array":
    case "vector":
      return base.elem;
    case "matrix":
      return vecType(base.rows, base.elem);
    case "ptr": // pointer composite access: p[i] means (*p)[i]
      return indexType(base.elem);
    default:
      return unknownType;
  }
}

/** Type of `base.name`: struct member access or vector swizzle. */
function memberType(base: Type, name: string, ctx: TypeContext): Type {
  if (base.kind === "struct") {
    const member = base.members.find(m => m.name === name);
    return member?.type ?? unknownType;
  }
  if (base.kind === "vector" && isSwizzle(name)) {
    if (name.length === 1) return base.elem;
    return vecType(name.length as 2 | 3 | 4, base.elem);
  }
  if (base.kind === "ptr") return memberType(base.elem, name, ctx);
  return unknownType;
}

/** Type of a unary expression: `&x`, `*p`, or the type-preserving -, !, ~. */
function unaryType(expr: UnaryExpression, ctx: TypeContext): Type {
  const op = expr.operator.value;
  if (op === "&") {
    const pointee = typeOfExpr(expr.expression, ctx);
    if (pointee.kind === "unknown") return unknownType;
    const space = addressSpaceOf(expr.expression, ctx);
    return { kind: "ptr", space, elem: pointee };
  }
  const operand = typeOfExpr(expr.expression, ctx);
  if (op === "*") return operand.kind === "ptr" ? operand.elem : unknownType;
  return operand;
}

/** Type of a binary expression: bool for logicals and comparisons (vector
 * comparisons are componentwise), the left operand for shifts, else arithmetic. */
function binaryType(expr: BinaryExpression, ctx: TypeContext): Type {
  const op = expr.operator.value;
  if (op === "&&" || op === "||") return boolType;

  const left = typeOfExpr(expr.left, ctx);
  const right = typeOfExpr(expr.right, ctx);
  if (comparisonOps.includes(op)) {
    if (left.kind === "vector") return vecType(left.size, boolType);
    if (right.kind === "vector") return vecType(right.size, boolType);
    // an unknown operand may be a vector, leaving the result shape
    // undecidable: bool or vecN<bool>?
    if (left.kind === "unknown" || right.kind === "unknown") return unknownType;
    return boolType;
  }
  if (op === "<<" || op === ">>") return left;
  return arithmeticType(op, left, right);
}

/**
 * Type of a call expression. WGSL spells several different things as
 * `f(args)`, distinguished here by what the callee name resolves to:
 * - a user `fn` declaration: its declared return type (void if none)
 * - a user struct or alias: a constructor, yielding the declared type
 * - `bitcast<T>(x)`: the template type T
 * - a templated predeclared type: `vec3<f32>(..)`, `array<f32, 4>(..)`
 * - a bare predeclared name: an inferred constructor `vec2(1, 2)`,
 *   or failing that a builtin function like `max(a, b)`
 */
function callType(call: FunctionCallExpression, ctx: TypeContext): Type {
  const decl = refDecl(calleeIdent(call.function), ctx.bindings);
  return decl ? declCallType(decl, ctx) : stdCallType(call, ctx);
}

/** Struct semantic type with members filtered by the link's conditions. */
function structType(elem: StructElem, ctx: TypeContext): StructType {
  const validMembers = filterValidElements(elem.members, ctx.conditions ?? {});
  const members = validMembers.map(m => ({
    name: m.name.name,
    type: resolveTypeRef(m.typeRef, ctx),
  }));
  const name = elem.name.ident.originalName;
  return { kind: "struct", name, members, structElem: elem };
}

/** Type from annotation, or from the initializer
 * (materialized to concrete defaults unless the decl is a const). */
function valueDeclType(
  name: TypedDeclElem,
  init: ExpressionElem | undefined,
  ctx: TypeContext,
  materialize: boolean,
): Type {
  if (name.typeRef) return resolveTypeRef(name.typeRef, ctx);
  if (!init) return unknownType;
  const t = typeOfExpr(init, ctx);
  return materialize ? concretize(t) : t;
}

/** A vecN/matCxR type name as a semantic type (undefined for other names);
 * `elemOf` supplies the element type when the name has no suffix (`vec2f`). */
function vecMatType(
  name: string,
  elemOf: () => ScalarType | undefined,
): Type | undefined {
  const vec = /^vec([234])([fhiu])?$/.exec(name);
  if (vec) {
    const size = Number(vec[1]) as 2 | 3 | 4;
    const elem = vec[2] ? suffixElems[vec[2]] : elemOf();
    return elem ? vecType(size, elem) : unknownType;
  }
  const mat = /^mat([234])x([234])([fh])?$/.exec(name);
  if (mat) {
    const cols = Number(mat[1]) as 2 | 3 | 4;
    const rows = Number(mat[2]) as 2 | 3 | 4;
    const elem = mat[3] ? suffixElems[mat[3]] : elemOf();
    return elem ? matType(cols, rows, elem) : unknownType;
  }
  return undefined;
}

function templateScalar(
  param: TypeTemplateParameter | undefined,
  ctx: TypeContext,
): ScalarType | undefined {
  const t = param && typeFromTemplateParam(param, ctx);
  return t?.kind === "scalar" ? t : undefined;
}

/** A template parameter interpreted as a type: `f32` in `vec3<f32>`,
 * or a nested templated type like `array<vec2<f32>, 4>`. */
function typeFromTemplateParam(
  param: TypeTemplateParameter,
  ctx: TypeContext,
): Type | undefined {
  if (param.kind === "type") return resolveTypeRef(param, ctx);
  if (param.kind === "ref") {
    const decl = refDecl(param.ident, ctx.bindings);
    if (decl) return typeOfDecl(decl, ctx);
    return stdTypeRef(param.ident.originalName, undefined, ctx);
  }
  return undefined;
}

/** Const-evaluate an array element count (undefined if not const-evaluable). */
function constCount(
  param: TypeTemplateParameter,
  ctx: TypeContext,
): number | undefined {
  const value = evalConstExpr(param, ctx);
  const count = value && scalarToNumber(value);
  if (count === undefined || count === null) return undefined;
  return Number.isInteger(count) && count > 0 ? count : undefined;
}

/** An enumerant template parameter like `storage` or `read_write`. */
function enumerantName(
  param: TypeTemplateParameter | undefined,
): string | undefined {
  if (param?.kind === "ref") return param.ident.originalName;
  if (param?.kind === "type" && !param.templateParams)
    return param.name.originalName;
  return undefined;
}

function textureTypeRef(
  name: string,
  params: TypeTemplateParameter[] | undefined,
  ctx: TypeContext,
): TextureType {
  if (name.startsWith("texture_storage_")) {
    const format = enumerantName(params?.[0]);
    const access = enumerantName(params?.[1]);
    return { kind: "texture", name, format, access };
  }
  if (name.startsWith("texture_depth") || name === "texture_external")
    return { kind: "texture", name };
  const sampled = templateScalar(params?.[0], ctx);
  return { kind: "texture", name, sampled };
}

/** Address space of the root declaration behind an expression
 * (for the type of `&expr`). */
function addressSpaceOf(expr: ExpressionElem, ctx: TypeContext): string {
  let e = expr;
  while (true) {
    if (e.kind === "parenthesized-expression") e = e.expression;
    else if (e.kind === "component-expression") e = e.base;
    else if (e.kind === "component-member-expression") e = e.base;
    else if (e.kind === "unary-expression" && e.operator.value === "*") {
      // deref: the space is the pointer's pointee space, from its type
      const ptr = typeOfExpr(e.expression, ctx);
      return ptr.kind === "ptr" ? ptr.space : "function";
    } else break;
  }
  if (e.kind !== "ref") return "function";
  const decl = refDecl(e.ident, ctx.bindings);
  if (decl?.declElem?.kind === "gvar")
    return decl.declElem.template?.[0]?.name ?? "private";
  if (decl) {
    // pointer composite access: &p[i] / &p.x keep the pointee's space
    const t = typeOfDecl(decl, ctx);
    if (t.kind === "ptr") return t.space;
  }
  return "function";
}

/** Result of +, -, *, /, %, &, |, ^ with abstract-numeric promotion:
 * mixed operands take the concrete (finite-conversion-rank) side. */
function arithmeticType(op: string, left: Type, right: Type): Type {
  if (op === "*") {
    const matrix = matrixMultiplyType(left, right);
    if (matrix) return matrix;
  }
  if (left.kind === "matrix" && right.kind === "matrix")
    return withElem(left, commonType(left.elem, right.elem));
  if (left.kind === "matrix" && right.kind === "scalar")
    return withElem(left, commonType(left.elem, right));
  if (left.kind === "scalar" && right.kind === "matrix")
    return withElem(right, commonType(left, right.elem));

  if (left.kind === "scalar" && right.kind === "scalar")
    return commonType(left, right) ?? unknownType;
  if (left.kind === "vector" && right.kind === "scalar")
    return withElem(left, commonType(left.elem, right));
  if (left.kind === "scalar" && right.kind === "vector")
    return withElem(right, commonType(left, right.elem));
  if (left.kind === "vector" && right.kind === "vector") {
    if (left.size !== right.size) return unknownType;
    return withElem(left, commonType(left.elem, right.elem));
  }
  return unknownType;
}

/** Call of a user declaration: a `fn`, or a struct/alias constructor. */
function declCallType(decl: DeclIdent, ctx: TypeContext): Type {
  const elem = decl.declElem;
  if (elem?.kind !== "fn") return typeOfDecl(decl, ctx);
  return elem.returnType ? resolveTypeRef(elem.returnType, ctx) : voidType;
}

/** Call of a predeclared name: bitcast, a constructor, or a builtin fn. */
function stdCallType(call: FunctionCallExpression, ctx: TypeContext): Type {
  const fn = call.function;
  const name = calleeIdent(fn).originalName;

  if (name === "bitcast") {
    const params = fn.kind === "type" ? fn.templateParams : call.templateArgs;
    const arg = params?.[0];
    return (arg && typeFromTemplateParam(arg, ctx)) ?? unknownType;
  }
  if (fn.kind === "type") {
    const argCount = call.arguments.length;
    return templatedCtorType(name, fn.templateParams, argCount, ctx);
  }

  const argTypes = call.arguments.map(a => typeOfExpr(a, ctx));
  return constructorType(name, argTypes) ?? builtinFnType(name, argTypes);
}

/** mat*mat, mat*vec, and vec*mat result shapes. */
function matrixMultiplyType(left: Type, right: Type): Type | undefined {
  if (left.kind === "matrix" && right.kind === "matrix") {
    const elem = commonType(left.elem, right.elem);
    if (elem?.kind !== "scalar") return unknownType;
    return matType(right.cols, left.rows, elem);
  }
  if (left.kind === "matrix" && right.kind === "vector") {
    const elem = commonType(left.elem, right.elem);
    return elem?.kind === "scalar" ? vecType(left.rows, elem) : unknownType;
  }
  if (left.kind === "vector" && right.kind === "matrix") {
    const elem = commonType(left.elem, right.elem);
    return elem?.kind === "scalar" ? vecType(right.cols, elem) : unknownType;
  }
  return undefined;
}

/** Rebuild a vector/matrix type with a new element type (unknown if none). */
function withElem(shape: Type, elem: Type | undefined): Type {
  if (elem?.kind !== "scalar") return unknownType;
  if (shape.kind === "vector") return vecType(shape.size, elem);
  if (shape.kind === "matrix") return matType(shape.cols, shape.rows, elem);
  return unknownType;
}

/** Explicitly templated constructor: `vec3<f32>(..)`, `array<f32>(a, b)`.
 * An array with no template count takes its length from the arguments. */
function templatedCtorType(
  name: string,
  params: TypeTemplateParameter[] | undefined,
  argCount: number,
  ctx: TypeContext,
): Type {
  const t = stdTypeRef(name, params, ctx);
  if (t.kind === "array" && t.count === undefined && argCount)
    return arrayType(t.elem, argCount);
  return t;
}

/** Type of a bare (untemplated) predeclared constructor call, with the
 * element type inferred from the arguments: `vec2(1, 2)` is vec2<abstract-int>.
 * Undefined if the name isn't a constructor (builtin fns handle it instead). */
function constructorType(name: string, argTypes: Type[]): Type | undefined {
  const scalar = scalarNames[name];
  if (scalar) return scalar; // conversion constructor: f32(x), u32(x), ...

  const elemOf = () =>
    argTypes.length ? commonElem(argTypes) : zeroElem(name);
  const vecMat = vecMatType(name, elemOf);
  if (vecMat) return vecMat;
  if (name === "array") {
    if (!argTypes.length) return unknownType;
    const elem = argTypes.reduce<Type | undefined>(
      (a, b) => a && commonType(a, b),
      argTypes[0],
    );
    return elem ? arrayType(elem, argTypes.length) : unknownType;
  }
  return undefined;
}

/** Common element scalar across constructor arguments (scalars or vectors). */
function commonElem(argTypes: Type[]): ScalarType | undefined {
  let elem: Type | undefined;
  for (const arg of argTypes) {
    const s = elemScalar(arg);
    if (!s) return undefined;
    elem = elem ? commonType(elem, s) : s;
    if (!elem) return undefined;
  }
  return elem?.kind === "scalar" ? elem : undefined;
}

/** Element type of a zero-value constructor, which has neither arguments nor a
 * template to take one from: `vec4()` is the zero value of vec4<abstract-int>,
 * `mat2x3()` of mat2x3<abstract-float>. Abstract, so it converts on use like
 * any other abstract value (`var v = vec4();` materializes to vec4<i32>). */
function zeroElem(name: string): ScalarType {
  return name.startsWith("vec") ? abstractInt : abstractFloat;
}
