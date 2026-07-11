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
import { encodeFragment, persistProject } from "./lib/Share.ts";
import { resolveInitialState } from "./lib/State.ts";
import { useGistSave } from "./lib/UseGistSave.ts";

const initialState = resolveInitialState();

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => initialTheme());
  const [title, setTitle] = useState(initialState.snapshot.title);
  const [auth, setAuth] = useState<GitHubAuth | null>(() => readGitHubAuth());
  const sessionId = useRef(initialState.sessionId);
  const snapshot = useRef<AutosaveSnapshot>(initialState.snapshot);
  const gistSave = useGistSave(persist);

  useEffect(() => {
    const onAppearanceChange = (e: Event) =>
      setTheme((e as CustomEvent<AppearanceChangeDetail>).detail.resolved);
    document.addEventListener("appearance-change", onAppearanceChange);
    return () =>
      document.removeEventListener("appearance-change", onAppearanceChange);
  }, []);

  /** Merge fields into the current buffer and persist to the session slot. */
  function persist(patch: Partial<AutosaveSnapshot> = {}) {
    const next = { ...snapshot.current, ...patch, savedAt: Date.now() };
    snapshot.current = next;
    writeSlot(sessionId.current, next);
    return next;
  }

  function onProjectChange(project: WeslProject) {
    snapshot.current = {
      ...snapshot.current,
      project: persistProject(project),
    };
  }

  function onAutosave(project: WeslProject) {
    persist({ project: persistProject(project) });
  }

  function onTitleCommit(value: string) {
    setTitle(value);
    persist({ title: value });
  }

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
          <SaveButton status={gistSave.state.status} onSave={gistSave.save} />
        }
        accountMenu={
          <AccountMenu auth={auth} onSignOut={() => setAuth(null)} />
        }
      />
      <EditPlay
        initial={initialState.snapshot.project}
        theme={theme}
        onChange={onProjectChange}
        onAutosave={onAutosave}
      />
      <Footer
        buildShareUrl={buildShareUrl}
        gist={gistSave.state.gist}
        saveStatus={gistSave.state.status}
      />
    </>
  );
}

function initialTheme(): "light" | "dark" {
  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") return attr;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
