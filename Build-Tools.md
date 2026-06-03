### commits
- all pushes and merges to the main branch shared repository should 
  pass all tests, lint/formatting rules, commenting standards
- interim commits are encouraged to increase clarity for future readers.
  Interim commits needn't pass all the quality rules. 
  Best to put interim commits on a branch that's merged to main.

### prepush script
- `rpr prepush` verifies tests, linting, formatting before pushing
- uses Turborepo for parallel task execution with quiet output (errors only)
- `rpr prepush:sequential` runs tasks one at a time (useful for debugging)

### turbo
- Turborepo orchestrates builds, typechecks, tests across packages
- Config in `turbo.json`, tasks defined must match scripts in package.json
- Output is quiet by default (`--output-logs=errors-only`)
- Logs written to `.turbo/` directories for debugging

```bash
rpr turbo:validate              # quiet mode (default)
rpr turbo:validate:verbose      # full output
rpr turbo:validate --force      # bypass cache, re-run everything
rpr turbo:validate --dry-run    # show what would run
```

- Only tasks run via `turbo run <task>` need turbo.json entries
- Undefined tasks still run but with default settings (no caching)

### version bumps and releases
- version bumps should be done on the `tomain` branch
- after bumping, push with tags: `git push && git push --tags`
- the auto-merge workflow will promote `tomain` to `main` after CI passes
- then run `rpr publish:all` and `rpr prep:examples` to complete the release

### continuous integration
- we run CI on macos and windows.
- tests currently include some use of dawn in headless mode, so no linux yet
- playground tests of example projects are not run on ci and should be run 
  locally before pushing to master.
  Use `prepush` or at least `test:examples`

### linting
- biomejs is the current primary linter/formatter.
- oxlint is run on the prepush script, and is enforced in ci.
- eslint is available to run manually, but is not required to pass for every main branch push.
- rationale: biome has currently the best combination features and stability. oxlint is up and coming. eslint is obsolescent but still catches some things that other linters miss.

### typecheck:watch
- run typescript typechecking continuously in the terminal.

### prep:examples
- user example wesl-js projects are in the main wesl-js repo
so that typechecking (and eventually testing) can help keep the examples up to date. 
- the prep:examples script exports the examples 
to a separate git repo
and rewrites their package.json files to depend on 
the current published wesl packages.
- The sepearate repo without workspace:* dependencies in package.json
is useful so that visitors can have a clean version to copy from,
and so that stackblitz examples will work.
- prep:examples should be run after each new release, 
so that the examples use the latest version of wesl-js.

### _baseline
- Holds a flat copy of the repo for benchmark comparisons.
`_baseline` is git-ignored.
The copy is likely a different version than the current tree 
(see `bench:baseline` to set it up at particular version)

- if you use the vitest vscode plugin, disable it for _baseline
<img width="539" alt="image" src="https://github.com/user-attachments/assets/84e3a309-108a-4b6a-b05e-c31acc6f3dc2" />

### tsconfig 
- most of the tsconfig files extend from base config files in the repo root.
  - the main exception is for example tsconfig files are intentially standalone
    
### syncpack
- sorts package.json fields via `fix:pkgJsonFormat` 
(but then biome needs to run for for final formatting for e.g. multiline vs oneline arrays).
- fixes inconsistent package dependencies via `fix:syncpack`.

### dependencies in the monorepo
- each package package.json declares its own regular and peer dependencies
- shared devDependencies are moved to the root package for convenient mgmt
- examples package.json files are intended to be read standalone by 
  users, and so declare all of their own dependencies.
- for internal devDependencies to private packages, we use `workspace:x` rather than `workspace:*`. 
  this puts a link in `node_modules` for the local test package so that tests can run.
  The test packages aren't published, but `pnpm publish` fails
  nonetheless to trying resolve these dependent packages if they're marked as `workspace:*`
  and don't have a version.

### publishConfig for package.json 'exports'
- We now use pnpm's `publishConfig` feature. 
  The package.json files for published packages like wesl and wesl-plugin 
  now effectively have two sets of entry points (in `exports`),
  one for internal wesl-js monorepo development 
  and a separate one for external users of the packages using `publishConfig`.

- The internal api uses typescript, 
  the external api uses javascript + .d.ts files. 
  The advantage is that internal tools like the typescript language server 
  can work on the source w/o waiting for transpilation during development.

- Vanilla nodejs now understands typescript pretty well.
  So most tools should just work with our sources and build sequencing should be easier. 
  e.g. It should be ok to typecheck or test a change w/o running our build step first.

### TypeScript `erasableSyntaxOnly`
- To make it easy for vanilla node tools to understand our sources, 
  we limit use of TypeScript features that require TypeScript code generation,
  notably attributes like 'public' or 'readonly' on class constructor 
  function parameters. See [commit](https://github.com/webgpu-tools/wesl-js/tree/cd8dcc3c49fc0fa96174126980cd7e8127b6a073).

### wesl-tooling types
- We currently don't build or publish the wesl-tooling package
  since it's only used by internal tools.
- This causes a little complication in the wesl-plugin build
  because wesl-plugin wants to publish one of the types from wesl-tooling, and tsdown bundler wants to use d.ts files for types.
  - see wesl-plugin/tsconfig.json and wesl-plugin/tsdown.config.ts 
