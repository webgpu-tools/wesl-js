/**
 * Capture a PNG thumbnail of the current render by driving the `<wgsl-play>`
 * element's `renderFrame()` hook and reading its canvas. Returns base64 (no
 * data-URL prefix) so it can ride along as gist text, or null when no frame is
 * available (compile error, compute mode, GPU unavailable).
 */

import type { WgslPlay } from "wgsl-play/element";

export async function captureThumbnail(): Promise<string | null> {
  const player = document.getElementById("player") as WgslPlay | null;
  if (!player) return null;
  try {
    await player.renderFrame();
  } catch {
    return null; // compile error, compute mode, or no GPU
  }
  const canvas = player.shadowRoot?.querySelector("canvas");
  if (!canvas) return null;
  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, "image/png"),
  );
  return blob ? blobToBase64(blob) : null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}
