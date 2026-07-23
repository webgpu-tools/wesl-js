import { statSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { waitForCompileSuccess } from "./E2eUtil.ts";

test("Export PNG downloads the current frame", async ({ page }) => {
  await page.goto("/");
  await waitForCompileSuccess(page);

  const downloadPromise = page.waitForEvent("download");
  await page.locator(".export-png").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]+\.png$/); // title slug
  const path = await download.path();
  // The cheapest proof the canvas was really read back: a blank or failed
  // capture lands far under.
  expect(statSync(path).size).toBeGreaterThan(500);
});
