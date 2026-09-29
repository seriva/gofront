# Zero-Allocation Codegen & TypedArray Buffers — Design Plan

**Version:** v1.3.0  
**Status:** Implemented & Verified  

---

## Goal

Provide zero-allocation JavaScript code generation and first-class JavaScript TypedArray support in GoFront. This will eliminate garbage collector (GC) pressure in hot execution loops (60–120+ FPS game engines, physics simulations, WebGL/WebGPU renderers), enable zero-copy binary buffer slicing, and provide full static typing for modern GPU APIs (`WebGL2RenderingContext`, `GPUDevice`), establishing the architectural foundation required to rewrite performance-critical applications like SimpleFPS in GoFront.

Currently, GoFront is optimized for DOM and component workflows. Several Go constructs compile to allocating JavaScript patterns (e.g., `for range` emits `.entries()` iterator tuples, struct literals emit `{}` options objects, numeric slices compile to standard JS `Array`, and sub-slicing calls `.slice()` which copies memory). In real-time 3D graphics and physics loops, these allocations trigger frequent GC sweeps, causing frame drops and jitter. This plan closes that performance gap while preserving GoFront's zero-runtime-dependencies guarantee.

---

## Out of Scope

- **Raw Pointer Arithmetic & Unsafe Memory:** `unsafe.Pointer` and arbitrary pointer arithmetic remain out of scope; JavaScript's memory sandbox does not allow raw memory manipulation.
- **Multithreaded SharedArrayBuffer & Atomics:** Shared memory across Web Workers and atomic operations are deferred to a dedicated concurrency release.
- **WASM or Runtime Garbage Collector:** GoFront will not introduce a WebAssembly target or custom runtime engine. All output remains clean, readable ES modules running directly on the JavaScript engine.
- **Rewriting SimpleFPS Engine:** The actual migration of SimpleFPS will happen as a downstream project after v1.3.0 is verified and published.

---

## Approach

### 1. Zero-Allocation Loop Generation (`src/codegen/statements.js`)

In hot paths (physics sweeps, raycasts, vertex transformations), loop iteration must not allocate any heap objects.

#### Problem
Currently, `for i, v := range slice` compiles via `_genRangeIterExpr` to:
```js
for (const [i, v] of __s(slice).entries()) { ... }
```
In V8/SpiderMonkey, `.entries()` creates an iterator object and allocates a 2-element array tuple `[i, v]` on every iteration.

Furthermore, naive index-loop conversion faces four subtle traps in Go semantics and JS scoping:
1. **`nil` Slice Crash:** In Go, ranging over an unallocated slice (`var s []float32 = nil`) is valid and executes zero times. Emitting `for (let i = 0, __arr = arr; i < __arr.length; i++)` throws `TypeError: Cannot read properties of null (reading 'length')`.
2. **`const v` Reassignment Error:** In Go, loop value `v` is a local variable copied by value that the loop body may freely reassign (`v = clean(v)`). Emitting `const v = __arr[i]` causes a runtime `TypeError: Assignment to constant variable` in JavaScript.
3. **`AssignStmt` (`=` instead of `:=`):** If the loop reuses outer variables (`for i, v = range arr`), emitting `let i = 0` or `let v` shadows the outer variables.
4. **Nested Loop Scoping:** In nested loops (`for row := range matrix { for col := range row { ... } }`), fixed temp variable names like `__arr` can collide or trigger linter redeclaration errors.

#### Solution
Update `_genForRange` and `_genRangeIterExpr` to detect slice and array types and emit a classic index loop:

1. **Both Index and Value (`for i, v := range arr`):**
   ```js
   for (let i = 0, __arr0 = arr, __len0 = __arr0 ? __arr0.length : 0; i < __len0; i++) {
     let v = __arr0[i];
     // body...
   }
   ```
2. **Index Only (`for i := range arr`):**
   ```js
   for (let i = 0, __arr0 = arr, __len0 = __arr0 ? __arr0.length : 0; i < __len0; i++) {
     // body...
   }
   ```
3. **Value Only (`for _, v := range arr`):**
   ```js
   for (let __i0 = 0, __arr0 = arr, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
     let v = __arr0[__i0];
     // body...
   }
   ```
4. **Assignment Form (`for i, v = range arr`):**
   When `stmt.init.kind === "AssignStmt"`, do not emit `let` for existing variables:
   ```js
   for (i = 0, __arr0 = arr, __len0 = __arr0 ? __arr0.length : 0; i < __len0; i++) {
     v = __arr0[i];
     // body...
   }
   ```

