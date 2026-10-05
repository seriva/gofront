# WASM MVP (Hybrid Targets in the JS Compiler) — Design Plan

**Version:** v1.5.0  
**Status:** In Progress (2026-10-05)  
**Baseline:** v1.4.0 JS compiler (`src/`)  
**Continues in:** [`docs/v1.6.0/wasm-hybrid-plan.md`](../v1.6.0/wasm-hybrid-plan.md) (full hybrid, still in the JS compiler) → [`docs/v2.0.0/native-go-engine.md`](../v2.0.0/native-go-engine.md) (port of the finished compiler to Go)

---

## Goal

Ship the first version of **per-package WebAssembly output** in the existing JS compiler, so GoFront can transpile to JS *and* compile to WasmGC in the same app, before the native Go rewrite.

The release answers one question with real numbers: **is the hybrid model worth it?** It does that by moving simplefps's heaviest compute (octree + trimesh raycasting) to WASM and its math types to a `both` package, then benchmarking against the JS-only build.

Concretely, v1.5.0 delivers:

1. **A shared lowering step (`src/lower/`)** extracted from `src/codegen/`. The JS output stays byte-identical, and the WASM backend reuses it.
2. **Package targets** `//gofront:target wasm | both` with import rules and targeted diagnostics.
3. **Strict numeric mode** in JS codegen for `both` packages, so the JS and WASM copies compute identical results.
4. **A WASM backend (`src/backend/wasm/`)** for a core language subset, with a dependency-free binary encoder and `--emit-wat`.
5. **Boundary v1:** generated JS facades for `wasm` packages imported by `js` packages.
6. **The simplefps split** (`mathx` both, `collision` wasm) and a **published go/no-go benchmark**.

**Done means:**
- All existing tests pass unchanged after the `lower` extraction.
- Every v1.5 WASM fixture passes.
- simplefps runs with collision in WASM.
- The `mathx` tests pass on both targets and the `collision` tests pass in WASM.
- The raycast benchmark is published in the README and CHANGELOG, whatever it shows.

---

## Out of Scope (deferred to v1.6.0)

