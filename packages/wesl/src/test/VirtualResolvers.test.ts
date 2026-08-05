import { expect, test } from "vitest";
import { createConstantsResolver } from "../ConstantsResolver.ts";
import { createVirtualLibraryResolver } from "../VirtualLibraryResolver.ts";

test("ConstantsResolver resolves only the constants module", () => {
  const resolver = createConstantsResolver({ num_lights: 4, scale: "1.5" })!;

  const ast = resolver.resolveModule("constants");
  expect(ast?.srcModule.src).toBe("const num_lights = 4;\nconst scale = 1.5;");
  expect(resolver.resolveModule("other")).toBeUndefined();
});

test("ConstantsResolver parses once and caches", () => {
  const resolver = createConstantsResolver({ size: 2 })!;
  const first = resolver.resolveModule("constants");
  expect(resolver.resolveModule("constants")).toBe(first);
});

test("ConstantsResolver parses under the host package", () => {
  const resolver = createConstantsResolver({ x: 1 }, "myapp")!;
  const ast = resolver.resolveModule("constants");
  expect(ast?.srcModule.modulePath).toBe("myapp::constants");
});

test("VirtualLibraryResolver resolves only registered modules", () => {
  const resolver = createVirtualLibraryResolver(
    { virt: () => "const value = 42;" },
    { conditions: {}, rootModulePath: "package::main", packageName: "package" },
  )!;

  const ast = resolver.resolveModule("virt");
  expect(ast?.srcModule.src).toBe("const value = 42;");
  expect(ast?.srcModule.modulePath).toBe("package::virt");
  expect(resolver.resolveModule("unregistered")).toBeUndefined();
});

test("VirtualLibraryResolver passes context to generators and caches", () => {
  const seen: unknown[] = [];
  const conditions = { MOBILE: true };
  const resolver = createVirtualLibraryResolver(
    {
      virt: ctx => {
        seen.push(ctx);
        return "const value = 1;";
      },
    },
    { conditions, rootModulePath: "package::app", packageName: "package" },
  )!;

  const first = resolver.resolveModule("virt");
  expect(resolver.resolveModule("virt")).toBe(first);
  expect(seen).toEqual([
    { conditions, rootModulePath: "package::app", packageName: "package" },
  ]);
});
