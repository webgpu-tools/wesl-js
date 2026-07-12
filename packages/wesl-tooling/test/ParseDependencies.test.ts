import { expect, test } from "vitest";
import { parseDependencies } from "../src/ParseDependencies.ts";

const thisDir = import.meta.dirname;

test("parseDependencies finds ref inside @if block", () => {
  const srcs = {
    main: `
      import package::foo::bar;
      fn main() {
        @if(feature) bar();
      }
    `,
    foo: `
      import dependent_package::dep;
      fn bar() { dep(); }
    `,
  };
  const deps = parseDependencies(srcs, thisDir);
  expect(deps).deep.equals(["dependent_package"]);
});

test("parseDepenencies finds non-root dependency", () => {
  const srcs = {
    main: `
      import package::foo::bar;
      fn main() { }
    `,
    foo: `
      import dependent_package::dep;

      fn bar() { 
        dep(); // should be a package dependency for a library even though it's not referenced from root
      }
    `,
  };
  const deps = parseDependencies(srcs, thisDir);
  expect(deps).deep.equals(["dependent_package"]);
});

test("parseDependencies ignores an unused import", () => {
  const srcs = {
    main: "import dependent_package::dep;\nfn main() {}",
  };
  expect(parseDependencies(srcs, thisDir)).deep.equals([]);
});
