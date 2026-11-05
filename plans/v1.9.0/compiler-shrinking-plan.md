# Compiler Shrinking Pass — Design Plan

**Version:** v1.9.0  
**Status:** In Progress  
**Base branch:** `main`  
**Related:** [`stdlib-in-go-plan.md`](stdlib-in-go-plan.md), [`follow-ups-2026-11-03-plan.md`](follow-ups-2026-11-03-plan.md), [`../v2.0.0/native-go-engine.md`](../v2.0.0/native-go-engine.md)  
**Release note:** `strings.Builder` and `math` now compile from Go source in `stdlib/` with registered native fast paths, `encoding/json` shares one compile-time codec pipeline (`src/lower/json-codecs.js` + `stdlib/internal/jsonrt`) across JavaScript and WebAssembly at ~2× the throughput of the former JS-only emitter, and reflection-style `binary.Read`/`Write`/`Size` and `fmt.Sscan`/`Sscanf`/`Sscanln` are retired in favor of explicit `binary.ByteOrder` / `Append*` / `Put*` methods and `strconv` parsers.

---

## Goal

Finish shrinking the Node.js compiler (`src/`) before the self-hosted Go port (`plans/v2.0.0/native-go-engine.md`) by cutting another **~4,500 lines** of bespoke backend emitter, runtime helper, and type-table code out of `src/`. After [`stdlib-in-go-plan.md`](stdlib-in-go-plan.md) moved 19 standard library packages into `stdlib/`, five pockets of duplicate or low-value compiler machinery remained in `src/`:

1. **15 dead methods (~285 lines)** across `src/backend/wasm/`, `src/backend/js/`, and `src/lower/ownership.js` left behind by earlier stdlib and ownership refactors.
2. **Unused reflection-style `binary.{Read,Write,Size}` and `fmt.Sscan*` (~1,150 lines)** across WASM/JS emitters and runtime helpers — unused by `simplefps`, `website`, and `example/`, and responsible for recurring struct-alignment, 64-bit BigInt, and format-scanner bugs.
3. **`strings.Builder` (~850 lines)** still split across a 472-line WasmGC byte-chunk emitter in `src/backend/wasm/stdlib/core.js`, 155 lines of `io.Writer` special cases in `src/backend/wasm/stdlib/io.js`, synthetic method synthesis in `src/backend/wasm/index.js`, and `__builder_proto` in `src/backend/js/`.
4. **`math` (~550 lines)** still split between `stdlib/math/extra.go` (7 functions) and hand-written constant/function tables in `src/typechecker/stdlib/core.js`, `src/backend/js/stdlib/math.js`, `src/backend/wasm/stdlib/core.js`, and `src/backend/wasm/prescan.js`.
5. **Duplicate JS `encoding/json` (~1,800 lines)** in `src/backend/js/stdlib/json.js` (1,166 lines) and `HELPER_JSON` in `src/backend/js/runtime.js` (730 lines), duplicating the AST-level codec generator (`src/lower/json-codecs.js` + `stdlib/internal/jsonrt/`) already used by `wasm` and `both` packages.

**Done means:**
- Net line count in `src/` decreases by **≥ 4,200 lines** (from 61,515 lines baseline to ≤ 57,300 lines), and `src/backend/wasm/stdlib/packages.js`, `src/backend/js/stdlib/binary.js`, `src/backend/js/stdlib/builder.js`, `src/backend/js/stdlib/math.js`, and `src/backend/js/stdlib/json.js` are deleted.
- `strings.Builder` and `math` live in `stdlib/strings/builder.go` and `stdlib/math/math.go` (`//gofront:target both`), removing `"strings"`, `"math"`, and `"encoding/binary"` from `STDLIB_PACKAGES` overlay registries (`src/typechecker/types.js`) and passing four-way differential checks (`JS`/`WASM` × natives on/off) in `test/unit/compiler/natives.test.js`, `test/unit/stdlib/strings-bytes.test.js`, and `test/unit/stdlib/math-bits-rand.test.js`.
- `encoding/json` on `js`, `wasm`, and `both` targets compiles through the single `checkJsonCodecs` + `src/lower/json-codecs.js` + `stdlib/internal/jsonrt` pipeline, passes `test/unit/builtins/json.test.js` and `test/unit/wasm/json.test.js`, and passes `node test/perf/json-bench.js` with `WASM <= 2.00x JS` and total JS encode+decode ≤ 150 ms on the 18,000-item (1.04 MB) corpus.
- `binary.Read`, `binary.Write`, `binary.Size`, `fmt.Sscan`, `fmt.Sscanln`, and `fmt.Sscanf` produce clear `EXCLUDED_STDLIB_MEMBERS` compile-time diagnostics in `test/unit/stdlib/excluded-stdlib.test.js`.
- All quality gates pass: `npm test`, `npm run check`, and `npm run test:e2e`.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Deleted or unified in `src/`, or moved to `stdlib/` (`//gofront:target both`) with `//gofront:native` / `//gofront:intrinsic` hooks where required | 15 dead methods in `src/`; `stdlib/strings/builder.go`; `stdlib/math/math.go` (32 constants + 47 functions); `encoding/json` unified onto `src/lower/json-codecs.js` + `stdlib/internal/jsonrt/` across `js`, `wasm`, and `both` | |
| **In scope: target-specific** | Per-target `//gofront:native` and `//gofront:intrinsic` fast paths registered in `src/backend/js/natives.js` and `src/backend/wasm/natives.js` | IEEE-754 bitcasts (`Float64bits`, `Float64frombits`, `Float32bits`, `Float32frombits`), single-opcode WASM math (`f64.abs`, `f64.sqrt`, `f64.floor`, `f64.ceil`, `f64.trunc`, `f64.min`, `f64.max`, `f64.copysign`), host `Math.*` transcendentals, and JS `internal/jsonrt` string/number fast paths | |
| **Excluded: runtime / platform** | Reflection-driven binary struct serialization and format-string input scanning removed and added to `EXCLUDED_STDLIB_MEMBERS` | `binary.Read`, `binary.Write`, `binary.Size`, `fmt.Sscan`, `fmt.Sscanln`, `fmt.Sscanf` | Go's `binary.Read`/`Write`/`Size` and `fmt.Sscan*` rely on runtime type reflection (`reflect.Value`) over arbitrary structs/interfaces; in GoFront they required ~1,150 lines of brittle per-type emitter code with zero usage in `simplefps`, `website`, or `example/`. Explicit `binary.LittleEndian`/`BigEndian` (`Uint*`, `PutUint*`, `AppendUint*`) and `strconv.Parse*` remain fully supported. |
| **Excluded: deferred** | Moving `fmt.Sprint*` / `fmt.Printf` format string dispatch or `sync.WaitGroup`/`Mutex`/`Once` out of backend emitters | `src/backend/wasm/stdlib/fmt.js`, `src/backend/js/stdlib/fmt.js` (`Sprintf`/`Printf`), `sync.Mutex`/`WaitGroup`/`Once` | `fmt` verb dispatch depends on compile-time variadic type specialization (`any` without runtime type descriptors), and `sync` primitives are already minimal no-op/single-threaded structs (~60 lines total). |

