import { clearGitHubAuth } from "./GitHubAuth.ts";

/**
 * Sign out locally. Server-side grant revocation is deferred until the
 * Worker grows a `/revoke` endpoint: GitHub's grant-revoke API needs
 * client_secret as Basic auth, which the browser cannot hold.
 */
export function signOut(): void {
  clearGitHubAuth();
}
