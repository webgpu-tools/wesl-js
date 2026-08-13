/// <reference types="wesl-plugin/suffixes" />

// Touches every published entry point that node side tooling reaches for, in
// one place: the package entries, the vite plugin, and the shader import
// suffixes the plugin declares. The real node side file, vitest.config.ts, is
// in this program too, but only exercises wesl-plugin/vite.
//
// Typechecked by tsconfig.node.json with no DOM lib, no WebGPU types, and
// skipLibCheck off, which is how a real vite config is typechecked. Any
// ambient global that leaks into the published .d.ts files fails there.

import { link } from "wesl/core";
import viteWesl from "wesl-plugin/vite";
import { classifyEntryPoints } from "wesl-reflect";
import { parseDependencies } from "wesl-tooling";
import linkParams from "../shaders/main.wesl?link";
import { structs } from "../shaders/main.wesl?simple_reflect";
import staticWgsl from "../shaders/main.wesl?static";

export const plugins = [viteWesl()];

export async function linkedWgsl(): Promise<string> {
  const linked = await link(linkParams);
  return linked.dest;
}

export const shaderText: string = staticWgsl;
export const memberNames = structs.flatMap(s => Object.keys(s.members));
export const nodeSideApis = { classifyEntryPoints, parseDependencies };
