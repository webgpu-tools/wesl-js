import {
  declsOfKind,
  type ExpressionElem,
  type GlobalVarElem,
  type StandardAttribute,
  type StructElem,
  type TypeRefElem,
  type WeslAST,
} from "wesl";
import { findAnnotation, numericParams } from "./Annotations.ts";
import {
  buildStructRegistry,
  roundUp,
  type StructRegistry,
} from "./StructLayout.ts";
import { originalTypeName } from "./WeslStructs.ts";

export type TypeShape =
  | ScalarShape
  | VecShape
  | MatShape
  | AtomicShape
  | ArrayShape
  | StructShape;

export type ScalarKind = "f32" | "i32" | "u32" | "bool" | "f16";
export type VecScalar = Exclude<ScalarKind, "bool">;
export type MatScalar = "f32" | "f16";
export type AtomicScalar = "i32" | "u32";

export interface ShapeBase {
  /** Static byte size; 0 for runtime-sized array containers. */
  size: number;
  alignment: number;
}

export interface ScalarShape extends ShapeBase {
  kind: "scalar";
  type: ScalarKind;
}

export interface VecShape extends ShapeBase {
  kind: "vec";
  n: 2 | 3 | 4;
  component: VecScalar;
}

export interface MatShape extends ShapeBase {
  kind: "mat";
  cols: 2 | 3 | 4;
  rows: 2 | 3 | 4;
  component: MatScalar;
}

export interface AtomicShape extends ShapeBase {
  kind: "atomic";
  component: AtomicScalar;
}

export interface ArrayShape extends ShapeBase {
  kind: "array";
  elem: TypeShape;
  /** Element count, or "runtime" for unbounded `array<T>`. */
  length: number | "runtime";
  stride: number;
}

export interface StructShape extends ShapeBase {
  kind: "struct";
  name: string;
  fields: StructField[];
}

export interface StructField {
  name: string;
  offset: number;
  size: number;
  type: TypeShape;
}

export type AddressSpace =
  | "function"
  | "private"
  | "workgroup"
  | "uniform"
  | "storage"
  | "handle";

export type AccessMode = "read" | "read_write" | "write";

export interface VarReflection {
  varName: string;
  addressSpace?: AddressSpace;
  accessMode?: AccessMode;
  group?: number;
  binding?: number;
  type: TypeShape;
  /** Static byte size; 0 if `type` contains a runtime-sized array. */
  byteSize: number;
}

const scalarTable: Record<string, ScalarKind> = {
  f32: "f32",
  i32: "i32",
  u32: "u32",
  f16: "f16",
  bool: "bool",
};

const vecTable: Record<string, { n: 2 | 3 | 4; component: VecScalar }> = {
  vec2f: { n: 2, component: "f32" },
  vec3f: { n: 3, component: "f32" },
  vec4f: { n: 4, component: "f32" },
  vec2i: { n: 2, component: "i32" },
  vec3i: { n: 3, component: "i32" },
  vec4i: { n: 4, component: "i32" },
  vec2u: { n: 2, component: "u32" },
  vec3u: { n: 3, component: "u32" },
  vec4u: { n: 4, component: "u32" },
  vec2h: { n: 2, component: "f16" },
  vec3h: { n: 3, component: "f16" },
  vec4h: { n: 4, component: "f16" },
};

const matTable: Record<
  string,
  { cols: 2 | 3 | 4; rows: 2 | 3 | 4; component: MatScalar }
> = {
  mat2x2f: { cols: 2, rows: 2, component: "f32" },
  mat3x2f: { cols: 3, rows: 2, component: "f32" },
  mat4x2f: { cols: 4, rows: 2, component: "f32" },
  mat2x3f: { cols: 2, rows: 3, component: "f32" },
  mat3x3f: { cols: 3, rows: 3, component: "f32" },
  mat4x3f: { cols: 4, rows: 3, component: "f32" },
  mat2x4f: { cols: 2, rows: 4, component: "f32" },
  mat3x4f: { cols: 3, rows: 4, component: "f32" },
  mat4x4f: { cols: 4, rows: 4, component: "f32" },
  mat2x2h: { cols: 2, rows: 2, component: "f16" },
  mat3x2h: { cols: 3, rows: 2, component: "f16" },
  mat4x2h: { cols: 4, rows: 2, component: "f16" },
  mat2x3h: { cols: 2, rows: 3, component: "f16" },
  mat3x3h: { cols: 3, rows: 3, component: "f16" },
  mat4x3h: { cols: 4, rows: 3, component: "f16" },
  mat2x4h: { cols: 2, rows: 4, component: "f16" },
  mat3x4h: { cols: 3, rows: 4, component: "f16" },
  mat4x4h: { cols: 4, rows: 4, component: "f16" },
};

