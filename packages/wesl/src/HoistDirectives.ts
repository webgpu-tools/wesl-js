import type {
  AbstractElem,
  DirectiveElem,
  ModuleElem,
  NameElem,
} from "./AbstractElems.ts";
import type { EmittableElem } from "./BindIdents.ts";
import { filterValidElements } from "./Conditions.ts";
import type { Conditions } from "./Scope.ts";

/** enable and requires apply to the whole shader, so they hoist out of
 * imported modules. diagnostic directives are scoped, and stay put. */
type HoistKeyword = "enable" | "requires";

/** An enable/requires directive (DirectiveElem also covers diagnostic). */
interface HoistDirectiveElem extends DirectiveElem {
  directive: { kind: HoistKeyword; extensions: NameElem[] };
}

/** A hoisted directive, still paired with the module it came from. */
interface HoistedDirective extends EmittableElem {
  elem: HoistDirectiveElem;
}

/** An extension to hoist, paired with the directive that named it. */
interface FoundExtension {
  extension: NameElem;
  source: HoistedDirective;
}

const hoistKeywords: HoistKeyword[] = ["enable", "requires"];

/**
 * Collapse the enable/requires directives gathered from imported modules into
 * one directive per keyword, to emit ahead of everything else (WGSL wants
 * directives before any declaration).
 *
 * Extensions the root module already declares are skipped, since the root
 * module emits its own directives in place. Deduplicating by extension name
 * rather than by directive element matters because one directive can name
 * several extensions, and two modules' lists can partly overlap.
 *
 * `hoisted` arrives filtered against the link's conditions (binding filters
 * each module's statements in sequence), so `conditions` is needed only to read
 * the root module's own directives.
 */
export function hoistedDirectives(
  rootModuleElem: ModuleElem,
  hoisted: EmittableElem[],
  conditions: Conditions,
): EmittableElem[] {
  if (!hoisted.length) return [];
  const rootElems = filterValidElements(rootModuleElem.decls, conditions);

  const merged: EmittableElem[] = [];
  for (const keyword of hoistKeywords) {
    const sources = hoistedOfKind(hoisted, keyword);
    const rootNames = rootExtensions(rootElems, keyword);
    const found = uniqueExtensions(sources, rootNames);
    if (found.length) {
      const extensions = found.map(f => f.extension);
      merged.push(mergedDirective(keyword, extensions, found[0].source));
    }
  }
  return merged;
}

/** The hoisted enable (or requires) directives. */
function hoistedOfKind(
  hoisted: EmittableElem[],
  keyword: HoistKeyword,
): HoistedDirective[] {
  return hoisted.filter((s): s is HoistedDirective =>
    directiveOfKind(s.elem, keyword),
  );
}

/** Extensions the root module declares itself. */
function rootExtensions(
  rootElems: AbstractElem[],
  keyword: HoistKeyword,
): Set<string> {
  const directives = rootElems.filter((e): e is HoistDirectiveElem =>
    directiveOfKind(e, keyword),
  );
  const extensions = directives.flatMap(d => d.directive.extensions);
  return new Set(extensions.map(e => e.name));
}

/** Extensions named across `sources`, deduplicated as they're collected and
 * skipping any in `exclude`. Collecting the NameElem rather than the string
 * keeps the merged directive made of real elements, so the emitted line still
 * maps back to the source that asked for it. */
function uniqueExtensions(
  sources: HoistedDirective[],
  exclude: Set<string>,
): FoundExtension[] {
  const seen = new Set(exclude);
  const found: FoundExtension[] = [];
  for (const source of sources) {
    for (const extension of source.elem.directive.extensions) {
      if (!seen.has(extension.name)) {
        seen.add(extension.name);
        found.push({ extension, source });
      }
    }
  }
  return found;
}

/** One directive naming every hoisted extension, spanning the directive that
 * contributed the first extension so the emitted line points at real source
 * (the first directive overall may have contributed nothing, when every
 * extension it names is already declared by the root module). */
function mergedDirective(
  keyword: HoistKeyword,
  extensions: NameElem[],
  source: HoistedDirective,
): EmittableElem {
  const { start, end } = source.elem;
  const elem: DirectiveElem = {
    kind: "directive",
    directive: { kind: keyword, extensions },
    start,
    end,
  };
  return { srcModule: source.srcModule, elem };
}

/** Is this element an enable (or requires) directive of the given keyword? */
function directiveOfKind(
  elem: AbstractElem,
  keyword: HoistKeyword,
): elem is HoistDirectiveElem {
  return elem.kind === "directive" && elem.directive.kind === keyword;
}
