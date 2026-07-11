import { useEffect, useRef, useState } from "preact/hooks";
import { startSignIn } from "../auth/Authorize.ts";
import type { GitHubAuth } from "../auth/GitHubAuth.ts";
import { signOut } from "../auth/Revoke.ts";

interface Props {
  auth: GitHubAuth | null;
  onSignOut(): void;
}

export function AccountMenu({ auth, onSignOut }: Props) {
  if (!auth) {
    return (
      <button type="button" class="signin-btn" onClick={startSignIn}>
        Sign in
      </button>
    );
  }
  return <SignedIn auth={auth} onSignOut={onSignOut} />;
}

function SignedIn({
  auth,
  onSignOut,
}: {
  auth: GitHubAuth;
  onSignOut(): void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function handleSignOut() {
    signOut();
    setOpen(false);
    onSignOut();
  }

  return (
    <div class="account-menu" ref={ref}>
      <button
        type="button"
        class="avatar-btn"
        aria-label={`Signed in as ${auth.account.login}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <img src={auth.account.avatarUrl} alt="" />
      </button>
      {open && (
        <div class="account-dropdown" role="menu">
          <div class="account-login">{auth.account.login}</div>
          <button type="button" role="menuitem" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