const addressSpaces: AddressSpace[] = [
  "function",
  "private",
  "workgroup",
  "uniform",
  "storage",
  "handle",
];

/** Thrown by varReflection / typeShape when a type cannot be reflected. */
export class TypeShapeError extends Error {
  readonly varName?: string;
  constructor(message: string, varName?: string) {
    super(message);
    this.name = "TypeShapeError";
    this.varName = varName;
  }
}

/** Reflect a top-level `var` declaration: type tree, address space, access mode, and bindings. */
export function varReflection(ast: WeslAST, varName: string): VarReflection {
  const gvar = findGlobalVar(ast, varName);
  if (!gvar) throw new TypeShapeError(`var '${varName}' not found`, varName);
  const typeRef = gvar.name.typeRef;
  if (!typeRef)
    throw new TypeShapeError(`var '${varName}' has no type`, varName);

  const structs = buildStructRegistry(ast);
  const type = typeShape(typeRef, structs, varName);
  const declText = ast.srcModule.src.slice(gvar.start, gvar.end);
  return {
    varName,
    addressSpace: parseAddressSpace(declText),
    accessMode: parseAccessMode(declText),
    group: numericAttr(gvar, "group"),
    binding: numericAttr(gvar, "binding"),
    type,
    byteSize: type.size,
  };
}

/** Build a TypeShape from a TypeRefElem, with layout (size/alignment/offsets) populated. */
export function typeShape(
  typeRef: TypeRefElem,
  structs: StructRegistry,
  varName?: string,
): TypeShape {
  const name = originalTypeName(typeRef);

  const primitive = primitiveShape(name);
  if (primitive) return primitive;

  if (name === "atomic") return atomicShape(typeRef, varName);
  if (name === "array") return arrayShape(typeRef, structs, varName);

  const struct = structs.get(name);
  if (struct) return structShape(struct, structs, varName);

  throw new TypeShapeError(`unsupported type '${name}'`, varName);
}

/** Byte size of a WGSL scalar: f16 is 2, all others (f32/i32/u32/bool) are 4. */
export function scalarSize(s: ScalarKind): number {
  return s === "f16" ? 2 : 4;
}

function findGlobalVar(
  ast: WeslAST,
  varName: string,
): GlobalVarElem | undefined {
  return declsOfKind(ast.moduleElem, "gvar").find(
    g => g.name.decl.ident.originalName === varName,
  );
}

// LATER replace these regexes when the AST is more complete

function parseAddressSpace(declText: string): AddressSpace | undefined {
  const m = declText.match(/var\s*<\s*([a-z_]+)/);
  if (!m) return undefined;
  const space = m[1] as AddressSpace;
  return addressSpaces.includes(space) ? space : undefined;
}

function parseAccessMode(declText: string): AccessMode | undefined {
  if (/\bread_write\b/.test(declText)) return "read_write";
  if (/var\s*<\s*storage\s*,\s*read\b/.test(declText)) return "read";
  return undefined;
}

function numericAttr(gvar: GlobalVarElem, name: string): number | undefined {
  const attr: StandardAttribute | undefined = findAnnotation(gvar, name);
  if (!attr) return undefined;
  const [n] = numericParams(attr);
  return Number.isFinite(n) ? n : undefined;
}

/** Look up a scalar/vec/mat shape by WGSL primitive name. */
function primitiveShape(name: string): TypeShape | undefined {
  const scalar = scalarTable[name];
  if (scalar) return { kind: "scalar", type: scalar, ...scalarLayout(scalar) };
  const vec = vecTable[name];
  if (vec) return { kind: "vec", ...vec, ...vecLayout(vec.n, vec.component) };
  const mat = matTable[name];
  if (mat) return { kind: "mat", ...mat, ...matLayout(mat) };
  return undefined;
}

