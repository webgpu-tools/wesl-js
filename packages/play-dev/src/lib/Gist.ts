/**
 * Compose the multi-file payload saved to a GitHub gist; `gistToDocument` is
 * the inverse, used when a `/gist/{owner}/{id}` URL is opened. A typical
 * saved gist:
 *
 * ```
 * main.wesl             <- package::main (the root, by convention)
 * util.wesl             <- package::util
 * package.json          name (slugged title), library deps, wesl config
 * README.md             backlink to wgsl-play.dev
 * thumbnail.png.base64  optional; gists store text, so the PNG rides base64
 * ```
 *
 * Shader filenames always end in `.wesl`/`.wgsl` (`moduleToFilename` appends
 * the suffix), so they can never collide with the bookkeeping names; the load
 * side here and the delete rule in Save.ts classify files purely by that
 * suffix, never by name.
 */

import {
  defaultRootModule,
  fileToModulePath,
  isWeslFile,
  moduleToRelativePath,
  normalizeModuleName,
} from "wesl";
import type { WeslToml } from "wesl-tooling";
import { dependencyNames } from "./Dependencies.ts";
import type { LoadedGist } from "./GitHub.ts";
import { maxTitleLength, type ShaderDocument } from "./Share.ts";

/** A gist file's content, matching the GitHub gists API shape. */
export interface GistFile {
  content: string;
}

export type GistFiles = Record<string, GistFile>;
export type GistChanges = Record<string, GistFile | null>;

/** Identity of a gist in the site's `/gist/{owner}/{id}` URL scheme. */
export interface GistRoute {
  owner: string;
  id: string;
}

interface GistOptions {
  wgslPlayVersion: string;
  thumbnailBase64?: string;
}
export const thumbnailFilename = "thumbnail.png.base64";
const packageJsonFilename = "package.json";
const readmeFilename = "README.md";

/**
 * JSON form of the wesl.toml vocabulary (wesl-spec WeslToml.md), carried
 * under a `wesl` key in the gist's package.json. `main` is ahead of the
 * spec: saves write a single bare module name, but reads accept an array so
 * future multi-entry configs don't orphan early gists.
 */
interface WeslConfig extends Partial<WeslToml> {
  main?: string | string[];

  /** "auto": resolve from the package manager's installed libraries. */
  dependencies?: "auto" | Record<string, unknown>;
}

const weslEdition = "2026_pre";

const siteUrl = "https://wgsl-play.dev";
/** The module a multi-file shader is rooted at by convention. */
const mainModule = `package::${defaultRootModule}`;

/** Build the full gist file map for a document, including the thumbnail if given. */
export function buildGistFiles(
  doc: ShaderDocument,
  options: GistOptions,
): GistFiles {
  const { thumbnailBase64, wgslPlayVersion } = options;
  const files: GistFiles = {};
  const packageName = doc.project.packageName ?? "package";
  for (const [key, content] of Object.entries(doc.project.weslSrc ?? {})) {
    const filename = moduleToFilename(key, packageName);
    // Gist filenames can't hold directories. The editor rejects '/' names
    // (flat-files), but a nested module can still arrive via a shared
    // fragment; fail here with a message rather than an opaque API error.
    if (filename.includes("/")) {
      throw new Error(`nested module can't be saved to a gist: ${key}`);
    }
    files[filename] = { content };
  }
  const manifest = packageJson(doc, wgslPlayVersion);
  files[packageJsonFilename] = { content: `${manifest}\n` };
  files[readmeFilename] = { content: readme(doc.title) };
  if (thumbnailBase64) files[thumbnailFilename] = { content: thumbnailBase64 };
  return files;
}

/**
 * Rebuild an editor document from a fetched gist: the inverse of
 * `buildGistFiles`. Only `.wesl` / `.wgsl` files become editor sources;
 * `package.json`, `README.md` and the thumbnail are gist bookkeeping.
 * Returns null when the gist holds no shader source.
 */
export function gistToDocument(gist: LoadedGist): ShaderDocument | null {
  const weslSrc: Record<string, string> = {};
  for (const [name, content] of Object.entries(gist.files)) {
    if (!isWeslFile(name)) continue;
    weslSrc[fileToModulePath(name, "package", false)] = content;
  }
  const modules = Object.keys(weslSrc);
  if (modules.length === 0) return null;
  const rootModuleName = rootModule(gist, modules);
  // The gist description is the title; cap it so the buffer still validates.
  const title = gist.description.trim().slice(0, maxTitleLength);
  return { project: { weslSrc, rootModuleName }, title };
}

