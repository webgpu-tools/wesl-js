import LZString from "lz-string";
import type { WeslProject } from "wesl";

const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } =
  LZString;

export type PersistedProject = Omit<WeslProject, "libs">;

/** Editable shader state that is safe to persist or share. */
export interface ShaderDocument {
  project: PersistedProject;
  title: string;
}

export const fragmentPrefix = "v1=";
export const maxTitleLength = 64;
/** Hard cap on the encoded fragment, including the `v1=` prefix. ~32K stays
 *  within Chrome's address-bar comfort zone; lz-string typically yields
 *  ~3-5x compression so this covers ~100-150KB of shader source. */
export const maxFragmentLength = 32_000;

/** Validate a decoded shader document's shape and bounds. */
export function isShaderDocument(value: unknown): value is ShaderDocument {
  const v = value as Partial<ShaderDocument> | null;
  if (!v) return false;
  if (typeof v.title !== "string" || v.title.length > maxTitleLength) {
    return false;
  }
  return isProject(v.project);
}

/** Encode a document into a `#v1=<lz-string>` fragment. Returns `null` if the
 *  encoded URL would exceed `maxFragmentLength`. */
export function encodeFragment(document: ShaderDocument): string | null {
  const json = JSON.stringify(document);
  const fragment = `#${fragmentPrefix}${compressToEncodedURIComponent(json)}`;
  if (fragment.length > maxFragmentLength) return null;
  return fragment;
}

/** Decode a `#v1=...` fragment string. Returns `null` if missing/invalid. */
export function decodeFragment(hash: string): ShaderDocument | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(fragmentPrefix)) return null;
  const compressed = raw.slice(fragmentPrefix.length);
  const json = decompressFromEncodedURIComponent(compressed);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!isShaderDocument(parsed)) return null;
    return { ...parsed, project: persistProject(parsed.project) };
  } catch {
    return null;
  }
}

/** Remove hydrated runtime libraries from a project before persistence. */
export function persistProject(project: WeslProject): PersistedProject {
  const { libs: _libs, ...persisted } = project;
  return persisted;
}

function isProject(p: unknown): p is WeslProject {
  if (!p || typeof p !== "object") return false;
  return isStringRecord((p as WeslProject).weslSrc);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object") return false;
  return Object.values(v).every(x => typeof x === "string");
}
