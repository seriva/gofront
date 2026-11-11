# v1.9.1 Review Follow-ups (2026-11-11, round 2) — Design Plan

**Version:** v1.9.1  
**Status:** In Progress  
**Base branch:** main  
**Related:** [`follow-ups-2026-11-11-plan.md`](follow-ups-2026-11-11-plan.md) (origin of every ledger entry, PRs #180–#183, merged into main as #184), [`follow-ups-2026-11-10-plan.md`](follow-ups-2026-11-10-plan.md)  
**Release note:** Structs that embed an interface (`struct{ error }`) now get its methods, explicit func type arguments (`f[func(int)]()`) parse, and WebAssembly builds no longer produce invalid modules for range assignments into an `any` or for a range-over-func loop nested in a `range` loop. Named array and slice types keep their identity in an `any` on WebAssembly, `complex64` arithmetic and typed constants keep float32 precision in JavaScript, and a field or method promoted from two embedded types at the same depth is now reported as an ambiguous selector, as in Go.  

---

## Goal

Schedule and fix every reproducing entry of `plans/follow-ups.md` (11 entries, all logged during [`follow-ups-2026-11-11-plan.md`](follow-ups-2026-11-11-plan.md) Phase 1–4 reviews, PRs #180–#183) for the v1.9.1 patch release. Entries are numbered `J01`–`J11` in ledger order. Re-probed on `main` @ `5f12880` (the 11-11 plan merged) with a scratch harness (`compileFiles` with `forceTarget` `js`, `both`, `wasm` after `evictParseCache`, `WebAssembly.Module` validation, then run through a sink-bundled ESM module like `runProgramModule` in `test/unit/helpers.js:506`).

- **11 entries reproduce**, all scheduled in Phases 1–4. The re-probe widened several:
  - `J01`: every range-assignment form into an `any` builds an invalid module, not only the slice index (slice value, string index/rune, map key/value, `range 3`).
  - `J02`: embedding *any* interface in a struct is unsupported (`struct{ error }` too), not only user-declared ones; no backend handles it either.
  - `J03`: two promoted *fields* at the same depth are also not ambiguous (`c.X` prints `0`).
  - `J04`: with a non-empty `Inner`, the call traps with a raw `RuntimeError: dereferencing a null pointer` instead of the Go panic.
  - `J05`: named slices (`type S []int`) share the problem with named arrays; named maps and funcs are already correct.
  - `J07`: also `[]V` with `V` a func type (`[]func()`); `map[string]V` with `V=int` is correct.
  - `J09`: not label-related. Any range-over-func loop body that uses the index of an enclosing `range n` / `range slice` loop builds an invalid module; a 3-clause outer loop and an ordinary closure capturing the index are correct.
- **0 entries no longer reproduce; 0 deferred.**
- No entry is scheduled in another open plan (no plan is `In Progress`).

Grouped by subsystem:

1. Parser and typechecker selectors (Phase 1).
2. Embedded interfaces and embedded nil pointers in both backends (Phase 2).
3. WASM dynamic types in `any`: identity of named arrays/slices, generic composites of funcs, assertion panic names (Phase 3).
4. Statement and call codegen: WASM range assignment into `any`, WASM range-over-func capture of outer range indexes, JS forwarded calls into nil-checked interface methods, JS `complex64` precision, plus docs (Phase 4).

Re-probe each phase's repros on its base commit before starting the phase, and drop any sub-repro that no longer reproduces. Go is not installed in the probe environment, so expected outputs come from Go semantics (go1.26 spec: "Selectors" depth rule, "Struct types" embedded fields, "Type identity"). Diagnostics are asserted by a stable substring.

**Done means:**

- Every repro in Phases 1–4 is a passing test in its task's `Test:` file: programs via `assertProgramOutput` (`both` + `wasm`), or `assertAllTargetsOutput` where plain `js` packages must also match; invalid programs via `assertErrorContains` on every target.
- No scheduled repro emits invalid WASM (`assertValidWasm`) or traps with a raw WebAssembly `RuntimeError` (`J01`, `J04`, `J09`).
- `npm test`, `npm run check` (including example type-checks) and `npm run test:e2e` pass with zero regressions.
- `docs/go-compatibility.md` does not contradict the new behaviour: the "Complex constants" row still describes exactly what differs from Go after `J11` (Task 4.4), and no row claims struct-embedded interfaces or named array/slice identity in an `any` behave otherwise.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Every reproducing ledger defect across the parser, typechecker, JS and WASM backends | `J01`–`J11` | |
| **In scope: target-specific** | Fix the failing target(s) and pin the working target(s) in the same test | WASM-only: `J01`, `J04`, `J05`, `J07`, `J08`, `J09`. JS-only: `J10` (`both` JS side), `J11`. All targets: `J02`, `J03`, `J06` | |
| **Excluded: runtime / platform** | Documented JS map-key stringification stays | `m[[2]int{1,2}]` and `m["1,2"]` share a key in a `js`/`both` `map[any]` | Documented in `docs/go-compatibility.md:89` ("JS objects only have string keys"). |
| **Excluded: runtime / platform** | Documented JS `any` semantics stay as documented | Sized numbers in an `any`, untyped complex constants as plain numbers in `js` (`docs/go-compatibility.md` "Complex constants", "Sized numbers in an `any`") | No runtime type descriptors (roadmap guiding principle). `J11` only fixes `complex64` values that already are complex in JS output. |
| **Excluded: deferred** | Rejecting other unparenthesized composite literals in statement headers | `if o == Other{1} {` | Carried over from the 11-11 plan; rejecting forms that compile today needs its own decision. |

---

## Verified Gaps & Baseline Audit

### Review follow-ups (2026-11-11, round 2)

All 11 ledger entries re-probed on `main` @ `5f12880`. Columns js / both / wasm, observed → wanted. `SEQ` = `func seq(y func(int) bool) { for _, v := range []int{1, 2, 3} { if !y(v) { return } } }`.

| Area | Finding | Evidence & probe |
|---|---|---|
| WASM range assignment | `J01` Assigning a range index or value to a declared `any` builds an invalid module | `var a any; for a = range []int{5, 6} {}; fmt.Println(a)` → js/both `1`, wasm invalid (`local.set[0] expected type anyref, found local.get of type i32`); want `1`. Widened: `for _, a = range []int{5,6}` (found `array.get of type i64`), `for a, b = range "hi"` (want `1 105`), `for a, b = range map[string]int{"k": 3}` (found `externref`), `for a = range 3` → all wasm invalid. Cause: `_emitRangeAssignStore` (`src/backend/wasm/emit-stmts.js:726`) stores the raw element value; it never boxes into the interface representation when the target's Go type is an interface. (feat/follow-ups-2026-11-11-phase-1) |
| Struct-embedded interfaces | `J02` A struct embedding an interface gets none of its methods | `type Mer interface{ M() }; type T struct{}; func (T) M(); type S struct{ Mer }; var m Mer = S{T{}}; m.M(); S{T{}}.M()` → all `S does not implement Mer` + `No field 'M' on S`; want `T.M\nT.M`. Widened: `type W struct{ error }; var e error = W{errors.New("x")}; e.Error()` → same errors; want `x`. (`type OW struct{ error }` with its own `Error` already works, `test/unit/builtins/fmt-stringer.test.js:356`.) Causes: typechecker `_offerEmbedMethods` (`src/typechecker/index.js`, final branch: `inner.kind === "named" && base?.kind !== "interface"`) offers nothing for an interface embed; JS `computeEmbeddedStubs` (`src/lower/embedding.js:45`) skips interface embeds; WASM `_findPromotedMethod` (`src/backend/wasm/module-emitter.js:1491`) only searches struct embeds. (feat/follow-ups-2026-11-11-phase-2) |
| Typechecker promoted fields | `J03` A field promoted at the same depth as another field or method is not ambiguous | `type A struct{ M int }; type B struct{}; func (B) M() {}; type C struct{ A; B }; fmt.Println(C{}.M)` → all `0`; want `ambiguous selector c.M`. Widened: `type A struct{ X int }; type B struct{ X int }; type C struct{ A; B }; c.X` → all `0`; want `ambiguous selector c.X`. Shallower field over deeper method (`C{ A; B }`, `B{ In }`, `In.M()`) → `0` (correct). Cause: `_offerEmbedMethods` copies embedded fields flat into `struct.fields` (first wins, no depth), and `_fieldTypeStruct` (`src/typechecker/resolve.js:1103`) returns a field before checking `isAmbiguousPromotion`. (feat/follow-ups-2026-11-11-phase-2) |
| WASM nil embedded pointer | `J04` A promoted value method reached through a nil embedded pointer runs (or traps) instead of panicking | `type VMer interface{ VM() }; type Inner struct{}; func (i Inner) VM(); type PO struct{ *Inner }; var v any = PO{}; v.(VMer).VM()` with `recover` → js/both nil-deref message, wasm `inner`; want `runtime error: invalid memory address or nil pointer dereference`. Widened: `Inner struct{ n int }` → wasm `RuntimeError: dereferencing a null pointer` (uncatchable by `recover`). Direct `PO{}.VM()` → correct on all. Cause: interface dispatch (`src/backend/wasm/emit.js:1466`–`1494`) walks `cand.embedPath` with `struct.get` and calls the value method without a null check on a pointer step (`_emitNilPtrCandidate`, `:1514`, only guards the outer receiver). (#181) |
| WASM named composite identity | `J05` Named array and slice types without methods are indistinguishable from their unnamed types in an `any` | `type A [2]int; var k any = A{1, 2}; _, ok := k.([2]int); var j any = [2]int{1, 2}; fmt.Println(ok, k == j)` → js/both `false false`, wasm `true true`; want `false false`. Widened: type switch `case [2]int` before `case A` → wasm `unnamed`, want `A`; `type S []int; k.([]int)` → wasm `true`, want `false`. Named map / func types → `false` (correct). Cause: interface boxing (`src/backend/wasm/emit-exprs.js:117`–`129`) stores named slices/arrays as the bare ref (`_emitTagSlice` only for `isTaggedSliceType`; arrays never tagged) and `mod.arrayTypes` is keyed by wasm type (`module-emitter.js:37`). (feat/follow-ups-2026-11-11-phase-3) |
| Parser type arguments | `J06` An explicit func type argument does not parse | `func mk[V any]() any { return map[string]V{} }; w := mk[func(int)]()` → all `Parse error … Expected type, got ']'`; want `%T` → `map[string]func(int)`. Cause: `parseReturnType(inTypeExpr = true)` (`src/parser/declarations.js:221`) ends a func type at `,` `)` `:` string `=` but not `]`, so `tryParseTypeLiteralArgs` (`src/parser/expressions.js:262`) fails and the index fallback parses `func(int)` as an expression. (feat/follow-ups-2026-11-11-phase-3) |
| WASM generic composites of funcs | `J07` A map or slice of funcs built in generic code does not match its type in an `any` | `func mk[V any](v V) any { return map[string]V{} }; w := mk(func() {}); _, ok := w.(map[string]func()); fmt.Printf("%T %v\n", w, ok)` → js/both `map[string]func() true`, wasm ` false`; want `map[string]func() true`. Widened: `return []V{v}` + `w.([]func())` → wasm ` false`, want `[]func() true`. `V=int` → correct. Cause (pin at task start): the monomorphised instance registers the map/slice type with an element Go/wasm type for `V` that differs from the one the assertion target `map[string]func()` resolves to, so `ref.test` and `_dynamicTypeNames` miss. (feat/follow-ups-2026-11-11-phase-3) |
| WASM assertion panic names | `J08` A failed assertion names arrays and slices of funcs wrongly | `var w any = [2]int{}; _ = w.(int)` with `recover` → js/both `… is [2]int, not int`, wasm `… is interface {}, not int`; `[]func(){}` → wasm `… is []interface {}, not int`, want `… is []func(), not int`. Maps and funcs → correct. Cause: `_dynamicTypeNames` (`src/backend/wasm/emit-builtins.js:1576`) has no entry for `mod.arrayTypes`, and `mod.sliceTypes` is keyed by wasm element type so `[]func()` shares the `[]any` slice type and its first-registered name. (feat/follow-ups-2026-11-11-phase-3) |
| WASM range-over-func capture | `J09` A range-over-func body that uses the index of an enclosing `range n` / `range slice` loop builds an invalid module | `L5: for i := range 2 { for x := range seq { if x == 2 { continue L5 }; fmt.Println(i, x) } }` → js/both `0 1\n1 1`, wasm invalid (`struct.new[1] expected type i64, found local.get of type i32`). Widened: no label (`break` only), `range []int{0, 1}` outer → same invalid module. 3-clause outer loop, labeled outer loop whose index the body does not use, and an ordinary closure capturing a `range 2` index → correct. Cause: the range loop keeps its `int` index in an i32 local, and the yield-closure environment (`struct.new`, `src/backend/wasm/emit.js` iterator lowering) stores it into an i64 field without `i64.extend_i32_s`. (feat/follow-ups-2026-11-11-phase-4) |
| JS forwarded call into interface method | `J10` In a `both` package, a multi-value call forwarded into a nil-checked interface method call is not spread | `type C interface{ check(v any, n int) bool }; var c C = &O{}; fmt.Println(wrap(c.check(makePair())))` (`makePair() (T, int)`, `check` asserts `v.(T)`) → js `true`, both `false`, wasm `true`; want `true`. Emitted (both): `wrap(__nilcall(c).check(makePair()))`; js: `c.check(...makePair())`. Cause: the strict interface-call path (`src/backend/js/expressions.js:2280`–`2286`) maps `expr.args` itself instead of `_genCallArgs(expr)` (`:1511`, which spreads `_multiForward`). (feat/follow-ups-2026-11-11-phase-4) |
| JS `complex64` precision | `J11` Typed `complex64` constants and `complex64` arithmetic keep float64 components | `const kt complex64 = 1 + 0.01i; var c complex64 = 2; x := c * (1 + 0.01i); fmt.Println(imag(kt) == 0.01, imag(x) == 0.02)` → js/both `false false`, wasm `true true`; want `true true`. Causes: `_tagComplex64Const` (`src/typechecker/assignability.js:287`) only tags *untyped* sources, so a use of the typed constant `kt` emits the complex128 folded value; `_genComplexBinary` (`src/backend/js/expressions.js:3237`) never rounds a `complex64` result's components with `Math.fround` (`float32` arithmetic does, `:3846`). (feat/follow-ups-2026-11-11-phase-4) |

---

## Approach

### 1. Architecture & Design Decisions

- **`J06` (Task 1.1):** add `T.RBRACKET` to the `inTypeExpr` terminators in `parseReturnType`. `a[func(int) int{…}]` style index expressions are unaffected because `tryParseTypeLiteralArgs` already restores position on failure.
- **`J03` (Tasks 1.2–1.3):** promoted fields get the same depth model as promoted methods (11-11 Task 2.1/2.2): `_offerEmbedMethods` records each promoted field's depth alongside the method candidates in one name → candidate map, so a field and a method (or two fields) at the same minimal depth make the name ambiguous, and a shallower one wins. `_fieldTypeStruct` checks ambiguity before returning a promoted field; a field declared on the struct itself always wins. Composite literal keys (`C{A: A{}}`) and the embedded field names themselves (`c.A`, depth 0) are unaffected. Field lookups in both backends already go through the typechecker's resolved path, so no backend change is expected; the tests pin all targets.
- **`J02` (Phase 2):** an embedded interface `I` contributes every method of `I`'s method set at depth 1, with `viaPtr: false` (value method set), through the same candidate map (ambiguity and shadowing rules unchanged).
  - Typechecker (Task 2.1): `_offerEmbedMethods` handles `base.kind === "interface"` (named or literal, including `error`), offering its `methods`.
  - JS (Task 2.2): `computeEmbeddedStubs` emits a forwarding stub for each interface method (`m(...a) { return this.<Field>.m(...a); }`), so `typeof v.M === "function"` holds and a nil embedded interface throws the nil-dereference panic through `__nilcall` in strict packages.
  - WASM (Task 2.3): `_findPromotedMethod` treats an interface-typed embed field as a candidate whose call loads the field and dispatches through the existing interface call path (the field holds an `anyref`), and direct calls `S{T{}}.M()` lower to the same field load + interface call.
- **`J04` (Task 2.4):** when `cand.embedPath` contains a pointer step and the target method has a value receiver, emit `ref.is_null` on that step's result and call the nil-dereference panic helper before `emitCloneStruct`. Same message as `_emitNilPtrCandidate`.
- **`J05` (Task 3.1):** a named (defined) slice or array type stored in an `any` keeps its identity: named slices always use `getTaggedSliceType` (tag per `goTypeKey`), named arrays get an interface box (`getIfaceBoxType`, as named maps/funcs with methods already do). Type assertions, type switches, `any_eq`/`any_hash` (11-11 Task 3.1/3.2 array arms) and `_dynamicTypeNames` use the same box, so `k.([2]int)` misses and `k.(A)` hits. Unnamed arrays/slices keep their current representation (no change to hot paths that never reach an `any`).
- **`J07` (Task 3.2):** probe first: compare the map/slice type the monomorphised `mk[func()]` registers with the assertion target's (`goTypeKey` and wasm type). Fix at the source of the divergence (substitution of `V` before `getMapType`/`getSliceType` in `src/backend/wasm/monomorph.js`, or closure wasm type normalisation); record the root cause in the commit body.
- **`J08` (Task 3.3):** `_dynamicTypeNames` adds `mod.arrayTypes` entries keyed by their Go type (record `goType` on `arrInfo`), and slices whose element is a func/interface-like type get a tagged slice when stored in an `any` (so `[]func()` and `[]any` are distinguishable by `ref.test`). Only names are affected for arrays; for `[]func()` the tag also fixes `w.([]any)` falsely succeeding (assert in the test).
- **`J01` (Task 4.1):** `_emitRangeAssignStore` takes the target's Go type; when it is an interface, `emitValue` is followed by the existing interface boxing of the element Go type (`_emitBoxValue` / `emitToAny`, as assignment statements do). Applies to all range kinds (int, slice, array, string, map, chan-free).
- **`J09` (Task 4.2):** wherever the yield-closure environment captures a variable, the stored value is converted from the local's wasm type to the env field's wasm type (`i64.extend_i32_s` for an i32 index local of a Go `int`). Prefer fixing at the capture site over widening range index locals to i64 (would touch hot loop codegen; `test/perf/zero-alloc.js`).
- **`J10` (Task 4.3):** the strict interface-call path uses `this._genCallArgs(expr)`.
- **`J11` (Task 4.4):** (a) the typechecker tags uses of a typed `complex64` constant (`Ident`/`SelectorExpr` whose `_const` is complex and whose type is `complex64`) with `_c64Const`, and `complexConstParts` already folds them (11-11 Task 4.4); (b) untyped complex operands of a `complex64` binary expression are tagged `_c64Const`; (c) `_genComplexBinary` wraps `+ - * /` result components in `Math.fround` when `expr._type` is `complex64` (via a `__c64` helper for `__cmul`/`__cdiv` results).

### 2. Invariants & Safety Bounds

- No new runtime type descriptors; tags and names are compile-time.
- Unambiguous embedding programs keep their dispatch: existing tests in `test/unit/language/named-type-methods.test.js`, `test/unit/wasm/mixins.test.js`, `test/unit/wasm/interfaces.test.js`, `test/unit/wasm/iface-assert.test.js`, `test/unit/builtins/fmt-stringer.test.js` keep passing unchanged.
- `any_hash` and `any_eq` stay consistent after `J05` (equal values of the same dynamic type hash equal; Task 3.1 test inserts and looks up named-array keys built separately).
- Examples keep type-checking (`npm run check`). If Task 1.2/1.3 flags example code (ambiguous selectors), fix the example in the same task and say so in the commit body.
- `test/perf/zero-alloc.js` results unchanged: Task 4.2 converts at closure capture only, not in loop bodies.

### 3. Edge Cases & Error Handling

- Task 1.1: `a[f(1)]`, `m[func() int { return 1 }()]` (index by a called func literal) keep parsing as index expressions; `mk[func(int) string]()`, `mk[func(), int]()` parse as instantiations.
- Tasks 1.2–1.3: field declared on the outer struct shadows two promoted ones; ambiguous name that is never selected compiles (Go only errors on use); `C{}.A.M` (explicit path) compiles.
- Task 2.1: an interface embed and a struct embed providing the same method at depth 1 → ambiguous; an outer method shadows the interface's; `var e error = W{nil}; e.Error()` panics with the nil-dereference message (asserted in Task 2.2/2.3).
- Task 2.4: the pointer embed is non-nil → method runs as before; nested `PO2{PO{}}` with a nil pointer two levels down → same panic.
- Task 3.1: `A` and `[2]int` values never compare equal in an `any`; `map[any]int{A{1,2}: 1}` with lookup `[2]int{1,2}` → `0`; `%T` of `A` → `main.A`.
- Task 4.1: target is a named interface (`var e fmt.Stringer`) with a value implementing it; target is a boxed (captured) `any`.
- Task 4.2: the env also captures an `int32`/`uint8` loop variable (no conversion needed) and a `range []T` value variable.
- Task 4.4: `complex128` arithmetic unchanged; `complex64(x) * complex64(y)` with exact float32 parts prints the same as before.

---

## Implementation Tasks

Scheduled from review follow-ups (`plans/follow-ups.md` sweep 2026-11-11 round 2, `J01`–`J11`). Each task's `Test:` asserts the repro from `Verified Gaps`.

### Phase 1: Parser and Typechecker Selectors
- [x] Task 1.1: Parse explicit func type arguments (`J06`)
  - Files: `src/parser/declarations.js` (`parseReturnType`)
  - Test: `test/unit/types/generics.test.js`: `w := mk[func(int)]()` + `fmt.Printf("%T\n", w)` → `map[string]func(int)` (`assertProgramOutput`); `mk[func(int) string]()` and `mk[func(), int]()` (two-param `mk`) compile; `m[func() int { return 1 }()]` still indexes
  - Done when: `assertAllTargetsOutput` passes and the index-expression edge cases keep their behaviour
- [ ] Task 1.2: Track promoted field depth (`J03`, field vs method)
  - Files: `src/typechecker/index.js` (`_offerEmbedMethods`, `_promoteEmbeddedInto`), `src/typechecker/resolve.js` (`_fieldTypeStruct`)
  - Test: `test/unit/language/named-type-methods.test.js`: `type A struct{ M int }; type B struct{}; func (B) M() {}; type C struct{ A; B }; fmt.Println(C{}.M)` → `assertErrorContains(…, "ambiguous selector")`; shallower field over deeper method prints `0`; outer-declared field `M` shadows both
  - Done when: negative reports on every target and positives pass `assertAllTargetsOutput`
- [ ] Task 1.3: Report two promoted fields at the same depth as ambiguous (`J03`, field vs field)
  - Files: `src/typechecker/index.js`, `src/typechecker/resolve.js`
  - Test: `test/unit/language/named-type-methods.test.js`: `type A struct{ X int }; type B struct{ X int }; type C struct{ A; B }; c.X` → `assertErrorContains(…, "ambiguous selector c.X")`; `c.A.X` prints `0`; ambiguous `X` never selected compiles
  - Done when: negative reports on every target, positives pass `assertAllTargetsOutput`, and `npm run check` type-checks the examples

### Phase 2: Embedded Interfaces and Embedded Nil Pointers
- [ ] Task 2.1: Promote an embedded interface's methods in the typechecker (`J02`)
  - Files: `src/typechecker/index.js` (`_offerEmbedMethods`)
  - Test: `test/unit/language/named-type-methods.test.js`: `type S struct{ Mer }; var m Mer = S{T{}}` and `S{T{}}.M()` type-check (`compile(…).errors` empty on every target); `struct{ Mer; B }` with `B.M` at depth 1 → `ambiguous selector`
  - Done when: the positives type-check and the negative reports on every target (backend runs are asserted in 2.2/2.3)
- [ ] Task 2.2: Forward embedded interface methods in JS (`J02` JS)
  - Files: `src/lower/embedding.js` (`computeEmbeddedStubs`), `src/backend/js/index.js` (stub emission, if needed)
  - Test: `test/unit/language/named-type-methods.test.js`: `var m Mer = S{T{}}; m.M(); S{T{}}.M()` → `T.M\nT.M`; `type W struct{ error }; var e error = W{errors.New("x")}; fmt.Println(e.Error())` → `x`; `W{}.Error()` with `recover` → nil-dereference message (`assertJsTargetsOutput`)
  - Done when: `js` and `both` print the Go output (switch to `assertAllTargetsOutput` in Task 2.3)
- [ ] Task 2.3: Dispatch through embedded interface fields in WASM (`J02` WASM)
  - Files: `src/backend/wasm/module-emitter.js` (`_findPromotedMethod`), `src/backend/wasm/emit.js` (candidate call), `src/backend/wasm/method-expr.js` (direct call, if needed)
  - Test: `test/unit/wasm/interfaces.test.js`: the Task 2.2 programs plus `v.(Mer)` on `any(S{T{}})` → `true`
  - Done when: `assertAllTargetsOutput` passes for every Task 2.2/2.3 program
- [ ] Task 2.4: Panic on value methods promoted through a nil embedded pointer in WASM (`J04`)
  - Files: `src/backend/wasm/emit.js` (embed-path walk in interface dispatch)
  - Test: `test/unit/wasm/interfaces.test.js`: `var v any = PO{}; v.(VMer).VM()` with `recover`, for empty `Inner` and `Inner struct{ n int }`, and nested `PO2{PO{}}` → `runtime error: invalid memory address or nil pointer dereference`; non-nil `PO{&Inner{}}` → `inner`
  - Done when: `assertAllTargetsOutput` passes and no raw `RuntimeError` escapes

### Phase 3: WASM Dynamic Types in `any`
- [ ] Task 3.1: Keep named array and slice identity in an `any` (`J05`)
  - Files: `src/backend/wasm/emit-exprs.js` (interface boxing), `src/backend/wasm/module-emitter.js` (box selection), `src/backend/wasm/emit-builtins.js` (`any_eq`/`any_hash` arms, if needed)
  - Test: `test/unit/types/dynamic-types.test.js`: `type A [2]int` → `k.([2]int)`, `k == any([2]int{1,2})` → `false false`; type switch `case [2]int … case A` → `A`; `type S []int` + `k.([]int)` → `false`, `k.(S)` → `true`; `map[any]int{A{1,2}: 1}[[2]int{1,2}]` → `0`
  - Done when: `assertAllTargetsOutput` passes
- [ ] Task 3.2: Match generic maps and slices of funcs in an `any` (`J07`)
  - Files: `src/backend/wasm/monomorph.js` and/or `src/backend/wasm/module-emitter.js` (per probe at task start)
  - Test: `test/unit/types/dynamic-types.test.js`: `mk(func() {})` returning `map[string]V{}` → `map[string]func() true`; returning `[]V{v}` → `[]func() true`; `V=int` stays `map[string]int true`
  - Done when: `assertAllTargetsOutput` passes and the commit body names the root cause
- [ ] Task 3.3: Name arrays and slices of funcs in WASM assertion panics (`J08`)
  - Files: `src/backend/wasm/emit-builtins.js` (`_dynamicTypeNames`), `src/backend/wasm/module-emitter.js` (record array Go types / func-slice tags)
  - Test: `test/unit/types/dynamic-types.test.js`: `var w any = [2]int{}; _ = w.(int)` with `recover` → `interface conversion: interface {} is [2]int, not int`; `[]func(){}` → `… is []func(), not int`; `var w any = []func(){}; _, ok := w.([]any)` → `false`
  - Done when: `assertAllTargetsOutput` passes

### Phase 4: Statement and Call Codegen, Docs
- [ ] Task 4.1: Box range assignments into interface-typed variables in WASM (`J01`)
  - Files: `src/backend/wasm/emit-stmts.js` (`_emitRangeAssignStore` and its callers)
  - Test: `test/unit/language/range-assign.test.js`: `var a any; for a = range []int{5, 6}` → `1`; `for _, a = range []int{5, 6}` → `6`; `for a, b = range "hi"` → `1 105`; `for a, b = range map[string]int{"k": 3}` → `k 3`; `for a = range 3` → `2`; `var s fmt.Stringer` target with a `Stringer` slice element
  - Done when: `assertAllTargetsOutput` passes and `assertValidWasm` holds for every program
- [ ] Task 4.2: Convert captured range indexes into range-over-func closure environments in WASM (`J09`)
  - Files: `src/backend/wasm/emit.js` (yield-closure environment capture)
  - Test: `test/unit/language/range-func.test.js`: `L5: for i := range 2 { for x := range seq { if x == 2 { continue L5 }; fmt.Println(i, x) } }` → `0 1\n1 1`; unlabeled `break` variant; outer `range []int{0, 1}` variant; `break L5` → `0 1`
  - Done when: `assertAllTargetsOutput` passes and `assertValidWasm` holds
- [ ] Task 4.3: Spread forwarded tuples in nil-checked interface method calls in JS (`J10`)
  - Files: `src/backend/js/expressions.js` (strict interface-call path)
  - Test: `test/unit/types/dynamic-types.test.js` (next to the 11-11 `makePair` tests): `var c C = &O{}; fmt.Println(wrap(c.check(makePair())))` → `true`; `x := c.check(makePair())` → `true`; nil `c` → nil-dereference message
  - Done when: `assertAllTargetsOutput` passes
- [ ] Task 4.4: Round typed `complex64` constants and `complex64` arithmetic to float32 in JS (`J11`)
  - Files: `src/typechecker/assignability.js` (`_c64Const` tagging), `src/backend/js/expressions.js` (`_genComplexBinary`), `docs/go-compatibility.md` ("Complex constants" row, only if it no longer matches)
  - Test: `test/unit/types/complex.test.js`: `const kt complex64 = 1 + 0.01i; var c complex64 = 2; x := c * (1 + 0.01i); fmt.Println(imag(kt) == 0.01, imag(x) == 0.02)` → `true true`; `c + (1 + 0.01i)`, `c / (1 + 0.01i)` match Go's float32 results; `complex128` arithmetic prints unchanged
  - Done when: `assertAllTargetsOutput` passes and `docs/go-compatibility.md` contradicts none of Phases 1–4
