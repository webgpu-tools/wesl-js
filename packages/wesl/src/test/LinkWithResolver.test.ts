import { expect, test } from "vitest";
import { createConstantsResolver } from "../ConstantsResolver.ts";
import { link, linkWithResolver } from "../Linker.ts";
import {
  composeResolvers,
  createLibraryResolvers,
  RecordResolver,
} from "../ModuleResolver.ts";
import {
  createVirtualLibraryResolver,
  type VirtualLibContext,
} from "../VirtualLibraryResolver.ts";
import type { WeslBundle } from "../WeslBundle.ts";

const utilPkg: WeslBundle = {
  name: "util",
  edition: "unstable_2025_1",
  modules: { "lib.wesl": "fn double(x: i32) -> i32 { return x * 2; }" },
};

/** the link context these tests link with: default root, no conditions */
const mainCtx: VirtualLibContext = {
  conditions: {},
  rootModulePath: "package::main",
  packageName: "package",
};

test("linkWithResolver with a simple record resolver", async () => {
  const resolver = new RecordResolver({
    "main.wesl": "fn main() -> i32 { return 1; }",
  });
  const result = await linkWithResolver({ resolver });
  expect(result.dest).toContain("fn main()");
});

test("linkWithResolver with composed constants and virtual libraries", async () => {
  const sources = {
    "main.wesl": `
      import constants::num_lights;
      import virt::helper;
      fn main() -> i32 { return num_lights + helper(); }
    `,
  };
  const resolver = composeResolvers(
    new RecordResolver(sources),
    createConstantsResolver({ num_lights: 4 }),
    createVirtualLibraryResolver(
      { virt: () => "fn helper() -> i32 { return 1; }" },
      mainCtx,
    ),
  );
  const result = await linkWithResolver({ resolver });
  expect(result.dest).toContain("const num_lights = 4;");
  expect(result.dest).toContain("fn helper()");
});

test("composeResolvers returns a single resolver unwrapped and skips undefined", () => {
  const record = new RecordResolver({ "main.wesl": "fn main() {}" });
  expect(composeResolvers(undefined, record, undefined)).toBe(record);
  expect(() => composeResolvers(undefined)).toThrow("no resolvers");
});

test("composeResolvers tries resolvers in order", () => {
  const first = new RecordResolver({ "main.wesl": "fn main() -> i32 {}" });
  const second = new RecordResolver({ "main.wesl": "fn other() {}" });
  const composed = composeResolvers(first, second);
  expect(composed.resolveModule("package::main")).toBe(
    first.resolveModule("package::main"),
  );
});

test("link() and linkWithResolver() produce identical wgsl", async () => {
  const weslSrc = {
    "main.wesl": `
      import constants::size;
      import virt::helper;
      import util::double;
      fn main() -> i32 { return double(size) + helper(); }
    `,
  };
  const virtualLibs = { virt: () => "fn helper() -> i32 { return 1; }" };
  const constants = { size: 8 };

  const oldResult = await link({
    weslSrc,
    constants,
    virtualLibs,
    libs: [utilPkg],
  });

  const newResult = await linkWithResolver({
    resolver: composeResolvers(
      new RecordResolver(weslSrc),
      ...createLibraryResolvers([utilPkg]),
      createConstantsResolver(constants),
      createVirtualLibraryResolver(virtualLibs, mainCtx),
    ),
  });

  expect(newResult.dest).toBe(oldResult.dest);
});

test("conditions affect virtual libraries but not constants", async () => {
  const sources = {
    "main.wesl": `
      import constants::size;
      import virt::mode;
      fn main() -> i32 { return size + mode; }
    `,
  };
  const constantsResolver = createConstantsResolver({ size: 4 });

  async function linkWith(conditions: Record<string, boolean>) {
    const resolver = composeResolvers(
      new RecordResolver(sources),
      constantsResolver,
      createVirtualLibraryResolver(
        {
          virt: ctx => `const mode = ${ctx.conditions.MOBILE ? 1 : 0};`,
        },
        { ...mainCtx, conditions },
      ),
    );
    return (await linkWithResolver({ resolver, conditions })).dest;
  }

  const mobile = await linkWith({ MOBILE: true });
  expect(mobile).toContain("const mode = 1;");
  expect(mobile).toContain("const size = 4;");
  // the shared constants resolver serves its cached AST regardless of conditions
  const desktop = await linkWith({ MOBILE: false });
  expect(desktop).toContain("const mode = 0;");
  expect(desktop).toContain("const size = 4;");
});

test("empty constants and virtualLibs compose to no resolver", async () => {
  expect(createConstantsResolver({})).toBeUndefined();
  expect(createVirtualLibraryResolver({}, mainCtx)).toBeUndefined();

  const result = await link({
    weslSrc: { "main.wesl": "fn main() { }" },
    constants: {},
    virtualLibs: {},
  });
  expect(result.dest).toContain("fn main()");
});

test("constants shadow a virtualLib named 'constants'", async () => {
  const result = await link({
    weslSrc: {
      "main.wesl": "import constants::size;\nfn main() -> i32 { return size; }",
    },
    constants: { size: 4 },
    virtualLibs: { constants: () => "const size = 999;" },
  });
  expect(result.dest).toContain("const size = 4;");
  expect(result.dest).not.toContain("999");
});
