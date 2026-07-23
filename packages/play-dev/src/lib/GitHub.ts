/**
 * Thin GitHub gists API client. Creates, updates and fetches public gists.
 * Writes need the bearer token (the OAuth token held in localStorage); reads
 * work without one, so anonymous visitors can open shared links. Throws
 * `GistError` on non-2xx so callers have a single failure path.
 */

import { isWeslFile } from "wesl";
import type { GitHubAuth } from "../auth/GitHubAuth.ts";
import type { GistChanges, GistFiles } from "./Gist.ts";

/** Identity of a saved gist, enough to build its share URL. */
export interface SavedGist {
  id: string;
  owner: string;
}

/** A gist read back from the API: identity, description, and file contents. */
export interface LoadedGist extends SavedGist {
  description: string;
  files: Record<string, string>;
}

interface GistBody<TFiles> {
  description: string;
  files: TFiles;
}

/** One file as the gists API returns it. Files past the API's inline size cap
 *  come back with `truncated` set and only the leading megabyte in `content`;
 *  the full text is served from `raw_url`. */
interface GistFileResponse {
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}

/** The fields the app reads from a gists API response. */
interface GistResponse {
  id?: string;
  owner?: { login?: string };
  description?: string | null;
  files?: Record<string, GistFileResponse | null>;
}

const apiBase = "https://api.github.com";

/** A stalled request otherwise hangs its caller forever: the startup
 *  placeholder never clears, or Save stays "Saving...". Timing out turns it
 *  into a rejection the existing error paths already handle. */
const fetchTimeoutMs = 20_000;

/** A gists API request that came back non-2xx, carrying the HTTP status. */
export class GistError extends Error {
  status: number;

  constructor(status: number, action: string) {
    super(`gist ${action} failed (${status})`);
    this.status = status;
  }
}

/** Create a new public gist; returns its id and owner login. */
export async function createGist(
  auth: GitHubAuth,
  body: GistBody<GistFiles>,
): Promise<SavedGist> {
  return writeGist(auth, "POST", "/gists", { ...body, public: true });
}

/** Apply file and description changes to an existing gist. */
export async function updateGist(
  auth: GitHubAuth,
  id: string,
  body: GistBody<GistChanges>,
): Promise<SavedGist> {
  return writeGist(auth, "PATCH", `/gists/${encodeURIComponent(id)}`, body);
}

/**
 * Fetch a gist by id. Sends the token when one is held (higher rate limit and
 * access to the caller's own gists); public gists resolve without it.
 */
export async function fetchGist(
  id: string,
  auth: GitHubAuth | null,
): Promise<LoadedGist> {
  // Encode the id: it arrives decoded from the URL path, and a crafted value
  // like `../user` would otherwise steer this authenticated request to an
  // arbitrary API endpoint.
  const res = await fetch(`${apiBase}/gists/${encodeURIComponent(id)}`, {
    headers: jsonHeaders(auth),
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  // A revoked or expired stored token 401s even for public gists; retry
  // anonymously rather than break every shared link until sign-out.
  if (res.status === 401 && auth) return fetchGist(id, null);
  if (!res.ok) throw new GistError(res.status, "GET");
  const data = (await res.json()) as GistResponse;
  if (!data.id) throw new Error("gist response missing id");
  return {
    id: data.id,
    owner: data.owner?.login ?? "",
    description: data.description ?? "",
    files: await fileContents(data.files ?? {}),
  };
}

/** Send an authenticated create or update, and read back the gist's identity. */
async function writeGist(
  auth: GitHubAuth,
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<SavedGist> {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: { ...jsonHeaders(auth), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  if (!res.ok) throw new GistError(res.status, method);
  const data = (await res.json()) as GistResponse;
  if (!data.id) throw new Error("gist response missing id");
  return { id: data.id, owner: data.owner?.login ?? auth.account.login };
}

/**
 * The full text of every file in the response, fetching any the API truncated.
 *
 * Only shader files are worth a raw refetch: the loader ignores the other
 * files, and fetching them anyway would let a hostile gist (hundreds of
 * files, up to ~10MB each past the truncation point) pull gigabytes into the
 * tab - and would abort the whole load if one refetch failed. In practice a
 * large thumbnail is the common truncated file; it is simply skipped.
 */
async function fileContents(
  files: Record<string, GistFileResponse | null>,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(files).map(async ([name, file]) => {
      if (!file) return null;
      if (file.truncated && !isWeslFile(name)) return null;
      const text = file.truncated ? await rawContent(name, file) : file.content;
      return typeof text === "string" ? ([name, text] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter(entry => entry !== null));
}

/**
 * Fetch a truncated file's full text from its raw url. Failing here throws,
 * which beats the alternatives: the partial `content` would load as silently
 * corrupt shader source, and skipping the file would load a shader with pieces
 * missing.
 *
 * Sent without the token: raw_url is a different host, and needs no
 * authorization anyway - the url itself is the secret for a non-public gist.
 */
async function rawContent(
  name: string,
  file: GistFileResponse,
): Promise<string> {
  if (!file.raw_url) throw new Error(`gist file too large to load: ${name}`);
  const res = await fetch(file.raw_url, {
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  // Not a GistError: the gist itself resolved, so reporting this as a 404 would
  // tell the user their existing gist doesn't exist.
  if (!res.ok)
    throw new Error(`gist file fetch failed: ${name} (${res.status})`);
  return res.text();
}

function jsonHeaders(auth: GitHubAuth | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (auth) headers.Authorization = `Bearer ${auth.accessToken}`;
  return headers;
}
