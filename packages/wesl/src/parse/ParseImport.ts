/** Token-based parsers for WESL import statements working directly with WeslStream. */

import type {
  ImportCollection,
  ImportElem,
  ImportItem,
  ImportSegment,
  ImportStatement,
} from "../AbstractElems.ts";
import { parseWeslConditional } from "./ParseAttribute.ts";
import { weslKeywords } from "./ParseIdent.ts";
import { parseMany, throwParseError } from "./ParseUtil.ts";
import {
  maxNesting,
  nestedTooDeeply,
  type ParsingContext,
} from "./ParsingContext.ts";
import type { WeslStream } from "./WeslStream.ts";

/** WESL Grammar: translation_unit : import_statement* global_directive* global_decl*
 * Yields each import as it parses (lazy, so callers keep imports parsed
 * before a syntax error). */
export function* parseWeslImports(ctx: ParsingContext): Generator<ImportElem> {
  yield* parseMany(ctx, parseImportStatement);
}

/** Grammar: import_statement : conditional_attribute? 'import' import_relative? (import_collection | import_path_or_item) ';' */
function parseImportStatement(ctx: ParsingContext): ImportElem | null {
  const { stream } = ctx;
  const condAttr = parseWeslConditional(ctx);

  const parseResult = parseImportStatementBase(stream);
  if (!parseResult) {
    if (condAttr) stream.reset(condAttr.start);
    return null;
  }

  const { statement: imports, importPos } = parseResult;
  const start = condAttr?.start ?? importPos;
  const end = stream.checkpoint();
  const attributes = condAttr ? [condAttr] : undefined;
  return { kind: "import", imports, start, end, attributes };
}

/** Parse: import <relative>? <collection_or_path> ';' */
function parseImportStatementBase(
  stream: WeslStream,
): { statement: ImportStatement; importPos: number } | null {
  const importToken = stream.matchText("import");
  if (!importToken) return null;

  const relative = parseImportRelative(stream) ?? [];
  const parsed =
    parseImportCollection(stream, 0) || parseImportPathOrItem(stream, 0);
  if (!parsed) throwParseError(stream, "invalid import, expected { or name");
  if (!stream.matchText(";"))
    throwParseError(stream, "invalid import, expected ';'");

  const isStatement = parsed.kind === "import-statement";
  const statement = isStatement
    ? prependSegments(relative, parsed)
    : makeStatement(relative, parsed);
  return { statement, importPos: importToken.span[0] };
}

/** WESL Grammar: import_relative : 'package' '::' | 'super' '::' ('super' '::')* */
function parseImportRelative(stream: WeslStream): ImportSegment[] | null {
  if (stream.matchSequence("package", "::")) return [makeSegment("package")];

  const segments: ImportSegment[] = [];
  while (stream.matchSequence("super", "::")) {
    segments.push(makeSegment("super"));
  }
  return segments.length > 0 ? segments : null;
}

/** WESL Grammar: import_collection : '{' import_path_or_item (',' import_path_or_item)* ','? '}' */
function parseImportCollection(
  stream: WeslStream,
  depth: number,
): ImportCollection | null {
  if (!stream.matchText("{")) return null;

  const msg = "invalid import collection, expected name";
  const first = parseImportPathOrItem(stream, depth);
  if (!first) throwParseError(stream, msg);
  const statements: ImportStatement[] = [first];

  while (stream.matchText(",")) {
    if (stream.peek()?.text === "}") break;
    const item = parseImportPathOrItem(stream, depth);
    if (!item) throwParseError(stream, msg + " after ','");
    statements.push(item);
  }

  if (!stream.matchText("}"))
    throwParseError(stream, "invalid import collection, expected }");
  return makeCollection(statements);
}

/**
 * WESL Grammar: import_path_or_item :
 *   ident '::' (import_collection | import_path_or_item) | ident ('as' ident)?
 */
function parseImportPathOrItem(
  stream: WeslStream,
  depth: number,
): ImportStatement | null {
  const name = parsePackageWord(stream);
  if (!name) return null;

  if (stream.matchText("::")) {
    // both branches below recurse, once per path segment or nested collection
    if (depth >= maxNesting) throwParseError(stream, nestedTooDeeply);
    const segment = makeSegment(name);

    const collection = parseImportCollection(stream, depth + 1);
    if (collection) return makeStatement([segment], collection);

    const pathOrItem = parseImportPathOrItem(stream, depth + 1);
    if (pathOrItem) return prependSegments([segment], pathOrItem);

    throwParseError(stream, "invalid import, expected '{' or name");
  }

  if (stream.matchText("as")) {
    const alias = stream.matchKind("word");
    if (!alias) throwParseError(stream, "invalid alias, expected name");
    return makeStatement([], makeImportItem(name, alias.text));
  }

  return makeStatement([], makeImportItem(name));
}

/** Prepend path segments to an existing statement */
function prependSegments(
  segments: ImportSegment[],
  statement: ImportStatement,
): ImportStatement {
  return { ...statement, segments: segments.concat(statement.segments) };
}

// -- AST node constructors --

function makeStatement(
  segments: ImportSegment[],
  finalSegment: ImportCollection | ImportItem,
): ImportStatement {
  return { kind: "import-statement", segments, finalSegment };
}

function makeSegment(name: string): ImportSegment {
  return { kind: "import-segment", name };
}

function makeCollection(subtrees: ImportStatement[]): ImportCollection {
  return { kind: "import-collection", subtrees };
}

/** @return word/keyword token text usable in import path, or null if it's a WESL keyword */
function parsePackageWord(stream: WeslStream): string | null {
  const token = stream.peek();
  if (!token) return null;

  const { text, kind } = token;
  if (kind !== "word" && kind !== "keyword") return null;
  if (weslKeywords.has(text)) return null;

  stream.nextToken();
  return text;
}

function makeImportItem(name: string, as?: string): ImportItem {
  return { kind: "import-item", name, as };
}
