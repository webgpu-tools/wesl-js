/**
 * Capture a PNG of the current render by driving the `<wgsl-play>` element's
 * `renderFrame()` hook and reading back its canvas.
 */

import type { WgslPlay } from "wgsl-play/element";

/** Render one frame as a PNG blob, or null when no frame is available. */
export async function captureFrameBlob(): Promise<Blob | null> {
  const player = document.getElementById("player") as WgslPlay | null;
  if (!player) return null;
  try {
    await player.renderFrame();
  } catch {
    return null; // compile error, compute mode, or no GPU
  }
  const canvas = player.shadowRoot?.querySelector("canvas");
  if (!canvas) return null;
  try {
    return await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, "image/png"),
    );
  } catch {
    return null; // a tainted canvas throws; the thumbnail is optional, the save is not
  }
}

/** Capture the current frame as base64 (no data-URL prefix) so it can ride
 *  along as gist text. */
export async function captureThumbnail(): Promise<string | null> {
  const blob = await captureFrameBlob();
  return blob ? blobToBase64(blob) : null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}
