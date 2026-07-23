import { slug } from "./Gist.ts";
import { captureFrameBlob } from "./Thumbnail.ts";

/** Download the current frame as a PNG named after the shader title; false when
 *  no frame is available (compile error, compute mode, GPU unavailable). */
export async function exportPng(title: string): Promise<boolean> {
  const blob = await captureFrameBlob();
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug(title)}.png`;
  link.click();
  // Revoke on a delay, not synchronously: browsers that dereference the blob
  // URL after click dispatch (WebKit, Firefox) would drop the download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}
