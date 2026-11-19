# Value Stores — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Schedules the review follow-ups that [`assignment-semantics-plan.md`](assignment-semantics-plan.md) deferred at completion (its *Review follow-ups found while executing this plan* row, 11 entries), L14 from the former `followup-fixes-plan.md`, and the `plans/follow-ups.md` entry *Pointer method on a dereferenced named scalar*, re-probed 2026-11-17 and grouped by root cause. Phase 4 starts after [`wasm-struct-types-plan.md`](wasm-struct-types-plan.md) Phase 1 (one struct field list). Keeps the assignment plan's spec-only evaluation-order policy: nothing here changes output that the Go spec leaves unspecified.  
**Release note:** Assignments keep Go's value semantics in more places on every target: `for x = range seq` and comma-ok assignments into a variable whose address was taken update it in place, `p.F, *p.F = …` stores through the old pointer, compound assignments on complex numbers evaluate each operand once (also in a `for` post statement), struct copies on WebAssembly no longer share arrays or embedded structs, and `(*p).Inc()` on a named number type changes the value `p` points to.  

---

## Goal

Make every statement that stores a value follow one rule per backend instead of deciding copy, in-place update and pointer write per statement kind. Today the JS backend has at least six places that write `Object.assign(...)` or `__p.value = ...` themselves (`src/backend/js/statements.js:280`, `:637`, `:853`, `:1083`, `:1217`, `:1234`), a separate complex compound path, and the WASM backend has 18 occurrences (16 call sites) that each decide whether to call `emitCloneStruct`/`_emitCopyFieldValue`. The assignment-semantics plan fixed the repros it was given at one entry point each; its review found the same defects at the sibling entry points. This plan adds one store primitive per backend, routes every assignment form through it, and extends the differential fuzzer to the statement shapes those defects came from, so siblings fail in the fuzzer before review.

