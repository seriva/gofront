# Hybrid JS + WebAssembly Guide

GoFront compiles each package to JavaScript, WebAssembly (WasmGC), or both. This guide
covers how to pick a target, what the compiler enforces, how values cross the boundary,
and what is not supported yet. For the motivation and benchmark numbers see
[The Hybrid Architecture](../README.md#the-hybrid-architecture-js--wasmgc) in the README.

> **Runtime requirement:** WasmGC needs Node ≥ 22 or a recent Chrome, Firefox or Safari.
> Pure-JS projects (no `wasm`/`both` packages) keep working on Node 20.

---

## Choosing a target

Put a `//gofront:target` directive in any file of the package, **before** the `package`
clause. Omitting it means `js`.

```go
//gofront:target wasm
package collision
```

| Target | Output | May import | Use for |
|---|---|---|---|
| `js` (default) | ES module | anything | DOM, `gom`, `.templ`, browser APIs, `async`/`await` |
| `wasm` | WasmGC module | `wasm` and `both` packages, `math`, `math/bits`, `testing` | Physics, spatial indexing, raycasting, tight numeric loops |
| `both` | ES module **and** WasmGC | `both` packages, `math`, `math/bits`, `testing` | Shared math/utility code (`vec3`, `mathx`, …) used from both sides |

Rules of thumb:

- Start with everything in `js`. Move a leaf package to `wasm` only when a profiler shows
  time in tight loops over numeric data.
- Make the helpers that both sides need `both`. Each side then uses its own copy, so no
  boundary crossing happens for those calls.
- Keep the boundary coarse: one call that casts 100 rays is cheap; 100 calls that cast
  one ray each are not.

### Diagnostics

Unknown target values and directives placed after the `package` clause are compile errors.
Import-rule and `both`-restriction violations are reported per site and end with a
per-package summary such as:

```
package 'mathx' cannot be both: 3 blockers — mutates package variable 'scratch' (vec3.go:12), …
```

---

## `both` packages

A `both` package is compiled twice and the two copies share no state, so the compiler
rejects anything that would make them diverge:

- No `gom` usage.
- No mutation of package-level variables after initialisation: direct assignment, `++`/`--`,
  taking the address (`&x`) and pointer-receiver method calls on a package variable are all
  rejected (shadowing is respected).
- Only `both` packages and the WASM stdlib subset may be imported.

### Strict numeric mode

The JavaScript emitted for a `both` package follows Go's numeric rules so that the two
copies agree bit-for-bit:

| Construct | JS emission |
|---|---|
| `float32` arithmetic | `Math.fround(a op b)` |
| `int32` / `uint32` arithmetic | `(a op b) \| 0` / `(a op b) >>> 0`; `Math.imul` for `*` |
| `int8` / `int16` / `uint8` / `uint16` | masked and sign-extended to width |
| Integer `/`, `%` by zero | panics |
| Shift count ≥ width | yields `0` (or `-1` for negative signed `>>`) |
| `x op= y`, `x++`, `x--` | covered for locals, struct fields and slice/array elements; the index expression is evaluated once |

`wasm` packages get these semantics natively from the WASM instruction set.

---

## What `wasm` packages support

The backend (`src/backend/wasm/`) implements: structs, pointers, methods, arrays, slices
(`append`, slicing, `copy`), strings, maps, interfaces, generics, closures (including
closures inside methods), `defer`/`panic`/`recover`, and `math`/`math/bits`.

Not yet supported inside `wasm` code (each reports a `… (planned)` diagnostic):

- Referencing a **non-literal** package constant (`const X = f()`); literal constants are
  inlined.
- `t.Run` subtests in `wasm` test packages.

Package-level variables with non-literal initialisers are initialised from a WASM `start`
function, so they are ready before any export is called.

---

## The boundary

Every `wasm` and `both` package reached by a build is linked into **one** `app.wasm`,
written next to `app.js` by `gofront build`, `gofront dev` and `-o`. The compiler splices
a facade into `app.js` that exposes each `wasm` package's exported functions, methods,
literal constants and structs under the package name — JS code calls them like any other
import.

Linked `wasm` packages share one namespace: a top-level name declared in two of them is a
compile error.

### Type marshalling

| Go type | Crossing JS → WASM / WASM → JS |
|---|---|
| `bool`, `float32`, `float64`, sized ints | Converted directly. `int`/`int64` are a JS `Number` on the JS side. |
| `string`, `any` | Passed through. |
| Struct from a `both` package (`T`, `*T`) | Copied into its JS class. `*T` parameters are written back after the call. |
| Struct from a `wasm` package (`T`, `*T`) | Opaque **handle** class with stable identity. Scalar fields are read/written through accessors; aggregate fields (`b.Pos.X = 1`, `b.Tags[0] = 2`) are live views, so writes reach WASM memory. |
| `[]T`, `[N]T` | Copied element-wise in both directions. TypedArray inputs (`Float32Array`, `Int32Array`, …) are accepted. |
| `func` values | Wrapped in both directions, so callbacks work either way. |
| Named non-empty interfaces | **WASM → JS:** an exported `*T` arrives as its handle class (or `both` live view); other dynamic types arrive as a facade object whose methods call into WASM. **JS → WASM:** only WASM-owned values (handles, facades) are accepted. A `js` type implementing a `wasm` interface is a compile error (`type '*tri' (js) cannot implement wasm interface 'Shape' across the boundary; …`); keep implementations in WASM or pass a `func` callback. |
| `*testing.T` | Stays a JS object; `t.Errorf`, `t.Fatal`, `t.Log`, `t.Skip`, `t.Name`, `t.Failed`, … are routed back to the harness. |
| `map`, `error`, anonymous interfaces, pointers to non-structs, anonymous structs, exported non-literal constants | **Rejected** with `… is not yet supported across the wasm boundary (planned)`. |

### Panics and traps

A Go `panic` inside WASM surfaces in JS as a thrown `Error` carrying the panic message.
Nil dereferences trap in hardware and are mapped to the matching Go panic message by the
facade.

### Loading `app.wasm`

The generated `app.js` fetches `app.wasm` relative to the page. Override this before the
bundle runs when needed:

```html
<script>
  globalThis.__GOFRONT_WASM_URL = "/static/app.wasm";      // custom location
  // or
  globalThis.__GOFRONT_WASM_BYTES = someUint8Array;        // pre-loaded bytes
</script>
<script type="module" src="app.js"></script>
```

`gofront dev` serves `.wasm` with `application/wasm` and `Cache-Control: no-store`, and
`gofront build --pwa` precaches it alongside the other assets.

### Inspecting the module

`--emit-wat` (with `build` or `-o`) also writes a human-readable `app.wat`. Every emitted
module carries a `gofront` custom section; stale `app.wasm`/`app.wat` files are only
removed by a rebuild when they carry that section, so hand-placed modules are never
deleted.

### Optimization pipeline (Binaryen)

`gofront build --release` (or `--wasm-opt`) optimizes `app.wasm` through Binaryen:

- **Zero setup:** Uses the `wasm-opt` CLI shipped by the optional `binaryen` npm package (run through node, no native toolchain) and automatically prefers a native `wasm-opt` binary if present on `PATH`. If neither is available, `--release`/`--wasm-opt` fail with an actionable error; plain `gofront build` is unaffected.
- **WasmGC feature flags:** Configured for `GC`, `ReferenceTypes`, `BulkMemory`, `Multivalue`, `ExceptionHandling`, `MutableGlobals`, `NontrappingFPToInt`, and `TailCall`.
- **Optimization passes:** Level `-O3` combined with GUFA (`--gufa`: devirtualization, type refinement, function inlining, dead type/code elimination).
- **Size savings & validation:** Typically yields **~23% binary size reduction** and validates module structure post-optimization.
- **Source maps:** Passing `--source-map` emits a matching `app.wasm.map` and embeds the `sourceMappingURL` section.
- **Instant dev reload:** `gofront dev` bypasses optimization for sub-10ms instant hot-reload.

---

## Testing hybrid packages

`gofront test` picks the backend from the package target:

| Package target | How tests run | Reported as |
|---|---|---|
| `js` | In Node (optionally JSDOM with `--dom`) | `pkg` |
| `wasm` | Inside the linked `app.wasm`; `*testing.T` stays in JS | `pkg` |
| `both` | Twice — once per backend; both must pass | `pkg [js]` and `pkg [wasm]` |

A `both` package whose two copies disagree therefore fails its own test suite, which is the
main guard that strict numeric mode is doing its job.

---

## Benchmarking

`npm run bench` (or `test/e2e/perf/raycast-bench.js`) compiles a snapshot of the simplefps
`mathx` (`both`) and `collision` (`wasm`) packages twice — all-JS and hybrid — casts 100k rays
through 131k triangles and reports rays/s, allocation per ray, and binary size.
Pass `--wasm-opt` to run the built-in Binaryen optimization pipeline over the emitted module.
