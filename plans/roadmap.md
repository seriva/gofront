# GoFront Roadmap

GoFront's guiding principle is **no runtime** — features that need a scheduler, runtime
type descriptors, or raw memory access are out of scope.

Each release has a subfolder in `plans/` containing design documents for the planned
features (e.g. `plans/v1.8.0/`).

---

## v2.0.0

**Theme: Web platform evolution (Draft).** Compile-time asset embedding (`//go:embed`), fast incremental watch rebuilds, whole-program dead-code elimination, typed web APIs (`gofront/dom`, `gofront/canvas`) and reactive `gom` signals in `.templ`, keeping the pure Node.js ESM compiler (the native Go engine rewrite is dropped). Concept sketch, to be audited with `/design-plan`, in [`plans/v2.0.0/web-platform-evolution-plan.md`](v2.0.0/web-platform-evolution-plan.md).

---

## v1.9.1

**Theme: Review follow-ups.** Patch release fixing the 24 reproducing review follow-ups left after v1.9.0, 5 regressions found while adopting 1.9.0 in SimpleFPS, 21 defects found while reviewing those fixes, and 14 more found while reviewing the second round.

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Follow-up fixes (2026-11-09) | High | Completed (2026-11-10) | 29 defects in 8 phases: typechecker checks (`switch` cases, `cap`, negative array lengths, local vs imported types), `any` → concrete without a type assertion, parser constraint elements and JS statements (local-type TDZ, 64-bit constants, labeled range-over-func, map range into boxed vars), WASM codegen (labeled range-over-func, unhashable-key messages, interface assertions from `any`), JS nil receivers and unhashable keys, dynamic types / `%T` / `encoding/json`, JSON codec generation (`.d.ts` interop crash, codecs for every declared type), and `float32` constants in JS, templ `fmt` typing and WASM SIMD global zero values. Untyped JS-interop `any` deferred. See [follow-ups-2026-11-09-plan.md](v1.9.1/follow-ups-2026-11-09-plan.md). |
| Follow-up fixes (2026-11-10) | High | Completed (2026-11-11) | 21 defects from the 2026-11-09 plan reviews in 6 phases: typechecker checks (`case nil` vs bool tag, `cap` whitelist, `any` → non-empty interface, constraint interfaces as value types, folded array-length import use on cached ASTs), parser and conversions (`I(v)`, `interface{…}(v)`, `[]func(){…}` call args) plus JS `for`-post 64-bit compound assigns and nested labeled range-over-func, WASM codegen (nested `continue outer`, slice/string range into boxed vars, promoted embedded-pointer dispatch, defined-map unhashable message), JS nil receivers (scope-aware analysis, generics, `(*T).V` nil check), unhashable literal keys and `json` func arrays, and multi-value call forwarding (`return f()`, `g(f())`) into `any` results and parameters, and `complex64` constants on JS plus `fmt` in templ `case` lists. Starts after the 2026-11-09 plan merges. See [follow-ups-2026-11-10-plan.md](v1.9.1/follow-ups-2026-11-10-plan.md). |
| Follow-up fixes (2026-11-11) | High | Draft | 14 defects from the 2026-11-10 plan reviews in 4 phases: typechecker and parser diagnostics (`comparable` embeds in constraints, `I(a)` from `any` without assertion, `int` range index into `int32`, unparenthesized composite literals in `if` headers), method sets (methods promoted through embedded pointers, ambiguous same-depth promotion, typed-nil outer pointers on WASM), arrays and func types in `any` (`==`, WASM `map[any]` array keys, `%T` of func types), and codegen (JS `switch` on nil map, stacked labels on range-over-func, WASM nested forwarded calls, named `complex64` constants) plus a stale WASM panic note in the docs. Starts after the 2026-11-10 plan merges. See [follow-ups-2026-11-11-plan.md](v1.9.1/follow-ups-2026-11-11-plan.md). |

---

## v1.9.0

