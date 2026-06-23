import process from "node:child_process";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import util from "node:util";
import { expect, test } from "vitest";

const exec = util.promisify((process as any).exec); // not sure why @types/node for child_process.exec is wrong (nodeExec vs exec)

const testDir = dirname(fileURLToPath(import.meta.url));

test("verify ?link", { timeout: 30000 }, async () => {
  // build test program
  const buildResult = await exec(`pnpm vite build`, {
    cwd: testDir,
  });
  const outFile = path.join("dist", "autoMain.cjs");
  if (buildResult.stderr) {
    console.error("buildResult.err", buildResult.stderr);
    console.log("buildResult.out", buildResult.stdout);
  }

  // run a test program that logs the ?link output to the console for verification
  const result = await exec(`pnpm node ${outFile}`, {
    cwd: testDir,
  });

  expect(result.stdout).toMatchInlineSnapshot(`
    "

    fn main() {
      toDep();
    }

    fn toDep() {
      dep();
    }

    fn dep() { }
    "
  `);
});
