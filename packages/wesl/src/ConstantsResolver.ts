import type { ModuleResolver } from "./ModuleResolver.ts";
import { parseSrcModule, type WeslAST } from "./ParseWESL.ts";

/** Create a resolver exposing host constants as the `constants` module.
 * Returns undefined when no constants are given, so the result composes
 * cleanly with composeResolvers (which skips undefined entries). */
export function createConstantsResolver(
  constants: Record<string, string | number>,
  packageName?: string,
): ConstantsResolver | undefined {
  if (Object.keys(constants).length === 0) return undefined;
  return new ConstantsResolver(constants, packageName);
}

/** Resolver for the `constants` virtual module, exposing host (js/ts) values
 * to wesl code: `import constants::num_lights;`
 *
 * Constants don't depend on conditions, so the module is parsed once
 * and cached for the life of the resolver. */
export class ConstantsResolver implements ModuleResolver {
  readonly constants: Record<string, string | number>;
  readonly packageName: string;
  private ast?: WeslAST;

  constructor(
    constants: Record<string, string | number>,
    packageName = "package",
  ) {
    this.constants = constants;
    this.packageName = packageName;
  }

  resolveModule(modulePath: string): WeslAST | undefined {
    if (modulePath !== "constants") return undefined;
    if (this.ast) return this.ast;

    const src = Object.entries(this.constants)
      .map(([name, value]) => `const ${name} = ${value};`)
      .join("\n");
    this.ast = parseSrcModule({
      // parsed under the host package so mangled names match other modules
      modulePath: `${this.packageName}::constants`,
      debugFilePath: "constants",
      src,
    });
    return this.ast;
  }
}