---

## Verified Gaps & Baseline Audit

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| **Dead methods in `src/`** | AST + regex symbol audit across `src/`, `test/`, and `scripts/` (checking direct calls, property reads, and `this[handler]` dynamic dispatch tables) found **15 unreferenced methods totaling 285 lines**, with 0 cascading dead methods after removal. | `src/backend/wasm/stdlib/core.js:1810-1903` (`emitSlicesClone`, 94L); `src/backend/wasm/stdlib/io.js:113-213` (`_emitAppendSliceBytes` 87L, `_emitNewError` 13L); `src/backend/wasm/emit-maps.js:424-460` (`emitElemLt`, 37L); `src/backend/js/expressions.js:892-894,2082-2094,3255-3257` (`_nodeWritesVar` 3L, `_genStructFields` 13L, `_is64BitSigned` 3L); `src/backend/js/index.js:625-628,953-964,1237-1239` (`getSourceMap` 4L, `_genSingleEmbedStubs` 12L, `_isReferenceType` 3L); `src/backend/js/statements.js:1382-1384` (`_nodeAssigns`, 3L); `src/backend/wasm/emit.js:1619-1621` (`allocTemp`, 3L); `src/backend/wasm/module-emitter.js:787-789,1589-1591` (`getMapTypeByIndex` 3L, `getTimezoneOffsetImportIndex` 3L); `src/lower/ownership.js:167-170` (`markOwnership`, 4L). |
| **`binary.{Read,Write,Size}`** | Only `Read`, `Write`, and `Size` remain in the compiler overlay for `encoding/binary`; all `ByteOrder` structs (`LittleEndian`, `BigEndian`) and varint helpers already live in `stdlib/encoding/binary/binary.go` (378 lines). Yet `Read`/`Write`/`Size` pull in **784 lines** of emitter/runtime code and have open 64-bit BigInt / named-struct bugs (S23, S26 in `follow-ups-2026-11-03-plan.md`). Zero occurrences exist in `simplefps`, `website`, or `example/`. | `src/backend/wasm/stdlib/packages.js:1-591` (591L — entire file is only `emitBinaryCall`); `src/backend/js/stdlib/binary.js:1-83` (83L); `src/backend/js/runtime.js:1345-1454` (`HELPER_BINARY`, 110L); `src/typechecker/stdlib/extended.js:612-629`. |
| **`fmt.Sscan*`** | `fmt.Fscan`, `fmt.Fscanln`, `fmt.Fscanf`, `fmt.Scan`, `fmt.Scanln`, and `fmt.Scanf` are already in `EXCLUDED_STDLIB_MEMBERS.fmt` (`src/typechecker/stdlib/excluded.js:193`), but `Sscan`, `Sscanln`, and `Sscanf` were left behind as **675 lines** of host-import and regex scanner emitters with open `%x`/`%v`/newline bugs (L83–L85 in `follow-ups-2026-11-03-plan.md`). Zero occurrences exist in `simplefps`, `website`, or `example/`. | `src/backend/wasm/stdlib/io.js:290-675` (`emitSscanCall` + helpers, 386L); `src/backend/wasm/boundary.js:2118-2195` (`fmt_sscan_*` host imports, 78L); `src/backend/wasm/module-emitter.js:62-69` (`STDLIB_IMPORTS`); `src/backend/js/stdlib/fmt.js:387-420` (34L); `src/backend/js/runtime.js:1032-1208` (`HELPER_SSCAN`, 177L). |
| **`strings.Builder`** | `strings` is already in `stdlib/strings/` (693 lines), except `strings.Builder` which is still hardcoded across **~850 lines** of WASM/JS compiler code: a special 3-field WasmGC struct (`chunks`, `len`, `addr`), synthetic `io.Writer` methods in `src/backend/wasm/index.js:1156-1190`, and `__builder_proto` in `src/backend/js/`. Because `strings.Builder` is an overlay type rather than a Go struct in `stdlib/strings/`, embedding or exporting a struct with a `strings.Builder` field across the WASM boundary fails (`follow-ups-2026-11-03-plan.md` L16). | `src/backend/wasm/stdlib/core.js:2034-2506` (472L); `src/backend/wasm/stdlib/io.js:12-111,215-289,677-860` (155L); `src/backend/wasm/index.js:1156-1190` (35L); `src/backend/wasm/types.js:58-67,491-493`; `src/backend/js/stdlib/builder.js:1-36` (36L); `src/backend/js/runtime.js:217-234` (`__builder_proto`, 18L); `src/typechecker/stdlib/core.js:317-335`. |
| **`math` split between `stdlib/` and `src/`** | `stdlib/math/extra.go` (270 lines) implements 7 functions (`Frexp`, `Ldexp`, `Modf`, `RoundToEven`, `Nextafter`, `Nextafter32`, `FMA`), while 32 constants and 40 functions are still hardcoded in **~550 lines** of typechecker tables, JS shims, and WASM emitters/host imports. | `src/typechecker/stdlib/core.js:230-315` (86L); `src/backend/js/stdlib/math.js:1-130` (130L); `src/backend/wasm/stdlib/core.js:12-55,1514-1808` (`MATH_CONSTS`, `emitMathConst`, `emitMathCall`, 340L); `src/backend/wasm/prescan.js:252-279` (28L); `src/backend/wasm/module-emitter.js:27-35` (`STDLIB_IMPORTS.math`). |
| **JS `encoding/json` duplication & `jsonrt` JS performance probe** | `wasm` and `both` packages use `src/lower/json-codecs.js` (1,073L) + `stdlib/internal/jsonrt/` (949L), while `js` packages use a separate 1,896-line compiler+runtime stack (`src/backend/js/stdlib/json.js` 1,166L + `HELPER_JSON` in `src/backend/js/runtime.js` 730L). Running an empirical probe compiling `test/perf/json-bench.js` (18,000 items, 1.04 MB JSON) through `json-codecs.js` + `stdlib/internal/jsonrt` to JS initially hung (>8 min) due to **four JS codegen/runtime bottlenecks**: (1) `HELPER_APPEND` on `Uint8Array` had no `__tcap` amortization when initial capacity was 0 (`e.B = append(e.B, c)` copied up to 1 MB on every byte = $O(N^2)$); (2) `HELPER_APPEND` on plain JS `Array` (`s = append(s, elem)` in `decElems`) spread-copied `[...a, ...b]` on every element ($O(N^2)$); (3) `__reslice` on plain JS `Array` in `Dec.Leave` (`d.fields = d.fields[:n]`) and `scanner.popParseState` allocated two `.slice()` arrays + `Object.defineProperty(__rcap)` 72,000 times per decode; (4) `Dec.readString`/`readNumber` allocated `new TextDecoder()` + `new Uint8Array` 108,000 times per decode. Fixing those four bottlenecks reduced JS 18k-item encode from `27.2 ms` → **`13.9 ms`** (2.0× faster) and decode from `120.9 ms` → **`63.4 ms`** (1.9× faster), total **`77.3 ms`** vs `148.2 ms` baseline (`WASM/JS = 1.60x`, well within the `<= 2.00x` gate). | Baseline `node test/perf/json-bench.js`: JS `27.2ms` enc / `120.9ms` dec (`148.2ms` total), WASM `54.5ms` enc / `69.2ms` dec (`123.7ms` total). Probe findings in `src/backend/js/runtime.js:68-137` (`HELPER_APPEND`, `HELPER_SLICE`), `stdlib/internal/jsonrt/decode.go:33-53,234-345`, `stdlib/internal/jsonrt/scanner.go:150-171`, `stdlib/internal/jsonrt/encode.go:40-185`. |

