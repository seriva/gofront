# v1.9.1 Review Follow-ups (2026-11-11, round 2) — Design Plan

**Version:** v1.9.1  
**Status:** In Progress  
**Base branch:** main  
**Related:** [`follow-ups-2026-11-11-plan.md`](follow-ups-2026-11-11-plan.md) (origin of every ledger entry, PRs #180–#183, merged into main as #184), [`follow-ups-2026-11-10-plan.md`](follow-ups-2026-11-10-plan.md)  
**Release note:** Structs that embed an interface (`struct{ error }`) now get its methods, explicit func type arguments (`f[func(int)]()`) parse, and WebAssembly builds no longer produce invalid modules for range assignments into an `any` or for a range-over-func loop nested in a `range` loop. Named array and slice types keep their identity in an `any` on WebAssembly, `complex64` arithmetic and typed constants keep float32 precision in JavaScript, and a field or method promoted from two embedded types at the same depth is now reported as an ambiguous selector, as in Go. A method promoted from an embedded type now wins over a same-named field embedded deeper, `append` of untyped constants to `[]complex128` works in JavaScript, a range assignment into an interface keeps a named type's methods in JavaScript, arrays, slices and maps keep their element types in an `any` on WebAssembly, `fmt` prints a slice that generic code boxes into an `any`, and WebAssembly builds accept untyped constants where a complex value is stored through a pointer, switched on or passed to a deferred call.  

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

**Second sweep (2026-11-12).** Phases 1–4 merged (PRs #185–#188). Their reviews logged 7 more entries in `plans/follow-ups.md`, numbered `K01`–`K07` in ledger order. Re-probed on `feat/follow-ups-2026-11-11b` @ `2242353` (Phases 1–4 merged) with the same scratch harness:

- **7 entries reproduce**; `K02` is deferred (explicit "planned" boundary error, needs a facade design), `K01` and `K03`–`K07` are scheduled in Phases 5–7. Entry `K02` reproduces only for a `wasm` package, not `both` as logged.
- The re-probe widened several:
  - `K01`: the typechecker rejects `C{}.M()`, and a `both`/`js` interface call (`var i I = C{}; i.M()`) throws `i.M is not a function`; `wasm` is correct. The shallower-field-over-deeper-method direction is already correct.
  - `K03`: also `[]int64` / `[]uint64` / `[]uint` vs `[]int`, `[2]int32` vs `[2]uint8`, `[2]A` (named array) vs `[2][2]int`, and `map[string]int64` vs `map[string]int`; all `true` on wasm, `false` on js/both. Pointers (`*int64` vs `*int`) are correct.
  - `K04`: broader than `%T`. `fmt.Println(mk(3))` for `func mk[V any](v V) any { return []V{v} }` prints `<nil>` and `%T` prints nothing on every target, for every `V` (not only funcs); assertions on the value work, and `map[string]V` is correct. Same on the pre-Phase-3 base.
  - `K05`: also `append` of `1+0.01i` to `[]complex64` (imag `0.01` as float64) and `append` to a named complex slice; `append(c, 3i)` and spread arguments are correct.
  - `K06`: also `*p += 2`, `**q = 9`, `*p = 9` for `complex64`, `switch c { case 2i: }` (any `switch` on a complex tag), `defer func(z complex128){}(2)` and `defer t.m(2)`. `p.c = 2` and plain `p(2)` are correct.
  - `K07`: every range-assignment form into an interface (map value, map key, defined string type) and into `any` (`s.(N)` is `false`) loses the defined type on JS; struct and pointer elements are correct.

**Done means:**

- Every repro in Phases 1–4 is a passing test in its task's `Test:` file: programs via `assertProgramOutput` (`both` + `wasm`), or `assertAllTargetsOutput` where plain `js` packages must also match; invalid programs via `assertErrorContains` on every target.
- No scheduled repro emits invalid WASM (`assertValidWasm`) or traps with a raw WebAssembly `RuntimeError` (`J01`, `J04`, `J09`).
- `npm test`, `npm run check` (including example type-checks) and `npm run test:e2e` pass with zero regressions.
- Every repro in Phases 5–7 is a passing test in its task's `Test:` file (same assertion rules). No Phase 5–7 repro emits invalid WASM (`assertValidWasm`; `K06`) or prints `<nil>`/an empty `%T` for a generic slice in an `any` (`K04`).
- `docs/go-compatibility.md` does not contradict the new behaviour: the "Complex constants" row describes exactly what differs from Go after `J11` and `K05` (Tasks 4.4, 5.3) and the `fmt` and `encoding/json` rows match Phases 6 (Tasks 6.3, 6.4), and no row claims struct-embedded interfaces or named array/slice identity in an `any` behave otherwise.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Every reproducing ledger defect across the parser, typechecker, JS and WASM backends | `J01`–`J11`, `K01`, `K03`–`K07` | |
| **In scope: target-specific** | Fix the failing target(s) and pin the working target(s) in the same test | WASM-only: `J01`, `J04`, `J05`, `J07`, `J08`, `J09`. JS-only: `J10` (`both` JS side), `J11`. All targets: `J02`, `J03`, `J06`, `K04`. `K01`: typechecker (all targets) + JS class. WASM-only: `K03`, `K06`. JS-only: `K05`, `K07` | |
| **Excluded: runtime / platform** | Documented JS map-key stringification stays | `m[[2]int{1,2}]` and `m["1,2"]` share a key in a `js`/`both` `map[any]` | Documented in `docs/go-compatibility.md:89` ("JS objects only have string keys"). |
| **Excluded: runtime / platform** | Documented JS `any` semantics stay as documented | Sized numbers in an `any`, untyped complex constants as plain numbers in `js` (`docs/go-compatibility.md` "Complex constants", "Sized numbers in an `any`") | No runtime type descriptors (roadmap guiding principle). `J11` only fixes `complex64` values that already are complex in JS output. |
| **Excluded: deferred** | Rejecting other unparenthesized composite literals in statement headers | `if o == Other{1} {` | Carried over from the 11-11 plan; rejecting forms that compile today needs its own decision. |
| **Excluded: deferred** | Tuple-returning interface methods across the wasm boundary (`K02`) | `type Pairer interface { Pair(int) (int, string) }; type S struct { P Pairer }; func main() {}` in a `wasm` package → `S.P: type kind 'tuple' (in method Pairer.Pair) is not yet supported across the wasm boundary (planned)`; a `both` package compiles | A deliberate, clearly worded boundary error. Supporting it needs a facade design for multi-value returns of interface methods (`src/backend/wasm/boundary.js`), not a defect fix. |

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

### Review follow-ups (2026-11-12)

All 7 entries re-probed on `feat/follow-ups-2026-11-11b` @ `2242353`. Columns js / both / wasm, observed → wanted. Harness: `compileFiles` with `forceTarget` `js`, `both`, `wasm`, `WebAssembly.Module` validation, run through a sink-bundled ESM module.

| Area | Finding | Evidence & probe |
|---|---|---|
| Promoted method vs deeper field | `K01` A method promoted at depth 1 is not selected when a same-named field is promoted at depth 2 | `type In struct{ M int }; type A struct{ In }; type B struct{}; func (B) M() string { return "m" }; type C struct{ A; B }; fmt.Println(C{}.M())` → js/both/wasm `Type error … Cannot call non-function type int`; want `m`. Method value `f := c.M` → same. `var i I = C{}; i.M()` (`I` has `M() string`) → js `i.M is not a function`, both `__nilcall(...).M is not a function`, wasm `m`. Reverse (`A{In}` with method, `B{ M int }`: field at depth 1 beats method at depth 2) → `0` on all (correct). Cause: Phase 1's promotion depth model reaches only `_fieldTypeStruct`; the flattened field map still wins in the typechecker's selector/call path, and the JS class keeps the field as an own instance property over the method stub (`src/lower/embedding.js` `computeEmbeddedStubs`). (#185, follow-ups-2026-11-11b Phase 1) |
| WASM boundary | `K02` A tuple-returning method of an interface-typed field of an exported struct is rejected at the wasm boundary | `type Pairer interface { Pair(int) (int, string) }; type S struct { P Pairer }; func main() {}` → `wasm` package: `S.P: type kind 'tuple' (in method Pairer.Pair) is not yet supported across the wasm boundary (planned)`; `both` package compiles with no wasm module (the logged `both` repro does not reproduce). Deliberate error (`src/backend/wasm/boundary.js:551`) → `Excluded: deferred`. (#186, follow-ups-2026-11-11b Phase 2) |
| WASM dynamic types in `any` | `K03` Values whose Go types share a WebAssembly representation are one type in an `any` | `var w any = [2]int64{}; _, ok := w.([2]int)` → js/both `false`, wasm `true`; want `false`. Widened (wasm `true`, want `false`): `[2]int32` vs `[2]uint8`, `[2]A` (`type A [2]int`) vs `[2][2]int`, `[]int64`/`[]uint64`/`[]uint` vs `[]int` and `[]uint64`, `map[string]int64` vs `map[string]int`; type switch `case [2]int` before `case [2]int64` on a `[2]int64` → wasm `int`, want `int64`. `[2]A` struct vs `[2][2]int` and `*int64` vs `*int` → correct. `[]float32` vs `[]float64` → correct. Cause: `arrayTypes`, slice and map types are keyed by wasm element type (`module-emitter.js`), and only slices of `bool`/≤32-bit integers are tagged (`TAGGED_SLICE_ELEMS`, `src/backend/wasm/types.js:527`); arrays are boxed only when named. (feat/follow-ups-2026-11-11b-phase-3, follow-ups-2026-11-11b Phase 3) |
| Generic slices in `any` | `K04` A slice that generic code boxes into an `any` prints `<nil>` and has an empty `%T` | `func mk[V any](v V) any { return []V{v} }; w := mk(3); fmt.Println(w); fmt.Printf("%T\n", w)` → js/both/wasm `<nil>` and an empty line; want `[3]` and `[]int`. `V=string`, `V=func(a int, b ...string) (int, error)` → same. `w.([]int)` → `[3] true` (value is intact); `map[string]V` → `map[a:3]` / `map[string]int` (correct); non-generic `[]int` in an `any` and `show[V any](v []V)` → correct. Same on the pre-Phase-3 base (28a9f01). Cause (pin at task start): the interface box of a composite literal whose static type contains a type parameter gets no fmt metadata (`_ifaceSrc`) and no WASM name for the instantiated slice type, unlike `map[string]V` (11-11 Task 3.x). (feat/follow-ups-2026-11-11b-phase-3, follow-ups-2026-11-11b Phase 3) |
| JS `append` of constants | `K05` Untyped constants appended to a complex slice are not converted | `var c []complex128; c = append(c, 7); fmt.Println(c)` → js/both `[(NaN+NaNi)]`, wasm `[(7+0i)]`; want `[(7+0i)]`. Widened: `append(c, 7.5, 2)` and `[]complex64`/named `type Zs []complex128` → `NaN`; `append(c64, 1+0.01i)` → `imag(...) == 0.01` is `false` on js (float64 digits), `true` on wasm; `append(c, 3i)` and spread arguments → correct. Cause: `BUILTIN_CHECK.append` (`src/typechecker/expressions.js:75`) marks interface boxes and 64-bit ints per argument but never calls `_tagComplexConst`, so `_asComplex` / `_c64Const` are never set. `docs/go-compatibility.md` "Complex constants" documents this gap. (feat/follow-ups-2026-11-11b-phase-4, follow-ups-2026-11-11b Phase 4) |
| WASM untyped complex constants | `K06` Several places that take an untyped constant where a complex value is expected build an invalid module | `var c complex128; p := &c; *p = 9` → wasm invalid (`not enough arguments on the stack for local.tee`), js/both `(9+0i)`; want `(9+0i)`. Widened (all wasm invalid): `*p += 2`, `**q = 9`, `*p = 9` with `complex64`, `*m["a"] = 4` (map of `*complex128`), `var c complex128 = 2; switch c { case 2: }` and `case 2i:` (every `switch` on a complex tag; `not enough arguments on the stack for if`), `defer func(z complex128){…}(2)` and `defer t.m(2)` (`local.tee[0] expected type (ref null …), found local.get of type i64`). Correct: `p.c = 2`, `c == 2`, `c += 3`, plain `p(2)`, `return 4` in a closure. The logged `defer p(2)` type error (`Cannot assign int to complex128`) no longer appears; it is now an invalid module. (feat/follow-ups-2026-11-11b-phase-4, follow-ups-2026-11-11b Phase 4) |
| JS range assignment into an interface | `K07` A defined non-struct type loses its identity when a range assigns it into an interface | `type N int; func (n N) String() string { … }; var s fmt.Stringer; for _, s = range []N{3, 4} {}; fmt.Println(s)` → js/both `4`, wasm `N4`; want `N4`. Widened: map value, map key (`for s = range map[N]bool{5: true}`), `type S string` → js `b`/`5`/`3`, wasm correct; into `any`: `for _, s = range []N{3, 4} {}; _, ok := s.(N)` → js `false`, want `true`; the plain assignment `s = N(4)` and the define form `for _, v := range … { s = v }` → `N4` on all (correct); struct and pointer elements → correct. Cause: `_checkAssignTypes` marks boxes on `stmt.rhs[i]` only when `rhs.length == lhs.length`, so a range assignment's `lhs` never gets `_ifaceBox`/`_ifaceNamedType`, and `_emitRangeVar` (`src/backend/js/statements.js:1457`) stores the raw element. (feat/follow-ups-2026-11-11b-phase-4, follow-ups-2026-11-11b Phase 4) |

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

- **`K01` (Tasks 5.1–5.2):** a method promoted at a shallower depth than a same-named field wins (Go's depth rule), in the same candidate model as 1.2/1.3.
  - Typechecker (5.1): selector, call and method-value resolution consult the depth model before the flattened field map, so `C{}.M()` and `c.M` resolve to `B.M`.
  - JS (5.2): the class emits the stub for the winning method and does not define the deeper field as an own property of the outer class (the field stays reachable as `c.A.In.M`), so `i.M()` through an interface calls the method.
- **`K03` (Tasks 6.1–6.3):** an `any` boxes values by Go type, not by wasm type.
  - 6.1 arrays: every array stored in an `any` gets an interface box keyed by `goTypeKey` (named arrays already do, 3.1); type assertion, type switch, `any_eq`/`any_hash` and `_dynamicTypeNames` use the box.
  - 6.2 slices: slices whose wasm element type is shared by several Go types (`int`, `int64`, `uint`, `uint64`, `uintptr` are i64) join `TAGGED_SLICE_ELEMS`, so `getTaggedSliceType` tags them per Go type in an `any`; `test/perf/zero-alloc.js` must stay unchanged (tagging happens on boxing into an `any`, not in loops).
  - 6.3 maps: a map stored in an `any` whose key or value Go type shares a wasm type with another Go type is boxed by `goTypeKey` (named maps already are).
- **`K04` (Task 6.4):** pin at task start with a probe. Give the interface box of a composite literal whose static type contains a type parameter the same treatment `map[string]V` gets: JS fmt metadata from the instantiated type on every call, and the WASM monomorph substitutes `V` before the box/name is recorded. Record the root cause in the commit body.
- **`K05` (Task 5.3):** `BUILTIN_CHECK.append` calls `_tagComplexConst` (and `_tagFloat32Const`, already correct for `float32`) for every non-spread argument against the slice's element type; JS codegen already consumes `_asComplex` / `_c64Const`. The "Complex constants" docs row loses the `append` exception.
- **`K07` (Task 5.4):** the typechecker marks a range assignment's interface boxing on the `lhs` node (box kind, named type, static source) using the range's key/element type; `_emitRangeVar` wraps the value with the existing `_ifaceBoxWrap` / named-box helpers. Define forms (`:=`) are unaffected.
- **`K06` (Tasks 7.1–7.3):** each site converts an untyped constant to the complex struct with the existing untyped-literal-to-complex conversion in `src/backend/wasm/emit-exprs.js` (it needs the target wasm type, which these three sites do not pass): store through a pointer deref (assign and compound assign), the `switch` tag comparison (complex equality for the tag and each case, including complex-typed cases), and deferred call arguments (evaluated into the defer record with the parameter type as target).

### 2. Invariants & Safety Bounds

- No new runtime type descriptors; tags and names are compile-time.
- Unambiguous embedding programs keep their dispatch: existing tests in `test/unit/language/named-type-methods.test.js`, `test/unit/wasm/mixins.test.js`, `test/unit/wasm/interfaces.test.js`, `test/unit/wasm/iface-assert.test.js`, `test/unit/builtins/fmt-stringer.test.js` keep passing unchanged.
- `any_hash` and `any_eq` stay consistent after `J05` (equal values of the same dynamic type hash equal; Task 3.1 test inserts and looks up named-array keys built separately).
- Examples keep type-checking (`npm run check`). If Task 1.2/1.3 flags example code (ambiguous selectors), fix the example in the same task and say so in the commit body.
- `test/perf/zero-alloc.js` results unchanged: Task 4.2 converts at closure capture only, not in loop bodies.
- Tasks 6.1–6.3: `any_hash` and `any_eq` stay consistent (equal values of one dynamic type hash equal); no change to slices, arrays or maps that never reach an `any`; `test/perf/zero-alloc.js` unchanged.
- Task 5.4 / 5.2: struct and pointer elements, plain assignments and `:=` range forms keep their current output.

### 3. Edge Cases & Error Handling

- Task 1.1: `a[f(1)]`, `m[func() int { return 1 }()]` (index by a called func literal) keep parsing as index expressions; `mk[func(int) string]()`, `mk[func(), int]()` parse as instantiations.
- Tasks 1.2–1.3: field declared on the outer struct shadows two promoted ones; ambiguous name that is never selected compiles (Go only errors on use); `C{}.A.M` (explicit path) compiles.
- Task 2.1: an interface embed and a struct embed providing the same method at depth 1 → ambiguous; an outer method shadows the interface's; `var e error = W{nil}; e.Error()` panics with the nil-dereference message (asserted in Task 2.2/2.3).
- Task 2.4: the pointer embed is non-nil → method runs as before; nested `PO2{PO{}}` with a nil pointer two levels down → same panic.
- Task 3.1: `A` and `[2]int` values never compare equal in an `any`; `map[any]int{A{1,2}: 1}` with lookup `[2]int{1,2}` → `0`; `%T` of `A` → `main.A`.
- Task 4.1: target is a named interface (`var e fmt.Stringer`) with a value implementing it; target is a boxed (captured) `any`.
- Task 4.2: the env also captures an `int32`/`uint8` loop variable (no conversion needed) and a `range []T` value variable.
- Task 4.4: `complex128` arithmetic unchanged; `complex64(x) * complex64(y)` with exact float32 parts prints the same as before.
- Task 5.1–5.2: depth-1 method beats depth-2 field; depth-1 field still beats a depth-2 method; two depth-1 candidates stay ambiguous (1.2/1.3); a method value `c.M` and an interface call both resolve to the method.
- Task 5.3: `append(f32s, 0.1)` and spread `append(a, b...)` keep working; `append(zs, x)` with `x` already complex is not re-converted.
- Task 5.4: boxed (captured) range target; `for s = range` index into `any` still prints as `int`.
- Tasks 6.1–6.3: `[2]int` and `[2]int` values from separate expressions still compare equal and hash equal; `map[any]` lookups with an unnamed array key; `%T` and the assertion-panic names of the new boxes (`[2]int64`, `[]uint64`, `map[string]int64`).
- Task 6.4: `V` as a defined struct type, `V` as a func type, nested `[]V` in a map; non-generic `[]int` in an `any` unchanged.
- Tasks 7.1–7.3: `complex64` and `complex128` both; `switch c { case 2, 3i: }` multi-value cases; `defer` of a method value and a func literal.

---

## Implementation Tasks

Scheduled from review follow-ups (`plans/follow-ups.md` sweep 2026-11-11 round 2, `J01`–`J11`). Each task's `Test:` asserts the repro from `Verified Gaps`.

### Phase 1: Parser and Typechecker Selectors
- [x] Task 1.1: Parse explicit func type arguments (`J06`)
  - Files: `src/parser/declarations.js` (`parseReturnType`)
  - Test: `test/unit/types/generics.test.js`: `w := mk[func(int)]()` + `fmt.Printf("%T\n", w)` → `map[string]func(int)` (`assertProgramOutput`); `mk[func(int) string]()` and `mk[func(), int]()` (two-param `mk`) compile; `m[func() int { return 1 }()]` still indexes
  - Done when: `assertAllTargetsOutput` passes and the index-expression edge cases keep their behaviour
- [x] Task 1.2: Track promoted field depth (`J03`, field vs method)
  - Files: `src/typechecker/index.js` (`_offerEmbedMethods`, `_promoteEmbeddedInto`), `src/typechecker/resolve.js` (`_fieldTypeStruct`)
  - Test: `test/unit/language/named-type-methods.test.js`: `type A struct{ M int }; type B struct{}; func (B) M() {}; type C struct{ A; B }; fmt.Println(C{}.M)` → `assertErrorContains(…, "ambiguous selector")`; shallower field over deeper method prints `0`; outer-declared field `M` shadows both
  - Done when: negative reports on every target and positives pass `assertAllTargetsOutput`
- [x] Task 1.3: Report two promoted fields at the same depth as ambiguous (`J03`, field vs field)
  - Files: `src/typechecker/index.js`, `src/typechecker/resolve.js`
  - Test: `test/unit/language/named-type-methods.test.js`: `type A struct{ X int }; type B struct{ X int }; type C struct{ A; B }; c.X` → `assertErrorContains(…, "ambiguous selector c.X")`; `c.A.X` prints `0`; ambiguous `X` never selected compiles
  - Done when: negative reports on every target, positives pass `assertAllTargetsOutput`, and `npm run check` type-checks the examples

### Phase 2: Embedded Interfaces and Embedded Nil Pointers
- [x] Task 2.1: Promote an embedded interface's methods in the typechecker (`J02`)
  - Files: `src/typechecker/index.js` (`_offerEmbedMethods`)
  - Test: `test/unit/language/named-type-methods.test.js`: `type S struct{ Mer }; var m Mer = S{T{}}` and `S{T{}}.M()` type-check (`compile(…).errors` empty on every target); `struct{ Mer; B }` with `B.M` at depth 1 → `ambiguous selector`
  - Done when: the positives type-check and the negative reports on every target (backend runs are asserted in 2.2/2.3)
- [x] Task 2.2: Forward embedded interface methods in JS (`J02` JS)
  - Files: `src/lower/embedding.js` (`computeEmbeddedStubs`), `src/backend/js/index.js` (stub emission, if needed)
  - Test: `test/unit/language/named-type-methods.test.js`: `var m Mer = S{T{}}; m.M(); S{T{}}.M()` → `T.M\nT.M`; `type W struct{ error }; var e error = W{errors.New("x")}; fmt.Println(e.Error())` → `x`; `W{}.Error()` with `recover` → nil-dereference message (`assertJsTargetsOutput`)
  - Done when: `js` and `both` print the Go output (switch to `assertAllTargetsOutput` in Task 2.3)
- [x] Task 2.3: Dispatch through embedded interface fields in WASM (`J02` WASM)
  - Files: `src/backend/wasm/module-emitter.js` (`_findPromotedMethod`), `src/backend/wasm/emit.js` (candidate call), `src/backend/wasm/method-expr.js` (direct call, if needed)
  - Test: `test/unit/wasm/interfaces.test.js`: the Task 2.2 programs plus `v.(Mer)` on `any(S{T{}})` → `true`
  - Done when: `assertAllTargetsOutput` passes for every Task 2.2/2.3 program
- [x] Task 2.4: Panic on value methods promoted through a nil embedded pointer in WASM (`J04`)
  - Files: `src/backend/wasm/emit.js` (embed-path walk in interface dispatch)
  - Test: `test/unit/wasm/interfaces.test.js`: `var v any = PO{}; v.(VMer).VM()` with `recover`, for empty `Inner` and `Inner struct{ n int }`, and nested `PO2{PO{}}` → `runtime error: invalid memory address or nil pointer dereference`; non-nil `PO{&Inner{}}` → `inner`
  - Done when: `assertAllTargetsOutput` passes and no raw `RuntimeError` escapes

### Phase 3: WASM Dynamic Types in `any`
- [x] Task 3.1: Keep named array and slice identity in an `any` (`J05`)
  - Files: `src/backend/wasm/emit-exprs.js` (interface boxing), `src/backend/wasm/module-emitter.js` (box selection), `src/backend/wasm/emit-builtins.js` (`any_eq`/`any_hash` arms, if needed)
  - Test: `test/unit/types/dynamic-types.test.js`: `type A [2]int` → `k.([2]int)`, `k == any([2]int{1,2})` → `false false`; type switch `case [2]int … case A` → `A`; `type S []int` + `k.([]int)` → `false`, `k.(S)` → `true`; `map[any]int{A{1,2}: 1}[[2]int{1,2}]` → `0`
  - Done when: `assertAllTargetsOutput` passes
- [x] Task 3.2: Match generic maps and slices of funcs in an `any` (`J07`)
  - Files: `src/backend/wasm/monomorph.js` and/or `src/backend/wasm/module-emitter.js` (per probe at task start)
  - Test: `test/unit/types/dynamic-types.test.js`: `mk(func() {})` returning `map[string]V{}` → `map[string]func() true`; returning `[]V{v}` → `[]func() true`; `V=int` stays `map[string]int true`
  - Done when: `assertAllTargetsOutput` passes and the commit body names the root cause
- [x] Task 3.3: Name arrays and slices of funcs in WASM assertion panics (`J08`)
  - Files: `src/backend/wasm/emit-builtins.js` (`_dynamicTypeNames`), `src/backend/wasm/module-emitter.js` (record array Go types / func-slice tags)
  - Test: `test/unit/types/dynamic-types.test.js`: `var w any = [2]int{}; _ = w.(int)` with `recover` → `interface conversion: interface {} is [2]int, not int`; `[]func(){}` → `… is []func(), not int`; `var w any = []func(){}; _, ok := w.([]any)` → `false`
  - Done when: `assertAllTargetsOutput` passes

### Phase 4: Statement and Call Codegen, Docs
- [x] Task 4.1: Box range assignments into interface-typed variables in WASM (`J01`)
  - Files: `src/backend/wasm/emit-stmts.js` (`_emitRangeAssignStore` and its callers)
  - Test: `test/unit/language/range-assign.test.js`: `var a any; for a = range []int{5, 6}` → `1`; `for _, a = range []int{5, 6}` → `6`; `for a, b = range "hi"` → `1 105`; `for a, b = range map[string]int{"k": 3}` → `k 3`; `for a = range 3` → `2`; `var s fmt.Stringer` target with a `Stringer` slice element
  - Done when: `assertAllTargetsOutput` passes and `assertValidWasm` holds for every program
- [x] Task 4.2: Convert captured range indexes into range-over-func closure environments in WASM (`J09`)
  - Files: `src/backend/wasm/emit.js` (yield-closure environment capture)
  - Test: `test/unit/language/range-func.test.js`: `L5: for i := range 2 { for x := range seq { if x == 2 { continue L5 }; fmt.Println(i, x) } }` → `0 1\n1 1`; unlabeled `break` variant; outer `range []int{0, 1}` variant; `break L5` → `0 1`
  - Done when: `assertAllTargetsOutput` passes and `assertValidWasm` holds
- [x] Task 4.3: Spread forwarded tuples in nil-checked interface method calls in JS (`J10`)
  - Files: `src/backend/js/expressions.js` (strict interface-call path)
  - Test: `test/unit/types/dynamic-types.test.js` (next to the 11-11 `makePair` tests): `var c C = &O{}; fmt.Println(wrap(c.check(makePair())))` → `true`; `x := c.check(makePair())` → `true`; nil `c` → nil-dereference message
  - Done when: `assertAllTargetsOutput` passes
- [x] Task 4.4: Round typed `complex64` constants and `complex64` arithmetic to float32 in JS (`J11`)
  - Files: `src/typechecker/assignability.js` (`_c64Const` tagging), `src/backend/js/expressions.js` (`_genComplexBinary`), `docs/go-compatibility.md` ("Complex constants" row, only if it no longer matches)
  - Test: `test/unit/types/complex.test.js`: `const kt complex64 = 1 + 0.01i; var c complex64 = 2; x := c * (1 + 0.01i); fmt.Println(imag(kt) == 0.01, imag(x) == 0.02)` → `true true`; `c + (1 + 0.01i)`, `c / (1 + 0.01i)` match Go's float32 results; `complex128` arithmetic prints unchanged
  - Done when: `assertAllTargetsOutput` passes and `docs/go-compatibility.md` contradicts none of Phases 1–4

### Phase 5: Promoted Methods over Fields, JS Constant and Range Conversions
Scheduled from review follow-ups (`plans/follow-ups.md` sweep 2026-11-12, `K01`–`K07`). Each task's `Test:` asserts the repro from `Verified Gaps` (Review follow-ups (2026-11-12)).
- [x] Task 5.1: Resolve a method promoted shallower than a same-named field in the typechecker (`K01`)
  - Files: `src/typechecker/types.js` (promotion depth helper), `src/typechecker/resolve.js` (`_fieldTypeStruct` and selector/method lookup)
  - Test: `test/unit/language/named-type-methods.test.js`: `type In struct{ M int }; type A struct{ In }; type B struct{}; func (B) M() string { return "m" }; type C struct{ A; B }; fmt.Println(C{}.M())` → `m`; `f := c.M; f()` → `m`; field at depth 1 over method at depth 2 prints `0`; two depth-1 candidates still `ambiguous selector`
  - Done when: the positives type-check on every target (`compile(…).errors` empty) and the ambiguity negatives keep their message
- [x] Task 5.2: Call the winning promoted method through the JS class (`K01` JS)
  - Files: `src/lower/embedding.js` (`computeEmbeddedStubs`), `src/backend/js/index.js` (class emission, if needed)
  - Test: `test/unit/language/named-type-methods.test.js`: Task 5.1 program plus `type I interface{ M() string }; var i I = C{}; fmt.Println(i.M(), C{}.M())` → `m m`; explicit path `C{}.A.In.M` → `0`
  - Done when: `assertAllTargetsOutput` passes for every Task 5.1/5.2 program
- [x] Task 5.3: Convert untyped constants appended to complex slices (`K05`)
  - Files: `src/typechecker/expressions.js` (`BUILTIN_CHECK.append`), `docs/go-compatibility.md` ("Complex constants" row)
  - Test: `test/unit/types/complex.test.js`: `append(c, 7)` → `[(7+0i)]`; `append(c, 7.5, 2)`; `[]complex64` `append(c, 1+0.01i)` with `imag(c[0]) == 0.01` → `true`; named `type Zs []complex128`; spread `append(b, a...)` and `append(c, 3i)` unchanged
  - Done when: `assertAllTargetsOutput` passes and the docs row no longer lists `append` as an exception (it says what differs from Go after this task, or the row is removed if nothing does)
- [x] Task 5.4: Box range assignments into interface-typed variables in JS (`K07`)
  - Files: `src/typechecker/statements.js` (mark the range assignment's boxing), `src/backend/js/statements.js` (`_emitRangeVar`)
  - Test: `test/unit/language/range-assign.test.js`: `for _, s = range []N{3, 4} {}` into `fmt.Stringer` → `N4`; map value → `N3`; map key (`range map[N]bool{5: true}`) → `N5`; `type S string` → `Sb`; into `any` with `_, ok := s.(N)` → `true`; struct/pointer elements and `for _, v := range … { s = v }` unchanged
  - Done when: `assertAllTargetsOutput` passes

### Phase 6: WASM Dynamic Types in `any` (second sweep)
- [x] Task 6.1: Keep array identity by Go type in an `any` (`K03` arrays)
  - Files: `src/backend/wasm/emit-exprs.js` (interface boxing), `src/backend/wasm/module-emitter.js` (box selection), `src/backend/wasm/emit-builtins.js` (`any_eq`/`any_hash`/`_dynamicTypeNames`, if needed)
  - Test: `test/unit/types/dynamic-types.test.js`: `[2]int64` asserted as `[2]int` → `false`; `[2]int32` vs `[2]uint8`; `[2]A` (`type A [2]int`) vs `[2][2]int`; type switch `case [2]int … case [2]int64` on a `[2]int64` → `int64`; `map[any]int{[2]int{1,2}: 1}` lookup with a separately built `[2]int{1,2}` → `1` and with `[2]int64{1,2}` → `0` (WASM only)
  - Done when: `assertAllTargetsOutput` passes (the `map[any]` lookup with `[2]int64` is a WASM-only assertion because JS stringifies keys)
- [x] Task 6.2: Tag slices of 64-bit integers per Go type in an `any` (`K03` slices)
  - Files: `src/backend/wasm/types.js` (`TAGGED_SLICE_ELEMS`), `src/backend/wasm/module-emitter.js` (tag registration, if needed)
  - Test: `test/unit/types/dynamic-types.test.js`: `[]int64{1}` in an `any` asserted as `[]int` → `false`, as `[]uint64` → `false`; `[]uint` vs `[]uint64`; `[]int{1}` asserted as `[]int` → `true`; `[]float32` vs `[]float64` stays `false`; assertion-panic names `[]int64`
  - Done when: `assertAllTargetsOutput` passes and `node test/perf/zero-alloc.js` results are unchanged
- [ ] Task 6.3: Box maps with ambiguous key or value types by Go type in an `any` (`K03` maps)
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/module-emitter.js`, `docs/go-compatibility.md` (`encoding/json` row sentence about maps and arrays that "can encode as one another", only if it no longer matches)
  - Test: `test/unit/types/dynamic-types.test.js`: `map[string]int64` asserted as `map[string]int` → `false`; `map[int]string` vs `map[int64]string`; same-type assertion → `true`; `%T` of each; `encoding/json` of an `any` holding `[2]byte` and `[2]bool` encodes each as itself (if the docs sentence is removed)
  - Done when: `assertAllTargetsOutput` passes and the docs `encoding/json` row contradicts nothing from Tasks 6.1–6.3
- [ ] Task 6.4: Print and name slices that generic code boxes into an `any` (`K04`)
  - Files: per probe at task start: `src/typechecker/assignability.js` (`_markIfaceBox` for types containing a type parameter) and/or `src/backend/wasm/monomorph.js`, `docs/go-compatibility.md` (`fmt` of a value in an `any` row: `%T` of generic slices, like the map sentence)
  - Test: `test/unit/types/dynamic-types.test.js`: `func mk[V any](v V) any { return []V{v} }`: `fmt.Println(mk(3))` → `[3]`, `%T` → `[]int`; `V=string`; `V=func(a int, b ...string) (int, error)` → `%T` `[]func(int, ...string) (int, error)`; `V` a struct; `map[string]V` and non-generic `[]int` unchanged
  - Done when: `assertAllTargetsOutput` passes and the commit body names the root cause

### Phase 7: WASM Untyped Complex Constants
- [ ] Task 7.1: Convert untyped constants stored through a complex pointer in WASM (`K06` stores)
  - Files: `src/backend/wasm/emit-stmts.js` (assignment and compound assignment through `*p`)
  - Test: `test/unit/wasm/complex.test.js`: `p := &c; *p = 9` → `(9+0i)`; `*p += 2`; `**q = 9`; `complex64` `*p = 9`; `*m["a"] = 4` (map of `*complex128`); `p.c = 2` unchanged (`assertWasmProgramOutput` plus `assertValidWasm`; the same programs run on JS via `assertAllTargetsOutput`)
  - Done when: `assertAllTargetsOutput` passes and `assertValidWasm` holds
- [ ] Task 7.2: Compare a complex `switch` tag with constant and complex cases in WASM (`K06` switch)
  - Files: `src/backend/wasm/emit-stmts.js` (`emitSwitchStmt` case comparison)
  - Test: `test/unit/wasm/complex.test.js`: `var c complex128 = 2; switch c { case 2: … }` → hit; `case 2i`, `case 2, 3i`, `complex64` tag with `case 1.5`; default branch; no match
  - Done when: `assertAllTargetsOutput` passes and `assertValidWasm` holds
- [ ] Task 7.3: Convert untyped constants passed to deferred calls with complex parameters in WASM (`K06` defer)
  - Files: `src/backend/wasm/emit.js` (`emitDeferStmt`)
  - Test: `test/unit/wasm/complex.test.js`: `func p(z complex128) { fmt.Println(z) }; defer p(2)` → `(2+0i)`; `defer func(z complex128) { … }(2)`; `defer t.m(2)`; `complex64` parameter with `1.5`
  - Done when: `assertAllTargetsOutput` passes and `assertValidWasm` holds
