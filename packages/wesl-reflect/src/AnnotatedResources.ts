import {
  type AttributeElem,
  declsOfKind,
  type GlobalVarElem,
  type StandardAttribute,
  type WeslAST,
  type WeslJsPlugin,
} from "wesl";
import { findAnnotation, firstRefName, numericParams } from "./Annotations.ts";
import { buildStructRegistry, type StructRegistry } from "./StructLayout.ts";
import { typeShape } from "./TypeShape.ts";
import { originalTypeName } from "./WeslStructs.ts";

/** Discovered buffer resource from @buffer annotation. */
export interface DiscoveredBuffer {
  kind: "buffer";
  varName: string;
  access: "read" | "read_write";
  byteSize: number;
}

/** Discovered texture resource from @test_texture annotation. */
export interface DiscoveredTexture {
  kind: "test_texture";
  varName: string;
  source: string;
  params: number[];
  /** WGSL type name of the declared var, e.g. "texture_2d". */
  typeName: string;
}

/** Discovered texture resource from @texture(name) annotation (user-supplied image). */
export interface DiscoveredUserTexture {
  kind: "texture";
  varName: string;
  source: string;
  /** WGSL type name of the declared var, e.g. "texture_2d". */
  typeName: string;
}

/** Discovered sampler resource from @sampler annotation. */
export interface DiscoveredSampler {
  kind: "sampler";
  varName: string;
  filter: "linear" | "nearest";
}

export type DiscoveredResource =
  | DiscoveredBuffer
  | DiscoveredTexture
  | DiscoveredUserTexture
  | DiscoveredSampler;

/** Find all @buffer, @test_texture, @sampler annotated global vars in a parsed WESL module. */
export function findAnnotatedResources(ast: WeslAST): DiscoveredResource[] {
  const src = ast.srcModule.src;
  const structs = buildStructRegistry(ast);
  return declsOfKind(ast.moduleElem, "gvar").flatMap(gvar =>
    discoverResource(gvar, src, structs),
  );
}

/** Linker plugin that decorates @buffer/@test_texture/@sampler globals with
 *  @group(0) @binding(N) so they emit as bindable WGSL vars.
 *  The wgsl-test annotations themselves drop at emit (non-WGSL attributes).
 *  Throws if a target var already carries user-supplied @group/@binding. */
export function annotatedResourcesPlugin(
  resources: DiscoveredResource[],
  startBinding = 1,
): WeslJsPlugin {
  const bindingByName = new Map(
    resources.map((r, i) => [r.varName, startBinding + i]),
  );
  return {
    transform: ast => {
      for (const elem of declsOfKind(ast.moduleElem, "gvar")) {
        const varName = elem.name.decl.ident.originalName;
        const binding = bindingByName.get(varName);
        if (binding === undefined) continue;
        assertNoUserBinding(elem, varName);
        const anchor = annotationAnchor(elem);
        const groupAttr = makeStandardAttr("group", 0, anchor);
        const bindingAttr = makeStandardAttr("binding", binding, anchor);
        elem.attributes = [...(elem.attributes ?? []), groupAttr, bindingAttr];
      }
      return ast;
    },
  };
}

/** Dispatch on which runtime annotation the gvar carries; returns [] if none. */
function discoverResource(
  gvar: GlobalVarElem,
  src: string,
  structs: StructRegistry,
): DiscoveredResource[] {
  if (findAnnotation(gvar, "buffer"))
    return [discoverBuffer(gvar, src, structs)];

  const textureAttr = findAnnotation(gvar, "test_texture");
  if (textureAttr) return [discoverTexture(gvar, textureAttr)];

  const userTextureAttr = findAnnotation(gvar, "texture");
  if (userTextureAttr) return [discoverUserTexture(gvar, userTextureAttr)];

  const samplerAttr = findAnnotation(gvar, "sampler");
  if (samplerAttr) return [discoverSampler(gvar, samplerAttr)];

  return [];
}

/** Throw if the user has already put @group or @binding on an annotated var. */
function assertNoUserBinding(gvar: GlobalVarElem, varName: string): void {
  if (findAnnotation(gvar, "group") || findAnnotation(gvar, "binding")) {
    throw new Error(
      `@buffer/@test_texture/@texture/@sampler on var '${varName}' cannot be combined with ` +
        `user-supplied @group/@binding — the runtime owns the binding for annotated resources.`,
    );
  }
}

/** Pick a source position to anchor synthetic attributes on, preferring the
 *  runtime annotation so error maps point to something meaningful. */
function annotationAnchor(gvar: GlobalVarElem): { start: number; end: number } {
  for (const name of ["buffer", "test_texture", "texture", "sampler"]) {
    const attr = gvar.attributes?.find(
      a => a.attribute.kind === "@attribute" && a.attribute.name === name,
    );
    if (attr) return { start: attr.start, end: attr.end };
  }
  return { start: gvar.start, end: gvar.start };
}

/** Build a synthetic `@name(value)` standard attribute anchored at the given source span. */
function makeStandardAttr(
  name: string,
  value: number,
  anchor: { start: number; end: number },
): AttributeElem {
  const { start, end } = anchor;
  return {
    kind: "attribute",
    start,
    end,
    attribute: {
      kind: "@attribute",
      name,
      params: [
        {
          kind: "expression",
          start,
          end,
          expression: { kind: "literal", value: String(value), start, end },
        },
      ],
    },
  };
}

function discoverBuffer(
  gvar: GlobalVarElem,
  src: string,
  structs: StructRegistry,
): DiscoveredBuffer {
  const varName = gvar.name.decl.ident.originalName;
  const declText = src.slice(gvar.start, gvar.end);
  const access = declText.includes("read_write") ? "read_write" : "read";
  const { typeRef } = gvar.name;
  const byteSize = typeRef ? typeShape(typeRef, structs, varName).size : 0;
  return { kind: "buffer", varName, access, byteSize };
}

function discoverTexture(
  gvar: GlobalVarElem,
  attr: StandardAttribute,
): DiscoveredTexture {
  const varName = gvar.name.decl.ident.originalName;
  const source = firstRefName(attr.params?.[0]) ?? "";
  // params[0] is the source ref (NaN here); the rest are the dimension ints.
  const numParams = numericParams(attr)
    .slice(1)
    .map(n => n || 0);
  const typeName = gvar.name.typeRef ? originalTypeName(gvar.name.typeRef) : "";
  return { kind: "test_texture", varName, source, params: numParams, typeName };
}

function discoverUserTexture(
  gvar: GlobalVarElem,
  attr: StandardAttribute,
): DiscoveredUserTexture {
  const varName = gvar.name.decl.ident.originalName;
  const source = firstRefName(attr.params?.[0]) ?? "";
  const typeName = gvar.name.typeRef ? originalTypeName(gvar.name.typeRef) : "";
  return { kind: "texture", varName, source, typeName };
}

function discoverSampler(
  gvar: GlobalVarElem,
  attr: StandardAttribute,
): DiscoveredSampler {
  const varName = gvar.name.decl.ident.originalName;
  const filterName = firstRefName(attr.params?.[0]) ?? "linear";
  const filter = filterName === "nearest" ? "nearest" : "linear";
  return { kind: "sampler", varName, filter };
}
