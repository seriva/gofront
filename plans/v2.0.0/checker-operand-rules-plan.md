# Checker: Operand Rules by Spec Section — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Schedules the `unrouted` checker follow-ups recorded while executing [`checker-go-rules-plan.md`](checker-go-rules-plan.md) Phases 1–3 (PRs #234–#236, ledger on `feat/checker-go-rules`), re-probed 2026-11-17 on `feat/checker-go-rules` at `236c678` and audited 2026-11-19 at `258d4148` (Phases 1–17 & 19 landed). Phases 2–9 start after checker-go-rules merges (Phase 1, the fuzzer, landed early on its epic branch) (it changes `binaryResultType`, `_checkIncDecStmt`, `anyKind` and the type-parameter operator rule this plan builds on; its Task 9.1 per-term operator rule is the type-parameter half of this plan's Phase 2 table). The two ledger entries already routed to checker-go-rules (*IncDec on constant*, *Condition messages*) stay there. Independent of [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md), [`codegen-fixes-plan.md`](codegen-fixes-plan.md) and [`wasm-struct-types-plan.md`](wasm-struct-types-plan.md).  
**Release note:** **Breaking:** the compiler rejects more programs that Go rejects, so fix each reported line as Go would: ordering (`<`) on booleans, pointers or structs, `&&`/`||`/`!` and `^` on non-boolean or non-integer operands, shifting a float or complex value, constants too large for `float32`, `float64` or `int`, comparing an interface with a non-implementing value or a struct/array with non-comparable fields, non-comparable map keys, assigning `*int` to `*any`, invalid conversions (including slice element mismatches and floats to `string`), methods on interface or pointer types, and `switch` on a value that cannot be compared. Integral complex constants (`1 + 0i`) now work as numbers, `switch { case v: }` with an interface `v` compiles, and comparing an interface with a struct or array value, and `++` on a complex number, now give Go's result.  

---

## Goal

The checker-go-rules reviews kept finding the same shape of gap: a Go rule about which operands an operator, constant, conversion, receiver or `switch` accepts is applied on the paths someone wrote it for and not on the others. Fixing each repro as it is found does not converge: every checker-go-rules phase so far logged about six new ones. This plan scopes the work by Go spec section instead of by repro. It first builds a differential checker fuzzer that walks the spec's operand-kind grid against Go's own type checker (`go/types`), records every current mismatch in a baseline file, and then fixes one spec rule per phase in one shared place, removing that rule's baseline entries. The plan is done when the baseline holds only the classes the *Scope Boundary Matrix* excludes, so siblings nobody has reported are found by the grid rather than by review.

**Done means:**
- `npm run fuzz:check` (full grid, Go installed) reports no mismatch outside `test/fuzz/check-baseline.txt`, and no `# O1`–`# O8` or `# map-key-comparability` tag remains in that baseline (entries owned by independent plans such as `wasm-iface-equality`, `parser-conversion-type`, `builtin-complex-operands`, `W1` or `# excluded:` rows may remain). `node test/unit/run.js cli/checkfuzz.test.js` (generator self-test, no Go needed) passes.
- Every failing row in *Verified Gaps* gives Go 1.26's result on `js`, `both` and `wasm`: the stated error on the stated line (a `test/unit/fixtures/conformance/reject/*.go` case) or Go's output (an `accept/*.go` case or the `assertOutput` test its task names). `node test/unit/run.js types/conformance.test.js` passes with no `// pending:` line added by this plan.
- Each rule has one implementation: operator/operand checks call `operatorDefined` (`src/typechecker/operators.js`); `_checkTypeConversion` and `_checkConversionValidity` both call one `_convertible`; `_caseValueUnchecked` has no `typeParam` early return; comparability uses one `_isComparable` predicate across `checkConstraint`, map keys, `switch` tags and `==`/`!=`.
- `npm test`, `npm run check` and the stdlib build pass; `test/perf/bundle-size.baseline.json` is unchanged.
- `docs/go-compatibility.md` describes the new rejections and the fixed cases.

---

## Scope Rule & Boundary Matrix

**Scope rule:** a defect is in scope when its root is one of the spec rules below (which operand kinds an operator, constant, conversion, method receiver or switch accepts) or the code generation of an operator those rules type, on any target.

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Phase 1 tooling: a checker differential fuzzer over the spec's operand-kind grid, oracle `go/types` | `test/fuzz/checkfuzz.js`, `test/fuzz/gocheck/`, `test/fuzz/check-baseline.txt` | |
| **In scope: core** | Root `operator-kind-table`: one table of the operand kinds each operator is defined on (spec *Arithmetic*, *Comparison*, *Logical*, unary operators), used by binary, logical and unary checks | O1.1–O1.12 | |
| **In scope: core** | Root `cmp-assignability`: a comparison needs one operand assignable to the other's type (spec *Comparison operators*), for every operand kind, with one error per comparison | O2.1–O2.4 | |
| **In scope: core** | Root `shift-operand-type`: the shifted operand of a constant shift must be an integer constant; that of a non-constant shift takes its context's type, which must be an integer (spec *Shifts*) | O3.1–O3.5 | |
| **In scope: core** | Root `const-representability`: constants are tracked by value including complex, and representability covers float, complex, `range` and blank-assignment targets (spec *Constants*, *Representability*) | O4.1–O4.12 | |
| **In scope: core** | Roots `nested-assignability`, `dual-conversion-check`: assignability of pointer/array/slice/map/func types is identity of their element types; one conversion rule for every target form (spec *Assignability*, *Conversions*) | O5.1–O5.8 | |
| **In scope: core** | Root `receiver-base-type`: a receiver's base type is a defined, non-pointer, non-interface type declared in the package (spec *Method declarations*) | O6.1–O6.6 | |
| **In scope: core** | Root `switch-tag-comparison`: the tag must be comparable and each case is a comparison `tag == e` under the Phase 2 rule (spec *Expression switches*) | O7.1–O7.5 | |
| **In scope: core** | Operator codegen of the forms above: JS mixed interface/concrete `==`, complex `++`/`--` on both backends | O8.1–O8.4 | |
| **In scope: core** | Root `type-comparability`: one predicate for whether a type is comparable (spec *Comparison operators*), used by map key types, `==`/`!=` on structs and arrays, and the `wasm` map-key helpers | O9.1–O9.4 | |
| **Excluded: runtime / platform** | Channels, `select`, goroutines in grid cases | `chan int` operands (parse error by design) | **No runtime** principle; the grid omits `chan` kinds |
| **Excluded: runtime / platform** | JS-dynamic `any` (`anyKind === "dynamic"`) stays permissive | `.d.ts` values, browser globals in grid cases | Typed by typed-web-platform Phase 4; the grid uses Go `any` only |
| **Excluded: runtime / platform** | `js` package narrow-integer arithmetic does not wrap | ledger *Non-strict JS int wrap* (`var x uint8 = 255; x++` → `256` on `js`) | Documented behaviour (`docs/go-compatibility.md` *Integer arithmetic*): `js` packages use float64 numbers. Entry deleted from the ledger |
| **Excluded: deferred** | Exact arbitrary-precision complex constants | `1e400 + 0i` components beyond float64 | Complex constants are held as two float64 components (Approach §1); real constants keep their exact form |
| **Excluded: deferred** | JS statement starting with `{` | ledger *JS discarded map literal* (`_ = map[any]int{1: 1}` → `SyntaxError` on js/both) | Root `js-stmt-expr-start` is JS statement emission, not an operand rule; stays `unrouted` in the ledger |
| **Excluded: deferred** | `wasm` type switch on a defined empty interface | ledger *wasm type switch* (`case B:` with `type B interface{}` prints nothing on `wasm`) | Root `wasm-typeswitch-empty-iface` is `wasm` type-switch matching; stays `unrouted` in the ledger |
| **Excluded: deferred** | Error-message wording beyond the messages the rows below state | grid `message` class (`--messages`) | Reported by the fuzzer for information; not a baseline class |

