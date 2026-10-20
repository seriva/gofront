# WASM SIMD Promotion & SoA Pipelines — Design Plan

**Version:** v1.7.1  
**Status:** Draft (2026-10-19)

---

## Goal

Promote `gofront/simd` from experimental groundwork to a first-class standard library package in v1.7.1. In v1.7.0, Array-of-Structures (AoS) 3D vector math achieved a 1.02× speedup over scalar WASM (missing the release plan's $\ge 1.30\times$ threshold) because the 4th lane was underutilized and octree tree traversal dominated leaf triangle compute. 

v1.7.1 solves this by introducing **Structure-of-Arrays (SoA)** 4-wide primitives (`Vec3x4`, `AABB4`, `Ray4`) and batch stream memory operations. By computing 4 independent points, rays, or particles simultaneously across all 4 vector lanes without horizontal shuffles, SIMD throughput is targeted to achieve **$2.0\times - 3.5\times$ speedup** over scalar WASM in batch workloads (e.g. particle simulations, bounding box culling, and vertex streaming).

---

## Out of Scope

- **Auto-Vectorization:** GoFront will not introduce an LLVM-style compiler auto-vectorization pass. Vectorization remains explicit, predictable, and zero-overhead through `gofront/simd` types.
- **64-bit and Integer SIMD vectors:** `F64x2`, `I16x8`, and `I8x16` remain out of scope; v1.7.1 focuses strictly on single-precision 3D/graphics/physics computing (`F32x4` and selection masks).
- **Relaxed SIMD:** WebAssembly relaxed SIMD opcodes are non-deterministic across hardware platforms; GoFront adheres exclusively to deterministic standard WASM SIMD (`0xFD`).
- **Threaded / SharedArrayBuffer SIMD:** Concurrency remains single-threaded in accordance with GoFront's no-runtime architecture.

---

## Analysis: Why SoA Over AoS for 3D Math

| Layout | Memory Order | Lane Utilization for 3D $(x, y, z)$ | Dot Product Cost |
| :--- | :--- | :--- | :--- |
| **AoS** (Array of Structures) | `[X0, Y0, Z0, _], [X1, Y1, Z1, _]` | 75% compute density (lane 3 is padding) | 1 mul + 2 horizontal shuffles/adds (`Dot3`) |
| **SoA** (Structure of Arrays) | `X: [0,1,2,3], Y: [0,1,2,3], Z: [0,1,2,3]` | **100% compute density** (4 points at once) | 3 parallel `mul` + 2 parallel `add` (0 shuffles) |

In AoS 3D math, computing the dot product of two vectors requires extracting lanes and performing cross-lane horizontal addition, stalling the vector pipeline. In SoA, computing the dot products of 4 vector pairs simultaneously requires zero shuffles:
$$\text{Dot}_4 = (X_A \times X_B) + (Y_A \times Y_B) + (Z_A \times Z_B)$$
All 4 operations execute in pure vertical SIMD instructions across the vector execution units.

---

## Approach

### 1. High-Level Types in `gofront/simd`

```go
package simd

// F32x4 remains the fundamental 4-lane value type
type F32x4 struct { ... }

// Vec3x4 represents 4 parallel 3D vectors:
// X holds x0, x1, x2, x3; Y holds y0, y1, y2, y3; Z holds z0, z1, z2, z3
type Vec3x4 struct {
    X F32x4
    Y F32x4
    Z F32x4
}

// Ray4 represents 4 rays bundled together for packet traversal
type Ray4 struct {
    Origin Vec3x4
    Dir    Vec3x4
    InvDir Vec3x4
}

// AABB4 represents 4 Axis-Aligned Bounding Boxes
type AABB4 struct {
    Min Vec3x4
    Max Vec3x4
}
```

### 2. Parallel Math & Selection Operations

- **Component-wise vector arithmetic:**
  - `a.Add(b Vec3x4) Vec3x4`
  - `a.Sub(b Vec3x4) Vec3x4`
  - `a.MulScalar(s F32x4) Vec3x4`
  - `a.Dot(b Vec3x4) F32x4` — returns 4 dot products in a single `F32x4`
  - `a.Cross(b Vec3x4) Vec3x4` — parallel cross products
  - `a.Normalize() Vec3x4`
- **Masking & Bitselect:**
  - `a.Less(b F32x4) Mask32x4` (`f32x4.lt`)
  - `a.Greater(b F32x4) Mask32x4` (`f32x4.gt`)
  - `simd.Select(mask Mask32x4, trueVal, falseVal F32x4) F32x4` (`v128.bitselect`)
  - `mask.Any() bool` (`v128.any_true`)
  - `mask.All() bool` (`v128.all_true`)

### 3. Bulk Linear-Memory Stream Operations (`gofront/shared`)

Streaming data between `gofront/shared.Float32` and `Vec3x4`:
- `simd.LoadVec3x4(xBuf, yBuf, zBuf shared.Float32, offset int) Vec3x4`
- `simd.StoreVec3x4(xBuf, yBuf, zBuf shared.Float32, offset int, v Vec3x4)`
- **AoS-to-SoA Transpose Helpers:**
  - `simd.LoadAoS4(buf shared.Float32, elemOffset int) (Vec3x4, F32x4)` — reads 16 consecutive floats (4 interleaved $(x, y, z, w)$ structures) and executes 4-way shuffle transpose into 3 parallel vector lanes + 1 attribute lane.
  - `simd.StoreAoS4(buf shared.Float32, elemOffset int, v Vec3x4, w F32x4)` — transposes back to interleaved layout for GPU vertex buffer upload.

### 4. JS↔WASM Boundary Transport

- Allow `shared.Float32` SoA stream buffers to cross directly into JavaScript as `Float32Array` handles with zero copies.
- Add typechecker and boundary support for returning `simd.F32x4` arrays (`[]simd.F32x4`) as aligned typed views across the boundary.

---

## Edge Cases

1. **Array Lengths Not Divisible by 4:**
   - Batch loops process `len - (len % 4)` in 4-wide steps.
   - Provide a clean idiom or helper (`simd.PadBuffer(n)`) so linear memory buffers are aligned to 4-float multiples without edge-case out-of-bounds traps.
2. **Division by Zero and IEEE-754 Special Floats:**
   - Division by zero in any SIMD lane must yield `+Inf` / `-Inf` without hardware traps or exceptions, matching Go and WebAssembly IEEE-754 specifications.
3. **JS Target Bit Parity:**
   - The JS backend fallback must evaluate `Vec3x4` operations using `Math.fround` across each lane to preserve bit-level agreement in `both` package test suites.
4. **NaN Handling in Min / Max:**
   - WASM `f32x4.pmin` / `f32x4.pmax` vs `f32x4.min` / `f32x4.max`. Follow Go's `math.Min`/`math.Max` rules (where `NaN` propagates).
5. **Boundary-in-Loop Overhead with SoA:**
   - Invoking SoA SIMD methods on individual 4-tuples inside a JS loop defeats vectorization gains due to boundary marshalling overhead. The `boundary-in-loop` compiler warning must explicitly flag WASM SoA method invocations inside loops, directing users toward batch buffer streaming via `shared.Float32`.

---

## Implementation Tasks

### Phase 1: Core SoA Vector Types & Instructions
- [ ] **Task 1.1** — Add mask types (`Mask32x4`), comparison opcodes (`f32x4.eq`, `ne`, `lt`, `le`, `gt`, `ge`), and `v128.bitselect` to `src/backend/wasm/encode.js` and `wat.js`.
- [ ] **Task 1.2** — Implement `Mask32x4` and bitselect lowering in WASM emitter and JS runtime fallback.
- [ ] **Task 1.3** — Implement `Vec3x4` compound struct and parallel methods in `src/typechecker/stdlib/simd.js`, `src/backend/wasm/stdlib/simd.js`, and `src/backend/js/stdlib/simd.js`.

### Phase 2: SoA Batch Memory & Transpose Helpers
- [ ] **Task 2.1** — Implement `LoadVec3x4` and `StoreVec3x4` with bounds checking on `shared.Float32`.
- [ ] **Task 2.2** — Implement 4-way shuffle transpose (`LoadAoS4` and `StoreAoS4`) using `i8x16.shuffle` for zero-cost conversion between GPU vertex buffers and SoA compute registers.
- [ ] **Task 2.3** — Comprehensive unit and parity tests in `test/unit/wasm/simd.test.js`.

### Phase 3: Benchmarks & Performance Gate ($\ge 1.30\times$)
- [ ] **Task 3.1** — **Particle Kinematics Benchmark:** Update `example/hybrid` or a dedicated benchmark stepping 65,536 particles (position integration, velocity damping, gravity, bounding box bounce) comparing scalar WASM vs SoA SIMD.
- [ ] **Task 3.2** — **4-Way Ray-AABB Packet Traversal:** Implement parallel 4-ray slab testing in `test/e2e/perf/raycast-bench.js`.
- [ ] **Task 3.3** — Measure and record performance: verify speedup meets the $\ge 1.30\times$ promotion gate (expected $\ge 2.0\times$).

### Phase 4: Integration, Promotion & Documentation
- [ ] **Task 4.1** — Promote `gofront/simd` in `docs/hybrid-wasm.md` and `docs/go-compatibility.md` from experimental to stable.
- [ ] **Task 4.2** — Adopt SoA SIMD in `example/hybrid` particle simulation.
- [ ] **Task 4.3** — Verification: `npm test`, `npm run check`, `npm run build`, `npm run test:e2e`, `npm run bench`.
- [ ] **Task 4.4** — Update `CHANGELOG.md` and `docs/roadmap.md` for v1.7.1.

---

## Test Plan

### Unit & Parity Tests
- **`test/unit/wasm/simd.test.js`:**
  - Verify `Mask32x4` comparison results and `v128.bitselect` conditional assignment.
  - Verify `Vec3x4.Dot`, `Cross`, and `Normalize` match scalar calculations within $1\text{e-}6$ float precision across both JS and WASM backends.
  - Verify `LoadAoS4` and `StoreAoS4` round-trip accurately against scalar element copies.

### Negative & Boundary Tests
- Out-of-bounds offsets for `LoadVec3x4` / `StoreVec3x4` trap with Go panic messages.
- Attempting to pass `Vec3x4` directly across the boundary without `shared.Float32` produces clear diagnostic hints.

### Performance Gates
- **Kinematics:** $\ge 2.0\times$ speedup on 65,536 particles vs scalar WASM.
- **Ray-AABB Packet:** $\ge 1.30\times$ speedup on bounding box intersection vs scalar WASM.