/** Parse a `/gist/{owner}/{id}` path; null for any other path. */
export function gistRoute(pathname: string): GistRoute | null {
  const match = /^\/gist\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const [, owner, id] = match;
  return { owner: decodePart(owner), id: decodePart(id) };
}

/** The site path that permalinks a gist. Re-encodes both parts, so the
 *  scheme round-trips reserved characters (`gistRoute` decodes them). */
export function gistPath(gist: GistRoute): string {
  return `/gist/${encodeURIComponent(gist.owner)}/${encodeURIComponent(gist.id)}`;
}

/** Convert a title to a lowercase, hyphen-separated name. */
export function slug(title: string): string {
  const hyphenated = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return hyphenated || "wgsl-shader";
}

/** Map a weslSrc module-path key to a gist filename (`package::main` -> `main.wesl`). */
export function moduleToFilename(key: string, packageName = "package"): string {
  if (key.includes("::")) {
    const path = moduleToRelativePath(key, packageName);
    if (path === undefined) throw new Error(`external module key: ${key}`);
    return `${path}.wesl`;
  }
  const name = key.replace(/^\.\//, "");
  return isWeslFile(name) ? name : `${name}.wesl`;
}

/** Compose the installable package manifest for a saved shader. */
function packageJson(doc: ShaderDocument, wgslPlayVersion: string): string {
  // The editor fetches libraries from npm at their latest version and keeps no
  // record of which one it got, so there is no version to pin here.
  const libs = dependencyNames(doc.project).map(name => [name, "*"]);
  const pkg = {
    name: slug(doc.title),
    version: "0.0.0",
    private: true,
    description: doc.title,
    dependencies: Object.fromEntries([["wgsl-play", wgslPlayVersion], ...libs]),
    wesl: weslConfig(doc),
  };
  return JSON.stringify(pkg, null, 2);
}

/** The wesl config for a saved gist: sources flat at the gist root, deps
 *  resolved from the package.json this rides in, and which module is the root. */
function weslConfig(doc: ShaderDocument): WeslConfig {
  const config: WeslConfig = {
    edition: weslEdition,
    root: ".",
    dependencies: "auto",
  };
  const main = bareRootModule(doc);
  return main ? { ...config, main } : config;
}

/**
 * The document's root module relative to its package (`package::fx::glow` ->
 * `fx::glow`), the form recorded as `wesl.main`. Undefined when the project
 * has no root or one outside its own package - then nothing is recorded and
 * a later load falls back to inference.
 */
function bareRootModule(doc: ShaderDocument): string | undefined {
  const root = doc.project.rootModuleName;
  if (!root) return undefined;
  const packageName = doc.project.packageName ?? "package";
  const path = normalizeModuleName(root);
  const prefix = ["package::", `${packageName}::`].find(p =>
    path.startsWith(p),
  );
  return prefix ? path.slice(prefix.length) : undefined;
}

/** The root module for a loaded gist: the recorded `wesl.main` when it names
 *  a module actually present, else `package::main` by convention, else the
 *  first module GitHub returned. */
function rootModule(gist: LoadedGist, modules: string[]): string {
  const recorded = recordedMain(gist.files[packageJsonFilename]);
  if (recorded && modules.includes(recorded)) return recorded;
  return modules.includes(mainModule) ? mainModule : modules[0];
}

/** Parse the recorded root module out of the gist's package.json; null when
 *  absent or hand-edited into an unreadable state (gists are editable on
 *  GitHub, so every read here is best-effort). */
function recordedMain(packageJson: string | undefined): string | null {
  if (!packageJson) return null;
  try {
    const pkg = JSON.parse(packageJson) as { wesl?: WeslConfig };
    const main = pkg.wesl?.main;
    const first = Array.isArray(main) ? main[0] : main;
    if (typeof first !== "string" || !first) return null;
    return first.startsWith("package::") ? first : `package::${first}`;
  } catch {
    return null;
  }
}

function readme(title: string): string {
  return `# ${title}\n\nA WESL/WGSL shader created with [wgsl-play.dev](${siteUrl}).\n`;
}

/** Decode a percent-encoded path segment; a malformed escape (e.g. a
 *  truncated link) keeps the raw text rather than throwing URIError. */
function decodePart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}