---

## Verified Gaps & Baseline Audit

**Method.** `feat/checker-go-rules` at `236c678` (checker-go-rules Phases 1–3 merged into the epic; `main` lacks them). A throwaway driver (`.probes/cr/`, deleted) wrote 83 programs; each ran through `node test/fuzz/difffuzz.js --replay` (Go 1.26.0 `go run` vs GoFront `js`/`both`/`wasm`), and `go build` gave Go's message and column. "ICE" = `InternalCompilerError`. *sibling* rows were not in the ledger: they were found by probing the root's other paths. Line numbers are as of `236c678`.

### Review follow-ups (2026-11-17)

#### O1 `operator-kind-table`

Root: no table says which operand kinds an operator is defined on. `binaryResultType` (`src/typechecker/assignability.js:114`) dispatches by operand class and each branch re-derives its own rule: `_binaryResultTypeCmp` (`:228`) only rejects ordering on complex (`_checkComplexCmpOp`, `:450`), never on bool/pointer/struct; `_checkLogicalOperands` (`:130`) only compares two typed bools for identity and accepts two untyped numbers or two ints; `_binaryResultTypeNonComplex` (`:149`) reports untyped constant operands as `Invalid operation: untyped string - untyped string`. Unary operators have three more copies (`_checkBoolUnaryOp`, `_checkNumericUnaryOp`, `_checkComplementUnaryOp`, `src/typechecker/expressions.js:372-392`), and `^` on a non-type-parameter operand is unchecked.

| ID | Program | Go | GoFront |
|---|---|---|---|
| O1.1 (ledger *Ordering on bool*) | `b := true; _ = b < true` | `invalid operation: b < true (operator < not defined on bool)` | accepted on all targets |
| O1.2 *sibling* | `var p, q *int; _ = p < q` | `… (operator < not defined on pointer)` | js/both accept; wasm ICE (`lt_s`) |
| O1.3 *sibling* | `_ = P{} < P{}` | `… (operator < not defined on struct)` | js/both accept; wasm ICE |
| O1.4 (ledger *Logical operators*) | `_ = 1 && 2` | `invalid operation: operator && not defined on 1 (untyped int constant)` | accepted on all targets |
| O1.5 *sibling* | `x := 1; _ = x \|\| x` | `operator \|\| not defined on x (variable of type int)` | accepted on all targets |
| O1.6 *sibling* | `_ = nil \|\| true` | `invalid operation: nil \|\| true (mismatched types untyped nil and untyped bool)` | js/both accept; wasm ICE (invalid module) |
| O1.7 *sibling* | `f := 1.5; _ = ^f`; `_ = ^1.5` | `operator ^ not defined on f (variable of type float64)` / `on 1.5 (untyped float constant)` | accepted on all targets |
| O1.8 *sibling* | `b := true; _ = -b`; `s := "a"; _ = +s` | `operator - not defined on b (variable of type bool)` | `- requires numeric` (message only) |
| O1.9 *sibling* | `x := 1; _ = !x`; `_ = !nil` | `operator ! not defined on x (variable of type int)` / `on nil` | `! requires bool` (message only) |
| O1.10 *sibling* | `_ = "a" - "b"`; `_ = true + true` | `operator - not defined on "a" (untyped string constant)` | `Invalid operation: untyped string - untyped string` (message only) |
| O1.11 *sibling* | `c := 1i; _ = c < 2i` | `invalid operation: c < 2i (operator < not defined on complex128)` | `invalid operation: complex128 < untyped complex128` (message only) |
| O1.12 *sibling* | `var v1, v2 any; _ = v1 < v2` … | — | controls: `f % 2`, `f & 1`, `s \| s`, `p + p`, `a + a` (slice), interface `<`, `true && 1` already report Go's message (must stay) |

#### O2 `cmp-assignability`

Root: `_checkCmpOperandTypes` (`assignability.js:335`) applies the "one operand assignable to the other" rule only when both operands are typed basics (`_isTypedBasicOperand`, `:444`); an interface operand returns early, and an untyped constant meeting an interface skips the default-type step (`_convertUntypedConst`, `:394`, returns true for interfaces). `_binaryResultTypeCmp` then also calls `_checkEqualityComparable` after a reported mismatch.

| ID | Program | Go | GoFront |
|---|---|---|---|
| O2.1 (ledger *Interface comparison*) | `type I interface{ M() }; var i I; _ = i == 1` | `invalid operation: i == 1 (mismatched types I and untyped int)` | accepted on all targets |
| O2.2 *sibling* | `var i I; var p P; _ = i == p` (`P` lacks `M`) | `invalid operation: i == p (mismatched types I and P)` | accepted on all targets |
| O2.3 *sibling* | `var e error; _ = e == "x"` | `cannot convert "x" (untyped string constant) to type interface{Error() string}` | accepted on all targets |
| O2.4 (ledger *Comparison errors*) | `var s []int; _ = s == 1` | one error: `invalid operation: s == 1 (mismatched types []int and untyped int)` | that error plus `operator == not defined on []int` |
| control | `var i I; var s S; _ = i == s` (`S []int` with `M`) | `slice can only be compared to nil` | `operator == not defined on S` (rejected; message only, fixed with O2) |

#### O3 `shift-operand-type`

Root (re-audited 2026-11-19 at `258d4148`): `checker-go-rules` Phase 16 already added `_checkShiftedOperand` and `_isShiftableUntyped` (`assignability.js:410-434`), which fixed O3.1 (`1.5 << 1`). What remains: `_binaryResultTypeNonComplex` (`:378`) only dispatches to `_binaryResultTypeShift` when `isNumeric(lt) && isNumeric(rt)` (so `"a" << 1` misses it); `_binaryResultTypeShift` (`:398`) runs `checkShiftCount` before `_checkShiftedOperand` (reporting twice on bad operand + bad count); `_retypeUntypedShift` (`:761`) retypes a non-constant shift's untyped operand only when the target is an integer, silently leaving float, complex and non-integer type-parameter contexts. Note: the two `binary:<<:*,rune` entries currently tagged `# O3` in `check-baseline.txt` (`_ = 1 << 'a'`) are actually blank-assignment `int` overflows (O4.12), not shift-operand bugs.

| ID | Program | Go | GoFront |
|---|---|---|---|
| O3.1 (ledger *Untyped shift operand*) | `_ = 1.5 << 1` | `invalid operation: shifted operand 1.5 (untyped float constant) must be integer` | **already fixed** by `checker-go-rules` Phase 16 (keep as regression control) |
| O3.2 *sibling* | `var s uint = 1; var f float64 = 1 << s` (also `var x T = 1 << s` with `T ~int \| ~float64`) | `shifted operand 1 (type float64) must be integer` | js/both accept; wasm ICE |
| O3.3 (ledger *Untyped shift to complex*) | `var c complex128 = 1i; k := uint(1); c += 1 << k` | `shifted operand 1 (type complex128) must be integer` | js/both print `2`; wasm ICE |
| O3.4 *sibling* | `_ = "a" << 1` | `shifted operand "a" (untyped string constant) must be integer` | `Invalid operation: untyped string << untyped int` (message only) |
| O3.5 (ledger *Shift diagnostics*) | `var f float64 = 1.0; f <<= 1.5` | one error: `shifted operand f (variable of type float64) must be integer` | that error plus `invalid shift count untyped float64 constant: not an integer` |
| control | `x := 1.0 << 2; fmt.Println(x)` | `4` | `4` on all targets (must stay) |

