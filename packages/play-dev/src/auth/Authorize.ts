/**
 * Begin the GitHub OAuth dance: stash a single-use CSRF token in
 * sessionStorage and redirect to GitHub's authorize endpoint. The token is
 * sent as OAuth's `state` parameter (RFC 6749 §4.1.1) and verified on return.
 *
 * sessionStorage is keyed by tab and survives navigation to other origins,
 * so the token we stash here is still readable when GitHub redirects back.
 * Cross-tab isolation is desirable: a sign-in started in tab A cannot be
 * completed by tab B.
 */

const prodClientId = "Ov23li6iYF3wfpn2cdgM";
const devClientId = "Ov23liXTsm3BlRW2gJVv";
const devOrigin = "http://localhost:9111";
const authorizeUrl = "https://github.com/login/oauth/authorize";
export const csrfKey = "wgsl-play.oauth-state";

/** Generate a CSRF token, persist it, and redirect the tab to GitHub. */
export function startSignIn(): void {
  const csrf = crypto.randomUUID();
  sessionStorage.setItem(csrfKey, csrf);
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: `${location.origin}/auth/callback`,
    scope: "gist",
    state: csrf,
    allow_signup: "true",
  });
  location.assign(`${authorizeUrl}?${params}`);
}

function clientId(): string {
  return location.origin === devOrigin ? devClientId : prodClientId;
}

/** Read and clear the stored CSRF token. Returns null if no sign-in was started in this tab. */
export function takeStoredCsrf(): string | null {
  const value = sessionStorage.getItem(csrfKey);
  sessionStorage.removeItem(csrfKey);
  return value;
}
