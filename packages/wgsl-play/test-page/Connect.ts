import type { WgslEdit } from "../../wgsl-edit/src/WgslEdit.ts";
import type { WgslPlay } from "../src/index.ts";
import { expose } from "./Shared.ts";

const multifilePlayer = document.querySelector<WgslPlay>("#multifilePlayer")!;
const multifileEditor = document.querySelector<WgslEdit>("#multifileEditor")!;

const connectCondPlayer =
  document.querySelector<WgslPlay>("#connectCondPlayer")!;
const connectCondEditor =
  document.querySelector<WgslEdit>("#connectCondEditor")!;
const setConnectRed =
  document.querySelector<HTMLButtonElement>("#set-connect-red")!;
let connectRed = false;
setConnectRed.addEventListener("click", () => {
  connectRed = !connectRed;
  connectCondEditor.conditions = { RED: connectRed };
  setConnectRed.textContent = connectRed
    ? "Unset RED condition"
    : "Set RED condition";
});

const connectExtPlayer = document.querySelector<WgslPlay>("#connectExtPlayer")!;
const connectExtEditor = document.querySelector<WgslEdit>("#connectExtEditor")!;

const dynamicNpmPlayer = document.querySelector<WgslPlay>("#dynamicNpmPlayer")!;
const dynamicNpmEditor = document.querySelector<WgslEdit>("#dynamicNpmEditor")!;
document.querySelector("#inject-dynamic-npm")!.addEventListener("click", () => {
  dynamicNpmEditor.source = `import env::u;

@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let seed = vec2u(u32(pos.x), u32(pos.y));
  let color = random_wgsl::pcg_2u_3f(seed);
  return vec4f(color, 1.0);
}`;
});

const virtualLibsEditor =
  document.querySelector<WgslEdit>("#virtualLibsEditor")!;
const envSrc = `
  struct Uniforms { resolution: vec2f, time: f32, mouse: vec2f }
  @group(0) @binding(0) var<uniform> u: Uniforms;
`;
const virtualLibsOutput = document.querySelector("#virtual-libs-output")!;
document
  .querySelector("#link-virtual-libs")!
  .addEventListener("click", async () => {
    try {
      const wgsl = await virtualLibsEditor.link({
        virtualLibs: { env: () => envSrc },
      });
      virtualLibsOutput.textContent = wgsl;
    } catch (e) {
      virtualLibsOutput.textContent = `Error: ${e}`;
    }
  });

expose({
  multifilePlayer,
  multifileEditor,
  connectCondPlayer,
  connectCondEditor,
  connectExtPlayer,
  connectExtEditor,
  dynamicNpmPlayer,
  dynamicNpmEditor,
  virtualLibsEditor,
});
