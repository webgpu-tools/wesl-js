/**
 * Editor state is autosaved into per-tab "slots" in localStorage.
 *
 * Each tab holds a session-id in sessionStorage; that id names a slot
 * `wgsl-play.buffer.<id>` so reloading a tab restores its own buffer
 * and concurrent tabs don't clobber each other. Every write also mirrors
 * to a shared `wgsl-play.buffer.last` key, which seeds new tabs with
 * the most recent buffer across the app.
 */

import type { GistRef } from "./Save.ts";
import { isShaderDocument, type ShaderDocument } from "./Share.ts";

/** A snapshot of editor state persisted to a localStorage slot. */
export interface AutosaveSnapshot extends ShaderDocument {
  savedAt: number;

  /** The gist this buffer was loaded from, or last saved to. */
  gist?: GistRef;
}

export const slotPrefix = "wgsl-play.buffer.";
export const lastKey = `${slotPrefix}last`;
const sessionIdKey = "wgsl-play.session-id";
const maxSlots = 20;
const maxAgeMs = 30 * 24 * 60 * 60 * 1000;

/** Validate that `value` matches the autosave snapshot shape. */
export function isAutosaveSnapshot(value: unknown): value is AutosaveSnapshot {
  if (!isShaderDocument(value)) return false;
  const snapshot = value as AutosaveSnapshot;
  if (typeof snapshot.savedAt !== "number") return false;
  return snapshot.gist === undefined || isGistRef(snapshot.gist);
}

/** Read the current tab's session-id, allocating one if needed. */
export function getOrCreateSessionId(): string {
  const id = getSessionId() ?? crypto.randomUUID();
  setSessionId(id);
  return id;
}

/** Peek at the tab's session-id without allocating. */
export function getSessionId(): string | null {
  try {
    return sessionStorage.getItem(sessionIdKey);
  } catch {
    return null;
  }
}

/** Pin the tab's session-id, e.g. after adopting a slot from a shared URL. */
export function setSessionId(id: string): void {
  try {
    sessionStorage.setItem(sessionIdKey, id);
  } catch (e) {
    console.warn("session id write failed:", e);
  }
}

/** Read the snapshot stored in slot `id`, or null if missing/corrupt. */
export function readSlot(id: string): AutosaveSnapshot | null {
  return readSnapshot(slotKey(id));
}

/** Persist `snapshot` to slot `id` and mirror it to the shared "last" slot. */
export function writeSlot(id: string, snapshot: AutosaveSnapshot): void {
  const json = JSON.stringify(snapshot);
  setItem(slotKey(id), json);
  setItem(lastKey, json);
}

/** Read the most recently written snapshot across all tabs. */
export function readLast(): AutosaveSnapshot | null {
  return readSnapshot(lastKey);
}

/** Allocate a fresh slot id and seed both slot + last with the snapshot. */
export function allocateSlot(snapshot: AutosaveSnapshot): string {
  const id = crypto.randomUUID();
  writeSlot(id, snapshot);
  return id;
}

/** Drop slots past `maxAgeMs`, then keep only the `maxSlots` most recent. */
export function sweepOldSlots(): void {
  const now = Date.now();
  const slots: Array<{ key: string; savedAt: number }> = [];
  for (const key of slotKeys()) {
    const snapshot = readSnapshot(key);
    if (!snapshot || now - snapshot.savedAt > maxAgeMs) {
      localStorage.removeItem(key);
      continue;
    }
    slots.push({ key, savedAt: snapshot.savedAt });
  }
  if (slots.length <= maxSlots) return;
  slots.sort((a, b) => b.savedAt - a.savedAt);
  for (const { key } of slots.slice(maxSlots)) localStorage.removeItem(key);
}

function isGistRef(value: unknown): value is GistRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Partial<GistRef>;
  return (
    typeof ref.id === "string" &&
    typeof ref.owner === "string" &&
    Array.isArray(ref.fileNames) &&
    ref.fileNames.every(name => typeof name === "string")
  );
}

// Storage access is best-effort throughout this file: a browser with storage
// full or blocked (private mode, site data off) throws on write, and on read
// even the `localStorage` reference throws. Losing autosave degrades the
// editor; an uncaught throw here takes it down entirely.
function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn("autosave write failed:", e);
  }
}

/** Parse the snapshot stored under `key`, or null if missing/corrupt. */
function readSnapshot(key: string): AutosaveSnapshot | null {
  const raw = getItem(key);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (isAutosaveSnapshot(parsed)) return parsed;
  return withoutGist(parsed);
}

function slotKey(id: string): string {
  return `${slotPrefix}${id}`;
}

/** Every autosave slot key in storage, excluding the shared "last" key: that
 *  single bounded entry is deliberately never swept, so a new tab can still
 *  pick up the latest work after its source slot expires. Keys are collected
 *  up front: removing during iteration shifts indices and skips entries. */
function slotKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(slotPrefix) && key !== lastKey) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

/** Salvage a snapshot whose gist ref doesn't match this build's schema (an
 *  older or newer deploy wrote the slot): the shader source is still the user's
 *  work, and a save without a gist ref simply creates a new gist. */
function withoutGist(value: unknown): AutosaveSnapshot | null {
  if (!value || typeof value !== "object" || !("gist" in value)) return null;
  const { gist: _gist, ...rest } = value as AutosaveSnapshot;
  return isAutosaveSnapshot(rest) ? rest : null;
}
