# v1.9.1 Review Follow-ups (2026-11-11) — Design Plan

**Version:** v1.9.1  
**Status:** In Progress  
**Base branch:** main  
**Related:** [`follow-ups-2026-11-10-plan.md`](follow-ups-2026-11-10-plan.md) (origin of every ledger entry, PRs #173–#178; execute after `feat/follow-ups-2026-11-10` is merged into main), [`follow-ups-2026-11-09-plan.md`](follow-ups-2026-11-09-plan.md)  
**Release note:** Interfaces that embed `comparable`, structs that satisfy an interface through an embedded pointer, and `complex64` variables set from a named complex constant now compile and run as in Go, and array values in an `any` compare equal (and work as `map[any]` keys in WebAssembly) when their elements are equal. Code that Go rejects is now rejected with a clear error instead of being accepted or misreported (converting an `any` to an interface with methods without a type assertion, ranging an `int` index into an `int32` variable, ambiguous promoted methods, an unparenthesized composite literal in an `if` header), and `switch` on a nil map, `continue` to a stacked label, `%T` of func types and nil pointers behind interfaces now behave as in Go on both JavaScript and WebAssembly.

---

## Goal

Schedule and fix every reproducing entry of `plans/follow-ups.md` (14 entries, all logged during [`follow-ups-2026-11-10-plan.md`](follow-ups-2026-11-10-plan.md) Phase 1–6 reviews) for the v1.9.1 patch release. Entries are numbered `I01`–`I14` in ledger order. Re-probed on `feat/follow-ups-2026-11-10` @ `dbd2d435` (all six phases merged into the epic branch; `main` @ `84452484` does not contain them yet) with `.probes/reprobe.mjs` (`compileFiles` with `forceTarget` `js`, `both`, `wasm` after `evictParseCache`, `WebAssembly.Module` validation, then run through a sink-bundled ESM module like `runProgramModule` in `test/unit/helpers.js:506`).

- **14 entries reproduce**, all scheduled in Phases 1–4. The re-probe widened several: `I07` (ambiguous promotion) is also accepted statically (`var m Mer = C{}` compiles), `I10` also covers `any(a) == any(b)` for equal arrays (`false` on every target), `I11` covers every func-bearing type in an `any` (`[]func()`, `func(int) string`, `[2]func(int) bool`, `map[string][2]func()`), `I13` also covers nested calls (`wrap(check(makePair()))`), `I14` also covers `complex64(k)` and `d = k`.
- **Two ledger "want"s were wrong and are corrected here** (Go semantics, go1.26 spec):
  - `I09`: in Go a string or slice range's index is `int`, so `var i int32; for i = range "abc"` is a type error, not a program that should run. The fix rejects it (the slice form `range []int{…}` is accepted today too). `for i = range 3` (untyped constant) stays valid.
  - `I12`: `if s := &Other{val: 5}; s.val > 0 {` is a Go **syntax error** (spec "Composite literals": a composite literal with a TypeName between `if`/`for`/`switch` and the block must be parenthesized). The parenthesized form `if s := (&Other{val: 5}); …` already works, receiver shadowing included. The defect is that GoFront misparses the unparenthesized form and then reports a misleading type error (`No field 'val' on S`, or `Undefined: 's'` without a receiver).
- **0 entries no longer reproduce; 0 deferred.** One widening is excluded as documented behaviour: JS `map[any]` array keys colliding with strings or same-content structs (`docs/go-compatibility.md:89`, "Map keys").
- No entry is scheduled in another open plan: `follow-ups-2026-11-10` has every task checked; `follow-ups-2026-11-09` is completed.

Grouped by subsystem:

1. Typechecker and parser diagnostics (Phase 1).
2. Method sets and embedded promotion, typechecker plus both backends (Phase 2).
3. Arrays and func types in `any`: equality, WASM map keys, `%T` (Phase 3).
4. Statement and constant codegen: JS `switch`/labels, WASM forwarded args, `complex64` constants, plus docs (Phase 4).

Re-probe each phase's repros on its base commit before starting the phase, and drop any sub-repro that no longer reproduces. Go is not installed in the probe environment, so expected outputs come from Go semantics as stated in the ledger entries (corrected above for `I09`/`I12`). Diagnostics are asserted by a stable substring.

**Done means:**

- Every repro in Phases 1–4 is a passing test in its task's `Test:` file: programs via `assertProgramOutput` (`both` + `wasm`), or `assertAllTargetsOutput` where plain `js` packages must also match; invalid programs via `assertErrorContains` on every target.
- No scheduled repro emits invalid WASM (`assertValidWasm`) or throws a JS `SyntaxError`/`TypeError` (`I04`, `I06`, `I09`, `I14`).
- `npm test`, `npm run check` (including example type-checks) and `npm run test:e2e` pass with zero regressions.
- `docs/go-compatibility.md` row "Runtime panics in `both` packages" (`:99`) no longer claims WASM interface calls report `interface conversion: nil or unmatched type for method call` (stale: a nil interface and a typed-nil `*S` already report the nil-dereference message, and `I08` fixes the last case), and nothing in the doc contradicts the new behaviour (Task 4.5).

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Every reproducing ledger defect across the parser, typechecker, JS and WASM backends | `I01`–`I14` | |
| **In scope: target-specific** | Fix the failing target(s) and pin the working target(s) in the same test | JS-only: `I01`, `I04`, `I06`. WASM-only: `I08`, `I10` map keys, `I13`, `I14` invalid module. All targets: `I02`, `I03`, `I05`, `I07`, `I09`, `I10` `==`, `I11`, `I12`, `I14` precision (JS) | |
| **Excluded: runtime / platform** | Documented JS map-key stringification stays | `m[[2]int{1,2}]` and `m["1,2"]` share a key in a `js`/`both` `map[any]`; `m[P{1,2}]` and `m[[1]P{{1,2}}]` too | Documented in `docs/go-compatibility.md:89` ("JS objects only have string keys"). Changing the JS map representation is a design change, not a patch fix. |
| **Excluded: runtime / platform** | Documented JS `any` semantics stay as documented | Sized numbers in an `any` (`:103`), `fmt` of types the calling package never mentions (`:101`) | No runtime type descriptors (roadmap guiding principle). |
| **Excluded: deferred** | Rejecting other unparenthesized composite literals in statement headers | `if o == Other{1} {` and `for … ; x != T{} ; {` are accepted today (invalid Go) | `I12` only replaces a misleading error with the right one where GoFront already fails. Rejecting forms that compile today breaks existing user code and needs its own decision. |

---

## Verified Gaps & Baseline Audit

### Review follow-ups (2026-11-11)

All 14 ledger entries re-probed on `feat/follow-ups-2026-11-10` @ `dbd2d435` with `.probes/cases.mjs` (ledger repros) plus `.probes/wide*.mjs` (widenings) on the `.probes/reprobe.mjs` harness. Columns js / both / wasm, observed → wanted. Shared prelude `M`: `type Mer interface{ M() }; type Inner struct{}; func (i *Inner) M() { fmt.Println("inner") }; type PO struct{ *Inner }`.

| Area | Finding | Evidence & probe |
|---|---|---|
| JS `switch` on map | `I01` A nil map tag does not match `case nil` | `var m map[string]int; switch m { case nil: fmt.Println("m nil") }` → js/both ``, wasm `m nil`; want `m nil`. Emitted JS: `let m = __nm(); switch (m) { case null: … }`: a nil map in JS is the `__nm()` sentinel (`src/backend/js/expressions.js:3121`), so `case null` never matches. `genSwitch` (`src/backend/js/statements.js:2145`) wraps only struct/array/interface tags; `m == nil` already goes through `_genNilMapCompare` (`expressions.js:3403`). Non-nil map tag with `case nil` → `default` (correct). Slice/pointer/func/error tags with `case nil` correct. (feat/follow-ups-2026-11-10-phase-1) |
| Typechecker constraints | `I02` Embedding `comparable` in an interface is rejected | `type NM interface{ ~int; comparable }; func h[T NM](x T) T` + `h(3)` → all `cannot embed non-interface type comparable`; want `3`. Also `interface{ comparable; ~int \| ~string }` and `interface{ comparable; M() }` with `a == b` in the body. Cause: `_resolveInterfaceType` (`src/typechecker/resolve.js:602`) resolves the embed to the basic `COMPARABLE` (`resolve.js:224`), which is not an interface, and errors at `:632`. Constraint satisfaction of `comparable` exists only as a bare constraint (`resolve.js:960`). (feat/follow-ups-2026-11-10-phase-1) |
| Typechecker conversions | `I03` `I(a)` with `a any` and `I` non-empty compiles without a type assertion | `type I interface{ M() }; var a any; _ = I(a)` → all compile and run; want `cannot convert a (variable of type any) to type I: need type assertion`. Cause: `_checkIfaceConversion` (`src/typechecker/assignability.js:485`) only fires for `_isConcreteTarget`; the assignment form uses `_isMethodIfaceTarget` too (`:472`, 11-10 Task 1.3). `var e error; I(e)` is already rejected (`error does not implement I`); `I(a.(I))` compiles (correct). (#174) |
| JS stacked labels | `I04` `continue L1` to the outer of two stacked labels on a range-over-func loop emits invalid JS | `func seq(y func(int) bool) { y(1) }; L1: L2: for x := range seq { _ = x; continue L1 }` → js/both `SyntaxError: Illegal continue statement: 'L1' does not denote an iteration statement`, wasm `done`; want `done`. Emitted: `L1: L2: { … seq(function(x){ __target0 = "continue$L1"; return false; }); … if (__target0 === "continue$L1") continue L1; }`. Cause: the `LabeledStmt` case (`statements.js:416`) sets `body.label` to the innermost label only, so `_genIteratorBranchStmt` (`:1255`, `_currentIterLoopLabel`) does not recognise `L1` as the loop's own label and routes it through `_emitIterTargetDispatch`. Non-iterator stacked labels (`L1: L2: for x := range 2`) correct. (#174) |
| Typechecker method sets | `I05` A struct value embedding `*Inner` does not get `*Inner`'s pointer methods | `M` + `var w Mer = PO{&Inner{}}` → all `PO does not implement Mer`; also `use(PO{&Inner{}})` param form; want `inner`. Cause: `_promoteEmbeddedInto` (`src/typechecker/index.js:818`) copies `mType` (with `_ptrRecv: true`) into `PO`'s methods regardless of the embed being a pointer, and `implements` (`assignability.js:841`) rejects `_ptrRecv` for non-pointer sources. Go: promoted methods of an embedded `*T` are in the value method set. (feat/follow-ups-2026-11-10-phase-3) |
| JS promoted method sets | `I06` A pointer method promoted through an embedded pointer two levels down is excluded from the outer value's method set | `M` + `type PO2 struct{ PO }; var v any = PO2{PO{&Inner{}}}; m, ok := v.(Mer); fmt.Println(ok); m.M()` → js `false` + `TypeError … (reading 'M')`, both `false` + nil-deref panic, wasm `true\ninner`; want `true\ninner`. `&PO2{…}` correct on all. Also `v.(interface{ M() })` → js/both `false`. Cause: `_genValueMethodMeta` (`src/backend/js/index.js:1052`) adds `__pm` entries from `computeEmbeddedStubs` (`src/lower/embedding.js:19`) `ptrOnly`, computed per embed level by `isPtrOnlyPromotion` without carrying "an embed on the path is a pointer". (feat/follow-ups-2026-11-10-phase-3) |
| Ambiguous promoted methods | `I07` A method declared by two embedded types at the same depth stays in the method set | `type A struct{}; func (A) M() {}; type B struct{}; func (B) M() {}; type C struct{ A; B }; var v any = C{}; _, ok := v.(Mer)` → all `true`; want `false`. Same for `&C{}`. Widened: `var m Mer = C{}` compiles; want `C does not implement Mer (missing method M)`. Cause: first-wins at every level: `_promoteEmbeddedInto` (`index.js:836`, `if (!struct.methods.has(mName))`), `computeEmbeddedStubs` (`embedding.js:51`, `declared` set), WASM `_findPromotedMethod` (`src/backend/wasm/module-emitter.js:1490`, returns the first hit in a BFS level). (#175) |
| WASM typed-nil outer pointer | `I08` An interface call on a nil `*PO` whose embedded `*Inner` declares the method panics with the wrong message | `M` + `var v any = (*PO)(nil); v.(Mer).M()` with `recover` → js/both `runtime error: invalid memory address or nil pointer dereference`, wasm `interface conversion: nil or unmatched type for method call`; want the nil-dereference message. A typed-nil `*S` with a value method and a nil `Mer` already report the nil-dereference message on wasm. Cause: `_emitNilPtrCandidate` (`src/backend/wasm/emit.js:1483`) returns early when `cand.testTypeIndex !== cand.structInfo.typeIndex`, which holds for promoted candidates, so the nil marker falls through to `emitMiss` (`:1477`). (#175) |
| Typechecker range assignment | `I09` An `int` range index is assignable to an `int32` variable; on WASM the string form then builds an invalid module | `var i int32; for i = range "abc" { _ = i }` → js/both `2`, wasm invalid (`local.set[0] expected type i32, found i64.extend_i32_s`); `for i = range []int{1,2}` → all `1`. Want (Go) `Cannot assign int to int32` on every target. `for i = range 3` → `2` (correct, untyped constant); `var r int64; for _, r = range "ab"` → `Cannot assign int32 to int64` (value already checked). Cause: `_checkAssignStmt` (`src/typechecker/statements.js:264`) checks the range value type but not the index type for string/slice/array ranges. Ledger "want it to compile and run" corrected. (#175) |
| WASM arrays in `any` | `I10` Array keys in `map[any]` are not found again; `==` of equal arrays in `any` is false everywhere | `m := map[any]int{}; m[[2]int{1, 2}] = 1; fmt.Println(len(m), m[[2]int{1, 2}])` → js/both `1 1`, wasm `1 0`; want `1 1`. `[2]string` key and `[1]int` key → wasm `0` lookups. Struct key `P{1,2}` → wasm correct. Widened: `var k, k2 any = [2]int{1,2}, [2]int{1,2}; k == k2` → **all** `false`; want `true` (also `[1]P` elements; struct `P` → `true`, correct). Causes: JS `__ifeq` (`src/backend/js/runtime.js:851`) compares only boxed named basics and `__v` struct boxes; arrays tagged by `__ity(…, "[2]int")` fall to `return false`. WASM `any_eq` / `any_hash` intrinsic bodies (`src/backend/wasm/emit-builtins.js:1663`, `:1806`) have no element-wise arm for `mod.arrayTypes` boxes. (feat/follow-ups-2026-11-10-phase-4) |
| `%T` of func types in `any` | `I11` `%T` of a func-bearing type stored in an `any` prints nothing | `var f [2]func(); var w any = f; fmt.Printf("%T\n", w)` → all ``; want `[2]func()`. Widened: `[]func()` → all `` (want `[]func()`); nil `func(int) string` → js/both `<nil>`, wasm `` (want `func(int) string`); `[2]func(int) bool` → all ``; `map[string][2]func()` → all ``. `%T` of `[2]func()` passed directly prints `[2]func()` (correct); `[2]int` in `any` correct. Causes: JS tags func types with a ` void` result suffix (`__ity(s, "[]func() void")`, also stripped ad hoc in `__ik`, `runtime.js:777`), which the generated `%T` formatter does not map; WASM `_dynamicTypeNames` (`emit-builtins.js:1534`) lists slices, maps, structs, iface boxes, tagged slices and nil boxes but no closure or func-element array types. (feat/follow-ups-2026-11-10-phase-4) |
| Parser `if` header | `I12` An unparenthesized composite literal in an `if` header is misparsed and reported as a misleading type error | `type Other struct{ val int }; func (s *S) M() int { if s := &Other{val: 5}; s.val > 0 { return s.val }; return 0 }` → all `No field 'val' on S`; same without a receiver → `Undefined: 's'`; `Other{val: 5}` (no `&`) → same. Go: syntax error (composite literal must be parenthesized). `if s := (&Other{val: 5}); s.val > 0` → `5` on all (correct, receiver shadowing works); `switch o := Other{1}; o.val {` → `Parse error … Expected case or default` (already an error). Ledger "want it to compile" corrected. (#176) |
| WASM forwarded call args | `I13` A multi-value call forwarded into interface parameters inside a larger expression boxes a struct as a pointer | `type T struct{ A int }; func makePair() (T, int); func check(v any, n int) bool { _, ok := v.(T); … }; if check(makePair()) {…}` → js/both `ok`, wasm `fail`; want `ok`. Also `var g = check(makePair())` (package level) and `wrap(check(makePair()))` → wasm `false`; `x := check(makePair())` → `true` (split). Cause: `splitForwardedTuples` (`src/lower/functions.js:321`) splits only statement operands (by design, to keep evaluation order); the WASM call path for a remaining `_multiForward` call (`src/backend/wasm/emit-builtins.js:1326`, `_emitStaticCall`: "g's results are f's arguments as they come") ignores the per-element marks in `call._fwdIface` that the typechecker recorded (11-10 Task 5.1). JS spreads and boxes per parameter (correct). (#177) |
| Named complex constant into `complex64` | `I14` A named untyped complex constant assigned to `complex64` builds an invalid WASM module and keeps float64 components on JS | `const k = 1 + 0.01i; var c complex64 = k; fmt.Println(imag(c) == 0.01)` → js/both `false`, wasm invalid (`local.tee[0] expected type (ref null …), found global.get`); want `true`. Also `complex64(k)`, `d = k`, `const k = 2i` → wasm invalid. Literal `var c complex64 = 1 + 0.01i` → `true` (11-10 Task 6.2). Causes: JS `_genComplex64Const` (`src/backend/js/expressions.js:834`) returns null when `complexConstParts` cannot fold an `Ident`, so the `_c64Const` tag (`assignability.js:290`) is ignored; WASM emits the constant's complex128 global and stores it into a complex64 local without conversion. (feat/follow-ups-2026-11-10-phase-6) |

---

## Approach

### 1. Architecture & Design Decisions

- **Typechecker and parser first (Phase 1).** `I09`'s invalid WASM disappears once the program is rejected; no backend change.
- **`I02` (Task 1.1):** `_resolveInterfaceType` accepts an embedded `COMPARABLE` (bare `comparable` or a named constraint that embeds it): it sets `result._comparable = true` instead of erroring, and `_checkInterfaceConstraint` / `checkConstraint` (`resolve.js:945`–`968`) require comparability (via `_isComparable(typeArg)`) when the constraint interface has `_comparable`. In `_reportConstraintUse` (`resolve.js:375`–`391`), check `u === COMPARABLE || (u?.kind === "interface" && u._comparable)` so an interface embedding `comparable` continues to report `cannot use type ... outside a type constraint: interface is (or embeds) comparable` when used as an ordinary value type.
- **`I03` (Task 1.2):** `_checkIfaceConversion` fires for `_isConcreteTarget(t) || _isMethodIfaceTarget(t)`, the same rule as `_checkIfaceToConcrete`. Message unchanged (`… to type I: need type assertion`).
- **`I09` (Task 1.3):** in the range-assignment path, check the index (first LHS) for string, slice, array and pointer-to-array ranges. Because GoFront's `_isNumericCoercible` permits `int:int32` coercion during general assignment, range index assignment must strictly require `int` per Go spec (e.g. check `typeStr(lhsType) === "int"`, else report `Cannot assign int to ${typeStr(lhsType)}`). Map keys and range-over-int/func keep their current element types.
- **`I12` (Task 1.4):** in the `if`/`switch`/`for` header parser (no-composite-literal mode), when a primary that is a type name (or `&TypeName`) is directly followed by `{` and the brace contents look like a composite literal element list followed by `;` (header continues), report `composite literal in if header must be parenthesized` (keyword substituted) at the `{`. A speculative scan with `this.pos` restore, as 11-10 Task 2.3 did for call arguments. Only the forms that fail today are turned into this error (see Excluded: deferred).
- **Method sets (Phase 2).** One rule, applied in three places that currently each do first-wins promotion:
  - Typechecker (Tasks 2.1–2.2): `_promoteEmbeddedInto` records, per promoted method, its depth and whether any embed on its path is a pointer. A method promoted through a pointer embed is copied with `_ptrRecv: false` (value method set). Two candidates at the same minimal depth from different embeds become an **ambiguous** tombstone (`{ _ambiguous: true }`): `implements` treats it as missing, and selector lookup `c.M()` reports `ambiguous selector c.M`. A method declared on the struct itself or at a shallower depth wins. The fixed-point loop in `_promoteEmbeddedMethods` must reach the same result regardless of declaration order, so depth is computed from the embed graph, not from loop iteration.
  - JS (Task 2.3): `computeEmbeddedStubs` carries `viaPointer` down the embed path (so `PO2 → PO → *Inner` is not `ptrOnly`) and skips ambiguous names (no stub, so `typeof v.M === "function"` is false and `_ifaceMethodCheck` fails, as in Go).
  - WASM (Task 2.4): `_findPromotedMethod` scans the whole BFS level and returns null when ≥2 embeds at that level provide the method. `_emitNilPtrCandidate` also handles promoted candidates: for a typed-nil outer pointer it panics with the nil-dereference message before walking `embedPath`.
- **`I10` (Tasks 3.1–3.2):** array values in an `any` compare element-wise when their dynamic types match. JS: `__ifeq` gets an arm for two arrays with the same `__t` tag → `__equal`. WASM: `any_eq` gets an arm per `mod.arrayTypes` box (same `ref.test` type → element loop through the existing element-equality emitter), and `any_hash` hashes array boxes by combining element hashes (consistent with `any_eq`, so lookups find the inserted key). JS map-key stringification is not changed (Excluded).
- **`I11` (Task 3.3):** one canonical Go type name per func type, `func(int) string` / `func()` (no ` void` suffix), produced by `goTypeName` (`src/backend/shared/fmt-types.js:39`), used for the JS `__ity` tag and by the `%T` formatter. Remove the ad hoc `/ void$/` strip in `__ik` once no tag carries it. WASM: `_dynamicTypeNames` adds closure types and array boxes whose element is a func type. A nil func value in an `any` on JS keeps its tag (`__ity(null, "func(int) string")`) only if `__ity` already preserves typed nils for slices (`__unnil`); if it does not, a JS nil func in `any` printing `<nil>` is the documented `:101` limitation and stays as is (decide by probe at the start of the task; record the outcome in the commit body).
- **`I01` (Task 4.1):** `genSwitch` routes a map-typed tag the same way `_genNilMapCompare` handles `m == nil`: emit `switch (true)` with `case __isnm(tag):` for `case nil` (helper from `runtime.js:711` / `718`) and identity for other values (only `nil` is a valid case value for a map tag besides other map-typed expressions, which Go rejects).
- **`I04` (Task 4.2):** the `LabeledStmt` case records all stacked labels on the loop (`body.labels = labels`), and `_genIteratorBranchStmt` / `_emitIterTargetDispatch` treat any of them as the loop's own label. The innermost label stays `body.label` for existing callers.
- **`I13` (Task 4.3):** the WASM call emitter, for a `_multiForward` call whose `_fwdIface` survives (not split), stores the tuple into temps and boxes each element through the existing per-value interface-box path using that element's holder marks, then pushes the arguments. Evaluation order is unchanged (the callee expression has no call, as checked by the lowering pass; otherwise `f()` is evaluated in place exactly once). Rejected: extending `splitForwardedTuples` to expressions (would need statement hoisting with order-preserving temps for every operand evaluated before the call).
- **`I14` (Task 4.4):** JS `complexConstParts` resolves a constant `Ident`/`SelectorExpr` through its folded `_const` value, so `_genComplex64Const` emits `{ re: fround(re), im: fround(im) }`. WASM: an untyped complex constant whose target type is `complex64` is emitted from its folded value as a complex64 struct (same as the literal path), never via the complex128 constant global.

### 2. Invariants & Safety Bounds

- No new runtime type descriptors; new tags and names are compile-time strings.
- Method-set changes must not change dispatch for unambiguous programs: existing embedding tests (`test/unit/language/named-type-methods.test.js`, `test/unit/wasm/mixins.test.js`, `test/unit/wasm/interfaces.test.js`, `test/unit/wasm/iface-assert.test.js`) keep passing unchanged.
- `any_hash` and `any_eq` stay consistent: equal values hash equal (Task 3.2 test inserts and looks up with separately built arrays).
- Examples keep type-checking (`npm run check`). If Task 1.3, 1.4 or 2.2 flags example code, fix the example in the same task and say so in the commit body.
- No change to `test/perf/zero-alloc.js` results: none of the tasks touch hot loop codegen.

### 3. Edge Cases & Error Handling

- Task 1.1: `comparable` as a plain variable type stays rejected (`cannot use type comparable outside a type constraint`); `h([]int{})` against `interface{ comparable; … }` → `[]int does not satisfy` (comparability enforced).
- Task 1.2: `I(x)` with `x` a concrete type implementing `I`, `I(nil)`, `any(a)` and `error(e)` with `e` another interface still compile.
- Task 1.3: `for i = range m` (map key type), `for i = range 3`, `for i := range "abc"` (declared `int`) and `var i int; for i = range s` stay valid; `type MyInt int; var i MyInt; for i = range s` → error (Go: `int` not assignable to `MyInt`).
- Task 1.4: `if x := f(); x {`, `if (T{}) == t {`, `if s := (&T{}); …`, `for _, v := range []T{{1}} {` and `switch x := T{}.f; x {` (selector after the literal is not this form, check by probe) keep their current behaviour.
- Tasks 2.1–2.2: a field and a method with the same name at the same depth, and a shallower method shadowing two deeper ones (`type D struct{ C; }` with `func (D) M()`), resolve as in Go. Interfaces embedded in structs (`struct{ io.Reader }`) promote their methods as before.
- Task 2.4: a typed-nil outer pointer whose promoted method is reached through a **value** embed (`type PV struct{ Inner }`, `(*PV)(nil)`) also panics with the nil-dereference message.
- Task 3.1: arrays of different types with equal elements (`[2]int` vs `[2]int32`) compare `false`; an array containing a func type is not comparable (already a compile error).
- Task 4.1: a `switch m { case nil: … default: … }` on a non-nil empty map (`map[string]int{}`) takes `default`; `switch` on a defined map type behaves the same.
- Task 4.2: `break L1` and `continue L2` on the stacked labels both work; nested iterator loops with stacked outer labels still propagate through `_emitIterTargetDispatch`.
- Task 4.3: the forwarded call still evaluates `f()` once and before evaluating the remaining operands of the enclosing expression (`check(makePair()) && sideEffect()`).
- Task 4.4: `complex128` targets and exact float32 components (`const k = 1 + 0.5i`) emit unchanged values.

---

## Implementation Tasks

Scheduled from review follow-ups (`plans/follow-ups.md` sweep 2026-11-11, `I01`–`I14`). Each task's `Test:` asserts the repro from `Verified Gaps`.

### Phase 1: Typechecker and Parser Diagnostics
- [x] Task 1.1: Allow `comparable` as an embedded constraint element (`I02`)
  - Files: `src/typechecker/resolve.js`
  - Test: `test/unit/types/generics.test.js`: `interface{ ~int; comparable }` with `h(3)` prints `3` (`assertProgramOutput`); `interface{ comparable; M() }` with `a == b` prints `true`; negative `h([]int{})` against `interface{ comparable; ~[]int }` → `assertErrorContains(…, "does not satisfy")`; `var x interface{ comparable }` → `outside a type constraint`
  - Done when: the three positive programs run on `both` + `wasm` and both negatives report on every target (and `_reportConstraintUse` flags embedded `_comparable` interfaces as value types)
- [x] Task 1.2: Require a type assertion for `I(a)` with `a any` and `I` non-empty (`I03`)
  - Files: `src/typechecker/assignability.js`
  - Test: `test/unit/types/any-assertion.test.js`: `var a any; _ = I(a)` → `assertErrorContains(…, "need type assertion")` on every target; `I(a.(I))`, `I(T{})`, `I(nil)` still compile
  - Done when: the negative fails on `js`, `both`, `wasm` and the positives print as Go
- [x] Task 1.3: Check the range index type in range assignments (`I09`)
  - Files: `src/typechecker/statements.js`
  - Test: `test/unit/language/range-assign.test.js`: `var i int32; for i = range "abc"` and `for i = range []int{1,2}` → `assertErrorContains(…, "Cannot assign int to int32")`; `var i int32; for i = range 3` prints `2`; `var i int; for i = range "abc"` prints `2`
  - Done when: both negatives report on every target (no invalid WASM reaches the backend; index type checked strictly without `_isNumericCoercible` exception) and the positives pass `assertProgramOutput`
- [x] Task 1.4: Report unparenthesized composite literals in `if`/`switch`/`for` headers (`I12`)
  - Files: `src/parser/statements.js` (header parsing), `src/parser/expressions.js` (speculative scan helper, if needed)
  - Test: `test/unit/language/control-flow.test.js`: `if s := &Other{val: 5}; s.val > 0 {` with and without a receiver, and `Other{val: 5}` without `&` → `assertErrorContains(…, "must be parenthesized")`; `if s := (&Other{val: 5}); s.val > 0` inside `func (s *S) M()` prints `5`
  - Done when: the misleading `No field 'val' on S` / `Undefined: 's'` no longer appear for these programs and the edge cases in Approach §3 keep their current behaviour

### Phase 2: Method Sets and Embedded Promotion
- [x] Task 2.1: Put methods promoted through an embedded pointer in the value method set (`I05`)
  - Files: `src/typechecker/index.js` (`_promoteEmbeddedInto`), `src/typechecker/assignability.js` (`implements`, if needed)
  - Test: `test/unit/language/named-type-methods.test.js`: `M` + `var w Mer = PO{&Inner{}}; w.M()` and `use(PO{&Inner{}})` print `inner` (`assertProgramOutput`); `type PV struct{ Inner }; var w Mer = PV{}` → `does not implement` (value embed, pointer method)
  - Done when: positives run on `both` + `wasm`, negative reports on every target
- [x] Task 2.2: Drop ambiguous promoted methods at the same depth (`I07`, typechecker)
  - Files: `src/typechecker/index.js`, `src/typechecker/expressions.js` (selector `ambiguous selector` error)
  - Test: `test/unit/language/named-type-methods.test.js`: `type C struct{ A; B }; var m Mer = C{}` → `assertErrorContains(…, "does not implement")`; `C{}.M()` → `ambiguous selector`; `type D struct{ C }; func (D) M() {}` with `var m Mer = D{}` compiles
  - Done when: negatives report on every target and the shadowing case runs
- [x] Task 2.3: Carry pointer embeds and ambiguity through JS embedded stubs (`I06`, `I07` JS)
  - Files: `src/lower/embedding.js`, `src/backend/js/index.js` (`_genValueMethodMeta`)
  - Test: `test/unit/language/named-type-methods.test.js`: `M` + `PO2{PO{&Inner{}}}` in `any`, `v.(Mer)` prints `true\ninner` (`assertAllTargetsOutput`); `var v any = C{}; _, ok := v.(Mer)` and `&C{}` print `false`
  - Done when: `js`, `both` and `wasm` print the Go output for these programs (wasm `C{}` part depends on Task 2.4; assert JS here with `assertJsTargetsOutput` and switch to `assertAllTargetsOutput` in Task 2.4)
- [x] Task 2.4: Ambiguity and typed-nil outer pointers in WASM interface dispatch (`I07` WASM, `I08`)
  - Files: `src/backend/wasm/module-emitter.js` (`_findPromotedMethod`), `src/backend/wasm/emit.js` (`_emitNilPtrCandidate`)
  - Test: `test/unit/wasm/interfaces.test.js`: `var v any = C{}; _, ok := v.(Mer)` → `false` on all targets; `M` + `var v any = (*PO)(nil); v.(Mer).M()` with `recover` prints `runtime error: invalid memory address or nil pointer dereference`; same for `(*PV)(nil)` with a value embed
  - Done when: `assertAllTargetsOutput` passes for all three programs, including the Task 2.3 `C{}` program

### Phase 3: Arrays and Func Types in `any`
- [x] Task 3.1: Compare array values in an `any` element-wise (`I10` `==`)
  - Files: `src/backend/js/runtime.js` (`__ifeq`), `src/backend/wasm/emit-builtins.js` (`any_eq`)
  - Test: `test/unit/types/dynamic-types.test.js`: `var k, k2 any = [2]int{1,2}, [2]int{1,2}; fmt.Println(k == k2)` → `true`; `[1]P{{1,2}}` pair → `true`; `[2]int{1,2}` vs `[2]int{1,3}` → `false`; `[2]int` vs `[2]int32` with equal elements → `false`
  - Done when: `assertAllTargetsOutput` passes
- [x] Task 3.2: Hash array keys of `map[any]` element-wise on WASM (`I10` map keys)
  - Files: `src/backend/wasm/emit-builtins.js` (`any_hash`)
  - Test: `test/unit/wasm/map-keys.test.js`: `m := map[any]int{}; m[[2]int{1, 2}] = 1; fmt.Println(len(m), m[[2]int{1, 2}])` → `1 1`; `[2]string{"a","b"}` key and `[1]int{5}` key with `m[5]` → `3 2 3` pattern from `X10b` (separate map)
  - Done when: `assertProgramOutput` passes (`both` + `wasm`); JS-only collisions with strings are not asserted (Excluded)
- [x] Task 3.3: Name func-bearing types for `%T` in an `any` (`I11`)
  - Files: `src/backend/shared/fmt-types.js`, `src/backend/js/expressions.js` (`__ity` tag text), `src/backend/wasm/emit-builtins.js` (`_dynamicTypeNames`)
  - Test: `test/unit/builtins/fmt-verbs.test.js`: `%T` of `[2]func()`, `[]func()`, `[2]func(int) bool`, `map[string][2]func()` in an `any` → Go names; nil `func(int) string` in `any` → `func(int) string` on wasm (JS per probe outcome, see Approach)
  - Done when: `assertAllTargetsOutput` passes for the four composite types and `__ik`'s ` void` strip is gone or still required (commit body says which)

### Phase 4: Statement and Constant Codegen, Docs
- [x] Task 4.1: Match `case nil` against a nil map tag in JS `switch` (`I01`)
  - Files: `src/backend/js/statements.js` (`genSwitch` / `_switchTagAndCases`)
  - Test: `test/unit/types/switch-cases.test.js`: `var m map[string]int; switch m { case nil: fmt.Println("m nil") }` → `m nil`; `m := map[string]int{}` with `default` → `non-nil`; defined map type `type MM map[string]int` → `m nil`
  - Done when: `assertAllTargetsOutput` passes (using helper `__isnm`)
- [x] Task 4.2: Treat every stacked label as the range-over-func loop's own label in JS (`I04`)
  - Files: `src/backend/js/statements.js` (`LabeledStmt` case, `_genIteratorBranchStmt`, `_emitIterTargetDispatch`)
  - Test: `test/unit/language/range-func.test.js`: `L1: L2: for x := range seq { _ = x; continue L1 }` → `done`; `break L1` with a seq that honours `yield`'s result → `1\ndone`; `continue L2` → same as `continue L1`
  - Done when: `assertAllTargetsOutput` passes and no JS `SyntaxError`
- [ ] Task 4.3: Box forwarded tuple elements into interface parameters in nested WASM calls (`I13`)
  - Files: `src/backend/wasm/emit-builtins.js` (`_emitStaticCall`, `_multiForward` branch at `:1326`; also the method-call path in `src/backend/wasm/method-expr.js:351` if a probe shows `O{}.check(makePair())` nested)
  - Test: `test/unit/types/dynamic-types.test.js` (next to the 11-10 Phase 5 `makePair` tests): `if check(makePair())`, `var g = check(makePair())` and `wrap(check(makePair()))` → `ok` / `true true`; `check(makePair()) && side()` evaluates `makePair` before `side`
  - Done when: `assertProgramOutput` passes on `both` + `wasm`
- [ ] Task 4.4: Emit named untyped complex constants into `complex64` with float32 components (`I14`)
  - Files: `src/backend/js/expressions.js` (`complexConstParts` / `_genComplex64Const`), `src/backend/wasm/emit-exprs.js` (complex constant / `ImagLit` emission, `:269`, `:1513`)
  - Test: `test/unit/types/complex.test.js`: `const k = 1 + 0.01i; var c complex64 = k; imag(c) == 0.01` → `true`; `complex64(k)`, `d = k` → `true`; `const k2 = 2i; var c complex64 = k2; fmt.Println(c)` → `(0+2i)`
  - Done when: `assertAllTargetsOutput` passes and `assertValidWasm` holds for every program
- [ ] Task 4.5: Align `docs/go-compatibility.md` with the fixed behaviour
  - Files: `docs/go-compatibility.md`
  - Test: none (docs only; no doc-consistency test exists). Check: `grep -n 'nil or unmatched type for method call' docs/go-compatibility.md` returns no match; the dev-loop reviewer checks the rest per `AGENTS.md` **Docs**
  - Done when: the "Runtime panics" row (`:99`) no longer says WASM interface calls report `interface conversion: nil or unmatched type for method call` (all nil-receiver cases now report the nil-dereference message; a call on a nil interface value reports it too), and no row contradicts Phases 1–4 (`comparable` embeds, `%T` of func types, array equality in `any`)
