import { useEffect, useRef, useState } from "preact/hooks";
import { startSignIn } from "../auth/Authorize.ts";
import { clearGitHubAuth, readGitHubAuth } from "../auth/GitHubAuth.ts";
import { gistPath } from "./Gist.ts";
import { GistError } from "./GitHub.ts";
import {
  markPendingSave,
  type SaveAction,
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

interface GistSaveOptions {
  /** Return the current editor document, persisting it to the session slot. */
  snapshot(): ShaderDocument;

  /** Gist to update, read once at mount. Null creates a new gist (a first save,
   *  or a fork of someone else's shader). */
  initialGist: SaveOutcome | null;

  /** The buffer came from someone else's gist, so a save that has no target
   *  yet creates a copy - a Fork. */
  forkOrigin: boolean;

  /** Record the gist identity with the buffer after a successful save. */
  onSaved(gist: SaveOutcome): void;

  /** The stored token was revoked or expired and has been cleared. */
  onAuthExpired(): void;
}

/** How long a save's outcome shows before returning to idle. An error lingers
 *  longer than a success: it carries a message worth reading. */
const savedFlashMs = 1800;
const errorFlashMs = 2500;

/** Coordinate gist saves and expose the save status plus the saved gist, which
 *  drive both the Save button and the footer's gist chip. */
export function useGistSave(options: GistSaveOptions) {
  const initial: GistSaveState = { status: "idle", gist: options.initialGist };
  const [state, setState] = useState(initial);
  const stateRef = useRef(initial);
  const optionsRef = useRef(options);
  const saveInFlight = useRef(false);
  const statusReset = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latched when a save starts: success flips state.gist truthy, which would
  // otherwise relabel a just-finished Fork as a plain Save mid-flash.
  const action = useRef<SaveAction>("Save");
  optionsRef.current = options;

  // Resume a save interrupted by sign-in. The flag is taken either way, so an
  // abandoned sign-in can't fire a save on some later, unrelated visit.
  useEffect(() => {
    if (takePendingSave() && readGitHubAuth()) void save();
    return clearStatusReset;
  }, []);

  async function save() {
    if (saveInFlight.current) return;
    const auth = readGitHubAuth();
    if (!auth) {
      optionsRef.current.snapshot(); // flush the live edit before the sign-in reload
      markPendingSave();
      startSignIn();
      return;
    }
    saveInFlight.current = true;
    clearStatusReset();
    const forking = optionsRef.current.forkOrigin && !stateRef.current.gist;
    action.current = forking ? "Fork" : "Save";
    update({ status: "saving", gist: stateRef.current.gist });
    try {
      const gist = await saveGist({
        auth,
        doc: optionsRef.current.snapshot(),
        gist: stateRef.current.gist,
      });
      optionsRef.current.onSaved(gist);
      history.replaceState(null, "", gistPath(gist) + location.search);
      flash({ status: "saved", gist }, savedFlashMs);
    } catch (e) {
      console.warn("gist save failed:", e);
      // A revoked or expired token can never save again: drop it so the next
      // Save restarts sign-in, and let the app show the signed-out state.
      if (e instanceof GistError && e.status === 401) {
        clearGitHubAuth();
        optionsRef.current.onAuthExpired();
      }
      flash({ status: "error", gist: stateRef.current.gist }, errorFlashMs);
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

  return { state, save, action: action.current };
}