---

## Approach

### 1. Architecture & Design Decisions

#### A. Dead Method Sweep & Pruning `binary.{Read,Write,Size}` and `fmt.Sscan*`
- **Dead method sweep (285 lines):** Delete the 15 unreferenced methods identified in the baseline audit across `src/backend/wasm/`, `src/backend/js/`, and `src/lower/ownership.js` (plus the unused `this.owned` and `this.borrowed` sets in `OwnershipContext`).
- **Retire `binary.Read`, `binary.Write`, and `binary.Size` (784 lines):**
  - Delete `src/backend/wasm/stdlib/packages.js` (591 lines) and remove `ExtendedPackagesEmitter` from `src/backend/wasm/stdlib/index.js` and `emitBinaryCall` from `src/backend/wasm/emit-builtins.js`.
  - Delete `src/backend/js/stdlib/binary.js` (83 lines), remove `binaryMethods` / `_genBinary` from `src/backend/js/stdlib/index.js`, and delete `HELPER_BINARY` from `src/backend/js/runtime.js` and `src/backend/js/index.js`.
  - Remove `binary` from `src/typechecker/stdlib/extended.js`, `WASM_STDLIB_MEMBERS` in `src/typechecker/types.js`, and `STDLIB_PACKAGES` in `src/typechecker/types.js` so `encoding/binary` is resolved purely from `stdlib/encoding/binary/binary.go` with zero compiler overlay.
  - Register `binary: ["Read", "Write", "Size"]` in `EXCLUDED_STDLIB_MEMBERS` (`src/typechecker/stdlib/excluded.js`) with a clear diagnostic pointing to `binary.LittleEndian` / `binary.BigEndian` methods.
