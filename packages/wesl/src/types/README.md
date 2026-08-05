# types/ -- Semantic Type Core

Semantic types, type synthesis, bidirectional checking, and const-expression
evaluation for WGSL/WESL. This directory answers three questions about
already-bound ASTs:

- "What type is this expression?" (`typeOfExpr`)
- "What type does the context expect here?" (`checkModule` + `checkedTypeOf`)
- "What value does this const-expression have?" (`evalConstExpr`)

Everything runs on demand *after* binding, over the conditioned view of a
module (@if-filtered per the link's conditions). None of it is required by
`link()` itself, so the whole directory tree-shakes out of bundles that don't
use it.

## Design principles

- **Unknown-tolerant, not validating.** Anything synthesis can't determine is
  `unknown` (which matches everything), never an error. Likewise
  `evalConstExpr` returns `null` for anything not const-evaluable rather than
  raising. Callers that want diagnostics layer them on top.
- **Per-link results.** Types depend on the link's conditions (@if can change
  struct members), so all caches live in the per-link `LinkBindings` tables
  (`expressionTypes`, `declTypes`, `checkedTypes`), never on the shared AST.
  ASTs are immutable after parse.
- **Abstract numerics are first-class.** Untyped literals are `abstract-int` /
  `abstract-float` per the WGSL spec; conversion rank (Conversions.ts) is the
  single relation that drives materialization, overload resolution, common-type
  promotion, and value conversion.

## Module map

Layered, top depends on bottom:

```
  Bidirectional ...................... expected-type checking
        |
  TypeSynthesis  <----------->  ConstEval ......... "what type?" | "what value?"
        |         mutually          |
        |         recursive         +-- ConstOperators     (operators on values)
        v                           +-- ConstConstructors  (vec3f(...), structs)
  BuiltinSignatures                 +-- ConstBuiltins      (also uses
    |-- BuiltinTable (data)         |                       BuiltinSignatures)
    |-- OverloadMatch (matcher)     v
    |-- TextureSignatures         ConstValues ..... value model + numeric rules
        |                           |
        v                           v
  Conversions / Types / OpNames ................... shared foundation
```

| Module | Role |
|---|---|
| [Types.ts](Types.ts) | The semantic `Type` model (separate from `TypeRefElem` syntax): scalars, vectors, matrices, arrays, structs (nominal), atomics, pointers, textures, samplers, `void`, `unknown`. Plus `sameType`, `typeToString`, and interned scalar constants. |
| [Conversions.ts](Conversions.ts) | The WGSL conversion-rank relation (`conversionRank`, `convertible`), abstract-numeric materialization (`concretize`), and common-type promotion (`commonType`). The shared kernel under everything else. |
| [OpNames.ts](OpNames.ts) | Leaf tables (comparison operators, swizzle names) shared by synthesis and const eval, so ConstEval doesn't import TypeSynthesis just to read them. |
| [TypeSynthesis.ts](TypeSynthesis.ts) | Forward synthesis: `typeOfExpr`, `typeOfDecl`, `resolveTypeRef`. Walks expressions bottom-up; resolves predeclared type names, constructors, operators, member/index access. |
| [Bidirectional.ts](Bidirectional.ts) | Bidirectional checking: pushes an expected type into the closed list of positions that have one (annotated decl RHS, return values, assignment RHS). `checkModule`/`checkFn` populate, `checkedTypeOf` reads. |
| [BuiltinTable.ts](BuiltinTable.ts) | Data only: builtin function signatures in a compact string form, e.g. `mix: "f T T T -> T; f V V E -> V"`. |
| [OverloadMatch.ts](OverloadMatch.ts) | The signature mini-language: parses table entries into `Overload`s and matches call argument types against them (lowest total conversion rank wins). |
| [BuiltinSignatures.ts](BuiltinSignatures.ts) | `builtinFnType(name, argTypes)`: return type of a builtin call. Table lookup for most builtins, special cases for those whose result depends on argument structure (atomics, frexp/modf result structs, transpose, ...). |
| [TextureSignatures.ts](TextureSignatures.ts) | Texture builtin return types; not table-driven because results depend on the texture argument's own type (depth vs color, channel format). |
| [ConstEval.ts](ConstEval.ts) | `evalConstExpr`: walks an expression and dispatches to the operator / constructor / builtin evaluators once operands are values. |
| [ConstValues.ts](ConstValues.ts) | The `ConstValue` model (scalar + composite) and its numeric rules: bigint for exact abstract-int, f64 for abstract-float, i32/u32 wrapping, f32/f16 rounding, plus implicit (`convertValue`) and constructor (`castScalar`) conversions. |
| [ConstOperators.ts](ConstOperators.ts) | Unary and binary operators over evaluated values, component-wise with scalar splat. |
| [ConstConstructors.ts](ConstConstructors.ts) | Type constructor calls as values: `vec3f(...)`, matrices from scalars/columns, arrays, structs, zero-value constructors. |
| [ConstBuiltins.ts](ConstBuiltins.ts) | Const evaluation of builtin calls (a pragmatic subset); uses `builtinFnType` to find the return type, then per-lane numeric tables. |

