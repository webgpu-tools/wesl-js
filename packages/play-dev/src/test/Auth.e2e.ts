import { expect, type Page, test } from "@playwright/test";
import { csrfKey } from "../auth/Authorize.ts";
import { workerUrl } from "../auth/Callback.ts";
import { githubAuthKey } from "../auth/GitHubAuth.ts";

const fakeAuth = {
  accessToken: "fake-token",
  scope: "gist",
  account: {
    login: "octocat",
    avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
  },
};

const workerGlob = `${workerUrl}/**`;
const profileUrl = "https://api.github.com/user";

async function stubWorkerAndProfile(page: Page) {
  await page.route(workerGlob, route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: fakeAuth.accessToken,
        scope: "gist",
        token_type: "bearer",
      }),
    }),
  );
  await page.route(profileUrl, route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        login: fakeAuth.account.login,
        avatar_url: fakeAuth.account.avatarUrl,
      }),
    }),
  );
}

async function waitForCompileSuccess(page: Page, selector: string) {
  await page.waitForFunction(sel => {
    const el = document.querySelector(sel) as
      | (HTMLElement & { frameCount?: number })
      | null;
    return (el?.frameCount ?? 0) > 0;
  }, selector);
}

test("signed-out shows Sign in button", async ({ page }) => {
  await page.goto("/");
  const btn = page.locator(".signin-btn");
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText("Sign in");
});

test("signed-in shows avatar and dropdown with Sign out", async ({ page }) => {
  await page.addInitScript(
    ({ key, token }) => localStorage.setItem(key, JSON.stringify(token)),
    { key: githubAuthKey, token: fakeAuth },
  );
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
  // Capture the CSRF value via console at the moment it's written, since
  // the navigation to github.com would otherwise race the read.
  const sessionWrites: Record<string, string> = {};
  page.on("console", msg => {
    const t = msg.text();
    const prefix = "@@SESS@@";
    if (!t.startsWith(prefix)) return;
    const eq = t.indexOf("=", prefix.length);
    if (eq > 0) sessionWrites[t.slice(prefix.length, eq)] = t.slice(eq + 1);
  });
  await page.addInitScript(() => {
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (this === sessionStorage) console.log(`@@SESS@@${k}=${v}`);
      return origSet.call(this, k, v);
    };
  });

  await page.goto("/");
  await page.route("https://github.com/**", route => route.abort());
  const navPromise = page.waitForRequest(req =>
    req.url().startsWith("https://github.com/login/oauth/authorize"),
  );
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
  await stubWorkerAndProfile(page);
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
    accessToken: fakeAuth.accessToken,
    scope: "gist",
    account: fakeAuth.account,
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
  await stubWorkerAndProfile(page);

  await page.goto("/");
  await waitForCompileSuccess(page, "#player");
  await page.evaluate(() => {
    const el = document.querySelector("#editor") as HTMLElement & {
      source: string;
    };
    return new Promise<void>(resolve => {
      el.addEventListener("autosave", () => resolve(), { once: true });
      el.source =
        "// AUTH-MARKER\n@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }\n";
    });
  });

  await page.evaluate(k => sessionStorage.setItem(k, "s"), csrfKey);
  await page.goto("/auth/callback?code=c&state=s");
  await page.waitForURL("**/");
  await waitForCompileSuccess(page, "#player");

  const sources = await page.evaluate(() => {
    const el = document.querySelector("#editor") as HTMLElement & {
      sources?: Record<string, string>;
    };
    return el?.sources ?? {};
  });
  expect(Object.values(sources).join("\n")).toContain("// AUTH-MARKER");
});
