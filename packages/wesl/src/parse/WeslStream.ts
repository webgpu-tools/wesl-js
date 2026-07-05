import { ParseError } from "../ParseError.ts";
import type { Stream, TypedToken } from "../Stream.ts";
import { keywords, reservedWords } from "./Keywords.ts";
import { MatchersStream, RegexMatchers } from "./stream/MatchersStream.ts";
import { matchOneOf } from "./stream/RegexHelpers.ts";
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

type InternalTokenKind =
  | "word"
  | "number"
  | "blankspaces"
  | "commentStart"
  | "symbol"
  | "invalid";

// https://www.w3.org/TR/WGSL/#blankspace-and-line-breaks
/** Whitespaces including new lines */
const blankspaces = /[ \t\n\v\f\r\u{0085}\u{200E}\u{200F}\u{2028}\u{2029}]+/u;
/** One line break, treating \r\n as a single break. */
const lineBreak = String.raw`\r\n?|[\n\v\f\u{0085}\u{2028}\u{2029}]`;
const symbolSet =
  "& && -> @ / ! [ ] { } :: : , == = != >>= >> >= > <<= << <= < % - --" +
  " . + ++ | || ( ) ; * ~ ^ // /* */ += -= *= /= %= &= |= ^=" +
  // For the _ = expr; syntax
  " _";

const ident =
  /(?:(?:[_\p{XID_Start}][\p{XID_Continue}]+)|(?:[\p{XID_Start}]))/u;

const keywordOrReserved = new Set(keywords.concat(reservedWords));

const digits = new RegExp(
  // decimal_float_literal
  /(?:0[fh])|(?:[1-9][0-9]*[fh])/.source +
    /|(?:[0-9]*\.[0-9]+(?:[eE][+-]?[0-9]+)?[fh]?)/.source +
    /|(?:[0-9]+\.[0-9]*(?:[eE][+-]?[0-9]+)?[fh]?)/.source +
    /|(?:[0-9]+[eE][+-]?[0-9]+[fh]?)/.source +
    // hex_float_literal
    /|(?:0[xX][0-9a-fA-F]*\.[0-9a-fA-F]+(?:[pP][+-]?[0-9]+[fh]?)?)/.source +
    /|(?:0[xX][0-9a-fA-F]+\.[0-9a-fA-F]*(?:[pP][+-]?[0-9]+[fh]?)?)/.source +
    /|(?:0[xX][0-9a-fA-F]+[pP][+-]?[0-9]+[fh]?)/.source +
    // hex_int_literal
    /|(?:0[xX][0-9a-fA-F]+[iu]?)/.source +
    // decimal_int_literal
    /|(?:0[iu]?)|(?:[1-9][0-9]*[iu]?)/.source,
);

const commentStart = /\/\/|\/\*/;
const weslMatcher = new RegexMatchers<InternalTokenKind>({
  word: ident,
  number: digits,
  blankspaces,
  commentStart,
  symbol: matchOneOf(symbolSet),
  // biome-ignore lint/correctness/noEmptyCharacterClassInRegex: TODO
  invalid: /[^]/,
});

/** A peeked token cached at the position it was read from. */
interface PeekedToken {
  pos: number;
  token: WeslToken | null;
  end: number;
}

