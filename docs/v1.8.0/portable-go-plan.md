# Portable Go Completion — Design Plan

**Version:** v1.8.0
**Status:** In Progress (2026-10-20)
**Depends on:** v1.7.0 ([`json-preact-simd-plan.md`](../v1.7.0/json-preact-simd-plan.md)), including the JS `encoding/json` hardening on the v1.7.0 branch.
**Replaces:** the dropped v1.7.1 plans. Their stdlib items (`bufio`, `context`, `net/url`), the WASM interior-pointer problem and the SIMD completion and SoA work move here. Boundary slice borrowing (a performance optimisation, not a completeness item) is not part of this plan.
**Followed by:** [`docs/v2.0.0/native-go-engine.md`](../v2.0.0/native-go-engine.md). v1.8.0 is the **last feature release of the JS engine** and the baseline for the v2.0.0 port. After it, only bug-fix releases (v1.8.x) ship.

---

## Goal

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
- Every in-scope package and member in the manifest (see [Scope rule](#scope-rule)) is supported on JS and WASM with Go's signature, or excluded with a stated reason.
- `encoding/json` and `encoding/csv` produce the same output as Go on the conformance corpus, on both backends.
- `gofront/simd` produces the same results on both backends (NaN payloads aside), and the promotion decision is recorded in this document with the benchmark numbers.
- [`go-compatibility.md`](../go-compatibility.md), [`language-support.md`](../language-support.md) and [`hybrid-wasm.md`](../hybrid-wasm.md) are generated from, or checked against, the same manifest.

---

## Scope rule

A Go package or member is **in scope** when it can be implemented as ordinary compiled code over values GoFront already has, with no scheduler, no runtime type metadata, and no host service beyond what the target already imports (clock, random source, console).

| Category | Rule | Examples |
|---|---|---|
| **In scope: pure** | Supported on `js`, `wasm` and `both` | `encoding/csv`, `container/heap`, `hash/crc32`, `cmp`, `iter`, `unicode/utf16` |
| **In scope: JS-only by design** | Supported in `js` packages; targeted diagnostic in `wasm` | `regexp`, `time.Sleep`, `os`, DOM, `context.Signal()` |
| **Excluded: runtime** | Targeted diagnostic everywhere | goroutines, channels, `select`, `reflect`, `unsafe`, `runtime`, `weak`, `unique` |
| **Excluded: host** | Targeted diagnostic everywhere | `net/http`, `net`, `os/exec`, file I/O in `os`, `syscall` |
| **Excluded: needs reflection** | Targeted diagnostic everywhere | `text/template`, `html/template`, `encoding/xml`, `encoding/gob`, `flag` |
| **Excluded: deferred (pure, large)** | Pure and inside the boundary, but the code size or API surface does not pay for itself in a frontend compiler. Targeted diagnostic with `deferred; open an issue if you need it`. Revived by a separate plan, never ad hoc. | `math/big`, `compress/*`, `archive/*`, `image/*`, `crypto/{aes,cipher,rsa,ecdsa,ed25519,x509,tls,elliptic}`, `encoding/{asn1,pem,ascii85}`, `text/{tabwriter,scanner}`, `go/*`, `debug/*`, `hash/{crc64,maphash}`, `unicode` range tables (`unicode.Is`/`In`, script and category tables), `embed` |

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

These were confirmed while writing this plan. The Phase 1 audit produces the complete list.

| Area | Finding | Evidence |
|---|---|---|
| Array value semantics in WASM | **Silent wrong results.** Fixed-size arrays alias instead of copying: after `b := a; b[0] = 9`, `a[0]` is `9`. Passing an array to a function also lets the callee mutate the caller's array. This affects `[N]float32` and `[N]simd.F32x4` alike. JS packages are correct. | Probe: a `both` package passes `[js]` and fails `[wasm]` for local assignment and for a parameter |
| Predeclared-name shadowing | A package-level `func Array()` fails with `Array redeclared in this block`, because browser globals are declared in the same scope as package declarations. Go lets package declarations shadow predeclared names. | Probe: a `both` package declaring `func Array()` |
| Pointers to fields/elements in WASM | **Silent wrong results.** `&s.X` and `&xs[i]` (scalar `X`/element) copy the value into a fresh box, so writes through the pointer are lost. JS packages are correct, and [go-compatibility](../go-compatibility.md) documents the JS behaviour for both targets. | Probe: a `both` package with `set(&s.X, 7)` and `*(&xs[1]) = 9` passes `[js]` and fails `[wasm]` (`Field() = 0`, `Elem() = 2`); [`emit-exprs.js`](../../src/backend/wasm/emit-exprs.js) `case "&"` emits `struct.new` of the box type |
| Range-over-func in WASM | `for v := range seq` over any `func(yield func(V) bool)` is lowered as a slice range. The module fails validation (`array.len expected arrayref`). JS packages work. | Probe: one `wasm` package with a non-generic `func(yield func(int) bool)`; `gofront test` fails at `WebAssembly.instantiate` |
| Generic named func types in WASM | `type Seq[V any] func(yield func(V) bool)` returned from a function produces `type error in return[0]` | Same probe with `Seq[int]` |
| Complex numbers in WASM | `complex()`, `real()`, `imag()` report `Unresolved identifier: complex`, an internal error rather than a diagnostic | Probe: one `wasm` package; [`src/backend/wasm/`](../../src/backend/wasm/) has no complex lowering |
| Per-iteration loop variables in WASM (Go 1.22) | **Silent wrong results.** `for i := 0; i < 3; i++ { fs = append(fs, func() int { return i }) }` calls give `0,1,2` in JS and `3,3,3` in WASM. The three-clause `for` shares one captured box across iterations. `range` loops are correct on both backends. | Probe: a `both` package returning `fs[0]()*100 + fs[1]()*10 + fs[2]()` gives `12` in JS and `333` in WASM |
| `min`/`max` builtins in WASM | `min(3, 1, 2)` reports `Unresolved identifier: min`, an internal error. JS packages work. [`emit-builtins.js`](../../src/backend/wasm/emit-builtins.js) handles `cap`, `copy`, `clear`, `print` but not `min`/`max`. | Probe: a `both` package calling `min`/`max` |
| `[]rune` indexing in WASM | `r := []rune(s); string(r[1])` produces an invalid module (`local.tee expected (ref null 21), found call of type externref`). | Probe: a `both` package; `gofront test` fails at `WebAssembly.validate` |
| Untyped constant expressions in JS | **Silent wrong results in `js` and `both` packages.** `var x int64 = 1 << 40` emits a JS `<<`, whose shift count wraps modulo 32, so `x == 256`. `1<<63 + 5` becomes `-2147483643`. Go evaluates constant expressions exactly at compile time. The WASM backend folds them correctly in [`const-fold.js`](../../src/backend/wasm/const-fold.js); the JS backend has no folder. | Probe: a `both` package returning `float64(x * 1000)` gives `256000` in JS and `1099511627776000` in WASM |
| Generic type aliases (Go 1.24) | `type Set[T comparable] = map[T]struct{}` then `Set[int]{}` reports `Unknown struct in CompositeLit: undefined`, an internal error on both backends | Probe |
| Method expressions with a pointer receiver | `(*C).Inc` reports `cannot dereference non-pointer type C` on both backends. [`language-support.md`](../language-support.md) lists method expressions as supported; only the value-receiver form `T.M` works. | Probe |
| Runtime panics in `both` packages | **Different results.** Out-of-range slice index: JS yields `undefined`, WASM panics. Write to a nil map: JS succeeds, WASM panics. Field read through a nil struct pointer: WASM panics with Go's message, JS does not. Strict numeric mode covers only integer division by zero. | Probe: three `both` packages with `defer`/`recover` return `"nopanic"` in JS and `"panic"` in WASM |
| Array value semantics on container loads | `a := m["x"]` and `a := xs[0]` alias the stored array in WASM, so `a[0] = 9` writes into the map or slice. JS copies. | Probe: `both` packages return `5` (JS) and `9` (WASM) |
| `fmt` `%d` of `uint64` ≥ 2⁶³ in WASM | Prints `9223372036854776000` instead of `9223372036854775813`: the value is converted to `f64` before formatting. `strconv.FormatUint` is exact. | Probe |
| `fmt` verbs | `%T`, `%U` and `%p` are not in the verb set and print literally on both backends. `%q` on a rune prints `"120"` instead of `'x'`. The `#` flag is parsed and ignored, so `%#v` equals `%v`. | [`runtime.js`](../../src/backend/js/runtime.js) format regex `[sdvftxXqobeEgGwc%]`; [`emit-stdlib.js`](../../src/backend/wasm/emit-stdlib.js) format regex |
| Type switch on `any` holding a float | `switch any(3.0).(type)` matches `case int` in JS and `case float64` in WASM. Same root cause as the documented `any == any` row: JS has one number type. | Probe |
| Stdlib signatures | `strconv.ParseInt` is declared as returning `(int, error)`; Go returns `(int64, error)`. A manifest that compares member **names** does not find this. | [`core.js`](../../src/typechecker/stdlib/core.js) `strconv.ParseInt` |
| `goto` | `Undefined: 'goto'`. Not mentioned in any plan; [`go-compatibility.md`](../go-compatibility.md) says "Not planned". | Probe |
| Generic calls inside generic bodies in WASM | `Compare[T]` calling `isNaN[T]` reports `Undefined: 'isNaN'`: monomorphisation dropped the inferred type arguments of a generic call when it copied a generic body. **Fixed in Phase 0.4.** | Found while landing `cmp` (Task 0.6a) |
| Generics in multi-package WASM builds | A linked `app.wasm` with any generic declaration fails on every cross-package reference (`Undefined: 'util'`): the monomorphisation re-check has no package namespaces. **Fixed in Phase 0.4.** | Probe: a `wasm` package calling `util.Two()` next to a generic `util.Id` |
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

---

## Out of Scope

- Everything in the **Excluded** rows of the [Scope rule](#scope-rule).
- **`regexp` in WASM.** It still needs either an RE2 engine or a host call per match (see [v1.6.1](../v1.6.1/wasm-gaps-plan.md#out-of-scope)). It stays JS-only.
- **`math/big`** and the other **deferred (pure, large)** packages in the [Scope rule](#scope-rule). Each is deferred to a separate plan if a user asks for it.
- **`log/slog`.** It is a candidate for v1.8.x once `log` and the Go-source stdlib exist. (`log` and `math/rand/v2` are **in** scope: see [§7](#7-new-pure-packages-go-source).)
- **`goto`.** It is inside the no-runtime boundary, but neither backend has unstructured control flow and both would need a loop-plus-state-machine lowering for a construct that is rare in idiomatic Go. It stays a targeted diagnostic (`goto is not supported; restructure with labeled break/continue`) in every target, and the parity matrix checks that diagnostic. Revisit only with a user request.
- **`//go:embed` and `embed.FS`.** Compile-time by definition, so it passes the scope rule, and it is useful for shaders and templates. It needs resolver and asset-pipeline design that does not fit this release. Listed as deferred; targeted diagnostic `//go:embed is not supported yet`.
- **Runtime-panic parity in `js` packages.** `js` packages keep JavaScript's behaviour for out-of-range indexing and nil-map writes (documented in [`go-compatibility.md`](../go-compatibility.md)). Only strict-mode packages (`both`) gain the checks, see [§1](#1-wasm-language-parity).
- **Type switches and `any` equality on numbers in `both` packages.** `any(3.0)` is `int` in JS and `float64` in WASM. Boxing every number to fix this would slow every DOM call. The divergence stays documented, the parity matrix marks the row as an accepted difference, and conformance fixtures do not depend on it.
- **Byte-exact Go string semantics.** `len(s)`, `s[i]` and `range` indices stay UTF-16 based on both backends (see [§1.1](#11-string-semantics-both-backends)). Changing the string representation is a v2.x decision.
- **Exact `int64`/`uint64` JSON parity beyond 2⁵³ in `both` packages.** WASM is exact. The JS backend keeps `Number` for `int64` so DOM, Canvas and WebGL calls stay fast. The parity corpus stays within ±2⁵³.
- **Boundary slice borrowing** (from the dropped v1.7.1 plans). It is a performance optimisation and needs its own plan if revived.
- **SIMD beyond `F32x4`:** `F64x2`, `I32x4`/`I16x8`/`I8x16` arithmetic vectors, relaxed SIMD (including fused multiply-add, which is non-deterministic across hardware), auto-vectorisation, matrix types, and threaded/`SharedArrayBuffer` SIMD. `Mask32x4` is the only integer-lane type.
- **`context.Context.Done()`.** It returns a channel, and channels are out of scope. See [§6](#6-bufio-neturl-and-context-go-source).
- **Cyclic JSON graphs, `TextMarshaler` map keys, struct tag options other than `json`/`csv`.**
- **Migrating existing emitter-backed packages to Go source.** Only new packages and new pure members use the Go-source stdlib.
- **New boundary types.** The v1.7.0 boundary is unchanged, except that `iter.Seq`/`Seq2` values cross like any other `func` value, and pointer-to-scalar parameters may now carry accessor refs (same JS-side `{ value }` box).

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
- **Parity matrix.** A test generator walks the rows of [`language-support.md`](../language-support.md) and compiles one fixture per row as a `both` package. A row that cannot be supported in WASM must report a targeted diagnostic. An invalid module, a validation error, an internal error (`Unresolved identifier`, `Unsupported WASM instruction`), or a JS/WASM output difference fails the test. The table gains rows for the items above (loop variables, `min`/`max`, `[]rune`, constant expressions, generic aliases, pointer-receiver method expressions, runtime panics, `goto`) before the generator is written, so the matrix covers them from the first run.

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
3. **Documentation.** The table above moves into [`go-compatibility.md`](../go-compatibility.md) (it replaces the two existing rows on `range` over string and `len()`), and [`language-support.md`](../language-support.md) links to it from the `strings`/`bytes` rows.
4. **JSON and CSV offsets.** `SyntaxError.Offset`, `csv.ParseError.Column` and `Decoder.InputOffset` count **bytes** of the UTF-8 input, because both codecs read `[]byte`. This matches Go exactly, even though `len(s)` on the original string does not.

### 2. Go-source stdlib

Today every stdlib member is implemented twice: a JS shim in [`src/backend/js/stdlib/`](../../src/backend/js/stdlib/) and a WASM emitter in [`src/backend/wasm/stdlib/`](../../src/backend/wasm/stdlib/). That is already 22k lines on the WASM side alone. Adding about 15 packages the same way would double that and multiply the parity risk.

Instead, pure packages are written **in GoFront Go** and shipped in `runtime/stdlib/<import path>/*.go` with `//gofront:target both`:

- **Location.** `runtime/stdlib/` sits next to the shared runtime helpers, not under `src/`. v1.8.0 is the last JS-engine feature release, and the [v2.0.0 native engine](../v2.0.0/native-go-engine.md) embeds these same files instead of porting them. Every file starts with `//go:build gofront`, so the Go toolchain ignores them once the repository becomes a Go module.

- **Resolution.** [`resolver.js`](../../src/resolver.js) resolves `container/heap` and similar paths to the embedded source directory before it checks `STDLIB_PACKAGES`. Typings come from type-checking that source, so there are no hand-written signatures in [`src/typechecker/stdlib/`](../../src/typechecker/stdlib/).
- **Overlays.** A Go-source directory may also extend an existing emitter-backed package. Its declarations merge into the same namespace. Examples: `sort.Sort`/`sort.Interface` on top of `sort`, and `simd.Vec3x4` on top of the `F32x4` intrinsics. A name defined both ways fails the stdlib self-test.
- **In-target compilation.** A Go-source package is compiled into its caller's target: JS for `js` callers, WASM for `wasm` callers, and both for `both` callers. It never goes through the boundary facade, and it never adds a linked WASM package (so no top-level name collisions).
- **Strict numerics for free.** `both` packages already get strict numeric JS ([hybrid guide](../hybrid-wasm.md#strict-numeric-mode)). As a result, `uint32` hashing (CRC32, SHA-1, FNV) is bit-identical across backends without extra work.
- **Reachability.** Only functions and methods reachable from user code are emitted. This applies to JS output and to dev-mode WASM, where Binaryen is not run, so its dead-code elimination does not help. A package that is imported but unused costs zero bytes.
- **Host intrinsics.** A small, closed set of `//gofront:intrinsic` functions lets Go-source packages request target-specific behaviour without importing browser APIs. The only one in v1.8.0 is the `context` deadline timer (see [§6](#6-bufio-neturl-and-context-go-source)). New intrinsics need a plan change.
- **Stdlib calls.** Go-source packages may call existing emitter-backed stdlib (for example `math.Sqrt` or `strings.Builder`) like any user package.
- **Layering.** The resolver and compiler own loading. Backends see ordinary packages. Sentrux layers are unchanged.
- **Diagnostics.** Errors inside stdlib source are compiler bugs. They are reported against the user's call site with an `internal stdlib` note, not a path into `runtime/stdlib/`.

**Rejected alternatives:**
- **More dual hand-written emitters.** This doubles the work and the parity risk for every package.
- **Compiling Go's own stdlib source.** Go's source depends on `unsafe`, `internal/*`, `reflect` and goroutines. GoFront's sources are small, purpose-written subsets with the same API.

### 3. Coverage manifest and conformance

- **Manifest.** `scripts/stdlib-manifest.js` reads Go's `api/go1.*.txt` files (go1.26, matching [go-compatibility](../go-compatibility.md)) for the in-scope package list. It writes `runtime/stdlib/manifest.json`, which is checked in, so CI does not need a Go toolchain. Each entry records its availability (`js`, `wasm`, `both`, or `excluded:<reason>`) and its implementation (`emitter` or `source`). v2.0.0 uses the implementation field to know which members must be ported.
- **Coverage test.** A unit test diffs the manifest against the checker namespaces, `WASM_STDLIB_MEMBERS` and the Go-source packages. It compares **signatures**, not just names: Go's `api/*.txt` lines carry parameter and result types, and the test normalises the checker's declared types to the same textual form (`func(string, int, int) (int64, error)`). A member whose signature differs (today: `strconv.ParseInt` returning `int`) fails the test with both signatures in the message. An entry without an implementation or an exclusion reason fails the test. This replaces the v1.6.1 coverage gate, which only compared JS against WASM.
- **Generated docs.** The package tables in [`language-support.md`](../language-support.md) and [`hybrid-wasm.md`](../hybrid-wasm.md#what-wasm-packages-support) are generated from the manifest (`npm run docs:stdlib`). `npm run check` fails if they are stale.
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
- `%p` prints `%!p(T)` with a note in [`go-compatibility.md`](../go-compatibility.md): there are no addresses.
- Exact `int64`/`uint64` formatting in WASM for `%d`, `%x`, `%o`, `%b`: the formatter takes `i64` and uses the `strconv` lowering, never `f64`.
- Missing argument and extra argument forms (`%!d(MISSING)`, `%!(EXTRA int=1)`) match Go, because conformance fixtures hit them.

**`os.Stdout`/`os.Stderr`.** They become typed `*os.File` values that implement `io.Writer` and `io.StringWriter` by writing to the console import (`Stdout` → `console.log` stream, `Stderr` → `console.error`), on both backends. `fmt.Print*`, `fmt.Fprint*(os.Stdout, …)` and `log` share one line-buffering helper so partial writes (`fmt.Print("a"); fmt.Print("b\n")`) produce one console line.

### 6. `bufio`, `net/url` and `context` (Go source)

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
  - `p := &xs[1]; xs = append(xs, 4)` (which reallocates) leaves `p` pointing at the old backing array, as in Go. **Capacity model:** both backends treat `cap(xs) == len(xs)` for slices they create, and `append` always reallocates when it grows (today's rule in [`go-compatibility.md`](../go-compatibility.md)). This is what makes the two copies of a `both` package agree on *when* a pointer detaches. The three-index slice keeps ignoring `max`.
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

> **Phase Sizing & Dev-Loop Bounds (1 Phase = 1 Dev-Loop)**:
> - **1 Phase = 1 Dev-Loop**: Each phase creates a dedicated branch (`feat/portable-go-phase-<N>`), executes all tasks continuously, opens 1 PR into `feat/portable-go`, and runs an isolated 2-pass AI code review.
> - **Phase Budget (3–5 Tasks)**: Phases are capped at 3–5 cohesive tasks with a net diff budget $\le$ 500 LOC so that AI reviews and tests are reliable and fast.
> - **Continuous Execution**: Within each phase, the orchestrator loops continuously through all tasks without halting between checkboxes, committing each task atomically (`feat(<scope>): <task summary> (Task N.M)`).

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

- [ ] **Task 0.6a — Go-source stdlib loader (first package: `cmp`)**
  - Files: `src/resolver.js`, `src/compiler.js`, `src/typechecker/types.js` (`STDLIB_PACKAGES`), new `runtime/stdlib/cmp/cmp.go`
  - Do: resolve an import path to `runtime/stdlib/<path>/` before checking `STDLIB_PACKAGES`. Type-check and compile the package into the caller's target (`js`, `wasm`, or both) as if it were a user `both` package, with no boundary facade and no linked top-level names. Land `cmp` (`Ordered`, `Compare`, `Less`, `Or`) as the smoke package.
  - Test: new `test/unit/compiler/stdlib-go.test.js` — a `js` package and a `wasm` package importing `cmp`; `cmp.Compare(1.0, math.NaN())` parity; a `both` package using `cmp.Or`.
  - Done when: `import "cmp"` works in all three targets without any entry in `src/typechecker/stdlib/`.

- [ ] **Task 0.6b — Overlays on emitter-backed packages (first overlay: `errors.ErrUnsupported`)**
  - Files: `src/resolver.js`, `src/typechecker/index.js` (namespace merge), new `runtime/stdlib/errors/overlay.go`
  - Do: a Go-source directory may extend an existing emitter-backed package; its declarations merge into the same namespace and must not collide with emitter members (collision = compiler error at load). Land `var ErrUnsupported = New("unsupported operation")`.
  - Test: `stdlib-go.test.js` — `errors.Is(err, errors.ErrUnsupported)` parity; a deliberate collision fixture reports `overlay redeclares errors.New`.
  - Done when: overlay members appear in `errors` on both backends and the collision diagnostic is tested.

- [ ] **Task 0.6c — Name coexistence and call-site diagnostics**
  - Files: `src/resolver.js`, `src/typechecker/index.js`, `src/compiler.js` (error mapping)
  - Do: a user package named `heap` coexists with `container/heap` (qualified by import path everywhere, including the WASM function-name mangling). A type error inside a Go-source file is re-reported at the user's import or call site with the note `internal stdlib error in <path>; please report`, never as a path into `runtime/stdlib/`.
  - Test: `stdlib-go.test.js` — the coexistence fixture (use `cmp` plus a user package `cmp`); a temporarily broken overlay copied to a temp dir reports at the call site.
  - Done when: both tests pass.

- [ ] **Task 0.6d — `//gofront:intrinsic` with the deadline timer**
  - Files: `src/parser/declarations.js` (directive), `src/typechecker/declarations.js`, `src/backend/js/statements.js`, `src/backend/wasm/emit-stdlib.js`
  - Do: a body-less func declaration preceded by `//gofront:intrinsic <name>` resolves to a backend-provided implementation. Only `deadline_timer(ns int64, fire func())` exists: JS arms `setTimeout`; WASM returns immediately (cooperative model). Any other name is a compile error `unknown intrinsic`.
  - Test: `stdlib-go.test.js` — a temp Go-source package calling the intrinsic compiles on both targets; an unknown intrinsic name is rejected.
  - Done when: `context` (Task 4.3b) can be written without browser APIs.

- [ ] **Task 0.7 — Reachability-based emission for Go-source packages**
  - Files: `src/lower/index.js` (or a new `src/lower/reachability.js`), `src/backend/js/index.js`, `src/backend/wasm/emit.js`
  - Do: starting from user exports, `init`, and `main`, mark reachable functions, methods (by name on reachable types) and package variables in Go-source packages; emit only those, in JS output and in dev-mode WASM. Emitter-backed packages are unaffected.
  - Test: `stdlib-go.test.js` — a program importing `cmp` but using nothing adds 0 bytes to `app.js` and to dev `app.wasm` compared with the same program without the import.
  - Done when: the zero-byte assertion holds for JS and WASM.

### Phase 0.5: Array value semantics, universe scope & loop variables

- [ ] **Task 0.8a — Array value semantics in WASM: always copy**
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/emit-stmts.js`, `src/backend/wasm/emit-shared.js` (reuse the value-struct copy helper)
  - Do: insert `array.new` + `array.copy` on assignment, parameter passing, return, struct-field copy, store into slice/map/interface, and load from slice/map/struct field. Nested arrays copy deeply. `range` over an array iterates a copy.
  - Test: new `test/unit/wasm/arrays.test.js` — every array edge case in [Edge Cases](#edge-cases) as parity tests, including the map/slice load cases and `[N]simd.F32x4`.
  - Done when: all pass; `npm run bench` numbers are recorded (regression expected, fixed in Task 0.5b).

- [ ] **Task 0.8b — Clone elision for arrays**
  - Files: `src/lower/ownership.js`, the emit sites from Task 0.5a
  - Do: skip the copy when `ownership.js` proves the source is dead after the copy or never mutated on either side. Add the negative case to the analysis tests: a copy must stay when the source is mutated afterwards.
  - Test: `test/unit/compiler/lower.test.js` (elision decisions), `arrays.test.js` (behaviour unchanged).
  - Done when: `npm run bench` scalar raycast is within 3% of v1.7.0 and `test/e2e/perf/zero-alloc.js` passes.

- [ ] **Task 0.9 — Predeclared names in the universe scope**
  - Files: `src/typechecker/index.js` (scope setup), `src/typechecker/types.js` (browser-global list)
  - Do: browser globals and other predeclared names live in a universe scope below the package scope, so package and local declarations shadow them in every target. Shadowing a global in a `js` package hides it for that package.
  - Test: new `test/unit/types/shadowing.test.js` — `func Array()`, `var document int`, a local `len := 3`, in `js`, `wasm` and `both` packages; `Array redeclared` must not appear.
  - Done when: all pass and `npm run check` on `example/` is unchanged.

- [ ] **Task 0.10 — Per-iteration loop variables in WASM**
  - Files: `src/backend/wasm/emit-stmts.js` (three-clause `for`), `src/lower/captures.js`
  - Do: when a three-clause `for` variable is captured by a closure in the body, allocate a fresh box per iteration: copy the value in at the top of the body and back out before the post statement. Uncaptured variables keep a plain local.
  - Test: `test/unit/wasm/closures.test.js` — the `fs[0]()*100 + fs[1]()*10 + fs[2]()` parity test (`12`); a closure that writes `i`; an uncaptured loop emits no `struct.new` in the loop (assert on WAT).
  - Done when: parity test passes and `zero-alloc.js` still passes.

### Phase 0.6: WASM builtins, conversions & constant folding

- [ ] **Task 0.11 — `min`/`max` builtins in WASM**
  - Files: `src/backend/wasm/emit-builtins.js`
  - Do: integers via `select` on `lt_s`/`lt_u`; floats via `f32.min`/`f64.min` and `max`; strings via the existing compare import; variadic forms fold left; a single argument returns itself.
  - Test: `test/unit/wasm/scalars.test.js` — the builtin edge cases in [Edge Cases](#edge-cases) as parity tests.
  - Done when: `Unresolved identifier: min` is gone and all cases pass.

- [ ] **Task 0.12 — `[]rune` conversions in WASM**
  - Files: `src/backend/wasm/emit-exprs.js` (conversion), `src/backend/wasm/types.js`
  - Do: `[]rune(s)` produces a `(ref null $array_i32)` built from code points; `string(r)` and `string(r[i])` accept it; `len`, `append`, slicing work on it.
  - Test: `test/unit/wasm/strings_any.test.js` — the `[]rune` edge cases as parity tests.
  - Done when: the `local.tee expected (ref null 21)` module is valid and outputs match JS.

- [ ] **Task 0.13a — Shared constant folder**
  - Files: move `src/backend/wasm/const-fold.js` to `src/lower/const-fold.js`; `src/backend/wasm/*` imports updated; `src/typechecker/expressions.js` (constant typing)
  - Do: a backend-independent evaluator for untyped constant expressions using `BigInt` for integers and `Number` for floats, covering `+ - * / % << >> & | ^ &^`, unary `- ^ !`, comparisons, and conversions. The checker attaches the folded value to the AST node. Typed constant overflow (`int32(1 << 40)`, `var x int8 = 200`) is a compile error with Go's `overflows` wording.
  - Test: new `test/unit/language/constants.test.js` — folded values for the constant edge cases; the two overflow diagnostics; WASM golden output unchanged (`test/unit/wasm/golden.test.js`).
  - Done when: the WASM backend uses the moved folder with no output change and the checker reports overflow.

- [ ] **Task 0.13b — JS backend emits folded constants**
  - Files: `src/backend/js/expressions.js`
  - Do: when a node carries a folded constant, emit the literal (`1099511627776`, not `1 << 40`). Values outside ±2⁵³ in `js` packages emit the nearest `Number` and a compile warning `constant … exceeds JS Number precision`; in `both` packages the same rule applies to the JS copy.
  - Test: `constants.test.js` — parity tests for `1 << 40`, `1 << 62`, `math.MaxInt64 / 2`; the warning text for `1<<63 + 5`.
  - Done when: `float64(x * 1000)` with `x = 1 << 40` gives `1099511627776000` on both backends.

### Phase 0.7: Type aliases, method expressions, panics & goto

- [ ] **Task 0.14 — Generic type aliases**
  - Files: `src/typechecker/declarations.js`, `src/typechecker/resolve.js`
  - Do: `type A[P any] = T[P]` records type parameters on the alias; an instantiation `A[int]` substitutes into the aliased type and resolves to exactly that type (no new named type). Works in composite literals, parameter types and nested generics.
  - Test: `test/unit/types/generics.test.js` — the generic-alias edge cases; the `Unknown struct in CompositeLit` message must not appear.
  - Done when: the four edge cases pass as parity tests.

- [ ] **Task 0.15 — Method expressions on pointer receivers**
  - Files: `src/parser/expressions.js`, `src/typechecker/expressions.js`
  - Do: `(*T).M` parses as a method expression when `T` names a type; its type is `func(*T, args…) results`. Value form `T.M` keeps working. Both backends reuse the existing method-value lowering.
  - Test: `test/unit/language/expressions.test.js` — the method-expression edge cases as parity tests; the old `cannot dereference non-pointer type` message must not appear for this form.
  - Done when: all pass.

- [ ] **Task 0.16a — Strict-mode runtime panics (checks everywhere)**
  - Files: `src/backend/js/expressions.js` (strict index/field access), `src/backend/js/runtime.js` (`__at`, `__set`, `__nilmap`, `__deref` helpers)
  - Do: in strict mode only, index reads/writes on slices, arrays and strings go through bounds-checked helpers that throw `runtime error: index out of range [i] with length n`; a write to a nil map throws `assignment to entry in nil map`; field access through a nil struct pointer throws `runtime error: invalid memory address or nil pointer dereference`. `recover()` returns the same message as WASM.
  - Test: new `test/unit/compiler/strict-panics.test.js` — the runtime-panic edge cases as parity tests; a `js` package is unchanged (no helpers in output).
  - Done when: all parity tests pass (benchmark regression expected, fixed next).

- [ ] **Task 0.16b — Index-check elision**
  - Files: `src/lower/` (new `bounds.js`), `src/backend/js/expressions.js`
  - Do: skip the helper for `for i := range xs` indices, `for i := 0; i < len(xs); i++` with no writes to `i`/`xs` in the body, and constant in-range indices into arrays.
  - Test: `strict-panics.test.js` — assert `__at` is absent from the generated JS for the elidable loops and present when the body reassigns `xs`.
  - Done when: `npm run bench` hybrid raycast is within 3% of v1.7.0. If not, extend the analysis; do not disable the checks.

- [ ] **Task 0.17 — `goto` diagnostic**
  - Files: `src/lexer.js` (keyword), `src/parser/statements.js`, `src/typechecker/statements.js`
  - Do: parse `goto L` and labels so the error is targeted: `goto is not supported; restructure with labeled break/continue`.
  - Test: `test/unit/language/control-flow.test.js` — the message appears for `js`, `wasm` and `both` packages; `Undefined: 'goto'` does not.
  - Done when: the parity matrix row for `goto` passes.

### Phase 1.1: Manifest generator and coverage gates

- [ ] **Task 1.1a — Manifest generator**
  - Files: new `scripts/stdlib-manifest.js`, `package.json` (`manifest:update` script)
  - Do: read `$(go env GOROOT)/api/go1.txt` … `go1.26.txt`, parse `pkg <path>, func|type|var|const|method` lines into `{pkg, name, kind, signature}`, and write `runtime/stdlib/manifest.json` with a `status` of `todo` for every member of every package named in the [Scope rule](#scope-rule) and the member tables. Packages absent from the scope rule get `excluded:<category>` from the table.
  - Test: new `test/unit/compiler/manifest.test.js` — the JSON parses, every entry has `pkg`, `name`, `kind`, `signature`, `status`; a sample of known members is present (`strconv.ParseInt` with `func(string, int, int) (int64, error)`).
  - Done when: the manifest is checked in and regenerating it is a no-op.

- [ ] **Task 1.1b — Fill statuses and exclusion reasons**
  - Files: `runtime/stdlib/manifest.json`, `scripts/stdlib-manifest.js` (status overrides file `scripts/manifest-overrides.json`)
  - Do: mark every member `js`, `wasm`, `both` or `excluded:<reason>` according to the scope rule and the member-level table. Unknown members default to `todo`, which the coverage test treats as a failure, so the audit is forced to finish.
  - Test: `manifest.test.js` — no `todo` entries remain for packages scheduled in Phases 2–5; every `excluded:` reason is one of the five categories.
  - Done when: `grep -c '"todo"'` on the manifest is 0 for scheduled packages.

- [ ] **Task 1.2a — Coverage gate by name**
  - Files: new `test/unit/types/stdlib-coverage.test.js`
  - Do: for each manifest entry with status `js`/`wasm`/`both`, assert the member exists in the checker namespace (and, for `wasm`/`both`, in `WASM_STDLIB_MEMBERS` or a Go-source package). For each `excluded:` entry, assert importing or referencing it yields the exclusion diagnostic. Replace the v1.6.1 JS-vs-WASM diff test.
  - Test: the gate itself; it must fail on the current tree with a list of missing members.
  - Done when: the failure list equals the union of the Verified-gaps tables (reconcile differences in Task 1.5).

- [ ] **Task 1.2b — Coverage gate by signature**
  - Files: `test/unit/types/stdlib-coverage.test.js`, `src/typechecker/stdlib/` (signature printer helper)
  - Do: print each checker signature in Go's `api` notation and compare with the manifest. Mismatches fail with both strings. Fix the mismatches found (start with `strconv.ParseInt` → `int64`).
  - Test: the gate itself; add a unit test for the signature printer on generics, variadics and methods.
  - Done when: zero signature mismatches for members marked `js`/`wasm`/`both`.

### Phase 1.2: Conformance harness, documentation and reconciliation

- [ ] **Task 1.3a — Conformance runner**
  - Files: new `test/conformance/run.js`, `test/conformance/README.md`, `package.json` (`conformance` script, included in `npm test`)
  - Do: for each `test/conformance/<pkg>/<name>.go`, compile as a `both` package, run `main` on JS and on WASM, and compare both outputs byte for byte with `<name>.out`. Missing `.out` is a failure with the `conformance:update` hint.
  - Test: one fixture per existing package (`strings`, `strconv`, `fmt`) with hand-verified `.out` files to bootstrap.
  - Done when: `npm run conformance` passes on the bootstrap fixtures on both backends.

- [ ] **Task 1.3b — `conformance:update` with real Go**
  - Files: `test/conformance/update.js`, `package.json`
  - Do: run each fixture with `go run` (go1.26) and write `.out`. Fail clearly when `go` is missing. Fixtures are plain Go programs, so they compile with both toolchains.
  - Test: regenerate the bootstrap fixtures; the files must be unchanged.
  - Done when: the README documents the workflow and CI does not need `go`.

- [ ] **Task 1.3c — Fixture lint for string semantics**
  - Files: `test/conformance/run.js`
  - Do: reject fixtures that apply `len(`, index `[`, or `range` to a string literal containing non-ASCII bytes, with the hint from [§1.1](#11-string-semantics-both-backends). `[]byte(...)` forms are allowed.
  - Test: a deliberately bad fixture in a temp dir is rejected.
  - Done when: the lint runs as part of `npm run conformance`.

- [ ] **Task 1.4 — Generated stdlib docs**
  - Files: new `scripts/docs-stdlib.js`, `docs/language-support.md`, `docs/hybrid-wasm.md`, `package.json` (`docs:stdlib`, added to `check`)
  - Do: generate the package tables between `<!-- stdlib:begin -->` / `<!-- stdlib:end -->` markers from the manifest. `npm run check` fails when the committed tables differ from the generated ones.
  - Test: `manifest.test.js` — the generator is idempotent.
  - Done when: both docs carry generated tables and `npm run check` enforces freshness.

- [ ] **Task 1.5 — Audit reconciliation**
  - Files: this document ([Verified gaps](#verified-gaps-2026-10-20-v170-tree) and the task lists)
  - Do: take the coverage-gate failure list; every member is either already in a Phase 2–5 task, added to Task 3.7, or marked `excluded:` with a reason in the manifest. Record the final counts (supported/excluded per package) here.
  - Test: `stdlib-coverage.test.js` has no unclassified failures.
  - Done when: the only remaining failures are members scheduled in later tasks, listed by task number in this document.

### Phase 2.1: `iter` package and slices iterator members

- [ ] **Task 2.1 — `iter` package**
  - Files: new `runtime/stdlib/iter/iter.go`, `src/typechecker/stdlib/` (diagnostic for `Pull`)
  - Do: `Seq[V]`, `Seq2[K, V]` as generic named func types (needs Task 0.3). `iter.Pull`/`Pull2` report `requires coroutines; out of scope (no runtime)`.
  - Test: new `test/unit/builtins/iter.test.js` — parity tests ranging over `iter.Seq[int]` returned from a user function; the `Pull` diagnostic.
  - Done when: both pass; `cmp` already landed in Task 0.6a.

- [ ] **Task 2.2a — `slices` iterator members: `All`, `Values`, `Backward`, `Collect`, `AppendSeq`**
  - Files: new `runtime/stdlib/slices/iter.go` (overlay)
  - Do: implement over `iter.Seq`/`Seq2` in Go source.
  - Test: `iter.test.js` parity tests; conformance fixture `test/conformance/slices/iter.go`.
  - Done when: fixture output matches Go on both backends.

- [ ] **Task 2.2b — `slices` iterator members: `Sorted`, `SortedFunc`, `SortedStableFunc`, `Chunk`**
  - Files: `runtime/stdlib/slices/iter.go`
  - Do: `Sorted*` collect then call the existing sort lowering; `Chunk` panics on `n < 1` with Go's message.
  - Test: `iter.test.js`; extend the `slices/iter.go` fixture.
  - Done when: fixture matches Go.

### Phase 2.2: `maps`, strings/bytes sequences and migration

- [ ] **Task 2.3 — `maps` iterator members and the breaking change**
  - Files: new `runtime/stdlib/maps/iter.go` (overlay), `src/typechecker/stdlib/core.js` (`maps.Keys`/`Values` removed from the emitter list), `src/typechecker/expressions.js` (hint diagnostic)
  - Do: `All`, `Keys`, `Values`, `Insert`, `Collect` over `iter.Seq`. `Keys`/`Values` now return `iter.Seq`; passing the result where a slice is expected reports the type error with the hint `use slices.Collect(maps.Keys(m)) for a slice`.
  - Test: `iter.test.js` — `for k := range maps.Keys(m)`; `sort.Strings(maps.Keys(m))` reports the hint; `slices.Sorted(maps.Keys(m))` on a WASM map with `NaN` keys keeps each entry.
  - Done when: all pass and `CHANGELOG.md` gets the breaking-change entry.

- [ ] **Task 2.4 — `strings`/`bytes` sequence members**
  - Files: new `runtime/stdlib/strings/iter.go`, `runtime/stdlib/bytes/iter.go` (overlays)
  - Do: `Lines`, `SplitSeq`, `SplitAfterSeq`, `FieldsSeq`, `FieldsFuncSeq`. `strings` versions work on `string` (splitting by substring is index-safe for ASCII separators; use `[]byte` internally per [§1.1](#11-string-semantics-both-backends)).
  - Test: conformance fixtures `strings/seq.go`, `bytes/seq.go`.
  - Done when: fixtures match Go.

- [ ] **Task 2.5 — Migrate in-repo uses of `maps.Keys`/`Values`**
  - Files: `example/`, `test/`, and a smoke build of `../simplefps`
  - Do: wrap with `slices.Collect` or range over the sequence directly.
  - Test: `npm test`, `npm run check`, `npm run test:e2e`.
  - Done when: nothing in the repo or `simplefps` hits the new diagnostic.

### Phase 3.1: `fmt` and `os.Stdout` completion

- [ ] **Task 3.1a — `fmt.Sprint`, `Sprintln`, `Append`, `Appendf`, `Appendln`**
  - Files: `src/typechecker/stdlib/core.js`, `src/backend/js/runtime.js`, `src/backend/wasm/emit-stdlib.js`
  - Do: `Sprint` inserts a space only between two non-string operands; `Sprintln` always. `Append*` write into a `[]byte`.
  - Test: conformance fixture `fmt/print.go`.
  - Done when: fixture matches Go on both backends.

- [ ] **Task 3.1b — `Stringer` and `error` dispatch for `%v`/`%s`**
  - Files: `src/backend/js/runtime.js` (`formatV`), `src/backend/wasm/emit-stdlib.js`, `src/typechecker/stdlib/core.js` (`fmt.Stringer`)
  - Do: a value whose type has `String() string` or `Error() string` prints through that method. Value-receiver methods apply to values and pointers; pointer-receiver methods only to pointers. Nested inside slices, maps and structs too.
  - Test: conformance fixture `fmt/stringer.go`.
  - Done when: fixture matches Go.

- [ ] **Task 3.1c — Verb completion: `%T`, `%U`, `%q` on runes, `%#v`, `%#x`, `%+d`, `% d`, `%[n]`, `%*d`, `%x` on byte slices**
  - Files: `src/typechecker/stdlib/core.js` (static type names per argument), `src/backend/js/runtime.js`, `src/backend/wasm/emit-stdlib.js`
  - Do: as specified in [§5](#5-member-completion). `%T` on interfaces uses the per-type name table shared with `%v`. `%p` prints `%!p(T)`.
  - Test: conformance fixture `fmt/verbs.go` (excluding `%p`); unit test for `%p` text.
  - Done when: fixture matches Go.

- [ ] **Task 3.1d — Exact 64-bit integer formatting in WASM and `MISSING`/`EXTRA` forms**
  - Files: `src/backend/wasm/emit-stdlib.js`
  - Do: `%d %x %o %b` take `i64` and use the `strconv` lowering, never `f64`. `%!d(MISSING)` and `%!(EXTRA int=1)` match Go.
  - Test: parity test `fmt.Sprintf("%d", uint64(1<<63+5))` in WASM equals `9223372036854775813`; conformance fixture `fmt/errors.go`.
  - Done when: both pass.

- [ ] **Task 3.1e — `os.Stdout`/`os.Stderr` as `io.Writer`, shared line buffer**
  - Files: `src/typechecker/stdlib/core.js` (`os.File` type), `src/backend/js/stdlib/os.js`, `src/backend/js/runtime.js`, `src/backend/wasm/emit-stdlib.js`, `src/backend/wasm/boundary.js` (console import)
  - Do: `*os.File` with `Write`, `WriteString`; `Stdout` and `Stderr` map to `console.log`/`console.error` through one line buffer shared with `fmt.Print*`. `Stdin.Read` returns `io.EOF`.
  - Test: `test/unit/builtins/stdlib.test.js` — `fmt.Fprintf(os.Stderr, "a"); fmt.Fprintln(os.Stderr, "b")` produces one `ab` line in both backends (use the harness `stdout` capture).
  - Done when: `os.Stdout` type-checks as `io.Writer` in `js`, `wasm` and `both` packages.

### Phase 3.2: `io`, `sort`, `unicode` and `strconv` completion

- [ ] **Task 3.1f — `fmt.Fscan`, `Fscanf`, `Fscanln`**
  - Files: `runtime/stdlib/fmt/scan.go` (overlay over `io.Reader` using `Sscan*`)
  - Do: read a line or token stream from an `io.Reader` and delegate to the existing `Sscan*` lowering.
  - Test: conformance fixture `fmt/fscan.go` over `strings.NewReader`.
  - Done when: fixture matches Go.

- [ ] **Task 3.2 — `sort` completion**
  - Files: new `runtime/stdlib/sort/sort.go` (overlay)
  - Do: `Interface`, `Sort` (port of Go's pdqsort so equal-element order matches Go), `Stable` (insertion-merge as Go), `Reverse`, `IsSorted`, `SearchInts`/`SearchStrings`/`SearchFloat64s`, `IntSlice`/`StringSlice`/`Float64Slice`. No delegation to JS `Array.prototype.sort`.
  - Test: conformance fixture `sort/sort.go` including an unstable-order case that only matches with pdqsort.
  - Done when: fixture matches Go.

- [ ] **Task 3.3a — `io` completion**
  - Files: new `runtime/stdlib/io/io.go` (overlay)
  - Do: `MultiReader`, `MultiWriter`, `TeeReader`, `NopCloser`, `ReadAtLeast`, `ReadFull`, `StringWriter`, `ByteReader`, `ByteWriter`, `RuneReader`, `ErrUnexpectedEOF`, `ErrShortWrite`, `SectionReader` if cheap.
  - Test: conformance fixture `io/io.go`.
  - Done when: fixture matches Go.

- [ ] **Task 3.3b — `unicode/utf8` byte API and `unicode` predicates**
  - Files: new `runtime/stdlib/unicode/utf8/bytes.go`, `runtime/stdlib/unicode/tables.go` (general categories only)
  - Do: `EncodeRune`, `AppendRune`, `DecodeRune`, `DecodeLastRune`, `RuneCount`, `FullRune`, `Valid`; `unicode.IsNumber`, `IsSymbol`, `IsMark`, `IsTitle`, `SimpleFold`, `Is`/`In` over the general-category tables listed in the scope rule.
  - Test: conformance fixtures `utf8/bytes.go`, `unicode/categories.go`.
  - Done when: fixtures match Go and the table file is under 40 KB of source.

- [ ] **Task 3.3c — `strconv.NumError`, `ErrRange`, `ErrSyntax`, quoting, and `errors.ErrUnsupported` usage**
  - Files: `src/backend/js/stdlib/strconv.js`, `src/backend/wasm/stdlib/core.js`, new `runtime/stdlib/strconv/quote.go`
  - Do: `Parse*` return `*NumError{Func, Num, Err}` wrapping `ErrRange`/`ErrSyntax` with Go's message; `QuoteRune`, `QuoteToASCII`, `QuoteRuneToASCII`, `AppendQuote*`, `UnquoteChar`, `IsPrint`, `CanBackquote`.
  - Test: conformance fixture `strconv/errors.go` with `errors.Is(err, strconv.ErrRange)` and `errors.As(err, &numErr)`.
  - Done when: fixture matches Go.

### Phase 3.3: `math`, `time` and strings/bytes buffer gaps

- [ ] **Task 3.4a — `math` and `math/bits` gaps**
  - Files: `src/typechecker/stdlib/core.js`, `src/backend/js/stdlib/math.js`, `src/backend/js/stdlib/bits.js`, `src/backend/wasm/emit-stdlib.js`
  - Do: `Log1p`, `Expm1`, `Frexp`, `Ldexp`, `Modf`, `FMA`, `RoundToEven`, `Nextafter`, `Nextafter32`, `Gamma`, `Erf`; `bits.Add32/64`, `Sub32/64`, `Mul32/64`, `Div32/64`, `Rem32/64`, `LeadingZeros`/`TrailingZeros`/`OnesCount`/`Len` for `uint`/8/16, `RotateLeft`/8/16, `Reverse8/16`, `ReverseBytes`. `bits.Mul64` must be exact in both backends (split 32-bit multiply in JS).
  - Test: conformance fixtures `math/extra.go`, `bits/wide.go`.
  - Done when: fixtures match Go.

- [ ] **Task 3.4b — `time` member completion**
  - Files: `src/typechecker/stdlib/core.js`, `src/backend/js/stdlib/time.js`, `src/backend/wasm/stdlib/time.js`
  - Do: `ParseDuration`, `Duration.Truncate`/`Round`/`Abs`, `Time.AddDate`, `Truncate`, `Round`, `Compare`, `YearDay`, `ISOWeek`, `MarshalJSON`/`UnmarshalJSON`/`MarshalText`/`UnmarshalText` on `Time` and `Duration` JSON as integer nanoseconds, `FixedZone`, `Month.String`/`Weekday.String`. `AfterFunc`/`Timer.Stop`/`Reset` as JS-only with the existing `time.Sleep` diagnostic in WASM. `After`, `Tick`, `NewTicker`, `NewTimer` report the channel exclusion.
  - Test: conformance fixture `time/members.go` (no wall clock; fixed dates); unit tests for the JS-only and excluded diagnostics.
  - Done when: fixture matches Go and the diagnostics are tested.

- [ ] **Task 3.4c — `strings.ToValidUTF8`, `bytes.NewBuffer`/`NewBufferString`, and `Buffer`/`Reader` method gaps**
  - Files: `src/typechecker/stdlib/core.js`, `src/backend/js/stdlib/bytes.js`, `src/backend/js/stdlib/strings.js`, `src/backend/wasm/stdlib/bytes.js`
  - Do: the named members plus whatever `bytes.Buffer`/`strings.Reader`/`bytes.Reader` methods the manifest lists as `todo` (`ReadRune`, `UnreadRune`, `ReadFrom`, `WriteTo`, `Seek`, `Next`, `Truncate`, `Grow`, `Cap`, `Available`).
  - Test: conformance fixtures `strings/members.go`, `bytes/buffer.go`.
  - Done when: fixtures match Go and no `todo` remains in `strings`/`bytes`.

### Phase 3.4: `sync`, `testing` and remaining audit items

- [ ] **Task 3.5 — `sync.Map`, `sync.Pool`, `OnceFunc`/`OnceValue`/`OnceValues`**
  - Files: new `runtime/stdlib/sync/extra.go` (overlay)
  - Do: single-threaded implementations. `Pool.Get` returns `New()` when empty and `nil` when `New` is nil. `Map.Range` stops on `false`. `sync.Cond` reports the blocking exclusion.
  - Test: conformance fixture `sync/extra.go`.
  - Done when: fixture matches Go.

- [ ] **Task 3.6 — `testing` additions**
  - Files: `src/typechecker/stdlib/core.js`, `src/backend/js/stdlib/testing.js`, `src/cli-core.js` (test runner), `src/backend/wasm/boundary.js` (`*testing.T` routing)
  - Do: `t.Cleanup` (LIFO, runs after `Fatal`), `t.Context()` (cancelled at test end; needs Task 4.3), `t.Setenv`, `t.Deadline`, `testing.B` with `N`, `ResetTimer`, `ReportAllocs`, `Loop`, run by `gofront test -bench`, `TestMain(m *testing.M)`. `t.Parallel` is a no-op; `TempDir`/`Chdir` report the host exclusion.
  - Test: `test/unit/compiler/test-runner.test.js` — Cleanup order, a benchmark that runs, `TestMain` that skips a test.
  - Done when: `gofront test` runs the new fixtures in `js` and `wasm` packages.

- [ ] **Task 3.7 — Remaining audit items**
  - Files: as the manifest dictates
  - Do: every member still `todo` in a package already supported, in manifest order, one package per change. Pure members go into overlays; emitter members only when an instruction or helper is cheaper.
  - Test: one conformance fixture per package touched.
  - Done when: `stdlib-coverage.test.js` reports no `todo` in Phase 3 packages.

### Phase 4.1: `bufio` and `net/url` (Go source)

- [ ] **Task 4.1a — `bufio.Reader`**
  - Files: new `runtime/stdlib/bufio/reader.go`
  - Do: the `Reader` members from [§6](#6-bufio-neturl-and-context-go-source) plus `ErrBufferFull`, `ErrNegativeCount`.
  - Test: conformance fixture `bufio/reader.go` (`ReadLine` with `isPrefix`, `Peek`, `UnreadRune`).
  - Done when: fixture matches Go.

- [ ] **Task 4.1b — `bufio.Writer` and `ReadWriter`**
  - Files: new `runtime/stdlib/bufio/writer.go`
  - Do: the `Writer` members; large writes pass through after flushing; `ReadWriter`, `NewReadWriter`.
  - Test: conformance fixture `bufio/writer.go` using a counting `io.Writer`.
  - Done when: fixture matches Go.

- [ ] **Task 4.1c — `bufio.Scanner` and split functions**
  - Files: new `runtime/stdlib/bufio/scan.go`
  - Do: `Scanner`, `SplitFunc`, `ScanLines`, `ScanWords`, `ScanRunes`, `ScanBytes`, `MaxScanTokenSize`, `ErrTooLong`, `ErrNegativeAdvance`, `ErrAdvanceTooFar`, `ErrFinalToken`.
  - Test: conformance fixture `bufio/scanner.go` (final token without newline, `ErrFinalToken`, `ErrTooLong`).
  - Done when: fixture matches Go.

- [ ] **Task 4.2a — `net/url` escaping and `Values`**
  - Files: new `runtime/stdlib/net/url/escape.go`, `values.go`
  - Do: `QueryEscape`, `QueryUnescape`, `PathEscape`, `PathUnescape`, `EscapeError`, `Values` (`Get`, `Set`, `Add`, `Del`, `Has`, `Encode` with sorted keys), `ParseQuery`. Work on `[]byte` so `"é"` escapes to `%C3%A9`.
  - Test: conformance fixture `url/escape.go` including non-ASCII input.
  - Done when: fixture matches Go.

- [ ] **Task 4.2b — `net/url` parsing, `URL` methods, errors**
  - Files: new `runtime/stdlib/net/url/url.go`
  - Do: `Parse`, `ParseRequestURI`, `URL` fields and methods from [§6](#6-bufio-neturl-and-context-go-source), `Userinfo`, `*Error`, `InvalidHostError`, `JoinPath`.
  - Test: conformance fixture `url/parse.go` (IPv6 host and port, `ResolveReference`, `Redacted`, malformed escapes returning `*url.Error`).
  - Done when: fixture matches Go.

### Phase 4.2: `context`, container and hash

- [ ] **Task 4.3a — `context` cancel tree and values**
  - Files: new `runtime/stdlib/context/context.go`, `src/typechecker/stdlib/` (`Done()` diagnostic)
  - Do: `Context` interface without `Done()`; `Background`, `TODO`, `WithCancel`, `WithCancelCause`, `WithValue`, `WithoutCancel`, `Cause`, `Canceled`, `CancelFunc`, `CancelCauseFunc`. `ctx.Done()` reports the channel diagnostic with the `ctx.Err()`/`context.AfterFunc` hint.
  - Test: conformance fixture `context/cancel.go`; unit test for the `Done()` diagnostic.
  - Done when: cancelling a parent cancels every descendant; `WithoutCancel` children are not cancelled.

- [ ] **Task 4.3b — `context` deadlines and `AfterFunc`**
  - Files: `runtime/stdlib/context/deadline.go` (uses the Task 0.6d intrinsic)
  - Do: `WithDeadline`, `WithDeadlineCause`, `WithTimeout`, `WithTimeoutCause`, `DeadlineExceeded`, `AfterFunc` (runs once; stop returns `false` once started). In WASM `Err()` compares the deadline with the clock import and cancels on first observation, firing `AfterFunc` callbacks.
  - Test: conformance fixture `context/deadline.go` with an injected clock; a WASM unit test that advances the fake clock import.
  - Done when: both pass and `example/preact` can cancel a `fetch` through `AbortController` (used in Task 7.1).

- [ ] **Task 4.4 — `container/heap`, `container/list`, `container/ring`**
  - Files: new `runtime/stdlib/container/{heap,list,ring}/*.go`
  - Do: full API of each.
  - Test: conformance fixtures `container/{heap,list,ring}.go`.
  - Done when: fixtures match Go.

- [ ] **Task 4.5 — `hash`, `hash/crc32`, `hash/fnv`, `hash/adler32`**
  - Files: new `runtime/stdlib/hash/**.go`
  - Do: `hash.Hash`/`Hash32`/`Hash64`; crc32 with `IEEE`, `Castagnoli`, `Koopman` tables built at init; fnv 32/32a/64/64a; adler32.
  - Test: conformance fixture `hash/sums.go` over ASCII and non-ASCII input (via `[]byte`).
  - Done when: fixture matches Go on both backends (strict `uint32` arithmetic makes JS bit-identical).

### Phase 4.3: `crypto`, base32 and `sync/atomic`

- [ ] **Task 4.6a — `crypto/md5`, `crypto/sha1`, `crypto/sha512`**
  - Files: new `runtime/stdlib/crypto/{md5,sha1,sha512}/*.go`
  - Do: `Sum*`, `New*`, `Size`, `BlockSize`, including `sha512/224`, `sha512/256`, `sha384`. sha512 needs `uint64` arithmetic: exact in WASM; in JS use `bits.Add64`/`Mul64`-style split limbs (document that it is slower in `js` packages).
  - Test: conformance fixture `crypto/digests.go` with the FIPS test vectors.
  - Done when: fixture matches Go.

- [ ] **Task 4.6b — `crypto/hmac`, `crypto/subtle`, and the security note**
  - Files: new `runtime/stdlib/crypto/{hmac,subtle}/*.go`, `docs/go-compatibility.md`
  - Do: `hmac.New`, `Equal`; `subtle.ConstantTimeCompare`, `ConstantTimeEq`, `ConstantTimeSelect`, `XORBytes`. Docs: not side-channel hardened; use Web Crypto in `js` packages for real cryptography.
  - Test: conformance fixture `crypto/hmac.go` (RFC 4231 vectors).
  - Done when: fixture matches Go and the doc row exists.

- [ ] **Task 4.7 — `encoding/base32`, `unicode/utf16`, `sync/atomic`**
  - Files: new `runtime/stdlib/encoding/base32/`, `runtime/stdlib/unicode/utf16/`, `runtime/stdlib/sync/atomic/`
  - Do: the member lists in [§7](#7-new-pure-packages-go-source). `atomic` is single-threaded; `Pointer[T]` and `Value` included.
  - Test: conformance fixtures `base32/codec.go`, `utf16/codec.go`, `atomic/ops.go`.
  - Done when: fixtures match Go.

### Phase 4.4: `math/cmplx`, `csv`, `log` and `math/rand/v2`

- [ ] **Task 4.8 — `math/cmplx` (after Task 0.4)**
  - Files: new `runtime/stdlib/math/cmplx/*.go`
  - Do: everything except functions needing `math/big`.
  - Test: conformance fixture `cmplx/funcs.go` with values printed via `%.6g` to avoid last-ulp differences.
  - Done when: fixture matches Go.

- [ ] **Task 4.9 — `encoding/csv` (after Task 4.1a)**
  - Files: new `runtime/stdlib/encoding/csv/{reader,writer}.go`
  - Do: as specified in [§8](#8-encodingcsv-go-source). Offsets count UTF-8 bytes.
  - Test: conformance fixtures `csv/reader.go`, `csv/writer.go` with the RFC 4180 cases and Go's `reader_test.go`/`writer_test.go` vectors.
  - Done when: fixtures match Go.

- [ ] **Task 4.10 — `log` (after Task 3.1e)**
  - Files: new `runtime/stdlib/log/log.go`
  - Do: the member list in [§7](#7-new-pure-packages-go-source). Default output `os.Stderr`; `Fatal*` calls `os.Exit(1)` in JS and panics in WASM; `Lshortfile`/`Llongfile` print `???:0`.
  - Test: conformance fixture `log/log.go` with `SetFlags(0)` and a `bytes.Buffer` output; unit test for `Fatal` on both backends.
  - Done when: fixture matches Go.

- [ ] **Task 4.11 — `math/rand/v2`**
  - Files: new `runtime/stdlib/math/rand/v2/*.go`
  - Do: `PCG` source (bit-exact with Go for a given seed), `Rand`, `New`, `N` (generic), `IntN`, `Int64N`, `Uint64N`, `Float64`, `Float32`, `Perm`, `Shuffle`, `NormFloat64`, `ExpFloat64`; top-level functions use the per-target random source. `ChaCha8` reports the deferred exclusion.
  - Test: conformance fixture `rand/pcg.go` with a fixed seed (PCG output must match Go exactly); unit test for `IntN(0)` panic message.
  - Done when: fixture matches Go.

### Phase 5.1: WASM JSON scanner, encoders, decoders and unmarshaling

- [ ] **Task 5.1a — WASM JSON scanner and per-type encoders**
  - Files: `src/backend/wasm/emit-stdlib.js` (or new `src/backend/wasm/stdlib/json.js`), `src/typechecker/resolve.js` (`resolveJsonFields` reused)
  - Do: one encoder per reachable type appending to `[]byte`, using `strconv.AppendFloat`/`AppendInt` and the UTF-8 helpers; sorted map keys; `Marshaler` through interface calls. No host JSON.
  - Test: new `test/unit/wasm/json.test.js` sharing cases with `test/unit/builtins/json.test.js` — `Marshal` of the existing JS corpus produces identical bytes in WASM.
  - Done when: encoding cases pass as parity tests.

- [ ] **Task 5.1b — WASM per-type decoders**
  - Files: as 5.1a
  - Do: one shared recursive-descent scanner over `[]byte`; one decoder per target type; case-insensitive matching; Go `null` semantics; integer range errors with Go's messages.
  - Test: `json.test.js` — `Unmarshal` corpus parity.
  - Done when: decoding cases pass as parity tests.

- [ ] **Task 5.2 — `Unmarshaler`, `RawMessage`, and `any` decoding in WASM**
  - Files: as 5.1a
  - Do: `Unmarshaler` dispatch; exact `RawMessage` bytes; `any` decodes to `map[string]any`, `[]any`, `float64`, `string`, `bool`, `nil`.
  - Test: `json.test.js` — the corresponding JS cases as parity tests.
  - Done when: all pass.

### Phase 5.2: JSON helpers, streaming I/O, enablement & benchmark

- [ ] **Task 5.3 — `Number`, `Compact`/`Indent`/`HTMLEscape`, error types (both backends)**
  - Files: `src/backend/js/stdlib/json.js`, `src/backend/js/runtime.js`, WASM json emitter, `src/typechecker/stdlib/core.js`
  - Do: as specified in [§9](#9-encodingjson-everywhere). Error types must work with `errors.As` and carry Go's `Offset`/field path.
  - Test: conformance fixture `json/errors.go` and `json/indent.go`.
  - Done when: fixtures match Go on both backends.

- [ ] **Task 5.4 — `Encoder`/`Decoder` over `io.Writer`/`io.Reader` (both backends)**
  - Files: new `runtime/stdlib/encoding/json/stream.go` (overlay, built on `bufio`)
  - Do: `NewEncoder`, `Encode`, `SetIndent`, `SetEscapeHTML`; `NewDecoder`, `Decode`, `More`, `UseNumber`, `DisallowUnknownFields`, `Buffered`, `InputOffset`. Multiple values in a stream, `io.EOF` at end, `io.ErrUnexpectedEOF` on truncation.
  - Test: conformance fixture `json/stream.go`.
  - Done when: fixture matches Go.

- [ ] **Task 5.5 — Enable JSON in WASM**
  - Files: `src/typechecker/types.js` (`WASM_STDLIB_MEMBERS` `["json", new Set()]` removed), `docs/go-compatibility.md`, `docs/hybrid-wasm.md`
  - Do: remove the rejection and its diagnostic; update the docs rows.
  - Test: the `json` diagnostic test is inverted; `npm test`.
  - Done when: `example/hybrid` can import `encoding/json` in its `wasm` package.

- [ ] **Task 5.6 — JSON benchmark**
  - Files: new `test/e2e/perf/json-bench.js`
  - Do: encode and decode a 1 MB corpus in WASM and in the JS backend; record the result in [Performance and size](#performance-and-size). Gate: WASM ≤ 2× JS. A miss is documented with a follow-up; the feature still ships.
  - Test: the benchmark runs under `npm run bench`.
  - Done when: numbers are recorded in this document.

### Phase 6.1: SIMD value type, opcodes, checker methods and Go overlay

- [ ] **Task 6.1** — Check the method names against go1.26 `simd/archsimd` and freeze the `gofront/simd` API surface in this document.
- [ ] **Task 6.2** — `F32x4` as a value type: boundary classification (removes the exported-API build blocker), `==`/`!=`, map keys, `fmt` on both backends (needs Task 3.1c for `%#v`), generic type arguments (array copies come from Task 0.8).
- [ ] **Task 6.3** — Encoder and WAT support for comparisons, `bitselect`, `any_true`/`all_true`, `bitmask`, and the `ceil`/`floor`/`trunc`/`nearest` opcodes. Include multi-byte LEB128 sub-opcode tests and Binaryen validation of optimized and unoptimized modules.
- [ ] **Task 6.4** — `Mask32x4` and the new `F32x4` methods (§10.2) in the checker, the WASM emitter and the JS fallback helpers.
- [ ] **Task 6.5** — Go-source overlay with `Vec3x4`, `AABB4`, `Ray4`, constructors, `SelectVec3x4` and `IntersectRayAABB4`.

### Phase 6.2: Memory helpers, boundary transport and benchmarks

- [ ] **Task 6.6** — Memory helpers: `LoadVec3x4`/`StoreVec3x4`, `LoadAoS4`/`StoreAoS4` (`i8x16.shuffle` transpose), `LoadF32x4Slice`/`StoreF32x4Slice`, `Pad4`.
- [ ] **Task 6.7** — Boundary transport for `F32x4`, `Mask32x4` and `[]F32x4` (§10.5). Update the marshalling table in `hybrid-wasm.md`.
- [ ] **Task 6.8** — Check allocations in release builds. If `heap2local` leaves allocations in the SoA hot loop, add scalar replacement for non-escaping `gofront/simd` structs.
- [ ] **Task 6.9** — Particle kinematics benchmark (65,536 particles) and the `IntersectRayAABB4` raycast variant in `test/e2e/perf/`. Adopt SoA SIMD in the `example/hybrid` particle simulation.
- [ ] **Task 6.10** — Apply the promotion rule (§10.6) and record the numbers and the decision in this document. Update `hybrid-wasm.md` and `go-compatibility.md` (stable or experimental, boundary rules, the zero-copy note).

Each Phase 6 task follows the same Files/Test/Done-when discipline: files are `src/typechecker/stdlib/simd.js`, `src/backend/wasm/stdlib/simd.js`, `src/backend/js/stdlib/simd.js`, `src/backend/wasm/encode.js`, `src/backend/wasm/wat.js`, `src/backend/wasm/boundary.js` and `runtime/stdlib/gofront/simd/`; tests go in `test/unit/wasm/simd.test.js`, `encode.test.js`, `wat.test.js` and `boundary.test.js`; every operation is checked against a scalar `[4]float32` reference on both backends.

### Phase 7.1: Example adoption and compatibility documentation

- [ ] **Task 7.1** — Adopt WASM JSON in `example/hybrid` (load a level or config inside the `wasm` package). Add a CSV example to `example/simple`, and a `context`-cancelled `fetch` to `example/preact`.
- [ ] **Task 7.2** — Update [`go-compatibility.md`](../go-compatibility.md): the scope rule, the excluded-package table, the string-semantics table from [§1.1](#11-string-semantics-both-backends), the `goto` and `//go:embed` rows, the strict-mode runtime-panic row, the `maps.Keys` change, `context` without `Done()`, `%p`, and the `crypto/*` caveat.
- [ ] **Task 7.3** — Regenerate the stdlib tables in `language-support.md` and `hybrid-wasm.md`. Update [`architecture.md`](../architecture.md) with `runtime/stdlib/`, `scripts/`, `test/conformance/` and the manifest.

### Phase 7.2: Baseline verification, release gates and changelog

- [ ] **Task 7.4** — Confirm the [`v2.0.0`](../v2.0.0/native-go-engine.md) baseline against what v1.8.0 actually shipped (including the SIMD promotion decision and the final manifest), and declare the JS-engine feature freeze.
- [ ] **Task 7.5** — Verification: `npm test`, `npm run check`, `npm run build`, `npm run test:e2e`, `npm run bench`, `npm run conformance`. Check for no regression in `app.wasm` size for apps that do not import new packages.
- [ ] **Task 7.6** — `CHANGELOG.md` (with a breaking-changes section: `maps.Keys`/`Values`, strict-mode runtime panics, typed-constant overflow errors) and [`roadmap.md`](../roadmap.md).

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
- **`test/unit/types/stdlib-coverage.test.js`:** the manifest coverage gate, by name and by signature.
- **`test/unit/compiler/manifest.test.js`:** manifest shape, no `todo` for scheduled packages, generator idempotence, docs generator idempotence.
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
- The WASM JSON benchmark (Task 5.6) is recorded in this document.
- `npm run bench` must show no regression in the hybrid raycast. Neither the array-copy fix (Task 0.8b) nor the strict-mode runtime checks (Task 0.16b) may slow the scalar raycast by more than 3% each; the analysis is extended until they do not, and the checks are never shipped disabled.
- `test/e2e/perf/zero-alloc.js` must pass after Tasks 0.5a, 0.5d and 0.7c.
- The SIMD particle and `IntersectRayAABB4` raycast results, with allocations per run, are recorded in §10.6 together with the promotion decision.