*Notes:*
- Suffixing temporary loop registers (`__arr${depth}`, `__len${depth}`) ensures hygiene across nested loops.
- `__len = __arr ? __arr.length : 0` safely handles `nil` slices without allocating default `[]` wrappers.
- If the loop discards the value (`for i, _ := range arr`), omit the element lookup entirely.
- Map and string ranges continue through their dedicated paths (`Object.keys/entries()` and Unicode `codePointAt` iteration).

---

### 2. First-Class TypedArray Slices (`src/typechecker/` & `src/codegen/`)

WebGL and WebGPU operate on raw binary buffers. Go numeric slices will compile directly to JavaScript TypedArrays instead of generic JS `Array`.

#### Type Checker Prerequisite (`src/typechecker/types.js`)
Currently, `BASIC_TYPES` collapses all sized numeric types (`float32` -> `FLOAT64`, and `byte`, `uint8`, `int32`, `uint32` -> `INT`).
Because `float32` and `float64` share the exact same type object, the compiler cannot distinguish `[]float32` from `[]float64` or `[]byte` from `[]int`.

**Required Refactoring:**
1. Introduce distinct basic types in `types.js`: `FLOAT32`, `FLOAT64`, `UINT8` (`BYTE`), `UINT16`, `UINT32`, `INT8`, `INT16`, `INT32`.
2. Update `isNumeric()` to include all sized types.
3. Update `UNTYPED_COMPAT` in `assignability.js` so untyped constants cleanly assign to sized numeric types.
4. Provide helper `isTypedArraySlice(type)` and `typedArrayConstructorForElem(elemType)`.

#### Type Mapping

| Go Type | JavaScript Representation | Notes |
|---|---|---|
| `[]float32` | `Float32Array` | Standard for 3D coordinates, matrices, vertex buffers |
| `[]float64` | `Float64Array` | High-precision math, timestamps |
| `[]byte` / `[]uint8` | `Uint8Array` | Textures, binary packet serialization |
| `[]uint16` | `Uint16Array` | Triangle element indices (<= 65,535 vertices) |
| `[]uint32` | `Uint32Array` | WebGL2/WebGPU 32-bit element index buffers |
| `[]int32` | `Int32Array` | Integer vertex attributes, uniform buffers |
| `[]int16` | `Int16Array` | Compressed geometry, audio PCM |
| `[]int8` | `Int8Array` | Signed normalized data |

#### Codegen Changes (`src/codegen/expressions.js` & `src/codegen/runtime.js`)

1. **`make()` Allocation:**
   ```go
   vertices := make([]float32, 1024)
   ```
   *Old:* `new Array(1024).fill(0)`  
   *New:* `new Float32Array(1024)` (zero-filled by the browser engine with contiguous C++ memory).

2. **Sub-slicing (`s[lo:hi]`):**
   ```go
   sub := vertices[0:16]
   ```
   *Old:* `vertices.slice(0, 16)` (allocates and copies memory).  
   *New for TypedArrays:* `vertices.subarray(0, 16)` (creates a **zero-copy view** over the existing `ArrayBuffer`).  
   *Semantic Win:* In addition to 0 allocations, `.subarray()` delivers **true Go slice semantics**: mutations to `sub[i]` write directly into `vertices[i]`, unlike JS `Array.prototype.slice()` which clones memory.

3. **Composite Literals:**
   ```go
   pos := []float32{1.0, 2.0, 3.0}
   ```
   *Emits:* `new Float32Array([1, 2, 3])`

4. **`copy(dst, src)` Builtin:**
   Currently, GoFront emits `__cd.splice(0, n, ...__cs.slice(0, n))`. **TypedArrays in JavaScript do not have `.splice()`**, which causes a runtime `TypeError`.  
   *New Codegen:* For TypedArrays, emit `.set()`:
   ```js
   ((dst, src) => {
     const n = Math.min(dst.length, src.length);
     dst.set(src.length === n ? src : src.subarray(0, n));
     return n;
   })(dst, src)
   ```

