# Native Go Compiler Engine — Design Plan

**Version:** v2.0.0  
**Status:** Draft (revised 2026-10-21)  
**Depends on:** v1.8.0 ([`docs/v1.8.0/portable-go-plan.md`](../v1.8.0/portable-go-plan.md)), the **last feature release of the JS engine**.  
**Replaces:** None  
**Followed by:** v2.1.0 (continuous feature evolution on the native Go engine)  

**Baseline Spec:** v1.8.0, comprising:
- The v1.4.0 language (including `.templ` and component-colocated scoped `css`);
- The complete hybrid JS + WASM compiler from v1.5.0–v1.6.1 (`src/lower/`, package targets, JS strict numeric mode, full WasmGC backend, JS ↔ WASM boundary facades, shared linear-memory buffers);
- v1.7.0 compile-time `encoding/json`, `.d.ts` tuple returns, Preact integration, and `gofront/simd`;
- v1.8.0 WASM language parity (array value semantics, accessor-ref pointers to scalar fields/elements, per-iteration loop variables, range-over-func, generic named func types and type aliases, complex numbers, `min`/`max`, `[]rune`, exact constant folding, strict-mode runtime panics, universe-scope predeclared-name shadowing), the Go-source stdlib (`runtime/stdlib/`) with overlays and coverage manifest (`runtime/stdlib/manifest.json`), `iter`/`cmp`, `bufio`/`net/url`/`context`, `encoding/csv` and pure Go packages, pure-WASM `encoding/json`, and completed `gofront/simd`.

See [`docs/v1.6.1/wasm-gaps-plan.md`](../v1.6.1/wasm-gaps-plan.md), [`docs/v1.7.0/json-preact-simd-plan.md`](../v1.7.0/json-preact-simd-plan.md), and [`docs/v1.8.0/portable-go-plan.md`](../v1.8.0/portable-go-plan.md).

