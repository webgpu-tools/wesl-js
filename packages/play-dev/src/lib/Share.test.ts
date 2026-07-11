import { expect, test } from "vitest";
import type { WeslBundle } from "wesl";
import {
  decodeFragment,
  encodeFragment,
  maxTitleLength,
  persistProject,
} from "./Share.ts";

test("encode/decode round-trips a payload", () => {
  const payload = {
    project: {
      weslSrc: { "main.wesl": "fn main() {}\n" },
      rootModuleName: "main",
    },
    title: "quirky-brewing-hummingbird",
  };
  const fragment = encodeFragment(payload);
  expect(fragment).not.toBeNull();
  expect(fragment!.startsWith("#v1=")).toBe(true);
  const decoded = decodeFragment(fragment!);
  expect(decoded).toEqual(payload);
});

test("decodeFragment returns null for missing prefix", () => {
  expect(decodeFragment("")).toBeNull();
  expect(decodeFragment("#")).toBeNull();
  expect(decodeFragment("#bogus")).toBeNull();
});

test("decodeFragment returns null for malformed payload", () => {
  expect(decodeFragment("#v1=abc")).toBeNull();
});

test("decodeFragment accepts a leading or missing #", () => {
  const payload = { project: { weslSrc: { "a.wesl": "" } }, title: "x" };
  const fragment = encodeFragment(payload);
  expect(decodeFragment(fragment!.slice(1))).toEqual(payload);
});

test("decodeFragment rejects non-string weslSrc values", () => {
  const fragment = encodeFragment({
    project: { weslSrc: { "main.wesl": 42 as unknown as string } },
    title: "bad",
  });
  expect(decodeFragment(fragment!)).toBeNull();
});

test("decodeFragment rejects oversized title", () => {
  const fragment = encodeFragment({
    project: { weslSrc: { "main.wesl": "" } },
    title: "x".repeat(maxTitleLength + 1),
  });
  expect(decodeFragment(fragment!)).toBeNull();
});

test("encodeFragment returns null for oversized payload", () => {
  // Pseudo-random varied content so lz-string can't collapse it: we want to
  // actually exercise the size cap.
  let seed = 1;
  const chars = Array.from({ length: 200_000 }, () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return String.fromCharCode(33 + (seed % 90));
  });
  const fragment = encodeFragment({
    project: { weslSrc: { "main.wesl": chars.join("") } },
    title: "big",
  });
  expect(fragment).toBeNull();
});

test("persistProject removes hydrated library bundles", () => {
  const lib: WeslBundle = { name: "lib", edition: "test", modules: {} };
  lib.dependencies = [lib];
  const project = persistProject({
    weslSrc: { "package::main": "fn main() {}" },
    libs: [lib],
  });
  expect(project).toEqual({
    weslSrc: { "package::main": "fn main() {}" },
  });
  expect(() => JSON.stringify(project)).not.toThrow();
});
