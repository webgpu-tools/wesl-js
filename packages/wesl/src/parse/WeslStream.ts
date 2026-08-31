import { ParseError } from "../ParseError.ts";
import type { Stream, TypedToken } from "../Stream.ts";
import { keywordOrReserved } from "./Keywords.ts";
import { type InternalTokenKind, WeslLexer } from "./stream/WeslLexer.ts";
export type WeslTokenKind = "word" | "keyword" | "number" | "symbol";

export type WeslToken<Kind extends WeslTokenKind = WeslTokenKind> =
  TypedToken<Kind>;

/** A comment skipped by the tokenizer, recorded as leading trivia of the next token.
 *  Line-break flags (newline/blank before) are not stored here: they are derived
 *  on demand during comment attachment, so the tokenizer hot path never counts
 *  line breaks. */
export interface CommentTrivia {
  style: "line" | "block";
  /** Source range of the comment text (excluding the trailing newline of a line comment). */
  start: number;
  end: number;
}

/** One line break, treating \r\n as a single break.
 *  Same code points as `isLineBreak` in AttachComments.ts (charCode form). */
const lineBreak = String.raw`\r\n?|[\n\v\f\u{0085}\u{2028}\u{2029}]`;

/** A stream that produces WESL tokens, skipping over comments and white space */
export class WeslStream implements Stream<WeslToken> {
  private stream: Stream<TypedToken<InternalTokenKind>>;
  /** New line or forbidden \0, for scanning line-comment bodies
   *  (stateful: scanned via lastIndex, so kept per-instance). */
  private eolOrNullPattern = new RegExp(lineBreak + "|\\0", "gu");
  /** Block comment delimiters or forbidden \0. (No `u` flag needed for this
   *  ASCII-only alternation; eolOrNullPattern needs `u` for its \u{...} escapes.) */
  private blockCommentPattern = /\/\*|\*\/|\0/g;
  /** Comments skipped before a real token, keyed by that token's start position. */
  private triviaByPos = new Map<number, CommentTrivia[]>();
  /** Last peeked token, cached at the position it was read from (scalar fields,
   *  not an object, to avoid an allocation per peek; peekedPos -1 = empty).
   *  Never invalidated: tokenization is deterministic per position.
   *  The cached token object itself is handed to callers (peek, nextToken's
   *  peek-hit path, matchText/matchKind/nextIf, nextTemplateEndToken's plain-`>`
   *  path), so returned tokens must never be mutated; nextToken's word->keyword
   *  promotion happens before the token is cached. */
  private peekedPos = -1;
  private peekedToken: WeslToken | null = null;
  private peekedEnd = 0;
  public src: string;
  /** false skips trivia recording: comments are still scanned past (and
   *  \0-checked) but not kept for the attachment pass. */
  private keepComments: boolean;
  constructor(src: string, keepComments = true) {
    this.src = src;
    this.keepComments = keepComments;
    this.stream = new WeslLexer(src);
  }
  position(): number {
    return this.stream.position();
  }
  reset(position: number): void {
    this.stream.reset(position);
  }
  /** All recorded comment runs (each a contiguous group of comments between two
   *  real tokens), in source order. Consumed by the post-parse comment pass. */
  commentRuns(): CommentTrivia[][] {
    return [...this.triviaByPos.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, run]) => run);
  }
  /** Next real token (comments/blankspace skipped and recorded as trivia); null at EOF. */
  nextToken(): WeslToken | null {
    // if the last peek() was at the current position, consume and return it
    if (this.peekedPos === this.stream.position()) {
      this.stream.reset(this.peekedEnd);
      return this.peekedToken;
    }

    let pending: CommentTrivia[] | undefined;
    while (true) {
      const token = this.stream.nextToken();
      if (token === null) {
        // trailing comments at end of file: key them past the last position
        if (pending !== undefined)
          this.triviaByPos.set(this.src.length, pending);
        return null;
      }

      const kind = token.kind;
      if (kind === "blankspaces") {
        continue; // newline/blank flags are derived later, at attach time
      } else if (kind === "commentStart") {
        if (this.keepComments) {
          pending ??= [];
          pending.push(this.consumeComment(token));
        } else {
          this.skipComment(token);
        }
      } else if (kind === "invalid") {
        const { start, end } = token;
        throw new ParseError("Invalid token " + token.text, [start, end]);
      } else {
        if (pending !== undefined) this.triviaByPos.set(token.start, pending);
        const result = token as WeslToken;
        if (kind === "word" && keywordOrReserved.has(token.text)) {
          result.kind = "keyword";
        }
        return result;
      }
    }
  }

  /** Advance the stream past a comment.
   *  @return the comment's end position */
  private skipComment(token: TypedToken<InternalTokenKind>): number {
    const end = this.commentEnd(token);
    this.stream.reset(end);
    return end;
  }

  /** Skip a comment and return it as trivia. */
  private consumeComment(token: TypedToken<InternalTokenKind>): CommentTrivia {
    const style = token.text === "//" ? "line" : "block";
    const { start } = token;
    const end = this.skipComment(token);
    return { style, start, end };
  }

  /** Peek at the next token without consuming it */
  peek(): WeslToken | null {
    const pos = this.stream.position();
    if (this.peekedPos === pos) return this.peekedToken;
    const token = this.nextToken();
    this.peekedEnd = this.stream.position();
    this.peekedToken = token;
    this.peekedPos = pos;
    this.stream.reset(pos);
    return token;
  }

  /** Consume token if text matches, otherwise leave position unchanged */
  matchText(text: string): WeslToken | null {
    const token = this.peek();
    if (token?.text === text) {
      this.nextToken();
      return token;
    }
    return null;
  }

  /** Consume token if kind matches (and optionally text), otherwise leave position unchanged */
  matchKind<K extends WeslTokenKind>(
    kind: K,
    text?: string,
  ): WeslToken<K> | null {
    const token = this.peek();
    if (token?.kind === kind && (!text || token.text === text)) {
      this.nextToken();
      return token as WeslToken<K>;
    }
    return null;
  }

  /** Consume token if predicate matches, otherwise leave position unchanged */
  nextIf(predicate: (token: WeslToken) => boolean): WeslToken | null {
    const token = this.peek();
    if (token && predicate(token)) {
      this.nextToken();
      return token;
    }
    return null;
  }

  /** Match a sequence of tokens by text. Resets and returns null if any fails. */
  matchSequence(...texts: string[]): WeslToken[] | null {
    const startPos = this.position();
    const tokens: WeslToken[] = [];
    for (const text of texts) {
      const token = this.matchText(text);
      if (!token) {
        this.reset(startPos);
        return null;
      }
      tokens.push(token);
    }
    return tokens;
  }

  /** End position of a comment opened by a commentStart token.
   *  WGSL forbids the null code point anywhere, and the `invalid` matcher never
   *  sees comment bodies (they are skipped, not lexed). So both end-scanning
   *  patterns below also match \0: a comment body is \0-checked by the same
   *  native scan that finds its end. */
  private commentEnd(token: TypedToken<InternalTokenKind>): number {
    return token.text === "//"
      ? this.lineCommentEnd(token.end)
      : this.skipBlockComment(token.end);
  }

  /** End of a line comment: the start of the next line break (or end of file). */
  private lineCommentEnd(position: number): number {
    this.eolOrNullPattern.lastIndex = position;
    const result = this.eolOrNullPattern.exec(this.src);
    if (result === null) return this.src.length;
    if (result[0] === "\0") throw invalidNull(result.index);
    return result.index;
  }

  private skipBlockComment(start: number): number {
    let position = start;
    while (true) {
      this.blockCommentPattern.lastIndex = position;
      const result = this.blockCommentPattern.exec(this.src);
      if (result === null) {
        throw new ParseError("Unclosed block comment!", [position, position]);
      } else if (result[0] === "*/") {
        return this.blockCommentPattern.lastIndex;
      } else if (result[0] === "/*") {
        // nested block comment: recurse so its */ doesn't close the outer one
        position = this.skipBlockComment(this.blockCommentPattern.lastIndex);
      } else if (result[0] === "\0") {
        throw invalidNull(result.index);
      } else {
        throw new Error("Unreachable, invalid block comment pattern");
      }
    }
  }

  /**
   * Only matches the `<` token if it is a template
   * Precondition: An ident was parsed right before this.
   * Runs the [template list discovery algorithm](https://www.w3.org/TR/WGSL/#template-list-discovery).
   */
  nextTemplateStartToken(): (WeslToken & { kind: "symbol" }) | null {
    // peek (not nextToken+reset) so a declined probe leaves the token cached
    // for the parser's next peek: this runs after every ident, so re-lexing
    // the following token here was a measurable cost
    const startPosition = this.stream.position();
    const token = this.peek();

    //<<= << <= cannot be templates, so we match the entire token text
    if (token === null || token.kind !== "symbol" || token.text !== "<") {
      return null;
    }
    if (!this.isTemplateStart(token.end)) {
      this.stream.reset(startPosition); // isTemplateStart advanced the stream
      return null;
    }
    this.stream.reset(token.end);
    return token as WeslToken & { kind: "symbol" };
  }

  /** Match a template-closing `>`, splitting it off a `>>`/`>=`/`>>=` token when needed. */
  nextTemplateEndToken(): (WeslToken & { kind: "symbol" }) | null {
    // peek so a declined probe leaves the token cached for the next peek
    const token = this.peek();
    if (token === null) return null;

    // Template closing can also match a >= or >> here, so split one `>` off
    // and re-lex the rest. Safe for the closed set of `>`-leading symbols in
    // WeslLexer.ts (`>` `>=` `>>` `>>=`): each remainder (``, `=`, `>`, `>=`)
    // re-lexes to the intended tokens. A new `>`-leading symbol would break
    // this split; isTemplateStart's exhaustive check throws if the set grows.
    if (token.kind !== "symbol" || token.text[0] !== ">") return null;

    // a plain `>` needs no split: consume the peeked token whole
    if (token.text === ">") {
      this.stream.reset(token.end);
      return token as WeslToken & { kind: "symbol" };
    }

    // SAFETY: The underlying streams implementations can be reset to any position.
    const { start } = token;
    this.stream.reset(start + 1);
    return { kind: "symbol", text: ">", start, end: start + 1 };
  }

  /** Next symbol from the raw stream, skipping comment bodies (so symbols
   *  inside comments don't count) and non-symbol tokens; null at EOF. */
  private nextRawSymbol(): TypedToken<InternalTokenKind> | null {
    while (true) {
      const token = this.stream.nextToken();
      if (token === null) return null;
      if (token.kind === "commentStart") {
        this.stream.reset(this.commentEnd(token));
      } else if (token.kind === "symbol") return token;
    }
  }

  /** Template-list discovery: scan forward from `<` for a balanced closing `>`. */
  private isTemplateStart(afterToken: number): boolean {
    // Skip over <
    this.stream.reset(afterToken);
    // We start with a < token
    let pendingCounter = 1;
    while (true) {
      const nextToken = this.nextRawSymbol();
      if (nextToken === null) return false;
      if (nextToken.text === "<") {
        // Start a nested template
        pendingCounter += 1;
      } else if (nextToken.text[0] === ">") {
        if (nextToken.text === ">" || nextToken.text === ">=") {
          pendingCounter -= 1;
        } else if (nextToken.text === ">>=" || nextToken.text === ">>") {
          pendingCounter -= 2;
        } else {
          throw new Error(
            "This case should never be reached, looks like we forgot one of the tokens that start with >",
          );
        }
        if (pendingCounter <= 0) {
          return true;
        }
      } else if (nextToken.text === "(") {
        this.skipBracketsTo(")");
      } else if (nextToken.text === "[") {
        this.skipBracketsTo("]");
      } else if (
        nextToken.text === "==" ||
        nextToken.text === "!=" ||
        nextToken.text === ";" ||
        nextToken.text === "{" ||
        nextToken.text === ":" ||
        nextToken.text === "&&" ||
        nextToken.text === "||"
      ) {
        return false;
      }
    }
  }

  /**
   * Call this after consuming an opening bracket.
   * Skips until a closing bracket. This also consumes the closing bracket.
   */
  private skipBracketsTo(closingBracket: string): void {
    while (true) {
      const nextToken = this.nextRawSymbol();
      if (nextToken === null) {
        const after = this.stream.position();
        throw new ParseError("Unclosed bracket!", [after, after]);
      }
      if (nextToken.text === "(") {
        this.skipBracketsTo(")");
      } else if (nextToken.text === "[") {
        this.skipBracketsTo("]");
      } else if (nextToken.text === closingBracket) {
        // We're done!
        return;
      }
    }
  }
}

/** Error for a forbidden \0 code point found inside a comment body. */
function invalidNull(at: number): ParseError {
  return new ParseError("Invalid token \\0", [at, at + 1]);
}
