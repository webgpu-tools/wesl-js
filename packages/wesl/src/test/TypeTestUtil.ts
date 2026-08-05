import type {
  AbstractElem,
  ExpressionElem,
  ModuleElem,
} from "../AbstractElems.ts";
import { visitAst } from "../LinkerUtil.ts";
import type { Conditions } from "../Scope.ts";
import { checkedTypeOf, checkModule } from "../types/Bidirectional.ts";
import { evalConstExpr } from "../types/ConstEval.ts";
import type { ConstValue } from "../types/ConstValues.ts";
import { type TypeContext, typeOfExpr } from "../types/TypeSynthesis.ts";
import { typeToString } from "../types/Types.ts";
import { bindTestSources } from "./TestUtil.ts";

/** Bind test sources and build a TypeContext for type synthesis tests.
 * First source is ./test.wesl, the rest ./file1.wesl, ./file2.wesl, ... */
export function typeTest(
  src: string | string[],
  conditions: Conditions = {},
): { ctx: TypeContext; moduleElem: ModuleElem } {
  const sources = Array.isArray(src) ? src : [src];
  const { bound } = bindTestSources(sources, conditions);
  const { bindings, moduleElem } = bound.transformedAst;
  return { ctx: { bindings, conditions }, moduleElem };
}

/** The init expression of the named decl (const/let/var/override), anywhere in
 * the module; if the name is declared more than once, the first in source order
 * (matching `checkedReturnType`, which takes the first return). */
export function initExpr(moduleElem: ModuleElem, name: string): ExpressionElem {
  const kinds = ["const", "let", "var", "gvar", "override"] as const;
  const named = kinds
    .flatMap(kind => elemsOfKind(moduleElem, kind))
    .filter(d => d.name.decl.ident.originalName === name && d.init)
    .sort((a, b) => a.start - b.start);
  const init = named[0]?.init;
  if (!init) throw new Error(`no initialized decl '${name}' in test source`);
  return init;
}

/** All elems of the given kind anywhere in the module, in pre-order. */
export function elemsOfKind<K extends AbstractElem["kind"]>(
  moduleElem: ModuleElem,
  kind: K,
): Extract<AbstractElem, { kind: K }>[] {
  const found: AbstractElem[] = [];
  visitAst(moduleElem, elem => {
    if (elem.kind === kind) found.push(elem);
  });
  return found as Extract<AbstractElem, { kind: K }>[];
}

/** Synthesized type (as a string) of the init expression of decl `name`. */
export function initType(
  src: string | string[],
  name: string,
  conditions?: Conditions,
): string {
  const { ctx, moduleElem } = typeTest(src, conditions);
  return typeToString(typeOfExpr(initExpr(moduleElem, name), ctx));
}

/** Bidirectionally-checked type (as a string) of the init expression of decl
 * `name`: runs the checking pass, then reads the expected-type-refined type. */
export function checkedInitType(
  src: string | string[],
  name: string,
  conditions?: Conditions,
): string {
  const { ctx, moduleElem } = typeTest(src, conditions);
  checkModule(moduleElem, ctx);
  return typeToString(checkedTypeOf(initExpr(moduleElem, name), ctx));
}

/** Bidirectionally-checked type (as a string) of the first `return` value in
 * the module. */
export function checkedReturnType(
  src: string | string[],
  conditions?: Conditions,
): string {
  const { ctx, moduleElem } = typeTest(src, conditions);
  checkModule(moduleElem, ctx);
  const value = elemsOfKind(moduleElem, "return").find(r => r.value)?.value;
  if (!value) throw new Error("no return with a value in test source");
  return typeToString(checkedTypeOf(value, ctx));
}

/** Const-evaluated value (as a string) of the init expression of decl `name`. */
export function initValue(
  src: string | string[],
  name: string,
  conditions?: Conditions,
): string {
  const { ctx, moduleElem } = typeTest(src, conditions);
  return valueToString(evalConstExpr(initExpr(moduleElem, name), ctx));
}

/** Render a const value as "value : type" (or "null"). */
export function valueToString(v: ConstValue | null): string {
  if (!v) return "null";
  return `${plainValue(v)} : ${typeToString(v.type)}`;
}

function plainValue(v: ConstValue): string {
  if (v.kind === "scalar") return String(v.value);
  return `[${v.elements.map(plainValue).join(", ")}]`;
}
