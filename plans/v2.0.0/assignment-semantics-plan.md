# Assignment Semantics — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Fixes the spec-mandated assignment and value-semantics defects found by the differential fuzzer (`test/fuzz/difffuzz.js`, added in Phase 1) and the matching `plans/follow-ups.md` entries from [`../v1.9.3/follow-ups-2026-11-16-plan.md`](../v1.9.3/follow-ups-2026-11-16-plan.md) Phases 4–5 (PRs #212, #213). Independent of [`followup-fixes-plan.md`](followup-fixes-plan.md), which owns the `wasm` anonymous-struct layout (F17) that the fuzzer skips by default. Start after the v1.9.3 follow-ups plan merges (it edits the same assignment paths in `src/backend/js/statements.js` and `src/backend/wasm/emit-stmts.js`).  
**Release note:** Assignments now keep Go's value semantics in more places: a struct reassigned inside a closure stays visible through earlier pointers, `p, *p = &b, x` stores through the old pointer, and comma-ok lookups into `*p` no longer crash in JavaScript. Calls in a comma-ok map key or a complex `+=` run once, and struct copies through a pointer on WebAssembly no longer share their arrays.  

---

## Goal

Make every assignment form follow what the Go spec requires, on `js`, `both` and `wasm`: each call runs exactly once and in source order, a multi-assignment evaluates its left-hand operands before it stores anything, an assignment copies struct and array values, and a whole-value store into an address-taken variable keeps the variable's identity. Do this by sharing the one assignment rule that both backends duplicate today (`_hoistLhsOperands`) and by fixing the localized store and copy paths, not by adding more per-path special cases.

**Policy decided 2026-11-16 (user): spec only.** Go leaves the order of a plain variable read relative to a call in the same statement unspecified (`a + f()` where `f` changes `a`). gc mostly reads after the call, and GoFront reads before it on every target (*Verified Gaps*, probe `rule.go`). This plan does not chase gc there: those differences are documented as unspecified, the gc-order-only ledger entries are closed (*Excluded* rows), and the fuzzer only generates programs whose output the spec fixes. Existing tests that pin gc's order for multi-assignments (`test/unit/language/codegen-regressions.test.js` sections *Multiple assignment evaluation order* and *Assignment order: blanks, pointer targets, comma-ok*, and `for-post multi-assignment reads plain-variable operands after the right-hand call`) keep passing unmodified: this plan does not change any output that the spec leaves open.