5. **`append()` Handling & Runtime Helpers:**
   `HELPER_APPEND` currently uses `[...a, ...b]`, which converts TypedArrays into standard JS `Array`s and risks call stack overflow on large buffers.
   - Emit `__typedAppend(target, ...items)`:
     ```js
     function __typedAppend(a, ...b) {
       if (!a) return new TargetTypedArray(b);
       const res = new a.constructor(a.length + b.length);
       res.set(a);
       res.set(b, a.length);
       return res;
     }
     ```
   - In performance mode, emit compiler diagnostics advising preallocation (`make`) over dynamic `append` in hot paths.

6. **Equality Checking (`src/codegen/runtime.js`):**
   `HELPER_EQUAL` checks `Array.isArray(a)`. In JavaScript, `Array.isArray(new Float32Array()) === false`. It falls through to `Object.keys()`, which is slow and allocates.
   Update `__equal` to check `ArrayBuffer.isView(a)` and compare byte-by-byte or element-by-element.

---

### 3. Struct Scratch Instances & Unboxing Struct Pointers

#### The Struct Pointer Boxing Hole
Currently, GoFront models all pointers uniformly:
```go
p := &b
```
Compiles to:
```js
let p = { value: b };
```
And field access emits `p.value.Field`.

In real-time game loops, code relies on scratch instances and out-parameters to avoid instantiating objects:
```go
var tmpVec = Vec3{}

func (t *Transform) PointToLocal(worldPoint *Vec3, out *Vec3) *Vec3 {
    out.X = worldPoint.X - t.Position.X
    out.Y = worldPoint.Y - t.Position.Y
    out.Z = worldPoint.Z - t.Position.Z
    return out
}
```
If called with `t.PointToLocal(&worldPoint, &tmpVec)`, GoFront currently allocates **two `{ value: ... }` wrapper objects on every single invocation**, defeating the entire scratch pattern.

#### Solution
Because GoFront already emits structs as ES6 classes (which are reference types passed by reference in JavaScript), struct pointers do not need boxing:
1. **Unbox Struct Pointers:**
   - When taking the address of a struct instance `&s`, emit `s` directly (0 allocations).
   - Dereferencing `*ptr` on a struct pointer is a no-op: emit `ptr`.
   - Accessing `ptr.Field` emits `ptr.Field` directly rather than `ptr.value.Field`.
   - Boxed `{ value: x }` wrappers remain reserved strictly for address-taken primitive types (`*int`, `*bool`).
2. **Positional Struct Constructors (`src/codegen/index.js`):**
   Currently, structs emit destructuring constructors:
   ```js
   class Point {
     constructor({ X = 0, Y = 0 } = {}) {
       this.X = X;
       this.Y = Y;
     }
   }
   ```
   Instantiating `Point{X: 1, Y: 2}` creates an intermediate options object `{ X: 1, Y: 2 }`.
   *Update:* Emit positional constructors:
   ```js
   class Point {
     constructor(X = 0, Y = 0) {
       this.X = X;
       this.Y = Y;
     }
   }
   ```
   - Literal `Point{X: 1, Y: 2}` and positional `Point{1, 2}` compile to `new Point(1, 2)`.
   - Omitted fields are filled at compile-time with precomputed zero values (`Point{Y: 2}` -> `new Point(0, 2)`).
   - Embedded fields are flattened in declared order.
   - For interop compatibility with external JS callers, constructors can accept positional arguments while supporting single-object arguments if needed.
   - In V8, positional constructors produce immediate stable Hidden Classes (Shapes), improving JIT inline caching.

---

### 4. WebGPU & WebGL2 Static Typings (`src/typechecker/stdlib/`)

#### Problem
Currently, `WebGL2RenderingContext` and `GPUDevice` are defined as `ANY` in `typechecker/stdlib/core.js`.
WebGL2 defines over 400 methods (`UseProgram`, `UniformMatrix4fv`, `VertexAttribPointer`, `CreateShader`, `Clear`, `TexImage2D`, `CreateVertexArray`, etc.). Replacing `ANY` with an interface containing only 5 methods would break type checking in downstream renderers.

#### Solution: Two-Tier Type Surface & WebGL Stdlib (`src/typechecker/stdlib/web.js`)
1. **TypedArray Builtins:**
   Define `ArrayBuffer`, `DataView`, `Float32Array`, `Float64Array`, `Uint8Array`, `Uint16Array`, `Uint32Array`, `Int32Array`, `Int16Array`, `Int8Array` with methods: `subarray`, `byteLength`, `byteOffset`, `buffer`, `set`, `slice`.
