/// <reference types="wesl-plugin/suffixes" />

import { beforeAll, expect, test } from "vitest";
import { link } from "wesl";
import { trimSrc } from "wesl/test-util";

let gpu: GPU;

beforeAll(async () => {
  const webgpu = await import("webgpu");
  Object.assign(globalThis, (webgpu as any).globals); // LATER fix types upstream in webgpu package
  gpu = webgpu.create([]);
});

test("gpu execution w/?link", async () => {
  const adapter = await gpu.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    expect(device).toBeDefined();
    return;
  }

  // import dynamically, so that import comes after globalThis has GPUShaderStage
  const linkParams = (await import("./shaders/main.wesl?link")).default;
  const code = (await link(linkParams)).dest;

  device.createShaderModule({ code }); // verify works for webgpu

  expect(trimSrc(code)).toMatchInlineSnapshot(`
    "@group(0) @binding(0) var<uniform> u: Uniforms;
    @compute @workgroup_size(1) fn main() { }
    struct Uniforms { foo: u32 }"
  `);
});
