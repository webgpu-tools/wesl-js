import "appearance-picker";
import "appearance-picker/jsx-preact";
import "wgsl-edit";
import "wgsl-edit/jsx-preact";
import "wgsl-play";
import "wgsl-play/jsx-preact";

import type { AppearanceChangeDetail } from "appearance-picker";
import { useEffect, useRef, useState } from "preact/hooks";
import type { WeslProject } from "wesl";
import { startSignIn } from "./auth/Authorize.ts";
import { type AuthToken, readToken } from "./auth/Token.ts";
import { AccountMenu } from "./components/AccountMenu.tsx";
import { EditPlay } from "./components/EditPlay.tsx";
import { Footer } from "./components/Footer.tsx";
import { SaveButton, type SaveStatus } from "./components/SaveButton.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { type BufferPayload, readSlot, writeSlot } from "./lib/Autosave.ts";
import { markPendingSave, saveGist, takePendingSave } from "./lib/Save.ts";
import { encodeFragment } from "./lib/Share.ts";
import { resolveInitialState } from "./lib/State.ts";

const initialState = resolveInitialState();

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => initialTheme());
  const [title, setTitle] = useState(initialState.payload.title);
  const [token, setToken] = useState<AuthToken | null>(() => readToken());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [gistUrl, setGistUrl] = useState<string | null>(null);
  const [saveNonce, setSaveNonce] = useState(0);
  const sessionId = useRef(initialState.sessionId);
  const buffer = useRef<BufferPayload>(initialState.payload);
  const gistId = useRef<string | null>(null);
  const saveInFlight = useRef(false);
  const statusReset = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onAppearanceChange = (e: Event) =>
      setTheme((e as CustomEvent<AppearanceChangeDetail>).detail.resolved);
    document.addEventListener("appearance-change", onAppearanceChange);
    return () =>
      document.removeEventListener("appearance-change", onAppearanceChange);
  }, []);

  // Resume a save that was interrupted by the sign-in redirect. Always consume
  // the pending flag on mount so an abandoned sign-out save can't later fire a
  // phantom save on an unrelated sign-in.
  useEffect(() => {
    if (takePendingSave() && readToken()) void runSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearStatusReset(), []);

  /** Save the current buffer to a gist, signing in first if needed. */
  async function runSave() {
    if (saveInFlight.current) return;
    const current = readToken();
    if (!current) {
      markPendingSave();
      startSignIn();
      return;
    }
    saveInFlight.current = true;
    clearStatusReset();
    setSaveStatus("saving");
    try {
      const payload = readSlot(sessionId.current) ?? buffer.current;
      const outcome = await saveGist({
        token: current,
        payload,
        gistId: gistId.current,
      });
      gistId.current = outcome.id;
      history.replaceState(null, "", `/gist/${outcome.owner}/${outcome.id}`);
      setGistUrl(outcome.url);
      setSaveNonce(n => n + 1);
      flashStatus("saved", 1800);
    } catch (e) {
      console.warn("gist save failed:", e);
      flashStatus("error", 2500);
    } finally {
      saveInFlight.current = false;
    }
  }

  function flashStatus(status: "saved" | "error", durationMs: number) {
    setSaveStatus(status);
    statusReset.current = setTimeout(() => {
      statusReset.current = null;
      setSaveStatus("idle");
    }, durationMs);
  }

  function clearStatusReset() {
    if (statusReset.current === null) return;
    clearTimeout(statusReset.current);
    statusReset.current = null;
  }

  /** Merge fields into the current buffer and persist to the session slot. */
  function persist(patch: Partial<BufferPayload>) {
    const current = readSlot(sessionId.current) ?? buffer.current;
    const next = { ...current, ...patch, savedAt: Date.now() };
    buffer.current = next;
    writeSlot(sessionId.current, next);
  }

  function onAutosave(project: WeslProject) {
    persist({ project });
  }

  function onTitleCommit(value: string) {
    setTitle(value);
    persist({ title: value });
  }

  function buildShareUrl(): string | null {
    const { project, title } = readSlot(sessionId.current) ?? buffer.current;
    const fragment = encodeFragment({ project, title });
    if (!fragment) return null;
    return `${location.origin}${location.pathname}${fragment}`;
  }

  return (
    <>
      <TopBar
        title={title}
        onTitleCommit={onTitleCommit}
        saveButton={<SaveButton status={saveStatus} onSave={runSave} />}
        accountMenu={
          <AccountMenu token={token} onSignOut={() => setToken(null)} />
        }
      />
      <EditPlay
        initial={initialState.payload.project}
        theme={theme}
        onAutosave={onAutosave}
      />
      <Footer
        buildShareUrl={buildShareUrl}
        gistUrl={gistUrl}
        saveNonce={saveNonce}
      />
    </>
  );
}

function initialTheme(): "light" | "dark" {
  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") return attr;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
