# GoFront v1.7.0 — Implementation Plan

**Version:** v1.7.0
**Status:** Complete (2026-10-20)
**Depends on:** v1.6.1
**Theme:** Typed data, typed JS libraries, faster math — without adding a runtime.

---

## Goal

Three features, each held to the **no runtime** rule ([roadmap](../roadmap.md#out-of-scope), [go-compatibility](../go-compatibility.md#whats-not-implemented)):

1. **`encoding/json`** — struct-tag driven `Marshal`/`Unmarshal`, generated per type at compile time. No `reflect`.
2. **`.d.ts` interop upgrade + Preact example** — TypeScript tuples map to Go multi-value returns, so `count, setCount := useState(0)` works. `example/reactive` (built on the retired microtastic `reactive.js`) is replaced by `example/preact`.
3. **WASM SIMD** — an explicit `gofront/simd` package (`F32x4`) lowered to `v128` in `wasm` packages, with a scalar fallback in `js` packages. Gated on a measured speedup.

### Non-goals

- Goroutines, channels, `select`. Out of scope by design: a userland scheduler is a runtime. Async stays `async`/`await` + Promises.
- `reflect`, `json.Decoder`/`Encoder` streams, `json.Number`, and typed error values (`*json.SyntaxError`, …).
- Cyclic object graph serialization.
- *(Originally also `json.Marshaler`/`Unmarshaler` and the `,string` tag option; both were added in Task 1.7.)*
- Auto-vectorization of scalar code. SIMD is opt-in through `gofront/simd`.
- `encoding/json` inside `wasm`/`both` packages. It gets a targeted diagnostic in 1.7.0. Asset and config loading lives in `js` packages already (simplefps `assets`).

### Success criteria

- `json.Marshal`/`Unmarshal` output matches Go's `encoding/json` on the test corpus (key order, `omitempty`, `-`, `-,`, embedded fields, nil vs empty slices/maps, exact `RawMessage` bytes, numeric range errors, error messages).
- `example/preact` passes `shared.spec.js` + its own spec with vendored Preact and `preact/hooks`. No CDN fetches in CI.
- SIMD promotion beyond experimental status requires the raycast benchmark to show **≥ 1.3×** over the scalar hybrid build. Otherwise retain the opt-in experimental API and defer general promotion.
- All existing tests pass; `npm run check` clean; Sentrux layer architecture respected; quality not below the v1.6.1 baseline; `npm run bench` hybrid ≥ 11,500 rays/s.

---

## Findings from review (why the plan changed)

| Finding | Evidence | Plan impact |
|---|---|---|
| Struct tags are parsed and **discarded** | [`src/parser/types.js#L192-L193`](../../src/parser/types.js#L192-L193) consumes the backtick string and drops it | Phase 1 starts in the parser, not the typechecker |
| Embedded field tag disambiguation in parser | [`src/parser/types.js#L181`](../../src/parser/types.js#L181) expects `;` or `}` for embedded fields; backtick tags cause syntax error | Parser must recognize optional tags on embedded types (`Base `json:"base"`` and `*Base`) |
| Go multi-value returns already lower to JS arrays | `a, b := f()` emits `let [a, b] = f();` | TS tuple `[A, B]` → Go `(A, B)` is almost free; makes React/Preact hooks usable without wrapper code |
| `.d.ts` parser has no tuple support | [`src/dts-parser.js`](../../src/dts-parser.js) handles `T[]` only; tuples fall back to `any` | Phase 2 task |
| `dts-parser` drops variadic flag on function types | [`src/dts-parser.js#L409`](../../src/dts-parser.js#L409), [`L553`](../../src/dts-parser.js#L553) maps types but ignores `p.variadic` | Fixed in `_parseFuncDecl` and `_parseMemberDefault` so `...children: any[]` becomes `variadic: true` |
| Preact hooks live in `preact/hooks` subpath | Preact npm package separates root from hooks | Vendor bundler and config must support `preact/hooks` subpath and globals mapping |
| `v128` valtype byte exists, no SIMD opcodes | [`src/backend/wasm/encode.js#L103`](../../src/backend/wasm/encode.js#L103) | SIMD needs `0xFD`-prefix with unsigned LEB128 sub-opcodes (e.g. `f32x4.add` is `0xFD 0xE4 0x01`, not 2 bytes) |
| Binaryen feature flag missing SIMD bit | [`src/backend/wasm/optimize.js#L28`](../../src/backend/wasm/optimize.js#L28) bitmask is 2006 | Bitmask updated to 2014 (`+ 8`), `--enable-simd` added to CLI args and bench script |
| Auto-vectorizing `Vec3` is not realistic | `Vec3` is 3-wide, lives in WasmGC structs | Explicit `simd.F32x4` type instead; go/no-go gate |
| CDN imports break offline CI | Playwright runs headless in CI | Vendor Preact via `gofront vendor` ([`src/vendor.js`](../../src/vendor.js)) |
| Channels conflict with the stated principle | [go-compatibility.md#L27](../go-compatibility.md#L27) | Dropped from the plan |

---

## Phase 1 — `encoding/json` (JS packages)

### Design

- **Parser:**
  - Keep the raw tag on the field AST (`field.tag`).
  - Disambiguate embedded fields with tags: if an identifier or pointer type is followed by `T.STRING` before `;` or `}`, preserve it as an embedded field with a tag.
- **Typechecker:**
  - Parse tags with Go's `reflect.StructTag` rules (`key:"value"` space-separated pairs).
  - Resolve the JSON field set once per named struct: exported fields only, tag rename, `omitempty`, `-` (ignore), `-,` (literal `-` key), embedded struct promotion with Go's depth/conflict rules.
  - Unknown options after comma (e.g. `json:"name,unknownopt"`) are ignored gracefully.
  - Cache resolved JSON schema on the struct type.
- **Codegen (`src/backend/js/stdlib/json.js`):**
  - Emits memoized per-type encoder/decoder functions (`__json_enc_<Type>`, `__json_dec_<Type>`) once per reachable type.
  - `Marshal(v any) ([]byte, error)`:
    - Static type dispatch when known; fallback to dynamic boxing tags (`__v`, `__p`, `__map`, `__slice`) for `any`.
    - Returns `Uint8Array` matching GoFront `[]byte`.
    - **Key order:** struct fields in declaration order; map keys sorted lexicographically.
    - **`omitempty` semantics:** omits zero values (false, 0, `""`, nil pointers/interfaces, empty slices `len == 0`, empty maps). **Empty struct values are NOT omitted**, matching Go standard library.
    - **Nil vs Empty:** `nil` slice/map emits `null`; empty allocated slice/map emits `[]` or `{}`.
    - **64-bit integers (`int64`/`uint64`):** serialized into JSON number values up to `Number.MAX_SAFE_INTEGER` ($2^{53}-1$); past that, serialized as exact integer digits to prevent precision loss.
    - **`json.RawMessage`:** bypasses string escaping and base64; its raw UTF-8 byte content is inlined directly into the JSON stream.
    - **Escaping:** matches Go's HTML-safe escaping (`<`, `>`, `&` → `\u003c`, `\u003e`, `\u0026`) plus `\u2028` and `\u2029`.
  - `MarshalIndent(v, prefix, indent)` and `Valid(data)`.
  - `Unmarshal(data []byte, v any) error`:
    - `JSON.parse` once, then assigns into typed targets via generated decoder.
    - **Target check:** target must be a non-nil pointer; error `json: Unmarshal(non-pointer ...)` or `json: Unmarshal(nil ...)`.
    - **Field matching:** exact tag match first, then exact field name, then case-insensitive fallback; unknown JSON keys are ignored.
    - Numbers into integer fields must be integral and in range; into `any` become `float64`; JSON objects into `any` become `map[string]any`; JSON arrays into `any` become `[]any`.
    - `json.RawMessage` targets receive the original source bytes for the exact JSON value, including nested struct, slice, and map fields.
    - Error messages match Go shapes: `json: cannot unmarshal string into Go struct field T.x of type int`.
- **WASM:** `json.*` in `wasm`/`both` packages reports `'json.Marshal' is not yet available in wasm packages` with hint to move to a `js` package.

### Tasks

- [x] **Task 1.1** — Preserve struct tags in parser AST (`field.tag`); support tags on embedded and pointer-embedded fields (`src/parser/types.js`); add `parseStructTag` utility with unit tests.
- [x] **Task 1.2** — JSON field resolution in typechecker (tag parsing, rename, omitempty, `-`, `-,`, embedded field promotion and collision resolution).
- [x] **Task 1.3** — `encoding/json` stdlib typechecker symbols (`Marshal`, `MarshalIndent`, `Unmarshal`, `Valid`, `RawMessage`).
- [x] **Task 1.4** — JS codegen: memoized per-type encoder/decoder emission in `src/backend/js/stdlib/json.js` handling `RawMessage`, BigInt/int64, nil vs empty, and sorted keys.
- [x] **Task 1.5** — WASM diagnostic for `json.*` in `wasm`/`both` packages.
- [x] **Task 1.6** — Tests (`test/unit/builtins/json.test.js`): golden outputs matching real Go; malformed inputs; non-pointer/nil targets; nested/embedded structs; `map[string]T`; `RawMessage`; `[]byte` base64 vs `RawMessage` verbatim; `omitempty` zero-value checks.
- [x] **Task 1.7** — Scope addition from the release documentation review (2026-10-20): `MarshalJSON` (value receivers on any named type; pointer receivers only on addressable values, as in Go; output validated, compacted and HTML-escaped; Go's `error calling MarshalJSON` messages), `UnmarshalJSON` (exact raw value bytes, `null` for non-pointer fields), the `,string` tag option, Go-identical decode error messages (number literal, JSON field path, element type; integer syntax and range checks for top-level targets and `[]byte` arrays), and a fix for pointer-to-scalar fields encoding as `NaN`/objects. Expected outputs captured from Go with `GOEXPERIMENT=nojsonv2` (go1.26 semantics).
- [x] **Task 1.8** — Language fixes found by the same review, verified against Go output: named non-struct types with methods (raw values, static method dispatch, interface boxing, runtime-checked assertions and type switches, interface equality, `errors.Is`/`As`), runtime checks for assertions to interface types, boxing of address-taken variables from multi-variable declarations, `var` declarations and parameters, and Go's identical-underlying-type assignability for type literals.

---

## Phase 2 — `.d.ts` tuples & `example/preact`

### Design

- **Tuples:**
  - `src/dts-parser.js` parses `[A, B]` (including labelled `[state: S, setState: Dispatch]`).
  - In **return position**, maps to Go multi-value return `(A, B)`.
  - In parameter/property position, maps to `[]any`.
  - Multi-value returns lower directly to array destructuring in JS (`let [a, b] = fn()`).
  - Typechecker enforces that tuple multi-value returns cannot be assigned to a single variable (`x := useState(0)` errors with `assignment mismatch: 1 variable but returns 2 values`).
- **Rest parameters & variadics:**
  - Fix `_parseFuncDecl` and `_parseMemberDefault` in `src/dts-parser.js` so `p.variadic = isRest` propagates to the function type as `{ variadic: true }`.
  - Verifies `h(tag, props, ...children)` type-checks with variadic arguments.
- **Vendoring & Preact hooks:**
  - Update `src/vendor.js` and `gofront` vendor config to support subpath exports (e.g. `preact/hooks`) and named export global assignments (`window.h = preact.h`, `window.useState = preact_hooks.useState`).
  - Provide checked-in `preact.d.ts` with ambient or module declarations for Preact and hooks.
- **Example:** `example/preact` reimplements TodoMVC (sharing `test/e2e/selectors.js`) with function components:
  ```go
  func TodoItem(p TodoProps) VNode {
      editing, setEditing := useState(false)
      return h("li", map[string]any{"class": itemClass(p.Todo, editing)}, ...)
  }
  ```
- **Component props note:** Preact shallow-copies props into fresh objects. Go structs passed as props preserve fields but lose method receivers. Document that component props are field-only structs.

### Tasks

- [x] **Task 2.1** — Tuple types in `src/dts-parser.js`; multi-value return mapping; typechecker single-variable assignment rejection; unit tests.
- [x] **Task 2.2** — Fix rest-parameter propagation (`variadic: true`) in `src/dts-parser.js` (`_parseFuncDecl`, `_parseMemberDefault`); unit tests with `h`-style variadic signatures.
- [x] **Task 2.3** — Support submodule vendor packaging (`preact/hooks`) and named export bindings in `src/vendor.js`; vendor Preact.
- [x] **Task 2.4** — Implement `example/preact` with `preact.d.ts` (TodoMVC parity: priorities, filters, async save, loading states).
- [x] **Task 2.5** — Retire `example/reactive` (`reactive.js`, `browser.d.ts`); update `package.json` build scripts, `playwright.config.js` (port 3002 webServer and test project), `test/e2e/reactive.spec.js` → `preact.spec.js`, CI workflows, and README.

---

## Phase 3 — WASM SIMD (`gofront/simd`), gated

### Design

- **API** (`import "gofront/simd"`), value types with Go value semantics:
  - `F32x4` — `simd.F32x4{a, b, c, d}`, `Splat(f)`, `Add`, `Sub`, `Mul`, `Div`, `Min`, `Max`, `Dot3`, `Dot4`, `Lane(i)` (constant `i`), `WithLane`.
  - Zero value: `var v simd.F32x4` zero-initializes to `(0, 0, 0, 0)` (`v128.const` 0s in WASM, `[0, 0, 0, 0]` in JS).
  - `simd.LoadF32x4(buf shared.Float32, i)` / `StoreF32x4`: zero-copy access to linear memory buffers. Index `i` is an element index (byte offset `i * 4`); bounds check validates $i + 4 \le \text{len}(buf)$.
- **WASM lowering:**
  - `F32x4` lowers to `v128` local/param/result/field.
  - Method calls inline to single opcodes.
  - Dot products lower to multiply + shuffles/adds.
- **JS lowering:**
  - `F32x4` lowers to a frozen 4-number struct/array; methods inline to scalar math using `Math.fround` per lane for IEEE-754 32-bit parity.
- **Encoder / WAT / Optimizer:**
  - `src/backend/wasm/encode.js`: encode `0xFD` prefix followed by unsigned LEB128 sub-opcode (e.g. `f32x4.add` = sub-opcode 228 → bytes `[0xFD, 0xE4, 0x01]`).
  - `src/backend/wasm/optimize.js`: update `DEFAULT_WASM_FEATURES` bitmask to 2014 ($2006 \mid 8$); add `--enable-simd` to `runWasmOpt` flags and `watArgs`.
  - Update `test/e2e/perf/raycast-bench.js`'s internal `optimiseWasm` to include `--enable-simd`.
- **Boundary:** `F32x4` cannot cross the JS↔WASM boundary in 1.7.0 (compile diagnostic suggests `shared.Float32`).

### Go/no-go

Port the raycast benchmark's ray–triangle test to `F32x4` (Möller–Trumbore with 4-wide edges) behind a flag. Ship if **≥ 1.3×** the scalar hybrid build in Node and headless Chromium. Otherwise move Phase 3 to v1.7.1 and keep the encoder groundwork.

**Benchmark outcome (131,072 triangles, 100,000 rays × 3 runs):**
- JS: 9,000 rays/s (11,111.5 ms/run, 12.7 MB alloc/run)
- Hybrid (scalar): 11,797 rays/s (8,477.1 ms/run, 2,688 B alloc/run)
- SIMD (`F32x4`): 12,072 rays/s (8,283.9 ms/run, 2,688 B alloc/run)
- Speedup vs JS: 1.34×
- Speedup vs scalar hybrid: **1.02×** (gate threshold was ≥ 1.30×)

**Decision: NO-GO for promotion beyond experimental status in v1.7.0.**
Octree node queries (`RayQueryLocal` and `IntersectRayAABB`) dominate runtime over per-triangle barycentric testing on 3-wide mesh data. The SIMD opcode encoding, Binaryen feature integration, `gofront/simd` type definitions, and lowering remain available as an opt-in experimental API; general promotion was deferred to v1.7.1 and, after v1.7.1 was dropped, to [v1.8.0](../v1.8.0/portable-go-plan.md); it does not block the release.

### Tasks

- [x] **Task 3.1** — `0xFD` opcode encoding with unsigned LEB128 sub-opcodes in `src/backend/wasm/encode.js` + WAT printing for `F32x4` ops; encoder unit tests.
- [x] **Task 3.2** — `gofront/simd` stdlib typechecker package; `v128` valtype mapping in locals, parameters, and struct fields; zero-value emission.
- [x] **Task 3.3** — WASM emitter lowering and JS scalar fallback with `Math.fround`; parity tests between WASM and JS targets.
- [x] **Task 3.4** — `shared.Float32` load/store lowering (`v128.load`/`v128.store`) with element offset calculation and bounds checking.
- [x] **Task 3.5** — Binaryen SIMD feature flag integration in `optimize.js` and `raycast-bench.js`; optimized/unoptimized module validation.
- [x] **Task 3.6** — SIMD raycast variant in `test/e2e/perf/raycast-bench.js`; record result; go/no-go decision recorded in this document.

---

## Phase 4 — Verification & docs

- [x] **Task 4.1** — Full verification: `npm test`, `npm run check`, `npm run build`, `npm run test:e2e`, `npm run bench`.
- [x] **Task 4.2** — Verify Sentrux architectural layering: ensure new modules (`src/backend/js/stdlib/json.js`, `src/backend/wasm/stdlib/simd.js`) strictly adhere to layer import rules in `.sentrux/rules.toml`.
- [x] **Task 4.3** — SimpleFPS smoke test: replace manual JSON helpers (`jsonInt`, `jsonFloat` in `app/src/engine/assets/materialloader.go` and `resources.go`) with standard `json.Unmarshal`; if SIMD ships, test a hybrid build with one `F32x4` hot path at 60 FPS.
- [x] **Task 4.4** — Documentation: `docs/go-compatibility.md` (add `encoding/json`, `gofront/simd`, tuple returns), `docs/hybrid-wasm.md` (SIMD section), `docs/roadmap.md`, `README.md`, `CHANGELOG.md`.

---

## Risks

| Risk | Mitigation |
|---|---|
| JSON edge cases diverge from Go (escaping, float formatting, embedding conflicts) | Golden files generated by real Go; float32 formatting uses shortest-round-trip digits and the `encoding/json` exponent thresholds |
| `BigInt` serialization crash in JS | Codegen explicitly serializes 64-bit integers to JSON numeric literals without calling raw `JSON.stringify(bigint)` |
| `RawMessage` base64 corruption | Generated encoder explicitly treats `RawMessage` as raw JSON bytes, bypassing standard `[]byte` base64 formatting |
| Preact submodule export incompatibility | `src/vendor.js` supports entry points and explicit named exports mapping to window globals |
| Tuple mapping allows invalid Go assignments | Typechecker enforces multi-value destination count matching Go compile rules |
| WASM SIMD LEB128 encoding bugs | Explicit tests for multi-byte sub-opcodes (> 127) against Binaryen validation |
| SIMD gain too small for 3-wide data | Go/no-go gate (≥ 1.3×); promotion moves to a later release (now v1.8.0) without blocking JSON/Preact |
| Sentrux architectural layering violation | Standalone stdlib modules located under `src/backend/` importing only allowed layer dependencies |

---

## Release order

Phase 1 → Phase 2 → Phase 3 (gate) → Phase 4. Phases 1 and 2 are independent and can run in parallel. Phase 3 never blocks the release.