**Theme: Stdlib in Go.** Move every remaining stdlib package whose behaviour is ordinary Go over GoFront values onto the Go-source path (`stdlib/`), and keep host-backed fast paths as small registered **natives** (`//gofront:native`) that a four-way differential test (JS/WASM × natives on/off) checks against the Go body. Removes the hand-written type tables, JS shims and WASM emitters for `sort`, `slices`, `maps`, `errors`, `unicode/utf8`, `path`, `html`, `io`, `bytes`, `strings`, `encoding/{hex,base64,binary}`, `crypto/sha256`, `math/{bits,rand}`, `sync`, `time` and `strconv` (WASM stdlib emitters 26,438 → ≤ 8,000 lines). Fixes what the old path gets wrong: every WASM sort is O(n²), sorting `NaN` is wrong on both backends, `sort.Slice` tie order differs from Go, generic helpers reject named slice and map types, and 24 deferred member bugs from the v1.8.0 follow-up fixes. Verified with Go-output unit cases (no manifest or real-Go harness). Starts after the v1.8.0 follow-up fixes complete. Design document in [`plans/v1.9.0/stdlib-in-go-plan.md`](v1.9.0/stdlib-in-go-plan.md).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Exact 64-bit integers in JS | High | ✅ Done | `int64`/`uint64` as BigInt in all JS output and across the WASM facade (today Numbers: `int64` `*`/`+` and the pdqsort `uint64` xorshift round above 2⁵³); struct copies through `T` in erased JS generics. Prerequisite for the Go-source packages. |
| Generic core types | Medium | ✅ Done | `S ~[]E` / `M ~map[K]V` index, slice, conversion and constraint type inference (today `Cannot index type S`, `Cannot infer type arguments`); type-literal type arguments (`Id[[]int, int]` fails to parse); valid WASM for named `S`. |
| Natives, differential testing, lazy checking | High | ✅ Done | `//gofront:native` name set and per-backend registries (decline and value fallback); `assertFourWay`; declarations checked eagerly, stdlib bodies on demand. |
| `sort` & `slices` | High | ✅ Done | Generated pdqsort variants (Go's tie order), `NaN` ordering, O(n log n) in WASM (200k ints: ≈20 s → ≤ 100 ms), JS comparator sorts ≤ 2× `Array.prototype.sort`. |
| `maps`, `errors`, `utf8`, `path`, `html` | Medium | ✅ Done | Go source with Go's signatures; JS generic map range fixed; `errors.As` stays the one emitter member. |
| `io`, readers, `bytes`, `strings` | High | ✅ Done | `io.Writer`-based `fmt.Fprint*`, `Reader`/`Buffer`/`Replacer` in Go, host natives for search and case mapping; name-coupled backend special cases removed. |
| Encodings, `sha256`, `bits`, `rand`, `sync` | Medium | ✅ Done | Go source; `binary.Read`/`Write` stay emitters; `rand_source` intrinsic. |
| `time` & `strconv` | High | ✅ Done | Civil dates, layouts and `Duration` in Go; clock and shortest-repr floats native; user docs. |
| Typings removal | Medium | ✅ Done | Leftover type tables deleted, native registry self-check, stdlib layout in the architecture docs. |
| Follow-up fixes | High | ✅ Done | 170 v1.8.0 ledger defects plus 32 `stdlib-in-go` review follow-ups that still reproduce, in 27 phases: front end, typechecker, generics, JS nil/numerics/dynamic types/map keys, `fmt`, WASM interfaces/locals/control flow/pointers/facade, JSON, templ `for` forms, and Go-source stdlib/emitter fixes. Design document in [`plans/v1.9.0/follow-ups-2026-11-03-plan.md`](v1.9.0/follow-ups-2026-11-03-plan.md). |
| Compiler shrinking | High | ✅ Done | Cuts ~4,800 lines of compiler emitter and runtime code from `src/`: moves `strings.Builder` and `math` to `stdlib/`, unifies JS `encoding/json` onto `src/lower/json-codecs.js` + `stdlib/internal/jsonrt/` (~2× faster JS encode/decode), prunes unused `binary.{Read,Write,Size}` and `fmt.Sscan*` to `EXCLUDED_STDLIB_MEMBERS`, and deletes 15 dead methods (~285 lines). Design document in [`plans/v1.9.0/compiler-shrinking-plan.md`](v1.9.0/compiler-shrinking-plan.md). |
| Stdlib overlays to Go | High | ✅ Done | Starts after compiler shrinking. Moves the last compiler-implemented stdlib pieces to Go source: `fmt` (today WASM marshals every operand to the JS `__sprintf` engine; ≈ 3,900 lines) with per-call-site typed wrappers and per-package generated formatters on the `json-codecs` spine, `testing` as a Go struct driven by a generated test main (≈ 1,300 lines incl. the runner), `errors.As` as a generated per-target-type function (fixes the custom-`As` JS/WASM divergence), and the `os`, `unicode`, `crypto/rand`, `time.Sleep`/`AfterFunc`, `regexp` and `gom` overlays (≈ 1,150 lines) via target-aware stdlib file loading. Leaves `gofront/shared`, `gofront/simd` and the `encoding/json` type overlay as the only compiler-side stdlib members; ≥ 5,000 net lines out of `src/`. Design document in [`plans/v1.9.0/overlays-to-go-plan.md`](v1.9.0/overlays-to-go-plan.md). |
| Runtime & overlay pruning | Medium | ✅ Done | Starts after `overlays-to-go`. Moves `encoding/json` (`Marshal`, `MarshalIndent`, `Unmarshal`, `Valid`, `RawMessage` + `MarshalJSON`/`UnmarshalJSON`) to `stdlib/encoding/json/` and deletes the `pkg.overlay` hybrid machinery in `src/link/stdlib.js` and stale `JSON_NAMES` / `addExtraRoots` roots in `src/lower/reachability.js` (aliased `encoding/json`, `json` locals, `json.Marshal` as a value now a compile error); unifies `importsFor`, canonical import qualifiers, `SHARED_REPR`, `spellable` and `collectProgramTypes` in `src/lower/gen-types.js` and delegates `compileSingleFile` to `compileFiles`; dissolves `src/typechecker/stdlib/{core,extended}.js`, `src/backend/wasm/stdlib/{core,io}.js` and `src/backend/js/stdlib/{shared,simd}.js`; registers the `time` host imports on demand and deletes `STDLIB_IMPORTS` / `WASM_STDLIB_JS`; deletes dead WASM emitters (`__errors_is`/`__errors_unwrap`, `emitMapClone`, `ERROR_PRODUCING_PKGS`, `hasIo`, `importsAnyOf`), stops exporting synthesised helpers under `exportAll`, and merges the map keys/values and lookup emitters. Cuts 763 net lines from `src/`. Design document in [`plans/v1.9.0/runtime-pruning-plan.md`](v1.9.0/runtime-pruning-plan.md). |
| Follow-up fixes (2026-11-07) | High | ✅ Done | Fixes 55 reproducing review follow-ups in 9 phases: typechecker checks, package types and function-local types, JS loops/pointers/numerics, nil receivers and panics, dynamic types and assertions, WASM control flow/strings/facade, `encoding/json`/templ/stdlib, and Go-source `fmt` and `testing` gaps. See [follow-ups-2026-11-07-plan.md](v1.9.0/follow-ups-2026-11-07-plan.md). |

---

## v1.8.0

**Theme: Portable Go & The Great Simplification.** Make GoFront complete, clean, and lean inside its no-runtime and JS/WASM boundaries. Language additions include range-over-func, generic named func types and type aliases, complex numbers, `min`/`max`, predeclared name shadowing, and modern iterators (`iter`, `slices`, `maps`). Compile-time `encoding/json` works on both backends. The release finishes with **The Great Simplification** (Phases 8–11): retiring the 377 KB coverage manifest and real-Go conformance runner, pruning the stdlib to a lean core (`bufio`, `net/url`, `context`, `encoding/csv`, `container/*` and most of the new pure packages go), and removing WASM workarounds (scalar interior-pointer accessors, array clone elision) in favor of a clear compile-time diagnostic. Design document in [`plans/v1.8.0/portable-go-plan.md`](v1.8.0/portable-go-plan.md).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| WASM language parity | High | ✅ Done | Range-over-func, generic named func types and type aliases, complex numbers, `min`/`max`, strict-mode checks, and predeclared name shadowing. |
| Modern iterators (`iter`, `slices`, `maps`) | Medium | ✅ Done | `iter.Seq`, sequence helpers, and iterator range support across both backends. |
| Go-source stdlib | High | ✅ Done | Pure packages in `stdlib/` compiled into the caller's target with strict numerics; reachability-based emission, so unused imports cost 0 bytes. |
| Member completion | Medium | ✅ Done | `fmt.Sprint`/`Stringer`/`%T`/`%#v`, `os.Stdout` as `io.Writer`, `sort.Sort`/`Interface`, `utf8` byte API, `strconv.NumError`, `math`/`bits`/`time` gaps (`time.Time` JSON on WASM only, see follow-ups), `sync.Map`/`Pool` (removed again by Phase 9 Task 9.4), `testing` additions. |
| Compile-time JSON everywhere | High | ✅ Done | Tag-driven compile-time codec generation on JS and WASM. |
| SIMD completion & promotion gate | High | ✅ Experimental | Value semantics, comparisons, shuffles, slice helpers; experimental status retained. |
| Coverage manifest & conformance | Medium | ✅ Done → retired (Phase 8) | Manifest from go1.26 `api/*.txt`, signature-checked coverage gate, generated docs, 55 real-Go conformance fixtures. Built in Phases 1–7; retired by D1. |
| `bufio`, `net/url`, `context`, `encoding/csv` & new pure packages | Medium | ✅ Done → removed (Phase 9) | Go-source packages on both backends (`container/*`, `hash/*`, extra `crypto/*`, `base32`, `utf16`, `cmplx`, `sync/atomic`, `log`, `math/rand/v2`). Built in Phase 4; removed by D2 before release. |
| Retire manifest & conformance gate (Phase 8) | Medium | ✅ Done | Delete 377 KB manifest and real-Go conformance runner; port uncovered fixtures into unit tests; hand-written package lists in docs. |
| Prune stdlib to the lean core (Phase 9) | Medium | ✅ Done | Remove `bufio`, `net/url`, `context`, `encoding/csv`, `container/*`, `hash/*` checksums, extra `crypto/*`, `base32`, `log`, `math/rand/v2`, `utf16`, `cmplx`, `sync/atomic` with a `package <pkg> is not supported` diagnostic; JSON streaming keeps a private buffered reader; kept overlays trimmed (`unicode` range tables, `math.Gamma`/`Erf`, `sync.Map`/`Pool`, `fmt.Fscan*`, `strconv.*ToGraphic`) to cut per-import check time. |
| WASM backend simplification (Phase 10) | Medium | ✅ Done | Reject pointers into scalar fields, elements and package-level variables in `wasm`/`both` packages, explicit or via pointer-receiver calls (`js` unchanged); remove accessor helpers and array clone elision (within the 3% bench budget); panic helper merge dropped (size gate failed, helpers stay). |
| `%p` parity & docs (Phase 11) | Low | ✅ Done | `fmt` `%p` parity fix, D5 docs, CHANGELOG consolidation, roadmap. |
| Review follow-ups | Medium | ✅ Done | Bugs from the PR #28–#40 reviews, re-probed against go1.26 ([Phases 0.11–0.14](v1.8.0/portable-go-plan.md#review-follow-ups-2026-10-24)): string escapes, unsigned/64-bit integer ops in JS, type-parameter struct values, variadic spread, nil maps, explicit `pkg.F[T]` instantiation, recursive generic types, pointer stability on whole-value assignment, stdlib function values and range-over-func leftovers in WASM. |
| Repository structure cleanup | Medium | ✅ Done | No change to output. Completes the Sentrux layer coverage and adds a guard against gaps and cross-backend imports; splits `wasm/index.js` and `compiler.js` (`src/link/`); moves `compileWasm` out of the backend and templ expression parsing out of JS codegen; moves CLI logic out of `src/index.js`; adds `src/cli/`, `src/lexer/`, `test/unit/cli/` and `test/perf/`; stops committing compiled examples; moves the preact vendor config into the example. Runs after the portable-go plan. Design document in [`plans/v1.8.0/repo-structure-plan.md`](v1.8.0/repo-structure-plan.md). |
| Follow-up fixes & BCE hardening | Medium | ✅ Done | Fixes parser lookahead on indexed selectors in call arguments; adds slice bounds-check elimination (BCE) in lowering for `_ = xs[k]` hints and length guards to eliminate strict-mode `both` overhead; squashes review follow-ups before v1.8.0 release. Design document in [`plans/v1.8.0/follow-up-fixes-plan.md`](v1.8.0/follow-up-fixes-plan.md). |

---

## v1.7.0

**Theme: Typed data, typed JS libraries, faster math — without adding a runtime.** Compile-time `encoding/json` driven by struct tags (no `reflect`), TypeScript tuple returns mapped to Go multi-value results so React/Preact hooks work directly (`example/reactive` replaced by `example/preact`), and an opt-in `gofront/simd` package lowered to WASM `v128`, promoted to stable only if it beats the scalar hybrid raycast by ≥ 1.3× (it measured 1.02×, so it ships as experimental). Design document in [`plans/v1.7.0/json-preact-simd-plan.md`](v1.7.0/json-preact-simd-plan.md).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| `encoding/json` | Medium | ✅ Done | Preserved struct tags; per-type generated compile-time encoders/decoders; Go-identical formatting and error messages; `,string`, `RawMessage`, `MarshalJSON`, `UnmarshalJSON`; JS packages only (diagnostic in wasm). |
| `.d.ts` tuples & `example/preact` | Medium | ✅ Done | TypeScript `[A, B]` returns → Go multi-value `(A, B)`; submodule vendor packaging (`preact/hooks`); TodoMVC reimplemented with function components and hooks; retired `example/reactive`. |
| WASM SIMD (`gofront/simd`) | High | ✅ Experimental | `F32x4` → `v128` in wasm, scalar fallback in js; `shared.Float32` load/store; Binaryen feature integration. Raycast gate: 1.02× over scalar hybrid (below 1.30× threshold); groundwork retained as experimental; completion and promotion moved to v1.8.0. |

---

## v1.6.1

**Theme: Close the WASM gaps.** Makes the `wasm`/`both` subset cover all of the language and stdlib that doesn't touch browser or host APIs: non-literal constants, array/interface map keys, the remaining boundary types (incl. anonymous interfaces), missing stdlib members, and the `unicode`, `math/rand`, `bytes`, `io`, `path`, `html` and `time` (minus `Sleep`) packages. Browser-facing code stays in `js` packages by design; only `os`, `regexp` and `time.Sleep` remain JS-only. Design document in [`plans/v1.6.1/wasm-gaps-plan.md`](v1.6.1/wasm-gaps-plan.md).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Language features | Medium | ✅ Done | Non-literal package constants (fold or `start` global), array- and interface-typed map keys with Go's unhashable panic. |
| Boundary types | Medium | ✅ Done | `error`, `map` (copied as JS `Map`), pointer-to-scalar boxes, anonymous structs and interfaces, exported non-literal constants, `time.Time`, `time.Duration`. |
| `strings` / `strconv` / `math` | Medium | ✅ Done | `Cut*`, `SplitN`/`SplitAfter*`, `Map`, `*Func` variants, `NewReplacer`, `Builder`, `NewReader`; `Unquote`, `AppendInt`/`AppendFloat`; `math.Remainder`. |
| `slices` & `fmt` | Medium | ✅ Done | Remaining `slices` members (inline, `call_ref` for `*Func`); composite `%v`/`%+v` matching the JS backend; `Fprint*`, `Sscan*`. |
| New packages | Medium | ✅ Done | `unicode`, `math/rand`, `bytes` (incl. `Buffer`), `io`, `path`/`path/filepath`, `html`, `time` (except `Sleep`; clock via import). |
| Test suite optimization | Medium | ✅ Done | Deduplicate CLI tests (43 `spawnSync` → 3 smoke), `withTempDir` helper, table-driven error tests, unified JS/WASM stdlib parity tests, parallel execution (<5s target). Design doc: [`test-suite-optimization-plan.md`](v1.6.1/test-suite-optimization-plan.md). |

---

## v1.6.0

**Theme: Complete hybrid JS + WebAssembly.** Finishes the per-package target model (`//gofront:target js | wasm | both`) in the existing JS compiler (`src/backend/wasm/`), so the whole hybrid is done before the v2.0.0 rewrite: the remaining language features in WASM, boundary v2, shared linear-memory buffers, `example/hybrid`, and full simplefps physics in WASM. Unblocked by the v1.5.1 go/no-go (hybrid = 1.17× JS, GO). Design document in [`plans/v1.6.0/wasm-hybrid-plan.md`](v1.6.0/wasm-hybrid-plan.md).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Remaining language features in WASM | High | ✅ Done | Non-empty interfaces (`ref.test` candidate dispatch), generics (monomorphisation), insertion-ordered maps, `defer`/`recover` (`try_table` + `exnref` with Go scoping rules), wider stdlib (`errors`, `fmt`, `strings`, `strconv`, `unicode/utf8`, `slices`, `maps`, `sort`), `t.Run` subtests. |
| Boundary v2 | High | ✅ Done | WASM ↔ JS closures, named non-empty interfaces across the boundary (handles and facades; provider interfaces kept WASM-side), handle method trampolines, boundary-in-loop warnings. |
| Shared buffers & `example/hybrid` | Medium | ✅ Done | `gofront/shared` zero-copy linear-memory TypedArray views; `example/hybrid` particle simulation with `.templ` controls and Playwright E2E; `import.meta.url` loader; `--js-only` and `gofront.json` `targets` overrides. |
| simplefps full split & benchmarks | Medium | ✅ Done | `physics` (`DynamicBody`, `FPSController`) and `animation` (skinning via `gofront/shared`) in `wasm`; `BinaryReader`/`ParseBinaryAnimation` moved to `assets`; Binaryen pipeline for `--release`; README target guide; simplefps `npm run bench`: raycasts 1.15×, controller step 2.4×, skinning 1.27×, `app.wasm` 98.5 → 79.7 kB. |
| Codebase consolidation | Low | ✅ Done | Zero-functional-change cleanup before the v2.0.0 port: single watch-mode path (`index.js` → `handleDev`), WASM emitter helpers (slice grow/unpack, value-struct copy), shared `lower/` AST traversal, JS helper registry, trimmed export surface. Output byte-identical; ~500 lines removed. |

---

## v1.5.1

**Theme: WASM codegen performance.** The Phase 6b raycast benchmark came back at hybrid = 0.65× JS, with the time inside the emitted WASM rather than at the boundary or in allocation. This release tightens the emitter output on the measured hot paths — immutable slice headers with a shared empty header, i32 bounds checks and induction variables, trap-based nil dereference, leaf methods small enough for V8 to inline, scratch globals cached in locals — until the hybrid build is at least as fast as the JS build. No language features; the go/no-go publish (v1.5.0 Phase 6c) waits on this. Design document in [`plans/v1.5.1/wasm-codegen-perf-plan.md`](v1.5.1/wasm-codegen-perf-plan.md).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Baseline & tooling | Low | ✅ Done | `--wasm-opt` ceiling flag on `bench:raycast` (done); hot-function instruction-count report. |
| Immutable slice headers | Medium | ✅ Done | Non-`mut` header fields, shared empty header per element type, null arm removed from every slice site. |
| i32 indices | Medium | ✅ Done | `br_if` bounds check, i32 induction-variable fast path for `for i := a; i < len(x); i++`. |
| Trap-based nil deref | Medium | ✅ Done | Drop `_emitNilCheck`; boundary maps `WebAssembly.RuntimeError` to the Go panic message. |
| Inlining & peepholes | Low | ✅ Done | `local.tee` peephole; `Vec3.*`/`GetVertex` under V8's default inlining budget. |
| Scratch globals in locals | Low | ✅ Done | Cache never-reassigned package globals at function entry. |

---

## v1.5.0

**Theme: WASM MVP — hybrid targets in the JS compiler.** First per-package WebAssembly (WasmGC) output in the existing compiler, so the hybrid model is validated with real numbers before the native rewrite. Extracts a shared `src/lower/` step (JS output byte-identical), adds `//gofront:target wasm | both` with targeted diagnostics, JS strict numeric mode for `both` packages, a core-subset WASM backend with a dependency-free encoder, and generated JS facades. Ends with the simplefps `mathx`/`collision` split and a go/no-go raycast benchmark. Design document in [`plans/v1.5.0/wasm-mvp-plan.md`](v1.5.0/wasm-mvp-plan.md).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| `src/lower/` extraction | High | ✅ Done | Move ownership/clone elision, boxing, range/defer shapes, embedding into side tables; add captures + escape analyses. All suites byte-identical to v1.4.0. |
| Package targets & diagnostics | Medium | ✅ Done | `//gofront:target` directives in the lexer, import rules, `both` mutable-state rule, targeted errors + per-package summary. |
| JS strict numeric mode | Medium | ✅ Done | `Math.fround`, `\|0`/`>>>0`, `Math.imul`, Go shift and div-by-zero semantics for `both` packages. |
| WASM backend (core subset) | High | ✅ Done | Encoder + `--emit-wat`; scalars, structs, pointers, methods, arrays, slices, strings (JS String Builtins), `any`, closures, `panic`; `math` natives/imports. |
| Boundary v1 & tooling | High | ✅ Done | Facades (values, handles, copy-in/out + retention check, numeric slices, `any`, JS → WASM callbacks), loader, single `app.wasm`, dev/build/test integration (`both` tests run on both targets). |
| simplefps split & go/no-go benchmark | Medium | ✅ Done | `mathx` (both) + `collision` (wasm: trimesh, octree, ray); `npm run bench:raycast` Möller–Trumbore + octree raycast, JS-only vs. hybrid. Baseline hybrid = 0.65× JS; after v1.5.1 codegen work 1.17× JS at 0.86 B/ray — **GO**. |

---

## v1.4.0

**Theme: Component-colocated CSS in `.templ` files.** Add native support for official [templ.guide](https://templ.guide) `css Name() { ... }` declarations, scoped class generation, and static stylesheet extraction. Design document in [`plans/v1.4.0/templ-css-plan.md`](v1.4.0/templ-css-plan.md).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| `css` declaration lexing | Medium | ✅ Done | Add `TT.CSS_KW` and nested brace CSS scanning in `TemplLexer`. |
| `CssDecl` AST node & parsing | Low | ✅ Done | Parse top-level `css Name() { ... }` in `TemplParser`. |
| Type-checker registration | Low | ✅ Done | Register `css` declarations as `func() string` in package scope. |
| Scoped class codegen & CSS extraction | Medium | ✅ Done | Hash class names (`gfc_<name>_<hash>`), emit class function, and collect static CSS into bundle. |

---

## v1.3.7

**Theme: Type-checker and codegen fixes surfaced by the SimpleFPS port.** No new language features.

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Pointer receiver typing | Low | ✓ | Receiver of `func (n *Node) M()` is typed `*Node`, so storing it in `[]*Node` no longer clones and `return n` type-checks. |
| Imported struct zero values | Low | ✓ | Omitted fields of a struct type from another bundled package are zero-initialised (`new V()`) instead of `null`. |

---

## v1.3.6

**Theme: Post-1.3.0 correctness.** No new language features. Fix the review findings against the 1.3.x releases: wrong JavaScript operator precedence, struct value aliasing, TypedArray mapping edge cases, Web API emission, and CLI safety.

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| JS operator precedence | Medium | ✓ | Parenthesise by *JavaScript* precedence and the emitted operator (`&^` → `& ~`, integer `/` → `Math.trunc`); separate adjacent unary operators (`- -a`). |
| Struct value semantics | High | ✓ | Copy struct/array values on assignment, call, return, `append`, and `range` via generated `__clone()`; box values in interfaces so `case T` / `case *T` are distinguished. |
| `[]float64` → plain array | Low | ✓ | Revert the 1.3.0 `Float64Array` mapping; `rune` becomes an alias of `int32` (`Int32Array`); sized integer conversions wrap. |
| TypedArray edge cases | Low | ✓ | `append` to nil typed slice, `[]rune(str)` code-point decoding, `__len` on typed arrays, assignment-form `for i, v = range` loops. |
| Web API emission | Medium | ✓ | PascalCase → camelCase member emission, WebGL1/WebGL2 split, trailing optional parameters, single-evaluation `io.Writer` receivers. |
| JS reserved identifiers | Low | ✓ | Rename Go identifiers that are JS reserved words (`in` → `in$`). |
| Type alias forward refs | Low | ✓ | Collect type declarations in dependency order. |
| CLI hardening | Low | ✓ | `cleanOutputDir` containment check, static asset copy on `build`, `localhost` default and error replay for `dev`, PWA offline fallback, vendor polyfill only for rolldown, `init` devDependency. |

---

## v1.3.2

**Theme: CLI polish and multi-file package resolution.** Fix multi-file package directory checks, auto-detect project test target, and add `serveDir` live-reload watcher to `gofront dev`.

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Multi-file package checks | Low | ✓ | Compile complete package directory when multiple Go files are present alongside `main.go`. |
| CLI `test` target auto-detection | Low | ✓ | Auto-detect `project.srcDir` when running `gofront test` from project root. |
| Dev server `serveDir` watcher | Low | ✓ | Watch `serveDir` for CSS hot-reload and HTML full-reload when distinct from watch target. |

---

## v1.3.1

**Theme: Bug fix.** Fix CLI routing fall-through in `gofront dev` causing crash on startup.

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| CLI `dev` process lifecycle | Low | ✓ | Await pending lifecycle promise so `gofront dev` holds process without falling through to file compile. |

---

## v1.3.0

**Theme: High-performance engine support & modern dev environment.**
This release covers two complementary tracks:
1. **Zero-Allocation Codegen & TypedArray Buffers:** High-performance code generation (`for range` loops, `Float32Array`/`Uint8Array` slice mapping, `.subarray()` zero-copy slicing, positional struct constructors, struct pointer unboxing, and WebGL2/WebGPU typings). Design document in [`plans/v1.3.0/zero-allocation-and-typed-arrays-plan.md`](v1.3.0/zero-allocation-and-typed-arrays-plan.md).
2. **Modern Dev Environment & Tooling:** Scaffolding overhaul (`gofront init`), semantic CLI commands (`gofront dev`, `gofront build`), resilient HTML-injected live reload, browser compiler error overlay, Node polyfills for Rolldown vendor bundling, and optional offline PWA service worker generation. Design document in [`plans/v1.3.0/dev-environment-and-tooling-plan.md`](v1.3.0/dev-environment-and-tooling-plan.md).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Zero-alloc `for range` loops | Low | ✓ | Emit indexed `for` loops without `.entries()` iterator tuple allocation. See [plan](v1.3.0/zero-allocation-and-typed-arrays-plan.md). |
| TypedArray slice mapping | Medium | ✓ | Map `[]float32`/`[]byte`/`[]uint32` to `Float32Array`/`Uint8Array`/`Uint32Array` in `make()`, literals, and builtins. See [plan](v1.3.0/zero-allocation-and-typed-arrays-plan.md). |
| Zero-copy sub-slicing | Low | ✓ | Emit `.subarray()` on TypedArrays instead of `.slice()`. See [plan](v1.3.0/zero-allocation-and-typed-arrays-plan.md). |
| Positional struct constructors & pointer unboxing | Medium | ✓ | Emit positional constructor calls `new Point(x, y)` and unbox struct pointers (`&s` -> `s`) to eliminate wrapper allocations. See [plan](v1.3.0/zero-allocation-and-typed-arrays-plan.md). |
| WebGL2 & WebGPU static typings | Medium | ✓ | Provide real method signatures and constants in typechecker stdlib instead of `ANY`. See [plan](v1.3.0/zero-allocation-and-typed-arrays-plan.md). |
| Turn-key project scaffolding | Low | ✓ | `gofront init` creates full browser project (`index.html`, `main.go`, `package.json` scripts, `biome.json`, `.devcontainer`). See [plan](v1.3.0/dev-environment-and-tooling-plan.md). |
| Semantic `dev` & `build` subcommands | Low | ✓ | Top-level `gofront dev` (watch + compile + asset sync + serve) and `gofront build` (clean + compile + minify + vendor). See [plan](v1.3.0/dev-environment-and-tooling-plan.md). |
| HTML live reload & error overlay | Medium | ✓ | Inject SSE live-reload script into HTML stream (survives compile errors), with keep-alive pings and interactive compiler error overlay. See [plan](v1.3.0/dev-environment-and-tooling-plan.md). |
| Rolldown Node polyfills | Low | ✓ | Auto-detect `@rolldown/plugin-node-polyfills` in `bundleVendor` so npm packages with Node built-ins run in browser. See [plan](v1.3.0/dev-environment-and-tooling-plan.md). |
| Offline PWA Service Worker | Low | ✓ | Automated `sw.js` pre-cache manifest generation via `gofront build --pwa`. See [plan](v1.3.0/dev-environment-and-tooling-plan.md). |

---

## v1.2.3

**Theme: Bug fix.** Fix minifier literal folding regex corrupting hyphenated numbers inside SVG path strings.

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Minifier literal folding token preservation | Low | ✓ | Tokenize before folding so strings/templates/regexes are never altered. |

---

## v1.2.2

**Theme: Bug fixes.** Fix identifier collisions in minifier mangling, struct field constructor shadowing, and single-variable map ranges.

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Minifier identifier collision | Low | ✓ | Skip occupied/unrenamed identifiers in `shortNameGenerator` during `--mangle`. |
| Struct field constructor shadowing | Low | ✓ | Alias constructor parameter when field name matches a type name. |
| Map range key iteration | Low | ✓ | Single-variable `range` over map emits `Object.keys()`. |

---

## v1.2.1

**Theme: Post-release hardening.** No new language features. Fix two bugs and several
consistency issues found in the v1.2.0 review, and document behaviour changes that shipped
undocumented. Design document in [`plans/v1.2.1/`](v1.2.1/).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Async-aware unit test harness | Low | ✓ | `test()` never awaited async tests; 25 async tests were vacuously green. `summarize()` now awaits pending promises. |
| Dev server path traversal | Low | ✓ | Replace `startsWith` prefix check with `relative()`/`isAbsolute()` containment (sibling-dir escape). See [plan](v1.2.1/post-release-hardening-plan.md). |
| `--dom` jsdom resolution | Low | ✓ | Resolve jsdom path in parent and inject `file://` import into harness; fixes global/npx installs. |
| Undocumented 1.2.0 changes | Low | ✓ | Changelog + tests for `== nil` loose-equality codegen and multi-file top-level var inference ordering. |
| CLI logic → `cli-core.js` | Low | ✓ | Move `test`/`prep` arg parsing and summary formatting out of `index.js` per architecture rule. |
| `vendor.globals` config | Low | ✓ | Replace hardcoded `fuse.js`/`prismjs`/`@emailjs/browser` global names with a config mapping. |
| Test-runner cleanups | Low | ✓ | Drop `bundleJsClean`, restrict discovery to `_test.go` programs, dedupe harness reporting. |

---

## v1.2.0

**Theme: Native unit testing & test runner.** Add built-in `gofront test` command, `*_test.go` file separation, standard `testing` package shim, and test harness execution. Design documents in [`plans/v1.2.0/`](v1.2.0/).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| `*_test.go` file filtering | Low | ✓ | Exclude `*_test.go` during normal builds, include during `gofront test`. |
| Standard `testing` package shim | Medium | ✓ | Built-in `testing.T` with `Error`, `Fatal`, `Log`, `Run`, `Skip`, `Helper` in typechecker + codegen. |
| Test discovery & harness generator | Medium | ✓ | Detect `Test*(*testing.T)` functions, emit and execute JS test runner with Go-style terminal formatting. |
| CLI `gofront test` command | Low | ✓ | Subcommand with `-v`, `-run`, `--dom` support. |

---

## v1.1.0

**Theme: Frontend asset management & vendor tooling.** Add native static asset copying,
vendor dependency packaging, and SPA route fallback to the dev server so GoFront projects
require no external build wrappers. Design documents in [`plans/v1.1.0/`](v1.1.0/).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| SPA fallback in dev server | Low | ✓ | Serve `index.html` on missing routes without file extensions during `gofront --serve`. |
| Native `assetCopy` manager | Low | ✓ | Zero-dependency static asset copying from `package.json` / `gofront.json` using `node:fs`. |
| Vendor dependency bundler | Medium | ✓ | Built-in `gofront prep` / `gofront vendor` bundling external npm dependencies. |

---

## v1.0.1

**Theme: Structural cleanup.** No new language features. Address four internal quality
concerns identified after v1.0.0 shipped. Design documents for this release were retired (available in git history).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Parser declarations split | Low | ✓ | Extract `parseTopDecl`, `parseFuncOrMethod`, `parseSignature`, `parseTypeDecl`, `parseVarDecl`, `parseConstDecl` from `parser/index.js` → `parser/declarations.js`. Mirrors the existing `statements.js`/`expressions.js` split. |
| Mixin `@this` JSDoc annotations | Low | ✓ | Add `/** @this {TypeChecker} */` and `/** @this {CodeGen} */` to all exported method objects in sub-modules. Fixes IDE autocomplete / "go to definition" on `this.*` calls without any runtime change. |
| ANY error cascade suppression | Medium | ✓ | Introduce `TAINTED_ANY` marker returned from error-recovery paths. Suppress downstream type errors whose sole cause is propagating tainted ANY. Root errors always emitted. |
| CLI core extraction | Medium | ✓ | Extract compile/minify/init logic from `src/index.js` into `src/cli/cli-core.js`. Enables direct import in tests; removes the subprocess-only coverage gap (~21% of `index.js`). |

---

## v0.0.5

**Theme: Major language features.** These are high-complexity items that touch multiple
compiler stages. Design documents for this release were retired (available in git history).

| Feature | Difficulty | Status | Notes |
|---|---|---|---|
| Generics (`[T any]`) | High | ✓ | Type erasure approach. |
| Range over iterator functions | Medium | ✓ | `func(yield func(K, V) bool)` protocol. |
| Complex number types | Medium | ✓ | `complex64`/`complex128`, `complex()`, `real()`, `imag()`. |
| Richer error values | Medium | ✓ | Custom error types, `errors.Is`/`Unwrap`, `%w` wrapping. |
| Better array semantics | Medium | ✓ | Compile-time bounds checking, `[...]T` inference, `append` rejection. |
| Better pointer model | High | ✓ | Address-taken scalars boxed as `{ value: T }`. |
| Slice → array conversion `[N]T(slice)` | Low | ✓ | Go 1.20 feature. |
| `bytes` stdlib shim | Medium | ✓ | `Contains`, `Split`, `Join`, `Replace`, `ToUpper`/`ToLower`, etc. |
| Built-in minifier (replace terser) | Medium | ✓ | Three-stage minifier: comment stripping, token compression, identifier mangling. |

---

## v0.0.6

**Theme: Standard library depth.** The language spec gap is nearly closed. v0.0.6
fills the most commonly used stdlib packages and the last missing spec statement. Design documents for this release were retired (available in git history).

| Feature | Difficulty | Status | Notes |
|---|---|---|---|
| `strings.Builder` / `bytes.Buffer` | Low | ✓ | Idiomatic string/byte building via plain JS object shim. |
| `regexp` package | Medium | ✓ | Pattern matching via JS `RegExp`. `MustCompile`, `FindString`, `ReplaceAllString`, inline flags, etc. |
| `slices` package (Go 1.21) | Low | ✓ | `Sort`, `Contains`, `Index`, `Reverse`, `Clone`, `Compact`, `Insert`, `Delete`, and more. |
| `maps` package (Go 1.21) | Low | ✓ | `Keys`, `Values`, `Clone`, `Copy`, `Equal`, `DeleteFunc`, etc. |
| `html` package | Low | ✓ | `html.EscapeString` / `html.UnescapeString` via inline `replace` chains. |

---

## v0.0.7

**Theme: gomponents-style DOM components.** Browser-native declarative component model
inspired by [gomponents](https://github.com/maragudk/gomponents). Design documents for this release were retired (available in git history).

| Feature | Difficulty | Status | Notes |
|---|---|---|---|
| Methods on named non-struct types | Medium | ✓ | `type Group []Node` and `type NodeFunc func(...)` with methods. Codegen: ES6 class wrapping the underlying value. |
| `gom` built-in namespace | Low | ✓ | Browser-native component built-in: `El`, `Text`, `Attr`, `Class`, `If`, `Map`, `Style`, `Mount`, `MountTo` plus all HTML element and attribute helpers. Registered in typechecker + codegen like `fmt`/`strings` — no source package, zero runtime overhead. |
| `gom` element helpers | Low | ✓ | `Div`, `A`, `Span`, `H1`–`H6`, `Ul`/`Ol`/`Li`, `Form`, `Input`, `Button`, etc. All built into the `gom` namespace — no `elements.go` source file needed. |
| `gom` example app | Low | ✓ | Full-featured todo app using `gom`, with feature parity to simple and reactive examples. |
| `io` package shim (optional) | Low | ✓ | `io.Writer`, `io.EOF`, `io.Discard`, `io.WriteString`. Enables shared Go code that accepts `io.Writer` to compile in GoFront unchanged. |


---

## v0.0.8

**Theme: stdlib completeness + E2E testing.** The language spec is effectively done.
v0.0.8 closes the remaining gaps in the standard library shims and adds end-to-end
browser tests covering all three example apps. Design documents for this release were retired (available in git history).

| Feature | Difficulty | Status | Notes |
|---|---|---|---|
| `math/rand` package | Low | ✓ | `rand.Intn`, `rand.Float64`, `rand.Shuffle`, `rand.Perm`, `rand.Seed` (no-op). Wraps `Math.random()`. |
| `math` additions | Low | ✓ | `Atan`, `Atan2`, `Asin`, `Acos`, `Exp`, `Exp2`, `Trunc`, `Hypot`, `Signbit`, `Copysign`, `Dim`, `Remainder`. |
| `sort` additions | Low | ✓ | `sort.Search` (binary search), `sort.IntsAreSorted`, `sort.Float64sAreSorted`, `sort.StringsAreSorted`. |
| `strings` additions | Low | ✓ | `Fields`, `Cut`, `CutPrefix`, `CutSuffix`, `SplitN`, `SplitAfter`, `SplitAfterN`, `IndexAny`, `LastIndexAny`, `ContainsAny`, `ContainsRune`, `IndexRune`, `IndexByte`, `LastIndexByte`, `Map`, `Title`, `ToTitle`, `TrimFunc`, `TrimLeftFunc`, `TrimRightFunc`, `IndexFunc`, `LastIndexFunc`, `NewReplacer`. |
| `bytes` additions | Low | ✓ | `ReplaceAll`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `TrimFunc`, `IndexByte`, `LastIndex`, `LastIndexByte`, `Fields`, `Cut`, `ContainsAny`, `ContainsRune`, `Map`, `SplitN`. |
| `strconv` additions | Low | ✓ | `strconv.Quote`, `strconv.Unquote`, `strconv.AppendInt`, `strconv.AppendFloat`. |
| `unicode/utf8` package | Low | ✓ | `RuneCountInString`, `RuneLen`, `ValidString`, `ValidRune`, `DecodeRuneInString`, `DecodeLastRuneInString`, `FullRuneInString`, `RuneError`/`MaxRune`/`UTFMax` constants. |
| `path` package | Low | ✓ | `Join`, `Base`, `Dir`, `Ext`, `Clean`, `IsAbs`, `Split`, `Match`. Also registers `path/filepath` as an alias. |
| `time` additions | Medium | ✓ | `t.Format(layout)`, `time.Parse`, `t.Year/Month/Day/Hour/Minute/Second`, `t.Add/Sub/Before/After/Equal`, `time.Date`, `time.Unix`, RFC3339/DateOnly/DateTime constants. |
| `io.Reader` shim | Medium | ✓ | `strings.NewReader`, `bytes.NewReader`, `io.ReadAll`. Completes the `io` package alongside the v0.0.7 writer side. |
| `fmt` scanning | Medium | ✓ | `fmt.Sscan`, `fmt.Sscanln`, `fmt.Sscanf`. Parses whitespace-separated tokens into pointer targets. |
| E2E tests (Playwright) | Medium | ✓ | Shared test suite covering all three example apps: CRUD, filtering, priority mode, persistence, drag-and-drop, sync status. |
| Source map `sourcesContent` | Low | ✓ | Embed original `.go` source in the source map so browser DevTools can show it and honour breakpoints without fetching source files. |
| Example app modernisation | Low | ✓ | `slices.DeleteFunc` replaces local `utils.Filter`; `utf8.RuneCountInString` replaces `len([]rune(...))` across all three apps. |
| GoFront lint in `npm run check` | Low | ✓ | `--check` pass for all three example apps added to `npm run check` and the husky pre-commit hook. |

---

## v0.0.9

**Theme: `.templ` file support.** Native `.templ` parsing brings the
[templ](https://templ.guide) authoring experience to GoFront. Components are written in
familiar templ syntax and compiled directly to DOM manipulation JavaScript, with the
`gom` built-in (promoted in v0.0.7) as the runtime target. Design documents for this release were retired (available in git history).

| Feature | Difficulty | Status | Notes |
|---|---|---|---|
| `.templ` file support | High | ✓ | Native `.templ` parsing: `templ` declarations, HTML bodies, `{ expr }` interpolation, `@component()` calls, `{ children... }` slots, `if`/`else if`/`else`, `for`, `switch` control flow, `@templ.Raw()` for trusted HTML injection. Compiles directly to DOM manipulation JS. |
| Column numbers in error messages | Low | — | Store `col` from lexer tokens on AST nodes; emit `file:line:col` and a caret indicator in both parse and type errors. |
| Incremental compilation in watch mode | Medium | — | Parse cache keyed by file mtime; skip re-parsing unchanged files on every save. Rebuild timing logged to console. |

---

## v1.0.0

**Theme: Code quality and tooling.** No new language features — focus on structural quality,
test coverage, and correctness of existing behaviour.

| Area | Status | Notes |
|---|---|---|
| Sentrux architectural quality gate | ✓ | Layer boundaries, coupling, complexity, and import cycles enforced via `.sentrux/rules.toml` on every `npm run check` run. Baseline floor: 6447/10000. |
| Test coverage improvements | ✓ | New unit tests for dts-parser robustness, `fmt.Fprintln`/`Fprint` multi-argument output, generics disambiguation edge cases, and complex compound assignment operators. New e2e tests for templ `switch` rendering and active filter state. |
| Bug fixes | ✓ | `fmt.Fprintln`/`Fprint` dropped all arguments after the first when writing to a builder or buffer; parser failed to recognise user-defined type names (uppercase identifiers) as generic type arguments; `_genComplexCompoundAssign` silently emitted wrong JS for unsupported operators. |

---

## Out of scope

Goroutines, channels, `select`, `unsafe`, full `reflect`, `cgo`, exact integer overflow,
Go-equivalent map semantics. These all require either a runtime scheduler or memory model
that conflicts with the "no runtime" principle.

`goto` — no clean JS translation in the general case (cross-scope jumps require a
runtime scheduler equivalent). See README § What's not implemented for the full list.