2. **Comprehensive WebGL2 / WebGPU Interfaces:**
   - Standard browser DOM casing: WebGL methods are exposed via browser-standard camelCase (`viewport`, `clearColor`, `createShader`, `shaderSource`, `compileShader`, `createProgram`, `attachShader`, `linkProgram`, `useProgram`, `createBuffer`, `bindBuffer`, `bufferData`, `createVertexArray`, `bindVertexArray`, `vertexAttribPointer`, `enableVertexAttribArray`, `drawArrays`, `drawElements`, `getUniformLocation`, `uniformMatrix4fv`, `clear`).
   - Constant definitions: `ARRAY_BUFFER`, `ELEMENT_ARRAY_BUFFER`, `STATIC_DRAW`, `DYNAMIC_DRAW`, `TRIANGLES`, `COLOR_BUFFER_BIT`, `DEPTH_BUFFER_BIT`, `VERTEX_SHADER`, `FRAGMENT_SHADER`, etc.
   - Open interface fallback: Interfaces specify `_isOpen: true` to permit calls to extended/vendor methods without triggering false compile-time type errors.
   - Bidirectional slice ↔ TypedArray assignability (`_isTypedArrayAssignable` in `src/typechecker/assignability.js`): `[]float32` passes directly into WebGL methods accepting `Float32Array`, and vice versa.

---

### 5. Multi-Value Returns & Zero-Allocation Out-Parameters

In JavaScript, multiple return values `return a, b` compile to array tuples `return [a, b]`.
In hot loops (such as ray-triangle intersection returning `(hit bool, dist float32, u float32, v float32)`), returning a tuple allocates an array object per check.

#### Recommended Strategy
1. **Promote Struct Out-Parameters:**
   With struct pointer unboxing (Section 3), the standard Go out-parameter idiom:
   ```go
   func (t *Triangle) Intersect(ray *Ray, out *HitResult) bool
   ```
   compiles to direct in-place property mutations with **0 allocations**. This is the primary zero-allocation mechanism for hot paths.
2. **Compile-Time Inlining (Future / Non-Breaking Optimization):**
   Small private functions returning multiple values called in direct assignments (`hit, dist := intersect(ray)`) can optionally be inlined at compile time in `--minify` mode to eliminate the temporary tuple array.

### 6. Reference Showcase: Rotating 3D WebGL Cube (`example/webgl/`)

To validate zero allocations, TypedArray buffer uploads, and WebGL2 static typings in a real browser context before tackling SimpleFPS, provide a standalone reference application in `example/webgl/`:

#### Architecture & Implementation
- **Canvas & WebGL2 Initialization:** Initializes `<canvas id="glcanvas" width="600" height="600">` and requests `"webgl2"` context via GoFront's static `WebGL2RenderingContext` typings.
- **Shader Pipeline:** Compiles GLSL ES 3.0 vertex and fragment shaders for 3D interpolated RGB coloring and perspective projection.
- **TypedArray Buffers:**
  - 24 vertices with interleaved positions and RGB colors defined as `[]float32` (`Float32Array`).
  - 36 element indices defined as `[]uint16` (`Uint16Array`).
  - Uploaded via `gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)` and `gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)` without intermediate conversions or copies.
- **Matrix Math & Uniforms:**
  - Computes Model-View-Projection (MVP) transformation matrix using in-place column-major scratch `[]float32` buffers (`mat4Perspective`, `mat4Translate`, `mat4RotateX`, `mat4RotateY`, `mat4Multiply`).
  - Transferred directly to the GPU via `gl.uniformMatrix4fv(mvpLoc, false, mvpMatrix)`.
- **Zero-Allocation Render Loop:**
  - Runs on `requestAnimationFrame`.
  - Updates rotation angles and recalculates MVP matrix in-place into preallocated scratch buffers.
  - Clears buffer and calls `gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0)`.
  - Generates **0 heap allocations per frame** in the steady-state render loop.
- **Automated Verification:**
  - Playwright E2E test (`test/e2e/webgl.spec.js`) verifies canvas visibility, 600x600 dimensions, continuous animation loop over 500ms, and 0 WebGL/runtime console errors.

---

## Implementation Breakdown (Phases & Tasks)

