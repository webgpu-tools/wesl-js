import type {
  AbstractElem,
  AbstractElemBase,
  CommentElem,
  ModuleElem,
  SyntheticElem,
} from "../AbstractElems.ts";
import { childElems } from "../LinkerUtil.ts";
import type { SrcModule } from "../Scope.ts";
import type { ParsingContext } from "./ParsingContext.ts";
import type { CommentTrivia } from "./WeslStream.ts";

/** An AST node with a source position (i.e. not a synthetic elem). Every such
 *  node can carry comments via the {@link AbstractElemBase} fields. */
type Positioned = Exclude<AbstractElem, SyntheticElem>;

/** The comment lists an element can carry: the {@link AbstractElemBase} pair
 *  plus a block's `innerComments`. */
type CommentHolder = Pick<
  AbstractElemBase,
  "commentsBefore" | "commentsAfter"
> & { innerComments?: CommentElem[] };

const tab = 0x09;
const lineFeed = 0x0a;
const verticalTab = 0x0b;
const formFeed = 0x0c;
const carriageReturn = 0x0d;
const space = 0x20;
const nextLine = 0x85;
const leftToRightMark = 0x200e;
const rightToLeftMark = 0x200f;
const lineSeparator = 0x2028;
const paragraphSeparator = 0x2029;

/**
 * Attach every recorded comment to a node in the parsed tree.
 *
 * Each comment run (a contiguous group of comments between two real tokens) is
 * anchored to the deepest node that contains it in a gap between children, then
 * distributed to the surrounding children:
 * - a comment that begins its own line leads the next child (`commentsBefore`);
 * - an inline comment trails the previous child (`commentsAfter`), unless it
 *   hugs the next child -- only blank space and comments, no separator token,
 *   between them -- in which case it leads the next child instead;
 * - comments before a closing token with no following child trail the last child,
 *   or land in an empty block's `innerComments`.
 *
 * Descending into expressions (via {@link childElems}) means interior comments
 * like the one in `foo(1, /* x *\/ 2)` are preserved on the `2`, not dropped.
 *
 * The runs arrive in source order (see `WeslStream.commentRuns`), so one
 * in-order walk of the tree places them all: see {@link attachWithin}.
 */
export function attachComments(
  ctx: ParsingContext,
  moduleElem: ModuleElem,
): void {
  const { srcModule } = ctx.state.stable;
  const runs = ctx.stream.commentRuns();
  if (runs.length === 0) return; // no comments: don't walk the tree at all
  // the module spans the whole source, so it contains every run and the walk
  // returns having placed all of them
  attachWithin(moduleElem, runs, 0, srcModule);
}

/**
 * Attach the runs that lie inside `node`, starting at `runs[firstRunIndex]`,
 * and return the index of the first run left for an ancestor to place.
 *
 * A run's anchor is the deepest node containing it, so the walk descends into
 * the child holding the run and otherwise treats `node` as the anchor, splitting
 * the run across the gap between the two children that bracket it.
 *
 * Both the child index and the run cursor only move forward. Sibling spans are
 * disjoint and in source order, and so are the runs, so a child that ends before
 * the current run ends before every later run too, and can never bracket or hold
 * one again. Each node is therefore visited once, its children computed once,
 * and the whole pass costs one scan of the tree rather than a descent per run.
 *
 * Recursion depth is AST depth, which loop-built operator chains (`a + a + ...`)
 * can push past the parser's maxNesting recursion guard; that's acceptable
 * because bind/emit recurse over the same tree and overflow on shallower input,
 * and an overflow here surfaces as a wrapped WeslParseError.
 */
