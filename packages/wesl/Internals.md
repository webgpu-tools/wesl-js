# Linker Internals

The linker's job is merge multiple WESL string fragments
into one combined WGSL string.
Suitable for WebGPU's `createShaderModule`.

The WESL language is a superset of WGSL, including support
for import statements, conditional compilation, etc.

wesl-js is designed to enable linking at runtime in the browser
to enable conditional compilation of shaders based on application specific
conditions (e.g. `@if(useShadowMap)` )

Because wesl-js is intended to run in the browser,
it assumes no access to the original source filesystem.
The caller is expected to provide named WESL strings, typically
by bundling `.wesl` files into strings with a build tool like `vite`.

## Setting up to link

- _build_ - .wesl source files are converted into strings for runtime registration.
- _register_ - wgsl fragments are registered with a ModuleResolver
- _link_ - create a merged wgsl string, starting from a root module
  in the resolver.
  The linked wgsl string contains only vanilla WGSL.
  extended WESL syntax (e.g. import statements, conditions) is removed.

## Module Resolution

The linker uses a `ModuleResolver` interface to lazily load and parse WESL modules on demand.

**Module Path Format:**
Modules are referenced using `::` separators (e.g. `package::foo::bar`)
which map to file paths (`foo/bar.wesl`).

**Virtual Libraries:**
Runtime generated code is provided through resolvers too:
`VirtualLibraryResolver` parses generator function output on demand,
and `ConstantsResolver` exposes host constants as the `constants` module:
```wgsl
import constants::maxLights;
```

## Linking Pipeline

Linking proceeds in four phases:

### 1. Setup Resolvers
- RecordResolver from app sources
- BundleResolvers for library dependencies
- ConstantsResolver and VirtualLibraryResolver for runtime generated modules
- Combine with composeResolvers() if multiple sources

link() builds this composition from its parameters (weslSrc, libs, constants,
virtualLibs). linkWithResolver() links with a caller-composed resolver instead.

### 2. Parse and Bind (`bindIdents`)
The binding pass walks the scope tree depth-first, linking references to declarations.

**Key Data Structures:**
- `WeslAST` - parsed representation of a WESL module containing:
  - `AbstractElem` - abstract syntax tree mirroring source structure
  - `Scope` - hierarchical tree of identifiers
    - `DeclIdent` - declaration identifiers (with attached scope for their body)
    - `RefIdent` - reference identifiers (to be linked)
  - `ImportTree` - import statement graph

**Binding Algorithm:**
Starting from the root module, for each RefIdent:
1. Search for matching DeclIdent in current scope
2. If not found, search up the scope hierarchy
3. If still not found, check import statements:
   - Resolve imported module via ModuleResolver
   - Search in imported module's exports
4. When a global DeclIdent is found:
   - Mangle its name for global uniqueness
   - Recursively process references in its attached scope
   - Add to list of declarations to emit (tree shaking)

**Conditional Compilation:**
The binding pass respects `@if/@else` directives by tracking validity state.
References inside filtered branches don't pull in declarations.

**Output:**
- List of reachable declarations (tree shaking eliminates dead code)
- Mangled names for all global declarations
- RefIdents linked to DeclIdents in the `LinkBindings.refersTo` table
  (read it with `refDecl()` or `refTarget()`: a ref resolves to a declaration,
  to a standard WGSL name like `sin`, or to nothing)

### 3. Transform (optional plugins)
Plugins can transform the bound AST before emission.

### 4. Emit (`lowerAndEmit`)
Traverse the AST, emitting WGSL text:
- Filter elements based on active conditions
- Write declarations in emitted order
- Rewrite DeclIdents to use their mangled name from `LinkBindings.mangled`
- Rewrite RefIdents to use the mangled name of the DeclIdent they bound to
- Drop import statements and conditional directives

**TextElems:**
Most AbstractElems contain `TextElem`s which capture semantically
uninteresting source text (whitespace, punctuation, etc.).
These are copied verbatim to the output, ensuring a trivial WESL
link produces identical WGSL.

## Error Reporting

If the linker finds a parsing or semantic error,
it logs a console message for the programmer including
the source line and a fragment of the source text.

An internal `SrcMap` provided by `MiniParse` is used to maintain the mapping
from edited text to the original text.
Linker errors found while processing the edited text can
then be reported to the user in terms of the source text.
User error logging routines like `srcLog()` take a `SrcMap`
as a parameter to facilitate error logging.
`SrcMap`s may stack to cover multiple rounds of rewrites.
