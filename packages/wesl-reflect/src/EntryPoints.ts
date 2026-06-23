import { declsOfKind, type FnElem, type WeslAST } from "wesl";
import { findAnnotation, numericParams } from "./Annotations.ts";

export type EntryPointStage = "compute" | "fragment" | "vertex";

export interface EntryPoint {
  fnName: string;
  stage: EntryPointStage;
  /** Present iff stage === "compute". WGSL requires @workgroup_size on compute fns,
   *  but we tolerate its absence and return undefined for diagnostic resilience. */
  workgroupSize?: [number, number, number];
}

const stageNames: EntryPointStage[] = ["compute", "fragment", "vertex"];

/** Classify all functions in a parsed WESL module by entry-point stage. */
export function classifyEntryPoints(ast: WeslAST): EntryPoint[] {
  return declsOfKind(ast.moduleElem, "fn").flatMap(fn => entryPointFor(fn));
}

function entryPointFor(fn: FnElem): EntryPoint[] {
  const stage = stageNames.find(s => findAnnotation(fn, s));
  if (!stage) return [];
  const fnName = fn.name.ident.originalName;
  if (stage !== "compute") return [{ fnName, stage }];
  return [{ fnName, stage, workgroupSize: parseWorkgroupSize(fn) }];
}

function parseWorkgroupSize(fn: FnElem): [number, number, number] | undefined {
  const attr = findAnnotation(fn, "workgroup_size");
  if (!attr) return undefined;
  const nums = numericParams(attr);
  if (nums.length === 0) return undefined;
  const [x, y = 1, z = 1] = nums.map(n => (Number.isFinite(n) ? n : 1));
  return [x, y, z];
}
