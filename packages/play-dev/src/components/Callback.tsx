import { useEffect, useState } from "preact/hooks";
import { takeReturnPath } from "../auth/Authorize.ts";
import { completeSignIn } from "../auth/Callback.ts";

type State = { kind: "pending" } | { kind: "error"; message: string };

/** The `/auth/callback` landing page: finish the sign-in, then leave for good. */
export function CallbackScreen() {
  const [state, setState] = useState<State>({ kind: "pending" });

  useEffect(() => {
    completeSignIn()
      .then(result => {
        if (!result.ok) {
          setState({ kind: "error", message: result.error });
          return;
        }
        // Swap /auth/callback for the page the sign-in started from, then
        // reload it: the editor boots there with the stored token in hand.
        history.replaceState(null, "", takeReturnPath());
        location.reload();
      })
      // An unexpected throw (blocked storage, say) would otherwise leave this
      // screen saying "Signing you in..." forever.
      .catch(e => setState({ kind: "error", message: `Sign-in failed: ${e}` }));
  }, []);

  if (state.kind === "pending") {
    return <div class="callback">Signing you in...</div>;
  }
  return (
    <div class="callback callback-error">
      <p>{state.message}</p>
      <a href="/">Return to editor</a>
    </div>
  );
}
