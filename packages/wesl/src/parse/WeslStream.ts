import { ParseError } from "../ParseError.ts";
import type { Span } from "../Span.ts";
import type { Stream, TypedToken } from "../Stream.ts";
import { keywords, reservedWords } from "./Keywords.ts";
import { CachingStream } from "./stream/CachingStream.ts";
import { MatchersStream, RegexMatchers } from "./stream/MatchersStream.ts";
import { matchOneOf } from "./stream/RegexHelpers.ts";
export type WeslTokenKind = "word" | "keyword" | "number" | "symbol";

export type WeslToken<Kind extends WeslTokenKind = WeslTokenKind> =
  TypedToken<Kind>;

/** A comment skipped by the tokenizer, recorded as leading trivia of the next token. */
export interface CommentTrivia {
  style: "line" | "block";
  /** Source span of the comment text (excluding the trailing newline of a line comment). */
  span: Span;
  /** A line break occurred since the previous token or comment. */
  newlineBefore: boolean;
  /** At least one fully blank line occurred since the previous token or comment. */
  blankBefore: boolean;
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

const lineBreaks = new RegExp(lineBreak, "gu");

/** Checks if a word is a valid WGSL ident, and not a keyword */
export function isIdent(text: string): boolean {
  if (text.match(ident)?.[0] !== text) {
    return false;
  }
  if (keywordOrReserved.has(text)) {
    return false;
  }
  return true;
}

/** To mark parts of the grammar implementation that are WESL specific extensions */
export function weslExtension<T>(combinator: T): T {
  return combinator;
}

/** A stream that produces WESL tokens, skipping over comments and white space */
export class WeslStream implements Stream<WeslToken> {
  private stream: Stream<TypedToken<InternalTokenKind>>;
  /** New line (stateful: scanned via lastIndex, so kept per-instance). */
  private eolPattern = new RegExp(lineBreak, "gu");
  private blockCommentPattern = /\/\*|\*\//g;
  /** Comments skipped before a real token, keyed by that token's start position. */
  private triviaByPos = new Map<number, CommentTrivia[]>();
  public src: string;
  constructor(src: string) {
    this.src = src;
    this.stream = new CachingStream(new MatchersStream(src, weslMatcher));
  }
  checkpoint(): number {
    return this.stream.checkpoint();
  }
  reset(position: number): void {
    this.stream.reset(position);
  }
  /** Comments skipped immediately before the token that starts at `pos`. */
  leadingTrivia(pos: number): CommentTrivia[] | undefined {
    return this.triviaByPos.get(pos);
  }
  private recordTrivia(pos: number, pending?: CommentTrivia[]): void {
    if (pending) this.triviaByPos.set(pos, pending);
  }

  nextToken(): WeslToken | null {
    let pending: CommentTrivia[] | undefined;
    let newlineBefore = false; // line break since the previous token or comment
    let blankBefore = false; // blank line since the previous token or comment
    while (true) {
      const token = this.stream.nextToken();
      if (token === null) {
        // trailing comments at end of file: key them past the last position
        this.recordTrivia(this.src.length, pending);
        return null;
      }

      const kind = token.kind;
      if (kind === "blankspaces") {
        const breaks = countLineBreaks(token.text);
        if (breaks >= 1) newlineBefore = true;
        if (breaks >= 2) blankBefore = true;
        continue;
      } else if (kind === "commentStart") {
        // SAFETY: The underlying streams can be seeked to any position
        const style = token.text === "//" ? "line" : "block";
        const end =
          style === "line"
            ? this.lineCommentEnd(token.span[1])
            : this.skipBlockComment(token.span[1]);
        pending ??= [];
        const span: Span = [token.span[0], end];
        // WGSL forbids the null code point anywhere, including inside comments
        // (a comment body is skipped here, so the `invalid` matcher never sees it).
        const nullIdx = this.src.indexOf("\0", span[0]);
        if (nullIdx >= 0 && nullIdx < end)
          throw new ParseError("Invalid token \\0", [nullIdx, nullIdx + 1]);
        pending.push({ style, span, newlineBefore, blankBefore });
        // this comment is now the reference point for the next comment's flags
        newlineBefore = false;
        blankBefore = false;
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

  /** Peek at the next token without consuming it */
  peek(): WeslToken | null {
    const pos = this.checkpoint();
    const token = this.nextToken();
    this.reset(pos);
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
        // Close block
        return this.blockCommentPattern.lastIndex;
      } else if (result[0] === "/*") {
        // Open block
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
    if (token === null) return null;

    if (token.kind !== "symbol") {
      return null;
    }

    //<<= << <= cannot be templates, so we match the entire token text
    if (token.text === "<") {
      if (this.isTemplateStart(token.span[1])) {
        this.stream.reset(token.span[1]);
        return token as WeslToken & { kind: typeof token.kind };
      } else {
        this.stream.reset(startPosition);
        return null;
      }
    } else {
      return null;
    }
  }

  nextTemplateEndToken(): (WeslToken & { kind: "symbol" }) | null {
    const startPosition = this.stream.checkpoint();
    const token: WeslToken | null = this.nextToken();
    this.stream.reset(startPosition);
    if (token === null) return null;

    // template closing can also match a >= or >>, so we split the token
    if (token.kind === "symbol" && token.text[0] === ">") {
      // SAFETY: The underlying streams implementations can be reset to any position.
      const tokenPosition = token.span[0];
      this.stream.reset(tokenPosition + 1);
      return {
        kind: "symbol",
        span: [tokenPosition, tokenPosition + 1],
        text: ">",
      };
    } else {
      return null;
    }
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

/** Count line breaks in a whitespace run. */
function countLineBreaks(text: string): number {
  return text.match(lineBreaks)?.length ?? 0;
}
