import type { Span } from "./Span.ts";

export function multiKeySet<A, B, V>(
  m: Map<A, Map<B, V>>,
  a: A,
  b: B,
  v: V,
): void {
  const bMap = m.get(a) || new Map();
  m.set(a, bMap);
  bMap.set(b, v);
}

const tokenRegex = /\b(\w+)\b/gi;
/** replace strings in a text according to a relacement map
 * replaced strings must be 'tokens', surrounded by spaces or punctuation
 */
export function replaceWords(
  text: string,
  replace: Record<string, string>,
): string {
  return text.replaceAll(tokenRegex, s => (s in replace ? replace[s] : s));
}

/** return an array partitioned into possibly overlapping groups */
export function grouped<T>(a: T[], size: number, stride = size): T[][] {
  const groups = [];
  for (let i = 0; i < a.length; i += stride) {
    groups.push(a.slice(i, i + size));
  }
  return groups;
}

/** group an array into subarrays by a key function */
export function groupBy<T, K>(a: T[], key: (t: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const t of a) {
    const k = key(t);
    const group = groups.get(k) || [];
    group.push(t);
    groups.set(k, group);
  }
  return groups;
}

/** partition an array into two parts by a discriminator function */
export function partition<T>(a: T[], partFn: (t: T) => boolean): [T[], T[]] {
  const yesPart: T[] = [];
  const noPart: T[] = [];
  for (const t of a) {
    if (partFn(t)) yesPart.push(t);
    else noPart.push(t);
  }
  return [yesPart, noPart];
}

/** run an carrying function over every element in an array,
 * i.e. an inclusive prefix scan */
export function scan<T, U>(array: T[], fn: (a: T, b: U) => U, zero: U): U[] {
  const result = [zero];

  let current = zero;
  for (let i = 0; i < array.length; i++) {
    current = fn(array[i], current);
    result.push(current);
  }
  return result;
}

/** return a new record by replacing values in 'a' with 'b' as a map.
 * values in 'a' that are not in 'b' are unchanged.
 * e.g. {a: "b", x: 9}, {b: 1} yields {a: 1, x: 9}
 */
export function mapForward(
  a: Record<string, string>,
  b: Record<string, any>,
): Record<string, any> {
  const combined = Object.entries(a).map(([key, value]) => {
    const mappedValue = value in b ? b[value] : value;
    return [key, mappedValue];
  });
  return Object.fromEntries(combined);
}

/** return the last element of an array or undefined */
export function last<T>(a: T[]): T | undefined {
  return a[a.length - 1];
}

/**
 * Overlap two arrays, returning the tail of b if a is a prefix of b.
 * Otherwise, return undefined.
 */
export function overlapTail<T>(a: T[], b: T[]): T[] | undefined {
  let overlapSize = Math.min(a.length, b.length);

  while (overlapSize > 0) {
    const suffix = a.slice(-overlapSize);
    const prefix = b.slice(0, overlapSize);
    if (arrayEquals(suffix, prefix)) {
      break;
    } else {
      overlapSize--;
    }
  }

  if (overlapSize) {
    return b.slice(overlapSize);
  }
}

function arrayEquals(a: any[], b: any[]): boolean {
  return a.length === b.length && a.every((val, index) => val === b[index]);
}

/** filter an array, returning the truthy results of the filter function */
export function filterMap<T, U>(arr: T[], fn: (t: T) => U | undefined): U[] {
  const out: U[] = [];
  for (const t of arr) {
    const u = fn(t);
    if (u) out.push(u);
  }
  return out;
}

/** filters an array, returns the first truthy result of the filter function */
export function findMap<T, U>(
  arr: T[],
  fn: (t: T) => U | undefined,
): U | undefined {
  for (const t of arr) {
    const u = fn(t);
    if (u) return u;
  }
  return undefined;
}

/** Run a function over the values in a Record
 * @return a new Record with mapped values.  */
export function mapValues<T, U>(
  obj: Record<string, T>,
  fn: (v: T) => U,
): Record<string, U> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}

/** cache of line-start positions, keyed by source text */
const lineStartCache = new Map<string, number[]>();

/** @return the character position of each line start in the text (cached).
 * Lines are delimited by \n only.
 * LATER: Does this "line break" actually match the spec? I think not */
export function lineStarts(text: string): number[] {
  const found = lineStartCache.get(text);
  if (found) return found;
  const starts = [...text.matchAll(/\n/g)].map(m => m.index + 1);
  starts.unshift(0);
  lineStartCache.set(text, starts);
  return starts;
}

/** @return the index into lineStarts of the line containing offset (binary search) */
export function lineIndexOf(offset: number, starts: number[]): number {
  let low = 0;
  let high = starts.length - 1;
  if (offset >= starts[high]) return high;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (offset >= starts[mid]) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

/** @return a ^^^^ caret line: indent spaces, then at least one caret */
export function caretLine(indent: number, count: number): string {
  return " ".repeat(Math.max(0, indent)) + "^".repeat(Math.max(1, count));
}

/**
 * Maps an character position in a string to a 1-indexed line number, and 1-indexed column.
 */
export function offsetToLineNumber(
  offset: number,
  text: string,
): [lineNum: number, linePos: number] {
  const safeOffset = Math.min(text.length, Math.max(0, offset));
  const starts = lineStarts(text);
  const line = lineIndexOf(safeOffset, starts);
  return [line + 1, 1 + safeOffset - starts[line]];
}

/** Highlights an error.
 *
 * Returns a string with the line, and a string with the ^^^^ carets
 */
export function errorHighlight(source: string, span: Span): [string, string] {
  const safeStart = Math.min(source.length, Math.max(0, span[0]));
  const starts = lineStarts(source);
  const line = lineIndexOf(safeStart, starts);
  const lineStart = starts[line];
  const nextStart = starts[line + 1];
  // slice to just before the \n, or to the end on the last line
  const lineEnd = nextStart !== undefined ? nextStart - 1 : source.length;

  // LATER Handle multiline spans
  return [
    source.slice(lineStart, lineEnd),
    caretLine(span[0] - lineStart, span[1] - span[0]),
  ];
}
