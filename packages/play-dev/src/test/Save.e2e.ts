import { expect, type Page, type Request, test } from "@playwright/test";
import { csrfKey } from "../auth/Authorize.ts";
import { tokenKey } from "../auth/Token.ts";
import { pendingSaveKey } from "../lib/Save.ts";

const fakeToken = {
  accessToken: "fake-token",
  scope: "gist",
  login: "octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
};

const createUrl = "https://api.github.com/gists";
const gistId = "abc123";

async function seedToken(page: Page) {
  await page.addInitScript(
    ({ key, token }) => localStorage.setItem(key, JSON.stringify(token)),
    { key: tokenKey, token: fakeToken },
  );
}

/** Stub create + update, recording each captured request for assertions. */
async function stubGists(
  page: Page,
  opts: { onPatch?: () => Promise<void> } = {},
): Promise<{ calls: Request[] }> {
  const calls: Request[] = [];
  const body = JSON.stringify({
    id: gistId,
    owner: { login: fakeToken.login },
  });
  await page.route(createUrl, route => {
    calls.push(route.request());
    route.fulfill({ status: 201, contentType: "application/json", body });
  });
  await page.route(`${createUrl}/*`, async route => {
    calls.push(route.request());
    await opts.onPatch?.();
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });
  return { calls };
}

async function waitForCompileSuccess(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#player") as
      | (HTMLElement & { frameCount?: number })
      | null;
    return (el?.frameCount ?? 0) > 0;
  });
}

test("signed-in Save creates a gist, updates URL, shows chip", async ({
  page,
}) => {
  await seedToken(page);
  const { calls } = await stubGists(page);
  await page.goto("/");
  await waitForCompileSuccess(page);

  await page.locator(".save-btn").click();

  await expect.poll(() => page.url()).toContain(`/gist/octocat/${gistId}`);
  const chip = page.locator(".gist-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(`/gist/octocat/${gistId}`);

  expect(calls).toHaveLength(1);
  const sent = calls[0].postDataJSON();
  expect(calls[0].method()).toBe("POST");
  expect(sent.public).toBe(true);
  expect(typeof sent.description).toBe("string");
  const files = Object.keys(sent.files);
  expect(files).toEqual(
    expect.arrayContaining([
      "main.wesl",
      "util.wesl",
      "package.json",
      "README.md",
      "thumbnail.png",
    ]),
  );
  const pkg = JSON.parse(sent.files["package.json"].content);
  expect(pkg.name).toMatch(/^[a-z0-9-]+$/);
  expect(pkg.private).toBe(true);
});

test("second Save patches the same gist", async ({ page }) => {
  await seedToken(page);
  const { calls } = await stubGists(page);
  await page.goto("/");
  await waitForCompileSuccess(page);

  await page.locator(".save-btn").click();
  await expect.poll(() => page.url()).toContain(`/gist/octocat/${gistId}`);

  await page.locator(".save-btn").click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].method()).toBe("PATCH");
  expect(calls[1].url()).toBe(`${createUrl}/${gistId}`);
});

test("second Save stays busy past the first save status timeout", async ({
  page,
}) => {
  let releasePatch: (() => void) | undefined;
  const patchGate = new Promise<void>(resolve => {
    releasePatch = resolve;
  });
  await seedToken(page);
  const { calls } = await stubGists(page, { onPatch: () => patchGate });
  await page.goto("/");
  await waitForCompileSuccess(page);

  const save = page.locator(".save-btn");
  await save.click();
  await expect(save).toHaveText("Saved");

  await save.click();
  await expect.poll(() => calls.length).toBe(2);
  await expect(save).toHaveText("Saving...");
  await page.waitForTimeout(1900);
  await expect(save).toHaveText("Saving...");
  await expect(save).toBeDisabled();

  releasePatch?.();
  await expect(save).toHaveText("Saved");
});

test("Save while signed out starts OAuth and flags a pending save", async ({
  page,
}) => {
  // Capture sessionStorage writes as they happen: reading it back after the
  // navigation to github.com races (and hits a SecurityError on the opaque doc).
  const writes: Record<string, string> = {};
  const prefix = "@@SESS@@";
  page.on("console", msg => {
    const t = msg.text();
    if (!t.startsWith(prefix)) return;
    const eq = t.indexOf("=", prefix.length);
    if (eq > 0) writes[t.slice(prefix.length, eq)] = t.slice(eq + 1);
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

  await page.locator(".save-btn").click();
  await navPromise;

  expect(writes[pendingSaveKey]).toBe("1");
  expect(writes[csrfKey]).toBeTruthy();
});

test("pending save resumes after sign-in", async ({ page }) => {
  const { calls } = await stubGists(page);
  await page.addInitScript(
    ({ tk, token, pk }) => {
      localStorage.setItem(tk, JSON.stringify(token));
      sessionStorage.setItem(pk, "1");
    },
    { tk: tokenKey, token: fakeToken, pk: pendingSaveKey },
  );

  await page.goto("/");
  await waitForCompileSuccess(page);

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].method()).toBe("POST");
  await expect(page.locator(".gist-chip")).toBeVisible();
});