## How the major operations fit together

**Forward synthesis** (`typeOfExpr`) is the base layer. Expression types are
computed bottom-up and cached per link. Call expressions branch three ways: a
user declaration (fn return type, struct/alias constructor via `typeOfDecl`),
a predeclared constructor (`vec2(1, 2)` infers its element type from the
arguments), or a builtin (`builtinFnType` -> overload matching against
BuiltinTable).

**Bidirectional checking** (Bidirectional.ts) layers on top. Where the
surrounding context unambiguously expects a type, the synthesized type is
checked against it; if it converts, the expression takes the expected type
(this is where `let x: f32 = 1` types the `1` as f32 instead of the default
i32). Expected types never propagate through operators or call arguments, so
every rule stays local to one AST node. Like synthesis it never errors: a
non-convertible type just keeps its synthesized type.

**Const evaluation** (`evalConstExpr`) mirrors the synthesis walk but produces
values. It is *mutually recursive* with TypeSynthesis: an array count is an
expression inside a type (`array<f32, N * 2>`), and a constructor's value
needs its resolved type. Each module only calls the other from inside a
function body, never at module init, so the import cycle is safe to load in
either order.

**Conversions** is the point where the three meet. One rank relation
(`conversionRank`) serves builtin overload resolution (OverloadMatch sums
per-argument ranks), expected-type unification (Bidirectional's `checkType`),
operator result types (`commonType` in TypeSynthesis), and value coercion
(ConstValues' `convertValue`).

## Caching and cycle guards

All state lives in `LinkBindings` (see BindIdents.ts):

- `expressionTypes` / `declTypes`: synthesis caches, read through
  `typeOfExpr` / `typeOfDecl`. `resolveTypeRef` shares `expressionTypes`,
  since a `TypeRefElem` is an `ExpressionElem`.
- `checkedTypes`: bidirectional results, populated by `checkModule`/`checkFn`
  and read through `checkedTypeOf` (falls back to forward synthesis).
- `visitingDecls` / `visitingConsts`: in-progress guards that break cycles in
  erroneous source (a decl whose type or value depends on itself yields
  `unknown` / `null` instead of recursing forever). Two separate sets because
  value recursion and type recursion are different cycles.

Const *values* are not cached: `evalConstExpr` recomputes on every call,
re-evaluating each referenced `const` declaration's initializer as it goes.
Fine for today's consumers (array counts, tests), which evaluate each site
once, but chained consts re-evaluate their whole dependency tree per
reference. If const eval ever runs hot, memoize at the declaration level
(a `Map<DeclIdent, ConstValue | null>` in `LinkBindings`; note `null` is a
valid cached result, so probe with `has()`).

## Entry points and tests

The package [index.ts](../index.ts) publishes a curated surface
(`typeOfExpr`, `typeOfDecl`, `resolveTypeRef`, `checkModule`, `checkedTypeOf`,
`evalConstExpr`, `builtinFnType`, the `Type`/`ConstValue` models, and the
conversion helpers); modules here export more than that so they can share
code with their siblings.

Tests live in [../test/](../test/): unit tests per module
(Bidirectional.test.ts, Conversions.test.ts, BuiltinTable.test.ts) plus the
WebGPU CTS oracles (CtsConstEval.test.ts and friends), which check const-eval
results and no-false-rejection against the upstream CTS case tables.
