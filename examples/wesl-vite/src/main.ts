/// <reference types="wesl-plugin/suffixes" />
import { createShaderModule, link } from "wesl";
import mainWesl from "../shaders/main.wesl?link";

const app = document.getElementById("app")!;
const canvas = document.createElement("canvas");
canvas.style.width = "80vmin";
canvas.style.height = "80vmin";
app.append(canvas);

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();

if (device === undefined) {
  app.append(document.createTextNode("WebGPU not available!"));
  throw new Error("WebGPU not available");
}

const linked = await link({ ...mainWesl, conditions: { DEBUG: true } });
const shader = createShaderModule(linked, device, {});
const context = canvas.getContext("webgpu")!;

const devicePixelRatio = window.devicePixelRatio;
canvas.width = canvas.clientWidth * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;
const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

context.configure({
  device,
  format: presentationFormat,
});

const pipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: shader,
    entryPoint: "vs_main",
  },
  fragment: {
    module: shader,
    entryPoint: "fs_main",
    targets: [{ format: presentationFormat }],
  },
  primitive: {
    topology: "triangle-list",
  },
});

function render() {
  const encoder = device.createCommandEncoder();
  const passEncoder = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: [0, 0, 0, 1],
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  passEncoder.setPipeline(pipeline);
  passEncoder.draw(6); // for the fullscreen quad
  passEncoder.end();
  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