- **Retire `fmt.Sscan`, `fmt.Sscanln`, and `fmt.Sscanf` (675 lines):**
  - Delete `emitSscanCall` and its helpers in `src/backend/wasm/stdlib/io.js:290-675`, `fmt_sscan_*` imports in `src/backend/wasm/module-emitter.js` and `src/backend/wasm/boundary.js:2118-2195`, `Sscan*` cases in `src/backend/js/stdlib/fmt.js:387-420`, and `HELPER_SSCAN` in `src/backend/js/runtime.js:1032-1208`.
  - Remove `Sscan`, `Sscanln`, and `Sscanf` from `src/typechecker/stdlib/core.js` and `WASM_STDLIB_MEMBERS`, and append them to `EXCLUDED_STDLIB_MEMBERS.fmt` in `src/typechecker/stdlib/excluded.js`.

#### B. `strings.Builder` in `stdlib/strings/builder.go` (~850 lines removed)
- Implement `Builder` directly in `stdlib/strings/builder.go` (`//gofront:target both`):
  ```go
  type Builder struct {
      addr *Builder
      buf  []byte
  }
  ```
- **Copy-by-value detection without `unsafe`:** In GoFront, pointer equality (`b.addr != b`) compares struct references (`ref.eq` in WasmGC, `===` in JS). On first mutation (`Write`, `WriteByte`, `WriteRune`, `WriteString`, `Grow`), `b.copyCheck()` sets `b.addr = b` if `b.addr == nil`, or panics with `"strings: illegal use of non-zero Builder copied by value"` if `b.addr != b`. When a non-zero `Builder` is copied by value (`b2 := b1`), GoFront clones the struct fields (`__clone()` in JS, struct field copy in WASM), so `b2.addr` still points to `b1` and `b2.copyCheck()` panics identically to Go's `strings.Builder`.
- **Amortized `[]byte` growth in JS `HELPER_APPEND`:** Update `HELPER_APPEND` in `src/backend/js/runtime.js` so appending to a `Uint8Array` (or any TypedArray) without an existing `__tcap` allocates an amortized backing buffer (`Math.max(total, a.length * 2, 64)`) and sets `__tcap = buf.buffer`, matching WASM's slice capacity doubling. This makes `Builder.Write*` and `jsonrt.Enc` $O(1)$ amortized per byte on both backends without bespoke chunk arrays.
- **Delete compiler special cases:** Remove `strings.Builder` from `src/backend/wasm/stdlib/core.js` (472 lines), `src/backend/wasm/stdlib/io.js` (155 lines), `src/backend/wasm/index.js` (synthetic `Write`/`WriteString` method synthesis), `src/backend/wasm/types.js`, `src/backend/wasm/module-emitter.js` (`SYNTHETIC_METHOD_TYPES`), `src/backend/js/stdlib/builder.js`, `src/backend/js/runtime.js` (`__builder_proto`), and `src/typechecker/stdlib/{core,extended}.js`. Remove `"strings"` from `STDLIB_PACKAGES` and `WASM_STDLIB_MEMBERS` so `strings` has zero compiler overlay.

#### C. `math` in `stdlib/math/math.go` (~550 lines removed)
- Consolidate all 32 `math` constants and all 47 `math` functions into `stdlib/math/math.go` + `stdlib/math/extra.go` (`//gofront:target both`).
- **Intrinsic & Native layering for `--no-natives` (`assertFourWay`) parity:**
  - Declare `Float64bits`, `Float64frombits`, `Float32bits`, and `Float32frombits` (plus an internal `hostMath1(op int, x float64) float64` / `hostMath2(op int, x, y float64) float64` or per-function `//gofront:intrinsic` for host `Math.*` transcendentals) as `//gofront:intrinsic`, just like `time_now` and `rand_source`. Intrinsics are fundamental host/CPU primitives that remain active in both default and `--no-natives` modes.
  - Implement `IsNaN`, `IsInf`, `Inf`, `NaN`, `Signbit`, `Copysign`, `Abs`, `Min`, `Max`, `Dim`, `Floor`, `Ceil`, `Trunc`, `Round`, and `Remainder` in pure Go in `stdlib/math/math.go` using IEEE-754 bit operations (`Float64bits` / `Float64frombits`), and mark `Abs`, `Floor`, `Ceil`, `Trunc`, `Round`, `Sqrt`, `Min`, `Max`, `Copysign`, `IsNaN`, `IsInf`, `Inf`, `NaN`, and `Signbit` with `//gofront:native` so default builds emit single WASM instructions (`f64.abs`, `f64.floor`, `f64.ceil`, `f64.trunc`, `f64.nearest`, `f64.sqrt`, `f64.min`, `f64.max`, `f64.copysign`, `f64.ne`) and inline JS `Math.*` expressions, while `assertFourWay` (`--no-natives`) exercises and verifies the pure-Go IEEE-754 bodies!