function atomicShape(typeRef: TypeRefElem, varName?: string): AtomicShape {
  const param = typeRef.templateParams?.[0];
  const inner = param && elemTypeName(param);
  if (inner !== "i32" && inner !== "u32") {
    throw new TypeShapeError(`atomic must wrap i32 or u32`, varName);
  }
  return { kind: "atomic", component: inner, ...scalarLayout(inner) };
}

function arrayShape(
  typeRef: TypeRefElem,
  structs: StructRegistry,
  varName?: string,
): ArrayShape {
  const params = typeRef.templateParams;
  if (!params?.length) {
    throw new TypeShapeError(`array missing element type`, varName);
  }
  const elemRef = params[0];
  const elem =
    elemRef.kind === "type"
      ? typeShape(elemRef, structs, varName)
      : namedTypeShape(elemTypeName(elemRef), structs, varName);
  const stride = roundUp(elem.alignment, elem.size);
  const lenExpr = params[1] as { value?: string } | undefined;
  if (lenExpr === undefined) {
    return {
      kind: "array",
      elem,
      length: "runtime",
      stride,
      size: 0,
      alignment: elem.alignment,
    };
  }
  const length =
    lenExpr.value !== undefined ? Number(lenExpr.value) : Number.NaN;
  if (!Number.isFinite(length) || length <= 0) {
    throw new TypeShapeError(
      `array length must be a positive literal`,
      varName,
    );
  }
  return {
    kind: "array",
    elem,
    length,
    stride,
    size: length * stride,
    alignment: elem.alignment,
  };
}

function structShape(
  struct: StructElem,
  structs: StructRegistry,
  varName?: string,
): StructShape {
  let offset = 0;
  let alignment = 1;
  const fields: StructField[] = [];

  for (const m of struct.members) {
    const mShape = typeShape(m.typeRef, structs, varName);
    let fieldAlign = mShape.alignment;
    let fieldSize = mShape.size;

    const alignAttr = findAnnotation(m, "align");
    if (alignAttr) {
      const [n] = numericParams(alignAttr);
      if (n) fieldAlign = Math.max(n, fieldAlign);
    }
    const sizeAttr = findAnnotation(m, "size");
    if (sizeAttr) {
      const [n] = numericParams(sizeAttr);
      if (n) fieldSize = n;
    }

    alignment = Math.max(alignment, fieldAlign);
    offset = roundUp(fieldAlign, offset);
    fields.push({ name: m.name.name, offset, size: fieldSize, type: mShape });
    offset += fieldSize;
  }

  return {
    kind: "struct",
    name: struct.name.ident.originalName,
    fields,
    alignment,
    size: roundUp(alignment, offset),
  };
}

function scalarLayout(s: ScalarKind): ShapeBase {
  const n = scalarSize(s);
  return { size: n, alignment: n };
}

/** vecN<T> layout: size=N*S, align=N*S (vec3 pads alignment to 4*S). */
function vecLayout(n: 2 | 3 | 4, component: VecScalar): ShapeBase {
  const s = scalarSize(component);
  const alignN = n === 3 ? 4 : n;
  return { size: n * s, alignment: alignN * s };
}

/** matCxR<T>: C columns of vec<R,T>, column stride = roundUp(colAlign, colSize). */
function matLayout(m: {
  cols: number;
  rows: 2 | 3 | 4;
  component: MatScalar;
}): ShapeBase {
  const col = vecLayout(m.rows, m.component);
  const colStride = roundUp(col.alignment, col.size);
  return { size: m.cols * colStride, alignment: col.alignment };
}

/** Pull a type name out of a template parameter (TypeRef or RefIdent). */
function elemTypeName(param: ExpressionElem): string | undefined {
  if (param.kind === "type") return originalTypeName(param);
  if (param.kind === "ref") return param.ident?.originalName;
  return undefined;
}

/** Resolve an array template-param identifier (e.g. `Particle` in `array<Particle, 4>`). */
function namedTypeShape(
  name: string | undefined,
  structs: StructRegistry,
  varName?: string,
): TypeShape {
  if (!name) throw new TypeShapeError(`cannot resolve array element`, varName);
  const primitive = primitiveShape(name);
  if (primitive) return primitive;
  const struct = structs.get(name);
  if (struct) return structShape(struct, structs, varName);
  throw new TypeShapeError(`unsupported type '${name}'`, varName);
}
