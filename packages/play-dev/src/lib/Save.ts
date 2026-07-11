/**
 * Orchestrate a save: capture a thumbnail, compose the gist payload, then
 * create or update the gist. A `pending-save` flag bridges the OAuth redirect
 * so a Save clicked while signed out resumes automatically after sign-in.
 */

import type { GitHubAuth } from "../auth/GitHubAuth.ts";
import { buildGistFiles, type GistChanges, type GistFiles } from "./Gist.ts";
import { createGist, updateGist } from "./GitHub.ts";
import type { ShaderDocument } from "./Share.ts";
import { captureThumbnail } from "./Thumbnail.ts";

/** A completed save: gist identity plus the in-app share URL. */
export interface SaveOutcome {
  id: string;
  owner: string;
  url: string;
  fileNames: string[];
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface SaveArgs {
  auth: GitHubAuth;
  payload: ShaderDocument;
  gist: SaveOutcome | null;
}

/** Capture a thumbnail and create or update the gist for the current buffer. */
export async function saveGist(args: SaveArgs): Promise<SaveOutcome> {
  const { auth, payload, gist } = args;
  const thumbnail = await captureThumbnail();
  const files = buildGistFiles(payload, {
    wgslPlayVersion: __WGSL_PLAY_VERSION__,
    thumbnailBase64: thumbnail ?? undefined,
  });
  const description = payload.title;
  const saved = gist
    ? await updateGist(auth, gist.id, {
        description,
        files: fileChanges(files, gist.fileNames),
      })
    : await createGist(auth, { description, files });
  const url = `${location.origin}/gist/${saved.owner}/${saved.id}`;
  return { ...saved, url, fileNames: Object.keys(files) };
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

/** Add explicit null entries for files removed since the previous save. */
function fileChanges(files: GistFiles, previous: string[]): GistChanges {
  const deleted = previous
    .filter(name => !(name in files))
    .map(name => [name, null] as const);
  return { ...files, ...Object.fromEntries(deleted) };
}
