import { expect, test } from "vitest";
import {
  atomicMinMaxFns,
  f16Types,
  packed4x8Fns,
  stdFns,
  stdTypes,
  subgroupFns,
} from "../StandardTypes.ts";

/** The names in a whitespace separated list. */
function names(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Extension names belong to their own list, never inline in the std text.
 * Adding one back to the core list shows up here as a duplicate, since the
 * std lists are built by interpolating the extension lists. */
test("no name appears twice in the std lists", () => {
  for (const list of [stdFns, stdTypes]) {
    const duplicates = list.filter((n, i) => list.indexOf(n) !== i);
    expect(duplicates).toEqual([]);
  }
});

test("extension names reach the std lists", () => {
  const fns = new Set(stdFns);
  const types = new Set(stdTypes);
  const extFns = [subgroupFns, atomicMinMaxFns, packed4x8Fns].flatMap(names);
  const missing = [
    ...extFns.filter(n => !fns.has(n)),
    ...names(f16Types).filter(n => !types.has(n)),
  ];
  expect(missing).toEqual([]);
});
