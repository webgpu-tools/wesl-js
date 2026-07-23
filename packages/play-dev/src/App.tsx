import "appearance-picker";
import "appearance-picker/jsx-preact";
import "wgsl-edit";
import "wgsl-edit/jsx-preact";
import "wgsl-play";
import "wgsl-play/jsx-preact";

import type { AppearanceChangeDetail } from "appearance-picker";
import { useEffect, useRef, useState } from "preact/hooks";
import type { WeslProject } from "wesl";
import { type GitHubAuth, readGitHubAuth } from "./auth/GitHubAuth.ts";
import { AccountMenu } from "./components/AccountMenu.tsx";
import { EditPlay } from "./components/EditPlay.tsx";
import { Footer } from "./components/Footer.tsx";
import { SaveButton } from "./components/SaveButton.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { type AutosaveSnapshot, writeSlot } from "./lib/Autosave.ts";
import { exportPng } from "./lib/ExportPng.ts";
import { gistRef, saveOutcome } from "./lib/Save.ts";
import { encodeFragment, persistProject } from "./lib/Share.ts";
import type { InitialState } from "./lib/State.ts";
import { useGistSave } from "./lib/UseGistSave.ts";

interface Props {
  initial: InitialState;
}

export function App({ initial }: Props) {
  const [theme, setTheme] = useState<"light" | "dark">(() => initialTheme());
  const [title, setTitle] = useState(initial.snapshot.title);
  const [auth, setAuth] = useState<GitHubAuth | null>(() => readGitHubAuth());
  const [loadError, setLoadError] = useState(initial.loadError);
  const sessionId = useRef(initial.sessionId);
  const snapshot = useRef<AutosaveSnapshot>(initial.snapshot);

  // The gist this buffer came from, and whether the signed-in user owns it.
  // Save updates a gist the user owns; on anyone else's it saves a copy
  // instead, and that copy is the Fork.
  //
  // Read once at mount rather than from the live snapshot ref: writing a ref
  // doesn't re-render, so a render that read it could disagree with what is on
  // screen. Where the buffer came from never changes anyway, and the gist a
  // later save lands in is gistSave's to track.
  const openGist = initial.snapshot.gist ?? null;
  const owned = !!openGist && openGist.owner === auth?.account.login;
  // Signed out we can't tell an owner from a visitor, so the button stays
  // "Save"; the sign-in it triggers resolves which one actually happens. Once
  // a fork exists, gistSave holds it and Save updates that copy from then on.
  const forkOrigin = !!auth && !!openGist && !owned;
  const gistSave = useGistSave({
    snapshot: persist,
    initialGist: owned && openGist ? saveOutcome(openGist) : null,
    forkOrigin,
    onSaved: gist => persist({ gist: gistRef(gist) }),
    onAuthExpired: () => setAuth(null),
  });

  // Idle shows what a save would do next; mid-save and during the outcome
  // flash, the action latched at save start keeps a finished Fork labeled
  // "Forked" even though the fork's gist now exists.
  const forking = forkOrigin && !gistSave.state.gist;
  const nextAction = forking ? "Fork" : "Save";
  const saveAction =
    gistSave.state.status === "idle" ? nextAction : gistSave.action;

  useEffect(() => {
    const onAppearance = (e: Event) =>
      setTheme((e as CustomEvent<AppearanceChangeDetail>).detail.resolved);
    document.addEventListener("appearance-change", onAppearance);
    return () =>
      document.removeEventListener("appearance-change", onAppearance);
  }, []);

  // Cmd/Ctrl+S saves; save() reads live state through refs, so the first
  // render's closure stays correct. Shift/Alt chords belong to the browser.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.shiftKey || e.altKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      commitTitleEdit();
      gistSave.save();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Merge fields into the current buffer and persist to the session slot. */
  function persist(patch: Partial<AutosaveSnapshot> = {}) {
    const next = { ...snapshot.current, ...patch, savedAt: Date.now() };
    snapshot.current = next;
    writeSlot(sessionId.current, next);
    return next;
  }

  // Every keystroke arrives here, but only the debounced autosave writes
  // storage. The in-memory buffer still tracks each edit, so a Save sends what
  // is on screen rather than whatever the last autosave caught.
  function onProjectChange(project: WeslProject) {
    const persisted = persistProject(project);
    snapshot.current = { ...snapshot.current, project: persisted };
  }

  function onAutosave(project: WeslProject) {
    persist({ project: persistProject(project) });
  }

  function onTitleCommit(value: string) {
    setTitle(value);
    persist({ title: value });
  }

  /** A self-contained link to the current buffer; null if it won't fit in one. */
  function buildShareUrl(): string | null {
    const { project, title } = snapshot.current;
    const fragment = encodeFragment({ project, title });
    if (!fragment) return null;
    return `${location.origin}${location.pathname}${fragment}`;
  }

  return (
    <>
      <TopBar
        title={title}
        onTitleCommit={onTitleCommit}
        saveButton={
          <SaveButton
            status={gistSave.state.status}
            onSave={gistSave.save}
            action={saveAction}
          />
        }
        accountMenu={
          <AccountMenu auth={auth} onSignOut={() => setAuth(null)} />
        }
      />
      {loadError && (
        <div class="load-error" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => setLoadError(undefined)}>
            Dismiss
          </button>
        </div>
      )}
      <EditPlay
        initial={initial.snapshot.project}
        theme={theme}
        onChange={onProjectChange}
        onAutosave={onAutosave}
      />
      <Footer
        buildShareUrl={buildShareUrl}
        exportPng={() => exportPng(snapshot.current.title)}
        gist={gistSave.state.gist}
        saveStatus={gistSave.state.status}
      />
    </>
  );
}

/**
 * Flush a title rename that is still in progress. The title commits on blur,
 * which a Save *click* triggers but a Cmd+S does not, so without this the gist
 * would be saved under the previous title. Only a focused title is blurred:
 * pulling focus out of the code editor mid-keystroke would be worse than the
 * bug this fixes.
 */
function commitTitleEdit() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.classList.contains("title")) {
    active.blur();
  }
}

/** The theme the page booted with: an explicit choice, else the OS preference. */
function initialTheme(): "light" | "dark" {
  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") return attr;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