/** A stream that produces WESL tokens, skipping over comments and white space */
export class WeslStream implements Stream<WeslToken> {
  private stream: Stream<TypedToken<InternalTokenKind>>;
  /** New line (stateful: scanned via lastIndex, so kept per-instance). */
  private eolPattern = new RegExp(lineBreak, "gu");
  private blockCommentPattern = /\/\*|\*\//g;
  /** Comments skipped before a real token, keyed by that token's start position. */
  private triviaByPos = new Map<number, CommentTrivia[]>();
  /** Last peeked token, so the following nextToken() skips the rescan.
   *  Never invalidated: tokenization is deterministic per position. */
  private peeked: PeekedToken | null = null;
  public src: string;
  constructor(src: string) {
    this.src = src;
    this.stream = new MatchersStream(src, weslMatcher);
  }
  checkpoint(): number {
    return this.stream.checkpoint();
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
  private recordTrivia(pos: number, pending?: CommentTrivia[]): void {
    if (pending) this.triviaByPos.set(pos, pending);
  }

  /** Next real token (comments/blankspace skipped and recorded as trivia); null at EOF. */
  nextToken(): WeslToken | null {
    const peeked = this.usePeeked();
    if (peeked !== null) return peeked.token;

    let pending: CommentTrivia[] | undefined;
    while (true) {
      const token = this.stream.nextToken();
      if (token === null) {
        // trailing comments at end of file: key them past the last position
        this.recordTrivia(this.src.length, pending);
        return null;
      }

      const kind = token.kind;
      if (kind === "blankspaces") {
        continue; // newline/blank flags are derived later, at attach time
      } else if (kind === "commentStart") {
        // SAFETY: The underlying streams can be seeked to any position
        const style = token.text === "//" ? "line" : "block";
        const end =
          style === "line"
            ? this.lineCommentEnd(token.span[1])
            : this.skipBlockComment(token.span[1]);
        pending ??= [];
        const start = token.span[0];
        // WGSL forbids the null code point anywhere, including inside comments
        // (a comment body is skipped here, so the `invalid` matcher never sees
        // it). Scan only the comment body, keeping this O(comment length).
        const bodyNull = this.src.slice(start, end).indexOf("\0");
        if (bodyNull >= 0) {
          const at = start + bodyNull;
          throw new ParseError("Invalid token \\0", [at, at + 1]);
        }
        pending.push({ style, start, end });
        this.stream.reset(end);
      } else if (kind === "invalid") {
        throw new ParseError("Invalid token " + token.text, token.span);
      } else {
        this.recordTrivia(token.span[0], pending);
        const result = token as WeslToken;
        if (kind === "word" && keywordOrReserved.has(token.text)) {
          result.kind = "keyword";
        }
        return result;
      }
    }
  }

  /** If the last peek() was at the current position, consume and return it. */
  private usePeeked(): PeekedToken | null {
    const peeked = this.peeked;
    if (peeked !== null && peeked.pos === this.checkpoint()) {
      this.reset(peeked.end);
      return peeked;
    }
    return null;
  }

  /** Peek at the next token without consuming it */
  peek(): WeslToken | null {
    const pos = this.checkpoint();
    const peeked = this.peeked;
    if (peeked !== null && peeked.pos === pos) return peeked.token;
    const token = this.nextToken();
    const end = this.checkpoint();
    this.reset(pos);
    this.peeked = { pos, token, end };
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
    const startPos = this.checkpoint();
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

  /** End of a line comment: the start of the next line break (or end of file). */
  private lineCommentEnd(position: number): number {
    this.eolPattern.lastIndex = position;
    const result = this.eolPattern.exec(this.src);
    return result === null ? this.src.length : result.index;
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
    const startPosition = this.stream.checkpoint();
    const token: WeslToken | null = this.nextToken();
    this.stream.reset(startPosition);

    //<<= << <= cannot be templates, so we match the entire token text
    if (token === null || token.kind !== "symbol" || token.text !== "<") {
      return null;
    }
    if (!this.isTemplateStart(token.span[1])) {
      this.stream.reset(startPosition); // isTemplateStart advanced the stream
      return null;
    }
    this.stream.reset(token.span[1]);
    return token as WeslToken & { kind: "symbol" };
  }

  nextTemplateEndToken(): (WeslToken & { kind: "symbol" }) | null {
    const startPosition = this.stream.checkpoint();
    const token: WeslToken | null = this.nextToken();
    this.stream.reset(startPosition);
    if (token === null) return null;

    // template closing can also match a >= or >>, so we split the token
    if (token.kind !== "symbol" || token.text[0] !== ">") return null;

    // SAFETY: The underlying streams implementations can be reset to any position.
    const tokenPosition = token.span[0];
    this.stream.reset(tokenPosition + 1);
    return {
      kind: "symbol",
      span: [tokenPosition, tokenPosition + 1],
      text: ">",
    };
  }

  private isTemplateStart(afterToken: number): boolean {
    // Skip over <
    this.stream.reset(afterToken);
    // We start with a < token
    let pendingCounter = 1;
    while (true) {
      const nextToken = this.stream.nextToken();
      if (nextToken === null) return false;
      if (nextToken.kind !== "symbol") continue;
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
      const nextToken = this.stream.nextToken();
      if (nextToken === null) {
        const after = this.stream.checkpoint();
        throw new ParseError("Unclosed bracket!", [after, after]);
      }
      if (nextToken.kind !== "symbol") continue;
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
