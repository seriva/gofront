# WASM Gap Closing — Design Plan

**Version:** v1.6.1
**Status:** Draft
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
| `bytes` | Full JS shim set incl. `Buffer`, implemented over `[]byte` in WASM (no JS round-trip for byte slices). |
| `io` | `Writer`, `Reader`, `ReadWriter`, `Closer` as ordinary WASM interfaces; `EOF` as a sentinel error value; `ReadAll`, `Discard`, `WriteString`. `strings.Builder` and `bytes.Buffer` implement `io.Writer`. |
| `path` / `path/filepath` | Full JS shim set (`Base`, `Dir`, `Ext`, `Join`, `Clean`, `IsAbs`, `Split`, `Match`), inline WASM over strings. |
| `html` | `EscapeString`, `UnescapeString`. Pure string transforms; no DOM access. |
| `time` | Everything except `Sleep`: `Duration` and its constants, `Time` and its methods (`Format`, `String`, `Year` … `Weekday`, `Unix`, `UnixMilli`, `Add`, `Sub`, `Before`, `After`, `Equal`), `Parse`, `Unix`, `Date`, layout/month/weekday constants. `Now`/`Since` read the clock through one import (`Date.now`), and the local timezone offset through another, the same sources the JS shim uses. |

Key decisions:
- **`*Func` callbacks are called inline.** `strings.Map`, `IndexFunc`, `slices.SortFunc` and similar call the closure directly with `call_ref`, so there is no boundary crossing. Sorting reuses the `_emitCallLess` insertion/merge sort from `sort.Slice`.
- **`strings.Builder` is a WASM struct.** It accumulates parts in a `[]string` and joins them on `String()`, which avoids one host call per write. The alternative of an externref to a JS builder was rejected: it would cross the boundary on every write inside hot loops.
- **`bytes` is native WASM.** A JS round-trip would copy the whole `[]byte` on every call.
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

- [ ] **Phase 1: Language features.** Non-literal constants (fold, or `start` global); array map keys; interface map keys with an unhashable panic. Remove the matching `(planned)` diagnostics.
- [ ] **Phase 2: Boundary.** `error` and `map` facades; pointer-to-scalar boxes; anonymous structs; anonymous interfaces; exported non-literal constants. Update the marshalling table in `hybrid-wasm.md`.
- [ ] **Phase 3: `strings` and `strconv`.** Missing members, `Builder`, `NewReplacer`; JS imports in the loader glue ([`glue.js`](../../src/backend/wasm/glue.js)).
- [ ] **Phase 4: `slices` and `math.Remainder`.** Inline WASM implementations; `*Func` variants via `call_ref`.
- [ ] **Phase 5: `fmt` composite `%v`.** Slices, arrays, maps and structs, with output matching the JS backend.
- [ ] **Phase 6: Pure packages.** `unicode`, `math/rand`, `bytes` (incl. `Buffer`), `path`/`path/filepath`, `html`.
- [ ] **Phase 7: `io` and readers/writers.** `io` interfaces and helpers, `fmt.Fprint*`, `fmt.Sscan*`, `strings.NewReader`, `bytes.NewReader`; `Builder`/`Buffer` as `io.Writer`.
- [ ] **Phase 8: `time`.** `Duration`, `Time` struct and methods, `Parse`/`Format`, clock and timezone imports, boundary marshalling; `time.Sleep` keeps its targeted diagnostic.
- [ ] **Phase 9: Docs and release.** Update `hybrid-wasm.md`, `language-support.md`, `go-compatibility.md`, the roadmap and the CHANGELOG. Re-run simplefps `npm run bench` to confirm there is no regression in `app.wasm` size or timings.

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
