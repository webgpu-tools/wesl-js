export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface Props {
  status: SaveStatus;
  onSave(): void;
}

export function SaveButton({ status, onSave }: Props) {
  return (
    <button
      type="button"
      class="save-btn"
      onClick={onSave}
      disabled={status === "saving"}
      aria-label="Save shader to a GitHub gist"
    >
      {label(status)}
    </button>
  );
}

function label(status: SaveStatus): string {
  if (status === "saving") return "Saving...";
  if (status === "saved") return "Saved";
  if (status === "error") return "Save failed";
  return "Save";
}
