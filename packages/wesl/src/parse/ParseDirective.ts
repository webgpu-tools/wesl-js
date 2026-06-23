import type {
  AttributeElem,
  DiagnosticDirective,
  DirectiveElem,
  EnableDirective,
  NameElem,
  RequiresDirective,
} from "../AbstractElems.ts";
import { parseAttributeList } from "./ParseAttribute.ts";
import { getStartWithAttributes } from "./ParseStatement.ts";
import {
  attachAttributes,
  attrsOrUndef,
  expect,
  expectWord,
  makeNameElem,
  parseCommaList,
} from "./ParseUtil.ts";
import type { ParsingContext } from "./ParsingContext.ts";
import type { WeslStream, WeslToken } from "./WeslStream.ts";

/** Grammar: global_directive : diagnostic_directive | enable_directive | requires_directive */
export function parseDirective(ctx: ParsingContext): DirectiveElem | null {
  const { stream } = ctx;
  const startPos = stream.checkpoint();
  const attrs = attrsOrUndef(parseAttributeList(ctx));

  const result =
    parseExtensionDirective(ctx, "enable", attrs) ||
    parseExtensionDirective(ctx, "requires", attrs) ||
    parseDiagnosticDirective(ctx, attrs);

  if (!result) stream.reset(startPos);
  return result;
}

/** Grammar: enable_directive | requires_directive : keyword extension_list ';' */
function parseExtensionDirective(
  ctx: ParsingContext,
  keyword: "enable" | "requires",
  attributes?: AttributeElem[],
): DirectiveElem | null {
  const { stream } = ctx;
  const token = stream.matchText(keyword);
  if (!token) return null;

  const extensions = parseCommaList(ctx, parseDirectiveName);
  expect(stream, ";", `${keyword} directive`);
  const directive = { kind: keyword, extensions };
  return makeDirectiveElem(directive, token, stream, attributes);
}

/**
 * Grammar: diagnostic_directive : 'diagnostic' diagnostic_control ';'
 * Grammar: diagnostic_control : '(' severity_control_name ',' diagnostic_rule_name ',' ? ')'
 */
function parseDiagnosticDirective(
  ctx: ParsingContext,
  attributes?: AttributeElem[],
): DirectiveElem | null {
  const { stream } = ctx;
  const token = stream.matchText("diagnostic");
  if (!token) return null;

  expect(stream, "(", "diagnostic");
  const severityToken = expectWord(stream, "Expected severity in diagnostic");
  const severity = makeNameElem(severityToken);
  expect(stream, ",", "diagnostic severity");
  const ruleToken = expectWord(stream, "Expected rule name in diagnostic");
  const ruleName = makeNameElem(ruleToken);

  let subrule = null;
  if (stream.matchText(".")) {
    const subruleToken = expectWord(stream, "Expected subrule name after '.'");
    subrule = makeNameElem(subruleToken);
  }

  stream.matchText(",");
  expect(stream, ")", "diagnostic rule");
  expect(stream, ";", "diagnostic directive");

  const directive: DiagnosticDirective = {
    kind: "diagnostic",
    severity,
    rule: [ruleName, subrule],
  };
  return makeDirectiveElem(directive, token, stream, attributes);
}

function parseDirectiveName(ctx: ParsingContext): NameElem {
  const nameToken = expectWord(ctx.stream, "Expected identifier in name list");
  return makeNameElem(nameToken);
}

function makeDirectiveElem(
  directive: EnableDirective | RequiresDirective | DiagnosticDirective,
  token: WeslToken,
  stream: WeslStream,
  attributes?: AttributeElem[],
): DirectiveElem {
  const start = getStartWithAttributes(attributes, token.span[0]);
  const end = stream.checkpoint();
  const elem: DirectiveElem = { kind: "directive", directive, start, end };
  attachAttributes(elem, attributes);
  return elem;
}
