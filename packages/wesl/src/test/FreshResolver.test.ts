import { expect, test } from "vitest";
import { link } from "../Linker.ts";
import { freshResolver, RecordResolver } from "../ModuleResolver.ts";

test("deprecated freshResolver is an identity wrapper", () => {
  const resolver = new RecordResolver({ main: `fn foo() {}` });
  const fresh = freshResolver(resolver);
  expect(fresh.resolveModule("package::main")).toBe(
    resolver.resolveModule("package::main"),
  );
});

test("link twice with one shared resolver and different conditions", async () => {
  const weslSrc = {
    "main.wesl": `
      @if(A) fn foo() -> i32 { return 1; }
      @else  fn foo() -> i32 { return 2; }
    `,
  };
  const resolver = new RecordResolver(weslSrc);

  const [r1, r2] = await Promise.all([
    link({ resolver, rootModuleName: "main", conditions: { A: true } }),
    link({ resolver, rootModuleName: "main", conditions: { A: false } }),
  ]);
  expect(r1.dest).toContain("return 1");
  expect(r2.dest).toContain("return 2");
});
