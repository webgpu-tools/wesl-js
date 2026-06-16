/// <reference types="wesl-plugin/suffixes" />
import { expect, expectTypeOf, test } from "vitest";
import type { LinkParams } from "wesl";
import linkParams from "../shaders/foo/app.wesl?link";
import appBLinkParams from "../shaders/foo/app-b.wesl?link";
import dashLinkParams from "../shaders/foo/app-test.wesl?link";

test("verify ?link", async () => {
  expectTypeOf(linkParams).toExtend<LinkParams>();

  const { rootModuleName, debugWeslRoot, weslSrc, libs } =
    linkParams as LinkParams;
  expect(rootModuleName).toMatchInlineSnapshot(`"app"`);

  expect(debugWeslRoot).toMatchInlineSnapshot(`"shaders/foo"`);

  expect(weslSrc).toMatchInlineSnapshot(`
    {
      "app.wesl": "import random_wgsl::pcg_2u_3f;

    fn main() {
       let a = pcg_2u_3f(vec2u(1, 2));
    }",
    }
  `);
  expect(libs?.length).equal(1);
  const firstDep = libs![0];
  expect(firstDep.name).toMatchInlineSnapshot(`"random_wgsl"`);
  expect([...Object.keys(firstDep.modules)]).toMatchInlineSnapshot(`
    [
      "randomTest.wgsl",
      "lib.wgsl",
    ]
  `);
});

test("?link scoping isolates modules between imports", async () => {
  const appSrc = (linkParams as LinkParams).weslSrc!;
  const appBSrc = (appBLinkParams as LinkParams).weslSrc!;

  // app.wesl doesn't import helper, so helper.wesl should NOT be in its scope
  expect(Object.keys(appSrc)).not.toContain("helper.wesl");
  expect(Object.keys(appSrc)).toContain("app.wesl");

  // app-b.wesl imports helper, so helper.wesl SHOULD be in its scope
  expect(Object.keys(appBSrc)).toContain("helper.wesl");
  expect(Object.keys(appBSrc)).toContain("app-b.wesl");

  // And app-b should NOT include app.wesl (they're independent)
  expect(Object.keys(appBSrc)).not.toContain("app.wesl");
});

test("?link with dash in filename", async () => {
  expectTypeOf(dashLinkParams).toExtend<LinkParams>();
  const { rootModuleName } = dashLinkParams as LinkParams;
  expect(rootModuleName).toMatchInlineSnapshot(`"app-test"`);
});
