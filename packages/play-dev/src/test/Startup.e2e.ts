import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { lastKey, slotPrefix } from "../lib/Autosave.ts";
import { encodeFragment } from "../lib/Share.ts";

const { editorVersion } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { editorVersion: string };

async function waitForCompileSuccess(page: Page, selector: string) {
  await page.waitForFunction(sel => {
    const el = document.querySelector(sel) as
      | (HTMLElement & { frameCount?: number })
      | null;
    return (el?.frameCount ?? 0) > 0;
  }, selector);
}

async function readEditorSources(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const el = document.querySelector("#editor") as
      | (HTMLElement & { sources?: Record<string, string> })
      | null;
    return el?.sources ?? {};
  });
}

test("starter loads and compiles", async ({ page }) => {
  await page.goto("/");
  await waitForCompileSuccess(page, "#player");

  const sources = await readEditorSources(page);
  expect(sources["package::main"]).toContain("import package::util::gradient");
  expect(sources["package::util"]).toBeTruthy();

  const footer = await page.textContent(".footer");
  expect(footer).toContain(`Editor: ${editorVersion}`);
  expect(footer).toMatch(/v\d/);

  const titleText = (await page.textContent(".title"))?.trim();
  expect(titleText?.length ?? 0).toBeGreaterThan(0);
});

test("fragment URL loads, compiles, and rotates the slot", async ({ page }) => {
  const fixturePayload = {
    project: {
      weslSrc: {
        "main.wesl": `// STARTUP-FIXTURE
import env::u;
@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u.resolution;
  return vec4f(uv, 0.5, 1.0);
}
`,
      },
      rootModuleName: "main",
    },
    title: "fixture-marker",
  };
  const fragment = encodeFragment(fixturePayload);
  const preseedKey = `${slotPrefix}preseed`;

  // Pre-seed an existing local slot so we can verify it isn't clobbered.
  await page.addInitScript(
    ({ preseedKey, lastKey }) => {
      const seed = {
        project: {
          weslSrc: { "main.wesl": "// PRE-SEED\n" },
          rootModuleName: "main",
        },
        title: "pre-seed",
        savedAt: Date.now() - 1000,
      };
      localStorage.setItem(preseedKey, JSON.stringify(seed));
      localStorage.setItem(lastKey, JSON.stringify(seed));
    },
    { preseedKey, lastKey },
  );

  await page.goto(`/${fragment}`);
  await waitForCompileSuccess(page, "#player");

  const sources = await readEditorSources(page);
  expect(sources["package::main"]).toContain("// STARTUP-FIXTURE");

  expect((await page.textContent(".title"))?.trim()).toBe("fixture-marker");

  expect(await page.evaluate(() => location.hash)).toBe("");

  const stored = await page.evaluate(prefix => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        out[key] = JSON.parse(localStorage.getItem(key) ?? "null");
      }
    }
    return out;
  }, slotPrefix);
  const preseed = stored[preseedKey] as { title: string };
  expect(preseed?.title).toBe("pre-seed");
  const newSlots = Object.entries(stored).filter(
    ([k, v]) =>
      k !== preseedKey &&
      k !== lastKey &&
      (v as { title: string }).title === "fixture-marker",
  );
  expect(newSlots.length).toBeGreaterThan(0);
});

test("startup sweeps stale slots and caps slot count", async ({ page }) => {
  await page.addInitScript(prefix => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const seed = (id: string, savedAt: number) => {
      localStorage.setItem(
        `${prefix}${id}`,
        JSON.stringify({
          project: {
            weslSrc: { "main.wesl": `// ${id}\n` },
            rootModuleName: "main",
          },
          title: id,
          savedAt,
        }),
      );
    };
    // 25 recent slots: fresh-0 newest, fresh-24 oldest. Cap is 20.
    for (let i = 0; i < 25; i++) seed(`fresh-${i}`, now - i * 1000);
    // One slot past the 30-day expiry.
    seed("stale", now - 31 * dayMs);
  }, slotPrefix);

  await page.goto("/");
  await waitForCompileSuccess(page, "#player");

  const seeded = await page.evaluate(prefix => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) keys.push(k.slice(prefix.length));
    }
    return keys;
  }, slotPrefix);

  expect(seeded).not.toContain("stale");
  expect(seeded).not.toContain("fresh-24");
  expect(seeded).toContain("fresh-0");
  const surviving = seeded.filter(k => k.startsWith("fresh-"));
  expect(surviving).toHaveLength(20);
});

test("localStorage round-trips an edit", async ({ page }) => {
  await page.goto("/");
  await waitForCompileSuccess(page, "#player");

  // Mutate the editor's source via its setter, then wait for the autosave
  // event before reloading.
  await page.evaluate(() => {
    const el = document.querySelector("#editor") as HTMLElement & {
      source: string;
    };
    return new Promise<void>(resolve => {
      el.addEventListener("autosave", () => resolve(), { once: true });
      el.source =
        "// EDIT-MARKER\n@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }\n";
    });
  });

  await page.reload();
  await waitForCompileSuccess(page, "#player");

  const sources = await readEditorSources(page);
  const concat = Object.values(sources).join("\n");
  expect(concat).toContain("// EDIT-MARKER");
});
