import {
  type AutosaveSnapshot,
  allocateSlot,
  getOrCreateSessionId,
  getSessionId,
  readLast,
  readSlot,
  setSessionId,
  sweepOldSlots,
  writeSlot,
} from "./Autosave.ts";
import { randomTitle } from "./RandomTitle.ts";
import { decodeFragment } from "./Share.ts";
import { starterProject } from "./StarterShader.ts";

export type StateSource = "url" | "tab" | "last" | "starter";

/** Editor snapshot to load on startup, with provenance for telemetry/UX. */
export interface InitialState {
  /** Autosave slot id owned by this tab. */
  sessionId: string;

  /** Project source plus title and savedAt timestamp. */
  snapshot: AutosaveSnapshot;

  /** Which resolution path produced this state. */
  source: StateSource;
}

/**
 * Determine the initial editor buffer.
 * Priority: shared URL fragment > tab's existing slot > most-recent slot > starter shader.
 */
export function resolveInitialState(): InitialState {
  sweepOldSlots();

  const fromUrl = decodeFragment(location.hash);
  if (fromUrl) {
    const snapshot: AutosaveSnapshot = { ...fromUrl, savedAt: Date.now() };
    const sessionId = allocateSlot(snapshot);
    setSessionId(sessionId);
    history.replaceState(null, "", location.pathname + location.search);
    return { sessionId, snapshot, source: "url" };
  }

  const existing = getSessionId();
  if (existing) {
    const snapshot = readSlot(existing);
    if (snapshot) return { sessionId: existing, snapshot, source: "tab" };
  }

  const last = readLast();
  if (last) {
    const sessionId = allocateSlot(last);
    setSessionId(sessionId);
    return { sessionId, snapshot: last, source: "last" };
  }

  const snapshot: AutosaveSnapshot = {
    project: starterProject,
    title: randomTitle(),
    savedAt: Date.now(),
  };
  const sessionId = getOrCreateSessionId();
  writeSlot(sessionId, snapshot);
  return { sessionId, snapshot, source: "starter" };
}
