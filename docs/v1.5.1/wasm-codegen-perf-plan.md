# WASM Codegen Performance — Design Plan

**Version:** v1.5.1  
**Status:** Completed (2026-10-06)  
**Baseline:** v1.5.0 WASM backend (`src/backend/wasm/`), Phase 6a/6b done  
**Blocks:** v1.5.0 Phase 6c (go/no-go publish) — see [`docs/v1.5.0/wasm-mvp-plan.md`](../v1.5.0/wasm-mvp-plan.md)  
**Continues in:** [`docs/v1.6.0/wasm-hybrid-plan.md`](../v1.6.0/wasm-hybrid-plan.md)

---

## Goal

Make the hybrid build **at least as fast as the JS-only build** on the Phase 6b raycast benchmark before the go/no-go number is published.

Phase 6b produced the first honest number and it is the wrong way round:

| mode   | rays/s | ms/run | alloc/ray | wasm    |
| ------ | -----: | -----: | --------: | ------- |
| js     | 25,660 |  3,897 |    6.2 B  | —       |
| hybrid | 16,678 |  5,996 |    0.8 B  | 86.6 KB |

**hybrid = 0.65× JS.** Profiling (see [Findings](#findings)) shows the boundary is not the problem (0.5 % of samples) and neither is allocation (0.8 B/ray). The time is spent inside the WASM functions themselves, and the WAT dump shows why: the emitter produces correct but naive code, and unlike V8's JS JIT — which rewrites naive JS into tight machine code for free — the WASM tier compiles roughly what it is given.

Two measurements bound the opportunity:

| experiment                                                                | rays/s | vs JS |
| ------------------------------------------------------------------------- | -----: | ----: |
| hybrid, as emitted                                                        | 16,678 | 0.65× |
| hybrid + forced V8 inlining (`--wasm-inlining-*` flags, not shippable)    | 21,619 | 0.84× |
| hybrid + Binaryen `wasm-opt -O3` on the emitted module (`--wasm-opt`)      | 21,266 | 0.83× |

A general-purpose optimiser only recovers a third of the gap, because it cannot see Go's semantics: it does not know that a slice header is immutable after construction, that `int` indices fit in i32 once bounds-checked, or that a nil check followed by a `struct.get` is a trap we would be happy to take. The emitter does, so the fixes live in the emitter.

This release has no language-feature content. It is codegen quality only, measured by one benchmark and one size number.

## Out of Scope

- **New language features in WASM** (maps, interfaces, closures over captured refs, `defer`/`recover`, generics): v1.6.0.
- **Boundary v2 / shared linear-memory buffers / memory-slot ABI:** v1.6.0. The boundary measures at 0.5 % of the profile; redesigning it now would be optimising the wrong thing.
- **Shipping Binaryen.** `wasm-opt` stays an optional benchmark flag (`--wasm-opt <bin>`) to measure the ceiling. It is not a dependency, not a build step, and the v2.0.0 native port must not need it.
- **A general optimiser pass over the IR** (SSA, GVN, LICM). Each item below is a targeted change to one emission site, verified by the benchmark. If the benchmark is met without a pass, no pass is written.
- **JS backend changes.** The JS-only variant is the yardstick and must not move.
- **The simplefps `physics` package in WASM**: v1.6.0.

## Findings

All numbers from `npm run bench:raycast` (131,072 triangles, 100,000 rays, median of 5) and the WAT dump of the benchmark's `collision` module (`compileDir(dir, { emitWat: true })`, 57,501 lines, 579 functions).

**Where the time goes** (`--cpu-prof`, hybrid): `Ray.IntersectTrimesh` + `OctreeNode.RayQueryLocal` + `Trimesh.GetVertex`/`GetNormal` + `RayPointInTriangle` ≈ 95 %. Boundary trampolines ≈ 0.5 %. GC ≈ 1 %.

**What the hot code looks like.** `Trimesh.GetVertex` is three slice reads and three field writes:

```go
func (tm *Trimesh) GetVertex(i int, out *mathx.Vec3) *mathx.Vec3 {
    i3 := i * 3
    out.X = tm.Vertices[i3]
    out.Y = tm.Vertices[i3+1]
    out.Z = tm.Vertices[i3+2]
    return out
}
```

It compiles to **199 instructions**. Each `tm.Vertices[k]` is:

```wat
local.get $tm            ;; nil check on tm (repeated per access)
ref.is_null
if  i32.const N  call $str  call $panic  unreachable  end
local.get $tm
struct.get $Trimesh 2    ;; load slice header
local.set $s
local.get $s             ;; nil check on the header
ref.is_null
if  ...zero len/off/arr...
else
  local.get $s  struct.get $Slice 2  local.set $len   ;; three header loads
  local.get $s  struct.get $Slice 1  local.set $off
  local.get $s  struct.get $Slice 0  local.set $arr
end
local.get $i64           ;; bounds check in i64
local.get $len
i64.extend_i32_u
i64.ge_u
if  i32.const M  call $str  call $panic  unreachable  end
local.get $arr           ;; finally the read
local.get $off
local.get $i64  i32.wrap_i64  i32.add
array.get $F32Arr
```

That is ~35 instructions, with a branch and three dependent loads, for one `f32` read that should be `array.get` with an `i32` index and one `br_if`. Module-wide counts: 2,317 slice-header `struct.get`s, 1,769 `ref.is_null` checks, 825 `i64.extend_i32_u`, 120 `global.get`.

**Why V8 does not fix it.** V8's WASM inliner only inlines callees below `--wasm-inlining-max-size=500` wire bytes within a per-caller budget. `GetVertex` (199 instrs), `Vec3.Sub` (104), `Vec3.Cross` (128), `Vec3.ScaleAndAdd` (110) are each large enough that the budget runs out after one or two of them in `IntersectTrimesh` (2,237 instrs). The same methods in JS are 3–5 bytecodes and inline trivially. Shrinking the leaf methods is therefore worth more than their own cost: it lets the engine inline them, which is what makes the JS build fast.

**Why `wasm-opt` tops out at 0.83×.** The slice-header struct is declared with `mut` fields (`(struct (field (mut (ref null $arr))) (field (mut i32)) (field (mut i32)) ...)`), so no optimiser may assume two reads of `len` return the same value across an intervening store; the explicit nil-check `if` blocks have side effects (a call) on one arm, so they are not hoistable; the i64 index arithmetic is semantically required unless the optimiser can prove range, which it cannot without the bounds check being expressed in a form it recognises.

## Approach

Each item names the emission site, the before/after shape, and the expected effect. Order is by expected payoff divided by risk; the benchmark after each item decides whether the next one is still needed.

### 1. Slice headers are immutable values

**Now:** `getSliceType()` in [`src/backend/wasm/types.js`](../../src/backend/wasm/types.js) emits `(struct (mut arr) (mut off) (mut len) (mut cap))`. Every slice read goes through `emitIndexExpr` → the null-check `if/else` + three `struct.get`s shown above.

**Change:**
- Declare the header fields **immutable** (`field` without `mut`). Go slice headers are values; `append`, reslicing and assignment already allocate a new header (`struct.new`), so no site mutates one in place. Immutability is what lets both V8 and any later optimiser CSE the header loads.
- Give **nil slices a real header** (`arr = null`, `off = 0`, `len = 0`, `cap = 0`) instead of `ref.null`, allocated once per element type as a module-level immutable global. `s == nil` compiles to `ref.eq` against that global (or `len == 0 && arr == null`, whichever the current `==` lowering needs). This removes the `ref.is_null` branch at every read, write, `len()`, `cap()`, range, and reslice site. Zero-value struct fields, `var s []T`, and `nil` literals of slice type all pick the shared empty header.
- `emitIndexExpr`, the assignment path (`_emitIndexValAndBoundsCheck` callers at ~1098, ~1551, ~1811), `len`/`cap`, `range`, `append`, `copy`, and `emitSliceExpr` stop emitting the null arm.

**Expected:** ~−8 instructions per access, one fewer branch, and the header loads become hoistable. This is the single largest item.

### 2. One i32 bounds check, i32 index arithmetic

**Now:** `_emitIndexValAndBoundsCheck` evaluates the index as i64, extends `len` to i64, compares with `i64.ge_u`, then `i32.wrap_i64`s the index. Range loops (`for i := 0; i < len(s); i++`) keep `i` in i64 for the whole body, so every `i*3+1` is i64 arithmetic followed by a wrap.

**Change:**
- When the index is already an **i32 local** (see next bullet), the check is `local.get idx; local.get len; i32.ge_u; br_if $oob` and the value feeds `array.get` directly: no extend, no wrap. When the index is genuinely i64 the current `i64.ge_u` against `i64.extend_i32_u len` stays — it is one compare and is already correct for negative indices (they compare as huge unsigned values).
- Introduce an **i32 fast path for loop induction variables**: when `lower` or the emitter sees `for i := a; i < len(x) [or constant < 2³¹]; i++` with `i` not escaping and not assigned elsewhere, keep `i` as an i32 local for the body and skip the extend/wrap at each use; derived expressions like `i*3+1` stay i32 too. This is the Go-semantic knowledge an external optimiser cannot have, and it covers every loop in `trimesh.go`/`octree.go`.
- Fuse the panic arm into a single out-of-line `call $boundsPanic` **after** a `br_if` rather than an `if … end` block, so the hot path is `local.get; local.get; i32.ge_u; br_if $oob` with the cold code at the end of the function. (Same shape for all runtime panics; see item 3.)
- Also apply to `_emitIndexExprToI32` (reslice bounds) and the string index path.

**Expected:** −4 to −6 instructions per access, no i64 ALU in the inner loops.

### 3. Trap-based nil dereference

**Now:** `_emitNilCheck` (emit.js ~404) emits `ref.is_null; if; call $str; call $panic; unreachable; end` before every `struct.get`/`struct.set`/`call_ref` through a possibly-nil pointer. 1,769 sites in the benchmark module. The v1.5.0 plan justified this with "so the panic message matches the JS backend's".

**Change:**
- Drop the guard and let `struct.get` on null **trap**. WasmGC raises `WebAssembly.RuntimeError` with a `"null dereference"`/`"dereferencing a null pointer"` message. The boundary already turns `env.panic` into a JS `Error`; it additionally maps a `RuntimeError` whose message matches the null-deref pattern to `runtime error: invalid memory address or nil pointer dereference`, so **observable behaviour is unchanged** for JS callers. Inside WASM a trap is not recoverable, but neither is a v1.5.0 panic (`recover` is v1.6.0), so nothing is lost yet; v1.6.0's `recover` design must account for this (an explicit check only where a `defer`/`recover` frame is live is the obvious shape and is noted there).
- Keep an explicit check **only** where the trap would not fire at the right place: a nil receiver passed to a method that never dereferences it (Go allows this and so must we — no check needed, it simply does not trap), and `ref.is_null` tests the program writes itself (`if p == nil`), which are not checks but code.
- Update [`test/unit/wasm/structs.test.js`](../../test/unit/wasm/structs.test.js) and [`closures.test.js`](../../test/unit/wasm/closures.test.js) assertions to exercise the JS-visible message via the facade, not the WAT.

**Expected:** −5 instructions and one branch per pointer access; function bodies shrink enough (see item 4) for the engine to inline them.

### 4. Leaf methods small enough to inline

After 1–3, re-measure the hot leaf sizes. Target: `Vec3.*` ≤ 30 instructions, `Trimesh.GetVertex`/`GetNormal` ≤ 40. Then:

- Remove **redundant local shuffles** the emitter produces when an expression result is immediately stored and reloaded (`local.set 11; local.get 11` → `local.tee 11` or nothing). This is a peephole in `pushInstruction`/function finalisation, not an IR pass.
- Verify with `--trace-wasm-inlining` that V8 now inlines the `Vec3` methods and `GetVertex`/`GetNormal` into `IntersectTrimesh` with default flags. If a specific callee is still over budget, that is the next target; do not touch flags.

### 5. Scratch globals cached in locals

**Now:** package-level scratch objects (`var _itA = mathx.NewVec3()`) are `global.get` + nil check + `struct.get` on every use; inside the Möller–Trumbore inner loop that is dozens of `global.get`s per triangle.

**Change:** at function entry, for each package-level pointer global the function reads but never assigns, `global.get` once into a local and use the local. Correctness: a global can only be reassigned by this function (we checked it is not), by a callee, or by another goroutine (none). Callees reassigning scratch globals is legal Go; the emitter only applies the cache when the whole package never assigns the global outside its initialiser, which `lower` can tell from a single pass. Falls back to `global.get` otherwise.

**Expected:** small per-site win, but it compounds inside the inner loop and removes the last branches from it after item 3.

### 6. Measure, then stop

After each item: `npm run bench:raycast`, `npm test`, WAT size of the benchmark module, instruction counts of the five hot functions. Record in the table under [Results](#results). Stop when **hybrid ≥ JS** with margin, or when all six items are done — in which case the number is the honest answer and 6c publishes it as is.

## Edge Cases

- **Slice header sharing.** With immutable headers and a shared empty header per element type, `s1 == nil` must not be true for a non-nil zero-length slice (`make([]T, 0)`). `make` allocates a fresh header with a non-null (possibly zero-length) array; only the literal/zero value uses the shared one. Equality against nil compares the `arr` field for null, not header identity.
- **Reslicing a nil slice** (`var s []int; s = s[0:0]`) is legal and yields nil; `s[:0]` on the shared empty header must return the same shared header.
- **`append` on nil** must keep allocating from the shared header's zero capacity; the `cap` field is immutable so growth always builds a new header. Already the case; add a test that the shared header is never written.
- **Bounds check with negative `int` index.** `i64.ge_u` treats negative as huge, which is the current trick; the i32 path must preserve it (wrap *after* the unsigned compare, or compare in i32 only when the index is a proven-non-negative induction variable).
- **Induction-variable i32 fast path when the loop bound exceeds 2³¹.** Only applies when the bound is `len(x)` (always < 2³¹ for WasmGC arrays), a constant < 2³¹, or an i32-typed expression. Anything else keeps i64.
- **Induction variable escapes** (address taken, captured by a closure, assigned in the body, used after the loop): no fast path. `lower` already computes escapes for closures; reuse.
- **Nil check removed, trap message differs by engine.** V8: `RuntimeError: dereferencing a null pointer`; SpiderMonkey/JSC use other wordings. The boundary matches on `instanceof WebAssembly.RuntimeError` plus a small wording list, falling back to the raw message with the Go prefix. Document the list.
- **Nil method receiver that is never dereferenced** must keep working (Go permits `var p *T; p.Method()` if `Method` does not touch `*p`). Removing the eager check makes this *more* correct than v1.5.0, which panics eagerly today. Add a test.
- **`unreachable` after `env.panic`.** Unchanged, but the panic arms move out of line (`br_if` to a block at function end); the validator still needs `unreachable` to type the cold block.
- **Scratch global cache and package initialisation order.** The cached local is loaded at function entry, after the start function has run, so initialisers are visible. Functions called *from* the start function (package init helpers) are excluded from caching since globals may not be set yet.
- **JS backend parity.** None of this touches `src/backend/js` or `lower`'s output for JS; the parity suite (`both` packages compiled twice) is the regression net.
- **WAT golden tests** ([`test/unit/wasm/wat.test.js`](../../test/unit/wasm/wat.test.js)) will change for every item; update them per item, not in one sweep, so the diff per change stays reviewable.

## Implementation Tasks

- [x] **Task 0 — Baseline and tooling**
  - [x] `--wasm-opt <bin>` flag in `raycast-bench.js` (ceiling measurement; Binaryen not a dependency).
  - [x] `npm run bench:raycast -- --json` baseline committed to this doc's Results table.
  - [x] Script (or `--sizes` flag on the bench) that prints instruction counts of `Trimesh.GetVertex`, `Trimesh.GetNormal`, `Vec3.Sub`, `Vec3.Cross`, `RayPointInTriangle`, `IntersectRayAABB`, `OctreeNode.RayQueryLocal`, `Ray.IntersectTrimesh` from the WAT.
- [x] **Task 1 — Immutable slice headers + shared empty header** (`types.js`, `emit.js` slice sites, `boundary.js` if it constructs headers for JS→wasm slice args).
  - [x] Header struct fields non-`mut`; audit every `struct.set` on a header type and replace with `struct.new`.
  - [x] Shared empty header per element type; nil-slice zero values, literals and `== nil` use it.
  - [x] Remove the null arm from `emitIndexExpr`, index assignment, `len`/`cap`, `range`, `append`, `copy`, `emitSliceExpr`.
  - [x] Tests: `slices.test.js` nil/empty semantics, `append` on nil, reslice of nil, parity on both targets.
- [x] **Task 2 — i32 bounds check and induction variables**
  - [x] `_emitIndexValAndBoundsCheck`: single compare, `br_if` to out-of-line panic block, no post-wrap when index is already i32.
  - [x] i32 induction-variable fast path for `for i := a; i < len(x)|const; i++` with non-escaping `i`.
  - [x] `_emitIndexExprToI32` and string index use the same shape.
  - [x] Tests: negative index panics, index ≥ 2³² panics, loop over 2³¹-bound keeps i64, escape cases keep i64.
- [x] **Task 3 — Trap-based nil dereference**
  - [x] Remove `_emitNilCheck` emission at pointer `struct.get`/`struct.set`/`call_ref` sites; keep behaviour for user-written `== nil`.
  - [x] Boundary: map `WebAssembly.RuntimeError` null-deref messages to the Go panic string.
  - [x] Tests: `structs.test.js`, `closures.test.js` message assertions via facade; nil receiver on non-dereferencing method succeeds; `traps.test.js` gains a nil-deref case.
  - [x] v1.5.0 plan edge case "Nil pointer dereference" updated to point here.
- [x] **Task 4 — Leaf size and inlining**
  - [x] `local.set`/`local.get` → `local.tee` peephole at function finalisation.
  - [x] Hot leaf sizes recorded; `--trace-wasm-inlining` confirms default-flag inlining of `Vec3.*` and `GetVertex`/`GetNormal`.
- [x] **Task 5 — Scratch globals cached in locals** (`lower` computes "never assigned outside init"; emitter caches at entry; excluded from init-path functions).
  - [x] Tests: global reassigned in a callee is not cached; init-order case.
- [x] **Task 6 — Results and hand-off** (owns the v1.5.0 Phase 6c publish)
  - [x] Results table below filled per task.
  - [x] Manual simplefps play session at 60 FPS on the hybrid build.
  - [x] gofront `CHANGELOG.md` / `README.md` (WASM section) and simplefps `CHANGELOG.md` publish the final hybrid vs JS number: **the go/no-go**.
  - [x] `docs/roadmap.md` v1.5.1 row statuses updated.

## Test Plan

- **Unit:** all existing `test/unit/wasm/*.test.js` pass; new cases listed per task above. WAT golden files updated per task.
- **Parity:** every `both` package in `example/` and the benchmark fixture's `mathx` compiles and passes on both targets with identical results.
- **Panic parity:** index-out-of-range, nil-deref, divide-by-zero messages seen by a JS caller are byte-identical before and after (facade-level test, not WAT-level).
- **Benchmark:** `npm run bench:raycast` after each task; hits must still equal rays (the bench exits 1 otherwise). Pass criterion for the release: **hybrid rays/s ≥ js rays/s** (median of 5) on the maintainer machine, hybrid alloc/ray ≤ 1 B.
- **Size:** benchmark module `.wasm` size and instruction counts of the eight hot functions recorded per task; none may grow.
- **simplefps:** `npm run check`, `npm test`, `npm run test:dom`, `npm run test:perf` (zero-alloc gate), `npm run test:e2e`, and a manual 60 FPS play session on the hybrid build — the latter is the Phase 6c step and runs once at the end.
- **Gate:** `npm run check`, `npm test`, `sentrux gate` green in gofront after every task.

## Results

Filled in as tasks land. Benchmark: 131,072 triangles, 100,000 rays, median of 5, Node v25, same machine as the baseline.

| after task | js rays/s | hybrid rays/s | hybrid/js | wasm size | GetVertex instrs | IntersectTrimesh instrs |
| ---------- | --------: | ------------: | --------: | --------: | ---------------: | ----------------------: |
| baseline (v1.5.0 6b) | 25,660 | 16,678 | 0.65× | 86.6 KB | 199 | 2,237 |
| 1 slice headers      | 26,302 | 23,281 | 0.89× | 112.4 KB | 166 | 1,900 |
| 2 i32 indices        | 26,856 | 25,620 | 0.95× | 102.0 KB | 155 | 1,654 |
| 3 trap nil           | 28,013 | 30,981 | 1.11× | 87.5 KB | 101 | 1,259 |
| 4 inlining           | 27,238 | 31,275 | 1.15× | 84.1 KB | 95 | 1,194 |
| 5 scratch globals    | 26,720 | 31,293 | 1.17× | 84.3 KB | 95 | 1,222 |
| perf pass (temp reuse, stack indexing) | 25,457 | 29,509 | 1.16× | 64.9 KB | 71 | 1,007 |

Reference points, not targets: forced V8 inlining 21,619 (0.84×); `wasm-opt -O3` on the baseline module 21,266 (0.83×).

Post-task-5 ceiling checks (same machine, interleaved A/B runs; run-to-run noise on hybrid is ±8 %, 26k–30.5k for identical code): `wasm-opt -O3` over the task-5 module 29,427 vs 30,476 unoptimised, and a build with *every* slice bounds check removed 30,214 vs 30,542. Neither moves throughput, so the remaining instruction-level slack is code size, not speed. `--cpu-prof` on hybrid: 84.5 % self time in `Ray.IntersectTrimesh` (leaf methods inlined by V8), 12.5 % `RayQueryLocal`, 0.5 % GC, boundary < 0.2 %.

The perf-pass row is code-size only: ref-typed temps are now recycled (the free list was keyed by type *object*, so every `s[i]` site allocated two fresh ref locals), and slice/array indexing keeps `arr`, `off` and the checked index on the operand stack instead of spilling the header to three locals. Module −23 %, 30,780 → 23,306 instructions.