### Phase 1: Sized Numeric Types & Decoupling in Typechecker
- **Target Files:** `src/typechecker/types.js`, `src/typechecker/assignability.js`
- [x] **Task 1.1 — Decouple Sized Types:** Define distinct basic type singletons for `FLOAT32`, `FLOAT64`, `UINT8` (`BYTE`), `UINT16`, `UINT32`, `INT8`, `INT16`, and `INT32` instead of collapsing them to generic `FLOAT64` and `INT`.
- [x] **Task 1.2 — Numeric Predicates & Assignability:** Update `isNumeric()` to recognize all sized basic types. Update `UNTYPED_COMPAT` in `assignability.js` so untyped numeric constants cleanly assign to sized numeric variables.
- [x] **Task 1.3 — TypedArray Type Identification Helpers:** Add `isTypedArraySlice(type)` and `typedArrayConstructorForElem(elemType)` helpers to query whether a slice element type maps to a JavaScript TypedArray.

### Phase 2: Zero-Allocation `for range` Loops
- **Target Files:** `src/codegen/statements.js`
- [x] **Task 2.1 — Indexed Loop Transformation:** In `_genForRange` / `_genRangeIterExpr`, detect slice and array types and emit indexed loops instead of `.entries()` iterator tuples.
- [x] **Task 2.2 — Nil Slice Guard:** Emit `__len${depth} = __arr${depth} ? __arr${depth}.length : 0` to prevent runtime crashes when ranging over unallocated/nil slices.
- [x] **Task 2.3 — Variable Hygiene & Reassignment:** Emit `let v = __arr[i]` for loop value copies to allow reassignment within the loop body. Skip element assignment entirely if the value variable is blank identifier `_`.
- [x] **Task 2.4 — Assignment Statement Form:** Support `for i, v = range arr` (`AssignStmt`) by avoiding `let` variable redeclarations.
- [x] **Task 2.5 — Nested Scoping:** Append loop nesting depth to temp register identifiers (`__arr${depth}`, `__len${depth}`) to prevent collisions in nested loops.

### Phase 3: First-Class TypedArray Slices & Sub-slicing
- **Target Files:** `src/codegen/expressions.js`, `src/codegen/runtime.js`
- [x] **Task 3.1 — Typed `make()` Allocation:** Emit `new Float32Array(n)` when compiling `make([]float32, n)` (and respective constructors for `uint8`, `uint32`, etc.).
- [x] **Task 3.2 — Slice Literals:** Compile slice literals of sized numeric types (`[]float32{...}`) to `new Float32Array([...])`.
- [x] **Task 3.3 — Zero-Copy Slicing:** When sub-slicing a TypedArray slice (`s[low:high]`), emit `s.subarray(low, high)` rather than `.slice()`.
- [x] **Task 3.4 — Runtime Builtins (`copy`, `append`, `__equal`):**
  - Compile `copy(dst, src)` on TypedArrays to `dst.set(src.subarray(0, count))`.
  - Implement `__typedAppend(target, ...items)` using capacity doubling and `.set()` buffer transfer.
  - Update `__equal` to compare TypedArrays efficiently using `ArrayBuffer.isView` byte-by-byte comparison.

### Phase 4: Struct Pointer Unboxing & Positional Constructors
- **Target Files:** `src/codegen/index.js`, `src/codegen/expressions.js`, `src/codegen/statements.js`
- [x] **Task 4.1 — Positional Struct Constructors:** Generate `class Struct { constructor(f1 = 0, f2 = 0) { ... } }` and instantiate via `new Struct(...)`, precomputing zero values for omitted fields.
- [x] **Task 4.2 — Pointer Unboxing (`&s` -> `s`):** Eliminate `{ value: s }` heap wrappers for struct pointers. Pass struct instances directly by object reference.
- [x] **Task 4.3 — Pointer Member Access Codegen:** Compile struct pointer dereferences `ptr.Field` directly to `ptr.Field` without intermediate `.value`.

### Phase 5: WebGL2 & WebGPU Typings in Stdlib
- **Target Files:** `src/typechecker/stdlib/web.js`, `src/typechecker/stdlib.js`, `src/typechecker/resolve.js`, `src/typechecker/assignability.js`
- [x] **Task 5.1 — TypedArray Builtins:** Define type representations for `ArrayBuffer`, `DataView`, `Float32Array`, `Uint8Array`, `Uint32Array`, etc., with their core methods (`subarray`, `set`, `buffer`, `byteLength`).
- [x] **Task 5.2 — WebGL2 & WebGPU Method Signatures:** Replace `ANY` placeholder for `WebGL2RenderingContext` and `GPUDevice` with typed interfaces supporting TypedArrays in buffer/uniform operations (`bufferData`, `bufferSubData`, `uniformMatrix4fv`).

