import { expect, test } from "@playwright/test";
import { csrfKey } from "../auth/Authorize.ts";
import { githubAuthKey } from "../auth/GitHubAuth.ts";
import {
  authorizeRequest,
  blockGitHubNav,
  captureSessionWrites,
  editAndAutosave,
  fakeAuth,
  readEditorSources,
  seedToken,
  stubOAuth,
  waitForCompileSuccess,
} from "./E2eUtil.ts";

const octocat = fakeAuth();

test("signed-out shows Sign in button", async ({ page }) => {
  await page.goto("/");
  const btn = page.locator(".signin-btn");
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText("Sign in");
});

test("signed-in shows avatar and dropdown with Sign out", async ({ page }) => {
  await seedToken(page);
  await page.goto("/");

  const avatar = page.locator(".avatar-btn");
  await expect(avatar).toBeVisible();
  await expect(page.locator(".account-dropdown")).toHaveCount(0);

  await avatar.click();
  await expect(page.locator(".account-dropdown")).toBeVisible();
  await expect(page.locator(".account-login")).toHaveText("octocat");

  await page.locator(".account-dropdown button").click();
  await expect(page.locator(".signin-btn")).toBeVisible();

  const stored = await page.evaluate(
    k => localStorage.getItem(k),
    githubAuthKey,
  );
  expect(stored).toBeNull();
});

test("Sign in button starts OAuth redirect", async ({ page }) => {
  const sessionWrites = await captureSessionWrites(page);

  await page.goto("/");
  await blockGitHubNav(page);
  const navPromise = authorizeRequest(page);
  await page.locator(".signin-btn").click();
  const req = await navPromise;
  const url = new URL(req.url());
  expect(url.searchParams.get("client_id")).toBe("Ov23li6iYF3wfpn2cdgM");
  expect(url.searchParams.get("scope")).toBe("gist");
  expect(url.searchParams.get("state")).toBeTruthy();
  expect(sessionWrites[csrfKey]).toBe(url.searchParams.get("state"));
});

test("callback exchange persists token and reloads to editor", async ({
  page,
}) => {
  await stubOAuth(page);
  await page.addInitScript(
    ({ key, csrf }) => sessionStorage.setItem(key, csrf),
    { key: csrfKey, csrf: "the-state" },
  );

  await page.goto("/auth/callback?code=the-code&state=the-state");
  await page.waitForURL("**/");
  await expect(page.locator(".avatar-btn")).toBeVisible();

  const stored = await page.evaluate(
    k => localStorage.getItem(k),
    githubAuthKey,
  );
  expect(stored && JSON.parse(stored)).toMatchObject({
    accessToken: octocat.accessToken,
    scope: "gist",
    account: octocat.account,
  });
});

test("callback rejects mismatched state", async ({ page }) => {
  await page.addInitScript(
    ({ key, csrf }) => sessionStorage.setItem(key, csrf),
    { key: csrfKey, csrf: "expected" },
  );
  await page.goto("/auth/callback?code=x&state=different");
  await expect(page.locator(".callback-error")).toContainText("State mismatch");
});

test("editor buffer survives sign-in redirect simulation", async ({ page }) => {
  await stubOAuth(page);

  await page.goto("/");
  await waitForCompileSuccess(page);
  await editAndAutosave(
    page,
    "// AUTH-MARKER\n@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }\n",
  );

  await page.evaluate(k => sessionStorage.setItem(k, "s"), csrfKey);
  await page.goto("/auth/callback?code=c&state=s");
  await page.waitForURL("**/");
  await waitForCompileSuccess(page);

  const sources = await readEditorSources(page);
  expect(Object.values(sources).join("\n")).toContain("// AUTH-MARKER");
});
