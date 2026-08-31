/**
 * Interface for a tokenizer. Returns a "next token", and can be reset to
 * previously saved positions.
 */
export interface Stream<T extends Token> {
  /** Returns the current position */
  position(): number;
  /** Restores a position */
  reset(position: number): void;
  /**
   * Returns the next token, or `null` if the end of the stream has been reached.
   * Always leaves `position` right after the token.
   */
  nextToken(): T | null;
  /** src text */
  src: string;
}

/** A text token */
export interface Token {
  kind: string;
  text: string;
  /** offset of the token's first character in src */
  start: number;
  /** offset just past the token's last character in src */
  end: number;
}

export interface TypedToken<Kind extends string> extends Token {
  kind: Kind;
}