**Done means:**
- Every failing row in *Verified Gaps* prints Go 1.26's output on `js`, `both` and `wasm`, each as an `assertAllTargetsOutput` test in the file its task names.
- JS: `grep -n "Object.assign(" src/backend/js/statements.js` finds only the store primitive; WASM: struct and array stores call one `emitStoreValue`.
- `node test/fuzz/difffuzz.js --mode order --seed 1 --batches 20 --cases 30 --stmts 6` and the new `--mode stores --seed 1 --batches 20` report `0 distinct findings` (by hand; CI has no Go toolchain), and every generated batch compiles with Go.
- `npm test` passes; `bundle-size.baseline.json` is unchanged and `zero-alloc.js`/`bce-mathx.js` pass; the gc-order test sections the assignment plan lists still pass unmodified.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `fuzz-generator`: the differential fuzzer generates valid Go and only spec-determined statements, including the store shapes below | V1.1–V1.3 | |
| **In scope: core** | Roots `lhs-operand-binds`, `complex-compound-path`: assignment target operands are evaluated once, before any store, by the shared `lhsOperandBinds` and the general compound path | V2.1–V2.5 | |
| **In scope: core** | Root `js-store-target`: one JS store primitive decides blank, plain, in-place copy (address-taken or aliased), `*p` and generic `*T` stores for every statement kind and context | V3.1–V3.7 | |
| **In scope: target-specific** | Root `wasm-value-copy`: every store of a struct or array value on `wasm` deep-copies through one `emitStoreValue`, including captured variables and literal fields | V4.1–V4.4 | |
| **In scope: core** | Roots `deref-receiver`, `js-new-struct`: `&(*p)` and pointer-receiver calls on `(*p)` pass `p` itself (with nil check); `new(T)` of any struct type returns the struct object | V5.1–V5.3 | |
| **Excluded: deferred** | Matching gc's read-after-call order where the spec leaves it open | `a + f()` where `f` changes `a` | Assignment-semantics policy (user, 2026-11-16): spec only |
| **Excluded: deferred** | `wasm` struct layout and type keys | embedded literals, anonymous map keys, generic instances | [`wasm-struct-types-plan.md`](wasm-struct-types-plan.md) |
| **Excluded: deferred** | JS discarded map literal | `_ = map[any]int{1: 1}` → `SyntaxError` on js/both | Root `js-stmt-expr-start` (expression statement starting with `{`), not a store; scheduled in [`codegen-fixes-plan.md`](codegen-fixes-plan.md) |
| **Excluded: runtime / platform** | Running the fuzzer in CI | — | No Go toolchain in CI (v1.8.0 decision); findings become unit tests |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6`, 2026-11-17 (re-probed in review at `002e5180`, 2026-11-19). A throwaway driver (`.probes/`, deleted) ran each program with `go run` (go1.26.10, module mode) and `runProgram` (`test/unit/helpers.js:522`) on `js`/`both`/`wasm`. Types: `type S struct{ N int }`, `type P struct{ M int }`, `type V struct{ P; K int }`. *sibling* rows were found by probing the root's other paths.

### V1 `fuzz-generator`

Root: `test/fuzz/difffuzz.js` declares the closures `f0`–`f2` before `ks` though they may call it (and `sptrTarget` inside `mutation` at `:221` calls `ie(0)`, which can emit `ks(...)` inside `ks`'s own `ks := func(...)` literal), and `stmtConflicts` (`:140`) does not follow `ks(...)` calls into closure bodies; `genOrderCase` only generates scalar `m[k]` comma-ok (`:306`, `:310`) and scalar `for` post tuples (`:345`), never comma-ok into struct/address-taken/`*p`/generic targets, comma-ok type assertions, range-over-func `=`, `for` init comma-ok `:=`, `for` post with struct `*p` or complex `+=`, or closures capturing struct/array variables, which is where every V3/V4 defect is.

| ID | Probe | Want | Got |
|---|---|---|---|
| V1.1 | `node test/fuzz/difffuzz.js --mode order --stmts 12 --case 6873:0` | a valid Go program | Go rejects it: `Undefined: 'ks'` |
| V1.2 | same case | `xs[(f1(-4))&1] = ((a / 3) * -1)` regenerated (depends on read-vs-call order through `ks`) | passes `stmtConflicts` |
| V1.3 | inspect `genOrderCase` (`test/fuzz/difffuzz.js:281-362`) for V3/V4 store shapes | generated | none (only scalar `m[k]` comma-ok and scalar `for`-post tuples) |

### V2 `lhs-operand-binds`, `complex-compound-path`

Root: `lhsOperandBinds` (`src/lower/assign-order.js:23`) records only `Ident` targets as assigned (`:31`), so an operand that reads a field or element target assigned earlier in the same statement is evaluated after that store. `_genComplexCompoundAssign` (`statements.js:1240`) is a second compound-assignment path that skips operand binding and the statement context the general path handles.

| ID | Program | Go | GoFront |
|---|---|---|---|
| V2.1 | `type SP struct{ P *int }; sa, sb := 1, 2; sp := SP{P: &sa}; sp.P, *sp.P = &sb, 99; fmt.Println(sa, sb)` | `99 2` | `1 99` on all targets |
| V2.2 | `xs := []*int{&xa}; xs[0], *xs[0] = &xb, 99` | `99 2` | `1 99` on all targets |
| V2.3 | `m[k()] += z` (`map[string]complex128`, `k` counts) | `(2+3i) 1` | js/both `k` runs 3 times |
| V2.4 | `for i := 0; i < 2; c += z { i++ }` (`complex128`) | `(2+2i)` | js/both `(NaN+NaNi)` |
| V2.5 | `p := &c; c += f()` (`complex128`) | `(4+6i) (4+6i)` | js/both `Cannot read properties of undefined (reading 're')` |

### V3 `js-store-target`

Root: each statement kind decides how to store into its target (`_genCommaOkMapIndex` `:268`, `_genCommaOkTypeAssert` `:1068`, `_emitRangeVar` `:1582` used by `genIteratorFor` `:2063` and slice/map/string/int `range`, `_rangeAssignTemps` `:1745` used by map `range` `_genIterFor` `:1764` which only treats `_boxedVars` as needing temps and skips stable struct or sliced-array `Ident` targets, tuple and stable-tuple stores `:1160`/`:1227`, compound `:853`). Only some route an address-taken or aliased variable through `_emitCopyInto` and a `*p`/generic `*T` through `Object.assign`; the others emit `x = v` or an invalid `*p = v`, and the comma-ok `:=` emitter assumes a statement context that a `for` initializer does not provide.

| ID | Program | Go | GoFront |
|---|---|---|---|
| V3.1 | `s := S{1}; p := &s; for *p = range seq {}` (`seq` yields `S{5}`); *siblings* `for _, *p = range []S{{5}} {}` and `for _, *p = range map[int]S{1: {5}} {}` | `{5}` | js/both `Invalid left-hand side in assignment` |
| V3.2 | `ps := &s; for s = range seq {}` (yields `S{2}`) → `*ps, ps == &s`; *siblings* `for _, s = range []S{{2}} {}` and `for _, s = range map[int]S{1: {2}} {}` | `{2} true` | js/both `{1} false` (slice and map siblings also `{1} false` on `wasm`) |
| V3.3 | `sl := arr[:]; for arr = range seq {}` (yields `[2]int{7, 8}`) → `sl`; *sibling* `for _, arr = range [][2]int{{7, 8}} {}` | `[7 8]` | js/both `[0 0]` (slice sibling also `[0 0]` on `wasm`) |
| V3.4 | `ps := &s; s, ok = m["k"]` (`m["k"] == S{5}`) → `*ps, ps == &s` | `{5} true` | `{1} false` on **all** targets |
| V3.5 *sibling* | `ps := &s; s, ok = i.(S)` (`i == S{6}`) → `*ps` | `{6}` | `{1}` on **all** targets |
| V3.6 | `func f[T any](p *T, m map[string]T) { *p, ok = m["k"] }`; *siblings* `*p, ok = a.(T)` and `for _, *p = range xs {}` | `true {5}` / `{5}` | js/both `Invalid left-hand side in assignment` |
| V3.7 | `for v, ok := m[k()]; ok; ok = false { fmt.Println(v, ok, n) }`; *sibling* `for i := 0; i < 1; v, ok = m["a"] { i++ }` | `5 true 1` / `5 true` | js/both `number 5 is not iterable` |

### V4 `wasm-value-copy`

Root: on `wasm`, 18 occurrences (16 call sites) decide separately whether a struct or array store copies (`emitCloneStruct`, `_emitCopyFieldValue`); stores into a captured (boxed) variable (`emit-stmts.js:573`), value-struct fields of a composite literal (`_emitFieldInit` `emit-exprs.js:623`), embedded struct fields, `range` `=` targets into an address-taken struct or sliced array (`_bindRangeAssignTargets` `emit-stmts.js:807`), and comma-ok results into an address-taken variable (`_emitStoreLhsFromTemp` `emit-stmts.js:1342`) skip the copy or replace the reference.

| ID | Program | Go | `wasm` |
|---|---|---|---|
| V4.1 | `type V struct{ M, K int }; v := V{9, 5}; w := v; w = v; v.K = 7; fmt.Println(w); func() { _ = w.M }()` | `{9 5}` | `{9 7}` |
| V4.2 | `type W struct{ Q P2 }` (`P2{ A [2]int }`); `*pa = W{Q: p}; pa.Q.A[0] = 9; fmt.Println(p, a)`; *sibling* `a := W{Q: p}; a.Q.A[0] = 9` | `{[1 2]} {{[9 2]}}` | `{[9 2]} …` |
| V4.3 | `v := V{P{-4}, 7}; w := v; f := func() { v.M = 5 }; v = w; f(); fmt.Println(w, v)` | `{{-4} 7} {{5} 7}` | `{{5} 7} {{5} 7}` |
| V4.4 | V3.4/V3.5 and slice/map-range V3.2/V3.3 siblings on `wasm` | `{5} true` / `{6}` / `{2} true` / `[7 8]` | `{1} false` / `{1}` / `{1} false` / `[0 0]` |

### V5 `deref-receiver`, `js-new-struct`

| ID | Root | Program | Go | GoFront |
|---|---|---|---|---|
| V5.1 | `deref-receiver`: `&(*p)` (used directly and by pointer-receiver calls `(*p).M()` via JS `_genUnaryExpr("&")` and WASM `_emitAddressOf`) evaluates `*p` to a value/copy and wraps or clones it instead of returning `p` | `type Num int; func (n *Num) Inc() { *n++ }; var x Num; p := &x; (*p).Inc(); fmt.Println(x)`; *siblings* named slice/string `(*p).M()`, `q := &(*p); *q = 99; fmt.Println(x, q == p)`, and struct `&(*p)` on `wasm` | `1` / `99 true` | `0` / `1 false` on all targets (`&(*p)` struct fails on `wasm`) |
| control | | same with `type S struct{ N int }` / `type A [2]int` | `1` | correct |
| V5.2 | `js-new-struct`: the JS `new` builtin (`src/backend/js/expressions.js:468`) returns a struct object only for a named struct; an alias of an anonymous struct gets the scalar box `{ value }` | `type T = struct{ A [2]int }; p := new(T); fmt.Println(p.A[0])` | `0` | js/both `TypeError … reading '0'` |
| V5.3 | same | `type T = struct{ N int }; new(T).N` | `0` | js/both `-9223372036854775808` |

---

## Approach

### 1. Architecture & Design Decisions
- **Fuzzer first (V1).** Fix the generator (declare `ks` before `f0`–`f2` and use `r.int(0, 1)` in `mutation`'s `&ss[...]` target so `ks` never calls itself; `stmtConflicts` follows calls into closure bodies transitively) and add a `--mode stores` that generates the V3/V4 shapes: comma-ok map/assert into plain, address-taken, `*p` and generic targets; range-over-func `=` forms; `for` init/post; closures capturing struct/array variables; embedded struct fields. Only spec-determined programs (assignment-semantics policy).
- **Target operands once (V2).** `lhsOperandBinds` records assigned selector fields (`SelectorExpr`), index targets (`IndexExpr`), and pointer-dereference targets (`UnaryExpr` `*`) alongside `Ident` targets so `mentions(n)` also binds any target operand that reads an assigned field, element, or dereference (including when `callOnly` is true in `for` post statements); call-free plain-`Ident` operands such as `xs[i], xs[j] = xs[j], xs[i]` and the `callOnly` gc-order tests stay unbound, so the gc-order tests and bundle size are unchanged. `_genComplexCompoundAssign` is removed: complex `op=` goes through the general compound path (bound target operands, then `target = op(target, rhs)` with `_genComplexArith` as the operator), which already handles `for` post and address-taken targets.
- **One JS store (V3).** `_storeInto(target, valueJs, type, ctx)` in `src/backend/js/statements.js` decides: blank → evaluate only; address-taken or sliced variable of struct/array type → `_emitCopyInto`; `*p` of struct type → `Object.assign`; generic `*T` → runtime `__storePtr(p, v)` (struct copy or `.value` write); otherwise `x = v`. `ctx` says whether temporaries may be emitted as statements (`for` init/post may not: the emitter uses a comma expression / IIFE or hoists to the enclosing block). The comma-ok emitters, `_emitRangeVar` (covering `genIteratorFor` and slice/map/string/int `range`, with `_rangeAssignTemps` also routing stable struct and sliced-array targets through `stores`), tuple, stable-tuple and compound stores call it; the inline `Object.assign` and `__p.value` writes are removed.
- **One WASM store (V4).** `emitStoreValue(target, goType)` in `src/backend/wasm/emit-stmts.js` deep-copies struct and array values (recursively through value-struct, array and embedded fields, using the shared field list from `wasm-struct-types` Phase 1) unless the source is a fresh composite literal or call result, and writes through the box for captured variables. Assignment, tuple, comma-ok (`_emitStoreLhsFromTemp`), range (`emitRangeForStmt` / `_bindRangeAssignTargets`) and literal-field (`_emitFieldInit`) stores call it.
- **Pointer identity (V5).** For `&(*p)` (which both backends also synthesize for `(*p).M()` with a pointer receiver: JS `_genUnaryExpr("&")` and WASM `_emitAddressOf`), unwrap `ParenExpr` + `*` and evaluate `p` once with a nil check instead of copying `*p` and re-boxing/cloning it. The JS `new` builtin returns `zeroValueForType(T)` for any type whose underlying type is a struct.

### 2. Invariants & Safety Bounds
- Programs whose output the spec fixes and that GoFront already runs correctly print the same output; outputs the spec leaves open are unchanged (gc-order sections pass unmodified).
- Emitted JS for statements that do not need the new paths is byte-identical (all-`Ident` multi-assignment, plain stores to non-address-taken locals): `bundle-size.baseline.json` unchanged.
- `zero-alloc.js` passes: fresh composite literals and call results are not copied again.

### 3. Edge Cases & Error Handling
- `for` post statements cannot hold temporaries: V2.4 and V3.7 forms are tested in both `for` init and post positions.
- A generic `*T` instantiated with a scalar, an array and a struct type (V3.6 for all three).
- Blank targets (`_, ok = m[k]`) evaluate the right side once and store nothing.
- A captured variable that is also address-taken (`&w` plus a closure) on `wasm`.
- `(*p).M()` where `p` is a call result (`(*get()).Inc()`) evaluates `get()` once; `&(*p)` and `(*p).M()` on a `nil` pointer panic with nil pointer dereference (matching Go 1.26).

---

## Implementation Tasks

> Scheduled from the assignment-semantics deferred follow-ups (re-probed 2026-11-17), L14 from the former `followup-fixes-plan.md`, and one `plans/follow-ups.md` entry.

### Phase 1: Differential fuzzer covers stores (root `fuzz-generator`)
- [ ] Task 1.1: Valid batches and transitive conflict detection (V1.1, V1.2)
  - Files: `test/fuzz/difffuzz.js`
  - Test: `test/unit/cli/difffuzz.test.js` (Go-free): the generator's batch for `--case 6873:0` declares `ks` before `f0`; `stmtConflicts` rejects the V1.2 statement
  - Done when: both pass; `--mode order --stmts 12 --case 6873:0` compiles with Go (by hand)
- [ ] Task 1.2: `--mode stores` generates the V3/V4 shapes (V1.3)
  - Files: `test/fuzz/difffuzz.js`, `docs/architecture.md` (*Differential fuzzer*: the new mode)
  - Test: `test/unit/cli/difffuzz.test.js`: a seeded `--mode stores` batch contains each shape (comma-ok into `*p` and generic targets, range-over-func `=`, `for` post, closure-captured struct, embedded field)
  - Done when: passes; a by-hand run reproduces at least V3.1 and V4.1 as findings before Phases 3–4

### Phase 2: Assignment target operands evaluated once (roots `lhs-operand-binds`, `complex-compound-path`)
- [ ] Task 2.1: Non-`Ident` targets bind every target operand (V2.1, V2.2)
  - Files: `src/lower/assign-order.js`
  - Test: `test/unit/compiler/assign-order.test.js` (non-`Ident` target binds) and `test/unit/language/codegen-regressions.test.js` *Assignment order*: V2.1, V2.2 and a `for` post form → `99 2` with `assertAllTargetsOutput`; the three gc-order sections unmodified
  - Done when: passes on every target; `bundle-size.js` passes
- [ ] Task 2.2: Complex compound assignment uses the general compound path (V2.3–V2.5)
  - Files: `src/backend/js/statements.js` (remove `_genComplexCompoundAssign`; complex operator in the compound path)
  - Test: `codegen-regressions.test.js`: V2.3 → `(2+3i) 1`, V2.4 → `(2+2i)`, V2.5 → `(4+6i) (4+6i)`, and C4 from the assignment plan unchanged
  - Done when: all pass on every target

### Phase 3: One JS store primitive (root `js-store-target`)
- [ ] Task 3.1: `_storeInto` and comma-ok stores (V3.4, V3.5, V3.6)
  - Files: `src/backend/js/statements.js`
  - Test: `test/unit/language/value-semantics.test.js` *Whole-value stores*: V3.4 → `{5} true`, V3.5 → `{6}`, V3.6 (`*p, ok = m["k"]` and `*p, ok = a.(T)`) with struct, array and `int` `T` → `true {5}` / Go's output, with `assertJsTargetsOutput` (wasm half in Phase 4)
  - Done when: passes on `js`/`both`; the comma-ok emitters contain no inline `Object.assign`
- [ ] Task 3.2: `for ... = range` forms store through `_storeInto` (V3.1–V3.3, slice/map-range siblings)
  - Files: `src/backend/js/statements.js` (`_emitRangeVar`, `_rangeAssignTemps`, `genIteratorFor`)
  - Test: `test/unit/language/range-func.test.js`: V3.1 → `{5}`, V3.2 → `{2} true`, V3.3 → `[7 8]` with `assertAllTargetsOutput`; `test/unit/language/value-semantics.test.js`: slice/map-range `*p` and generic `*T` siblings with `assertAllTargetsOutput`, and slice/map-range address-taken struct / sliced array siblings with `assertJsTargetsOutput` (wasm half in Phase 4)
  - Done when: all pass on the tested targets
- [ ] Task 3.3: Stores in `for` init and post contexts (V3.7)
  - Files: `src/backend/js/statements.js`
  - Test: `codegen-regressions.test.js`: V3.7 → `5 true 1`; the same comma-ok `=` form in a `for` post; a tuple store with a struct `*p` target in a `for` post
  - Done when: all pass; `grep -n "Object.assign(" src/backend/js/statements.js` lists only `_storeInto`

### Phase 4: One WASM value store (root `wasm-value-copy`; after `wasm-struct-types` Phase 1)
- [ ] Task 4.1: `emitStoreValue` for plain and captured variables (V4.1, V4.3)
  - Files: `src/backend/wasm/emit-stmts.js`, `src/backend/wasm/emit.js` (copy helper over the shared field list)
  - Test: `test/unit/language/value-semantics.test.js` *Struct value semantics*: V4.1 → `{9 5}`, V4.3 → `{{-4} 7} {{5} 7}`, and a captured, address-taken variant, with `assertAllTargetsOutput`
  - Done when: all pass on every target
- [ ] Task 4.2: Literal fields, `range` `=` targets and comma-ok results store through `emitStoreValue` (V4.2, V4.4)
  - Files: `src/backend/wasm/emit-stmts.js` (`_bindRangeAssignTargets`, `_emitStoreLhsFromTemp`), `src/backend/wasm/emit-exprs.js` (`_emitFieldInit` composite-literal value-struct fields)
  - Test: `value-semantics.test.js`: V4.2 (`*pa = W{Q: p}` and `a := W{Q: p}`) → `{[1 2]} {{[9 2]}}`; Task 3.1's V3.4/V3.5 tests and Task 3.2's slice/map-range address-taken struct / sliced array tests switch to `assertAllTargetsOutput`
  - Done when: all pass; `zero-alloc.js` passes

### Phase 5: Pointer identity (roots `deref-receiver`, `js-new-struct`)
Two one-task roots, both about which object a pointer refers to; each fix is under ~40 production LOC.
- [ ] Task 5.1: `&(*p)` and `(*p).M()` with a pointer receiver pass `p` (V5.1)
  - Files: `src/backend/js/expressions.js` (`_genUnaryExpr`), `src/backend/wasm/emit-exprs.js` (`_emitAddressOf`)
  - Test: `test/unit/language/value-semantics.test.js`: V5.1 → `1`; named slice/string `(*p).M()`; `q := &(*p)` identity for scalar and struct → `99 true`; `(*get()).Inc()` calls `get` once; `&(*nilPtr)` / `(*nilPtr).M()` panic; struct and array controls → `1`, with `assertAllTargetsOutput`
  - Done when: all pass on every target
- [ ] Task 5.2: JS `new` of any struct type returns the struct object (V5.2, V5.3)
  - Files: `src/backend/js/expressions.js` (`new` builtin)
  - Test: `test/unit/language/structs.test.js`: V5.2 → `0`, V5.3 → `0`, `*p = T{…}` then `p.N`, with `assertAllTargetsOutput` (`new(struct{ N int })` is covered by [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md) Task 4.2, L3, which runs in a parallel lane; add it here only if that task has already landed)
  - Done when: all pass; `bundle-size.js` passes (named structs emit the same JS)
