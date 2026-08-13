/* eslint-disable */
// @ts-nocheck (ts isn't setup for deno)
import { createCapture } from "@std/webgpu/create-capture";
import { getRowPadding } from "@std/webgpu/row-padding";
import { encode as encodePng } from "png";
import { createShaderModule, link } from "wesl";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();

const dimensions = {
  width: 200,
  height: 200,
};

const { padded, unpadded } = getRowPadding(dimensions.width);

const { texture, outputBuffer } = createCapture(
  device,
  dimensions.width,
  dimensions.height,
);

const linked = await link({
  weslSrc: {
    "main.wesl": await Deno.readTextFile("./shaders/main.wesl"),
    "fullscreen_quad.wesl": await Deno.readTextFile(
      "./shaders/fullscreen_quad.wesl",
    ),
    "mandelbrot.wesl": await Deno.readTextFile("./shaders/mandelbrot.wesl"),
  },
});
const shader = createShaderModule(linked, device, {});

const pipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: shader,
    entryPoint: "vs_main",
  },
  fragment: {
    module: shader,
    entryPoint: "fs_main",
    targets: [{ format: "rgba8unorm-srgb" }],
  },
  primitive: {
    topology: "triangle-list",
  },
});

const encoder = device.createCommandEncoder();
const passEncoder = encoder.beginRenderPass({
  colorAttachments: [
    {
      view: texture.createView(),
      clearValue: [0, 0, 0, 1],
      loadOp: "clear",
      storeOp: "store",
    },
  ],
});
passEncoder.setPipeline(pipeline);
passEncoder.draw(6); // for the fullscreen quad
passEncoder.end();

encoder.copyTextureToBuffer(
  {
    texture,
  },
  {
    buffer: outputBuffer,
    bytesPerRow: padded,
  },
  dimensions,
);

device.queue.submit([encoder.finish()]);

// Save the buffer
await outputBuffer.mapAsync(GPUMapMode.READ);
const inputBuffer = new Uint8Array(outputBuffer.getMappedRange());
const imageBuffer = new Uint8Array(unpadded * dimensions.height);
for (let i = 0; i < dimensions.height; i++) {
  const slice = inputBuffer
    .slice(i * padded, (i + 1) * padded)
    .slice(0, unpadded);
  imageBuffer.set(slice, i * unpadded);
}
outputBuffer.unmap();

// Turn into PNG and save
const image = encodePng(imageBuffer, dimensions.width, dimensions.height, {
  stripAlpha: true,
  color: 2,
});
Deno.writeFileSync("./output.png", image);
