/// <reference types="wesl-plugin/suffixes" />
import type { WgslEdit } from "../../wgsl-edit/src/WgslEdit.ts";
import type { WgslPlay } from "../src/index.ts";
import { expose } from "./Shared.ts";
import mouseConfig from "./shaders/mouse.wesl?link";

const uniformsPlayer = document.querySelector<WgslPlay>("#uniformsPlayer")!;
uniformsPlayer.setUniform("brightness", 0.6);

// ?link bundles the shader at build time; load it into the editor, which the
// player connects to via `from` for live edits.
const mouseSource = document.querySelector<WgslEdit>("#mouseSource")!;
mouseSource.project = mouseConfig;
const mousePlayer = document.querySelector<WgslPlay>("#mousePlayer")!;

expose({ uniformsPlayer, mousePlayer, mouseSource, mouseConfig });
