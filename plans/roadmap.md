# GoFront Roadmap

GoFront's guiding principle is **no runtime** — features that need a scheduler, runtime
type descriptors, or raw memory access are out of scope.

Each release has a subfolder in `plans/` containing design documents for the planned
features (e.g. `plans/v1.8.0/`).

---

## v2.0.0

**Theme: Web platform evolution and Go-faithful checking (Draft, breaking).** Compile-time asset embedding (`//go:embed`), fast incremental watch rebuilds, whole-program dead-code elimination, typed web APIs (`gofront/dom`, `gofront/canvas`) and reactive `gom` signals in `.templ`, keeping the pure Node.js ESM compiler architecture; a checker that rejects the invalid Go 1.x accepted; and a hardened unit test harness underneath both. Backward compatibility is not a goal. Merge order: harness Phase 1 → checker strictness → web platform Phase 6 (web Phases 1–5 are independent of the checker plan).

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Web platform evolution | High | Draft | **Breaking.** `//go:embed` (`string`, `[]byte`, `embed.FS.ReadFile`) on every target, a process-lifetime `PackageCache` with a dependency DAG for < 25 ms `gofront dev` rebuilds (also reports import cycles and compiles diamond imports once), user-code and receiver-qualified stdlib DCE with runtime helpers emitted once per bundle, `gofront check` over every package and `_test.go`, WebIDL-generated `gofront/dom`, `canvas`, `fetch`, `websocket` and `webgpu` with typed browser globals (IDL integers → `int`), and `gom.Signal` text/attribute bindings in `.templ`. Phase 6 starts after checker strictness merges. See [web-platform-evolution-plan.md](v2.0.0/web-platform-evolution-plan.md). |
| Unit test harness hardening | Medium | Draft | Internal only. `compile()` test helper on the production `compileFiles` path (structured `CompileError`, returned warnings, crashes no longer counted as compile errors), message-checked negative tests enforced by a convention test, one `assertOutput` behind the six output helpers, and `run.js` file args, `--grep`, per-test/per-file timeouts, file-qualified failures and a correct standalone exit code. Suite speed is deferred to the `PackageCache` phase of the web platform plan. See [test-harness-hardening-plan.md](v2.0.0/test-harness-hardening-plan.md). |
| Checker strictness | High | Draft | **Breaking.** The checker rejects the invalid Go that 31 of 68 review programs got through: identity by declaration and structure instead of printed names (anonymous structs/interfaces, shadowed local types), identical numeric operand types and no implicit `int` → `float64`, no operators/calls/indexing on a Go `any` (JS-dynamic interop values stay permissive until web plan Phase 7), returns, `nil`, `range`, left-hand sides, labels, unused expressions, duplicates, struct literal counts, impossible assertions and uninstantiated generics. Also a line:col on every expression diagnostic, a conformance corpus, `WebAssembly.validate` on the linked module and internal-compiler-error reporting. No change to `example/` or `stdlib/`; SimpleFPS fixes 10–11 call sites. Starts after harness Phase 1; merges before web plan Phase 6. See [checker-strictness-plan.md](v2.0.0/checker-strictness-plan.md). |

---

## v1.9.3

**Theme: Valid Go that miscompiles.** Patch release for the runtime miscompiles found in the 2026-11-13 review: names that shadow JavaScript built-ins, side effects evaluated twice or out of order, shallow copies of anonymous structs, and `wasm` panic parity. Nothing that compiles today is rejected.

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| JS codegen fixes | Medium | Draft | [`v1.9.3/js-codegen-fixes-plan.md`](v1.9.3/js-codegen-fixes-plan.md): `$`-suffix rename set derived from what emitted code references (registry test), `__` names, strict `/ % << >>` and compound operands evaluated once and left first, Go's multi-assignment order on JS and `wasm`, field-wise anonymous-struct copies and elided literals, typed `recover()` values and Go's slice-bounds text on `wasm`; local and `wasm`-package type names after built-ins renamed (`Map__L1`, `WeakMap$$util`), `__` struct members suffixed, and `wasm` generics specialised for anonymous structs. |

---

## v1.9.2

**Theme: Valid release bundles.** Patch release for the 1.9.1 regression found while adopting 1.9 in SimpleFPS: the built-in minifier turns binary literals from the Go-source stdlib (`0b00000000`) into `0 b00000000`, so `gofront build` output for any program importing `fmt`, `strings` or `strconv` does not parse. Also adds bundle-size budgets.

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Release bundle fixes | Medium | Completed (2026-11-13) | [`v1.9.2/release-bundle-fixes-plan.md`](v1.9.2/release-bundle-fixes-plan.md): minifier numeric literals (`0b`/`0o`/`_`), a parse gate in `npm run build`, `test/perf/bundle-size.js` budgets. JSON register-only scoping was dropped (no reflective JS fallback) and is deferred. The Go-source stdlib and generated-code size growth is measured and deferred to v2.0.0 DCE. |

---

## v1.9.1

**Theme: Review follow-ups.** Patch release fixing the 24 reproducing review follow-ups left after v1.9.0, 5 regressions found while adopting 1.9.0 in SimpleFPS, 21 defects found while reviewing those fixes, 14 more found while reviewing the second round, and 11 more found while reviewing the third round.