- **Non-empty interfaces**, itabs and interface proxies across the boundary. simplefps's `RaycastProvider`, so `DynamicBody`/`FPSController` stay in a `js` package for now.
- **Generics in WASM packages** (monomorphisation).
- **Maps** in WASM packages.
- **`defer` / `recover`.** `panic` exists (bounds checks, explicit `panic`), but it can't be recovered inside WASM. It reaches JS as a thrown error.
- **WASM → JS closures** (passing a WASM closure to JS as a callback). The JS → WASM direction *is* in scope.
- **Shared linear-memory buffers** (`gofront/shared`), `example/hybrid`, `wasm-opt` integration.
- **DOM, `.templ`, `gom`, `js:` imports, `async`** in WASM packages. These are permanently rejected in v1.x, and the [future whole-app design](../v1.6.0/wasm-hybrid-plan.md#future-whole-app-wasm) relaxes them later.
- **WASM source maps.**
- **Porting to Go.** That is v2.0.0, which then ports this backend too.

---

## Approach

### 1. Extract `src/lower/` (refactor, no behaviour change)

Today the analyses are spread through codegen and stored as `_`-prefixed fields on AST nodes (`_type`, `_lvalue`, `_className`, …). Move the decision-making into `src/lower/`, which produces **side tables** (`Map`s keyed by AST node):

| Analysis | Currently in | Moves to |
|---|---|---|
| Clone elision / ownership (`_fnMutates`, `_markOwnership`, `_nodeMutatesVar`, `_rangeElemValue`) | `codegen/statements.js`, `codegen/expressions.js` | `lower/ownership.js` |
| Address-taken boxing (`{ value }`) | codegen + typechecker | `lower/boxing.js` |
| Range shape (indexed / map / string / int / iterator) | `codegen/statements.js` | `lower/range.js` |
| Named-return pre-declaration, `defer` structure | codegen | `lower/functions.js` |
| Embedded promotion / delegation stubs | codegen | `lower/embedding.js` |
| **New:** captured-and-mutated variables (needed by WASM closures) | — | `lower/captures.js` |
| **New:** pointer-retention escape analysis (boundary rule) | — | `lower/escape.js` |

- **Two-step implementation:**
  - **1a. Extract existing side-tables (zero behavior change):** Move ownership/clone elision, boxing, range, functions, and embedding to `src/lower/`. The WASM backend reads the side tables; JS codegen keeps using the same `_`-prefixed node fields (the `lower/` passes are the shared source of those decisions, JS codegen is not rewired in 1.5). *Safety net:* All ~1,400 existing tests and E2E must be byte-identical to v1.4.0.
  - **1b. Add new analyses:** Implement `captures.js` (tracked mutated variables for WASM closure env boxing) and `escape.js` (pointer retention across the WASM boundary). Unused by JS codegen, tested via targeted AST analysis tests. `escape.js` is intra-procedural: it flags pointer parameters stored into struct fields, globals, closures or returned, but does not follow a pointer through a call into another function.
- **Bonus:** v2.0.0 then *ports* a clean `lower` instead of untangling codegen during the port.

### 2. Package targets & diagnostics

- **Directive:** `//gofront:target wasm` or `//gofront:target both` as a line comment before `package` in any file of the package. The lexer must keep `//gofront:` directive comments (today all comments are dropped). Conflicting directives across files are an error. No directive means `js`.
- **Import rules:**
  - `js` imports anything.
  - `wasm` imports `wasm`, `both` and the supported stdlib.
  - `both` imports only `both` and the supported stdlib.
- **`both` packages:** package-level `var`s may not be written after init.
- **Diagnostics:** exactly the [target diagnostics table](../v1.6.0/wasm-hybrid-plan.md#target-diagnostics), plus the **per-package summary line**. Features deferred to v1.6 get a distinct message: `'defer' is not yet supported in wasm packages (planned)`.

### 3. JS strict numeric mode (`both` packages only)

| Operation | Strict codegen |
|---|---|
| `float32` arithmetic | `Math.fround(a op b)` |
| `int8/16/32` arithmetic | `(a op b) \| 0`, then sign-extend for 8/16 (`<< 24 >> 24`) |
| `uint8/16/32` arithmetic | `(a op b) >>> 0` / `& 0xFF` / `& 0xFFFF` |
| `int32 * int32` | `Math.imul(a, b)` |
| Shifts | Go semantics: counts ≥ width give `0` (or `-1` for negative signed `>>`), not JS's `count & 31` |
| Integer `/`, `%` by zero | panic |
| `int`/`int64` | unchanged (float64). Dev builds assert the safe-integer range. |

Normal `js` packages are unaffected.

### 4. WASM backend (`src/backend/wasm/`)

```
src/backend/wasm/
  index.js      lowered AST + types → module IR (types, funcs, globals, exports, imports)
  types.js      GoFront types → WasmGC types (rec groups for recursive structs)
  emit.js       statements/expressions → instructions
  encode.js     module IR → binary (Uint8Array, LEB128, sections)
  wat.js        module IR → WAT text (--emit-wat, golden tests)
  glue.js       JS facades + loader

runtime/wasm/*.go   runtime written in GoFront (slice growth, string helpers, panics).
                    Lives at the repo root, not under src/, so the v2.0.0 Go engine compiles the same files.
```

**v1.5 language subset:**

| Feature | Representation |
|---|---|
| `bool`, `int8…int32`, `uint8…uint32` | `i32` (narrow types re-extended) |
| `int`, `uint`, `int64`, `uint64` | `i64` |
| `float32`, `float64` | `f32`, `f64`. `math.Sqrt/Floor/Ceil/Trunc/Abs/Min/Max/Copysign` native. `math.Sin/Cos/Atan2/Pow/…` imported from JS `Math`. |
| Structs, pointers, methods, embedding | `(struct (mut …))`, `(ref null $T)`, boxed scalars |
| Arrays `[N]T` | `(array (mut T))` |
| Slices `[]T` | `(struct (ref $arr) i32 off, i32 len, i32 cap)` with `append`, `copy`, `len`, `cap`, 3-index slicing |
| Strings | JS strings as `externref` via JS String Builtins (polyfilled through imports): literals, `+`, `==`/`<`, `len`, indexing, `range` |
| `any` / `interface{}` | `anyref`. Assertions and type switches on **concrete types** via `ref.test`/`ref.cast`. Holds JS values opaquely. |
| Func values & closures | `(struct funcref, anyref env)` + `call_ref`. Captured-mutated vars boxed (`lower/captures.js`). |
| `if`/`for`/`switch`/labels/`fallthrough`, multi-value returns | structured control flow, native multi-value |
| `panic`, bounds/nil/div-zero checks | `throw` with one exception tag. **No `try` blocks are needed in v1.5**, so the exception-handling encoding question (`exnref` vs. legacy) waits until v1.6 brings `recover`. |
| `print`/`println`, `fmt.Println` | imported `console.log` |
| Stdlib | `math`, `math/bits`, `errors.New`, `strconv.Itoa/FormatFloat`, `fmt.Sprintf` (subset via runtime) |

**Linking:** all `wasm` + `both` packages in the build go into **one `app.wasm`** with one runtime instance.

### 5. Boundary v1 (`js` package importing a `wasm` package)

For each imported `wasm` package, the backend generates a facade with the same API shape the JS backend would have emitted:

| Exported type | Crossing |
|---|---|
| bool, ints ≤ 32-bit, floats | direct |
| `int`, `int64` | via `number` (safe-range check in dev) |
| `string` | zero-copy `externref` |
| struct value (`both` types like `mathx.Vec3`) | marshalled field-wise to/from the JS class from the JS copy of the package |
| `*T` where `T` is in a `wasm` package (`*collision.Trimesh`) | handle facade: getters/setters, methods, stable identity |
| `*T` where `T` is in a `both` package (`*mathx.Vec3`) | copy-in/copy-out per call. A compile error if `lower/escape.js` finds the WASM side retains it. |
| `[]float32`, `[]int32`, `[]uint8`, … | copied to/from TypedArrays |
| `any` | JS values round-trip opaquely. WASM refs become handle facades. |
| JS func passed into WASM (e.g. `RayOptions.Callback`) | `externref` + generic invoke import |
| WASM func returned to JS, maps, non-empty interfaces | compile error: `not yet supported across the wasm boundary (planned)` |

**Loader:** `app.js` starts with `await WebAssembly.instantiateStreaming(fetch("app.wasm"), imports)` (top-level await), feature-detects the required proposals, and reports a clear error otherwise.

### 6. CLI & tooling integration

- **Backend architecture (`src/backend/`):** move `src/codegen/` → `src/backend/js/` to establish symmetric backends alongside `src/backend/wasm/`. Update Sentrux layer `backend` at order 2. Maintain a transitional re-export shim in `src/codegen/index.js` to ensure zero breaking changes.
- **`compiler.js`:** builds the package graph with targets. Dispatches symmetrically to `backend/js` and `backend/wasm`. `both` packages go through both backends. Facades are emitted for the boundary. Outputs are `{ js, css, wasm, wat? }`.
- **`build`:** writes `app.wasm` next to the bundle. The PWA precache includes it.
- **`dev`:** `dev-server.js` serves `.wasm` as `application/wasm`. Live reload rebuilds both outputs.
- **`--emit-wat`:** writes `app.wat` for debugging.
- **`check`:** target diagnostics + summary.
- **`test`:**
  - `wasm` packages run in WASM.
  - **`both` packages run twice, JS-strict and WASM, and the results must match.**
  - `js` packages importing `wasm` packages run against the hybrid bundle (JSDOM with `--dom`, as today).
- **Node:** JS-only use keeps `engines: >=20`. Using WASM targets needs a Node with WasmGC on by default. That version is checked at startup with a clear message and documented in the README.
- **Packaging:** add `runtime/` to `package.json` `"files"` (currently only `src/`), so the npm package ships the GoFront runtime sources.

### Rejected alternatives

- **Wait for v2.0.0 and build WASM only in Go.** That delays the go/no-go answer by a full rewrite cycle, and v2.0 would have to design `lower` during the port.
- **Emit WAT and shell out to `wat2wasm`/`wasm-tools`.** That adds an external dependency to every build. The encoder is small.
- **Binaryen.js as the encoder/optimiser.** A large dependency, and its IR would shape the backend. It may come back later as optional `wasm-opt`.
- **Full hybrid in v1.5.** Interfaces, generics, maps, `defer`/`recover` and shared buffers roughly double the scope. The core subset already covers the compute the benchmark has to measure.

---

## simplefps Split for v1.5

From an inspection of `engine/physics`:
- Math, octree and trimesh need only structs, slices, methods and `math`.
- `ray.go` adds `interface{}` fields (`Shape`, `Body`) and a `Callback func(*RaycastResult)`. Both are covered by the `any` and JS-func-into-WASM support.
- `dynamicbody.go` needs the non-empty `RaycastProvider` interface, which is deferred.

| Package | Target | Contents |
|---|---|---|
| `engine/mathx` (new) | `both` | `vec3`, `mat4`, `quat`, `transform`, `boundingbox` (moved from `physics`) |
| `engine/collision` (new) | `wasm` | `trimesh`, `octree`, `ray` (moved from `physics`) |
| `engine/physics` | `js` (for v1.5) | `dynamicbody`, `fpscontroller`. Imports `mathx` + `collision`. Moves to `wasm` in v1.6 once interfaces land. |
| `rendering`, `scene`, `systems`, `assets`, `animation`, `game` | `js` | import `mathx` instead of `physics` for math types |

The boundary per frame is then raycasts (gameplay, bodies, controller), each a single call into `collision`.

---

## Edge Cases

- **Go shift semantics:** a shift count ≥ the operand width gives `0` (or `-1` for negative signed `>>`). WASM and JS both mask the count, so both backends need explicit handling (strict JS mode and WASM).
- **Narrow integer wrap:** `int8(127) + 1 == -128` in WASM and JS-strict. Normal JS mode is unchanged (documented semantic difference).
- **`float32` rounding:** every intermediate is rounded in both WASM and JS-strict, including compound assignment and `++`.
- **Integer division by zero:** panics in WASM and JS-strict. `MinInt32 / -1` wraps (Go) and must not trap (WASM `i32.div_s` traps, so emit a guarded sequence).
- **Nil pointer dereference:** WASM `struct.get` on null traps. The backend emits an explicit check so the panic message matches the JS backend's.
- **Recursive struct types** (`OctreeNode` children): emitted in one recursive type group.
- **Struct values inside slices:** element reads copy unless `lower` elides the copy, matching JS semantics exactly.
- **Handle identity:** the same WASM object always maps to the same facade instance. Verify early whether WasmGC refs work as `WeakMap` keys in all target engines. Fallback: store the facade back-reference in an `externref` field.
- **Copy-in/copy-out with aliasing:** the same `*Vec3` passed as two arguments must not be copied in twice. Alias detection is done in the facade.
- **`any` holding a JS value inside WASM** is opaque: assertions to GoFront types fail cleanly (comma-ok `false`), and `==` compares by identity.
- **`both` package test with package-level state written in tests:** allowed in `_test.go` files only, since each target runs its own process.
- **Hot reload:** a changed `.wasm` must not be served from a stale cache. Dev server sends `Cache-Control: no-store` for `.wasm`.
- **Panics crossing into JS:** surface as a JS `Error` with the Go panic message. JS `recover` in the caller works as with JS-thrown panics.

---

## Test Plan

- **Refactor safety (Phase 1):** full unit suite, `test:examples`, `test:examples:dom` and E2E are byte-identical before and after the `lower` extraction. A temporary CI job diffs emitted JS for all examples against v1.4.0.
- **Unit — encoder (`test/unit/wasm/encode.test.js`):** golden bytes for LEB128, each section, GC type forms, rec groups, and representative instructions. Every module passes `WebAssembly.validate`.
- **Unit — WAT golden (`test/unit/wasm/wat.test.js`):** small programs → reviewed WAT snapshots.
- **Unit — runtime fixtures (`test/unit/wasm/*.test.js`):** new helper `compileHybrid()` runs each fixture as JS-strict and WASM and asserts identical output (stdout, results, panic messages). Covers every row of the subset and the edge cases above.
- **Unit — boundary:** every row of the boundary table, plus aliasing, identity, `any` round-trips, JS callbacks, panics into JS, and retention errors.
- **Negative — diagnostics:** every target diagnostic and "not yet supported (planned)" message, with exact text, position, caret and summary line.
- **Unit — strict mode:** JS-strict vs. normal JS on overflow, shifts, `float32` rounding, div-by-zero.
- **Integration:** `gofront test` on a sample hybrid project (wasm + both + js packages), dev-server MIME/caching test, build output test (`app.wasm` + PWA manifest).
- **simplefps:** `mathx` tests on both targets, `collision` tests in WASM, full game suite and manual play on the hybrid build.
- **Benchmark (`test/e2e/perf/raycast-bench.js`, new):** a real Möller–Trumbore + octree raycast workload (a simplefps level mesh or a generated mesh of 100k+ triangles, 100k rays). Runs JS-only vs. hybrid in Node and headless Chromium. Reports rays/s and allocation counts. The existing `zero-alloc.js` uses a stub intersection and is not representative.

---

---

## Implementation Tasks

### Phase 1: Shared Lowering & Analyses (`src/lower/`)
- [x] **Phase 1a — Side-table extraction:** Move ownership, boxing, range, functions, embedding to `src/lower/`. All ~1,400 tests, `test:examples`, E2E byte-identical to v1.4.0.
- [x] **Phase 1b — New analyses:** Implement `lower/captures.js` (closure envs) and `lower/escape.js` (pointer retention). Dedicated AST analysis unit tests pass.

### Phase 2: Package Targets & Diagnostics
- [x] **Phase 2a — Target directives & rules:** `//gofront:target` in lexer, target import rules, package summary diagnostic line. Target and negative diagnostic tests pass.
- [x] **Phase 2b — JS strict numeric mode:** JS strict numeric mode for `both` packages (`Math.fround`, `|0`, `Math.imul`, Go shifts, div-zero). Parity tests pass against normal JS.

### Phase 3: Core WASM Backend & Scalars
- [x] **Phase 3a — Minimal binary encoder & WAT writer:** LEB128, headers, type/func/export/code sections (`encode.js`, `wat.js`). Hardcoded `add(i32, i32)` passes `WebAssembly.validate()` & runs.
- [x] **Phase 3b — Module IR & scalar emission:** `i32/i64/f32/f64`, locals, Go arithmetic & control flow (`block/loop/br_if`). Numeric & loop fixtures: WASM == JS-strict.
- [x] **Phase 3c — Traps & Math imports:** `panic` tag, div-zero & nil guards, and JS `Math` imports (`math.Sin/Cos/...`). Parity tests and math tests pass.

### Phase 4: Types & Runtime Constructs
- [x] **Phase 4a — Structs, pointers & methods:** `struct.new`, `struct.get/set`, and rec groups. `mathx.Vec3` operations and methods run in WASM.
- [x] **Phase 4b — Arrays & slices:** `(array (mut T))`, slice header struct, `len`/`cap`/indexing, `append` with growth. Slice manipulation & growth fixtures pass. *(Deviation: `append` is emitted directly by `emit.js` instead of a GoFront-written `runtime/wasm/slice.go`; the Go-source runtime is deferred.)*
- [x] **Phase 4c — Strings & any:** JS String Builtins (`externref`) + `anyref` with concrete casts (`ref.test`/`ref.cast`). String concatenation/comparison and `any` fixtures pass.
- [x] **Phase 4d — Closures:** `(struct funcref, anyref env)` + `call_ref`, boxed environments via `captures.js`. Closure and callback fixtures pass.

### Phase 5: Boundary & Tooling Integration
- [ ] **Phase 5a — Boundary v1 (Values):** Facades for primitives and struct values (`mathx.Vec3` <-> JS class). Struct passing across boundary matches JS-only results.
- [ ] **Phase 5b — Boundary v1 (Slices & Handles):** TypedArray copy for slices and opaque handles (`*collision.Trimesh` with stable identity). Identity & slice tests pass.
- [ ] **Phase 5c — Tooling & linking:**
  - Backend restructuring: migrate `src/codegen/` → `src/backend/js/` (with transition re-export shim in `src/codegen/index.js`), update `.sentrux/config.toml` layer order 2 (`backend`).
  - Loader, single `app.wasm` linking, `compiler.js` pipeline dispatching to `backend/js` and `backend/wasm`, dev-server MIME, dual-target test runner.
  - Hybrid sample project builds, serves, and passes dual-target tests.

### Phase 6: simplefps Validation & Go/No-Go Benchmark
- [ ] **Phase 6a — simplefps split:** `engine/mathx` (`both`) and `engine/collision` (`wasm`). `mathx` passes on both targets, `collision` passes in WASM.
- [ ] **Phase 6b — Raycast benchmark harness:** `test/e2e/perf/raycast-bench.js` (100k+ triangles, 100k rays). Automated benchmark produces repeatable rays/s & alloc numbers.
- [ ] **Phase 6c — Verification & publish:** Full game verification (manual play at 60 FPS) & publish benchmark in README / CHANGELOG. simplefps runs hybrid. **Go/no-go benchmark published.**

**After Phase 6:** if the benchmark and determinism results justify it, v1.6.0 completes the hybrid in the JS compiler, and v2.0.0 ports the finished result. If not, the WASM backend stays as a documented experimental target, v1.6.0 is dropped or repurposed, and v2.0.0 ports the v1.5 subset as-is without further investment.
