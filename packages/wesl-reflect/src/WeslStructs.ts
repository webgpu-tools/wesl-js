import type { StructElem, TypeRefElem } from "wesl/core";

export interface WeslStruct {
  members: Record<string, WeslMember>;
}

export interface WeslMember {
  type: string;
}

export type StructsRecord = Record<string, WeslStruct>;

/** Convert parsed WESL/WGSL struct AST nodes to simplified WeslStruct records. */
export function weslStructs(astStructs: StructElem[]): StructsRecord[] {
  return astStructs.map(s => {
    const name = s.name.ident.originalName;
    const entries = s.members.map(
      m => [m.name.name, { type: originalTypeName(m.typeRef) }] as const,
    );
    return { [name]: { members: Object.fromEntries(entries) } };
  });
}

/** Extract the original type name from a TypeRefElem. */
export function originalTypeName(typeRef: TypeRefElem): string {
  const { name } = typeRef;
  if (typeof name === "string") return name;
  return name.originalName;
}

/** Map a WGSL type name to a TypeScript type name. */
export function wgslTypeToTs(wgslType: string): string {
  switch (wgslType) {
    case "f32":
    case "f16":
    case "u32":
    case "i32":
      return "number";
    default:
      return wgslType;
  }
}
