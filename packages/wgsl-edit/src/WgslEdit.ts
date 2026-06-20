import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { type Diagnostic, forceLinting, lintKeymap } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import {
  Compartment,
  type EditorSelection,
  EditorState,
  type Extension,
  Text,
  Transaction,
} from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  gutters,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import {
  type Conditions,
  fileToModulePath,
  type LinkParams,
  link,
  type WeslBundle,
  type WeslProject,
} from "wesl";
import { fetchPackagesByName } from "wesl-fetch";
import { createWeslLinter, wesl } from "./Language.ts";
import { saveEndpoint } from "./SaveEndpoint.ts";
import cssText from "./WgslEdit.css?inline";

type Theme = "light" | "dark" | "auto";

type LintMode = "on" | "off";

interface FileState {
  doc: Text;
  /** Authoritative once the file has been active; carries the per-file undo history. */
  state?: EditorState;
  scrollPos?: number;
  selection?: EditorSelection;
}

/** `autosave` CustomEvent detail: full project snapshot + dirty file names. */
export interface AutosaveDetail {
  project: WeslProject;
  dirty: string[];
}

/** Attributes accepted by `<wgsl-edit>` beyond standard HTML.
 *  Source of truth for framework-specific JSX augmentations (see `./jsx-preact.ts`). */
export interface WgslEditAttrs {
  /** Color theme; `"auto"` follows `prefers-color-scheme`. */
  theme?: "light" | "dark" | "auto";
  /** ID of an element (e.g. `<wgsl-play>`) to source compile diagnostics from. */
  "lint-from"?: string;
}

type GpuMessage = {
  offset: number;
  length: number;
  severity: string;
  message: string;
};
type LinkedSourceMap = {
  sourceMap: {
    destToSrc(offset: number): { position: number; src: { path?: string } };
  };
};

/*  WESL syntax colors
 *
 *  | Name       | Elements                             |
 *  |------------|--------------------------------------|
 *  | variable   | variables, params, struct members    |
 *  | keyword    | import, package, super, booleans     |
 *  | control    | fn, if, return, break, for, while    |
 *  | type       | types, type defs, template calls     |
 *  | fn         | function name definitions            |
 *  | number     | numeric literals                     |
 *  | comment    | line and block comments              |
 *  | modulePath | import path identifiers              |
 */

// prettier-ignore
const light = {
  variable: "#000f80",
  keyword: "#0000ff",
  control: "#af00db",
  type: "#891a1a",
  fn: "#795e26",
  number: "#098658",
  comment: "#008000",
  modulePath: "#0070c1",
};

// prettier-ignore
const dark = {
  variable: "#9cdcfe",
  keyword: "#569cd6",
  control: "#c586c0",
  type: "#4ec9b0",
  fn: "#dcdcaa",
  number: "#b5cea8",
  comment: "#6a9955",
  modulePath: "#4fc1ff",
};

const lightColors = weslColors(light);
const darkColors = weslColors(dark);

let cachedStyleSheet: CSSStyleSheet | undefined;

export class WgslEdit extends HTMLElement {
  static observedAttributes = [
    "src",
    "readonly",
    "theme",
    "shader-root",
    "tabs",
    "lint",
    "lint-from",
    "line-numbers",
    "fetch-libs",
    "gpu-lint",
    "autosave",
  ];

  private editorView: EditorView | null = null;
  private editorContainer: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private snackbar: HTMLDivElement;
  private readonlyCompartment = new Compartment();
  private themeCompartment = new Compartment();
  private lintCompartment = new Compartment();
  private lineNumbersCompartment = new Compartment();
  private _pendingSource: string | null = null;
  private _theme: Theme = "auto";
  private _mediaQuery: MediaQueryList | null = null;
  private _visibilityObserver: IntersectionObserver | null = null;
  private _lineNumbers = false;

