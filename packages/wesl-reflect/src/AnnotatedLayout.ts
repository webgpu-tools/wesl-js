import type { StructElem, StructMemberElem } from "wesl";
import {
  type FieldLayout,
  type LayoutOptions,
  type StructLayout,
  structLayout,
  validMembers,
} from "./StructLayout.ts";
import {
  type AutoAnnotation,
  autoAnnotation,
  type ColorAnnotation,
  colorAnnotation,
  type RangeAnnotation,
  rangeAnnotation,
  type ToggleAnnotation,
  toggleAnnotation,
} from "./UniformAnnotations.ts";
import { originalTypeName } from "./WeslStructs.ts";

export interface RangeControl extends AnnotatedField, RangeAnnotation {
  kind: "range";
}
export interface ColorControl extends AnnotatedField, ColorAnnotation {
  kind: "color";
}
export interface ToggleControl extends AnnotatedField, ToggleAnnotation {
  kind: "toggle";
}

export type UniformControl = RangeControl | ColorControl | ToggleControl;

export interface AutoField extends AnnotatedField, AutoAnnotation {
  kind: "auto";
}
export interface PlainField extends AnnotatedField {
  kind: "plain";
}

export type UniformField = AutoField | PlainField;

/** Struct layout enriched with parsed annotations: UI controls and data fields. */
export interface AnnotatedLayout {
  structName: string;
  layout: StructLayout;
  controls: UniformControl[];
  fields: UniformField[];
}

interface AnnotatedField extends FieldLayout {
  type: string;
}

type Classified =
  | { control: UniformControl; field?: undefined }
  | { control?: undefined; field: UniformField };

/** Compute layout + annotations for a @uniforms-annotated struct. */
export function annotatedLayout(
  struct: StructElem,
  opts: LayoutOptions = {},
): AnnotatedLayout {
  const layout = structLayout(struct, opts);
  // same filtering as structLayout, so members index-align with layout.fields
  const members = validMembers(struct, opts.conditions);
  const controls: UniformControl[] = [];
  const fields: UniformField[] = [];

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const fl = layout.fields[i];
    const type = originalTypeName(m.typeRef);
    const base = { name: fl.name, offset: fl.offset, size: fl.size, type };
    const { control, field } = classifyMember(m, base);
    if (control) controls.push(control);
    else fields.push(field);
  }

  const structName = struct.name.ident.originalName;
  return { structName, layout, controls, fields };
}

/** Classify a struct member as a UI control or a data field based on annotations. */
function classifyMember(m: StructMemberElem, base: AnnotatedField): Classified {
  const range = rangeAnnotation(m);
  if (range) return { control: { kind: "range", ...base, ...range } };
  const color = colorAnnotation(m);
  if (color) return { control: { kind: "color", ...base, ...color } };
  const toggle = toggleAnnotation(m);
  if (toggle) return { control: { kind: "toggle", ...base, ...toggle } };
  const auto = autoAnnotation(m);
  if (auto) return { field: { kind: "auto", ...base, ...auto } };
  return { field: { kind: "plain", ...base } };
}
