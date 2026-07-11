/**
 * Thin GitHub gists API client. Creates and updates public gists with a bearer
 * token (the OAuth token held in localStorage). Throws on non-2xx so callers
 * have a single failure path.
 */

import type { GitHubAuth } from "../auth/GitHubAuth.ts";
import type { GistFiles } from "./Gist.ts";

/** Identity of a saved gist, enough to build its share URL. */
export interface SavedGist {
  id: string;
  owner: string;
}

interface CreateBody {
  description: string;
  files: GistFiles;
}

const apiBase = "https://api.github.com";

/** Create a new public gist; returns its id and owner login. */
export async function createGist(
  auth: GitHubAuth,
  body: CreateBody,
): Promise<SavedGist> {
  return request(auth, "POST", "/gists", { ...body, public: true });
}

/** Replace the files/description of an existing gist. */
export async function updateGist(
  auth: GitHubAuth,
  id: string,
  body: CreateBody,
): Promise<SavedGist> {
  return request(auth, "PATCH", `/gists/${id}`, body);
}

async function request(
  auth: GitHubAuth,
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<SavedGist> {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`gist ${method} failed (${res.status})`);
  }
  const data = (await res.json()) as {
    id?: string;
    owner?: { login?: string };
  };
  if (!data.id) throw new Error("gist response missing id");
  return { id: data.id, owner: data.owner?.login ?? auth.account.login };
}
