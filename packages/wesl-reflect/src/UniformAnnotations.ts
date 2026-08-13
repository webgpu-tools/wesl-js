import type { StructElem, StructMemberElem } from "wesl/core";
import {
  annotationParams,
  findAnnotation,
  numericParams,
} from "./Annotations.ts";

export interface RangeAnnotation {
  min: number;
  max: number;
  initial: number;
  step?: number;
}

export interface ColorAnnotation {
  initial: [number, number, number];
}

export interface ToggleAnnotation {
  initial: 0 | 1;
}

export interface AutoAnnotation {
  autoName: string;
}

/** Check if a struct has @uniforms annotation. */
export function isUniformsStruct(struct: StructElem): boolean {
  return findAnnotation(struct, "uniforms") !== undefined;
}

/** Extract @range(min, max [, step [, initial]]) from a member. */
export function rangeAnnotation(
  member: StructMemberElem,
): RangeAnnotation | undefined {
  const attr = findAnnotation(member, "range");
  if (!attr) return undefined;
  const nums = numericParams(attr);
  const [min = 0, max = 1] = nums;
  return { min, max, step: nums[2], initial: nums[3] ?? min };
}

/** Extract @color(r, g, b) from a member. */
export function colorAnnotation(
  member: StructMemberElem,
): ColorAnnotation | undefined {
  const attr = findAnnotation(member, "color");
  if (!attr) return undefined;
  const [r = 0, g = 0, b = 0] = numericParams(attr);
  return { initial: [r, g, b] };
}

/** Extract @toggle([initial]) from a member. */
export function toggleAnnotation(
  member: StructMemberElem,
): ToggleAnnotation | undefined {
  const attr = findAnnotation(member, "toggle");
  if (!attr) return undefined;
  const nums = numericParams(attr);
  return { initial: (nums[0] ?? 0) as 0 | 1 };
}

/** Extract @auto or @auto(name) from a member. */
export function autoAnnotation(
  member: StructMemberElem,
): AutoAnnotation | undefined {
  const attr = findAnnotation(member, "auto");
  if (!attr) return undefined;
  const params = annotationParams(attr);
  return { autoName: params[0] ?? member.name.name };
}
