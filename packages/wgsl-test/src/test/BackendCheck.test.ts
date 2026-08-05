import { expect, test } from "vitest";
import { getGPUAdapter, getGPUDevice, isDeno } from "../WebGPUTestSetup.ts";

/** Logs the adapter identity so CI runs record whether tests ran on real
 * hardware or a software rasterizer (e.g. SwiftShader reports vendor
 * "google", isFallbackAdapter true). */
test("check WebGPU backend", async () => {
  const device = await getGPUDevice();
  expect(device).toBeTruthy();

  const adapter = await getGPUAdapter();
  const { info } = adapter;
  const backend = isDeno ? "wgpu (Deno native)" : "Dawn (Node webgpu package)";
  console.log("==> Backend:", backend);
  console.log("==> Adapter vendor:", info.vendor);
  console.log("==> Adapter architecture:", info.architecture);
  console.log("==> Adapter device:", info.device);
  console.log("==> Adapter description:", info.description);
  console.log("==> Fallback adapter (software):", info.isFallbackAdapter);
  console.log("==> Subgroups feature:", adapter.features.has("subgroups"));
});
