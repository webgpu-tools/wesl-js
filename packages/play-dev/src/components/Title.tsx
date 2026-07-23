import { useEffect, useRef } from "preact/hooks";
import { maxTitleLength } from "../lib/Share.ts";

interface Props {
  value: string;
  onCommit(title: string): void;
}

export function Title({ value, onCommit }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const committed = useRef(value);

  useEffect(() => {
    committed.current = value;
    if (ref.current && ref.current.textContent !== value) {
      ref.current.textContent = value;
    }
  }, [value]);

  function commit() {
    const text = (ref.current?.textContent ?? "")
      .trim()
      .slice(0, maxTitleLength);
    if (!text) {
      ref.current!.textContent = committed.current;
      return;
    }
    if (text !== committed.current) {
      committed.current = text;
      onCommit(text);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      ref.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (ref.current) ref.current.textContent = committed.current;
      ref.current?.blur();
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: inline contentEditable span; an <input> would not flow as plain text in the topbar
    <span
      ref={ref}
      class="title"
      contentEditable
      role="textbox"
      aria-label="Shader title"
      spellcheck={false}
      tabIndex={0}
      onBlur={commit}
      onKeyDown={onKeyDown}
    >
      {value}
    </span>
  );
}