  private _files: Map<string, FileState> = new Map();
  private _activeFile = "";
  private _rootModuleName: string | undefined;
  private _tabs = true;
  private _lint: LintMode = "on";
  private _gpuLint = true;
  private _fetchLibs = true;
  private _conditions: Conditions = {};
  private _constants: Record<string, string | number> | undefined;
  private _packageName: string | undefined;
  private _libs: WeslBundle[] = [];
  private _ignorePackages: string[] = ["constants", "env"];
  private _fetchingPkgs = new Set<string>();
  private _fetchedPkgs = new Set<string>();
  private _snackTimer: ReturnType<typeof setTimeout> | undefined;
  private _devSaveListener: ((e: Event) => void) | null = null;
  private _saveTimer: ReturnType<typeof setTimeout> | undefined;
  private _dirtyFiles = new Set<string>();
  private _switchingFile = false;
  private _externalDiagnostics: Diagnostic[] = [];
  private _lintFromEl: Element | null = null;
  /** Bound listeners for lint-from element's compile events. */
  private _boundCompileError = this.onCompileError.bind(this);
  private _boundCompileSuccess = this.onCompileSuccess.bind(this);

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [getStyles()];

    this.tabBar = document.createElement("div");
    this.tabBar.className = "tab-bar";
    shadow.appendChild(this.tabBar);

    this.editorContainer = document.createElement("div");
    this.editorContainer.className = "editor-container";
    shadow.appendChild(this.editorContainer);

