# Hybrid JS + WebAssembly Target — Design Plan

**Version:** v1.6.0 (design spans v1.5.0 → v1.6.0, see [Phased Roadmap](#phased-roadmap))  
**Status:** Draft (revised 2026-10-04: full hybrid completed in the JS compiler as v1.6.0, before the v2.0.0 Go port. Whole-app WASM moved to [Future](#future-whole-app-wasm).)  
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
- **WASI / server targets, DWARF.** Browser only. WASM source maps are a stretch goal.
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
- Stdlib: `math`, `math/bits`, `errors`, `strings`, `strconv`, `unicode/utf8`, `slices`, `maps`, `sort`, `testing`; `fmt.Sprintf`/`Errorf`/`Println`

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
| interface | `(struct i32 typeId, (ref null $itab), anyref data)` | |
| func values / closures | `(struct funcref, anyref env)` + `call_ref` | |
| generics | monomorphised (deduplicated by layout) | JS stays erased |

- **Control flow:** structured (`block`/`loop`/`br`/`br_table`). No `goto` means no relooper. `fallthrough` becomes nested blocks.
- **Multiple results:** native multi-value.
- **`panic`:** an exception tag.
- **`defer`:** a defer list in `try_table` + `catch_all_ref`, rethrowing unless `recover()` ran.
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
| interfaces | **WASM value passed to JS:** a facade object with the interface's methods calling WASM exports. **JS-implemented value passed into WASM:** not supported via dynamic itab proxies; keep provider implementations in WASM or pass typed function callbacks (`func`). Avoids slow double-boundary hops. |
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
- **WASM side:** loads and stores at a base offset. Index syntax and `len` are supported. `append` and reslicing beyond the bounds are rejected.
- **JS side:** a live TypedArray view. Views are refreshed if memory grows, so the allocation size is fixed at startup by default.
- **In pure-JS builds or `both` packages compiled for JS:** a plain TypedArray. Code is portable across targets.

---

## Build, Dev & Test Integration

- **`build`:** `app.js` (JS packages + generated facades + loader) + `app.wasm` (all `wasm`/`both` code, one module) + `app.css`.
  - The loader uses `WebAssembly.instantiateStreaming` with top-level `await` before `main()`.
  - Optional `wasm-opt` (Binaryen, GC + EH) when it is on `PATH`.
  - The PWA precache includes `app.wasm`.
- **`dev`:** serves `.wasm` as `application/wasm`. Rebuilds both outputs. Live reload as today.
- **`check`:** target and import-rule diagnostics, WASM-subset errors, boundary-retention errors, boundary-in-loop hints.
- **`test`:**
  - `wasm` packages: tests are compiled to WASM and run in Node.
  - **`both` packages: tests run twice (JS and WASM) and the results must match.** This is the built-in determinism check.
  - `js` packages that import `wasm` packages: the hybrid bundle runs under Node (with JSDOM for `--dom`).
- **Tooling:** dependency-free binary encoder (`src/backend/wasm/encode.js`), `--emit-wat`, `WebAssembly.validate` on every module in tests, golden WAT tests, per-example size budget in CI.

---

## Platform Baseline

Required: **GC, typed function references, reference types, multi-value, bulk memory, sign-extension, exception handling.** Optional: JS String Builtins (polyfilled). JSPI is not used.

Exact minimum browser versions and the EH encoding (`exnref` vs. legacy) are fixed in v1.5.0 (the EH encoding in v1.6.0, when `recover` lands) and documented in the README. The loader feature-detects and reports a clear error. The README states whether a JS-only fallback build is recommended. Node for WASM tests: the minimum version with GC + EH on by default, checked at startup.

---

## Applying It to `simplefps` (reference split)

Current imports: `physics` is the only pure leaf (imports `math` only). `rendering`, `scene`, `game` and `animation` use `physics.Vec3`/`Mat4`/`BoundingBox` about 300 times. `animation` imports `systems` for `NewBinaryReader`.

| Package | v1.5.0 | v1.6.0 (end state) | Contents |
|---|---|---|---|
| `engine/mathx` (new) | `both` | `both` | `Vec3`, `Mat4`, `Quat`, `Transform`, `BoundingBox` (moved from `physics`) |
| `engine/collision` (new) | `wasm` | `wasm` | `Trimesh`, `Octree`, `Ray` + raycasting (moved from `physics`). Needs only the v1.5 core subset (`any` fields, JS callbacks). |
| `engine/physics` | `js` | `wasm` | `DynamicBody`, `FPSController`. Blocked on WASM → JS closures (`OnBounce`) and internal non-empty interface dispatch until v1.6 (in v1.6, `physics` queries `collision` directly in WASM). |
| `engine/rendering`, `scene`, `systems`, `assets`, `game` | `js` | `js` | Import `mathx` instead of `physics` for math types |
| `engine/animation` | `js` | `js` → candidate | Candidate for `wasm` (skinning → `shared` bone matrices) once the binary-reader dependency is moved to `assets` |

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
- [x] **Task H4.1 — Non-empty interfaces:** Itabs and `ref.test` dynamic dispatch.
- [x] **Task H4.2 — Generics:** Monomorphisation of generic types and functions for WASM target.
- [x] **Task H4.3 — Maps & stdlib:** Insertion-ordered map runtime and remaining stdlib subset in WASM.
- [ ] **Task H4.4 — Defer & recover:** Exception handling emission (`exnref` vs legacy EH encoding). Language fixtures pass on WASM == JS-strict.

### Phase H5: Boundary v2 (WASM Closures & Boundary Discipline)
- [ ] **Task H5.1 — WASM to JS closures:** Passing WASM closures across boundary into JS callers via cached trampolines.
- [ ] **Task H5.2 — Boundary interface resolution:** Resolve boundary interfaces by keeping provider implementations on the WASM side or passing function callbacks, avoiding cross-boundary dynamic itab proxies.
- [ ] **Task H5.3 — Physics migration:** Move `physics` (`DynamicBody`, `FPSController`) to `wasm` with full test suite passing.

### Phase H6: Shared Memory & Hybrid Example
- [ ] **Task H6.1 — Linear-memory buffers:** Implement `gofront/shared` TypedArray zero-copy views.
- [ ] **Task H6.2 — `example/hybrid` app:** Build and verify hybrid sample application with Playwright E2E.

### Phase H7: simplefps Full Split & Verification
- [ ] **Task H7.1 — simplefps final split:** Physics and collision in WASM, animation candidate.
- [ ] **Task H7.2 — Optimization & tooling:** Optional `wasm-opt` pipeline integration and WASM source maps.
- [ ] **Task H7.3 — Documentation & benchmarks:** Target guide in README and published comparative benchmarks.


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

1. **Directive vs. config.** Should package targets also be settable in `gofront.json` (`"targets": { "engine/physics": "wasm" }`), so one codebase can build JS-only or hybrid without code edits? A config override would also make A/B benchmarking trivial.
2. **`int` width.** `i64` (Go-correct, chosen) vs. `i32`. Revisit only if benchmarks show a cost.
3. **Strict mode scope.** Keep it only for `both` packages, or offer `//gofront:strict` for any JS package?
4. **`shared` buffer API.** Index syntax via compiler special-casing (proposed) vs. plain methods (`At`/`Set`). Program-lifetime only, or add pools/free later?
5. **Interface proxies (Resolved).** Do not implement dynamic two-way cross-boundary itab proxies. Calling from WASM into a JS-implemented interface introduces high runtime cost and a double boundary hop (WASM → JS proxy → WASM static mesh). Instead, provider interfaces live on the WASM side (e.g. `physics` queries `collision.Trimesh` directly), or cross the boundary via typed callback functions (`func`).
