import type { SrcMap, SrcWithPath } from "./SrcMap.ts";
import { caretLine, lineIndexOf, lineStarts } from "./Util.ts";

/** a console.log-like sink (declared structurally so that "wesl/core"
 * doesn't depend on ambient DOM or node globals) */
export type LogFn = (...data: any[]) => void;

/** base logger (can be overridden to a capturing logger for tests) */
export let log: LogFn = console.log;

/** enable debug assertions and verbose error messages (set false via bundler for smaller builds) */
export const debug = true;

/** enable user-facing validation like operator binding rules (set false via bundler for smaller builds) */
export const validation = true;

/** use temporary logger for tests */
export function withLogger<T>(logFn: LogFn, fn: () => T): T {
  const orig = log;
  try {
    log = logFn;
    return fn();
  } finally {
    log = orig;
  }
}

/** use temporary logger for async tests */
export async function withLoggerAsync<T>(
  logFn: LogFn,
  fn: () => Promise<T>,
): Promise<T> {
  const orig = log;
  try {
    log = logFn;
    return await fn();
  } finally {
    log = orig;
  }
}

interface SrcPositions {
  positions: number | [number, number];
  src: SrcWithPath;
}

interface SrcLine {
  /** src line w/o newline */
  line: string;
  /** requested position relative to line start */
  linePos: number;
  /** requested position2 relative to line start */
  linePos2?: number;
  /** line number in the src (first line is #1) */
  lineNum: number;
}

/**
 * Log a message along with the source line and a caret indicating the error position.
 * @param pos is the position in the source string, or if src is a SrcMap,
 *   then pos is the position in the dest (e.g. preprocessed) text
 */
export function srcLog(
  src: string | SrcMap,
  pos: number | [number, number],
  ...msgs: any[]
): void {
  if (typeof src === "string") {
    logInternalSrc(log, src, pos, ...msgs);
    return;
  }
  const { src: mappedSrc, positions } = mapSrcPositions(src, pos);
  logInternalSrc(log, mappedSrc.text, positions, ...msgs);
}

/** return the line in the src containing a given character position */
export function srcLine(
  src: string,
  position: number | [number, number],
): SrcLine {
  let pos: number;
  let pos2: number | undefined;
  if (typeof position === "number") {
    pos = position;
  } else {
    [pos, pos2] = position;
  }
  const starts = lineStarts(src);
  const lineIndex = lineIndexOf(pos, starts);
  const lineStart = starts[lineIndex];
  const nextStart = starts[lineIndex + 1]; // undefined on the last line
  const lineEnd = nextStart !== undefined ? nextStart - 1 : src.length;
  const line = src.slice(lineStart, lineEnd);

  let linePos2: number | undefined;
  const sameLine = pos2 !== undefined && pos2 >= lineStart && pos2 <= lineEnd;
  if (sameLine) linePos2 = pos2! - lineStart;

  return { line, linePos: pos - lineStart, linePos2, lineNum: lineIndex + 1 };
}

function logInternalSrc(
  logFn: LogFn,
  src: string,
  pos: number | [number, number],
  ...msgs: any[]
): void {
  logFn(...msgs);
  const { line, lineNum, linePos, linePos2 } = srcLine(src, pos);
  logFn(line, `  Ln ${lineNum}`);
  const caret = carets(linePos, linePos2);
  logFn(caret);
}

/** Map a dest position (or range) back to one src text, narrowing a range that
 *  straddles two src texts to just its start position. */
function mapSrcPositions(
  srcMap: SrcMap,
  destPos: number | [number, number],
): SrcPositions {
  const [start, end] = Array.isArray(destPos) ? destPos : [destPos, destPos];
  const srcPos = srcMap.destToSrc(start);
  const { src, position } = srcPos;

  if (end > start) {
    const srcEnd = srcMap._destToSrcEnd(srcPos, end);
    if (srcEnd !== undefined) return { src, positions: [position, srcEnd] };
  }
  return { src, positions: position };
}

function carets(linePos: number, linePos2?: number): string {
  return caretLine(linePos, linePos2 ? linePos2 - linePos : 1);
}
