# built-test

`built-test` verifies the npm packages that users will install. Most tests in
the monorepo resolve workspace dependencies to their source files, so they
cannot catch every problem in the files produced for publication.

## How it works

`pnpm run test:built`:

1. Builds the WESL-JS packages and creates npm tarballs with `pnpm pack`.
2. Copies this project to `temp-built-test` at the repository root.
3. Installs the tarballs in that temporary project instead of the workspace
   packages.
4. Runs the tests and type checks against the installed packages.

The Vitest suite also runs inside the monorepo against the source packages.
Checks that depend on package tarballs run only in `temp-built-test`.

## Type checking

TypeScript compiles browser code separately from Node.js code such as Vite
configuration files and command-line tools. Browser code has DOM and WebGPU
globals; Node.js tooling does not. `built-test` uses separate configurations to
verify that the published declarations work in both environments.

| Configuration | Purpose | WebGPU types | Library checks |
| --- | --- | --- | --- |
| `tsconfig.json` | Test suite in the monorepo and temporary project | DOM and `@webgpu/types` | skipped |
| `tsconfig.browser.json` | Browser imports from published packages | DOM | enabled |
| `tsconfig.node.json` | Node.js imports from published packages | none | enabled |

The two strict configurations verify that browser entry points work with the
WebGPU types supplied by the DOM library and that Node-compatible entry points
do not depend on browser globals.

The main configuration enables `skipLibCheck` because it includes both the DOM
library and `@webgpu/types`, which declare the same WebGPU globals. It is also
the configuration used for routine type checking inside the monorepo. The two
stricter configurations are intended for `temp-built-test`, where imports
resolve through the published export maps instead of directly to source files.

## Notes

- Vite is an explicit dependency because it is a Vitest peer dependency.
  Without it, dependency resolution can select an older Vite and esbuild
  combination that warns about the ES2024 target.