    this.snackbar = document.createElement("div");
    this.snackbar.className = "snackbar";
    this.snackbar.textContent = "Loading\u2026";
    shadow.appendChild(this.snackbar);
  }

  connectedCallback(): void {
    this.initEditor();
    this.loadInitialContent();
    this.observeVisibility();
    const props = ["conditions", "source", "sources", "project", "autosave"];
    for (const p of props) upgradeProperty(this, p);
  }

  disconnectedCallback(): void {
    this.connectLintSource(null);
    this._visibilityObserver?.disconnect();
    this._visibilityObserver = null;
    this.editorView?.destroy();
    this.editorView = null;
  }

  /** CodeMirror can't measure while hidden (e.g. inside a closed <details>),
   *  so it lays out at the wrong height. Re-measure whenever we become visible. */
  private observeVisibility(): void {
    if (typeof IntersectionObserver === "undefined") return;
    this._visibilityObserver = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting))
        this.editorView?.requestMeasure();
    });
    this._visibilityObserver.observe(this);
  }

  attributeChangedCallback(
    name: string,
    _old: string | null,
    value: string | null,
  ): void {
    switch (name) {
      case "src":
        if (value && this.editorView) this.loadFromUrl(value);
        break;
      case "readonly":
        this.updateReadonly();
        break;
      case "theme":
        this.theme = (value as Theme) || "auto";
        break;
      case "tabs":
        this._tabs = value !== "false";
        this.renderTabs();
        break;
      case "lint":
        this._lint = (value as LintMode) || "on";
        this.updateLint();
        break;
      case "lint-from":
        this.connectLintSource(value);
        break;
      case "line-numbers":
        this._lineNumbers = value === "true";
        this.updateLineNumbers();
        break;
      case "fetch-libs":
        this._fetchLibs = value !== "false";
        this.updateLint();
        break;
      case "gpu-lint":
        this._gpuLint = value !== "off";
        this.updateLint();
        break;
      case "autosave":
        if (value !== null && value !== "false") this.enableDevSave();
        else this.disableDevSave();
        break;
    }
  }

  /** Conditions for conditional compilation (@if/@elif/@else). */
  get conditions(): Conditions {
    return this._conditions;
  }

  set conditions(value: Conditions) {
    this._conditions = value;
    this.updateLint();
    this.dispatchChange();
  }

  /** Reconfigure a compartment via the active editor view (no-op if unmounted). */
  private reconfigure(comp: Compartment, ext: Extension): void {
    this.editorView?.dispatch({ effects: comp.reconfigure(ext) });
  }

  /** Active file content (single-file API). */
  get source(): string {
    return this.editorView?.state.doc.toString() ?? this._pendingSource ?? "";
  }

  /** Set active file content (single-file API). Auto-creates a default file entry. */
  set source(value: string) {
    if (!this._activeFile && this._files.size === 0) {
      this._files.set("main.wesl", { doc: toDoc(value) });
      this._activeFile = "main.wesl";
      this.renderTabs();
    }
    if (this.editorView) {
      // Replace content via a non-history transaction so autosave/change
      // listeners fire but initial-load content doesn't land on the undo stack.
      const docLength = this.editorView.state.doc.length;
      this.editorView.dispatch({
        changes: { from: 0, to: docLength, insert: value },
        annotations: Transaction.addToHistory.of(false),
      });
    } else {
      this._pendingSource = value;
      const entry = this._files.get(this._activeFile);
      if (entry) entry.doc = toDoc(value);
    }
  }

  /** All file contents keyed by module path (e.g., "package::main"). */
  get sources(): Record<string, string> {
    this.saveCurrentFileState();
    const pkg = this.pkgName();
    const result: Record<string, string> = {};
    for (const [tabName, state] of this._files) {
      result[fileToModulePath(tabName, pkg, false)] = state.doc.toString();
    }
    return result;
  }

  /** Set all files (replaces existing). */
  set sources(value: Record<string, string>) {
    this._files.clear();
    for (const [key, content] of Object.entries(value)) {
      const tabName = toTabName(key);
      this._files.set(tabName, { doc: toDoc(content) });
    }
    const firstKey = Object.keys(value)[0];
    if (firstKey) this.switchToFile(toTabName(firstKey));
    this.renderTabs();
  }

  /** Snapshot of all editor state needed to link: sources, conditions, libs, root module. */
  get project(): WeslProject {
    return {
      weslSrc: this.sources,
      rootModuleName: this._rootModuleName,
      conditions: this._conditions,
      constants: this._constants,
      libs: this._libs,
      packageName: this._packageName,
      shaderRoot: this.shaderRoot ?? undefined,
    };
  }

  set project(value: WeslProject) {
    const { weslSrc, rootModuleName, conditions } = value;
    const { constants, packageName, libs, shaderRoot } = value;
    if (conditions !== undefined) this._conditions = conditions;
    if (constants !== undefined) this._constants = constants;
    if (packageName !== undefined) this._packageName = packageName;
    if (libs !== undefined) this._libs = libs;
    if (rootModuleName !== undefined) this._rootModuleName = rootModuleName;
    if (shaderRoot !== undefined && !this.hasAttribute("shader-root")) {
      this.shaderRoot = shaderRoot;
    }

    if (weslSrc) {
      this.sources = weslSrc;
      const tab = toTabName(this._rootModuleName ?? "");
      if (tab) this.activeFile = tab;
    }
    this.updateLint();
    this.dispatchChange();
  }

  /** Link/compile WESL sources into WGSL. Returns the compiled WGSL string. */
  async link(options?: Partial<LinkParams>): Promise<string> {
    const linked = await link({ ...this.linkParams(), ...options });
    return linked.dest;
  }

  private linkParams(): LinkParams {
    return {
      weslSrc: this.sources,
      rootModuleName: this._rootModuleName ?? this.activeModulePath(),
      conditions: this._conditions,
      constants: this._constants,
      libs: this._libs,
      packageName: this.pkgName(),
    };
  }

  get libs(): WeslBundle[] {
    return this._libs;
  }

  /** Root module for linking (stable across tab switches). */
  get rootModuleName(): string | undefined {
    return this._rootModuleName;
  }

  set rootModuleName(value: string | undefined) {
    this._rootModuleName = value;
    this.dispatchChange();
  }

  get activeFile(): string {
    return this._activeFile;
  }

  set activeFile(name: string) {
    this.switchToFile(name);
  }

  get fileNames(): string[] {
    return Array.from(this._files.keys());
  }

  get tabs(): boolean {
    return this._tabs;
  }

  set tabs(value: boolean) {
    this._tabs = value;
    this.renderTabs();
  }

  /** Lint mode: "on" (default) or "off". */
  get lint(): LintMode {
    return this._lint;
  }

  set lint(value: LintMode) {
    this._lint = value;
    this.updateLint();
  }

  /** Line numbers visibility (default: true). */
  get lineNumbers(): boolean {
    return this._lineNumbers;
  }

  set lineNumbers(value: boolean) {
    this._lineNumbers = value;
    if (value) this.setAttribute("line-numbers", "true");
    else this.removeAttribute("line-numbers");
  }

  /** GPU validation of linked WGSL (default: true). Set to false to disable. */
  get gpuLint(): boolean {
    return this._gpuLint;
  }

  set gpuLint(value: boolean) {
    this._gpuLint = value;
    if (!value) this.setAttribute("gpu-lint", "off");
    else this.removeAttribute("gpu-lint");
  }

  /** Persist edits to disk via the dev-server save endpoint.
   *  Requires `wgslEditAutosave()` to be installed in vite.config.ts. */
  get autosave(): boolean {
    return this._devSaveListener !== null;
  }

  set autosave(value: boolean) {
    if (value) {
      this.enableDevSave();
      this.setAttribute("autosave", "");
    } else {
      this.disableDevSave();
      this.removeAttribute("autosave");
    }
  }

  /** Whether to auto-fetch missing library packages from npm (default: true). */
  get fetchLibs(): boolean {
    return this._fetchLibs;
  }

  set fetchLibs(value: boolean) {
    this._fetchLibs = value;
    if (value) this.removeAttribute("fetch-libs");
    else this.setAttribute("fetch-libs", "false");
  }

  get loading(): boolean {
    return this.snackbar.classList.contains("visible");
  }

  set loading(value: boolean) {
    if (value) this.showSnack("Loading\u2026");
    else this.hideSnack();
  }

  /** Show the snackbar with a message. Auto-hides after `ms` if provided. */
  private showSnack(msg: string, ms?: number): void {
    clearTimeout(this._snackTimer);
    this.snackbar.textContent = msg;
    this.snackbar.classList.add("visible");
    console.log("wgsl-edit showSnack:", msg);
    if (ms) this._snackTimer = setTimeout(() => this.hideSnack(), ms);
  }

  private hideSnack(): void {
    clearTimeout(this._snackTimer);
    this.snackbar.classList.remove("visible");
  }

  get readonly(): boolean {
    return this.hasAttribute("readonly");
  }

  set readonly(value: boolean) {
    if (value) this.setAttribute("readonly", "");
    else this.removeAttribute("readonly");
  }

  get theme(): Theme {
    return this._theme;
  }

  set theme(value: Theme) {
    this._theme = value;
    this.updateTheme();
  }

  get shaderRoot(): string | null {
    return this.getAttribute("shader-root");
  }

  set shaderRoot(value: string | null) {
    if (value) this.setAttribute("shader-root", value);
    else this.removeAttribute("shader-root");
  }

  /** Add a new file and switch to it. No-op if `name` already exists. */
  addFile(name: string, content = ""): void {
    if (this._files.has(name)) return;
    this._files.set(name, { doc: toDoc(content) });
    this.switchToFile(name);
    this.renderTabs();
    this.dispatchFileChange("add", name);
  }

  /** Remove a file. No-op if it is missing or is the last remaining file. */
  removeFile(name: string): void {
    if (!this._files.has(name) || this._files.size <= 1) return;
    this._files.delete(name);
    if (this._activeFile === name) {
      const firstFile = this._files.keys().next().value!;
      this.switchToFile(firstFile);
    }
    this.renderTabs();
    this.dispatchFileChange("remove", name);
  }

  /** Rename a file, preserving its document and editor state. No-op on collision. */
  renameFile(oldName: string, newName: string): void {
    const state = this._files.get(oldName);
    if (!state || this._files.has(newName)) return;
    this._files.delete(oldName);
    this._files.set(newName, state);
    if (this._activeFile === oldName) this._activeFile = newName;
    this.renderTabs();
    this.dispatchFileChange("rename", newName);
  }

  /** Switch to a file, saving current state and restoring target state. */
  private switchToFile(name: string): void {
    if (!this._files.has(name) || name === this._activeFile) return;
    this.saveCurrentFileState();
    this._activeFile = name;

    const fileState = this._files.get(name)!;
    const view = this.editorView;
    if (view) {
      const state = fileState.state ?? this.createFileState(fileState.doc);
      fileState.state = state;
      view.setState(state);
      if (fileState.scrollPos != null) {
        view.scrollDOM.scrollTop = fileState.scrollPos;
      }
    }
    this.renderTabs();
  }

  /** Build a fresh EditorState seeded with `doc` and the current extension set. */
  private createFileState(doc: Text | string): EditorState {
    return EditorState.create({ doc, extensions: this.buildExtensions() });
  }

  private saveCurrentFileState(): void {
    const view = this.editorView;
    const fileState = this._activeFile
      ? this._files.get(this._activeFile)
      : undefined;
    if (!view || !fileState) return;
    fileState.state = view.state;
    fileState.doc = view.state.doc;
    fileState.selection = view.state.selection;
    fileState.scrollPos = view.scrollDOM.scrollTop;
  }

  private pkgName(): string {
    return this._packageName ?? "package";
  }

  private activeModulePath(): string {
    return fileToModulePath(this._activeFile, this.pkgName(), false);
  }

  private dispatchChange(): void {
    this.dispatchEvent(new CustomEvent("change", { detail: this.project }));
  }

  private dispatchFileChange(action: string, file: string): void {
    const detail = { action, file };
    this.dispatchEvent(new CustomEvent("file-change", { detail }));
  }

  private scheduleAutosave(): void {
    this._dirtyFiles.add(this._activeFile);
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.fireAutosave(), 500);
  }

  /** Dispatch an `autosave` event with a fresh project snapshot and the dirty-file list. */
  private fireAutosave(): void {
    const dirty = [...this._dirtyFiles];
    this._dirtyFiles.clear();
    const detail: AutosaveDetail = { project: this.project, dirty };
    this.dispatchEvent(new CustomEvent("autosave", { detail }));
  }

  private enableDevSave(): void {
    if (this._devSaveListener) return;
    this._devSaveListener = e => this.devSave(e as CustomEvent<AutosaveDetail>);
    this.addEventListener("autosave", this._devSaveListener);
  }

  private disableDevSave(): void {
    if (!this._devSaveListener) return;
    this.removeEventListener("autosave", this._devSaveListener);
    this._devSaveListener = null;
  }

  /** Built-in `autosave` listener: POST each dirty file to the dev-server save endpoint. */
  private async devSave(e: CustomEvent<AutosaveDetail>): Promise<void> {
    const root = this.shaderRoot;
    if (!root) return;
    const { project, dirty } = e.detail;
    const weslSrc = project.weslSrc;
    if (!weslSrc) return;
    const pkg = this.pkgName();
    for (const file of dirty) {
      const content = weslSrc[fileToModulePath(file, pkg, false)];
      if (content === undefined) continue;
      try {
        const res = await fetch(saveEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root, file, content }),
        });
        if (!res.ok) return this.devSaveFailed(`HTTP ${res.status}`);
      } catch (err) {
        return this.devSaveFailed(
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /** One-shot disable on first failure: avoids spamming the console on every keystroke. */
  private devSaveFailed(reason: string): void {
    this.disableDevSave();
    console.error(
      `wgsl-edit: autosave disabled (${reason}). ` +
        `Make sure wgslEditAutosave() is installed in vite.config.ts.`,
    );
  }

  /** First-time setup: read attributes, parse inline content, mount the EditorView. */
  private initEditor(): void {
    this.readInitialAttributes();
    this.parseInlineContent();

    this._mediaQuery = matchMedia("(prefers-color-scheme: dark)");
    this._mediaQuery.addEventListener("change", () => this.updateTheme());

    const firstFile = this._files.keys().next().value;
    const firstDoc = firstFile && this._files.get(firstFile)!.doc.toString();
    const initialDoc = this._pendingSource ?? firstDoc ?? "";
    this._pendingSource = null;
    if (firstFile) {
      this._activeFile = firstFile;
    } else if (initialDoc) {
      this._files.set("main.wesl", { doc: toDoc(initialDoc) });
      this._activeFile = "main.wesl";
    }

    const state = this.createFileState(initialDoc);
    const active = this._activeFile ? this._files.get(this._activeFile) : null;
    if (active) {
      active.state = state;
      active.doc = state.doc;
    }
    this.editorView = new EditorView({ state, parent: this.editorContainer });
    this.renderTabs();
  }

  private readInitialAttributes(): void {
    const themeAttr = this.getAttribute("theme") as Theme | null;
    if (themeAttr) this._theme = themeAttr;
    const tabsAttr = this.getAttribute("tabs");
    if (tabsAttr !== null) this._tabs = tabsAttr !== "false";
    const lintAttr = this.getAttribute("lint") as LintMode | null;
    if (lintAttr) this._lint = lintAttr;
    const lineNumAttr = this.getAttribute("line-numbers");
    if (lineNumAttr !== null) this._lineNumbers = lineNumAttr === "true";
    const lintFromAttr = this.getAttribute("lint-from");
    if (lintFromAttr) this.connectLintSource(lintFromAttr);
  }

  /** Assemble the full CodeMirror extension set for a fresh EditorState. */
  private buildExtensions(): Extension[] {
    const baseTheme = EditorView.theme({
      ".cm-content": { padding: "0" },
      ".cm-line": { padding: "0" },
      ".cm-panels": { position: "relative" }, // suppress firefox warning in scrollable containers
    });
    return [
      gutters({ fixed: false }),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
      ]),
      wesl(),
      baseTheme,
      this.themeCompartment.of(this.resolveTheme()),
      this.readonlyCompartment.of(EditorState.readOnly.of(this.readonly)),
      this.lintCompartment.of(this.resolveLint()),
      this.lineNumbersCompartment.of(this.resolveLineNumbers()),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          this._externalDiagnostics = [];
          this.saveCurrentFileState();
          this.dispatchChange();
          if (!this._switchingFile) this.scheduleAutosave();
        }
      }),
    ];
  }

  private resolveTheme() {
    const isDark =
      this._theme === "dark" ||
      (this._theme === "auto" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    this.classList.toggle("dark", isDark);
    return [
      EditorView.theme({}, { dark: isDark }),
      isDark ? darkColors : lightColors,
    ];
  }

  private updateTheme(): void {
    this.reconfigure(this.themeCompartment, this.resolveTheme());
  }

  private updateReadonly(): void {
    const ext = EditorState.readOnly.of(this.readonly);
    this.reconfigure(this.readonlyCompartment, ext);
    this.renderTabs();
  }

  private resolveLint() {
    if (this._lint === "off") return [];
    const useGpuLint = this._gpuLint && !this._lintFromEl;
    return createWeslLinter({
      getSources: () => this.sources,
      rootModule: () => this.activeModulePath(),
      conditions: () => this._conditions,
      packageName: () => this._packageName,
      getExternalDiagnostics: () => this._externalDiagnostics,
      getLibs: () => this._libs,
      fetchLibs: this._fetchLibs
        ? pkgs => this.fetchLibsOnDemand(pkgs)
        : undefined,
      ignorePackages: () => this._ignorePackages,
      gpuValidate: useGpuLint ? () => this.gpuValidate() : undefined,
    });
  }

  /** Link WESL->WGSL and validate via WebGPU, returning CodeMirror diagnostics. */
  private async gpuValidate(): Promise<Diagnostic[]> {
    const { validateWgsl } = await import("./GpuValidator.ts");
    const linked = await link(this.linkParams());
    const messages = await validateWgsl(linked.dest);
    return mapGpuDiagnostics(
      messages,
      linked,
      this._activeFile,
      this.pkgName(),
    );
  }

  /** Fetch missing library packages, deduplicating in-flight requests. */
  private async fetchLibsOnDemand(names: string[]): Promise<WeslBundle[]> {
    const needed = names.filter(
      n => !this._fetchedPkgs.has(n) && !this._fetchingPkgs.has(n),
    );
    if (needed.length === 0) return [];

    for (const n of needed) this._fetchingPkgs.add(n);
    this.showSnack(`Loading ${needed.join(", ")}…`);
    try {
      const bundles = await fetchPackagesByName(needed);
      this._libs = [...this._libs, ...bundles];
      for (const n of needed) this._fetchedPkgs.add(n);
      if (bundles.length > 0) {
        this.showSnack(`Loaded ${needed.join(", ")}`, 3000);
        this._externalDiagnostics = []; // stale compile errors from before libs loaded
        this.dispatchChange();
      } else this.hideSnack();
      return bundles;
    } catch (e) {
      console.warn("wgsl-edit: failed to fetch packages:", needed, e);
      this.showSnack(`Failed to load ${needed.join(", ")}`, 3000);
      return [];
    } finally {
      for (const n of needed) this._fetchingPkgs.delete(n);
    }
  }

  private updateLint(): void {
    this.reconfigure(this.lintCompartment, this.resolveLint());
  }

  /** Listen for compile-error/compile-success events from a lint source element. */
  private connectLintSource(id: string | null): void {
    const hadExternal = !!this._lintFromEl;
    const prev = this._lintFromEl;
    if (prev) {
      prev.removeEventListener("compile-error", this._boundCompileError);
      prev.removeEventListener("compile-success", this._boundCompileSuccess);
      this._lintFromEl = null;
    }
    this._externalDiagnostics = [];
    const el = id ? document.getElementById(id) : null;
    if (el) {
      this._lintFromEl = el;
      el.addEventListener("compile-error", this._boundCompileError);
      el.addEventListener("compile-success", this._boundCompileSuccess);
    }

    // Reconfigure lint when external source changes (toggles internal GPU lint)
    if (hadExternal !== !!this._lintFromEl) this.updateLint();
  }

  /** Convert external compile-error locations into CodeMirror diagnostics for the active file. */
  private onCompileError(e: Event): void {
    const detail = (e as CustomEvent).detail;
    if (!this.editorView || detail.source === "wesl") return;

    const doc = this.editorView.state.doc;
    const pkg = this.pkgName();
    const activeModule = this.activeModulePath();
    const inActiveFile = (loc: any) =>
      !loc.file || fileToModulePath(loc.file, pkg, false) === activeModule;
    this._externalDiagnostics = detail.locations
      .filter(inActiveFile)
      .map((loc: any) => {
        const line = doc.line(Math.max(1, Math.min(loc.line, doc.lines)));
        const from = Math.min(line.from + (loc.column ?? 0), doc.length);
        const to = Math.min(from + (loc.length ?? 1), doc.length);
        const { severity, message } = loc;
        return { from, to, severity, message, source: "WebGPU" } as Diagnostic;
      });
    if (this._externalDiagnostics.length) forceLinting(this.editorView);
  }

  private onCompileSuccess(): void {
    if (this._externalDiagnostics.length === 0) return;
    this._externalDiagnostics = [];
    if (this.editorView) forceLinting(this.editorView);
  }

  private resolveLineNumbers(): Extension {
    // lineNumbers() is always in the extension list, so hide gutters via CSS when disabled
    return this._lineNumbers
      ? []
      : EditorView.theme({ ".cm-gutters": { display: "none" } });
  }

  private updateLineNumbers(): void {
    this.reconfigure(this.lineNumbersCompartment, this.resolveLineNumbers());
  }

  /** Parse script tags into _files. Supports single or multi-file via data-name. */
  private parseInlineContent(): void {
    const sel = 'script[type="text/wgsl"], script[type="text/wesl"]';
    const scripts = Array.from(this.querySelectorAll(sel));

    if (scripts.length === 0) {
      const content = this.textContent?.trim() ?? "";
      if (content) this._files.set("main.wesl", { doc: toDoc(content) });
      return;
    }

    for (const script of scripts) {
      const name = script.getAttribute("data-name") || "main.wesl";
      const content = script.textContent?.trim() ?? "";
      this._files.set(name, { doc: toDoc(content) });
    }
  }

  private renderTabs(): void {
    this.tabBar.style.display = this._tabs ? "flex" : "none";
    if (!this._tabs) return;

    this.tabBar.innerHTML = "";
    for (const name of this._files.keys()) {
      this.tabBar.appendChild(this.createTab(name));
    }
    if (!this.readonly) this.tabBar.appendChild(this.createAddButton());
  }

  private createTab(name: string): HTMLButtonElement {
    const tab = document.createElement("button");
    tab.className = "tab" + (name === this._activeFile ? " active" : "");

    const nameSpan = document.createElement("span");
    nameSpan.className = "tab-name";
    nameSpan.textContent = name;

    if (!this.readonly) {
      nameSpan.addEventListener("dblclick", e => {
        e.stopPropagation();
        this.startRenameTab(tab, nameSpan, name);
      });

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "\xd7"; // Multiplication sign
      closeBtn.addEventListener("click", e => {
        e.stopPropagation();
        this.removeFile(name);
      });
      tab.append(nameSpan, closeBtn);
    } else {
      tab.append(nameSpan);
    }

    tab.addEventListener("click", () => this.switchToFile(name));
    return tab;
  }

  private createAddButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "tab-add";
    btn.textContent = "+";
    btn.addEventListener("click", () => {
      let name = "new.wesl";
      let i = 1;
      while (this._files.has(name)) name = `new${i++}.wesl`;
      this.addFile(name);
    });
    return btn;
  }

  /** Replace the tab name span with an editable input; commit on Enter/blur, cancel on Escape. */
  private startRenameTab(
    tab: HTMLElement,
    nameSpan: HTMLElement,
    oldName: string,
  ): void {
    const input = document.createElement("input");
    input.className = "tab-rename";
    input.value = oldName;
    input.size = Math.max(oldName.length, 8);

    const cancelRename = () => {
      nameSpan.style.display = "";
      input.remove();
    };
    const finishRename = () => {
      const newName = input.value.trim() || oldName;
      if (newName !== oldName && !this._files.has(newName)) {
        this.renameFile(oldName, newName);
      } else {
        cancelRename();
      }
    };

    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishRename();
      }
      if (e.key === "Escape") cancelRename();
    });
    input.addEventListener("blur", finishRename);
    input.addEventListener("input", () => {
      input.size = Math.max(input.value.length, 8);
    });

    nameSpan.style.display = "none";
    tab.insertBefore(input, nameSpan);
    input.focus();
    input.select();
  }

  private async loadFromUrl(url: string): Promise<void> {
    this.loading = true;
    try {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
      this.source = await response.text();
    } catch (e) {
      console.error("wgsl-edit: Failed to load source:", e);
    } finally {
      this.loading = false;
    }
  }

  private loadInitialContent(): void {
    const src = this.getAttribute("src");
    if (src) this.loadFromUrl(src);
  }
}

