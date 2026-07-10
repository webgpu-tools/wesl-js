import type { ComponentChildren } from "preact";
import { Title } from "./Title.tsx";

interface Props {
  title: string;
  onTitleCommit(value: string): void;
  saveButton: ComponentChildren;
  accountMenu: ComponentChildren;
}

export function TopBar({
  title,
  onTitleCommit,
  saveButton,
  accountMenu,
}: Props) {
  return (
    <header class="topbar">
      <a class="logo" href="/" aria-label="wgsl-play.dev">
        <img src="/logo-small.png" alt="" />
      </a>
      <Title value={title} onCommit={onTitleCommit} />
      <div class="topbar-spacer" />
      <div class="gallery">
        <button type="button" class="gallery-btn" disabled title="Coming soon">
          Gallery <span aria-hidden="true">▾</span>
        </button>
      </div>
      <appearance-picker />
      {saveButton}
      {accountMenu}
    </header>
  );
}
