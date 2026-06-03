# Developing wesl-js

## Git Submodules

This is a meta repository with several related projects
included as git submodules.

We recommend setting `git config submodule.recurse true` for this project,
to make working with Git submodules easier.

### Install packages:

```sh
cd wesl-js
pnpm install
```

### Scripts

See `wesl-js/package.json` for scripts you can run.

This is the most common one:

```sh
pnpm test
```

If it fails with a `Error [ERR_MODULE_NOT_FOUND]:`, try doing `pnpm run build:all` first.

### wesl tool packages

- *wesl* The main library in the suite,
- *wesl-plugin* wesl build plugins for vite, webpack, etc.
parses WESL sources and links to WGSL.
- *wesl-link* a command line tool to link multiple WESL files into one WGSL file.
- *wesl-packager* a command line tool to contruct
WESL npm packages.

- *bench* benchmark tests of linker performance.
- *random_wgsl* a sample WESL npm package

## Test Packages
Supporting sources for tests are available as subprojects in the
`/wesl-testsuite` directory.

## rpr script

`rpr` is a convenient way to run package scripts from any directory within the
project. It's a standalone tool (the [repo-runner](https://github.com/mighdoll/repo-runner) package),
not part of this repo.

- Install it globally: `pnpm add -g repo-runner` (or `npm i -g repo-runner`).
- Then run `rpr` instead of any pnpm script, from any directory:
  - `rpr fix:all` (instead of `cd ../..; pnpm fix:all`)
  - `rpr test`, `rpr typecheck`, etc.

`rpr` finds the repo root, runs root-level scripts from the root and
current-package scripts from the current directory, and detects pnpm
automatically. Unknown commands pass through to pnpm.