/** Build a CodeMirror highlight style from a WESL color palette. */
function weslColors(c: typeof light) {
  return syntaxHighlighting(
    HighlightStyle.define(
      [
        { tag: t.variableName, color: c.variable },
        { tag: t.definition(t.variableName), color: c.variable },
        { tag: t.propertyName, color: c.variable },
        { tag: t.keyword, color: c.keyword },
        { tag: t.definitionKeyword, color: c.keyword },
        { tag: t.controlKeyword, color: c.control },
        { tag: t.bool, color: c.keyword },
        { tag: t.typeName, color: c.type },
        { tag: t.definition(t.typeName), color: c.type },
        { tag: t.function(t.variableName), color: c.fn },
        { tag: t.function(t.definition(t.variableName)), color: c.fn },
        { tag: t.number, color: c.number },
        { tag: t.lineComment, color: c.comment },
        { tag: t.blockComment, color: c.comment },
        { tag: t.namespace, color: c.modulePath },
      ],
      { all: { fontWeight: "normal", fontStyle: "normal" } },
    ),
  );
}

/** Lazily build and cache the shared component stylesheet. */
function getStyles(): CSSStyleSheet {
  if (!cachedStyleSheet) {
    cachedStyleSheet = new CSSStyleSheet();
    cachedStyleSheet.replaceSync(cssText);
  }
  return cachedStyleSheet;
}

