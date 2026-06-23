import fs from "node:fs/promises";
import { declsOfKind, type StructElem } from "wesl";
import { originalTypeName, weslStructs, wgslTypeToTs } from "wesl-reflect";
import type {
  PluginExtension,
  PluginExtensionApi,
} from "../PluginExtension.ts";

export interface SimpleReflectOptions {
  /** directory to contain the .d.ts files or undefined to not write .d.ts files */
  typesDir?: string;
}

/** wesl-js build extension to reflect wgsl structs into js and .d.ts files. */
export function simpleReflect(
  options: SimpleReflectOptions = {},
): PluginExtension {
  const { typesDir = "./src/types" } = options;
  return {
    extensionName: "simple_reflect",
    emitFn: async (_baseId: string, api: PluginExtensionApi) => {
      const registry = await api.weslRegistry();
      const astStructs = [...registry.allModules()].flatMap(([, module]) =>
        declsOfKind(module.moduleElem, "struct"),
      );

      const jsStructs = weslStructs(astStructs);
      if (typesDir) await writeTypes(astStructs, typesDir);

      const structArray = JSON.stringify(jsStructs, null, 2);
      return `export const structs = ${structArray};`;
    },
  };
}

/** Write .d.ts file with TypeScript interfaces for reflected structs. */
async function writeTypes(
  structs: StructElem[],
  typesDir: string,
): Promise<void> {
  const tsdInterfaces = structs.map(s => {
    const name = s.name.ident.originalName;
    const entries = s.members.map(m => {
      const tsType = wgslTypeToTs(originalTypeName(m.typeRef));
      return `  ${m.name.name}: ${tsType};`;
    });
    return `interface ${name} {\n${entries.join("\n")}\n}`;
  });
  await fs.mkdir(typesDir, { recursive: true });
  await fs.writeFile(`${typesDir}/reflectTypes.d.ts`, tsdInterfaces.join("\n"));
}
