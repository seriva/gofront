# Hybrid JS + WebAssembly Target — Design Plan

**Version:** v1.6.0 (design spans v1.5.0 → v1.6.0, see [Phased Roadmap](#phased-roadmap))  
**Status:** Completed (2026-10-10) — full hybrid completed in the JS compiler as v1.6.0, before the v2.0.0 Go port. Whole-app WASM moved to [Future](#future-whole-app-wasm).  
**Depends on:** [`docs/v1.5.0/wasm-mvp-plan.md`](../v1.5.0/wasm-mvp-plan.md) (MVP: `src/lower/`, targets, strict mode, encoder, core subset, boundary v1).  
**Followed by:** [`docs/v2.0.0/native-go-engine.md`](../v2.0.0/native-go-engine.md), which ports the finished JS + WASM compiler to Go with byte-identical output.

This document is the **full design** of the hybrid model. v1.5.0 implements a core subset in the JS compiler and v1.6.0 completes it there, still in the JS compiler (`src/backend/wasm/`). v2.0.0 then ports the whole thing to Go without new features.

---

## Goal

Let one GoFront app run **partly as JavaScript and partly as WebAssembly (WasmGC)**, chosen per package:

- **UI and browser code stays JS:** DOM, `.templ`, `gom`, `async`/`await`, WebGL calls, npm libraries. It runs at native JS speed with today's codegen.
- **Engine code compiles to WASM:** simulation, collision, spatial structures, pathfinding, procedural generation. It gets Go-correct integers, real `float32` and predictable performance.
- **The compiler owns the boundary.** It sees both sides, so it generates all the glue. Importing code is written the same way whatever the target of the imported package.

The hybrid architecture is the optimal end-state for browser apps: it leaves UI and DOM in native JS (avoiding the severe host-call penalty of WASM DOM manipulation), while accelerating compute and simulation in WasmGC. Whole-app WASM remains an extension for headless or pure Canvas/WebGL applications where no DOM is present.

**Done means:**
- `simplefps` runs with its simulation in WASM and its rendering/UI in JS.
- The relevant `_test.go` suites pass on their targets. Dual-target packages pass on both.
- A new `example/hybrid` passes its E2E suite.
- Benchmarks comparing JS-only and hybrid builds are published, whatever they show.

---

## Out of Scope (v1.6.0)

- **DOM, browser globals, `js:`/npm imports, `.templ`, `gom` inside WASM packages.** That is the [whole-app future](#future-whole-app-wasm).
- **`async`/`await` in WASM packages.** WASM code is synchronous. Async orchestration stays in JS.
- **Linear-memory runtime / custom GC.** WasmGC for all objects. Linear memory is used only for explicit [shared buffers](#shared-buffers-zero-copy).
- **WASI / server targets, DWARF, statement-level WASM source maps.** Browser only (function-level `app.wasm.map` shipped in H7.2).
- **Goroutines, channels, `reflect`, `unsafe`.** Same as the JS target.
- **Porting to Go.** That is v2.0.0. v1.6.0 lives entirely in the JS compiler.

---

## Package Targets

Each package has a target, declared once in any of its files:

```go
//gofront:target wasm     // compiled to WASM only
//gofront:target both     // compiled to JS *and* WASM; each side uses its own copy
package physics           // no directive = js (default, today's behaviour)
```

| Target | Compiled to | May import | Restrictions |
|---|---|---|---|
| `js` (default) | JS | anything | none (today's language) |
| `wasm` | WASM | `wasm`, `both`, stdlib (WASM-supported subset) | WASM subset (below) |
| `both` | JS + WASM | `both`, stdlib (subset) | WASM subset. **No package-level mutable state** (each side would get its own copy). |

- **The boundary exists only where a `js` package imports a `wasm` package.** `both` packages never create a boundary: a JS caller uses the JS copy and a WASM caller uses the WASM copy.
- **Values of `both` types cross the boundary by layout.** A `Vec3` returned from WASM arrives in JS as the JS backend's `Vec3` class instance, and the reverse.
- **All `wasm` + `both` code in an app links into one `app.wasm`** with one runtime instance.
- **The checker enforces the import rules** with targeted errors (e.g. "package `physics` (wasm) cannot import `systems` (js)").
- **A mutable-state rule for `both` packages:** package-level `var`s are only allowed if they're never written after init. Package-level scratch values, as in `dynamicbody.go`, belong in `wasm` packages.

### WASM subset (applies to `wasm` and `both`)

Allowed:

- All numeric types, `bool`, `string`, structs, pointers, methods, embedding
- Arrays, slices, maps
- Interfaces, type switches, closures, method values, generics
- `defer`/`panic`/`recover`, labeled `break`/`continue`
- `print`/`println`, routed to `console.log` through a runtime import so debugging works the same as in JS packages
- Stdlib: `math`, `math/bits`, `errors`, `strings`, `strconv`, `unicode/utf8`, `slices`, `maps`, `sort`, `testing`, `gofront/shared` (`wasm` packages); `fmt.Sprintf`/`Printf`/`Errorf`/`Println`

### Target diagnostics

The type checker rejects anything outside the subset in `check`, `dev` and `build`. Each case has a **targeted message** naming the package's target and where the code should go instead:

| Inside a `wasm`/`both` package | Diagnostic |
|---|---|
| `.templ` file in the package | `.templ files are not allowed in wasm packages; move 'hud.templ' to a js package` |
| `css` declaration | `css declarations are not allowed in wasm packages` |
| Browser global (`document`, `window`, `console`, `localStorage`, …) | `'document' is not available in wasm packages` |
| `import "js:…"` or npm/`.d.ts` types | `js: imports are not allowed in wasm packages` |
| `gom` usage | `package 'gom' is not available in wasm packages` |
| `async func` / `await` | `async functions are not supported in wasm packages; keep async code in a js package` |
| Importing a `js` package | `package 'physics' (wasm) cannot import 'systems' (js)` |
| `both` package importing a `wasm` package | `package 'mathx' (both) can only import 'both' packages; 'physics' is wasm` |
| Package-level `var` written after init in a `both` package | `package-level variable '_scratch' is mutated; not allowed in 'both' packages (each target gets its own copy)` |
| Stdlib shim not yet ported | `'regexp' is not yet available in wasm packages` |

Example output, using the existing diagnostic format:

```
Type error in engine/physics/dynamicbody.go at line 5:5: 'document' is not available in wasm packages
  (package 'physics' is //gofront:target wasm — browser globals are only available in js packages)
    5 |     document.getElementById("debug").textContent = "stepping"
            ^
```

**Per-package summary.** If a package has target errors, `check` finishes with one summary line per package. Switching a package to `wasm` then produces a ready-made migration checklist:

```
package 'animation' cannot be wasm: 3 blockers — 1 js package import (systems), 1 browser global (console), 1 async function
```

These are **"not yet" rules, not "never" rules.** The [whole-app future](#future-whole-app-wasm) relaxes them step by step. Some then become "allowed, crosses the boundary" hints instead of errors. In `js` packages nothing changes.

### How UI and engine packages talk

Dependencies point one way: **`js` packages import `wasm` packages, never the reverse.** The UI pulls state from the engine. The engine signals the UI through callbacks passed in from JS.

```go
// game/hud.templ — js package, unchanged templ
templ HUD(p *physics.FPSController) {
    <div class="hud">Speed: { fmt.Sprintf("%.1f", p.Speed()) }</div>   // call into wasm, number comes back
}
```

```go
// game/game.go — js package
body := physics.NewDynamicBody(physics.DynamicBodyConfig{
    OnBounce: func(hp, hn *mathx.Vec3, speed float32) {
        sound.Play("bounce", speed) // wasm calls back into JS → Web Audio
    },
})
```

The rule of thumb: **the engine computes, the JS side shows.** When WASM code seems to "need" the DOM, that logic belongs in a `js` package, connected through a return value, a callback, or a [shared buffer](#shared-buffers-zero-copy).

---

## Cross-Target Determinism for `both` Packages

A `both` package runs as two separate implementations of the same code, so they must agree. Otherwise a raycast in WASM and the same raycast in JS return different results. The JS backend therefore compiles `both` packages in **strict numeric mode**:

| Operation | Normal JS codegen | Strict mode (`both` packages) |
|---|---|---|
| `float32` arithmetic | float64 | `Math.fround(...)` after each op (JIT intrinsic, cheap) |
| `int32`/`int16`/`int8` arithmetic | float64 | `\| 0` / sign-extend after each op |
| `uint32`/… arithmetic | float64 | `>>> 0` / mask after each op |
| `int`/`int64` | float64 (safe to 2⁵³) | unchanged. Dev builds check the safe range in strict mode. |
| Integer `/` and `%` by zero | `Infinity`/`NaN` | panic |

Strings (JS strings in both targets, see below) and map iteration order (insertion order in both targets) already agree. The remaining known divergence is `int64` beyond 2⁵³, documented as unsupported in `both` packages.

Strict mode could become a general opt-in for `js` packages later (`//gofront:strict`). That's out of scope for v1.6.0.

---

## WASM Code Generation (WasmGC)

| GoFront | WasmGC representation | Notes |
|---|---|---|
| `bool`, `int8…int32`, `uint8…uint32` | `i32` | narrow types re-extended after arithmetic |
| `int`, `uint`, `int64`, `uint64` | `i64` | converted via `number` at the boundary |
| `float32` / `float64` | `f32` / `f64` | native `sqrt/floor/ceil/trunc/nearest/abs/min/max/copysign` |
| `complex64/128` | immutable `(struct f32 f32)` / `(struct f64 f64)` | |
| `struct T` | `(struct (mut …))` | value copies via `struct.new`, elided by `lower`'s ownership analysis |
| `*T` (struct) | `(ref null $T)` | |
| `*T` (scalar), address-taken scalars | `(struct (mut T))` box | same `Info.Boxed` decision as JS. No interior pointers on either target. |
| `[N]T` | `(array (mut T))` | |
| `[]T` | `(struct (ref $arr) i32 off, i32 len, i32 cap)` | real slices: `cap`, 3-index, amortised `append` |
| `string` | JS string as `externref` via JS String Builtins (`wasm:js-string`), polyfilled through imports where unavailable | same semantics as JS (`len` = UTF-16 units), zero-copy across the boundary |
| `map[K]V` | insertion-ordered hash map (runtime) | same iteration order as JS |
| interface | boxed value as `anyref` (concrete struct ref, or box for scalars); method calls dispatch via `ref.test` chains over the candidate implementing types, no itab | the "itab" design in H4.1 was replaced by static candidate sets: cheaper for the small type sets of game code, no runtime tables |
| func values / closures | `(struct funcref, anyref env)` + `call_ref` | |
| generics | monomorphised (deduplicated by layout) | JS stays erased |

- **Control flow:** structured (`block`/`loop`/`br`/`br_table`). No `goto` means no relooper. `fallthrough` becomes nested blocks.
- **Multiple results:** native multi-value.
- **`panic`:** an exception tag.
- **`defer`:** a defer list in `try_table` + `catch_all_ref`, rethrowing unless `recover()` ran. Each deferred call runs under its own `try_table` so a panic raised in a defer replaces the in-flight one (Go semantics). `recover()` is armed only for the frame that is a direct defer target (an `armed` global copied into a local in the prologue); a `recover()` reached through a helper or nested closure returns `nil`. The JS backend mirrors this with `__gopanic.armed` / `__recover(ok)`, and `lower/functions.js` normalises `defer` for both backends.
- **Panics crossing the boundary:** a panic escaping a WASM export becomes a JS `Error` the JS side can `recover`. A JS panic thrown inside a callback invoked from WASM unwinds through WASM `defer`s.
- **Type switches:** `ref.test`/`ref.cast` for concrete structs, `typeId` otherwise.
- **Runtime** (`runtime/wasm/*.go`): written in GoFront and compiled by this backend. Maps, string helpers, `strconv`/`fmt` formatting, slice growth. Tree-shaken. Transcendental `math` (`Sin`, `Atan2`, `Pow`, …) is imported from JS `Math`, which also matches JS-target results exactly.

The no-runtime rule still holds for JS output. The WASM runtime is a target-scoped exception.

---

## The JS ↔ WASM Boundary

For every `wasm` package imported by `js` code, the compiler generates a **JS facade module** with the same API shape the JS backend would have produced (functions, classes, methods, fields), backed by WASM exports. JS callers are compiled exactly as if the package were JS.

| Type in an exported signature | Crossing strategy |
|---|---|
| bool, ints ≤ 32-bit, floats | direct (`i32`/`f32`/`f64` ↔ `number`) |
| `int`, `int64`, `uint64` | via `number` (safe-range check in dev builds) |
| `string` | zero-copy (`externref`) |
| struct **value** (`T`) | marshalled field-wise into or out of the JS class instance (`both` types: the class from the JS copy of the package) |
| pointer to a **`wasm`-package struct** (`*Body`) | **handle**: facade class wrapping the WasmGC ref. Fields become getters/setters calling generated accessors. Methods call exports. Identity is preserved (one facade object per ref, via a `WeakMap`-style cache). |
| pointer to a **`both`-package struct** (`*Vec3`) | **copy-in / copy-out** for the duration of the call (mutation is visible to the caller). If escape analysis in `lower` shows the WASM side *retains* the pointer, it's a compile error: "pointer to JS-owned `Vec3` retained by wasm; store a value or use a wasm-owned handle". |
| numeric slices (`[]float32`, `[]int32`, …) | copied into or out of TypedArrays (matches the JS backend's TypedArray mapping) |
| other slices | element-wise copy |
| shared buffers | zero-copy (see below) |
| func values (callbacks) | **JS → WASM:** JS function held as `externref`, called through a generic invoke import. **WASM → JS:** closure wrapped in a cached JS function calling an exported trampoline. Covers `OnBounce`-style hooks. |
| interfaces | **WASM value passed to JS:** the handle class (or `both` live view) when the dynamic type is an exported `*T` whose JS class has every method; otherwise a facade object with the interface's methods calling WASM exports. Identity is stable per WASM object. **JS-implemented value passed into WASM:** not supported via dynamic itab proxies. `check` rejects a `js`/`both` type converted to a `wasm` interface, and the facade throws a `TypeError` for anything without a WASM ref or whose WASM type does not implement the interface. Values that reach the interface through `any` (e.g. stored in an `any` field and type-asserted on the WASM side) bypass the `check` diagnostic and are only caught by that runtime check. Keep provider implementations in WASM or pass typed function callbacks (`func`). Avoids slow double-boundary hops. Named interfaces only. |
| maps | not allowed in exported signatures in v1.6.0. Use slices or methods. |

**Design rule: keep the boundary coarse and per-frame.** One `world.Step(dt)`, a few controller updates and a handful of raycasts per frame are cheap. Fine-grained calls such as `Vec3.Add` from JS into WASM thousands of times per frame are exactly what `both` packages exist to avoid. `gofront check` can report boundary call sites inside loops in `js` packages as **hints**, not errors.

### Shared buffers (zero-copy)

Bulk per-frame data (transforms, bone matrices, particle positions) must not be copied every frame. A WasmGC array cannot be viewed from JS, so shared buffers live in **linear memory**:

```go
import "gofront/shared"

var Transforms = shared.NewFloat32(maxEntities * 16) // in a wasm package

// wasm side: Transforms[i*16+3] = x   (indexing and len work like a slice; no append)
// js side:   gl.uniformMatrix4fv(loc, false, physics.Transforms.Subarray(i*16, i*16+16))
```

- `shared.Float32`, `shared.Int32`, `shared.Uint8`, … are fixed-size, allocated once from a bump allocator in exported linear memory, and live for the whole program (no freeing in v1.6.0).
- **Allocation discipline:** `shared.New*` calls are intended for package-level / startup allocations. The compiler rejects or warns on allocations in runtime loops to prevent unbounded linear memory growth.
- **Detached ArrayBuffer hazard:** Calling `memory.grow` in WebAssembly detaches existing JavaScript `ArrayBuffer` instances and typed array views, throwing a `TypeError` if JS code accesses a cached view. To guarantee safety:
  - All `shared.New*` allocations run inside the module start function (package-level initializers and `init()`), which is the only place the bump allocator may call `memory.grow`. By the time JS obtains its first view, the memory has reached its final size and never grows again.
  - JS facade accessors verify view validity against the live `memory.buffer` and refresh the view if it ever differs.
- **Linear memory vs. GC slice distinction:** `shared.Float32` is a linear-memory buffer, whereas Go `[]float32` in WasmGC is an object slice referencing a GC array. The compiler explicitly rejects passing a `shared` buffer to functions expecting GC slices (`cannot use shared.Float32 as []float32: linear-memory buffer cannot be passed as a GC slice without an explicit copy`), preventing confusing internal type errors. `copy(dst, src)` is the explicit copy and requires identical element types on both sides.
- **WASM side:** loads and stores at a base offset. Index syntax and `len` are supported. `append` and reslicing beyond the bounds are rejected.
- **JS side:** a live TypedArray view.
- **In pure-JS builds (`--js-only`) and `js` packages:** a plain TypedArray, so the same code compiles on either target. `both` packages may not import `gofront/shared`: the JS copy has no linear memory to share, so a buffer created there could never be the same memory the WASM copy sees.

---

## Build, Dev & Test Integration

- **`build`:** `app.js` (JS packages + generated facades + loader) + `app.wasm` (all `wasm`/`both` code, one module) + `app.css`.
  - The loader uses `WebAssembly.instantiateStreaming` with top-level `await` before `main()`.
  - **Asset URL Resolution (`import.meta.url`):** The loader resolves `app.wasm` relative to `import.meta.url` (`new URL("app.wasm", import.meta.url).href`) with fallback to `globalThis.__GOFRONT_WASM_URL` or `"app.wasm"`. This ensures correct asset resolution when `app.js` is served from nested routes (e.g. `/game/play`), CDN origins, or subdirectories where relative `fetch("app.wasm")` would otherwise resolve against `document.baseURI` and 404.
  - **Target overrides & JS fallback builds:** Support `--js-only` (or `gofront build --target js`) and `gofront.json` `"targets"` config overrides to compile all packages to JavaScript. This enables zero-code-change A/B performance benchmarking and provides a fallback release build for browsers lacking WasmGC (Safari < 18.2 / iOS 17).
  - **Binaryen optimization pipeline (`binaryen` npm package):**
    - Built-in release optimization through the `wasm-opt` CLI shipped by the optional `binaryen` npm package (a JS-wrapped WebAssembly build run as a node child process; no native toolchain required).
    - Integrated into `gofront build --release` (or `--wasm-opt`).
    - Configures WasmGC features (`GC`, `ReferenceTypes`, `BulkMemory`, `Multivalue`, `ExceptionHandling`), optimization level (`-O3`), and GUFA (`--gufa`: devirtualization, type refinement, inlining, and dead type/code elimination).
    - Prefers a native `wasm-opt` binary if available on `PATH` for fastest execution, falling back to the `binaryen` npm package's `wasm-opt`.
    - Validates the optimized module with `WebAssembly.validate` prior to writing output.
  - The PWA precache includes `app.wasm`.
- **`dev`:** serves `.wasm` as `application/wasm`. Rebuilds both outputs directly via `src/backend/wasm/encode.js` without Binaryen optimization for sub-10ms instant hot reloads.
- **`check`:** target and import-rule diagnostics, WASM-subset errors, boundary-retention errors, boundary-in-loop hints.
- **`test`:**
  - `wasm` packages: tests are compiled to WASM and run in Node.
  - **`both` packages: tests run twice (JS and WASM) and the results must match.** This is the built-in determinism check.
  - `js` packages that import `wasm` packages: the hybrid bundle runs under Node (with JSDOM for `--dom`).
- **Tooling:** dependency-free binary encoder (`src/backend/wasm/encode.js`), built-in Binaryen optimizer pipeline (`src/backend/wasm/optimize.js`), `--emit-wat`, `WebAssembly.validate` on every module in tests, golden WAT tests, per-example size budget in CI.

---

## Platform Baseline

Required: **GC, typed function references, reference types, multi-value, bulk memory, sign-extension, exception handling.** Optional: JS String Builtins (polyfilled). JSPI is not used.

Exact minimum browser versions and the EH encoding (`exnref` vs. legacy) are fixed in v1.5.0 (the EH encoding in v1.6.0, when `recover` lands) and documented in the README (Chrome 119+, Firefox 120+, Safari 18.2+). The loader feature-detects and reports a clear error. The README states whether a JS-only fallback build is recommended. Node for WASM tests: the minimum version with GC + EH on by default, checked at startup.

### Concurrency & Web Workers Constraint

WasmGC object references and boundary handles (`externref`) **cannot** be transferred or cloned across Web Workers via `postMessage` under current browser specifications. Simulation or physics running in a Web Worker must either manage its own isolated WASM runtime instance or communicate strictly via linear memory (`ArrayBuffer` / `SharedArrayBuffer` when cross-origin isolated).

---

## Applying It to `simplefps` (reference split)

Current imports: `physics` is the only pure leaf (imports `math` only). `rendering`, `scene`, `game` and `animation` use `physics.Vec3`/`Mat4`/`BoundingBox` about 300 times. `animation` imports `systems` for `NewBinaryReader`.

| Package | v1.5.0 | v1.6.0 (end state) | Contents |
|---|---|---|---|
| `engine/mathx` (new) | `both` | `both` | `Vec3`, `Mat4`, `Quat`, `Transform`, `BoundingBox` (moved from `physics`) |
| `engine/collision` (new) | `wasm` | `wasm` | `Trimesh`, `Octree`, `Ray` + raycasting (moved from `physics`). Needs only the v1.5 core subset (`any` fields, JS callbacks). |
| `engine/physics` | `js` | `wasm` | `DynamicBody`, `FPSController`. Done in H5.3: the static-world provider is `collision.StaticWorld` (WASM), so controller/body raycasts never cross the boundary; the controller owns a `CameraPose` value that the game copies in/out per frame; `OnBounce`/`OnRest`/`OnLand`/`OnJump` call back into JS. |
| `engine/rendering`, `scene`, `systems`, `assets`, `game` | `js` | `js` | Import `mathx` instead of `physics` for math types |
| `engine/animation` | `js` | `wasm` | Done in H7.1: `NewBinaryReader` and `ParseBinaryAnimation` moved to `assets`, so `animation` imports only `mathx`. As a first cut it returned `[]mathx.Mat4` and measured at parity with JS (copied out per frame); `ComputeSkinningMatrices` now writes the palette into a `gofront/shared` buffer (`animation.SkinMatrices`) and returns the joint count — 1.27× JS on a 64-joint frame. |

The per-frame boundary in the end state: controller and body updates, raycasts from gameplay, and `OnBounce` callbacks back into JS (sound). That is a small, coarse set.

---

## Testing & Verification

- **Unit fixtures:** runtime tests in the WASM subset run under both targets through the `compileHybrid()` test helper introduced in v1.5.0. JS-strict and WASM outputs must match exactly. Normal JS mode differs only in the documented cases.
- **Boundary fixtures:** every row of the boundary table, in both directions, including panics, callbacks, interface proxies, copy-in/out and retention errors.
- **Diagnostic fixtures:** every row of the [target diagnostics](#target-diagnostics) table, with exact message, position, caret and per-package summary line.
- **`example/hybrid` (new):** a particle/n-body simulation in a `wasm` package, rendered to canvas from JS through a `shared.Float32`, with `.templ` controls. Playwright E2E.
- **`simplefps`:** `mathx` tests on both targets, `physics` tests on WASM, the full game suite on the hybrid build.
- **Benchmarks:** the zero-alloc ray-triangle benchmark (`test/e2e/perf`) and `simplefps` frame times, JS-only vs. hybrid, in Node and headless Chromium.

---

## Risks & Honest Expectations

| Risk | Mitigation |
|---|---|
| Speedup is modest. V8 is strong on monomorphic numeric JS. | **Go/no-go benchmark at H3.** Correct ints/`float32` and determinism are value even at speed parity. |
| Boundary design is subtle (copy-in/out, retention, proxies) | Compiler-owned glue, escape analysis, exhaustive boundary fixtures |
| Strict mode slows `both` packages on the JS side | Applies only to `both` packages. Measured. `Math.fround`/`\|0` are JIT intrinsics. |
| Users split in the wrong place and make the boundary chatty | Boundary-in-loop hints, documented guidance, `simplefps` as the reference split |
| Shared-buffer lifetime (no free) | Fixed-size, program-lifetime buffers in v1.6.0. Freeing/pools later if needed. |
| Platform support varies | Fixed baseline, feature detection, clear error |

---

## Phased Roadmap

The hybrid design is delivered over three releases. Both WASM releases land in the JS compiler, so the feature is complete before the rewrite:

| Release | Delivers | Plan |
|---|---|---|
| **v1.5.0** (JS compiler) | `src/lower/` extraction, targets + diagnostics, JS strict mode, encoder + WAT, core subset (scalars, structs, pointers, methods, arrays, slices, strings, `any`, closures, `panic`), boundary v1 (values, handles, copy-in/out + retention check, numeric slices, `any`, JS → WASM callbacks), simplefps `mathx` (both) + `collision` (wasm), **go/no-go benchmark** | [`docs/v1.5.0/wasm-mvp-plan.md`](../v1.5.0/wasm-mvp-plan.md) |
| **v1.6.0** (JS compiler, this document) | The rest of the hybrid (phases below) | — |
| **v2.0.0** (Go engine) | Port of the complete JS + WASM compiler to Go, with **byte-identical JS and `.wasm` output** as oracle gates. No new WASM features. | [`docs/v2.0.0/native-go-engine.md`](../v2.0.0/native-go-engine.md) |

---

## Implementation Tasks

<!-- v1.6.0 execution tasks (pending positive v1.5.0 go/no-go benchmark) -->

### Phase H4: Language Completeness in WASM
- [x] **Task H4.1 — Non-empty interfaces:** `ref.test` dynamic dispatch over static candidate sets (itabs were not needed).
- [x] **Task H4.2 — Generics:** Monomorphisation of generic types and functions for WASM target.
- [x] **Task H4.3 — Maps & stdlib:** Insertion-ordered map runtime and remaining stdlib subset in WASM.
- [x] **Task H4.4 — Defer & recover:** Exception handling emission (`exnref` vs legacy EH encoding). Language fixtures pass on WASM == JS-strict.

### Phase H5: Boundary v2 (WASM Closures & Boundary Discipline)
- [x] **Task H5.1 — WASM to JS closures:** Passing WASM closures across boundary into JS callers via cached trampolines.
- [x] **Task H5.2 — Boundary interface resolution:** Resolve boundary interfaces by keeping provider implementations on the WASM side or passing function callbacks, avoiding cross-boundary dynamic itab proxies.
- [x] **Task H5.3 — Physics migration:** Move `physics` (`DynamicBody`, `FPSController`) to `wasm` with full test suite passing.

### Phase H6: Shared Memory & Hybrid Example
- [x] **Task H6.1 — Linear-memory buffers:** Implement `gofront/shared` TypedArray zero-copy views.
  - Memory grows only inside the start function (allocation is startup-only), so no JS view can ever be detached; JS facade getters still verify view validity.
  - Typechecker diagnostics enforcing startup/package-level allocation discipline, rejecting implicit `shared.*` -> GC slice parameter conversions without explicit copy, and requiring identical element types in `copy()`.
- [x] **Task H6.2 — `example/hybrid` app:** Build and verify hybrid sample application with Playwright E2E.
- [x] **Task H6.3 — Asset loader URL resolution & target overrides:**
  - Robust `import.meta.url` relative resolution for `app.wasm` in `src/backend/wasm/boundary.js` so subpath routes and CDN setups do not 404.
  - CLI flag `--js-only` (or `gofront build --target js`) and `gofront.json` `"targets"` config overrides for zero-code-change A/B benchmarking and Safari < 18.2 fallback builds.

### Phase H7: simplefps Full Split & Verification
- [x] **Task H7.1 — simplefps final split:** Physics and collision in WASM; extract `NewBinaryReader` from `systems` to `assets` and migrate `animation` to WASM candidate. Done: `assets.NewBinaryReader`/`assets.ParseBinaryAnimation`; `animation` is `wasm` with skinning matrices published through `gofront/shared` (see table above). Surfaced and fixed three compiler bugs: method trampolines never generated (handle methods with `int` params threw `Cannot convert 0 to a BigInt`), `math.Mod`/`Hypot`/`Cbrt` unsupported in WASM plus `math.Round` half-even divergence, and the parse cache leaking an overridden `target` between `forceTarget` compiles. Follow-ups: (a) `__gfw_slout_*` returns a plain `Array` for numeric slices (`[]float32`) — the "numeric slices ↔ TypedArrays" intent is not met yet because the out-marshaller is keyed by wasm element type (`uint8` and `int32` both `i32`), so it needs the Go element type; (b) an exported constant in a `wasm` package that shares its name with a top-level symbol of a `js` package (`animation.MaxJoints` vs `rendering.MaxJoints`) produces `SyntaxError: Identifier 'MaxJoints' has already been declared` in the bundle — facade constants should be namespaced like the JS packages' symbols (simplefps renamed to `MaxSkinJoints` for now).
- [x] **Task H7.2 — Binaryen optimization pipeline & tooling:**
  - Add `binaryen` npm package as an `optionalDependency` (cross-platform, no native build tools); `--release`/`--wasm-opt` fail with an actionable error when neither it nor a native `wasm-opt` is present.
  - Implement optimizer wrapper (`src/backend/wasm/optimize.js`) configuring WasmGC feature flags (`Features.GC`, `Features.ReferenceTypes`, `Features.BulkMemory`, `Features.Multivalue`, `Features.ExceptionHandling`), optimization levels (`-O3`), and GUFA (`--gufa`).
  - Wire `--release` / `--wasm-opt` flags into `gofront build` CLI; detect native `wasm-opt` on `PATH` with fallback to `binaryen` npm module.
  - Assert module validity post-optimization via `WebAssembly.validate` and report size reduction metrics in CLI verbose output.
  - WASM source maps: `--source-map` writes a function-level `app.wasm.map` (one segment per function body offset recorded by the encoder, resolved `sources`) and embeds the `sourceMappingURL` custom section; with `--wasm-opt` the map is fed to Binaryen via `-ism` so offsets survive optimisation. Statement-level mappings are deferred.
  - Hardening follow-ups done alongside: every unit-test module is `WebAssembly.validate`d, a golden WAT fixture (`test/unit/fixtures/wasm/golden.wat`, `UPDATE_GOLDEN=1`) and size budgets (minimal module ≤ 3 KiB, golden ≤ 6 KiB) guard regressions; a boundary-call-in-loop warning in `js` packages; `gofront test` requires Node 22+ for `wasm`/`both` packages with a clear error.
- [x] **Task H7.3 — Documentation & benchmarks:** Target guide in README and published comparative benchmarks (reporting unoptimized vs `wasm-opt` binary size and raycast/fps throughput). Done: README "choosing a target" checklist + simplefps table (raycasts 1.11–1.15×, controller step 2.4× at 0.2 B/frame, skinning 1.27×, `app.wasm` 98.5 → 79.7 kB with `--release`); simplefps `npm run bench` (`tests/perf/js-vs-wasm.js`).

### Phase H8: Codebase Consolidation (zero functional change)

Pre-port cleanup from the 2026-10-09 codebase review. Every task is a pure refactor: all 1702 unit tests, `npm run check`, and the E2E suite must pass unchanged, and `example/*` output (JS and `.wasm`) must stay byte-identical. Smaller, deduplicated source is also a direct win for the v2.0.0 Go port (less to translate). ~500 lines expected to go.

- [x] **Task H8.1 — Single watch-mode implementation:** Legacy `--watch` / `--serve` path in `src/index.js` (`buildOnce`, `handleCssWatch`, debounce + `fs.watch` setup, ~90 lines) duplicates `buildDevOnce` / `setupDevWatchers` in `src/cli-core.js`. Delegate to `handleDev` (already accepts `srcDir`, `outputFile`, `port`, `sourceMap`); keep the legacy CLI output format (`stamp()` + clear-screen when no `-o`). Restores the "`index.js` is CLI entry only" rule.
- [x] **Task H8.2 — Legacy flag parser in `cli-core`:** Replace the ad-hoc `args.includes(...)` / `indexOf("-o")` block in `src/index.js` with `parseLegacyArgs(argv)` in `src/cli-core.js`, next to the other `parse*Args` functions, with unit tests (`--release` implies `--minify --mangle --wasm-opt`, `--no-wasm-opt` wins, `--serve` implies `--watch`).
- [x] **Task H8.3 — WASM emitter helpers:** Collapse the three hand-expanded patterns in `src/backend/wasm/`:
  - `_emitGrowSlice(...)` for the capacity-growth sequence duplicated verbatim in both branches of `_emitBuiltinAppend` (`emit-builtins.js`, ~60 lines each).
  - `_emitCopyIfValueStruct(node, goType, wType)` for the 15 `isValStruct && !isFresh → emitCloneStruct` sites in `emit-stmts.js`, `emit-exprs.js`, `emit-builtins.js`; all sites use the same `_resolveStructInfo(node) ?? getStructType(goType.name)` fallback.
  - `_emitSliceUnpack(sliceTmp, sliceInfo)` returning `{ arr, off, len, cap }` temps for the ~20 `local.get → struct.get N → local.set` unpack sequences.
  - Unary `math` switch in `emit-stdlib.js` (`Sqrt`/`Floor`/`Ceil`/`Trunc`/`Abs`) → `MATH_F64_UNARY` table.
- [x] **Task H8.4 — Shared AST child traversal in `src/lower/`:** Add `forEachChild(node, fn)` and `someChild(node, pred)` to `lower/index.js` and replace the 15 hand-rolled `for (key of Object.keys(node)) { if (key.startsWith("_")) continue; … }` loops in `boxing.js`, `captures.js`, `escape.js`, `functions.js`, `globals.js`, `ownership.js`, `range.js`. Skip side-table keys by a precomputed `Set` rather than a `startsWith` per key (hot path of the lowering pass).
- [x] **Task H8.5 — JS backend helper registry:** Replace the 40 scattered `this._usesXxx = true` flags (13 files) + constructor field list + `HELPER_MAP` entry per helper with `this.useHelper(name)` writing into a `Set`; `HELPER_MAP` iterates the set. Adding a runtime helper becomes a one-line change.
- [x] **Task H8.6 — Export surface & dead code:** Drop `export` from the 47 symbols nothing imports (17 section encoders in `encode.js`, `classifyType`, `WASM_LOADER_JS`, `peepholeOptimize`, `ModuleEmitter`, `typeKey`, `cloneAst`, `evaluatesToPointer`, `LowerResult`, `INT64`/`UINTPTR`/`COMPLEX64`, …). Delete the two fully dead symbols: `COMPARABLE` in `typechecker/types.js` (resolve.js builds the literal inline — use the constant there instead) and `resetNativeWasmOptCheck` in `backend/wasm/optimize.js`. Re-run `sentrux check` to confirm coupling metrics improve.
- [x] **Task H8.7 — Hygiene:** `package.json` description → "compiles to JavaScript and WebAssembly"; remove the empty untracked `gen/` and `dist/` directories; keep `files: ["src/"]` as the single npm whitelist and drop the redundant `.npmignore`.


---

## Future: Whole-App WASM (Headless & Canvas-Only)

The per-package hybrid model is the intentional, permanent end-state for browser applications with DOM UI:
- **DOM / `.templ` in WASM is an architectural anti-pattern:** browsers have no direct WASM DOM API, so every element and attribute mutation must call an imported JS host function. Native JS JIT code with inline caches is strictly faster, lighter, and has lower latency for DOM rendering.
- **Where Whole-App WASM is actually valuable:**
  1. **Canvas / WebGL-only apps:** Games and visualizations that bypass the DOM entirely, rendering to a canvas via WebGL/WebGPU through typed `js:` imports and `shared` memory buffers.
  2. **Headless & Server/WASI runtimes:** Compiling GoFront packages for Node/Bun server execution, microbenchmarks, or WASI targets where no browser DOM exists.
  3. **`async`/`await` in WASM:** Lowering async functions to resumable state machines that return Promises (without requiring JSPI).
  4. **`gofront build --target wasm`:** Mode for compiling headless or pure-canvas projects where every package targets WASM, leaving only the bootstrap loader in JS.

For general web development, DOM, `.templ`, CSS, and browser events remain permanently in JS by design.

---

## Open Questions

1. **Directive vs. config (Resolved).** Package targets can be overridden in `gofront.json` (`"targets": { "engine/physics": "wasm" }`) or via `--js-only`, making automated A/B comparative benchmarking and Safari < 18.2 fallback builds trivial without editing source code comments.
2. **`int` width.** `i64` (Go-correct, chosen) vs. `i32`. Revisit only if benchmarks show a cost.
3. **Strict mode scope.** Keep it only for `both` packages, or offer `//gofront:strict` for any JS package?
4. **`shared` buffer API (Resolved).** Index syntax via compiler base-offset emission. Startup-only allocation in v1.6.0 avoids detached `ArrayBuffer` traps. Slices and shared buffers are distinct types to preserve GC slice semantics; `gofront/shared` is `wasm`-package only (not `both`).
5. **Interface proxies (Resolved).** Do not implement dynamic two-way cross-boundary itab proxies. Calling from WASM into a JS-implemented interface introduces high runtime cost and a double boundary hop (WASM → JS proxy → WASM static mesh). Instead, provider interfaces live on the WASM side (e.g. `physics` queries `collision.Trimesh` directly), or cross the boundary via typed callback functions (`func`).
