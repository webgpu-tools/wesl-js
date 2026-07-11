import { useEffect, useRef, useState } from "preact/hooks";
import { startSignIn } from "../auth/Authorize.ts";
import { readGitHubAuth } from "../auth/GitHubAuth.ts";
import {
  markPendingSave,
  type SaveOutcome,
  type SaveStatus,
  saveGist,
  takePendingSave,
} from "./Save.ts";
import type { ShaderDocument } from "./Share.ts";

export interface GistSaveState {
  status: SaveStatus;
  gist: SaveOutcome | null;
}

/**
 * Coordinate gist saves and expose their complete UI state.
 *
 * `snapshotDocument` returns the current editor document and, as a side effect,
 * persists it to the session slot, so a live edit survives the sign-in reload
 * when a signed-out Save redirects to OAuth.
 */
export function useGistSave(snapshotDocument: () => ShaderDocument) {
  const initial: GistSaveState = { status: "idle", gist: null };
  const [state, setState] = useState(initial);
  const stateRef = useRef(initial);
  const snapshotRef = useRef(snapshotDocument);
  const saveInFlight = useRef(false);
  const statusReset = useRef<ReturnType<typeof setTimeout> | null>(null);
  snapshotRef.current = snapshotDocument;

  // Resume a save interrupted by sign-in, consuming abandoned attempts too.
  useEffect(() => {
    if (takePendingSave() && readGitHubAuth()) void save();
    return clearStatusReset;
  }, []);

  async function save() {
    if (saveInFlight.current) return;
    const auth = readGitHubAuth();
    if (!auth) {
      snapshotRef.current(); // flush the live edit before the sign-in reload
      markPendingSave();
      startSignIn();
      return;
    }
    saveInFlight.current = true;
    clearStatusReset();
    update({ status: "saving", gist: stateRef.current.gist });
    try {
      const gist = await saveGist({
        auth,
        payload: snapshotRef.current(),
        gist: stateRef.current.gist,
      });
      history.replaceState(null, "", `/gist/${gist.owner}/${gist.id}`);
      flash({ status: "saved", gist }, 1800);
    } catch (e) {
      console.warn("gist save failed:", e);
      flash({ status: "error", gist: stateRef.current.gist }, 2500);
    } finally {
      saveInFlight.current = false;
    }
  }

  function flash(next: GistSaveState, durationMs: number) {
    update(next);
    statusReset.current = setTimeout(() => {
      statusReset.current = null;
      update({ status: "idle", gist: stateRef.current.gist });
    }, durationMs);
  }

  function update(next: GistSaveState) {
    stateRef.current = next;
    setState(next);
  }

  function clearStatusReset() {
    if (statusReset.current === null) return;
    clearTimeout(statusReset.current);
    statusReset.current = null;
  }

  return { state, save };
}
