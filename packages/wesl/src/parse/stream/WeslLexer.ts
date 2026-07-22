import type { Stream, TypedToken } from "../../Stream.ts";
import { matchOneOf } from "./RegexHelpers.ts";
import { RegexMatchers } from "./RegexMatchers.ts";

export type InternalTokenKind =
  | "word"
  | "number"
  | "blankspaces"
  | "commentStart"
  | "symbol"
  | "invalid";

type RawToken = TypedToken<InternalTokenKind>;

/** https://www.w3.org/TR/WGSL/#identifiers ident_pattern_token (unanchored) */
export const identPattern =
  /(?:(?:[_\p{XID_Start}][\p{XID_Continue}]+)|(?:[\p{XID_Start}]))/u;

// https://www.w3.org/TR/WGSL/#blankspace-and-line-breaks
/** Whitespaces including new lines */
const blankspaces = /[ \t\n\v\f\r\u{0085}\u{200E}\u{200F}\u{2028}\u{2029}]+/u;

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

const symbolSet =
  "& && -> @ / ! [ ] { } :: : , == = != >>= >> >= > <<= << <= < % - --" +
  " . + ++ | || ( ) ; * ~ ^ // /* */ += -= *= /= %= &= |= ^=" +
  // For the _ = expr; syntax
  " _";

const commentStart = /\/\/|\/\*/;

/** Unicode-aware fallback for characters the ASCII fast path can't handle.
 *  lastIndex is set on every use, so sharing one instance is safe. */
const unicodeMatcher = new RegexMatchers<InternalTokenKind>({
  word: identPattern,
  number: digits,
  blankspaces,
  commentStart,
  symbol: matchOneOf(symbolSet),
  // biome-ignore lint/correctness/noEmptyCharacterClassInRegex: [^] deliberately matches any char (incl. newlines) as the catch-all
  invalid: /[^]/,
});

/**
 * Hand-written scanner for WESL/WGSL raw tokens.
 *
 * The common case is dispatched on ASCII char codes: whitespace is skipped
 * without producing tokens, and idents, numbers, symbols, and comment openers
 * are matched directly. Any character >= 0x80 (unicode idents, unicode
 * blankspace) falls back to the unicode-aware regex, so there is no up-front
 * scan and no unicode restriction.
 */
export class WeslLexer implements Stream<RawToken> {
  private position = 0;
  /** sticky number matcher (stateful via lastIndex, so kept per-instance) */
  private numberExp = new RegExp(digits.source, "y");
  public src: string;

  constructor(src: string) {
    this.src = src;
  }

  checkpoint(): number {
    return this.position;
  }
  reset(position: number): void {
    this.position = position;
  }

  nextToken(): RawToken | null {
    const { src } = this;
    const len = src.length;
    let pos = this.position;
    // skip ASCII blankspace; unicode blankspace falls through to the regex
    while (pos < len) {
      const c = src.charCodeAt(pos);
      if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) pos++;
      else break;
    }
    if (pos >= len) {
      this.position = pos;
      return null;
    }

