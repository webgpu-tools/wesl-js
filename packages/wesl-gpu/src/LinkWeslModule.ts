import {
  CompositeResolver,
  createShaderModule,
  link,
  RecordResolver,
} from "wesl";
import type { AnnotatedLayout } from "wesl-reflect";
import type { WeslOptions } from "./FragmentParams.ts";
import { scanUniforms } from "./UniformsVirtualLib.ts";

export type LinkWeslModuleParams = WeslOptions & {
  device: GPUDevice;
  /** Source registered as the root module (may include synthetic prelude). */
  rootSource: string;
  /** Source scanned for @uniforms; usually the user's source without any prelude. */
  scanSource: string;
};

export interface LinkWeslModuleResult {
  module: GPUShaderModule;
  layout: AnnotatedLayout | null;
}

/** Build the resolver chain, scan @uniforms, link, and compile the shader module.
 *  Shared by `linkFragmentShader` and `linkComputeShader`. */
export async function linkWeslModule(
  params: LinkWeslModuleParams,
): Promise<LinkWeslModuleResult> {
  const { rootSource, scanSource, conditions, constants } = params;
  const { device, resolver, libs = [], rootModuleName = "main" } = params;
  const { packageName, config, weslSrc, virtualLibs, weslExtensions } = params;

  const resolvers: RecordResolver[] = [
    new RecordResolver(
      { [rootModuleName]: rootSource },
      { packageName, weslExtensions },
    ),
  ];
  if (weslSrc) resolvers.push(new RecordResolver(weslSrc, { packageName }));

  let finalResolver =
    resolvers.length === 1 ? resolvers[0] : new CompositeResolver(resolvers);
  if (resolver)
    finalResolver = new CompositeResolver([finalResolver, resolver]);

  const pkg = packageName ?? "package";
  const scan = scanUniforms(scanSource, `${pkg}::${rootModuleName}`);
  const mergedVirtualLibs = { ...scan.virtualLibs, ...virtualLibs };

  const linked = await link({
    resolver: finalResolver,
    rootModuleName,
    packageName,
    libs,
    virtualLibs: mergedVirtualLibs,
    conditions,
    constants,
    config,
  });

  const module = createShaderModule(linked, device);
  return { module, layout: scan.layout };
}
