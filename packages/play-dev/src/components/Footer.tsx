import { useEffect, useRef, useState } from "preact/hooks";
import type { SaveOutcome, SaveStatus } from "../lib/Save.ts";

type CopyStatus = "idle" | "copied" | "too-large" | "failed";
type PngStatus = "idle" | "no-frame" | "failed";

interface Props {
  /** A self-contained link to the shader; null if it won't fit in one. */
  buildShareUrl(): string | null;

  /** Download the current frame; false when there was no frame to capture. */
  exportPng(): Promise<boolean>;
  gist: SaveOutcome | null;
  saveStatus: SaveStatus;
}

/** Editor versions, the share and PNG buttons, and a link to the saved gist. */
export function Footer({ buildShareUrl, exportPng, gist, saveStatus }: Props) {
  const copy = useFlashStatus<CopyStatus>("idle");
  const png = useFlashStatus<PngStatus>("idle");

  async function copyLink() {
    const url = buildShareUrl();
    if (!url) {
      copy.flash("too-large", 2500);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      copy.flash("copied", 1500);
    } catch (e) {
      console.warn("clipboard write failed:", e);
      copy.flash("failed", 2500);
    }
  }

  async function downloadPng() {
    try {
      if (await exportPng()) return;
      png.flash("no-frame", 2500);
    } catch (e) {
      console.warn("png export failed:", e);
      png.flash("failed", 2500);
    }
  }

  const chipClass =
    saveStatus === "saved" ? "gist-chip gist-chip-flash" : "gist-chip";

  return (
    <footer class="footer">
      <span>Editor: {__EDITOR_VERSION__}</span>
      <span>·</span>
      <span>v{__WGSL_PLAY_VERSION__}</span>
      <span>·</span>
      <button type="button" class="copy-link" onClick={copyLink}>
        {copyLabel(copy.status)}
      </button>
      <span>·</span>
      <button type="button" class="copy-link export-png" onClick={downloadPng}>
        {pngLabel(png.status)}
      </button>
      {gist && (
        <a class={chipClass} href={gist.url}>
          {shortPath(gist.url)}
        </a>
      )}
    </footer>
  );
}

/** A status that reverts to idle after a delay. Re-flashing cancels the
 *  pending timer, so an earlier flash can't cut a later one short. */
function useFlashStatus<T>(idle: T) {
  const [status, setStatus] = useState(idle);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => clearReset, []);

  function flash(next: T, durationMs: number) {
    clearReset();
    setStatus(next);
    reset.current = setTimeout(() => {
      reset.current = null;
      setStatus(idle);
    }, durationMs);
  }

  function clearReset() {
    if (reset.current === null) return;
    clearTimeout(reset.current);
    reset.current = null;
  }

  return { status, flash };
}

function copyLabel(status: CopyStatus): string {
  if (status === "copied") return "Copied";
  if (status === "too-large") return "Too large to share";
  if (status === "failed") return "Copy failed";
  return "Copy link";
}

function pngLabel(status: PngStatus): string {
  if (status === "no-frame") return "No frame to export";
  if (status === "failed") return "Export failed";
  return "Export PNG";
}

/** Show a saved gist URL as its path (`/gist/user/hash`) for a compact chip. */
function shortPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
