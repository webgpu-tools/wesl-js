import { useEffect, useRef } from "preact/hooks";
import type { WeslProject } from "wesl";
import type { AutosaveDetail, WgslEdit } from "wgsl-edit/element";

interface Props {
  initial: WeslProject;
  theme: "light" | "dark";
  onChange(project: WeslProject): void;
  onAutosave(project: WeslProject): void;
}

export function EditPlay({ initial, theme, onChange, onAutosave }: Props) {
  const editorRef = useRef<WgslEdit>(null);
  const onChangeRef = useRef(onChange);
  const onAutosaveRef = useRef(onAutosave);
  onChangeRef.current = onChange;
  onAutosaveRef.current = onAutosave;

  useEffect(() => {
    const el = editorRef.current!;
    const onChangeEvent = (e: Event) => {
      onChangeRef.current((e as CustomEvent<WeslProject>).detail);
    };
    const onAutosaveEvent = (e: Event) => {
      const { project } = (e as CustomEvent<AutosaveDetail>).detail;
      onAutosaveRef.current(project);
    };
    el.addEventListener("change", onChangeEvent);
    el.addEventListener("autosave", onAutosaveEvent);
    el.project = initial;
    return () => {
      el.removeEventListener("change", onChangeEvent);
      el.removeEventListener("autosave", onAutosaveEvent);
    };
  }, []);

  return (
    <div class="editplay-pane">
      <wgsl-edit ref={editorRef} id="editor" theme={theme} lint-from="player" />
      <wgsl-play id="player" from="editor" theme={theme} resizable />
    </div>
  );
}
