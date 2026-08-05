/**
 * Operator and swizzle name tables shared by type synthesis and const
 * evaluation.
 */

/** Binary operators that yield a bool (per component for vectors). */
export const comparisonOps = ["==", "!=", "<", "<=", ">", ">="];

/** True if `name` is a vector swizzle: 1-4 components from xyzw or rgba. */
export function isSwizzle(name: string): boolean {
  return /^([xyzw]{1,4}|[rgba]{1,4})$/.test(name);
}
