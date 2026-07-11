/**
 * Compose the multi-file payload saved to a GitHub gist: the `.wesl` sources,
 * a `package.json` (name + parsed library dependencies), a `README.md` backlink,
 * and an optional `thumbnail.png`.
 *
 * Gists store text, not binary, so the thumbnail is carried base64-encoded;
 * consumers rebuild a data URL from the file content.
 */

import { findUnboundIdents, RecordResolver } from "wesl";
import type { ShaderDocument } from "./Share.ts";

/** A gist file's content, matching the GitHub gists API shape. */
export interface GistFile {
  content: string;
}

export type GistFiles = Record<string, GistFile>;

const siteUrl = "https://wgsl-play.dev";

/** Roots that resolve locally or to runtime-virtual modules, not npm packages. */
const localRoots = new Set(["package", "super", "env", "constants"]);

/** Build the full gist file map for a buffer, including the thumbnail if given. */
export function buildGistFiles(
  payload: ShaderDocument,
  thumbnailBase64?: string,
): GistFiles {
  const files: GistFiles = {};
  for (const [key, content] of Object.entries(payload.project.weslSrc ?? {})) {
    files[moduleToFilename(key)] = { content };
  }
  files["package.json"] = { content: `${packageJson(payload)}\n` };
  files["README.md"] = { content: readme(payload.title) };
  if (thumbnailBase64) files["thumbnail.png"] = { content: thumbnailBase64 };
  return files;
}

/** External npm library roots imported by the project (e.g. `lygia`). */
export function externalLibs(weslSrc: Record<string, string>): string[] {
  let unbound: string[][];
  try {
    unbound = findUnboundIdents(new RecordResolver(weslSrc));
  } catch {
    return [];
  }
  const roots = unbound
    .filter(path => path.length > 1 && !localRoots.has(path[0]))
    .map(path => path[0]);
  return [...new Set(roots)].sort();
}

/** Slugify a title into an npm-safe package name. */
export function slug(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "wgsl-shader";
}

/** Map a weslSrc module-path key to a gist filename (`package::main` -> `main.wesl`). */
export function moduleToFilename(key: string): string {
  if (key.includes("::")) {
    return `${key.replace(/^[^:]+::/, "").replaceAll("::", "/")}.wesl`;
  }
  const name = key.replace(/^\.\//, "");
  return /\.(wesl|wgsl)$/.test(name) ? name : `${name}.wesl`;
}

function packageJson(payload: ShaderDocument): string {
  const libs = externalLibs(payload.project.weslSrc ?? {});
  const pkg: Record<string, unknown> = {
    name: slug(payload.title),
    version: "0.0.0",
    private: true,
    description: payload.title,
  };
  // Versions are pinned against the curated catalog later; "*" snapshots intent.
  if (libs.length)
    pkg.dependencies = Object.fromEntries(libs.map(l => [l, "*"]));
  return JSON.stringify(pkg, null, 2);
}

function readme(title: string): string {
  return `# ${title}\n\nA WESL/WGSL shader created with [wgsl-play.dev](${siteUrl}).\n`;
}
