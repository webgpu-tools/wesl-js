/// <reference types="wesl-plugin/suffixes" />
import {
  createShaderModule,
  type LinkedWesl,
  link,
  requestWeslDevice,
} from "wesl";
import appWesl from "../shaders/app.wesl?link";

main();

async function main(): Promise<void> {
  const linked = await link(appWesl);
  displayShaderCode(linked.dest);

  launchShader(linked);
}

function displayShaderCode(wgslSrc: string): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (app) {
    app.innerHTML = `<pre>${wgslSrc}<pre>`;
  }
}

async function launchShader(linked: LinkedWesl): Promise<void> {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await requestWeslDevice(adapter);
  const module = createShaderModule(linked, device, {});

  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module },
  });

  const commands = device.createCommandEncoder();
  const pass = commands.beginComputePass();
  pass.setPipeline(pipeline);
  pass.dispatchWorkgroups(1, 1, 1);
  pass.end();
  device.queue.submit([commands.finish()]);
}
