import { expect, test } from "vitest";
import {
  sanitizePackageName,
  validWgslIdent,
} from "../discovery/PackageNameUtils.ts";

test("my_package", () => {
  expect(sanitizePackageName("my_package")).toBe("my_package");
});

test("my-package", () => {
  expect(sanitizePackageName("my-package")).toBe("my_package");
});

test("my-cool-package", () => {
  expect(sanitizePackageName("my-cool-package")).toBe("my_cool_package");
});

test("@scope/package", () => {
  expect(sanitizePackageName("@scope/package")).toBe("scope__package");
});

test("@scope/my-package", () => {
  expect(sanitizePackageName("@scope/my-package")).toBe("scope__my_package");
});

test("@scope/my_package", () => {
  expect(sanitizePackageName("@scope/my_package")).toBe("scope__my_package");
});

test("@my-org/my-cool-package", () => {
  expect(sanitizePackageName("@my-org/my-cool-package")).toBe(
    "my_org__my_cool_package",
  );
});

test("sanitized names that are valid wgsl idents", () => {
  const names = ["my_package", "scope__my_package", "wgsl_utils", "a"];
  for (const name of names) {
    expect(validWgslIdent(name), name).toBe(true);
  }
});

test("sanitized names that aren't valid wgsl idents", () => {
  // e.g. npm names 3d-utils, my.utils, ~utils, package
  const names = ["3d_utils", "my.utils", "~utils", "package", "fn", ""];
  for (const name of names) {
    expect(validWgslIdent(name), name).toBe(false);
  }
});