/** Absorb instance properties set before custom element upgrade.
 * Duplicated in WgslPlay.ts. Later, extract to a shared package. */
function upgradeProperty(el: HTMLElement, prop: string): void {
  if (Object.hasOwn(el, prop)) {
    const value = (el as any)[prop];
    delete (el as any)[prop];
    (el as any)[prop] = value;
  }
}

/** Build a CodeMirror Text doc from a string. */
function toDoc(s: string): Text {
  return Text.of(s.split("\n"));
}

/** Convert a module path or file path to a tab name: "package::main" -> "main", "main.wesl" -> "main.wesl" */
function toTabName(key: string): string {
  if (key.includes("::"))
    return key.replace(/^[^:]+::/, "").replaceAll("::", "/");
  return key.replace(/^\.\//, "");
}

/** Map GPU validation messages back to source positions via the source map. */
function mapGpuDiagnostics(
  messages: GpuMessage[],
  linked: LinkedSourceMap,
  activeFile: string,
  pkg: string,
): Diagnostic[] {
  const { sourceMap } = linked;
  const active = fileToModulePath(activeFile, pkg, false);

  return messages.flatMap(msg => {
    const srcPos = sourceMap.destToSrc(msg.offset);
    const path = srcPos.src.path;
    const mod = path ? fileToModulePath(path, pkg, false) : null;
    if (mod !== active) return [];

    const endPos = sourceMap.destToSrc(msg.offset + msg.length);
    const from = srcPos.position;
    const to = endPos.position > from ? endPos.position : from + 1;
    const { severity, message } = msg;
    return { from, to, severity, message, source: "WebGPU" } as Diagnostic;
  });
}
