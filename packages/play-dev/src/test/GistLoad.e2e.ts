import { expect, type Page, type Request, test } from "@playwright/test";
import { csrfKey, returnPathKey } from "../auth/Authorize.ts";
import {
  authorizeRequest,
  blockGitHubNav,
  captureSessionWrites,
  editAndAutosave,
  jsonReply,
  readEditorSources,
  seedToken,
  stubOAuth,
  waitForCompileSuccess,
} from "./E2eUtil.ts";

const gistId = "abc123";
const forkId = "fork456";
const gistsUrl = "https://api.github.com/gists";
const gistUrl = `${gistsUrl}/${gistId}`;
const gistPath = `/gist/octocat/${gistId}`;

const mainWesl = `// GIST-FIXTURE
import package::util::tint;
@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return tint();
}
`;
const utilWesl = "fn tint() -> vec4f { return vec4f(0.2, 0.6, 0.9, 1.0); }\n";

const gistBody = {
  id: gistId,
  owner: { login: "octocat" },
  description: "loaded-fixture",
  files: {
    "main.wesl": { content: mainWesl },
    "util.wesl": { content: utilWesl },
    "package.json": { content: '{ "name": "loaded-fixture" }\n' },
    "README.md": { content: "# loaded-fixture\n" },
    "thumbnail.png.base64": { content: "aGVsbG8=" },
  },
};

/** Stub gist GET (load), POST (fork) and PATCH (update), recording each call. */
async function stubGists(page: Page, opts: { getStatus?: number } = {}) {
  const calls: Request[] = [];
  const forked = { id: forkId, owner: { login: "visitor" } };
  await page.route(gistsUrl, route => {
    calls.push(route.request());
    route.fulfill(jsonReply(201, forked));
  });
  await page.route(`${gistsUrl}/*`, route => {
    calls.push(route.request());
    const status = opts.getStatus ?? 200;
    if (route.request().method() === "GET" && status !== 200) {
      return route.fulfill(jsonReply(status, { message: "Not Found" }));
    }
    route.fulfill(jsonReply(200, gistBody));
  });
  return { calls };
}

/** Sign in as `login` (if given), stub the gist API, open the gist page. */
async function openGist(page: Page, login?: string) {
  if (login) await seedToken(page, login);
  const stub = await stubGists(page);
  await page.goto(gistPath);
  await waitForCompileSuccess(page);
  return stub;
}

test("anonymous visitor loads a gist URL, unauthenticated", async ({
  page,
}) => {
  const { calls } = await openGist(page);

  const sources = await readEditorSources(page);
  expect(Object.keys(sources).sort()).toEqual([
    "package::main",
    "package::util",
  ]);
  expect(sources["package::main"]).toContain("// GIST-FIXTURE");

  expect((await page.textContent(".title"))?.trim()).toBe("loaded-fixture");
  expect(new URL(page.url()).pathname).toBe(gistPath);

  // One tokenless GET: a shared link has to open for a visitor who never
  // signed in, so the load path must not require (or invent) credentials.
  expect(calls).toHaveLength(1);
  expect(calls[0].method()).toBe("GET");
  expect(calls[0].url()).toBe(gistUrl);
  expect((await calls[0].allHeaders()).authorization).toBeUndefined();
});

test("owner's Save patches the loaded gist", async ({ page }) => {
  const { calls } = await openGist(page, "octocat");

  const save = page.locator(".save-btn");
  await expect(save).toHaveText("Save");
  await expect(page.locator(".gist-chip")).toHaveText(gistPath);

  await save.click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].method()).toBe("PATCH");
  expect(calls[1].url()).toBe(gistUrl);
});

test("visitor forks someone else's gist into their own", async ({ page }) => {
  const { calls } = await openGist(page, "visitor");

  const fork = page.locator(".save-btn");
  await expect(fork).toHaveText("Fork");
  // No chip yet: it links the gist a save writes to, and the visitor has none
  // until their fork lands.
  await expect(page.locator(".gist-chip")).toHaveCount(0);

  await fork.click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].method()).toBe("POST");
  expect(calls[1].url()).toBe(gistsUrl);
  const sent = calls[1].postDataJSON();
  expect(sent.files["main.wesl"].content).toContain("// GIST-FIXTURE");

  const forkPath = `/gist/visitor/${forkId}`;
  await expect.poll(() => new URL(page.url()).pathname).toBe(forkPath);
  await expect(page.locator(".gist-chip")).toHaveText(forkPath);
  // The success flash reports the action that ran, even though the fork's
  // gist now exists (which is what makes the NEXT save a plain Save).
  await expect(fork).toHaveText("Forked");
});

