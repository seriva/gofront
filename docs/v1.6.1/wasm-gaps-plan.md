# WASM Gap Closing — Design Plan

**Version:** v1.6.1
**Status:** Complete
**Depends on:** [`docs/v1.6.0/wasm-hybrid-plan.md`](../v1.6.0/wasm-hybrid-plan.md)
**Followed by:** [`docs/v2.0.0/native-go-engine.md`](../v2.0.0/native-go-engine.md), which then ports the v1.6.1 WASM backend instead of v1.6.0.

---

## Goal

Make the `wasm`/`both` subset cover **all of the GoFront language and stdlib that does not interact with browser or host APIs**. Browser-facing code (DOM, `.templ`, `gom`, `js:`/npm imports, `async`) stays in `js` packages by design; everything else should work on either side. The work stays in the hybrid model (`src/backend/wasm/`) and adds no new architecture. This covers four things:

- The two language features that still report `(planned)`.
- The boundary types that still report `(planned)`, including anonymous interfaces.
- The members missing from stdlib packages that are already partly supported.
- The pure stdlib packages not yet available in WASM: `unicode`, `math/rand`, `bytes`, `path`, `html`, `io` and the pure part of `time`.

**Done means:**
- None of the items in [Approach](#approach) reports a `(planned)` or `not yet available` diagnostic.
- The only stdlib still rejected in WASM is listed in [Out of Scope](#out-of-scope), each with a stated reason.
- Each new member produces the same output in a `both` package on the JS and WASM backends.
- JS output stays byte-identical to v1.6.0, and the existing WASM goldens change only where a test covers a new feature.
- [`hybrid-wasm.md`](../hybrid-wasm.md) and [`language-support.md`](../language-support.md) list the new subset.

---

## Out of Scope

- **Browser APIs.** DOM, browser globals, `.templ`, `gom`, `js:`/npm imports and `async`/`await` stay out of WASM packages. This is the hybrid split, not a gap; compiling a whole app to WASM is not a goal.
- **`time.Sleep`.** It is async in GoFront; WASM code is synchronous.
- **`os`** (`Exit`, `Args`, `Getenv`). Process/host state with no meaning inside an engine module; `os.Stdout` is therefore not available as an `io.Writer` in WASM either.
- **`regexp`.** The JS shim delegates to the JS `RegExp` engine. In WASM that means either a host call per match through an opaque handle, or writing an RE2 engine. Neither fits a patch release; it can return as its own feature if a profile asks for it.
- **JS types implementing `wasm` interfaces.** This stays a compile error, as designed in v1.6.0.
- **`gofront/shared` in `both` packages.** A `both` package has no linear memory on its JS side.
- **New codegen performance work and the v2.0.0 Go port.**

---

## Approach

The v1.6.0 mechanisms are reused everywhere:

- **Stdlib members** are added to `WASM_STDLIB_MEMBERS` / `WASM_STDLIB_PACKAGES` in [`types.js`](../../src/typechecker/types.js).
- **Their implementations** go in [`emit-stdlib.js`](../../src/backend/wasm/emit-stdlib.js). String-heavy functions call a JS import via `_callStdlib`; multi-result and slice-returning functions use the "park in JS, collect in WASM" path (`_emitCollectStringParts`).
- **Pure numeric and slice functions** are emitted inline as WASM, so they never cross the boundary.

### 1. Language features

| Item | Today | Plan |
|---|---|---|
| Non-literal package constants (`const X = f()` / constant expressions over other consts) | `constant 'X' has a non-literal value … (planned)` ([`emit-exprs.js`](../../src/backend/wasm/emit-exprs.js)) | Fold them with the checker's constant evaluator. A constant that only folds at runtime (typed string/float expressions the checker does not reduce) becomes an immutable global initialised in the `start` function, the same as non-literal package `var`s. |
| Array-typed map keys (`map[[3]int]T`) | `(planned)` ([`emit-maps.js`](../../src/backend/wasm/emit-maps.js)) | Hash and compare element-wise, using the existing struct-key path (field-wise hash and equality). |
| Interface-typed map keys (`map[any]T`, `map[Shape]T`) | `(planned)` | Hash on dynamic type id plus the value hash. Equality compares dynamic types first, then values (reusing `_emitAnyEq`). An unhashable dynamic type (slice, map, func) panics with Go's message `runtime error: hash of unhashable type …`. |

### 2. Boundary types

| Type | Plan |
|---|---|
| `error` | **WASM → JS:** a JS `Error` subclass carrying `.message` and the WASM handle, so `errors.Is`/`Unwrap` still work if it is passed back. A nil error is `null`. **JS → WASM:** only errors that came from WASM, consistent with the interface rule. |
| `map[K]V` (K = string, number or bool) | Copied both ways as a JS `Map` in insertion order, like slices. Map parameters are copy-in, matching the slice semantics already documented. |
| Pointers to non-structs (`*float64`, `*int`, …) | Copy-in/copy-out boxes `{ value }`, written back after the call (same rule as `*T` for `both` structs). |
| Anonymous structs | Copied as plain JS objects with the same field names. |
| Exported non-literal constants | Exposed on the facade as values read once after `start` runs. |
| Anonymous interfaces (`interface{ Len() int }`) | Treated like a named interface with a synthesized internal name: the facade is keyed on the method set, so two identical anonymous interfaces share one facade class. Same JS → WASM rule (only WASM-owned values). |
| `time.Time`, `time.Duration` | `Duration` is an `int64` and crosses as a `Number`. `Time` is copied into the JS backend's `time.Time` object via Unix milliseconds, the JS shim's precision. |
| `io.Reader` / `io.Writer` values | Same as any named interface: WASM-owned implementations cross as facades. |

### 3. Stdlib members

Members missing from packages that are already partly supported:

| Package | Members to add |
|---|---|
| `strings` | `Cut`, `CutPrefix`, `CutSuffix`, `SplitN`, `SplitAfter`, `SplitAfterN`, `LastIndexAny`, `Map`, `IndexFunc`, `LastIndexFunc`, `TrimFunc`, `TrimLeftFunc`, `TrimRightFunc`, `NewReplacer` (+ `Replace`), `Builder` (`WriteString`, `WriteByte`, `WriteRune`, `String`, `Len`, `Reset`, `Grow`) |
| `strconv` | `Unquote`, `AppendInt`, `AppendFloat` |
| `math` | `Remainder` |
| `slices` | `Compare`, `SortFunc`, `SortStableFunc`, `IsSorted`, `IsSortedFunc`, `Min`, `Max`, `MinFunc`, `MaxFunc`, `Compact`, `CompactFunc`, `Concat`, `Delete`, `DeleteFunc`, `Insert`, `Replace`, `Grow`, `Clip` |
| `fmt` | `%v`/`%+v` for slices, arrays, maps and structs (today callers must format field by field); `Fprintf`, `Fprintln`, `Fprint` over `io.Writer`; `Sscan`, `Sscanln`, `Sscanf` |
| `strings` / `bytes` readers | `strings.NewReader`, `bytes.NewReader` returning an `io.Reader` |

New packages (none of them touch browser APIs):

| Package | Scope |
|---|---|
| `unicode` | Full JS shim set (`IsLetter`, `IsDigit`, `IsSpace`, `IsUpper`, `IsLower`, `IsPunct`, `IsControl`, `IsPrint`, `IsGraphic`, `ToUpper`, `ToLower`). ASCII fast path inline; non-ASCII via JS import. |
| `math/rand` | Full JS shim set. Calls `Math.random` through an import, the same source as the JS backend; `Seed` stays a no-op. `Shuffle`/`Perm` inline. |
| `bytes` | Full JS shim set incl. `Buffer`, implemented over `[]byte` in WASM (with host JS helper delegation for string cutset trims/ContainsAny). |
| `io` | `Writer`, `Reader`, `ReadWriter`, `Closer` as ordinary WASM interfaces; `EOF` as a sentinel error value; `ReadAll`, `Discard`, `WriteString`. `strings.Builder` and `bytes.Buffer` implement `io.Writer`. |
| `path` / `path/filepath` | Full JS shim set (`Base`, `Dir`, `Ext`, `Join`, `Clean`, `IsAbs`, `Split`, `Match`) via host JS runtime shims in `boundary.js`. |
| `html` | `EscapeString`, `UnescapeString` via host JS runtime shims in `boundary.js`; no DOM access. |
| `time` | Everything except `Sleep`: `Duration` and its constants, `Time` and its methods (`Format`, `String`, `Year` … `Weekday`, `Unix`, `UnixMilli`, `Add`, `Sub`, `Before`, `After`, `Equal`), `Parse`, `Unix`, `Date`, layout/month/weekday constants. `Now`/`Since` read the clock through one import (`Date.now`), and the local timezone offset through another, the same sources the JS shim uses. |

Key decisions:
- **`*Func` callbacks are called inline.** `strings.Map`, `IndexFunc`, `slices.SortFunc` and similar call the closure directly with `call_ref`, so there is no boundary crossing. Sorting reuses the `_emitCallLess` insertion/merge sort from `sort.Slice`.
- **`strings.Builder` is a WASM struct.** It accumulates parts in a `[]string` and joins them on `String()`, which avoids one host call per write. The alternative of an externref to a JS builder was rejected: it would cross the boundary on every write inside hot loops.
- **`bytes` is implemented over `[]byte` in WASM** with `Buffer` and slice manipulation in bytecode, delegating to host JS shims for string cutset matching.
- **`io` and `Fprint*` are pure WASM.** `Fprintf(w, …)` formats with the existing `Sprintf` path and calls `w.Write` through normal interface dispatch, so user types can be writers.
- **`time.Time` is a WASM struct** (Unix nanos + offset), not a JS `Date` handle. Only `Now`, `Since` and the timezone offset are host imports; formatting and arithmetic run inline, so `time` is usable in hot paths.
- **`fmt.Sscan*` writes through pointers inside WASM.** No boundary is involved; only the boundary rejects pointer-to-scalar today, and that is handled in [Boundary types](#2-boundary-types).

---

## Edge Cases

- `const X = len("abc") * 2` must fold at compile time, not become a `start` global.
- An exported non-literal constant must be read only after `start` has run.
- A `map[any]T` whose key holds an unhashable type at runtime must panic with Go's message. `NaN` keys never match: each insert adds a new entry.
- With `map[[2]float64]T`, `-0` and `+0` must hash equal and `NaN` elements must never match.
- `strings.Map` must drop the rune when the mapping returns a negative value.
- `strings.SplitN` with `n == 0` must return `nil`, and with `n < 0` it must behave like `Split`.
- `strings.Cut` and `CutPrefix` return tuples, so they need the multi-result return path.
- `strconv.Unquote` must return Go's `ErrSyntax` error value, so that `errors.Is` works on the WASM side.
- `slices.Insert`/`Delete` with an index out of range must panic with Go's bounds message.
- `slices.Delete` must zero the tail elements (Go 1.22 semantics).
- `slices.Compact` must keep the first of each run, and `Clip` must set cap = len.
- `fmt` `%v` on a nested pointer-to-struct prints `&{…}` at top level and an address-like `0x…` placeholder nested. This must match the JS backend output for `both` parity.
- An `error` returned to JS and then passed back into WASM must keep its identity.
- A `map` returned to JS must be a fresh copy, so mutating it must not affect WASM state.
- A `*float64` boundary param written back after a panic: the write-back is skipped and the panic propagates.
- `strings.Builder` copied by value after its first write: Go panics on this; match it with a self-pointer check, as the JS backend does (or document the divergence if the JS backend doesn't check).
- Two structurally identical anonymous interfaces in different packages must map to the same facade class.
- `io.ReadAll` on a reader returning `(n > 0, io.EOF)` in the same call must keep the bytes. `io.EOF` must compare equal (`==` and `errors.Is`) whether created in WASM or seen from JS.
- `fmt.Sscanf` with fewer inputs than verbs returns the count scanned so far and Go's `unexpected EOF` error, matching the JS shim.
- `time.Format`/`Parse` must use the same timezone offset as the JS shim, including across a DST change between `Now()` and `Format()`.
- `time.Time` crossing the boundary loses sub-millisecond precision, which is the JS shim's precision anyway; `Equal` after a round-trip must still hold for times created in JS.
- `path.Clean("")` returns `"."`; `path.Match` with a malformed pattern returns `ErrBadPattern`.
- `html.UnescapeString` must handle numeric (`&#39;`, `&#x27;`) and named entities identically to the JS shim's table.

---

## Implementation Tasks

- [x] **Phase 1: Language features.** Non-literal constants (fold, or `start` global); array map keys; interface map keys with an unhashable panic. Remove the matching `(planned)` diagnostics.
- [x] **Phase 2: Boundary.** `error` and `map` facades; pointer-to-scalar boxes; anonymous structs; anonymous interfaces; exported non-literal constants. Update the marshalling table in `hybrid-wasm.md`.
- [x] **Phase 3: `strings` and `strconv`.** Missing members, `Builder`, `NewReplacer`; JS imports in the loader glue ([`glue.js`](../../src/backend/wasm/glue.js)).
- [x] **Phase 4: `slices` and `math.Remainder`.** Inline WASM implementations; `*Func` variants via `call_ref`.
- [x] **Phase 5: `fmt` composite `%v`.** Slices, arrays, maps and structs, with output matching the JS backend.
- [x] **Phase 6: Pure packages.** `unicode`, `math/rand`, `bytes` (incl. `Buffer`), `path`/`path/filepath`, `html`.
- [x] **Phase 7: `io` and readers/writers.** `io` interfaces and helpers, `fmt.Fprint*`, `fmt.Sscan*`, `strings.NewReader`, `bytes.NewReader`; `Builder`/`Buffer` as `io.Writer`.
- [x] **Phase 8: `time`.** `Duration`, `Time` struct and methods, `Parse`/`Format`, clock and timezone imports, boundary marshalling; `time.Sleep` keeps its targeted diagnostic.
- [x] **Phase 9: Docs and release.** Update `hybrid-wasm.md`, `language-support.md`, `go-compatibility.md`, the roadmap and the CHANGELOG. Re-run simplefps `npm run bench` to confirm there is no regression in `app.wasm` size or timings.

---

## Test Plan

- **Unit:** one test per new member in the existing suites under `test/unit/wasm/`:
  - [`stdlib.test.js`](../../test/unit/wasm/stdlib.test.js) for `slices`, `math`, `unicode`, `math/rand`, `bytes`, `io`, `path`, `html` and `time`.
  - [`strings_any.test.js`](../../test/unit/wasm/strings_any.test.js) for `strings`, `strconv`, `fmt` `%v`, `Fprint*` and `Sscan*`.
  - [`maps.test.js`](../../test/unit/wasm/maps.test.js) for the array and interface key cases.
  - [`boundary.test.js`](../../test/unit/wasm/boundary.test.js) for the new marshalled types.
  - [`go_semantics.test.js`](../../test/unit/wasm/go_semantics.test.js) for the non-literal constants.
- **Parity:** each case runs as a `both` package so that the JS and WASM outputs are compared. This is the main correctness gate. `time.Now`-dependent cases use a fixed injected clock in the test harness.
- **Coverage gate:** a unit test diffs `WASM_STDLIB_MEMBERS`/`WASM_STDLIB_PACKAGES` against the JS stdlib typings; the only differences allowed are the [Out of Scope](#out-of-scope) list.
- **Goldens:** [`golden.test.js`](../../test/unit/wasm/golden.test.js) must stay unchanged for the existing fixtures, and JS output must stay byte-identical to v1.6.0.
- **Integration / E2E:** `example/hybrid` E2E still passes. The simplefps hybrid build and `npm run bench` show no regression.
- **Negative cases:**
  - `os`, `regexp` and `time.Sleep` still report `not yet available in wasm packages` with a hint to keep the call in a JS package.
  - Browser-facing code (DOM, `.templ`, `gom`, `js:` imports, `async`) keeps its existing targeted diagnostics.
  - A JS caller passing a non-WASM `error` into WASM gets a clear runtime error.
  - Hashing an unhashable interface key panics with Go's message.

---

## Post-Audit Findings & Future Gaps (Fixes, Removals, and Additions)

A comprehensive review of the stdlib across both JS and WASM identified the following concrete fixes, removals, and additions for the next iteration:

### 1. Fixes (Bugs & Architectural Traps)
- [x] **`math` Constants Parity**: 24 constants (`MaxInt32`, `MinInt32`, `MaxInt64`, `MinInt64`, `MaxUint32`, `MaxFloat32`, `SmallestNonzeroFloat32`, `Phi`, `Sqrt2`, `SqrtE`, `SqrtPi`, `SqrtPhi`, `Ln2`, `Log2E`, `Ln10`, `Log10E`, etc.) are declared in `WASM_STDLIB_MEMBERS` and implemented in the WASM backend, but were omitted from `src/typechecker/stdlib/core.js` and `src/backend/js/expressions.js`. Compiling `math.MaxInt32` fails in both JS and WASM. Register them in the checker and JS backend.
- [x] **`math/rand` in WASM (Boundary Overhead & No-op Seed)**: In WASM, `rand.Float64()`, `rand.Intn()`, etc. currently call imported JS `Math.random()` on every invocation, crossing the boundary thousands of times in tight loops and ignoring `rand.Seed`. Replace with an inline pure PRNG (e.g. PCG or XorShift) in WASM with zero host overhead and deterministic seeding.
- [x] **`io.WriteString` on `strings.Builder` in WASM**: Currently converts the string to a `[]byte` slice and calls `w.Write`, allocating on every write instead of calling `WriteString` directly.
- [x] **`testing` Namespace in `WASM_STDLIB_MEMBERS`**: Add `testing` to `WASM_STDLIB_MEMBERS` in `src/typechecker/types.js` for consistency with `WASM_SUPPORTED_STDLIB`.

### 2. Removals
- [x] **`fmt.Scan`**: Declared in `src/typechecker/stdlib/core.js`, but unhandled in JS codegen (returns `undefined`) and missing in WASM. Frontend environments have no standard input (`os.Stdin`). Remove from the typechecker.
- [x] **Redundant Boundary Imports**: Avoid JS host imports for operations that can be emitted inline natively in WASM (e.g., ASCII checks, bit twiddling, pure PRNG).

### 3. Additions
#### A. Essential Methods on Existing Types
- [x] **`time.Duration` Methods**: Attach `.Seconds()`, `.Milliseconds()`, `.Microseconds()`, `.Nanoseconds()`, `.Minutes()`, `.Hours()`, and `.String()`.
- [x] **`time.Time` Methods**: Add `.IsZero()` (standard uninitialized check), `.UnixNano()`, `.Nanosecond()`, `.UTC()`, and `.Local()`.

#### B. High-Frequency Functions in Existing Packages
- [x] **`slices`**: `slices.IndexFunc`, `slices.ContainsFunc`, `slices.BinarySearch`, `slices.BinarySearchFunc`.
- [x] **`strconv`**: `strconv.ParseUint`, `strconv.FormatUint`, `strconv.AppendUint`, `strconv.AppendBool`.
- [x] **`io`**: `io.Copy(dst, src)`, `io.CopyN(dst, src, n)`, `io.LimitReader`.
- [x] **`math`**: Bit reinterpretations (`Float64bits`, `Float64frombits`, `Float32bits`, `Float32frombits` — 1-opcode instructions in WASM), and hyperbolic functions (`Sinh`, `Cosh`, `Tanh`).
- [x] **`math/bits`**: Endianness byte reversals (`ReverseBytes16`, `ReverseBytes32`, `ReverseBytes64`), `Len32`, `Len64`, `Reverse32`, `Reverse64`.
- [x] **`errors`**: `errors.As` (chain traversal with dynamic type matching) and `errors.Join`.
- [x] **`strings` & `bytes`**: `strings.FieldsFunc`, `bytes.FieldsFunc`, `bytes.Clone`.

#### C. High-Impact New Packages (Especially for WASM / Engine Workloads)
- [x] **`encoding/binary`** *(Top Priority for WASM)*: LittleEndian / BigEndian decoding and `binary.Read`/`Write`. Eliminates the need for hand-rolled JS `DataView` shims (e.g., in `simplefps/app/src/engine/assets/binaryreader.go`) and allows 3D mesh, model, audio, and network decoding to run at full speed inside WASM.
- [x] **`sync` Shim (`sync.Once`, `sync.Mutex`)**: Lightweight single-threaded shims (`sync.Once.Do` bool check, no-op mutexes) to allow standard Go packages with thread-safety constructs to compile unmodified.
- [x] **`crypto/rand` & `crypto/sha256`**: `rand.Read` via `crypto.getRandomValues()` and pure WASM SHA-256 for asset cache keys and packet integrity.
- [x] **`encoding/hex` & `encoding/base64`**: Pure data encoding utilities for web and binary payloads.

### 4. WASM Optimization Pipeline & Codegen Improvements
#### A. Optimizer Pipeline (`src/backend/wasm/optimize.js`)
- [x] **Eliminate Double-Pass GUFA on `--emit-wat`**: When `--emit-wat` is passed, `runWasmOpt` currently runs `wasm-opt -O3 --gufa` twice from scratch (once for binary, once for WAT text). Instead, disassemble the already-optimized binary output directly (`wasm-opt out.wasm -S -o out.wat` without optimization passes). Cuts build time in half when `--emit-wat` is requested.
- [x] **Whole-Program Optimization via `--closed-world`**: Enable Binaryen's `--closed-world` flag for WasmGC modules. Since GoFront modules are self-contained and types are not extended by host JS, this unlocks aggressive interface devirtualization, struct field pruning, and type refinement.
- [x] **Instruction Reordering via `--traps-never-happen`**: Since GoFront explicitly emits Go panics for bounds checks and divide-by-zero, inform Binaryen that hardware WASM traps will not occur, allowing it to aggressively hoist loads and reorder instructions without trap-preservation overhead.
- [x] **Pass Convergence in Release (`--converge`)**: Run Binaryen optimization passes until convergence in `--release` builds for maximum size reduction.

#### B. Code Generation Emitters (`src/backend/wasm/emit*.js`)
- [x] **Eliminate Duplicate Struct Allocations on Function Returns**: In `_emitCopyIfValueStruct` (`emit.js`), skip cloning when assigning the result of a `CallExpr`. Functions returning struct values already allocate on the WasmGC heap; cloning the returned value immediately duplicates the allocation and increases GC pressure. Halves heap allocations for value-struct returning calls (vectors, matrices, complex types).
- [x] **Zero & Overflow Guard Elimination for Constant Divisors**: In `emitDivRem` (`emit-exprs.js`), when the divisor is a constant literal (`N != 0 && N != -1`), eliminate the dynamic zero-check (`tmpB.eqz`) and `MinInt / -1` overflow guard. Saves ~15 instructions, 2 temporary locals, and 2 branches per constant division, helping keep hot functions within V8's 500-wire-byte inlining threshold. Specialize unsigned powers-of-two to shifts (`i32.shr_u`) or bitwise masks (`i32.and`).
- [x] **Compile-Time Bounds Check Elimination for Constant-Indexed Arrays**: In `_emitElemAddr` (`emit-exprs.js`), when indexing a fixed-size array `[N]T` with a constant index `0 <= i < N`, omit the bounds check and emit `array.get` directly. Eliminates branches in matrix, vector, and coordinate operations.
- [x] **Function-Body Constant Folding**: Hook `foldConstExpr` (`const-fold.js`) into `emitExpr` so constant operations inside function bodies (`24 * 60 * 60`, `1 << 8`, `10 + 20`) are evaluated at compile time rather than emitting runtime bytecode instructions.
- [x] **Direct `WriteString` on `strings.Builder` and `bytes.Buffer`**: In `_emitWriterWrite` (`io.js`), invoke `WriteString` directly rather than converting strings to `[]byte` slices on every write.
- [x] **Index-Only Slice Range Loops**: In `emitRangeForStmt` (`emit-stmts.js`), when looping with `for i := range slice` and the value element is omitted or `_`, only unpack `slice.len`, omitting the unpack of `arr` and `off`.
