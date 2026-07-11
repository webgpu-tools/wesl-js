/**
 * Compose the multi-file payload saved to a GitHub gist: the `.wesl` sources,
 * a `package.json` (name + parsed library dependencies), a `README.md` backlink,
 * and an optional `thumbnail.png.base64`.
 *
 * Gists store text, not binary, so the thumbnail is carried base64-encoded;
 * consumers rebuild a data URL from the file content.
 */

import { moduleToRelativePath } from "wesl";
import { dependencyNames } from "./Dependencies.ts";
import type { ShaderDocument } from "./Share.ts";

/** A gist file's content, matching the GitHub gists API shape. */
export interface GistFile {
  content: string;
}

export type GistFiles = Record<string, GistFile>;
export type GistChanges = Record<string, GistFile | null>;

interface GistOptions {
  wgslPlayVersion: string;
  thumbnailBase64?: string;
}

const siteUrl = "https://wgsl-play.dev";
export const thumbnailFilename = "thumbnail.png.base64";

/** Build the full gist file map for a document, including the thumbnail if given. */
export function buildGistFiles(
  payload: ShaderDocument,
  options: GistOptions,
): GistFiles {
  const { thumbnailBase64, wgslPlayVersion } = options;
  const files: GistFiles = {};
  const packageName = payload.project.packageName ?? "package";
  for (const [key, content] of Object.entries(payload.project.weslSrc ?? {})) {
    files[moduleToFilename(key, packageName)] = { content };
  }
  files["package.json"] = {
    content: `${packageJson(payload, wgslPlayVersion)}\n`,
  };
  files["README.md"] = { content: readme(payload.title) };
  if (thumbnailBase64) files[thumbnailFilename] = { content: thumbnailBase64 };
  return files;
}

/** Convert a title to a lowercase, hyphen-separated name. */
export function slug(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "wgsl-shader";
}

/** Map a weslSrc module-path key to a gist filename (`package::main` -> `main.wesl`). */
export function moduleToFilename(key: string, packageName = "package"): string {
  if (key.includes("::")) {
    const path = moduleToRelativePath(key, packageName);
    if (path === undefined) throw new Error(`external module key: ${key}`);
    return `${path}.wesl`;
  }
  const name = key.replace(/^\.\//, "");
  return /\.(wesl|wgsl)$/.test(name) ? name : `${name}.wesl`;
}

/** Compose the installable package manifest for a saved shader. */
function packageJson(payload: ShaderDocument, wgslPlayVersion: string): string {
  const libs = dependencyNames(payload.project);
  const pkg: Record<string, unknown> = {
    name: slug(payload.title),
    version: "0.0.0",
    private: true,
    description: payload.title,
    dependencies: Object.fromEntries([
      ["wgsl-play", wgslPlayVersion],
      ...libs.map(name => [name, "*"]),
    ]),
  };
  // Versions are pinned against the curated catalog later; "*" snapshots intent.
  return JSON.stringify(pkg, null, 2);
}

function readme(title: string): string {
  return `# ${title}\n\nA WESL/WGSL shader created with [wgsl-play.dev](${siteUrl}).\n`;
}
