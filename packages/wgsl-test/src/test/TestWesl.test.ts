import { afterAll, beforeAll, expect, test } from "vitest";
import { expectWesl, runWesl } from "../TestWesl.ts";
import { destroySharedDevice, getGPUDevice } from "../WebGPUTestSetup.ts";
import { loadFixture } from "./TestSupport.ts";

let device: GPUDevice;

beforeAll(async () => {
  device = await getGPUDevice();
});

afterAll(() => {
  destroySharedDevice();
});

test("passing test with expect()", async () => {
  const src = loadFixture("passing_expect.wesl");
  const results = await runWesl({ device, src });
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe("checkTrue");
  expect(results[0].passed).toBe(true);
});

test("failing test with expect()", async () => {
  const src = loadFixture("failing_expect.wesl");
  const results = await runWesl({ device, src });
  expect(results).toHaveLength(1);
  expect(results[0].passed).toBe(false);
});

test("passing test with expectNear()", async () => {
  const src = loadFixture("passing_near.wesl");
  const results = await runWesl({ device, src });
  expect(results).toHaveLength(1);
  expect(results[0].passed).toBe(true);
});

test("failing test with expectNear() reports actual and expected", async () => {
  const src = loadFixture("failing_near.wesl");
  const results = await runWesl({ device, src });
  expect(results).toHaveLength(1);
  expect(results[0].passed).toBe(false);
  expect(results[0].actual?.[0]).toBeCloseTo(1.0);
  expect(results[0].expected?.[0]).toBeCloseTo(2.0);
});

test("failing assertion values survive later passing assertions", async () => {
  const src = loadFixture("first_failure.wesl");
  const results = await runWesl({ device, src });
  expect(results).toHaveLength(1);
  expect(results[0].passed).toBe(false);
  expect(results[0].actual?.[0]).toBeCloseTo(1.0);
  expect(results[0].expected?.[0]).toBeCloseTo(5.0);
});

test("failCount counts every failed assertion", async () => {
  const src = loadFixture("fail_count.wesl");
  const results = await runWesl({ device, src });
  expect(results).toHaveLength(1);
  expect(results[0].passed).toBe(false);
  expect(results[0].failCount).toBe(3);
  expect(results[0].actual?.[0]).toBeCloseTo(1.0);
  expect(results[0].expected?.[0]).toBeCloseTo(5.0);
});

test("expectWesl reports the failed assertion count", async () => {
  const src = loadFixture("fail_count.wesl");
  await expect(expectWesl({ device, src })).rejects.toThrow(
    "first of 3 failed assertions",
  );
});

test("multiple @test functions in one module", async () => {
  const src = loadFixture("multiple_tests.wesl");
  const results = await runWesl({ device, src });
  expect(results).toHaveLength(3);
  expect(results[0].name).toBe("first");
  expect(results[0].passed).toBe(true);
  expect(results[1].name).toBe("second");
  expect(results[1].passed).toBe(false);
  expect(results[2].name).toBe("third");
  expect(results[2].passed).toBe(true);
});

test("no @test functions returns empty array", async () => {
  const src = loadFixture("no_tests.wesl");
  const results = await runWesl({ device, src });
  expect(results).toHaveLength(0);
});

test("expectEq passes for equal values", async () => {
  const src = loadFixture("expect_eq.wesl");
  const results = await runWesl({ device, src });
  const equalResult = results.find(r => r.name === "equalInts");
  expect(equalResult?.passed).toBe(true);
});

test("expectEq fails for different values", async () => {
  const src = loadFixture("expect_eq.wesl");
  const results = await runWesl({ device, src });
  const unequalResult = results.find(r => r.name === "unequalInts");
  expect(unequalResult?.passed).toBe(false);
});

test("expectWesl passes when all tests pass", async () => {
  const src = loadFixture("passing_expect.wesl");
  await expectWesl({ device, src }); // should not throw
});

test("expectWesl throws on failure with details", async () => {
  const src = loadFixture("failing_near.wesl");
  await expect(expectWesl({ device, src })).rejects.toThrow(
    "WESL tests failed",
  );
});

test("passing test with expectUlp()", async () => {
  const src = loadFixture("passing_ulp.wesl");
  const results = await runWesl({ device, src });
  expect(results).toHaveLength(2);
  expect(results.every(r => r.passed)).toBe(true);
});

test("failing test with expectUlp()", async () => {
  const src = loadFixture("failing_ulp.wesl");
  const results = await runWesl({ device, src });
  expect(results).toHaveLength(1);
  expect(results[0].passed).toBe(false);
});

test("expectUlp counts representable floats across zero", async () => {
  const src = loadFixture("ulp_across_zero.wesl");
  const results = await runWesl({ device, src });
  const within = results.find(r => r.name === "ulpAcrossZeroWithin");
  const tooFar = results.find(r => r.name === "ulpAcrossZeroTooFar");
  expect(within?.passed).toBe(true);
  expect(tooFar?.passed).toBe(false);
});
