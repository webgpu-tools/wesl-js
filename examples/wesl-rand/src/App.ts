/// <reference types="wesl-plugin/suffixes" />
import type { SlIconButton } from "@shoelace-style/shoelace";
import rand from "random_wgsl";
import { createShaderModule, link } from "wesl";
import main from "../shaders/main.wgsl?link";
import type { Loopable } from "./Drawable.ts";
import { gpuDevice } from "./GpuUtil.ts";
import { wgslToHTML } from "./Highlight.ts";
import { gpuAnimation } from "./Shader.ts";
import { mapKeys } from "./Util.ts";

/** Wire up the html UI and install the demo WebGPU shader */
export async function startApp(
  canvas: HTMLCanvasElement,
  stopButton: HTMLButtonElement,
  srcPanel: HTMLDivElement,
): Promise<void> {
  const device = await gpuDevice();
  const linked = await link(main);
  const shaderModule = createShaderModule(linked, device, {});
  const animation = await gpuAnimation(device, canvas, shaderModule);

  const randFiles = mapKeys(rand.modules, s => "random_wgsl/" + s);
  const linkedSrc = { linked: linked.dest };
  const baseSrcs = { ...main.weslSrc, ...randFiles, ...linkedSrc };
  const srcs = mapKeys(baseSrcs, dropSuffix);

  srcPanel.innerHTML = makeSrcPanel(srcs);

  const buttonHandler = playPauseHandler(animation);
  stopButton.addEventListener("click", buttonHandler);
}

/** remove an optional file suffix from a string (e.g. 'foo.wesl' => 'foo') */
function dropSuffix(src: string): string {
  return src.replace(/\.\w+$/, "");
}

/** @return html for the tabs that display the source code */
function makeSrcPanel(srcs: Record<string, string>): string {
  const srcEntries = Object.entries(srcs);
  const srcTabs = srcEntries
    .map(([name]) => `<sl-tab slot="nav" panel="${name}">${name}</sl-tab>`)
    .join("\n");
  const srcPanels = srcEntries
    .map(
      ([name, src]) => `
      <sl-tab-panel name="${name}">
        <pre>
${wgslToHTML(src)}
        </pre>
      </sl-tab-panel>`,
    )
    .join("\n");

  const html = `
    <sl-tab-group placement="top">
      ${srcTabs}
      ${srcPanels}
    </sl-tab-group>`;

  return html;
}

type ButtonClickListener = (this: HTMLButtonElement, evt: MouseEvent) => void;

function playPauseHandler(loopable: Loopable): ButtonClickListener {
  return function buttonHandler(e: MouseEvent): void {
    const running = !loopable.running; // get the current looping state
    loopable.run(running);
    const button = e.target as SlIconButton;
    button.name = running ? "pause" : "play";
  };
}
