/**
 * Orchestrate a save: capture a thumbnail, compose the gist payload, then
 * create or update the gist. A `pending-save` flag bridges the OAuth redirect
 * so a Save clicked while signed out resumes automatically after sign-in.
 */

import type { GitHubAuth } from "../auth/GitHubAuth.ts";
import { buildGistFiles } from "./Gist.ts";
import { createGist, updateGist } from "./GitHub.ts";
import type { ShaderDocument } from "./Share.ts";
import { captureThumbnail } from "./Thumbnail.ts";

/** A completed save: gist identity plus the in-app share URL. */
export interface SaveOutcome {
  id: string;
  owner: string;
  url: string;
}

interface SaveArgs {
  auth: GitHubAuth;
  payload: ShaderDocument;
  gistId: string | null;
}

/** Capture a thumbnail and create or update the gist for the current buffer. */
export async function saveGist(args: SaveArgs): Promise<SaveOutcome> {
  const { auth, payload, gistId } = args;
  const thumbnail = await captureThumbnail();
  const files = buildGistFiles(payload, thumbnail ?? undefined);
  const body = { description: payload.title, files };
  const saved = gistId
    ? await updateGist(auth, gistId, body)
    : await createGist(auth, body);
  const url = `${location.origin}/gist/${saved.owner}/${saved.id}`;
  return { ...saved, url };
}

export const pendingSaveKey = "wgsl-play.pending-save";

/** Mark that a save should resume once the OAuth redirect returns. */
export function markPendingSave(): void {
  sessionStorage.setItem(pendingSaveKey, "1");
}

/** Read and clear the pending-save flag. */
export function takePendingSave(): boolean {
  const pending = sessionStorage.getItem(pendingSaveKey) === "1";
  sessionStorage.removeItem(pendingSaveKey);
  return pending;
}