**Prerequisite:** v1.8.0 released. The JS engine is feature-frozen from that release on (see [Cutover & Coexistence](#cutover--coexistence)). Phases 0–2 (oracle, lexer, parser) may start earlier because v1.8.0 adds no syntax changes.

---

## Goal

Rewrite GoFront's compiler core and CLI from Node.js (currently 107 ESM files, 67,679 LOC under `src/`) into a native Go binary (`cmd/gofront`) that produces **the same JavaScript output, the same WebAssembly output, the same diagnostics, and the same CLI behaviour** as the v1.8.0 JS engine.

Motivation:
1. **Compilation speed:** Remove V8 process startup and ESM module-graph loading (~775–1,100 ms per CLI subprocess), JIT warm-up (~50–185 ms cold in-process compile), and GC pauses. The *target* is sub-10 ms incremental rebuilds in `gofront dev` for projects the size of `simplefps`.
2. **No Node.js for the core loop:** `dev`, `build` (without npm vendor deps), `check`, and `init` run from a single static Go binary (`go install github.com/seriva/gofront/cmd/gofront@latest` or prebuilt GitHub releases).
3. **Unchanged npm workflow:** `npm i -g gofront` and `npx gofront` keep working. As with `esbuild` and `biome`, the npm package becomes a thin launcher that runs a prebuilt platform binary (`@gofront/linux-x64`, `@gofront/darwin-arm64`, `@gofront/windows-x64`, etc.) installed through `optionalDependencies`.
4. **Maintainability:** Statically typed AST/type structs, sealed interfaces, and typed side tables (`types.Info`, `lower.Info`) replace ad-hoc JS objects whose properties are mutated across compilation passes (`_type`, `_lvalue`, `_className`, `_boxed`).
5. **Unified multi-backend foundation:** Carries over shared lowering (`internal/lower`) and both backends (`internal/backend/{js,wasm}`) so all v2.x compiler and backend work happens in native Go.

**Done means:**
- Every test in the unit test suite (`test/unit/run.js`), example DOM tests, Playwright E2E suite (`npx playwright test`), v1.8.0 language parity matrix, coverage manifest gate, and real-Go conformance suite (`test/conformance/`) passes against the native engine (`GOFRONT_ENGINE=native`).
- Emitted JavaScript and scoped CSS match the v1.8.0 JS engine byte-for-byte across all test fixtures.
- Emitted unoptimized `.wasm` binaries and `.wat` dumps match the v1.8.0 JS engine byte-for-byte, and optimized `.wasm` passes `WebAssembly.validate` and runtime parity.
- Diagnostics (error message, hints, file, line, UTF-16 column, caret alignment) match the JS engine byte-for-byte.
- `simplefps` builds and runs as a hybrid app at 60 FPS, and `npm run bench` (raycast and SIMD benchmarks) runs within noise ($\pm 3\%$) of v1.8.0.
- The npm package ships and executes the native binary by default, with `README.md`, `docs/roadmap.md`, and `CHANGELOG.md` updated.

---

## Scope Rule & Boundary Matrix

The v2.0.0 release is strictly a **1:1 behavioural port of the v1.8.0 compiler and CLI**. It introduces zero new language syntax, zero new stdlib packages, and zero changes to emitted JS or WASM semantics.

| Category | Rule | Examples / Members |
|---|---|---|
| **In scope: core** | Full native Go port of compiler pipeline, tooling, and CLI | `cmd/gofront`, `internal/token`, `internal/lexer`, `internal/ast`, `internal/parser`, `internal/types`, `internal/check`, `internal/stdlib`, `internal/dts`, `internal/resolve`, `internal/lower`, `internal/compiler`, `internal/minify`, `internal/devserver`, `internal/cli`, `internal/oracle` |
| **In scope: target-specific** | Target codegen faithful to v1.8.0 `js`, `wasm`, and `both` rules | `internal/backend/js` (ES6 classes, strict numerics + panics, templ DOM, scoped CSS, VLQ source maps, emitter stdlib, JSON codecs, SIMD fallback), `internal/backend/wasm` (WasmGC IR, deterministic binary encoder, WAT printer, monomorphiser, insertion-ordered maps, `try_table` defer/recover, accessor-ref pointers, WASM stdlib + JSON + SIMD, boundary facades/loader, Binaryen wrapper) |
| **Excluded: runtime / platform** | Incompatible with GoFront's "no runtime" invariant; targeted diagnostics | Goroutines (`go`), channels (`chan`, `<-`), `select`, `goto`, `unsafe`, runtime `reflect`, `cgo`, embedded JS VMs (Goja/QuickJS) |
| **Excluded: deferred** | Desirable improvements deferred to v2.x to preserve byte parity | Multi-error parser recovery (stops at first `ParseError` like JS engine), public Go compiler API (all packages stay under `internal/`), replacing minifier with `esbuild` Go API (breaks byte parity), migrating existing emitter-backed stdlib packages to Go-source |

### Node.js Dependency Matrix

| Command | Native binary alone | Needs Node | Why |
|---|---|---|---|
| `gofront check` | ✓ | | Pure compile |
| `gofront <input> [-o] [--watch] [--serve] [--minify] [--source-map]` | ✓ | | Pure compile + native HTTP/SSE dev server |
| `gofront dev` | ✓ | | Compile, watch (`fsnotify`), serve, asset sync |
| `gofront build` (no npm `dependencies`) | ✓ | | Compile, minify, assets, PWA |
| `gofront build` (with npm `dependencies`) | | ✓ | Vendor step delegates to `src/vendor.js` (Rolldown/esbuild) |
| `gofront build --release` / `--wasm-opt` (hybrid app) | ✓ with `wasm-opt` on `PATH` | ✓ otherwise | Binaryen: prefers native `wasm-opt` binary, falls back to `binaryen` npm package via Node |
| `gofront build --emit-wat` | ✓ | | Native WAT printer |
| `gofront prep` / `vendor` | | ✓ | Rolldown/esbuild from consumer `devDependencies` |
| `gofront test [--dom]` | | ✓ | Executes compiled JS (and JSDOM) in `node:vm` via `src/test-runner.js` |
| `gofront init` | ✓ | | Pure filesystem scaffolding |

If Node is missing (or, for `--release`, neither `wasm-opt` nor Node is available), the native binary prints an actionable error naming the subcommand and the missing prerequisite. The npm launcher resolves Node-side scripts (`src/vendor.js`, `src/test-runner.js`) relative to its own package root so `npx gofront prep` and `npx gofront test` work with zero extra configuration.

---

## Verified Gaps & Baseline Audit

Empirically audited against the repository on 2026-10-21:

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Go Module Root & GoFront Files | No `go.mod` exists at root. Running `go vet ./...` at root once initialized would parse 68 existing GoFront `.go` files under `example/`, `test/unit/fixtures/`, and `test/e2e/perf/raycast/` that use GoFront extensions (`async func`, relative `import "./utils"`, `mixed_packages/{a,b}.go` in one directory) and fail. Modifying `test/unit/fixtures/*_error.go` to add build tags would shift line numbers asserted by existing tests. | Probe: `find example test -name '*.go' \| wc -l` → 68 files. Probe with `go1.27.2`: adding `ignore ( example / test/unit/fixtures / test/e2e )` in `go.mod` plus `//go:build gofront` on `runtime/stdlib/` makes `go vet ./...` exit 0 without modifying any existing fixture or example `.go` file. |
| `//go:embed` Parent Path Restriction | Go's `embed` package rejects `..` in `//go:embed` patterns, so packages under `internal/backend/js` or `internal/stdlib` cannot directly declare `//go:embed ../../runtime/js`. | Go `embed` spec: embedding across sibling directories requires an `embed.FS` exported from `runtime/assets.go` (`package runtime`) at the `runtime/` root. |
| CLI & Rebuild Latency Baseline | Every CLI invocation pays ~775–1,100 ms to boot Node and parse 107 ESM files (67,679 LOC). Cold in-process compiles take 49–184 ms; warm parse-cached rebuilds take 17.4–69.4 ms (up to 7× above the 10 ms target). | Probe across all 6 examples (`example/{simple,gom,templ,preact,webgl,hybrid}/src`): `simple` = 776.5 ms CLI / 168.4 ms cold / 53.6 ms warm; `hybrid` = 1,091.1 ms CLI / 184.4 ms cold / 69.4 ms warm; `webgl` = 887.9 ms CLI / 49.3 ms cold / 17.4 ms warm. |
| Synchronous Test Helpers vs Async Child Process | All 1,953 unit tests call `compile()`, `compileWasm()`, and `compileDir()` synchronously (`test/unit/helpers.js:73-120`, `216-238`). A naive `child_process.spawn` oracle requires async stream reads on Node's event loop, whereas `fs.readSync` on libuv pipes throws `EAGAIN` (`O_NONBLOCK`). | Probe: `compile.constructor.name === "Function"`. Synchronous IPC to a persistent `gofront oracle` process per test worker requires a dedicated sidecar `node:worker_threads` bridge using `SharedArrayBuffer` + `Atomics.wait` + `receiveMessageOnPort`. |
| Test Runner File Filtering | `test/unit/run.js` hardcodes `TEST_FILES` (64 suites) and ignores `process.argv.slice(2)`, preventing targeted execution of a single test file during incremental subsystem porting. | Inspection of `test/unit/run.js:19-92`: `process.argv` is never read; running `node test/unit/run.js <file>` executes all 64 suites. |
| Coupled Runtime Helpers & Host Glue | 35 JS runtime helpers (`HELPER_LEN` .. `HELPER_SIMD`, 1,891 LOC) are inline template strings in `src/backend/js/runtime.js`, and 808 LOC of WASM host imports (`WASM_IMPORTS_JS`, `WASM_STDLIB_JS`) live inside `src/backend/wasm/boundary.js:1731-2538`. Furthermore, `package.json:30` sets `"files": ["src/"]`, which would exclude `runtime/` from npm tarballs if not updated. | Inspection of `src/backend/js/runtime.js:5-1848`, `src/backend/wasm/boundary.js:1731, 1887`, and `package.json:30-32`. |
| Subsystem Scale in WASM & Stdlib | `src/backend/wasm/` totals 39,850 LOC: 19,150 LOC of core compiler/boundary (`index.js` 3,759, `boundary.js` 2,982, `emit-stmts.js` 2,466, `emit-exprs.js` 2,107, `emit-maps.js` 1,999, `emit.js` 1,413, `emit-builtins.js` 1,247, `encode.js` 1,048) and 20,700 LOC of WASM stdlib emitters (`core.js` 8,903, `bytes.js` 5,039, `packages.js` 2,400, `io.js` 2,161, `time.js` 1,200). | Probe: `find src -type f \| xargs wc -l` (total 67,679 LOC). Requires fine-grained phase decomposition across JS stdlib (Phases 5.1–5.2) and WASM backend/stdlib/boundary (Phases 5.3–5.7). |

---

## Out of Scope

- **Language or semantic changes:** v2.0.0 is a strict port. New syntax, type rules, stdlib packages, or WASM features wait for v2.1+. Known v1.8.0 quirks are ported *as-is* and logged for v2.x.
- **Expanding the stdlib surface:** The v1.8.0 coverage manifest (`runtime/stdlib/manifest.json`) is the frozen stdlib surface. Excluded entries remain excluded with identical diagnostics. `gofront/simd` retains the stability status decided in v1.8.0.
- **Porting Go-source stdlib packages:** Pure packages and overlays written in GoFront Go under `runtime/stdlib/` in v1.8.0 are shared directly and embedded via `runtime/assets.go` (`//go:embed`). They are compiled by GoFront, not rewritten in host Go.
- **Rewriting vendor bundling:** `gofront prep` / `vendor` (and the vendor step of `gofront build` when npm `dependencies` are present) continues delegating to [`src/vendor.js`](../../src/vendor.js), which invokes Rolldown or esbuild from the consumer's `devDependencies`.
- **Embedding a JS runtime for `gofront test`:** GoFront will not embed Goja (incomplete modern ES/WasmGC/JSDOM support) or QuickJS (requires CGO). Node is already present wherever JS/WASM unit tests and JSDOM run.
- **Using standard `go/parser` / `go/ast` / `go/types`:** The standard library packages enforce the official Go grammar and type rules strictly, rejecting GoFront extensions (`async`/`await`, `.templ`, `css`, `js:` imports, browser globals). `go/constant` and `math/big` *are* used for exact untyped constant arithmetic.
- **Parser multi-error recovery:** The JS parser stops at the first `ParseError`. The native parser matches that behaviour; multi-error recovery is deferred until parity is locked.
- **Public Go compiler API:** All compiler packages reside under `internal/` so internal interfaces can evolve freely after cutover.

---

## Approach

### 1. Architecture & Design Decisions

```
 .go / .templ / .d.ts
        │
        ▼
 ┌─────────────┐  tokens  ┌─────────────┐  AST  ┌──────────────────┐  AST + Info  ┌──────────────┐  lowered pkg   ┌──────────────────┐
 │ lexer       │ ───────► │ parser      │ ────► │ typechecker      │ ───────────► │ lower        │ ─────────────► │ backend          │
 │ • Go ASI    │          │ • Go exprs  │       │ • 5 passes       │              │ • clone      │                │ • js             │
 │ • templ/css │          │ • generics  │       │ • generics       │              │   elision    │                │ • wasm (full     │
 │ • directives│          │ • templ/css │       │ • stdlib + web   │              │ • boxing     │                │   hybrid, from   │
 └─────────────┘          └─────────────┘       │ • .d.ts types    │              │ • captures   │                │   v1.8.0)        │
                                                │ • pkg targets    │              │ • escape     │                └────────┬─────────┘
                                                └──────────────────┘              │ • range/defer│                         │
                                                                                  │ • reachability                         ▼
                                                                                  └──────────────┘          JS + CSS + source map + .wasm
```

- **Side Tables (`types.Info` and `lower.Info`):** Instead of mutating AST nodes with `_type`, `_lvalue`, `_className`, `_boxed`, or `_cloneElided`, the type checker populates `types.Info` and the lowering pass populates `lower.Info` (mirroring `src/lower/` from v1.5.0–v1.8.0).
- **Unified `Backend` Interface:** Both backends implement `Emit(pkg *lower.Package) (Output, error)` producing JS, extracted CSS, VLQ source map mappings, and (for `wasm`/`both`) `.wasm` bytes, `.wat` text, string tables, and boundary facades.
- **Single-Source Shared Assets (`runtime/`):**
  - `runtime/js/*.js` holds the 35 JS runtime helpers extracted from `src/backend/js/runtime.js`.
  - `runtime/js/wasm/*.js` holds `WASM_IMPORTS_JS` and `WASM_STDLIB_JS` extracted from `src/backend/wasm/boundary.js`.
  - `runtime/stdlib/` holds the v1.8.0 Go-source stdlib packages, overlays, and `manifest.json`.
  - `runtime/assets.go` (`package runtime`) exports `//go:embed js/*.js js/wasm/*.js stdlib` as `embed.FS` so `internal/*` packages can read them without `..` path traversal, while the JS engine loads the exact same files via `fs.readFileSync`.

#### 1.1 Repository Layout

A single Go module at the repo root (`github.com/seriva/gofront`). `go.mod` uses `ignore ( example / test/unit/fixtures / test/e2e )` so standard Go tools (`go build ./...`, `go test ./...`, `go vet ./...`) skip GoFront example and test fixture directories without altering fixture line numbers, while `runtime/stdlib/` and `test/conformance/` carry `//go:build gofront`.

```
cmd/gofront/            CLI entry point (incl. hidden `oracle` subcommand)
internal/token          Token kinds, Pos, File line/UTF-16 column tables
internal/lexer          Go lexer + templ/css dual-mode lexer + //gofront: directives
internal/ast            Sealed AST node interfaces and structs (Go + templ/css)
internal/parser         Recursive-descent parser (Go + templ/css + struct tags)
internal/types          Type representations, lexical Scope, universe scope, Info side table
internal/check          5-pass type checker (types, funcs, embedding, vars/consts, bodies)
internal/stdlib         Emitter-backed stdlib typings, browser/WebGL/WebGPU typings, embedded stdlib loader
internal/dts            TypeScript .d.ts declaration parser (incl. tuple returns)
internal/resolve        Multi-file package loading, local imports, npm/@types lookup, target graph
internal/lower          Shared lowering + semantic analyses (port of src/lower/)
internal/compiler       Multi-package topological compiler, parse cache, chunk/source-map merger
internal/backend/js     JS emitter (incl. strict numeric/panic mode), stdlib codegen, templ/css, source maps
internal/backend/wasm   WasmGC IR, binary encoder, WAT printer, monomorphiser, maps, stdlib, boundary, Binaryen
internal/minify         3-stage JS minifier and local identifier mangler
internal/devserver      HTTP static server, SSE live reload + CSS hot swap, recursive fsnotify watcher
internal/cli            CLI flag parser, project config, asset sync, PWA generator, Node delegation
internal/oracle         JSON-lines differential testing oracle server
runtime/assets.go       //go:embed exporter for runtime/js/, runtime/js/wasm/, and runtime/stdlib/
runtime/js/*.js         Shared JS runtime helpers
runtime/js/wasm/*.js    Shared WASM host imports + boundary glue
runtime/stdlib/         Shared Go-source stdlib packages, overlays, and manifest.json (from v1.8.0)
```

#### 1.2 Differential Testing Oracle (`internal/oracle` & `test/unit/helpers.js`)

The 1,953 unit tests in `test/unit/**/*.test.js` call `compile`, `compileFile`, `compileWasm`, `compileHybrid`, `compileHybridProject`, `compileDir`, `Lexer`, and `Parser` synchronously through [`test/unit/helpers.js`](../../test/unit/helpers.js), then execute emitted code in `node:vm` or `WebAssembly.Instance`. Hooking into `helpers.js` turns the entire existing test suite into a parity oracle without rewriting tests:

```
 test/unit/*.test.js ──► helpers.js ──┬── GOFRONT_ENGINE=js     → src/* (reference JS compiler)
                                      └── GOFRONT_ENGINE=native → oracle-bridge.js (Worker + Atomics.wait)
                                                                       │
                                                                       ▼
                                                                 gofront oracle (persistent stdin/stdout JSON-lines)
```

- **`gofront oracle` (hidden subcommand):** Long-lived process reading newline-delimited JSON requests (`{id, op: "ping" | "tokens" | "parse" | "check" | "compile" | "compileWasm" | "compileDir" | "minify", source, file, dir, files, opts}`) and writing single-line JSON responses (`{id, ok, js, css, wasmBase64, wat, stringTable, errors, tokens, mappings}`).
- **Synchronous Worker Bridge (`test/unit/oracle-bridge.js`):** Because `compile()` in `test/unit/helpers.js` is synchronous and libuv pipes are non-blocking (`EAGAIN` on `fs.readSync`), each test worker spawns one lightweight `node:worker_threads` bridge thread that owns a persistent `gofront oracle` child process. `helpers.js` posts requests over a `MessageChannel`, waits synchronously via `Atomics.wait(syncI32, 0, 0)`, and reads the reply via `receiveMessageOnPort(port)` with sub-millisecond IPC overhead and zero process-spawn churn.
- **Skipped / Internal-Probe Accounting:** Unit tests that directly instantiate internal JS classes (`new TypeChecker()`, `lower()` internal maps) either use the corresponding oracle `op` or are tagged `js-only` with the skipped count printed in the test summary so coverage is never silently lost.

#### 1.3 Tokens & Lexer (`internal/token`, `internal/lexer`)

```go
type Pos struct {
    File   *File
    Offset int // byte offset; Line and UTF-16 Col computed from File line table
}

type Token struct {
    Kind    Kind
    Literal string
    Pos     Pos
}
```

- **Go tokens:** Literals (`INT`, `FLOAT`, `IMAG`, `CHAR`, `STRING`, `RAW_STRING`, `IDENT`), all Go keywords including `go`, `chan`, `select`, and `goto` (lexed so the parser emits targeted GoFront diagnostics), and all operators (`&^`, `&^=`, `<-`, `~`, `...`, `++`, `--`).
- **GoFront extensions & directives:** `async`, `await`, `templ`, `css`, `//gofront:target <js|wasm|both>`, and `//gofront:intrinsic <name>`.
- **Go ASI:** At newline or EOF, insert `;` if the last token was an identifier, literal (`INT`, `FLOAT`, `IMAG`, `CHAR`, `STRING`, `RAW_STRING`), `break`/`continue`/`fallthrough`/`return`, or `++`/`--`/`)`/`]`/`}`.
- **templ/css Dual-Mode Scanner** (port of [`src/templ-lexer.js`](../../src/templ-lexer.js)):
  - Go mode at top level until `templ Name(...) {` transitions to HTML mode.
  - HTML mode scans tags, self-closing tags, static attributes, dynamic `attr={expr}`, boolean `attr?={cond}`, `{ expr }` interpolation, `@Comp(args)`, `@templ.Raw(...)`, `{ children... }`, control-flow headers (`if`/`else if`/`else`/`for`/`switch`/`case`/`default`), and SVG element depth.
  - CSS mode (`css Name() {`) scans raw CSS text with brace-depth tracking that ignores `{`/`}` inside strings and `/* ... */` comments, supporting `&` nesting, pseudo-classes, and `@media`.

#### 1.4 AST & Parser (`internal/ast`, `internal/parser`)

- **Sealed AST interfaces:** `Node`, `Expr`, `Stmt`, `Decl`, `TemplNode` with unexported marker methods (`exprNode()`, `stmtNode()`, `declNode()`, `templNode()`) enabling exhaustive Go type switches.
- **Expression precedence climbing:** Five Go binary precedence levels (`* / % << >> & &^` = 5, `+ - | ^` = 4, `== != < <= > >=` = 3, `&&` = 2, `||` = 1); unary `+ - ! ^ * &` and `await`; postfix calls (`...` spread), 2/3-index slices, index/generic `IndexList`, selectors, and type assertions. Assignment is a statement, not an expression.
- **Struct tags:** Port [`src/parser/struct-tag.js`](../../src/parser/struct-tag.js) into `internal/parser/struct_tag.go` to parse backtick struct tags (`json`, `csv`) into structured metadata at parse/check time.

#### 1.5 Types, Checker & Stdlib Registry (`internal/types`, `internal/check`, `internal/stdlib`)

```go
type Type interface {
    Underlying() Type
    String() string
}
```

- **Five-Pass Package Checker** (ports [`src/typechecker/`](../../src/typechecker/) across all files in a package per pass):
  1. **Pass 1 — Types:** Collect `type` declarations in dependency order, resolve forward/recursive references, reject invalid value cycles, unroll aliases including v1.8.0 generic type aliases (`type A[P any] = T[P]`).
  2. **Pass 2 — Functions & Methods:** Check signatures (type parameters, union constraints `~T | U`), attach methods to `T` and `*T`, register `templ` components as `func(...) gom.Node` and `css` declarations as `func() string`, validate `//gofront:intrinsic`.
  3. **Pass 3 — Embedding:** Promote embedded struct fields and methods, detect same-depth collisions, resolve embedded interfaces.
  4. **Pass 4 — Package Vars & Consts:** Topological dependency ordering across package files, `iota` evaluation, exact untyped constant folding via `go/constant` and `math/big` with typed overflow checks and JS $> 2^{53}$ precision warnings matching v1.8.0.
  5. **Pass 5 — Function & Templ Bodies:** Lexical scopes, assignability (untyped promotion, structural interface satisfaction, pointer-receiver method sets, `TAINTED_ANY` cascade suppression), generic type argument inference and instantiation, `(*T).M` pointer-receiver method expressions, control-flow labels, termination analysis ("missing return"), and unused variable/import diagnostics.
- **Stdlib & Universe Scope (`internal/stdlib`):**
  - Universe scope holds the 18 builtins (`len`, `cap`, `append`, `copy`, `make`, `new`, `delete`, `panic`, `recover`, `clear`, `min`, `max`, `print`, `println`, `complex`, `real`, `imag`), predeclared types, and browser globals (`document`, `window`, `console`, WebGL/WebGL2/WebGPU, TypedArrays) so package and local declarations can shadow them (v1.8.0 rule).
  - Emitter-backed packages are registered via table-driven definitions matching `src/typechecker/stdlib/{core,extended,web,shared,simd}.js`.
  - Go-source stdlib packages and overlays (`runtime/stdlib/` from v1.8.0) are loaded from `runtime.FS` via `internal/resolve`, type-checked from source, and merged into emitter namespaces where applicable.

#### 1.6 Lowering & JavaScript Backend (`internal/lower`, `internal/backend/js`)

- **Shared Lowering (`internal/lower`):** Mechanical port of `src/lower/` producing `lower.Info` side tables for struct and `[N]T` array clone elision (`ownership.go`), address-taken scalar boxing (`boxing.go`), closure-captured mutable variables and per-iteration loop variable boxing (`captures.go`), pointer-retention escape analysis (`escape.go`), struct/method promotion (`embedding.go`), range/defer shapes (`range.go`, `functions.go`), constant-folded literals (`globals.go`), and Go-source stdlib reachability.
- **JavaScript Backend (`internal/backend/js`):** Reproduces v1.8.0 output byte-for-byte:

| Area | Emitted JS Representation |
|---|---|
| Structs & Value Semantics | ES6 classes with zero-value constructor defaults and `__clone()`; cloned on assign/call/return/`append`/`range` unless elided by `lower.Info` |
| Pointers | Address-taken scalars boxed as `{ value: T }`; structs, slices, and maps passed by reference |
| Embedding & Wrapper Types | Flattened struct fields + delegation stubs (`Base.prototype.M.call(this, ...a)`); ES6 wrapper classes for named non-struct types with methods |
| Interfaces & Type Switches | `__ifv` / `__ifp` / `__ifs` / `__ifm` tagging so `case T` vs `case *T` is distinguished via `typeof` / `instanceof` |
| Control Flow & `defer` | Zero-alloc indexed slice `range`; `Object.keys`/`entries` map `range`; `Array.from` rune `range`; yield closure for `range`-over-func; `try/finally` defer stack |
| Numerics & Strict Mode | Integer `/` → `Math.trunc(a / b)`; `&^` → `(a & ~b)`; in `both`/strict mode: `Math.fround`, `\| 0`, `>>> 0`, `Math.imul`, shift/div-by-zero checks, and v1.8.0 `__at`/`__set`/nil-map/nil-ptr runtime panics (elided when proven in-bounds) |
| TypedArrays | `[]float32`, `[]int8..int32`, `[]uint8..uint32`, `[]rune` → TypedArrays with `.subarray()` zero-copy slicing; `[]float64` / `[]int` → `Array` |
| Stdlib, JSON, SIMD, templ & CSS | All 30 emitter-backed stdlib modules (`src/backend/js/stdlib/*`), compile-time tag-driven `encoding/json` codecs, `gofront/simd` fallback, `templ` DOM `{ Mount(___p, ___refs) }`, 32-bit FNV-1a base-36 `gfc_<name>_<hash>` scoped CSS, and VLQ source maps |

#### 1.7 WebAssembly Backend (`internal/backend/wasm`)

Ports the complete 39,850-LOC `src/backend/wasm/` subsystem as shipped in v1.8.0:
- **WasmGC Type Hierarchy & Deterministic Binary Encoder (`types.go`, `encode.go`, `wat.go`):** Recursive type groups (`rec`), immutable slice headers with shared empty headers, `externref` JS strings (via JS String Builtins + host imports), insertion-ordered hash maps, interface itabs and `ref.test`/`ref.cast` dispatch, closure structs, complex `{re, im}` structs, and v1.8.0 abstract scalar pointer supertypes with box (`{ mut value T }`) and accessor-ref (`{ anyref target, i32 index, ref $get_T, ref $set_T }`) subtypes tested via `br_on_cast`.
- **Monomorphisation & Instruction Emission (`monomorph.go`, `module.go`, `emit*.go`):** Specializes generic functions/structs/func-types; emits structured control flow (`block`/`loop`/`br_if`/`br_table`), `i32` bounds checks and induction-variable fast paths, trap-based nil dereference, scratch-global local caching, `local.tee` peepholes, `[N]T` deep array copy + clone elision, per-iteration loop variable boxes, range-over-func closures, and `try_table` + `exnref` `panic`/`defer`/`recover`.
- **WASM Stdlib, JSON & SIMD (`stdlib/*.go`):** Ports all emitter mixins (`core`, `bytes`, `io`, `time`, `packages`, `pure`, `simd`), the v1.8.0 pure-WASM `encoding/json` scanner and per-type codecs, `gofront/simd` `v128` (`0xFD` LEB128 opcodes, `F32x4`, `Mask32x4`, shuffles, SoA `Vec3x4`/`AABB4`/`Ray4`), and `gofront/shared` linear-memory views.
- **JS ↔ WASM Boundary & Binaryen (`boundary_*.go`, `optimize.go`):** Generates JS facades and `app.wasm` loader splicing embedded `runtime/js/wasm/*.js`; invokes `wasm-opt` (`-O3 --gufa --closed-world`, plus `--converge` on `--release`) preferring native `wasm-opt` on `PATH` with Node `binaryen` fallback.

#### 1.8 CLI, Dev Server, Minifier & NPM Distribution (`internal/cli`, `internal/devserver`, `internal/minify`, `bin/`)

- **Full CLI Surface:** Supports `dev`, `build`, `check`, `test`, `prep`/`vendor`, `init`, and legacy direct compilation flags (`-o`, `--check`, `--watch`, `--serve`, `--port`, `--copy-assets`, `--source-map`, `--minify`, `--mangle`, `--no-minify`, `--no-mangle`, `--pwa`, `--emit-wat`, `--release`, `--wasm-opt`, `--no-wasm-opt`, `--js-only`, `--target`, `--ast`, `--tokens`, `--version`, `--help`) with identical `src/colors.js` terminal output.
- **Dev Server & Recursive Watcher (`internal/devserver`):** `net/http` static server with path-traversal containment, SPA `index.html` fallback, SSE live reload + browser error overlay injection, CSS hot swap without full reload, and recursive `fsnotify` directory watching (walking subdirectories on Linux and debouncing 80 ms for `.go`/`.templ` and 50 ms for `.css`).
- **Minifier (`internal/minify`):** Byte-identical port of `src/minifier.js` (token-preserving comment stripping, ASI-safe whitespace compression, collision-safe local identifier mangling).
- **Hybrid NPM Distribution (`bin/gofront.js`, `packages/@gofront/*`):** Root `gofront` npm package uses `bin/gofront.js` to resolve the platform-specific binary (`@gofront/linux-x64`, `@gofront/linux-arm64`, `@gofront/darwin-x64`, `@gofront/darwin-arm64`, `@gofront/windows-x64`) installed via `optionalDependencies`.

#### 1.9 Cutover & Coexistence

1. **JS Engine Feature Freeze:** Once v1.8.0 ships, the JS compiler in `src/` receives bug fixes only; any bug fix lands in both engines with a shared test.
2. **Dual-Engine CI:** From Phase 1 onward, CI runs both `GOFRONT_ENGINE=js` and `GOFRONT_ENGINE=native` on every phase PR, tracking parity gates.
3. **Beta Opt-In → Default Flip:** `GOFRONT_ENGINE=native` enables the native binary during beta; Phase 9 flips the default in `bin/gofront.js` to `native` while retaining `GOFRONT_ENGINE=js` as a fallback for one minor release before retiring compiler sources in `src/` (keeping `src/vendor.js`, `src/test-runner.js`, and `runtime/`).

#### 1.10 Rejected Alternatives

- **Embedding Goja or QuickJS in Go for `gofront test`:** Goja lacks WasmGC and JSDOM support; QuickJS requires CGO and still cannot run browser DOM/Playwright suites. Node is already present in test environments.
- **Machine-translating JS compiler files to Go:** Carries over dynamic AST-mutation technical debt (`_type`, `_lvalue`) instead of clean Go types and side tables.
- **Using `esbuild`'s Go API for `--minify`:** Produces different output from `src/minifier.js`, breaking the byte-for-byte parity gate during the v2.0.0 transition.

---

### 2. Invariants & Safety Bounds

1. **Byte-for-Byte Output Parity:** Emitted JS, extracted CSS, VLQ source maps, WAT text, and unoptimized `.wasm` binaries must match the v1.8.0 JS engine byte-for-byte across all test fixtures.
2. **Deterministic Emission:** Go maps have randomized iteration order. Every symbol table, import list, struct field map, WasmGC type table, and CSS bundle must iterate over insertion-ordered slices or sorted keys—never raw Go `map` iteration.
3. **Zero CGO (`CGO_ENABLED=0`):** The native binary must compile with `CGO_ENABLED=0` across all 5 target platforms (`linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64`, `windows/amd64`) with only a single external Go dependency (`golang.org/x/sys` transitive via `github.com/fsnotify/fsnotify`).
4. **Diagnostic Fidelity:** Error messages, hints, line numbers, UTF-16 column numbers, and caret indicator strings must match `src/` byte-for-byte.
5. **Untouched Fixture Line Numbers:** Existing `.go` files under `example/` and `test/unit/fixtures/` must not be modified with header lines that shift line numbers in diagnostic tests; `go.mod` `ignore` directives isolate them from `go vet ./...`.

---

### 3. Edge Cases & Error Handling

- **UTF-8 Byte Offsets vs UTF-16 Caret Columns:** Go strings index UTF-8 bytes, whereas JS strings (`src/lexer.js`) count UTF-16 code units (`col` increments by 2 for astral plane runes $\ge \text{U+10000}$). `token.File` must compute columns in UTF-16 code units so caret alignment on non-ASCII source lines matches the JS engine exactly.
- **Automatic Semicolon Insertion (ASI) in Dual-Mode Lexing:** ASI applies in Go mode and inside `{ expr }` / control-flow headers in `.templ` files, but must be suppressed inside raw HTML tag bodies and raw `css Name() { ... }` blocks.
- **CSS Brace Counting with Strings & Comments:** In `css Name() { ... }`, nested `{` and `}` inside quoted strings (`content: "{"`) or `/* ... */` comments must not alter brace depth.
- **Composite Literals in Control Headers (`exprLev`):** In `if x == (T{}) {`, composite literals at `exprLev < 0` without parentheses must not greedily consume the block opening `{`.
- **Generic Instantiation vs Index Expression (`a[T](x)`):** The parser produces `IndexExpr` / `IndexListExpr` inside `CallExpr`; the type checker disambiguates whether `T` is a type argument list or a value index expression.
- **Linux Non-Recursive `fsnotify`:** `fsnotify` does not watch subdirectories recursively on Linux (`inotify`). `internal/devserver` must walk the directory tree at startup and dynamically register newly created directories on `Create` events.
- **Missing `wasm-opt` / Node Fallback:** When `gofront build --release` runs on a hybrid project, `internal/backend/wasm/optimize.go` checks `exec.LookPath("wasm-opt")` first, then falls back to `node` running the `binaryen` npm package, and finally builds unoptimized with a warning if neither is installed (matching `src/backend/wasm/optimize.js`).

---

## Implementation Tasks

> **Phase Sizing & Dev-Loop Bounds (1 Phase = 1 Dev-Loop)**:
> - **1 Phase = 1 Dev-Loop**: Each phase runs on a dedicated branch (`feat/v2-phase-<X.Y>`), executes all tasks continuously, opens 1 PR, and undergoes a fresh-context 2-pass AI review.
> - **Phase Budget (3–5 Tasks)**: Every phase is scoped to **4 cohesive tasks** with synchronized task IDs (`Task X.Ya`–`Task X.Yd`) and a target net diff budget of ~150–500 LOC per phase (table-driven ports for large stdlib emitters).
> - **Continuous Execution**: Within each phase, the orchestrator loops continuously through all tasks without halting between checkboxes, committing each task atomically (`feat(<scope>): <summary> (Task X.Ya)`).

<!-- Native Go engine implementation roadmap -->

### Phase 0.1: Go Module, Build Isolation & Shared Runtime Assets
- [ ] **Task 0.1a — Root Go module, `ignore` directives, and `runtime` embed package**
  - Files: `go.mod`, `runtime/assets.go`, `cmd/gofront/main.go`
  - Test: `go vet ./...` and `go build ./cmd/gofront` exit 0 without modifying any file in `example/` or `test/unit/fixtures/`.
  - Done when: `go.mod` defines `module github.com/seriva/gofront` with `ignore ( example / test/unit/fixtures / test/e2e )`, `runtime/assets.go` exports `embed.FS`, and `cmd/gofront/main.go` compiles.
- [ ] **Task 0.1b — Extract JS runtime helpers to `runtime/js/`**
  - Files: `runtime/js/helpers.js`, `src/backend/js/runtime.js`, `package.json`
  - Test: `npm test` passes all unit tests with zero regressions.
  - Done when: The 35 `HELPER_*` constants in `src/backend/js/runtime.js` are loaded from `runtime/js/` via `readFileSync`, and `"runtime/"` is added to `package.json` `"files"`.
- [ ] **Task 0.1c — Extract WASM host imports and stdlib glue to `runtime/js/wasm/`**
  - Files: `runtime/js/wasm/imports.js`, `runtime/js/wasm/stdlib.js`, `src/backend/wasm/boundary.js`
  - Test: `node test/unit/run.js` passes all WASM and boundary tests.
  - Done when: `WASM_IMPORTS_JS` and `WASM_STDLIB_JS` reside in `runtime/js/wasm/*.js` and are loaded via `readFileSync` in `src/backend/wasm/boundary.js`.
- [ ] **Task 0.1d — Shared runtime asset parity & Go embed test**
  - Files: `runtime/assets_test.go`, `test/unit/compiler/lexer-parser.test.js`
  - Test: `go test ./runtime/...` and `npm run check` pass.
  - Done when: `runtime/assets_test.go` verifies `runtime.FS` embeds all `runtime/js/*.js` and `runtime/js/wasm/*.js` files non-empty and matching the JS exports.

### Phase 0.2: Differential Testing Oracle & Timing Baseline
- [ ] **Task 0.2a — `gofront oracle` JSON-lines server & CLI dispatch stub**
  - Files: `cmd/gofront/main.go`, `internal/oracle/oracle.go`, `internal/oracle/oracle_test.go`
  - Test: `go test ./internal/oracle/...` verifying `{"id":1,"op":"ping"}` returns `{"id":1,"ok":true}`.
  - Done when: `gofront oracle` runs a persistent buffered JSON-lines stdin/stdout loop handling `ping` and structured error responses for unimplemented ops.
- [ ] **Task 0.2b — Synchronous worker-thread oracle bridge in `test/unit/helpers.js`**
  - Files: `test/unit/oracle-bridge.js`, `test/unit/helpers.js`
  - Test: `GOFRONT_ENGINE=native node -e 'import("./test/unit/helpers.js").then(h => console.log(h.oraclePing()))'` returns `true`.
  - Done when: `test/unit/helpers.js` routes `compile`, `compileWasm`, and `compileDir` synchronously through `oracle-bridge.js` (`SharedArrayBuffer` + `Atomics.wait` + `receiveMessageOnPort`) when `GOFRONT_ENGINE=native`.
- [ ] **Task 0.2c — Targeted file filtering & skipped-test accounting in `test/unit/run.js`**
  - Files: `test/unit/run.js`, `test/unit/helpers.js`
  - Test: `node test/unit/run.js test/unit/compiler/minifier.test.js` runs only `minifier.test.js` and exits 0.
  - Done when: `test/unit/run.js` filters `TEST_FILES` when CLI path arguments are passed and reports any `js-only` skipped tests in `summarize()`.
- [ ] **Task 0.2d — Automated timing baseline harness**
  - Files: `test/e2e/perf/compile-bench.js`
  - Test: `node test/e2e/perf/compile-bench.js` measures CLI subprocess, cold compile, and warm rebuild times across all 6 examples.
  - Done when: Baseline script outputs structured JSON/table timings matching the baseline audit metrics.

### Phase 1.1: Token Model & Core Go Lexer
- [ ] **Task 1.1a — Token kinds, positions & UTF-16 column table**
  - Files: `internal/token/token.go`, `internal/token/position.go`, `internal/token/token_test.go`
  - Test: `go test ./internal/token/...` testing ASCII and multi-byte/astral UTF-8 rune column calculations against UTF-16 code unit offsets.
  - Done when: All GoFront token kinds, keyword tables, and `File`/`Pos` line/UTF-16 column lookups are implemented.
- [ ] **Task 1.1b — UTF-8 scanner for Go identifiers, numbers, strings & operators**
  - Files: `internal/lexer/lexer.go`, `internal/lexer/scanner.go`, `internal/lexer/lexer_test.go`
  - Test: `go test ./internal/lexer/...` covering `0b`/`0o`/`0x`/octal/float/imaginary literals, rune/string escapes, raw strings, and 3-char operators (`&^=`, `...`, `<-`, `~`).
  - Done when: Standard Go tokens scan with exact literal and position parity.
- [ ] **Task 1.1c — Automatic Semicolon Insertion (ASI) & comment handling**
  - Files: `internal/lexer/asi.go`, `internal/lexer/asi_test.go`
  - Test: `go test ./internal/lexer/...` verifying semicolon insertion at line breaks and EOF after ASI-triggering tokens and suppression inside line/block comments.
  - Done when: ASI rules match `src/lexer.js` across all Go token types.
- [ ] **Task 1.1d — Oracle `tokens` operation & `--tokens` CLI dump**
  - Files: `internal/oracle/oracle.go`, `test/unit/compiler/lexer-parser.test.js`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/lexer-parser.test.js` (lexer section).
  - Done when: `op: "tokens"` returns canonical token arrays matching `new Lexer().tokenize()` byte-for-byte on Go inputs.

### Phase 1.2: Extensions, Directives & templ/css Dual-Mode Lexer
- [ ] **Task 1.2a — GoFront extension keywords & `//gofront:` directives**
  - Files: `internal/token/token.go`, `internal/lexer/lexer.go`, `internal/lexer/lexer_test.go`
  - Test: `go test ./internal/lexer/...` verifying `async`, `await`, `templ`, `css`, `//gofront:target`, and `//gofront:intrinsic`.
  - Done when: Extension keywords and file/declaration directives are scanned and attached matching `src/lexer.js`.
- [ ] **Task 1.2b — `.templ` HTML mode scanner**
  - Files: `internal/lexer/templ.go`, `internal/lexer/templ_test.go`
  - Test: `go test ./internal/lexer/...` covering HTML tags, self-closing tags, `attr={expr}`, `attr?={cond}`, `{ expr }`, `@Comp(args)`, `@templ.Raw(...)`, `{ children... }`, `if`/`for`/`switch` headers, and SVG depth.
  - Done when: `TemplLexer` mode switching and token emission match `src/templ-lexer.js`.
- [ ] **Task 1.2c — Scoped `css` mode scanner**
  - Files: `internal/lexer/css.go`, `internal/lexer/css_test.go`
  - Test: `go test ./internal/lexer/...` testing `css Name() { ... }` with nested `{}` rules, `@media`, `&` selectors, and braces inside strings/comments.
  - Done when: CSS block scanning captures raw CSS text and returns to Go mode at the matching closing brace.
- [ ] **Task 1.2d — Full Gate 1 token & lexer diagnostic parity**
  - Files: `internal/lexer/error.go`, `internal/oracle/oracle.go`
  - Test: `go test ./internal/lexer/...` and `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/lexer-parser.test.js`.
  - Done when: 100% of `.go` and `.templ` files in `example/` and `test/unit/fixtures/` produce byte-identical token streams on both engines.

### Phase 2.1: AST Hierarchy & Expression Parser
- [ ] **Task 2.1a — Sealed AST node interfaces & structs**
  - Files: `internal/ast/ast.go`, `internal/ast/templ.go`, `internal/ast/walk.go`
  - Test: `go test ./internal/ast/...` verifying node constructors, positions, and AST walker traversal.
  - Done when: All declaration, statement, expression, type, and templ/css AST structs implement sealed `Node`/`Expr`/`Stmt`/`Decl`/`TemplNode` interfaces.
- [ ] **Task 2.1b — Precedence-climbing binary & unary expression parser**
  - Files: `internal/parser/parser.go`, `internal/parser/expressions.go`, `internal/parser/expressions_test.go`
  - Test: `go test ./internal/parser/...` covering all 5 binary precedence levels and unary `+ - ! ^ * &` and `await`.
  - Done when: Binary and unary expressions parse with Go associativity and precedence.
- [ ] **Task 2.1c — Primary, postfix & type expression parser**
  - Files: `internal/parser/expressions.go`, `internal/parser/types.go`, `internal/parser/types_test.go`
  - Test: `go test ./internal/parser/...` covering calls (`...`), 2/3-index slices, index/`IndexList`, selectors, type assertions, composite literals, func literals, structs, interfaces, and union constraints `~T | U`.
  - Done when: All primary/postfix expressions and type syntax nodes parse cleanly.
- [ ] **Task 2.1d — Expression disambiguation rules (`exprLev`, generic calls, `(*T).M`)**
  - Files: `internal/parser/expressions.go`, `internal/parser/disambig_test.go`
  - Test: `go test ./internal/parser/...` testing `if x == (T{}) {`, unparenthesized composite literal rejection in headers, `a[T](x)` generic calls, and `(*T).M` pointer-receiver method expressions.
  - Done when: All expression ambiguities match `src/parser/expressions.js` and v1.8.0 rules.

### Phase 2.2: Statement, Declaration & templ/css Parser
- [ ] **Task 2.2a — Statement & control-flow parser**
  - Files: `internal/parser/statements.go`, `internal/parser/statements_test.go`
  - Test: `go test ./internal/parser/...` covering `if`, 3-clause/cond/infinite `for`, `range`, `switch`, `type switch`, `defer`, `return`, assignments, `incdec`, labels, and targeted errors for `go`/`chan`/`select`/`goto`/`<-`.
  - Done when: Statement parsing and unsupported-keyword diagnostics match `src/parser/statements.js`.
- [ ] **Task 2.2b — Top-level declarations & struct tag parser**
  - Files: `internal/parser/declarations.go`, `internal/parser/struct_tag.go`, `internal/parser/declarations_test.go`
  - Test: `go test ./internal/parser/...` and `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/lexer-parser.test.js`.
  - Done when: `func`/method decls, generics, `type`/`var`/`const`/`import` groups with `iota`, `//gofront:intrinsic`, and backtick struct tags (`json`/`csv` matching `src/parser/struct-tag.js`) parse identically.
- [ ] **Task 2.2c — `.templ` and `css` declaration parser**
  - Files: `internal/parser/templ.go`, `internal/parser/templ_test.go`
  - Test: `go test ./internal/parser/...` covering `TemplDecl`, `CssDecl`, nested elements, dynamic/boolean attributes, `@Comp`, `{ children... }`, and templ `if`/`for`/`switch`.
  - Done when: `internal/parser/templ.go` ports all constructs from `src/templ-parser.js`.
- [ ] **Task 2.2d — `ParseError` formatting & oracle `parse` gate**
  - Files: `internal/parser/error.go`, `internal/oracle/oracle.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/lexer-parser.test.js test/unit/compiler/templ.test.js`.
  - Done when: `ParseError` message, `file:line:col`, and UTF-16 caret alignment match the JS parser byte-for-byte.

### Phase 3.1: Type System, Universe Scope & Side Tables
- [ ] **Task 3.1a — Core `Type` representations & underlying resolution**
  - Files: `internal/types/types.go`, `internal/types/types_test.go`
  - Test: `go test ./internal/types/...` testing `Basic` (incl. untyped & `complex64`/`128`), `Array`, `Slice`, `Map`, `Pointer`, `Struct`, `Interface`, `Signature`, `Tuple`, `Named`, `TypeParam`, `Union`, and `External` (`TAINTED_ANY`).
  - Done when: All GoFront types and `Underlying()` methods are defined.
- [ ] **Task 3.1b — Lexical scopes & universe scope with predeclared shadowing**
  - Files: `internal/types/scope.go`, `internal/types/universe.go`, `internal/types/scope_test.go`
  - Test: `go test ./internal/types/...` verifying universe builtins/types/globals lookup and shadowing by package-level or local declarations (v1.8.0 rule).
  - Done when: `Universe` and hierarchical `Scope` lookup match v1.8.0 scoping rules.
- [ ] **Task 3.1c — `types.Info` side table**
  - Files: `internal/types/info.go`, `internal/types/info_test.go`
  - Test: `go test ./internal/types/...` verifying side-table recording of `Types`, `Defs`, `Uses`, `Instances`, `Implicits`, and `PkgTarget`.
  - Done when: `types.Info` stores all checker annotations without mutating `ast.Node` structs.
- [ ] **Task 3.1d — Byte-identical `Type.String()` formatting**
  - Files: `internal/types/typestr.go`, `internal/types/typestr_test.go`
  - Test: `go test ./internal/types/...` comparing `Type.String()` against `src/typechecker/types.js:typeStr` across all composite, generic, and function types.
  - Done when: Type names in diagnostics match the JS type checker character-for-character.

### Phase 3.2: Package Resolution, `.d.ts` Parser & Target Graph
- [ ] **Task 3.2a — Multi-file package discovery & recursive local imports**
  - Files: `internal/resolve/package.go`, `internal/resolve/imports.go`, `internal/resolve/package_test.go`
  - Test: `go test ./internal/resolve/...` testing sorted `.go`/`.templ` loading, `*_test.go` exclusion, and relative `import "./sub"` resolution with aliases, `.`, and `_`.
  - Done when: Multi-file and local sub-package resolution matches `src/resolver.js`.
- [ ] **Task 3.2b — TypeScript `.d.ts` declaration parser**
  - Files: `internal/dts/ast.go`, `internal/dts/parser.go`, `internal/dts/parser_test.go`
  - Test: `go test ./internal/dts/...` parsing `test/unit/fixtures/*.d.ts` (namespaces, interfaces, classes, functions, unions → `any`, and v1.7.0 `[A, B]` tuple returns → Go multi-value `Tuple`).
  - Done when: `internal/dts` produces identical type and value maps to `src/dts-parser.js`.
- [ ] **Task 3.2c — `js:` relative imports & `node_modules` / `@types` resolution**
  - Files: `internal/resolve/npm.go`, `internal/resolve/npm_test.go`
  - Test: `go test ./internal/resolve/...` resolving `test/unit/fixtures/node_modules/fake-lib` (`package.json` `types`), `@types/fake-util`, and `@types/scope__mypkg`.
  - Done when: Pure filesystem npm `.d.ts` discovery matches `src/resolver.js` without invoking Node.
- [ ] **Task 3.2d — Package target rules (`js`, `wasm`, `both`)**
  - Files: `internal/resolve/targets.go`, `internal/resolve/targets_test.go`
  - Test: `go test ./internal/resolve/...` testing target import boundaries and `both` mutable package-variable rejection against `test/unit/compiler/targets.test.js` cases.
  - Done when: Target validation diagnostics match `src/compiler.js` and `src/typechecker/`.

### Phase 3.3: Type Checker Passes 1–4 (Declarations & Constants)
- [ ] **Task 3.3a — Pass 1: Type declarations, cycle detection & generic type aliases**
  - Files: `internal/check/check.go`, `internal/check/types.go`, `internal/check/types_test.go`
  - Test: `go test ./internal/check/...` testing forward type refs, recursive pointers/slices, invalid value cycles, and v1.8.0 generic type aliases (`type Set[T comparable] = map[T]struct{}`).
  - Done when: Pass 1 resolves all package type declarations in dependency order.
- [ ] **Task 3.3b — Pass 2: Function/method signatures, generics & templ/css decls**
  - Files: `internal/check/funcs.go`, `internal/check/funcs_test.go`
  - Test: `go test ./internal/check/...` testing `T` vs `*T` receivers, generic type parameters/constraints, `templ` → `func(...) gom.Node`, `css` → `func() string`, and `//gofront:intrinsic`.
  - Done when: Pass 2 registers all callable declarations and method sets.
- [ ] **Task 3.3c — Pass 3: Struct field & method embedding promotion**
  - Files: `internal/check/embed.go`, `internal/check/embed_test.go`
  - Test: `go test ./internal/check/...` testing multi-level embedded struct fields, promoted methods, collision rules, and embedded interfaces.
  - Done when: Pass 3 matches `src/typechecker/resolve.js` promotion behaviour.
- [ ] **Task 3.3d — Pass 4: Package vars, consts, `iota` & exact untyped constant folding**
  - Files: `internal/check/vars.go`, `internal/check/const.go`, `internal/check/const_test.go`
  - Test: `go test ./internal/check/...` testing cross-file var initialization order, `iota`, exact arbitrary-precision constant shifts (`1 << 40`, `1<<63 + 5`), typed overflow errors, and JS $> 2^{53}$ warnings.
  - Done when: Pass 4 evaluates untyped constants with exact precision matching v1.8.0.

### Phase 3.4: Type Checker Pass 5 (Statements, Expressions & Generics)
- [ ] **Task 3.4a — Assignability, structural interfaces & `TAINTED_ANY` suppression**
  - Files: `internal/check/assign.go`, `internal/check/interface.go`, `internal/check/assign_test.go`
  - Test: `go test ./internal/check/...` verifying untyped promotion, structural interface implementation, pointer-receiver method set diagnostics, and `TAINTED_ANY` error cascade suppression.
  - Done when: `internal/check/assign.go` matches `src/typechecker/assignability.js`.
- [ ] **Task 3.4b — Expression checking, builtins & generic type inference**
  - Files: `internal/check/expr.go`, `internal/check/call.go`, `internal/check/generics.go`
  - Test: `go test ./internal/check/...` testing binary/unary ops, all 18 builtins, generic call inference and instantiation, `(*T).M` method expressions, and composite literals.
  - Done when: Expression checking populates `types.Info` for all expression forms.
- [ ] **Task 3.4c — Statement checking, control flow & termination analysis**
  - Files: `internal/check/stmt.go`, `internal/check/termination.go`, `internal/check/stmt_test.go`
  - Test: `go test ./internal/check/...` testing `if`, `for`, `range` (slice, array, map, string, int, iterator func), `switch`, `type switch`, labels, missing return detection, and unused local/import errors.
  - Done when: Pass 5 statement validation matches `src/typechecker/statements.js` and `termination.js`.
- [ ] **Task 3.4d — Checker diagnostic parity & oracle `check` gate**
  - Files: `internal/check/error.go`, `internal/oracle/oracle.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/types/errors.test.js test/unit/types/checks.test.js test/unit/types/inference.test.js test/unit/types/arrays.test.js test/unit/types/complex.test.js test/unit/types/generics.test.js`.
  - Done when: `TypeCheckError` messages, hints, line/UTF-16 columns, and carets match the JS engine across `test/unit/types/*.test.js`.

### Phase 3.5: Stdlib Built-in Registry, Web Typings & Go-Source Stdlib
- [ ] **Task 3.5a — Emitter-backed stdlib package typings**
  - Files: `internal/stdlib/core.go`, `internal/stdlib/extended.go`, `internal/stdlib/simd.go`
  - Test: `go test ./internal/stdlib/...` verifying all package members from `src/typechecker/stdlib/{core,extended,shared,simd}.js`.
  - Done when: All emitter-backed stdlib namespaces and derived return rules are registered.
- [ ] **Task 3.5b — Browser DOM, TypedArray, WebGL/WebGL2 & WebGPU typings**
  - Files: `internal/stdlib/web.go`, `internal/stdlib/web_test.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/types/typedarrays.test.js test/unit/types/webgl.test.js`.
  - Done when: Web globals and graphics typings pass all `typedarrays.test.js` and `webgl.test.js` checks.
- [ ] **Task 3.5c — Embedded Go-source stdlib & overlay loader**
  - Files: `internal/stdlib/embedded.go`, `internal/resolve/stdlib.go`, `internal/stdlib/embedded_test.go`
  - Test: `go test ./internal/stdlib/...` loading Go-source stdlib packages and overlays from `runtime.FS`, verifying namespace merge, collision rejection, and call-site error remapping.
  - Done when: Go-source stdlib packages (`runtime/stdlib/`) resolve and type-check in `js`, `wasm`, and `both` targets.
- [ ] **Task 3.5d — v1.8.0 coverage manifest gate on native checker**
  - Files: `internal/stdlib/manifest_test.go`
  - Test: `go test ./internal/stdlib/... -run TestManifestCoverage`.
  - Done when: Every in-scope entry in `runtime/stdlib/manifest.json` is verified present with matching Go signature in the native engine.

### Phase 4.1: Shared Lowering & Semantic Analyses (`internal/lower`)
- [ ] **Task 4.1a — Ownership, mutation & struct/array clone elision**
  - Files: `internal/lower/lower.go`, `internal/lower/ownership.go`, `internal/lower/walk.go`
  - Test: `go test ./internal/lower/...` testing `_fnMutates` and `_markOwnership` on value structs and v1.8.0 `[N]T` arrays.
  - Done when: Clone elision annotations in `lower.Info` match `src/lower/ownership.js`.
- [ ] **Task 4.1b — Address-taken scalar boxing & struct embedding metadata**
  - Files: `internal/lower/boxing.go`, `internal/lower/embedding.go`, `internal/lower/boxing_test.go`
  - Test: `go test ./internal/lower/...` verifying scalar `&x` boxing flags and flattened field/delegation method descriptors.
  - Done when: Boxing and embedding tables match `src/lower/boxing.js` and `embedding.js`.
- [ ] **Task 4.1c — Closure capture, per-iteration loop vars & pointer escape analysis**
  - Files: `internal/lower/captures.go`, `internal/lower/escape.go`, `internal/lower/captures_test.go`
  - Test: `go test ./internal/lower/...` testing captured-and-mutated locals, captured 3-clause `for` loop vars, and pointer retention escape flags.
  - Done when: Capture and escape side tables match `src/lower/captures.js` and `escape.js`.
- [ ] **Task 4.1d — Range/defer shapes, globals folding & stdlib reachability**
  - Files: `internal/lower/range.go`, `internal/lower/functions.go`, `internal/lower/globals.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/lower.test.js`.
  - Done when: Range/defer lowering, named-return pre-declaration, constant-folded values, and Go-source stdlib reachability pass `lower.test.js`.

### Phase 4.2: JS Core Emitter: Declarations, Structs & Statements
- [ ] **Task 4.2a — Module skeleton, exports, `init()` IIFE & identifier sanitization**
  - Files: `internal/backend/js/codegen.go`, `internal/backend/js/identifiers.go`, `internal/backend/js/codegen_test.go`
  - Test: `go test ./internal/backend/js/...` testing ES module imports/exports, `init()` IIFE ordering, and `JS_RESERVED` `$` suffix renaming (`in` → `in$`).
  - Done when: Top-level declarations and identifier sanitization match `src/backend/js/index.js`.
- [ ] **Task 4.2b — ES6 struct classes, `__clone()`, embedding & named-type wrappers**
  - Files: `internal/backend/js/structs.go`, `internal/backend/js/structs_test.go`
  - Test: `go test ./internal/backend/js/...` verifying positional constructors, zero-value defaults, `__clone()`, embedded delegation stubs, and `_namedWrapperField` classes.
  - Done when: Emitted class definitions match `src/backend/js/index.js` byte-for-byte.
- [ ] **Task 4.2c — Control-flow statements, `range` forms, `type switch` & `defer`/`recover`**
  - Files: `internal/backend/js/stmts.go`, `internal/backend/js/stmts_test.go`
  - Test: `go test ./internal/backend/js/...` covering `if`, `for`, zero-alloc slice `range`, map/string/int/func `range`, `switch`, `__ifv`/`__ifp` `type switch`, and `try/finally` defer stacks.
  - Done when: Statement emission matches `src/backend/js/statements.js` byte-for-byte.
- [ ] **Task 4.2d — Strict numeric mode & v1.8.0 strict runtime panic helpers**
  - Files: `internal/backend/js/strict.go`, `internal/backend/js/strict_test.go`
  - Test: `go test ./internal/backend/js/...` testing `Math.fround`, `| 0`, `>>> 0`, `Math.imul`, shift/div-by-zero checks, and `__at`/`__set`/nil-map/nil-ptr checks with in-bounds loop elision.
  - Done when: Strict-mode JS emission matches v1.8.0 `both`-target semantics.

### Phase 4.3: JS Expressions, Runtime Helpers, Source Maps & Package Compiler
- [ ] **Task 4.3a — Expression codegen, JS operator precedence & TypedArray slicing**
  - Files: `internal/backend/js/exprs.go`, `internal/backend/js/typedarrays.go`, `internal/backend/js/exprs_test.go`
  - Test: `go test ./internal/backend/js/...` testing JS operator parenthesization, `Math.trunc` int division, `& ~` bit-clear, `- -a` spacing, folded constants, scalar `{ value }` boxes, and TypedArray `.subarray()`.
  - Done when: Expression emission matches `src/backend/js/expressions.js` byte-for-byte.
- [ ] **Task 4.3b — Conditional runtime helper injection from `runtime.FS`**
  - Files: `internal/backend/js/runtime.go`, `internal/backend/js/runtime_test.go`
  - Test: `go test ./internal/backend/js/...` verifying helpers (`__len`, `__append`, `__sclone`, `__ifv`, etc.) are emitted in deterministic order only when referenced.
  - Done when: Runtime preamble injection matches `src/backend/js/index.js` using embedded `runtime/js/*.js`.
- [ ] **Task 4.3c — VLQ source map generator & multi-package compiler (`internal/compiler`)**
  - Files: `internal/backend/js/sourcemap.go`, `internal/compiler/compiler.go`, `internal/compiler/compiler_test.go`
  - Test: `go test ./internal/compiler/...` testing multi-file/multi-package preamble bundling, mtime parse caching, and VLQ `sourcesContent` source maps.
  - Done when: `internal/compiler` ports `compileSingleFile`, `compileFiles`, and `compileDir` from `src/compiler.js`.
- [ ] **Task 4.3d — Oracle `compile` & `compileDir` integration for core language suite**
  - Files: `internal/oracle/oracle.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/language/core.test.js test/unit/language/control-flow.test.js test/unit/language/declarations.test.js test/unit/language/expressions.test.js test/unit/language/loops.test.js test/unit/language/pointers.test.js test/unit/language/range-iter.test.js test/unit/language/struct_unboxing.test.js test/unit/language/structs.test.js test/unit/language/value-semantics.test.js test/unit/language/named-type-methods.test.js test/unit/language/codegen-regressions.test.js test/unit/compiler/strict-mode.test.js test/unit/compiler/packages.test.js test/unit/compiler/imports.test.js`.
  - Done when: All 12 `test/unit/language/*.test.js` suites plus `strict-mode`, `packages`, and `imports` pass with byte-identical JS output.

### Phase 5.1: JS Stdlib Codegen: Core, Strings, Math & Collections
- [ ] **Task 5.1a — `fmt`, `errors`, `strconv`, `os` & `testing` JS emitters**
  - Files: `internal/backend/js/stdlib/core.go`, `internal/backend/js/stdlib/fmt.go`, `internal/backend/js/stdlib/errors.go`, `internal/backend/js/stdlib/strconv.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/builtins/core.test.js test/unit/builtins/operators.test.js`.
  - Done when: `fmt` (incl. `Sprint*`, `Fprint*`, `Sscan*`, `%T`, `%#v`), `errors` (`Is`, `As`, `Join`, `Unwrap`), `strconv`, `os`, and `testing` emitters match `src/backend/js/stdlib/`.
- [ ] **Task 5.1b — `strings`, `bytes`, `Builder`/`Buffer`, `unicode`, `utf8`, `html` & `regexp` JS emitters**
  - Files: `internal/backend/js/stdlib/strings.go`, `internal/backend/js/stdlib/bytes.go`, `internal/backend/js/stdlib/builder.go`, `internal/backend/js/stdlib/unicode.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/builtins/bytes.test.js`.
  - Done when: String/byte manipulation, builders, UTF-8/Unicode helpers, HTML escaping, and JS `RegExp` shims emit byte-identical JS.
- [ ] **Task 5.1c — `math`, `math/bits`, `math/rand`, `slices`, `maps` & `sort` JS emitters**
  - Files: `internal/backend/js/stdlib/math.go`, `internal/backend/js/stdlib/slices.go`, `internal/backend/js/stdlib/maps.go`, `internal/backend/js/stdlib/sort.go`
  - Test: `go test ./internal/backend/js/stdlib/...` verifying all collection, sorting, and math stdlib emitters.
  - Done when: `math`, `bits`, `rand`, `slices`, `maps` (incl. v1.8.0 `iter.Seq` integration), and `sort` emitters match `src/backend/js/stdlib/`.
- [ ] **Task 5.1d — `io`, `time`, `path`, `sync`, `crypto/*` & `encoding/{binary,hex,base64}` JS emitters**
  - Files: `internal/backend/js/stdlib/io.go`, `internal/backend/js/stdlib/time.go`, `internal/backend/js/stdlib/path.go`, `internal/backend/js/stdlib/encoding.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/builtins/stdlib.test.js`.
  - Done when: All remaining non-JSON emitter-backed JS stdlib modules pass `test/unit/builtins/stdlib.test.js` with byte-identical JS output.

### Phase 5.2: JS Compile-Time JSON, SIMD Fallback & templ/css Codegen
- [ ] **Task 5.2a — Compile-time `encoding/json` codec generator in JS**
  - Files: `internal/backend/js/stdlib/json.go`, `internal/backend/js/stdlib/json_test.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/builtins/json.test.js`.
  - Done when: Tag-driven per-type JSON encoders/decoders (`,string`, `omitempty`, `RawMessage`, `MarshalJSON`/`UnmarshalJSON`, `Encoder`/`Decoder`, `Number`, `Compact`/`Indent`) match `src/backend/js/stdlib/json.js` byte-for-byte.
- [ ] **Task 5.2b — `gofront/simd` JS fallback & `gofront/shared` emitters**
  - Files: `internal/backend/js/stdlib/simd.go`, `internal/backend/js/stdlib/shared.go`
  - Test: `go test ./internal/backend/js/stdlib/... -run TestSimdAndShared`.
  - Done when: `gofront/simd` (`F32x4`, `Mask32x4`, comparisons, shuffles, SoA helpers) and `gofront/shared` JS emitters match `src/backend/js/stdlib/{simd,shared}.js`.
- [ ] **Task 5.2c — `.templ` DOM codegen & `gom` namespace emitter**
  - Files: `internal/backend/js/templ.go`, `internal/backend/js/stdlib/gom.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/builtins/gom.test.js test/unit/builtins/dom.test.js`.
  - Done when: `templ` `{ Mount(___p, ___refs) { ... } }` DOM/SVG builders and `gom` element/attribute helpers pass `gom.test.js` and `dom.test.js`.
- [ ] **Task 5.2d — Scoped `css` hashing, static stylesheet extraction & `__injectStyles`**
  - Files: `internal/backend/js/css.go`, `internal/compiler/compiler.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/templ.test.js`.
  - Done when: 32-bit FNV-1a base-36 class hashing (`gfc_<name>_<hash>`) and static CSS extraction across packages pass `test/unit/compiler/templ.test.js` byte-for-byte.

### Phase 5.3: WASM Module IR, WasmGC Types, Binary Encoder & WAT Printer
- [ ] **Task 5.3a — WasmGC type hierarchy, rec groups & v1.8.0 pointer/complex types**
  - Files: `internal/backend/wasm/types.go`, `internal/backend/wasm/types_test.go`
  - Test: `go test ./internal/backend/wasm/... -run TestWasmTypes`.
  - Done when: `internal/backend/wasm/types.go` ports `src/backend/wasm/types.js` (rec groups, immutable slice headers, maps, interfaces, closures, abstract scalar pointer supertype + box/accessor-ref subtypes, complex `{re, im}`, and `v128`).
- [ ] **Task 5.3b — Deterministic WASM binary encoder & LEB128 serializer**
  - Files: `internal/backend/wasm/encode.go`, `internal/backend/wasm/leb128.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/encode.test.js`.
  - Done when: Section serialization, LEB128 encoding, WasmGC instructions, `try_table`/`exnref`, and `0xFD` SIMD opcodes pass `encode.test.js`.
- [ ] **Task 5.3c — Textual WAT printer (`--emit-wat`)**
  - Files: `internal/backend/wasm/wat.go`, `internal/backend/wasm/wat_test.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/wat.test.js`.
  - Done when: `emitWat` formatting matches `src/backend/wasm/wat.js` byte-for-byte on all `wat.test.js` cases.
- [ ] **Task 5.3d — WASM constant folder (`const_fold.go`)**
  - Files: `internal/backend/wasm/const_fold.go`, `internal/backend/wasm/const_fold_test.go`
  - Test: `go test ./internal/backend/wasm/... -run TestConstFold`.
  - Done when: Compile-time constant folding for WASM globals and expressions matches `src/backend/wasm/const-fold.js`.

### Phase 5.4: WASM Module Builder, Monomorphisation & Control Flow
- [ ] **Task 5.4a — WASM module orchestrator, interface itabs & synthetic runtime helpers**
  - Files: `internal/backend/wasm/module.go`, `internal/backend/wasm/runtime_helpers.go`
  - Test: `go test ./internal/backend/wasm/... -run TestModuleBuilder`.
  - Done when: `module.go` and `runtime_helpers.go` port `src/backend/wasm/index.js` (imports, globals, string table, shared empty slice headers, method registration, `ref.test` interface dispatch, and `emitRuntimeHelper`).
- [ ] **Task 5.4b — Generics monomorphiser (`monomorph.go`)**
  - Files: `internal/backend/wasm/monomorph.go`, `internal/backend/wasm/monomorph_test.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/generics.test.js`.
  - Done when: Generic functions, structs, methods, and v1.8.0 generic named func types (`Seq[T]`) specialize identically to `src/backend/wasm/monomorph.js`.
- [ ] **Task 5.4c — Function body setup, locals & structured control flow (`emit.go`, `emit_stmts.go`)**
  - Files: `internal/backend/wasm/emit.go`, `internal/backend/wasm/emit_shared.go`, `internal/backend/wasm/emit_stmts.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/scalars.test.js test/unit/wasm/closures.test.js`.
  - Done when: Locals, scratch-global caching, `block`/`loop`/`br_if`/`br_table`, `i32` induction-variable fast paths, per-iteration captured loop variable boxes, and `range` (incl. v1.8.0 range-over-func closures) match `src/backend/wasm/emit-stmts.js`.
- [ ] **Task 5.4d — WASM `panic`, traps & `try_table`/`exnref` `defer`/`recover`**
  - Files: `internal/backend/wasm/emit_defer.go`, `internal/oracle/oracle.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/traps.test.js test/unit/wasm/defer_recover.test.js`.
  - Done when: Trap-based nil dereferences, `panic` tags, and scoped `defer`/`recover` pass `traps.test.js` and `defer_recover.test.js` with byte-identical `.wasm`.

### Phase 5.5: WASM Expressions, Builtins, Value Semantics & Maps
- [ ] **Task 5.5a — Expressions, structs, slices, strings, complex & `[N]T` array copies**
  - Files: `internal/backend/wasm/emit_exprs.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/structs.test.js test/unit/wasm/slices.test.js test/unit/wasm/strings_any.test.js`.
  - Done when: Numeric/bitwise ops, `local.tee` peepholes, structs, immutable slice headers, JS String Builtins, complex `{re, im}` math, and v1.8.0 `[N]T` deep array copy/clone-elision match `src/backend/wasm/emit-exprs.js`.
- [ ] **Task 5.5b — Scalar box vs accessor-ref pointers (`&s.F`, `&xs[i]`) & interfaces**
  - Files: `internal/backend/wasm/emit_pointers.go`, `internal/backend/wasm/emit_interfaces.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/interfaces.test.js test/unit/wasm/go_semantics.test.js`.
  - Done when: `br_on_cast` box fast path + getter/setter accessor refs for `&s.F`/`&xs[i]` and non-empty interface dispatch pass `interfaces.test.js` and `go_semantics.test.js`.
- [ ] **Task 5.5c — WASM built-in functions (`emit_builtins.go`)**
  - Files: `internal/backend/wasm/emit_builtins.go`
  - Test: `go test ./internal/backend/wasm/... -run TestEmitBuiltins`.
  - Done when: `len`, `cap`, `append`, `copy`, `make`, `new`, `delete`, `clear`, `min`, `max`, `complex`/`real`/`imag`, `[]rune` conversions, and `print`/`println` match `src/backend/wasm/emit-builtins.js`.
- [ ] **Task 5.5d — Insertion-ordered WasmGC maps & golden WAT gate**
  - Files: `internal/backend/wasm/emit_maps.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/maps.test.js test/unit/wasm/golden.test.js`.
  - Done when: Insertion-ordered map allocation, lookup, deletion, iteration, and `test/unit/fixtures/wasm/golden.wat` match byte-for-byte.

### Phase 5.6: WASM Stdlib Emitter Port (`internal/backend/wasm/stdlib`)
- [ ] **Task 5.6a — WASM `core` stdlib emitter (`fmt`, `strings`, `strconv`, `math`, `slices`, `maps`, `sort`)**
  - Files: `internal/backend/wasm/stdlib/core.go`, `internal/backend/wasm/stdlib/strings.go`, `internal/backend/wasm/stdlib/fmt.go`
  - Test: `go test ./internal/backend/wasm/stdlib/... -run TestWasmStdlibCore`.
  - Done when: `src/backend/wasm/stdlib/core.js` emitters (`fmt`, `strings`, `strconv`, `math`, `errors`, `unicode/utf8`, `slices`, `maps`, `sort`) are ported with byte-identical opcode emission.
- [ ] **Task 5.6b — WASM `bytes`, `Builder`/`Buffer` & `io`/`unicode`/`rand`/`bits` emitters**
  - Files: `internal/backend/wasm/stdlib/bytes.go`, `internal/backend/wasm/stdlib/io.go`
  - Test: `go test ./internal/backend/wasm/stdlib/... -run TestWasmStdlibBytesAndIO`.
  - Done when: `src/backend/wasm/stdlib/bytes.js` and `io.js` (`bytes`, `Buffer`, `Reader`, `strings.Builder`/`Replacer`, `io`, `unicode`, `math/rand`, `math/bits`) are ported.
- [ ] **Task 5.6c — WASM `time`, `path`, `html`, `sync`, `crypto/*`, `encoding/*` & `testing` emitters**
  - Files: `internal/backend/wasm/stdlib/time.go`, `internal/backend/wasm/stdlib/packages.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/stdlib.test.js`.
  - Done when: `src/backend/wasm/stdlib/time.js` and `packages.js` pass `test/unit/wasm/stdlib.test.js`.
- [ ] **Task 5.6d — WASM `encoding/json`, `gofront/simd` & `gofront/shared` emitters**
  - Files: `internal/backend/wasm/stdlib/json.go`, `internal/backend/wasm/stdlib/simd.go`, `internal/backend/wasm/stdlib/pure.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/simd.test.js test/unit/wasm/shared.test.js`.
  - Done when: v1.8.0 pure-WASM JSON codecs, `gofront/simd` (`F32x4`, `Mask32x4`, SoA types), and `gofront/shared` linear-memory views pass all tests.

### Phase 5.7: JS ↔ WASM Boundary, Facades & Binaryen Optimizer
- [ ] **Task 5.7a — Boundary metadata collection, import scanning & WASM boundary helpers**
  - Files: `internal/backend/wasm/boundary_meta.go`, `internal/backend/wasm/boundary_helpers.go`
  - Test: `go test ./internal/backend/wasm/... -run TestBoundaryMeta`.
  - Done when: `collectBoundaryMeta`, `scanBoundaryImports`, and `addBoundaryHelpers` from `src/backend/wasm/boundary.js` are ported.
- [ ] **Task 5.7b — JS ↔ WASM facade & `app.wasm` loader generation**
  - Files: `internal/backend/wasm/boundary_facade.go`, `internal/compiler/compiler.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/boundary.test.js`.
  - Done when: `generateFacade` (values, handles, copy-in/out + retention checks, numeric slices, maps, `any`, `error`, named/anonymous interfaces, scalar boxes/accessor-refs, `simd.F32x4`, `time.Time`, closures, and embedded `runtime/js/wasm/*.js` loader) passes `boundary.test.js`.
- [ ] **Task 5.7c — Binaryen (`wasm-opt`) pipeline wrapper**
  - Files: `internal/backend/wasm/optimize.go`, `internal/backend/wasm/optimize_test.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/optimize.test.js test/unit/compiler/optimize-build.test.js`.
  - Done when: `optimize.go` invokes native `wasm-opt` on `PATH` (or Node `binaryen` fallback) with `-O3 --gufa --closed-world` (`--converge` on `--release`) and source-map pass-through.
- [ ] **Task 5.7d — Full semantics & hybrid compilation gate**
  - Files: `internal/oracle/oracle.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/semantics.test.js test/unit/compiler/targets.test.js`.
  - Done when: Unoptimized `.wasm` and `.wat` outputs match the JS engine byte-for-byte across all WASM and hybrid test suites.

### Phase 6.1: Native Minifier & Dev Server
- [ ] **Task 6.1a — 3-stage JavaScript minifier & local identifier mangler**
  - Files: `internal/minify/minify.go`, `internal/minify/mangle.go`, `internal/oracle/oracle.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/minifier.test.js`.
  - Done when: Token-preserving comment stripping, ASI-safe compression, and collision-safe `--mangle` match `src/minifier.js` byte-for-byte.
- [ ] **Task 6.1b — HTTP static file server, path containment & SPA fallback**
  - Files: `internal/devserver/server.go`, `internal/devserver/mime.go`, `internal/devserver/server_test.go`
  - Test: `go test ./internal/devserver/...` and `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/dev-server.test.js`.
  - Done when: `net/http` static serving, sibling-directory traversal rejection, `.wasm` MIME headers, and SPA `index.html` fallback match `src/dev-server.js`.
- [ ] **Task 6.1c — Recursive `fsnotify` watcher with Go/templ & CSS debounce**
  - Files: `go.mod`, `go.sum`, `internal/devserver/watcher.go`, `internal/devserver/watcher_test.go`
  - Test: `go test ./internal/devserver/... -run TestWatcherDebounce`.
  - Done when: `fsnotify` watches trees recursively on Linux/macOS/Windows, dynamically adds newly created directories, and debounces 80 ms for `.go`/`.templ` and 50 ms for `.css`.
- [ ] **Task 6.1d — SSE live reload, CSS hot swap & browser error overlay**
  - Files: `internal/devserver/sse.go`, `internal/devserver/inject.go`, `internal/devserver/sse_test.go`
  - Test: `go test ./internal/devserver/... -run TestSSEAndOverlay`.
  - Done when: HTML stream injection of the live-reload client, keep-alive pings, CSS hot swap without full reload, and interactive compiler error replay match `src/dev-server.js`.

### Phase 6.2: Project Config, Assets, PWA & Full CLI Surface
- [ ] **Task 6.2a — Project config reader & terminal color/diagnostic formatter**
  - Files: `internal/cli/config.go`, `internal/cli/colors.go`, `internal/cli/config_test.go`
  - Test: `go test ./internal/cli/... -run TestConfigAndColors`.
  - Done when: `gofront.json` / `package.json` `"gofront"` discovery and `formatDiagnostic` ANSI output match `src/project-config.js` and `src/colors.js`.
- [ ] **Task 6.2b — Static asset synchronization & offline PWA service worker generator**
  - Files: `internal/cli/assets.go`, `internal/cli/pwa.go`, `internal/cli/assets_test.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/asset-manager.test.js test/unit/compiler/pwa.test.js`.
  - Done when: `copyAssets`, `cleanOutputDir` containment checks, and `sw.js` precache manifest generation match `src/asset-manager.js` and `src/pwa.js`.
- [ ] **Task 6.2c — Full CLI command & legacy flag dispatch (`dev`, `build`, `check`, `init`)**
  - Files: `cmd/gofront/main.go`, `internal/cli/commands.go`, `internal/cli/init.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/cli.test.js test/unit/compiler/cli-core.test.js`.
  - Done when: Subcommands (`dev`, `build`, `check`, `init`) and legacy direct flags (`-o`, `--watch`, `--serve`, `--minify`, `--mangle`, `--source-map`, `--ast`, `--tokens`, `--version`, `--help`) match `src/index.js` and `src/cli-core.js`.
- [ ] **Task 6.2d — Node delegation for `prep`/`vendor` and `test [--dom]`**
  - Files: `internal/cli/delegate.go`, `internal/cli/delegate_test.go`
  - Test: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/prep.test.js test/unit/compiler/test-runner.test.js`.
  - Done when: `gofront prep`/`vendor` and `gofront test [--dom] [-v] [-run]` delegate to `src/vendor.js` and `src/test-runner.js` with clear diagnostics when Node is absent.

### Phase 7.1: Multi-Platform Packaging & NPM Launcher
- [ ] **Task 7.1a — Cross-compilation build script & GitHub Actions release workflow**
  - Files: `scripts/build-binaries.sh`, `.github/workflows/release.yml`
  - Test: `bash scripts/build-binaries.sh` builds static binaries for `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, and `windows-x64` with `CGO_ENABLED=0`.
  - Done when: All 5 platform binaries compile cleanly and `file` / `ldd` confirms static linkage.
- [ ] **Task 7.1b — `@gofront/*` platform package manifests**
  - Files: `packages/linux-x64/package.json`, `packages/linux-arm64/package.json`, `packages/darwin-x64/package.json`, `packages/darwin-arm64/package.json`, `packages/windows-x64/package.json`
  - Test: Node validation check confirming `os`, `cpu`, `name`, and binary paths across all 5 `packages/*/package.json` files.
  - Done when: Platform npm packages are structured for automated publishing via `optionalDependencies`.
- [ ] **Task 7.1c — Thin npm launcher (`bin/gofront.js`) with `GOFRONT_ENGINE` override**
  - Files: `bin/gofront.js`, `package.json`
  - Test: `GOFRONT_ENGINE=native node bin/gofront.js --version` and `GOFRONT_ENGINE=js node bin/gofront.js --version` both succeed.
  - Done when: `bin/gofront.js` resolves the platform binary from `@gofront/<platform>-<arch>` (or local `cmd/gofront` build in repo checkouts) and falls back with an actionable download link if missing.
- [ ] **Task 7.1d — Isolated `npm pack` install & execution smoke test**
  - Files: `test/unit/compiler/cli.test.js`
  - Test: `node test/unit/run.js test/unit/compiler/cli.test.js` verifying `bin/gofront.js check example/simple/src`.
  - Done when: Packed launcher invokes the native binary transparently with inherited stdio and exit codes.

### Phase 8.1: Full Conformance, E2E & Hybrid Parity
- [ ] **Task 8.1a — 100% unit test suite & zero-allocation gate on native engine**
  - Files: `test/unit/helpers.js`, `test/e2e/perf/zero-alloc.js`
  - Test: `GOFRONT_ENGINE=native npm test` (runs all 64 unit test files, `zero-alloc.js`, and `gofront test --dom example/...`).
  - Done when: Every unit test, zero-alloc check, and example DOM test passes under `GOFRONT_ENGINE=native` with zero `js-only` escapes on compiler output gates.
- [ ] **Task 8.1b — Playwright E2E browser suite across all 6 example apps**
  - Files: `playwright.config.js`, `test/e2e/global-setup.js`
  - Test: `GOFRONT_ENGINE=native npm run test:e2e`.
  - Done when: All 6 example apps (`simple`, `preact`, `gom`, `templ`, `webgl`, `hybrid`) built by the native Go engine pass all Playwright E2E specs (`test/e2e/*.spec.js`).
- [ ] **Task 8.1c — v1.8.0 real-Go conformance corpus & language parity matrix**
  - Files: `test/conformance/conformance_test.go`
  - Test: `go test -v ./test/conformance/...`.
  - Done when: All v1.8.0 conformance fixtures and language parity matrix rows produce byte-identical stdout to reference `go run` execution on both JS and WASM targets compiled by the native engine.
- [ ] **Task 8.1d — Raycast & SIMD benchmark gate + `simplefps` hybrid verification**
  - Files: `test/e2e/perf/raycast-bench.js`
  - Test: `GOFRONT_ENGINE=native npm run bench`.
  - Done when: Native-compiled hybrid raycast and SIMD particle benchmarks run within $\pm 3\%$ of v1.8.0, and `simplefps` builds and runs at 60 FPS.

### Phase 9.1: Performance Audit, Documentation & Default Cutover
- [ ] **Task 9.1a — Rebuild latency audit & sub-10ms verification**
  - Files: `test/e2e/perf/compile-bench.js`, `docs/v2.0.0/native-go-engine.md`
  - Test: `GOFRONT_ENGINE=native node test/e2e/perf/compile-bench.js`.
  - Done when: Cold CLI and warm incremental rebuild timings for all 6 examples and `simplefps` are measured against the Phase 0 baseline, verifying the sub-10 ms warm rebuild target and recording final numbers in this plan.
- [ ] **Task 9.1b — Flip default engine to `native` in `bin/gofront.js` & `package.json`**
  - Files: `bin/gofront.js`, `package.json`, `test/unit/helpers.js`
  - Test: `npm test` and `npm run check` pass with default native engine, and `GOFRONT_ENGINE=js npm test` still passes.
  - Done when: `bin/gofront.js` and `test/unit/helpers.js` default to the native Go binary while preserving `GOFRONT_ENGINE=js` as an explicit fallback.
- [ ] **Task 9.1c — Update user documentation (`README.md`, `CHANGELOG.md`)**
  - Files: `README.md`, `CHANGELOG.md`
  - Test: `npm run check` passes Biome lint and formatting gates.
  - Done when: `README.md` documents native binary installation (`go install`, GitHub releases, `npx gofront`) and the Node dependency matrix, and `CHANGELOG.md` records the v2.0.0 release notes.
- [ ] **Task 9.1d — Reconcile `docs/roadmap.md` v2.0.0 status**
  - Files: `docs/roadmap.md`, `docs/v2.0.0/native-go-engine.md`
  - Test: `npm run check` and `go test ./...` pass cleanly.
  - Done when: All v2.0.0 rows in `docs/roadmap.md` are marked `✅ Done` and this design plan status is updated to `Completed`.

---

## Test & Conformance Plan

Parity between the v1.8.0 JS engine and the v2.0.0 native Go engine is enforced across five progressive gates:

- **Gate 1 — Tokens (`test/unit/compiler/lexer-parser.test.js`, `internal/lexer/*_test.go`):**
  - Command: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/compiler/lexer-parser.test.js` and `go test ./internal/token/... ./internal/lexer/...`
  - Criterion: Byte-identical token kind, literal text, line number, UTF-16 column number, and ASI semicolon placement across all `.go` and `.templ` files.
- **Gate 2 — Diagnostics (`test/unit/types/*.test.js`, `test/unit/compiler/targets.test.js`):**
  - Command: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/types/errors.test.js test/unit/types/checks.test.js test/unit/compiler/targets.test.js`
  - Criterion: Byte-identical error messages, hints, `file:line:col` headers, and UTF-16 caret indicator lines for both `ParseError` and `TypeCheckError`.
- **Gate 3 — Emitted JavaScript, CSS & Source Maps (`test/unit/language/*.test.js`, `test/unit/builtins/*.test.js`, `test/unit/compiler/templ.test.js`):**
  - Command: `GOFRONT_ENGINE=native node test/unit/run.js`
  - Criterion: Byte-identical emitted `.js`, extracted `.css`, minified output (`test/unit/compiler/minifier.test.js`), and VLQ source map mappings across all unit test fixtures.
- **Gate 4 — Emitted WebAssembly & Boundary (`test/unit/wasm/*.test.js`, `test/unit/compiler/optimize-build.test.js`):**
  - Command: `GOFRONT_ENGINE=native node test/unit/run.js test/unit/wasm/encode.test.js test/unit/wasm/wat.test.js test/unit/wasm/golden.test.js test/unit/wasm/boundary.test.js`
  - Criterion: Byte-identical unoptimized `.wasm` binary bytes, byte-identical `.wat` dumps, byte-identical JS boundary facades/loaders, and `WebAssembly.validate(bytes) === true` on every module.
- **Gate 5 — Runtime, Browser E2E, Conformance & Benchmarks:**
  - Unit & DOM execution: `GOFRONT_ENGINE=native npm test` (all 64 unit test suites + `test/e2e/perf/zero-alloc.js` + `gofront test --dom example/...`).
  - Browser E2E: `GOFRONT_ENGINE=native npm run test:e2e` (`test/e2e/{simple,preact,gom,templ,webgl,hybrid,shared}.spec.js`).
  - Conformance: `go test -v ./test/conformance/...` comparing native GoFront JS and WASM stdout byte-for-byte against reference `go run` output.
  - Benchmarks: `GOFRONT_ENGINE=native npm run bench` (`test/e2e/perf/raycast-bench.js`) within $\pm 3\%$ of v1.8.0, and `node test/e2e/perf/compile-bench.js` confirming sub-10 ms warm incremental rebuilds.
