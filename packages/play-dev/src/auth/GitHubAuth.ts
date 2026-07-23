/** Persisted GitHub authorization and cached account identity. */
export interface GitHubAuth {
  accessToken: string;
  scope: string;
  account: GitHubAccount;
}

export interface GitHubAccount {
  login: string;
  avatarUrl: string;
}

export const githubAuthKey = "wgsl-play.token";

/**
 * Read the persisted GitHub authorization, migrating the legacy flat shape.
 *
 * Reads storage inside the try: a browser with site data blocked throws on
 * `localStorage` access itself, and this runs during the first render, where a
 * throw renders nothing at all. Signed-out is the right answer there.
 */
export function readGitHubAuth(): GitHubAuth | null {
  try {
    const raw = localStorage.getItem(githubAuthKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (isGitHubAuth(parsed)) return parsed;
    const migrated = migrateLegacyAuth(parsed);
    if (migrated) writeGitHubAuth(migrated);
    return migrated;
  } catch {
    return null;
  }
}

export function writeGitHubAuth(auth: GitHubAuth): void {
  localStorage.setItem(githubAuthKey, JSON.stringify(auth));
}

export function clearGitHubAuth(): void {
  localStorage.removeItem(githubAuthKey);
}

function isGitHubAuth(v: unknown): v is GitHubAuth {
  if (!v || typeof v !== "object") return false;
  const auth = v as Partial<GitHubAuth>;
  return (
    typeof auth.accessToken === "string" &&
    typeof auth.scope === "string" &&
    isGitHubAccount(auth.account)
  );
}

/** Convert auth persisted before the account fields were grouped. */
function migrateLegacyAuth(v: unknown): GitHubAuth | null {
  if (!v || typeof v !== "object") return null;
  const legacy = v as Record<string, unknown>;
  if (
    typeof legacy.accessToken !== "string" ||
    typeof legacy.scope !== "string" ||
    typeof legacy.login !== "string" ||
    typeof legacy.avatarUrl !== "string"
  ) {
    return null;
  }
  const account = { login: legacy.login, avatarUrl: legacy.avatarUrl };
  return { accessToken: legacy.accessToken, scope: legacy.scope, account };
}

function isGitHubAccount(v: unknown): v is GitHubAccount {
  if (!v || typeof v !== "object") return false;
  const account = v as Partial<GitHubAccount>;
  return (
    typeof account.login === "string" && typeof account.avatarUrl === "string"
  );
}