### Phase 6: Reference Showcase (`example/webgl/`)
- **Target Files:** `example/webgl/index.html`, `example/webgl/src/main.go`, `test/e2e/webgl.spec.js`, `playwright.config.js`, `package.json`
- [x] **Task 6.1 — Application Implementation:** Build a complete 3D rotating colored cube application in GoFront.
- [x] **Task 6.2 — Buffer & Render Verification:** Upload geometry via `gl.bufferData` with `Float32Array` / `Uint16Array` and drive the animation loop with `requestAnimationFrame`.
- [x] **Task 6.3 — Zero Allocation & Dev Server Smoke Test:** Verify 0 bytes allocated per frame in Chrome DevTools and verify live reload with `gofront dev` / Playwright E2E test.

---

## Edge Cases

- **TypedArray `len()` and `cap()`:** For TypedArrays, `len(arr)` and `cap(arr)` both evaluate to `arr.length`.
- **Bounds Checking & Clamping:** Go panics on out-of-bounds slicing `s[10:20]` when `len < 20`. JS `.subarray(10, 20)` clamps quietly. In dev builds (`--check`), bounds assertions can be emitted; in production (`--minify`), `.subarray` runs at native C++ speed.
- **JSON Serialization Interop:** In JavaScript, `JSON.stringify(new Float32Array([1, 2]))` produces `{"0": 1, "1": 2}` rather than `[1, 2]`. Document this behavior for network serialization boundaries.
- **`nil` Slices:** `var s []float32` produces `null`. `len(s)` evaluates to 0, range loops run 0 times, and `copy(dst, s)` copies 0 elements without throwing.
- **Generics & Mixed Slice Types:** Generic functions `func Map[T any](s []T)` operate correctly whether passed generic JS `Array` or a `Float32Array`.

---

## Test Plan

### Unit Tests (`test/unit/`)
1. **Loop Codegen (`test/unit/codegen/loops_test.js`):**
   - Verify `for i, v := range slice` emits indexed loop without `.entries()`.
   - Verify `nil` slice ranging executes 0 times and does not throw.
   - Verify range value reassignment (`v = clean(v)`) emits `let v` and executes properly.
   - Verify assignment-form ranges (`for i, v = range arr`) do not emit duplicate `let`.
   - Verify nested ranges do not collide on loop register variables.
   - Verify map ranges still emit `Object.keys()` / `Object.entries()`.
2. **TypedArray Codegen (`test/unit/codegen/typedarray_test.js`):**
   - Verify `make([]float32, 128)` emits `new Float32Array(128)`.
   - Verify `s[2:8]` on `[]float32` emits `s.subarray(2, 8)`.
   - Verify `copy(dst, src)` on TypedArrays emits `dst.set(...)` and succeeds without `.splice`.
   - Verify subslice mutations reflect in the parent buffer (zero-copy sharing).
3. **Struct Literal & Pointer Codegen (`test/unit/codegen/struct_test.js`):**
   - Verify `Point{X: 1, Y: 2}` emits positional constructor `new Point(1, 2)`.
   - Verify `Point{Y: 2}` emits `new Point(0, 2)` with precomputed zero values.
   - Verify struct pointers `&point` do not emit `{ value: point }`.
   - Verify field access through struct pointers `ptr.X` compiles to `ptr.X`.
4. **Type Checking (`test/unit/typechecker/webgl_test.js`):**
   - Verify `[]float32` and `[]float64` are recognized as distinct types.
   - Verify WebGL2 and WebGPU API calls compile with full type validation.

### Zero-Allocation Verification Benchmark (`test/e2e/perf/`)
- Implement a 100,000-iteration ray-triangle intersection and physics sweep benchmark in GoFront.
- Measure heap allocation in Node.js via `v8.getHeapSpaceStatistics()` before and after the loop.
- Assert that allocated heap memory delta is **0 bytes** during hot loop execution.

### End-to-End Showcase Verification (`example/webgl/`)
- Compile and run `example/webgl` via `gofront dev example/webgl` (or `gofront example/webgl`).
- Verify the 3D colored cube renders and rotates smoothly at 60/120 FPS.
- Profile in Chrome DevTools / Performance panel: verify the JS heap memory timeline remains completely flat (sawtooth-free) during continuous rendering (0 B/frame GC pressure).
- Verify hot-reload cleanly re-executes canvas initialization on code edits.
