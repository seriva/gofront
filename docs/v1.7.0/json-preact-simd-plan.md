# GoFront v1.7.0 — Implementation Plan

**Version:** v1.7.0
**Status:** Draft (2026-10-18)
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
- `reflect`, `json.Marshaler`/`Unmarshaler` interfaces, `json.Decoder`/`Encoder` streams.
- Auto-vectorization of scalar code. SIMD is opt-in through `gofront/simd`.
- `encoding/json` inside `wasm`/`both` packages. It gets a targeted diagnostic in 1.7.0. Asset and config loading lives in `js` packages already (simplefps `assets`).

### Success criteria

- `json.Marshal`/`Unmarshal` output matches Go's `encoding/json` on the test corpus (key order, `omitempty`, `-`, embedded fields, nil vs empty slices, error messages).
- `example/preact` passes `shared.spec.js` + its own spec. No CDN fetches in CI.
- SIMD ships only if the raycast benchmark shows **≥ 1.3×** over the scalar hybrid build. Otherwise it moves to v1.7.1 and the release ships without it.
- All existing tests pass; `npm run check` clean; Sentrux quality not below the v1.6.1 baseline; `npm run bench` hybrid ≥ 11,500 rays/s.

---

## Findings from review (why the plan changed)

| Finding | Evidence | Plan impact |
|---|---|---|
| Struct tags are parsed and **discarded** | [`src/parser/types.js#L192-L193`](../../src/parser/types.js#L192-L193) consumes the backtick string and drops it | Phase 1 starts in the parser, not the typechecker |
| Go multi-value returns already lower to JS arrays | `a, b := f()` emits `let [a, b] = f();` | TS tuple `[A, B]` → Go `(A, B)` is almost free; this makes React/Preact hooks usable without wrapper code |
| `.d.ts` parser has no tuple support | [`src/dts-parser.js`](../../src/dts-parser.js) handles `T[]` only; tuples fall back to `any` | New Phase 2 task |
| `v128` valtype byte exists, no SIMD opcodes | [`src/backend/wasm/encode.js#L103`](../../src/backend/wasm/encode.js#L103) | SIMD needs `0xFD`-prefix opcode encoding, WAT printing, Binaryen feature flag |
| Auto-vectorizing `Vec3` is not realistic | `Vec3` is 3-wide, lives in WasmGC structs | Explicit `simd.F32x4` type instead; go/no-go gate |
| CDN imports break offline CI | Playwright runs headless in CI | Vendor Preact via `gofront vendor` ([`src/vendor.js`](../../src/vendor.js)) |
| Channels conflict with the stated principle | [go-compatibility.md#L27](../go-compatibility.md#L27) | Dropped from the plan |

---

## Phase 1 — `encoding/json` (JS packages)

### Design

- **Parser:** keep the raw tag on the field AST (`field.tag`).
- **Typechecker:** parse tags with Go's `reflect.StructTag` rules (`key:"value"` pairs, space-separated). Resolve the JSON field set once per named struct: exported fields only, tag rename, `omitempty`, `-`, `-,` (literal `-` key), embedded struct promotion with Go's depth/conflict rules. Cache on the type.
- **Codegen:** one encoder and one decoder function per reachable type, emitted once (memoized like runtime helpers, named `__json_enc_<Type>` / `__json_dec_<Type>`). Call sites stay small.
  - `Marshal(v any) ([]byte, error)` — dispatches on static type when known, falls back to dynamic boxing tags (`__v`, `__p`, `__map`, `__slice`) for `any`. Returns `Uint8Array` (matches the v1.6.1 `[]byte` representation).
  - `MarshalIndent(v, prefix, indent)`, `Valid(data)`.
  - `Unmarshal(data []byte, v any) error` — `JSON.parse` once, then the generated decoder assigns typed fields. Numbers into `int*` truncate like Go conversions; into `any` become `float64`; objects into `any` become `map[string]any`; arrays become `[]any`.
  - Errors use Go's message shapes: `json: cannot unmarshal string into Go struct field T.x of type int`, `invalid character ...`, `json: Unmarshal(non-pointer main.T)`.
- **Key order:** struct fields in declaration order; maps sorted by key (Go behaviour, not insertion order).
- **Escaping:** match Go's HTML-safe escaping (`<`, `>`, `&` → `\u003c` etc.).
- **WASM:** `json.*` in `wasm`/`both` packages reports `'json.Marshal' is not yet available in wasm packages` with the usual "move to a js package" hint.

### Tasks

- [ ] **Task 1.1** — Preserve struct tags in the parser; add `parseStructTag` utility with tests.
- [ ] **Task 1.2** — JSON field resolution in the typechecker (rename, omitempty, `-`, embedding conflicts).
- [ ] **Task 1.3** — `encoding/json` typechecker stdlib entries (`Marshal`, `MarshalIndent`, `Unmarshal`, `Valid`, `RawMessage`).
- [ ] **Task 1.4** — JS codegen: memoized per-type encoder/decoder emission in `src/backend/js/stdlib/json.js`.
- [ ] **Task 1.5** — WASM diagnostic for `json.*`.
- [ ] **Task 1.6** — Tests (`test/unit/builtins/json.test.js`): golden outputs captured from real Go for each case; malformed input; non-pointer target; nested/embedded/pointer fields; `map[string]T`; `[]byte` field (base64, like Go).

---

## Phase 2 — `.d.ts` tuples & `example/preact`

### Design

- **Tuples:** `dts-parser` parses `[A, B]` (and readonly / labelled `[a: A, b: B]`). In **return position** it maps to a Go multi-value result `(A, B)`; elsewhere to `[]any`. No codegen change: multi-value results already destructure from JS arrays.
- **Rest params:** confirm `...children: any[]` maps to Go variadic so `h("li", props, child1, child2)` type-checks.
- **Example:** `example/preact` reimplements the shared TodoMVC (same selectors in `test/e2e/selectors.js`) with function components:

  ```go
  func TodoItem(p TodoProps) VNode {
      editing, setEditing := useState(false)
      return h("li", map[string]any{"class": itemClass(p.Todo, editing)}, ...)
  }
  ```

  Preact is vendored (`gofront vendor preact`), loaded as ESM from `index.html`, typed by a checked-in `preact.d.ts`.
- **Props note:** Preact copies props into a fresh object, so a Go struct passed as props keeps its fields but loses methods. Document this; components take props as structs and use only fields.

### Tasks

- [ ] **Task 2.1** — Tuple types in `src/dts-parser.js`; multi-value mapping in return position; unit tests.
- [ ] **Task 2.2** — Verify/fix rest-parameter → variadic mapping; unit test with an `h`-style signature.
- [ ] **Task 2.3** — `example/preact` (TodoMVC parity incl. priority, filters, async save status), vendored Preact, `preact.d.ts`.
- [ ] **Task 2.4** — Remove `example/reactive` (`reactive.js`, `browser.d.ts`, sources); update `package.json` `build`, `playwright.config.js` (project + port 3002), `test/e2e/reactive.spec.js` → `preact.spec.js`, `.github/workflows/ci.yml` deploy step, README examples table.

---

## Phase 3 — WASM SIMD (`gofront/simd`), gated

### Design

- **API** (`import "gofront/simd"`), value types with Go value semantics:
  - `F32x4` — `simd.F32x4{a, b, c, d}`, `Splat(f)`, `Add`, `Sub`, `Mul`, `Div`, `Min`, `Max`, `Dot3`, `Dot4`, `Lane(i)` (constant `i`), `WithLane`.
  - `simd.LoadF32x4(buf shared.Float32, i)` / `StoreF32x4` for zero-copy access to `gofront/shared` buffers (linear memory, `v128.load`/`v128.store`).
- **WASM lowering:** `F32x4` is a `v128` local/param/result/struct field. Methods inline to single opcodes (`f32x4.add` = `0xFD 0xE4`, ...). `Dot3` = mul + two shuffles/adds (no native dot for f32).
- **JS lowering:** `F32x4` becomes a frozen 4-number struct; methods inline to scalar math. Same results bit-for-bit for `+ - * /` (both use `Math.fround` per lane in strict mode).
- **Encoder/WAT/optimizer:** `0xFD`-prefixed opcode encoding with LEB128 sub-opcodes, WAT printing, `--enable-simd` in Binaryen flags and `DEFAULT_WASM_FEATURES`.
- **Boundary:** `F32x4` does not cross the JS↔WASM boundary in 1.7.0 (compile error with hint). Use `shared.Float32` instead.

### Go/no-go

Port the raycast benchmark's ray–triangle test to `F32x4` (Möller–Trumbore with 4-wide edges) behind a flag. Ship if **≥ 1.3×** the scalar hybrid build in Node and headless Chromium. Otherwise move Phase 3 to v1.7.1 and keep the encoder groundwork.

### Tasks

- [ ] **Task 3.1** — `0xFD` opcode encoding + WAT printing for the `F32x4` op set; encoder tests.
- [ ] **Task 3.2** — `gofront/simd` typechecker package; `v128` in WASM type mapping (locals, params, struct fields).
- [ ] **Task 3.3** — WASM emitter lowering; JS scalar fallback; parity tests (same program, both targets).
- [ ] **Task 3.4** — `shared.Float32` load/store; bounds checks.
- [ ] **Task 3.5** — Binaryen SIMD feature flag; optimized/unoptimized parity test.
- [ ] **Task 3.6** — SIMD raycast variant in `test/e2e/perf/raycast-bench.js`; record result; go/no-go decision in this doc.

---

## Phase 4 — Verification & docs

- [ ] **Task 4.1** — `npm test`, `npm run check`, `npm run build`, `npm run test:e2e`, `npm run bench`.
- [ ] **Task 4.2** — simplefps smoke: load a config via `json.Unmarshal`; if SIMD shipped, a hybrid build with one `F32x4` hot path at 60 FPS.
- [ ] **Task 4.3** — Docs: `go-compatibility.md` (add `encoding/json`, `gofront/simd`, tuple mapping), `hybrid-wasm.md` (SIMD section), `roadmap.md`, `README.md`, `CHANGELOG.md`.

---

## Risks

| Risk | Mitigation |
|---|---|
| JSON edge cases diverge from Go (escaping, float formatting, embedding conflicts) | Golden files generated by real Go; float formatting via Go's `strconv` 'g'-shortest rules already used by `fmt` |
| Generated encoders bloat bundles | One function per reachable type, emitted only when `encoding/json` is imported; measure on `example/preact` |
| Tuple mapping changes existing `.d.ts` typings from `any` to multi-value | Only in return position; release note; existing code that indexed the `any` result gets a clear error |
| Preact props lose methods | Documented; example uses field-only props structs |
| SIMD gain too small for 3-wide data | Go/no-go gate; drop to v1.7.1 without blocking JSON/Preact |
| Sentrux complexity rise in emitter | SIMD ops table-driven (like `MATH_F64_UNARY`); JSON codegen in its own module |

---

## Release order

Phase 1 → Phase 2 → Phase 3 (gate) → Phase 4. Phases 1 and 2 are independent and can run in parallel. Phase 3 never blocks the release.
