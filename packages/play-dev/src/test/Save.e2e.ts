import { expect, type Page, type Request, test } from "@playwright/test";
import { csrfKey } from "../auth/Authorize.ts";
import { githubAuthKey } from "../auth/GitHubAuth.ts";
import { pendingSaveKey } from "../lib/Save.ts";
import {
  authorizeRequest,
  blockGitHubNav,
  captureSessionWrites,
  fakeAuth,
  seedToken,
  waitForCompileSuccess,
} from "./E2eUtil.ts";

/** `onPatch` gates the update response, holding a save open mid-flight. */
type StubOpts = { onPatch?: () => Promise<void> };

const gistsUrl = "https://api.github.com/gists";
const gistId = "abc123";
const gistUrl = `${gistsUrl}/${gistId}`;

/** Stub create + update, recording each captured request for assertions. */
async function stubGists(page: Page, opts: StubOpts = {}) {
  const calls: Request[] = [];
  const body = JSON.stringify({ id: gistId, owner: { login: "octocat" } });
  await page.route(gistsUrl, route => {
    calls.push(route.request());
    route.fulfill({ status: 201, contentType: "application/json", body });
  });
  await page.route(`${gistsUrl}/*`, async route => {
    calls.push(route.request());
    await opts.onPatch?.();
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });
  return { calls };
}

/** Put the caret in the code editor, where a shortcut key usually arrives from. */
async function focusEditor(page: Page) {
  await page.evaluate(() => {
    const host = document.querySelector("#editor");
    const content = host?.shadowRoot?.querySelector(".cm-content");
    (content as HTMLElement | null)?.focus();
  });
}

/** Sign in, stub the gist API, and open the editor on a compiled shader. */
async function startSignedIn(page: Page, opts: StubOpts = {}) {
  await seedToken(page);
  const stub = await stubGists(page, opts);
  await page.goto("/");
  await waitForCompileSuccess(page);
  return stub;
}

test("signed-in Save creates a gist, updates URL, shows chip", async ({
  page,
}) => {
  const { calls } = await startSignedIn(page);

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
      "thumbnail.png.base64",
    ]),
  );
  const pkg = JSON.parse(sent.files["package.json"].content);
  expect(pkg.name).toMatch(/^[a-z0-9-]+$/);
  expect(pkg.private).toBe(true);
});

test("Save snapshots an edit before the autosave debounce", async ({
  page,
}) => {
  const { calls } = await startSignedIn(page);

  const marker = "// LIVE-SAVE-MARKER";
  await page.evaluate(source => {
    const editor = document.querySelector("#editor") as HTMLElement & {
      source: string;
    };
    editor.source = source;
  }, `${marker}\n@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }`);
  await page.locator(".save-btn").click();

  await expect.poll(() => calls.length).toBe(1);
  const sent = calls[0].postDataJSON();
  expect(sent.files["main.wesl"].content).toContain(marker);
});

test("second Save patches the same gist", async ({ page }) => {
  const { calls } = await startSignedIn(page);

  await page.locator(".save-btn").click();
  await expect.poll(() => page.url()).toContain(`/gist/octocat/${gistId}`);

  await page.locator(".save-btn").click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].method()).toBe("PATCH");
  expect(calls[1].url()).toBe(gistUrl);
});

test("second Save deletes files removed from the editor", async ({ page }) => {
  const { calls } = await startSignedIn(page);

  await page.locator(".save-btn").click();
  await expect.poll(() => calls.length).toBe(1);
  await page.evaluate(() => {
    const editor = document.querySelector("#editor") as HTMLElement & {
      project: { weslSrc: Record<string, string> };
    };
    editor.project = {
      weslSrc: {
        "package::main":
          "@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }",
      },
    };
  });
  await page.locator(".save-btn").click();

  await expect.poll(() => calls.length).toBe(2);
  const patch = calls[1].postDataJSON();
  expect(patch.files["util.wesl"]).toBeNull();
});

// "Saved" fades back to idle on a timer. If the second save doesn't cancel the
// first one's timer, that stale timer fires mid-flight and the button claims to
// be idle while a PATCH is still in the air.
test("second Save stays busy past the first save status timeout", async ({
  page,
}) => {
  const patchGate = Promise.withResolvers<void>();
  const onPatch = () => patchGate.promise;
  const { calls } = await startSignedIn(page, { onPatch });
  await page.clock.install();

  const save = page.locator(".save-btn");
  await save.click();
  await expect(save).toHaveText("Saved");

  await save.click();
  await expect.poll(() => calls.length).toBe(2);
  await expect(save).toHaveText("Saving...");
  await page.clock.fastForward(1900); // past the first save's fade
  await expect(save).toHaveText("Saving...");
  await expect(save).toBeDisabled();

  patchGate.resolve();
  await expect(save).toHaveText("Saved");
});

test("Cmd/Ctrl+S saves like the Save button", async ({ page }) => {
  const { calls } = await startSignedIn(page);
  await focusEditor(page); // the shortcut has to reach document from the editor

  await page.keyboard.press("ControlOrMeta+s");

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].method()).toBe("POST");
  await expect.poll(() => page.url()).toContain(`/gist/octocat/${gistId}`);
});

test("Cmd/Ctrl+S saves a title rename still being typed", async ({ page }) => {
  const { calls } = await startSignedIn(page);

  // The title commits on blur, which a Save click forces and Cmd+S must too:
  // the caret is still in the title when the shortcut fires.
  const title = page.locator(".title");
  await title.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("renamed by keyboard");
  await page.keyboard.press("ControlOrMeta+s");

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].postDataJSON().description).toBe("renamed by keyboard");
  await expect(title).toHaveText("renamed by keyboard");
});

test("Save while signed out starts OAuth and flags a pending save", async ({
  page,
}) => {
  const writes = await captureSessionWrites(page);

  await page.goto("/");
  await blockGitHubNav(page);
  const navPromise = authorizeRequest(page);

  await page.locator(".save-btn").click();
  await navPromise;

  // The flag is what makes the save resume on the way back; the csrf token is
  // what the callback will check the returned `state` against.
  expect(writes[pendingSaveKey]).toBe("1");
  expect(writes[csrfKey]).toBeTruthy();
});

test("pending save resumes after sign-in", async ({ page }) => {
  const { calls } = await stubGists(page);
  // The state the OAuth callback leaves behind: a token, and the flag saying a
  // save was interrupted. Booting on that alone should finish the save.
  await page.addInitScript(
    ({ tk, token, pk }) => {
      localStorage.setItem(tk, JSON.stringify(token));
      sessionStorage.setItem(pk, "1");
    },
    { tk: githubAuthKey, token: fakeAuth(), pk: pendingSaveKey },
  );

  await page.goto("/");
  await waitForCompileSuccess(page);

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].method()).toBe("POST");
  await expect(page.locator(".gist-chip")).toBeVisible();
});
