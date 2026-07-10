import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { parseSrcModule } from "wesl";
import { findTestFunctions, testDisplayName } from "wgsl-test";

const execFileAsync = promisify(execFile);

const output = vscode.window.createOutputChannel("WESL Tests");

function log(...args: unknown[]): void {
  output.appendLine(
    args
      .map(a => (typeof a === "object" ? JSON.stringify(a) : String(a)))
      .join(" "),
  );
}

export interface TestResult {
  testId: string;
  passed: boolean;
  error?: string;
}

/** VS Code Test Controller for discovering and running @test functions in WESL files. */
export class WeslTestController implements vscode.Disposable {
  readonly items: vscode.TestItemCollection;
  private controller: vscode.TestController;
  private disposables: vscode.Disposable[] = [];
  private fileItems = new Map<string, vscode.TestItem>();
  private resultEmitter = new vscode.EventEmitter<TestResult>();
  readonly onTestResult = this.resultEmitter.event;
  private enabled = true;
  private watchersSetup = false;
  private continuousRequest?: vscode.TestRunRequest;
  private continuousToken?: vscode.CancellationToken;

  constructor(_context: vscode.ExtensionContext) {
    this.controller = vscode.tests.createTestController(
      "weslTests",
      "WESL Tests",
    );
    this.items = this.controller.items;
    this.controller.resolveHandler = this.resolveTests.bind(this);
    this.controller.createRunProfile(
      "Run",
      vscode.TestRunProfileKind.Run,
      this.runTests.bind(this),
      true,
      undefined, // tag
      true, // supportsContinuousRun
    );

    this.enabled = this.isEnabled();
    if (this.enabled) this.initialize();

    // Listen for setting changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("wgslStudio.nativeTestRunner.enabled")) {
          const wasEnabled = this.enabled;
          this.enabled = this.isEnabled();
          if (this.enabled && !wasEnabled) {
            this.initialize();
          } else if (!this.enabled && wasEnabled) {
            this.clearAllTests();
          }
        }
      }),
    );
  }

  /** Set up watchers and discover existing tests. */
  private initialize(): void {
    output.show();
    this.setupWatchers();
    this.discoverExistingTests();
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("wgslStudio")
      .get("nativeTestRunner.enabled", true);
  }

  private clearAllTests(): void {
    this.controller.items.replace([]);
    this.fileItems.clear();
  }

  dispose(): void {
    this.controller.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private setupWatchers(): void {
    if (this.watchersSetup) return;
    this.watchersSetup = true;
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.wesl");
    watcher.onDidCreate(uri => this.parseFileTests(uri));
    watcher.onDidChange(uri => this.parseFileTests(uri));
    watcher.onDidDelete(uri => this.removeFileTests(uri));
    this.disposables.push(watcher);

    const docWatcher = vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.fileName.endsWith(".wesl")) {
        this.parseFileTests(doc.uri, doc.getText());
        this.runContinuousTests(doc.uri);
      }
    });
    this.disposables.push(docWatcher);
  }

  private async discoverExistingTests(): Promise<void> {
    const files = await vscode.workspace.findFiles(
      "**/*.wesl",
      "**/node_modules/**",
    );
    for (const uri of files) this.parseFileTests(uri);
  }

  private async resolveTests(item?: vscode.TestItem): Promise<void> {
    if (!this.enabled) return;
    if (!item) {
      await this.discoverExistingTests();
    }
  }

  /** Parse a file for tests - exposed for testing. */
  parseTests(uri: vscode.Uri, src?: string): Promise<void> {
    return this.parseFileTests(uri, src);
  }

  /** Run all discovered tests - exposed for testing. */
  async runAllTests(): Promise<void> {
    const request = new vscode.TestRunRequest();
    const token = new vscode.CancellationTokenSource().token;
    await this.runTests(request, token);
  }

  private removeFileTests(uri: vscode.Uri): void {
    const existing = this.fileItems.get(uri.fsPath);
    if (existing) {
      this.controller.items.delete(existing.id);
      this.fileItems.delete(uri.fsPath);
    }
  }

  private async parseFileTests(uri: vscode.Uri, src?: string): Promise<void> {
    if (!this.enabled) return;
    const filePath = uri.fsPath;
    if (filePath.includes("node_modules")) return;
    const content = src ?? (await readFile(uri));
    if (!content) return;

    const testFns = discoverTests(content, filePath);
    if (testFns.length === 0) {
      this.removeFileTests(uri);
      return;
    }

    const fileName = vscode.workspace.asRelativePath(uri);
    const fileItem =
      this.fileItems.get(filePath) ??
      this.controller.createTestItem(filePath, fileName, uri);
    fileItem.children.replace([]);
    this.fileItems.set(filePath, fileItem);

    for (const test of testFns) {
      const testItem = this.controller.createTestItem(
        `${filePath}::${test.name}`,
        testDisplayName(test.name, test.description),
        uri,
      );
      testItem.range = positionToRange(content, test.start);
      fileItem.children.add(testItem);
    }

    this.controller.items.add(fileItem);
  }

  private async runTests(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (request.continuous) {
      this.continuousRequest = request;
      this.continuousToken = token;
      token.onCancellationRequested(() => {
        this.continuousRequest = undefined;
        this.continuousToken = undefined;
      });
    }

    const run = this.controller.createTestRun(request);
    const queue = this.collectTestItems(request);

    // Group tests by file for batch execution
    const testsByFile = new Map<string, vscode.TestItem[]>();
    for (const item of queue) {
      if (item.children.size > 0) continue; // Skip file-level items
      const [filePath] = item.id.split("::");
      const items = testsByFile.get(filePath) ?? [];
      items.push(item);
      testsByFile.set(filePath, items);
    }

    // Run each file's tests in a single process
    for (const [filePath, items] of testsByFile) {
      if (token.isCancellationRequested) break;
      for (const item of items) run.started(item);

      const results = await this.runFileTests(filePath, items);
      for (const item of items) {
        const [, testName] = item.id.split("::");
        const result = results.find(r => r.name === testName);
        if (!result) {
          run.errored(item, new vscode.TestMessage("Test result not found"));
          this.resultEmitter.fire({
            testId: item.id,
            passed: false,
            error: "Test result not found",
          });
        } else if (result.error) {
          const msg = new vscode.TestMessage(result.error);
          msg.location = new vscode.Location(item.uri!, item.range!);
          run.errored(item, msg);
          this.resultEmitter.fire({
            testId: item.id,
            passed: false,
            error: result.error,
          });
        } else if (result.passed) {
          run.passed(item);
          this.resultEmitter.fire({ testId: item.id, passed: true });
        } else {
          const lines = [
            `actual: [${result.actual.join(", ")}]`,
            `expected: [${result.expected.join(", ")}]`,
          ];
          if ((result.failCount ?? 0) > 1) {
            lines.push(`(first of ${result.failCount} failed assertions)`);
          }
          const msg = new vscode.TestMessage(lines.join("\n"));
          msg.location = new vscode.Location(item.uri!, item.range!);
          run.failed(item, msg);
          this.resultEmitter.fire({ testId: item.id, passed: false });
        }
      }
    }
    run.end();
  }

  /** Re-run tests for a file when continuous mode is active. */
  private runContinuousTests(uri: vscode.Uri): void {
    if (
      !this.continuousRequest ||
      this.continuousToken?.isCancellationRequested
    )
      return;
    const fileItem = this.fileItems.get(uri.fsPath);
    if (!fileItem || fileItem.children.size === 0) return;

    const items: vscode.TestItem[] = [];
    fileItem.children.forEach(child => {
      items.push(child);
    });
    const request = new vscode.TestRunRequest(
      items,
      undefined,
      undefined,
      true,
    );
    this.runTests(request, this.continuousToken!);
  }

  private collectTestItems(request: vscode.TestRunRequest): vscode.TestItem[] {
    const items: vscode.TestItem[] = [];
    if (request.include) {
      for (const item of request.include) {
        if (item.children.size > 0) {
          item.children.forEach(child => {
            items.push(child);
          });
        } else {
          items.push(item);
        }
      }
    } else {
      this.controller.items.forEach(fileItem => {
        fileItem.children.forEach(child => {
          items.push(child);
        });
      });
    }
    return items;
  }

  private async runFileTests(
    filePath: string,
    items: vscode.TestItem[],
  ): Promise<
    {
      name: string;
      passed: boolean;
      actual: number[];
      expected: number[];
      failCount?: number;
      error?: string;
    }[]
  > {
    try {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const testNames = items.map(item => item.id.split("::")[1]);
      const params = {
        src: doc.getText(),
        projectDir: path.dirname(filePath),
        testNames,
      };
      log("Spawning test runner for:", testNames.join(", "));

      const thisDir = path.dirname(new URL(import.meta.url).pathname);
      const cliPath = path.resolve(thisDir, "runTestCli.mjs");
      const { stdout, stderr } = await execFileAsync(
        "node",
        [cliPath, JSON.stringify(params)],
        { timeout: 30000 },
      );
      if (stderr) log("stderr:", stderr);
      log("stdout:", stdout);

      return JSON.parse(stdout);
    } catch (e) {
      const error = e instanceof Error ? (e.stack ?? e.message) : String(e);
      log("Error:", error);
      return items.map(item => ({
        name: item.id.split("::")[1],
        passed: false,
        actual: [],
        expected: [],
        error,
      }));
    }
  }
}

interface DiscoveredTest {
  name: string;
  description?: string;
  start: number;
}

function discoverTests(src: string, filePath: string): DiscoveredTest[] {
  try {
    const ast = parseSrcModule({
      modulePath: "test",
      debugFilePath: filePath,
      src,
    });
    return findTestFunctions(ast).map(fn => ({
      name: fn.name,
      description: fn.description,
      start: fn.fn.start,
    }));
  } catch {
    return [];
  }
}

function positionToRange(src: string, offset: number): vscode.Range {
  let line = 0;
  let col = 0;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === "\n") {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return new vscode.Range(line, col, line, col);
}

async function readFile(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}
