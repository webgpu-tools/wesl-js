/**
 * Thin GitHub gists API client. Creates and updates public gists with a bearer
 * token (the OAuth token held in localStorage). Throws on non-2xx so callers
 * have a single failure path.
 */

import type { AuthToken } from "../auth/Token.ts";
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
  token: AuthToken,
  body: CreateBody,
): Promise<SavedGist> {
  return request(token, "POST", "/gists", { ...body, public: true });
}

/** Replace the files/description of an existing gist. */
export async function updateGist(
  token: AuthToken,
  id: string,
  body: CreateBody,
): Promise<SavedGist> {
  return request(token, "PATCH", `/gists/${id}`, body);
}

async function request(
  token: AuthToken,
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<SavedGist> {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
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
  return { id: data.id, owner: data.owner?.login ?? token.login };
}
