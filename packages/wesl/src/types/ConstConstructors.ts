import {
  type CompositeValue,
  type ConstValue,
  castScalar,
  convertValue,
  type ScalarValue,
  zeroValue,
} from "./ConstValues.ts";
import { type Type, vecType } from "./Types.ts";

/** Type constructor calls: vec3f(1,2,3), mat2x2(...), MyStruct(...), array(...). */

/** Build a value of a constructed type from evaluated arguments. */
export function constructValue(
  type: Type,
  args: (ConstValue | null)[],
): ConstValue | null {
  if (args.some(a => !a)) return null;
  const values = args as ConstValue[];
  if (!values.length) return zeroValue(type);

  switch (type.kind) {
    case "scalar":
      return values[0].kind === "scalar" ? castScalar(values[0], type) : null;
    case "vector": {
      const components = flattenScalars(values);
      if (!components) return null;
      const spread =
        components.length === 1
          ? Array.from({ length: type.size }, () => components[0])
          : components;
      if (spread.length !== type.size) return null;
      const elements = spread.map(c => castScalar(c, type.elem));
      if (elements.some(e => !e)) return null;
      return { kind: "composite", type, elements: elements as ConstValue[] };
    }
    case "matrix":
      return constructMatrix(type, values);
    case "array": {
      const elements = values.map(v => convertValue(v, type.elem));
      if (elements.some(e => !e)) return null;
      const count = type.count ?? values.length;
      if (count !== values.length) return null;
      return { kind: "composite", type, elements: elements as ConstValue[] };
    }
    case "struct": {
      if (values.length !== type.members.length) return null;
      const elements = values.map((v, i) =>
        convertValue(v, type.members[i].type),
      );
      if (elements.some(e => !e)) return null;
      return { kind: "composite", type, elements: elements as ConstValue[] };
    }
    default:
      return null;
  }
}

export function isConstructorName(name: string): boolean {
  return (
    /^(bool|i32|u32|f32|f16|array)$/.test(name) ||
    /^vec[234][fhiu]?$/.test(name) ||
    /^mat[234]x[234][fh]?$/.test(name)
  );
}

/** Matrix from another matrix, from cols*rows scalars, or from one vector per column. */
function constructMatrix(
  type: Extract<Type, { kind: "matrix" }>,
  values: ConstValue[],
): ConstValue | null {
  const single = values[0];
  if (values.length === 1 && single.kind === "composite")
    return convertValue(single, type) ?? matrixFromComposite(single, type);

  const columnType = vecType(type.rows, type.elem);
  if (values.every(v => v.kind === "scalar")) {
    if (values.length !== type.cols * type.rows) return null;
    const columns: ConstValue[] = [];
    for (let c = 0; c < type.cols; c++) {
      const start = c * type.rows;
      const column = constructVec(
        columnType,
        values.slice(start, start + type.rows),
      );
      if (!column) return null;
      columns.push(column);
    }
    return { kind: "composite", type, elements: columns };
  }
  if (values.length === type.cols) {
    const columns = values.map(v => convertValue(v, columnType));
    if (columns.some(c => !c)) return null;
    return { kind: "composite", type, elements: columns as ConstValue[] };
  }
  return null;
}

/** Rebuild a matrix value column-by-column with element casts. */
function matrixFromComposite(
  from: CompositeValue,
  type: Extract<Type, { kind: "matrix" }>,
): ConstValue | null {
  if (from.type.kind !== "matrix") return null;
  if (from.type.cols !== type.cols || from.type.rows !== type.rows) return null;
  const columnType = vecType(type.rows, type.elem);
  const columns = from.elements.map(col =>
    col.kind === "composite" ? constructVec(columnType, col.elements) : null,
  );
  if (columns.some(c => !c)) return null;
  return { kind: "composite", type, elements: columns as ConstValue[] };
}

/** Vector from exactly one scalar per component, each cast to the element type. */
function constructVec(
  type: Extract<Type, { kind: "vector" }>,
  components: ConstValue[],
): ConstValue | null {
  if (components.length !== type.size) return null;
  const elements = components.map(c =>
    c.kind === "scalar" ? castScalar(c, type.elem) : null,
  );
  if (elements.some(e => !e)) return null;
  return { kind: "composite", type, elements: elements as ConstValue[] };
}

/** Flatten constructor args (scalars and vectors) into scalar components. */
function flattenScalars(values: ConstValue[]): ScalarValue[] | null {
  const flat: ScalarValue[] = [];
  for (const v of values) {
    if (v.kind === "scalar") flat.push(v);
    else if (v.type.kind === "vector") {
      for (const e of v.elements) {
        if (e.kind !== "scalar") return null;
        flat.push(e);
      }
    } else return null;
  }
  return flat;
}