function attachWithin(
  node: Positioned,
  runs: CommentTrivia[][],
  firstRunIndex: number,
  srcModule: SrcModule,
): number {
  const children = positioned(childElems(node));
  let childIndex = 0; // first child that can still hold or bracket a run
  let runIndex = firstRunIndex;
  while (runIndex < runs.length) {
    const run = runs[runIndex];
    const start = run[0].start;
    const end = runEnd(run);
    if (start < node.start || node.end < end) return runIndex; // an ancestor owns it

    while (childIndex < children.length && children[childIndex].end <= start) {
      childIndex++;
    }
    const child: Positioned | undefined = children[childIndex];

    // a child containing the whole run holds the anchor: it ends at/after the
    // run, so the scan above never passed it
    if (child !== undefined && child.start <= start && end <= child.end) {
      // the same containment test gates the recursion, so the call places at
      // least this run and `runIndex` always advances
      runIndex = attachWithin(child, runs, runIndex, srcModule);
      continue; // later runs may sit in a gap of this node, after `child`
    }

    // no child contains the run, so `node` is its anchor. The bracketing
    // children are in hand:
    //   prev ends at/before the comments
    //   next starts at/after the comments
    //   prev, next may be missing:
    //     prev when the run leads the anchor's first child
    //     next when the run dangles after the last child
    //     both when the anchor has no children (e.g. an empty block)
    const prev = childIndex > 0 ? children[childIndex - 1] : undefined;
    const next = firstAfter(children, childIndex, end);
    distribute(node, run, prev, next, srcModule);
    runIndex++;
  }
  return runIndex;
}

/** Source-positioned children, sorted in source order. Synthetic elems (no
 *  source position) cannot anchor comments and are dropped. Children usually
 *  arrive already in source order, so the sort is skipped when possible.
 *  Filtering and order-checking share one pass: this runs per node, so it's
 *  kept deliberately lean. */
function positioned(elems: readonly AbstractElem[]): Positioned[] {
  const result: Positioned[] = [];
  let sorted = true; // starts in source order until proven otherwise
  let lastStart = -1;
  for (const e of elems) {
    if (e.kind === "synthetic") continue;
    if (e.start < lastStart) sorted = false;
    lastStart = e.start;
    result.push(e);
  }
  if (!sorted) result.sort((a, b) => a.start - b.start);
  return result;
}

function runEnd(run: CommentTrivia[]): number {
  return run[run.length - 1].end;
}

/** The first child at or after `fromIndex` that starts at/after source position
 *  `end`, i.e. the child a run ending at `end` leads. Children before
 *  `fromIndex` all end at/before the run, so they start before it too and could
 *  never qualify. Sorted starts make this the first match; the loop steps only
 *  over children overlapping the run, and real spans never overlap a comment. */
function firstAfter(
  children: Positioned[],
  fromIndex: number,
  end: number,
): Positioned | undefined {
  for (let i = fromIndex; i < children.length; i++) {
    if (children[i].start >= end) return children[i];
  }
  return undefined;
}

/** Split a comment run between the previous child (trailing) and the next child
 *  (leading) of its anchor, or onto the last child / inner comments when it
 *  dangles before a closing token. The walk supplies the bracketing children,
 *  which it already found while locating the anchor. */
function distribute(
  anchor: Positioned,
  run: CommentTrivia[],
  prev: Positioned | undefined,
  next: Positioned | undefined,
  srcModule: SrcModule,
): void {
  if (!next) {
    // run dangles after the last child, before the anchor's closing token
    if (prev) addComments(prev, "commentsAfter", run, srcModule);
    // empty block: nothing to attach to, so the comments live inside it.
    // A block left empty by error recovery can take more than one run (the
    // dropped statement separated them), so append rather than replace.
    else if (anchor.kind === "block")
      addComments(anchor, "innerComments", run, srcModule);
    // empty non-block container: keep the comments rather than drop them
    else addComments(anchor, "commentsBefore", run, srcModule);
    return;
  }

  // one run in a gap can hold comments belonging to both sides -- some trailing
  // prev (on its line), some leading next -- so split it at the boundary:
  // [0, split) trail prev, [split, end) lead next.
  const split = splitPoint(prev, next, run, srcModule.src);
  if (prev && split > 0)
    addComments(prev, "commentsAfter", run.slice(0, split), srcModule);
  if (split < run.length)
    addComments(next, "commentsBefore", run.slice(split), srcModule);
}

/** Append converted comments to one of an element's comment lists. */
function addComments(
  elem: CommentHolder,
  field: keyof CommentHolder,
  trivia: CommentTrivia[],
  srcModule: SrcModule,
): void {
  const comments = trivia.map(t => makeComment(t, srcModule));
  const existing = elem[field];
  elem[field] = existing ? [...existing, ...comments] : comments;
}

