/**
 * Shared Playwright helpers for the play-dev e2e suites. Not named `*.e2e.ts`,
 * so Playwright's testMatch never collects it as a suite of its own.
 */

import type { Page, Request } from "@playwright/test";
import { workerUrl } from "../auth/Callback.ts";
import { type GitHubAuth, githubAuthKey } from "../auth/GitHubAuth.ts";

export const avatarUrl = "https://avatars.githubusercontent.com/u/583231?v=4";

/** A persisted authorization for `login`, shaped as the app stores it. */
export function fakeAuth(login = "octocat"): GitHubAuth {
  return {
    accessToken: "fake-token",
    scope: "gist",
    account: { login, avatarUrl },
  };
}

/** Arrive already signed in as `login`, before any app script reads the token. */
export async function seedToken(page: Page, login = "octocat") {
  await page.addInitScript(
    ({ key, token }) => localStorage.setItem(key, JSON.stringify(token)),
    { key: githubAuthKey, token: fakeAuth(login) },
  );
}

/** A JSON response for Playwright's route.fulfill. */
export function jsonReply(status: number, value: unknown) {
  const body = JSON.stringify(value);
  return { status, contentType: "application/json", body };
}

/** Stub the token-exchange worker and profile fetch so an OAuth callback
 *  completes as `login` without a real trip to GitHub. */
export async function stubOAuth(page: Page, login = "octocat") {
  const token = {
    access_token: "fake-token",
    scope: "gist",
    token_type: "bearer",
  };
  const profile = { login, avatar_url: avatarUrl };
  await page.route(`${workerUrl}/**`, route =>
    route.fulfill(jsonReply(200, token)),
  );
  await page.route("https://api.github.com/user", route =>
    route.fulfill(jsonReply(200, profile)),
  );
}

/** Wait for a drawn frame: the shader compiled and the player rendered it. */
export async function waitForCompileSuccess(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#player") as
      | (HTMLElement & { frameCount?: number })
      | null;
    return (el?.frameCount ?? 0) > 0;
  });
}

/**
 * Record every sessionStorage write into the returned map, live.
 *
 * Reading sessionStorage back after the navigation to github.com races with it
 * (and hits a SecurityError on the opaque document), so the page relays each
 * write through the console instead. Install before navigating.
 */
export async function captureSessionWrites(page: Page) {
  const writes: Record<string, string> = {};
  const prefix = "@@SESS@@";
  page.on("console", msg => {
    const text = msg.text();
    if (!text.startsWith(prefix)) return;
    const eq = text.indexOf("=", prefix.length);
    if (eq > 0) writes[text.slice(prefix.length, eq)] = text.slice(eq + 1);
  });
  await page.addInitScript(() => {
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (this === sessionStorage) console.log(`@@SESS@@${k}=${v}`);
      return origSet.call(this, k, v);
    };
  });
  return writes;
}

/** The editor's current sources, keyed by module path. */
export async function readEditorSources(
  page: Page,
): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const el = document.querySelector("#editor") as
      | (HTMLElement & { sources?: Record<string, string> })
      | null;
    return el?.sources ?? {};
  });
}

/** Replace the editor's source, resolving once the autosave event commits it. */
export async function editAndAutosave(page: Page, source: string) {
  await page.evaluate(src => {
    const el = document.querySelector("#editor") as HTMLElement & {
      source: string;
    };
    return new Promise<void>(resolve => {
      el.addEventListener("autosave", () => resolve(), { once: true });
      el.source = src;
    });
  }, source);
}

/** Abort the sign-in hop to github.com, so the test can assert on the
 *  outbound authorize request instead of leaving the app. */
export async function blockGitHubNav(page: Page) {
  await page.route("https://github.com/**", route => route.abort());
}

/** The next request to GitHub's authorize endpoint. Create before clicking
 *  the control that starts the sign-in. */
export function authorizeRequest(page: Page): Promise<Request> {
  return page.waitForRequest(req =>
    req.url().startsWith("https://github.com/login/oauth/authorize"),
  );
}