- **Delete legacy `math` compiler files:** Delete `src/backend/js/stdlib/math.js` (130 lines), `MATH_CONSTS` / `emitMathConst` / `emitMathCall` in `src/backend/wasm/stdlib/core.js` (340 lines), `math` in `src/typechecker/stdlib/core.js` (86 lines), and `math` import prescan in `src/backend/wasm/prescan.js` (28 lines). Remove `"math"` from `STDLIB_PACKAGES` and `WASM_STDLIB_MEMBERS`.

#### D. Unify JS `encoding/json` onto `src/lower/json-codecs.js` + `stdlib/internal/jsonrt/` (~1,800 lines removed)
- **Single compilation pipeline for all targets:**
  - In `src/link/stdlib.js`, run `checkJsonCodecs` for **all** packages that import `encoding/json` (`js`, `both`, and `wasm`), instead of skipping `target === "js"`.
  - In `src/compiler.js` / `src/lower/stdlib-refs.js`, lower `json.Marshal`, `json.MarshalIndent`, `json.Unmarshal`, `json.Valid`, `json.Compact`, `json.Indent`, `json.HTMLEscape`, and `json.NewEncoder`/`NewDecoder` streams onto `_jsonGen` and `internal/jsonrt` across all targets.
- **Solve the 4 JS performance bottlenecks in `src/backend/js/runtime.js`, `src/lower/json-codecs.js`, and `stdlib/internal/jsonrt/`:**
  1. **TypedArray & Array amortized `__append` (`src/backend/js/runtime.js`):** In `HELPER_APPEND`, amortize `Uint8Array` growth via `__tcap` even when starting from an empty/unallocated slice, and for plain JS `Array`s without `__rcap` (or when `a.length === a.__rcap.length`), grow in place or via amortized `__rcap` instead of `O(N)` `[...a, ...b]` spread-copying on every element.
  2. **Zero-allocation stack management in `Dec` and `scanner` (`stdlib/internal/jsonrt/decode.go`, `stdlib/internal/jsonrt/scanner.go`):** Replace `d.fields = d.fields[:n]` and `s.parseState = s.parseState[:n]` reslicing on every token/object with an explicit integer stack depth (`d.fieldsLen`, `s.parseStateLen`) so `Enter`/`Leave` and `pushParseState`/`popParseState` mutate elements in place without calling `__reslice` (eliminating 72,000 `.slice()` + `Object.defineProperty` calls per 18k-item decode).
  3. **Registered JS `//gofront:native` fast paths for `internal/jsonrt` (`src/backend/js/natives.js`):** Register thin JS natives for `Enc` (`WriteString`, `WriteFloat`, `WriteInt`, `WriteUint`) and `Dec` (`ReadString`, `ReadInt`, `ReadUint`, `ReadFloat`) that use a shared module-level `TextEncoder`/`TextDecoder` and JS number parsing/formatting when `natives: true`, while keeping the pure-Go Dragonbox/UTF-8 bodies in `stdlib/internal/jsonrt/` for WASM and `--no-natives`.
- **Delete JS-only JSON compiler & runtime (~1,896 lines):**
  - Delete `src/backend/js/stdlib/json.js` (1,166 lines).
  - Delete `HELPER_JSON` in `src/backend/js/runtime.js` (~730 lines) and remove `["json", HELPER_JSON]` from `src/backend/js/index.js` and `_genJsonStreamCall` from `src/backend/js/expressions.js`.

---

### 2. Invariants & Safety Bounds

- **Compiler Line Budget Invariant:**
  | Subsystem | Files Deleted / Trimmed in `src/` | Lines Removed from `src/` | Lines Added (`src/` + `stdlib/`) | Net `src/` Change |
  |---|---|---|---|---|
  | 1. Dead methods in `src/` | 9 files in `src/backend/{js,wasm}/`, `src/lower/ownership.js` | −285 | +0 | **−285** |
  | 2. Prune `binary.{Read,Write,Size}` & `fmt.Sscan*` | `wasm/stdlib/packages.js` (deleted), `js/stdlib/binary.js` (deleted), `wasm/stdlib/io.js`, `js/stdlib/fmt.js`, `js/runtime.js`, `wasm/boundary.js` | −1,459 | +15 (`excluded.js`) | **−1,444** |
  | 3. `strings.Builder` to `stdlib/strings/` | `js/stdlib/builder.js` (deleted), `wasm/stdlib/core.js`, `wasm/stdlib/io.js`, `wasm/index.js`, `js/runtime.js`, `typechecker/stdlib/` | −850 | +110 (`stdlib/strings/builder.go`) | **−850** |
  | 4. `math` to `stdlib/math/` | `js/stdlib/math.js` (deleted), `wasm/stdlib/core.js`, `typechecker/stdlib/core.js`, `wasm/prescan.js` | −584 | +90 (`natives.js`) + 260 (`stdlib/math/math.go`) | **−494** |
  | 5. Unify JS `encoding/json` | `js/stdlib/json.js` (deleted), `js/runtime.js` (`HELPER_JSON`), `js/expressions.js`, `js/index.js` | −1,920 | +120 (`js/natives.js`, `link/stdlib.js`) | **−1,800** |
  | **Total** | **5 files deleted, 22 files trimmed** | **−5,098** | **+225 in `src/` (+370 in `stdlib/`)** | **−4,873 in `src/`** |
