import type { SrcMap, SrcWithPath } from "./SrcMap.ts";

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

interface SrcPositions {
  positions: number | [number, number];
  src: SrcWithPath;
}

function mapSrcPositions(
  srcMap: SrcMap,
  destPos: number | [number, number],
): SrcPositions {
  const srcPos = srcMap.mapPositions(...[destPos].flat());
  const { src } = srcPos[0];

  let positions: [number, number] | number;
  if (srcPos[1]?.src?.path === src.path && srcPos[1]?.src?.text === src.text) {
    positions = srcPos.map(p => p.position) as [number, number];
  } else {
    positions = srcPos[0].position;
  }

  return { src, positions };
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

function carets(linePos: number, linePos2?: number): string {
  const indent = " ".repeat(Math.max(0, linePos));
  const numCarets = linePos2 ? linePos2 - linePos : 1;
  const caretStr = "^".repeat(Math.max(1, numCarets));
  return indent + caretStr;
}

// map from src strings to line start positions
const startCache = new Map<string, number[]>();

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
  const starts = getStarts(src);

  let start = 0;
  let end = starts.length - 1;

  // short circuit search if pos is after last line start
  if (pos >= starts[end]) {
    start = end;
  }

  // binary search to find start,end positions that surround provided pos
  while (start + 1 < end) {
    const mid = (start + end) >> 1;
    if (pos >= starts[mid]) {
      start = mid;
    } else {
      end = mid;
    }
  }

  let linePos2: number | undefined;
  if (pos2 !== undefined && pos2 >= starts[start] && pos2 < starts[end]) {
    linePos2 = pos2 - starts[start];
  }

  // get line with possible trailing newline
  const lineNl = src.slice(starts[start], starts[start + 1] || src.length);

  // return line without trailing newline
  const line = lineNl.slice(-1) === "\n" ? lineNl.slice(0, -1) : lineNl;

  return { line, linePos: pos - starts[start], linePos2, lineNum: start + 1 };
}

/** return an array of the character positions of the start of each line in the src (cached) */
function getStarts(src: string): number[] {
  const found = startCache.get(src);
  if (found) return found;
  const starts = [...src.matchAll(/\n/g)].map(m => m.index! + 1);
  starts.unshift(0);
  startCache.set(src, starts);
  return starts;
}
