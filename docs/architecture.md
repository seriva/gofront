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

### 1. Lexer (`src/lexer/`)

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

Runtime helpers (`__len`, `__append`, `__s`, `__equal`, `__cmul`, `__cdiv`, `__error`,
`__sclone`, `__ifv`, `__ifp` and the `__simd_*` `gofront/simd` fallback) are tree-shaken: only
emitted when actually used. `encoding/json` has no JavaScript emitter of its own: its calls compile
to the same generated Go codecs as on WebAssembly (`src/lower/json-codecs.js`, on top of
`stdlib/internal/jsonrt/`), and the JavaScript backend emits those like any other package code,
with host fast paths for the encoder's buffer writes and the decoder's string, number and
validity reads. Optional inline source maps are supported
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
| `index.js` | `compileWasmModule` entry — lowered AST + types → module IR → binary / WAT |
| `module-emitter.js` | `ModuleEmitter` — the module IR builder: types, imports, globals, functions, exports |
| `prescan.js` | Pre-scan of the lowered AST to decide which imports, runtime helpers and interface dispatchers a module needs |
| `globals.js` | Package-level constants and variables, zero values, the synthesised global init function and interface dispatchers |
| `method-expr.js` | Method expressions (`T.M`) and method values (`x.M`) |
| `variadic.js` | Variadic parameters as `[]T` parameters and call-site packing |
| `monomorph.js` | Monomorphisation of generic functions and struct types for the WASM target |
| `types.js` | GoFront types → WasmGC types; recursive structs share one `rec` group |
| `emit.js` | `FunctionEmitter` core — prologue/epilogue, defer/recover frames, locals, control stack; composed from the mixins below |
| `emit-stmts.js` | statements (decls, assignment, `if`/`for`/`switch`/`range`, `return`) |
| `emit-exprs.js` | expressions (literals, operators, indexing, slicing, conversions) |
| `emit-builtins.js` | `panic`/`recover`, Go builtins (`len`, `append`, `make`, …) and call dispatch |
| `emit-maps.js` | map runtime helpers (key hash/eq, get/set/delete, iteration) and zero values |
| `emit-shared.js` | `gofront/shared` linear-memory buffer allocation, load/store indexing, `Subarray` and `copy` |
| `stdlib/` | the `gofront/simd` emitter (`simd.js`), indexed by `index.js`; every other package is Go source |
| `encode.js` | Module IR → binary (`LEB128`, sections, `gofront` custom section, `app.wasm.map` source maps) — no dependencies |
| `optimize.js` | Binaryen (`wasm-opt`) optimization pipeline (`-O3` + `--gufa`) and source map pass-through for `--release` / `--wasm-opt` |
| `wat.js` | Module IR → WAT text for `--emit-wat` and golden tests |
| `glue.js` | JS imports (`Math`, string builtins, console, panic) and the `instantiateWasm()` loader |
| `boundary.js` | The JS facade spliced into `app.js`: handle classes, copy-in/out, live views, `gofront/shared` views, trap mapping |

`compiler.js` links every `wasm`/`both` unit reached by a build into a single `app.wasm` and
rejects top-level name collisions between them.

`gofront test` runs the tests of a `wasm` package inside the linked module and runs the tests
of a `both` package twice — once per backend, reported as `pkg [js]` and `pkg [wasm]` —
ensuring both backends produce identical results. The `testing` package is Go source
(`stdlib/testing/`), so `*testing.T` never crosses the boundary: the runner compiles one extra
in-memory file, `gofront_testmain_test.go`, next to the package's `_test.go` files (it is never
written to disk). The file holds a table of the package's `Test…` and `Benchmark…` functions and
`GofrontRunTests(run, bench string, verbose bool) int`, which builds a `testing.M` and runs it.
In a `js` package the driver is an `async func` that awaits async tests and subtests; when the
package has a `TestMain` the driver calls it with the `M` instead. The generated test child
process (`src/cli/test-runner.js`) only loads the bundle, applies `--dom`, calls
`GofrontRunTests` and exits with its result; discovery, filtering, output and timing all
happen inside the compiled package. The two host primitives it needs, a monotonic clock and a
regular-expression match for `-run`/`-bench`, are the `testing_nanotime` and `testing_match`
intrinsics, and `testing_call` (js only) keeps the promise of an async test body.

*(For package targets, boundary rules and benchmarks see the [Hybrid JS + WebAssembly Guide](hybrid-wasm.md).)*

---

## Standard library

### Go-source standard library (`stdlib/`)

Most standard library packages are ordinary GoFront Go under `stdlib/<import path>/`, written with `//gofront:target both` and `//go:build gofront`. The resolver loads them before the built-in namespaces and compiles them into the caller's target (`js`, `wasm` or `both`), so each package is written once and behaves the same on both backends. Only `gofront/shared` and `gofront/simd` remain built-in namespaces implemented by the compiler.

A file marked `//gofront:target js` (such as `stdlib/time/sleep_js.go`) is loaded only for `js` packages, where it may use `async`/`await` and browser globals; a `wasm` or `both` package gets the package without those files and reports `'time.Sleep' is only available in js packages` for a name they declare. A package whose files are all `js` (`regexp`, `gom`) is rejected at the import of a `wasm` or `both` package.

Function bodies in these packages are type-checked only when the program reaches them, and only reachable declarations are emitted, so an unused import adds nothing to `app.js` or `app.wasm`.

Two markers connect Go source to the backends:

- `//gofront:native <name>` keeps the Go body as the specification and lets a backend replace calls with a faster host primitive (`indexOf` for `strings.Index`, `Math.clz32` or a WASM instruction for `math/bits`). A native may decline an instantiation, in which case the call runs the Go body. Names form a closed set in `src/typechecker/types.js`; implementations live in `src/backend/js/natives.js` and `src/backend/wasm/natives.js`. `test/unit/compiler/natives.test.js` fails when a name is missing from a registry (outside a short single-target list) or when a registry entry has no Go declaration.
- `//gofront:intrinsic <name>` marks a body-less function whose body each backend supplies (host clock, entropy, time-zone offset, standard streams, exit and environment, Unicode tables, IEEE-754 bit casts and the host `Math.*` functions behind `math`; target-specific intrinsics such as `time_sleep` provide host timers on JavaScript).

| Package | Where it lives |
|---|---|
| `cmp`, `iter`, `maps`, `errors`, `io`, `html`, `path`, `path/filepath`, `sync`, `hash`, `crypto/sha256`, `encoding/hex`, `encoding/base64` | Go only, `stdlib/<package>/` |
| `slices`, `sort`, `strings`, `bytes`, `unicode/utf8`, `math`, `math/bits`, `strconv`, `math/rand`, `os`, `unicode`, `crypto/rand`, `time` | Go in `stdlib/<package>/` plus natives and intrinsics |
| `fmt` | Go in `stdlib/fmt/` over `stdlib/internal/fmtrt/`, plus generated formatters (see below) |
| `encoding/binary` | Go in `stdlib/encoding/binary/` |
| `regexp`, `gom`, and `time.Sleep`, `time.AfterFunc`, `time.Timer` | Go marked `//gofront:target js` (`stdlib/regexp/`, `stdlib/gom/`, `stdlib/time/sleep_js.go`); loaded only for `js` packages |
| `testing` | Go in `stdlib/testing/` plus intrinsics; the runner adds a generated driver (see [Testing](usage.md#testing)) |
| `context` | Go in `stdlib/context/` (`Background`, `TODO`, `WithCancel`, `WithValue`; no `Done` channel) |
| `gofront/shared`, `gofront/simd` | emitters with typings in `src/typechecker/stdlib/` |
| `encoding/json` | generated codecs plus Go support code in `stdlib/encoding/json/` and `stdlib/internal/jsonrt/` |

#### Generated Go per package

Some library calls need code that depends on the types the calling package uses: an `encoding/json` codec for each encoded type, a type switch for each `errors.As` target, and a formatter for each type that reaches an `fmt` operand. Instead of emitting these per backend, the compiler writes them as ordinary Go source: after a package type-checks, the generators in `src/lower/` (`json-codecs.js`, `errors-as.js`, `fmt-formatters.js`) each return a fragment, and `checkGeneratedGo` in `src/link/stdlib.js` joins the fragments into one file, `gofront_gen.go`, which is parsed, imported and type-checked as one more file of the package. Calls to the library are rewritten to call the generated functions, which are named `gfj_<pkg>_*` (json), `gfe_<pkg>_as_*` (`errors.As`) and `gff_<pkg>_*` (`fmt`). Because the generated file goes through the same checker and backends as hand-written code, `js`, `wasm` and `both` packages behave the same and no backend has a formatter or `errors.As` implementation of its own.

---

## Source layout

```
stdlib/               Go-source standard library packages (//gofront:target both)
  <pkg>/              Pure Go implementations (cmp, iter, slices, strings, etc.)
src/
  index.js            CLI entry: argument routing, file I/O, watch mode
  compiler.js         compileDir / compileSingleFile / compileWasm: parse → check → lower → emit
  resolver.js         import resolution: local packages, npm types, .d.ts, builtin package list, stdlib/
  dts-parser.js       TypeScript .d.ts → GoFront types
  cli/                command layer
    cli-core.js         dev / build / check / test / prep / init command implementations
    colors.js           ANSI color helpers and diagnostic formatting
    project-config.js   gofront.json / package.json "gofront" settings
    dev-server.js       static server, SSE live reload, error overlay
    test-runner.js      *_test.go discovery and Go-style harness (JS, wasm and dual-target)
    asset-manager.js    assetCopy and serveDir mirroring
    vendor.js           npm dependency bundling via rolldown / esbuild
    pwa.js              service worker + precache manifest for --pwa
    minifier.js         built-in minifier (--minify, --mangle)
  link/               bundle linking: source maps, wasm units into one app.wasm, Go-source stdlib
  lexer/              lexer.js and tokens.js (Go lexer with semicolon insertion and //gofront: directives), templ-lexer.js (.templ dual-mode lexer)
  parser/             declarations, statements, expressions, types (mixins on Parser); templ.js is the .templ parser
  typechecker/        resolve, assignability, statements, expressions, termination; stdlib/ typings (`gofront/shared`, `gofront/simd`, WebGL/WebGPU/TypedArray globals, unsupported-member diagnostics)
  lower/              backend-independent analyses stored as side tables
  backend/shared/     fmt type descriptors used by both backends
  backend/js/         JS code generator: statements, expressions, templ, runtime helpers, source maps, `gofront/shared` and `gofront/simd` calls
  backend/wasm/       WasmGC backend (see table above)
test/
  unit/               Compiler, parser, type checker, and backend unit tests; run.js discovers every *.test.js
    cli/              CLI, dev server, test runner, prep, PWA and asset tests
  e2e/                Playwright specs against the compiled examples
  perf/               Benchmarks (raycast, JSON, particles) and the zero-allocation check
```

Layer boundaries (`cli → support → backend → lower → typechecker → parser → lexer → types`)
are enforced by [Sentrux](https://sentrux.dev) on every `npm run check`.

---

