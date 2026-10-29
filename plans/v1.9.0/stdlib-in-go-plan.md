# Stdlib in Go — Design Plan

**Version:** v1.9.0  
**Status:** Draft (2026-10-23; revised 2026-10-27 for the v1.8.0 simplification; re-audited 2026-10-29)  
**Related:** Follows [`../v1.8.0/portable-go-plan.md`](../v1.8.0/portable-go-plan.md) (Go-source stdlib loader, overlays, reachability, `//gofront:intrinsic`; its Phase 8 retired the coverage manifest and the real-Go conformance harness, so this plan verifies with pasted Go-output unit cases) and [`../v1.8.0/repo-structure-plan.md`](../v1.8.0/repo-structure-plan.md) (layout). Starts after [`../v1.8.0/follow-up-fixes-plan.md`](../v1.8.0/follow-up-fixes-plan.md) completes: it is In Progress (Phases 11–14 open), touches the same generics, `emit-builtins.js` and `monomorph.js` code, and its Boundary Matrix defers stdlib-member bugs to this plan (absorbed below). The v2.0.0 native engine is shelved, so this is an ordinary feature release.  
**Release note:** Sorting now matches Go on both targets: `NaN` values sort first, equal elements keep Go's order, and WebAssembly sorts of large slices are fast instead of quadratic. Most standard-library packages now follow Go's real signatures and behaviour, so generic helpers such as `slices` and `maps` work with named slice and map types, and many small differences from Go in `strings`, `bytes`, `io`, `errors`, `strconv` and `time` are gone.  

---

## Goal

v1.8.0 introduced a way to write a stdlib package **once, in Go**, and left most packages on the old path: a hand-written type table in [`src/typechecker/stdlib/`](../../src/typechecker/stdlib/), a JS shim in [`src/backend/js/stdlib/`](../../src/backend/js/stdlib/) and a WASM instruction emitter in [`src/backend/wasm/stdlib/`](../../src/backend/wasm/stdlib/). At `4731b6e` that is 32,583 lines of JavaScript (2,289 in `core.js`/`extended.js` typings, 3,856 JS shims, 26,438 WASM emitters) against 5,451 lines of Go-source stdlib. v1.9.0 moves **every package whose behaviour is ordinary Go over GoFront values** onto the Go-source path and keeps host-backed fast paths as small, named **natives** that are checked against the Go body.

It is the largest simplification left: about 18,000 lines of hand-written WASM emitters go. It is also a correctness release. The probes below show the old path is where the bugs are: every WASM sort is quadratic, sorting `NaN` gives an unsorted result on both backends, `sort.Slice` breaks ties differently from Go, and 24 deferred member bugs in `strings`, `bytes`, `io`, `errors`, `strconv`, `time`, `base64`, `rand` and `maps` still reproduce. The opposite risk is real too: Go code over a `string` in WASM pays one host call per byte (≈11× slower than the host search), and Go-source stdlib JS is always strict. So the plan has one rule: **Go is the specification and the default implementation; a native may replace it only where the host has a faster primitive, and only while a differential test proves the two agree.**

