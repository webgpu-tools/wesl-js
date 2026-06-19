import type {
  Conditions,
  ExpressionElem,
  RefIdent,
  StructElem,
  StructMemberElem,
  TypeRefElem,
  WeslAST,
} from "wesl";
import { declsOfKind, filterValidElements } from "wesl";
import { findAnnotation, numericParams } from "./Annotations.ts";
import { originalTypeName } from "./WeslStructs.ts";

export interface FieldLayout {
  name: string;
  offset: number;
  size: number;
}

export interface StructLayout {
  fields: FieldLayout[];
  bufferSize: number;
  alignment: number;
}

export interface TypeInfo {
  alignment: number;
  size: number;
}

/** Optional registry of top-level structs by name, used when a parsed AST has
 *  not been bound (refersTo unresolved). */
export type StructRegistry = ReadonlyMap<string, StructElem>;

const typeTable: Record<string, TypeInfo> = {
  // scalars
  f32: scalar(4),
  i32: scalar(4),
  u32: scalar(4),
  f16: scalar(2),

  // vec<N, f32> shorthand
  vec2f: vec(2, 4),
  vec3f: vec(3, 4),
  vec4f: vec(4, 4),

  // vec<N, i32>
  vec2i: vec(2, 4),
  vec3i: vec(3, 4),
  vec4i: vec(4, 4),

  // vec<N, u32>
  vec2u: vec(2, 4),
  vec3u: vec(3, 4),
  vec4u: vec(4, 4),

  // vec<N, f16>
  vec2h: vec(2, 2),
  vec3h: vec(3, 2),
  vec4h: vec(4, 2),

  // mat<C>x<R>f (f32)
  mat2x2f: mat(2, 2, 4),
  mat3x2f: mat(3, 2, 4),
  mat4x2f: mat(4, 2, 4),
  mat2x3f: mat(2, 3, 4),
  mat3x3f: mat(3, 3, 4),
  mat4x3f: mat(4, 3, 4),
  mat2x4f: mat(2, 4, 4),
  mat3x4f: mat(3, 4, 4),
  mat4x4f: mat(4, 4, 4),

  // mat<C>x<R>h (f16)
  mat2x2h: mat(2, 2, 2),
  mat3x2h: mat(3, 2, 2),
  mat4x2h: mat(4, 2, 2),
  mat2x3h: mat(2, 3, 2),
  mat3x3h: mat(3, 3, 2),
  mat4x3h: mat(4, 3, 2),
  mat2x4h: mat(2, 4, 2),
  mat3x4h: mat(3, 4, 2),
  mat4x4h: mat(4, 4, 2),
};

/** Compute byte offsets and buffer size for a bound WGSL struct.
 *  Nested structs resolved via refersTo links. Conditional members filtered when conditions provided. */
export function structLayout(
  struct: StructElem,
  conditions?: Conditions,
  structs?: StructRegistry,
): StructLayout {
  const members = conditions
    ? filterValidElements(struct.members, conditions)
    : struct.members;
  return membersLayout(members, conditions, structs);
}

/** Build a StructRegistry from all top-level struct declarations in `ast`. */
export function buildStructRegistry(ast: WeslAST): StructRegistry {
  const reg = new Map<string, StructElem>();
  for (const e of declsOfKind(ast.moduleElem, "struct")) {
    reg.set(e.name.ident.originalName, e);
  }
  return reg;
}

/** Resolve alignment and size for any host-shareable typeRef (primitive, array, or nested struct). */
export function typeRefLayout(
  typeRef: TypeRefElem,
  conditions?: Conditions,
  structs?: StructRegistry,
): TypeInfo {
  const name = originalTypeName(typeRef);

  // primitive type
  const primitive = typeTable[name];
  if (primitive) return primitive;

  // array<T, N> or array<T>
  if (name === "array") {
    const params = typeRef.templateParams;
    if (!params?.length)
      throw new Error("array type missing template parameters");
    const elem = elemTypeInfo(params[0], conditions, structs);
    const stride = roundUp(elem.alignment, elem.size);
    const p = params[1];
    const count = p && "value" in p ? Number(p.value) : 0;
    return { alignment: elem.alignment, size: count * stride };
  }

  // nested struct via refersTo (post-binding) or registry (pre-binding)
  const nested = resolveStructInfo(typeRef.name, conditions, structs, name);
  if (nested) return nested;

  throw new Error(`unsupported type for layout: '${name}'`);
}