#### O4 `const-representability`

Root: the constant folder has no complex kind (`src/typechecker/const-fold.js` header: `k — "INT" \| "FLOAT" \| "STRING" \| "BOOL"`), so `_convertUntypedConst` (`assignability.js:403-411`) reports every complex constant meeting a real type as an overflow, `UNTYPED_COMPAT` (`:84`) lets `complex128` constants reach only complex types, and `real`/`imag` of a constant are not constant. `_checkConstOverflow` (`src/typechecker/constants.js:364`) checks integer ranges only (`_intRange`), so float and complex targets accept any magnitude.

| ID | Program | Go | GoFront |
|---|---|---|---|
| O4.1 (ledger *Complex constants*) | `var f float64 = 1; _ = f + (1 + 0i)` | ok | `1 + 0i (untyped complex constant) overflows float64` |
| O4.2 *sibling* | `var i int = 1 + 0i; fmt.Println(i)` | `1` | `Cannot assign untyped complex128 to int` |
| O4.3 *sibling* | `const c = 1 + 0i; var n int = 1; fmt.Println(n == c)` | `true` | `c (untyped complex constant) overflows int` |
| O4.4 *sibling* | `const c = 3 + 4i; var a [int(real(c))]int` | `3` | `invalid array length … must be constant` |
| O4.5 *sibling* | `var f float64 = 2i` | `cannot use 2i (untyped complex constant (0 + 2i)) as float64 value in variable declaration (overflows)` | `Cannot assign untyped complex128 to float64` (message only) |
| O4.6 (ledger *float32 constants*) | `var f float32 = 1; _ = f == 1e40` | `1e40 (untyped float constant 1e+40) overflows float32` | accepted on all targets |
| O4.7 *sibling* | `var f float32 = 1e40`; `const k float32 = 1e40` | `cannot use 1e40 (…) as float32 value in variable declaration (overflows)` / `… constant declaration (overflows)` | accepted on all targets |
| O4.8 *sibling* | `_ = float32(1e40)` | `cannot convert 1e40 (untyped float constant 1e+40) to type float32` | accepted on all targets |
| O4.9 *sibling* | `var f float64 = 1e400` | `cannot use 1e400 (…) as float64 value in variable declaration (overflows)` | accepted on all targets |
| O4.10 *sibling* | `var c complex64 = 1e40` | `cannot use 1e40 (…) as complex64 value in variable declaration (overflows)` | accepted on all targets |
| O4.11 (ledger *Range constant overflow*, review 2026-11-19) | `for i := range 1 << 63 { _ = i }` | `cannot use 1 << 63 (untyped int constant 9223372036854775808) as int value in range clause (overflows)` | accepted on all targets (runs without end); root `expressions.js:_checkRangeExpr` and `statements.js:_checkForCond` never call `_checkConstOverflow` |
| O4.12 *sibling* (review 2026-11-19; PR #248 ledger + fuzz baseline) | `func F[T ~complex64](a T) T { return a + 1e40 }`; `func G[T ~uint](s T) { _ = 1i << s }`; `_ = 1 << 'a'`; `_ = +1e400`; `switch 1e400 {}` | `cannot convert 1e40 … to type T`; `shifted operand 1i (untyped complex constant) must be integer`; `cannot use 1 << 'a' … as int value in assignment to _ identifier (overflows)` / `1e400 … overflows float64` | accepted on all targets: `_untypedFitsTerm` (`assignability.js:247`) skips overflow on complex terms, `_isShiftableUntyped` (`:427`) skips `complex128`, and blank assignments / untyped switch tags skip `_checkConstDefault` |
| control | `range 1e100`, `range int8(200)` | `cannot range over 1e100 …`; `constant 200 overflows int8` | rejected (must stay) |

#### O5 `nested-assignability`, `dual-conversion-check`

Root (assignability): `assertAssignable` checks a pointer's base through `_assertNestedAssignable` (`assignability.js:606`), which only rejects a struct/defined-struct mix and otherwise accepts, instead of requiring identical base types; arrays reach it through `:1105`. Slice, map and func mismatches are rejected but by per-kind paths with `Cannot assign X to Y` and, for pointers to defined types, the inner type (`Cannot assign int to MyInt`). Root (conversion): two validators decide convertibility separately: `_checkTypeConversion` (`src/typechecker/expressions.js:1273`, type-literal targets like `[]MyInt(s)`, `(*any)(p)`) and `_checkConversionValidity` (`:1373`, named targets); the first never compares slice element types, and `_pointerConversionOk` (`:1342`) requires base types with the same name rather than identical underlying types.

| ID | Program | Go | GoFront |
|---|---|---|---|
| O5.1 (ledger *Nested assignability*) | `var p *int; var q *any = p` | `cannot use p (variable of type *int) as *any value in variable declaration: …` | accepted on all targets |
| O5.2 *sibling* | `var a [2]int; var b [2]any = a` | `cannot use a (variable of type [2]int) as [2]any value in variable declaration` | js/both accept; wasm ICE (invalid module) |
| O5.3 *sibling* | `var p *int; var q *MyInt = p` | `cannot use p (variable of type *int) as *MyInt value in variable declaration` | `Cannot assign int to MyInt` (message only) |
| O5.4 *sibling* | `var a []int; var b []any = a` (also `map[string]int`, `func() int`) | `cannot use a (variable of type []int) as []any value in variable declaration` | `Cannot assign []int to []any` (message only) |
| O5.5 (ledger *Pointer conversion*) | `type B interface{}; var p *B; _ = (*any)(p)` | ok | `cannot convert *B to *any` |
| O5.6 *sibling* | `type MyInt int; var s []int; _ = []MyInt(s)` | `cannot convert s (variable of type []int) to type []MyInt` | accepted on all targets |
| O5.7 controls | `(*MyInt)(&x)`; `(*B)(&a)` with tag-only differences (js); `(*float64)(p)` rejected | `1`; `1`; rejected | same (must stay; the `wasm` struct-pointer blocker message stays) |
| O5.8 (ledger *Conversion to type literal*, review 2026-11-19) | `_ = struct{ X int }(1)`; *siblings* `[]int(1)`, `map[int]int(1)`, `bool(1)`, `MS(float64(1))`, `MI(1.5)` | `cannot convert … to type …` | accepted on all targets (and `MS(float64)` emits `invalid-wasm`): `_checkTypeConversion` returns before `_checkConversionValidity` for type-literal and predeclared targets, `_checkConversionValidity` (`expressions.js:1629`) allows `isNumeric` instead of `isInteger` for `string` targets, and untyped constant conversions skip representability |
| control | `type S struct{ X int }; S(1)`; `[2]int(1)` | `cannot convert 1 (untyped int constant) to type S` | rejected (message differs: `cannot convert untyped int to S`; must stay rejected) |

#### O6 `receiver-base-type`

Root: `collectFunc`/`_attachMethod` (`src/typechecker/index.js:1137`, `:1183`) attach a method to whatever `decl.recvType` names without checking it; the parser (`src/parser/declarations.js:32`) reads the receiver as `[*]TypeName`, so `**T` is a parse error.

| ID | Program | Go | GoFront |
|---|---|---|---|
| O6.1 (ledger *Interface receivers*) | `type B interface{}; func (b B) Foo() int { return 1 }` | `invalid receiver type B (pointer or interface type)` | accepted on all targets |
| O6.2 *sibling* | `type I interface{ M() }; func (p *I) N() {}` | `invalid receiver type I (pointer or interface type)` | accepted on all targets |
| O6.3 *sibling* | `type P *int; func (p P) M() {}` | `invalid receiver type P (pointer or interface type)` | accepted on all targets |
| O6.4 *sibling* | `func (i int) M() {}` | `cannot define new methods on non-local type int` | accepted on all targets |
| O6.5 *sibling* | `type A = []int; func (a A) M() {}` | `invalid receiver type A` | accepted on all targets |
| O6.6 *sibling* | `func (t **T) M() {}` | `invalid receiver type **T` | `Parse error … expected ')'` (message only) |

#### O7 `switch-tag-comparison`

Root: `_caseValueUnchecked` (`src/typechecker/statements.js:769`) returns early for type-parameter tags and nothing checks that the tag is comparable; `_checkTaglessCase` (`:747`) skips type-parameter cases and checks `isBool(under)` instead of applying the comparison `bool(true) == e`, so an interface case Go accepts is rejected while a defined boolean (`type MB bool`) or type parameter (`T any`) case Go rejects is accepted.

| ID | Program | Go | GoFront |
|---|---|---|---|
| O7.1 (ledger *Switch on type parameter*) | `func f[T any](x T) { switch x { case nil: } }; f(1)` | `cannot switch on x (variable of type T constrained by any) (T is not comparable)` | js/both accept; wasm ICE (`cannot convert nil to type int`) |
| O7.2 *sibling* | `func f[T comparable](x T) { switch x { case nil: } }; f(1)` | `cannot convert nil to type T` | js/both accept; wasm ICE |
| O7.3 *sibling* | `type P struct{ S []int }; var p P; switch p {}` | `cannot switch on p (variable of struct type P) (P is not comparable)` | accepted on all targets |
| O7.4 (ledger *Tagless switch*, re-verified: Go accepts) | `var v any = true; switch { case v: }` | ok | `invalid case v in switch (mismatched types any and bool)` |
| O7.5 *sibling* | `type I interface{}; var v I = true; switch { case v: fmt.Println("hit") }`; `type MB bool; var b MB; switch { case b: }`; `func f[T any](x T) { switch { case x: } }` | `hit`; `invalid case b in switch on true (mismatched types MB and bool)`; `invalid case x in switch on true (mismatched types T and bool)` | rejects `I`; accepts `MB` and `T` on js/both (wasm ICE on `T`) |
| control | `switch x { case nil: }` (`x int`); `x == nil` with `T any`; `switch p { case nil: }` (`p *int`); `switch s {}` (`s []int`, no cases) | rejected; rejected; `nil`; ok | same (must stay) |

#### O8 operator codegen

Root (JS equality, re-audited 2026-11-19 at `258d4148`): `_isStructEquality` (`src/backend/js/expressions.js:3657`) runs *before* `_isIfaceEquality` (`:3489`), so `P{1} == a` calls `__equal` (ignoring dynamic type: `P{1} == any(&P{1})` and `P{1} == any(Q{1})` wrongly print `true`), while `i == P{1}` and `a == [2]int{1, 2}` reach `_isIfaceEquality` → `__ifeq` (`src/backend/js/runtime.js:891`) where `_genIfaceOperand` (`expressions.js:3680`) only boxes non-struct named types (`_namedBoxInfo`), leaving `P{1}` unboxed (no `__v: true`) and `[2]int{1, 2}` untagged (no `__t`), so `__ifeq` returns `false`. Root (complex `++`): JS `IncDecStmt` (`src/backend/js/statements.js:353`, `:2142`) and `emitIncDecStmt` (`src/backend/wasm/emit-stmts.js:2064`) treat the operand as a scalar; `c += 1` already works on both.

| ID | Program | Go | GoFront |
|---|---|---|---|
| O8.1 *sibling* | `var i I = P{1}; fmt.Println(i == P{1})`; `var a any = [2]int{1, 2}; fmt.Println(a == [2]int{1, 2})` | `true`; `true` | js/both `false`; wasm `true` |
| O8.2 *sibling* | `var a any = P{1}; fmt.Println(a == P{1})`; `var a1 any = &P{1}; var a2 any = Q{1}; fmt.Println(P{1} == a1, P{1} == a2)` | `true`; `false false` | js/both `false` / `true true`; wasm `true` / `false false` |
| O8.3 (ledger *Complex ++/--*) | `var c complex128 = 1i; c++; fmt.Println(c)` | `(1+1i)` | js/both `(NaN+NaNi)`; wasm ICE (invalid module) |
| O8.4 *sibling* | `var c complex64 = 1i; c--; fmt.Println(c)` | `(-1+1i)` | js/both `(NaN+NaNi)`; wasm ICE |
| control | `var c complex128 = 1i; c += 1`; `var i, j I = P{1}, P{1}; i == j` | `(1+1i)`; `true` | same on all targets (must stay) |

#### O9 `type-comparability` (review follow-ups 2026-11-19)

Scheduled from `plans/follow-ups.md` (*Unhashable array chain in struct map key*, PR #245; re-probed with `go run` go1.26 and `runProgram` on `js`/`both`/`wasm` at `60ce661f`, re-audited at `258d4148`). Root: `_isComparable` already exists in `src/typechecker/resolve.js:1105` (with a separate `_typeParamComparable` in `assignability.js:341`), but map type resolution never calls it and `_checkEqualityComparable` (`assignability.js:723`) only checks top-level slice/map/func kinds (`_isNonComparableKind`), never struct fields or array elements. In `wasm`, `src/backend/wasm/types.js:isUnhashableGoType` (`:933`) reads one level of `goType.underlying?.elem` instead of unwrapping with `namedUnderlying` (already imported at `:6`). `check-baseline.txt` already holds 8 `# map-key-comparability` entries (`comparable:mapkey:*`).

| ID | Program | Go | GoFront |
|---|---|---|---|
| O9.1 (ledger) | `type S1 []int; type A1 [2]S1; type Box struct{ Arr A1 }; var m map[Box]int` | `invalid map key type Box` | accepted on all targets |
| O9.2 *sibling* | `map[[]int]int`; `map[func()]int`; `type S []int; map[S]int`; `type A1 [2][]int; map[A1]int`; `type F func(); type G F; map[G]int` | `invalid map key type …` | accepted on all targets |
| O9.3 *sibling* | `type Box struct{ S []int }; map[Box]int`; nested `struct{ I In }` with `In struct{ S []int }` | `invalid map key type Box` | accepted on all targets |
| O9.4 *sibling* | `type Box struct{ S []int }; a, b := Box{}, Box{}; _ = a == b` (also through a nested struct) | `invalid operation: a == b (struct containing []int cannot be compared)` | accepted on all targets |

---

## Approach

### 1. Architecture & Design Decisions
- **Checker fuzzer (Phase 1).** `test/fuzz/gocheck/main.go` (own `go.mod`, stdlib only) reads a JSON list of `{id, src}` on stdin and type-checks each with `go/types` (`importer.Default()`), printing `{id, ok, line, col, msg}` per case: one Go process checks the whole grid, so the full run takes minutes, not hours. `test/fuzz/checkfuzz.js` builds the grid from an operand-kind list (`bool`, `int`, `int8`, `uint`, `float32`, `float64`, `complex64`, `complex128`, `string`, defined `MI int`/`MS string`/`MB bool`, `*int`, `[]int`, `[2]int`, `map[string]int`, `func()`, `struct{X int}`, `P` struct, `PS` struct with a slice field, Go `any`, `I` with a method, defined empty `E`, `error`, type parameters `T any`/`T comparable`/`T ~int\|~float64`, and untyped `1`, `1.5`, `1i`, `1 + 0i`, `"a"`, `true`, `'a'`, `nil`, `1e40`, `1e400`) crossed with templates per spec section: binary operators, unary operators, `op=`, `++`/`--`, comparison, shifts (constant and non-constant, each context), conversions `T(x)`, assignability `var t T = x` (also nested `*T`, `[2]T`, `[]T`), method receivers, and `switch` tag/case. Each case runs `compileFiles` with `forceTarget` `js`, plus `wasm` when GoFront accepts (ICE and invalid-module detection). Classes: `go-reject/gf-accept`, `go-accept/gf-reject`, `ice`, `invalid-wasm`, and `message` (both reject, Go's message not contained; reported only with `--messages`). A mismatch is keyed `<section>:<template>:<kinds>:<class>` and compared to `test/fuzz/check-baseline.txt` (one key per line, `# O<n>` or `# excluded: <row>` tag); the run fails on a mismatch not in the baseline and on a baseline key that no longer mismatches, so each later phase removes its keys. `--sample N --seed S` runs a random subset; `--self-test` checks rendering and key stability without Go. The order-mode fuzzer (`difffuzz.js`) is unchanged; `runGofront`'s compile-and-validate step is shared through a small `test/fuzz/gofront-run.js`.
- **Checker fuzzer as built (2026-11-18).** Differences from the paragraph above: the oracle resolves imports from source (`importer.ForCompiler(…, "source", nil)`), takes one-file packages per case (`pkgs`, for `./sub` and dot imports) and flags Go parse errors (`syntax`), on which the run stops as a grid bug. The grid lives in `test/fuzz/check-grid.js` and adds the kinds `MI2`, `MS2`, `I2` (defined over a defined type), conversions through `*T`/`[2]T`/`[]T`, and a `names` section: each kind of name (variable, parameter, constant, type, alias, type parameter, function, generic function, field, method value and expression, builtin, `nil`, predeclared constant and type, package, members of a stdlib, a local and a dot-imported package, and predeclared or imported names a declaration shadows) in each position (value, assignment target, `&` operand, `++`, call, conversion, type, composite literal). `js` accepting what Go rejects is recorded without running `wasm`; a `wasm` compile error after `js` accepted is the extra class `wasm-reject`. `--show KEY` prints one case with both verdicts and `--write-baseline` rewrites the baseline, keeping tags and tagging new entries from `TAG_RULES`.
- **Operator table (Phase 2).** `src/typechecker/operators.js` exports `OPERAND_KINDS` (operator → predicate over a core kind: `+` numeric/string/complex, `-`/`*`/`/` numeric/complex, `%`/`&`/`|`/`^`/`&^` and unary `^` integer, `<`…`>=` ordered = integer/float/string, `==`/`!=` comparable, `&&`/`||`/`!` boolean, unary `+`/`-` numeric/complex) and `operatorDefined(op, t)`, where `t` may be untyped (its class decides: `1.5` is a float constant) or a type parameter (every term must satisfy; `_checkTypeParamOperator` calls it, replacing `TYPE_PARAM_OP_PREDICATES`). `binaryResultType`, `_checkLogicalOperands` and the three unary checks call it and report Go's `operator OP not defined on X (KIND)` once, from one formatter. Operand-kind mismatches between two operands (`mismatched types`) keep their existing path.
- **Comparison (Phase 2).** `_checkCmpOperandTypes` applies the spec rule for every operand kind: after `convertUntyped` (an untyped constant meeting an interface converts to its default type first), one operand must be assignable to the other's type (`_assignableQuietly` both ways), else `mismatched types`; the untyped-to-interface failure reports `cannot convert X (KIND) to type I` as Go does. A reported mismatch stops the comparison check (no `_checkEqualityComparable` second error), and the comparable check reports Go's `slice can only be compared to nil`.
- **Shifts (Phase 3).** `_binaryResultTypeNonComplex` dispatches all `<<`/`>>` expressions (including non-numeric left operands like `"a" << 1`) to `_binaryResultTypeShift`, which checks the shifted operand (`_checkShiftedOperand`, already added by checker-go-rules Phase 16) *before* `checkShiftCount` (and likewise in `_checkTypeParamOperator`) so a bad operand with a bad count reports once. `_retypeUntypedShift` reports Go's `shifted operand 1 (type T) must be integer` when the context type `T` of a non-constant shift is not an integer (float, complex, or a type parameter whose type set contains a non-integer term) and keeps the `int` default for interface contexts.
- **Constants (Phase 4).** `const-fold.js` gains `k: "COMPLEX"` with `v = { re, im }` (two float64 components), folded for `+ - * /`, unary `-`, `==`/`!=`, and `real`/`imag`/`complex` of constant operands (`constants.js`). A complex constant with `im === 0` is representable wherever its real part is (`int`, `float64`, numeric conversions and `complex()` arguments in `expressions.js`), and `_isShiftableUntyped` checks `constIntValue` on complex constants so `1i << s` is rejected and `(1 + 0i) << s` is accepted; `UNTYPED_COMPAT.complex128` and the overflow special case in `_convertUntypedConst` give way to that rule. Backends read `_const`: a COMPLEX constant converted to a real type is emitted as its real part (JS `src/backend/js/expressions.js:623` reader, wasm `src/backend/wasm/emit-exprs.js` constant emitter). `_checkConstOverflow` gains float and complex ranges (also called by `_untypedFitsTerm` for complex type-parameter terms, by `_checkRangeExpr`/`_checkForCond` for `range`, by conversion checks in `expressions.js` for `float32(1e40)`, and via `_checkConstDefault` for blank assignments `_ = c` and untyped `switch` tags): a constant rounds to `float32` with `Math.fround` and overflows when the result is infinite; `float64` overflow uses the exact decimal form (`r`), since `1e400` is `Infinity` as a Number; complex targets check each component. Conversions `float32(1e40)` report Go's `cannot convert` form.
- **Assignability and conversions (Phase 5).** `_assertNestedAssignable` requires `identical` element/base types (the struct-copy exception for defined structs in its doc comment stays), and every composite mismatch (pointer, array, slice, map, func) reports through `_assertAssignableTypeMismatch` with Go's `cannot use X (KIND) as T value in CTX`. One `_convertible(src, tgt)` in `src/typechecker/expressions.js` implements spec *Conversions* (assignable; identical underlying types ignoring tags; unnamed pointers whose base underlying types are identical ignoring tags; numeric/integer-to-string/byte-slice/rune-slice rules — rejecting float-to-string; slice to array or array pointer with identical elements; untyped constant representability); `_checkTypeConversion` and `_checkConversionValidity` keep only their target-form specific tagging and both call it. `_pointerConversionOk` keeps the `wasm` struct-pointer blocker, now behind `_convertible`.
- **Receivers (Phase 6).** `_checkReceiverType(decl)`, called from `_attachMethod` before attaching: the receiver must name a type declared in this package (`cannot define new methods on non-local type T` for predeclared and imported types), not an alias of an unnamed type (`invalid receiver type A`), and its underlying type must not be a pointer or interface (`invalid receiver type T (pointer or interface type)`). The parser reads the receiver type with `parseType` so `**T` reaches the checker (`invalid receiver type **T`); the declaration node keeps `recvType`/`recvPointer` for the existing consumers.
- **Switch (Phase 7).** New `_checkSwitchTag` (called from `_checkSwitchStmt`) reports a non-comparable tag (`_isComparable` in `resolve.js:1105` plus `_typeParamComparable` for type parameters until Phase 9 unifies them) with Go's `cannot switch on x (…) (T is not comparable)`; `_caseValueUnchecked` no longer skips type-parameter tags, so `case nil` uses `_isNilless` (`assignability.js:681`, `cannot convert nil to type T`). The tagless form checks each case as a comparison against typed `bool` (`BOOL`, Go's default-typed implicit `true`) through the Phase 2 rule — accepting interface cases (`any`, defined empty interface) and rejecting defined booleans (`type MB bool`) and type parameters (`T any`, `T comparable`, `T ~int|~float64`).
- **Operator codegen (Phase 8).** JS: `_isStructEquality` (`src/backend/js/expressions.js:3474`) moves *after* `_isIfaceEquality` (`:3489`, preserving `_genAnyNilCompare` and `_genTypeParamEquality` precedence), so comparing an interface with a struct or array in either operand order (`i == P{1}`, `P{1} == i`, `a == [2]int{1, 2}`) goes through `__ifeq` (preserving dynamic-type checks so `P{1} == any(&P{1})` and `P{1} == any(Q{1})` return `false`). `_genIfaceOperand` (`:3680`) boxes concrete struct values (`__ifv(...)`) and array values (`__t` tag) the same way interface assignment does (which also fixes interface `switch` cases with struct/array values in `src/backend/js/statements.js:2339`). Complex `++`/`--` are emitted as `+= 1`/`-= 1` through the existing compound-assignment emitters on both backends (both `genStmt` and `stmtInline` for `for`-post in `src/backend/js/statements.js`, and `emitIncDecStmt` in `src/backend/wasm/emit-stmts.js`; the checker tags the statement `_complexIncDec`), so complex64 rounding stays in one place.
- **Comparable types (Phase 9).** Unify `_isComparable` (`src/typechecker/resolve.js:1105`) with `_typeParamComparable` (`assignability.js:341`, updating callers in `assignability.js` and `statements.js`) so one predicate handles structs, arrays, slices, maps, funcs and type parameters. Map type resolution (`resolve.js`) rejects non-comparable keys with Go's `invalid map key type …`, and `_checkEqualityComparable` (`assignability.js:723`) uses it for struct and array `==`/`!=` (`struct containing … cannot be compared`). In `src/backend/wasm/types.js:isUnhashableGoType`, unwrap named array types with `namedUnderlying` (already imported at `:6`) instead of one-level `goType.underlying?.elem`.

### 2. Invariants & Safety Bounds
- A program Go accepts and GoFront compiles today prints the same output on every target, except the fixed miscompiles (O3.3 on js/both, O8.1–O8.4).
- JS-dynamic `any` stays permissive: `operatorDefined` and the comparison rule return "defined" for `anyKind === "dynamic"` and tainted types.
- Emitted code for programs without the affected forms is byte-identical; `bundle-size`, `zero-alloc` and `bce-mathx` gates unchanged.
- `example/` and `stdlib/` compile unchanged (`npm run check`, stdlib build); if a new rejection hits them, the phase fixes the call site and the release note names the rule.
- The fuzzer is a manual tool (`npm run fuzz:check`, needs Go): `npm test` runs only its `--self-test`, so CI without Go is unaffected.

### 3. Edge Cases & Error Handling
- **O1:** `+` on two strings, `<` on strings and defined numeric types, `==` on structs/arrays/pointers/interfaces stay valid; `!` on a defined bool keeps its type; an untyped rune is an integer for `%` and `^`.
- **O2:** `i == j` with two interfaces, `i == T{}` when `T` implements `I`, and `x == nil` for nilable `x` stay valid; JS-dynamic operands compare with anything.
- **O3:** `var v any = 1 << s` is valid (`int` default); `var u uint64 = (1 << k) - 1` keeps its 64-bit retyping; a shift inside a constant expression (`1.0 << 2`) folds to `4`.
- **O4:** `var c complex64 = 1 + 2i` and `complex(1, 2)` of constants stay valid; `const r = real(1i)` is `0`; `float32(0.1)` rounds without error; the largest finite `float32` (`3.4028234663852886e38`) is accepted.
- **O5:** a defined struct and an identical struct literal type stay interchangeable where `structCopy` allows; `[]byte(s)` and `string(runes)` stay valid; `(*T)(p)` between struct types differing only in tags stays valid on `js` and keeps its `wasm` blocker.
- **O6:** methods on pointer receivers of defined structs (`func (p *P) M()`) and on defined non-struct types (`type MI int`) stay valid; generic receivers (`func (l *List[T]) Push`) keep working.
- **O7:** the tag check is Go's, not "comparable": Go 1.26 accepts `switch s {}` and `switch f { case nil: }` for a slice or func tag (they compare with `nil`) but rejects a struct tag with a slice field and an unconstrained type parameter. So the check rejects a type parameter without `comparable` and a struct/array that is not comparable, and leaves slice, map and func tags to the existing `case` checks.
- **O8:** `i != P{1}` negates `__ifeq`; interface-vs-pointer comparisons continue using `__ifeq` unchanged.

---

## Implementation Tasks

### Phase 1: Checker differential fuzzer
*Scheduled from review follow-ups (2026-11-17). Landed early (2026-11-18) on `feat/checker-go-rules`, so the remaining checker-go-rules phases run against it; the baseline was written at that branch's state.*
- [x] Task 1.1: `go/types` oracle that checks many programs in one process
  - Files: `test/fuzz/gocheck/main.go`, `test/fuzz/gocheck/go.mod`
  - Test: `test/unit/cli/checkfuzz.test.js` (skipped when `go` is not on `PATH`) feeds two programs (`_ = 1 && 2`, `_ = 1 + 2`) and asserts `ok:false` with `operator && not defined` and `ok:true`
  - Done when: one invocation returns a result per input case with line, column and message
- [x] Task 1.2: Operand-kind grid and GoFront runner
  - Files: `test/fuzz/checkfuzz.js`, `test/fuzz/check-grid.js` (the grid), `test/fuzz/gofront-run.js`, `test/fuzz/difffuzz.js` (use the shared runner)
  - Test: `checkfuzz.js --self-test` from `test/unit/cli/checkfuzz.test.js`: every rendered case parses with GoFront's parser (but for the `UNPARSED` patterns, each a parser gap Go reads), keys are unique and stable for a fixed seed, and the grid contains the O1–O7 ledger repros; `test/unit/cli/difffuzz.test.js` still passes
  - Done when: `node test/fuzz/checkfuzz.js --sample 200 --seed 1` prints classified mismatches
- [x] Task 1.3: Baseline file and `fuzz:check` script
  - Files: `test/fuzz/checkfuzz.js`, `test/fuzz/check-baseline.txt`, `package.json`
  - Test: self-test case: a baseline with a stale key and a run with an unlisted mismatch both fail with a message naming the key
  - Done when: `npm run fuzz:check` passes against the committed baseline, and the baseline holds a key tagged `O<n>` for every grid-covered *Verified Gaps* row (O1.1–O1.11, O2.1–O2.4, O3.1–O3.5, O4.1–O4.10, O5.1–O5.6, O6.1–O6.5, O7.1–O7.5); further keys the grid finds are tagged with the root whose rule covers them, or listed under *Review follow-ups* with a new root before Phase 2 starts
  - As landed: 27,078 cases, 7,690 baseline entries (down to 6,342 at `258d4148` after checker-go-rules Phases 4–17 & 19), full run about 30 s. Every row that is not "message only" has its key (`LEDGER_KEYS`); the message-only rows (O1.8–O1.11, O2.4, O3.4, O3.5, O5.3, O5.4) have none, since `message` is not a baseline class. Tags come from `TAG_RULES` (one rule per template, not per entry): `O1`–`O8`, `map-key-comparability` (O9), `R8`/`R9`/`R12`/`R13`/`R18`/`R20`, `W1`, `builtin-complex-operands`, `excluded: …`, and the four originally unscheduled roots now assigned to other plans (`type-param-value` → checker-go-rules Phase 22, `wasm-iface-equality` → codegen-fixes Phase 3, `type-as-value` → checker-go-rules Phase 27, `parser-conversion-type` → names-panics-type-exprs Task 4.2).

### Phase 2: Operator table and comparisons (roots `operator-kind-table`, `cmp-assignability`)
- [ ] Task 2.1: `operatorDefined` table for binary arithmetic and ordering (O1.1–O1.3, O1.10, O1.11)
  - Files: `src/typechecker/operators.js` (new), `src/typechecker/assignability.js`
  - Test: reject fixtures `ordering_bool.go`, `ordering_pointer.go`, `ordering_struct.go`, `untyped_string_minus.go`, `complex_ordering.go`; O1.12 controls keep their messages
  - Done when: Go's messages on all targets, no wasm ICE; baseline keys `# O1` for binary and ordering templates removed
- [ ] Task 2.2: Logical and unary operators through the table (O1.4–O1.9)
  - Files: `src/typechecker/assignability.js`, `src/typechecker/expressions.js`
  - Test: reject fixtures `logical_untyped_int.go`, `logical_typed_int.go`, `logical_nil.go`, `complement_float.go`, `unary_minus_bool.go`, `not_int.go`
  - Done when: Go's messages on all targets; `_checkBoolUnaryOp`/`_checkNumericUnaryOp`/`_checkComplementUnaryOp` call `operatorDefined`; remaining `# O1` keys removed
- [ ] Task 2.3: Comparison assignability for every operand kind, one error per comparison (O2.1–O2.4)
  - Files: `src/typechecker/assignability.js`, `test/fuzz/check-baseline.txt` (retag the five `binary:==:*PS*` comparability entries from `# O2` to `# map-key-comparability` for Task 9.2)
  - Test: reject fixtures `iface_cmp_untyped.go`, `iface_cmp_nonimpl.go`, `error_cmp_string.go`; `test/unit/types/errors.test.js` asserts `s == 1` reports exactly one error and `i == s` reports `slice can only be compared to nil`; accept fixture `iface_cmp_impl.go` compile-only (its JS output is O8.1)
  - Done when: Go's messages on all targets; `# O2` keys removed

### Phase 3: Shifts (root `shift-operand-type`)
- [ ] Task 3.1: Dispatch all shifts through `_binaryResultTypeShift` and check operand before count (O3.1 control, O3.4, O3.5)
  - Files: `src/typechecker/assignability.js` (`_binaryResultTypeNonComplex`, `_binaryResultTypeShift`, `_checkTypeParamOperator`)
  - Test: reject fixtures `shift_untyped_float.go` (O3.1 regression), `shift_untyped_string.go`; `test/unit/types/errors.test.js` asserts `f <<= 1.5` reports exactly one error; `1.0 << 2` prints `4` on all targets
  - Done when: Go's messages on all targets, no wasm ICE
- [ ] Task 3.2: Non-constant shifts take their context type, which must be an integer (O3.2, O3.3)
  - Files: `src/typechecker/assignability.js`, `test/fuzz/check-baseline.txt` (retag the two `binary:<<:*,rune` overflow entries from `# O3` to `# O4`)
  - Test: reject fixtures `shift_nonconst_float_ctx.go`, `shift_nonconst_complex_ctx.go`, plus `var x T = 1 << s` (`T ~int | ~float64`); `test/unit/types/numeric-operands.test.js` `var v any = 1 << s` prints `2` and the `uint64` retyping test still passes
  - Done when: Go's messages on all targets, no wasm ICE; `# O3` keys removed

### Phase 4: Constant representability (root `const-representability`)
- [ ] Task 4.1: Complex constants folded by value
  - Files: `src/typechecker/const-fold.js`, `src/typechecker/constants.js`
  - Test: `test/unit/language/constants.test.js`: `const c = 3 + 4i; const r = real(c)` sizes an array of length `3` (O4.4); `(1 + 2i) * (3 - 1i)` folds to `(5+5i)` on all targets
  - Done when: both pass on all targets
- [ ] Task 4.2: Integral complex constants convert to real types and shifts (O4.1–O4.3, O4.5, O4.12 shift)
  - Files: `src/typechecker/assignability.js`, `src/typechecker/expressions.js`, `src/backend/js/expressions.js`, `src/backend/wasm/emit-exprs.js`
  - Test: accept fixtures `complex_const_to_int.go` (prints `1`), `complex_const_cmp_int.go` (prints `true`), `complex_const_plus_float.go`; reject fixtures `complex_const_to_float.go` (`2i … (overflows)`), `shift_untyped_complex.go` (`1i << s` with `T ~uint`)
  - Done when: Go's result on all targets
- [ ] Task 4.3: Float, complex and default-type constant overflow (O4.6–O4.10, O4.12)
  - Files: `src/typechecker/constants.js`, `src/typechecker/assignability.js` (`_untypedFitsTerm`), `src/typechecker/expressions.js`, `src/typechecker/statements.js` (blank assignment and untyped `switch` tag `_checkConstDefault`), `test/fuzz/check-baseline.txt` (retag non-O4 entries tagged `# O4` by operand name: `conv:value:{bool,string,MS,MS2},*` → `# O5`, `builtins:{real,imag}:1e40` → `# builtin-complex-operands`, and non-comparable `switch:tag:*` → `# O7`)
  - Test: reject fixtures `float32_cmp_overflow.go`, `float32_var_overflow.go`, `float32_const_overflow.go`, `float32_conv_overflow.go`, `float64_overflow.go`, `complex64_overflow.go`, plus `func F[T ~complex64](a T) T { return a + 1e40 }`, `_ = 1 << 'a'`, `_ = +1e400`, `switch 1e400 {}`; `test/unit/language/float32-consts.test.js` max finite `float32` still compiles
  - Done when: Go's messages on all targets; `# O4` keys (except the three `range:*:1<<63` keys for Task 4.4) removed
- [ ] Task 4.4: A constant `range` operand must be representable as `int` (O4.11)
  - Files: `src/typechecker/expressions.js` (`_checkRangeExpr`), `src/typechecker/statements.js` (`_checkForCond`)
  - Test: reject fixture `range_const_overflow.go` (`… as int value in range clause (overflows)`); `range 1 << 62` and the O4.11 controls unchanged
  - Done when: Go's message on all targets; both paths call `_checkConstOverflow`; the remaining `# O4` keys (`range:*:1<<63`) are gone

### Phase 5: Assignability and conversions (roots `nested-assignability`, `dual-conversion-check`)
- [ ] Task 5.1: Pointer and array element types must be identical; composite mismatches use Go's message (O5.1–O5.4)
  - Files: `src/typechecker/assignability.js`
  - Test: reject fixtures `assign_ptr_int_to_ptr_any.go`, `assign_array_int_to_array_any.go`, `assign_ptr_int_to_ptr_named.go`, `assign_slice_int_to_slice_any.go`; existing `structCopy` tests in `test/unit/types/identity.test.js` pass
  - Done when: Go's messages on all targets, no wasm ICE
- [ ] Task 5.2: One `_convertible` for every conversion form (O5.5–O5.8)
  - Files: `src/typechecker/expressions.js`
  - Test: accept fixture `ptr_conv_defined_empty_iface.go`; reject fixtures `slice_conv_elem_mismatch.go`, `conv_untyped_to_struct_literal.go`, `conv_untyped_to_slice_literal.go`, `conv_untyped_to_map_literal.go`, `conv_int_to_bool.go`, `conv_float_to_string.go`, `conv_untyped_float_to_named_int.go` (O5.8); O5.7 and O5.8 controls in `test/unit/types/pointers.test.js`
  - Done when: both conversion paths call `_convertible`; `# O5` keys removed

### Phase 6: Method receivers (root `receiver-base-type`)
- [ ] Task 6.1: Receiver base type checks (O6.1–O6.5)
  - Files: `src/typechecker/index.js`
  - Test: reject fixtures `receiver_interface.go`, `receiver_ptr_to_interface.go`, `receiver_pointer_type.go`, `receiver_predeclared.go`, `receiver_alias_unnamed.go`; `test/unit/language/named-type-methods.test.js` and generic receiver tests pass
  - Done when: Go's messages on all targets
- [ ] Task 6.2: Receiver types parse as types (O6.6)
  - Files: `src/parser/declarations.js`, `src/typechecker/index.js`, `test/fuzz/checkfuzz.js` (remove the `recv:decl` pattern from `UNPARSED`)
  - Test: reject fixture `receiver_double_pointer.go` (`invalid receiver type **T`)
  - Done when: Go's message on all targets; `# O6` keys removed

### Phase 7: Switch tags and cases (root `switch-tag-comparison`)
- [ ] Task 7.1: Tags must be comparable; type-parameter tags are checked (O7.1–O7.3)
  - Files: `src/typechecker/statements.js` (new `_checkSwitchTag` using `_isComparable` and `_typeParamComparable`)
  - Test: reject fixtures `switch_typeparam_any.go`, `switch_typeparam_nil_case.go`, `switch_noncomparable_struct.go`; O7 controls in `test/unit/types/switch-cases.test.js`
  - Done when: Go's messages on all targets, no wasm ICE
- [ ] Task 7.2: Tagless cases are comparisons with typed `bool` (O7.4, O7.5)
  - Files: `src/typechecker/statements.js`
  - Test: accept fixtures `tagless_case_any.go`, `tagless_case_defined_iface.go` (prints `hit`); reject fixtures `tagless_case_defined_bool.go` (`type MB bool`), `tagless_case_typeparam.go` (`T any`); existing tagless rejections (`case 1:`) keep their messages
  - Done when: Go's result on all targets; `# O7` keys removed

### Phase 8: Operator codegen
- [ ] Task 8.1: JS equality of an interface with a struct or array value (O8.1, O8.2)
  - Files: `src/backend/js/expressions.js` (`_isStructEquality` after `_isIfaceEquality`; `_genIfaceOperand` boxes struct and array values)
  - Test: `test/unit/language/value-semantics.test.js` `assertOutput` for O8.1 (`i == P{1}`, `a == [2]int{1, 2}`), O8.2 (`a == P{1}`, `P{1} == a`, `P{1} == any(&P{1})`, `P{1} == any(Q{1})`), `!=`, and `switch a { case P{1}: }`; interface-pointer equality unchanged
  - Done when: Go's output on all targets
- [ ] Task 8.2: Complex `++`/`--` through compound assignment (O8.3, O8.4)
  - Files: `src/backend/js/statements.js` (`genStmt` and `stmtInline`), `src/backend/wasm/emit-stmts.js`, `src/typechecker/statements.js`
  - Test: `test/unit/types/complex.test.js` `assertOutput` for O8.3 (`(1+1i)`) and O8.4 (`(-1+1i)`), including a map element `m[k]++`, a field `p.C++`, and a `for`-post `c++`
  - Done when: Go's output on all targets, valid `wasm`; `# O8` keys removed
- [ ] Task 8.3: Document the new rejections and fixed cases
  - Files: `docs/go-compatibility.md`
  - Test: none (docs); `npm run fuzz:check` baseline holds no `# O1`–`# O8` keys
  - Done when: the doc lists the rules of Phases 2–8 that now match Go and no longer lists them as differences

### Phase 9: Comparable types (root `type-comparability`)
*Scheduled from review follow-ups (2026-11-19): ledger *Unhashable array chain in struct map key*. Lands after Phase 8; carries its own docs line since Task 8.3 documents Phases 2–8.*
- [ ] Task 9.1: Unify `_isComparable` (including type parameters); map types reject non-comparable keys (O9.1–O9.3)
  - Files: `src/typechecker/resolve.js` (`_isComparable` + map type resolution), `src/typechecker/assignability.js` (`_typeParamComparable` unified into `_isComparable`), `src/typechecker/statements.js` (`_checkSwitchTag` uses `_isComparable`)
  - Test: reject fixtures `map_key_slice.go`, `map_key_func_chain.go`, `map_key_struct_slice_field.go`, `map_key_array_of_slice_in_struct.go`; `map[struct{ X int }]int`, `map[[2]int]int`, `map[any]int`, `map[*T]int` stay valid
  - Done when: Go's `invalid map key type …` on all targets; `comparable:mapkey:*` `# map-key-comparability` keys removed
- [ ] Task 9.2: `==`/`!=` on a struct or array require comparable fields and elements (O9.4)
  - Files: `src/typechecker/assignability.js` (`_checkEqualityComparable`)
  - Test: reject fixtures `struct_cmp_slice_field.go`, `struct_cmp_nested_slice_field.go`; comparisons of comparable structs and arrays unchanged
  - Done when: Go's `struct containing []int cannot be compared` on all targets; remaining `# map-key-comparability` keys (`binary:==:*PS*`) removed
- [ ] Task 9.3: `wasm` map-key helpers read the full underlying type; docs
  - Files: `src/backend/wasm/types.js` (`isUnhashableGoType` unwraps named array types via `namedUnderlying`), `docs/go-compatibility.md`
  - Test: a `test/unit/wasm/map-keys.test.js` test over valid defined key chains (`type K [2]P; type P struct{ X int }`; `type K2 K`) prints Go's output (control: no failing repro was found once Task 9.1 rejects invalid keys, so this pins the helper to full unwrapping)
  - Done when: passes; `isUnhashableGoType` has no one-level `.underlying` read; the doc lists the map-key and struct-comparison rejections
