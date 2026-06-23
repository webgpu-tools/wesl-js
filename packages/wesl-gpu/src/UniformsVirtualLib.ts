import type { StructElem, VirtualLibraryFn } from "wesl";
import { declsOfKind, parseSrcModule } from "wesl";
import {
  type AnnotatedLayout,
  annotatedLayout,
  isUniformsStruct,
} from "wesl-reflect";

/** Result of scanning a shader source for @uniforms. */
export interface UniformsScan {
  /** Layout metadata (null if using default uniforms). */
  layout: AnnotatedLayout | null;

  /** Virtual library record to pass to the linker. */
  virtualLibs: Record<string, VirtualLibraryFn>;
}

/** Default env:: module when no @uniforms struct is declared. */
const defaultEnvSource = `
  struct Uniforms {
    resolution: vec2f,
    time: f32,
  }
  @group(0) @binding(0) var<uniform> u: Uniforms;
`;

/**
 * Scan entry module source for an @uniforms struct and produce:
 * - The AnnotatedLayout for buffer management (or null for default)
 * - A virtual library that generates the correct env:: module
 */
export function scanUniforms(
  entrySource: string,
  rootModulePath = "package::main",
): UniformsScan {
  const struct = findUniformsStruct(entrySource, rootModulePath);

  if (struct) {
    const layout = annotatedLayout(struct);
    const structName = struct.name.ident.originalName;

    const env: VirtualLibraryFn = ({ rootModulePath: root }) => `
      import ${root}::${structName};
      @group(0) @binding(0) var<uniform> u: ${structName};
    `;
    return { layout, virtualLibs: { env } };
  }

  return { layout: null, virtualLibs: { env: () => defaultEnvSource } };
}

/** Parse source and find a struct annotated with @uniforms. */
function findUniformsStruct(
  src: string,
  modulePath: string,
): StructElem | undefined {
  const ast = parseSrcModule({ modulePath, debugFilePath: "entry", src });
  return declsOfKind(ast.moduleElem, "struct").find(isUniformsStruct);
}
