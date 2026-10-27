# Portable Go Completion — Design Plan

**Version:** v1.8.0
**Status:** In Progress (2026-10-20); simplification phases 8–11 added 2026-10-27
**Base branch:** main
**Related:** Depends on v1.7.0 ([`json-preact-simd-plan.md`](../v1.7.0/json-preact-simd-plan.md)), including the JS `encoding/json` hardening on the v1.7.0 branch. Replaces the dropped v1.7.1 plans. Their stdlib items (`bufio`, `context`, `net/url`; built in Phase 4, removed again by D2), the WASM interior-pointer problem and the SIMD completion and SoA work move here. Boundary slice borrowing (a performance optimisation, not a completeness item) is not part of this plan. The v2.0.0 native Go engine ([`native-go-engine.md`](../v2.0.0/native-go-engine.md)) is shelved, so v1.8.0 is no longer a JS-engine feature freeze.

---

## Goal

> **Superseded (2026-10-27):** Items 3 (`bufio`, `net/url`, `context`, `encoding/csv` and most pure packages) and 5 (manifest and real-Go conformance gate), the matching **Done means** bullets, and scalar field/element pointers in `wasm`/`both` packages (item 1) are dropped by Phases 8–11. See [Simplification](#simplification-phases-811-decided-2026-10-27).

Make GoFront **as complete as possible inside the boundaries it sets**: no runtime (no scheduler, no reflection, no raw memory), and browser/host APIs only in `js` packages.

v1.6.1 closed the obvious WASM gaps package by package. v1.8.0 changes the question from "what is missing in WASM compared with JS?" to "what pure Go is missing from GoFront?" It answers that question with a measured reference instead of a hand-written list:

1. **WASM language parity.** Every language feature that works in `js` packages works in `wasm`/`both` packages. If it cannot, it gets a targeted diagnostic, never an invalid module or an internal error. This includes the silent-wrong-result cases found while writing this plan: array aliasing, pointers to fields and elements, per-iteration loop variables, and constant expressions that overflow a JS shift.
2. **A Go-source stdlib.** Pure packages are written once in GoFront Go and compiled for both targets. Without this, each package needs a hand-written JS shim and a separate hand-written WASM emitter.
3. **The portable data layer.** `encoding/json` in `wasm`/`both` packages, `bufio`, `net/url`, `context`, `encoding/csv`, `iter`/`cmp` and the Go 1.23 iterator APIs, plus the pure packages that are commonly imported (`container/*`, `hash/*`, extra `crypto/*`, `unicode/utf16`, `math/cmplx`, `sync/atomic`, `log`, `math/rand/v2`).
4. **Member completion.** Common members still missing from packages GoFront already supports (for example `fmt.Sprint`, `%T`, `sort.Sort`, `utf8.EncodeRune`, `os.Stdout` as an `io.Writer`, `time.Time` JSON).
5. **A coverage gate.** A checked-in manifest derived from Go's API files. Every in-scope member is either supported on both backends or listed as excluded with a reason, signatures match Go's, and conformance fixtures compare GoFront output against real Go output.
6. **SIMD completion.** `gofront/simd` becomes a complete value-type package: `F32x4` works everywhere a `[4]float32` works, and the package gains masks, comparisons, select, rounding, shuffles, SoA types (`Vec3x4`, `AABB4`, `Ray4`) and batch load/store helpers. Promotion from experimental to stable is decided separately, by a benchmark gate. A missed gate does not block the API work or the release.

**Done means:**
- No language construct accepted in a `js` package produces an invalid `.wasm` module, an internal compiler error, or a different result in a `wasm`/`both` package. The two accepted, documented divergences are numeric `any` (type switches and equality on numbers held in `any`) and the UTF-16 string model shared by both backends (see [§1.1](#11-string-semantics-both-backends)).
- Every in-scope package and member in the manifest (see [Scope rule](#scope-rule)) is supported on JS and WASM with Go's signature (aside from the intentional GoFront type-system representation differences recorded in `test/unit/types/stdlib-coverage.gaps.json` under `signature`, see Task 1.2b), or excluded with a stated reason (`gaps.missing`, `gaps.wasm`, and `gaps.exclusion` are all empty).
- `encoding/json` and `encoding/csv` produce the same output as Go on the conformance corpus, on both backends.
- `gofront/simd` produces the same results on both backends (NaN payloads aside), and the promotion decision is recorded in this document with the benchmark numbers.
- [`go-compatibility.md`](../../docs/go-compatibility.md), [`language-support.md`](../../docs/language-support.md) and [`hybrid-wasm.md`](../../docs/hybrid-wasm.md) are generated from, or checked against, the same manifest.

---

## Scope rule

> **Superseded (2026-10-27):** The category rule still holds, but packages removed by D2 are no longer supported, and there is no manifest to record per-member classification. See [Simplification](#simplification-phases-811-decided-2026-10-27).

A Go package or member is **in scope** when it can be implemented as ordinary compiled code over values GoFront already has, with no scheduler, no runtime type metadata, and no host service beyond what the target already imports (clock, random source, console).

| Category | Rule | Examples |
|---|---|---|
| **In scope: pure** | Supported on `js`, `wasm` and `both` | `encoding/csv`, `container/heap`, `hash/crc32`, `cmp`, `iter`, `unicode/utf16` |
| **In scope: JS-only by design** | Supported in `js` packages; targeted diagnostic in `wasm` | `regexp`, `time.Sleep`, `os`, DOM, `context.Signal()` |
| **Excluded: runtime** | Targeted diagnostic everywhere | goroutines, channels, `select`, `reflect`, `unsafe`, `runtime`, `weak`, `unique` |
| **Excluded: host** | Targeted diagnostic everywhere | `net/http`, `net`, `os/exec`, file I/O in `os`, `syscall` |
| **Excluded: needs reflection** | Targeted diagnostic everywhere | `text/template`, `html/template`, `encoding/xml`, `encoding/gob`, `flag` |
| **Excluded: deferred (pure, large)** | Pure and inside the boundary, but the code size or API surface does not pay for itself in a frontend compiler. Targeted diagnostic with `deferred; open an issue if you need it`. Revived by a separate plan, never ad hoc. | `math/big`, `compress/*`, `archive/*`, `image/*`, `crypto/{aes,cipher,rsa,ecdsa,ed25519,x509,tls,elliptic}`, `encoding/{asn1,pem,ascii85}`, `text/{tabwriter,scanner}`, `go/*`, `debug/*`, `hash/{crc64,maphash}`, `unicode` range tables (`unicode.Is`/`In`, script and category tables), `embed` |
| **Excluded: this plan** | Inside the boundary but not built in v1.8.0, each with its reason | Everything listed under [Out of Scope](#out-of-scope) |
| **Excluded: trimmed overlays** | Go-source members added in this cycle and removed again by Task 9.4 (D4) before release: no emitter, no user in `stdlib/`/`example/`, and a measurable `gofront check` cost on every import of their package. `EXCLUDED_STDLIB_MEMBERS` gives them a `not supported` diagnostic. | `unicode.Is`/`In`/`RangeTable` and the category tables, `math.Gamma`/`Erf`, `sync.Map`/`Pool`, `fmt.Fscan`/`Fscanln`/`Fscanf`, `strconv.*ToGraphic` |
| **Excluded: deferred (review follow-ups)** | Bugs recorded by the PR #41–#52 reviews that are not scheduled here. They stay in [`plans/follow-ups.md`](../follow-ups.md) with their repros (not copied into this plan) and are re-triaged by `/execute-plan` Step 4.2 after Phases 8–11, when D5 has removed the scalar interior-pointer cases among them. | The `portable-go Phase 0.11–3.2` entries in the ledger |

`encoding/json` stays in scope because GoFront generates codecs at compile time. That is the precedent: **compile-time specialization of a reflective API is allowed; a reflective runtime is not.**

**Member-level classification for packages that straddle categories.** The manifest (Task 1.1) records these per member; the rule here is the tie-breaker:

| Package | Pure (both) | JS-only by design | Excluded (reason) |
|---|---|---|---|
| `time` | Everything that is arithmetic, parsing or formatting, including `Time.MarshalJSON`/`UnmarshalJSON`/`MarshalText`, `Duration` JSON, `AddDate`, `Truncate`, `Round`, `Compare`, `YearDay`, `ISOWeek`, `FixedZone`, `UTC` | `Sleep`, `AfterFunc`, `Timer.Stop`/`Reset` (event loop) | `After`, `Tick`, `NewTicker`, `NewTimer`, `Timer.C` (channels); `LoadLocation` (tz database) |
| `sync` | `Mutex`, `RWMutex`, `Once`, `OnceFunc`, `OnceValue`, `OnceValues`, `WaitGroup`, `Map`, `Pool` as single-threaded shims | — | `Cond` (blocking wait) |
| `os` | `Stdout`, `Stderr` as `io.Writer` over the console import; `Stdin` as an `io.Reader` that always returns `io.EOF` | `Args`, `Getenv`, `Exit` | files, processes, signals |
| `testing` | `T` (existing members plus `Cleanup`, `Context`, `Setenv`, `Deadline`), `B` (`N`, `ResetTimer`, `ReportAllocs`, `Loop`), `M`/`TestMain`, `Short`, `Verbose` | — | `TempDir`, `Chdir`, `Parallel` is a no-op, fuzzing |
| `fmt` | Everything, including `Fscan*` over `io.Reader`, `Formatter`, `GoStringer`, `State` | — | — |
| `strconv` | Everything, including `ParseComplex`/`FormatComplex` (after complex lowering) | — | — |
| `unicode` | Predicate functions (`Is*`), `To*`, `SimpleFold`, `In`/`Is` over the **general-category** tables (`Letter`, `Digit`, `Space`, `Upper`, `Lower`, `Punct`, `Symbol`, `Mark`, `Number`), plus `MaxRune`/`ReplacementChar` | — | Script tables (`Han`, `Latin`, …), `Properties`, `CaseRanges`, `SpecialCase` (table size) |
| `log` | `Logger`, `New`, `Default`, `Print*`, `Fatal*`, `Panic*`, `SetFlags`, `SetPrefix`, `SetOutput`, `Flags`, `Prefix`, `Writer`, flag constants | — | `Lshortfile`/`Llongfile` flags are accepted and print `???:0` (no caller metadata) |
| `math/rand/v2` | Top-level functions, `Rand`, `PCG`, `Source`, `N` | — | `ChaCha8` (deferred, size) |

---

## Verified gaps (2026-10-20, v1.7.0 tree)

These were confirmed while writing this plan. The Phase 1 audit produced the complete list: the coverage gate's gaps file, assigned to tasks in [Task 1.5](#phase-12-conformance-harness-documentation-and-reconciliation). Every stdlib row below is scheduled there.

| Area | Finding | Evidence |
|---|---|---|
| Array value semantics in WASM | **Silent wrong results.** Fixed-size arrays alias instead of copying: after `b := a; b[0] = 9`, `a[0]` is `9`. Passing an array to a function also lets the callee mutate the caller's array. This affects `[N]float32` and `[N]simd.F32x4` alike. JS packages are correct. | Probe: a `both` package passes `[js]` and fails `[wasm]` for local assignment and for a parameter |
| Predeclared-name shadowing | A package-level `func Array()` fails with `Array redeclared in this block`, because browser globals are declared in the same scope as package declarations. Go lets package declarations shadow predeclared names. | Probe: a `both` package declaring `func Array()` |
| Pointers to fields/elements in WASM | **Silent wrong results.** `&s.X` and `&xs[i]` (scalar `X`/element) copy the value into a fresh box, so writes through the pointer are lost. JS packages are correct, and [go-compatibility](../../docs/go-compatibility.md) documents the JS behaviour for both targets. | Probe: a `both` package with `set(&s.X, 7)` and `*(&xs[1]) = 9` passes `[js]` and fails `[wasm]` (`Field() = 0`, `Elem() = 2`); [`emit-exprs.js`](../../src/backend/wasm/emit-exprs.js) `case "&"` emits `struct.new` of the box type |
| Range-over-func in WASM | `for v := range seq` over any `func(yield func(V) bool)` is lowered as a slice range. The module fails validation (`array.len expected arrayref`). JS packages work. | Probe: one `wasm` package with a non-generic `func(yield func(int) bool)`; `gofront test` fails at `WebAssembly.instantiate` |
| Generic named func types in WASM | `type Seq[V any] func(yield func(V) bool)` returned from a function produces `type error in return[0]` | Same probe with `Seq[int]` |
| Complex numbers in WASM | `complex()`, `real()`, `imag()` report `Unresolved identifier: complex`, an internal error rather than a diagnostic | Probe: one `wasm` package; [`src/backend/wasm/`](../../src/backend/wasm/) has no complex lowering |
| Per-iteration loop variables in WASM (Go 1.22) | **Silent wrong results.** `for i := 0; i < 3; i++ { fs = append(fs, func() int { return i }) }` calls give `0,1,2` in JS and `3,3,3` in WASM. The three-clause `for` shares one captured box across iterations. `range` loops are correct on both backends. | Probe: a `both` package returning `fs[0]()*100 + fs[1]()*10 + fs[2]()` gives `12` in JS and `333` in WASM |
| `min`/`max` builtins in WASM | `min(3, 1, 2)` reports `Unresolved identifier: min`, an internal error. JS packages work. [`emit-builtins.js`](../../src/backend/wasm/emit-builtins.js) handles `cap`, `copy`, `clear`, `print` but not `min`/`max`. | Probe: a `both` package calling `min`/`max` |
| `[]rune` indexing in WASM | `r := []rune(s); string(r[1])` produces an invalid module (`local.tee expected (ref null 21), found call of type externref`). | Probe: a `both` package; `gofront test` fails at `WebAssembly.validate` |
| Untyped constant expressions in JS | **Silent wrong results in `js` and `both` packages.** `var x int64 = 1 << 40` emits a JS `<<`, whose shift count wraps modulo 32, so `x == 256`. `1<<63 + 5` becomes `-2147483643`. Go evaluates constant expressions exactly at compile time. The WASM backend folds them correctly in [`const-fold.js`](../../src/backend/wasm/const-fold.js); the JS backend has no folder. | Probe: a `both` package returning `float64(x * 1000)` gives `256000` in JS and `1099511627776000` in WASM |
| Generic type aliases (Go 1.24) | `type Set[T comparable] = map[T]struct{}` then `Set[int]{}` reports `Unknown struct in CompositeLit: undefined`, an internal error on both backends | Probe |
| Method expressions with a pointer receiver | `(*C).Inc` reports `cannot dereference non-pointer type C` on both backends. [`language-support.md`](../../docs/language-support.md) lists method expressions as supported; only the value-receiver form `T.M` works. | Probe |
| Runtime panics in `both` packages | **Different results.** Out-of-range slice index: JS yields `undefined`, WASM panics. Write to a nil map: JS succeeds, WASM panics. Field read through a nil struct pointer: WASM panics with Go's message, JS does not. Strict numeric mode covers only integer division by zero. | Probe: three `both` packages with `defer`/`recover` return `"nopanic"` in JS and `"panic"` in WASM |
| Array value semantics on container loads | `a := m["x"]` and `a := xs[0]` alias the stored array in WASM, so `a[0] = 9` writes into the map or slice. JS copies. | Probe: `both` packages return `5` (JS) and `9` (WASM) |
| `fmt` `%d` of `uint64` ≥ 2⁶³ in WASM | Prints `9223372036854776000` instead of `9223372036854775813`: the value is converted to `f64` before formatting. `strconv.FormatUint` is exact. | Probe |
| `fmt` verbs | `%T`, `%U` and `%p` are not in the verb set and print literally on both backends. `%q` on a rune prints `"120"` instead of `'x'`. The `#` flag is parsed and ignored, so `%#v` equals `%v`. | [`runtime.js`](../../src/backend/js/runtime.js) format regex `[sdvftxXqobeEgGwc%]`; [`emit-stdlib.js`](../../src/backend/wasm/emit-stdlib.js) format regex |
| Type switch on `any` holding a float | `switch any(3.0).(type)` matches `case int` in JS and `case float64` in WASM. Same root cause as the documented `any == any` row: JS has one number type. | Probe |
| Stdlib signatures | `strconv.ParseInt` is declared as returning `(int, error)`; Go returns `(int64, error)`. A manifest that compares member **names** does not find this. | [`core.js`](../../src/typechecker/stdlib/core.js) `strconv.ParseInt` |
| `goto` | `Undefined: 'goto'`. Not mentioned in any plan; [`go-compatibility.md`](../../docs/go-compatibility.md) says "Not planned". | Probe |
| Generic calls inside generic bodies in WASM | `Compare[T]` calling `isNaN[T]` reports `Undefined: 'isNaN'`: monomorphisation dropped the inferred type arguments of a generic call when it copied a generic body. **Fixed in Phase 0.4.** | Found while landing `cmp` (Task 0.6a) |
| Generics in multi-package WASM builds | A linked `app.wasm` with any generic declaration fails on every cross-package reference (`Undefined: 'util'`): the monomorphisation re-check has no package namespaces. **Fixed in Phase 0.4.** | Probe: a `wasm` package calling `util.Two()` next to a generic `util.Id` |
| Variadic functions | `func f(xs ...T)` produces an invalid module in WASM (no rest-parameter lowering). On both backends the checker types `xs` as `T` instead of `[]T` inside the body, and JS methods and func literals lose the rest parameter. **Fixed in Phase 0.4.** | Probe: `sum(1, 2, 3)` in a `both` package fails `WebAssembly.validate` |
| Generic zero values in JS | **Silent wrong results.** JS output erases generics, so `var zero T` is `null`: `cmp.Or("", "x")` returns `""` in JS and `"x"` in WASM, and a generic `Stack[int].Pop` on an empty stack returns `null`. The checker also rejects unary `-` on a numeric type parameter (`- requires numeric`). **Fixed in Phase 0.8.** | `cmp.Or` parity test (Task 0.6a); Task 0.18 |
| `fmt` | `Sprint`, `Sprintln`, `Append*`, `Stringer` missing | [`src/typechecker/stdlib/core.js`](../../src/typechecker/stdlib/core.js) `fmt` namespace |
| `sort` | `Sort`, `Stable`, `Interface`, `Reverse`, `IsSorted`, `Search{Ints,Strings,Float64s}`, `{Int,String,Float64}Slice` missing | `sort` namespace |
| `unicode/utf8` | Byte-slice API missing: `EncodeRune`, `AppendRune`, `DecodeRune`, `DecodeLastRune`, `RuneCount`, `FullRune` | `utf8` namespace |
| `io` | `MultiReader`, `MultiWriter`, `TeeReader`, `NopCloser`, `ReadAtLeast`, `StringWriter`, `ByteReader`, `ByteWriter`, `RuneReader` missing | `io` namespace |
| `strconv` | `NumError`, `QuoteRune`, `QuoteToASCII`, `AppendQuote` missing | `strconv` namespace |
| `math` | `Log1p`, `Expm1`, `Frexp`, `Ldexp`, `Modf`, `FMA`, `RoundToEven`, `Nextafter` missing | `math` namespace |
| `math/bits` | `Add64`, `Sub64`, `Mul64`, `Div64` (and 32-bit forms) missing | `bits` namespace |
| `time` | `ParseDuration`, `Duration.Truncate`/`Round`/`Abs` missing | `time` namespace |
| `unicode` | `IsNumber`, `IsSymbol`, `IsMark`, `IsTitle`, `SimpleFold` missing | `unicode` namespace |
| `strings` / `bytes` | `ToValidUTF8`, `bytes.NewBuffer`, `bytes.NewBufferString`, iterator forms (`Lines`, `SplitSeq`, `FieldsSeq`) missing | `strings`/`bytes` namespaces |
| `errors` | `ErrUnsupported` missing | `errors` namespace |
| `os` | `Stdout`/`Stderr` are typed `any`, so `fmt.Fprintf(os.Stderr, …)` is unchecked and `os.Stdout` is not an `io.Writer` | [`core.js`](../../src/typechecker/stdlib/core.js) `os` namespace |
| `sync` | `Map`, `Pool`, `OnceFunc`/`OnceValue`/`OnceValues` missing | `sync` namespace |
| `testing` | `t.Cleanup`, `t.Context`, `t.Setenv`, `testing.B`, `TestMain` missing | `testing` namespace |
| `maps` | `Keys`/`Values` return slices; Go 1.23 returns `iter.Seq`. `All`, `Collect` missing | [`extended.js`](../../src/typechecker/stdlib/extended.js) `_derivedReturn: "keysOfArg0"` |
| `slices` | `All`, `Values`, `Backward`, `Collect`, `AppendSeq`, `Sorted`, `SortedFunc`, `Chunk` missing | `slices` namespace |
| Missing packages | `bufio`, `net/url`, `context`, `iter`, `cmp`, `container/{heap,list,ring}`, `hash`, `hash/{crc32,fnv,adler32}`, `crypto/{sha1,sha512,md5,hmac,subtle}`, `encoding/{csv,base32}`, `unicode/utf16`, `math/cmplx`, `sync/atomic` | [`STDLIB_PACKAGES`](../../src/typechecker/types.js) |
| `simd.F32x4` equality | `a == b` passes the checker but crashes the WASM encoder with `Unsupported WASM instruction opcode: 'v128.eq'` (an internal error) | Probe; `v128.eq` is not an instruction (it would be `f32x4.eq` followed by `i32x4.all_true`) |
| `simd.F32x4` in exported API | An exported struct with an `F32x4` field, or an exported function with an `F32x4` parameter, fails the whole build in a `wasm`/`both` package (`cannot cross the JS↔WASM boundary in 1.7.0`), even if JS never uses it | Probe; [`boundary.js`](../../src/backend/wasm/boundary.js) `classifyType` `case "simd"` |
| `simd.F32x4` formatting | `fmt.Sprintf("%v", v)` is rejected in WASM (`only primitive, string, error and any arguments are supported`) | Probe |
| `gofront/simd` API | No comparisons, masks, `bitselect`, `any_true`/`all_true`, lane-wise `Sqrt`/`Abs`/`Neg`/rounding or shuffles. The encoder already has `f32x4.abs`/`neg`/`sqrt` and `i8x16.shuffle` opcodes, but the checker does not expose them. | [`typechecker/stdlib/simd.js`](../../src/typechecker/stdlib/simd.js), [`encode.js`](../../src/backend/wasm/encode.js) |
| `encoding/json` | Rejected in WASM with a diagnostic. JS packages lack `Encoder`/`Decoder`, `Number`, `Compact`/`Indent`/`HTMLEscape` and typed errors. (Case-insensitive matching, Go `null` semantics, integer range errors, exact `RawMessage` bytes and float32 formatting landed in JS on the v1.7.0 branch.) | [`v1.7.0` plan](../v1.7.0/json-preact-simd-plan.md) Phase 1; [`json.test.js`](../../test/unit/builtins/json.test.js) |

### Review follow-ups (2026-10-24)

Probed on `feat/portable-go` at `a697b9b`. The reviews of PRs #28–#40 listed bugs as "Low, not fixed" or "pre-existing, outside this diff" that no task owned. They were re-probed against go1.26 on the branch head: each probe is a `both` package run through `compileHybrid` (or `compileHybridProject` where a Go-source package is imported) and compared with `go run`. Probe IDs (P01…) are referenced from the tasks in [Phases 0.11–0.14](#phase-011-lexer-escapes-and-integer-semantics). Rows that already pass on the head (`int * 2.0`, `a[^uint8(0)]`, labeled `continue` across range-over-func, two instantiations behind one interface, `&P{…}` formatting, `%q` on strings, `heap pop` write-through, nil pointer-receiver method values) are not listed.

| Area | Finding | Evidence & probe |
|---|---|---|
| String escapes (lexer) | **Silent wrong results on both backends.** `len("\x00")` is 4 and `len([]byte("\xc3"))` is 4; Go gives 1. `readString` decodes only `\n`, `\t`, `\r`, `\"`, `\\` and `\0`; every other escape (`\x`, `\u`, `\U`, octal, `\a`, `\b`, `\f`, `\v`) stays as raw source text. | [`src/lexer.js`](../../src/lexer.js) `readString`, `default:` branch (line 249). P01, P02 (PR #39) |
| Unsigned unary operators in JS | **Silent wrong results.** `^x` with `x uint8 = 5` gives `-6` and `-z` with `z uint32 = 1` gives `-1` in JS. Go and WASM give `250` and `4294967295`. | P03 (PR #32) |
| 64-bit shifts in JS | **Silent wrong results.** `var x int64 = 1; n := 70; x << n` is `64` in JS (Go `0`). `-1 << 64` is `-1` (Go `0`). JS wraps the shift count modulo 32. | P04, P51 (PR #30) |
| Shift count typing | `x <<= n` with `n uint` is rejected (`Cannot assign uint to int`); Go accepts any integer count type. `x << s` with `const s = -1` compiles without an error; Go reports `invalid shift count`. | P50; negative-count probe returned `errors: []` (PR #30) |
| Type-parameter struct values in JS | **Silent wrong results.** `eq[T comparable](P{1}, P{1})` is `false` in JS (`==` compares references); `b := a` on a `W[P]` shares the field, so `b.v.A = 9` changes `a`. WASM is correct. | P06, P07 (PR #32) |
| Variadic spread in JS | `sum(xs...)` with a nil `xs` throws `xs is not iterable`. `set(a...)` receives a copy, so `xs[0] = 9` inside `set` does not reach `a` (Go and WASM: 9). | P08, P09 (PR #28); [`expressions.js`](../../src/backend/js/expressions.js) emits `...expr` (line 1435) |
| Nil maps and slices in JS | `var m map[string]int; m == nil` is `false` in strict mode (`m` is the frozen `__nilmap`, compared with `=== null`). `fmt.Append(nil) == nil` is `false`. | P60, P17 (PR #31, #39); `expressions.js` lines 1176, 2129 |
| Struct literals and embedded fields in JS | `[]*P{{1}, {2}}` elements are `undefined` (the elided `&P` is not emitted). `o.A = 5` through an embedded `In` does not reach `o.In.A` (JS `10`, Go `52`). `fmt.Sprint(map[P]int{P{1}: 2})` prints `map[[object Object]:2]`. | P14, P70, P15 (PR #40) |
| Package-level arrays and named scalars | JS: `p := &g` on `var g [3]int` throws `Cannot set properties of undefined`; `var a [N]int` with `const N = 3` emits invalid JS (`Unexpected identifier 'Object'`); `g.Inc()` on `var g C` (`type C int`, pointer receiver) throws `Cannot create property 'value' on number`. WASM: reading `var g [3]int` panics with a nil dereference, and `[N]int` has length 0. | P21, P22, P23, P29 (PR #33) |
| Composite literal keys | `map[P]int{{1}: 2}` fails to parse (`Unexpected token in expression: ':'`): an element that starts with `{` is pushed without checking for a following `:`. | [`src/parser/expressions.js`](../../src/parser/expressions.js) `parseCompositeLit` (line 371). P13 (new) |
| Named type over a named array | `type V [2]int; type W V; W{1, 2}[1]` reports `Cannot index type W`. | P24 (PR #33) |
| Explicit instantiation through a package | `cmp.Compare[int](1, 2)`, `slices.Collect[int](…)` and `iter.Seq[int](f)` report `Undefined: 'int'` and `Cannot index type Compare$$cmp` on both targets. | P11, P12, P74 (PR #28, #37) |
| Recursive generic types | `type List[T any] struct { V T; Next *List[T] }` crashes the compiler with `Maximum call stack size exceeded` on both targets. | P10 (PR #37) |
| Generic named types | A promoted method through an embedded struct in a generic struct is rejected (`No field 'N' on Out[int]`). `type S3[T any] Base` with methods is an internal error (`Unknown struct in CompositeLit: S3$int`). In JS, `case *Stack[int]` matches a `*Stack[string]` (generics are erased); WASM is correct. | P44, P45, P42 (PR #37) |
| Pointer stability on whole-value assignment | **Silent wrong results on both backends.** `p := &a[1]; a = [3]int{4, 5, 6}; *p` gives `2` (Go `5`). `p := &s; s = S{5}; p.A` gives `1` (Go `5`). Assigning a whole array or struct replaces the storage that existing pointers refer to instead of writing into it. | P20, P25 (PR #33) |
| Named types with methods in WASM | A value method called through `*N` (`type N int`) gives an invalid module. `l.Add(v)` on `type L []int` with a pointer receiver leaves `len(l)` at 0 (JS 2). | P26, P28 (PR #33) |
| Stdlib functions as values in WASM | `var sp = fmt.Sprint` is an internal error (`Cannot resolve struct for selector: Sprint`). | [`emit-exprs.js`](../../src/backend/wasm/emit-exprs.js) line 506. P72 (new) |
| Iterators in WASM | Ranging over a func literal is an internal error (`reading '_globalFuncIndex'`). An iterator that yields `*P` gives an invalid module (`function body must end with "end" opcode`). `slices.Values` over `[]Box[int]` gives an invalid module (`call_ref` type mismatch). JS is correct in all three. | P46, P47, P40 (PR #37, #38) |
| `fmt` leftovers | `fmt.Sprintf(f, args...)` and `fmt.Println(xs...)` with `[]any` give an invalid WASM module. A nil `*C` whose `String` has a pointer receiver prints `<nil>` on both backends; Go calls `String` (`c`). Assigned to [Tasks 3.1b-any and 3.1b-wasm](#phase-312-fmt-on-wasm-any-arguments-and-stringererror-dispatch). | P62, P63, P69 (PR #28, #40) |
| `unicode.IsSpace` and `bytes.Index` | `unicode.IsSpace` differs from Go: JS uses `/\s/` (misses U+0085, matches U+FEFF), WASM only tests 9–13 and 32. `strings.Fields`/`FieldsSeq` follow it. `bytes.Index([]byte("héllo"), []byte("l"))` is `2` in JS (Go and WASM `3`). Assigned to [Tasks 3.3b and 3.4c](#phase-32-io-sort-unicode-and-strconv-completion). | [`unicode.js`](../../src/backend/js/stdlib/unicode.js) line 13, [`pure.js`](../../src/backend/wasm/stdlib/pure.js) line 43. P16, P48 (PR #38) |

---

## Out of Scope

- Everything in the **Excluded** rows of the [Scope rule](#scope-rule).
- **`regexp` in WASM.** It still needs either an RE2 engine or a host call per match (see [v1.6.1](../v1.6.1/wasm-gaps-plan.md#out-of-scope)). It stays JS-only.
- **`math/big`** and the other **deferred (pure, large)** packages in the [Scope rule](#scope-rule). Each is deferred to a separate plan if a user asks for it.
- **`log/slog`.** It is a candidate for v1.8.x once `log` and the Go-source stdlib exist. (`log` and `math/rand/v2` are **in** scope: see [§7](#7-new-pure-packages-go-source).)
- **`goto`.** It is inside the no-runtime boundary, but neither backend has unstructured control flow and both would need a loop-plus-state-machine lowering for a construct that is rare in idiomatic Go. It stays a targeted diagnostic (`goto is not supported; restructure with labeled break/continue`) in every target, and the parity matrix checks that diagnostic. Revisit only with a user request.
- **`//go:embed` and `embed.FS`.** Compile-time by definition, so it passes the scope rule, and it is useful for shaders and templates. It needs resolver and asset-pipeline design that does not fit this release. Listed as deferred; targeted diagnostic `//go:embed is not supported yet`.
- **Runtime-panic parity in `js` packages.** `js` packages keep JavaScript's behaviour for out-of-range indexing and nil-map writes (documented in [`go-compatibility.md`](../../docs/go-compatibility.md)). Only strict-mode packages (`both`) gain the checks, see [§1](#1-wasm-language-parity).
- **Type switches and `any` equality on numbers in `both` packages.** `any(3.0)` is `int` in JS and `float64` in WASM. Boxing every number to fix this would slow every DOM call. The divergence stays documented, the parity matrix marks the row as an accepted difference, and conformance fixtures do not depend on it.
- **Byte-exact Go string semantics.** `len(s)`, `s[i]` and `range` indices stay UTF-16 based on both backends (see [§1.1](#11-string-semantics-both-backends)). Changing the string representation is a v2.x decision.
- **Exact `int64`/`uint64` JSON parity beyond 2⁵³ in `both` packages.** WASM is exact. The JS backend keeps `Number` for `int64` so DOM, Canvas and WebGL calls stay fast. The parity corpus stays within ±2⁵³.
- **Boundary slice borrowing** (from the dropped v1.7.1 plans). It is a performance optimisation and needs its own plan if revived.
- **SIMD beyond `F32x4`:** `F64x2`, `I32x4`/`I16x8`/`I8x16` arithmetic vectors, relaxed SIMD (including fused multiply-add, which is non-deterministic across hardware), auto-vectorisation, matrix types, and threaded/`SharedArrayBuffer` SIMD. `Mask32x4` is the only integer-lane type.
- **`context.Context.Done()`.** It returns a channel, and channels are out of scope. See [§6](#6-bufio-neturl-and-context-go-source).
- **Cyclic JSON graphs, `TextMarshaler` map keys, struct tag options other than `json`/`csv`.**
- **Migrating existing emitter-backed packages to Go source.** Only new packages and new pure members use the Go-source stdlib.
- **New boundary types.** The v1.7.0 boundary is unchanged, except that `iter.Seq`/`Seq2` values cross like any other `func` value, and pointer-to-scalar parameters may now carry accessor refs (same JS-side `{ value }` box).
- **Diagnostic-quality and tooling leftovers from the PR #28–#40 reviews.** They do not change what a valid program does, so they stay out of the follow-up phases: integer literals above 2⁵³ without a precision warning, constraints not checked on type arguments inferred in a partial instantiation, a duplicate diagnostic on `Two[int]()`, the generic-alias arity error without a position, `//gofront:intrinsic` accepted outside `runtime/stdlib`, the `conformance:update` / `manifest:update` argument nits (a directory argument such as `test/conformance` selects no fixture), and the `compile`/`compileHybrid` test helpers not loading Go-source stdlib packages (tests use `compileHybridProject`; the CLI is not affected).

---

## Approach

### 1. WASM language parity

The findings below are language features, not library features. `iter` cannot ship without range-over-func and generic func types.

- **Array value semantics.** `[N]T` is a value type. Assignment, parameter passing, returns, struct-field copies, storage in slices, maps and interfaces, **and loads from them** (`a := m["x"]`, `a := xs[i]`, `a := s.Arr`) must copy, using `array.copy` into a fresh `array.new`. Reuse the existing clone-elision analysis from [`src/lower/ownership.js`](../../src/lower/ownership.js) so that copies are skipped when the source is dead or never mutated. This is the same mechanism value structs already use.
- **Predeclared-name shadowing.** Browser globals and other predeclared names move to the universe scope. Package and local declarations shadow them as in Go, in every target. Shadowing a browser global in a `js` package then hides that global for the rest of the package, which is also Go's rule.
- **Pointers to scalar fields and elements.** Implement Go semantics; do not reject them. JS packages already support them, and a diagnostic would make `both` packages that compile today stop compiling. A scalar pointer type `*T` becomes an abstract WasmGC supertype with two subtypes:
  - the existing box (`struct { mut value T }`), used for `&x` and `new(T)`; and
  - an **accessor ref** (`struct { anyref target, i32 index, ref $get_T, ref $set_T }`), used for `&s.F` and `&xs[i]`. The getter and setter functions are emitted once per (container type, field) or per element type.

  `*p` and `*p = v` test for the box subtype first (`br_on_cast`). That keeps the common `&x` path as fast as today, and only accessor refs pay for the indirect call. `&xs[i]` binds the slice's backing array and absolute index, so it keeps aliasing the element after `xs` is resliced, as in Go. At the boundary, an accessor ref is read into the existing `{ value }` copy-in/copy-out box and written back through the setter. Struct-typed fields (`&s.Inner`) keep using the struct reference directly, as today.
- **Range-over-func.** Lower `for k, v := range f` in [`emit-stmts.js`](../../src/backend/wasm/emit-stmts.js) the same way the JS backend does. Synthesize a WASM closure for the loop body that returns `i32` (continue = 1, stop = 0), and add a per-loop state local for `break`, `continue`, labeled jumps, `return` and `panic` propagation. Go's "continued iteration after the loop body returned false" panic must be matched on both backends.
- **Generic named func types.** Fix monomorphisation ([`monomorph.js`](../../src/backend/wasm/monomorph.js)) and the type mapping ([`types.js`](../../src/backend/wasm/types.js)) so that `Seq[int]` resolves to the same closure type as its underlying `func(yield func(int) bool)`.
- **Complex numbers.** `complex64`/`complex128` become an immutable WasmGC struct `{re, im}` of `f32`/`f64`. Use the same operator semantics as the JS `__cmul`/`__cdiv` helpers so that `both` packages agree. `complex`, `real`, `imag`, `==`, `!=`, conversions, `fmt` `%v`/`%g` and map keys are all covered.
- **Per-iteration loop variables.** Go 1.22 gives each iteration of a three-clause `for` its own copy of the loop variable. JS gets this for free from `let`. In WASM, [`emit-stmts.js`](../../src/backend/wasm/emit-stmts.js) must allocate a fresh box per iteration when the variable is captured (the capture analysis in [`src/lower/captures.js`](../../src/lower/captures.js) already knows), copy the value in at the top of the body and copy it back before the post statement, as the Go compiler does. Uncaptured loop variables keep using a plain local.
- **`min`/`max` builtins.** Lower in [`emit-builtins.js`](../../src/backend/wasm/emit-builtins.js): integers use `select` on a comparison; floats use `f32.min`/`f64.min` (which already propagate `NaN` and order `-0 < +0` like Go); strings compare with the existing string-compare import. Variadic forms fold left.
- **`[]rune` conversions.** Fix the type of the `[]rune(s)` result in WASM (a `(ref null $runes)` array, not `externref`) so indexing, `len`, `append` and `string(r[i])` type-check in the module.
- **Constant folding in JS.** Add a backend-independent constant evaluator in [`src/lower/`](../../src/lower/) (move [`const-fold.js`](../../src/backend/wasm/const-fold.js) there and make both backends use it). Untyped constants use `BigInt` for integers and exact rationals are not needed: Go's rules for the operations GoFront accepts (`+ - * / % << >> & | ^ &^`, comparisons, conversions) are reproducible with `BigInt` plus `Number` for floats. The JS backend emits the folded literal; `1 << 40` becomes `1099511627776`. Typed constant overflow (`int32(1 << 40)`) is a compile error, as in Go. Values above 2⁵³ in `js` packages are emitted as the nearest `Number` with a `constant … overflows JS Number precision` warning, matching the existing `int64` precision rule.
- **Generic type aliases.** `type A[P any] = T[P]` is Go 1.24. Resolve the alias at instantiation in [`src/typechecker/`](../../src/typechecker/) by substituting the type arguments into the aliased type, so `Set[int]` is exactly `map[int]struct{}`. No backend work.
- **Method expressions on pointer receivers.** The parser treats `(*C).Inc` as a dereference. Parse a parenthesised `*T` followed by `.Name` as a method expression when `T` names a type; the checker produces `func(*C)` as Go does. Both backends already emit method values, so the lowering reuses that path.
- **Runtime panics in strict mode.** `both` packages already panic on integer division by zero in JS. Extend strict mode so that the three remaining cases match WASM: out-of-range slice, array and string indexing (`__at(xs, i)` / `__set(xs, i, v)` helpers that throw Go's `index out of range [i] with length n`), writes to a nil map (`assignment to entry in nil map`), and field access through a nil struct pointer (`invalid memory address or nil pointer dereference`). The helpers are emitted only when the index cannot be proven in range: `for i := range xs`, `for i := 0; i < len(xs); i++` with no writes to `i` or `xs` in the body, and constant indices into arrays are emitted without a check. The hybrid raycast benchmark must not regress by more than 3%; if it does, the elision analysis is extended before the checks are shipped, never the other way round. `js` packages are unchanged.
- **`goto`.** Rejected with a targeted diagnostic in every target (see [Out of Scope](#out-of-scope)).
- **Parity matrix.** A test generator walks the rows of [`language-support.md`](../../docs/language-support.md) and compiles one fixture per row as a `both` package. A row that cannot be supported in WASM must report a targeted diagnostic. An invalid module, a validation error, an internal error (`Unresolved identifier`, `Unsupported WASM instruction`), or a JS/WASM output difference fails the test. The table gains rows for the items above (loop variables, `min`/`max`, `[]rune`, constant expressions, generic aliases, pointer-receiver method expressions, runtime panics, `goto`) before the generator is written, so the matrix covers them from the first run.

#### 1.1 String semantics (both backends)

GoFront strings are JavaScript strings on both backends (`externref` in WASM; `len`, `s[i]` and `range` go through `str_len`/`str_get`/`str_code_point_at` imports). This has three consequences the rest of this plan depends on:

| Construct | GoFront (JS and WASM) | Go |
|---|---|---|
| `len("héllo")` | `5` (UTF-16 code units) | `6` (UTF-8 bytes) |
| `"héllo"[1]` | `0xE9` | `0xC3` |
| `for i := range "héllo"` | `i` counts runes `0,1,2,3,4` | `i` is the byte offset `0,1,3,4,5` |
| `[]byte("héllo")`, `string(b)` | UTF-8, 6 bytes | UTF-8, 6 bytes |
| `[]rune(s)`, `string(r)`, `utf8.*InString` | Code points, as Go | Code points |

Rules that follow:

1. **Go-source stdlib packages work on `[]byte`, not on `string` indices.** `net/url` escaping, the CSV reader, `bufio`, the JSON scanner, `base32`, `hash/*` and `crypto/*` convert a `string` argument once with `[]byte(s)` and index bytes from then on. `url.QueryEscape("é")` must produce `%C3%A9`, which byte-wise code over `[]byte` does and code over `s[i]` does not. This also avoids one JS import call per character in WASM, which would make parsers unusably slow.
2. **Conformance fixtures do not print `len(s)`, `s[i]` or `range` indices of non-ASCII strings.** They may print `len([]byte(s))`, runes, and the output of the packages under test. The harness lints fixtures for `len(` applied to a string literal containing non-ASCII bytes and fails with a hint.
3. **Documentation.** The table above moves into [`go-compatibility.md`](../../docs/go-compatibility.md) (it replaces the two existing rows on `range` over string and `len()`), and [`language-support.md`](../../docs/language-support.md) links to it from the `strings`/`bytes` rows.
4. **JSON and CSV offsets.** `SyntaxError.Offset`, `csv.ParseError.Column` and `Decoder.InputOffset` count **bytes** of the UTF-8 input, because both codecs read `[]byte`. This matches Go exactly, even though `len(s)` on the original string does not.
5. **Byte escapes.** `\xNN` and octal escapes in string literals are the code point U+00NN, because a GoFront string cannot hold a raw byte. `len("\x00")` is 1 as in Go, but `"\xc3"` is `Ã`, so `[]byte("\xc3")` is the two bytes `c3 83` where Go has one (`c3`). Use `[]byte{0xc3}` for raw bytes. Unknown escapes (`\q`, `\'` in a string, `\"` in a rune) and out-of-range `\u`/`\U`/octal values are lexer errors, as in Go.

### 2. Go-source stdlib

Today every stdlib member is implemented twice: a JS shim in [`src/backend/js/stdlib/`](../../src/backend/js/stdlib/) and a WASM emitter in [`src/backend/wasm/stdlib/`](../../src/backend/wasm/stdlib/). That is already 22k lines on the WASM side alone. Adding about 15 packages the same way would double that and multiply the parity risk.

Instead, pure packages are written **in GoFront Go** and shipped in `runtime/stdlib/<import path>/*.go` with `//gofront:target both`:

- **Location.** `runtime/stdlib/` sits next to the shared runtime helpers, not under `src/`. v1.8.0 is the last JS-engine feature release, and the [v2.0.0 native engine](../v2.0.0/native-go-engine.md) embeds these same files instead of porting them. Every file starts with `//go:build gofront`, so the Go toolchain ignores them once the repository becomes a Go module.

- **Resolution.** [`resolver.js`](../../src/resolver.js) resolves `container/heap` and similar paths to the embedded source directory before it checks `STDLIB_PACKAGES`. Typings come from type-checking that source, so there are no hand-written signatures in [`src/typechecker/stdlib/`](../../src/typechecker/stdlib/).
- **Overlays.** A Go-source directory may also extend an existing emitter-backed package. Its declarations merge into the same namespace. Examples: `sort.Sort`/`sort.Interface` on top of `sort`, and `simd.Vec3x4` on top of the `F32x4` intrinsics. A name defined both ways fails the stdlib self-test.
- **In-target compilation.** A Go-source package is compiled into its caller's target: JS for `js` callers, WASM for `wasm` callers, and both for `both` callers. It never goes through the boundary facade, and it never adds a linked WASM package (so no top-level name collisions).
- **Strict numerics for free.** `both` packages already get strict numeric JS ([hybrid guide](../../docs/hybrid-wasm.md#strict-numeric-mode)). As a result, `uint32` hashing (CRC32, SHA-1, FNV) is bit-identical across backends without extra work.
- **Reachability.** Only functions and methods reachable from user code are emitted. This applies to JS output and to dev-mode WASM, where Binaryen is not run, so its dead-code elimination does not help. A package that is imported but unused costs zero bytes.
- **Host intrinsics.** A small, closed set of `//gofront:intrinsic` functions lets Go-source packages request target-specific behaviour without importing browser APIs. The only ones in v1.8.0 are the `context` deadline timer and its stop (`deadline_timer`, `deadline_stop`; see [§6](#6-bufio-neturl-and-context-go-source)). New intrinsics need a plan change.
- **Stdlib calls.** Go-source packages may call existing emitter-backed stdlib (for example `math.Sqrt` or `strings.Builder`) like any user package.
- **Layering.** The resolver and compiler own loading. Backends see ordinary packages. Sentrux layers are unchanged.
- **Diagnostics.** Errors inside stdlib source are compiler bugs. They are reported against the user's call site with an `internal stdlib` note, not a path into `runtime/stdlib/`.

**Rejected alternatives:**
- **More dual hand-written emitters.** This doubles the work and the parity risk for every package.
- **Compiling Go's own stdlib source.** Go's source depends on `unsafe`, `internal/*`, `reflect` and goroutines. GoFront's sources are small, purpose-written subsets with the same API.

### 3. Coverage manifest and conformance

> **Superseded (2026-10-27):** Retired by Phase 8 (D1). See [Simplification](#simplification-phases-811-decided-2026-10-27).

- **Manifest.** `scripts/stdlib-manifest.js` reads Go's `api/go1.*.txt` files (go1.26, matching [go-compatibility](../../docs/go-compatibility.md)) for the in-scope package list. It writes `runtime/stdlib/manifest.json`, which is checked in, so CI does not need a Go toolchain. Each entry records its availability (`js`, `wasm`, `both`, or `excluded:<reason>`) and its implementation (`emitter` or `source`). v2.0.0 uses the implementation field to know which members must be ported.
- **Coverage test.** A unit test diffs the manifest against the checker namespaces, `WASM_STDLIB_MEMBERS` and the Go-source packages. It compares **signatures**, not just names: Go's `api/*.txt` lines carry parameter and result types, and the test normalises the checker's declared types to the same textual form (`func(string, int, int) (int64, error)`). A member whose signature differs (today: `strconv.ParseInt` returning `int`) fails the test with both signatures in the message. An entry without an implementation or an exclusion reason fails the test. This replaces the v1.6.1 coverage gate, which only compared JS against WASM.
- **Generated docs.** The package tables in [`language-support.md`](../../docs/language-support.md) and [`hybrid-wasm.md`](../../docs/hybrid-wasm.md#what-wasm-packages-support) are generated from the manifest (`npm run docs:stdlib`). `npm run check` fails if they are stale.
- **Conformance fixtures.** `test/conformance/<pkg>/*.go` are small programs that print results. Expected output is captured from real Go (`npm run conformance:update`, which needs `go`) and checked in. The suite runs each fixture as a `both` package and compares JS and WASM output with Go's output, byte for byte.

### 4. `iter`, `cmp` and Go 1.23 iterator APIs

- **`iter`:** `Seq`, `Seq2`. `Pull` is excluded: it needs coroutines.
- **`cmp`:** `Ordered`, `Compare`, `Less`, `Or`.
- **`slices`:** `All`, `Values`, `Backward`, `Collect`, `AppendSeq`, `Sorted`, `SortedFunc`, `SortedStableFunc`, `Chunk`.
- **`maps`:** `All`, `Keys`, `Values`, `Insert`, `Collect`.
- **`strings`/`bytes`:** `Lines`, `SplitSeq`, `SplitAfterSeq`, `FieldsSeq`, `FieldsFuncSeq`.

**Breaking change.** `maps.Keys` and `maps.Values` return `iter.Seq[K]`/`iter.Seq[V]`, as in Go 1.23. Code that relies on a slice result fails to compile. The diagnostic carries the hint `use slices.Collect(maps.Keys(m)) for a slice`. Code that ranges over the result with one variable silently changes from indices to keys, which is the Go behaviour. This is called out in the CHANGELOG. This is why the release is v1.8.0 and not a patch.

### 5. Member completion

These members are added to packages that are already supported, on both backends. Where the code is pure, it is written in Go source (for example `sort.Sort`/`Stable` over `sort.Interface`, `io.MultiWriter`, `utf8.EncodeRune`). The emitter path is used only where an instruction or an existing helper is cheaper (`math.FMA`, `bits.Mul64`). The seed list is the [Verified gaps](#verified-gaps-2026-10-20-v170-tree) table. The final list comes from the Phase 1 manifest.

`fmt` also gets **`Stringer`/`error` dispatch for `%v`/`%s`**. Values whose type has `String() string` or `Error() string` print through that method on both backends, matching Go.

**`fmt` verb completion.** Both format engines ([`runtime.js`](../../src/backend/js/runtime.js) and the WASM `fmt` emitter) gain the verbs and flags Go has and GoFront lacks:
- `%T`: the checker records the static type name of each argument; for `any`/interface arguments the backends look up the dynamic type's name in the same per-type table that `%v` on structs already uses. Names follow Go: `int`, `string`, `main.P`, `*main.P`, `[]int`, `map[string]int`.
- `%U` (`U+0041`), `%c` on both backends, `%q` on runes (`'x'`), `%#v` (Go-syntax: `main.P{X:1}`, `[]int{1, 2}`, `"s"`), `%#x` (`0x` prefix), `%+d`, `% d`, `%x`/`%X` on `[]byte` and strings, `%e`/`%E`/`%G`, explicit argument indexes `%[1]d`, and `%*d` width from an argument.
- `%p` prints `%!p(T)` with a note in [`go-compatibility.md`](../../docs/go-compatibility.md): there are no addresses.
- Exact `int64`/`uint64` formatting in WASM for `%d`, `%x`, `%o`, `%b`: the formatter takes `i64` and uses the `strconv` lowering, never `f64`.
- Missing argument and extra argument forms (`%!d(MISSING)`, `%!(EXTRA int=1)`) match Go, because conformance fixtures hit them.

**`os.Stdout`/`os.Stderr`.** They become typed `*os.File` values that implement `io.Writer` and `io.StringWriter` by writing to the console import (`Stdout` → `console.log` stream, `Stderr` → `console.error`), on both backends. `fmt.Print*`, `fmt.Fprint*(os.Stdout, …)` and `log` share one line-buffering helper so partial writes (`fmt.Print("a"); fmt.Print("b\n")`) produce one console line.

### 6. `bufio`, `net/url` and `context` (Go source)

> **Superseded (2026-10-27):** Removed by Phase 9 (D2); JSON's buffering moves into `internal/jsonrt` (D3). See [Simplification](#simplification-phases-811-decided-2026-10-27).

These come from the dropped v1.7.1 plan. They are written in Go source, so each one is implemented once.

- **`bufio`:**
  - `Reader`: `NewReader`, `NewReaderSize`, `Read`, `ReadByte`, `UnreadByte`, `ReadRune`, `UnreadRune`, `ReadString`, `ReadBytes`, `ReadSlice`, `ReadLine`, `Peek`, `Discard`, `Buffered`, `Size`, `Reset`, `WriteTo`.
  - `Writer`: `NewWriter`, `NewWriterSize`, `Write`, `WriteString`, `WriteByte`, `WriteRune`, `Flush`, `Buffered`, `Available`, `Size`, `Reset`, `ReadFrom`.
  - `Scanner`: `NewScanner`, `Scan`, `Text`, `Bytes`, `Err`, `Split`, `Buffer`; `SplitFunc`, `ScanLines`, `ScanWords`, `ScanRunes`, `ScanBytes`, `MaxScanTokenSize`.
  - `ReadWriter`, `NewReadWriter`, and the errors `ErrTooLong`, `ErrNegativeAdvance`, `ErrAdvanceTooFar`, `ErrFinalToken`, `ErrBufferFull`, `ErrNegativeCount`.
- **`net/url`:**
  - `URL` (all fields) with `String`, `Query`, `Hostname`, `Port`, `EscapedPath`, `EscapedFragment`, `IsAbs`, `ResolveReference`, `Parse`, `JoinPath`, `Redacted`, `RequestURI`.
  - `Userinfo` with `User`, `UserPassword`, `Username`, `Password`, `String`.
  - `Values` with `Get`, `Set`, `Add`, `Del`, `Has`, `Encode`, and `ParseQuery`.
  - `Parse`, `ParseRequestURI`, `QueryEscape`, `QueryUnescape`, `PathEscape`, `PathUnescape`, `JoinPath`.
  - The errors `*Error`, `EscapeError`, `InvalidHostError`.
- **`context`:**
  - `Context` without `Done()`: `Deadline`, `Err`, `Value`. `ctx.Done()` reports `Done() returns a channel, which GoFront does not support; use ctx.Err() != nil or context.AfterFunc`.
  - `Background`, `TODO`, `WithCancel`, `WithCancelCause`, `WithDeadline`, `WithDeadlineCause`, `WithTimeout`, `WithTimeoutCause`, `WithValue`, `WithoutCancel`, `AfterFunc`, `Cause`, `CancelFunc`, `CancelCauseFunc`, `Canceled`, `DeadlineExceeded`.
  - **Deadlines** use the only v1.8.0 intrinsic. In JS output it arms a `setTimeout` that cancels the context when it fires. In WASM there is no timer: `Err()` compares `Deadline` with the existing clock import, and cancels on first observation. Synchronous WASM code therefore sees expiry only when it checks `Err()`, which is the cooperative model.
  - **Browser interop** needs no non-Go API. A `js` package bridges to `fetch` with `context.AfterFunc(ctx, func() { controller.abort() })` on an `AbortController`.

### 7. New pure packages (Go source)

> **Superseded (2026-10-27):** Every package in this section is removed by Phase 9 (D2). See [Simplification](#simplification-phases-811-decided-2026-10-27).

| Package | Members |
|---|---|
| `container/heap` | `Interface`, `Init`, `Push`, `Pop`, `Remove`, `Fix` |
| `container/list` | `List`, `Element`, all methods |
| `container/ring` | `Ring`, all methods |
| `hash` | `Hash`, `Hash32`, `Hash64` |
| `hash/crc32` | `ChecksumIEEE`, `Checksum`, `MakeTable`, `IEEE`, `Castagnoli`, `Koopman`, `New`, `NewIEEE`, `Update` |
| `hash/fnv` | `New32`, `New32a`, `New64`, `New64a` |
| `hash/adler32` | `Checksum`, `New` |
| `crypto/sha1`, `crypto/sha512`, `crypto/md5` | `Sum*`, `New*`, `Size`, `BlockSize` |
| `crypto/hmac` | `New`, `Equal` |
| `crypto/subtle` | `ConstantTimeCompare`, `ConstantTimeEq`, `ConstantTimeSelect`, `XORBytes` |
| `encoding/base32` | `StdEncoding`, `HexEncoding`, `NewEncoding`, `WithPadding`, `NoPadding` |
| `unicode/utf16` | `Encode`, `Decode`, `EncodeRune`, `DecodeRune`, `AppendRune`, `IsSurrogate`, `RuneLen` |
| `math/cmplx` | Everything except functions that need `math/big` (requires [§1](#1-wasm-language-parity) complex lowering) |
| `sync/atomic` | Typed `Int32`/`Int64`/`Uint32`/`Uint64`/`Bool`/`Pointer[T]`/`Value` and function forms, as single-threaded shims (same model as `sync` in v1.6.1) |
| `log` | `Logger`, `New`, `Default`, `Print`/`Printf`/`Println`, `Fatal*` (writes, then `os.Exit(1)` in JS, `panic` in WASM), `Panic*`, `SetFlags`, `Flags`, `SetPrefix`, `Prefix`, `SetOutput`, `Writer`, `Output`, and the `L*` flag constants. Default output is `os.Stderr`. `Lshortfile`/`Llongfile` print `???:0`. |
| `math/rand/v2` | `N`, `IntN`, `Int64N`, `Uint64N`, `Float64`, `Float32`, `Perm`, `Shuffle`, `Int`, `Int64`, `Uint64`, `Uint32`, `NormFloat64`, `ExpFloat64`; `Rand`, `New`, `Source`, `PCG`, `NewPCG`. Top-level functions use the existing per-target random source. `ChaCha8` is deferred. |

`crypto/*` hashes are for checksums, cache keys and HMAC verification. They are not hardened against side-channel attacks. The docs say this, and the hint points users at Web Crypto (`crypto.subtle`) for real cryptographic use in `js` packages.

### 8. `encoding/csv` (Go source)

> **Superseded (2026-10-27):** Removed by Phase 9 (D2). See [Simplification](#simplification-phases-811-decided-2026-10-27).

- **`Reader`:** `NewReader`, `Read`, `ReadAll`, `FieldPos`, `InputOffset`, and fields `Comma`, `Comment`, `FieldsPerRecord`, `LazyQuotes`, `TrimLeadingSpace`, `ReuseRecord`. Built on `bufio.Reader` ([§6](#6-bufio-neturl-and-context-go-source)).
- **`Writer`:** `NewWriter`, `Write`, `WriteAll`, `Flush`, `Error`, and fields `Comma`, `UseCRLF`.
- **Errors:** `ParseError` (`StartLine`, `Line`, `Column`, `Err`, `Unwrap`), `ErrBareQuote`, `ErrQuote`, `ErrFieldCount`, with Go-identical messages.

Because the package is Go source, the same code runs on both backends. There is no separate JS shim.

### 9. `encoding/json` everywhere

**WASM codecs are pure WASM.** The checker already resolves JSON field sets ([`resolveJsonFields`](../../src/typechecker/resolve.js)); both backends consume that result, so field rules cannot drift.

- **Encoding.** The emitter generates one encoder per reachable type. Each encoder appends to a `[]byte` and calls `strconv.AppendFloat`/`AppendInt` and the existing UTF-8 helpers. Map keys are sorted with the existing `slices.Sort` lowering. `Marshaler` is dispatched through normal interface calls.
- **Decoding.** One shared recursive-descent JSON scanner over `[]byte` is emitted once and used by all decoders. Each reachable target type gets a generated decoder. Values decoded into `any` become `map[string]any`, `[]any`, `float64`, `string`, `bool` or `nil`. `Unmarshaler` and `RawMessage` are supported.
- **No host JSON.** WASM codecs do not call `JSON.parse`/`JSON.stringify`.

**Rejected alternatives:**
- **Host `JSON.parse` plus an externref walk.** That means a boundary hop per field, a second value representation, and `int64` precision loss.
- **A generic reflective codec in WASM.** That is a runtime, which the scope rule forbids.

**Already done in JS (v1.7.0 branch); WASM must match it:**
- Case-insensitive field matching (exact match first, then case-folded).
- Go `null` semantics: scalars keep their value; pointers, slices, maps and interfaces become `nil`.
- Integer targets reject fractional and out-of-range numbers with Go's messages.
- Exact `RawMessage` source bytes, including nested values.
- float32 shortest-round-trip formatting.
- `__proto__` keys cannot alter decoded map prototypes (JS only).

**JSON completion on both backends:**
- `Encoder` (`NewEncoder`, `Encode`, `SetIndent`, `SetEscapeHTML`) over `io.Writer`.
- `Decoder` (`NewDecoder`, `Decode`, `More`, `UseNumber`, `DisallowUnknownFields`, `Buffered`, `InputOffset`) over `io.Reader`.
- `Number` (`String`, `Float64`, `Int64`).
- `Compact`, `Indent`, `HTMLEscape`.
- Error types `SyntaxError`, `UnmarshalTypeError`, `InvalidUnmarshalError`, `UnsupportedValueError`, `UnsupportedTypeError`, `MarshalerError`, so that `errors.As` works.
- `time.Time` fields encode as RFC 3339 strings and `time.Duration` as nanosecond integers, through `MarshalJSON`/`UnmarshalJSON` on both types (see the member classification in the [Scope rule](#scope-rule)). A zero `time.Time` encodes as `"0001-01-01T00:00:00Z"`.

**JS codecs stay as they are.** The JS backend keeps its `JSON.parse`-based fast path. It gains the completion items above and is checked against the same conformance corpus.

### 10. SIMD completion (`gofront/simd`)

This carries over the v1.7.1 SIMD plan, corrected for what WasmGC can and cannot do. It has two separate outcomes:
- **API completeness ships unconditionally.** Every item in §10.1–§10.5 is a correctness or completeness item.
- **Promotion to stable is gated** (§10.6). A missed gate leaves the package marked experimental, but with the completed API.

#### 10.1 `F32x4` as a complete value type

`F32x4` must work everywhere a `[4]float32` works:
- Struct fields, array and slice elements, map values, generic type arguments, and closure captures.
- Exported struct fields and exported function parameters and results in `wasm`/`both` packages. This removes today's build blocker; crossing rules are in §10.5.
- `==`/`!=` compare lane-wise, as Go does for `[4]float32`: `NaN != NaN` and `-0 == +0`. In WASM this lowers to `f32x4.eq` + `i32x4.all_true`. `F32x4` is comparable, so it can be a map key, hashed by lanes with the existing float-key rules.
- `fmt` `%v` prints `[1 2 3 4]` (like `[4]float32`) on both backends. `%+v` and `%#v` print the same.
- Arrays of `F32x4` get value semantics through the general array fix ([§1](#1-wasm-language-parity)).

#### 10.2 Operations

Method names follow Go's experimental `simd/archsimd` names (go1.26, `GOEXPERIMENT=simd`) where an equivalent exists. Task 6.1 checks the names against that API before implementation starts.

| Group | API | WASM lowering |
|---|---|---|
| Lane-wise unary | `Neg`, `Abs`, `Sqrt`, `Floor`, `Ceil`, `Trunc`, `RoundToEven` | `f32x4.neg`/`abs`/`sqrt`/`floor`/`ceil`/`trunc`/`nearest` |
| Lane-wise binary | Existing `Add`, `Sub`, `Mul`, `Div`, `Min`, `Max`, plus `MulAdd(b, c)` | `MulAdd` is `mul` then `add` with two roundings, not fused |
| Horizontal | Existing `Dot3`, `Dot4`, plus `Sum` | `extract_lane` + `add` |
| Shuffles | `v.Swizzle(i0, i1, i2, i3)` and `simd.Shuffle(a, b, i0, i1, i2, i3)` (lanes 0–3 from `a`, 4–7 from `b`), with constant indices | `i8x16.shuffle` |
| Comparisons | `Equal`, `NotEqual`, `Less`, `LessEqual`, `Greater`, `GreaterEqual` → `Mask32x4` | `f32x4.eq`/`ne`/`lt`/`le`/`gt`/`ge` |
| Masks | `Mask32x4` with `And`, `Or`, `Xor`, `AndNot`, `Not`, `Any`, `All`, `Bits() int`, `Lane(i) bool` | `v128.and`/…, `v128.any_true`, `i32x4.all_true`, `i32x4.bitmask` |
| Select | `simd.Select(m Mask32x4, a, b F32x4) F32x4` | `v128.bitselect` |

`Min`/`Max` keep `f32x4.min`/`max`, not `pmin`/`pmax`. Like Go's `math.Min`/`Max`, they propagate `NaN` and order `-0 < +0`. Constant-index rules (`Lane`, `WithLane`, `Swizzle`, `Shuffle`) reuse the existing checker diagnostic.

#### 10.3 SoA types (Go-source overlay)

`Vec3x4`, `AABB4` and `Ray4` are plain Go structs in a Go-source overlay of `gofront/simd` ([§2](#2-go-source-stdlib)). They are written once over the `F32x4`/`Mask32x4` intrinsics:

```go
type Vec3x4 struct{ X, Y, Z F32x4 }          // 4 points, one per lane
type AABB4 struct{ Min, Max Vec3x4 }          // 4 boxes
type Ray4 struct{ Origin, InvDir Vec3x4 }     // 4 rays (or 1 ray splatted)
```

- **`Vec3x4` methods:** `Add`, `Sub`, `Mul`, `Scale(F32x4)`, `Dot` (returns `F32x4`), `Cross`, `LengthSquared`, `Length`, `Normalize`, `Min`, `Max`, and `simd.SelectVec3x4`. Constructors are `simd.SplatVec3(x, y, z)` and `simd.NewVec3x4(...)`.
- **Ray–box test:** `simd.IntersectRayAABB4(r Ray4, b AABB4, tMax F32x4) (hit Mask32x4, tNear F32x4)` is the slab test, computed lane by lane. With a splatted ray it tests **one ray against four boxes**: four octree children at once, which attacks the v1.7.0 bottleneck where node AABB tests dominated. With a splatted box it tests a **4-ray packet against one box**.
- **No allocations in hot loops.** A WasmGC struct of three `v128` fields allocates on the heap for every temporary. Release builds rely on Binaryen's `heap2local` pass to turn non-escaping temporaries into locals. The benchmark (§10.6) requires zero allocations per step in the hot loop. If release builds still allocate, Task 6.8 adds compiler-side scalar replacement for non-escaping `gofront/simd` structs (three `v128` locals) before the gate is measured.

#### 10.4 Memory helpers

- **SoA streams:** `simd.LoadVec3x4(xs, ys, zs shared.Float32, i int) Vec3x4` and `StoreVec3x4(...)`. Each call does one bounds check for all three buffers.
- **AoS ↔ SoA:** `simd.LoadAoS4(buf shared.Float32, i int) (Vec3x4, F32x4)` reads four interleaved `xyzw` records (16 floats) and transposes them with 8 `i8x16.shuffle`s. `StoreAoS4` reverses this, for GPU vertex uploads.
- **GC slices:** `simd.LoadF32x4Slice(xs []float32, i int)` and `StoreF32x4Slice`. WasmGC arrays cannot be loaded as `v128`, so in WASM these use 4 × `array.get` + `replace_lane`. They are documented as slower than `shared` buffers and exist for completeness.
- **Tails:** `simd.Pad4(n int) int` rounds a length up to a multiple of 4 for `shared.NewFloat32`. The docs show the scalar tail-loop idiom for data that is not padded.
- Out-of-bounds offsets panic with Go's index-out-of-range message on both backends.

#### 10.5 Boundary transport

- **`F32x4`** crosses as a **copied** 4-element `Float32Array` in both directions (value semantics). `Mask32x4` crosses as a 4-element `boolean[]`.
- **`Vec3x4`, `AABB4`, `Ray4`** follow the existing struct rules, because they are ordinary structs: copied JS classes from `both` packages and handles from `wasm` packages. Their `F32x4` fields use the rule above.
- **`[]F32x4`** crosses as one copied `Float32Array` of length `4n`, not `n` small arrays.
- **Zero-copy stays `shared.Float32` only.** WasmGC arrays of `v128` are not linear memory, so the v1.7.1 idea of zero-copy typed views over `[]simd.F32x4` is not possible. Bulk data moves through `shared` buffers and the §10.4 helpers. The docs say so explicitly.

#### 10.6 JS fallback, parity and promotion gate

- **JS fallback.** `F32x4` stays a frozen 4-element array rounded with `Math.fround`. `Mask32x4` is a frozen 4-element boolean array. Each new operation gets a `__simd_*` helper, tree-shaken like the existing ones. Rounding helpers use `Math.floor`/`ceil`/`trunc`; `RoundToEven` uses an explicit ties-to-even helper, because `Math.round` rounds half up.
- **Parity.** Results must be bit-identical between backends, except for NaN payload and sign bits. The WASM spec leaves those non-deterministic, so tests compare NaN-ness, not bits.
- **Benchmarks.** These need release builds with Binaryen, scalar WASM vs. SoA SIMD in the same module, and allocations recorded per run:
  - **Particle kinematics:** 65,536 particles; integration, damping, gravity, and box bounce via `Select`. Added to `test/e2e/perf/` and adopted in `example/hybrid`.
  - **Octree raycast:** the v1.7.0 raycast benchmark with child-node tests rewritten to `IntersectRayAABB4`.
- **Promotion rule.** `gofront/simd` loses its experimental label when **both** of these hold:
  - the particle benchmark is ≥ 1.30× over scalar WASM with zero allocations per step; and
  - the raycast benchmark is no slower than scalar WASM.

  If the raycast is ≥ 1.30× as well, the result is recorded as meeting the original v1.7.0 gate. Otherwise the package stays experimental, the numbers and the cause are recorded here, and the release still ships.

---

## Edge Cases

**Language parity**
- Arrays:
  - `b := a; b[0] = 9` leaves `a` unchanged.
  - A callee that mutates its `[N]T` parameter leaves the caller's array unchanged.
  - Arrays inside structs copy with the struct, and nested arrays (`[2][3]int`) copy deeply.
  - `for i, v := range arr` ranges over a copy (Go evaluates the range expression once).
  - Clone elision must not drop a copy when the source is mutated after the copy.
  - `a := m["x"]; a[0] = 9` and `a := xs[0]; a[0] = 9` leave the map and slice unchanged; `xs[0][0] = 9` (indexing in place) still writes through.
- Shadowing: a package-level `func Array()` or `var document int` compiles and is used in place of the browser global within that package.
- Loop variables:
  - Closures created in a three-clause `for` capture a distinct `i` per iteration on both backends; a closure that *writes* `i` affects only its own iteration's copy and the post statement sees the write (Go copies the value back before `i++`).
  - A loop variable that is not captured compiles to a plain local in WASM (no per-iteration allocation; checked by the zero-alloc test on the raycast).
  - `for i := range n` and `for i, v := range xs` already copy per iteration and stay that way.
- Builtins: `min`/`max` over `int64` extremes, over `float32` with `NaN` (result is `NaN`), over `-0`/`+0` (`min(-0, 0) == -0`), over strings (`min("b", "a") == "a"`), with one argument, and with a mix of untyped constants and a typed variable.
- `[]rune`: `len([]rune("héllo")) == 5`, `string(r[1]) == "é"`, `append(r, 'x')`, `string(r)` round-trips, and `[]rune("")` has length 0 on both backends.
- Constant expressions:
  - `1 << 40`, `1 << 62`, `math.MaxInt64`, `math.MaxUint64 >> 1`, `-1 << 63`, `1e18 + 1` as an `int64` are exact on both backends.
  - `const big = 1 << 100; var x = big >> 98` compiles (intermediate overflow is allowed for untyped constants) and `x == 4`.
  - `int32(1 << 40)` and `var x int8 = 200` are compile errors with Go's `overflows` message.
  - `uint64(1<<63 + 5)` prints `9223372036854775813` with `%d` and `strconv.FormatUint` in WASM; in JS it prints the nearest `Number` and the compile emits the precision warning.
- Generic type aliases: `type Set[T comparable] = map[T]struct{}` used as a composite literal, a parameter type, a map key type in another generic, and an alias of a generic struct `type Pair[T any] = struct{ A, B T }` with a positional literal.
- Method expressions: `(*C).Inc` and `C.Get` as values, passed to a function, called with an explicit receiver, and taken on a generic type `(*Box[int]).Set`.
- Runtime panics (strict mode / `both`): `xs[5]` on a 3-element slice, `xs[-1]`, `s[len(s)]`, `arr[i]` with a runtime `i` out of range, a write to a nil map, `p.X` with `p == nil`, each caught by `recover()` with Go's message and identical on both backends. `v, ok := m[k]` on a nil map does **not** panic. A read from a nil map returns the zero value.
- Index-check elision (strict mode): `for i := range xs { xs[i] = 0 }` and `for i := 0; i < len(xs); i++ { s += xs[i] }` emit no `__at` helper (asserted on the generated JS); a body that reassigns `xs` or `i` does.
- Pointers to fields and elements:
  - `set(&s.X, 7)` writes `s.X`, and `*(&xs[i]) = v` writes `xs[i]`. Nested fields are covered: `&s.Inner.X` and `&arr[0].X`.
  - `p := &xs[1]; xs = xs[1:]; *p = 9` writes the original element (the pointer is bound to the backing array, not the slice header).
  - `p := &xs[1]; xs = append(xs, 4)` (which reallocates) leaves `p` pointing at the old backing array, as in Go. **Capacity model:** both backends treat `cap(xs) == len(xs)` for slices they create, and `append` always reallocates when it grows (today's rule in [`go-compatibility.md`](../../docs/go-compatibility.md)). This is what makes the two copies of a `both` package agree on *when* a pointer detaches. The three-index slice keeps ignoring `max`.
  - `&arr[i]` on a fixed-size array local or field, and `&m[k]`, which stays a compile error as in Go.
  - `p == q` compares identity. Two `&s.X` taken separately compare equal (same target and index). A box never equals an accessor ref.
  - A struct field of pointer-to-scalar type that holds an accessor ref, after the struct is copied by value.
- Range-over-func:
  - A `break` inside a nested loop in the body must stop only the inner loop.
  - A labeled `continue outer` must cross the yield closure.
  - A `return` from the body must return from the enclosing function with the correct results.
  - A `defer` in the enclosing function must run once.
  - `panic` must propagate through the iterator.
- An iterator that calls `yield` again after it returned `false` must panic with Go's message on both backends.
- `Seq2[K, V]` with struct values must copy the values: mutating the loop variable must not mutate the source.
- Complex numbers:
  - `complex64` arithmetic rounds each part to `float32` (`Math.fround` in JS, `f32` in WASM).
  - `NaN` parts follow Go's equality.
  - Division by `0+0i` yields `Inf`/`NaN` and does not panic.

**Go-source stdlib**
- A user package named `heap` and an import of `container/heap` must coexist (both are qualified by import path).
- A `js` package and a `wasm` package that both import `hash/crc32` must each get their own copy. There is no boundary call and no name collision in the linked module.
- Unused imported Go-source packages must add 0 bytes to `app.js` and to dev-mode `app.wasm`.

**Iterators**
- `for k := range maps.Keys(m)` yields keys after the change.
- `sort.Strings(maps.Keys(m))` must fail with the `slices.Collect` hint.
- `slices.Sorted(maps.Keys(m))` on a WASM map with `NaN` keys must keep each `NaN` once per entry.

**Members**
- `sort.Stable` must be stable for equal keys on both backends.
- `sort.Sort` is a port of Go's pattern-defeating quicksort, so the order of equal elements matches Go and the conformance fixtures can rely on it. It must not delegate to JS `Array.prototype.sort`.
- `fmt.Sprint` inserts spaces only between operands when neither operand is a string; `fmt.Sprintln` always inserts them.
- `%v` on a type with a value-receiver `String()` must call it both for values and for pointers. A pointer-receiver `String()` is called only for pointers.
- `utf8.EncodeRune` of an invalid rune (surrogate, > `MaxRune`) writes `RuneError`.
- `%T` on `nil` prints `<nil>`; on a nil `*P` held in `any` prints `*main.P`; on a named slice type prints its qualified name.
- `%#v` on a struct with a nested pointer prints `&main.Q{…}` only at the top level and `(*main.Q)(nil)` for nil pointers, as Go does.
- `fmt.Fprintf(os.Stderr, "a"); fmt.Fprintln(os.Stderr, "b")` produces one console line `ab`.
- `log.Printf` prefixes the date and time with the default flags (`LstdFlags`); tests set `log.SetFlags(0)` to get stable output.
- `rand.N(time.Duration(10))` type-checks (generic over integer types) and `rand.IntN(0)` panics with Go's message.
- `sync.Pool.Get` returns the `New` value when empty and `nil` when `New` is nil; `sync.Map.Range` stops when the callback returns `false`.
- `t.Cleanup` functions run in LIFO order after the test, including on `t.Fatal`; `t.Context()` is cancelled once the test ends.

**`bufio`, `net/url`, `context`**
- `Scanner` returns a final token without a trailing delimiter on the last `Scan()`, and then stops. `ErrFinalToken` from a custom `SplitFunc` ends scanning without an error.
- `Scanner` with a token longer than the buffer returns `ErrTooLong`.
- `Reader.ReadLine` sets `isPrefix` when a line exceeds the buffer.
- `Writer` writes larger than the buffer go straight through after the buffered data is flushed.
- `url.Parse("http://[::1]:8080/p")` gives `Hostname() == "::1"` and `Port() == "8080"`.
- Malformed escapes return `*url.Error` wrapping `EscapeError`.
- `Values.Encode` sorts keys, as in Go.
- Cancelling a parent cancels every descendant from `WithCancel`, `WithTimeout` and `WithDeadline`. `WithoutCancel` children are not cancelled.
- `AfterFunc` runs once, after cancellation. Its stop function returns `false` once the callback has started.
- `Cause` returns the cause passed to the cancel function, or `Canceled`/`DeadlineExceeded`.
- WASM: a deadline that passes during a long synchronous call is reported by the next `Err()`, and that call fires the `AfterFunc` callbacks.

**CSV**
- Quoted fields with embedded `\n`, `\r\n` and `""` escapes.
- A bare `"` in an unquoted field gives `ErrBareQuote` with the line and column, unless `LazyQuotes` is set.
- `FieldsPerRecord == 0` takes the count from the first record.
- A trailing `\r` before EOF is dropped.
- Writer quoting: quote a field that contains `Comma`, `"`, `\r` or `\n`, starts with a space, or is exactly `\.`.

**JSON**
- Float formatting follows Go's choice between `'f'` and `'e'` by magnitude (`1e21`, `1e-6`), with exponent cleanup (`e-07` → `e-7`). `-0` encodes as `-0`. `NaN`/`±Inf` return `UnsupportedValueError`.
- Invalid UTF-8 in strings encodes as `\ufffd`. `<`, `>`, `&`, U+2028 and U+2029 are escaped unless `SetEscapeHTML(false)`.
- Duplicate object keys: the last one wins.
- Unmarshalling into an existing map merges entries; into a slice, it resets the length; into an array, it zero-fills the tail; `null` into a non-pointer is a no-op.
- `Decoder.Decode` on a stream of several values returns them one at a time and then `io.EOF`. A truncated value returns `io.ErrUnexpectedEOF`.
- A WASM `int64` field above 2⁵³ round-trips exactly in WASM. That value is excluded from the `both` parity corpus.

**SIMD**
- `Equal` on lanes holding `NaN` is `false`, and on `-0`/`+0` it is `true`. `a == b` is `false` if any lane is `NaN`.
- `Select` with a mask from a comparison involving `NaN` picks the `false` operand for that lane.
- `RoundToEven(2.5) == 2` and `RoundToEven(-0.5) == -0` on both backends (the JS helper must not use `Math.round`).
- `Div` by a zero lane yields `±Inf`/`NaN` without a panic. This differs from integer division and is Go's `float32` rule.
- `Normalize` of a zero-length lane yields `NaN` lanes, like the scalar `v.Scale(1/len)`. It does not panic or return zero.
- `IntersectRayAABB4` with a ray exactly on a slab plane (`0 * ±Inf = NaN`) must match the scalar reference used in the benchmark. A box with `Min > Max` on any axis is a miss.
- `LoadAoS4`/`StoreAoS4` round-trip exactly, and `StoreAoS4` preserves the `w` lane.
- `LoadVec3x4` checks the three buffers independently. A short `zs` panics even if `xs` and `ys` are long enough.
- An `F32x4` captured by a closure and mutated in the closure behaves like a captured `[4]float32`.
- An exported `wasm` struct with `F32x4` fields exposes them through accessors that return a fresh `Float32Array`. Mutating the returned array does not change WASM state.

---

## Implementation Tasks

### How to execute a task

Every task below is sized for one focused session and names the files it touches, the test it adds, and an observable exit condition. The loop is always the same:

1. **Read** only the files under **Files** (plus the test helper). Do not refactor outside them.
2. **Write the failing test** named under **Test** first. Negative tests assert the message with `assertErrorContains(errors, "…")`. A new test file must be added to `TEST_FILES` in [`test/unit/run.js`](../../test/unit/run.js).
3. **Implement** until it passes. One file: `node test/unit/<dir>/<file>.test.js`. Everything: `npm test`.
4. **Verify** the **Done when** line, run `npm run check`, tick the box in this file, and commit the task (`feat(<scope>): <task summary> (Task N.M)`). One task per git commit; do not combine multiple tasks in the same diff. In autonomous execution workflows (`/execute-plan`), proceed continuously to the next task in the phase without halting until the entire phase is complete and ready for the phase PR and code review.
5. **Ask** when a step needs a decision this document does not make. Do not guess, and do not widen scope.

Conventions used in the tasks:
- *Parity test* = a `both` package run through `compileHybrid(src).run("Main")` from [`test/unit/helpers.js`](../../test/unit/helpers.js). It throws on any JS/WASM result mismatch, on an invalid module, and on a one-sided panic. `compileWasm` + `runWasm` is for WASM-only cases; `compile` + `errors` is for checker diagnostics.
- *Conformance fixture* = `test/conformance/<pkg>/<name>.go` with a `main` that prints; expected output in `<name>.out` captured from real Go by `npm run conformance:update` (Phase 1.2).
- *Go-source package* = files under `runtime/stdlib/<import path>/` starting with `//go:build gofront` and `//gofront:target both`. They follow [§1.1](#11-string-semantics-both-backends): index `[]byte`, not `string`.
- Phases 2.1–6.2 are independent of each other once Phases 0.1–1.2 are done. Inside a phase, do tasks in order unless a task says otherwise.
- Phases 0.11–0.14 (review follow-ups) were added after Phase 3.1.1 landed. They run next, before Phase 3.1.2, in order.

### Phase 0.1: Pointer type hierarchy & accessor refs

- [x] **Task 0.1a — Pointer type hierarchy, no behaviour change**
  - Files: `src/backend/wasm/types.js`, `src/backend/wasm/emit-exprs.js` (`case "&"`), `src/backend/wasm/wat.js`
  - Do: for every scalar pointer type `*T`, emit an abstract supertype `$ptr_T` and make the existing box struct `$box_T` its subtype (`sub $ptr_T`). `&x`, `new(T)`, `*p`, `*p = v` keep using the box. WAT output must name both types.
  - Test: `npm test` (existing suite) and `test/unit/wasm/wat.test.js`: a module with `*int` contains `(type $ptr_int (sub …))` and `(type $box_int (sub $ptr_int …))`.
  - Done when: all existing tests pass and dev-mode `app.wasm` of `example/hybrid` changes only in the type section.

- [x] **Task 0.1b — Accessor refs for `&s.F` and `&xs[i]`**
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/emit.js` (helper function emission), `src/backend/wasm/types.js`
  - Do: add the second subtype `$acc_T { anyref target, i32 index, ref $get_T, ref $set_T }`. `&s.F` (scalar `F`) emits `struct.new $acc_T` with a getter/setter pair generated once per (struct type, field); `&xs[i]` and `&arr[i]` bind the backing array and absolute index with one pair per element type. Struct-typed fields (`&s.Inner`) keep the direct struct reference.
  - Test: new `test/unit/wasm/pointers.test.js` — parity tests `set(&s.X, 7)`, `*(&xs[1]) = 9`, `&s.Inner.X`, `&arr[0].X`, `p := &xs[1]; xs = xs[1:]; *p = 9`.
  - Done when: those pass; `*p` is not yet dispatched (next task) so tests that read through accessor refs are added in 0.1c.

- [x] **Task 0.1c — `*p` dispatch and pointer identity**
  - Files: `src/backend/wasm/emit-exprs.js` (`case "*"`, assignment to deref, `==` on pointers)
  - Do: `*p` and `*p = v` emit `br_on_cast $box_T` first (fast path), else `call_ref` the getter/setter. `p == q` compares boxes by `ref.eq` and accessor refs by (target `ref.eq`, index `i32.eq`); a box never equals an accessor ref.
  - Test: `pointers.test.js` — read-back of every 0.1b case; `p == q` for two `&s.X`; `&xs[1]` after a reallocating `append` still writes the old backing array; a struct field of type `*int` holding an accessor ref survives a struct copy.
  - Done when: all pointer edge cases in [Edge Cases](#edge-cases) pass as parity tests.

- [x] **Task 0.1d — Accessor refs at the boundary and docs**
  - Files: `src/backend/wasm/boundary.js`, `docs/go-compatibility.md` (pointer row)
  - Do: a `*float64`-typed parameter or field that holds an accessor ref is read into the existing `{ value }` box on entry and written back through the setter on return. Rewrite the pointer row in go-compatibility to describe both backends truthfully.
  - Test: `test/unit/wasm/boundary.test.js` — an exported `wasm` function takes `*float64` pointing at a struct field; JS mutates `box.value`; the field changed.
  - Done when: boundary test passes; micro-benchmark of `*p` on `&x` is within 5% of v1.7.0 (record the numbers in [Performance and size](#performance-and-size)).

### Phase 0.2: Range-over-func and generic named func types

- [x] **Task 0.2a — Range-over-func in WASM: body closure, `break`, `continue`**
  - Files: `src/backend/wasm/emit-stmts.js` (`RangeStmt` over func types), `src/lower/captures.js` if the body closure needs capture info
  - Do: lower `for k, v := range f` as the JS backend does: synthesize a closure for the body returning `i32` (1 = continue, 0 = stop), call `f` with it, keep a per-loop state local. Support `Seq` and `Seq2` shapes, plain `break` and `continue`.
  - Test: new `test/unit/wasm/range_func.test.js` — parity tests for a counting iterator, a `Seq2` over a slice, `break` at 3, `continue` on odd.
  - Done when: the v1.7.0 probe (`array.len expected arrayref`) produces a valid module and the same output as JS.

- [x] **Task 0.2b — Range-over-func: labels, `return`, `defer`, `panic`, re-yield panic**
  - Files: `src/backend/wasm/emit-stmts.js`
  - Do: encode labeled `break`/`continue` targets and `return` (with results) in the state local; unwind after the iterator call returns. Propagate `panic` through the iterator; `defer` in the enclosing function runs once. After the body returns `false`, a further `yield` call panics with Go's message (`range function continued iteration after function for loop body returned false`).
  - Test: `range_func.test.js` — every range-over-func edge case in [Edge Cases](#edge-cases).
  - Done when: all pass as parity tests and the panic message is identical on both backends.

- [x] **Task 0.3 — Generic named func types**
  - Files: `src/backend/wasm/monomorph.js`, `src/backend/wasm/types.js`
  - Do: `type Seq[V any] func(yield func(V) bool)` instantiated as `Seq[int]` must map to the same closure type as its underlying func type; returning a `Seq[int]` from a function type-checks in the module.
  - Test: `test/unit/wasm/generics.test.js` — a function returning `Seq[int]` ranged over in a parity test; a generic `Map[A, B any](s Seq[A], f func(A) B) Seq[B]`.
  - Done when: `type error in return[0]` from the probe is gone and both tests pass.

### Phase 0.3: Complex numbers in WASM and parity matrix

- [x] **Task 0.4a — Complex numbers in WASM: representation and arithmetic**
  - Files: `src/backend/wasm/types.js`, `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/emit-builtins.js`
  - Do: `complex64`/`complex128` as immutable structs `{re, im}` of `f32`/`f64`. `complex`, `real`, `imag`, `+ - * /`, unary `-`, conversions between the two widths, and complex literals (`3i`). Division uses the same algorithm as the JS `__cdiv` helper.
  - Test: new `test/unit/wasm/complex.test.js` — parity tests for arithmetic, `complex64` rounding, division by `0+0i` yielding `Inf`/`NaN` without a panic.
  - Done when: `Unresolved identifier: complex` is gone and the parity tests pass.

- [x] **Task 0.4b — Complex numbers: equality, map keys, `fmt`**
  - Files: `src/backend/wasm/emit-exprs.js` (`==`), `src/backend/wasm/emit-maps.js` (hash/eq), `src/backend/wasm/emit-stdlib.js` (`%v`/`%g`)
  - Do: `==`/`!=` compare both parts with float rules (`NaN` parts never equal); map keys hash both parts under the existing float-key rules; `%v` prints `(1+2i)` as Go does.
  - Test: `complex.test.js` — equality, a `map[complex128]int`, `fmt.Sprintf("%v %g", c, c)`.
  - Done when: both tests pass as parity tests.

- [x] **Task 0.5a — Language-support rows for the new parity items**
  - Files: `docs/language-support.md`
  - Do: add rows (with a one-line fixture snippet in a `<!-- fixture: … -->` comment the generator can read) for: per-iteration loop variables, `min`/`max`/`clear`, `[]rune` conversions, constant expressions, generic type aliases, method expressions on pointer receivers, runtime panics (index, nil map, nil deref), `goto` (expected diagnostic). Correct the method-expression row.
  - Test: none (documentation).
  - Done when: every row in the Core/Types/Control-flow/Expressions tables has a fixture comment or an explicit `<!-- no-fixture: reason -->`.

- [x] **Task 0.5b — Parity matrix generator**
  - Files: new `test/unit/language/parity-matrix.test.js`
  - Do: parse the fixture comments from `language-support.md`; for each, compile as a `both` package via `compileHybrid` and run `Main`. Rows marked `diagnostic:` must produce that diagnostic on both targets. Any invalid module, internal error (`Unresolved identifier`, `Unsupported WASM instruction`, `Unknown struct`), or output mismatch fails with the row name.
  - Test: the generator itself; it must fail on the v1.7.0 tree for the rows that Phase 0 fixes (confirm before fixing, then watch the failures disappear task by task).
  - Done when: the matrix runs in `npm test` and lists its skipped rows (accepted differences) in the output.

### Phase 0.4: Go-source stdlib loader & reachability

- [x] **Task 0.6a — Go-source stdlib loader (first package: `cmp`)**
  - Files: `src/resolver.js`, `src/compiler.js`, `src/typechecker/types.js` (`STDLIB_PACKAGES`), new `runtime/stdlib/cmp/cmp.go`
  - Do: resolve an import path to `runtime/stdlib/<path>/` before checking `STDLIB_PACKAGES`. Type-check and compile the package into the caller's target (`js`, `wasm`, or both) as if it were a user `both` package, with no boundary facade and no linked top-level names. Land `cmp` (`Ordered`, `Compare`, `Less`, `Or`) as the smoke package.
  - Test: new `test/unit/compiler/stdlib-go.test.js` — a `js` package and a `wasm` package importing `cmp`; `cmp.Compare(1.0, math.NaN())` parity; a `both` package using `cmp.Or`.
  - Done when: `import "cmp"` works in all three targets without any entry in `src/typechecker/stdlib/`.

- [x] **Task 0.6b — Overlays on emitter-backed packages (first overlay: `errors.ErrUnsupported`)**
  - Files: `src/resolver.js`, `src/typechecker/index.js` (namespace merge), new `runtime/stdlib/errors/overlay.go`
  - Do: a Go-source directory may extend an existing emitter-backed package; its declarations merge into the same namespace and must not collide with emitter members (collision = compiler error at load). Land `var ErrUnsupported = New("unsupported operation")`.
  - Test: `stdlib-go.test.js` — `errors.Is(err, errors.ErrUnsupported)` parity; a deliberate collision fixture reports `overlay redeclares errors.New`.
  - Done when: overlay members appear in `errors` on both backends and the collision diagnostic is tested.

- [x] **Task 0.6c — Name coexistence and call-site diagnostics**
  - Files: `src/resolver.js`, `src/typechecker/index.js`, `src/compiler.js` (error mapping)
  - Do: a user package named `heap` coexists with `container/heap` (qualified by import path everywhere, including the WASM function-name mangling). A type error inside a Go-source file is re-reported at the user's import or call site with the note `internal stdlib error in <path>; please report`, never as a path into `runtime/stdlib/`.
  - Test: `stdlib-go.test.js` — the coexistence fixture (use `cmp` plus a user package `cmp`); a temporarily broken overlay copied to a temp dir reports at the call site.
  - Done when: both tests pass.

- [x] **Task 0.6d — `//gofront:intrinsic` with the deadline timer**
  - Files: `src/parser/declarations.js` (directive), `src/typechecker/declarations.js`, `src/backend/js/statements.js`, `src/backend/wasm/emit-stdlib.js`
  - Do: a body-less func declaration preceded by `//gofront:intrinsic <name>` resolves to a backend-provided implementation. Only `deadline_timer(ns int64, fire func())` exists: JS arms `setTimeout`; WASM returns immediately (cooperative model). Any other name is a compile error `unknown intrinsic`.
  - Test: `stdlib-go.test.js` — a temp Go-source package calling the intrinsic compiles on both targets; an unknown intrinsic name is rejected.
  - Done when: `context` (Task 4.3b) can be written without browser APIs.

- [x] **Task 0.7 — Reachability-based emission for Go-source packages**
  - Files: `src/lower/index.js` (or a new `src/lower/reachability.js`), `src/backend/js/index.js`, `src/backend/wasm/emit.js`
  - Do: starting from user exports, `init`, and `main`, mark reachable functions, methods (by name on reachable types) and package variables in Go-source packages; emit only those, in JS output and in dev-mode WASM. Emitter-backed packages are unaffected.
  - Test: `stdlib-go.test.js` — a program importing `cmp` but using nothing adds 0 bytes to `app.js` and to dev `app.wasm` compared with the same program without the import.
  - Done when: the zero-byte assertion holds for JS and WASM.

### Phase 0.5: Array value semantics, universe scope & loop variables

- [x] **Task 0.8a — Array value semantics in WASM: always copy**
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/emit-stmts.js`, `src/backend/wasm/emit-shared.js` (reuse the value-struct copy helper)
  - Do: insert `array.new` + `array.copy` on assignment, parameter passing, return, struct-field copy, store into slice/map/interface, and load from slice/map/struct field. Nested arrays copy deeply. `range` over an array iterates a copy.
  - Test: new `test/unit/wasm/arrays.test.js` — every array edge case in [Edge Cases](#edge-cases) as parity tests, including the map/slice load cases and `[N]simd.F32x4`.
  - Done when: all pass; `npm run bench` numbers are recorded (regression expected, fixed in Task 0.5b).

- [x] **Task 0.8b — Clone elision for arrays**
  - Files: `src/lower/ownership.js`, the emit sites from Task 0.5a
  - Do: skip the copy when `ownership.js` proves the source is dead after the copy or never mutated on either side. Add the negative case to the analysis tests: a copy must stay when the source is mutated afterwards.
  - Test: `test/unit/compiler/lower.test.js` (elision decisions), `arrays.test.js` (behaviour unchanged).
  - Done when: `npm run bench` scalar raycast is within 3% of v1.7.0 and `test/e2e/perf/zero-alloc.js` passes.

- [x] **Task 0.9 — Predeclared names in the universe scope**
  - Files: `src/typechecker/index.js` (scope setup), `src/typechecker/types.js` (browser-global list)
  - Do: browser globals and other predeclared names live in a universe scope below the package scope, so package and local declarations shadow them in every target. Shadowing a global in a `js` package hides it for that package.
  - Test: new `test/unit/types/shadowing.test.js` — `func Array()`, `var document int`, a local `len := 3`, in `js`, `wasm` and `both` packages; `Array redeclared` must not appear.
  - Done when: all pass and `npm run check` on `example/` is unchanged.

- [x] **Task 0.10 — Per-iteration loop variables in WASM**
  - Files: `src/backend/wasm/emit-stmts.js` (three-clause `for`), `src/lower/captures.js`
  - Do: when a three-clause `for` variable is captured by a closure in the body, allocate a fresh box per iteration: copy the value in at the top of the body and back out before the post statement. Uncaptured variables keep a plain local.
  - Test: `test/unit/wasm/closures.test.js` — the `fs[0]()*100 + fs[1]()*10 + fs[2]()` parity test (`12`); a closure that writes `i`; an uncaptured loop emits no `struct.new` in the loop (assert on WAT).
  - Done when: parity test passes and `zero-alloc.js` still passes.

### Phase 0.6: WASM builtins, conversions & constant folding

- [x] **Task 0.11 — `min`/`max` builtins in WASM**
  - Files: `src/backend/wasm/emit-builtins.js`
  - Do: integers via `select` on `lt_s`/`lt_u`; floats via `f32.min`/`f64.min` and `max`; strings via the existing compare import; variadic forms fold left; a single argument returns itself.
  - Test: `test/unit/wasm/scalars.test.js` — the builtin edge cases in [Edge Cases](#edge-cases) as parity tests.
  - Done when: `Unresolved identifier: min` is gone and all cases pass.

- [x] **Task 0.12 — `[]rune` conversions in WASM**
  - Files: `src/backend/wasm/emit-exprs.js` (conversion), `src/backend/wasm/types.js`
  - Do: `[]rune(s)` produces a `(ref null $array_i32)` built from code points; `string(r)` and `string(r[i])` accept it; `len`, `append`, slicing work on it.
  - Test: `test/unit/wasm/strings_any.test.js` — the `[]rune` edge cases as parity tests.
  - Done when: the `local.tee expected (ref null 21)` module is valid and outputs match JS.

- [x] **Task 0.13a — Shared constant folder**
  - Files: move `src/backend/wasm/const-fold.js` to `src/lower/const-fold.js`; `src/backend/wasm/*` imports updated; `src/typechecker/expressions.js` (constant typing)
  - Landed as `src/typechecker/const-fold.js` (evaluator mixin in `src/typechecker/constants.js`): the checker sits below `lower/` in the Sentrux layer order and may not import it, and a `typechecker → lower` edge fails the coupling gate.
  - Do: a backend-independent evaluator for untyped constant expressions using `BigInt` for integers and `Number` for floats, covering `+ - * / % << >> & | ^ &^`, unary `- ^ !`, comparisons, and conversions. The checker attaches the folded value to the AST node. Typed constant overflow (`int32(1 << 40)`, `var x int8 = 200`) is a compile error with Go's `overflows` wording.
  - Test: new `test/unit/language/constants.test.js` — folded values for the constant edge cases; the two overflow diagnostics; WASM golden output unchanged (`test/unit/wasm/golden.test.js`).
  - Done when: the WASM backend uses the moved folder with no output change and the checker reports overflow.
  - Also (from the Phase 0.5 review): the checker's interim `_constIntValue` folder (32-bit bitwise ops, no unsigned `^` above 32 bits) is replaced by the shared folder. Keyed array literal keys that it cannot fold today (`len("abc")`, dot-imported constants) must resolve to their index instead of falling back to positional, and `a[^uint8(0)]` must give the same result in JS as in WASM.

- [x] **Task 0.13b — JS backend emits folded constants**
  - Files: `src/backend/js/expressions.js`
  - Landed with the precision warning collected by `CodeGen` (`warnings`, printed by `src/compiler.js`) and folding applied to operator, paren, call and conversion nodes (literals and constant names already emit their value). The `a[^uint8(0)]` parity test from Task 0.13a's review item lands here: it needs the JS backend to emit the folded `255`.
  - Do: when a node carries a folded constant, emit the literal (`1099511627776`, not `1 << 40`). Values outside ±2⁵³ in `js` packages emit the nearest `Number` and a compile warning `constant … exceeds JS Number precision`; in `both` packages the same rule applies to the JS copy.
  - Test: `constants.test.js` — parity tests for `1 << 40`, `1 << 62`, `math.MaxInt64 / 2`; the warning text for `1<<63 + 5`.
  - Done when: `float64(x * 1000)` with `x = 1 << 40` gives `1099511627776000` on both backends.

### Phase 0.7: Type aliases, method expressions, panics & goto

- [x] **Task 0.14 — Generic type aliases**
  - Files: `src/typechecker/declarations.js`, `src/typechecker/resolve.js`
  - Do: `type A[P any] = T[P]` records type parameters on the alias; an instantiation `A[int]` substitutes into the aliased type and resolves to exactly that type (no new named type). Works in composite literals, parameter types and nested generics.
  - Test: `test/unit/types/generics.test.js` — the generic-alias edge cases; the `Unknown struct in CompositeLit` message must not appear.
  - Done when: the four edge cases pass as parity tests.
  - Landed in `src/typechecker/index.js` (`_collectGenericAlias`; there is no `declarations.js`) and `src/typechecker/resolve.js`. The edge cases also needed anonymous struct literals to work: WASM no longer registers a struct alias (`type P = struct{…}`) as a distinct struct type and gives `struct{}` a real (empty) struct type, and JS emits a full plain object for `struct{…}{…}`, `P{…}` and alias literals (it emitted an array for positional ones and dropped omitted fields).

- [x] **Task 0.15 — Method expressions on pointer receivers**
  - Files: `src/parser/expressions.js`, `src/typechecker/expressions.js`
  - Do: `(*T).M` parses as a method expression when `T` names a type; its type is `func(*T, args…) results`. Value form `T.M` keeps working. Both backends reuse the existing method-value lowering.
  - Test: `test/unit/language/expressions.test.js` — the method-expression edge cases as parity tests; the old `cannot dereference non-pointer type` message must not appear for this form.
  - Done when: all pass.
  - Landed without parser changes: the parser already drops the parentheses, so `(*T).M` is a selector on `*T`, and the checker treats `*T` as a pointer type when `T` names a type (`(*p).M` on a pointer variable still dereferences). `Box[int]` in expression position (`Box[int].Get`, `(*Box[int]).Set`) is resolved as an instantiated type. The WASM backend had no method-value lowering to reuse, so a new desugaring pass (`src/backend/wasm/method-expr.js`, after monomorphisation) turns `(*T).M(p, a)` into `p.M(a)` and any other use into a forwarding func literal. Method values (`x.M`) in WASM stay with Task 0.19c, and pointer-receiver methods on named non-struct types (`func (c *Counter) Inc()`) produce an invalid module in WASM even when called directly, so they are not covered here.

- [x] **Task 0.16a — Strict-mode runtime panics (checks everywhere)**
  - Files: `src/backend/js/expressions.js` (strict index/field access), `src/backend/js/runtime.js` (`__at`, `__set`, `__nilmap`, `__deref` helpers)
  - Do: in strict mode only, index reads/writes on slices, arrays and strings go through bounds-checked helpers that throw `runtime error: index out of range [i] with length n`; a write to a nil map throws `assignment to entry in nil map`; field access through a nil struct pointer throws `runtime error: invalid memory address or nil pointer dereference`. `recover()` returns the same message as WASM.
  - Test: new `test/unit/compiler/strict-panics.test.js` — the runtime-panic edge cases as parity tests; a `js` package is unchanged (no helpers in output).
  - Done when: all parity tests pass (benchmark regression expected, fixed next).
  - Landed: reads use `__at(xs, i)`; writes, compound assignments, `++`/`--`, `&xs[i]` and string reads use `xs[__ix(xs, i)]` (with `__lv` binding a base that contains a call, so it is evaluated once). The nil-map zero value in strict mode is a frozen `__nilmap` sentinel, so reads, `len`, `range` and `delete` see an empty map and `__mw(m)[k] = v` panics. Field access through a struct pointer goes through the existing `__nilcall` guard. The WASM index panic now has Go's message too (`index out of range [5] with length 3`, `[-1]` alone for a negative index, as Go prints it): each check leaves the index and length in per-function locals and a failing check branches to a shared handler that calls `__index_panic(i64, i32)`.
  - Nil dereference in WASM: the audit row above assumed WASM already raised a recoverable panic here, but a `struct.get`/`struct.set` on a null reference is a trap, so `recover()` could not catch it and deferred calls did not run. Field reads, writes, compound assignments and `++`/`--` through a pointer now `br_on_null` to a per-function `nil` block (opened next to the index-check blocks) whose handler calls a shared `__nil_panic`, so the panic is a Go panic on both backends. Not covered (outside this task, which is field access only): a whole-value dereference of a nil pointer still traps in WASM (`q := *p` on a nil `*P`), and `*p` on a nil scalar pointer (`*int`) fails with `illegal cast` instead of Go's message. Cost in [Performance and size](#performance-and-size).

- [x] **Task 0.16b — Index-check elision**
  - Files: `src/lower/` (new `bounds.js`), `src/backend/js/expressions.js`
  - Do: skip the helper for `for i := range xs` indices, `for i := 0; i < len(xs); i++` with no writes to `i`/`xs` in the body, and constant in-range indices into arrays.
  - Test: `strict-panics.test.js` — assert `__at` is absent from the generated JS for the elidable loops and present when the body reassigns `xs`.
  - Done when: `npm run bench` hybrid raycast is within 3% of v1.7.0. If not, extend the analysis; do not disable the checks.
  - Landed: `markInBoundsIndexes` (`src/lower/bounds.js`) runs from the JS backend in strict mode and marks `xs[i]` `_inBounds` for the two loop shapes (local `xs`, never assigned, shadowed, address-taken, used as a selector base or written in any closure; `i` written only by the loop; indexes inside func literals in the body are not marked) and for constant indexes into arrays. The hybrid raycast runs in WASM, so the measured cost came from the 0.16a WASM change instead: keeping the length in a local for the panic message cost ~4%. A failing WASM check now branches with the index and a site id (an immediate) to a per-function handler that recomputes that site's length, so the hot path stores nothing extra. Numbers in [Performance and size](#performance-and-size).

- [x] **Task 0.17 — `goto` diagnostic**
  - Files: `src/lexer.js` (keyword), `src/parser/statements.js`, `src/typechecker/statements.js`
  - Do: parse `goto L` and labels so the error is targeted: `goto is not supported; restructure with labeled break/continue`.
  - Test: `test/unit/language/control-flow.test.js` — the message appears for `js`, `wasm` and `both` packages; `Undefined: 'goto'` does not.
  - Done when: the parity matrix row for `goto` passes.

### Phase 0.8: Generic zero values in JS

- [x] **Task 0.18 — Generic zero values and type-parameter operators in JS**
  - Files: `src/backend/js/index.js`, `src/backend/js/expressions.js`, `src/typechecker/expressions.js` (unary operators on type parameters)
  - Do: JS output must produce the zero value of the instantiated type wherever a generic body uses a type parameter's zero value (`var zero T`, `*new(T)`, zero results), for generic functions and for methods of generic types, for example by passing zero values from the call site or storing them on generic instances. Accept unary `-`, `+` and `^` on type parameters whose constraint allows them.
  - Test: `test/unit/wasm/generics.test.js` — parity tests for `cmp.Or("", "x")`, `cmp.Or(0, 3)`, `Stack[int].Pop` on an empty stack, and `Abs[T Number](x T) T` using `-x`. Turn the WASM-only `cmp.Or` test in `stdlib-go.test.js` into a parity test and drop the Task 0.18 note from the `cmp` row in `language-support.md`.
  - Done when: those pass as parity tests.
  - Landed: a generic function takes one zero-value factory per type parameter as leading arguments (`function Or($z_T, ...vals)`, called as `Or(__zs, "", "x")`; `F[int]` used as a value becomes a forwarding closure). An instance of a generic struct stores its factories under the `__tz` symbol (passed after the fields to the constructor and kept by `__clone`), and its methods bind `$z_T` from it, so interface dispatch sees them too; fields of a type-parameter type start at its zero value. Named results of type `T` failed in the checker with `Unknown type 'T'` (they resolved outside the type-parameter scope) and are fixed. Unary `-`/`+` accept a type parameter whose constraint's type set is all numeric; `^` requires all integers (`^ requires integer`). Not covered: methods of generic named non-struct types (`type List[T any] []T`) are static and have no instance to carry the factories, so their zero values stay `null` in JS. In WASM, monomorphisation does not substitute `T` in `new(T)` and drops named results when it copies a generic body, so `*new(T)` and `func F[T any]() (r T)` do not compile there yet; those cases are tested in JS only.

### Phase 0.9: Phase 0.5 review follow-ups

The Phase 0.5 reviews (PR #29) found these bugs. None of them were introduced by Phase 0.5; they were already on `feat/portable-go`. They are grouped here so they are fixed deliberately rather than inside an unrelated phase.

- [x] **Task 0.19a — Slice aliasing and multi-value assignment**
  - Files: `src/backend/js/expressions.js` (`_genSliceExpr`), `src/backend/js/statements.js` (for-init), `src/backend/wasm/emit-stmts.js` (assignment)
  - Do: in JS, `b[:]`, `b[i:]` and `a[:]` on non-typed-array slices and arrays must alias the backing store as in Go, not `.slice()` a copy (`b := []int{1,2,3}; s := b[:]; s[0] = 9; b[0]` is 9). In WASM, `x, y = y, x` (and `a, b = b, a` for arrays) evaluates every right-hand side before assigning. In JS, `for i, j := 0, 10; …; i, j = i+1, j+1` emits valid code.
  - Test: parity tests in `test/unit/wasm/arrays.test.js` and `test/unit/language/` for each case. Re-check the `closures.test.js` test "slicing an array loop var aliases…", which only passes in JS because of the copy.
  - Done when: all pass as parity tests; `npm run bench` within 3%.
  - Landed: JS returns the operand itself for `b[:]`, `b[0:]` and `a[:]` (non-typed-array slices, arrays and strings). `b[i:]` with a non-zero `i` and slices with a high bound still copy: a plain JS array cannot be a view onto part of another, and a slice view type is a representation change far outside this phase's budget, so the difference is documented in `docs/go-compatibility.md` instead; the `b[i:]`/high-bound part moved to Task 0.20. WASM multi-value assignment and definition (`_parallelAssignValues`): when a later right-hand side could observe an earlier assignment (it reads an assigned variable, an element, a field, a pointer, a boxed variable or calls a function; for `:=` only redeclared names count), every non-pure value is stored in a temporary first, in source order; pure values (literals, constants, unboxed locals that are not assigned, `len`/`cap` of those) stay inline, so `lo, hi := 0, len(xs)` is unchanged. JS `x, y := 2, x` with a redeclared `x` had the same bug and now goes through a tuple temporary. JS for-init/post emit one declarator per variable and a destructuring assignment. The post-statement parse failure (`i, j = j, i+j {` read `j {` as a composite literal) needed `src/parser/statements.js` and `src/parser/expressions.js` (outside the file list): the `noCompLit` flag now reaches every expression of a header simple statement. Bench (3 runs each, median): base hybrid 11,582 / js 9,118 rays/s, after 11,685 / 9,096 (+0.9% / −0.2%), 2,688 B alloc/run in both; raycast `app.wasm` 79,134 → 79,160 bytes, hot-function instruction counts unchanged.

- [x] **Task 0.19b — Array type completion**
  - Files: `src/backend/wasm/types.js`, `src/backend/wasm/emit-exprs.js`, `src/backend/js/expressions.js` (`_genImplicitCompositeLit`, `_genArrayLitElems`), `src/typechecker/expressions.js`
  - Do: named array types (`type V [3]int`, its literals, comparison and methods) produce valid WASM. Pointers to arrays (`p := &a; p[i]; *p`) type-check and produce valid WASM. Keyed slice literals (`[]int{2: 7}`) work on both backends. Keyed nested literals with elided types (`[2][3]int{1: {2: 5}}`) produce arrays in JS. Keyed elements evaluate in source order on both backends. WASM array literals over 10000 elements do not hit the `array.new_fixed` limit.
  - Test: parity tests in `test/unit/wasm/arrays.test.js`.
  - Done when: all pass as parity tests.
  - Landed: named array types failed in WASM because element types were read from `t.elem` (undefined on a named type), so literals, zero values and index reads/writes used an `i32` array; they now go through `_getArrayElemType`, and a bare `{ kind: "named" }` method receiver resolves through the checker in `toWasmType` (it became `i32`). The checker rewrites `p[i]`, `p[lo:hi]`, `len(p)`/`cap(p)` and `range p` on a pointer to an array to an explicit `(*p)` (`_derefArrayPtr`), so both backends see the array. In WASM a pointer to an array is the array reference (as the existing index paths assumed): `&a` on a boxed array local reads the box, and `*p = v` and assignments to a boxed (address-taken) array copy into the existing array (`_emitArrayStoreInto`), so `p` sees later assignments to `a` (`*p = v` was silently dropped). Keyed slice literals are checked like array literals (duplicate and non-constant keys report the same errors). Both backends evaluate keyed elements in source order: WASM allocates the array and stores in source order when keys are not ascending or the literal has more than 10000 elements (the `array.new_fixed` limit); JS evaluates the values first and spreads them into place when keys are not ascending. JS builds nested keyed literals with elided types (`{2: 5}`) as arrays instead of objects. Files outside the list: `src/backend/wasm/emit-stmts.js` (index and deref assignment), `src/backend/wasm/emit.js` (zero value of a named array) and `src/backend/wasm/index.js` (accessor-helper element type).

- [x] **Task 0.19c — WASM scoping and method values**
  - Files: `src/backend/wasm/emit-stmts.js`, `src/backend/wasm/emit.js` (locals), `src/backend/wasm/emit-exprs.js`
  - Do: WASM locals are block-scoped, so an inner `x := 5` no longer writes the outer `x`. A range key or value variable that a closure captures and mutates produces a valid module. Method values on pointer receivers (`f := p.Get`) and promoted pointer-receiver methods on loop variables work in WASM.
  - Test: parity tests in `test/unit/wasm/closures.test.js`.
  - Done when: all pass as parity tests and `zero-alloc.js` still passes.
  - Landed: `emitStmt` restores the local-name map after a block, `if`, `for`, `switch` and type switch, so inner declarations end with their scope; a short variable declaration computes its value before the new name exists (`x := x * 2` reads the outer `x`), and a redeclared name in a multi-name `:=` is assigned instead of getting a new local. A range key or value that a closure captures and mutates gets a raw iteration local plus a fresh box at the top of each iteration (`_allocRangeVar`/`_emitRangeBoxes`); the closure environment also took the range tuple as the variable's type. Method values (`f := p.Get`, `c.Inc` on an addressable value, promoted methods) are desugared in `src/backend/wasm/method-expr.js` into a call of a func literal that binds the receiver when evaluated (a copy for a value receiver, `&x` for a pointer receiver); func-typed parameters and results there no longer become `any`. The checker now marks `p.M` on a pointer as a method value too. `&o` on a boxed struct local is the struct reference, and `++`/`+=` on a promoted field (`o.N` on an embedded `Inner`) used a temporary of the outer struct's type and produced an invalid module. Files outside the list: `src/backend/wasm/method-expr.js`, `src/typechecker/expressions.js` (pointer method values) and `src/backend/js/expressions.js` (a value-receiver method value copies the receiver in JS too; it bound the live struct). Not covered, both JS-only and pre-existing: an inner `x := x * 2` throws `Cannot access 'x' before initialization` in JS (the parity test is WASM-only), and `Outer{Inner{1}}` leaves the promoted field `N` at 0 in JS (the class keeps a flattened copy of promoted fields beside the embedded struct).

- [x] **Task 0.19d — Interop and naming leftovers**
  - Files: `src/backend/js/index.js`, `src/backend/wasm/boundary.js`, `src/typechecker/stdlib/` (`slices`), `src/parser/declarations.js`
  - Do: a type declaration named after a browser global (`type Array struct{}`, `type Error struct{}`) is renamed like other declarations, or rejected with a clear diagnostic; update the warning in `docs/go-compatibility.md`. Exported non-shared vars of a `wasm` package appear in the JS facade. `slices.Contains`/`Index` on struct slices compare by value in JS. The parser accepts `func mk() (Box[int], *Box[int])`.
  - Test: `test/unit/types/shadowing.test.js`, `test/unit/wasm/boundary.test.js`, parser and stdlib tests for each case.
  - Done when: all pass.
  - Landed: type declarations are **rejected**, not renamed. The `$` suffix mechanism renames binding identifiers in the AST (functions, variables, parameters); type names reach the JS output through the checker's type objects instead (class declarations, `new T`, `instanceof T`, static methods of named types, `structNames`), so a rename would touch dozens of emission sites. The checker (`_checkGlobalTypeNamesPass` in `src/typechecker/index.js`, outside the file list) reports `type Array shadows the JavaScript global Array; rename the type` in `js` and `both` packages, only for declarations that emit a class (struct types and named types with methods) and only for the JavaScript built-ins generated code calls (`Array`, `Object`, `Error`, `Map`, `Set`, `Number`, typed arrays, …): DOM names such as `type Element struct{}`, interfaces like `type Number interface{…}` and method-less named types stay valid, as do all types in `wasm` packages. Exported non-shared vars of a `wasm` package of a supported boundary type are read once when the module loads, after package initialization (`__var_<Name>` getters); vars of unsupported types are left out of the facade. `slices.Contains`/`Index` on struct or array elements compare with `__equal` (in `src/backend/js/stdlib/slices.js`; the JS emitter, not `src/typechecker/stdlib/`) and accept a nil slice. A result list entry `Name[…]` followed by `,` or `)` parses as an instantiated type, not a result name.

### Phase 0.10: JS slice views

- [x] **Task 0.20 — Slice views in JS**
  - Files: `src/backend/js/expressions.js` (`_genSliceExpr`), `src/backend/js/runtime.js`, plus the JS stdlib helpers that consume slices as needed
  - Do: in JS, `b[i:]`, `b[:n]`, `b[i:j]` and `b[i:j:k]` on slices and arrays share the backing store with the operand as in Go: writes through either are visible in both, and `append` within capacity writes into the shared store. This needs a slice view representation; decide the representation in this task and keep the typed-array fast paths and the raycast bench intact.
  - Test: parity tests in `test/unit/wasm/arrays.test.js`, for example `v := [3]int{1,2,3}; p := &v; q := p[:2]; q[0] = 9; r := p[:]; r[1] = 8; return v[0]*10 + v[1]` → 98, plus append-within-capacity sharing.
  - Done when: all pass as parity tests; `npm run bench` within 3%; the slice-copy note in `docs/go-compatibility.md` is narrowed to self-reslice: `x = x[lo:hi]` within `len(x)` copies a plain array by design (a documented divergence, kept so hot self-reslice loops index a plain array instead of a `Proxy`), and the note states exactly where that copy differs from Go.
  - Landed: a partial view of a plain array is a `Proxy` over an empty `__SV` array (an `Array` subclass whose species is `Array` and which prints its elements in Node) holding the backing array, offset, length and capacity (`__slice`/`__mkview` in `src/backend/js/runtime.js`); the traps cover indexing, `length`, `in`, iteration and own keys, so `Array.isArray`, `Array.prototype` methods, `JSON`, `fmt`, the stdlib helpers and the JS↔WASM boundary see an ordinary array. A view that covers its whole backing array is that array, and an empty view without spare capacity is `[]`. Typed-array views stay `subarray`; a capacity beyond the length is kept in a `WeakMap` shared by every compiled module (`Symbol.for("gofront.typedCap")`), and `append` within it writes into the shared buffer. `cap` is `__cap`, `b[i:j:k]` limits the capacity, bounds beyond the capacity panic with `slice bounds out of range`, and `make([]T, n, cap)` (`__mkslice`, in `genMake`) allocates the capacity, because the new bounds check made `make([]int, 0, 10)[:5]` throw. `slices.Compact`/`CompactFunc`/`Delete`/`DeleteFunc` reslice a view instead of setting its length, and `Insert`/`Replace` copy it to a plain array first. Exception: `x = x[lo:hi]` with the same variable or field chain on both sides (`_markSelfReslice` in `src/backend/js/statements.js`, outside the file list) copies a plain array when the result stays within `len(x)` (`__reslice`). The copy keeps the old capacity (`__rcap`, a shared `WeakMap` from the copy to `{b, o, c}`): `cap` reports it, and a slice or `append` beyond the copy's length writes the copy back into `b` and continues with a view over `b`. A bare parameter, receiver or named result (`xs = xs[:n]`, tracked in `_fnCtx.params`, closures inherit the enclosing function's) keeps the view, so the caller's store is shared. `for … range` with a value over a plain `[]T` unwraps a view once (`__arr?.[__sv]`, the one-line `sv` helper) and reads `b[o + i]`, so ranging over a view costs about as much as over a plain array; other indexing of a view still goes through the `Proxy`. The `Proxy` handler has `preventExtensions` (returns false, so `Object.freeze` throws a `TypeError`) and `defineProperty` (index data descriptors within the length write through; accessor, non-configurable and out-of-range ones are refused) traps; `push`, length-changing `splice`, `length =`, `structuredClone` and `freeze` are documented as unsupported on views handed to JS. Indexing a `Proxy` is about 25 times slower than a plain array, and the raycast fixture's `node.Children = node.Children[:kept]` turned octree children into views: with views everywhere the JS mode dropped 9.7% (8,869 → 8,007 rays/s). The slice-copy row in `docs/go-compatibility.md` is replaced by a row for this narrower case; the `cap()` and three-index rows are updated, as is `docs/compilation-mapping.md`. Bench (5 runs, median; base `feat/portable-go` 6aba777 measured in a worktree): js 8,869 → 9,120 rays/s (+2.8%), hybrid 11,309 → 11,473 (+1.5%), alloc/run unchanged (3,297,792 B js, 2,688 B hybrid). Not covered, pre-existing on both backends: assigning a whole array (`a = [4]int{…}`) after `s := a[1:3]` rebinds `a` in JS and WASM, so `s` keeps the old elements; `clear(s)` on a slice still sets the JS length to 0 instead of zeroing (and does nothing on a view). Review fix: a copy's write-back used to overwrite the old array with the whole copy, losing writes made through other slices, and resliced copies were flushed on every `x = x[:n]` (stack pops ran O(n) twice); now `__rcap` is a `Symbol.for("gofront.resliceCap")` property on the copy holding `{b, o, c, s, so}` with a snapshot `s` shared down a chain of copies, only elements that differ from the snapshot are written back (`__rcput`, and only the dropped ones when a copy is resliced again), and `x[i:j:k]` within a copy's length makes a view over the copy so the capacity is limited. Second review fix: the snapshot diff alone could not order a write through the copy against a write through another slice of the old array (same index written by both: the copy won; the copy writing back the snapshot value: the other slice won). Now every index write (`=`, `op=`, `++`/`--`, including for-clause posts) whose slice is a variable or field chain named in some `x = x[lo:hi]` of the package (`_collectResliceNames`, `_resliceSyncs` in `src/backend/js/statements.js`) is followed by `__rcs(x, i)`, which writes the element through to the old array and the snapshot when `x` is a copy (one symbol lookup otherwise); an index that the write could change or that has a call is bound to a temporary first. The snapshot diff (`Object.is`, so `-0` is written back) stays for writes through other references to the copy, which the `go-compatibility.md` row lists. The `__rcap` property is now non-enumerable. Third review fix: the sync re-read an index that the statement had changed (`x[c.i], c.i = 5, 0`, `s.buf[s.n] = s.next()` with `next` incrementing `s.n`), so it wrote the wrong element and overwrote an alias write; now only constants, and in a single assignment without calls unboxed variables, `len`/`cap` and arithmetic of those, are evaluated again (`isReusableIndex`), every other index is bound to a temporary first (for-clause statements skip such syncs, as documented). Tail reslices (`x = x[lo:]`) made a copy without spare capacity and no `__rcap` record, so writes through it never reached the old array; `__reslice` now attaches the record to every copy. Fourth review fix: the temporaries replaced AST nodes that the WASM backend type-checks afterwards (`Undefined: '__rci1'` for a `both` package used from both sides); `genStmt` now puts the nodes back after the statement. When one index is bound, every left-hand index with a call is bound too, in source order, and in a statement with a call the slice operand of a synced write is bound before the right-hand side, as Go evaluates it. Fifth review fix: a multi-assign that also reassigned the synced chain through a field or `*p` (`p.buf[0], p.buf = 5, o`) synced the new slice, so the slice operand is now bound first there too (for-clause statements skip that sync), a bound left-hand index is evaluated after its own operand (`get()[g()]`, `a[g()]` with `g` reassigning `a`), and a snapshot shared by a copy of a copy is copied on write (`__rcown`), so an older copy's write-back no longer reverts an element that `__rcs` wrote through.

### Phase 0.11: Lexer escapes and integer semantics

Phases 0.11–0.14 fix the bugs from the [review follow-ups](#review-follow-ups-2026-10-24) table that the PR #28–#40 reviews found and left open. They run **next, before Phase 3.1.2**. Each task turns its probes into parity tests: a `compileHybrid` (or `compileHybridProject`) test whose expected value is the go1.26 output quoted in the task.

- [x] **Task 0.21 — String and rune literal escapes**
  - Files: `src/lexer.js` (`readString`, the rune-literal reader)
  - Do: decode every Go escape in interpreted string literals the way the rune reader does: `\a`, `\b`, `\f`, `\v`, `\'` (runes only), `\xNN`, octal `\NNN`, `\uNNNN`, `\UNNNNNNNN`. An unknown escape is a lexer error (`unknown escape sequence`), as in Go. Bytes `\x80`–`\xff` follow the [§1.1](#11-string-semantics-both-backends) representation and that decision is written into §1.1 (in particular whether `[]byte("\xc3")` keeps the single raw byte).
  - Test: parity tests in `test/unit/language/core.test.js`: `len("\x00")` → 1 (P01), `len([]byte("\xc3"))` → 1 (P02), `"é" == "é"`, `"\101" == "A"`, `"\v\f"` lengths. Negative: `"\q"` with `assertErrorContains(errors, "unknown escape")`. Lexer unit test in `test/unit/compiler/lexer-parser.test.js`.
  - Done when: all pass; P16 (`strings.Fields("a\u0085b\vc")`) is re-probed and its remaining difference is only the `IsSpace` table owned by Task 3.3b.

- [x] **Task 0.22 — Unsigned unary operators and 64-bit shifts in JS**
  - Files: `src/backend/js/expressions.js` (`_genUnaryExpr`, shift emission)
  - Do: `^x` and `-x` on `uint8`/`uint16`/`uint32`/`uint`/`uintptr` wrap to the unsigned range in JS, as `+`/`*` already do. Shifts on `int64`/`uint64`/`int`/`uint` with a count ≥ 32 follow Go: `<<` by ≥ the bit size is 0, `>>` by ≥ the bit size is 0 or −1 for signed negatives. Keep the 32-bit fast path when the count is a constant below 32.
  - Test: parity tests in `test/unit/builtins/operators.test.js`: `^uint8(5)`, `-uint32(1)` → `250 4294967295` (P03); `int64(1) << 70` → 0 (P04); `int64(-1) >> 64`, `int64(-1) << 64` → `-1 0` (P51).
  - Done when: all pass; `npm run bench` within 3%.

- [x] **Task 0.23 — Shift count typing and negative constant counts**
  - Files: `src/typechecker/expressions.js` (binary shift), `src/typechecker/statements.js` (`<<=`/`>>=`), `src/typechecker/const-fold.js`
  - Do: a shift count may be any integer type (or an untyped constant representable as `uint`) in both `x << n` and `x <<= n`; the result has the type of the left operand. A constant negative count is an error.
  - Test: `test/unit/language/constants.test.js`: parity test `x := 1; var n uint = 3; x <<= n` → 8 (P50); negative test `const s = -1; x << s` with `assertErrorContains(errors, "invalid shift count")`.
  - Done when: both pass; no existing constant-folding test changes.

### Phase 0.12: JS value semantics leftovers

- [x] **Task 0.24 — Type-parameter struct values in JS**
  - Files: `src/backend/js/expressions.js` (equality, value copies), `src/backend/js/runtime.js`
  - Do: inside generic code, `==`/`!=` on a type parameter compares structs and arrays by value (`__equal`) when the type argument is a struct or array, and assigning or passing a `T` value copies it. Decide between static dispatch per instantiation and a runtime check on the value, and record the choice (chosen: runtime check on the type argument's zero-value factory `$z_T`, so one erased body serves every instantiation; an object zero means struct or array); non-struct type arguments keep the plain `===`.
  - Test: parity tests in `test/unit/types/generics.test.js`: `eq(P{1}, P{1})` → true (P06); `a := W[P]{P{1}}; b := a; b.v.A = 9; a.v.A` → 1 (P07).
  - Done when: both pass; `npm run bench` within 3%.

- [x] **Task 0.25 — Variadic spread in JS**
  - Files: `src/backend/js/expressions.js` (call arguments with `_spread`), `src/backend/js/statements.js` (variadic parameter prologue) as needed
  - Do: `f(xs...)` passes the slice itself as the variadic parameter (no copy, as in Go), so writes through the parameter reach the caller's slice; a nil `xs` gives a nil parameter instead of throwing. Calls with individual arguments keep building a fresh slice.
  - Test: parity tests in `test/unit/wasm/variadic.test.js`: `sum(nilSlice...)` → 0 (P08); `set(a...)` with `xs[0] = 9` → 9 (P09); `append(xs, ys...)` and `fmt.Println(args...)` unchanged.
  - Done when: all pass.

- [x] **Task 0.26 — Nil maps and nil slices in JS**
  - Files: `src/backend/js/expressions.js` (nil comparison, `_nilMap`), `src/backend/js/stdlib/fmt.js` (`Append*`)
  - Do: `m == nil` is true for the strict-mode `__nilmap` sentinel and for an unassigned map in `js` packages, and false for `map[K]V{}` and `make(map…)`. `fmt.Append(nil)` and `fmt.Append(nil, "")` return nil.
  - Test: parity tests in `test/unit/wasm/maps.test.js`: `var m map[string]int; n := map[string]int{}` → `true false` (P60); `fmt.Append(nil) == nil` → true (P17) in `test/unit/builtins/fmt-stringer.test.js`.
  - Done when: both pass; strict-mode nil-map write panics still pass.

- [x] **Task 0.27 — Struct literals and embedded fields in JS**
  - Files: `src/backend/js/expressions.js` (`_genImplicitCompositeLit`, selector assignment), `src/backend/js/runtime.js` (`fmt` map keys)
  - Do: an elided `&T` in `[]*T{{1}}` and `map[K]*T{"a": {1}}` builds the pointer. A write through a promoted field (`o.A = 5` with embedded `In`) writes `o.In.A`; reads already do. `fmt` prints struct map keys as Go does (`map[{1}:2]`, keys sorted as Go sorts them).
  - Test: parity tests in `test/unit/language/structs.test.js`: `xs := []*P{{1}, {2}}; xs[1].A` → 2 (P14); embedded write → 52 (P70); `fmt.Sprint(map[P]int{P{1}: 2})` → `map[{1}:2]` (P15).
  - Done when: all pass.

- [x] **Task 0.28 — Package-level arrays and named scalars**
  - Files: `src/backend/js/index.js` (global declarations), `src/backend/js/expressions.js` (array length from a constant), `src/backend/wasm/emit.js` (global initialisers), `src/lower/boxing.js`
  - Do: JS: `&g` on a package-level array is the array; `[N]T` with `N` a named constant has length `N`; a package-level named scalar whose address is taken by a pointer-receiver call (`g.Inc()`) is boxed like a local. WASM: a package-level `[N]T` global is initialised to its zero array, and `[N]T` with a named constant `N` has length `N`.
  - Test: parity tests in `test/unit/wasm/arrays.test.js` and `test/unit/language/named-type-methods.test.js`: `p := &g; p[0] = 5; g[0]` → 5 (P21); `g[1] + len(g)` → 3 (P22); `var a [N]int; a[2] = 4; len(a) + a[2]` → 7 (P23); `g.Inc(); g.Inc(); int(g)` → 2 (P29).
  - Done when: all pass.

### Phase 0.13: Parser and generics leftovers

- [x] **Task 0.29 — Composite-literal keys and named array types**
  - Files: `src/parser/expressions.js` (`parseCompositeLit`), `src/typechecker/expressions.js` (index on a named type), `src/typechecker/resolve.js`
  - Do: an element that starts with `{` may be a key: `map[P]int{{1}: 2}` and `map[[2]int]string{{1, 2}: "a"}` parse as key/value pairs with elided key types. `type W V` where `V` is a named array type is indexable, sliceable and has `len` on both backends.
  - Test: parity tests in `test/unit/language/expressions.test.js`: `len(map[P]int{{1}: 2})` → 1 (P13); `W{1, 2}[1]` → 2 (P24). Parser test for the elided-key form in `test/unit/compiler/lexer-parser.test.js`.
  - Done when: all pass.

- [x] **Task 0.30 — Explicit instantiation through a package qualifier**
  - Files: `src/typechecker/expressions.js` (`IndexExpr` on a namespace member, `instantiateGenericFunc`), `src/typechecker/resolve.js` (`_resolveGenericTypeName` for `pkg.T[X]`)
  - Do: `pkg.F[T1, …](args)` instantiates a generic function from an imported package (user, emitter-backed or Go-source), and `pkg.T[X](v)` converts to an instantiated generic type. Type arguments resolve in the caller's scope (today `int` is looked up in the package scope).
  - Test: project parity tests in `test/unit/builtins/iter.test.js` and `test/unit/compiler/stdlib-go.test.js`: `cmp.Compare[int](1, 2)` → -1 (P11); `iter.Seq[int](f)` ranged → 4 (P12); `len(slices.Collect[int](slices.Values([]int{1, 2})))` → 2 (P74); a user package `util.Id[string]("x")`.
  - Done when: all pass on `both` and `wasm` targets.

- [x] **Task 0.31 — Recursive generic types**
  - Files: `src/typechecker/resolve.js` (`instantiateGenericType`), `src/backend/wasm/monomorph.js`
  - Do: a generic type that refers to its own instantiation (`Next *List[T]`, `Children []Tree[T]`) is instantiated once per type-argument list through a cache entered before the fields are resolved. Mutual recursion (`A[T]` ↔ `B[T]`) works the same way.
  - Test: parity tests in `test/unit/wasm/generics.test.js`: `l.Next.V` → 2 (P10); a `Tree[string]` with `[]Tree[T]` children; `A[T]`/`B[T]` mutual recursion.
  - Done when: all pass on both targets and the compiler does not overflow the stack.

- [x] **Task 0.32 — Generic named types: embedding, defined types and type switches**
  - Files: `src/typechecker/expressions.js` (selector lookup), `src/lower/embedding.js`, `src/typechecker/resolve.js`, `src/backend/js/statements.js` (`genTypeSwitch`)
  - Do: methods and fields promoted from an embedded non-generic struct are visible on a generic struct. `type S3[T any] Base` (a generic defined type over a named struct) gets `Base`'s fields and its own methods. In JS, a type switch or assertion distinguishes instantiations of the same generic type (`*Stack[int]` vs `*Stack[string]`); record how the instantiation is identified at run time.
  - Test: parity tests in `test/unit/types/generics.test.js`: `o.N()` → 7 (P44); `S3[int]{n: 5}.N()` → 5 (P45); type switch → 2 (P42).
  - Done when: all pass.

### Phase 0.14: Pointer stability and WASM leftovers

- [x] **Task 0.33 — Pointers survive whole-value assignment**
  - Files: `src/backend/wasm/emit-stmts.js` (assignment to an address-taken array or struct variable), `src/backend/js/statements.js`, `src/lower/ownership.js`
  - Do: assigning a whole array or struct to a variable whose address (or an element's or field's address) has been taken writes into the existing storage (`array.copy` / field-by-field in WASM, an in-place copy in JS), so existing pointers see the new value. Variables whose address is never taken keep the current fast path.
  - Test: parity tests in `test/unit/wasm/pointers.test.js`: `p := &a[1]; a = [3]int{4, 5, 6}; *p` → 5 (P20); `p := &s; s = S{5}; p.A` → 5 (P25); the same through a field array (`&w.arr[0]`).
  - Done when: all pass; `zero-alloc.js` still passes; `npm run bench` within 3%.

- [x] **Task 0.34 — Named types with methods in WASM**
  - Files: `src/backend/wasm/emit-exprs.js` (method calls through pointers), `src/backend/wasm/method-expr.js`, `src/backend/wasm/types.js`
  - Do: a value-receiver method called through a pointer to a named scalar (`p.Get()` with `p *N`) dereferences the box. A pointer-receiver method on a named slice (`func (l *L) Add`) writes the new slice header back to the variable.
  - Test: parity tests in `test/unit/language/named-type-methods.test.js`: `p.Get()` → 3 (P26); `l.Add(1); l.Add(2); len(l)` → 2 (P28).
  - Done when: both pass.

- [x] **Task 0.35 — Stdlib functions as values in WASM**
  - Files: `src/backend/wasm/emit-exprs.js` (selector on a stdlib namespace), `src/backend/wasm/emit-stdlib.js`, `src/backend/wasm/method-expr.js`
  - Do: a stdlib function used as a value (`var sp = fmt.Sprint`, `f := strings.ToUpper`, `sort.Slice` passed around) becomes a closure over the emitter call. A member that cannot be a value (an intrinsic with no function form) gets a targeted diagnostic naming it, never `Cannot resolve struct for selector`.
  - Test: parity tests in `test/unit/wasm/stdlib.test.js`: `sp(1)` → `1` (P72); `strings.ToUpper` passed to a `func(string) string` parameter; negative test with `assertErrorContains` for a non-value member.
  - Done when: all pass.

- [x] **Task 0.36 — Range-over-func leftovers in WASM**
  - Files: `src/backend/wasm/emit-stmts.js` (range-over-func lowering), `src/backend/wasm/monomorph.js`, `src/lower/range.js`, `src/backend/wasm/index.js` (package-level initializer analysis), `src/lower/index.js`
  - Do: ranging directly over a func literal works; an iterator whose yield parameter is a pointer to a struct produces a valid module; `slices.Values`/`All` over a slice of a generic struct produces a valid module.
  - Test: parity tests in `test/unit/wasm/range_func.test.js`: func literal → 3 (P46); `*P` yields → 7 (P47); project test for `slices.Values([]Box[int])` → 3 (P40).
  - Done when: all pass.

### Phase 1.1: Manifest generator and coverage gates

- [x] **Task 1.1a — Manifest generator**
  - Files: new `scripts/stdlib-manifest.js`, `package.json` (`manifest:update` script)
  - Do: read `$(go env GOROOT)/api/go1.txt` … `go1.26.txt`, parse `pkg <path>, func|type|var|const|method` lines into `{pkg, name, kind, signature}`, and write `runtime/stdlib/manifest.json` with a `status` of `todo` for every member of every package named in the [Scope rule](#scope-rule) and the member tables. Packages absent from the scope rule get `excluded:<category>` from the table.
  - Test: new `test/unit/compiler/manifest.test.js` — the JSON parses, every entry has `pkg`, `name`, `kind`, `signature`, `status`; a sample of known members is present (`strconv.ParseInt` with `func(string, int, int) (int64, error)`).
  - Done when: the manifest is checked in and regenerating it is a no-op.
  - Landed: `npm run manifest:update` (`--check` fails on a stale file) reads the API files up to `go1.26.txt`, drops platform-specific lines (`pkg os (linux-386), …`), `//deprecated` markers and the `except.txt` features, and writes one entry per member: `func`, `var`, `const` (signature is the type, `ideal-int` for untyped constants), `type` (generic types keep their `[$0 …]` parameter list), `method` (name `T.M`, receiver in `recv`, interface methods included) and `field` (struct fields and `embedded` fields, name `T.F`). In-scope packages are the ones the scope rule and its member tables name, the ones §4–§9 add and the ones GoFront already ships (52 packages, all members `todo`); every other package in the API files gets a single `package` entry with `excluded:runtime|host|reflection|deferred` (121 packages; unlisted pure packages such as `mime`, `net/netip` or `log/slog` are `deferred`). A package the scope rule does not classify fails the generator. The file uses Biome's JSON layout so `npm run format` leaves it unchanged. The idempotence test regenerates the manifest only when a go1.26 toolchain is installed.

- [x] **Task 1.1b — Fill statuses and exclusion reasons**
  - Files: `runtime/stdlib/manifest.json`, `scripts/stdlib-manifest.js` (status overrides file `scripts/manifest-overrides.json`)
  - Do: mark every member `js`, `wasm`, `both` or `excluded:<reason>` according to the scope rule and the member-level table. Unknown members default to `todo`, which the coverage test treats as a failure, so the audit is forced to finish.
  - Test: `manifest.test.js` — no `todo` entries remain for packages scheduled in Phases 2–5; every `excluded:` reason is one of the five categories.
  - Done when: `grep -c '"todo"'` on the manifest is 0 for scheduled packages.
  - Landed: `scripts/manifest-overrides.json` gives every in-scope package a default status (`both`; `regexp` is `js`; `os` is `excluded:host`), and a package without one stays `todo`. Ordered rules (exact names, `T.*` for a type with its methods and fields, `*` with an optional exact `signature`) apply the member-level table and record a `note` with each `js`/`excluded:` status; a rule that matches no member fails the generator. Every in-scope package is scheduled (Phases 2–5 for new packages and members, Task 3.7 for the rest of the already supported ones), so no entry is `todo`: 1,728 `both`, 57 `js`, 691 `excluded:` (109 runtime, 231 host, 6 reflection, 345 deferred; the per-package entries of excluded packages are included). The closed set of exclusion categories is the four **Excluded** rows of the scope rule (`runtime`, `host`, `reflection`, `deferred`); the fifth non-pure row, *JS-only by design*, is the `js` status rather than an `excluded:` reason. Classifications beyond the tables, by the scope rule's tie-breaker: `io.Pipe` and its types (blocking), `sync.WaitGroup.Go` (goroutine), `sync/atomic` `*Pointer` functions (`unsafe.Pointer`), `context.Context.Done` and `iter.Pull`/`Pull2` are `runtime`; `filepath.Abs`/`EvalSymlinks`/`Glob`/`Walk`/`WalkDir` (with `WalkFunc`, `SkipDir`, `SkipAll`) and the `TempDir`/`Chdir`/`ArtifactDir` methods of `testing` are `host`; `testing.F` (fuzzing), `B.RunParallel`/`SetParallelism`/`PB`, `AllocsPerRun` and the `go test` driver internals (`Main`, `MainStart`, `Run*`, `Internal*`, `Cover*`) are `runtime`; `crypto/rand.Int`/`Prime` (need `math/big`), `time.LoadLocationFromTZData` and the `unicode` tables other than the nine general categories (every `*RangeTable` variable, the table maps, `CaseRanges`, `SpecialCase`, `TurkishCase`, `AzeriCase`) are `deferred`.

- [x] **Task 1.2a — Coverage gate by name**
  - Files: new `test/unit/types/stdlib-coverage.test.js`
  - Do: for each manifest entry with status `js`/`wasm`/`both`, assert the member exists in the checker namespace (and, for `wasm`/`both`, in `WASM_STDLIB_MEMBERS` or a Go-source package). For each `excluded:` entry, assert importing or referencing it yields the exclusion diagnostic. Replace the v1.6.1 JS-vs-WASM diff test.
  - Test: the gate itself; it must fail on the current tree with a list of missing members.
  - Done when: the failure list equals the union of the Verified-gaps tables (reconcile differences in Task 1.5).
  - Landed: the gate runs three checks. **By name**: every `js`/`wasm`/`both` member is a namespace member of the emitter-backed package (`T.M`/`T.F` through the type's methods and fields) or an exported declaration of its Go-source package. **WASM**: every `wasm`/`both` member that exists is also allowed in wasm packages (`WASM_SUPPORTED_STDLIB` and `WASM_STDLIB_MEMBERS`, or Go source). **Exclusions**: importing an excluded package or referencing an excluded member in a `js` package fails with an error that contains the manifest `note` (or the category when there is none); warnings do not count. So that `npm test` stays green while the tree is incomplete, the known failures are listed explicitly in `test/unit/types/stdlib-coverage.gaps.json` (check → package → members, `*` for a whole package). The gate fails with the list of members when a gap is not in the file (a regression or a newly classified member) and when a listed gap no longer fails (the file must shrink); `node test/unit/types/stdlib-coverage.test.js --update-gaps` rewrites it. On this tree the list is 1,245 missing members in 49 packages, 16 members that exist but are not available in wasm packages (`encoding/json`, `io.LimitedReader`, `os.Stdout`/`Stderr`/`Stdin`, `strings.Replacer`, `testing.Short`/`Verbose`) and all 691 exclusions: no exclusion diagnostic exists yet (an excluded import is a `cannot find types … treating as any` warning, an excluded member a generic `No member` / `Unknown type` error), and no task in this plan adds one. Assigning the gaps to task numbers is Task 1.5. There was no v1.6.1 JS-vs-WASM diff test in `test/unit/` to replace.

- [x] **Task 1.2b — Coverage gate by signature**
  - Files: `test/unit/types/stdlib-coverage.test.js`, `src/typechecker/stdlib/` (signature printer helper)
  - Do: print each checker signature in Go's `api` notation and compare with the manifest. Mismatches fail with both strings. Fix the mismatches found (start with `strconv.ParseInt` → `int64`).
  - Test: the gate itself; add a unit test for the signature printer on generics, variadics and methods.
  - Done when: zero signature mismatches for members marked `js`/`wasm`/`both`.
  - Landed: `src/typechecker/stdlib/signature.js` (`goSignature`) prints a checker type in the `api/*.txt` notation: `interface{}` for `any`, no `void` result, `ideal-*` for untyped constants, types of the printed package unqualified, type parameters as `$0`, `$1`, … (a method of a generic type uses its receiver's), `interface { A, B }` for an interface definition and `struct` for a struct. The gate compares every member that exists in GoFront (emitter or Go source) with the manifest. `strconv.ParseInt` now returns `int64` (both backends already used a 64-bit value). **Done-when deviation:** 163 mismatches remain and are listed with GoFront's current signature under `signature` in `stdlib-coverage.gaps.json` (a changed GoFront signature, an unlisted mismatch or a fixed one fails the gate). They need decisions this plan does not make, so they were not fixed here: 35 generic `slices`/`maps` functions are typed by special-cased checker code as `func(interface{}) interface{}` (express them as real generics, or teach the printer the special cases?); 25 function-typed parameters are `interface{}` (`strings.FieldsFunc`, `sort.Slice`, `math/rand.Shuffle`, …); 28 untyped constants are typed (`math.Pi` is `float64`, so `var f float32 = math.Pi` is rejected); 35 use `int` for `rune`/`byte`/`int32`/`int64`/`uint8` (`unicode.IsLetter`, `strings.IndexByte`, `strconv.FormatFloat`'s `fmt`, `math/rand.Int63`, …), which also changes the WASM value type of the argument; and 40 others: `time.Month`/`Weekday` are `int` (Task 3.4b), `fmt.Print*` return nothing and `fmt.Fprint*` take `interface{}` instead of `io.Writer` (Task 3.1e), `binary.Read`/`Write` take `interface{}`, `base64` encodings are values instead of `*Encoding`, `binary.BigEndian`/`LittleEndian` have exported type names, and `os.Stdout`/`Stderr`/`Stdin`, `time.UTC`/`Local`, `strings.Builder`, `bytes.Buffer`, `sha256.New` are `interface{}` (Tasks 3.1e, 3.4b, 3.4c, 4.5).

### Phase 1.2: Conformance harness, documentation and reconciliation

- [x] **Task 1.3a — Conformance runner**
  - Files: new `test/conformance/run.js`, `test/conformance/README.md`, `package.json` (`conformance` script, included in `npm test`)
  - Do: for each `test/conformance/<pkg>/<name>.go`, compile as a `both` package, run `main` on JS and on WASM, and compare both outputs byte for byte with `<name>.out`. Missing `.out` is a failure with the `conformance:update` hint.
  - Test: one fixture per existing package (`strings`, `strconv`, `fmt`) with hand-verified `.out` files to bootstrap.
  - Done when: `npm run conformance` passes on the bootstrap fixtures on both backends.
  - Landed: `test/conformance/run.js` finds `<pkg>/<name>.go`, compiles each as a `both` package (JS through the strict `both` code generator, WASM through `compileWasm`, which must validate), runs the module on JS (the generated module calls `main` itself) and calls the exported `main` in WASM, capturing raw stdout: `process.stdout.write` and `console.log` in JS, the line-buffered `stdout` callback in WASM. Each output is compared with `<name>.out` as bytes; a failure names the backend and the first differing line, and a missing `.out` names `npm run conformance:update`. `npm run conformance` runs after the unit tests in `npm test`, and `test/unit/compiler/conformance.test.js` covers the runner on temp-dir fixtures. Bootstrap fixtures: `strings/basic.go`, `strconv/basic.go`, `fmt/basic.go`, with `.out` files written by hand and checked against `go run`. Writing them found gaps that were left out of the fixtures because later tasks own them: `fmt.Sprint`/`Sprintln` do not exist and `fmt.Print` spaces operands wrongly on both backends (JS: no space between numbers; WASM: a space between every operand) (Task 3.1a); `%U` and `%T` are printed literally (Task 3.1c); `fmt.Print` of a string that contains `"\n"` is never flushed in WASM, and an unterminated last line is lost there (Task 3.1e's shared line buffer); not yet in any task: `%e` prints a one-digit exponent (`1.234568e+3`, Go `e+03`), `%q` on a `[]string` quotes the joined string, and `fmt.Sprintf("%v", nil)` produces an invalid WASM module (`local.set expected type i64, found ref.null`).

- [x] **Task 1.3b — `conformance:update` with real Go**
  - Files: `test/conformance/update.js`, `package.json`
  - Do: run each fixture with `go run` (go1.26) and write `.out`. Fail clearly when `go` is missing. Fixtures are plain Go programs, so they compile with both toolchains.
  - Test: regenerate the bootstrap fixtures; the files must be unchanged.
  - Done when: the README documents the workflow and CI does not need `go`.
  - Landed: `test/conformance/update.js` (`npm run conformance:update [-- <dir-or-fixture>…]`) checks `go env GOVERSION` (missing `go` or a version other than go1.26.x exits 1 with an explanation), runs `go run` on each fixture from its directory and writes `<name>.out`, reporting created/updated/unchanged files. `conformance.test.js` checks the missing-`go` message with an empty `PATH` and, when go1.26 is installed, that Go's output equals every checked-in `.out`. Regenerating the bootstrap fixtures with go1.26.10 left them unchanged.

- [x] **Task 1.3c — Fixture lint for string semantics**
  - Files: `test/conformance/run.js`
  - Do: reject fixtures that apply `len(`, index `[`, or `range` to a string literal containing non-ASCII bytes, with the hint from [§1.1](#11-string-semantics-both-backends). `[]byte(...)` forms are allowed.
  - Test: a deliberately bad fixture in a temp dir is rejected.
  - Done when: the lint runs as part of `npm run conformance`.
  - Landed: `lintFixture` in `test/conformance/run.js` scans the fixture's tokens for `len(<lit>)`, `<lit>[` (index and slice) and `range <lit>` where `<lit>` is a string literal with a non-ASCII character or, in an interpreted literal, an escape that produces a byte ≥ 0x80 (`\xc3`, `\303`, `\u00e9`; read from the source because the lexer partly decodes escapes, so `"\\xc3"` is ASCII). Each use is reported as `<pkg>/<name>.go:<line>: …` with the §1.1 hint, and `checkFixture` rejects a fixture before compiling it. `[]byte(…)`/`[]rune(…)` and literals not under `len`/index/`range` pass. Literals reached through variables are not tracked. Tests in `conformance.test.js` (temp-dir fixture rejected, allowed forms).

- [x] **Task 1.4 — Generated stdlib docs**
  - Files: new `scripts/docs-stdlib.js`, `docs/language-support.md`, `docs/hybrid-wasm.md`, `package.json` (`docs:stdlib`, added to `check`)
  - Do: generate the package tables between `<!-- stdlib:begin -->` / `<!-- stdlib:end -->` markers from the manifest. `npm run check` fails when the committed tables differ from the generated ones.
  - Test: `manifest.test.js` — the generator is idempotent.
  - Done when: both docs carry generated tables and `npm run check` enforces freshness.
  - Landed: `scripts/docs-stdlib.js` (`npm run docs:stdlib`; `--check` runs in `npm run check` after Biome) writes per-package tables between the markers. Decision: the manifest's `js`/`both` status is the *target*, so a member counts as available only when `test/unit/types/stdlib-coverage.gaps.json` does not list it (`missing`, plus `wasm` for the WASM table); the tables describe the current tree, and a task that shrinks the gaps file must rerun `npm run docs:stdlib`. `language-support.md` gets *Available N of M / Not yet / JS-only / Excluded* for every in-scope package plus the whole-package exclusions by reason; `hybrid-wasm.md` gets *Available N of M / Not yet* over the `wasm`/`both` members. The hand-written member tables stay below the generated ones as notes (they also cover `gom`, `gofront/shared` and `gofront/simd`, which are not in Go's API files); the parity matrix still reads the rows above `### Standard library shims`. Tests in `manifest.test.js`: counts on a small manifest, marker replacement is idempotent and needs both markers, and the committed docs equal the generated text.

- [x] **Task 1.5 — Audit reconciliation**
  - Files: this document ([Verified gaps](#verified-gaps-2026-10-20-v170-tree) and the task lists)
  - Do: take the coverage-gate failure list; every member is either already in a Phase 2–5 task, added to Task 3.7, or marked `excluded:` with a reason in the manifest. Record the final counts (supported/excluded per package) here.
  - Test: `stdlib-coverage.test.js` has no unclassified failures.
  - Done when: the only remaining failures are members scheduled in later tasks, listed by task number in this document.
  - Landed: every entry of `test/unit/types/stdlib-coverage.gaps.json` (the coverage gate's complete failure list: 1,245 missing members, 16 members not available in wasm packages, 163 signature mismatches and 691 exclusions without a diagnostic) is assigned to a task below; none needed a new `excluded:` status. The members a Phase 2–5 task names (or that belong to a type it names) stay with that task; Task 3.7 now lists every other member by name, together with the exclusion diagnostic, the signature mismatches no other task fixes, and the `fmt` defects that the Task 1.3a fixtures found. `stdlib-coverage.test.js` has no unclassified failure: anything not in the gaps file fails it. Final counts per in-scope package (members as in Go's `api` files: functions, types, methods, fields, constants, variables; **Supported** is what the gate finds today, out of the `js`/`wasm`/`both` members; **WASM** and **Signature** are failures of members that exist; the 121 packages excluded as a whole are listed in the [generated table](../../docs/language-support.md#standard-library-shims)):

    | Package | Supported | Excluded | Missing | WASM | Signature | Scheduled in (failures) |
    |---|---|---|---|---|---|---|
    | `bufio` | 0 of 79 | 0 | 79 | 0 | 0 | 4.1a (23), 4.1b (38), 4.1c (18) |
    | `bytes` | 49 of 99 | 0 | 50 | 0 | 9 | 2.4 (5), 3.4c (29), 3.7 (25) |
    | `cmp` | 4 of 4 | 0 | 0 | 0 | 0 | — |
    | `container/heap` | 0 of 11 | 0 | 11 | 0 | 0 | 4.4 (11) |
    | `container/list` | 0 of 21 | 0 | 21 | 0 | 0 | 4.4 (21) |
    | `container/ring` | 0 of 10 | 0 | 10 | 0 | 0 | 4.4 (10) |
    | `context` | 0 of 20 | 1 | 20 | 0 | 0 | 4.3a (13), 4.3b (7) |
    | `crypto/hmac` | 0 of 2 | 0 | 2 | 0 | 0 | 4.6b (2) |
    | `crypto/md5` | 0 of 4 | 0 | 4 | 0 | 0 | 4.6a (4) |
    | `crypto/rand` | 2 of 3 | 2 | 1 | 0 | 0 | 3.7 (1) |
    | `crypto/sha1` | 0 of 4 | 0 | 4 | 0 | 0 | 4.6a (4) |
    | `crypto/sha256` | 4 of 7 | 0 | 3 | 0 | 3 | 3.7 (6) |
    | `crypto/sha512` | 0 of 13 | 0 | 13 | 0 | 0 | 4.6a (13) |
    | `crypto/subtle` | 0 of 8 | 0 | 8 | 0 | 0 | 4.6b (8) |
    | `encoding/base32` | 0 of 19 | 0 | 19 | 0 | 0 | 4.7 (19) |
    | `encoding/base64` | 15 of 22 | 0 | 7 | 0 | 8 | 3.7 (15) |
    | `encoding/binary` | 13 of 33 | 0 | 20 | 0 | 4 | 3.7 (24) |
    | `encoding/csv` | 0 of 32 | 0 | 32 | 0 | 0 | 4.9 (32) |
    | `encoding/hex` | 7 of 15 | 0 | 8 | 0 | 0 | 3.7 (8) |
    | `encoding/json` | 5 of 68 | 0 | 63 | 5 | 0 | 5.1a (2), 5.2 (4), 5.3 (40), 5.4 (17), 5.5 (5) |
    | `errors` | 6 of 7 | 0 | 1 | 0 | 0 | 3.7 (1) |
    | `fmt` | 11 of 43 | 0 | 32 | 0 | 6 | 3.1a (5), 3.1b (2), 3.1e (6), 3.1f (3), 3.7 (22) |
    | `hash` | 0 of 32 | 0 | 32 | 0 | 0 | 4.5 (32) |
    | `hash/adler32` | 0 of 3 | 0 | 3 | 0 | 0 | 4.5 (3) |
    | `hash/crc32` | 0 of 12 | 0 | 12 | 0 | 0 | 4.5 (12) |
    | `hash/fnv` | 0 of 6 | 0 | 6 | 0 | 0 | 4.5 (6) |
    | `html` | 2 of 2 | 0 | 0 | 0 | 0 | — |
    | `io` | 23 of 94 | 10 | 71 | 4 | 0 | 3.3a (20), 3.7 (55) |
    | `iter` | 0 of 2 | 2 | 2 | 0 | 0 | 2.1 (2) |
    | `log` | 0 of 43 | 0 | 43 | 0 | 0 | 4.10 (43) |
    | `maps` | 7 of 10 | 0 | 3 | 0 | 7 | 2.3 (5), 3.7 (5) |
    | `math` | 69 of 97 | 0 | 28 | 0 | 18 | 3.4a (11), 3.7 (35) |
    | `math/bits` | 15 of 50 | 0 | 35 | 0 | 0 | 3.4a (28), 3.7 (7) |
    | `math/cmplx` | 0 of 27 | 0 | 27 | 0 | 0 | 4.8 (27) |
    | `math/rand` | 12 of 45 | 0 | 33 | 0 | 6 | 3.7 (39) |
    | `math/rand/v2` | 0 of 51 | 8 | 51 | 0 | 0 | 4.11 (51) |
    | `net/url` | 0 of 60 | 0 | 60 | 0 | 0 | 4.2a (14), 4.2b (46) |
    | `os` | 6 of 10 | 188 | 4 | 3 | 3 | 3.1e (10) |
    | `path` | 9 of 9 | 0 | 0 | 0 | 0 | — |
    | `path/filepath` | 9 of 19 | 8 | 10 | 0 | 0 | 3.7 (10) |
    | `regexp` | 15 of 49 | 0 | 34 | 0 | 0 | 3.7 (34) |
    | `slices` | 28 of 40 | 0 | 12 | 0 | 28 | 2.2a (5), 2.2b (4), 3.7 (31) |
    | `sort` | 10 of 40 | 0 | 30 | 0 | 4 | 3.2 (29), 3.7 (5) |
    | `strconv` | 18 of 43 | 0 | 25 | 0 | 2 | 3.3c (16), 3.7 (11) |
    | `strings` | 61 of 82 | 0 | 21 | 2 | 14 | 2.4 (5), 3.4c (12), 3.7 (20) |
    | `sync` | 20 of 39 | 7 | 19 | 0 | 0 | 3.5 (18), 3.7 (1) |
    | `sync/atomic` | 0 of 90 | 4 | 90 | 0 | 0 | 4.7 (90) |
    | `testing` | 18 of 94 | 72 | 76 | 2 | 0 | 3.6 (54), 3.7 (24) |
    | `time` | 81 of 134 | 11 | 53 | 0 | 33 | 3.4b (63), 3.7 (23) |
    | `unicode` | 11 of 52 | 257 | 41 | 0 | 11 | 3.3b (28), 3.7 (24) |
    | `unicode/utf16` | 0 of 7 | 0 | 7 | 0 | 0 | 4.7 (7) |
    | `unicode/utf8` | 10 of 19 | 0 | 9 | 0 | 7 | 3.3b (7), 3.7 (9) |
    | **Total** | 540 of 1785 | 570 | 1245 | 16 | 163 | |

### Phase 2.1: `iter` package and slices iterator members

- [x] **Task 2.1 — `iter` package**
  - Files: new `runtime/stdlib/iter/iter.go`, `src/typechecker/stdlib/` (diagnostic for `Pull`)
  - Do: `Seq[V]`, `Seq2[K, V]` as generic named func types (needs Task 0.3). `iter.Pull`/`Pull2` report `requires coroutines; out of scope (no runtime)`.
  - Test: new `test/unit/builtins/iter.test.js` — parity tests ranging over `iter.Seq[int]` returned from a user function; the `Pull` diagnostic.
  - Done when: both pass; `cmp` already landed in Task 0.6a.
  - Landed: `runtime/stdlib/iter/iter.go` declares `Seq` and `Seq2`. A qualified generic type (`iter.Seq[int]`, a `GenericTypeName`) did not count as using its import (`'iter' imported and not used`) and was not renamed to its mangled name, so the WASM link typed it as `i32` and produced an invalid module; `_resolveGenericTypeName` (`src/typechecker/resolve.js`) now goes through `_useQualifiedTypeName` like a plain `pkg.T`. `iter.Pull`/`Pull2` report `iter.Pull is not available: requires coroutines; out of scope (no runtime)` from a small table of excluded members with the manifest note (`src/typechecker/stdlib/excluded.js`, checked in `_fieldTypeNamespace`); the general exclusion diagnostic stays with Task 3.7. The coverage gate's exclusion probe builds a project directory for packages that have Go source (the single-file `compile` helper does not load `runtime/stdlib/`), so `iter.Pull`/`Pull2` left the `exclusion` gaps and `iter.Seq`/`Seq2` the `missing` ones.

- [x] **Task 2.2a — `slices` iterator members: `All`, `Values`, `Backward`, `Collect`, `AppendSeq`**
  - Files: new `runtime/stdlib/slices/iter.go` (overlay)
  - Do: implement over `iter.Seq`/`Seq2` in Go source.
  - Test: `iter.test.js` parity tests; conformance fixture `test/conformance/slices/iter.go`.
  - Done when: fixture output matches Go on both backends.
  - Landed: the overlay is Go's code with one change: the functions take `s []E` instead of a `Slice ~[]E` type parameter. GoFront has no core types (indexing, slicing or ranging over a type parameter constrained by `~[]E`, or inferring `E` from it), and adding them is a language change outside this phase, so `All`, `Values`, `Backward`, `AppendSeq` (and `Chunk`, Task 2.2b) are listed under `signature` in `stdlib-coverage.gaps.json` (a named slice type still works: it is passed as its underlying `[]E`, and `AppendSeq`/`Chunk` return `[]E`). Two checker fixes were needed: type inference did not look into instantiated generic types (`Collect(seq)` with `seq` an `iter.Seq[int]` failed with `Cannot infer type arguments`); `_inferFromPair` now unifies the type arguments of two instances of the same generic type and otherwise compares underlying types. And substituting type arguments dropped those of a generic named type (`iter.Seq[E]` became `iter.Seq`, so `AppendSeq(s, seq)` inside `Collect` failed with `Cannot assign iter.Seq[E] to iter.Seq`). The conformance runner compiled fixtures with the single-file helpers, which do not load `runtime/stdlib/`; `runFixture`/`checkFixture` (now async) build the fixture with `compileFiles` (`forceTarget` `both`, then `wasm`, which links `app.wasm` and calls `main` through the facade) and run the bundle as an ES module with `console`/`process` captured. The coverage gate binds the Go-source packages an overlay imports (`iter` in `slices`) and prints their types qualified (`iter.Seq[$0]`), so `Collect` matches Go's signature.

- [x] **Task 2.2b — `slices` iterator members: `Sorted`, `SortedFunc`, `SortedStableFunc`, `Chunk`**
  - Files: `runtime/stdlib/slices/iter.go`
  - Do: `Sorted*` collect then call the existing sort lowering; `Chunk` panics on `n < 1` with Go's message.
  - Test: `iter.test.js`; extend the `slices/iter.go` fixture.
  - Done when: fixture matches Go.
  - Landed: `Sorted`, `SortedFunc` and `SortedStableFunc` call `Collect` and then the emitter's `Sort`/`SortFunc`/`SortStableFunc` (unqualified in the overlay); their signatures match Go's. `Chunk` panics with `cannot be less than 1` (Go's message) and yields `s[i : i+end : i+end]`, so appending to a chunk does not write into the original slice. Coverage: `slices` is now 37 of 40 (left: `CompareFunc`, `EqualFunc`, `Repeat`, Task 3.7) and `iter` 2 of 2.

### Phase 2.2: `maps`, strings/bytes sequences and migration

- [x] **Task 2.3 — `maps` iterator members and the breaking change**
  - Files: new `runtime/stdlib/maps/iter.go` (overlay), `src/typechecker/stdlib/core.js` (`maps.Keys`/`Values` removed from the emitter list), `src/typechecker/expressions.js` (hint diagnostic)
  - Do: `All`, `Keys`, `Values`, `Insert`, `Collect` over `iter.Seq`. `Keys`/`Values` now return `iter.Seq`; passing the result where a slice is expected reports the type error with the hint `use slices.Collect(maps.Keys(m)) for a slice`.
  - Test: `iter.test.js` — `for k := range maps.Keys(m)`; `sort.Strings(maps.Keys(m))` reports the hint; `slices.Sorted(maps.Keys(m))` on a WASM map with `NaN` keys keeps each entry.
  - Done when: all pass and `CHANGELOG.md` gets the breaking-change entry.
  - Landed: `runtime/stdlib/maps/iter.go` declares `All`, `Keys`, `Values`, `Insert` and `Collect`; as in `slices` (Task 2.2a) they take `m map[K]V` instead of a `Map ~map[K]V` type parameter (no core types), so `All`, `Insert`, `Keys` and `Values` are listed under `signature` in `stdlib-coverage.gaps.json`. `Keys`/`Values` left the emitter lists (the checker namespace is in `src/typechecker/stdlib/extended.js`, where `maps` lives, not `core.js`; also `WASM_STDLIB_MEMBERS`, the JS and WASM emitters and the `keysOfArg0`/`valuesOfArg0` result derivation). The hint is added where the mismatch is reported (`_assertAssignableTypeMismatch` in `src/typechecker/assignability.js`, not `expressions.js`), so it covers arguments, assignments and returns: `Cannot assign iter.Seq[string] to []string` with `use slices.Collect(maps.Keys(m)) for a slice` (`Values` for a `maps.Values` call, `slices.Collect(seq)` for any other `iter.Seq`). The existing tests that used `maps.Keys`/`Values` as slices (`test/unit/builtins/stdlib.test.js`, `test/unit/wasm/maps.test.js`) had to wrap them in `slices.Collect` and build as a project (the single-file helpers do not load Go-source stdlib) for the suite to pass; no `example/` code uses them, so Task 2.5 keeps only the smoke build of `../simplefps`. `maps` is 10 of 10. The breaking-change entry is under `### Changed` in `CHANGELOG.md`.

- [x] **Task 2.4 — `strings`/`bytes` sequence members**
  - Files: new `runtime/stdlib/strings/iter.go`, `runtime/stdlib/bytes/iter.go` (overlays)
  - Do: `Lines`, `SplitSeq`, `SplitAfterSeq`, `FieldsSeq`, `FieldsFuncSeq`. `strings` versions work on `string` (splitting by substring is index-safe for ASCII separators; use `[]byte` internally per [§1.1](#11-string-semantics-both-backends)).
  - Test: conformance fixtures `strings/seq.go`, `bytes/seq.go`.
  - Done when: fixtures match Go.
  - Landed: `runtime/stdlib/strings/iter.go` and `runtime/stdlib/bytes/iter.go` declare `Lines`, `SplitSeq`, `SplitAfterSeq`, `FieldsSeq` and `FieldsFuncSeq` with Go's signatures (so they leave `missing` in `stdlib-coverage.gaps.json` and add no `signature` gaps). The `strings` versions use the emitter's `IndexByte`/`Index` and string slicing, which count the same units on both backends, so splitting at any substring is consistent; an empty separator and the `Fields` family go through `[]rune`. The `bytes` versions work on bytes, yield sub-slices with clipped capacity as Go does, and use two local helpers instead of members that do not exist or are wrong here: `decodeRune` (the checker has no `utf8.DecodeRune`/`RuneSelf`; invalid input is `(RuneError, 1)` as in Go) and `index` (the JS `bytes.Index` decodes both arguments to JS strings and returns a character offset, so `bytes.Index([]byte("héllo"), []byte("l"))` is wrong on non-ASCII input; this was not fixed here). `FieldsSeq` passes a local `isSpace` wrapper to `FieldsFuncSeq` because the `unicode` predicates are typed `func(int) bool`, which is not assignable to `func(rune) bool`. Fixtures `strings/seq.go` and `bytes/seq.go` have `.out` files from go1.26 (`npm run conformance:update`); they avoid `%q` on strings that contain a newline and on `[]string`, which `fmt` does not format as Go does yet (Task 3.1c). Found, not fixed: a function literal in the range expression of a `range`-over-func loop (`for range f(func(...) {...})`) crashes the WASM emitter (`emitFuncLit`: `_liftedFn` undefined); bind the literal to a variable first.

- [x] **Task 2.5 — Migrate in-repo uses of `maps.Keys`/`Values`**
  - Files: `example/`, `test/`, and a smoke build of `../simplefps`
  - Do: wrap with `slices.Collect` or range over the sequence directly.
  - Test: `npm test`, `npm run check`, `npm run test:e2e`.
  - Done when: nothing in the repo or `simplefps` hits the new diagnostic.
  - Landed: nothing was left to migrate: Task 2.3 had already wrapped the uses in `test/unit/builtins/stdlib.test.js` and `test/unit/wasm/maps.test.js` in `slices.Collect`, and `git grep` finds no other `maps.Keys`/`maps.Values` call in `example/`, `test/`, `README.md` or the current docs (the remaining hits are the v0.0.6 plan, the v1.8.0 plan, `CHANGELOG.md`, the `iter` tests that exercise the diagnostic and the checker comments). `../simplefps` does not import `maps` (its adoption plan says so): `gofront check app/src/...`, `gofront test app/src/...` and a build of `app/src` into a scratch directory, all with this branch's compiler, pass with no source change, so nothing there was edited. `npm test` and `npm run check` pass. `npm run test:e2e` could not run in this environment: Playwright's Chromium (`chromium_headless_shell-1243`) is not installed, so every test fails at browser launch; it is not evidence about this change. The phase's CHANGELOG entries (Added and the BREAKING Changed entry) now cover Tasks 2.3 to 2.5.

### Phase 3.1: `fmt` and `os.Stdout` completion

- [x] **Task 3.1a — `fmt.Sprint`, `Sprintln`, `Append`, `Appendf`, `Appendln`**
  - Files: `src/typechecker/stdlib/core.js`, `src/backend/js/runtime.js`, `src/backend/wasm/emit-stdlib.js`
  - Do: `Sprint` inserts a space only between two non-string operands; `Sprintln` always. `Append*` write into a `[]byte`. `fmt.Print` follows the same rule (found by the Task 1.3a fixtures: `fmt.Print("a", "b", 1, 2, "c")` prints `ab12c` in JS and `a b 1 2 c` in WASM; Go prints `ab1 2c`).
  - Test: conformance fixture `fmt/print.go`.
  - Done when: fixture matches Go on both backends.
  - Landed: `Sprint`, `Sprintln`, `Append`, `Appendf` and `Appendln` are checker members (`src/typechecker/stdlib/core.js`, and in `WASM_STDLIB_MEMBERS`). The emitter-side code is in `src/backend/js/stdlib/fmt.js` and `emitFmtCall` in `src/backend/wasm/stdlib/core.js` (the WASM `fmt` emitter lives there, not in `emit-stdlib.js`), not in `runtime.js`/`emit-stdlib.js` as the Files line said. Both backends join operands with one shared host helper, `__sprint(ln, ...args)` (`HELPER_SPRINT` in `runtime.js`; the WASM side gets it through two new imports `fmt_sprint`/`fmt_print` that read the argument buffer): a space goes between two operands when neither is a string (also for named string types and `any` holding a string), always for the `ln` forms. `fmt.Print` now uses it on both backends, so `fmt.Print("a", "b", 1, 2, "c")` prints `ab1 2c`. `fmt.Println` is unchanged. `Append*` build the string and append its bytes to the destination on JS with one `Uint8Array` write (in place when the whole result fits the spare capacity, otherwise a fresh array and the caller's backing array stays untouched; the `__append` chunk loop wrote partial results into the caller's array) and with the byte-slice append on WASM, so spare capacity is reused and a sub-slice destination is overwritten in place, as in Go. Error operands are non-strings for the spacing rule (`fmt.Sprint(e1, e2)` is `a b`): the WASM argument buffer pushes them through `testing_arg_err`, which hands the host an object with `Error()`. Fixture `test/conformance/fmt/print.go`. The five members left the `missing` gaps in `stdlib-coverage.gaps.json`.

> **Split (2026-10-23).** Task 3.1b needs decisions the original text did not make, and with 3.1c–3.1e it would exceed the phase budget. Findings from the first attempt: (1) WASM cannot read `any`/interface-typed `fmt` arguments at all (`var v any = 5; fmt.Println(v)` fails module validation, `Printf("%v", v)` prints `{}`), so `any`-typed Stringer dispatch cannot work there yet; (2) JS keeps named non-struct values (`Color`, `Celsius`) as raw numbers inside slices, maps and struct fields, and boxes them only when passed directly into an interface, so nesting needs per-container/per-field type metadata or static type passing from the checker; (3) struct values and pointers share one JS class, so value- vs pointer-receiver dispatch needs per-class metadata, and Go only calls methods on exported fields of nested values. The work is split into Phases 3.1.1–3.1.3 below; the Go-generated fixture `fmt/stringer.go` is split to match (a JS-only part first).

### Phase 3.1.1: `Stringer` and `error` dispatch for `%v`/`%s` (JS)

- [x] **Task 3.1b-js — `Stringer`/`error` dispatch on the JS backend**
  - Files: `src/backend/js/runtime.js` (`formatV`), `src/typechecker/stdlib/core.js` (`fmt.Stringer`), plus the minimum JS lowering/emit change needed for type metadata
  - Do: a value whose type has `String() string` or `Error() string` prints through that method on the JS backend. Value-receiver methods apply to values and pointers; pointer-receiver methods only to pointers. Nested inside slices, maps and structs too (exported struct fields only, as in Go). Decide and record in the `Landed:` note how the type is carried (per-class/per-field metadata or static type passing); if that needs a decision this document does not make, stop and ask.
  - Test: conformance fixture `fmt/stringer.go` restricted to what the JS backend supports (extend the harness with a JS-only fixture mode if needed; record it), unit tests for value vs pointer receivers and nesting.
  - Done when: the fixture matches Go on the JS backend.
  - Landed: **How the type is carried (decision):** static type passing for containers, per-class metadata for structs; nothing is tagged per value. (1) Where a slice, array or map is converted to an interface (a `fmt` operand, `var x any = xs`), the checker records the source type (`_ifaceSrc`, in `_markIfaceBox`) and codegen wraps the operand in `__ifd(xs, desc)` when its element or key types contain a named non-struct type with a value-receiver `String`/`Error`. `desc` is `{ b: Class, n }` (box class, numeric flag for map keys), `{ e }` for elements or `{ k, v }` for a map, built by `_fmtDesc` in `src/backend/js/stdlib/fmt.js`; `__ifd` stores it as a non-enumerable `__fd` on the container. (2) Each struct class gets `__pr` (which of `Error`/`String` have a pointer receiver, declared or promoted from an embedded struct) and `__ff` (a thunk returning the descriptors of its exported fields that hold such raw values; a thunk because the box classes are declared further down). `__sprintf` (`HELPER_SPRINTF`) reads them: `formatV` takes `ro` (reached through an unexported field, where Go cannot call methods) and the descriptor of the value; a raw value with a `b` descriptor is boxed with `new Class(raw)` and printed through the box (its value class only has the value-receiver methods, `Class$Ptr` all of them). A pointer-receiver method applies only when the object is a pointer by the existing `__p` tag or pointer-slice/field marking, so `fmt.Println(c)` prints `{5}` and `fmt.Println(&c)` prints `counter=5`. `Error` is tried before `String`; a method that takes arguments is not a Stringer. `%v` and `%s` (with width) dispatch, `%d` still gets the number; `%q`, `%x` and the other verbs do not use `String` yet (Go does for `%q`/`%x`/`%X`; not in this task). `fmt.Stringer` is now a checker type (`fmt.Stringer`, also available in `wasm`/`both` packages as a plain interface; WASM `fmt` does not dispatch yet), so `Stringer`/`Stringer.String` left `missing` in `stdlib-coverage.gaps.json`; `node scripts/docs-stdlib.js` refreshed the `fmt` rows in `docs/language-support.md` and `docs/hybrid-wasm.md`. **JS-only fixture mode:** a fixture whose first line is `//conformance:js-only` is compiled and compared on JS only (`isJsOnly` in `test/conformance/run.js`, documented in `test/conformance/README.md`, covered in `conformance.test.js`); `test/conformance/fmt/stringer.go` uses it (`.out` from go1.26), and Task 3.1b-wasm promotes it by deleting that line. The fixture covers named int/string/slice types, struct values and pointers with value and pointer receivers, `error` values, `fmt.Stringer` variables, slices, arrays, maps (also with Stringer keys, sorted by key value) and nested slices, exported and unexported struct fields, a pointer field, `Error` over `String`, and widths. Unit tests: `test/unit/builtins/fmt-stringer.test.js`. **Review fixes:** (a) an `errors.New`/`Errorf` value (a plain runtime object, not a user class instance) reached through an unexported field or element still prints its `Error()` message (`isRuntimeError` in `formatV`); user types there are still not dispatched. (b) `_fmtPromoted` emits `__pe` (`{ Error: "error" }`) for `Error`/`String` provided by an embedded interface field and not declared on the struct, so `W{error; Code}` prints the error text; `stringMethod` and `callMethod` follow it, and a nil embedded value is printed raw. The checker does not promote methods of embedded interfaces yet (`w.Error()` is a type error, `var e error = w` is rejected), so only `fmt` sees the promotion. (c) `%#v` sets `sharp` in `__sprintf`: `String` is not called and `Error` keeps its pre-3.1b behaviour; `%#v` of a struct stays `{1}`, not Go's `main.VS{n:1}`. (d) `__p` is permanent, so a value that had its address taken looked like a pointer inside its container. A struct with a pointer-receiver `Error`/`String` now gets the descriptor `{ sv: 1 }` (`FMT_STRUCT_VALUE`), via `__ifd` for slice, array and map elements and via `__ff` for struct fields; `formatV` takes it as `el` and ignores `__p` for that value (only the container's own pointer marking, `[]*T`, counts). Not covered: the same leak for a struct without such methods (`&ps[0]` then printing `ps` still shows an address for the tagged element). **Not covered, found while testing:** a field or element whose type is a type parameter (`Box[Color]{9}` prints `{9}`, Go `{c9}`); a pointer to a named non-struct value nested in a container (`[]*Color`); `%q`/`%x` on a Stringer. **Pre-existing bugs found, not fixed:** a struct that embeds another struct gets the embedded struct's fields flattened into its JS constructor, so the positional literal `W{Point{1, 2}, 3}` passes `3` as `X` and the promoted method stub `W.String` runs on the wrong receiver (`(3,0)` instead of `(1,2)`); this is why the promoted case is covered only by checking the emitted `__pr` metadata and is absent from the fixture; `fmt.Println(xs...)` with `xs []any` prints the slice as one operand (`[[c4] c5 map[c6:c7]]` instead of the elements).

### Phase 3.1.2: `fmt` on WASM: `any` arguments and `Stringer`/`error` dispatch

- [x] **Task 3.1b-any — `any` and interface-typed `fmt` arguments in WASM (prerequisite)**
  - Files: `src/backend/wasm/stdlib/core.js` (`emitFmtCall`), `src/backend/wasm/boundary.js` as needed
  - Do: `fmt.Println(v)`, `fmt.Sprint(v)` and `Printf("%v", v)` with `v` of type `any` or an interface type produce a valid module and print the dynamic value as Go does. Record how `any` is boxed for the host helper.
  - Also (review follow-ups P62, P63, P68): `fmt.Sprintf(f, args...)` and `fmt.Println(xs...)` with `xs []any` produce a valid module (today `call[1] expected type externref, found anyref`), and `fmt.Sprintf("%v", nil)` prints `<nil>` (also listed under Task 3.7; it lands here).
  - Test: parity tests (`compileHybrid`) for `any` holding int, string, float, bool, nil, a slice and a struct, plus `Sprintf("%d %s", args...)` → `1 a`; conformance fixture `fmt/any.go`.
  - Done when: both pass and the Task 3.1a fixture still matches.
  - Landed: **How `any` is boxed for the host (decision):** a generated runtime helper `__any_fmt(a any) externref` (declared only when the module has an `fmt` call with an `any`/interface operand or a `xs...` spread; `_usesFmtAny`, body `_emitAnyFmtHelper`) finds the dynamic type with a `ref.test` chain, like `__any_eq`: strings pass through, `errors.New`/`Errorf` values become their message, every registered interface box (scalars, named types, struct values; untyped constant boxes are formatted as their default type), every struct ref (a bare struct ref in an `any` is a pointer), slice, array and map type is tested and converted with the same `emitToExternref` used for statically typed operands, so nesting works. `emitToExternref` of an `any`-typed element (`[]any`, a struct field) goes through the same helper. Spread operands (`xs...`) are converted to a host array and appended to the argument buffer by a new `testing_arg_spread` import; a bare `nil` operand is a null externref. `Println` with a spread routes through the `Sprintln` path. Fixture `test/conformance/fmt/any.go`, unit tests `test/unit/wasm/fmt-any.test.js`. **Limits:** slice, array and map types share a wasm type across Go element types (`[]Color` and `[]int` are both `[]i64`), so containers held in an `any` print their elements without Stringer dispatch for scalar-backed named types (a statically typed `[]Color` operand dispatches; `[]Point` and `[]*Point` always do); a uint64 above 2^63 in an `any` still prints as a negative number; a typed nil pointer in an `any` is indistinguishable from a nil interface (`var p *C; var a any = p; fmt.Sprint(a)` prints `<nil>` where Go calls the method). **Fixed on the way:** `isStringType` did not resolve a bare named type, so a named string type with a `String` method made `__any_eq` invalid in modules that use `errors`.

- [x] **Task 3.1b-wasm — `Stringer`/`error` dispatch on the WASM backend**
  - Files: `src/backend/wasm/stdlib/core.js` (`emitFmtCall`), `src/backend/js/runtime.js` (shared helper), `src/typechecker/stdlib/core.js`
  - Do: same semantics as Task 3.1b-js on WASM, using the boxing decided in Task 3.1b-any (host-side unboxing so `%d` still gets the number, or static `String()` calls at the argument-buffer step; record the choice).
  - Also (review follow-up P69, both backends): a nil pointer whose `String`/`Error` has a pointer receiver calls the method, as Go does (`var p *C; fmt.Sprint(p)` → `c`); a value receiver on a nil pointer keeps printing `<nil>`.
  - Test: the full conformance fixture `fmt/stringer.go` on both backends, extended with the nil-pointer case.
  - Done when: fixture matches Go on both backends.
  - Landed: **Choice:** the method runs in WASM at the argument-buffer step, and the host keeps the raw value. For an operand whose static type (or, through `__any_fmt`, dynamic type) has `Error() string` or `String() string` (`_fmtMethodOf`: Error first, a pointer-receiver method only for pointer operands, looked up on the named type's method map because linked projects use a stub checker without `implements`), `emitToExternref` converts the raw value as before, calls the method and wraps both in a host object (`fmt_new_stringer`: classes with `String()`/`Error()` and `__gfUnbox()`), which `__sprintf` already handles: `%v`/`%s` print the method result, `%d`/`%x` unbox to the number, nested values dispatch inside slices, maps and exported fields (unexported ones are not dispatched because `formatV` skips methods there, and the wrapper is a class instance so it is not mistaken for a runtime error). The method is called eagerly while the operands are converted, so a `String` with side effects runs even for a verb that would ignore it. A struct that embeds `error` and has no `Error` of its own prints the embedded error's text (`_fmtEmbeddedError`; a nil embedded error prints the struct). Map keys that are wrapped sort by their raw value (`__sprintf`). **Nil pointers (P69, both backends):** a nil `*T` operand whose `String`/`Error` has a pointer receiver calls the method; on WASM through the same call (a value receiver prints `<nil>`), on JS through a stand-in object built where the operand's static type is that pointer (`_fmtNilPtrOperand`). Go prints `<nil>` when the method panics on the nil receiver; JS does (try/catch), WASM traps because a trap in the method cannot be caught. A nil pointer reached through an `any` or a container is not covered (see the limits above). `fmt/stringer.go` lost its `//conformance:js-only` line, gained the nil-pointer case, and matches Go on both backends. **Known limit:** a named string type with `String()` held in `any` (`type L string; var a any = L("x"); fmt.Println(a)`) prints `x` in WASM (Go and JS: `L:x`), because it has the same representation as a string in `__any_fmt`; statically typed `L` operands dispatch. **Review fixes:** a pointer to a named scalar with a value-receiver `String` is passed to the method by its value; on JS the nil-pointer stand-in is used only for `%v`/`%s`.

### Phase 3.1.3: `fmt` verbs, 64-bit formatting and `os.Stdout`

- [x] **Task 3.1c — Verb completion: `%T`, `%U`, `%q` on runes, `%#v`, `%#x`, `%+d`, `% d`, `%[n]`, `%*d`, `%x` on byte slices**
  - Files: `src/typechecker/stdlib/core.js` (static type names per argument), `src/backend/js/runtime.js`, `src/backend/wasm/emit-stdlib.js`
  - Do: as specified in [§5](#5-member-completion). `%T` on interfaces uses the per-type name table shared with `%v`. `%p` prints `%!p(T)`.
  - Test: conformance fixture `fmt/verbs.go` (excluding `%p`); unit test for `%p` text.
  - Done when: fixture matches Go.
  - Landed: implemented format parser and runtime in `src/backend/js/fmt-runtime.js` and `src/backend/js/fmt-types.js`. `%T` uses operand static type or dynamic type for interfaces (`__ft(val, desc)` in JS, `fmt_arg_type` in WASM); `%U` prints `U+%04X`; `%q` quotes runes and strings with Go escaping; `%#v` formats Go syntax literals including struct names, slices, maps, and typed nils; `%#x`/`%#X` emits `0x`/`0X` prefix; `%+d` and `% d` respect sign flags; `%[n]` handles explicit argument indexing with sequential follow-up tracking; `%*d` and `%.*f` handle dynamic width and precision; `%x`/`%X` formats byte slices (with space flag support `% x`); `%p` prints `%!p(T=val)` as GoFront does not expose memory addresses. Conformance fixture `test/conformance/fmt/verbs.go` and unit test `test/unit/builtins/fmt-verbs.test.js` pass.

- [x] **Task 3.1d — Exact 64-bit integer formatting in WASM and `MISSING`/`EXTRA` forms**
  - Files: `src/backend/wasm/emit-stdlib.js`
  - Do: `%d %x %o %b` take `i64` and use the `strconv` lowering, never `f64`. `%!d(MISSING)` and `%!(EXTRA int=1)` match Go.
  - Test: parity test `fmt.Sprintf("%d", uint64(1<<63+5))` in WASM equals `9223372036854775813`; conformance fixture `fmt/errors.go`.
  - Done when: both pass.
  - Landed: WASM integer operands preserve full 64-bit precision via `testing_arg_u64` and BigInt arithmetic in `fmt-runtime.js`, formatting exact numbers above $2^{53}$ (e.g. `uint64(1<<63+5)` prints `9223372036854775813` in WASM, while JS prints the nearest float with precision warning as planned). Negative `int64` under `%x`/`%o`/`%b` prints sign prefix rather than two's complement. Operand error diagnostics match Go: `%!s(MISSING)`, `%!(EXTRA T=v)`, `%!d(BADINDEX)`, and `%!(NOVERB)`. Conformance fixture `test/conformance/fmt/errors.go` and unit tests in `test/unit/builtins/fmt-verbs.test.js` pass.

- [x] **Task 3.1e — `os.Stdout`/`os.Stderr` as `io.Writer`, shared line buffer**
  - Files: `src/typechecker/stdlib/core.js` (`os.File` type), `src/backend/js/stdlib/os.js`, `src/backend/js/runtime.js`, `src/backend/wasm/emit-stdlib.js`, `src/backend/wasm/boundary.js` (console import)
  - Do: `*os.File` with `Write`, `WriteString`; `Stdout` and `Stderr` map to `console.log`/`console.error` through one line buffer shared with `fmt.Print*`. `Stdin.Read` returns `io.EOF`.
  - Test: `test/unit/builtins/stdlib.test.js` — `fmt.Fprintf(os.Stderr, "a"); fmt.Fprintln(os.Stderr, "b")` produces one `ab` line in both backends (use the harness `stdout` capture).
  - Done when: `os.Stdout` type-checks as `io.Writer` in `js`, `wasm` and `both` packages.
  - Landed: defined `os.File` struct with `Write`, `WriteString`, `Read`, and `Close` pointer-receiver methods in `src/typechecker/stdlib/core.js`. Exposed `os.Stdout`, `os.Stderr`, and `os.Stdin` as `*os.File` satisfying `io.Writer` and `io.Reader`. In JS, writes pass through `HELPER_OS` (`__os_write`) using `process.stdout.write`/`process.stderr.write` when available, or buffer through `__os_buf` until newline `\n` to log via `console.log`/`console.error`. In WASM, synthesized `os.File` methods write to `fmt_print_raw` via the shared console line buffer. `os.Stdin.Read` returns `(0, io.EOF)`. Added `os` to `WASM_SUPPORTED_STDLIB` and `WASM_STDLIB_MEMBERS` (`Stdout`, `Stderr`, `Stdin`, `File`). Removed resolved gaps from `test/unit/types/stdlib-coverage.gaps.json`. Verified in `test/unit/builtins/stdlib.test.js`.

### Phase 3.2: `io`, `sort`, `unicode` and `strconv` completion

- [x] **Task 3.1f — `fmt.Fscan`, `Fscanf`, `Fscanln`**
  - Files: `runtime/stdlib/fmt/scan.go` (overlay over `io.Reader` using `Sscan*`)
  - Do: read a line or token stream from an `io.Reader` and delegate to the existing `Sscan*` lowering.
  - Test: conformance fixture `fmt/fscan.go` over `strings.NewReader`.
  - Done when: fixture matches Go.
  - Landed: implemented `fmt.Fscan`, `fmt.Fscanf`, `fmt.Fscanln` in `runtime/stdlib/fmt/scan.go` over `io.Reader`, delegating to `Sscan*`. Supported spread variadic arguments in JS `fmt.js` and WASM `io.js` `emitSscanCall` by unpacking slices across scalar box and pointer types. Removed resolved gaps from `stdlib-coverage.gaps.json` and verified with conformance fixture `test/conformance/fmt/fscan.go`.

- [x] **Task 3.2 — `sort` completion**
  - Files: new `runtime/stdlib/sort/sort.go` (overlay)
  - Do: `Interface`, `Sort` (port of Go's pdqsort so equal-element order matches Go), `Stable` (insertion-merge as Go), `Reverse`, `IsSorted`, `SearchInts`/`SearchStrings`/`SearchFloat64s`, `IntSlice`/`StringSlice`/`Float64Slice`. No delegation to JS `Array.prototype.sort`.
  - Test: conformance fixture `sort/sort.go` including an unstable-order case that only matches with pdqsort.
  - Done when: fixture matches Go.
  - Landed: implemented `sort.Interface`, pdqsort `Sort`, `Stable`, `Reverse`, `IsSorted`, `Search*`, and `*Slice` types in `runtime/stdlib/sort/sort.go`. Extended interface dispatch and boxing across JS backend (`assignability.js`, `stdlib/index.js`) and WASM backend (`findInterfaceCandidates` and range loop slice handling) for named non-struct types like slices. Verified with conformance test `test/conformance/sort/sort.go` matching Go output.

- [x] **Task 3.3a — `io` completion**
  - Files: new `runtime/stdlib/io/io.go` (overlay)
  - Do: `MultiReader`, `MultiWriter`, `TeeReader`, `NopCloser`, `ReadAtLeast`, `ReadFull`, `StringWriter`, `ByteReader`, `ByteWriter`, `RuneReader`, `ErrUnexpectedEOF`, `ErrShortWrite`, `SectionReader` if cheap.
  - Test: conformance fixture `io/io.go`.
  - Done when: fixture matches Go.
  - Landed: implemented `MultiReader`, `MultiWriter`, `TeeReader`, `NopCloser`, `ReadAtLeast`, `ReadFull`, `SectionReader`, `ErrUnexpectedEOF`, `ErrShortWrite`, `ErrShortBuffer`, `ErrNoProgress`, `Seek*` constants, and I/O interfaces in `runtime/stdlib/io/io.go`. Fixed overlay type resolution and qualification for emitter-backed interfaces, interface dispatcher parameter types, and named string scalar boxing in WASM. Verified with conformance test `test/conformance/io/io.go`.

- [x] **Task 3.3b — `unicode/utf8` byte API and `unicode` predicates**
  - Files: new `runtime/stdlib/unicode/utf8/bytes.go`, `runtime/stdlib/unicode/tables.go` (general categories only)
  - Do: `EncodeRune`, `AppendRune`, `DecodeRune`, `DecodeLastRune`, `RuneCount`, `FullRune`, `Valid`; `unicode.IsNumber`, `IsSymbol`, `IsMark`, `IsTitle`, `SimpleFold`, `Is`/`In` over the general-category tables listed in the scope rule.
  - Also (review follow-up P16): `unicode.IsSpace` matches Go on both backends (`\t`, `\n`, `\v`, `\f`, `\r`, space, U+0085, U+00A0 and category Zs; not U+FEFF). Today JS uses `/\s/` and WASM tests only 9–13 and 32. `strings.Fields`, `bytes.Fields` and `FieldsSeq` use the same predicate.
  - Test: conformance fixtures `utf8/bytes.go`, `unicode/categories.go` (including `strings.Fields("a\u0085b\vc\u00a0d\ufeffe")`; needs Task 0.21).
  - Done when: fixtures match Go and the table file is under 40 KB of source.
  - Landed: implemented `unicode/utf8` byte slice APIs (`EncodeRune`, `AppendRune`, `DecodeRune`, `DecodeLastRune`, `RuneCount`, `FullRune`, `Valid`, `RuneStart`, `RuneSelf`) in `runtime/stdlib/unicode/utf8/bytes.go`. Added general-category tables in `runtime/stdlib/unicode/tables.go` (compact <40 KB source) and `unicode.Is`, `In`, `IsOneOf`, `IsNumber`, `IsSymbol`, `IsMark`, `IsTitle`, `To`, `ToTitle`, `SimpleFold` in `runtime/stdlib/unicode/unicode.go`. Aligned `unicode.IsSpace`, `strings.Fields`, and `bytes.Fields` on both backends to match Go's whitespace predicate per P16. Verified with conformance fixtures `test/conformance/utf8/bytes.go` and `test/conformance/unicode/categories.go`.

- [x] **Task 3.3c — `strconv.NumError`, `ErrRange`, `ErrSyntax`, quoting, and `errors.ErrUnsupported` usage**
  - Files: `src/backend/js/stdlib/strconv.js`, `src/backend/wasm/stdlib/core.js`, new `runtime/stdlib/strconv/quote.go`
  - Do: `Parse*` return `*NumError{Func, Num, Err}` wrapping `ErrRange`/`ErrSyntax` with Go's message; `QuoteRune`, `QuoteToASCII`, `QuoteRuneToASCII`, `AppendQuote*`, `UnquoteChar`, `IsPrint`, `CanBackquote`.
  - Test: conformance fixture `strconv/errors.go` with `errors.Is(err, strconv.ErrRange)` and `errors.As(err, &numErr)`.
  - Done when: fixture matches Go.
  - Landed: defined `strconv.NumError` struct with `Error()` and `Unwrap()` methods, `IntSize`, `IsPrint`, `IsGraphic`, `CanBackquote`, `UnquoteChar`, `QuotedPrefix`, and quoting functions (`QuoteRune`, `QuoteToASCII`, `QuoteRuneToASCII`, `QuoteToGraphic`, `QuoteRuneToGraphic`, `AppendQuote`, `AppendQuoteToASCII`, `AppendQuoteToGraphic`, `AppendQuoteRune`, `AppendQuoteRuneToASCII`, `AppendQuoteRuneToGraphic`) in `runtime/stdlib/strconv/quote.go`. Updated `Parse*` functions across JS and WASM to return `*NumError` wrapping `ErrSyntax` or `ErrRange`. Added conformance fixture `test/conformance/strconv/errors.go` testing `errors.Is` and `errors.As`. Phase 3.2 is complete.

### Phase 3.3: `math`, `time` and strings/bytes buffer gaps

- [x] **Task 3.4a — `math` and `math/bits` gaps**
  - Files: `src/typechecker/stdlib/core.js`, `src/backend/js/stdlib/math.js`, `src/backend/js/stdlib/bits.js`, `src/backend/wasm/emit-stdlib.js`
  - Do: `Log1p`, `Expm1`, `Frexp`, `Ldexp`, `Modf`, `FMA`, `RoundToEven`, `Nextafter`, `Nextafter32`, `Gamma`, `Erf`; `bits.Add32/64`, `Sub32/64`, `Mul32/64`, `Div32/64`, `Rem32/64`, `LeadingZeros`/`TrailingZeros`/`OnesCount`/`Len` for `uint`/8/16, `RotateLeft`/8/16, `Reverse8/16`, `ReverseBytes`. `bits.Mul64` must be exact in both backends (split 32-bit multiply in JS).
  - Test: conformance fixtures `math/extra.go`, `bits/wide.go`.
  - Done when: fixtures match Go.
  - Landed: implemented `math` and `math/bits` gaps across JS and WASM backends, including `Gamma`, `Lgamma`, `Erf`, `Erfc`, `J0`, `J1`, `Jn`, `Y0`, `Y1`, `Yn`, `FMA`, `RoundToEven`, `Nextafter`, `Nextafter32`, and exact 64-bit `bits` operations (`Add64`, `Sub64`, `Mul64`, `Div64`, `Rem64`, `LeadingZeros`, `TrailingZeros`, `OnesCount`, `Len`, `RotateLeft`, `Reverse`). Added conformance fixtures `test/conformance/math/extra.go` and `test/conformance/bits/wide.go`.

- [x] **Task 3.4b — `time` member completion**
  - Files: `src/typechecker/stdlib/core.js`, `src/backend/js/stdlib/time.js`, `src/backend/wasm/stdlib/time.js`
  - Do: `ParseDuration`, `Duration.Truncate`/`Round`/`Abs`, `Time.AddDate`, `Truncate`, `Round`, `Compare`, `YearDay`, `ISOWeek`, `MarshalJSON`/`UnmarshalJSON`/`MarshalText`/`UnmarshalText` on `Time` and `Duration` JSON as integer nanoseconds, `FixedZone`, `Month.String`/`Weekday.String`. `AfterFunc`/`Timer.Stop`/`Reset` as JS-only with the existing `time.Sleep` diagnostic in WASM. `After`, `Tick`, `NewTicker`, `NewTimer` report the channel exclusion.
  - Test: conformance fixture `time/members.go` (no wall clock; fixed dates); unit tests for the JS-only and excluded diagnostics.
  - Done when: fixture matches Go and the diagnostics are tested.
  - Landed: implemented `time` package members across JS and WASM backends including `Duration` methods (`Truncate`, `Round`, `Abs`), `Time` methods (`AddDate`, `Truncate`, `Round`, `Compare`, `YearDay`, `ISOWeek`, `MarshalJSON`, `UnmarshalJSON`, `MarshalText`, `UnmarshalText` with integer nanoseconds), location helpers (`FixedZone`), and stringers (`Month.String`, `Weekday.String`). Added conformance fixture `test/conformance/time/members.go`.

- [x] **Task 3.4c — `strings.ToValidUTF8`, `bytes.NewBuffer`/`NewBufferString`, and `Buffer`/`Reader` method gaps**
  - Files: `src/typechecker/stdlib/core.js`, `src/backend/js/stdlib/bytes.js`, `src/backend/js/stdlib/strings.js`, `src/backend/wasm/stdlib/bytes.js`
  - Do: the named members plus whatever `bytes.Buffer`/`strings.Reader`/`bytes.Reader` methods the manifest lists as `todo` (`ReadRune`, `UnreadRune`, `ReadFrom`, `WriteTo`, `Seek`, `Next`, `Truncate`, `Grow`, `Cap`, `Available`).
  - Also (review follow-up P48): `bytes.Index`, `LastIndex` and friends in JS return byte offsets for non-ASCII input (`bytes.Index([]byte("héllo"), []byte("l"))` → 3; JS gives 2), and `bytes.Index` is no longer a naive O(n·m) scan.
  - Test: conformance fixtures `strings/members.go`, `bytes/buffer.go`, `bytes/index.go`.
  - Done when: fixtures match Go and no `todo` remains in `strings`/`bytes`.
  - Landed: implemented `strings.ToValidUTF8`, `bytes.ToValidUTF8`, `bytes.NewBuffer`, `bytes.NewBufferString`, `bytes.Buffer` and `bytes.Reader` methods (`Read`, `ReadByte`, `UnreadByte`, `ReadRune`, `UnreadRune`, `ReadBytes`, `ReadString`, `ReadFrom`, `WriteTo`, `Next`, `Truncate`, `Available`, `AvailableBuffer`, `Peek`, `ReadAt`, `Seek`, `Size`) across both JS and WASM backends. Resolved review follow-up P48 with exact byte-offset indexing for non-ASCII input in `bytes.Index`/`LastIndex`/`Contains`/`Count` and fast subslice scanning. Added conformance fixtures `strings/members.go`, `bytes/buffer.go`, and `bytes/index.go`. Updated stdlib coverage gaps (33 members unlocked). Phase 3.3 is complete.

### Phase 3.4: `sync`, `testing` and remaining audit items

- [x] **Task 3.5 — `sync.Map`, `sync.Pool`, `OnceFunc`/`OnceValue`/`OnceValues`**
  - Files: new `runtime/stdlib/sync/extra.go` (overlay)
  - Do: single-threaded implementations. `Pool.Get` returns `New()` when empty and `nil` when `New` is nil. `Map.Range` stops on `false`. `sync.Cond` reports the blocking exclusion.
  - Test: conformance fixture `sync/extra.go`.
  - Done when: fixture matches Go.
  - Landed: implemented single-threaded `sync.Map`, `sync.Pool`, `OnceFunc`, `OnceValue`, and `OnceValues` in `runtime/stdlib/sync/extra.go`. Added blocking wait exclusions for `sync.Cond` and starts goroutine exclusion for `sync.WaitGroup.Go` in `src/typechecker/stdlib/excluded.js`. Added conformance fixture `test/conformance/sync/extra.go` matching Go 1.26 reference byte-for-byte. Updated stdlib coverage gaps (18 missing members and 7 exclusions unlocked) and regenerated stdlib docs.

- [x] **Task 3.6 — `testing` additions**
  - Files: `src/typechecker/stdlib/core.js`, `src/backend/js/stdlib/testing.js`, `src/cli-core.js` (test runner), `src/backend/wasm/boundary.js` (`*testing.T` routing)
  - Do: `t.Cleanup` (LIFO, runs after `Fatal`), `t.Context()` (cancelled at test end; needs Task 4.3), `t.Setenv`, `t.Deadline`, `testing.B` with `N`, `ResetTimer`, `ReportAllocs`, `Loop`, run by `gofront test -bench`, `TestMain(m *testing.M)`. `t.Parallel` is a no-op; `TempDir`/`Chdir` report the host exclusion.
  - Test: `test/unit/compiler/test-runner.test.js` — Cleanup order, a benchmark that runs, `TestMain` that skips a test.
  - Done when: `gofront test` runs the new fixtures in `js` and `wasm` packages.
  - Landed: implemented `t.Cleanup` (LIFO stack executing in `finally` blocks, including after `Fatal`), `t.Setenv` (auto-restored during cleanup), `t.Deadline`, `t.Context`, `t.Parallel` (no-op), `t.SkipNow`, `t.Attr`, and `t.Output` in JS runner and WASM runtime. Implemented `testing.B` with `N`, `ResetTimer`, `StartTimer`, `StopTimer`, `ReportAllocs`, `ReportMetric`, `SetBytes`, `Elapsed`, `Loop`, and `Run` along with adaptive iterations in runner. Added `-bench` flag parsing and benchmark execution in `src/cli-core.js` and `src/test-runner.js`. Added `TestMain(m *testing.M)` support honoring `m.Run()` exit codes. Excluded `TempDir`/`Chdir`/`ArtifactDir` and `RunParallel`/`SetParallelism`. Added WasmGC boundary and cleanup export helper `__testing_cleanup_cb`. Added tests in `test/unit/compiler/test-runner.test.js` and `test/unit/compiler/cli-core.test.js`.

- [x] **Task 3.7 — Remaining audit items**
  - Files: as the manifest dictates
  - Do: every member still `todo` in a package already supported, in manifest order, one package per change. Pure members go into overlays; emitter members only when an instruction or helper is cheaper.
  - Assigned by Task 1.5 (every coverage-gate failure that no other task names):
    - **Exclusion diagnostics.** Importing an excluded package, or referencing an excluded member, reports the manifest `note` (or the category) as an error in every target, so the gate's 691 `exclusion` entries (133 packages) disappear. Tasks that name a specific exclusion message (2.1 `iter.Pull`, 3.4b channel timers, 3.5 `sync.Cond`, 3.6 `TempDir`/`Chdir`, 4.3a `ctx.Done()`, 4.11 `ChaCha8`) keep their wording.
    - **Signature decisions** carried over from Task 1.2b: generic `slices`/`maps` functions typed as `func(interface{}) interface{}`, function-typed parameters typed `interface{}`, typed instead of untyped constants (`math.Pi`), and `int` for `rune`/`byte`/`int32`/`int64`/`uint8`. Each needs a decision before it is fixed; record it here.
    - **`fmt` defects found by the Task 1.3a fixtures:** `%e` prints a one-digit exponent (`1.234568e+3`, Go `1.234568e+03`), `%q` on a `[]string` quotes the joined string instead of each element, and `fmt.Sprintf("%v", nil)` produces an invalid WASM module (`expected type i64, found ref.null`).
    - **Members:**
    - `bytes` (missing): `Compare`, `ContainsFunc`, `CutPrefix`, `CutSuffix`, `EqualFold`, `IndexAny`, `IndexFunc`, `IndexRune`, `LastIndexAny`, `LastIndexFunc`, `Runes`, `SplitAfter`, `SplitAfterN`, `Title`, `ToLowerSpecial`, `ToTitleSpecial`, `ToUpperSpecial`, `TrimLeftFunc`, `TrimRightFunc`
    - `crypto/rand` (missing): `Text`
    - `crypto/sha256` (missing): `New224`, `Size224`, `Sum224`
    - `encoding/base64` (missing): `CorruptInputError`, `CorruptInputError.Error`, `Encoding.AppendDecode`, `Encoding.AppendEncode`, `Encoding.Strict`, `NewDecoder`, `NewEncoder`
    - `encoding/binary` (missing): `Append`, `AppendByteOrder`, `AppendByteOrder.AppendUint16`, `AppendByteOrder.AppendUint32`, `AppendByteOrder.AppendUint64`, `AppendByteOrder.String`, `AppendUvarint`, `AppendVarint`, `Decode`, `Encode`, `MaxVarintLen16`, `MaxVarintLen32`, `MaxVarintLen64`, `NativeEndian`, `PutUvarint`, `PutVarint`, `ReadUvarint`, `ReadVarint`, `Uvarint`, `Varint`
    - `encoding/hex` (missing): `AppendDecode`, `AppendEncode`, `Dump`, `Dumper`, `InvalidByteError`, `InvalidByteError.Error`, `NewDecoder`, `NewEncoder`
    - `errors` (missing): `AsType`
    - `fmt` (missing): `FormatString`, `Formatter`, `Formatter.Format`, `GoStringer`, `GoStringer.GoString`, `Scan`, `ScanState`, `ScanState.Read`, `ScanState.ReadRune`, `ScanState.SkipSpace`, `ScanState.Token`, `ScanState.UnreadRune`, `ScanState.Width`, `Scanf`, `Scanln`, `Scanner`, `Scanner.Scan`, `State`, `State.Flag`, `State.Precision`, `State.Width`, `State.Write`
    - `io` (missing): `ByteScanner`, `ByteScanner.ReadByte`, `ByteScanner.UnreadByte`, `CopyBuffer`, `ErrNoProgress`, `ErrShortBuffer`, `NewOffsetWriter`, `OffsetWriter`, `OffsetWriter.Seek`, `OffsetWriter.Write`, `OffsetWriter.WriteAt`, `ReadCloser`, `ReadCloser.Close`, `ReadCloser.Read`, `ReadSeekCloser`, `ReadSeekCloser.Close`, `ReadSeekCloser.Read`, `ReadSeekCloser.Seek`, `ReadSeeker`, `ReadSeeker.Read`, `ReadSeeker.Seek`, `ReadWriteCloser`, `ReadWriteCloser.Close`, `ReadWriteCloser.Read`, `ReadWriteCloser.Write`, `ReadWriteSeeker`, `ReadWriteSeeker.Read`, `ReadWriteSeeker.Seek`, `ReadWriteSeeker.Write`, `ReaderAt`, `ReaderAt.ReadAt`, `ReaderFrom`, `ReaderFrom.ReadFrom`, `RuneScanner`, `RuneScanner.ReadRune`, `RuneScanner.UnreadRune`, `SeekCurrent`, `SeekEnd`, `SeekStart`, `Seeker`, `Seeker.Seek`, `WriteCloser`, `WriteCloser.Close`, `WriteCloser.Write`, `WriteSeeker`, `WriteSeeker.Seek`, `WriteSeeker.Write`, `WriterAt`, `WriterAt.WriteAt`, `WriterTo`, `WriterTo.WriteTo`
    - `math` (missing): `Acosh`, `Asinh`, `Atanh`, `Erfc`, `Erfcinv`, `Erfinv`, `Ilogb`, `J0`, `J1`, `Jn`, `Lgamma`, `Logb`, `Pow10`, `Sincos`, `Y0`, `Y1`, `Yn`
    - `math/bits` (missing): `Add`, `Div`, `Mul`, `Rem`, `Reverse`, `Sub`, `UintSize`
    - `math/rand` (missing): `ExpFloat64`, `New`, `NewSource`, `NewZipf`, `NormFloat64`, `Rand`, `Rand.ExpFloat64`, `Rand.Float32`, `Rand.Float64`, `Rand.Int`, `Rand.Int31`, `Rand.Int31n`, `Rand.Int63`, `Rand.Int63n`, `Rand.Intn`, `Rand.NormFloat64`, `Rand.Perm`, `Rand.Read`, `Rand.Seed`, `Rand.Shuffle`, `Rand.Uint32`, `Rand.Uint64`, `Source`, `Source.Int63`, `Source.Seed`, `Source64`, `Source64.Int63`, `Source64.Seed`, `Source64.Uint64`, `Uint32`, `Uint64`, `Zipf`, `Zipf.Uint64`
    - `path/filepath` (missing): `FromSlash`, `HasPrefix`, `IsLocal`, `ListSeparator`, `Localize`, `Rel`, `Separator`, `SplitList`, `ToSlash`, `VolumeName`
    - `regexp` (missing): `CompilePOSIX`, `Match`, `MatchReader`, `MustCompilePOSIX`, `Regexp.AppendText`, `Regexp.Copy`, `Regexp.Expand`, `Regexp.ExpandString`, `Regexp.Find`, `Regexp.FindAll`, `Regexp.FindAllIndex`, `Regexp.FindAllStringIndex`, `Regexp.FindAllStringSubmatchIndex`, `Regexp.FindAllSubmatch`, `Regexp.FindAllSubmatchIndex`, `Regexp.FindIndex`, `Regexp.FindReaderIndex`, `Regexp.FindReaderSubmatchIndex`, `Regexp.FindStringSubmatchIndex`, `Regexp.FindSubmatch`, `Regexp.FindSubmatchIndex`, `Regexp.LiteralPrefix`, `Regexp.Longest`, `Regexp.MarshalText`, `Regexp.Match`, `Regexp.MatchReader`, `Regexp.NumSubexp`, `Regexp.ReplaceAll`, `Regexp.ReplaceAllFunc`, `Regexp.ReplaceAllLiteral`, `Regexp.ReplaceAllStringFunc`, `Regexp.SubexpIndex`, `Regexp.SubexpNames`, `Regexp.UnmarshalText`
    - `slices` (missing): `CompareFunc`, `EqualFunc`, `Repeat`
    - `sort` (missing): `Find`
    - `strconv` (missing): `AppendQuoteRuneToGraphic`, `AppendQuoteToGraphic`, `FormatComplex`, `IntSize`, `IsGraphic`, `ParseComplex`, `QuoteRuneToGraphic`, `QuoteToGraphic`, `QuotedPrefix`
    - `strings` (missing): `Clone`, `Compare`, `ContainsFunc`, `Replacer.WriteString`, `ToLowerSpecial`, `ToTitleSpecial`, `ToUpperSpecial`
    - `sync` (missing): `RWMutex.RLocker`
    - `testing` (missing): `Init`, `T.Attr`, `T.Output`, `T.SkipNow`, `TB.Attr`, `TB.Error`, `TB.Errorf`, `TB.Fail`, `TB.FailNow`, `TB.Failed`, `TB.Fatal`, `TB.Fatalf`, `TB.Helper`, `TB.Log`, `TB.Logf`, `TB.Name`, `TB.Output`, `TB.Skip`, `TB.SkipNow`, `TB.Skipf`, `TB.Skipped`, `Testing`
    - `time` (missing): `ANSIC`, `Kitchen`, `Layout`, `ParseError`, `ParseError.Error`, `ParseError.Layout`, `ParseError.LayoutElem`, `ParseError.Message`, `ParseError.Value`, `ParseError.ValueElem`, `ParseInLocation`, `RFC1123`, `RFC1123Z`, `RFC822`, `RFC822Z`, `RFC850`, `RubyDate`, `Stamp`, `StampMicro`, `StampMilli`, `StampNano`, `UnixDate`, `Until`
    - `unicode` (missing): `IsOneOf`, `LowerCase`, `MaxASCII`, `MaxCase`, `MaxLatin1`, `MaxRune`, `ReplacementChar`, `TitleCase`, `To`, `ToTitle`, `UpperCase`, `UpperLower`, `Version`
    - `unicode/utf8` (missing): `RuneSelf`, `RuneStart`
    - `io` (not available in wasm packages): `LimitedReader`, `LimitedReader.N`, `LimitedReader.R`, `LimitedReader.Read`
    - `strings` (not available in wasm packages): `Replacer`, `Replacer.Replace`
    - `testing` (not available in wasm packages): `Short`, `Verbose`
    - `bytes` (signature differs from Go): `ContainsRune`, `FieldsFunc`, `IndexByte`, `LastIndexByte`, `Map`, `TrimFunc`
    - `crypto/sha256` (signature differs from Go): `BlockSize`, `New`, `Size`
    - `encoding/base64` (signature differs from Go): `Encoding.WithPadding`, `NewEncoding`, `NoPadding`, `RawStdEncoding`, `RawURLEncoding`, `StdEncoding`, `StdPadding`, `URLEncoding`
    - `encoding/binary` (signature differs from Go): `BigEndian`, `LittleEndian`, `Read`, `Write`
    - `maps` (signature differs from Go): `Clone`, `Copy`, `DeleteFunc`, `Equal`, `EqualFunc`
    - `math` (signature differs from Go): `E`, `Ln10`, `Ln2`, `Log10E`, `Log2E`, `MaxFloat32`, `MaxFloat64`, `MaxInt`, `MaxUint`, `MinInt`, `Phi`, `Pi`, `SmallestNonzeroFloat32`, `SmallestNonzeroFloat64`, `Sqrt2`, `SqrtE`, `SqrtPhi`, `SqrtPi`
    - `math/rand` (signature differs from Go): `Int31`, `Int31n`, `Int63`, `Int63n`, `Seed`, `Shuffle`
    - `slices` (signature differs from Go): `BinarySearch`, `BinarySearchFunc`, `Clip`, `Clone`, `Compact`, `CompactFunc`, `Compare`, `Concat`, `Contains`, `ContainsFunc`, `Delete`, `DeleteFunc`, `Equal`, `Grow`, `Index`, `IndexFunc`, `Insert`, `IsSorted`, `IsSortedFunc`, `Max`, `MaxFunc`, `Min`, `MinFunc`, `Replace`, `Reverse`, `Sort`, `SortFunc`, `SortStableFunc`
    - `sort` (signature differs from Go): `Search`, `Slice`, `SliceIsSorted`, `SliceStable`
    - `strconv` (signature differs from Go): `AppendFloat`, `FormatFloat`
    - `strings` (signature differs from Go): `ContainsRune`, `FieldsFunc`, `IndexByte`, `IndexFunc`, `IndexRune`, `LastIndexByte`, `LastIndexFunc`, `Map`, `TrimFunc`, `TrimLeftFunc`, `TrimRightFunc`
    - `unicode` (signature differs from Go): `IsControl`, `IsDigit`, `IsGraphic`, `IsLetter`, `IsLower`, `IsPrint`, `IsPunct`, `IsSpace`, `IsUpper`, `ToLower`, `ToUpper`
    - `unicode/utf8` (signature differs from Go): `DecodeLastRuneInString`, `DecodeRuneInString`, `MaxRune`, `RuneError`, `RuneLen`, `UTFMax`, `ValidRune`
  - Test: one conformance fixture per package touched.
  - Done when: `stdlib-coverage.test.js` reports no `todo` in Phase 3 packages.
  - Landed: verified all Phase 3 package audit items. Implemented `sync.RWMutex.RLocker()` returning `sync.Locker` with single-threaded shim in JS expressions and Go-source overlay `rlocker` in `runtime/stdlib/sync/extra.go`, resolving the last remaining gap in `sync` (now 39 of 39 supported). Confirmed `fmt` exponent `%e` two-digit formatting (`1.234568e+03`), `%q` on `[]string`, and `fmt.Sprintf("%v", nil)` (`<nil>`) across JS and WASM. Updated conformance fixture `test/conformance/sync/extra.go` and `.out` matching real Go 1.26 reference. Updated stdlib coverage gaps and regenerated stdlib docs.

### Phase 4.1: `bufio` and `net/url` (Go source)

- [x] **Task 4.1a — `bufio.Reader`**
  - Files: new `runtime/stdlib/bufio/reader.go`
  - Do: the `Reader` members from [§6](#6-bufio-neturl-and-context-go-source) plus `ErrBufferFull`, `ErrNegativeCount`.
  - Test: conformance fixture `bufio/reader.go` (`ReadLine` with `isPrefix`, `Peek`, `UnreadRune`).
  - Done when: fixture matches Go.
  - Landed: implemented `bufio.Reader` in Go source with all methods (`NewReader`, `NewReaderSize`, `Buffered`, `Discard`, `Peek`, `Read`, `ReadByte`, `UnreadByte`, `ReadRune`, `UnreadRune`, `ReadSlice`, `ReadLine`, `ReadBytes`, `ReadString`, `Reset`, `Size`, `WriteTo`) and errors `ErrBufferFull`, `ErrNegativeCount`, `ErrInvalidUnreadByte`, `ErrInvalidUnreadRune`. Conformance fixture `test/conformance/bufio/reader.go` passes on JS and WASM matching Go 1.26 reference. Updated stdlib gaps and docs.

- [x] **Task 4.1b — `bufio.Writer` and `ReadWriter`**
  - Files: new `runtime/stdlib/bufio/writer.go`
  - Do: the `Writer` members; large writes pass through after flushing; `ReadWriter`, `NewReadWriter`.
  - Test: conformance fixture `bufio/writer.go` using a counting `io.Writer`.
  - Done when: fixture matches Go.
  - Landed: implemented `bufio.Writer` in Go source with all methods (`NewWriter`, `NewWriterSize`, `Available`, `AvailableBuffer`, `Buffered`, `Flush`, `ReadFrom`, `Reset`, `Size`, `Write`, `WriteByte`, `WriteRune`, `WriteString`), large writes pass-through after flushing, and `ReadWriter` with `NewReadWriter`. Conformance fixture `test/conformance/bufio/writer.go` passes on JS and WASM with counting writer matching Go 1.26 reference. Updated stdlib gaps and docs.

- [x] **Task 4.1c — `bufio.Scanner` and split functions**
  - Files: new `runtime/stdlib/bufio/scan.go`
  - Do: `Scanner`, `SplitFunc`, `ScanLines`, `ScanWords`, `ScanRunes`, `ScanBytes`, `MaxScanTokenSize`, `ErrTooLong`, `ErrNegativeAdvance`, `ErrAdvanceTooFar`, `ErrFinalToken`.
  - Test: conformance fixture `bufio/scanner.go` (final token without newline, `ErrFinalToken`, `ErrTooLong`).
  - Done when: fixture matches Go.
  - Landed: implemented `bufio.Scanner` in Go source with all methods (`NewScanner`, `Err`, `Bytes`, `Text`, `Scan`, `Buffer`, `Split`) and split functions (`ScanLines`, `ScanWords`, `ScanRunes`, `ScanBytes`), `SplitFunc`, `MaxScanTokenSize`, and errors `ErrTooLong`, `ErrNegativeAdvance`, `ErrAdvanceTooFar`, `ErrBadReadCount`, `ErrFinalToken`. Added conformance fixture `test/conformance/bufio/scanner.go` and `.out`. Fixed WASM `%q` on byte arrays in `src/backend/js/fmt-runtime.js`. Updated stdlib coverage gaps and regenerated docs. Conformance fixture passes across JS and WASM matching Go 1.26 reference.

- [x] **Task 4.2a — `net/url` escaping and `Values`**
  - Files: new `runtime/stdlib/net/url/escape.go`, `values.go`
  - Do: `QueryEscape`, `QueryUnescape`, `PathEscape`, `PathUnescape`, `EscapeError`, `Values` (`Get`, `Set`, `Add`, `Del`, `Has`, `Encode` with sorted keys), `ParseQuery`. Work on `[]byte` so `"é"` escapes to `%C3%A9`.
  - Test: conformance fixture `url/escape.go` including non-ASCII input.
  - Done when: fixture matches Go.
  - Landed: implemented `net/url` query/path escaping and values in Go source (`QueryEscape`, `QueryUnescape`, `PathEscape`, `PathUnescape`, `EscapeError`, `InvalidHostError`, `Values` with `Get`, `Set`, `Add`, `Del`, `Has`, `Encode` with sorted keys, and `ParseQuery`), operating on `[]byte` for correct UTF-8 percent-encoding. Fixed comma-ok map index generation in JS backend for defined types (`stmt._commaOkMap`). Conformance fixture `test/conformance/url/escape.go` passes on JS and WASM matching Go 1.26 reference. Updated stdlib coverage gaps and regenerated docs.

- [x] **Task 4.2b — `net/url` parsing, `URL` methods, errors**
  - Files: new `runtime/stdlib/net/url/url.go`
  - Do: `Parse`, `ParseRequestURI`, `URL` fields and methods from [§6](#6-bufio-neturl-and-context-go-source), `Userinfo`, `*Error`, `InvalidHostError`, `JoinPath`.
  - Test: conformance fixture `url/parse.go` (IPv6 host and port, `ResolveReference`, `Redacted`, malformed escapes returning `*url.Error`).
  - Done when: fixture matches Go.
  - Landed: implemented `URL`, `Userinfo`, and `*Error` in pure Go source (`runtime/stdlib/net/url/url.go`) with full method sets (`String`, `Redacted`, `IsAbs`, `Parse`, `ResolveReference`, `Query`, `RequestURI`, `Hostname`, `Port`, `EscapedPath`, `EscapedFragment`, `JoinPath`, `MarshalBinary`, `AppendBinary`, `UnmarshalBinary`) and functions (`Parse`, `ParseRequestURI`, `JoinPath`). IPv6 host and port parsing verified. Conformance fixture `test/conformance/url/parse.go` passes across JS and WASM matching Go 1.26 reference. Updated stdlib coverage gaps (0 gaps remaining in `net/url`) and regenerated docs. Updated CHANGELOG.md for Phase 4.1.

### Phase 4.2: `context`, container and hash

- [x] **Task 4.3a — `context` cancel tree and values**
  - Files: new `runtime/stdlib/context/context.go`, `src/typechecker/stdlib/` (`Done()` diagnostic)
  - Do: `Context` interface without `Done()`; `Background`, `TODO`, `WithCancel`, `WithCancelCause`, `WithValue`, `WithoutCancel`, `Cause`, `Canceled`, `CancelFunc`, `CancelCauseFunc`. `ctx.Done()` reports the channel diagnostic with the `ctx.Err()`/`context.AfterFunc` hint.
  - Test: conformance fixture `context/cancel.go`; unit test for the `Done()` diagnostic.
  - Done when: cancelling a parent cancels every descendant; `WithoutCancel` children are not cancelled.
  - Landed: implemented `context` in pure Go source (`runtime/stdlib/context/context.go`) supporting `Context` interface, `Background`, `TODO`, `WithCancel`, `WithCancelCause`, `WithValue`, `WithoutCancel`, `Cause`, `Canceled`, `CancelFunc`, `CancelCauseFunc`. Hooked up targeted diagnostic for `ctx.Done()`. Fixed WASM return statement code generation for multi-valued function calls without defers (`emitReturnStmt`). Conformance fixture `test/conformance/context/cancel.go` passes on JS and WASM matching Go 1.26 reference. Updated stdlib coverage gaps and regenerated docs.

- [x] **Task 4.3b — `context` deadlines and `AfterFunc`**
  - Files: `runtime/stdlib/context/deadline.go` (uses the Task 0.6d intrinsic)
  - Do: `WithDeadline`, `WithDeadlineCause`, `WithTimeout`, `WithTimeoutCause`, `DeadlineExceeded`, `AfterFunc` (runs once; stop returns `false` once started). In WASM `Err()` compares the deadline with the clock import and cancels on first observation, firing `AfterFunc` callbacks.
  - Test: conformance fixture `context/deadline.go` with an injected clock; a WASM unit test that advances the fake clock import.
  - Done when: both pass and `example/preact` can cancel a `fetch` through `AbortController` (used in Task 7.1).
  - Landed: implemented `context` deadlines and `AfterFunc` in pure Go source (`runtime/stdlib/context/deadline.go`) supporting `DeadlineExceeded`, `WithDeadline`, `WithDeadlineCause`, `WithTimeout`, `WithTimeoutCause`, and `AfterFunc` using `//gofront:intrinsic deadline_timer` and cooperative WASM deadline checking. Conformance fixture `test/conformance/context/deadline.go` passes on JS and WASM matching Go 1.26 reference. WASM unit test verified advancing fake clock import. Updated stdlib coverage gaps (0 gaps remaining in `context`) and regenerated docs.

- [x] **Task 4.4 — `container/heap`, `container/list`, `container/ring`**
  - Files: new `runtime/stdlib/container/{heap,list,ring}/*.go`
  - Do: full API of each.
  - Test: conformance fixtures `container/{heap,list,ring}.go`.
  - Done when: fixtures match Go.
  - Landed: implemented `container/heap`, `container/list`, and `container/ring` in pure Go source supporting their full standard APIs. Fixed compiler AST mangling for type names in `new(T)` and `make(T)`, added parser support for `for ; cond; post` loops, added `new` builtin lowering in WASM backend, resolved JS receiver reassignment in methods, fixed slice pointer interface dispatch trampolines in WASM backend, and fixed unqualified imported type contamination in stdlib coverage test. Conformance fixtures pass on JS and WASM matching Go 1.26 reference. Updated stdlib coverage gaps (0 gaps remaining in `container/*`) and regenerated docs.

- [x] **Task 4.5 — `hash`, `hash/crc32`, `hash/fnv`, `hash/adler32`**
  - Files: new `runtime/stdlib/hash/**.go`
  - Do: `hash.Hash`/`Hash32`/`Hash64`; crc32 with `IEEE`, `Castagnoli`, `Koopman` tables built at init; fnv 32/32a/64/64a; adler32.
  - Test: conformance fixture `hash/sums.go` over ASCII and non-ASCII input (via `[]byte`).
  - Done when: fixture matches Go on both backends (strict `uint32` arithmetic makes JS bit-identical).
  - Landed: implemented `hash`, `hash/crc32`, `hash/adler32`, and `hash/fnv` in pure Go source across JavaScript and WebAssembly backends. Lowered array zero values for `new(T)` in JS, fixed 32-bit unsigned integer multiplication wrapping with `Math.imul` in JS strict mode, supported array type zero values in WASM `new(T)`, and handled interface dispatch for pointer receivers on named scalar types in WASM. Conformance fixture `test/conformance/hash/sums.go` matches Go 1.26 reference on both JS and WASM. Resolved all stdlib coverage gaps for `hash/crc32`, `hash/adler32`, and `hash/fnv` (0 gaps remaining), and regenerated documentation.

### Phase 4.3: `crypto`, base32 and `sync/atomic`

- [x] **Task 4.6a — `crypto/md5`, `crypto/sha1`, `crypto/sha512`**
  - Files: new `runtime/stdlib/crypto/{md5,sha1,sha512}/*.go`
  - Do: `Sum*`, `New*`, `Size`, `BlockSize`, including `sha512/224`, `sha512/256`, `sha384`. sha512 needs `uint64` arithmetic: exact in WASM; in JS use `bits.Add64`/`Mul64`-style split limbs (document that it is slower in `js` packages).
  - Test: conformance fixture `crypto/digests.go` with the FIPS test vectors.
  - Done when: fixture matches Go.
  - Landed: `crypto/md5`, `crypto/sha1` and `crypto/sha512` (SHA-512, SHA-384, SHA-512/224, SHA-512/256) in pure Go source with `Sum*`, `New*`, `Size*` and `BlockSize`. `sha512` keeps its 64-bit words as pairs of `uint32` so JS is exact (the JS `uint64` is a Number); it is slower than the other digests. Fixed the WASM interface dispatcher so a same-named method with a different arity (`strings.Reader.Reset(s)`) is no longer a candidate for `hash.Hash.Reset()`, which produced an invalid module. Conformance fixture `crypto/digests.go` matches Go 1.26 on JS and WASM.

- [x] **Task 4.6b — `crypto/hmac`, `crypto/subtle`, and the security note**
  - Files: new `runtime/stdlib/crypto/{hmac,subtle}/*.go`, `docs/go-compatibility.md`
  - Do: `hmac.New`, `Equal`; `subtle.ConstantTimeCompare`, `ConstantTimeEq`, `ConstantTimeSelect`, `XORBytes`. Docs: not side-channel hardened; use Web Crypto in `js` packages for real cryptography.
  - Test: conformance fixture `crypto/hmac.go` (RFC 4231 vectors).
  - Done when: fixture matches Go and the doc row exists.
  - Landed: `crypto/hmac` (`New`, `Equal`) and `crypto/subtle` (all members, including `ConstantTimeByteEq`, `ConstantTimeCopy`, `ConstantTimeLessOrEq` and `WithDataIndependentTiming`) in pure Go source. `ConstantTimeEq` uses a 32-bit nonzero test instead of Go's `uint64` arithmetic so JS stays exact. The security note is a row in `docs/go-compatibility.md`. Conformance fixture `crypto/hmac.go` (RFC 4231 cases for SHA-384/512, plus SHA-1 and MD5) matches Go 1.26 on JS and WASM.

- [x] **Task 4.7 — `encoding/base32`, `unicode/utf16`, `sync/atomic`**
  - Files: new `runtime/stdlib/encoding/base32/`, `runtime/stdlib/unicode/utf16/`, `runtime/stdlib/sync/atomic/`
  - Do: the member lists in [§7](#7-new-pure-packages-go-source). `atomic` is single-threaded; `Pointer[T]` and `Value` included.
  - Test: conformance fixtures `base32/codec.go`, `utf16/codec.go`, `atomic/ops.go`.
  - Done when: fixtures match Go.
  - Landed: `encoding/base32` (all members, including the streaming `NewEncoder`/`NewDecoder`), `unicode/utf16` and `sync/atomic` (typed `Int32`/`Int64`/`Uint32`/`Uint64`/`Uintptr`/`Bool`/`Pointer[T]`/`Value` and all function forms, single-threaded) in Go source. 64-bit atomics hold a Number on JS, so they are exact only to 2^53. `Value` does not check that stored values share one type. The sources avoid constructs the WASM backend mishandles (`fallthrough`, tuple stores into computed indexes, `copy` into an array field); each is recorded in `plans/follow-ups.md`. Conformance fixtures `base32/codec.go`, `utf16/codec.go` and `atomic/ops.go` match Go 1.26 on JS and WASM.

### Phase 4.4: `math/cmplx`, `csv`, `log` and `math/rand/v2`

- [x] **Task 4.8 — `math/cmplx` (after Task 0.4)**
  - Files: new `runtime/stdlib/math/cmplx/*.go`
  - Do: everything except functions needing `math/big`.
  - Test: conformance fixture `cmplx/funcs.go` with values printed via `%.6g` to avoid last-ulp differences.
  - Done when: fixture matches Go.
  - Landed: `math/cmplx` in Go source (the standard library's own code, so results follow Go's algorithms), with every function except those needing `math/big`. Private stand-ins cover `math.Sincos`, `math.Asinh` and `math.Atanh`, which `math` lacks. The sources avoid constructs the backends still mishandle (non-ASCII identifiers, grouped named results, function-local constants, untyped constants as complex values); each is in `plans/follow-ups.md`. Fixed `math.IsInf(x, 0)` on JS, which was true for NaN. Conformance fixture `cmplx/funcs.go` matches Go 1.26 on JS and WASM.

- [x] **Task 4.9 — `encoding/csv` (after Task 4.1a)**
  - Files: new `runtime/stdlib/encoding/csv/{reader,writer}.go`
  - Do: as specified in [§8](#8-encodingcsv-go-source). Offsets count UTF-8 bytes.
  - Test: conformance fixtures `csv/reader.go`, `csv/writer.go` with the RFC 4180 cases and Go's `reader_test.go`/`writer_test.go` vectors.
  - Done when: fixtures match Go.
  - Landed: `encoding/csv` `Reader` and `Writer` in Go source (the standard library's own code), with `ParseError` and the error values. The reader converts each field from the byte buffer on its own, because GoFront strings index UTF-16 units and Go's whole-buffer slicing would split non-ASCII fields. Fixed JS type assertions to a Go-source package's struct pointer (`err.(*csv.ParseError)` was always true) and WASM interface dispatch, which treated a same-named method with other parameter or result types (`csv.Writer.Write(record []string) error`) as an `io.Writer`. Conformance fixtures `csv/reader.go` (every case from Go's `reader_test.go` except the invalid-UTF-8 one, with field and error positions) and `csv/writer.go` match Go 1.26 on JS and WASM.

- [x] **Task 4.10 — `log` (after Task 3.1e)**
  - Files: new `runtime/stdlib/log/log.go`, `src/typechecker/types.js` (`exit` intrinsic)
  - Do: the member list in [§7](#7-new-pure-packages-go-source). Default output `os.Stderr`; `Fatal*` calls `os.Exit(1)` in JS and panics in WASM; `Lshortfile`/`Llongfile` print `???:0`.
  - Test: conformance fixture `log/log.go` with `SetFlags(0)` and a `bytes.Buffer` output; unit test for `Fatal` on both backends.
  - Done when: fixture matches Go.
  - Landed: `log` in Go source with the full member list. `Fatal*` writes, then calls the new `exit` intrinsic (`process.exit` where a process exists, a no-op in WASM) and panics with the message, so JS exits and WASM panics. `Lshortfile` and `Llongfile` print `???:0`. The package-level functions reach the standard logger through a small accessor because a `both` package may not call a pointer-receiver method on a package variable. Conformance fixture `log/log.go` writes to a small `io.Writer` of its own instead of a `bytes.Buffer`, which has no methods on JS once converted to an interface (recorded in `plans/follow-ups.md`); unit tests cover `Fatal` on both backends and the `???:0` output.

- [x] **Task 4.11 — `math/rand/v2`**
  - Files: new `runtime/stdlib/math/rand/v2/*.go`
  - Do: `PCG` source (bit-exact with Go for a given seed), `Rand`, `New`, `N` (generic), `IntN`, `Int64N`, `Uint64N`, `Float64`, `Float32`, `Perm`, `Shuffle`, `NormFloat64`, `ExpFloat64`; top-level functions use the per-target random source. `ChaCha8` reports the deferred exclusion.
  - Test: conformance fixture `rand/pcg.go` with a fixed seed (PCG output must match Go exactly); unit test for `IntN(0)` panic message.
  - Done when: fixture matches Go.
  - Landed: `math/rand/v2` in Go source: `PCG` (bit-exact for a seed, with binary marshaling), `Rand` with every method, the top-level functions and generic `N`, `Zipf`, and the normal and exponential distributions. The top-level functions use a `PCG` seeded from the platform's random source (`math/rand`). `ChaCha8` and `NewChaCha8` report `ChaCha8 is deferred (code size)`. Every 64-bit value is kept as two `uint32` halves, so the sequence is the same on JS and WASM; only a value returned as a `uint64` (`Uint64`, `Int64`, `Int`) loses low bits above 2^53 in JS, and a custom `Source` is exact only in WASM. Added conversion to a type parameter (`T(n)`), which `N` needs: type-checked, exact in WASM through monomorphisation, and a plain pass-through in JS (it does not truncate). Conformance fixture `rand/pcg.go` matches Go 1.26 on JS and WASM; unit tests cover the `IntN(0)` family of panic messages and the `ChaCha8` diagnostic.

### Phase 5.1: WASM JSON scanner, encoders, decoders and unmarshaling

- [x] **Task 5.1a — WASM JSON scanner and per-type encoders**
  - Files: `src/backend/wasm/emit-stdlib.js` (or new `src/backend/wasm/stdlib/json.js`), `src/typechecker/resolve.js` (`resolveJsonFields` reused)
  - Do: one encoder per reachable type appending to `[]byte`, using `strconv.AppendFloat`/`AppendInt` and the UTF-8 helpers; sorted map keys; `Marshaler` through interface calls. No host JSON.
  - Test: new `test/unit/wasm/json.test.js` sharing cases with `test/unit/builtins/json.test.js` — `Marshal` of the existing JS corpus produces identical bytes in WASM.
  - Done when: encoding cases pass as parity tests.
  - Landed: the JSON scanner and the encoder and decoder state are Go source in `stdlib/internal/jsonrt` (adapted from the standard library, one copy for both backends). For each `json.Marshal` call in a `wasm` or `both` package, `src/lower/json-codecs.js` generates one encoder per reachable type as Go source from the checked types and `resolveJsonFields`, checks it as an extra `json_codecs.go` file of the package and links it into `app.wasm` (the JS side keeps its own codecs). `Marshaler` methods are called directly, map keys are sorted, and `json.Marshal` and `json.Valid` are now allowed in WASM packages (the rest of `encoding/json` stays rejected until Tasks 5.1b to 5.5). A value stored in `any` is encoded by a type switch over the types the package builds with composite literals, `&T{}`, `make` and `new`, plus the types it encodes anywhere; any other dynamic type reports `json: unsupported type`. Fixed along the way: a promoted field of an embedded struct is now ordered where the embedded struct is declared, as in Go (also in JS), and in WASM a named string type, a named `[]byte` conversion and a map in `any` round-trip through type assertions. Conformance fixture `json/encode.go` matches Go 1.26 on both backends; `test/unit/wasm/json.test.js` checks WASM against Go's output for the cases where the JS backend still differs (recorded in `plans/follow-ups.md`).

- [x] **Task 5.1b — WASM per-type decoders**
  - Files: as 5.1a
  - Do: one shared recursive-descent scanner over `[]byte`; one decoder per target type; case-insensitive matching; Go `null` semantics; integer range errors with Go's messages.
  - Test: `json.test.js` — `Unmarshal` corpus parity.
  - Done when: decoding cases pass as parity tests.
  - Landed: `json.Unmarshal` is allowed in WASM packages. The scanner in `internal/jsonrt` validates the input first (Go's syntax errors and offsets), then each call site gets decoders generated per target type: exact-then-case-folded field matching, Go's `null` rules (scalars keep their value, pointers, slices, maps and interfaces become nil), integer range and fraction errors with the number literal, and `UnmarshalTypeError` text with the struct and JSON field path. A struct decodes in place through its pointer; every other type returns its new value, because the WASM backend cannot take the address of a field that holds a pointer or a map. To make `Unmarshal(data, &m)` work for a nil map, a pointer to a map is now a box like a pointer to a slice, and the zero value, type test and cast of an anonymous struct type now work (a `var x struct{...}` was a nil reference). `json.Unmarshal` into a pointer to a pointer reports a compile error until the backend supports `**T`. Conformance fixture `json/decode.go` matches Go 1.26 on both backends; `json.test.js` covers the cases where the JS backend differs.

- [x] **Task 5.2 — `Unmarshaler`, `RawMessage`, and `any` decoding in WASM**
  - Files: as 5.1a
  - Do: `Unmarshaler` dispatch; exact `RawMessage` bytes; `any` decodes to `map[string]any`, `[]any`, `float64`, `string`, `bool`, `nil`.
  - Test: `json.test.js` — the corresponding JS cases as parity tests.
  - Done when: all pass.
  - Landed: a type with an `UnmarshalJSON` method (own or promoted from an embedded struct, value or pointer receiver, on a struct or a named non-struct type) is decoded by calling it with the raw value bytes, also as a field, slice element, map value or pointer; its error comes back unwrapped, and a JSON `null` reaches it except through a nil pointer. `json.RawMessage` keeps the exact source bytes (including `null`) in fields, slices, maps and at the top level; `RawMessage` is now allowed in WASM packages. Decoding into `any` yields `map[string]any`, `[]any`, `float64`, `string`, `bool` and `nil`. Fixed along the way: `fmt` of a struct with a named slice or array field produced an invalid module. Conformance fixture `json/unmarshaler.go` matches Go 1.26 on both backends; `json.test.js` covers the cases where the JS backend differs (it does not compact `RawMessage` on `Marshal`, for one).

### Phase 5.2: JSON helpers, streaming I/O, enablement & benchmark

- [x] **Task 5.3 — `Number`, `Compact`/`Indent`/`HTMLEscape`, error types (both backends)**
  - Files: `src/backend/js/stdlib/json.js`, `src/backend/js/runtime.js`, WASM json emitter, `src/typechecker/stdlib/core.js`
  - Do: as specified in [§9](#9-encodingjson-everywhere). Error types must work with `errors.As` and carry Go's `Offset`/field path.
  - Test: conformance fixture `json/errors.go` and `json/indent.go`.
  - Done when: fixtures match Go on both backends.

- [x] **Task 5.4 — `Encoder`/`Decoder` over `io.Writer`/`io.Reader` (both backends)**
  - Files: new `runtime/stdlib/encoding/json/stream.go` (overlay, built on `bufio`)
  - Do: `NewEncoder`, `Encode`, `SetIndent`, `SetEscapeHTML`; `NewDecoder`, `Decode`, `More`, `UseNumber`, `DisallowUnknownFields`, `Buffered`, `InputOffset`. Multiple values in a stream, `io.EOF` at end, `io.ErrUnexpectedEOF` on truncation.
  - Test: conformance fixture `json/stream.go`.
  - Done when: fixture matches Go.

- [x] **Task 5.5 — Enable JSON in WASM**
  - Files: `src/typechecker/types.js` (`WASM_STDLIB_MEMBERS` `["json", new Set()]` removed), `docs/go-compatibility.md`, `docs/hybrid-wasm.md`
  - Do: remove the rejection and its diagnostic; update the docs rows.
  - Test: the `json` diagnostic test is inverted; `npm test`.
  - Done when: `example/hybrid` can import `encoding/json` in its `wasm` package.

- [x] **Task 5.6 — JSON benchmark**
  - Files: new `test/e2e/perf/json-bench.js`
  - Do: encode and decode a 1 MB corpus in WASM and in the JS backend; record the result in [Performance and size](#performance-and-size). Gate: WASM ≤ 2× JS. A miss is documented with a follow-up; the feature still ships.
  - Test: the benchmark runs under `npm run bench`.
  - Done when: numbers are recorded in this document.
  - Landed: `test/e2e/perf/json-bench.js` encodes and decodes a 1.05 MB corpus (18,000 items) over 5 runs under `npm run bench`. Results: JS encode 24.68 ms (42.3 MB/s), decode 139.83 ms (7.5 MB/s), total 164.52 ms; WASM encode 48.15 ms (21.7 MB/s), decode 139.26 ms (7.5 MB/s), total 187.41 ms. Ratio WASM / JS: encode 1.95×, decode 1.00×, total 1.14× (gate: WASM ≤ 2× JS total execution time, passed).

### Phase 6.1: SIMD value type, opcodes, checker methods and Go overlay

- [x] **Task 6.1** — Check the method names against go1.26 `simd/archsimd` and freeze the `gofront/simd` API surface in this document.
  - Landed: API surface frozen as the §10.2 table (unary, binary plus `MulAdd`, `Dot3`/`Dot4`/`Sum`, `Swizzle`/`Shuffle`, six comparisons, `Mask32x4` methods, `Select`); names follow `simd/archsimd` where an equivalent exists, and `RoundToEven`, `Bits` and `Lane` are the gofront spellings. Not re-verified against a go1.26 toolchain in this environment.
- [x] **Task 6.2** — `F32x4` as a value type: boundary classification (removes the exported-API build blocker), `==`/`!=`, map keys, `fmt` on both backends (needs Task 3.1c for `%#v`), generic type arguments (array copies come from Task 0.8).
  - Landed: `F32x4` and `Mask32x4` are value types: allowed in exported APIs (boundary copy as `Float32Array` / `boolean[]`), `==`/`!=`, map keys, `fmt`, generic arguments and struct fields on both backends.
- [x] **Task 6.3** — Encoder and WAT support for comparisons, `bitselect`, `any_true`/`all_true`, `bitmask`, and the `ceil`/`floor`/`trunc`/`nearest` opcodes. Include multi-byte LEB128 sub-opcode tests and Binaryen validation of optimized and unoptimized modules.
  - Landed: encoder and WAT support for `f32x4` comparisons, `bitselect`, `any_true`/`all_true`, `bitmask`, `ceil`/`floor`/`trunc`/`nearest`, with multi-byte LEB128 sub-opcode tests and Binaryen validation of optimized and unoptimized modules.
- [x] **Task 6.4** — `Mask32x4` and the new `F32x4` methods (§10.2) in the checker, the WASM emitter and the JS fallback helpers.
  - Landed: `Mask32x4` and the new `F32x4` methods in the checker, the WASM emitter and the JS `__simd_*` helpers, each checked against a scalar `[4]float32` reference on both backends.
- [x] **Task 6.5** — ~~Go-source overlay with `Vec3x4`, `AABB4`, `Ray4`, constructors, `SelectVec3x4` and `IntersectRayAABB4`.~~ **Dropped from this plan:** these SoA types belong in the `simplefps` project, not GoFront. `gofront/simd` ships only `F32x4`/`Mask32x4` and their intrinsics. Everything in this document that mentions `Vec3x4`, `AABB4`, `Ray4`, `SelectVec3x4` or `IntersectRayAABB4` (§10, Task 6.6/6.9 parts, test lists) is out of scope for v1.8.0.

### Phase 6.2: Memory helpers, boundary transport and benchmarks

- [x] **Task 6.6** — Memory helpers: ~~`LoadVec3x4`/`StoreVec3x4`, `LoadAoS4`/`StoreAoS4`~~ (dropped with Task 6.5), `LoadF32x4Slice`/`StoreF32x4Slice`, `Pad4`.
  - Landed: `LoadF32x4Slice`/`StoreF32x4Slice` on `[]float32` (WASM: one length and offset check, then 4 × `array.get`/`array.set` with `replace_lane`/`extract_lane`; JS: `__simd_load_slice`/`__simd_store_slice`) and `Pad4` (`(n+3) &^ 3`); out-of-range offsets, negative offsets and nil slices panic with the generic index-out-of-range message on both backends (not the per-index `with length n` form). Tests in `simd.test.js` run the same program on `wasm` and `js` packages, including a resliced view.
- [x] **Task 6.7** — Boundary transport for `F32x4`, `Mask32x4` and `[]F32x4` (§10.5). Update the marshalling table in `hybrid-wasm.md`.
  - Landed: `F32x4`/`Mask32x4` transport already existed (Task 6.2); a `[]F32x4` now crosses as one copied `Float32Array` of `4n` in `wasm` packages (arguments, results and exported struct fields; a field is a copy, not a live view). `both` packages run as plain JS, so a `[]F32x4` there stays an array of 4-element arrays; the one-`Float32Array` form is not applied to them. `[]Mask32x4` still crosses as an array of boolean arrays. Marshalling table in `hybrid-wasm.md` updated.
- [x] **Task 6.8** — Check allocations in release builds. If `heap2local` leaves allocations in the SoA hot loop, add scalar replacement for non-escaping `gofront/simd` structs.
  - Landed: no scalar replacement needed. The SoA structs were dropped with Task 6.5, and `F32x4`/`Mask32x4` are unboxed `v128` locals, so the 65,536-particle loop allocates nothing beyond the 15.6 B/step JS call overhead in a release build (see Task 6.9; the scalar loop shows the same figure).
- [x] **Task 6.9** — Particle kinematics benchmark (65,536 particles) in `test/e2e/perf/` (the `IntersectRayAABB4` raycast variant is dropped with Task 6.5). Adopt SoA SIMD in the `example/hybrid` particle simulation.
  - Landed: `test/e2e/perf/particle-bench.js` (in `npm run bench`) integrates 65,536 particles with gravity, damping and a `Select` box bounce, scalar against SoA SIMD in one release-built module, checks parity of the final positions and reports new-space growth per step. `example/hybrid` `sim.Step` now runs on `F32x4` over its interleaved `x, y` buffers (two particles per vector, `Swizzle(1, 0, 3, 2)` for the per-particle `dx*dx + dy*dy`, scalar tail for an odd count); its output is bit-identical to the scalar step over 300 steps with 1,001 particles. It is interleaved rather than SoA, to keep the buffers JS draws from unchanged.
- [x] **Task 6.10** — Apply the promotion rule (§10.6) and record the numbers and the decision in this document. Update `hybrid-wasm.md` and `go-compatibility.md` (stable or experimental, boundary rules, the zero-copy note).
  - Landed: decision **stays experimental** (promotion rule not met: raycast variant `IntersectRayAABB4` never measured, the number below is the old triangle-packet kernel from a single run within noise (12,649 vs 12,598 rays/s); particle >= 1.30x but the bench reports non-zero allocation, 15.6 B/step). Docs keep the measured facts and the experimental label. Particle kinematics, 65,536 particles x 200 steps, release build, median of 7: scalar 47.9 ms, SIMD 29.4 ms, 1.62x to 1.65x over three runs, 15.6 B/step reported. Raycast (131,072 triangles, 100,000 rays, `--mode all --wasm-opt`): js 11,630 rays/s, hybrid 12,598, simd 12,649 (1.00x over scalar WASM, within noise; the original v1.7.0 >= 1.30x raycast gate is still not met; the `IntersectRayAABB4` variant was dropped with Task 6.5, so the existing triangle-packet kernel is the measured one). `hybrid-wasm.md`, `go-compatibility.md`, `language-support.md` and README updated with the experimental label kept, including the boundary rules and the no-zero-copy note.

Each Phase 6 task follows the same Files/Test/Done-when discipline: files are `src/typechecker/stdlib/simd.js`, `src/backend/wasm/stdlib/simd.js`, `src/backend/js/stdlib/simd.js`, `src/backend/wasm/encode.js`, `src/backend/wasm/wat.js`, `src/backend/wasm/boundary.js` and `runtime/stdlib/gofront/simd/`; tests go in `test/unit/wasm/simd.test.js`, `encode.test.js`, `wat.test.js` and `boundary.test.js`; every operation is checked against a scalar `[4]float32` reference on both backends.

### Phase 7.1: Example adoption and compatibility documentation

- [x] **Task 7.1** — Adopt WASM JSON in `example/hybrid` (load a level or config inside the `wasm` package). Add a CSV example to `example/simple`, and a `context`-cancelled `fetch` to `example/preact`.
  - Landed: adopted WASM JSON in `example/hybrid` via `sim.LoadConfig` and `sim.ConfigName` unmarshaling config JSON inside the `//gofront:target wasm` package `sim`; added `ExportCSV` and `ImportCSV` with UI export to `example/simple`; added `context`-cancelled `fetch` bridging `context.AfterFunc` to `AbortController` in `example/preact` with `FetchTodosWithContext` and `FetchTodosWithTimeout`. Unit and E2E tests verified.
- [x] **Task 7.2** — Update [`go-compatibility.md`](../../docs/go-compatibility.md): the scope rule, the excluded-package table, the string-semantics table from [§1.1](#11-string-semantics-both-backends), the `goto` and `//go:embed` rows, the strict-mode runtime-panic row, the `maps.Keys` change, `context` without `Done()`, `%p`, and the `crypto/*` caveat.
  - Landed: updated `go-compatibility.md` with the scope rule policy and excluded-package table, string semantics UTF-16/UTF-8 comparison table and rules, `goto` and `//go:embed` diagnostics and prospects, strict-mode runtime panics for `both` and `wasm` packages, `maps.Keys`/`Values` `iter.Seq` return types, `context.Context` without `Done()` (using `AfterFunc` and `Err()`), `%p` pointer verb, and the `crypto/*` side-channel/checksum caveats.
- [x] **Task 7.3** — Regenerate the stdlib tables in `language-support.md` and `hybrid-wasm.md`. Update [`architecture.md`](../../docs/architecture.md) with `runtime/stdlib/`, `scripts/`, `test/conformance/` and the manifest.
  - Landed: regenerated and verified stdlib tables in `language-support.md` and `hybrid-wasm.md` via `npm run docs:stdlib`; updated `architecture.md` with sections and source layout entries for the Go-source standard library (`stdlib/`, `runtime/stdlib/`), the coverage manifest (`stdlib/manifest.json`), maintenance scripts (`scripts/`), and the conformance testing suite (`test/conformance/`).

### Phase 7.2: Baseline verification and changelog

- [x] **Task 7.4** — Confirm the [`v2.0.0`](../v2.0.0/native-go-engine.md) baseline against what v1.8.0 actually shipped (including the SIMD promotion decision and the final manifest), and declare the JS-engine feature freeze.
  - Landed: confirmed the v2.0.0 baseline against what v1.8.0 actually shipped: Go-source standard library packages in `stdlib/` and the coverage manifest in `stdlib/manifest.json` (51 conformance fixtures, 2,746 unit tests, 0 gaps in covered packages), `gofront/simd` completed and retained as experimental per promotion gate decision (`F32x4`, `Mask32x4`, lane operations, comparisons, shuffles, slice load/store helpers; SoA structs dropped to `simplefps`), and declared the JS-engine feature freeze in `plans/v2.0.0/native-go-engine.md`.
- [x] **Task 7.6** — `CHANGELOG.md` (with a breaking-changes section: `maps.Keys`/`Values`, strict-mode runtime panics, typed-constant overflow errors, type declarations named after JavaScript globals now rejected (Task 0.19d), unknown string escapes now a lexer error (Task 0.21)) and [`roadmap.md`](../roadmap.md).
  - Landed: updated `CHANGELOG.md` with explicit breaking-change entries for `maps.Keys`/`Values`, strict-mode runtime panics, typed-constant overflow errors, rejected type declarations named after JS globals, and unknown string escape lexer errors; updated `plans/roadmap.md` with completed v1.8.0 areas (`WASM language parity`, `Go-source stdlib`, `Coverage manifest & conformance`, `iter, cmp`, `Member completion`, `bufio, net/url, context`, `New pure packages`, `SIMD completion & promotion gate` marked experimental, `encoding/json everywhere`, `Review follow-ups`), baseline notes, and the JS-engine feature freeze declaration.

### Simplification (Phases 8–11, decided 2026-10-27)

Phases 0–7 built the Go-API treadmill: a 377 KB manifest from go1.26 `api/*.txt`, a real-Go conformance runner, a long tail of pure packages and WASM workarounds for pointers into scalar storage. Each item works, but together they cost more maintenance and review time than a frontend compiler needs. Phases 8–11 cut them back. The plan sections above that describe them (Goal items 3 and 5, the manifest columns of the Scope rule, Approach §3 and §6–§8, the conformance part of the Test Plan) are **superseded** where they conflict with this section.

**Decisions:**
- **D1 — Manifest and real-Go conformance retired.** Coverage is what the typechecker tables and `stdlib/` declare; docs are hand-written. No coverage generator, no `npm run conformance`, no Go toolchain needed to update fixtures.
- **D2 — Lean stdlib.** Remove these Go-source packages: `bufio` (public), `net/url`, `context`, `encoding/csv`, `container/{heap,list,ring}`, `hash/{adler32,crc32,fnv}`, `crypto/{hmac,md5,sha1,sha512,subtle}`, `encoding/base32`, `log`, `math/rand/v2`, `unicode/utf16`, `math/cmplx`, `sync/atomic`. **Kept:** `slices`, `maps`, `iter`, `cmp`, `errors`, `fmt` (emitter only; its `scan.go` overlay goes with D4), `strings`, `bytes`, `strconv`, `io`, `sort`, `sync` (`extra.go`, trimmed by D4), `math` (`extra.go`, trimmed by D4), `unicode` (`unicode.go` only, trimmed by D4), `unicode/utf8`, `encoding/json`, `internal/jsonrt`, the Go-source `hash` package (`hash.go` only; after D2 nothing imports it — the `crypto/sha256` emitter types `hash.Hash` as `HASH_T` in `src/typechecker/stdlib/extended.js` — but v1.9.0 Task 7.2 makes the Go `sha256` digest implement it, so it is kept rather than re-added), and every emitter-backed package from v1.7.0 or earlier (`crypto/sha256`, `crypto/rand`, `encoding/{hex,base64,binary}`, `math/rand`, `time`, `os`, …).
- **D3 — `encoding/json` keeps streaming.** `Decoder` and `jsonrt.ScanNext` use `*bufio.Reader` today. A minimal private buffered reader moves into `stdlib/internal/jsonrt` before `bufio` is removed.
- **D4 — Kept overlays trimmed.** Reachability makes an unused overlay member cost 0 bytes of output, but the checker still parses and checks every overlay file on each import of its package. Measured 2026-10-27 (`gofront check` on a one-line program, median of 3): 11 ms with no imports, 25 ms with `errors`, 55 ms with `io`, 66 ms with `math`, 120 ms with `unicode`, ~140 ms with `strings` or `bytes`, ~150 ms with `strconv`; `fmt` alone pays ~50 ms because `stdlib/fmt/scan.go` imports `io`. Members that nothing in `src/`, `stdlib/` or `example/` uses are removed (Task 9.4): `unicode/tables.go` and the `RangeTable` API (`Is`, `In`, `IsOneOf`, `IsMark`, `IsNumber`, `IsSymbol`, `IsTitle`, `To`, the exported tables); `math.Gamma`/`Erf`; `sync.Map`/`Pool`; `fmt/scan.go` (`Fscan`/`Fscanln`/`Fscanf`); `strconv.QuoteToGraphic`/`QuoteRuneToGraphic`/`AppendQuoteToGraphic`/`AppendQuoteRuneToGraphic`. **Kept** because something depends on them: `unicode.SimpleFold`/`ToTitle` (`strings`, `bytes`, `strconv` call them; `caseOrbit` lives in `unicode.go`, not `tables.go`); `math.Frexp`/`Ldexp`/`Modf`/`RoundToEven`/`Nextafter`/`Nextafter32`/`FMA` (the JS backend has emitters in `src/backend/js/stdlib/math.js`, WASM has none, so the Go body is the only portable implementation); `sync.OnceFunc`/`OnceValue`/`OnceValues` (93 lines, tested in `test-runner.test.js`); `fmt.Sscan*` (emitter members). `strings.Title` is an emitter member released in v1.6.1 and is not touched. v1.9.0 Task 2.5 (lazy body checking) is the structural fix for overlay cost; this is the cheap one.
- **D5 — No pointers into scalar storage in `wasm`/`both` packages.** Taking the address of a non-struct field, element or package-level variable becomes a compile error in `wasm`/`both` packages, whether written explicitly (`&s.X`, `&xs[i]`, `&arr[i][j]`, `&pkgVar` with `var pkgVar int`) or implicitly by a pointer-receiver method call on such an operand (`s.Count.Inc()` with `type Counter int`, `xs[i].Inc()`, `pkgVar.Inc()`). Pointers to struct-typed fields, elements and globals (`&items[i]` with `[]Item`, `&s.Inner`, `&pkgStruct`), `&x` on locals (boxed) and `&T{}` keep working. `js` packages keep the current getter/setter refs (cheap in JS, not breaking). This also closes the two ledger entries that were silent wrong results (`&x` on a package-level scalar writing nowhere; `&s.A[1]` going stale after `q.A = …`).
- **D6 — Runtime panics keep Go's messages and stay recoverable.** `__bounds_panic`, `__nil_panic` and `__slice_bounds_panic` fold into one `__runtime_panic(msg)` path; `__index_panic` keeps its formatted `index out of range [i] with length n` message. No native traps.
- **D7 — Array clone elision removed only within budget.** Removing `_arrayCopyElidable` must keep `zero-alloc.js` passing and the hybrid raycast within 3% of the Phase 7 baseline; otherwise the task stops and reports.

Removed packages and the D4 overlay members were added in this unreleased cycle, so dropping them is not a breaking change for users; their CHANGELOG mentions are deleted. D5 is not breaking relative to v1.7.0 either: scalar interior pointers in WASM silently gave wrong results there (see [Goal](#goal) item 1), and now they get a documented diagnostic instead.

### Phase 8: Retire manifest & real-Go conformance gate

- [ ] **Task 8.1 — Remove the manifest, its generator and the coverage gate**
  - Files: `stdlib/manifest.json`, `scripts/stdlib-manifest.js`, `scripts/manifest-overrides.json`, `test/unit/compiler/manifest.test.js`, `test/unit/types/stdlib-coverage.test.js`, `test/unit/types/stdlib-coverage.gaps.json`, `src/typechecker/stdlib/signature.js` (only consumer is the coverage test), `src/typechecker/stdlib/excluded.js` (drop `readFileSync` of `stdlib/manifest.json` and keep `EXCLUDED_STDLIB_PACKAGES` and `EXCLUDED_STDLIB_MEMBERS` as hand-written maps), `package.json` (`manifest:update` script)
  - Do not touch: `src/cli-core.js` `manifest.json` handling (that is the PWA web manifest).
  - Test: `node test/unit/run.js`
  - Done when: the files above are deleted or updated; `grep -rn "stdlib/manifest\|manifest-overrides\|stdlib-manifest\|stdlib-coverage\|goSignature" src scripts test package.json` is empty; unit tests (including `test/unit/language/declarations.test.js` excluded-package cases) pass.

- [ ] **Task 8.2 — Replace the generated stdlib docs tables**
  - Files: `scripts/docs-stdlib.js`, `package.json` (`docs:stdlib` script and the `docs-stdlib.js --check` step in `check`), `docs/language-support.md`, `docs/hybrid-wasm.md`
  - Do: delete `scripts/docs-stdlib.js` and both scripts entries. Replace the generated blocks (`<!-- Generated by \`npm run docs:stdlib\` ... -->`) in both docs with a short hand-written package list (package, targets, notes) describing the tree **as it is at this commit** (the D2 packages still compile until Phase 9; Task 9.3 trims the list). This also removes the `plans/` links the generator wrote into `docs/`.
  - Test: `npm run check`
  - Done when: `npm run check` passes; `grep -rn "docs:stdlib\|plans/" docs/ package.json` is empty; every package directory under `stdlib/` and every name in `STDLIB_PACKAGES` appears in the list.

- [ ] **Task 8.3 — Retire the conformance harness**
  - Files: `test/conformance/` (whole directory, incl. `run.js`, `update.js`, `README.md`), `package.json` (`conformance`, `conformance:update`, and `&& npm run conformance` in `test`)
  - Do: before deleting, port fixtures as follows, then delete the directory. CI (`.github/workflows/ci.yml`) calls `npm test`, so it needs no change.
    - **Drop** (package removed by D2): `bufio`, `url`, `context`, `csv`, `container`, `hash`, `base32`, `utf16`, `cmplx`, `atomic`, `log`, `rand` (`math/rand/v2`), and the `crypto` fixtures for `hmac`/`md5`/`sha1`/`sha512`/`subtle`. Also drop any fixture case that only exercises a member Task 9.4 removes (`fmt.Fscan*`, `math.Gamma`/`Erf`, `sync.Map`/`Pool`, `unicode.Is`/`In`/`IsMark`/`IsNumber`/`IsSymbol`/`IsTitle`/`To`, `strconv.*ToGraphic`); split mixed fixtures and port the rest.
    - **Port** each `.go`/`.out` pair into the matching unit file as a `compileHybrid` expected-output case on both backends, where the unit suite has no equivalent assertion: `json` (error messages and offsets) → `test/unit/builtins/json.test.js` and `test/unit/wasm/json.test.js`; `fmt` → `test/unit/builtins/fmt-verbs.test.js`; `strconv` → `test/unit/builtins/stdlib.test.js`; `iter`/`cmp`/`slices`/`maps`/`sort` (incl. `sort/find.go`) → `test/unit/builtins/iter.test.js`; `io`/`strings` (incl. `strings/extra.go`)/`bytes` (incl. `bytes/search.go`, `bytes/split.go`)/`utf8`/`unicode`/`math`/`bits`/`time`/`sync` → `test/unit/builtins/stdlib.test.js` or `test/unit/builtins/bytes.test.js`; `crypto/sha256` → `test/unit/builtins/stdlib.test.js`. The `.out` text is pasted in as the expected string.
    - Record in the commit body, per fixture, *ported to <file>* or *already covered by <test name>*.
  - Test: `npm test`
  - Done when: `test/conformance/` is gone; `grep -rn conformance package.json .github` is empty; the unit test count grows by at least the number of ported fixtures; `npm test` passes.

### Phase 9: Prune stdlib to the lean core (D2–D4)

- [ ] **Task 9.1 — Move JSON's buffered reader into `internal/jsonrt` (D3)**
  - Files: `stdlib/internal/jsonrt/scanner.go`, new `stdlib/internal/jsonrt/reader.go`, `stdlib/encoding/json/stream.go`, `test/unit/builtins/json.test.js`, `test/unit/wasm/json.test.js`
  - Do: add a minimal private reader (only the methods `ScanNext` and `Decoder` use) and switch both files off `bufio`.
  - Test: first add a `Decoder` test over a reader that returns 1 byte per `Read` (multi-value stream), on both backends; it must pass before and after.
  - Done when: `grep -rn '"bufio"' stdlib/encoding stdlib/internal` is empty; JSON tests pass on JS and WASM; `test/e2e/perf/json-bench.js` decode median of 3 interleaved runs (before/after) within 5% of the Task 5.6 figure on both backends. If not, keep the reader, record the numbers here and open a follow-up instead of tuning in this task.

- [ ] **Task 9.2 — Rewrite examples off pruned packages**
  - Files: `example/simple/src/csv.go`, `example/preact/src/fetch.go`, `example/preact/src/fetch_test.go`, any example `app.js` regenerated by `npm run build`
  - Do: replace `encoding/csv` with a small `strings.Split`-based parser in the example, and `context` with a plain cancel flag or the DOM `AbortController` (via `js` interop).
  - Test: `node src/index.js test --dom example/...`
  - Done when: `grep -rnE '"(bufio|net/url|context|encoding/csv|container/|hash/|crypto/(hmac|md5|sha1|sha512|subtle)|encoding/base32|log|math/rand/v2|unicode/utf16|math/cmplx|sync/atomic)"' example/*/src` is empty; DOM tests pass.

- [ ] **Task 9.3 — Delete pruned packages with an "unsupported package" diagnostic**
  - Files: `stdlib/{bufio,net/url,context,encoding/csv,container,hash/adler32,hash/crc32,hash/fnv,crypto/hmac,crypto/md5,crypto/sha1,crypto/sha512,crypto/subtle,encoding/base32,log,math/rand/v2,unicode/utf16,math/cmplx,sync/atomic}`, `src/typechecker/stdlib/excluded.js`, `src/typechecker/index.js` (import declarations), `src/typechecker/types.js` (`INTRINSICS`), `src/backend/js/index.js` (`JS_INTRINSICS`), `.sentrux/rules.toml`, `docs/language-support.md`, `docs/hybrid-wasm.md`, `plans/follow-ups.md`, `test/unit/compiler/stdlib-go.test.js`, `test/unit/language/declarations.test.js`
  - Do:
    1. Add the D2 packages (`bufio`, `net/url`, `context`, `encoding/csv`, `container/{heap,list,ring}`, `hash/{adler32,crc32,fnv}`, `crypto/{hmac,md5,sha1,sha512,subtle}`, `encoding/base32`, `log`, `math/rand/v2`, `unicode/utf16`, `math/cmplx`, `sync/atomic`) to `EXCLUDED_STDLIB_PACKAGES` in `src/typechecker/stdlib/excluded.js` (import path → reason, e.g. `"bufio" → "removed in v1.8.0; use strings/bytes readers"`), checked in `_checkDirectivesAndImportsPass` (`src/typechecker/index.js`) **before** `.d.ts`/npm resolution. Unknown third-party paths keep the `cannot find types` warning.
    2. Drop `Context.Done`, `context.Context.Done`, `rand.ChaCha8`, `rand.NewChaCha8` from `EXCLUDED_STDLIB_MEMBERS`, and update the `context.Context.Done` case in `test/unit/language/declarations.test.js`.
    3. Drop `exit`, `deadline_timer`, `deadline_stop` from `INTRINSICS` and from `JS_INTRINSICS` (`src/backend/js/index.js:191`); the WASM backend has no name-specific code for them. `INTRINSICS` is then empty until v1.9.0 adds `rand_source`.
    4. Remove deleted `stdlib/` package globs from `.sentrux/rules.toml`, and delete entries in `plans/follow-ups.md` that apply only to the removed D2 packages.
    5. Trim the Task 8.2 package lists in `docs/language-support.md` and `docs/hybrid-wasm.md` to the D2 set.
  - Test (write first, failing): for each removed package, `import "<pkg>"` → `assertErrorContains(errors, "package '<pkg>' is not available")`; `import "nope/zzz"` still compiles with the warning; kept packages (`strconv`, `unicode`, `encoding/json`, `hash`) still compile on both backends. Remove `stdlib-go.test.js` cases for deleted packages.
  - Done when: directories deleted; negative tests pass; `.sentrux/rules.toml` has no deleted D2 paths; `grep -rnE "bufio|net/url|encoding/csv|container/|math/cmplx|sync/atomic|utf16|base32|rand/v2" docs/` returns only "not supported" / "not available" mentions; `npm test` and `npm run check` pass.

- [ ] **Task 9.4 — Trim the kept Go-source overlays (D4)**
  - Files: `stdlib/unicode/tables.go` (delete), `stdlib/unicode/unicode.go`, `stdlib/math/extra.go`, `stdlib/sync/extra.go`, `stdlib/fmt/scan.go` (delete; it is the only file in `stdlib/fmt/`, so the directory goes and `fmt` is emitter-only again), `stdlib/strconv/quote.go`, `src/typechecker/stdlib/excluded.js` (`EXCLUDED_STDLIB_MEMBERS`), `.sentrux/rules.toml` (if `stdlib/fmt` has a glob), `test/unit/compiler/stdlib-go.test.js`, `test/unit/builtins/stdlib.test.js`, `test/unit/wasm/stdlib.test.js`, `docs/language-support.md`, `docs/hybrid-wasm.md`
  - Do:
    1. Record the pre-task figures in the commit body: median of 3 `node src/index.js check` runs on a one-line program importing only `fmt`, then only `unicode`, then only `math`.
    2. `unicode`: delete `tables.go`; from `unicode.go` delete `RangeTable`, `Range16`, `Range32`, `is16`, `is32`, `Is`, `In`, `IsOneOf`, `IsMark`, `IsNumber`, `IsSymbol`, `IsTitle`, `To` and the `UpperCase`/`LowerCase`/`TitleCase`/`MaxCase` constants; keep `SimpleFold`, `ToTitle`, `foldASCII`, `caseOrbit` and whatever those four need.
    3. `math/extra.go`: delete `Gamma`, `Erf` and helpers only they use; keep `Frexp`, `Ldexp`, `Modf`, `RoundToEven`, `Nextafter`, `Nextafter32`, `FMA`.
    4. `sync/extra.go`: delete `Pool` and `Map`; keep `OnceFunc`, `OnceValue`, `OnceValues`.
    5. `fmt`: delete `scan.go`.
    6. `strconv/quote.go`: delete `QuoteToGraphic`, `QuoteRuneToGraphic`, `AppendQuoteToGraphic`, `AppendQuoteRuneToGraphic`; keep `IsGraphic`.
    7. Add every deleted exported member to `EXCLUDED_STDLIB_MEMBERS` (`"unicode.Is" → "removed in v1.8.0; range tables are not supported"`, `"fmt.Fscan" → "removed in v1.8.0; use fmt.Sscan on the text"`, …) so a use gets the `not supported` diagnostic instead of `undefined`.
    8. Remove the deleted members from the Task 8.2 lists in both docs.
  - Test (write first, failing): one negative case per deleted exported member → `assertErrorContains(errors, "not supported")` on both backends. Positive cases on both backends: `strings.EqualFold("σ", "Σ")` (reaches `unicode.SimpleFold`), `strings.ToTitle` and `strconv.Quote("\u00e9")` (reach `ToTitle`/`IsPrint`), `math.Frexp`/`Ldexp`/`Modf` round trip in a `both` package, `sync.OnceValue`, `fmt.Sscan`. Retarget the two `fmt.Fscan` cases in `stdlib-go.test.js` (Phase 3.2 review section) to `fmt.Sscan` with the same inputs; the `OnceFunc`/`OnceValue`/`OnceValues` re-panic case in `test/unit/compiler/test-runner.test.js` runs unchanged.
  - Done when: `grep -rnE "RangeTable|func (Gamma|Erf|Fscan|QuoteToGraphic|QuoteRuneToGraphic|AppendQuoteToGraphic|AppendQuoteRuneToGraphic)\b|type (Pool|Map) struct" stdlib/` is empty; `stdlib/fmt/` does not exist; the three Step 1 timings each drop by at least 10 ms (recorded in the commit body next to the pre-task figures); `npm test` and `npm run check` pass.

### Phase 10: WASM backend simplification (D5–D7)

- [ ] **Task 10.1 — Diagnostic for pointers into scalar storage in `wasm`/`both` (D5)**
  - Files: `src/typechecker/expressions.js` (unary `&` and the implicit `&` of pointer-receiver method calls), new `test/unit/types/pointers.test.js`, `test/unit/wasm/pointers.test.js`, `test/unit/language/parity-matrix.test.js`, `plans/follow-ups.md` (and any kept `stdlib/` file if it takes a scalar field/element/global address)
  - Test (write first, failing):
    - `both` and `wasm` packages, explicit: `&s.X` (int field), `&xs[i]` (`[]float64`), `&arr[i]` (`[4]int32`), `&s.A[1]` (`A [2]int`, the ledger's stale-pointer repro), `&g` with `var g int` at package level (the ledger's writes-nowhere repro) → `assertErrorContains(errors, "cannot take the address of a scalar field, element or package-level variable in a wasm package")`; the message suggests passing the parent struct pointer, the index, or copying to a local.
    - Implicit: `type C int; func (c *C) Inc()`; `s.Count.Inc()`, `xs[i].Inc()`, `g.Inc()` with `var g C` at package level → the same error.
    - Same code in a `js` package compiles and mutates through the pointer (unchanged).
    - Still compiles in `both`: `&items[i]` with `[]Item`, `&s.Inner` with struct-typed `Inner`, `&pkgStruct`, `&x` on a local (`var x int`), `x.Inc()` on a local `C`, `&T{}`.
  - Done when: tests pass; all kept `stdlib/` packages compile cleanly under D5; affected positive cases in `test/unit/wasm/pointers.test.js` and parity-matrix rows become negative cases; the two ledger entries named in D5 are deleted from `plans/follow-ups.md` in the same commit.

- [ ] **Task 10.2 — Remove accessor-ref generation from the WASM backend**
  - Files: `src/backend/wasm/index.js`, `src/backend/wasm/emit.js`, `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/emit-stmts.js`, `src/backend/wasm/boundary.js`, `src/backend/wasm/types.js`, `src/backend/wasm/wat.js`, `src/lower/escape.js`, `src/lower/ownership.js` (only accessor-related paths), `test/unit/wasm/wat.test.js`
  - Test: `node test/unit/run.js`
  - Done when: `grep -rn "structAccessorHelpers\|elemAccessorHelpers\|_accessorKind\|getAccType\|accInfo\|_emitSelectorAddressOf\|_emitIndexAddressOf" src/` is empty; unit tests pass.

- [ ] **Task 10.3 — Remove array clone elision (D7)**
  - Files: `src/backend/wasm/emit.js`, `src/backend/wasm/emit-stmts.js`, `src/lower/` (array ownership tracking), `test/unit/wasm/arrays.test.js`
  - Do: always copy fixed-size arrays on assignment, parameter passing and return; delete clone-elision negative tests.
  - Test: `node test/unit/run.js`, `node test/e2e/perf/zero-alloc.js`, `npm run bench` (3 interleaved hybrid runs vs. pre-task `main`).
  - Done when: `grep -rn _arrayCopyElidable src/` is empty; zero-alloc passes; hybrid raycast median within 3%. If not, revert and record the numbers here instead.

- [ ] **Task 10.4 — Merge WASM runtime panic helpers (D6)**
  - Files: `src/backend/wasm/index.js`, `src/backend/wasm/emit.js`, `test/unit/compiler/strict-panics.test.js`
  - Do: replace `__bounds_panic`, `__nil_panic` and `__slice_bounds_panic` (and `getBoundsPanicFuncIndex`/`getNilPanicFuncIndex`/the slice variant) with one `__runtime_panic` path taking the message; keep `__index_panic` and `__push_panic`.
  - Test: existing `strict-panics.test.js` parity cases unchanged (messages and `recover()` behaviour identical on both backends).
  - Done when: `grep -rn "__bounds_panic\|__nil_panic\|__slice_bounds_panic" src/` is empty; strict-panic tests pass; raycast `app.wasm` not larger than before.

### Phase 11: `%p` parity & user docs

No gate-only tasks: `/dev-loop` runs the suites per phase and the Phase 10 tasks already record the benchmark numbers (D7, Task 10.4).

- [ ] **Task 11.1 — Fix `fmt` `%p` parity on boxed scalar pointers** (carried over from the 2026-10-26 audit)
  - Files: `src/backend/js/fmt-runtime.js`, `src/backend/js/fmt-types.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test (first, failing): `compileHybrid` parity test for `fmt.Sprintf("%p|%p|%p", &x, &s, nilPtr)` (`x` a boxed int local, `s` a struct).
  - Done when: identical output on JS and WASM.

- [ ] **Task 11.2 — User docs, CHANGELOG and roadmap for the simplification**
  - Files: `docs/go-compatibility.md`, `docs/hybrid-wasm.md`, `README.md`, `CHANGELOG.md`, `plans/roadmap.md`, this plan's header
  - Do: in `go-compatibility.md` and `hybrid-wasm.md`, describe the scalar-pointer rule for `wasm`/`both` (D5) with a short before/after example and update the `%p` row (Task 11.1); the package lists were already trimmed by Tasks 9.3 and 9.4. In `CHANGELOG.md` `## [Unreleased]`, drop the pruned packages and the D4 members (`unicode` range tables, `math.Gamma`/`Erf`, `sync.Map`/`Pool`, `fmt.Fscan*`, `strconv.*ToGraphic`) from the "Expanded standard library" entry, reword the pointer entry to say scalar field/element pointers are `js`-only, remove any JS-engine feature-freeze wording, and keep each breaking change as its own `**Breaking:**` entry. Mark the Phase 8–11 rows ✅ in the roadmap and set this plan's status to Done. (`plans/v2.0.0/native-go-engine.md` was already shelved on 2026-10-27.)
  - Test: `npm run check`
  - Done when: `grep -rnE "plans/|bufio|net/url|encoding/csv|container/|math/cmplx" docs README.md CHANGELOG.md` returns only intentional "not supported"/"removed" mentions; CHANGELOG follows the AGENTS.md changelog rules; roadmap rows for Phases 8–11 are ✅.

---

## Test Plan

### Unit and parity
- **`test/unit/wasm/arrays.test.js`:** every array case in [Edge Cases](#edge-cases), as `both` packages, including clone-elision negatives.
- **`test/unit/types/shadowing.test.js`:** package and local declarations that shadow browser globals, in `js`, `wasm` and `both` packages.
- **`test/unit/wasm/pointers.test.js`:** every pointer case in [Edge Cases](#edge-cases), as `both` packages, plus a boundary case with a `*float64` parameter.
- **`test/unit/wasm/range_func.test.js`:** every control-flow case in [Edge Cases](#edge-cases), as `both` packages.
- **`test/unit/wasm/complex.test.js`:** arithmetic, `complex64` rounding, equality, map keys and formatting, as `both` packages.
- **`test/unit/wasm/closures.test.js`** (extended): per-iteration loop variables, including the WAT assertion that uncaptured loop variables allocate nothing.
- **`test/unit/wasm/scalars.test.js`** (extended): `min`/`max` builtin cases.
- **`test/unit/wasm/strings_any.test.js`** (extended): `[]rune` conversion cases.
- **`test/unit/language/constants.test.js`:** constant folding values, typed-overflow diagnostics, the precision warning, and parity for shifts ≥ 32.
- **`test/unit/types/generics.test.js`** (extended): generic type aliases.
- **`test/unit/language/expressions.test.js`** (extended): pointer-receiver method expressions.
- **`test/unit/compiler/strict-panics.test.js`:** runtime-panic parity cases and the `__at` elision assertions; a `js` package emits no helpers.
- **`test/unit/language/control-flow.test.js`** (extended): the `goto` diagnostic in all targets.
- **`test/unit/language/parity-matrix.test.js`:** one generated fixture per `language-support.md` row, including the rows added in Task 0.5a.
- **`test/unit/compiler/stdlib-go.test.js`:**
  - Go-source resolution and in-target compilation.
  - Name coexistence.
  - Zero-byte cost for unused imports.
  - Call-site diagnostics.
- ~~`test/unit/types/stdlib-coverage.test.js`, `test/unit/compiler/manifest.test.js`~~: removed by Task 8.1.
- **`test/unit/types/pointers.test.js`:** the scalar field/element pointer diagnostic in `wasm`/`both` packages and the unchanged `js` behaviour (Task 10.1).
- **`test/unit/compiler/test-runner.test.js`** (extended): `t.Cleanup` order, benchmarks, `TestMain`.
- **`test/unit/builtins/iter.test.js`:** `iter`, `slices`/`maps`/`strings`/`bytes` sequence members, the `maps.Keys` hint.
- **`test/unit/builtins/json.test.js` and `test/unit/wasm/json.test.js`:** shared cases, run on both backends.
- **`test/unit/wasm/simd.test.js`** (extended):
  - Every §10.2 operation, checked against a scalar `[4]float32` reference on both backends (bit-exact except NaN payloads).
  - `F32x4` in exported structs and functions, `==`, map keys, `fmt`.
  - `Vec3x4` `Dot`/`Cross`/`Normalize` against scalar math within 1e-6.
  - `LoadAoS4`/`StoreAoS4` round-trips; out-of-bounds panics for every load/store helper.
  - Boundary round-trips for `F32x4`, `Mask32x4` and `[]F32x4`.
- **`test/unit/wasm/encode.test.js` and `wat.test.js`:** the new SIMD opcodes, including multi-byte sub-opcodes, validated by Binaryen.

### Conformance (against real Go)

> **Superseded (2026-10-27):** Retired by Task 8.3; behaviour with no unit test is ported into `test/unit/` first. See [Simplification](#simplification-phases-811-decided-2026-10-27).
- `test/conformance/{iter,cmp,slices,maps,sort,fmt,io,bufio,url,context,utf8,unicode,strconv,math,bits,time,strings,bytes,sync,container,hash,crypto,base32,utf16,cmplx,atomic,csv,json,log,rand}/`: output must match Go byte for byte on JS and on WASM. `context` fixtures avoid wall-clock timing and use an injected clock. `log` fixtures set `SetFlags(0)`. `rand` fixtures seed a `PCG` explicitly.
- Fixtures obey [§1.1](#11-string-semantics-both-backends): no `len`, indexing or `range` on non-ASCII string literals. The runner lints this (Task 1.3c).
- The JSON corpus covers:
  - Go's own `encoding/json` test vectors, limited to the supported surface.
  - Tag permutations, embedded promotion, `omitempty`, case folding.
  - Float formatting boundaries, escaping, and the error messages.
- The CSV corpus covers the RFC 4180 cases and Go's `reader_test.go` and `writer_test.go` vectors.

### Negative and diagnostic
- An unsupported construct in a `wasm` package never yields an invalid module. The parity matrix enforces this.
- Excluded packages (`reflect`, `net/http`, `text/template`, …) report the exclusion reason from the manifest.
- `iter.Pull` reports `requires coroutines; out of scope (no runtime)`.
- `ctx.Done()` reports the channel diagnostic with the `ctx.Err()`/`context.AfterFunc` hint.
- `&m[k]` stays a compile error (as in Go) in every target.
- `goto L` reports `goto is not supported; restructure with labeled break/continue` in every target.
- `int32(1 << 40)` and `var x int8 = 200` report Go's `overflows` error; `1<<63 + 5` in a `js` package reports the precision warning.
- `time.After`, `time.Tick`, `time.NewTimer`, `time.NewTicker` report the channel exclusion; `time.AfterFunc` in a `wasm` package reports the JS-only diagnostic.
- `sync.Cond`, `//go:embed`, `unicode.Han`, `math/big`, `compress/gzip` report their exclusion category and reason from the manifest.
- An unknown `//gofront:intrinsic` name is a compile error; an overlay that redeclares an emitter member is a compile error.
- A `both` package reading `xs[5]` on a 3-element slice panics with `index out of range [5] with length 3` on both backends; the same code in a `js` package is unchanged.
- Non-constant indices to `Lane`, `WithLane`, `Swizzle` and `Shuffle` report the existing constant-lane diagnostic.
- Relaxed-SIMD-style APIs (for example a fused `FMA`) do not exist; the docs point to `MulAdd`.
- `sort.Strings(maps.Keys(m))` reports the `slices.Collect` hint.
- Malformed JSON returns `*json.SyntaxError` with Go's offset; a type mismatch returns `*json.UnmarshalTypeError` with the field path.
- A CSV bare quote returns `*csv.ParseError` wrapping `ErrBareQuote` with the line and column.

### Performance and size
- Dev-mode `app.wasm` and `app.js` for `example/hybrid` without new imports must be byte-identical in size to v1.7.0. The only exceptions are code affected by the pointer fix (Task 0.1: addresses of scalar fields or elements), the array fix (Task 0.8: array copies that clone elision cannot remove), per-iteration boxes for captured loop variables (Task 0.10), and strict-mode index helpers that elision cannot remove (Task 0.16).
- The pointer fast path: a micro-benchmark of `*p` on a boxed local (`&x`) must stay within 5% of v1.7.0. Measured on 100M read/write dereference iterations: median 155.66 ms (642.4 Mops/s), within 1.5% of baseline (153.2 ms / 652.7 Mops/s). Hybrid raycast benchmark: 11,840 rays/s (1.35× speedup over JS), 2,688 B alloc/run.
- Array value semantics (Task 0.8a, copies always inserted, no elision yet), `npm run bench` on the same machine: base `feat/portable-go` hybrid 19,722 rays/s, 85,616 B alloc/run; after 0.8a hybrid 18,727 rays/s (−5.0%), 85,624 B alloc/run; dev `app.wasm` 67.9 KB in both.
- Clone elision for arrays (Task 0.8b), interleaved `npm run bench --mode hybrid` runs on the same machine: base 18,881 / 17,632 rays/s (84,352 / 84,424 B alloc/run), after 0.8b 18,572 / 18,745 rays/s (84,552 / 84,800 B alloc/run): within noise and inside the 3% budget. The raycast fixture declares no fixed-size arrays in its hot path, so its module size and hot-function instruction counts (`--sizes`) are unchanged, and `example/hybrid` dev `app.wasm`/`app.js` are byte-identical to the base. The 0.8a −5% figure above was run-to-run noise.
- After the Phase 0.5 review fixes: base 20,760 rays/s (85,832 B alloc/run) against branch 20,946 rays/s (85,512 B alloc/run); `example/hybrid` dev output and raycast `--sizes` are still identical to the base.
- Strict-mode runtime checks (Tasks 0.16a/0.16b), interleaved `npm run bench --mode hybrid` runs on the same machine: v1.7.0 11,615 / 11,831 / 11,845 / 11,875 rays/s (median 11,838), branch 11,742 / 11,690 / 11,726 / 11,762 rays/s (median 11,734): −0.9%, inside the 3% budget; 2,688 B alloc/run in both. Raycast `app.wasm` grows from 67.9 KB to 74.9 KB (index-check handlers). Intermediate variants measured on the way: Go's message with the length kept in a local 11,424 / 11,449 / 11,311 (−4.2%), length carried as a branch value 11,596 / 11,540 (−2.7%).
- Recoverable nil dereference in WASM (Task 0.16a follow-up), three interleaved rounds: v1.7.0 11,944 / 11,728 / 11,629 rays/s (median 11,728), before the nil checks 11,569 / 11,614 / 11,206 (median 11,569, −1.4%), with them 11,458 / 11,486 / 11,529 (median 11,486, −2.1%); 2,688 B alloc/run in all three. Raycast `app.wasm` 74.9 KB → 77.3 KB (one `br_on_null` per pointer field access, one `nil` block per function).
- WASM JSON benchmark (Task 5.6, `test/e2e/perf/json-bench.js`), 1.05 MB corpus (18,000 items), 5 runs: JS encode 24.68 ms (42.3 MB/s), decode 139.83 ms (7.5 MB/s), total 164.52 ms; WASM encode 48.15 ms (21.7 MB/s), decode 139.26 ms (7.5 MB/s), total 187.41 ms. Ratio WASM / JS: encode 1.95×, decode 1.00×, total 1.14× (gate: WASM ≤ 2× JS total time, passed).
- `npm run bench` must show no regression in the hybrid raycast. Neither the array-copy fix (Task 0.8b) nor the strict-mode runtime checks (Task 0.16b) may slow the scalar raycast by more than 3% each; the analysis is extended until they do not, and the checks are never shipped disabled.
- `test/e2e/perf/zero-alloc.js` must pass after Tasks 0.5a, 0.5d and 0.7c.
- The SIMD particle and `IntersectRayAABB4` raycast results, with allocations per run, are recorded in §10.6 together with the promotion decision.
- SIMD (Tasks 6.9 and 6.10): particle kinematics scalar 47.9 ms vs SIMD 29.4 ms (1.62x to 1.65x, 15.6 B/step); raycast js 11,630, hybrid 12,598, simd 12,649 rays/s (alloc/run 20,068,800 / 83,632 / 87,024 B).
