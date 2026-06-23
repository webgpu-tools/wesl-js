import { declsOfKind, type FnElem, type WeslAST } from "wesl";
import { findAnnotation, firstRefName, numericParams } from "wesl-reflect";

export interface TestFunctionInfo {
  name: string;
  description?: string;
  fn: FnElem;
}

export interface SnapshotFunctionInfo {
  name: string;
  snapshotName: string;
  extent: [number, number];
  fn: FnElem;
}

/** Format test name for display: "fnName" or "fnName - description" */
export function testDisplayName(name: string, description?: string): string {
  return description ? `${name} - ${description}` : name;
}

/** Find all functions marked with @test attribute (excluding @snapshot fns). */
export function findTestFunctions(ast: WeslAST): TestFunctionInfo[] {
  return declsOfKind(ast.moduleElem, "fn")
    .filter(fn => findAnnotation(fn, "test") && !findAnnotation(fn, "snapshot"))
    .filter(fn => {
      if (fn.params.length > 0) {
        const name = fn.name.ident.originalName;
        console.warn(
          `@test function '${name}' has parameters and will be skipped`,
        );
        return false;
      }
      return true;
    })
    .map(fn => ({
      name: fn.name.ident.originalName,
      description: getTestDescription(fn),
      fn,
    }));
}

/** Find all @fragment @snapshot functions in a parsed WESL module. */
export function findSnapshotFunctions(ast: WeslAST): SnapshotFunctionInfo[] {
  return declsOfKind(ast.moduleElem, "fn")
    .filter(
      fn => findAnnotation(fn, "fragment") && findAnnotation(fn, "snapshot"),
    )
    .map(fn => ({
      name: fn.name.ident.originalName,
      snapshotName: extractSnapshotName(fn),
      extent: extractExtent(fn),
      fn,
    }));
}

/** Extract description from @test(description) attribute. */
function getTestDescription(fn: FnElem): string | undefined {
  return firstRefName(findAnnotation(fn, "test")?.params?.[0]);
}

/** Extract snapshot name from @snapshot(name) or fall back to fn name. */
function extractSnapshotName(fn: FnElem): string {
  const param = findAnnotation(fn, "snapshot")?.params?.[0];
  return firstRefName(param) ?? fn.name.ident.originalName;
}

/** Extract extent from @extent(w, h), default [256, 256]. */
function extractExtent(fn: FnElem): [number, number] {
  const attr = findAnnotation(fn, "extent");
  if (!attr) return [256, 256];
  const nums = numericParams(attr).map(n => n || 256);
  return [nums[0] ?? 256, nums[1] ?? nums[0] ?? 256];
}
