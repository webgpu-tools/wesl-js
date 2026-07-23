/**
 * The outbound half of GitHub OAuth: redirect to GitHub's authorize endpoint,
 * holding the state that has to survive the round trip. The CSRF token travels
 * as OAuth's `state` parameter (RFC 6749 sec 4.1.1) and is verified on return.
 *
 * That state lives in sessionStorage, which is keyed by tab and survives
 * navigation to another origin, so it is still readable when GitHub redirects
 * back. Per-tab is a feature: a sign-in started in tab A cannot be completed
 * by tab B.
 */

export const csrfKey = "wgsl-play.oauth-state";
export const returnPathKey = "wgsl-play.return-path";

const prodClientId = "Ov23li6iYF3wfpn2cdgM";
const devClientId = "Ov23liXTsm3BlRW2gJVv";
const devOrigin = "http://localhost:9111";
const authorizeUrl = "https://github.com/login/oauth/authorize";

/** Generate a CSRF token, persist it, and redirect the tab to GitHub. */
export function startSignIn(): void {
  const csrf = crypto.randomUUID();
  sessionStorage.setItem(csrfKey, csrf);
  // Remember the page we left, so a Save started on /gist/... returns there and
  // updates that gist instead of creating a duplicate. No hash to keep: shared
  // fragments are stripped from the URL at startup, before anything can save.
  sessionStorage.setItem(returnPathKey, location.pathname + location.search);
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: `${location.origin}/auth/callback`,
    scope: "gist",
    state: csrf,
    allow_signup: "true",
  });
  location.assign(`${authorizeUrl}?${params}`);
}

/**
 * Read and clear the stored CSRF token. Null when this tab never started a
 * sign-in, which is itself the signal to reject the callback.
 */
export function takeStoredCsrf(): string | null {
  const value = sessionStorage.getItem(csrfKey);
  sessionStorage.removeItem(csrfKey);
  return value;
}

/**
 * Read and clear the page to return to after sign-in; the editor root by
 * default. Only same-origin paths are honored, never a full URL.
 *
 * The URL parser decides, not a string test: `//host`, `/\host` and even a
 * path with an embedded newline all resolve to a different origin, and the
 * parser is what `history.replaceState` will use anyway.
 */
export function takeReturnPath(): string {
  const path = sessionStorage.getItem(returnPathKey);
  sessionStorage.removeItem(returnPathKey);
  if (!path?.startsWith("/")) return "/";
  try {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

/** The OAuth app to sign in against: a separate one serves the dev origin. */
function clientId(): string {
  return location.origin === devOrigin ? devClientId : prodClientId;
}
