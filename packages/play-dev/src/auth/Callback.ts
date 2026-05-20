import { takeStoredCsrf } from "./Authorize.ts";
import { type AuthToken, writeToken } from "./Token.ts";

export const workerUrl = "https://play-auth.mighdoll.workers.dev";

export type CallbackResult =
  | { ok: true; token: AuthToken }
  | { ok: false; error: string };

/**
 * Post-redirect handler for `/auth/callback`. Verifies the CSRF token,
 * swaps the `code` for a token via the Cloudflare Worker, fetches the GitHub
 * profile for avatar/login caching, and persists the result.
 */
export async function completeSignIn(): Promise<CallbackResult> {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const returnedCsrf = params.get("state");
  const githubError = params.get("error");
  if (githubError) return { ok: false, error: `GitHub: ${githubError}` };
  if (!code || !returnedCsrf) {
    return { ok: false, error: "Missing code or state in callback URL." };
  }
  const expectedCsrf = takeStoredCsrf();
  if (!expectedCsrf || expectedCsrf !== returnedCsrf) {
    return { ok: false, error: "State mismatch. Please try signing in again." };
  }

  const exchanged = await exchangeCode(code);
  if (!exchanged.ok) return exchanged;

  const profile = await fetchProfile(exchanged.accessToken);
  if (!profile.ok) return profile;

  const token: AuthToken = {
    accessToken: exchanged.accessToken,
    scope: exchanged.scope,
    login: profile.login,
    avatarUrl: profile.avatarUrl,
  };
  writeToken(token);
  return { ok: true, token };
}

type ExchangeOk = { ok: true; accessToken: string; scope: string };
type ExchangeErr = { ok: false; error: string };

/** POST {code} to the Worker; map Worker error shapes to user-facing messages. */
async function exchangeCode(code: string): Promise<ExchangeOk | ExchangeErr> {
  let res: Response;
  try {
    res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  } catch (e) {
    return { ok: false, error: `Network error talking to auth: ${e}` };
  }
  const body = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!res.ok) {
    if (body?.error === "github_error") {
      const inner = body.body as Record<string, unknown> | undefined;
      const desc = inner?.error_description ?? inner?.error ?? "auth rejected";
      return { ok: false, error: `Sign-in failed: ${desc}` };
    }
    if (body?.error === "invalid_request") {
      return { ok: false, error: "Sign-in failed: malformed request." };
    }
    if (body?.error === "unexpected_scope") {
      return { ok: false, error: "Sign-in failed: unexpected scope granted." };
    }
    return { ok: false, error: `Sign-in failed (${res.status}).` };
  }
  if (
    typeof body?.access_token !== "string" ||
    typeof body.scope !== "string"
  ) {
    return { ok: false, error: "Auth response missing token." };
  }
  return { ok: true, accessToken: body.access_token, scope: body.scope };
}

type ProfileOk = { ok: true; login: string; avatarUrl: string };

async function fetchProfile(
  accessToken: string,
): Promise<ProfileOk | ExchangeErr> {
  let res: Response;
  try {
    res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });
  } catch (e) {
    return { ok: false, error: `Network error fetching profile: ${e}` };
  }
  if (!res.ok) {
    return { ok: false, error: `Profile fetch failed (${res.status}).` };
  }
  const data = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (typeof data?.login !== "string" || typeof data.avatar_url !== "string") {
    return { ok: false, error: "Profile response malformed." };
  }
  return { ok: true, login: data.login, avatarUrl: data.avatar_url };
}
