import { expect, test } from "vitest";
import { scanDependencies } from "../src/ScanDependencies.ts";

test("scanDependencies includes inline package references", () => {
  const paths = scanDependencies({
    main: "fn main() { dependent_package::dep(); }",
  });
  expect(paths).toContainEqual(["dependent_package", "dep"]);
});

test("scanDependencies includes referenced imports", () => {
  const paths = scanDependencies({
    main: "import dependent_package::dep;\nfn main() { dep(); }",
  });
  expect(paths).toContainEqual(["dependent_package", "dep"]);
});

test("scanDependencies deduplicates repeated references", () => {
  const paths = scanDependencies({
    main: "fn main() { dependent_package::dep(); dependent_package::dep(); }",
  });
  expect(paths.filter(path => path[0] === "dependent_package")).toHaveLength(1);
});

test("scanDependencies ignores unused imports", () => {
  const paths = scanDependencies({
    main: "import dependent_package::dep;\nfn main() {}",
  });
  expect(paths).toEqual([]);
});
