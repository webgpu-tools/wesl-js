import { render } from "preact";
import { App } from "./App.tsx";
import { CallbackScreen } from "./components/Callback.tsx";
import { gistRoute } from "./lib/Gist.ts";
import { resolveInitialState } from "./lib/State.ts";
import "./styles/app.css";

// The app rewrites URLs in place (replaceState only, never pushState), so the
// only same-document history traversals are hash-only entries; reloading on
// them re-runs the startup resolution instead of showing a stale buffer.
addEventListener("popstate", () => location.reload());

const root = document.getElementById("app")!;
if (location.pathname === "/auth/callback") {
  render(<CallbackScreen />, root);
} else {
  // A /gist/ URL fetches from GitHub before the buffer is known, so it gets a
  // placeholder to look at. Every other route resolves from local storage
  // within a microtask, too fast for that placeholder to ever paint.
  if (gistRoute(location.pathname)) {
    render(<div class="callback">Loading shader...</div>, root);
  }
  render(<App initial={await resolveInitialState()} />, root);
}
