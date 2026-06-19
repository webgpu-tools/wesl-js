import type {
  AbstractElem,
  CommentElem,
  GrammarElem,
  OpenElemKind,
} from "../AbstractElems.ts";
import type { OpenElem } from "../ParseWESL.ts";
import type { SrcModule } from "../Scope.ts";
import type { ParsingContext } from "./ParsingContext.ts";
import type { CommentTrivia } from "./WeslStream.ts";

/** An element that can carry attached comments. */
interface Commentable {
  start: number;
  commentsBefore?: CommentElem[];
  commentsAfter?: CommentElem[];
}

/** Push an open elem whose scratch buffer collects children parsed beneath it. */
export function beginElem(
  ctx: ParsingContext,
  kind: OpenElemKind,
  contents: readonly GrammarElem[] = [],
): void {
  ctx.state.context.openElems.push({ kind, contents: [...contents] });
}

/** Pop the open element, discarding its collected contents. Used by statements,
 *  which capture their children in typed fields and keep no `contents`. */
export function discardOpenElem(ctx: ParsingContext): void {
  popOpenElem(ctx);
}

/** Pop the open element and return its collected children, in source order.
 *  Used by the module, which keeps its ordered children in a typed `decls`
 *  array and emits them structurally. */
export function finishCollected(ctx: ParsingContext): GrammarElem[] {
  return popOpenElem(ctx).contents as GrammarElem[];
}

/**
 * Distribute the comments recorded by the stream onto a container's children.
 * A comment on the same line as the previous child becomes that child's
 * trailing comment (`commentsAfter`); a comment on its own line leads the next
 * child (`commentsBefore`). Comments before the closing token (`danglingPos`,
 * e.g. `}` or end of file) with no following child trail the last child, or, in
 * an empty container, land in `danglingFallback.innerComments`.
 */
export function attachComments(
  ctx: ParsingContext,
  children: readonly AbstractElem[],
  danglingPos?: number,
  danglingFallback?: { innerComments?: CommentElem[] },
): void {
  const { stream } = ctx;
  const { srcModule } = ctx.state.stable;
  let prev: Commentable | undefined;
  for (const child of children) {
    if (!("start" in child)) continue; // synthetic elems have no source position
    const run = stream.leadingTrivia(child.start);
    if (run?.length) splitRun(prev, child, run, srcModule);
    prev = child;
  }
  if (danglingPos === undefined) return;
  const run = stream.leadingTrivia(danglingPos);
  if (!run?.length) return;
  if (prev) {
    addComments(prev, "commentsAfter", run, srcModule);
  } else if (danglingFallback) {
    danglingFallback.innerComments = run.map(t => makeComment(t, srcModule));
  }
}

/** Pop the top open element, throwing if the stack is empty. */
function popOpenElem(ctx: ParsingContext): OpenElem {
  const open = ctx.state.context.openElems.pop();
  if (!open) throw new Error("No open element to close");
  return open;
}

/**
 * Split a comment run between the previous child (trailing) and this child
 * (leading) at the first comment that begins its own line. With no previous
 * child, the whole run leads this child.
 */
function splitRun(
  prev: Commentable | undefined,
  child: Commentable,
  run: CommentTrivia[],
  srcModule: SrcModule,
): void {
  const split = prev ? firstOwnLine(run) : 0;
  if (prev && split > 0)
    addComments(prev, "commentsAfter", run.slice(0, split), srcModule);
  if (split < run.length)
    addComments(child, "commentsBefore", run.slice(split), srcModule);
}

/** Append converted comments to an element's leading or trailing list. */
function addComments(
  elem: Commentable,
  field: "commentsBefore" | "commentsAfter",
  trivia: CommentTrivia[],
  srcModule: SrcModule,
): void {
  const comments = trivia.map(t => makeComment(t, srcModule));
  const existing = elem[field];
  elem[field] = existing ? [...existing, ...comments] : comments;
}

function makeComment(trivia: CommentTrivia, srcModule: SrcModule): CommentElem {
  const { style, span, blankBefore } = trivia;
  const comment: CommentElem = {
    kind: "comment",
    style,
    start: span[0],
    end: span[1],
    srcModule,
  };
  if (blankBefore) comment.blankBefore = true;
  return comment;
}

/** Index of the first comment that begins its own line (after a line break). */
function firstOwnLine(run: CommentTrivia[]): number {
  const i = run.findIndex(t => t.newlineBefore);
  return i === -1 ? run.length : i;
}
