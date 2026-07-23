import { expect, test } from "@playwright/test";

// The export button shares the .copy-link styling, so exclude it.
const copyButton = ".copy-link:not(.export-png)";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

// "Copied" fades back to idle on a timer. If a second copy doesn't cancel the
// first one's timer, that stale timer fires early and cuts the second flash
// short.
test("second Copy link keeps flashing past the first flash timeout", async ({
  page,
}) => {
  await page.goto("/");
  const copy = page.locator(copyButton);
  await expect(copy).toHaveText("Copy link");
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);

  await copy.click();
  await expect(copy).toHaveText("Copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain("#v1=");

  // Both clicks show the same label, so overwrite the clipboard between them:
  // the url reappearing proves the second click's flash timer is registered.
  await page.evaluate(() => navigator.clipboard.writeText("sentinel"));
  await page.clock.fastForward(1000);
  await copy.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(url);

  await page.clock.fastForward(1000); // past the first flash's 1500ms fade
  await expect(copy).toHaveText("Copied");
  await page.clock.fastForward(600); // the second flash fades 1500ms after its click
  await expect(copy).toHaveText("Copy link");
});