test("a crafted gist id can't steer an authenticated request", async ({
  page,
}) => {
  await seedToken(page, "octocat");
  await stubGists(page, { getStatus: 404 });
  const apiRequests: string[] = [];
  page.on("request", req => {
    if (req.url().startsWith("https://api.github.com/"))
      apiRequests.push(req.url());
  });

  // Un-encoded, `..%2F..%2Fuser` would decode to `../../user` and the fetch
  // would normalize to GET api.github.com/user with the Bearer token attached.
  await page.goto("/gist/x/..%2F..%2Fuser");
  await waitForCompileSuccess(page);

  expect(new URL(page.url()).pathname).toBe("/");
  expect(apiRequests.length).toBeGreaterThan(0);
  for (const url of apiRequests) {
    expect(url.startsWith("https://api.github.com/gists/")).toBe(true);
  }
});

test("a new tab inherits the last buffer but not its gist target", async ({
  page,
}) => {
  const { calls } = await openGist(page, "octocat");

  // A fresh tab has no session id but shares localStorage (the `last` mirror).
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/");
  await waitForCompileSuccess(page);

  const sources = await readEditorSources(page);
  expect(sources["package::main"]).toContain("// GIST-FIXTURE");

  // The buffer carried over, the write target must not: saving from a tab
  // whose URL never showed the gist creates a new one instead of patching.
  await expect(page.locator(".gist-chip")).toHaveCount(0);
  await page.locator(".save-btn").click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].method()).toBe("POST");
});

test("a missing gist falls back to the local editor with a message", async ({
  page,
}) => {
  await stubGists(page, { getStatus: 404 });
  await page.goto("/gist/octocat/missing");
  await waitForCompileSuccess(page);

  const error = page.locator(".load-error");
  await expect(error).toContainText("doesn't exist");
  expect(new URL(page.url()).pathname).toBe("/");
  const sources = await readEditorSources(page);
  expect(sources["package::main"]).toContain("import package::util::gradient");

  await error.locator("button").click();
  await expect(error).toHaveCount(0);
});

test("reload keeps edits made since the gist loaded", async ({ page }) => {
  const { calls } = await openGist(page, "octocat");

  const marker = "// POST-LOAD-EDIT";
  await editAndAutosave(
    page,
    `${marker}\n@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }\n`,
  );

  await page.reload();
  await waitForCompileSuccess(page);

  const sources = await readEditorSources(page);
  expect(Object.values(sources).join("\n")).toContain(marker);
  expect(calls).toHaveLength(1); // the published copy was not re-fetched

  // The gist identity survived the reload, so a save still updates it.
  await page.locator(".save-btn").click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].method()).toBe("PATCH");
  expect(calls[1].url()).toBe(gistUrl);
});

test("signed-out Save on a gist page returns there and patches", async ({
  page,
}) => {
  const { calls } = await stubGists(page);
  await stubOAuth(page, "octocat");
  // Signing in navigates away to github.com; stand in for GitHub below by
  // loading the callback URL ourselves.
  await blockGitHubNav(page);
  const writes = await captureSessionWrites(page);

  await page.goto(gistPath);
  await waitForCompileSuccess(page);

  const navPromise = authorizeRequest(page);
  await page.locator(".save-btn").click();
  await navPromise;
  expect(writes[returnPathKey]).toBe(gistPath);

  await page.goto(`/auth/callback?code=c&state=${writes[csrfKey]}`);
  await page.waitForURL(`**${gistPath}`);
  await waitForCompileSuccess(page);

  // What the return path buys: the resumed save PATCHes the gist the user was
  // looking at. Coming back to / instead would POST a duplicate copy, so a
  // stray POST here is the failure being watched for.
  await expect.poll(() => calls.length).toBe(2);
  expect(calls.map(c => c.method())).toEqual(["GET", "PATCH"]);
  expect(calls[1].url()).toBe(gistUrl);
});