- **Performance Invariant (`test/perf/json-bench.js`):**
  - `WASM / JS` total time ratio must remain `<= 2.00x` (probed at `1.60x`: WASM `123.7 ms`, unified JS `77.3 ms`).
  - Unified JS total time on the 18,000-item corpus must remain `<= 150 ms` (faster than or equal to the 148.2 ms baseline).
- **Zero-Unused-Cost Invariant:** Moving `strings.Builder` and `math` to `stdlib/` uses `src/link/reachability.js` so importing `strings` or `math` only emits the functions/methods reachable from `main`.
- **Differential Parity Invariant:** Every `//gofront:native` function in `stdlib/strings`, `stdlib/math`, and `stdlib/internal/jsonrt` must produce identical results with `{ natives: true }` and `{ natives: false }` in `test/unit/compiler/natives.test.js`.

---

### 3. Edge Cases & Error Handling

- **`strings.Builder` copy-by-value panic:** Copying a non-zero `strings.Builder` by value (`b2 := b1`) and calling a mutating method (`Write`, `WriteByte`, `WriteRune`, `WriteString`, `Grow`) on `b2` must panic with `"strings: illegal use of non-zero Builder copied by value"`, while copying a zero `Builder` (`var b1 strings.Builder; b2 := b1; b2.WriteString("ok")`) or calling `Reset()` on a copied builder (`b2.Reset(); b2.WriteString("ok")`) must succeed on both JS and WASM.
- **`strings.Builder.Grow(n)` negative argument:** Calling `b.Grow(-1)` must panic with `"strings.Builder.Grow: negative count"` on both backends.
- **`strings.Builder` as `io.Writer` in `fmt.Fprint*`:** Because `*strings.Builder` in `stdlib/strings/builder.go` implements `Write([]byte) (int, error)`, `fmt.Fprintf(&b, ...)` and `io.WriteString(&b, ...)` dispatch through standard interface / method calls without any synthetic `SYNTHETIC_METHOD_TYPES` or `_emitHelperBuilderWrite*` hooks in the WASM emitter.
- **IEEE-754 special values in `stdlib/math`:** `math.Copysign(0, -1)` must preserve `-0.0` (`Float64bits(Copysign(0, -1)) == 0x8000000000000000`); `math.Signbit(-0.0)` must return `true`; `math.Min(0.0, -0.0)` and `math.Max(-0.0, 0.0)` must distinguish `-0.0` from `+0.0`; `math.NaN()`, `math.IsNaN`, and `math.IsInf` must match Go's IEEE-754 semantics in both default and `--no-natives` modes.
- **JS `encoding/json` parity after unification:**
  - `json.RawMessage`, `json.Number`, custom `MarshalJSON() ([]byte, error)` / `UnmarshalJSON([]byte) error` (on both value and pointer receivers), `,string` struct tags, `omitempty`, embedded structs, anonymous structs, base64 `[]byte`, `time.Time`, nil vs empty slices, and `json.NewEncoder`/`NewDecoder` streams must pass all existing tests in `test/unit/builtins/json.test.js` on `target: "js"`.
- **Excluded stdlib diagnostics:** Calling `binary.Read`, `binary.Write`, `binary.Size`, `fmt.Sscan`, `fmt.Sscanln`, or `fmt.Sscanf` must fail typechecking with the `EXCLUDED_STDLIB_MEMBERS` diagnostic naming the excluded function and its supported replacement.
- **Coordination with `follow-ups-2026-11-03-plan.md`:**
  - Pruning `fmt.Sscan*` supersedes L83–L85 (Task 12.4 in `follow-ups-2026-11-03-plan.md`).
  - Pruning `binary.{Read,Write,Size}` supersedes S23 and S26 (Task 27.3 in `follow-ups-2026-11-03-plan.md`).
  - Moving `strings.Builder` to `stdlib/strings/builder.go` resolves L16 (`strings.Builder` struct field across WASM boundary, Task 18.1 in `follow-ups-2026-11-03-plan.md`) by making `strings.Builder` an ordinary Go struct.
  - Unifying JS `encoding/json` onto `json-codecs.js` + `internal/jsonrt` consolidates JSON bug fixes onto a single code path across JS and WASM.

---

## Implementation Tasks

### Phase 1: Dead Method Sweep & Prune `binary.{Read,Write,Size}` and `fmt.Sscan*`

- [x] Task 1.1: Delete the 15 dead methods across JS codegen, WASM codegen, and ownership lowering
  - Files: `src/backend/wasm/stdlib/core.js`, `src/backend/wasm/stdlib/io.js`, `src/backend/wasm/emit-maps.js`, `src/backend/wasm/emit.js`, `src/backend/wasm/module-emitter.js`, `src/backend/js/expressions.js`, `src/backend/js/index.js`, `src/backend/js/statements.js`, `src/lower/ownership.js`
  - Test: `test/unit/compiler/check-layers.test.js`
  - Done when: All 15 unreferenced methods (`emitSlicesClone`, `_emitAppendSliceBytes`, `_emitNewError`, `emitElemLt`, `_nodeWritesVar`, `_genStructFields`, `_is64BitSigned`, `getSourceMap`, `_genSingleEmbedStubs`, `_isReferenceType`, `_nodeAssigns`, `allocTemp`, `getMapTypeByIndex`, `getTimezoneOffsetImportIndex`, `markOwnership`) are removed (~285 lines) and `npm test` + `npm run check` pass.