/**
 * Index into `run` where it flips from trailing `prev` to leading `next`:
 * caller attaches run[0, split) to `prev` and run[split, end) to `next`.
 *
 * The aim is to keep each comment with the code it describes, so it stays
 * meaningful after the tree is reordered or reformatted. That follows how people
 * write comments: a comment on its own line documents what comes after it, while
 * a comment sharing a line with code documents that code. Hence:
 * - with no previous child the whole run leads (split 0);
 * - otherwise the split is the first comment that begins its own line;
 * - failing that (an all-inline run), it is the start of the suffix that hugs
 *   `next` on the same line, so the comment in `foo(1, /* x *\/ 2)` documents,
 *   and lands on, the `2`.
 */
function splitPoint(
  prev: Positioned | undefined,
  next: Positioned,
  run: CommentTrivia[],
  src: string,
): number {
  if (!prev) return 0;
  const ownLine = firstOwnLine(run, src);
  return ownLine >= 0 ? ownLine : hugsNextStart(run, next.start, src);
}

function makeComment(trivia: CommentTrivia, srcModule: SrcModule): CommentElem {
  const { style, start, end } = trivia;
  const comment: CommentElem = {
    kind: "comment",
    style,
    start,
    end,
    srcModule,
  };
  // a fully blank line above the comment is preserved in the output
  if (lineBreaksBefore(srcModule.src, start) >= 2) comment.blankBefore = true;
  return comment;
}

/** Index of the first comment that begins its own line (after a line break),
 *  or -1 if none do. */
function firstOwnLine(run: CommentTrivia[], src: string): number {
  return run.findIndex(t => lineBreaksBefore(src, t.start) >= 1);
}

/** Start index of the trailing suffix of `run` that is joined to `next` by
 *  same-line whitespace only (no line break, no separator token between them).
 *  Returns run.length when nothing hugs `next`. */
function hugsNextStart(
  run: CommentTrivia[],
  nextStart: number,
  src: string,
): number {
  let suffixStart = run.length; // nothing hugs `next` until proven otherwise
  let rightStart = nextStart; // start of the neighbor just right of this comment
  for (let i = run.length - 1; i >= 0; i--) {
    const comment = run[i];
    // stop once more than blank space sits between this comment and its neighbor
    if (!sameLineGap(src, comment.end, rightStart)) break;
    suffixStart = i;
    rightStart = comment.start;
  }
  return suffixStart;
}

// Blankspace classification per https://www.w3.org/TR/WGSL/#blankspace-and-line-breaks
// (the tokenizer matches the same set via the blankspaces/lineBreak regexes).

/** Count line breaks in the whitespace run immediately before `pos`, capped at 2:
 *  callers only need none / one line break / a blank line. Scans backward over
 *  blankspace, stopping at the first non-blankspace char, so cost is the gap
 *  length, not the source length. `\r\n` counts as one break. */
function lineBreaksBefore(src: string, pos: number): number {
  let count = 0;
  for (let i = pos - 1; i >= 0; i--) {
    const c = src.charCodeAt(i);
    if (isLineBreak(c)) {
      if (c === lineFeed && src.charCodeAt(i - 1) === carriageReturn) i--; // \r\n
    } else if (isInlineSpace(c)) {
      continue; // still inside the run
    } else {
      break; // run ended at a non-blankspace char
    }
    if (++count >= 2) return 2;
  }
  return count;
}

/** True when [from, to) is inline blankspace only (no line break): the two ends
 *  sit on the same line with nothing but same-line spaces between. */
function sameLineGap(src: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    if (!isInlineSpace(src.charCodeAt(i))) return false;
  }
  return true;
}

/** A WGSL line break code point. `\r\n` is two of these; callers coalesce it. */
function isLineBreak(c: number): boolean {
  return (
    c === lineFeed ||
    c === carriageReturn ||
    c === verticalTab ||
    c === formFeed ||
    c === nextLine ||
    c === lineSeparator ||
    c === paragraphSeparator
  );
}

/** WGSL blankspace that stays on the same line (not a line break). */
function isInlineSpace(c: number): boolean {
  return (
    c === space || c === tab || c === leftToRightMark || c === rightToLeftMark
  );
}
