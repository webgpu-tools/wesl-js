import { readGitHubAuth } from "../auth/GitHubAuth.ts";
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
import { type GistRoute, gistPath, gistRoute, gistToDocument } from "./Gist.ts";
import { fetchGist, GistError, type SavedGist } from "./GitHub.ts";
import { randomTitle } from "./RandomTitle.ts";
import { decodeFragment, type ShaderDocument } from "./Share.ts";
import { starterProject } from "./StarterShader.ts";

/** The editor buffer to load on startup. */
export interface InitialState {
  /** Autosave slot id owned by this tab. */
  sessionId: string;

  snapshot: AutosaveSnapshot;

  /** Why a `/gist/` URL could not be loaded, when we fell back to local state. */
  loadError?: string;
}

/**
 * Determine the initial editor buffer.
 * Priority: shared URL fragment > gist URL > tab's existing slot >
 * most-recent slot > starter shader.
 *
 * The fragment outranks the gist path because Copy link on a `/gist/` page
 * shares the editor's *current* buffer as a fragment on that same path;
 * loading the published gist instead would silently drop the shared edits.
 */
export async function resolveInitialState(): Promise<InitialState> {
  sweepOldSlots();
  const shared = decodeFragment(location.hash);
  if (shared) return localState(shared);
  const route = gistRoute(location.pathname);
  return route ? gistState(route) : localState(null);
}

/** A fresh buffer: the starter shader under a random title. */
export function starterSnapshot(): AutosaveSnapshot {
  return { project: starterProject, title: randomTitle(), savedAt: Date.now() };
}

/**
 * Load the gist named by the URL. A tab that already holds a buffer for this
 * gist keeps it, so edits made after a save (or before a sign-in redirect)
 * survive a reload rather than being overwritten by the published copy.
 */
async function gistState(route: GistRoute): Promise<InitialState> {
  const local = tabStateForGist(route);
  if (local) return local;
  try {
    const gist = await fetchGist(route.id, readGitHubAuth());
    const doc = gistToDocument(gist);
    if (!doc) return gistFallback("That gist doesn't contain a shader.");
    const fileNames = Object.keys(gist.files);
    const snapshot: AutosaveSnapshot = {
      ...doc,
      title: doc.title || randomTitle(),
      savedAt: Date.now(),
      gist: { id: gist.id, owner: gist.owner, fileNames },
    };
    const sessionId = allocateSlot(snapshot);
    setSessionId(sessionId);
    canonicalizeOwner(gist, route);
    return { sessionId, snapshot };
  } catch (e) {
    console.warn("gist load failed:", e);
    return gistFallback(loadErrorMessage(e));
  }
}

/** Fall back to local state when a gist can't be loaded, clearing the `/gist/`
 *  URL that would otherwise promise a shader we aren't showing. A shared
 *  fragment can't be in play here: it would have outranked the gist route. */
function gistFallback(loadError: string): InitialState {
  const state = localState(null);
  history.replaceState(null, "", "/");
  return { ...state, loadError };
}

/** Resolve from the shared document, this tab's slot, the last slot, or the starter. */
function localState(shared: ShaderDocument | null): InitialState {
  if (shared) return sharedState(shared);
  return tabState() ?? lastState() ?? starterState();
}

/** Adopt a document decoded from a share fragment into a slot of this tab's own. */
function sharedState(shared: ShaderDocument): InitialState {
  const snapshot: AutosaveSnapshot = { ...shared, savedAt: Date.now() };
  const sessionId = allocateSlot(snapshot);
  setSessionId(sessionId);
  // Drop the fragment, and the `/gist/` path it may have ridden in on: the
  // buffer holds the sharer's edits, not that gist, and a reload of the bare
  // path would fetch the gist over them.
  const path = gistRoute(location.pathname) ? "/" : location.pathname;
  history.replaceState(null, "", path + location.search);
  return { sessionId, snapshot };
}

/** This tab's own buffer, restoring the editor across a reload. */
function tabState(): InitialState | null {
  const sessionId = getSessionId();
  if (!sessionId) return null;
  const snapshot = readSlot(sessionId);
  if (!snapshot) return null;
  return { sessionId, snapshot };
}

/** The most recent buffer from any tab, so a new tab opens where the user left
 *  off rather than on the starter. Copied into a slot this tab owns. */
function lastState(): InitialState | null {
  const last = readLast();
  if (!last) return null;
  // The buffer carries over but its gist ref does not: inheriting the write
  // target would arm Cmd+S in a fresh tab to silently update a gist whose URL
  // this tab never showed. Saving here creates a new gist instead.
  const { gist: _gist, ...snapshot } = last;
  const sessionId = allocateSlot(snapshot);
  setSessionId(sessionId);
  return { sessionId, snapshot };
}

/** First visit, or nothing left in storage: the starter shader. */
function starterState(): InitialState {
  const snapshot = starterSnapshot();
  const sessionId = getOrCreateSessionId();
  writeSlot(sessionId, snapshot);
  return { sessionId, snapshot };
}

/** This tab's own buffer, if it already mirrors the gist being opened. */
function tabStateForGist(route: GistRoute): InitialState | null {
  const sessionId = getSessionId();
  if (!sessionId) return null;
  const snapshot = readSlot(sessionId);
  if (!snapshot || snapshot.gist?.id !== route.id) return null;
  canonicalizeOwner(snapshot.gist, route);
  return { sessionId, snapshot };
}

/**
 * Replace an unverified owner in the URL with the one GitHub reported, so the
 * address bar can't misattribute the shader: any login in the path opens any
 * gist id, so `/gist/famous-person/{someone-elses-id}` would otherwise stand.
 * Both load paths need it - a tab that already mirrors the gist never refetches.
 * Only the URL is at stake: a save targets the gist by id, never by owner.
 */
function canonicalizeOwner(gist: SavedGist, route: GistRoute): void {
  if (!gist.owner || gist.owner === route.owner) return;
  history.replaceState(null, "", gistPath(gist) + location.search);
}

/** A one-line explanation of a failed gist load, shown in the editor. */
function loadErrorMessage(e: unknown): string {
  if (e instanceof DOMException && e.name === "TimeoutError") {
    return "GitHub isn't responding. Try again in a while.";
  }
  const status = e instanceof GistError ? e.status : 0;
  if (status === 404) return "That gist doesn't exist, or it isn't public.";
  if (status === 403 || status === 429) {
    return "GitHub rate limit reached. Sign in, or try again in a while.";
  }
  if (status) return `Could not load that gist (GitHub returned ${status}).`;
  return "Could not load that gist.";
}