- [x] Task 1.2: Prune `binary.Read`, `binary.Write`, and `binary.Size` and remove the `encoding/binary` compiler overlay
  - Files: `src/backend/wasm/stdlib/packages.js` (delete), `src/backend/js/stdlib/binary.js` (delete), `src/backend/wasm/stdlib/index.js`, `src/backend/wasm/emit-builtins.js`, `src/backend/js/stdlib/index.js`, `src/backend/js/runtime.js`, `src/backend/js/index.js`, `src/typechecker/stdlib/extended.js`, `src/typechecker/stdlib/excluded.js`, `src/typechecker/types.js`, `test/unit/stdlib/encodings-crypto.test.js`, `test/unit/stdlib/excluded-stdlib.test.js`
  - Test: `test/unit/stdlib/excluded-stdlib.test.js`, `test/unit/stdlib/encodings-crypto.test.js`
  - Done when: `src/backend/wasm/stdlib/packages.js`, `src/backend/js/stdlib/binary.js`, and `HELPER_BINARY` are deleted (~784 lines), `"encoding/binary"` has no compiler overlay in `STDLIB_PACKAGES`, and `binary.Read`/`Write`/`Size` report the excluded-stdlib diagnostic in `test/unit/stdlib/excluded-stdlib.test.js`.
- [x] Task 1.3: Prune `fmt.Sscan`, `fmt.Sscanln`, and `fmt.Sscanf` across WASM/JS emitters and runtime
  - Files: `src/backend/wasm/stdlib/io.js`, `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/boundary.js`, `src/backend/wasm/module-emitter.js`, `src/backend/js/stdlib/fmt.js`, `src/backend/js/runtime.js`, `src/backend/js/index.js`, `src/typechecker/stdlib/core.js`, `src/typechecker/stdlib/excluded.js`, `src/typechecker/types.js`, `test/unit/stdlib/fmt.test.js`, `test/unit/stdlib/excluded-stdlib.test.js`
  - Test: `test/unit/stdlib/excluded-stdlib.test.js`, `test/unit/stdlib/fmt.test.js`
  - Done when: `emitSscanCall`, `fmt_sscan_*` host imports, and `HELPER_SSCAN` are deleted (~675 lines) and `fmt.Sscan`/`Sscanln`/`Sscanf` report the excluded-stdlib diagnostic in `test/unit/stdlib/excluded-stdlib.test.js`.

### Phase 2: Move `strings.Builder` to `stdlib/strings/builder.go`

- [x] Task 2.1: Amortize `Uint8Array` growth in JS `HELPER_APPEND` and implement `strings.Builder` in `stdlib/strings/builder.go`
  - Files: `src/backend/js/runtime.js`, `stdlib/strings/builder.go`, `test/unit/stdlib/strings-bytes.test.js`
  - Test: `test/unit/stdlib/strings-bytes.test.js`
  - Done when: `stdlib/strings/builder.go` implements `Builder` (`Write`, `WriteByte`, `WriteRune`, `WriteString`, `String`, `Len`, `Cap`, `Grow`, `Reset`, and `copyCheck()` panic on copy-by-value) and `HELPER_APPEND` amortizes `Uint8Array` growth via `__tcap`.
- [x] Task 2.2: Remove JS `strings.Builder` emitter shim and runtime prototype
  - Files: `src/backend/js/stdlib/builder.js` (delete), `src/backend/js/stdlib/index.js`, `src/backend/js/stdlib/fmt.js`, `src/backend/js/expressions.js`, `src/backend/js/runtime.js`, `src/backend/js/index.js`
  - Test: `test/unit/stdlib/strings-bytes.test.js`, `test/unit/stdlib/fmt.test.js`
  - Done when: `src/backend/js/stdlib/builder.js` and `__builder_proto` are deleted and all JS `strings.Builder` and `fmt.Fprint(&builder, ...)` tests compile through `stdlib/strings/builder.go`.
- [x] Task 2.3: Remove WASM `strings.Builder` emitters, synthetic methods, and `strings` typechecker overlay
  - Files: `src/backend/wasm/stdlib/core.js`, `src/backend/wasm/stdlib/io.js`, `src/backend/wasm/index.js`, `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/types.js`, `src/backend/wasm/module-emitter.js`, `src/typechecker/stdlib/core.js`, `src/typechecker/stdlib/extended.js`, `src/typechecker/types.js`, `test/unit/compiler/natives.test.js`
  - Test: `test/unit/stdlib/strings-bytes.test.js`, `test/unit/compiler/natives.test.js`
  - Done when: All WASM `strings.Builder` special cases (~680 lines) and the `"strings"` overlay entry in `STDLIB_PACKAGES` / `WASM_STDLIB_MEMBERS` are deleted, and `strings.Builder` passes `assertFourWay` in `test/unit/compiler/natives.test.js` and `test/unit/stdlib/strings-bytes.test.js` (including exported structs containing a `strings.Builder` field across the WASM boundary).

### Phase 3: Move `math` to `stdlib/math/math.go`

