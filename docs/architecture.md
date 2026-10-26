# Compiler Architecture & Internals

## How it works

GoFront is a five-stage compiler written in pure Node.js (no dependencies). Every stage
operates on the AST (abstract syntax tree):

```
source text (.go files)
  → Lexer          tokenize + Go-style semicolon insertion
  → Parser         recursive-descent → AST
  → Type Checker   annotate AST with types + collect errors
  → Lowering       ownership/clone elision, escape analysis, capture analysis
  → Code Gen       AST → JavaScript ES module or WebAssembly GC module (.wasm)

source text (.templ files)
  → TemplLexer     dual-mode: Go mode for declarations, HTML mode inside templ bodies
  → TemplParser    extends Parser; produces TemplDecl AST nodes with TemplNode children
  → Type Checker   registers each templ component as func(...) gom.Node
  → Code Gen       TemplDecl → direct DOM calls (createElement / setAttribute / appendChild)
```

### 1. Lexer (`src/lexer.js`)

Tokenises the source into a stream of tokens. Implements Go's semicolon insertion rules:
a semicolon is automatically inserted after a line's final token if that token is an
identifier, literal, `)`, `]`, `}`, or certain keywords (`return`, `break`, `continue`,
`fallthrough`). This is why Go doesn't need explicit semicolons — and neither does
GoFront.

### 2. Parser (`src/parser/`)

A hand-written recursive-descent parser. No parser generators, no grammar files — just
straightforward top-down parsing. Produces an AST where every node is a plain JS object
with a `kind` field (`"FuncDecl"`, `"IfStmt"`, `"BinaryExpr"`, etc.).

Operator precedence is handled via a Pratt-style expression parser with numeric
precedence levels.

### 3. Type Checker (`src/typechecker/`)

Three-pass type checker operating on the AST:

1. **Pass 1 — collect types**: register all `type` declarations (structs, interfaces,
   named types) so they can be referenced before definition.
2. **Pass 2 — collect functions & vars**: register function signatures and package-level
   variables. Resolve embedded struct fields and promote methods.
3. **Pass 3 — check bodies**: walk every function body, infer expression types, verify
   assignments and call arguments, and report errors with source location.

Types are plain JS objects (`{ kind: "basic", name: "int" }`, `{ kind: "slice",
elem: ... }`, etc.). The special `any` type acts as a recovery/escape hatch — any
operation on it is silently permitted, preventing cascading errors.

### 4. Code Generator (`src/backend/js/`)

Walks the typed AST and emits clean, readable JavaScript. No intermediate representation
— the codegen writes directly to an output buffer with indentation tracking.

Runtime helpers (`__len`, `__append`, `__s`, `__sprintf`, `__equal`, `__cmul`, `__cdiv`,
`__error`, `__errorIs`, `__timeFmt`, `__timeParse`, `__pathClean`, `__sortSlice`,
`__sclone`, `__ifv`, `__ifp`, the `__json_*` encoding/json runtime and the `__simd_*` `gofront/simd`
fallback) are tree-shaken: only emitted when actually used. `encoding/json` additionally emits
one memoized encoder/decoder per reachable type, derived from the struct tags preserved by the
parser and the field sets resolved by the type checker. Optional inline source maps are supported
via VLQ-encoded mappings.

### 5. Lowering & WASM backend (`src/lower/`, `src/backend/wasm/`)

`src/lower/` runs analysis passes shared by both backends (ownership/clone elision, address-taken
boxing, range shape, named returns/`defer`, embedded-method stubs, closure captures, global
immutability/init-path analysis, and pointer escape analysis) and stores the results in side tables
keyed by AST node.

When a package targets WebAssembly (`//gofront:target wasm` or `both`), `src/backend/wasm/` emits
a WebAssembly GC module:

| File | Role |
|---|---|
| `index.js` | `ModuleEmitter` — lowers the typed AST into module IR (types, functions, imports, exports) |
| `monomorph.js` | Monomorphisation of generic functions and struct types for the WASM target |
| `types.js` | GoFront types → WasmGC types; recursive structs share one `rec` group |
| `emit.js` | `FunctionEmitter` core — prologue/epilogue, defer/recover frames, locals, control stack; composed from the mixins below |
| `emit-stmts.js` | statements (decls, assignment, `if`/`for`/`switch`/`range`, `return`) |
| `emit-exprs.js` | expressions (literals, operators, indexing, slicing, conversions) |
| `emit-builtins.js` | `panic`/`recover`, Go builtins (`len`, `append`, `make`, …) and call dispatch |
| `emit-maps.js` | map runtime helpers (key hash/eq, get/set/delete, iteration) and zero values |
| `emit-shared.js` | `gofront/shared` linear-memory buffer allocation, load/store indexing, `Subarray` and `copy` |
| `stdlib/` | natively implemented stdlib modules (`core.js`, `bytes.js`, `pure.js`, `io.js`, `time.js`, `packages.js`, `simd.js`, indexed by `index.js`) |
| `encode.js` | Module IR → binary (`LEB128`, sections, `gofront` custom section, `app.wasm.map` source maps) — no dependencies |
| `optimize.js` | Binaryen (`wasm-opt`) optimization pipeline (`-O3` + `--gufa`) and source map pass-through for `--release` / `--wasm-opt` |
| `wat.js` | Module IR → WAT text for `--emit-wat` and golden tests |
| `glue.js` | JS imports (`Math`, string builtins, console, panic) and the `instantiateWasm()` loader |
| `boundary.js` | The JS facade spliced into `app.js`: handle classes, copy-in/out, live views, `gofront/shared` views, trap mapping |

