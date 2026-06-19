import { WeslStream } from "../parse/WeslStream.ts";

/** Remove extra bits from WESL for test comparisons.
 *
 * removes:
 *  . extra whitespace,
 *  . comments,
 *  . trailing commas in brackets, paren, and array containers
 *  . redundant module-scope `;` (an empty global declaration, which structural
 *    emit canonicalizes away)
 */
export function stripWesl(text: string): string {
  const stream = new WeslStream(text);
  const firstToken = stream.nextToken();
  if (firstToken === null) return "";

  let depth = firstToken.text === "{" ? 1 : 0;
  let prev = firstToken.text;
  let result = firstToken.text;
  while (true) {
    const token = stream.nextToken();
    if (token === null) return result;

    // A `;` at module scope following a `}` (or another such `;`) is an empty
    // global declaration; the structural emitter drops it, so drop it here too.
    if (token.text === ";" && depth === 0 && (prev === "}" || prev === ";")) {
      continue;
    }

    if (token.text === ",") {
      const nextToken = stream.nextToken();
      const nextText = nextToken?.text;
      if (nextText === "}" || nextText === "]" || nextText === ")") {
        // Ignore trailing comma
        result += " ";
        result += nextText;
      } else {
        result += ", " + (nextText ?? "");
      }
      if (nextText !== undefined) {
        depth += braceDelta(nextText);
        prev = nextText;
      }
    } else {
      result += " " + token.text;
      depth += braceDelta(token.text);
      prev = token.text;
    }
  }
}

function braceDelta(text: string): number {
  if (text === "{") return 1;
  if (text === "}") return -1;
  return 0;
}