- [ ] Task 3.1: Add IEEE-754 bitcast and host-math intrinsics and implement `stdlib/math/math.go`
  - Files: `stdlib/math/math.go`, `stdlib/math/extra.go`, `src/backend/js/expressions.js`, `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/prescan.js`
  - Test: `test/unit/stdlib/math-bits-rand.test.js`
  - Done when: `stdlib/math/math.go` defines all 32 `math` constants and 40 remaining `math` functions with IEEE-754 bitcast intrinsics (`Float64bits`, `Float64frombits`, `Float32bits`, `Float32frombits`), pure-Go IEEE-754 bodies for `IsNaN`, `IsInf`, `Inf`, `NaN`, `Signbit`, `Copysign`, `Abs`, `Min`, `Max`, `Dim`, `Floor`, `Ceil`, `Trunc`, `Round`, and `Remainder`, and host-math intrinsic calls for transcendental functions.
- [ ] Task 3.2: Register `//gofront:native` fast paths for `math` in JS and WASM backends
  - Files: `src/backend/js/natives.js`, `src/backend/wasm/natives.js`, `test/unit/compiler/natives.test.js`
  - Test: `test/unit/compiler/natives.test.js`, `test/unit/stdlib/math-bits-rand.test.js`
  - Done when: `Abs`, `Floor`, `Ceil`, `Trunc`, `Round`, `Sqrt`, `Min`, `Max`, `Copysign`, `Signbit`, `IsNaN`, `IsInf`, `Inf`, and `NaN` emit inline JS `Math.*` / IEEE expressions and single WASM instructions (`f64.abs`, `f64.floor`, `f64.ceil`, `f64.trunc`, `f64.nearest`, `f64.sqrt`, `f64.min`, `f64.max`, `f64.copysign`, `f64.ne`) when `natives: true`, and pass `assertFourWay` against their pure-Go bodies when `natives: false`.
- [ ] Task 3.3: Delete legacy `math` emitters and typechecker overlay
  - Files: `src/backend/js/stdlib/math.js` (delete), `src/backend/js/stdlib/index.js`, `src/backend/wasm/stdlib/core.js`, `src/backend/wasm/emit-builtins.js`, `src/typechecker/stdlib/core.js`, `src/typechecker/types.js`
  - Test: `test/unit/stdlib/math-bits-rand.test.js`, `test/unit/compiler/natives.test.js`
  - Done when: `src/backend/js/stdlib/math.js`, `MATH_CONSTS`/`emitMathConst`/`emitMathCall` in `src/backend/wasm/stdlib/core.js`, and the `math` overlay in `src/typechecker/stdlib/core.js` and `STDLIB_PACKAGES` are deleted (~550 lines), and all `math` unit and perf tests pass.

### Phase 4: Unify JS `encoding/json` onto `json-codecs.js` + `stdlib/internal/jsonrt/`

- [ ] Task 4.1: Optimize `stdlib/internal/jsonrt`, JS `HELPER_APPEND`, and JS `jsonrt` natives for high-throughput JS execution
  - Files: `stdlib/internal/jsonrt/decode.go`, `stdlib/internal/jsonrt/scanner.go`, `stdlib/internal/jsonrt/encode.go`, `src/backend/js/runtime.js`, `src/backend/js/natives.js`
  - Test: `test/unit/wasm/json.test.js`, `test/unit/compiler/natives.test.js`
  - Done when: `Dec.Enter`/`Leave` and `scanner.pushParseState`/`popParseState` track stack depth by index without `__reslice` allocations, `HELPER_APPEND` amortizes plain-array growth, and `src/backend/js/natives.js` provides fast JS `Enc`/`Dec` primitives verified by `assertFourWay`.
- [ ] Task 4.2: Route `js` and `both` `encoding/json` compilation through `checkJsonCodecs` and `src/lower/json-codecs.js`
  - Files: `src/link/stdlib.js`, `src/compiler.js`, `src/lower/json-codecs.js`, `src/lower/stdlib-refs.js`, `src/backend/js/expressions.js`, `src/backend/js/index.js`
  - Test: `test/unit/builtins/json.test.js`, `test/unit/wasm/json.test.js`
  - Done when: `checkJsonCodecs` runs for `js`, `both`, and `wasm` packages, `_jsonGen` and `_jsonStream` lower on the AST before `CodeGen.generateAll`, and every test in `test/unit/builtins/json.test.js` and `test/unit/wasm/json.test.js` passes.
- [ ] Task 4.3: Delete `src/backend/js/stdlib/json.js` and `HELPER_JSON`, verify `json-bench.js`, and update documentation
  - Files: `src/backend/js/stdlib/json.js` (delete), `src/backend/js/stdlib/index.js`, `src/backend/js/runtime.js`, `docs/architecture.md`, `docs/language-support.md`, `docs/go-compatibility.md`, `CHANGELOG.md`
  - Test: `test/unit/builtins/json.test.js`, `test/perf/json-bench.js`
  - Done when: `src/backend/js/stdlib/json.js` (1,166 lines) and `HELPER_JSON` in `src/backend/js/runtime.js` (~730 lines) are deleted, `node test/perf/json-bench.js` passes (`WASM <= 2.00x JS`, JS total ≤ 150 ms), total `src/` line count is reduced by ≥ 4,200 lines, and user docs and `CHANGELOG.md` reflect the unified `encoding/json` pipeline and retired `binary.{Read,Write,Size}` / `fmt.Sscan*` members.
