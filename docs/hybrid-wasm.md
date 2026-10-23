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
| `wasm` | WasmGC module | `wasm` and `both` packages, the [WASM stdlib subset](#what-wasm-packages-support) | Physics, spatial indexing, raycasting, tight numeric loops |
| `both` | ES module **and** WasmGC | `both` packages, the WASM stdlib subset | Shared math/utility code (`vec3`, `mathx`, …) used from both sides |

Rules of thumb:

- Start with everything in `js`. Move a leaf package to `wasm` only when a profiler shows
  time in tight loops over numeric data.
- Make the helpers that both sides need `both`. Each side then uses its own copy, so no
  boundary crossing happens for those calls.
- Keep the boundary coarse: one call that casts 100 rays is cheap; 100 calls that cast
  one ray each are not.
- Watch what comes *out*: scalars, handles and `gofront/shared` buffers are free, but a
  slice result is copied on every call. A package whose main per-frame output is a
  `[]T` the JS side reads (e.g. skinning matrices) will measure at parity with JS; write
  that output into a shared buffer and return a count instead.
- Measure before committing: `gofront build --js-only` or a `gofront.json` `targets`
  override compiles the same code either way without editing source.

### Diagnostics

Unknown target values and directives placed after the `package` clause are compile errors.
Import-rule and `both`-restriction violations are reported per site and end with a
per-package summary such as:

```
package 'mathx' cannot be both: 3 blockers — mutates package variable 'scratch' (vec3.go:12), …
```

A `js` package that calls into a `wasm` package from inside a `for`/`range` body gets a
non-fatal warning (`'phys.Step' crosses the JS→WASM boundary inside a loop`): every call
copies its arguments, so the loop usually belongs on the WASM side, or the data in a
`gofront/shared` buffer.

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
| `xs[i]` on a slice, array or string out of range | panics with `runtime error: index out of range [i] with length n` (`[i]` alone for a negative index) |
| Write to a nil map | panics with `assignment to entry in nil map`; reads, `len`, `range` and `delete` see an empty map |
| Field access through a nil struct pointer | panics with `runtime error: invalid memory address or nil pointer dereference` |

`wasm` packages get these semantics natively from the WASM instruction set.

---

## What `wasm` packages support

The backend (`src/backend/wasm/`) implements: structs, pointers, methods, arrays, slices
(`append`, slicing, `copy`), strings, maps (including array-typed and interface-typed keys),
interfaces (including anonymous interfaces), generics, closures (including closures inside methods),
`defer`/`panic`/`recover`, `error` values, and non-literal package constants.

**Known limitations** (fixes planned for [v1.8.0](v1.8.0/portable-go-plan.md)); a `both` package's
`[wasm]` test run is the quickest way to spot them:

- Fixed-size arrays (`[N]T`) are not copied on assignment or when passed to a function, so the
  copy aliases the original.
- A pointer to a scalar struct field or slice/array element (`&s.X`, `&xs[i]`) points at a copy;
  writes through it do not reach the original.
- `for … range` over an iterator function and complex numbers (`complex`, `real`, `imag`) are
  not supported in `wasm` packages.

Stdlib coverage in `wasm`/`both` packages, per package:

<!-- stdlib:begin -->
<!-- Generated by `npm run docs:stdlib` from runtime/stdlib/manifest.json; do not edit. -->

Members of each Go package that `wasm` and `both` packages can use today, out of the members planned for them (JS-only and excluded members are not counted). **Not yet** is scheduled in the [portable Go plan](v1.8.0/portable-go-plan.md).

| Package | Available | Not yet |
|---|---|---|
| `bufio` | 0 of 79 | 79 |
| `bytes` | 49 of 99 | 50 |
| `cmp` | 4 of 4 | 0 |
| `container/heap` | 0 of 11 | 11 |
| `container/list` | 0 of 21 | 21 |
| `container/ring` | 0 of 10 | 10 |
| `context` | 0 of 20 | 20 |
| `crypto/hmac` | 0 of 2 | 2 |
| `crypto/md5` | 0 of 4 | 4 |
| `crypto/rand` | 2 of 3 | 1 |
| `crypto/sha1` | 0 of 4 | 4 |
| `crypto/sha256` | 4 of 7 | 3 |
| `crypto/sha512` | 0 of 13 | 13 |
| `crypto/subtle` | 0 of 8 | 8 |
| `encoding/base32` | 0 of 19 | 19 |
| `encoding/base64` | 15 of 22 | 7 |
| `encoding/binary` | 13 of 33 | 20 |
| `encoding/csv` | 0 of 32 | 32 |
| `encoding/hex` | 7 of 15 | 8 |
| `encoding/json` | 0 of 68 | 68 |
| `errors` | 6 of 7 | 1 |
| `fmt` | 11 of 43 | 32 |
| `hash` | 0 of 32 | 32 |
| `hash/adler32` | 0 of 3 | 3 |
| `hash/crc32` | 0 of 12 | 12 |
| `hash/fnv` | 0 of 6 | 6 |
| `html` | 2 of 2 | 0 |
| `io` | 19 of 94 | 75 |
| `iter` | 0 of 2 | 2 |
| `log` | 0 of 43 | 43 |
| `maps` | 7 of 10 | 3 |
| `math` | 69 of 97 | 28 |
| `math/bits` | 15 of 50 | 35 |
| `math/cmplx` | 0 of 27 | 27 |
| `math/rand` | 12 of 45 | 33 |
| `math/rand/v2` | 0 of 51 | 51 |
| `net/url` | 0 of 60 | 60 |
| `os` | 0 of 7 | 7 |
| `path` | 9 of 9 | 0 |
| `path/filepath` | 9 of 19 | 10 |
| `slices` | 28 of 40 | 12 |
| `sort` | 10 of 40 | 30 |
| `strconv` | 18 of 43 | 25 |
| `strings` | 59 of 82 | 23 |
| `sync` | 20 of 39 | 19 |
| `sync/atomic` | 0 of 90 | 90 |
| `testing` | 16 of 94 | 78 |
| `time` | 80 of 129 | 49 |
| `unicode` | 11 of 52 | 41 |
| `unicode/utf16` | 0 of 7 | 7 |
| `unicode/utf8` | 10 of 19 | 9 |
<!-- stdlib:end -->

Notable members per package:
- `math` (including 24 constants, `Float64bits`/`Float64frombits`, `Float32bits`/`Float32frombits`, `Sinh`, `Cosh`, `Tanh`, `Remainder`), `math/bits` (including `Len*`, `Reverse*`, `ReverseBytes*`), `math/rand` (pure inline 64-bit PRNG with deterministic `Seed`, `Read`, `Shuffle`, `Perm`)
- `errors` (`New`, `Is`, `Unwrap`, `As`, `Join`)
- `fmt` (`Sprintf`, `Printf`, `Println`, `Errorf`, `Fprintf`, `Fprintln`, `Fprint`, `Sscan`, `Sscanln`, `Sscanf`, including `%v`/`%+v` composite formatting over slices, arrays, maps, and structs)
- `strings` (including `Builder`, `NewReplacer`, `NewReader`, `Cut*`, `Split*`, `*Func`, `FieldsFunc`)
- `bytes` (including `Buffer`, `NewReader`, `FieldsFunc`, `Clone`)
- `strconv` (including `Unquote`, `AppendInt`, `AppendFloat`, `AppendUint`, `AppendBool`, `ParseUint`, `FormatUint`)
- `unicode`, `unicode/utf8`
- `slices` (including `Compare`, `SortFunc`, `IndexFunc`, `ContainsFunc`, `BinarySearch`, `BinarySearchFunc`, `Min`, `Max`, `Compact`, `Concat`, `Delete`, `Insert`, `Replace`, `Grow`, `Clip`), `maps`, `sort`
- `io` (`Reader`, `Writer`, `ReadWriter`, `Closer`, `ReadAll`, `Discard`, `WriteString`, `Copy`, `CopyN`, `LimitReader`, `EOF`)
- `path`, `path/filepath`
- `html` (`EscapeString`, `UnescapeString`)
- `time` (pure parts: `Duration` with methods `.Seconds()`, `.Milliseconds()`, `.Minutes()`, `.Hours()`, `.String()`; `Time` with methods `.IsZero()`, `.UnixNano()`, `.Nanosecond()`, `.UTC()`, `.Local()`, calendar arithmetic, parsing, formatting; `time.Sleep` stays JS-only)
- `sync` (`Mutex`, `RWMutex`, `Once`, `WaitGroup`)
- `crypto/rand` (`Read`), `crypto/sha256` (`Sum256`, `New`)
- `encoding/binary` (`LittleEndian`, `BigEndian`, `Read`, `Write`, `Append*`, `Size`)
- `encoding/hex` (`EncodeToString`, `DecodeString`, `EncodedLen`, `DecodedLen`)
- `encoding/base64` (`StdEncoding`, `URLEncoding`, `RawStdEncoding`, `RawURLEncoding`)
- `testing`, `gofront/shared`, and `gofront/simd` (experimental).

Any other import, or JS-only API (`os`, `regexp`, `encoding/json`, `time.Sleep`), reports a targeted diagnostic
(e.g. `'time.Sleep' is not yet available in wasm packages`) with a hint to keep the call in a JS package.
The `math` functions without a native WASM instruction (`Sin`, `Cos`, `Atan2`, `Pow`, `Mod`, `Hypot`,
`Cbrt`, `Round`, …) are imported from JS `Math` with Go semantics (`Round` rounds half away
from zero; `Mod` keeps the sign of the dividend).

Package-level variables with non-literal initialisers and runtime-evaluated constants are initialised
from a WASM `start` function, so they are ready before any export is called.

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
| `shared.Float32`, `shared.Int32`, … (`gofront/shared`) | **Zero-copy** TypedArray view over the module's linear memory in both directions (see below). |
| `error` | **WASM → JS:** `Error` subclass carrying `.message` and the WASM reference (`__ref`). A nil error is `null`. **JS → WASM:** only WASM-owned error instances are accepted; identity is preserved (`errors.Is`). Non-WASM error throws `TypeError`. |
| `map[K]V` (K = string, number, bool) | Copied both ways as a fresh JS `Map` in insertion order. Map parameters accept a plain JS object or a `Map`. Mutating the returned JS `Map` does not alter WASM state. |
| Pointers to non-structs (`*float64`, `*int`, …) | Copy-in/copy-out box `{ value }`, written back after the call. Write-back is skipped on panic and the panic propagates. |
| Anonymous structs | Copied as plain JS objects `{ [field]: value }` with the same field names. |
| Anonymous interfaces (`interface{ … }`) | Keyed on the sorted method set; identical method sets share the same facade class. Same JS → WASM rule as named interfaces (only WASM-owned values). |
| Exported non-literal constants | Exposed on the facade as module constants read once after the `start` function runs. |
| `time.Duration` | Nanoseconds crossing as a JS `Number` (`int64`). |
| `time.Time` | Copied into the JS backend's `time.Time` object via Unix milliseconds (preserving timezone offset). Rounded to the JS shim's millisecond precision. |
| `chan` | **Rejected** with `chan is not yet supported across the wasm boundary (planned)`. |

### Shared linear-memory buffers (`gofront/shared`)

Slices are copied across the boundary. For large numeric data that both sides touch every
frame (particle positions, vertex buffers, audio samples) a `wasm` package can allocate
**shared buffers** instead:

```go
//gofront:target wasm
package sim

import "gofront/shared"

const Max = 4096

var Positions = shared.NewFloat32(Max * 2) // x,y pairs
var Flags = shared.NewUint8(Max)

func Step(dt float32) {
	for i := range Positions {
		Positions[i] += dt
	}
}
```

```js
// JS side — a Float32Array aliasing the wasm memory; no copy per frame.
for (let i = 0; i < sim.Positions.length; i += 2) {
	ctx.fillRect(sim.Positions[i], sim.Positions[i + 1], 2, 2);
}
```

- Element types: `Float32`, `Float64`, `Int8`, `Int16`, `Int32`, `Uint8`, `Uint16`, `Uint32`
  (`shared.NewXxx(n)`). Buffers support indexing, `len`, `range`, `copy` to/from slices and
  `b.Subarray(lo, hi)` (an aliasing sub-view, bounds-checked).
- **Allocation only at startup**: `shared.NewXxx` may appear in package-level `var`
  initialisers and `init()` only. The memory is sized once, so views handed to JS never
  detach; the facade still re-creates a cached view if the buffer changed.
- A shared buffer is **not** a slice: passing it where `[]float32` is expected (or vice
  versa), slicing it with `b[lo:hi]`, `append` and `cap` are compile errors — use `copy`
  or `Subarray` explicitly.
- `gofront/shared` is only available in `wasm` packages (`both` packages have no linear
  memory on the JS side). In a `--js-only` build the buffers become plain TypedArrays.
- JS → WASM parameters must be a view of the right type over the module's memory
  (`sim.Positions.subarray(0, 8)` is fine); anything else throws a `TypeError`.

`example/hybrid` is a complete particle demo built this way.

### WASM SIMD (`gofront/simd`, experimental)

`gofront/simd` provides 4-wide 32-bit floating-point SIMD vector operations lowering to native WebAssembly `v128` instructions without GC overhead.

- **Types & Methods:**
  - `simd.F32x4` — 4-lane `float32` vector value type: `simd.F32x4{a, b, c, d}`, `simd.Splat(f)`.
  - Arithmetic & math: `v.Add(u)`, `v.Sub(u)`, `v.Mul(u)`, `v.Div(u)`, `v.Min(u)`, `v.Max(u)`.
  - Dot products: `v.Dot3(u)`, `v.Dot4(u)`.
  - Lane access: `v.Lane(i)` (where index `i` is a constant $0 \le i \le 3$), `v.WithLane(i, f)`.
  - Zero value: `var v simd.F32x4` initializes to `(0, 0, 0, 0)` (`v128.const` zeros in WASM, frozen `[0, 0, 0, 0]` in JS).
- **Direct Linear-Memory Load / Store:**
  - `simd.LoadF32x4(buf shared.Float32, i)` — loads 4 consecutive floats from element offset `i` (`v128.load`).
  - `simd.StoreF32x4(buf, i, v)` — stores vector `v` at element offset `i` (`v128.store`).
  - Bounds checks enforce $i + 4 \le \text{len}(buf)$ and trap with a panic on out-of-bounds access.
- **Lowering & Semantics:**
  - **WASM:** compiles directly to unboxed `v128` locals, parameters, and struct fields using `0xFD` opcodes.
  - **Current limits (planned for v1.8.0):** in `wasm`/`both` packages, `F32x4` cannot appear in exported struct fields or exported function signatures (they would cross the boundary), `==`/`!=` on `F32x4` is not supported, and `fmt` cannot format `F32x4` values. Keep `F32x4` in unexported types and functions, and compare or print lanes individually.
  - **JS:** compiles to frozen 4-element arrays using `Math.fround` per lane for bit-level 32-bit float parity.
  - **Boundary:** In v1.7.0, `F32x4` is restricted from crossing the JS↔WASM boundary directly (compile diagnostic advises passing data via `gofront/shared.Float32`).
- **Benchmark & Gating:**
  - Tested on the 131,072-triangle raycast benchmark: 1.34× faster than pure JS, but 1.02× over scalar hybrid (spatial octree traversal dominates runtime over 3-wide triangle checks). Per the release plan's $\ge 1.30\times$ gate, `gofront/simd` stays experimental; its completion and the promotion decision are planned for v1.8.0 ([`docs/v1.8.0/portable-go-plan.md`](v1.8.0/portable-go-plan.md)).

### Panics and traps

A Go `panic` inside WASM surfaces in JS as a thrown `Error` carrying the panic message.
A field access through a nil struct pointer is checked and raises the same Go panic,
so `recover()` catches it. A whole-value dereference of a nil pointer (`*p`) still traps
in hardware; the facade maps that trap to the matching Go panic message.

### Loading `app.wasm`

The generated `app.js` fetches `app.wasm` relative to **itself** (`import.meta.url`), so
the bundle keeps working under sub-path routes and when served from a CDN. Override this
before the bundle runs when needed:

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

### Overriding targets without touching code

- `gofront build --js-only` (alias `--target js`; also accepted by `dev`, `check` and the
  legacy `gofront <src> -o …` form) compiles **every** package to JavaScript — no
  `app.wasm` is produced. Use it for A/B benchmarking or as a fallback build for browsers
  without WasmGC.
- `gofront.json` can pin targets per package, keyed by the package directory relative to
  the source root (`"."` for the root package). An entry replaces the package's
  `//gofront:target` directive:

  ```json
  { "targets": { "engine/physics": "wasm", "engine/debug": "js" } }
  ```

### Inspecting the module

`--emit-wat` (with `build` or `-o`) also writes a human-readable `app.wat`. Every emitted
module carries a `gofront` custom section; stale `app.wasm`/`app.wat` files are only
removed by a rebuild when they carry that section, so hand-placed modules are never
deleted.

### Optimization pipeline (Binaryen)

`gofront build --release` (or `--wasm-opt`) optimizes `app.wasm` through Binaryen:

- **Zero setup:** Uses the `wasm-opt` CLI shipped by the optional `binaryen` npm package (run through node, no native toolchain) and automatically prefers a native `wasm-opt` binary if present on `PATH`. If neither is available, `--release`/`--wasm-opt` fail with an actionable error; plain `gofront build` is unaffected.
- **WasmGC feature flags:** Configured for `GC`, `ReferenceTypes`, `BulkMemory`, `Multivalue`, `ExceptionHandling`, `MutableGlobals`, `NontrappingFPToInt`, `TailCall`, and `SIMD`.
- **Optimization passes:** Level `-O3` combined with whole-program analysis (`--closed-world`: interface devirtualization, struct field pruning, type refinement), GUFA (`--gufa`), and pass convergence (`--converge`) in release builds, retaining hardware trap preservation by default (traps on nil struct dereference). Disassembly on `--emit-wat` translates the optimized binary directly in a single pass without re-running passes.
- **Size savings & validation:** Typically yields **~23% binary size reduction** and validates module structure post-optimization.
- **Source maps:** Passing `--source-map` emits a function-level `app.wasm.map` (one mapping per function body, resolved `sources`) and embeds the `sourceMappingURL` custom section. With `--release`/`--wasm-opt` the map is handed to Binaryen (`-ism`) so offsets stay correct after optimisation.
- **Instant dev reload:** `gofront dev` bypasses optimization for sub-10ms instant hot-reload.

---

## Testing hybrid packages

`gofront test` picks the backend from the package target:

| Package target | How tests run | Reported as |
|---|---|---|
| `js` | In Node (optionally JSDOM with `--dom`) | `pkg` |
| `wasm` | Inside the linked `app.wasm`; `*testing.T` stays in JS (`t.Run` subtests included) | `pkg` |
| `both` | Twice — once per backend; both must pass | `pkg [js]` and `pkg [wasm]` |

Running `wasm`/`both` tests needs Node 22+ (WasmGC); older runtimes fail the build step
with `running wasm packages requires Node 22+ (WasmGC)` and a `--js-only` hint.

A `both` package whose two copies disagree therefore fails its own test suite, which is the
main guard that strict numeric mode is doing its job.

---

## Benchmarking

`npm run bench` (or `test/e2e/perf/raycast-bench.js`) compiles a snapshot of the simplefps
`mathx` (`both`) and `collision` (`wasm`) packages twice — all-JS and hybrid — casts 100k rays
through 131k triangles and reports rays/s, allocation per ray, and binary size.
Pass `--wasm-opt` to run the built-in Binaryen optimization pipeline over the emitted module.

For a whole-application comparison, simplefps's `npm run bench` (`tests/perf/js-vs-wasm.js`)
compiles its `physics` and `animation` packages with `forceTarget: "js"` and hybrid and times
raycasts, the FPS-controller fixed step and a skinned-character frame across the boundary;
the results are tabulated in the README under *Real-World Benchmark*.
