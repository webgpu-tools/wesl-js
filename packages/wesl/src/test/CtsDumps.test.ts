import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * The offline CTS oracles read dumps checked into the cts fork under dumps/,
 * versioned with the src/ tree they derive from. Each dump stamps that tree hash
 * into its manifest; this guard pins the stamp to the live submodule's HEAD:src,
 * so a submodule bump without a matching regen fails here instead of silently
 * testing stale data. The readers themselves stay lenient (a missing dump falls
 * back to the keep-set), so this is the loud backstop.
 */

const ctsDir = path.resolve(import.meta.dirname, "../../../../cts");
const dumpsDir = path.join(ctsDir, "dumps");

const dumps = [
  ["cases", "pnpm --filter wesl dump:cts:cases"],
  ["shaders", "pnpm --filter wesl dump:cts:shaders (needs a GPU)"],
] as const;

for (const [name, regen] of dumps) {
  test(`cts ${name} dump matches the submodule src tree`, () => {
    const tree = srcTree(); // throws an actionable message if cts/ is absent
    const manifestPath = path.join(dumpsDir, name, "manifest.json");
    expect(
      existsSync(manifestPath),
      `missing ${manifestPath}\nregenerate with '${regen}'`,
    ).toBe(true);
    const { sourceTree } = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(
      sourceTree,
      `cts/dumps/${name} is stale; regenerate with '${regen}'`,
    ).toBe(tree);
  });
}

/** The src tree the live cts submodule currently has checked out. */
function srcTree(): string {
  try {
    const out = execFileSync("git", ["-C", ctsDir, "rev-parse", "HEAD:src"], {
      encoding: "utf8",
    });
    return out.trim();
  } catch {
    throw new Error(
      `cannot read the cts submodule at ${ctsDir}\n` +
        "run 'git submodule update --init' to check it out",
    );
  }
}