`compiler.js` links every `wasm`/`both` unit reached by a build into a single `app.wasm` and
rejects top-level name collisions between them.

`gofront test` runs the tests of a `wasm` package inside the linked module (`*testing.T`
stays a JS object) and runs the tests of a `both` package twice — once per backend,
reported as `pkg [js]` and `pkg [wasm]` — ensuring both backends produce identical results.

*(For package targets, boundary rules and benchmarks see the [Hybrid JS + WebAssembly Guide](hybrid-wasm.md).)*

---

## Standard library & Conformance

### Go-source standard library (`stdlib/`)

GoFront provides pure Go implementations of standard library packages (such as `encoding/csv`, `container/heap`, `cmp`, `iter`, `hash/*`, `net/url`, `bufio`, and `context`), located in `stdlib/`. These packages are written in GoFront Go with `//gofront:target both` and `//go:build gofront`. The resolver loads them before built-in fallbacks and compiles them into the caller's target (`js`, `wasm`, or `both`) with no external runtime dependencies. Package overlays extend emitter-backed namespaces with pure Go implementations.

### Standard library manifest (`stdlib/manifest.json`)

The coverage manifest records every member of every standard library package listed in Go's `api/go1.*.txt` specifications (targeting Go 1.26). It documents each member's kind, signature, availability (`js`, `wasm`, `both`, or `excluded:<reason>`), and implementation source (`emitter` or `source`). The manifest is checked into the repository, allowing CI and coverage verification to run without requiring a host Go toolchain.

### Maintenance scripts (`scripts/`)

- `scripts/stdlib-manifest.js`: Parses Go API specification files, applies overrides from `scripts/manifest-overrides.json`, and generates or validates (`--check`) `stdlib/manifest.json`.
- `scripts/docs-stdlib.js`: Reads `stdlib/manifest.json` and `test/unit/types/stdlib-coverage.gaps.json` to generate or check the stdlib coverage tables in `docs/language-support.md` and `docs/hybrid-wasm.md`.

### Conformance testing (`test/conformance/`)

The conformance test suite verifies standard library behavior against the official Go compiler:

- Each fixture in `test/conformance/<pkg>/<name>.go` is a standalone Go program whose expected output is recorded in `<name>.out` using real Go (`go run`).
- `npm run conformance` (`test/conformance/run.js`) compiles every fixture as a `both` package, executes it under both the JavaScript and WebAssembly backends, and compares stdout byte-for-byte with `<name>.out`.
- `npm run conformance:update` (`test/conformance/update.js`) regenerates the `.out` golden files using the Go 1.26 toolchain when new conformance tests are added.

---

## Source layout

```
stdlib/               Go-source standard library packages (//gofront:target both)
  manifest.json       Standard library coverage manifest against Go 1.26 API
  <pkg>/              Pure Go implementations (cmp, iter, container, csv, url, etc.)
scripts/
  stdlib-manifest.js  Generates and checks stdlib/manifest.json from Go API files
  manifest-overrides.json Overrides and status annotations for the manifest
  docs-stdlib.js      Generates stdlib tables in language-support.md and hybrid-wasm.md
src/
  index.js            CLI entry: argument routing, file I/O, watch mode
  cli-core.js         dev / build / check / test / prep / init command implementations
  colors.js           ANSI color helpers and diagnostic formatting
  compiler.js         compileDir / compileSingleFile: parse → check → lower → emit, package linking
  resolver.js         import resolution: local packages, npm types, .d.ts, builtin package list, stdlib/
  project-config.js   gofront.json / package.json "gofront" settings
  dev-server.js       static server, SSE live reload, error overlay
  test-runner.js      *_test.go discovery and Go-style harness (JS, wasm and dual-target)
  asset-manager.js    assetCopy and serveDir mirroring
  vendor.js           npm dependency bundling via rolldown / esbuild
  pwa.js              service worker + precache manifest for --pwa
  minifier.js         built-in minifier (--minify, --mangle)
  dts-parser.js       TypeScript .d.ts → GoFront types
  lexer.js, tokens.js             Go lexer with semicolon insertion and //gofront: directives
  templ-lexer.js, templ-parser.js .templ dual-mode lexer and parser
  parser/             declarations, statements, expressions, types (mixins on Parser)
  typechecker/        resolve, assignability, statements, expressions, termination; stdlib/ typings
  lower/              backend-independent analyses stored as side tables
  backend/js/         JS code generator: statements, expressions, templ, runtime helpers, source maps, stdlib/ shims
  backend/wasm/       WasmGC backend (see table above)
test/
  conformance/        Byte-for-byte output conformance fixtures compared with real Go
    run.js            Conformance runner (JS and WASM backends vs .out golden files)
    update.js         Regenerates .out golden files using the Go 1.26 toolchain
  unit/               Compiler, parser, type checker, and backend unit tests
  e2e/                End-to-end and performance benchmark suites
```

Layer boundaries (`cli → support → backend → lower → typechecker → parser → lexer → types`)
are enforced by [Sentrux](https://sentrux.dev) on every `npm run check`.

---

