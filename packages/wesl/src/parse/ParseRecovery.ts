import { ParseError } from "../ParseError.ts";
import type { Scope } from "../Scope.ts";
import type { ParsingContext } from "./ParsingContext.ts";
import type { WeslStream, WeslToken } from "./WeslStream.ts";

/** Stream and scope state captured before a parse attempt, so recovery can
 * discard a failed attempt's partial effects. */
export interface ParseAttempt {
  start: number;
  scope: Scope;
  scopeLength: number;
  /** attribute-param marker, in case the attempt failed mid-attribute */
  parsingAttrParam: string | undefined;
  /** nesting depth, in case an enterNesting call site misses its finally */
  nesting: number;
}

/** Whether a token ends a recovery skip. `depth` counts the braces opened since
 * the skip began, so the contents of a nested brace aren't taken for a boundary. */
export type BoundaryTest = (token: WeslToken, depth: number) => boolean;

/** Capture the stream position and the state that rollbackAttempt restores. */
export function markAttempt(ctx: ParsingContext): ParseAttempt {
  const scope = ctx.currentScope();
  const scopeLength = scope.contents.length;
  const { parsingAttrParam, nesting } = ctx;
  const start = ctx.stream.checkpoint();
  return { start, scope, scopeLength, parsingAttrParam, nesting };
}

/**
 * Undo the scope and ident effects of a failed parse attempt. (The stream isn't
 * moved; the caller skips to its own sync point.)
 *
 * `pushScope` links each new scope into its parent's `contents` and `saveIdent`
 * appends to the current scope's `contents`, so restoring the scope pointer and
 * truncating `contents` drops unpopped scopes, orphaned child scopes and stray
 * idents in one move.
 *
 * `parsingAttrParam` is restored too: a throw inside attribute params would
 * otherwise leave it set, and every ref parsed after the recovery would be
 * marked as an attribute param and skipped by binding.
 *
 * `nesting` is restored as a backstop: every enterNesting call site pairs it
 * with exitNesting in a finally, so unwinding normally restores the depth, but
 * a future call site that misses its finally would otherwise leak depth on
 * every recovered error.
 *
 * Only the scope tree and those fields are restored. Module level lists
 * (imports, asserts, decls) are not, so recovery that spans those needs a
 * wider snapshot.
 */
export function rollbackAttempt(
  ctx: ParsingContext,
  attempt: ParseAttempt,
): void {
  const { scope, scopeLength } = attempt;
  ctx.state.context.scope = scope;
  scope.contents.length = scopeLength;
  ctx.parsingAttrParam = attempt.parsingAttrParam;
  ctx.nesting = attempt.nesting;
}

/**
 * Recover a failed list item (statement, switch clause, struct member): drop
 * the scopes and idents it built, skip to the next item boundary, and record
 * its syntax error.
 *
 * Rethrows non-ParseErrors, and rethrows when no boundary lies ahead (an
 * unterminated list at EOF): the enclosing recovery then reports the error,
 * and the caller's item loop stops instead of spinning forever.
 *
 * Also rethrows (without recording) when `bailAtBoundary` accepts the boundary
 * token: the skip escaped the caller's region (e.g. a module-level keyword
 * during a statement skip), so an enclosing recovery resumes and reports there.
 */
export function recoverListItem(
  ctx: ParsingContext,
  error: unknown,
  attempt: ParseAttempt,
  atBoundary: BoundaryTest,
  bailAtBoundary?: (token: WeslToken) => boolean,
): void {
  if (!(error instanceof ParseError)) throw error;
  rollbackAttempt(ctx, attempt);
  if (!skipToBoundary(ctx.stream, attempt.start, atBoundary)) throw error;
  if (bailAtBoundary) {
    const boundary = ctx.stream.peek();
    if (boundary && bailAtBoundary(boundary)) throw error;
  }
  ctx.addError(error.message, ...error.span);
}

/**
 * Skip tokens until `atBoundary` accepts one, leaving the boundary token
 * unconsumed. Braces opened during the skip are counted, so `atBoundary` can
 * ignore anything nested. Only tokens strictly past `attemptStart` count as
 * boundaries, so a caller that loops on recovery makes progress.
 *
 * Counting from depth 0 is only sound because a parser that has consumed an
 * opening brace recovers its own errors: any error that escapes to an enclosing
 * list left no unseen `{` ahead of the cursor.
 *
 * @return true if a boundary was found. false at EOF, or if the input can't be
 * tokenized any further; the caller then has no recovery point left.
 */
export function skipToBoundary(
  stream: WeslStream,
  attemptStart: number,
  atBoundary: BoundaryTest,
): boolean {
  let depth = 0;
  while (true) {
    const pos = stream.checkpoint();
    let token: WeslToken | null;
    try {
      token = stream.peek();
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      // tokenizer error (e.g. invalid character); the stream advanced past it
      if (stream.checkpoint() === pos) return false; // can't advance; give up
      continue;
    }
    if (token === null) return false;
    if (pos > attemptStart && atBoundary(token, depth)) return true;
    stream.nextToken();
    if (token.text === "{") depth++;
    else if (token.text === "}" && depth > 0) depth--;
  }
}
