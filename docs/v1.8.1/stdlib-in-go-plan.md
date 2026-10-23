# Stdlib in Go — Design Plan

**Version:** v1.8.1
**Status:** Draft (2026-10-23)
**Depends on:** v1.8.0 ([`../v1.8.0/portable-go-plan.md`](../v1.8.0/portable-go-plan.md)) **released**: the Go-source stdlib loader, overlays, reachability, `//gofront:intrinsic`, the coverage manifest and the conformance harness must all exist. Phases 3–9 of this plan also assume the v1.8.0 member tasks that touch the same packages have landed (see [Relationship to v1.8.0 and v2.0.0](#4-relationship-to-v180-and-v200)).
**Replaces:** None
**Followed by:** [`docs/v2.0.0/native-go-engine.md`](../v2.0.0/native-go-engine.md). After this release the stdlib that the native engine must port is a fraction of today's, because Go-source packages are embedded, not ported.

---

## Goal

v1.8.0 introduced a way to write a stdlib package **once, in Go**, and left every existing package on the old path: a hand-written type table in [`src/typechecker/stdlib/`](../../src/typechecker/stdlib/), a JS shim in [`src/backend/js/stdlib/`](../../src/backend/js/stdlib/) and a WASM instruction emitter in [`src/backend/wasm/stdlib/`](../../src/backend/wasm/stdlib/). That is 26,119 lines of JavaScript (2,426 typings, 2,976 JS shims, 20,717 WASM emitters) against 77 lines of Go-source stdlib. v1.8.1 moves **every package whose behaviour is ordinary Go over GoFront values** onto the Go-source path, and keeps host-backed fast paths as small, named **natives** that are checked against the Go body.

This is not only a cleanup. The probes below show that the old path is where the correctness and speed bugs are: every WASM sort is quadratic, sorting `NaN` gives an unsorted result on both backends, `sort.Slice` breaks ties in a different order than Go, and 163 signatures differ from Go's. It also shows the opposite risk: a naive Go rewrite of host-backed string functions is about 300× slower in WASM. So the plan has one rule: **Go is the specification and the default implementation; a native may replace it only where the host has a faster primitive, and only while a differential test proves the two agree.**

**Done means:**
- Every package marked *Go-only* or *Native-accelerated* in the [Scope rule](#scope-rule) is a directory under `runtime/stdlib/`, with no entry in `src/typechecker/stdlib/`, no WASM emitter and no JS shim body beyond its registered natives. `STDLIB_PACKAGES` and `WASM_STDLIB_MEMBERS` lose those names.
- Line counts, measured with `wc -l` and recorded in this document at the end of Phase 9: `src/backend/wasm/stdlib/` ≤ 8,000 (from 20,717), `src/typechecker/stdlib/{core,extended}.js` ≤ 1,500 (from 1,715), `src/backend/js/stdlib/` ≤ 2,200 (from 2,976).
- Every conformance fixture produces Go's exact output in **four** configurations: JS with natives, JS with natives off, WASM with natives, WASM with natives off. Fixtures for `sort`, `slices` and `bits` include `NaN` and tie-order cases captured from real Go.
- WASM sorting is O(n log n): `slices.Sort` of 200,000 `int` values runs in ≤ 100 ms (today 20,443 ms), and `slices.SortFunc` and `sort.Slice` in JS stay within 1.5× of `Array.prototype.sort` with a comparator at 200,000 elements (the Go-source quicksort probe measured 0.73×).
- Compile time does not regress: a program that imports all migrated packages and uses one function from each type-checks at most 5 ms slower than the same program on v1.8.0, and an unused import costs 0 bytes in `app.js` and dev-mode `app.wasm`.
- `strconv.ParseInt`-style signature drift is gone for migrated packages: the signature gate reports 0 mismatches for every package with implementation `source`, and the manifest records `source`, `native` or `emitter` per member.
- `npm test`, `npm run check` and `npm run test:e2e` pass, and built `example/` outputs differ from v1.8.0 only where [Edge Cases](#3-edge-cases--error-handling) list a behaviour fix.

---

## Scope Rule

A package or member is **moved to Go** when its behaviour can be written as ordinary GoFront Go over values the compiler already has. It **keeps a native** when the host has a primitive that is measurably faster than that Go, and the Go body still exists. It **stays an emitter** when it needs type information, host services or generated code that Go source cannot express.

| Category | Rule | Packages and members |
|---|---|---|
| **In scope: Go-only** | Whole package in Go, no natives, on both backends | `sort` (except the JS `Ints`/`Strings` natives below), `slices`, `maps`, `errors` (`New`, `Is`, `Unwrap`, `Join`, `ErrUnsupported`; `As` stays an emitter member), `unicode/utf8` (except `RuneCountInString` native), `path`, `path/filepath`, `html`, `encoding/hex`, `encoding/base64`, `encoding/binary` (`ByteOrder`, `Append*`, `Put*`, varints), `crypto/sha256`, `sync`, `io`, `bytes`, `strings.Reader`, `bytes.Reader`, `bytes.Buffer`, `strings.Replacer` |
| **In scope: Native-accelerated** | Go body is the specification; a registered native replaces calls when the host primitive wins | `strings` (`Contains`, `Index*`, `Has*`, `Repeat`, `ToUpper`/`ToLower`, `Split*`, `Join`, `Replace*`, `Trim*`, `EqualFold`, ... where JS or a WASM import has the primitive), `bytes` (`IndexByte`, `Equal`, `Compare` on typed arrays), `slices.Sort`/`Contains`/`Index`/`Reverse`/`Clone` for `int`/`string`/`float64` element types where JS equals Go, `sort.Ints`/`Strings`, `math/bits` (`Len`, `LeadingZeros`, `OnesCount` via `Math.clz32`/WASM instructions), `math/rand` (top-level functions over `Math.random` or the existing random import), `unicode` `Is*`/`To*` (JS `\p{…}` classes and the existing WASM tables), `strconv` (`FormatFloat`/`ParseFloat`/`AppendFloat` shortest-repr), `time` (`Now`, `Since`, local zone offset) |
| **In scope: Stays emitter** | Needs type tables, generated code or the host | `fmt` (verb engine, `%T`/`%v` type tables, `Fprint*` dispatch), `encoding/json` (generated codecs), `regexp`, `os`, `testing`, `gom`, `gofront/shared`, `gofront/simd`, browser and WebGL/WebGPU typings, `math` (single instructions and imports), `crypto/rand`, `errors.As` (tests the dynamic type of its target), `strings.Builder` (JS string append, WASM builder state), `encoding/binary` `Read`/`Write` (take `any` and walk struct fields), `time.Sleep` |
| **Excluded: runtime / platform** | Unchanged from v1.8.0 | goroutines, channels, `reflect`, `unsafe`, `runtime`, file I/O |
| **Excluded: deferred** | Valid, but not part of a patch release | A user-visible `//gofront:native` for user packages (natives are a closed, compiler-owned registry); generating a Go-source `fmt`; moving `regexp` to Go (RE2 port); the `go/*`, `compress/*`, `math/big` families already deferred in v1.8.0 |

---

## Verified Gaps & Baseline Audit

Audit run 2026-10-23 on `feat/portable-go` (HEAD `04aa0c6`, Node 25.2.0, local Go toolchain `go1.27.2`). Probes lived in `.probes/` (excluded from git) and were deleted when this plan was drafted; each row records the command and the observed result. "Go says" columns come from running the same program with `go run`.

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Generic core types | **The type-parameter pattern that `slices` and `maps` need does not type-check.** With `[S ~[]E, E any]`: `s[0]` reports `Cannot index type S`, `s[1:]` reports `Cannot slice type S`, `S(nil)` reports `Cannot call non-function type S`, and `M ~map[K]V` reports `Cannot infer type arguments`. Only `range` and `append` over `S` work. Using plain `[]E` compiles, but then a named slice type cannot come back as `S`, and the signature no longer matches Go's. | P1b: `node .probes/p1b.mjs`, project compile of `index S~[]E`, `slice S~[]E`, `conversion S(nil)`, `map M~map[K]V`: each FAIL on `both` and `wasm`; `plain []E` and `plain map[K]V` OK |
| Generic core types, WASM | `Contains[S ~[]E, E comparable]` called with a named slice type (`type IDs []int`) gives an **invalid WASM module** (`local.tee[0] expected type (ref null 21), found local.get of type (ref null 52)`). JS is correct. | P1c: `Contains(IDs{1,2,3}, 2)` as a `wasm` package; same call in `both` (JS copy) returns `1` |
| WASM sort complexity | **Every WASM sort is O(n²).** Doubling n multiplies the time by 4 or more: `sort.Ints` 10k/20k/40k = 51/81/320 ms, `slices.Sort` 24/72/285 ms, `sort.Slice` 220/119/509 ms, `slices.SortFunc` 195/117/324 ms. `slices.Sort` of 200,000 `int` values takes 20,443 ms; a Go-source quicksort over the same input takes 22 ms. | P4, P5: `node .probes/p4.mjs 200000`, `node .probes/p5.mjs` (`compileWasm` + `runWasm`); emitter in [`core.js`](../../src/backend/wasm/stdlib/core.js) `emitSlicesSort`/`emitSortSlice` |
| Sort with `NaN` | **Silent wrong result on both backends.** `slices.Sort([]float64{3, NaN, 1, -Inf, 2})` leaves `[3 NaN -Infinity 1 2]`; Go says `[NaN -Inf 1 2 3]`. `sort.Float64s([]float64{3, NaN, 1, 2})` leaves `[3 NaN 1 2]`; Go says `[NaN 1 2 3]`. The JS comparator `a < b ? -1 : a > b ? 1 : 0` is not a valid order for `NaN`. | P6: `compileHybrid(...).run("Main")` JS and WASM agree with each other and differ from `go run` (`.probes/gop6/main.go`) |
| Sort tie order | `sort.Slice` with 40 elements whose key is `i % 3` returns the first 14 values as `0 3 6 9 12 15 …` (stable) on both backends; Go's pattern-defeating quicksort returns `15 39 36 3 33 30 6 27 24 9 0 21 12 18`. The v1.8.0 plan requires Go's order only for the new `sort.Sort`. | P6 against `go run` |
| Native fast paths | The JS emitters inline host primitives: `strings.Contains(s, x)` → `s.includes(x)`, `strings.Index` → `s.indexOf`, `slices.Sort` → `a.sort(...)`, `slices.Contains` → `a.includes`. A Go rewrite loses this. | P2: `compile()` output of a program using `strings`, `slices`, `sort`, `bytes`, `utf8` |
| Cost of naive Go | A Go loop over `[]byte` replacing `strings.Index` on a 1 MB string is **~300× slower in WASM**: 271.2 ms for 20 calls against 0.9 ms for the emitter (which calls the host `indexOf`). Module size is similar (6,816 vs 6,381 bytes). Blanket migration of string functions would be a regression. | P3: `node .probes/p3.mjs` |
| Native vs Go in JS | A Go-source quicksort compiled to JS: ordered `Sort[E]` takes 349 ms against 89.7 ms for `Array.prototype.sort` at 200,000 elements (3.9× slower), but `SortFunc` with a comparator takes 65.6 ms (0.73×). So the JS native for ordered sorts is worth keeping, and comparator sorts can use Go. | P11: `node .probes/p11.mjs` |
| Module size | A WASM module that uses `bytes.Buffer` is 6,957 bytes; the same program with a 6-line Go `Buffer` is 3,293 bytes. | P8: `compileWasm` of both programs |
| Compile cost | The checker handles about 110 lines of generic Go per millisecond: 5,604 lines type-check in 49.9 ms (JS) and 56.0 ms (WASM), against 0.4 ms / 1.2 ms for hello world. Checking every body of every migrated package on every build would add tens of milliseconds, against v2.0.0's sub-10 ms rebuild target. | P10: `node .probes/p10.mjs` |
| Signature drift | 163 coverage-gate signature mismatches come from the hand-written type tables: `time` 33, `slices` 28, `math` 18, `strings` 14, `unicode` 11, `bytes` 9, `encoding/base64` 8, `maps` 7, `unicode/utf8` 7, `fmt` 6, `math/rand` 6, `encoding/binary` 4, `sort` 4, `crypto/sha256` 3, `os` 3, `strconv` 2. | P7: `node .probes/p7.mjs` over [`stdlib-coverage.gaps.json`](../../test/unit/types/stdlib-coverage.gaps.json) |
| Name coupling | Backends and the checker special-case emitter types by name outside the stdlib directories: `strings.Builder` 11 sites, `bytes.Buffer` 12, `strings.Reader` 9, `bytes.Reader` 9, `time.Time` 10, `time.Duration` 5, `sha256.` 14, `strings.Replacer` 4, `io.LimitedReader` 5, `io.Writer`/`io.Reader` 4 each, and `_derivedReturn` 3. A migrated type needs these sites unwound or it keeps two representations. | grep over `src/` excluding `*/stdlib/`: [`emit-builtins.js`](../../src/backend/wasm/emit-builtins.js), [`wasm/index.js`](../../src/backend/wasm/index.js), [`boundary.js`](../../src/backend/wasm/boundary.js), [`js/expressions.js`](../../src/backend/js/expressions.js), [`typechecker/expressions.js`](../../src/typechecker/expressions.js) |
| Manifest | `runtime/stdlib/manifest.json` entries have `pkg, name, kind, signature, status` only. The `implementation` field (`emitter`/`source`) that [v1.8.0 §3](../v1.8.0/portable-go-plan.md#3-coverage-manifest-and-conformance) and [v2.0.0](../v2.0.0/native-go-engine.md) rely on does not exist. | Inspection of `runtime/stdlib/manifest.json` (2,476 entries, 4 key sets) |
| Tooling | `npm run conformance:update` accepts only `go1.26.x` ([`update.js:13`](../../test/conformance/update.js)). This machine has `go1.27.2`, so new fixtures cannot be captured here without a pinned 1.26 toolchain. | `go version`; `GO_VERSION = "go1.26"` |
| No gap found | `unicode.IsLetter/IsUpper/IsLower/IsDigit/IsSpace/IsPunct/ToUpper/ToLower` on `a é Σ σ 中 ٣ ǅ U+00A0 €` give identical results on JS, WASM and Go. The `unicode` natives can be kept as they are. | P8 against `.probes/gop8/main.go` |
| Found, not in this plan | (1) `'é'` as a rune literal throws a `LexError` (`Unknown escape in rune literal: \u`); string literals and `'\x41'` need a separate check. (2) `fmt.Sprintf("%v", math.Inf(-1))` prints `-Infinity`; Go prints `-Inf`. | P9, P6. (2) joins the `fmt` defects already listed in v1.8.0 Task 3.7; (1) is a lexer bug for a v1.8.x fix |

---

## Out of Scope

- **`fmt`.** The verb engine needs per-type name tables and `Stringer`/`error` dispatch, and it is the most host-coupled package. It stays an emitter. Its `Fprint*` dispatch is rewritten only as far as the `io.Writer` change in Phase 6 requires.
- **`encoding/json`.** The generated per-type codecs are compile-time specialisation, not library code.
- **`regexp`.** Needs an RE2 engine or a host call per match; stays JS-only.
- **User-visible natives.** `//gofront:native` is accepted only in files under `runtime/stdlib/`. A user package that uses it reports `//gofront:native is reserved for the standard library`.
- **Generating `strings.Builder` in Go.** A Go builder over `[]byte` makes `String()` an O(n) conversion on every call and `WriteString` a UTF-8 encode, against a JS `+=`. Revisit only after the string representation changes (v2.x).
- **Byte-for-byte JS output of migrated calls for programs that do not use them.** Output changes are limited to calls that now use a native template; the template text reproduces today's emitter text where the host primitive is the same.
- **New stdlib surface.** No member is added by this release unless a migrated package needs it to match Go's signature. New members stay with v1.8.0 and later.
- **Fixing the rune-literal `\u` bug and `fmt` `-Inf`.** Both are reported in [Verified Gaps](#verified-gaps--baseline-audit) and belong to separate v1.8.x fixes.
- **Changing what a runtime panic or unsupported feature reports.** Exclusion diagnostics from v1.8.0 are unchanged.

---

## Approach

### 1. Architecture & Design Decisions

**Three layers become one.**

| Today (per package) | After |
|---|---|
| Type table in `src/typechecker/stdlib/*.js` | Go declarations in `runtime/stdlib/<path>/*.go`; the checker reads them like user code |
| JS shim `src/backend/js/stdlib/<pkg>.js` | Go body compiled by the normal pipeline, plus registered natives in `src/backend/js/natives.js` |
| WASM emitter `src/backend/wasm/stdlib/*.js` | Go body compiled by the normal pipeline, plus registered natives in `src/backend/wasm/natives.js` |

Signatures are written once as real Go, so the signature gate compares Go with Go and drift for migrated packages is impossible by construction.

**`//gofront:native <name>` (new in this release).** A directive on a function **with a Go body**:

```go
//gofront:native strings.Index
func Index(s, substr string) int { /* Go body: the specification */ }
```

- `<name>` must exist in the backend's native registry (`unknown native 'x'` otherwise); the registry is compiler-owned and closed, like `INTRINSICS` in [`types.js`](../../src/typechecker/types.js). This plan is the "plan change" that v1.8.0 requires for new intrinsics.
- At a **call site**, the backend asks the registry for a template: JS returns an expression string from the argument strings and the instantiated type arguments (for example `` `${s}.indexOf(${sub})` ``); WASM returns an emitter or a host-import call. A template may **decline** (return `null`) for an instantiation it does not cover, for example `slices.Sort` of `float64`; the Go body is then called.
- A native used as a **value** (`f := strings.Index`, `defer`, a method value) always calls the Go body, so a native never has to exist as a standalone function.
- The Go body is always compiled when reachable, so removing a native never breaks a program. The body is the specification: the conformance harness runs every fixture with natives off ([Test & Conformance Plan](#test--conformance-plan)).
- This differs from `//gofront:intrinsic` (v1.8.0), which is body-less and closed to one function. Intrinsics stay for host services that have no Go body (the `context` deadline timer).

**Generic core types.** `slices` and `maps` use Go's real signatures (`func Sort[S ~[]E, E cmp.Ordered](x S)`). The checker gains the notion of a type parameter's **core type** (the single underlying type of its constraint's type set) and uses it for index, slice, `range`, `len`, `cap`, `append`, `make`, `copy` and conversion. Inference unifies `S` with the argument type and `E` with its element, so a named slice argument returns the named type. WASM monomorphisation substitutes the concrete named type.

**`sort` and `slices` order.** Go's pattern-defeating quicksort exists in four variants (`sort.Interface`, `sort` with a `lessSwap`, `slices` ordered, `slices` with a comparison function). Go generates them from one template. GoFront does the same with `scripts/gen-pdq.js`, which writes four checked-in files marked `// Code generated`. The algorithm is a verbatim port (including the xorshift pivot seeded from the length), so equal elements land in the same order as in Go. Go's source is BSD-3-Clause; the generated files keep its notice.

**Lazy body checking.** Today the checker verifies every function body of every imported Go-source package. With an estimated 9,000 lines of Go behind `slices`, `strings`, `bytes`, `sort`, `io` and `time`, that costs tens of milliseconds per build (P10). The checker verifies **declarations** (types, signatures, package vars, constants) of a Go-source package eagerly and **function bodies on demand**, when a call from checked code, a method of a used type, or an interface satisfaction check reaches them. Diagnostics inside a stdlib body are still reported at the user's call site (v1.8.0 Task 0.6c). The existing reachability pass (Task 0.7) then sees only what was checked.

**Package-by-package migration order.** Each package moves in one phase: write or finish the Go, register natives, run the four-way conformance fixture, delete the typing, the shim and the emitter, unwind the name coupling listed in [Verified Gaps](#verified-gaps--baseline-audit). A package is not half-moved: either all its members come from Go (with natives) or none.

**Rejected alternatives:**
- **Move everything to Go with no natives.** The string-search probe is 300× slower in WASM, and the ordered-sort probe is 3.9× slower in JS.
- **Keep emitters and only generate the type tables from Go's `api/*.txt`.** Fixes the 163 signature mismatches but leaves the quadratic sorts, the `NaN` bug and 21,000 lines of hand-written WASM.
- **A user-facing native/FFI mechanism.** That is a language feature with its own safety questions; natives stay a closed compiler registry.
- **Check Go-source bodies at build time and cache the result.** A cache invalidates on any compiler change and does not help `gofront test` or CI; lazy checking is cheaper and simpler.

### 2. Invariants & Safety Bounds

- **Go is the specification.** For every native, the Go body and the native give identical results on the conformance corpus, on both backends. CI runs both.
- **Natives never change semantics for programs that do not decline.** A template either reproduces Go's behaviour for the instantiation it accepts or declines.
- **Stdlib dependency direction.** A Go-source stdlib package imports only other stdlib packages (migrated or emitter-backed) and never a user package; `cmp`, `iter`, `errors`, `io` and `unicode/utf8` form the base layer. The resolver rejects cycles in `runtime/stdlib/`.
- **Unused imports cost nothing.** Reachability from v1.8.0 still applies: 0 bytes in `app.js` and dev-mode `app.wasm`.
- **No new boundary types.** `time.Time` and `time.Duration` keep their names, field layout and boundary conversion; exported Go-source types follow the ordinary struct rules.
- **JS output of natives matches today's.** Built `example/` outputs are diffed before and after each phase; differences are limited to the listed behaviour fixes.
- **Performance gates are measured, not assumed.** The raycast and zero-allocation benchmarks (`npm run bench`, `test/e2e/perf/zero-alloc.js`) stay within their v1.8.0 bounds after every phase.
- **No new runtime dependencies.** The generator script is plain Node.

### 3. Edge Cases & Error Handling

**Natives**
- A native declined for an instantiation (`slices.Sort[float64]`, a named element type, a struct element) calls the Go body with no diagnostic.
- Function values, method values, `defer` and arguments evaluated in a different order than the template emits all go through the Go body or evaluate arguments exactly once, in order. A template that repeats an argument must bind it to a temporary first.
- Natives in a `both` package use strict numeric semantics in the JS copy, like any other code there.
- A native named in `runtime/stdlib/` but missing from a backend registry is a compiler self-test failure, not a user error.

**Behaviour fixes (user-visible, recorded in the CHANGELOG)**
- `slices.Sort`, `slices.SortFunc`, `sort.Float64s`, `sort.Slice`, `sort.Sort` order `NaN` and break ties exactly like Go; programs that depended on the previous stable tie order change output.
- WASM sorts are O(n log n).
- Results of `slices.Insert`, `Delete`, `Clone`, `Compact` and `Grow` keep a named slice type (`S`) as Go does.

**Migration hazards**
- `fmt.Errorf("%w")` wrapping is built by the `fmt` emitter. `errors.Is`/`Unwrap` in Go call the `Unwrap() error` method, so the emitter's wrapper type must expose that method on both backends; a fixture covers `%w` chains and multiple `%w`.
- `errors.As` stays an emitter member: it tests the dynamic type of `*target`, which Go source cannot express.
- `io.Writer` becomes a real Go interface. `fmt.Fprint*(w, …)` currently dispatches on the argument's concrete emitter type; after Phase 6 it calls `w.Write`, with `os.Stdout`/`os.Stderr` (v1.8.0 Task 3.1e) and `strings.Builder` implementing it.
- `bytes.Buffer`, `strings.Reader` and `time.Time` are used by value and by pointer across the boundary and in interfaces; fixtures cover copy semantics, `io.Reader`/`io.Writer` satisfaction, embedding and use as map values.
- `sha256` is used by `io.Copy` through `hash.Hash`; the digest object is a Go struct with `Write`, `Sum`, `Reset`, `Size`, `BlockSize`.
- `math/rand` seeding: top-level functions keep drawing from the host random source; `rand.New(rand.NewSource(seed))` must give Go's exact sequence only if v1.8.0 documents that guarantee (it does not today); the plan keeps today's behaviour and records it.
- Large generated Go (pdqsort) in JS output uses strict numeric helpers only inside `both` packages; the JS copy of a `js` caller uses plain operators.
- Recursion depth: Go's pdqsort recurses O(log n); the JS and WASM stacks are not at risk at 10⁶ elements.

**Compile time**
- A diagnostic raised while lazily checking a stdlib body is reported once, at the user's call site, with the `internal stdlib error in <path>; please report` note.
- Body checking order must not change which diagnostics a user program reports.

### 4. Relationship to v1.8.0 and v2.0.0

- **Patch policy.** [v1.8.0](../v1.8.0/portable-go-plan.md) and [v2.0.0](../v2.0.0/native-go-engine.md) say v1.8.x releases are bug fixes only. This release is justified as a bug-fix release (quadratic WASM sorts, wrong `NaN` and tie order, 163 wrong signatures) whose fix is a structural change. **This needs the project owner's agreement before Phase 3 starts**; Phases 1 and 2 add compiler capabilities with no stdlib behaviour change and are safe either way.
- **Unfinished v1.8.0 member tasks.** Tasks 2.2/2.3 (`slices`/`maps` iterator members, already Go overlays), 3.2 (`sort`, Go), 3.3a–3.3c, 3.4a–3.4c (these edit emitters), 3.5 and 3.7 add members to packages this plan migrates. Members written as Go overlays are absorbed by the matching phase here. Members written as emitters (3.3c, 3.4a, 3.4b, 3.4c, parts of 3.7) are rework: **write them as Go overlays in v1.8.0 where a native is not needed**, so this release only deletes code.
- **v2.0.0 baseline.** The native engine ports the compiler core plus the *remaining* emitters; migrated packages are embedded `.go` files. Task 9.3 updates the v2.0.0 plan's "ported stdlib" list and its 22k-line estimate. The natives registry becomes a table the native engine ports (an estimated 60 small templates instead of ≈ 21,000 lines).

---

## Implementation Tasks

Execution follows [v1.8.0 → How to execute a task](../v1.8.0/portable-go-plan.md#how-to-execute-a-task): failing test first, one task per commit (`feat(<scope>): <summary> (Task N.M)`), `npm run check` before each, ticking the box here. 1 phase = 1 branch (`feat/stdlib-go-phase-<N>`), 1 PR into `feat/stdlib-go`, 1 two-pass review. Phase budget: 3–5 tasks and ≈ 150–500 net lines of **hand-written** source (compiler JS and Go stdlib); generated files and deletions do not count. Phases 1–2 are prerequisites. Phases 3–8 are independent of each other once those two are done; Phase 9 closes.

### Phase 1: Generic core types

- [ ] **Task 1.1 — Core type of a constrained type parameter in expressions**
  - Files: `src/typechecker/types.js` (`coreType`), `src/typechecker/expressions.js`, `src/typechecker/statements.js` (`range`)
  - Do: for a type parameter whose constraint has one underlying type (`~[]E`, `~map[K]V`), use that type for index, slice, `range`, `len`, `cap`, `append`, `copy`, `make(S, n)` and composite-literal checks. A constraint with several underlying types still reports `Cannot index type S`.
  - Test: `test/unit/types/generics.test.js` — `First`, `Tail`, `Len`, `make(S, n)` over `[S ~[]E, E any]` and `[M ~map[K]V, K comparable, V any]`; negative: `[T int | string]` indexing keeps its message.
  - Done when: the P1b probes `index S~[]E` and `slice S~[]E` compile and run on `both` and `wasm`.

- [ ] **Task 1.2 — Conversions and inference through core types**
  - Files: `src/typechecker/expressions.js`, `src/typechecker/resolve.js` (unification)
  - Do: `S(nil)` and `S(x)` convert to a type parameter whose core type accepts `x`; inference unifies `S` with an argument's type (named or unnamed) and derives `E`/`K`/`V` from its core type; a call returning `S` has the argument's named type.
  - Test: `generics.test.js` — `Z[S ~[]E, E any](s S) S { return S(nil) }`, `Len(map[string]int{…})`, `Id(IDs{…}).Len()` with a method on `IDs`.
  - Done when: P1b `conversion S(nil)` and `map M~map[K]V` pass on both backends, and `Cannot infer type arguments` no longer appears for them.

- [ ] **Task 1.3 — WASM: valid modules for named slice and map arguments**
  - Files: `src/backend/wasm/monomorph.js`, `src/backend/wasm/types.js`
  - Do: substitute the concrete named type for `S`/`M` when a generic body is copied, so locals, parameters and results of `S` use the named type's representation (the P1c module failed with `ref null 21` vs `ref null 52`).
  - Test: `test/unit/wasm/generics.test.js` — P1c `Contains(IDs{…}, 2)`, a function returning `S` with methods called on the result, `map` core types; all as parity tests.
  - Done when: P1c produces a valid module and the same output as JS.

- [ ] **Task 1.4 — JS zero values for core-typed parameters and parity rows**
  - Files: `src/backend/js/expressions.js` (`S(nil)`, zero factory for `S`), `docs/language-support.md` (fixture rows)
  - Do: the zero-value factories from Task 0.18 cover type parameters with a core type; add `language-support.md` rows with `<!-- fixture: … -->` comments for each pattern above so the parity matrix guards them.
  - Test: `test/unit/language/parity-matrix.test.js` picks up the new rows; `generics.test.js` — `var zero S`, `S(nil)`, `append(S(nil), s...)`.
  - Done when: the matrix passes with the new rows on `both`.

### Phase 2: Natives, differential testing and lazy checking

- [ ] **Task 2.1 — `//gofront:native` directive and registries**
  - Files: `src/lexer.js`, `src/parser/declarations.js`, `src/typechecker/index.js`, new `src/backend/js/natives.js`, new `src/backend/wasm/natives.js`
  - Do: parse `//gofront:native <name>` before a func **with a body**, as `//gofront:intrinsic` is parsed; the checker rejects an unknown name (`unknown native 'x'`), a native on a body-less func, and any use outside `runtime/stdlib/` (`//gofront:native is reserved for the standard library`). The registries start empty.
  - Test: `test/unit/compiler/stdlib-go.test.js` — each of the three diagnostics via a temp-dir stdlib root; a valid directive compiles with an empty registry entry for a test-only name.
  - Done when: the four tests pass.

- [ ] **Task 2.2 — JS call-site substitution with decline and value fallback**
  - Files: `src/backend/js/expressions.js`, `src/backend/js/natives.js`
  - Do: at a call whose callee carries a native, ask the registry for a template with the argument expressions and instantiated type arguments; emit it when it returns a string, else call the Go function. A native used as a value, `defer` target or method value calls the Go function. Arguments used twice by a template are bound to a temporary.
  - Test: `stdlib-go.test.js` — a test-only native `str.Index` emits `.indexOf(`; `f := str.Index; f(a, b)` emits a call of the Go body; a template that declines for `float64` emits the Go call; `str.Index(next(), next())` evaluates each argument once, in order.
  - Done when: all four assertions pass on the generated JS.

- [ ] **Task 2.3 — WASM call-site substitution**
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/natives.js`
  - Do: the same contract for WASM: a registered emitter pushes instructions or a host-import call and returns `true`, or returns `false` to decline. The Go body is always emitted when reachable.
  - Test: `test/unit/wasm/stdlib.test.js` — a test-only native that calls an import; the same decline and value-fallback cases as Task 2.2, as parity tests against the Go body.
  - Done when: native-on and native-off WASM modules give the same results on the test fixtures.

- [ ] **Task 2.4 — Natives-off mode, four-way conformance, pinned Go toolchain**
  - Files: `src/compiler.js` (`natives` option), `src/cli-core.js` (`--no-natives`, debugging only), `test/conformance/run.js`, `test/conformance/update.js`
  - Do: `natives: false` makes every backend ignore the registries. The conformance runner compares JS, JS natives-off, WASM and WASM natives-off with `<name>.out`, naming the failing configuration. `update.js` reads `GOFRONT_GO` (default `go`) so a pinned `go1.26.x` binary works when the default `go` is newer.
  - Test: `test/unit/compiler/conformance.test.js` — a fixture whose test-only native disagrees with its Go body fails and names `js (natives on)`; `GOFRONT_GO` pointing at a stub reporting `go1.27` is rejected with the install hint.
  - Done when: the bootstrap fixtures pass in four configurations and the stub tests pass.

- [ ] **Task 2.5 — Lazy body checking for Go-source packages**
  - Files: `src/typechecker/index.js`, `src/compiler.js` (`checkStdlibPrograms`), `src/lower/reachability.js`
  - Do: check declarations of a Go-source package eagerly and function and method bodies when first reached (call, used type's method, interface satisfaction); report stdlib body errors at the user's call site. Expose `checker.stats.bodiesChecked` for tests.
  - Test: `stdlib-go.test.js` — a synthetic 5,600-line Go-source package of which the program calls one function checks ≤ 10 bodies; a type error in an unreached body is not reported; the same error in a reached body is reported at the call site with the `internal stdlib error` note; user-visible diagnostics for existing packages are unchanged.
  - Done when: the synthetic import type-checks in ≤ 5 ms more than without the import (recorded in [Performance and size](#performance-and-size)).

### Phase 3: `sort` and `slices`

- [ ] **Task 3.1 — pdqsort variant generator**
  - Files: new `scripts/gen-pdq.js`, new `scripts/pdq-template.txt`, generated `runtime/stdlib/sort/zsort_iface.go`, `zsort_func.go`, `runtime/stdlib/slices/zsort_ordered.go`, `zsort_cmp.go`, `package.json` (`gen:pdq`, checked by `npm run check`)
  - Do: one template with the four substitutions Go's `gen_sort_variants` uses; keep Go's BSD notice. `npm run check` fails when the generated files are stale.
  - Test: `test/unit/compiler/manifest.test.js`  — regenerating is a no-op; fixture `test/conformance/sort/ties.go` prints the order of equal-key elements for n = 5, 13, 40, 1000 and matches Go.
  - Done when: the tie-order fixture matches Go on all four configurations.

- [ ] **Task 3.2 — `slices` (non-sorting members) in Go**
  - Files: `runtime/stdlib/slices/slices.go`, `src/backend/js/natives.js` (`slices.Contains`, `Index`, `Reverse`, `Clone` for primitive `E`), `src/backend/js/stdlib/slices.js`, `src/backend/wasm/stdlib/core.js` (delete `emitSlices*` non-sort), `src/typechecker/stdlib/extended.js`
  - Do: every existing `slices` member except the sort/search family, with Go's signatures (`S ~[]E`). JS natives keep today's `includes`/`indexOf` output; WASM uses the Go body. Remove the typings, the shim bodies and the WASM emitters for these members.
  - Test: conformance `test/conformance/slices/members.go` (Insert/Delete/Compact/Concat/Clip/Grow/Equal/Compare/Min/Max with named slice types, empty and nil slices) in four configurations; `test/unit/types/stdlib-coverage.test.js` shows the `slices` signature mismatches for these members gone.
  - Done when: fixture matches Go; built `example/` JS differs only where a native's text differs (diff recorded).

- [ ] **Task 3.3 — `slices` sort and search family in Go**
  - Files: `runtime/stdlib/slices/sort.go`, `src/backend/js/natives.js` (`slices.Sort` for `int`/`string`), `src/backend/js/stdlib/slices.js`, `src/backend/wasm/stdlib/core.js` (delete `emitSlicesSort*`, `BinarySearch*`, `IsSorted*`, `MinMax*`)
  - Do: `Sort`, `SortFunc`, `SortStableFunc`, `IsSorted*`, `BinarySearch*`, `Min*`, `Max*` over the generated pdqsort; `Sort` of floats orders `NaN` first via `cmp.Less`. The JS native for `Sort` accepts only integer and string element types and declines otherwise.
  - Test: conformance `slices/sort.go` (NaN, ±0, ties via `SortFunc`, stability of `SortStableFunc`, large n); `test/unit/wasm/slices.test.js` — a comparison-counting `SortFunc` on 20,000 elements makes ≤ 400,000 calls (O(n log n)); `test/e2e/perf` records the 200,000-int WASM sort.
  - Done when: fixtures match Go; the 200,000-int WASM sort runs in ≤ 100 ms; JS `SortFunc` is within 1.5× of `Array.prototype.sort` with a comparator.

- [ ] **Task 3.4 — `sort` in Go**
  - Files: `runtime/stdlib/sort/sort.go`, `src/backend/js/natives.js` (`sort.Ints`, `sort.Strings`), `src/backend/js/stdlib/sort.js`, `src/backend/wasm/stdlib/core.js` (delete `emitSort*`), `src/typechecker/stdlib/core.js`
  - Do: the whole `sort` package: `Ints`, `Strings`, `Float64s`, `Slice`, `SliceStable`, `Sort`, `Stable`, `Reverse`, `Search*`, `IntSlice`/`StringSlice`/`Float64Slice`, `IsSorted`, `Find`, `SliceIsSorted` (this absorbs v1.8.0 Task 3.2).
  - Test: conformance `sort/sort.go` and `sort/ties.go` from Task 3.1 across all four configurations; `stdlib-coverage` reports no `sort` mismatches.
  - Done when: fixtures match Go and `sort.Slice`'s tie order equals Go's.

### Phase 4: `maps`, `errors`, `unicode/utf8`, `path`, `html`

- [ ] **Task 4.1 — `maps` in Go**
  - Files: `runtime/stdlib/maps/maps.go`, `src/backend/js/stdlib/maps.js`, `src/backend/wasm/stdlib/core.js` (delete `emitMaps*`), `src/typechecker/stdlib/extended.js`, `src/typechecker/expressions.js` (remove `_derivedReturn`)
  - Do: `Clone`, `Copy`, `Equal`, `EqualFunc`, `DeleteFunc`, and the iterator forms (`All`, `Keys`, `Values`, `Insert`, `Collect`) with `M ~map[K]V`. Map iteration order is unchanged from today.
  - Test: conformance `maps/members.go` (sorted output, `NaN` keys kept once each); `stdlib-coverage` shows `maps` signatures match.
  - Done when: fixture matches Go in four configurations and `_derivedReturn` is gone.

- [ ] **Task 4.2 — `errors` in Go, `As` stays an emitter member**
  - Files: `runtime/stdlib/errors/errors.go` (absorbs `overlay.go`), `src/backend/js/stdlib/errors.js`, `src/backend/wasm/stdlib/core.js` (delete `emitErrorsCall` except `As`), `src/typechecker/stdlib/core.js` (keep only `As`)
  - Do: `New`, `Is`, `Unwrap`, `Join`, `ErrUnsupported` in Go. `errors` remains an overlay on the emitter namespace (the v1.8.0 mechanism) with `As` as its only emitter member, because it tests the dynamic type of `*target`, which Go source cannot express; the manifest records it as `emitter`. The `fmt.Errorf("%w")` wrapper exposes `Unwrap() error` so Go's `Is` and `Unwrap` see it.
  - Test: conformance `errors/wrap.go` (`%w`, multiple `%w`, `Join`, `Is` with `Is(error) bool` methods, `As` on pointer and value targets) in four configurations.
  - Done when: fixture matches Go and `errors.Is(err, strconv.ErrRange)`-style cases pass.

- [ ] **Task 4.3 — `unicode/utf8` in Go**
  - Files: `runtime/stdlib/unicode/utf8/utf8.go`, `src/backend/js/natives.js` (`RuneCountInString`), `src/backend/js/stdlib/utf8.js`, `src/backend/wasm/stdlib/core.js` (`emitUtf8Call`), `src/typechecker/stdlib/core.js`
  - Do: the whole package over `[]byte` (this absorbs v1.8.0 Task 3.3b's utf8 part), with Go's constants and signatures (`RuneError` and `UTFMax` untyped).
  - Test: conformance `utf8/bytes.go` (invalid sequences, surrogates, `FullRune`, `DecodeLastRune`) in four configurations.
  - Done when: fixture matches Go and `unicode/utf8` has no signature mismatch.

- [ ] **Task 4.4 — `path`, `path/filepath` and `html` in Go**
  - Files: `runtime/stdlib/path/path.go`, `runtime/stdlib/path/filepath/filepath.go`, `runtime/stdlib/html/html.go`, `src/backend/js/stdlib/{path,html}.js`, `src/backend/wasm/stdlib/pure.js`
  - Do: `Join`, `Clean`, `Base`, `Dir`, `Ext`, `Split`, `IsAbs`, `Match`; `EscapeString`/`UnescapeString` with Go's entity table subset documented. Delete the emitters and typings.
  - Test: conformance `path/path.go`, `html/escape.go`.
  - Done when: fixtures match Go and `pure.js` keeps only `unicode` and `rand`.

### Phase 5: `bytes`

- [ ] **Task 5.1 — `bytes` functions in Go with typed-array natives**
  - Files: `runtime/stdlib/bytes/bytes.go`, `src/backend/js/natives.js` (`IndexByte`, `Equal`, `Compare`), `src/backend/js/stdlib/bytes.js`, `src/backend/wasm/stdlib/bytes.js` (delete `emitBytesCall` and `_emitBytes*`)
  - Do: every existing `bytes` function with Go's signatures (`ContainsRune`, `IndexByte`, `Map`, `FieldsFunc`, `TrimFunc` get their `rune`/`byte` types), absorbing the v1.8.0 Task 3.4c `bytes` functions.
  - Test: conformance `bytes/functions.go` in four configurations; `test/unit/builtins/bytes.test.js` runs unchanged.
  - Done when: fixture matches Go and `bytes` function signatures match.

- [ ] **Task 5.2 — `bytes.Buffer` in Go**
  - Files: `runtime/stdlib/bytes/buffer.go`, `src/backend/js/stdlib/bytes.js`, `src/backend/wasm/stdlib/bytes.js` (`emitBytesBufferMethodCall`), `src/backend/js/expressions.js`, `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/index.js` (12 `bytes.Buffer` sites)
  - Do: `Buffer` with `Write*`, `Read*`, `Bytes`, `String`, `Len`, `Cap`, `Grow`, `Truncate`, `Reset`, `Next`, `ReadFrom`, `WriteTo`, `UnreadByte`, `UnreadRune`, `NewBuffer`, `NewBufferString`; remove the special cases in the backends; `fmt.Fprint*` into a `Buffer` goes through `io.Writer` (Task 6.1).
  - Test: conformance `bytes/buffer.go`; `test/unit/builtins/bytes.test.js` value-copy, pointer, interface and map-value cases; a module-size assertion: a program using `Buffer` is ≤ 4,500 bytes of dev `app.wasm` (P8: 6,957 → 3,293).
  - Done when: both pass and `bytes.js` in the WASM stdlib directory is gone.

- [ ] **Task 5.3 — Remove dead `bytes` internals and `bytes.Reader` coupling**
  - Files: `src/backend/wasm/stdlib/io.js` (bytes reader helpers), `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/index.js`
  - Do: delete helpers that only `bytes.js` used; make `bytes.NewReader` return a Go `Reader` (type moves with Task 6.2; until then it is the only emitter type left in `bytes`).
  - Test: `npm run check` on `example/...` and `test/unit/wasm/stdlib.test.js` unchanged.
  - Done when: `grep -rn "bytes\.Buffer" src --include='*.js'` finds only comments.

### Phase 6: `io` and `strings`

- [ ] **Task 6.1 — `io` in Go**
  - Files: `runtime/stdlib/io/io.go`, `src/backend/js/stdlib/io.js`, `src/backend/wasm/stdlib/io.js` (`emitIo*`, `_emitIoCopy*`, `_emitIoReadAll`), `src/backend/wasm/index.js` (`io.Writer`/`io.Reader` sites), `src/typechecker/stdlib/core.js`
  - Do: `Reader`, `Writer`, `Closer`, `Seeker` and the composites, `EOF`, `ErrUnexpectedEOF`, `ErrShortWrite`, `Discard`, `Copy`, `CopyN`, `CopyBuffer`, `ReadAll`, `ReadFull`, `ReadAtLeast`, `WriteString`, `LimitReader`/`LimitedReader`, `MultiReader`, `MultiWriter`, `TeeReader`, `NopCloser`, `SectionReader`; `fmt.Fprint*` and `Sscan` stay emitters but call `w.Write` through the interface (absorbs v1.8.0 Task 3.3a).
  - Test: conformance `io/io.go` and `fmt/fprint.go` (`Fprintf` into `Buffer`, `Builder`, `os.Stdout`, a user `Writer`) in four configurations.
  - Done when: fixtures match Go and `fmt.Fprintf(w, …)` type-checks against `io.Writer`.

- [ ] **Task 6.2 — `strings.Reader` and `bytes.Reader` in Go**
  - Files: `runtime/stdlib/strings/reader.go`, `runtime/stdlib/bytes/reader.go`, `src/backend/wasm/stdlib/io.js`, `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/index.js` (9 + 9 sites)
  - Do: `NewReader`, `Read`, `ReadByte`, `UnreadByte`, `ReadRune`, `UnreadRune`, `Len`, `Size`, `Reset`, `Seek`, `ReadAt`, `WriteTo`.
  - Test: conformance `strings/reader.go`, `bytes/reader.go`; `io.ReadAll` over each.
  - Done when: fixtures match Go and the reader special cases are gone from the backends.

- [ ] **Task 6.3 — `strings` functions: Go bodies with host natives**
  - Files: `runtime/stdlib/strings/strings.go`, `src/backend/js/natives.js`, `src/backend/wasm/natives.js` (host-import calls for `Index`, `Contains`, `HasPrefix`, `ToUpper`, … — the same imports the emitters use today), `src/backend/js/stdlib/strings.js`, `src/backend/wasm/stdlib/core.js` (delete `emitStrings*` except natives)
  - Do: all `strings` functions with Go's `rune`/`byte` types; each function with a host primitive gets a native whose template reproduces today's output; the rest (`FieldsFunc`, `TrimFunc`, `Map`, `IndexFunc`, `Title`, `Fields`, `EqualFold`, …) run as Go over `[]byte`/`[]rune`, following [v1.8.0 §1.1](../v1.8.0/portable-go-plan.md#11-string-semantics-both-backends). Absorbs v1.8.0 Tasks 2.4 and 3.4c's `strings` members.
  - Test: conformance `strings/functions.go` (ASCII only, per the harness lint) in four configurations; `test/e2e/perf` records `strings.Index` on 1 MB: WASM with natives within 2× of v1.8.0 (0.9 ms/20 calls baseline), natives-off result equal but not timed.
  - Done when: fixtures match Go; the string-search benchmark is within the bound.

- [ ] **Task 6.4 — `strings.Replacer` in Go**
  - Files: `runtime/stdlib/strings/replacer.go`, `src/backend/js/expressions.js`, `src/backend/wasm/emit-builtins.js` (4 sites), `src/backend/wasm/stdlib/core.js` (`emitReplacerMethodCall`, `emitStringsNewReplacer`)
  - Do: `NewReplacer`, `Replace`, `WriteString` with Go's generic algorithm (first-match, argument order).
  - Test: conformance `strings/replacer.go` (overlapping old strings, empty old string, `WriteString` into a `Buffer`).
  - Done when: fixture matches Go and `strings.Builder` is the only emitter type left in `strings`.

### Phase 7: encodings, `sha256`, `bits`, `rand`, `sync`

- [ ] **Task 7.1 — `encoding/hex` and `encoding/base64` in Go**
  - Files: `runtime/stdlib/encoding/hex/hex.go`, `runtime/stdlib/encoding/base64/base64.go`, `src/backend/js/stdlib/{hex,base64}.js`, `src/backend/wasm/stdlib/packages.js` (`emitHexCall`, `emitBase64*`)
  - Do: Go's full APIs (`*Encoding`, `NewEncoding`, `WithPadding`, `Strict`, `Append*`, `NewEncoder`/`NewDecoder`, `Dump`), index `[]byte` per §1.1; `StdEncoding`, `URLEncoding`, `RawStdEncoding`, `RawURLEncoding` become package vars of type `*Encoding`.
  - Test: conformance `hex/codec.go`, `base64/codec.go` (invalid input errors with Go's messages) in four configurations.
  - Done when: fixtures match Go and the 8 `base64` signature mismatches are gone.

- [ ] **Task 7.2 — `encoding/binary` (ByteOrder) and `crypto/sha256` in Go**
  - Files: `runtime/stdlib/encoding/binary/binary.go`, `runtime/stdlib/crypto/sha256/sha256.go`, `src/backend/js/stdlib/{binary,sha256}.js`, `src/backend/wasm/stdlib/packages.js`, `src/backend/wasm/stdlib/io.js` (sha256 write cores), `src/backend/wasm/boundary.js` (14 `sha256` sites)
  - Do: `ByteOrder` implementations with `Uint*`/`PutUint*`/`Append*`, varints, `MaxVarintLen*`; `Read`/`Write` stay native (they take `any` and walk fields). `sha256` `Sum256`, `New`, `Sum224`, `New224` as a Go digest satisfying `hash.Hash`.
  - Test: conformance `binary/order.go`, `crypto/sha256.go` (FIPS vectors, `io.Copy` into the hash, `Reset`).
  - Done when: fixtures match Go and `sha256.go` special cases are removed from the backends.

- [ ] **Task 7.3 — `math/bits` and `math/rand` in Go**
  - Files: `runtime/stdlib/math/bits/bits.go`, `runtime/stdlib/math/rand/rand.go`, `src/backend/js/natives.js` (`bits.Len*`, `LeadingZeros*`, `OnesCount*`, `rand.Float64`), `src/backend/js/stdlib/{bits,rand}.js`, `src/backend/wasm/stdlib/core.js` (`emitBitsCall`), `src/backend/wasm/stdlib/pure.js` (rand)
  - Do: every existing member with Go's signatures (`uint` vs `uint64`, `rune`); rand's top-level functions call a single `//gofront:intrinsic rand_source` for host entropy and implement `Intn`, `Perm`, `Shuffle`, `Rand`/`NewSource` in Go. Absorbs the v1.8.0 `bits.Add64`/`Mul64` members.
  - Test: conformance `bits/wide.go`; `test/unit/wasm/stdlib.test.js` rand distribution checks (range, `Perm` is a permutation, `Shuffle` keeps the multiset).
  - Done when: fixtures match Go, and the zero-alloc and raycast benches are unchanged.

- [ ] **Task 7.4 — `sync` in Go**
  - Files: `runtime/stdlib/sync/sync.go`, `src/backend/js/stdlib/sync.js`, `src/backend/wasm/stdlib/packages.js` (`emitSync*`)
  - Do: `Mutex`, `RWMutex`, `Once`, `WaitGroup` as single-threaded Go structs (absorbs v1.8.0 Task 3.5's `Map`, `Pool`, `OnceFunc/Value/Values`); `Mutex.Unlock` of an unlocked mutex panics with Go's message.
  - Test: conformance `sync/sync.go`; `sync.Mutex` as a struct field copied by value keeps `go vet`-style behaviour (documented, not diagnosed).
  - Done when: fixture matches Go in four configurations.

### Phase 8: `time` and `strconv`

- [ ] **Task 8.1 — `time` core: `Duration`, `Month`, `Weekday`, civil dates**
  - Files: `runtime/stdlib/time/time.go`, `runtime/stdlib/time/duration.go`, `src/backend/js/stdlib/time.js`, `src/backend/wasm/stdlib/time.js` (civil-day helpers, `emitDurationMethodCall`), `src/typechecker/stdlib/core.js` (`DURATION_T`, `TIME_T`)
  - Do: `Duration` and its methods and constants, `Month`/`Weekday` as named `int` types with `String`, `Time` with the existing field layout (`unixNano int64`, `offset int32`), `Date`, `Unix`, `Add`, `Sub`, `AddDate`, `Truncate`, `Round`, `YearDay`, `ISOWeek`, `Compare`, `FixedZone`, `UTC`; `Now`/`Since`/`Until` and the local zone offset stay natives (`//gofront:native time.Now`) over the existing clock import. Absorbs v1.8.0 Task 3.4b's arithmetic members.
  - Test: conformance `time/members.go` (fixed dates, DST-free zones, leap years, ISO week edges) in four configurations; `test/unit/builtins/stdlib.test.js` time tests unchanged.
  - Done when: fixture matches Go and `Month`/`Weekday` are no longer `int` in the signature gate.

- [ ] **Task 8.2 — `time` layouts: `Format`, `Parse`, `ParseDuration`, JSON**
  - Files: `runtime/stdlib/time/format.go`, `runtime/stdlib/time/parse.go`, `src/backend/wasm/stdlib/time.js` (`_emitTimeMethodFormat`, `_emitTimeParse`), `src/backend/js/stdlib/time.js`
  - Do: Go's layout engine for the supported layouts and constants (`RFC3339`, `Kitchen`, …), `ParseError` with Go's messages, `ParseDuration`, `MarshalJSON`/`UnmarshalJSON`/`MarshalText`/`UnmarshalText` (absorbs v1.8.0 Task 3.4b's layout members).
  - Test: conformance `time/layout.go` (all constants, 12-hour clocks, fractional seconds, parse errors).
  - Done when: fixture matches Go and `time.js` in the WASM stdlib directory holds only clock natives.

- [ ] **Task 8.3 — `time` at the boundary and in the backends**
  - Files: `src/backend/wasm/boundary.js` (10 `time.Time` + 5 `time.Duration` sites), `src/backend/js/expressions.js`, `src/backend/wasm/emit-builtins.js`, `src/typechecker/assignability.js`
  - Do: unwind the name-based special cases so `time.Time`/`Duration` follow ordinary struct and named-type rules except for the documented JS `Date` conversion; keep the boundary representation unchanged.
  - Test: `test/unit/wasm/boundary.test.js` — `time.Time`/`Duration` parameters, results and struct fields cross as before; a `both` package round-trips a `Time`.
  - Done when: boundary tests pass unchanged and `grep -rn "time\.Time" src --include='*.js'` finds only the boundary conversion.

- [ ] **Task 8.4 — `strconv` in Go with float natives**
  - Files: `runtime/stdlib/strconv/strconv.go`, `runtime/stdlib/strconv/quote.go`, `src/backend/js/natives.js`/`wasm/natives.js` (`FormatFloat`, `ParseFloat`, `AppendFloat`), `src/backend/js/stdlib/strconv.js`, `src/backend/wasm/stdlib/core.js` (`emitStrconvCall`)
  - Do: `Itoa`, `Atoi`, `ParseInt` (returning `int64`), `ParseUint`, `ParseBool`, `FormatInt`, `FormatUint`, `Quote*`, `Unquote*`, `NumError`, `ErrRange`/`ErrSyntax` in Go (absorbs v1.8.0 Task 3.3c); float formatting and parsing remain natives because shortest-representation needs the host's number printer.
  - Test: conformance `strconv/errors.go`, `strconv/quote.go`, `strconv/float.go` (round trips, `'g'`/`'e'`/`'f'`, bit sizes 32 and 64) in four configurations; `fmt/basic.go` unchanged.
  - Done when: fixtures match Go and `strconv` has no signature mismatch.

### Phase 9: Typings removal, manifest and documentation

- [ ] **Task 9.1 — Manifest `implementation` field and gate**
  - Files: `scripts/stdlib-manifest.js`, `runtime/stdlib/manifest.json`, `test/unit/types/stdlib-coverage.test.js`, `test/unit/compiler/manifest.test.js`
  - Do: record `implementation: source | native | emitter` per member (derived from the tree: a Go declaration, a Go declaration carrying `//gofront:native`, or an emitter-backed namespace member); the gate requires every `source`/`native` member's signature to equal Go's, and requires every `native` member to have registry entries in both backends (or a documented single-target exception).
  - Test: `manifest.test.js` — the field is present on every entry and regeneration is a no-op; the gate fails if a native loses its registry entry.
  - Done when: both pass and the signature-mismatch count for `source`/`native` members is 0.

- [ ] **Task 9.2 — Delete leftover typings and shrink the registries**
  - Files: `src/typechecker/stdlib/core.js`, `src/typechecker/stdlib/extended.js`, `src/typechecker/types.js` (`STDLIB_PACKAGES`, `WASM_STDLIB_MEMBERS`, `WASM_SUPPORTED_STDLIB`), `src/backend/js/stdlib/index.js`, `src/backend/wasm/stdlib/index.js`
  - Do: remove every migrated package from the registries and dispatch tables; keep only `fmt`, `json`, `regexp`, `os`, `testing`, `math`, `gom`, `shared`, `simd`, `crypto/rand` and the remaining emitter members; run `wc -l` and record the sizes.
  - Test: `npm test`, `npm run check`, `npm run test:e2e`; a unit test asserts `STDLIB_PACKAGES` contains none of the migrated names.
  - Done when: the line-count targets in [Done means](#goal) hold.

- [ ] **Task 9.3 — Documentation, v2.0.0 baseline and release notes**
  - Files: `docs/go-compatibility.md`, `docs/hybrid-wasm.md`, `docs/language-support.md` (regenerated by `npm run docs:stdlib`), `docs/architecture.md`, `docs/v2.0.0/native-go-engine.md`, `docs/roadmap.md`, `CHANGELOG.md`, `README.md`
  - Do: document the new sort tie order and `NaN` ordering, natives (what they are, `--no-natives`), the Go-source stdlib layout, `errors.As` as the one emitter member of `errors`; replace the v2.0.0 plan's "emitter-backed packages" list and its 22k-line estimate with the post-migration list and the natives registry; set this document's status to *Completed* and record the final numbers in [Performance and size](#performance-and-size).
  - Test: `npm run docs:stdlib -- --check` and `npm run check` pass; the v2.0.0 plan's package list equals the manifest's `emitter` packages (a one-line assertion in `manifest.test.js`).
  - Done when: docs are generated and the check passes.

---

## Performance and size

Baselines measured on this machine for this plan (Node 25.2.0, no Binaryen, dev-mode WASM). Final numbers are recorded in Task 9.3.

| Measure | v1.8.0 baseline | Target |
|---|---|---|
| `slices.Sort`, 200,000 `int`, WASM | 20,443 ms | ≤ 100 ms |
| Go-source quicksort, 200,000 `int`, WASM (probe) | 22 ms | reference only |
| `slices.SortFunc` / `sort.Slice` vs `Array.prototype.sort` with comparator, JS, 200,000 | Go-source probe 65.6 ms vs 89.7 ms | ≤ 1.5× native |
| `strings.Index` on 1 MB, 20 calls, WASM | 0.9 ms | ≤ 2× (native keeps the host call) |
| Dev `app.wasm`, program using `bytes.Buffer` | 6,957 bytes | ≤ 4,500 bytes |
| Type-check of 5,604 lines of generic Go (eager) | 49.9 ms | unused import ≤ +5 ms (lazy) |
| `src/backend/wasm/stdlib/` | 20,717 lines | ≤ 8,000 |
| `src/typechecker/stdlib/{core,extended}.js` | 1,715 lines | ≤ 1,500 |
| `src/backend/js/stdlib/` | 2,976 lines | ≤ 2,200 |
| `npm run bench` raycast, zero-alloc | v1.8.0 numbers | unchanged (±3%) |

---

## Test & Conformance Plan

- **Unit tests:** `test/unit/types/generics.test.js` (core types), `test/unit/wasm/generics.test.js` (named `S` in WASM), `test/unit/compiler/stdlib-go.test.js` (natives directive, call-site substitution, decline and value fallback, lazy checking and body counts), `test/unit/wasm/slices.test.js` (comparison-count bound), `test/unit/wasm/stdlib.test.js` (natives parity), `test/unit/wasm/boundary.test.js` (`time`), `test/unit/builtins/bytes.test.js` (`Buffer` semantics). New test files are added to `TEST_FILES` in [`test/unit/run.js`](../../test/unit/run.js).
- **Integration / conformance:** `test/conformance/{sort,slices,maps,errors,utf8,path,html,bytes,io,strings,hex,base64,binary,crypto,bits,sync,time,strconv,fmt}/*.go`, each with a `.out` captured from real Go 1.26 (`GOFRONT_GO=go1.26.x npm run conformance:update`). The runner compares **four configurations** per fixture (JS, JS natives-off, WASM, WASM natives-off) byte for byte. Sort fixtures include `NaN`, `-0` and tie-order cases.
- **Negative cases & diagnostics:** `unknown native 'x'`; a native on a body-less function; `//gofront:native is reserved for the standard library`; `Cannot index type S` still reported for a constraint with several underlying types; an unreached stdlib body error is not reported, a reached one is reported at the call site with the `internal stdlib error` note; a migrated package imported from a `js` package behaves as before (no new diagnostics).
- **Differential tests:** for each native, the same fixtures run with natives on and off; a disagreement names the configuration. This is the main protection against a template that drifts from Go.
- **Generated-file checks:** `npm run gen:pdq` is a no-op; `npm run docs:stdlib -- --check` and `npm run manifest:update -- --check` pass.
- **Benchmarks:** `npm run bench` (raycast) and `test/e2e/perf/zero-alloc.js` after every phase; `test/e2e/perf/` gains the sort and string-search measurements from the table above; `example/` outputs are built before and after each phase and diffed, with differences limited to listed behaviour fixes.