**Done means:**
- **Layout.** Every package marked *Go-only* or *Native-accelerated* in the [Boundary Matrix](#scope-rule--boundary-matrix) is a directory under `stdlib/` with no `src/typechecker/stdlib/` entry, no WASM emitter and no JS shim beyond registered natives: `test/unit/compiler/natives.test.js` (Task 12.1) and the registry assertion in Task 12.2 pass, and `wc -l` gives `src/backend/wasm/stdlib/` ≤ 8,000 (from 26,438), `src/typechecker/stdlib/{core,extended}.js` ≤ 1,500 (from 2,289), `src/backend/js/stdlib/` ≤ 2,400 (from 3,856).
- **Go behaviour.** Every migrated package has Go-output cases in `test/unit/stdlib/<pkg>.test.js` that pass in four configurations (JS and WASM, natives on and off), including the `NaN` and tie-order cases and every repro in [Deferred stdlib defects](#deferred-stdlib-defects-re-probed-2026-10-29).
- **Speed.** `test/perf/stdlib-bench.js` shows: WASM `slices.Sort` of 200,000 `int` ≤ 100 ms (today ≈ 20 s); JS `slices.SortFunc` and `sort.Slice` ≤ 2× `Array.prototype.sort` with a comparator at 200,000; WASM `strings.Index` on 1 MB ≤ 1.25× today's emitter. An unused import costs 0 bytes in `app.js` and dev-mode `app.wasm`, and a program importing every migrated package type-checks ≤ 5 ms slower than on `4731b6e`.
- **No regressions.** `npm test`, `npm run check` and `npm run test:e2e` pass, and built `example/` outputs differ from `4731b6e` only where [Edge Cases](#3-edge-cases--error-handling) list a behaviour fix.

---

## Scope Rule & Boundary Matrix

A package or member is **moved to Go** when its behaviour can be written as ordinary GoFront Go over values the compiler already has. It **keeps a native** when the host has a primitive that is measurably faster than that Go; the Go body still exists. It **stays an emitter** when it needs type information, host services or generated code that Go source cannot express.

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core (Go-only)** | Whole package or type in Go, no natives, both backends | `sort` (except `Ints`/`Strings` natives), `slices` (except the natives below), `maps`, `errors` (`New`, `Is`, `Unwrap`, `Join`, `ErrUnsupported`), `unicode/utf8` (except `RuneCountInString`), `path` (`path/filepath` stays an alias), `html`, `encoding/hex` (core codec), `encoding/base64`, `encoding/binary` (`ByteOrder`, `Append*`, `Put*`, varints), `crypto/sha256`, `sync`, `io`, `strings.Reader`, `bytes.Reader`, `bytes.Buffer`, `strings.Replacer` | |
| **In scope: core (Native-accelerated)** | Go body is the specification; a registered native replaces calls when the host primitive wins | `strings` (`Contains`, `Index*`, `Has*`, `Count`, `Repeat`, `ToUpper`/`ToLower`, `Split*`, `Join`, `Replace*`, `Trim*`, `EqualFold`, … where JS or an existing WASM import has the primitive), `bytes` (`IndexByte`, `Equal`, `Compare`), `math/bits` (`Len*`, `LeadingZeros*`, `OnesCount*` via `Math.clz32`/WASM instructions), `math/rand` top-level functions (host entropy via `rand_source`), `unicode` `Is*`/`To*` (existing JS `\p{…}` classes and WASM tables; P8 found no gap), `strconv` `FormatFloat`/`ParseFloat`/`AppendFloat` (shortest repr), `time` `Now`/`Since`/`Until`/local offset | |
| **In scope: target-specific** | A native may exist on one backend only; the other backend calls the Go body | JS-only: `slices.Sort`/`Contains`/`Index`/`Reverse`/`Clone` for `int`/`string`/`float64` elements where JS equals Go (`Sort` accepts only `int`/`string`), `sort.Ints`/`Strings`, `utf8.RuneCountInString`; listed in Task 12.1's single-target allow-list | |
| **Excluded: runtime / platform** | Unchanged from v1.8.0; clear error | goroutines, channels, `reflect`, `unsafe`, `runtime`, file I/O | No-runtime invariant (`plans/roadmap.md`) |
| **Excluded: stays emitter** | Kept on today's path | `fmt` (verb engine, `%T`/`%v` tables; `Fprint*` changes only to call `io.Writer`), `encoding/json` (generated codecs + `internal/jsonrt`), `regexp`, `os`, `testing`, `gom`, `gofront/shared`, `gofront/simd`, browser/WebGL/WebGPU typings, `math`, `crypto/rand`, `errors.As`, `strings.Builder`, `encoding/binary` `Read`/`Write`, `time.Sleep` | Need per-type tables, generated code or host services: `errors.As` tests the dynamic type of `*target`; `binary.Read`/`Write` walk the fields of an `any`; a Go `strings.Builder` over `[]byte` makes `String()` O(n) against a JS `+=` (revisit after a string representation change) |
| **Excluded: deferred** | Valid, but not this release | User-visible `//gofront:native`; a Go-source `fmt`; `regexp` in Go (RE2 port); `go/*`, `compress/*`, `math/big`; members v1.8.0 Task 9.4 removed (`unicode` range tables, `math.Gamma`/`Erf`, `sync.Map`/`Pool`, `fmt.Fscan*`, `strconv.*ToGraphic`); `hex.Dump`/`Dumper`, `hex`/`base64` `NewEncoder`/`NewDecoder`, `Encoding.Strict`; new stdlib surface beyond Go's signatures of existing members; Go-exact `rand.New(rand.NewSource(seed))` sequences; WASM per-byte `str_get` cost of `s[i]`; strict-JS codegen costs (tuple swap allocates two arrays, constant-divisor zero guard); facade identifier for exported `strings.Builder` fields (`plans/follow-ups.md`) | Natives are a closed compiler registry with no safety story for user code; `fmt`/`regexp` need their own designs; streaming/strict codec variants have no in-tree user; v1.8.0 never documented seeded sequences; the string and codegen costs need a string-representation or strict-codegen plan, not a stdlib one; `strings.Builder` stays an emitter |

---

## Verified Gaps & Baseline Audit

Original audit 2026-10-23 on `feat/portable-go` `04aa0c6` (Node 25.2.0, `go1.27.2` for "Go says"). Re-audit 2026-10-29 on `feat/follow-up-fixes` `4731b6e` (Node 25.2.0, no Go toolchain: expected values come from the original `go run` probes or Go's documented behaviour). Probes lived in `.probes/` and were deleted; each row records the snippet and result. Programs ran through `compileHybridProgram` ([`test/unit/helpers.js`](../../test/unit/helpers.js)), timings through `compileWasm` + `runWasm` or `compile(…, { strict })` in `node:vm`.

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Generic core types (checker) | With `[S ~[]E, E any]`: `s[0]` → `Cannot index type S`; `s[1:]` → `Cannot slice type S`; `S(nil)` → `cannot convert nil to S`. **Inference fails whenever `E`/`K`/`V` occur only in a constraint**: `First([]int{7, 8})`, `Id(IDs{1, 2})`, `Len(map[string]int{…})` with `M ~map[K]V` → `Cannot infer type arguments`. `Contains(IDs{1,2,3}, 2)` works only because `E` comes from the second argument. | 2026-10-29: `func First[S ~[]E, E any](s S) E { return s[0] }`, `Tail` (`s[1:]`), `Z` (`return S(nil)`), `Len[M ~map[K]V, …]`, `Keys(Set{…})` with `type Set map[string]bool` |
| Explicit instantiation (parser) | A type-literal first type argument does not parse: `Id[[]int, int]`, `slices.Index[[]int, int]` → `Parse error: expected '{' (got ,)`; `slices.Sort[[]int]` → `expected '{' (got ])`. Named arguments (`Id[IDs, int]`) parse. | 2026-10-29: `var f = Id[[]int, int]`, `f := slices.Index[[]int, int]`; type args parsed at [`src/parser/expressions.js:182`](../../src/parser/expressions.js) |
| Generic core types (WASM) | Fixed since `04aa0c6`: `Contains(IDs{1,2,3}, 2)` is valid and prints `true`. Still broken: `func Id[S ~[]E, E any](s S) S { return append(s, s...) }; Id[IDs, int](IDs{1, 2}).Sum()` → `WebAssembly.validate failed: array.set[2] expected type i64, found local.get of type (ref null 81)`; JS compiles. | 2026-10-29: `type IDs []int` with `Sum()` method |
| WASM sort complexity | **Every WASM sort is O(n²)** (×4 per doubling). 10k/20k/40k: `slices.Sort` 52/219/913 ms, `sort.Ints` 53/240/907, `sort.Slice` 237/982/4,474, `slices.SortFunc` 213/854/3,584. 200,000 `int` via `slices.Sort` took 20,443 ms on `04aa0c6`. A Go quicksort takes 23 ms at 200,000; the existing Go pdqsort `sort.Sort(sort.IntSlice(xs))` takes **38 ms**. | 2026-10-29: `compileWasm` of `func Run() int { xs := make([]int, n); …; slices.Sort(xs) }`; emitters [`core.js`](../../src/backend/wasm/stdlib/core.js) `emitSlicesSort`/`emitSortSlice` |
| Sort with `NaN` | **Silent wrong result on both backends.** `slices.Sort([]float64{3, NaN, 1, -Inf, 2})` → `[3 NaN -Inf 1 2]`, Go `[NaN -Inf 1 2 3]`; `sort.Float64s([]float64{3, NaN, 1, 2})` → `[3 NaN 1 2]`, Go `[NaN 1 2 3]`. The comparator `a < b ? -1 : a > b ? 1 : 0` is not a valid order for `NaN`. | 2026-10-29 (unchanged from P6) |
| Sort tie order | `sort.Slice` of 0..39 by `i % 3` → first 14 `0 3 6 … 39` (stable) on both backends; Go's pdqsort gives `15 39 36 3 33 30 6 27 24 9 0 21 12 18`. | 2026-10-29 (unchanged; Go order from P6 `go run`) |
| Go-source stdlib JS is strict | `stdlibJs` emits every Go-source package with `target: "both", strict: true` for **all** importers, including `js` ones ([`src/link/stdlib.js:322`](../../src/link/stdlib.js)). The 2026-10-23 "Go `SortFunc` is 0.73× `Array.sort`" figure was non-strict. Measured now at 200,000: existing Go pdqsort through the real stdlib path (`sort.Sort(sort.IntSlice)`) **114 ms**; `Array.prototype.sort` with a comparator 64–90 ms (≈1.3–1.7×). A hand quicksort compiled with `strict: true` takes 748 ms (99 ms non-strict) because each tuple swap allocates two arrays and each index goes through `__at`/`__ix`. | 2026-10-29: `time.Since` inside the program via `compileHybridProgram`; `compile(src, { strict })` + `vm` |
| Native fast paths (JS) | JS emitters inline host primitives: `strings.Contains` → `s.includes(x)`, `strings.Index` → `s.indexOf`, `slices.Sort` → `a.sort(…)`, `slices.Contains` → `a.includes`. A plain Go rewrite loses this. | P2 (`compile()` output) |
| Go over strings (WASM) | Strings are host `externref`s; `s[i]` is a `str_get` import call per byte ([v1.8.0 §1.1](../v1.8.0/portable-go-plan.md#11-string-semantics-both-backends)). `strings.Index` on 1 MB (`"a"×(2²⁰−1)+"b"`, pattern `"ab"`), 20 calls: emitter (host `str_index`) **145 ms**; Go loop over `string` 1,600–1,850 ms (≈11×); Go loop over `[]byte(s)` converted once per call 285–313 ms (≈2×). The 2026-10-23 figures (0.9 ms, 300×) do not reproduce on this input. | 2026-10-29: `compileWasm` + `runWasm`, `Native()` vs `Naive()` exports |
| Module size | A WASM module using `bytes.Buffer` is 6,957 bytes; the same program with a 6-line Go `Buffer` is 3,293 bytes. | P8 (2026-10-23; not re-run) |
| Compile cost | The checker handles ≈110 lines of generic Go per ms (5,604 lines: 49.9 ms JS / 56.0 ms WASM). Go-source packages are checked **twice** per build (probe, then mangled: [`src/link/stdlib.js:197`](../../src/link/stdlib.js) and `:272`), so eager checking costs double. | P10; 2026-10-29 source read |
| Signature drift | 163 coverage-gate mismatches came from hand-written tables (`time` 33, `slices` 28, `math` 18, `strings` 14, `unicode` 11, `bytes` 9, `base64` 8, `maps` 7, `utf8` 7, `fmt` 6, `rand` 6, `binary` 4, `sort` 4, `sha256` 3, `os` 3, `strconv` 2). Not re-measurable: the gaps file was deleted by v1.8.0 Task 8.1. | P7 at `04aa0c6` |
| Name coupling | Sites outside `*/stdlib/` (2026-10-29): `strings.Builder` 11, `bytes.Buffer` 12, `strings.Reader` 10, `bytes.Reader` 9, `time.Time` 12, `time.Duration` 9, `sha256.` 14 (13 are the `sha256.digest` method table in [`wasm/index.js:1397`](../../src/backend/wasm/index.js), 1 in `boundary.js`), `strings.Replacer` 5, `io.LimitedReader` 5, `io.Writer` 5, `io.Reader` 4, `_derivedReturn` 3. By file: `wasm/index.js` 55, `js/expressions.js` 12, `wasm/emit-builtins.js` 10, `wasm/boundary.js` 10, `typechecker/expressions.js` 3, `js/fmt-runtime.js` 3, `js/runtime.js` 2, `wasm/emit.js` 2, `typechecker/assignability.js` 1. | `grep -rn '<name>' src --include=*.js \| grep -v /stdlib/` |
| Existing Go source | `stdlib/` holds 5,451 lines of Go. [`stdlib/sort/sort.go`](../../stdlib/sort/sort.go) (561 lines) already ports Go's pdqsort for `sort.Interface` as an overlay. `maps.Keys` etc. are already Go ([`stdlib/maps/iter.go`](../../stdlib/maps/iter.go)). `INTRINSICS` ([`types.js:695`](../../src/typechecker/types.js)) is empty: `rand_source` is new in this plan. | 2026-10-29 source read |
| `maps.Keys` in JS | Ranging `map[any]int` directly works on both backends, but `maps.Keys` over it yields nothing in JS and loses dynamic key types, and struct keys come out in the internal encoding. The cause is JS codegen of `range` over a type-parameter map inside a generic body (`_structKeyRange` in [`js/statements.js:1353`](../../src/backend/js/statements.js) sees no concrete key type), not `maps` logic. | 2026-10-29: `for k := range m { _, ok := k.(L) }` → `true`/`2` on both; ledger repros below |
| Layer guard | Sentrux resolves Go stdlib imports by suffix, so a `stdlib/**/*.go` file importing `math/bits` or `encoding/base64` is a false layer violation while `src/backend/js/stdlib/{bits,base64}.js` exist; [`scripts/check-layers.js`](../../scripts/check-layers.js) `ALLOW` lists three such files. | 2026-10-29 source read |
| Fixed since `04aa0c6` | The rune literal `'\u00e9'` lexes (`233`), and `fmt.Println(math.Inf(-1))` prints `-Inf` on both backends. Removed from this plan's scope. | 2026-10-29 |

### Deferred stdlib defects (re-probed 2026-10-29)

Bugs that [`follow-up-fixes-plan.md`](../v1.8.0/follow-up-fixes-plan.md) defers to this plan (Boundary Matrix, "packages that v1.9.0 rewrites") and [`plans/follow-ups.md`](../follow-ups.md) entries scheduled here on 2026-10-29. All still reproduce; each is a Go-output case in the named task.

| Area | Finding | Evidence & probe → Task |
|---|---|---|
| `bytes.Reader` | `r := bytes.NewReader([]byte{0xff, 'a'}); r.ReadRune(); b, _ := r.ReadByte()` → JS `"\x00"`, WASM `a`; want `a` | follow-up-fixes matrix → 5.2 |
| `bytes.IndexRune` | `bytes.IndexRune([]byte("a\xffb"), utf8.RuneError)` → `-1` both; want `1` | follow-up-fixes matrix → 6.1 |
| `bytes.ToTitle` (WASM) | `Unsupported` in wasm | follow-up-fixes matrix → 6.1 |
| `strings.Replacer` | `strings.NewReplacer("a", "1", "", "X").Replace("ab")` → `1b`; want `1XbX` | follow-up-fixes matrix → 5.3 |
| `strings.ToTitle` | `strings.ToTitle("ǆ")` → `Ǆ`; want `ǅ` | follow-up-fixes matrix → 7.3 |
| `io.ReadAll` | `io.ReadAll(bytes.NewReader(nil))` → JS `Cannot read properties of null (reading 'length')`; want `0 <nil>` | follow-up-fixes matrix → 5.1 |
| `io.LimitedReader` | `io.ReadAll(&io.LimitedReader{R: strings.NewReader("hello"), N: 3})` → JS `w.Read is not a function`; want `hel <nil>` | follow-up-fixes matrix → 5.1 |
| `io.SectionReader` | `io.NewSectionReader(strings.NewReader("hello world"), 6, 5).Read(p)` → WASM `interface conversion: nil or unmatched type`; want `5 world` | follow-up-fixes matrix → 5.1 |
| `fmt.Fprint` count | `fmt.Fprint(&bytes.Buffer{}, "héé")` → WASM `n=3`; want `5` | follow-up-fixes matrix → 6.2 |
| nil slices (JS) | `slices.Contains(nil, 1)` → `Cannot read properties of null (reading 'includes')`, want `false`; `sort.Ints(nil)` → `(reading 'sort')`; `slices.Index(nil, 1)` throws | follow-ups.md "JS nil slices in stdlib" (PR #83) → 3.2, 3.4 |
| `strconv.FormatFloat` | `FormatFloat(math.Copysign(0, -1), 'f', -1, 64)` → `0`; want `-0` | follow-up-fixes matrix → 11.3 |
| `strconv.ParseFloat` | `ParseFloat("1e39", 32)` → `1e+39 <nil>`; want `+Inf strconv.ParseFloat: parsing "1e39": value out of range` (WASM module failed validation when printed directly, follow-up-fixes Task 9.4) | follow-up-fixes matrix → 11.3 |
| `base64` errors | `StdEncoding.DecodeString("!!!")` → `illegal base64 data at input byte 3`; want `byte 0` | follow-up-fixes matrix → 8.1 |
| `errors.Is` | `errors.Is(nil, nil)` → `false`; want `true` | follow-up-fixes matrix → 4.2 |
| `errors.New` `%T` | `fmt.Printf("%T", errors.New("x"))` → WASM `string`; want `*errors.errorString` | follow-up-fixes matrix → 4.2 |
| `Unwrap` matching | `fmt.Errorf("w: %w", e).(interface{ Unwrap() error })` → `false` both; `errors.Join(a, b).(interface{ Unwrap() []error })` → WASM `false`; `Is2[error](errors.New("x"))` (`_, ok := v.(T)`) → `false`; want `true` for all | follow-ups.md "WASM errors" (feat/follow-up-fixes-phase-7) → 4.2 |
| `maps.Keys` (JS) | `slices.Collect(maps.Keys(map[K]int{{"a",1}:1}))` → `[{"A":"a","B":1}]`, want `[{a 1}]`; `maps.Keys(map[any]int{L("a"):1})` loses `L`; `for range maps.Keys(map[any]int{1:1,2:2})` counts `0`, want `2` | follow-ups.md "JS maps.Keys …" ×3 (PR #84) → 4.1 |
| `rand.Perm` | `rand.Perm(-1)` panics `invalid argument to Perm`; want `runtime error: makeslice: len out of range` | follow-up-fixes matrix → 9.2 |
| `time.Time.Compare` | `t.Compare(t.Add(1))` → JS `0`, WASM `-1`; want `-1` | follow-up-fixes matrix → 10.1 |
| `time.Time` methods (WASM) | `t.Clock()`, `t.Date()`, `t.In`, `time.UnixMilli`, `time.UnixMicro` → `Unsupported time.Time method 'Clock'` | follow-up-fixes matrix → 10.1 |
| `time.Time` print (WASM) | `fmt.Println(time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC))` → `{1577934245000000000 0 <nil>}`; want `2020-01-02 03:04:05 +0000 UTC` | follow-up-fixes matrix → 10.2 |
| `Duration` in structs | `fmt.Println(struct{ D time.Duration }{time.Second})` → `{1000000000}`, want `{1s}`; `type T struct{ time.Duration; N int }; fmt.Println(T{time.Second, 1})` → `{1000000000 1}`, want `1s` (promoted `String`) | follow-up-fixes matrix; follow-ups.md "fmt embedded `time.Duration`" (PR #85) → 10.2 |
| `time` JSON (JS) | `json.Marshal(time.Date(…))` → `v.MarshalJSON is not a function` | follow-up-fixes matrix → 10.2 |

---

## Approach

### 1. Architecture & Design Decisions

**Three layers become one.**

| Today (per package) | After |
|---|---|
| Type table in `src/typechecker/stdlib/*.js` | Go declarations in `stdlib/<path>/*.go`; the checker reads them like user code |
| JS shim `src/backend/js/stdlib/<pkg>.js` | Go body compiled by the normal pipeline, plus natives in `src/backend/js/natives.js` |
| WASM emitter `src/backend/wasm/stdlib/*.js` | Go body compiled by the normal pipeline, plus natives in `src/backend/wasm/natives.js` |

Signatures are written once as real Go, so signature drift for migrated packages is impossible by construction.

**`//gofront:native <name>` (new).** A directive on a function **with a Go body**:

```go
//gofront:native strings.Index
func Index(s, substr string) int { /* Go body: the specification */ }
```

- The valid names are a closed set `NATIVES` beside `INTRINSICS` in [`src/typechecker/types.js`](../../src/typechecker/types.js) (the checker may not import backends; `scripts/check-layers.js`), validated where `INTRINSICS` is ([`typechecker/index.js:1054`](../../src/typechecker/index.js)): `unknown native 'x'`, a native on a body-less func, and use outside `stdlib/` (`//gofront:native is reserved for the standard library`) are errors. Each backend registry maps a name to its implementation. This plan is the "plan change" v1.8.0 requires for new intrinsics and natives.
- At a **call site** the backend asks its registry: JS returns an expression string from the argument strings and instantiated type arguments (for example `` `${s}.indexOf(${substr})` ``) or `null` to decline; WASM pushes instructions or a host-import call and returns `true`, or `false` to decline. A declined call calls the Go body.
- A native used as a **value** (`f := strings.Index`, `defer`, a method value) always calls the Go body, so a native never has to exist as a standalone function.
- The Go body is always compiled when reachable, so removing a native never breaks a program. The differential tests run every case with natives off.
- `//gofront:intrinsic` (v1.8.0) stays for body-less host services. `INTRINSICS` is empty today; Task 9.2 adds `rand_source`.

**Strict JS stays.** Go-source stdlib JS is one strict (`both`) build shared by all importers. JS speed comes from natives where the host wins and, for comparator sorts, from pdqsort itself: the existing Go pdqsort already runs at ≈1.3–1.7× `Array.prototype.sort` on this path, so the bound is ≤ 2×. `SortFunc`/`sort.Slice` cannot use `Array.prototype.sort` as a native because it is stable and Go's tie order is not. Rejected: a non-strict JS build for `js` importers (two JS builds per package and lost bounds panics such as `slices.Delete` out of range); a stdlib-only bounds-check opt-out (a new unsafe mode for a gate the measurements already meet).

**WASM strings.** Go bodies that scan a `string` convert it once with `[]byte(s)` (v1.8.0 §1.1); scanning `s[i]` directly costs one `str_get` import per byte (≈11×). Search and case-mapping functions keep host natives (the `[]byte` form is still ≈2× slower).

**Generic core types.** `slices` and `maps` use Go's real signatures (`func Sort[S ~[]E, E cmp.Ordered](x S)`). The checker gains a type parameter's **core type** (the single underlying type of its constraint's type set) for index, slice, `range`, `len`, `cap`, `append`, `make`, `copy`, composite literals and conversion, and **constraint type inference**: unifying `S` with an argument's type also unifies `S`'s core type `[]E` with that argument's underlying type, deriving `E` (likewise `K`/`V` for `~map[K]V`). A named slice argument returns the named type. Explicit instantiation accepts type-literal arguments (`Id[[]int, int]`). WASM monomorphisation substitutes the concrete named type.

**`sort` and `slices` order.** Go's pdqsort exists in four variants (`sort.Interface`, `sort` `lessSwap`, `slices` ordered, `slices` with `cmp`), generated in Go from one template. GoFront does the same with `scripts/gen-pdq.js`, which writes four checked-in `// Code generated` files. The template is derived from the existing hand port in `stdlib/sort/sort.go` (a verbatim port, including the xorshift pivot seeded from the length), so equal elements land in Go's order. Go's source is BSD-3-Clause; generated files keep its notice.

**Lazy body checking.** The checker verifies every body of every imported Go-source package, twice per build (probe and mangled). With ≈9,000 more lines behind `slices`, `strings`, `bytes`, `sort`, `io`, `time` and `strconv`, that adds tens of milliseconds per `gofront dev` rebuild. The checker verifies **declarations** (types, signatures, package vars, constants) eagerly and **function bodies on demand**: a call from checked code, a method of a used type, or an interface satisfaction check. Diagnostics inside a stdlib body are reported at the user's call site with `internal stdlib error in <path>; please report` ([`src/link/stdlib.js:507`](../../src/link/stdlib.js)). Reachability then sees only what was checked.

**Package-by-package migration.** Each package moves in one task or phase: write or finish the Go, register natives, run the four-way Go-output cases, delete the typing, the shim and the emitter, and unwind the name coupling listed in [Verified Gaps](#verified-gaps--baseline-audit). A package is not half-moved: all its members come from Go (with natives) or none, except the emitter members named in the Boundary Matrix. Members v1.8.0 wrote as Go overlays (`stdlib/{bytes,slices,strings,sync,math,strconv,unicode/utf8,io,errors,maps,sort}`) are absorbed by the matching task; members v1.8.0 wrote as emitters (its Tasks 3.3c, 3.4a, 3.4b, 3.4c, parts of 3.7) are rework. Each phase re-audits its packages on its base commit.

**Verification.** A *Go-output case* is a small `package main` program plus its expected stdout, taken from Go 1.26 behaviour and pasted into `test/unit/stdlib/<pkg>.test.js`; there is no conformance directory and no Go toolchain step. `assertFourWay` (Task 2.4, extending `compileHybridProgram`/`assertProgramOutput` in [`test/unit/helpers.js`](../../test/unit/helpers.js)) runs it as JS (`both`) and WASM, each with natives on and off, and names the failing configuration. Non-ASCII cases follow [v1.8.0 §1.1](../v1.8.0/portable-go-plan.md#11-string-semantics-both-backends) (no `len`/`s[i]`/range indices of non-ASCII strings).

**Rejected alternatives:**
- **Everything in Go, no natives.** Go over a WASM `string` is ≈11× slower than the host search (≈2× over `[]byte`), and JS loses `includes`/`indexOf`/`Array.prototype.sort` for primitive slices.
- **Keep emitters, generate type tables from Go's `api/*.txt`.** Fixes signature drift but leaves the quadratic sorts, the `NaN` bug, the 24 deferred defects and 26,000 lines of hand-written WASM.
- **A user-facing native/FFI mechanism.** A language feature with its own safety questions; natives stay a closed compiler registry.
- **Cache checked stdlib bodies across builds.** Invalidates on any compiler change and does not help `gofront test` or CI; lazy checking is cheaper and simpler.

### 2. Invariants & Safety Bounds

- **Go is the specification.** For every native, the Go body and the native give identical results on the Go-output cases on both backends; CI runs both.
- **Natives decline rather than diverge.** A template reproduces Go's behaviour (including strict-mode bounds panics and integer wrapping) for every instantiation it accepts, or declines.
- **Stdlib dependency direction.** A Go-source stdlib package imports only stdlib packages, never a user package; `cmp`, `iter`, `errors`, `io` and `unicode/utf8` form the base layer; the resolver rejects cycles in `stdlib/`.
- **Unused imports cost nothing.** 0 bytes in `app.js` and dev-mode `app.wasm`.
- **No new boundary types.** `time.Time` and `time.Duration` keep their names, field layout and boundary conversion; exported Go-source types follow the ordinary struct rules.
- **JS output of natives matches today's.** Built `example/` outputs are diffed before and after each phase; differences are limited to listed behaviour fixes.
- **No new runtime dependencies.** `scripts/gen-pdq.js` is plain Node.
- **Performance bounds** (measured by `test/perf/stdlib-bench.js`, Node 25.2.0, no Binaryen, dev-mode WASM; final numbers recorded here by Task 12.2):

| Measure | Baseline (`4731b6e` unless noted) | Bound |
|---|---|---|
| `slices.Sort`, 200,000 `int`, WASM | 20,443 ms (`04aa0c6`); 913 ms at 40,000 | ≤ 100 ms |
| Existing Go pdqsort `sort.Sort(IntSlice)`, 200,000, WASM / JS | 38 ms / 114 ms | reference |
| `slices.SortFunc` / `sort.Slice` vs `Array.prototype.sort` with comparator, JS, 200,000 | Go pdqsort path ≈1.3–1.7× | ≤ 2× |
| `strings.Index`, 1 MB `"a…ab"`, 20 calls, WASM | 145 ms (host `str_index`) | ≤ 1.25× |
| Dev `app.wasm`, program using `bytes.Buffer` | 6,957 bytes (`04aa0c6`) | ≤ 4,500 bytes |
| Type-check, program importing every migrated package | measured in Task 2.5 | ≤ +5 ms (lazy) |
| `src/backend/wasm/stdlib/` | 26,438 lines | ≤ 8,000 |
| `src/typechecker/stdlib/{core,extended}.js` | 2,289 lines | ≤ 1,500 |
| `src/backend/js/stdlib/` | 3,856 lines | ≤ 2,400 |
| `npm run bench`, `test/perf/zero-alloc.js`, `test/perf/bce-mathx.js` | `4731b6e` numbers | unchanged (±3%) after every phase |

### 3. Edge Cases & Error Handling

**Natives**
- A native declined for an instantiation (`slices.Sort[float64]`, a named or struct element type) calls the Go body with no diagnostic.
- Function values, method values and `defer` go through the Go body. A template evaluates each argument exactly once, in order; one that repeats an argument binds it to a temporary first.
- Natives run inside the strict stdlib build: a native for a slice function must panic like the Go body on out-of-range input and treat a nil slice as empty (today `slices.Contains(nil, 1)` throws in JS).
- A native named in `stdlib/` but missing from a backend registry, outside the single-target allow-list, is a compiler self-test failure (Task 12.1), not a user error.

**Behaviour fixes (user-visible; for the release note)**
- `slices.Sort`, `slices.SortFunc`, `sort.Float64s`, `sort.Slice`, `sort.Sort` order `NaN` and break ties like Go; programs that relied on the previous stable tie order change output.
- WASM sorts are O(n log n).
- `slices.Insert`, `Delete`, `Clone`, `Compact`, `Grow` keep a named slice type (`S`) as Go does.
- Every repro in [Deferred stdlib defects](#deferred-stdlib-defects-re-probed-2026-10-29) prints Go's output.

**Migration hazards**
- `fmt.Errorf("%w")` wrappers are built by the `fmt` emitter and the JS runtime (`js/runtime.js:952–1016`) and by the WASM runtime error struct (`wasm/module-emitter.js:274`). Go's `Is`/`Unwrap` call `Unwrap() error`/`Unwrap() []error`, so both runtimes must expose those methods in their method sets (type switches and assertions included).
- `errors.As` stays an emitter member: it tests the dynamic type of `*target`.
- `io.Writer` becomes a real Go interface. `fmt.Fprint*(w, …)` dispatches on the concrete emitter type today; after Task 5.1 it calls `w.Write`, with `os.Stdout`/`os.Stderr` and `strings.Builder` implementing it. `io` therefore lands before `bytes.Buffer`.
- `bytes.Buffer`, the readers and `time.Time` are used by value and by pointer across the boundary and in interfaces; cases cover copy semantics, `io.Reader`/`io.Writer` satisfaction, embedding and map values.
- `sha256` is used through `hash.Hash` by `io.Copy`; the digest is a Go struct with `Write`, `Sum`, `Reset`, `Size`, `BlockSize`, replacing the hand-built `sha256.digest` method table in `wasm/index.js`.
- `maps` over `map[any]V` or struct keys in JS needs the key decoding of `range` to work inside generic bodies (Task 4.1); moving `maps` alone does not fix it.
- `time.Duration` embedded in a struct promotes `String`, so `fmt.Println(T{time.Second, 1})` prints `1s`; the `fmt` emitter must see the promoted method on Go-source named types.
- `math/rand` top-level functions keep drawing from the host source; seeded `rand.New(rand.NewSource(seed))` sequences are not promised to match Go (Boundary Matrix, deferred).
- New `stdlib/**/*.go` files importing a package that still has a `src/backend/js/stdlib/<name>.js` shim trip Sentrux's suffix resolution; add them to `ALLOW` in `scripts/check-layers.js` with the standard reason, and drop the entries when the shim is deleted.
- Recursion depth: pdqsort recurses O(log n); the JS and WASM stacks are not at risk at 10⁶ elements.

**Compile time**
- A diagnostic raised while lazily checking a stdlib body is reported once, at the user's call site, with the `internal stdlib error` note.
- Body checking order must not change which diagnostics a user program reports.

---

## Implementation Tasks

Execution follows `/execute-plan`: epic branch `feat/stdlib-in-go`, one branch `feat/stdlib-in-go-phase-<N>` and one PR per phase, failing test first, one commit per task (`feat(stdlib-in-go): <summary> (Task N.M)`). Phase budget: 3–5 tasks and ≈150–500 net lines of hand-written source (compiler JS and new Go); generated files and deletions do not count. `Files:` lists the 1–3 hand-written files a task edits; `Removes:` lists files whose only change is deleting the migrated members (typings, shims, emitters), which do not count toward either limit. Phases 1–2 are prerequisites; Phase 5 precedes Phases 6–7 (`io.Writer` dispatch); the others are independent; Phase 11 carries the user docs; Phase 12 closes.

### Phase 1: Generic core types

- [ ] **Task 1.1 — Core type of a constrained type parameter in expressions**
  - Files: `src/typechecker/types.js` (`coreType`), `src/typechecker/expressions.js`, `src/typechecker/statements.js` (`range`)
  - Do: for a type parameter whose constraint has one underlying type (`~[]E`, `~map[K]V`), use it for index, slice, `range`, `len`, `cap`, `append`, `copy`, `make(S, n)` and composite literals. A constraint with several underlying types keeps `Cannot index type S`.
  - Test: `test/unit/types/generics.test.js` — `First`, `Tail`, `Len`, `make(S, n)` over `[S ~[]E, E any]` and `[M ~map[K]V, K comparable, V any]` called with explicit type arguments; negative: `[T int | string]` indexing keeps its message.
  - Done when: `First[[]int, int]`-style calls print Go's output via `assertProgramOutput` on JS and WASM.

- [ ] **Task 1.2 — Constraint type inference and conversions through core types**
  - Files: `src/typechecker/resolve.js` (unification), `src/typechecker/expressions.js`
  - Do: unify `S`'s core type with the argument's underlying type to derive `E`/`K`/`V`; `S(nil)` and `S(x)` convert when the core type accepts the operand; a call returning `S` has the argument's named type.
  - Test: `generics.test.js` — `First([]int{7, 8})` → `7`; `Z([]int{1}) == nil` → `true`; `Len(map[string]int{"a": 1})` → `1`; `Id(IDs{1, 2}).Sum()` with a method on `IDs` → `3`.
  - Done when: none of these reports `Cannot infer type arguments` or `cannot convert nil to S`, and all print Go's output on JS.

- [ ] **Task 1.3 — Type-literal type arguments in explicit instantiation**
  - Files: `src/parser/expressions.js`
  - Do: the index-or-instantiation parse at `expressions.js:182` accepts a type literal (`[]T`, `map[K]V`, `func(…)`, `*T`, `chan` excluded) as any type argument.
  - Test: `test/unit/parser/` — `Id[[]int, int]`, `slices.Index[[]int, int]`, `slices.Sort[[]int]`, `Keys[map[string]int, string, int]` parse; `a[[]int{1}[0]]` (index by composite literal) still parses as an index.
  - Done when: `f := slices.Index[[]int, int]; fmt.Println(f([]int{1}, 1))` prints `0` on JS and WASM.

- [ ] **Task 1.4 — WASM: valid modules for named slice and map type arguments**
  - Files: `src/backend/wasm/monomorph.js`, `src/backend/wasm/types.js`
  - Do: substitute the concrete named type for `S`/`M` when a generic body is copied, so locals, parameters, results and `append` of `S` use the named type's representation.
  - Test: `test/unit/wasm/generics.test.js` — `Id[IDs, int](IDs{1, 2}).Sum()` with `return append(s, s...)` (today `array.set[2] expected type i64`), a function returning `S` with a method called on the result, `M ~map[K]V` over `type Set map[string]bool`; all as parity tests.
  - Done when: the modules validate and print the JS output.

- [ ] **Task 1.5 — JS zero values for core-typed parameters and parity rows**
  - Files: `src/backend/js/expressions.js` (`S(nil)`, zero factory for `S`), `docs/language-support.md` (fixture rows)
  - Do: zero-value factories cover type parameters with a core type; add `<!-- fixture: … -->` rows for each pattern in Tasks 1.1–1.4.
  - Test: `test/unit/language/parity-matrix.test.js` picks up the rows; `generics.test.js` — `var zero S`, `S(nil)`, `append(S(nil), s...)`.
  - Done when: the matrix passes with the new rows on `both`.

### Phase 2: Natives, differential testing and lazy checking

- [ ] **Task 2.1 — `//gofront:native` directive and name set**
  - Files: `src/lexer/lexer.js`, `src/parser/declarations.js`, `src/typechecker/types.js` (`NATIVES` beside `INTRINSICS`, validated next to `typechecker/index.js:1054`)
  - Do: parse `//gofront:native <name>` before a func with a body, like `//gofront:intrinsic`; reject an unknown name, a native on a body-less func, and use outside `stdlib/`.
  - Test: `test/unit/compiler/stdlib-go.test.js` — `unknown native 'x'`, the body-less error, `//gofront:native is reserved for the standard library` (user package), via a temp-dir stdlib root; a valid test-only name compiles.
  - Done when: the four tests pass with those messages.

- [ ] **Task 2.2 — JS call-site substitution with decline and value fallback**
  - Files: `src/backend/js/expressions.js`, new `src/backend/js/natives.js`
  - Do: at a call whose callee carries a native, ask the registry with the argument expressions and instantiated type arguments; emit the string, else call the Go function. Values, `defer` and method values call the Go function. Repeated arguments are bound to temporaries.
  - Test: `stdlib-go.test.js` — a test-only native `str.Index` emits `.indexOf(`; `f := str.Index; f(a, b)` calls the Go body; a template that declines for `float64` calls the Go body; `str.Index(next(), next())` evaluates each argument once, in order.
  - Done when: all four assertions pass on the generated JS.

- [ ] **Task 2.3 — WASM call-site substitution**
  - Files: `src/backend/wasm/emit-exprs.js`, new `src/backend/wasm/natives.js`
  - Do: the same contract for WASM; an implementation pushes instructions or a host-import call and returns `true`, or `false` to decline. The Go body is emitted whenever reachable.
  - Test: `test/unit/wasm/stdlib.test.js` — a test-only native calling an import; decline and value-fallback cases as parity tests against the Go body.
  - Done when: native-on and native-off modules validate and give the same output.

- [ ] **Task 2.4 — Natives-off mode and `assertFourWay`**
  - Files: `src/compiler.js` (`natives` option), `src/link/stdlib.js` (pass it to the stdlib `CodeGen` and WASM unit), `src/cli/cli-core.js` (`--no-natives`, debugging only)
  - Do: `natives: false` makes both backends ignore their registries. Extend `compileHybridProgram` in `test/unit/helpers.js` with a `natives` option and add `assertFourWay(source, expected)`, which reports the failing configuration (`js (natives on)`, …).
  - Test: `stdlib-go.test.js` — a test-only native that disagrees with its Go body fails `assertFourWay` naming `js (natives on)`; an agreeing one passes.
  - Done when: both cases behave as stated.

- [ ] **Task 2.5 — Lazy body checking for Go-source packages**
  - Files: `src/typechecker/index.js`, `src/link/stdlib.js` (`checkStdlibPrograms`, both passes), `src/lower/reachability.js`
  - Do: check declarations eagerly and function and method bodies when first reached (call, used type's method, interface satisfaction) in both the probe and the mangled pass; report stdlib body errors at the user's call site. Expose `checker.stats.bodiesChecked`.
  - Test: `stdlib-go.test.js` — a synthetic 5,600-line Go-source package of which the program calls one function checks ≤ 10 bodies; a type error in an unreached body is not reported; the same error in a reached body is reported at the call site with the `internal stdlib error` note; diagnostics for existing packages are unchanged.
  - Done when: the synthetic import type-checks ≤ 5 ms slower than without it; the measurement is recorded in [§2](#2-invariants--safety-bounds).

### Phase 3: `sort` and `slices`

- [ ] **Task 3.1 — pdqsort variant generator**
  - Files: new `scripts/gen-pdq.js`, new `scripts/pdq-template.txt` (derived from the pdqsort in `stdlib/sort/sort.go`), `package.json` (`gen:pdq`; `npm run check` fails when regeneration changes a file)
  - Generates: `stdlib/sort/zsort_iface.go`, `stdlib/sort/zsort_func.go`, `stdlib/slices/zsort_ordered.go`, `stdlib/slices/zsort_cmp.go` (Go's BSD notice kept)
  - Do: one template with the four substitutions Go's `gen_sort_variants` uses; swap and inspect by index (`data[a], data[b] = data[b], data[a]`), never `&data[i]` (v1.8.0 D5).
  - Test: new `test/unit/compiler/gen-pdq.test.js` — regenerating is a no-op; `test/unit/stdlib/sort.test.js` tie cases print the order of equal keys for n = 5, 13, 40, 1000.
  - Done when: tie cases match Go's order in all four configurations.

- [ ] **Task 3.2 — `slices` non-sorting members in Go**
  - Files: `stdlib/slices/slices.go` (absorbs `extra.go`, `iter.go`), `src/backend/js/natives.js` (`slices.Contains`, `Index`, `Reverse`, `Clone` for primitive `E`)
  - Removes: non-sort members from `src/backend/js/stdlib/slices.js`, `emitSlices*` (non-sort) in `src/backend/wasm/stdlib/core.js`, `slices` entries in `src/typechecker/stdlib/extended.js`
  - Do: every existing non-sort/search member with Go's signatures (`S ~[]E`); JS natives keep today's `includes`/`indexOf` text and handle nil slices.
  - Test: `test/unit/stdlib/slices.test.js` — Insert/Delete/Compact/Concat/Clip/Grow/Equal/Compare/Min/Max with named, empty and nil slices; `type IDs []int` comes back as `IDs` from `Insert`/`Delete`/`Clone`/`Compact`/`Grow`; `slices.Contains(nil, 1)` → `false`, `slices.Index(nil, 1)` → `-1`.
  - Done when: cases pass four ways; `example/` JS differs only where a native's text differs (diff in the PR).

- [ ] **Task 3.3 — `slices` sort and search family in Go**
  - Files: `stdlib/slices/sort.go`, `src/backend/js/natives.js` (`slices.Sort` for `int`/`string`), new `test/perf/stdlib-bench.js`
  - Removes: `emitSlicesSort*`, `BinarySearch*`, `IsSorted*`, `MinMax*` in `core.js`; the matching shim members and typings
  - Do: `Sort`, `SortFunc`, `SortStableFunc`, `IsSorted*`, `BinarySearch*`, `Min*`, `Max*` over the generated pdqsort; floats order `NaN` first via `cmp.Less`.
  - Test: `slices.test.js` — `NaN`, ±0, ties via `SortFunc`, `SortStableFunc` stability, large n; `test/unit/wasm/slices.test.js` — a counting `SortFunc` on 20,000 elements makes ≤ 400,000 comparisons; `stdlib-bench.js` records the WASM 200,000-`int` sort and JS `SortFunc` vs `Array.prototype.sort`.
  - Done when: cases pass four ways; WASM 200,000 `int` ≤ 100 ms; JS `SortFunc` ≤ 2× `Array.prototype.sort` with a comparator.

- [ ] **Task 3.4 — `sort` in Go**
  - Files: `stdlib/sort/sort.go` (keeps the `Interface` API; its pdqsort moves to the generated files), `src/backend/js/natives.js` (`sort.Ints`, `sort.Strings`)
  - Removes: `src/backend/js/stdlib/sort.js`, `emitSort*` in `core.js`, `sort` typings in `src/typechecker/stdlib/core.js`
  - Do: `Ints`, `Strings`, `Float64s`, `Slice`, `SliceStable`, `Sort`, `Stable`, `Reverse`, `Search*`, `IntSlice`/`StringSlice`/`Float64Slice`, `IsSorted`, `*AreSorted`, `Find`, `SliceIsSorted`.
  - Test: `sort.test.js` — `sort.Float64s([]float64{3, NaN, 1, 2})` → `[NaN 1 2 3]`; `sort.Slice` of 0..39 by `i % 3` → Go's order; `sort.Ints(nil)` no panic; Task 3.1 tie cases.
  - Done when: cases pass four ways and `stdlib-bench.js` shows `sort.Slice` ≤ 2× `Array.prototype.sort`.

### Phase 4: `maps`, `errors`, `unicode/utf8`, `path`, `html`

- [ ] **Task 4.1 — `maps` in Go and generic map range in JS**
  - Files: `stdlib/maps/maps.go` (absorbs `iter.go`), `src/backend/js/statements.js` (`_structKeyRange` for type-parameter maps), `src/typechecker/expressions.js` (remove `_derivedReturn`)
  - Removes: `src/backend/js/stdlib/maps.js`, `emitMaps*` in `core.js`, `maps` typings in `extended.js`
  - Do: `Clone`, `Copy`, `Equal`, `EqualFunc`, `DeleteFunc`, `All`, `Keys`, `Values`, `Insert`, `Collect` with `M ~map[K]V`; `range` over a type-parameter map decodes keys from the instantiated key type.
  - Test: `test/unit/stdlib/maps.test.js` — sorted output, `NaN` keys kept once each; `slices.Collect(maps.Keys(map[K]int{{"a",1}:1}))` → `[{a 1}]`; `maps.Keys(map[any]int{L("a"):1})` keeps `L`; `for range maps.Keys(map[any]int{1:1,2:2})` counts `2`.
  - Done when: cases pass four ways and `grep -rn _derivedReturn src` finds nothing.

- [ ] **Task 4.2 — `errors` in Go, `As` stays an emitter member**
  - Files: `stdlib/errors/errors.go` (absorbs `overlay.go`), `src/backend/js/runtime.js` (`%w`/`Join` wrappers' `Unwrap`), `src/backend/wasm/module-emitter.js` (runtime error struct method set)
  - Removes: `emitErrorsCall` except `As` in `core.js`; `src/backend/js/stdlib/errors.js` except `As`; `errors` typings except `As`
  - Do: `New` (an `*errorString`), `Is`, `Unwrap`, `Join`, `ErrUnsupported` in Go, as an overlay with `As` the only emitter member; wrappers expose `Unwrap() error` / `Unwrap() []error` to type switches and assertions on both backends.
  - Test: `test/unit/stdlib/errors.test.js` — `%w`, multiple `%w`, `Join`, `Is` with `Is(error) bool` methods, `As` on pointer and value targets; `errors.Is(nil, nil)` → `true`; `%T` of `errors.New("x")` → `*errors.errorString`; `Errorf("%w")` matches `interface{ Unwrap() error }`; `Join` matches `interface{ Unwrap() []error }`; `Is2[error](errors.New("x"))` → `true`; `errors.Is(err, strconv.ErrRange)`.
  - Done when: cases pass four ways.

- [ ] **Task 4.3 — `unicode/utf8` in Go**
  - Files: `stdlib/unicode/utf8/utf8.go` (absorbs `bytes.go`), `src/backend/js/natives.js` (`RuneCountInString`)
  - Removes: `src/backend/js/stdlib/utf8.js`, `emitUtf8Call` in `core.js`, `utf8` typings in `core.js`
  - Do: the whole package over `[]byte` with Go's constants and signatures (`RuneError`, `UTFMax` untyped).
  - Test: `test/unit/stdlib/utf8.test.js` — invalid sequences, surrogates, `FullRune`, `DecodeLastRune`.
  - Done when: cases pass four ways and `unicode/utf8` has no typechecker table entry.

- [ ] **Task 4.4 — `path` and `html` in Go**
  - Files: `stdlib/path/path.go`, `stdlib/html/html.go`, `src/typechecker/types.js` (`path/filepath` alias, `types.js:123`)
  - Removes: `src/backend/js/stdlib/{path,html}.js`, `path`/`html` emitters in `src/backend/wasm/stdlib/pure.js`, typings in `extended.js` (the alias at `extended.js:540` re-points to the Go `path`)
  - Do: `Join`, `Clean`, `Base`, `Dir`, `Ext`, `Split`, `IsAbs`, `Match`; `EscapeString`/`UnescapeString` with Go's entity subset documented in the file.
  - Test: `test/unit/stdlib/path.test.js` (run again with `import "path/filepath"`), `test/unit/stdlib/html.test.js`.
  - Done when: cases pass four ways and `pure.js` keeps only `unicode` and `rand`.

### Phase 5: `io`, readers and `strings.Replacer`

- [ ] **Task 5.1 — `io` in Go; `fmt.Fprint*` through `io.Writer`**
  - Files: `stdlib/io/io.go`, `src/backend/js/fmt-runtime.js` (`Fprint*` calls `w.Write`), `src/backend/wasm/stdlib/core.js` (`Fprint*` dispatch through the interface)
  - Removes: `src/backend/js/stdlib/io.js`, `emitIo*`/`_emitIoCopy*`/`_emitIoReadAll` in `src/backend/wasm/stdlib/io.js`, `io` typings, `io.Writer`/`io.Reader` sites in `wasm/index.js`
  - Do: `Reader`, `Writer`, `Closer`, `Seeker` and composites, `EOF`, `ErrUnexpectedEOF`, `ErrShortWrite`, `Discard`, `Copy`, `CopyN`, `CopyBuffer`, `ReadAll`, `ReadFull`, `ReadAtLeast`, `WriteString`, `LimitReader`/`LimitedReader`, `MultiReader`, `MultiWriter`, `TeeReader`, `NopCloser`, `SectionReader`; `Sscan` stays an emitter.
  - Test: `test/unit/stdlib/io.test.js` — `io.ReadAll(bytes.NewReader(nil))` → `0 <nil>`; `ReadAll(&io.LimitedReader{…, N: 3})` → `hel <nil>`; `NewSectionReader(…, 6, 5).Read` → `5 world`; `test/unit/stdlib/fmt.test.js` — `Fprintf` into `bytes.Buffer`, `strings.Builder`, `os.Stdout` and a user `Writer`.
  - Done when: cases pass four ways and `fmt.Fprintf(w, …)` type-checks against `io.Writer`.

- [ ] **Task 5.2 — `strings.Reader` and `bytes.Reader` in Go**
  - Files: `stdlib/strings/reader.go`, `stdlib/bytes/reader.go`, `src/backend/wasm/index.js` (10 + 9 sites)
  - Removes: reader helpers in `src/backend/wasm/stdlib/io.js`, reader sites in `wasm/emit-builtins.js` and `js/expressions.js`
  - Do: `NewReader`, `Read`, `ReadByte`, `UnreadByte`, `ReadRune`, `UnreadRune`, `Len`, `Size`, `Reset`, `Seek`, `ReadAt`, `WriteTo`.
  - Test: `test/unit/stdlib/strings.test.js`, `bytes.test.js` reader cases; `io.ReadAll` over each; `bytes.NewReader([]byte{0xff, 'a'})` then `ReadRune`, `ReadByte` → `a`.
  - Done when: cases pass four ways and `grep -rn 'strings\.Reader\|bytes\.Reader' src --include=*.js` outside `*/stdlib/` finds only comments.

- [ ] **Task 5.3 — `strings.Replacer` in Go**
  - Files: `stdlib/strings/replacer.go`, `src/backend/js/expressions.js`, `src/backend/wasm/emit-builtins.js` (5 sites)
  - Removes: `emitReplacerMethodCall`, `emitStringsNewReplacer` in `core.js`
  - Do: `NewReplacer`, `Replace`, `WriteString` with Go's generic algorithm (first match, argument order).
  - Test: `strings.test.js` — overlapping old strings; `NewReplacer("a", "1", "", "X").Replace("ab")` → `1XbX`; `WriteString` into a `bytes.Buffer`.
  - Done when: cases pass four ways and `strings.Replacer` has no backend special case.

### Phase 6: `bytes`

- [ ] **Task 6.1 — `bytes` functions in Go with natives**
  - Files: `stdlib/bytes/bytes.go` (absorbs `iter.go`, `search.go`, `split.go`), `src/backend/js/natives.js` (`IndexByte`, `Equal`, `Compare`)
  - Removes: `emitBytesCall`/`_emitBytes*` in `src/backend/wasm/stdlib/bytes.js`, function members of `src/backend/js/stdlib/bytes.js`, `bytes` function typings
  - Do: every existing `bytes` function with Go's signatures (`rune`/`byte` types for `ContainsRune`, `IndexByte`, `Map`, `FieldsFunc`, `TrimFunc`).
  - Test: `test/unit/stdlib/bytes.test.js` — functions; `bytes.IndexRune([]byte("a\xffb"), utf8.RuneError)` → `1`; `bytes.ToTitle` on WASM; `test/unit/builtins/bytes.test.js` unchanged.
  - Done when: cases pass four ways and `bytes` functions have no typechecker entry.

- [ ] **Task 6.2 — `bytes.Buffer` in Go**
  - Files: `stdlib/bytes/buffer.go`, `src/backend/js/expressions.js`, `src/backend/wasm/index.js` (`bytes.Buffer` sites)
  - Removes: `emitBytesBufferMethodCall` (the rest of `src/backend/wasm/stdlib/bytes.js`), `Buffer` in `src/backend/js/stdlib/bytes.js`, `bytes.Buffer` sites in `wasm/emit-builtins.js`
  - Do: `Write*`, `Read*`, `Bytes`, `String`, `Len`, `Cap`, `Grow`, `Truncate`, `Reset`, `Next`, `ReadFrom`, `WriteTo`, `UnreadByte`, `UnreadRune`, `NewBuffer`, `NewBufferString`; `fmt.Fprint*` into a `Buffer` goes through `io.Writer` (Task 5.1).
  - Test: `bytes.test.js` — buffer cases; `n, _ := fmt.Fprint(&b, "héé")` → `5`; value-copy, pointer, interface and map-value cases in `test/unit/builtins/bytes.test.js`; a program using `Buffer` is ≤ 4,500 bytes of dev `app.wasm`.
  - Done when: both pass and `src/backend/wasm/stdlib/bytes.js` is deleted.

- [ ] **Task 6.3 — Remove dead `bytes` internals**
  - Files: `src/backend/wasm/stdlib/io.js`, `src/backend/wasm/emit-builtins.js`, `scripts/check-layers.js` (`ALLOW` entries made obsolete)
  - Do: delete helpers only the `bytes` emitters used and any `ALLOW` entry whose shim is gone.
  - Test: `test/unit/compiler/check-layers.test.js` passes with the shorter `ALLOW`; `test/unit/wasm/stdlib.test.js` unchanged.
  - Done when: `grep -rn 'bytes\.Buffer' src --include=*.js` finds only comments.

### Phase 7: `strings`

- [ ] **Task 7.1 — Search family with host natives**
  - Files: `stdlib/strings/strings.go` (absorbs `extra.go`, `iter.go`), `src/backend/js/natives.js`, `src/backend/wasm/natives.js` (`Index`, `LastIndex`, `IndexByte`, `IndexRune`, `IndexAny`, `Contains*`, `HasPrefix`, `HasSuffix`, `Count` via today's imports such as `str_index`)
  - Removes: matching `emitStrings*` cases in `core.js`, members of `src/backend/js/stdlib/strings.js`, typings
  - Do: Go bodies over `[]byte` (v1.8.0 §1.1); natives reproduce today's output.
  - Test: `test/unit/stdlib/strings.test.js` — search cases (ASCII, per §1.1); `stdlib-bench.js` records WASM `strings.Index` on 1 MB.
  - Done when: cases pass four ways and WASM `strings.Index` is ≤ 1.25× the 145 ms baseline.

- [ ] **Task 7.2 — Split, join, repeat and replace family**
  - Files: `stdlib/strings/strings.go`, `src/backend/js/natives.js`, `src/backend/wasm/natives.js`
  - Removes: matching `emitStrings*` cases, shim members and typings
  - Do: `Split*`, `Join`, `Repeat`, `Replace`, `ReplaceAll`, `Cut*`, `Fields`, `FieldsFunc` with natives where JS has the primitive.
  - Test: `strings.test.js` — split/join/replace cases including empty separators and `n` limits.
  - Done when: cases pass four ways.

- [ ] **Task 7.3 — Case mapping, trimming and the rest**
  - Files: `stdlib/strings/strings.go`, `src/backend/js/natives.js`, `src/backend/wasm/natives.js` (`ToUpper`, `ToLower`, `EqualFold`)
  - Removes: the remaining `emitStrings*` (except `strings.Builder`), the rest of `src/backend/js/stdlib/strings.js` (except `Builder`), `strings` typings
  - Do: `ToUpper`, `ToLower`, `ToTitle`, `Title`, `EqualFold`, `Trim*`, `Map`, `IndexFunc`, `ToValidUTF8`.
  - Test: `strings.test.js` — `strings.ToTitle("ǆ")` → `ǅ`; trim and fold cases.
  - Done when: cases pass four ways and `strings.Builder` is the only emitter type left in `strings`.

### Phase 8: Encodings and `crypto/sha256`

- [ ] **Task 8.1 — `encoding/hex` and `encoding/base64` in Go**
  - Files: `stdlib/encoding/hex/hex.go`, `stdlib/encoding/base64/base64.go`, `scripts/check-layers.js` (drop the `jsonrt` `ALLOW` entries once `base64.js` is gone)
  - Removes: `src/backend/js/stdlib/{hex,base64}.js`, `emitHexCall`/`emitBase64*` in `src/backend/wasm/stdlib/packages.js`, typings
  - Do: over `[]byte` (§1.1): `hex` `EncodeToString`, `DecodeString`, `Encode`, `Decode`, `EncodedLen`, `DecodedLen`, `AppendEncode`, `AppendDecode`, `ErrLength`, `InvalidByteError`; `base64` `*Encoding` with `NewEncoding`, `WithPadding`, `EncodeToString`, `DecodeString`, `Encode`, `Decode`, `EncodedLen`, `DecodedLen`, `AppendEncode`, `AppendDecode`, `CorruptInputError`; `StdEncoding`, `URLEncoding`, `RawStdEncoding`, `RawURLEncoding` as `*Encoding` package vars. `internal/jsonrt` keeps working on the Go `base64`.
  - Test: `test/unit/stdlib/{hex,base64}.test.js` — codecs and Go's error messages; `DecodeString("!!!")` → `illegal base64 data at input byte 0`; `test/unit/builtins/json.test.js` `[]byte` fields unchanged.
  - Done when: cases pass four ways.

- [ ] **Task 8.2 — `encoding/binary` (`ByteOrder`, varints) in Go**
  - Files: `stdlib/encoding/binary/binary.go`
  - Removes: `ByteOrder`/varint members of `src/backend/js/stdlib/binary.js` and `packages.js`, typings
  - Do: `ByteOrder` implementations with `Uint*`/`PutUint*`/`Append*`, varints, `MaxVarintLen*`; `Read`/`Write` stay emitter members (overlay).
  - Test: `test/unit/stdlib/binary.test.js` — both byte orders, varint round trips and overflow.
  - Done when: cases pass four ways and `binary.Read`/`Write` still pass their existing tests.

- [ ] **Task 8.3 — `crypto/sha256` in Go**
  - Files: `stdlib/crypto/sha256/sha256.go`, `src/backend/wasm/index.js` (`sha256.digest` method table, 13 sites), `src/backend/wasm/boundary.js` (1 site)
  - Removes: `src/backend/js/stdlib/sha256.js`, sha256 write cores in `src/backend/wasm/stdlib/io.js`, emitters in `packages.js`, typings
  - Do: `Sum256`, `New`, `Sum224`, `New224`, `Size`, `BlockSize` as a Go digest satisfying `hash.Hash`.
  - Test: `test/unit/stdlib/crypto.test.js` — FIPS vectors, `io.Copy` into the hash, `Reset`, `Sum(prefix)`.
  - Done when: cases pass four ways and `grep -rn 'sha256\.' src --include=*.js` outside `*/stdlib/` finds only comments.

### Phase 9: `math/bits`, `math/rand`, `sync`

- [ ] **Task 9.1 — `math/bits` in Go with natives**
  - Files: `stdlib/math/bits/bits.go`, `src/backend/js/natives.js`, `src/backend/wasm/natives.js` (`Len*`, `LeadingZeros*`, `TrailingZeros*`, `OnesCount*` as `Math.clz32`/WASM `clz`/`ctz`/`popcnt`)
  - Removes: `src/backend/js/stdlib/bits.js`, `emitBitsCall` in `core.js`, typings; `stdlib/math/extra.go`'s `ALLOW` entry in `scripts/check-layers.js`
  - Do: every existing member with Go's signatures (`uint` vs `uint64`), absorbing `Add64`/`Mul64`/`Div64`.
  - Test: `test/unit/stdlib/bits.test.js` — wide arithmetic, edge widths; zero-alloc and raycast benches unchanged.
  - Done when: cases pass four ways.

- [ ] **Task 9.2 — `math/rand` in Go over `rand_source`**
  - Files: `stdlib/math/rand/rand.go`, `src/typechecker/types.js` (`INTRINSICS`: `rand_source`), `src/backend/js/index.js` (`JS_INTRINSICS.rand_source`; the WASM side uses the existing random import)
  - Removes: `src/backend/js/stdlib/rand.js`, rand in `src/backend/wasm/stdlib/pure.js`, typings
  - Do: top-level functions draw from `//gofront:intrinsic rand_source`; `Intn`, `Int63`, `Float64`, `Perm`, `Shuffle`, `Rand`/`NewSource` in Go.
  - Test: `test/unit/stdlib/rand.test.js` — range checks, `Perm` is a permutation, `Shuffle` keeps the multiset; `rand.Perm(-1)` panics `runtime error: makeslice: len out of range`.
  - Done when: cases pass four ways.

- [ ] **Task 9.3 — `sync` in Go**
  - Files: `stdlib/sync/sync.go` (absorbs `extra.go`)
  - Removes: `src/backend/js/stdlib/sync.js`, `emitSync*` in `packages.js`, typings
  - Do: `Mutex`, `RWMutex`, `Once`, `WaitGroup`, `OnceFunc`/`OnceValue`/`OnceValues` as single-threaded structs; `Unlock` of an unlocked mutex panics with Go's message (`sync: unlock of unlocked mutex`).
  - Test: `test/unit/stdlib/sync.test.js`; a `Mutex` field copied by value behaves as in Go (documented, not diagnosed).
  - Done when: cases pass four ways.

### Phase 10: `time`

- [ ] **Task 10.1 — `time` core: `Duration`, `Month`, `Weekday`, civil dates**
  - Files: `stdlib/time/time.go`, `stdlib/time/duration.go`, `src/backend/wasm/natives.js` (`time.Now`, local offset over the existing clock import)
  - Removes: civil-day helpers and `emitDurationMethodCall` in `src/backend/wasm/stdlib/time.js`, matching members of `src/backend/js/stdlib/time.js`, `DURATION_T`/`TIME_T` tables in `src/typechecker/stdlib/core.js`
  - Do: `Duration` with methods and constants, `Month`/`Weekday` as named `int` types with `String`, `Time` with today's field layout (`unixNano int64`, `offset int32`), `Date`, `Unix`, `UnixMilli`, `UnixMicro`, `Add`, `Sub`, `AddDate`, `Truncate`, `Round`, `Clock`, `Date()`, `In`, `YearDay`, `ISOWeek`, `Compare`, `FixedZone`, `UTC`; `Now`/`Since`/`Until` stay natives.
  - Test: `test/unit/stdlib/time.test.js` — fixed dates, DST-free zones, leap years, ISO week edges; `t.Compare(t.Add(1))` → `-1`; `t.Clock()` → `3 4 5` on WASM; `test/unit/builtins/stdlib.test.js` time tests unchanged.
  - Done when: cases pass four ways and `Month`/`Weekday` are named types with `String()`.

- [ ] **Task 10.2 — `time` layouts, printing and JSON**
  - Files: `stdlib/time/format.go`, `stdlib/time/parse.go`, `src/backend/js/fmt-runtime.js` (promoted `String` on Go-source named types)
  - Removes: `_emitTimeMethodFormat`, `_emitTimeParse` in `src/backend/wasm/stdlib/time.js`; the rest of `src/backend/js/stdlib/time.js` except clock natives
  - Do: Go's layout engine for the supported layouts and constants (`RFC3339`, `Kitchen`, …), `ParseError`, `ParseDuration`, `Time.String`, `MarshalJSON`/`UnmarshalJSON`/`MarshalText`.
  - Test: `time.test.js` — all layout constants, 12-hour clocks, fractional seconds, parse errors; `fmt.Println(time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC))` → `2020-01-02 03:04:05 +0000 UTC`; `fmt.Println(struct{ D time.Duration }{time.Second})` → `{1s}`; `type T struct{ time.Duration; N int }` prints `1s`; `json.Marshal(time.Date(…))` round-trips on JS and WASM.
  - Done when: cases pass four ways and `src/backend/wasm/stdlib/time.js` holds only clock natives.

- [ ] **Task 10.3 — `time` at the boundary and in the backends**
  - Files: `src/backend/wasm/boundary.js` (10 `time.Time` + `time.Duration` sites), `src/backend/js/expressions.js`, `src/typechecker/assignability.js`
  - Removes: `time.*` name checks in `wasm/emit-builtins.js`, `wasm/emit.js`, `js/runtime.js`
  - Do: `time.Time`/`Duration` follow ordinary struct and named-type rules except the documented JS `Date` conversion; the boundary representation is unchanged.
  - Test: `test/unit/wasm/boundary.test.js` — `Time`/`Duration` parameters, results and struct fields cross as before; a `both` package round-trips a `Time`.
  - Done when: boundary tests pass unchanged and `grep -rn 'time\.Time' src --include=*.js` outside `*/stdlib/` finds only the boundary conversion.

### Phase 11: `strconv` and user docs

- [ ] **Task 11.1 — `strconv` integers, bools and errors in Go**
  - Files: `stdlib/strconv/strconv.go`
  - Removes: integer/bool members of `src/backend/js/stdlib/strconv.js` and `emitStrconvCall`, typings
  - Do: `Itoa`, `Atoi`, `ParseInt` (returns `int64`), `ParseUint`, `ParseBool`, `FormatInt`, `FormatUint`, `FormatBool`, `Append*` forms, `NumError`, `ErrRange`, `ErrSyntax`, `IntSize`.
  - Test: `test/unit/stdlib/strconv.test.js` — error messages and `errors.Is(err, strconv.ErrRange)`; bases 2–36; `int64` limits.
  - Done when: cases pass four ways and `ParseInt` returns `int64`.

- [ ] **Task 11.2 — `strconv` quoting in Go**
  - Files: `stdlib/strconv/quote.go`
  - Removes: quote members of the shim and emitter, typings
  - Do: `Quote`, `QuoteRune`, `QuoteToASCII`, `QuoteRuneToASCII` and `Append*` forms, `Unquote`, `UnquoteChar`, `QuotedPrefix`, `CanBackquote`, `IsPrint`, `IsGraphic`.
  - Test: `strconv.test.js` — quote/unquote round trips and invalid input.
  - Done when: cases pass four ways.

- [ ] **Task 11.3 — `strconv` floats as natives over a Go body**
  - Files: `stdlib/strconv/float.go`, `src/backend/js/natives.js`, `src/backend/wasm/natives.js` (`FormatFloat`, `ParseFloat`, `AppendFloat`)
  - Removes: the rest of `src/backend/js/stdlib/strconv.js` and `emitStrconvCall`
  - Do: the Go body handles sign, `-0`, special values, `bitSize` 32 range errors and syntax; the shortest-representation digits come from the native (host number printer).
  - Test: `strconv.test.js` — round trips, `'g'`/`'e'`/`'f'`, bit sizes 32 and 64; `FormatFloat(-0, 'f', -1, 64)` → `-0`; `ParseFloat("1e39", 32)` → `+Inf` with the range error; `fmt.Println(strconv.ParseFloat(…))` validates on WASM.
  - Done when: cases pass four ways and `fmt` cases are unchanged.

- [ ] **Task 11.4 — User documentation**
  - Files: `docs/go-compatibility.md`, `docs/language-support.md` (package tables), `docs/hybrid-wasm.md`
  - Do: document the sort tie order and `NaN` ordering, generic helpers with named slice and map types, the behaviour fixes, `--no-natives`, and `errors.As`/`strings.Builder` as the remaining emitter members.
  - Test: `test/unit/compiler/plan-paths.test.js` and the `language-support.md` fixture rows pass.
  - Done when: the docs describe the post-migration behaviour with no plan or task references.

### Phase 12: Typings removal and native self-check

- [ ] **Task 12.1 — Native registry self-check**
  - Files: new `test/unit/compiler/natives.test.js`, `src/backend/js/natives.js`, `src/backend/wasm/natives.js`
  - Do: scan `stdlib/**/*.go` for `//gofront:native <name>`; require each name in `NATIVES` and in both registries except the documented single-target allow-list; fail on a registry entry no Go file names.
  - Test: the test fails first against a temporary Go file naming an unregistered native.
  - Done when: the test passes on the real tree.

- [ ] **Task 12.2 — Delete leftover typings and shrink the registries**
  - Files: `src/typechecker/types.js` (`STDLIB_PACKAGES`, `WASM_STDLIB_MEMBERS`, `WASM_SUPPORTED_STDLIB`), `src/backend/js/stdlib/index.js`, `src/backend/wasm/stdlib/index.js`
  - Removes: leftover migrated entries in `src/typechecker/stdlib/{core,extended}.js`
  - Do: keep only `fmt`, `encoding/json`, `regexp`, `os`, `testing`, `math`, `gom`, `gofront/shared`, `gofront/simd`, `crypto/rand`, browser typings and the emitter members in the Boundary Matrix; run `wc -l` and record the sizes and final benchmark numbers in [§2](#2-invariants--safety-bounds).
  - Test: `test/unit/compiler/stdlib-go.test.js` — `STDLIB_PACKAGES` contains none of the migrated names.
  - Done when: the line-count bounds in [Done means](#goal) hold.

- [ ] **Task 12.3 — Stdlib layout in the architecture docs**
  - Files: `docs/architecture.md`
  - Do: describe the Go-source stdlib, natives and intrinsics, lazy checking, and a per-package "where does it live" table (Go directory plus natives, or emitter).
  - Test: `test/unit/compiler/plan-paths.test.js` passes.
  - Done when: `docs/architecture.md` matches the tree after Task 12.2.