    const c = src.charCodeAt(pos);
    if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)) {
      return this.word(pos);
    }
    if (c >= 0x30 && c <= 0x39) return this.number(pos);

    // n is NaN past the end of source; all comparisons with NaN are false
    const n = src.charCodeAt(pos + 1);
    switch (c) {
      case 0x5f: // _
        if (isWordChar(n)) return this.word(pos);
        if (n >= 0x80) return this.regexToken(pos); // _ + unicode continue
        return this.symbol(pos, "_");
      case 0x2f: // /
        if (n === 0x2f) return this.token("commentStart", pos, "//");
        if (n === 0x2a) return this.token("commentStart", pos, "/*");
        if (n === 0x3d) return this.symbol(pos, "/=");
        return this.symbol(pos, "/");
      case 0x2e: // .
        if (n >= 0x30 && n <= 0x39) return this.number(pos); // .5 float
        return this.symbol(pos, ".");
      case 0x3e: // >
        if (n === 0x3e) {
          if (src.charCodeAt(pos + 2) === 0x3d) return this.symbol(pos, ">>=");
          return this.symbol(pos, ">>");
        }
        if (n === 0x3d) return this.symbol(pos, ">=");
        return this.symbol(pos, ">");
      case 0x3c: // <
        if (n === 0x3c) {
          if (src.charCodeAt(pos + 2) === 0x3d) return this.symbol(pos, "<<=");
          return this.symbol(pos, "<<");
        }
        if (n === 0x3d) return this.symbol(pos, "<=");
        return this.symbol(pos, "<");
      case 0x26: // &
        if (n === 0x26) return this.symbol(pos, "&&");
        if (n === 0x3d) return this.symbol(pos, "&=");
        return this.symbol(pos, "&");
      case 0x7c: // |
        if (n === 0x7c) return this.symbol(pos, "||");
        if (n === 0x3d) return this.symbol(pos, "|=");
        return this.symbol(pos, "|");
      case 0x2d: // -
        if (n === 0x3e) return this.symbol(pos, "->");
        if (n === 0x2d) return this.symbol(pos, "--");
        if (n === 0x3d) return this.symbol(pos, "-=");
        return this.symbol(pos, "-");
      case 0x2b: // +
        if (n === 0x2b) return this.symbol(pos, "++");
        if (n === 0x3d) return this.symbol(pos, "+=");
        return this.symbol(pos, "+");
      case 0x3a: // :
        if (n === 0x3a) return this.symbol(pos, "::");
        return this.symbol(pos, ":");
      case 0x3d: // =
        if (n === 0x3d) return this.symbol(pos, "==");
        return this.symbol(pos, "=");
      case 0x21: // !
        if (n === 0x3d) return this.symbol(pos, "!=");
        return this.symbol(pos, "!");
      case 0x2a: // *
        if (n === 0x2f) return this.symbol(pos, "*/");
        if (n === 0x3d) return this.symbol(pos, "*=");
        return this.symbol(pos, "*");
      case 0x25: // %
        if (n === 0x3d) return this.symbol(pos, "%=");
        return this.symbol(pos, "%");
      case 0x5e: // ^
        if (n === 0x3d) return this.symbol(pos, "^=");
        return this.symbol(pos, "^");
      case 0x40: // @
        return this.symbol(pos, "@");
      case 0x5b: // [
        return this.symbol(pos, "[");
      case 0x5d: // ]
        return this.symbol(pos, "]");
      case 0x7b: // {
        return this.symbol(pos, "{");
      case 0x7d: // }
        return this.symbol(pos, "}");
      case 0x28: // (
        return this.symbol(pos, "(");
      case 0x29: // )
        return this.symbol(pos, ")");
      case 0x2c: // ,
        return this.symbol(pos, ",");
      case 0x3b: // ;
        return this.symbol(pos, ";");
      case 0x7e: // ~
        return this.symbol(pos, "~");
    }
    if (c >= 0x80) return this.regexToken(pos);
    this.position = pos + 1;
    return { kind: "invalid", span: [pos, pos + 1], text: src[pos] };
  }

  private token(
    kind: InternalTokenKind,
    start: number,
    text: string,
  ): RawToken {
    const end = start + text.length;
    this.position = end;
    return { kind, span: [start, end], text };
  }

  private symbol(start: number, text: string): RawToken {
    return this.token("symbol", start, text);
  }

  private word(start: number): RawToken | null {
    const { src } = this;
    const len = src.length;
    let pos = start + 1;
    while (pos < len) {
      const c = src.charCodeAt(pos);
      if (isWordChar(c)) pos++;
      else if (c >= 0x80)
        return this.regexToken(start); // unicode ident
      else break;
    }
    this.position = pos;
    return { kind: "word", span: [start, pos], text: src.slice(start, pos) };
  }

  private number(start: number): RawToken {
    this.numberExp.lastIndex = start;
    // non-null: callers guarantee a leading digit (matches decimal_int) or
    // a `.` followed by a digit (matches the fraction-first float alternative)
    const text = this.numberExp.exec(this.src)![0];
    return this.token("number", start, text);
  }

  /** match one token (or blankspace run) with the unicode-aware regex */
  private regexToken(start: number): RawToken | null {
    const token = unicodeMatcher.execAt(this.src, start);
    if (token === null) return null; // unreachable: `invalid` matches any char
    this.position = token.span[1];
    return token;
  }
}

function isWordChar(c: number): boolean {
  return (
    (c >= 0x61 && c <= 0x7a) || // a-z
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x30 && c <= 0x39) || // 0-9
    c === 0x5f // _
  );
}
