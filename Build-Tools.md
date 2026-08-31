### commits
- pushes and merges to shared `main` must pass all tests, lint, and formatting
- interim commits needn't; put them on a branch that's merged to main

### prepush script
- `rpr prepush` verifies tests, lint, and formatting before pushing, using
  Turborepo for parallel execution (quiet, errors only; logs in `.turbo/`)
- `rpr prepush:sequential` runs tasks one at a time (useful for debugging)
- turbo config is in `turbo.json`; only tasks run via `turbo run <task>` need
  entries there

### CTS tests
The WebGPU CTS (a git submodule in `cts/`) is used two ways.

**Transpile-diff** runs the CTS plain and with the linker spliced into
`createShaderModule`, and diffs the results. Tests parse and emit fidelity.
Needs a real GPU, so it doesn't run under a sandbox.

```bash
rpr test:cts        # two fast queries (~5s), runs on every prepush
rpr test:cts:full   # the whole validation suite (~2 min), run before a merge
```

**Fixture replay** decodes CTS dumps as ordinary vitest suites (no GPU):
`CtsConstEval.test.ts` uses the CTS case tables as an oracle for `src/types/`;
`CtsValidation.test.ts` checks we don't reject or crash on CTS-valid shaders
(constructs we give up on need a triaged `skip`/`todo` in `gapTriage`).
Iterate on these alone with `rpr test:cts:offline`.

The dumps live in the cts fork under `dumps/`, pinned by the submodule SHA.
Regenerate them in the same commit that bumps the submodule:

```bash
rpr dump:cts:cases     # rebuild cts/dumps/cases/ (no GPU)
rpr dump:cts:shaders   # rebuild cts/dumps/shaders/ (~70s, needs a GPU)
```

To extend const-eval coverage, delete names from the exclusion filters in
`packages/wesl/scripts/dump-cts-cases.ts` and re-dump. For full-corpus hand
dumps see `cts/transpiler/README-DumpTools.md`.

### version bumps and releases
- version bumps should be done on the `tomain` branch
- after bumping, push with tags: `git push && git push --tags`
- the auto-merge workflow promotes `tomain` to `main` after CI passes
- then run `rpr publish:all` and `rpr prep:examples` to complete the release

### continuous integration
- CI runs on macos and windows (headless dawn keeps linux out for now)
- playground tests of example projects don't run in CI; run `prepush`
  (or at least `test:examples`) locally before pushing

### linting
- biome is the primary linter/formatter; oxlint can be run manually;

### prep:examples
- example projects live in this repo so typechecking keeps them current;
  `prep:examples` exports them to a separate repo, rewriting package.json to
  depend on the published wesl packages (clean to copy, works on stackblitz)
- run it after each release

### benchmark perf check
After a change that could affect linker perf, A/B the working tree against
the committed code (~1 min):

```bash
rpr bench:baseline HEAD    # snapshot the "before" side
rpr bench --baseline       # A/B run; the HTML viewer opens when it finishes
```

`equivalent` is the pass; `inconclusive` means rerun (or `--preset thorough`).
`_baseline/` holds a git-ignored flat copy of the repo for the comparison
disable the vitest vscode plugin for _baseline:
[vscode pic](https://github.com/user-attachments/assets/84e3a309-108a-4b6a-b05e-c31acc6f3dc2)

### tsconfig
- most tsconfigs extend base configs in the repo root; example tsconfigs are
  intentionally standalone

### WebGPU types
- we use `@webgpu/types` because TypeScript's `lib.dom` still lacks the flag
  namespaces (`GPUBufferUsage`, `GPUShaderStage`, ...). The two declare
  duplicate type aliases, which is why `skipLibCheck` stays on repo-wide.
- `@types/web` (gpuweb's recommended alternative) doesn't work here: any
  dependency can `/// <reference lib="dom" />` and drag the bundled DOM copy
  back in alongside it - preact does.
- this is over once `lib.dom.d.ts` gains `declare namespace GPUBufferUsage`
- packages/built-test typechecks the published types with `skipLibCheck` off
  (see its README)

### package.json conventions
- syncpack: `fix:syncpack` fixes inconsistent dependency versions,
  `fix:pkgJsonFormat` sorts fields (run biome after for final formatting)
- each package declares its own regular and peer dependencies; shared
  devDependencies live in the root package; examples declare everything,
  since their package.json is read standalone by users
- internal devDeps on private packages use `workspace:x`, not `workspace:*`,
  so `pnpm publish` doesn't fail resolving unversioned test packages

### publishConfig and TypeScript sources
- published packages carry two `exports` sets via pnpm's `publishConfig`:
  TypeScript sources for in-repo development, JS + .d.ts for consumers.
  Tools (and vanilla node) work on the sources directly, so typecheck and
  test don't need a build step first.
- we avoid TS syntax that requires codegen (`erasableSyntaxOnly`, e.g. no
  constructor parameter properties) so node tools can run the sources

### wesl-tooling types
- wesl-tooling isn't built or published (internal tools only); wesl-plugin
  republishes one of its types, hence the special handling in
  wesl-plugin/tsconfig.json and tsdown.config.ts
