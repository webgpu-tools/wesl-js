import type {
  BindingStructElem,
  StructMemberElem,
  TypeRefElem,
} from "./AbstractElems.ts";
import { assertThat } from "./Assertions.ts";
import type { TransformedAST, WeslJsPlugin } from "./Linker.ts";
import { identElemLog } from "./LinkerUtil.ts";
import { expressionToString } from "./LowerAndEmit.ts";
import { matchOneOf } from "./parse/stream/RegexHelpers.ts";
import type { RefIdent } from "./Scope.ts";
import {
  multisampledTextureTypes,
  sampledTextureTypes,
  textureStorageTypes,
} from "./StandardTypes.ts";
import { findMap } from "./Util.ts";

export type BindingStructReportFn = (structs: BindingStructElem[]) => void;
export const textureStorage = matchOneOf(textureStorageTypes);

export function reportBindingStructsPlugin(
  fn: BindingStructReportFn,
): WeslJsPlugin {
  return {
    transform: reportBindingStructs(fn),
  };
}
/**
 * Linker plugin that generates TypeScript strings for GPUBindingGroupLayouts
 * based on the binding structs in the WESL source.
 *
 * Requires the enableBindingStructs() transform to be enabled.
 *
 * @param fn called with the binding structs. Normally the caller passes a
 * function that uses bindingGroupLayoutTs() to generate the TypeScript.
 *
 * The generated TypeScript looks roughly like this:

  export function MyBindingLayout(device: GPUDevice): GPUBindGroupLayout {
    return device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: "storage",
          },
        },
      ],
    });
  }
*/
export function reportBindingStructs(
  fn: BindingStructReportFn,
): (ast: TransformedAST) => TransformedAST {
  return (ast: TransformedAST) => {
    const structs = ast.notableElems.bindingStructs as BindingStructElem[];
    fn(structs);
    return ast;
  };
}

function firstLetterLower(s: string): string {
  return s[0].toLowerCase() + s.slice(1);
}

/** Generate TypeScript source for a function that builds the
 *  GPUBindGroupLayout matching one WESL binding struct. */
export function bindingGroupLayoutTs(
  struct: BindingStructElem,
  typeScript = true,
): string {
  if (!struct) {
    console.log("no struct!???");
    return "";
  }
  const structName = firstLetterLower(struct.name.ident.mangledName!);
  const visibility = shaderVisiblity(struct);
  const entries = struct.members
    .map(m => memberToLayoutEntry(m, visibility))
    .join(",");

  const fnName = `${structName}Layout`;
  const entriesName = `${structName}Entries`;

  const fnParams = typeScript
    ? "(device: GPUDevice): GPUBindGroupLayout"
    : "(device)";

  const src = `
const ${entriesName} = [ ${entries} ];
function ${fnName}${fnParams} {
  return device.createBindGroupLayout({
    entries: ${entriesName} 
  });
}

export const layoutFunctions = { ${fnName} };
export const layouts = { ${entriesName} };
  `;
  return src;
}

const stageVisibility: Record<string, string> = {
  compute: "GPUShaderStage.COMPUTE",
  vertex: "GPUShaderStage.VERTEX",
  fragment: "GPUShaderStage.FRAGMENT",
};

/** Shader stage visibility for a binding struct, from the attributes of its
 *  entry function (attached to the struct by the enableBindingStructs transform). */
function shaderVisiblity(struct: BindingStructElem): string {
  const { entryFn } = struct;
  if (!entryFn) {
    identElemLog(struct.name, "missing entry function for binding struct");
  } else {
    for (const { attribute } of entryFn.attributes ?? []) {
      const visibility =
        attribute.kind === "@attribute" && stageVisibility[attribute.name];
      if (visibility) return visibility;
    }
  }
  identElemLog(struct.name, "unknown entry point type for binding struct");
  return "GPUShaderStage.COMPUTE";
}

/** @return a GPUBindGroupLayoutEntry for one member of a WESL binding struct. */
function memberToLayoutEntry(
  member: StructMemberElem,
  visibility: string,
): string {
  const bindingParam = findMap(member.attributes ?? [], ({ attribute: a }) =>
    a.kind === "@attribute" && a.name === "binding" ? a : undefined,
  )?.params?.[0];
  const binding = bindingParam
    ? expressionToString(bindingParam.expression)
    : "?";

  const src = `
      {
        binding: ${binding},
        visibility: ${visibility},
        ${layoutEntry(member)}
      }`;
  return src;
}

/** @return the guts of the GPUBindGroupLayoutEntry for this binding struct member.
 * ptr references to storage arrays become 'buffer' GPUBufferBindingLayout instances,
 * references to WGSL samplers become 'sampler' GPUSamplerBindingLayout instances, etc.
 */