**Done means:**
- Every repro in *Verified Gaps* (T1, I1, I3–I7, X1, X3, V1–V3, V7, C1, C2, C4) prints Go 1.26's output on `js`, `both` and `wasm`, each as a test in the file its task names.
- `npm test` passes, `test/perf/bundle-size.baseline.json` is unchanged and `zero-alloc.js` / `bce-mathx.js` pass; the three gc-order test sections listed above pass unmodified.
- One implementation of the left-hand operand rule: `grep -n "_hoistLhsOperands(" src/backend` shows both backends delegating to `lhsOperandBinds` in `src/lower/assign-order.js`, with no `ordered && l.kind === "UnaryExpr"` guard left in either backend.
- `node test/fuzz/difffuzz.js --mode order --seed 1 --batches 20 --cases 30 --stmts 6` reports `0 distinct findings` and `--mode arith --seed 1 --batches 20` reports `0 distinct findings` (run by hand: CI has no Go toolchain).
- `docs/go-compatibility.md` has an *Evaluation order* row describing the unspecified read-vs-call order.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Assignment behaviour the Go spec fixes, wrong on some target: calls run once, two-phase multi-assignment, value copies, identity of address-taken variables, no crash on valid targets | T1, I1–I7, X1, X3, V1–V3, V7, C1, C2, C4 | |
| **In scope: core** | One shared left-hand operand rule for both backends | `src/lower/assign-order.js` `lhsOperandBinds`, used by JS `statements.js:1024` and WASM `emit-stmts.js:325` | |
| **In scope: core** | Spec-aware differential fuzzer as a manual tool | `test/fuzz/difffuzz.js`, `npm run fuzz` | |
| **Excluded: deferred** | Matching gc's read-after-call order where the spec leaves it open | Ledger entries *WASM compound assignment* (×2), *Multiple assignment order*, *JS assignment order* (for-post), *Assignment order (container rebound by RHS call)*, *Multiple assignment order (LHS base operands)*, *Multiple assignment order (RHS operands)*, and the "reads the target before it" half of *JS complex compound assignment*; probe `rule.go` P1–P15 | Spec: "the order of those events compared to the evaluation of `y` and `z` is not specified". gc is not consistent either (`len(xs) + f()` reads before the call, P7). Full parity would hoist every call out of every expression, adding temporaries to ordinary code and risking the bundle-size and zero-alloc gates. Documented in Phase 5 |
| **Excluded: deferred** | A lowering pass that rewrites every assignment into temporaries before both backends | `lower/assign-order.js` as an AST rewriter | Under the spec-only policy the remaining defects are localized. A rewrite would change emitted JS for every multi-assignment (bundle-size baseline), must stay idempotent on cached ASTs (`src/compiler.js:71`), and cannot put temporaries in a `for` post statement. Only the duplicated decision is shared |
| **Excluded: deferred** | `wasm` anonymous struct with an embedded field | `v := struct{ P }{P{3}}; w := v; w.P.M = 8; fmt.Println(v.M)` → wasm `0`, want `3`; such literals also emit invalid modules (fuzzer `--anon-embed`) | F17, owned by `followup-fixes-plan.md` Phase 2 |
| **Excluded: deferred** | JS `new(T)` of an anonymous struct alias | ledger *JS anonymous struct alias* | Not an assignment defect; stays in `plans/follow-ups.md` |
| **Excluded: runtime / platform** | Running the fuzzer in `npm test` or CI | — | CI has no Go toolchain, and v1.8.0 retired the real-Go runner by design. Fuzzer findings become unit tests with the Go output written in |
| **Excluded: deferred** | Review follow-ups found while executing this plan (not caused by it; each repro reproduced on 2026-11-16 at plan completion) | **WASM struct assignment:** `v = w` of a struct with an embedded struct field shares the embedded value when `v` is captured by a closure. Repro: `v := V{P{-4}, 7}; w := v; f := func() { v.M = 5 }; v = w; f(); fmt.Println(w, v)` (V embeds P) → wasm got `{{5} 7} {{5} 7}`, want `{{-4} 7} {{5} 7}`. (feat/assignment-semantics-phase-1, assignment-semantics Phase 1, Out of Scope; also fuzz `--mode order --stmts 6 --case 1:2`, feat/assignment-semantics-phase-5, assignment-semantics Phase 5) <br>**Fuzzer transitive mutations:** `stmtConflicts` does not follow `ks(...)` calls inside closure bodies, so a statement can still depend on read-vs-call order. Repro: `node test/fuzz/difffuzz.js --mode order --stmts 12 --case 6873:0` → `xs[(f1(-4))&1] = ((a / 3) * -1)` passes `stmtConflicts`, want it regenerated. (PR #219, assignment-semantics Phase 1, Low) <br>**Fuzzer closure order:** `f0`–`f2` are declared before `ks` but may call it, so the batch is rejected by Go. Repro: `node test/fuzz/difffuzz.js --mode order --stmts 12 --case 6873:0` → got `Undefined: 'ks'`, want a valid Go program. (PR #219, assignment-semantics Phase 1, Out of Scope) <br>**Multi-assignment (non-Ident targets):** `lhsOperandBinds` only tracks `Ident` targets as assigned, so an operand mentioning a field or element target assigned in the same statement is read after the first store. Repro: `type SP struct{ P *int }; sa, sb := 1, 2; sp := SP{P: &sa}; sp.P, *sp.P = &sb, 99; fmt.Println(sa, sb)` → got `1 99`, want `99 2` (also `xs[0], *xs[0] = &xb, 99`). (PR #220, assignment-semantics Phase 2, Out of Scope) <br>**JS range-over-func assign form:** `for *p = range seq`, `for s = range seq` with `&s` taken, and `for arr = range seq` with `arr[:]` aliased do not store in place on `js`/`both`. Repro: `s := S{1}; p := &s; seq := func(yield func(S) bool) { yield(S{5}) }; for *p = range seq {}` → got `Invalid left-hand side in assignment`, want `{5}`; `for s = range seq {}` with `ps := &s` → got `{1} false`, want `{2} true`. (PR #221, assignment-semantics Phase 3, Out of Scope) <br>**Comma-ok into an address-taken struct:** `s, ok = m["k"]` and `s, ok = i.(S)` replace the variable instead of copying in place, so earlier pointers go stale on all targets. Repro: `s := S{1}; ps := &s; m := map[string]S{"k": {5}}; var ok bool; s, ok = m["k"]; fmt.Println(*ps, ps == &s)` → got `{1} false`, want `{5} true`. (PR #221, assignment-semantics Phase 3, Out of Scope) <br>**JS comma-ok into a generic `*T`:** `func f[T any](p *T, m map[string]T) { var ok bool; *p, ok = m["k"] }` crashes on `js`/`both`. Repro: call `f(&S{1}, map[string]S{"k": {5}})` → got `Invalid left-hand side in assignment`, want `{5} true`. (PR #221, assignment-semantics Phase 3, Out of Scope) <br>**JS complex compound assignment:** a call in the left-hand target with a call-free right-hand side runs three times, a `for` post `c += z` yields NaN, and `c += f()` on an address-taken `c` crashes. Repro: `m := map[string]complex128{"a": complex(1, 2)}; m[k()] += z` → got `k()` called 3 times on `js`/`both`, want 1; `for i := 0; i < 2; c += z { i++ }` → got `(NaN+NaNi)`, want `(2+2i)`; `p := &c; c += f()` → got `Cannot read properties of undefined (reading 're')`. (PR #222, assignment-semantics Phase 4, Out of Scope) <br>**JS comma-ok `:=` in a `for` initializer:** `for v, ok := m[k()]; ok; ok = false {}` crashes on `js`/`both`. Repro: `for v, ok := m[k()]; ok; ok = false { fmt.Println(v, ok, n) }` → got `number 5 is not iterable`, want `5 true 1`. (PR #222, assignment-semantics Phase 4, Out of Scope) <br>**WASM struct literal into a struct holding a value-struct field:** the field is shared, not copied. Repro: `type P struct{ A [2]int }; type W struct{ Q P }; p := P{[2]int{1, 2}}; var a W; pa := &a; *pa = W{Q: p}; pa.Q.A[0] = 9; fmt.Println(p, a)` → got `{[9 2]} {{[9 2]}}`, want `{[1 2]} {{[9 2]}}`. (PR #222, assignment-semantics Phase 4, Out of Scope) <br>**WASM captured struct assignment:** `w = v` of a struct variable `w` captured by a closure aliases `v` instead of copying it. Repro: `type V struct{ M, K int }; v := V{9, 5}; w := v; w = v; v.K = 7; fmt.Println(w); func() { _ = w.M }()` → wasm got `{9 7}`, want `{9 5}` (js/both right); fuzz `node test/fuzz/difffuzz.js --mode order --stmts 6 --case 2:18`. (feat/assignment-semantics-phase-5, assignment-semantics Phase 5, Out of Scope) | Out of this plan's scope; deferred at plan completion |

---

## Verified Gaps & Baseline Audit

**Method.** Probes ran on 2026-11-16 against `feat/follow-ups-2026-11-16` at `2b4f619` with go1.26.10. Each probe is a `package main` run with `node test/fuzz/difffuzz.js --replay <file>`, which prints `go run` output beside `compileFiles` with `forceTarget` `js`, `both` and `wasm` run in-process. Probe files (`rule.go`, `spec.go`, `x.go`, `x2.go`, `x4.go` in `.probes/plan/`) were deleted; their snippets are below. The fuzzer campaigns (seeds 1, 100, 7000; about 330 order-mode and 780 arith-mode programs) reduced to the same clusters.

### Spec-mandated defects (scheduled)

| ID | Area | Finding | Evidence & probe |
|---|---|---|---|
| T1 | Two-phase multi-assignment through `*p` (all targets) | Go evaluates the operand of `*p` before any store; both backends only bind a `*`-target operand when the statement has a call (`else if (ordered && l.kind === "UnaryExpr" && l.op === "*")` in `_hoistLhsOperands`, `src/backend/js/statements.js:1052` and its copy `src/backend/wasm/emit-stmts.js:345`) | `a, b := 1, 2; p := &a; p, *p = &b, 0; fmt.Println(a, b)` → js/both/wasm `1 0`, want `0 2`. Ledger: *Multiple assignment aliasing* `p, *p = &b, 99` → `10 99 99`, want `99 20 20` (PR #212). Controls pass: `ps, ps.N = &s2, 5`, `xs, xs[0] = ys, 9`, `i, arr[i] = 1, 5`, `m, m["k"] = m2, 1`, swaps |
| I1 | JS identity of a struct reassigned in a closure | `_isStableTarget` asks `_fnMutates(root, true)` (`src/backend/js/expressions.js:1196`), which scans only `this._fnCtx.body`, the closure's own body. `&s` is taken in the enclosing function, so `s = S{2}` inside the closure replaces the object instead of `_emitCopyInto` | `type S struct{ N int }; s := S{1}; ps := &s; f := func() { s = S{2} }; f(); fmt.Println(*ps, ps == &s)` → js/both `{1} false`, want `{2} true`; wasm right. About 20 of 56 distinct short-program fuzz findings |
| I3–I7 | Same root as I1 | Multi-assignment in a closure (I3 `s, j = S{2}, 1`), `s = *ps` then a field write (I4), pointer returned from another closure (I5), `&s` taken after the closure is created (I6), closure in a range body (I7) | js/both I3 `{1}`, I4 `{1} false`, I5 `false false`, I6 `{1}`, I7 `{1}`; want `{2}`, `{5} true`, `true true`, `{2}`, `{3}`. Arrays are right (I2 `arr = [2]int{3, 4}` in a closure → `[3 4] true`) |
| X1 | JS comma-ok map lookup into a `*p` struct | `_genCommaOkMapIndex` builds the target with `e.name ?? this.genExpr(e)` (`statements.js:275`), which for a struct `*p` is the struct expression, not a store | `type S struct{ f int }; p := &S{1}; m := map[string]S{"k": {5}}; var ok bool; *p, ok = m["k"]` → js/both `ReferenceError: Invalid left-hand side in assignment`, want `{5} true`; wasm right. Ledger *JS comma-ok / stable tuple into `*p` struct* (PR #212) |
| X3 | JS comma-ok type assertion into a `*p` struct | Same pattern in `_genCommaOkTypeAssert` (`statements.js:1086`) | `var i any = S{7}; *p, ok = i.(S)` → js/both `Invalid left-hand side in assignment`, want `{7} true`. Controls pass: `*p, ok = two()` (tuple call), `*ps, x = t, 9` (stable tuple) |
| V1 | WASM `*ps = s2` shares array fields | `_emitStructDerefAssign` (`src/backend/wasm/emit-stmts.js:1105`) copies each field with `struct.get`/`struct.set`; array and value-struct fields stay shared refs. `emitCloneStruct` (`src/backend/wasm/emit.js:1210`) already deep-copies them | `type T struct{ A [2]int }; var s, s2 T; ps := &s; *ps = s2; ps.A[0] = 9; fmt.Println(s2)` → wasm `{[9 0]}`, want `{[0 0]}`; js/both right. Ledger *WASM struct assignment through `*p`* (×2) |
| V2 | Same root, multi-assignment | `*ps, x = s2, 1` | wasm `{[9 0]}`, want `{[0 0]}`; ledger repro `*p, x = s2, 9; s2.A[0] = 99` → `[99 2]`, want `[1 2]` (PR #212) |
| V3 | Same root, nested struct field | `type W struct{ Q P; A [2]int }; *pa = b; pa.Q.M = 3; pa.A[1] = 4; fmt.Println(b)` | wasm `{{3} [0 4]}`, want `{{0} [0 0]}` |
| V7 | JS range-over-func does not copy yielded arrays | `genIteratorFor` copies a yielded value only when `_isStructType` (`statements.js:2076`, `:2101`); arrays need `_aggregateBase` | `arr := [2]int{1, 2}; seq := func(yield func([2]int) bool) { yield(arr) }; for v := range seq { v[0] = 9 }; fmt.Println(arr)` → js/both `[9 2]`, want `[1 2]`; wasm right. Ledger *JS range-over-func* (PR #213) |
| C1 | JS comma-ok `:=` runs the key twice | Non-strict define fast path (`statements.js:290-298`) emits `keyExpr`/`mapExpr` in both the value line and the `in` test | `n := 0; k := func() string { n++; return "x" }; m := map[string]int{"x": 1}; v, ok := m[k()]; fmt.Println(v, ok, n)` → js `1 true 2`, want `1 true 1`; both/wasm right. Ledger *Comma-ok `:=` map index* (phase-4 branch) |
| C2 | Same root, `if` initializer | `if v, ok := m[k()]; ok { … }` | js `n == 2`, want `1` |
| C4 | JS complex `+=` runs the right-hand call twice | `_genAssignStmt` dispatches `_isComplexCompoundAssign` (`statements.js:816`) before `_isCompoundWithCall` (`:820`), so the call is never bound, and `_genComplexArith` uses `rhsExpr` for both parts | `n := 0; f := func() complex128 { n++; return complex(3, 4) }; c := complex(1, 2); c += f(); fmt.Println(c, n)` → js/both `(4+6i) 2`, want `(4+6i) 1`; wasm right. Ledger *JS complex compound assignment* (PR #212) |

### Baseline and controls

| Area | Finding | Evidence & probe |
|---|---|---|
| Duplicated rule | `_hoistLhsOperands` exists twice with the same `ordered`/`callOnly`/`mentions` logic: JS `statements.js:1024-1079` (string emission, `_type`-based constants) and WASM `emit-stmts.js:325-377` (local temps, `_isConstOperand` resolves locals/globals) | Source read. Callers: JS `_genAssignStmt` (`:865`), `_genStableTupleAssign` (`:1143`), `_genCommaOkMapIndex` (`:271`), `_genCommaOkTypeAssert` (`:1083`); WASM `_emitAssign` (`:259`, `:283`, `:306`) |
| Read vs call order (unspecified) | GoFront reads a plain operand before a call in the same expression on every target; gc mostly after, but not always | `rule.go`: `a + f()` gc `11` / GoFront `2`; `g(a, f())` `10`/`1`; `[]int{a, f()}` `[10 0]`/`[1 0]`; `return a, f()` `10 0`/`1 0`; `fmt.Println(a, f())` `10 0`/`1 0`; `b, c = a, f()` `10`/`1`; `*p = f()` (f sets `p = &b`) `1 9`/`9 2`; `xs[i] = f()` (f sets `i = 1`) `[0 9]`/`[9 0]`; `len(xs) + f()` (f rebinds `xs`) gc `1` = read **before** |
| Lowering precedent | `lower/` already rewrites the AST after checking: `splitForwardedTuples` inserts typed `:=` temps (`src/lower/functions.js:416-519`) and clears `_fwdIface` so a cached AST is not split twice | Source read; both backends import from `lower/` (`statements.js:12`, `emit-stmts.js:4-12`) |
| Integer arithmetic | No mismatches | Fuzzer `--mode arith`, 780 programs (int8…uint64 wrapping, conversions, shifts, truncated division) on `both`/`wasm` |
| Real-Go in CI | CI installs no Go (`.github/workflows/ci.yml`) | Source read |

---

## Approach

### 1. Architecture & Design Decisions
- **One left-hand operand rule (`src/lower/assign-order.js`).** A pure function `lhsOperandBinds(lhs, rhs, { single, callOnly, isConst })` returns, in source order, the `{ node, key }` operand slots to evaluate into temporaries before the right-hand side: index `expr`/`index`, selector `expr`, and `*` `operand`, descending into a struct or array value base instead of binding it (today's `_aggregateBase` / `_isValueStruct` branch, passed in as `isAggregate`). It keeps today's `ordered` and `callOnly` decisions exactly (so the gc-order tests keep passing) and fixes T1: a `*` operand is also bound when it mentions a variable the statement assigns, with or without a call. Each backend keeps only the emission: JS writes `const __hN = …;` lines and swaps the slot for an `Ident`; WASM allocates a local. Constant detection differs per backend (JS by `_type`, WASM by resolving locals and globals), so it is the `isConst` callback. The module imports only `lower/walk.js`, so the `check-layers` rules hold.
- **JS identity across closures.** `_withFnCtx` records its parent context. `_fnMutates(name, addrOnly)` also returns true when `name` is not declared in the current function body and some enclosing context's body takes its address (`fnMutates(parent.body, name, true, parent.mut)`). `_isStableTarget` then routes `s = S{2}` in a closure through `_emitCopyInto`, as it already does outside closures. Arrays already work and are unaffected.
- **One JS store for comma-ok targets.** `_genCommaOkMapIndex` and `_genCommaOkTypeAssert` store each target through a small `_storeTarget(l, js)` that writes a struct `*p` with `Object.assign(<operand>, js)` (as `_genStructDerefAssign` does) and everything else as today. X1 and X3 are the only crashing forms; tuple calls and stable tuples already use `derefs`.
- **JS calls run once.** C1/C2: the non-strict `:=` fast path keeps its shape when the map and key have no call, and binds them to `const __mN, __kN` (the strict path's form) when either contains a call or receive. C4: `_isCompoundWithCall` is checked before `_isComplexCompoundAssign`, so the right-hand call is bound once and the complex path sees a temp; a map target's base and key with a call are bound by the same pre-step.
- **WASM deep field copy.** The per-field copy inside `emitCloneStruct` (array → `emitCopyArray`, value struct → nested `emitCloneStruct`) moves into `_emitCopyFieldValue(field)`, which `_emitStructDerefAssign` also calls between `struct.get` and `struct.set`, unless the right-hand side is fresh (`CompositeLit`, non-conversion `CallExpr`), matching `_emitCopyIfValue`.
- **JS range-over-func copies arrays.** `genIteratorFor` uses `_aggregateBase(yType) || _aggregateBase(varType)` instead of `_isStructType` in both preambles.
- **Spec-aware fuzzer.** `test/fuzz/difffuzz.js` (from the 2026-11-16 session) gains alias groups: `{a, b, p}`, `{i, j}`, `{xs, ys}`, `{arr}`, `{m}`, `{s, s2, ps, ss}`, `{v, w}`. Each generated closure knows the groups its mutations touch (`*p = n` touches `{a, b, p}`). A statement is regenerated when a group that one of its calls (including `ks`) mutates is also named anywhere else in the statement, so no generated output depends on read-vs-call order. `package.json` gets `"fuzz": "node test/fuzz/difffuzz.js"`.

### 2. Invariants & Safety Bounds
- No output the spec leaves open changes: the three gc-order sections of `codegen-regressions.test.js` pass unmodified.
- Emitted JS and WASM are byte-identical for statements without a `*p` target mentioned by the same statement, a closure-captured address-taken aggregate, a comma-ok into `*p`, a call in a non-strict comma-ok key, a complex compound with a call, a struct `*p` store with array or struct fields, or a range-over-func array. `bundle-size.baseline.json` is unchanged; `zero-alloc.js` and `bce-mathx.js` pass.
- `lhsOperandBinds` never mutates the AST: the backends own the slot swap and its undo, as today, so cached ASTs (`src/compiler.js:71`) stay clean.

### 3. Edge Cases & Error Handling
- **T1 in a `for` post statement:** the JS `_inForPost` path passes `callOnly`; the new `*` rule applies there too, and the binding is emitted before the loop's post expression the same way index operands are today.
- **T1 with `_` and boxed variables:** `p, *p` where `p` is boxed (address-taken) mentions `p` by name; `mentions` matches the `Ident` regardless of boxing.
- **I1 shadowing:** a closure that declares its own `s` must not pick up the outer `&s`. The parent lookup only runs when `name` is not declared in the current body (`declaresVar` over params, `:=`, `var`, range keys).
- **I6:** `&s` taken after the closure literal is still in the enclosing body, so the whole-body scan covers it.
- **C1 strict mode:** `both`/`wasm` already bind map and key once; only the `js` non-strict path changes.
- **V1 nil pointer:** `_emitNilGuard` still runs before the first field copy, so `*nilPtr = s2` panics as today.

---

## Implementation Tasks

> Scheduled from the 2026-11-16 differential fuzzer and the spec-mandated `plans/follow-ups.md` entries. The gc-order-only entries were closed into the *Excluded* row above.

### Phase 1: Spec-aware differential fuzzer
- [x] Task 1.1: Fuzzer only generates programs whose output the spec fixes
  - Files: `test/fuzz/difffuzz.js` (alias groups, per-closure mutated groups, regenerate a statement whose calls mutate a group it names), `package.json` (`fuzz` script)
  - Test: `test/unit/cli/difffuzz.test.js` (no Go needed): import the generator through a new `--self-test` entry that generates 2,000 order-mode cases from seed 1 and asserts that no statement both calls a closure mutating group G and names a member of G elsewhere; and that `--replay` on a missing file exits non-zero with `ENOENT`
  - Done when: the self-test passes, and `npm run fuzz -- --mode order --seed 1 --batches 3 --cases 30 --stmts 6` no longer reports any finding whose minimal repro is in the gc-order *Excluded* row
- [x] Task 1.2: Deterministic replay of findings
  - Files: `test/fuzz/difffuzz.js` (`--case <seed>:<n>` regenerates and replays one case; finding headers print it)
  - Test: `test/unit/cli/difffuzz.test.js`: `--self-test` also asserts that generating seed 7000 twice yields identical program text
  - Done when: a finding's header names a `--case` that reproduces it

### Phase 2: Shared left-hand operand rule (T1)
- [x] Task 2.1: `lhsOperandBinds` in `src/lower/assign-order.js`
  - Files: `src/lower/assign-order.js` (new), `src/lower/index.js` (export)
  - Test: `test/unit/compiler/assign-order.test.js`: on parsed and checked snippets, `i, xs[i] = 1, 5` binds `xs[i].index`; `p, *p = &b, 0` binds `(*p).operand`; `arr[i], x = f(), 5` binds `arr[i].expr`/`.index` (ordered); with `callOnly` the same statement binds nothing; `ps[n].A[k], x = …` descends into `ps[n]` instead of binding the struct value
  - Done when: the unit tests pass; nothing calls the function yet
- [x] Task 2.2: JS `_hoistLhsOperands` delegates to `lhsOperandBinds`
  - Files: `src/backend/js/statements.js`
  - Test: `test/unit/language/codegen-regressions.test.js` section *Assignment order: blanks, pointer targets, comma-ok*: T1 `p, *p = &b, 0` and the ledger `p, *p = &b, 99` (`99 20 20`) with `assertAllTargetsOutput` (fails on js/both first)
  - Done when: T1 passes on js/both and the existing gc-order sections pass unmodified
- [x] Task 2.3: WASM `_hoistLhsOperands` delegates to `lhsOperandBinds`
  - Files: `src/backend/wasm/emit-stmts.js`
  - Test: the Task 2.2 tests now pass on wasm; add T1 inside a `for` post (`for k := 0; k < 1; p, *p, k = &b, 7, k+1 {}`) on all targets
  - Done when: `grep -n "ordered && l.kind" src/backend` finds nothing and all assignment-order sections pass

### Phase 3: JS stores keep identity and copies (I1–I7, X1, X3, V7)
- [x] Task 3.1: `_fnMutates` sees an enclosing function's `&x` for captured variables
  - Files: `src/backend/js/expressions.js` (`_withFnCtx` parent link, `_fnMutates`), `src/lower/ownership.js` (a `declaresVar` helper if `fnMutates` needs it)
  - Test: `test/unit/language/value-semantics.test.js` new section *Whole-value stores in closures*: I1, I3, I4, I5, I6, I7 with `assertAllTargetsOutput`; I2 (arrays) as a control; a shadowing control (closure declares its own `s := S{9}`; outer `*ps` stays `{1}`)
  - Done when: all pass on every target
- [x] Task 3.2: Comma-ok results stored into a struct `*p`
  - Files: `src/backend/js/statements.js` (`_storeTarget`, used by `_genCommaOkMapIndex` and `_genCommaOkTypeAssert`)
  - Test: `codegen-regressions.test.js` *Assignment order: blanks, pointer targets, comma-ok*: X1 (`{5} true`), X3 (`{7} true`), plus a missing key (`*p, ok = m["z"]` → `{0} false`) with `assertAllTargetsOutput`
  - Done when: no `Invalid left-hand side` on js/both and all three print Go's output
- [x] Task 3.3: Range-over-func copies yielded arrays
  - Files: `src/backend/js/statements.js` (`genIteratorFor` preambles)
  - Test: `test/unit/language/range-func.test.js`: V7 (`[1 2]`), the assign form (`var v [2]int; for v = range seq { v[0] = 9 }`), and a `[2][2]int` yield, with `assertAllTargetsOutput`
  - Done when: all three print Go's output on every target

### Phase 4: Calls run once (C1, C2, C4) and WASM deep copies through pointers (V1–V3)
- [x] Task 4.1: Non-strict comma-ok `:=` binds a map or key with a call once
  - Files: `src/backend/js/statements.js` (`_genCommaOkMapIndex` non-strict define path)
  - Test: `codegen-regressions.test.js`: C1 and C2 with `assertJsTargetsOutput` and the call count printed (`1 true 1`, `1 1`); a call-free key keeps the fast path (assert the emitted JS has no `__m` temp)
  - Done when: both print Go's output on `js` and `both`, and `bundle-size.js` passes
- [x] Task 4.2: Complex compound assignment binds its right-hand call first
  - Files: `src/backend/js/statements.js` (`_genAssignStmt` dispatch order, `_genComplexCompoundAssign` map base/key)
  - Test: `codegen-regressions.test.js`: C4 (`(4+6i) 1`), `m[k()] += f()` on a `map[string]complex128` (each call once), `c *= f()` with `assertAllTargetsOutput`
  - Done when: each call runs once on every target
- [x] Task 4.3: WASM struct stores through a pointer deep-copy array and struct fields
  - Files: `src/backend/wasm/emit.js` (`_emitCopyFieldValue`, used by `emitCloneStruct`), `src/backend/wasm/emit-stmts.js` (`_emitStructDerefAssign`)
  - Test: `test/unit/language/value-semantics.test.js` *Struct value semantics*: V1, V2 (and the ledger `*p, x = s2, 9` → `[1 2]`), V3, and a composite-literal right-hand side (no extra copy: same output) with `assertAllTargetsOutput`
  - Done when: all pass on wasm, and `zero-alloc.js` passes

### Phase 5: Documentation and fuzzer sign-off
- [x] Task 5.1: Document evaluation order and the fuzzer
  - Files: `docs/go-compatibility.md` (new *Evaluation order* row: calls run once in source order and multi-assignments evaluate their targets first, as Go requires; a variable read in the same statement as a call that changes it may see either value, which Go leaves unspecified, so GoFront and gc can differ, e.g. `a + f()`), `docs/architecture.md` (a short *Differential fuzzer* paragraph: what it generates, `npm run fuzz`, `--replay`, that findings become unit tests)
  - Test: `node test/fuzz/difffuzz.js --mode order --seed 1 --batches 20 --cases 30 --stmts 6` and `--mode arith --seed 1 --batches 20`, run by hand and recorded in the PR body
  - Done when: both runs report `0 distinct findings`, except findings outside this plan's scope (each logged in `plans/follow-ups.md` with its `--case`), and the docs rows exist
