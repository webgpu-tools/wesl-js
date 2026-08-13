import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolve } from "import-meta-resolve";
import {
  astToString,
  link,
  log,
  RecordResolver,
  scopeToString,
  type WeslBundle,
} from "wesl/core";
import {
  dependencyBundles,
  loadModules,
  versionFromPackageJson,
} from "wesl-tooling";
import yargs from "yargs";

type CliArgs = Awaited<ReturnType<typeof parseArgs>>;

export async function cli(rawArgs: string[]): Promise<void> {
  const argv = await parseArgs(rawArgs);
  await linkNormally(argv);
}

async function parseArgs(args: string[]) {
  const toolDir = new URL("..", import.meta.url).href;
  const appVersion = await versionFromPackageJson(toolDir);
  return yargs(args)
    .version(appVersion)
    .command("$0 [module]", false, yargs => {
      yargs.positional("module", {
        type: "string",
        describe:
          "root module to link. Use :: for package references (lygia::utils), / for current package (utils/foo)",
      });
    })
    .option("src", {
      type: "string",
      describe:
        "WGSL/WESL files to bundle in the package (glob syntax, defaults to wesl.toml or shaders/**/*.w[eg]sl)",
    })
    .option("rootModule", {
      type: "string",
      default: "main",
      describe: "start linking from this module name",
    })
    .option("conditions", {
      type: "array",
      describe: "settings for conditional compilation",
    })
    .option("baseDir", {
      requiresArg: true,
      type: "string",
      describe: "root directory for shaders (defaults to wesl.toml or shaders)",
    })
    .option("projectDir", {
      requiresArg: true,
      type: "string",
      default: ".",
      describe: "directory containing package.json",
    })
    .option("details", {
      type: "boolean",
      default: false,
      hidden: true,
      describe: "show details about parsed files",
    })
    .option("emit", {
      type: "boolean",
      default: true,
      hidden: true,
      describe: "emit linked result",
    })
    .help()
    .parse();
}

async function linkNormally(argv: CliArgs): Promise<void> {
  const { baseDir, projectDir, module, rootModule } = argv;
  const weslSrc = await loadModules(projectDir, baseDir, argv.src);
  const projectDirAbs = path.resolve(projectDir);
  const libs = await dependencyBundles(weslSrc, projectDirAbs);

  const conditionEntries = argv.conditions?.map(c => [c, true]) || [];
  const conditions = Object.fromEntries(conditionEntries);

  // Use positional module argument if provided, otherwise use --rootModule option (default "main")
  const rootModuleName = (module || rootModule || "main") as string;
  const rootLib = await rootModuleLib(rootModuleName, projectDir, libs);
  if (rootLib) libs.push(rootLib);

  if (argv.emit) {
    const linked = await link({ weslSrc, rootModuleName, libs, conditions });
    log(linked.dest);
  }

  if (argv.details) {
    const resolver = new RecordResolver(weslSrc);
    for (const [modulePath, ast] of resolver.allModules()) {
      log(`---\n${modulePath}`);
      log(`\n->ast`);
      log(astToString(ast.moduleElem));
      log(`\n->scope`);
      log(scopeToString(ast.rootScope));
      log();
    }
  }
}

/** load the weslbundle containing the root module (if we haven't already loaded it) */
async function rootModuleLib(
  rootModuleName: string,
  projectDir: string,
  libs: WeslBundle[],
): Promise<WeslBundle | undefined> {
  // Check if root module is from a dependency (contains :: and doesn't start with "package")
  if (rootModuleName.includes("::")) {
    const packageName = rootModuleName.split("::")[0];
    if (packageName !== "package") {
      const alreadyLoaded = libs.some(lib => lib.name === packageName);
      if (!alreadyLoaded) {
        const depBundle = await loadWeslBundle(packageName, projectDir);
        if (depBundle) {
          return depBundle;
        }
      }
    }
  }
}

/**
 * Load a specific dependency wesl bundle by package name.
 *
 * @param packageName npm package name (e.g., "random_wgsl" or "foo/bar")
 * @param projectDir directory containing package.json
 */
async function loadWeslBundle(
  packageName: string,
  projectDir: string,
): Promise<WeslBundle | undefined> {
  const projectDirAbs = path.resolve(path.join(projectDir, "dummy.js"));
  const projectURL = pathToFileURL(projectDirAbs).href;

  try {
    const url = resolve(packageName, projectURL);
    const module = await import(url);
    return module.default;
  } catch {
    return undefined;
  }
}