function layoutEntry(member: StructMemberElem): string {
  const { typeRef } = member;
  const { name: typeName } = typeRef;
  let entry = ptrLayoutEntry(typeRef) ?? storageTextureLayoutEntry(typeRef);
  if (!entry && typeof typeName !== "string" && typeName.std) {
    entry =
      samplerLayoutEntry(typeRef) ??
      textureLayoutEntry(typeRef) ??
      externalTextureLayoutEntry(typeRef);
  }
  if (!entry) {
    console.error("unhandled type", typeName);
    entry = "{ }";
  }
  return entry;
}

function ptrLayoutEntry(typeRef: TypeRefElem): string | undefined {
  if (typeRef.name.originalName === "ptr") {
    const param1 = typeRef.templateParams?.[0];
    const param3 = typeRef.templateParams?.[2];
    if (param1?.kind === "type" && param1.name.originalName === "uniform") {
      return `buffer: { type: "uniform" }`;
    } else if (
      param1?.kind === "type" &&
      param1.name.originalName === "storage"
    ) {
      if (param3?.kind === "type" && param3.name.originalName === "read") {
        return `buffer: { type: "read-only-storage" }`;
      } else {
        return `buffer: { type: "storage" }`;
      }
      // LATER what do we do with the element type (2nd parameter)
      // LATER should there be an ability to set hasDynamicOffset?
    }
  }
}

function samplerLayoutEntry(typeRef: TypeRefElem): string | undefined {
  const { originalName } = typeRef.name as RefIdent;
  if (originalName === "sampler") {
    // LATER how do we set: type GPUSamplerBindingType = | "filtering" | "non-filtering";
    // (just assuming filtering as a placeholder for now)
    return `sampler: { type: "filtering" }`;
  }
  if (originalName === "sampler_comparison") {
    return `sampler: { type: "comparison" }`;
  }
}

const textureTypes = matchOneOf(sampledTextureTypes);
const multiNames = matchOneOf(multisampledTextureTypes);

function textureLayoutEntry(typeRef: TypeRefElem): string | undefined {
  const { originalName } = typeRef.name as RefIdent;
  const multisampled = multiNames.test(originalName)
    ? ", multisampled: true, "
    : "";
  if (multisampled || textureTypes.test(originalName)) {
    // LATER viewDimension
    const sampleType = getSampleType(typeRef);
    return `texture: { sampleType: "${sampleType}"${multisampled} }`;
  }
  return undefined;

  function getSampleType(typeRef: TypeRefElem): GPUTextureSampleType {
    const firstParam = typeRef.templateParams?.[0] as TypeRefElem;
    const texelType = (firstParam.name as RefIdent)
      .originalName as WgslTexelType;
    return texelTypeToSampleType(texelType);
  }
}

function storageTextureLayoutEntry(typeRef: TypeRefElem): string | undefined {
  if (textureStorage.test(typeRef.name.originalName)) {
    const firstParam = typeRef.templateParams?.[0];
    const secondParam = typeRef.templateParams?.[1];
    assertThat(firstParam?.kind === "type"); // LATER: Temp hack
    assertThat(secondParam?.kind === "type"); // LATER: Temp hack
    const sampleType = formatToTextureSampleType(
      firstParam.name.originalName as GPUTextureFormat,
    );
    const access = accessMode(secondParam.name.originalName);
    return `storageTexture: { format: "${firstParam.name.originalName}", sampleType: "${sampleType}", access: "${access}" }`;
  }
  return undefined;
}

function externalTextureLayoutEntry(typeRef: TypeRefElem): string | undefined {
  const { originalName } = typeRef.name as RefIdent;
  if (originalName === "texture_external") {
    // LATER. how would we set the required source: HTMLVideoElement or VideoFrame?
  }
  return undefined;
}

export function formatToTextureSampleType(
  format: GPUTextureFormat,
  float32Filterable = false,
): GPUTextureSampleType {
  if (format.includes("32float")) {
    return float32Filterable ? "float" : "unfilterable-float";
  }
  if (format.includes("float") || format.includes("unorm")) {
    return "float";
  }
  if (format.includes("uint")) {
    return "uint";
  }
  if (format.includes("sint")) {
    return "sint";
  }
  throw new Error(`native sample type unknwon for texture format ${format}`);
}

export type WgslTexelType = "f32" | "u32" | "i32";

/** return the wgsl element type for a given texture format */
export function formatToTexelType(format: GPUTextureFormat): WgslTexelType {
  if (format.includes("float")) return "f32";
  if (format.includes("unorm")) return "f32";
  if (format.includes("uint")) return "u32";
  if (format.includes("sint")) return "i32";
  throw new Error(`unknown format ${format}`);
}

/** @return the webgpu GPUTextureSampleType from the wgsl texel type */
export function texelTypeToSampleType(
  type: WgslTexelType,
): GPUTextureSampleType {
  if (type === "f32") return "float";
  if (type === "u32") return "uint";
  if (type === "i32") return "sint";
  throw new Error(`unknown texel type ${type}`);
}

export function accessMode(access: string): GPUStorageTextureAccess {
  if (access === "read") {
    return "read-only";
  }
  if (access === "write") {
    return "write-only";
  }
  if (access === "read_write") {
    return "read-write";
  }
  throw new Error(`unknown access mode: ${access}`);
}
