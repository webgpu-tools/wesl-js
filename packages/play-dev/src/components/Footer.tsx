import { useState } from "preact/hooks";
import type { SaveOutcome, SaveStatus } from "../lib/Save.ts";

type Status = "idle" | "copied" | "too-large";

interface Props {
  buildShareUrl(): string | null;
  gist: SaveOutcome | null;
  saveStatus: SaveStatus;
}

/** Render editor versions and controls for copying or opening share links. */
export function Footer({ buildShareUrl, gist, saveStatus }: Props) {
  const [status, setStatus] = useState<Status>("idle");

  async function copyLink() {
    const url = buildShareUrl();
    if (!url) {
      setStatus("too-large");
      setTimeout(() => setStatus("idle"), 2500);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 1500);
    } catch (e) {
      console.warn("clipboard write failed:", e);
    }
  }

  return (
    <footer class="footer">
      <span>Editor: {__EDITOR_VERSION__}</span>
      <span>·</span>
      <span>v{__WGSL_PLAY_VERSION__}</span>
      <span>·</span>
      <button type="button" class="copy-link" onClick={copyLink}>
        {label(status)}
      </button>
      {gist && (
        <a
          class={`gist-chip${saveStatus === "saved" ? " gist-chip-flash" : ""}`}
          href={gist.url}
        >
          {shortPath(gist.url)}
        </a>
      )}
    </footer>
  );
}

function label(status: Status): string {
  if (status === "copied") return "Copied";
  if (status === "too-large") return "Too large to share";
  return "Copy link";
}

/** Show a saved gist URL as its path (`/gist/user/hash`) for a compact chip. */
function shortPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
