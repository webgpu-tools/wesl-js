/**
 * Editor state is autosaved into per-tab "slots" in localStorage.
 *
 * Each tab holds a session-id in sessionStorage; that id names a slot
 * `wgsl-play.buffer.<id>` so reloading a tab restores its own buffer
 * and concurrent tabs don't clobber each other. Every write also mirrors
 * to a shared `wgsl-play.buffer.last` key, which seeds new tabs with
 * the most recent buffer across the app.
 *
 * `sweepOldSlots` caps storage at the N most-recent slots and drops
 * anything older than 30 days.
 */

import { isShaderDocument, type ShaderDocument } from "./Share.ts";

/** A snapshot of editor state persisted to a localStorage slot. */
export interface AutosaveSnapshot extends ShaderDocument {
  savedAt: number;
}

export const slotPrefix = "wgsl-play.buffer.";
export const lastKey = "wgsl-play.buffer.last";
const sessionIdKey = "wgsl-play.session-id";
const maxSlots = 20;
const maxAgeMs = 30 * 24 * 60 * 60 * 1000;

/** Validate that `value` matches the autosave snapshot shape. */
export function isAutosaveSnapshot(value: unknown): value is AutosaveSnapshot {
  return (
    isShaderDocument(value) &&
    typeof (value as AutosaveSnapshot).savedAt === "number"
  );
}

/** Read the current tab's session-id, allocating one if needed. */
export function getOrCreateSessionId(): string {
  let id = sessionStorage.getItem(sessionIdKey);
  if (!id) {
    id = newId();
    sessionStorage.setItem(sessionIdKey, id);
  }
  return id;
}

/** Peek at the tab's session-id without allocating. */
export function getSessionId(): string | null {
  return sessionStorage.getItem(sessionIdKey);
}

/** Pin the tab's session-id, e.g. after adopting a slot from a shared URL. */
export function setSessionId(id: string): void {
  sessionStorage.setItem(sessionIdKey, id);
}

/** Read the snapshot stored in slot `id`, or null if missing/corrupt. */
export function readSlot(id: string): AutosaveSnapshot | null {
  return readKey(slotKey(id));
}

/** Persist `snapshot` to slot `id` and mirror it to the shared "last" slot. */
export function writeSlot(id: string, snapshot: AutosaveSnapshot): void {
  const json = JSON.stringify(snapshot);
  localStorage.setItem(slotKey(id), json);
  localStorage.setItem(lastKey, json);
}

/** Read the most recently written snapshot across all tabs. */
export function readLast(): AutosaveSnapshot | null {
  return readKey(lastKey);
}

/** Allocate a fresh slot id and seed both slot + last with the snapshot. */
export function allocateSlot(snapshot: AutosaveSnapshot): string {
  const id = newId();
  writeSlot(id, snapshot);
  return id;
}

/** Drop slots older than 30 days, keep at most the N most-recent. */
export function sweepOldSlots(): void {
  const now = Date.now();
  // Snapshot keys first; removing during iteration over localStorage.length
  // shifts indices and skips entries.
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isSlotKey(key)) keys.push(key);
  }
  const slots: Array<{ key: string; savedAt: number }> = [];
  for (const key of keys) {
    const snapshot = readKey(key);
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

function newId(): string {
  return crypto.randomUUID();
}

function readKey(key: string): AutosaveSnapshot | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isAutosaveSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function slotKey(id: string): string {
  return `${slotPrefix}${id}`;
}

function isSlotKey(key: string): boolean {
  return key.startsWith(slotPrefix) && key !== lastKey;
}
