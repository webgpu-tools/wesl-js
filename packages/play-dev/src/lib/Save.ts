/**
 * Orchestrate a save: capture a thumbnail, compose the gist payload, then
 * create or update the gist. A `pending-save` flag bridges the OAuth redirect
 * so a Save clicked while signed out resumes automatically after sign-in.
 */

import { isWeslFile } from "wesl";
import type { GitHubAuth } from "../auth/GitHubAuth.ts";
import {
  buildGistFiles,
  type GistChanges,
  type GistFiles,
  gistPath,
} from "./Gist.ts";
import { createGist, updateGist } from "./GitHub.ts";
import type { ShaderDocument } from "./Share.ts";
import { captureThumbnail } from "./Thumbnail.ts";

/**
 * The gist backing the current buffer: its identity plus the files it holds
 * (so a later save can delete the ones the user removed). Persisted alongside
 * the buffer, so a reload knows which gist to update.
 */
export interface GistRef {
  id: string;
  owner: string;
  fileNames: string[];
}

/** A gist reference plus the in-app share URL. */
export interface SaveOutcome extends GistRef {
  url: string;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Fork saves someone else's shader as a copy under the visitor's account. */
export type SaveAction = "Save" | "Fork";

interface SaveArgs {
  auth: GitHubAuth;
  doc: ShaderDocument;

  /** The gist to update, or null to create one (a first save, or a fork). */
  gist: SaveOutcome | null;
}

/** Capture a thumbnail and create or update the gist for the current buffer. */
export async function saveGist(args: SaveArgs): Promise<SaveOutcome> {
  const { auth, doc, gist } = args;
  const wgslPlayVersion = __WGSL_PLAY_VERSION__;
  const thumbnailBase64 = (await captureThumbnail()) ?? undefined;
  const files = buildGistFiles(doc, { wgslPlayVersion, thumbnailBase64 });
  const description = doc.title;
  const saved = gist
    ? await updateGist(auth, gist.id, {
        description,
        files: fileChanges(files, gist.fileNames),
      })
    : await createGist(auth, { description, files });
  return saveOutcome({ ...saved, fileNames: Object.keys(files) });
}

export const pendingSaveKey = "wgsl-play.pending-save";

/** Attach the site's share URL to a gist reference. */
export function saveOutcome(ref: GistRef): SaveOutcome {
  return { ...ref, url: `${location.origin}${gistPath(ref)}` };
}

/** Drop the derived URL, leaving only what is worth persisting. */
export function gistRef({ id, owner, fileNames }: SaveOutcome): GistRef {
  return { id, owner, fileNames };
}

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

/**
 * Null out the shader files removed since the previous save (the gists API
 * deletes a file by a null entry). Only shader source: the rest of the gist is
 * not ours to remove. So a file added on GitHub survives an app save, and so
 * does the previous thumbnail when this save had no frame to capture (compile
 * error, compute shader) - both of which a plain "not in the new file map" rule
 * would delete.
 */
function fileChanges(files: GistFiles, previous: string[]): GistChanges {
  const deleted = previous
    .filter(name => isWeslFile(name) && !(name in files))
    .map(name => [name, null] as const);
  return { ...files, ...Object.fromEntries(deleted) };
}