/** Look up alignment and size for a host-shareable WGSL type. */
export function typeLayout(typeName: string): TypeInfo {
  const info = typeTable[typeName];
  if (info) return info;
  throw new Error(`unsupported type for layout: '${typeName}'`);
}

/** Round `n` up to the next multiple of `align`. */
export function roundUp(align: number, n: number): number {
  return Math.ceil(n / align) * align;
}

function scalar(size: number): TypeInfo {
  return { alignment: size, size };
}

/** vec2: align=2*S, size=2*S; vec3: align=4*S, size=3*S; vec4: align=4*S, size=4*S */
function vec(n: number, scalarSize: number): TypeInfo {
  const alignN = n === 3 ? 4 : n;
  return { alignment: alignN * scalarSize, size: n * scalarSize };
}

/** matCxR<T>: C columns of vecR<T>, column stride = roundUp(colAlign, colSize) */
function mat(cols: number, rows: number, scalarSize: number): TypeInfo {
  const col = vec(rows, scalarSize);
  const colStride = roundUp(col.alignment, col.size);
  return { alignment: col.alignment, size: cols * colStride };
}

/** Compute layout from a flat member list (used internally and for nested resolution). */
function membersLayout(
  members: StructMemberElem[],
  conditions?: Conditions,
  structs?: StructRegistry,
): StructLayout {
  let offset = 0;
  let structAlign = 1;
  const fields: FieldLayout[] = [];

  for (const m of members) {
    let { alignment, size } = typeRefLayout(m.typeRef, conditions, structs);

    const alignAttr = findAnnotation(m, "align");
    if (alignAttr) {
      const [n] = numericParams(alignAttr);
      if (n) alignment = Math.max(n, alignment);
    }

    const sizeAttr = findAnnotation(m, "size");
    if (sizeAttr) {
      const [n] = numericParams(sizeAttr);
      if (n) size = n;
    }

    structAlign = Math.max(structAlign, alignment);
    offset = roundUp(alignment, offset);
    fields.push({ name: m.name.name, offset, size });
    offset += size;
  }

  const bufferSize = roundUp(structAlign, offset);
  return { fields, bufferSize, alignment: structAlign };
}

/** Extract type info from an array template param (TypeRefElem or RefIdentElem). */
function elemTypeInfo(
  param: ExpressionElem,
  conditions?: Conditions,
  structs?: StructRegistry,
): TypeInfo {
  if (param.kind === "type") return typeRefLayout(param, conditions, structs);
  const ident = param.kind === "ref" ? param.ident : undefined;
  const typeName = ident?.originalName;
  if (!typeName) throw new Error("cannot resolve array element type");
  const primitive = typeTable[typeName];
  if (primitive) return primitive;
  const nested = resolveStructInfo(ident, conditions, structs, typeName);
  if (nested) return nested;
  throw new Error(`unsupported type for layout: '${typeName}'`);
}

/** Resolve a struct typeRef via refersTo (bound) or struct registry (unbound). */
function resolveStructInfo(
  ident: RefIdent | undefined,
  conditions: Conditions | undefined,
  structs: StructRegistry | undefined,
  fallbackName?: string,
): TypeInfo | undefined {
  const fromRefersTo = ident && structFromRefersTo(ident);
  const name = ident?.originalName ?? fallbackName;
  const fromRegistry = name ? structs?.get(name) : undefined;
  const elem = fromRefersTo ?? fromRegistry;
  if (!elem) return undefined;
  const inner = structLayout(elem, conditions, structs);
  return { alignment: inner.alignment, size: inner.bufferSize };
}

/** Walk a bound RefIdent's refersTo chain to find its StructElem, if any. */
function structFromRefersTo(ident: RefIdent): StructElem | undefined {
  const decl = ident.refersTo;
  if (decl?.kind !== "decl") return undefined;
  const elem = decl.declElem;
  if (elem?.kind !== "struct") return undefined;
  return elem;
}
