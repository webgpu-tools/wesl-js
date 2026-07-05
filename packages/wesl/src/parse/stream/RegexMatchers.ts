import type { Span } from "../../Span.ts";
import type { TypedToken } from "../../Stream.ts";
import { toRegexSource } from "./RegexHelpers.ts";

/**
 * Matches tokens by kind with one combined regex.
 *
 * The matchers passed to this object must follow certain rules:
 * - They must use non-capturing groups: `(?:...)`
 * - They must NOT use `^` or `$`
 */
export class RegexMatchers<Kind extends string> {
  private groups: Kind[];
  private exp: RegExp;
  constructor(matchers: Record<Kind, string | RegExp>) {
    this.groups = Object.keys(matchers) as Kind[];
    const expParts = Object.entries(matchers as Record<string, string | RegExp>)
      .map(toRegexSource)
      .join("|");
    // y = sticky, match exactly at lastIndex (set per call in execAt)
    // u = unicode aware
    this.exp = new RegExp(expParts, "yu");
  }

  execAt(text: string, position: number): TypedToken<Kind> | null {
    this.exp.lastIndex = position;
    const matches = this.exp.exec(text);
    if (matches === null) return null;

    // each matcher is a full-token capturing group, so the matched substring
    // is the whole match and the span starts at the sticky position
    const matched = matches[0];
    const span: Span = [position, position + matched.length];
    const kind = this.groups[matchedGroupIndex(matches)];
    return { kind, span, text: matched };
  }
}

/** @return index of the alternation group that matched */
function matchedGroupIndex(matches: RegExpExecArray): number {
  for (let i = 1; i < matches.length; i++) {
    if (matches[i] !== undefined) return i - 1;
  }
  throw new Error("no matching group");
}
