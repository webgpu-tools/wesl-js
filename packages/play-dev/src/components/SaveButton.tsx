import type { SaveAction, SaveStatus } from "../lib/Save.ts";

interface Props {
  status: SaveStatus;
  onSave(): void;
  action?: SaveAction;
}

/** Save (or Fork) the shader to a gist, reporting the attempt in its label. */
export function SaveButton({ status, onSave, action = "Save" }: Props) {
  const ariaLabel =
    action === "Fork"
      ? "Fork this shader to a gist of your own"
      : "Save shader to a GitHub gist";

  return (
    <button
      type="button"
      class="save-btn"
      onClick={onSave}
      disabled={status === "saving"}
      aria-label={ariaLabel}
    >
      {label(status, action)}
    </button>
  );
}

function label(status: SaveStatus, action: SaveAction): string {
  const forking = action === "Fork";
  if (status === "saving") return forking ? "Forking..." : "Saving...";
  if (status === "saved") return forking ? "Forked" : "Saved";
  if (status === "error") return forking ? "Fork failed" : "Save failed";
  return action;
}