| Area | Difficulty | Status | Notes |
|---|---|---|---|
| Follow-up fixes (2026-11-09) | High | Completed (2026-11-10) | 29 defects in 8 phases: typechecker checks (`switch` cases, `cap`, negative array lengths, local vs imported types), `any` → concrete without a type assertion, parser constraint elements and JS statements (local-type TDZ, 64-bit constants, labeled range-over-func, map range into boxed vars), WASM codegen (labeled range-over-func, unhashable-key messages, interface assertions from `any`), JS nil receivers and unhashable keys, dynamic types / `%T` / `encoding/json`, JSON codec generation (`.d.ts` interop crash, codecs for every declared type), and `float32` constants in JS, templ `fmt` typing and WASM SIMD global zero values. Untyped JS-interop `any` deferred. See [follow-ups-2026-11-09-plan.md](v1.9.1/follow-ups-2026-11-09-plan.md). |
| Follow-up fixes (2026-11-10) | High | Completed (2026-11-11) | 21 defects from the 2026-11-09 plan reviews in 6 phases: typechecker checks (`case nil` vs bool tag, `cap` whitelist, `any` → non-empty interface, constraint interfaces as value types, folded array-length import use on cached ASTs), parser and conversions (`I(v)`, `interface{…}(v)`, `[]func(){…}` call args) plus JS `for`-post 64-bit compound assigns and nested labeled range-over-func, WASM codegen (nested `continue outer`, slice/string range into boxed vars, promoted embedded-pointer dispatch, defined-map unhashable message), JS nil receivers (scope-aware analysis, generics, `(*T).V` nil check), unhashable literal keys and `json` func arrays, and multi-value call forwarding (`return f()`, `g(f())`) into `any` results and parameters, and `complex64` constants on JS plus `fmt` in templ `case` lists. Starts after the 2026-11-09 plan merges. See [follow-ups-2026-11-10-plan.md](v1.9.1/follow-ups-2026-11-10-plan.md). |
| Follow-up fixes (2026-11-11) | High | Completed (2026-11-11) | 14 defects from the 2026-11-10 plan reviews in 4 phases: typechecker and parser diagnostics (`comparable` embeds in constraints, `I(a)` from `any` without assertion, `int` range index into `int32`, unparenthesized composite literals in `if` headers), method sets (methods promoted through embedded pointers, ambiguous same-depth promotion, typed-nil outer pointers on WASM), arrays and func types in `any` (`==`, WASM `map[any]` array keys, `%T` of func types), and codegen (JS `switch` on nil map, stacked labels on range-over-func, WASM nested forwarded calls, named `complex64` constants) plus a stale WASM panic note in the docs. Starts after the 2026-11-10 plan merges. See [follow-ups-2026-11-11-plan.md](v1.9.1/follow-ups-2026-11-11-plan.md). |
| Follow-up fixes (2026-11-12) | High | Completed (2026-11-12) | 11 defects from the 2026-11-11 plan reviews in 4 phases (plus 6 more from those phases' own reviews in 3 appended phases: promoted methods over deeper fields, JS `append` of complex constants and range assignment into interfaces, WASM array/slice/map identity and generic slices in `any`, WASM untyped complex constants): parser and typechecker selectors (explicit func type arguments, ambiguous promoted fields), embedded interfaces in structs (`struct{ error }`) on every target and value methods through a nil embedded pointer on WASM, WASM dynamic types in `any` (named array/slice identity, generic maps and slices of funcs, assertion panic names), and codegen (WASM range assignment into `any`, WASM range-over-func capture of outer range indexes, JS forwarded calls into nil-checked interface methods, JS `complex64` precision). A third sweep adds 9 more defects in 2 phases: deferred calls (variadic and spread arguments, `nil` and untyped constants for defined-type, generic and nilable parameters) and JS/WASM range assignment targets, nil defined slice assertions, generic arrays in `any` and complex equality. A fourth sweep adds 5 more defects in 2 phases: comparison results as untyped bools for defined bool types, deferred non-constant untyped arguments, the default type of a rune literal, `fmt` of maps and arrays with `bool` or small-integer keys and elements in an `any`, and range-over-func assignment targets. A fifth sweep adds 5 more defects in a final phase: `&&`/`||` of defined bools, non-integer constant array lengths, indexes and `make` sizes, range-over-func assignability, `%T` of maps with small keys and func values, and per-call type tags for maps and arrays boxed in generic JavaScript code. A sixth sweep adds 4 more defects in one more phase: non-integer typed index and size operands, type inference from array parameters, `len`/`cap` of arrays as array lengths, and the value type of structs that generic JavaScript code boxes after a pointer. A seventh sweep adds 1 more defect in a last phase: index, slice-bound and `make` size operands of struct, pointer, slice, map, func, array, interface and non-integer type-parameter types. See [follow-ups-2026-11-12-plan.md](v1.9.1/follow-ups-2026-11-12-plan.md). |

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

## Earlier releases

v0.0.5 through v1.7.0 are complete. See [CHANGELOG.md](../CHANGELOG.md) for what each release shipped; their roadmap entries and design documents were retired (available in git history).

---

## Out of scope

Goroutines, channels, `select`, `unsafe`, full `reflect`, `cgo`, exact integer overflow,
Go-equivalent map semantics. These all require either a runtime scheduler or memory model
that conflicts with the "no runtime" principle.

`goto` — no clean JS translation in the general case (cross-scope jumps require a
runtime scheduler equivalent). See README § What's not implemented for the full list.
