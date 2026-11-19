# Checker: Go Rules Applied Everywhere — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Schedules the review follow-ups that [`checker-strictness-plan.md`](checker-strictness-plan.md) deferred at completion (its *Review follow-ups found while executing this plan* row, 41 entries), re-probed 2026-11-17 on `main` at `4eb69a6` and grouped by root cause. Entries whose root belongs to another plan are routed in `plans/follow-ups.md` (see *Excluded*). L4 from the former `followup-fixes-plan.md` joined R8 on 2026-11-17 (same root). Independent of [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md); `mangleLocalTypes` (Task 8.1) is also changed by its Task 1.3, so whichever lands second rebases; merges before [`typed-web-platform-plan.md`](typed-web-platform-plan.md) Phase 1, which extends assignability; that plan's Phase 4 reuses this plan's Phase 3 `anyKind` when it types the browser globals.  
**Release note:** **Breaking:** the compiler rejects more programs that Go rejects, so fix each reported line as Go would: comparing a value with a constant or `nil` of the wrong kind, `nil` without a type, builtins such as `append`, `len`, `copy` and `min` with the wrong arguments, assigning to a field of a function result, two-variable `range` over an integer or `range` over a float constant, and invalid operators inside generic functions. Defined string, complex, function and interface types (also when defined over another defined type), `type MyAny any`, and functions or types that reuse a predeclared name such as `len`, `max` or `error` now work as in Go.  

---

## Goal

Close the checker gaps the checker-strictness reviews found, by fixing the mechanism behind each group instead of each repro. The 34 entries scheduled here come from 13 root causes (*Verified Gaps*). Most of them share one pattern: a Go rule is applied in some places and not others because each check re-derives a type property on its own (whether an operand is untyped and must be converted, whether a type is Go `any`, what a named type's underlying type is, whether an expression is addressable). The phases below add or reuse one shared helper per rule and route every path through it, so siblings the reviews have not hit yet are fixed too. Each root's sibling paths were probed (*Verified Gaps*, "sibling" rows).

**Done means:**
- Every failing row in *Verified Gaps* gives Go 1.26's result on `js`, `both` and `wasm`: the stated compile error on the stated line (a `test/unit/fixtures/conformance/reject/*.go` case; the harness matches line and message substring, so a column a row states is asserted in the unit test its task names) or Go's output (an `accept/*.go` case or an `assertOutput` test in the file its task names). `node test/unit/run.js types/conformance.test.js` passes with no `// pending:` line added by this plan.
- No program in the *Verified Gaps* tables produces an `InternalCompilerError` on any target.
- Each root has one implementation: `grep -rn "ot === ANY" src/typechecker` finds nothing and `NON_INTEGER_BASICS` (`src/typechecker/expressions.js:178`) has no `"any"` entry; `_checkIncDecStmt` and the compound-assignment path call `binaryResultType`; `_checkAssignTarget`, the `&` operand check and `_reportUnaddressableRecv` call one `_isAddressable`, and `_isTemporaryOperand` is gone.
- `npm test`, `npm run check` (`gofront check` on `example/`) and the stdlib build pass; `test/perf/bundle-size.baseline.json` is unchanged.
- `docs/go-compatibility.md` describes the new rejections and the fixed defined-type cases.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `untyped-conversion`: an untyped constant or `nil` operand is converted to the other operand's or target's type (with representability), and has a default type or none (`nil`) | R1.1–R1.14 | |
| **In scope: core** | Root `operator-typing`: every operator form (`x op y`, `x op= y`, `x++`) types through `binaryResultType`, and string/complex results keep the operand's defined type | R2.1–R2.10 | |
| **In scope: core** | Root `empty-interface-kinds`: one classification of JS-dynamic `any`, Go `any` (every spelling), defined empty interfaces and error-tainted types | R3.1–R3.5, R15 | |
| **In scope: core** | Root `builtin-operands`: builtins check their operand kinds and element assignability from one contract per builtin | R4.1–R4.12 | |
| **In scope: core** | Root `addressability`: one `_isAddressable(expr)` per the spec, used by every assignment form and `&` | R5.1–R5.13 | |
| **In scope: core** | Root `ad-hoc-type-structure`: checks read a named type's underlying type through `_deepUnderlying` and struct identity through `identical`, never one level or field-by-field, in the checker and in both backends | R6.1–R6.8, R14 | |
| **In scope: core** | Root `range-int-operand`: range over an integer or constant operand | R7.1–R7.5 | |
| **In scope: core** | Root `predeclared-scope`: user declarations shadow predeclared and imported names at package and block scope, without replacing the universe entry other code (stdlib signatures, generated Go, backends) relies on | R8.1–R8.11, R16 | |
| **In scope: core** | Roots `generic-body-check`, `generic-func-value`: generic bodies are checked against the constraint once, at the definition, including the other operand of an operator; an instantiated generic function is a value | R9.1–R9.10, R11 | |
| **In scope: core** | Roots `builtin-type-param-constraints`, `comparable-constraint`: builtins in a generic body and `comparable` type arguments are checked against the type set | R12, R13 | |
| **In scope: core** | Roots `forwarded-tuple`, `node-positions`, `error-classification`: diagnostics only (count, position, error class); no change to accepted programs | R10.1–R10.8 | |
| **Excluded: deferred** | Entries that no longer reproduce against real Go | *Duplicate bool cases* (`switch b { case 1 == 1: case true: }`), *Impossible assertions* (`i.(J)` with conflicting `M`): `go run` (1.26.10) accepts both | Not defects: Go accepts them. Deleted |
| **Excluded: deferred** | `wasm` struct layout | *WASM map keys* (`map[struct{ X int }]int` lookup → `0`, want `10`), *WASM struct conversion* (`struct{ E }(a)` → invalid wasm), sibling `append(s, A{5})` into `[]struct{ X int }` → invalid wasm (Go: `1`) | Root `wasm-struct-field-list`, scheduled in [`wasm-struct-types-plan.md`](wasm-struct-types-plan.md) Phase 1 (W1.6–W1.8) |
| **Excluded: deferred** | Cross-package unexported field in a positional literal | *Struct literals*: `sub.S{1, 2}` with unexported `b` compiles | Root `export-visibility`, scheduled in [`package-scope-plan.md`](package-scope-plan.md) Phase 3 (E5) |
| **Excluded: deferred** | Codegen defects without a checker root | *Pointer method on dereferenced named scalar* (`(*p).Inc()` on `type Num int` → `0` on **every** target, want `1`); *JS codegen* (`_ = map[any]int{1: 1}` → `SyntaxError` on js/both) | Backend roots: `deref-receiver` scheduled in [`value-stores-plan.md`](value-stores-plan.md) Phase 5 (V5.1); `js-stmt-expr-start` `unrouted` in `plans/follow-ups.md` |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6` (checker-strictness merged). A throwaway driver (`.probes/cs/`, deleted) wrote each program as `main.go`, ran `go run` (go1.26.10, `go.mod` `go 1.26`) for the expected result, and `runProgram` (`test/unit/helpers.js:522`) with `target` `js`/`both`/`wasm`. "ICE" = `InternalCompilerError`. Rows marked *sibling* were not in the ledger: they were found by probing the root's other paths. Line numbers are as of `4eb69a6`. **Review 2026-11-17** (`main` at `7504e49`, no `src/` change since `4eb69a6`, go1.26.0, driver in `/tmp`, deleted): every row re-probed and reproduces; rows marked *sibling (review)* and the extra controls were found by spot-checking unlisted paths of each root.

### R1 `untyped-conversion`

Root: there is no step that converts an untyped operand to the other operand's (or the target's) type. `_checkCmpOperandTypes` (`src/typechecker/assignability.js:294`) returns early when either side is untyped or `nil` (`_isTypedBasicOperand`, `:304`); `_binaryResultTypeComplex` (`:187`) accepts any untyped operand; `defaultType` (`src/typechecker/types.js:632`) gives untyped `nil` a type in `:=`/`var`/`const` (`src/typechecker/statements.js:192`, `src/typechecker/index.js:1577`, `:1626`); duplicate-case detection compares constants before conversion to the tag type (`src/typechecker/statements.js:644`); a constant shift count keeps its float type (`checkShiftCount`, `src/typechecker/assignability.js:151`) and `emitShift` (`src/backend/wasm/emit-exprs.js:2872`) emits it with `toWasmType(right._type)` (`f64`).

| ID | Program | Go | GoFront |
|---|---|---|---|
| R1.1 | `s := "a"; _ = s == 'a'` | `mismatched types string and untyped rune` | js/both accept; wasm ICE |
| R1.2 | `n := 1; _ = n == "a"` | `mismatched types int and untyped string` | js/both accept; wasm ICE |
| R1.3 | `var f float64 = 1; _ = f + 1i` | `1i … overflows float64` | js/both `SyntaxError: Label 're' has already been declared`; wasm ICE |
| R1.4 | `x := 1; fmt.Println(x << 1.0)` | `2` | js/both `2`; wasm ICE (`expected type i64, found f64`) |
| R1.5 | `var x = nil` | `use of untyped nil in variable declaration` | js/both accept; wasm ICE |
| R1.6 | `const c = nil` | `nil is not constant` | same as R1.5 |
| R1.7 *sibling* | `x := nil` | `use of untyped nil in assignment` | same as R1.5 |
| R1.8 | `func f[T any]() T { var x T = nil; return x }` | `cannot use nil as T value in variable declaration` | js/both print `-9223372036854775808`; wasm ICE |
| R1.9 | `var p P; _ = p == nil` (struct) | `mismatched types P and untyped nil` | accepted on all targets |
| R1.10 *sibling* | `var a [2]int; _ = a == nil` | `mismatched types [2]int and untyped nil` | accepted on all targets |
| R1.11 *sibling* | `n := 1; _ = n == nil` | `mismatched types int and untyped nil` | js/both accept; wasm ICE |
| R1.12 | `var x float32 = 1; switch x { case 1.00000001: case 1.00000002: }` | `duplicate case 1.00000002 (constant 1 of type float32)` | accepted on all targets |
| R1.13 *sibling (review)* | `_ = nil == nil` | `invalid operation: nil == nil (operator == not defined on untyped nil)` | accepted on all targets |
| R1.14 *sibling (review)* | `var f float64; _ = f < "a"` | `mismatched types float64 and untyped string` | js/both accept; wasm ICE (`f64.lt`) |
| control | `x := 1; _ = x == 1.5`; `var b byte; _ = b == 300`; `g(nil)` (`g(int)`); `return nil` from `func() int` | `truncated to int`; `overflows byte`; `cannot use nil as int value` | same errors on all targets (must stay) |

### R2 `operator-typing`

Root: three paths type operators. `binaryResultType` (`assignability.js:99`) handles `x op y`; `x op= y` only calls `_checkDeclaredAnyOperator` and `_checkCompoundIntegerOnly` (`statements.js:370`); `x++` only `_checkDeclaredAnyOperator` (`_checkIncDecStmt`, `statements.js:353`). Within `binaryResultType`, `_binaryResultTypeString` (`:172`) returns `STRING` and skips `_checkIdenticalOperands`; `_binaryResultTypeComplex` (`:200`) returns `COMPLEX128` for defined complex types.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R2.1 | `type S string; var a, b S = "x", "y"; var c S = a + b` | `xy` | `Cannot assign string to S` |
| R2.2 | `var s S = "a"; var t string = "b"; _ = s + t` | `mismatched types S and string` | accepted |
| R2.3 | `type MyC complex128; var a, b MyC = 1i, 2i; var c MyC = a + b` | `(0+3i)` | `Cannot assign complex128 to MyC` |
| R2.4 | `var f float64 = 1.0; f <<= 1` | `shifted operand f … must be integer` | js/both print `2`; wasm ICE (`f64.ge_u`) |
| R2.5 | `var v interface{} = 2; v++` | `non-numeric type interface{}` | js/both print `3`; wasm ICE |
| R2.6 control | `var a S = "x"; a += "y"` | `xy` | `xy` everywhere (must stay) |
| R2.7 *sibling (review)* | `b := true; b += true` | `operator + not defined on b (variable of type bool)` | js/both print `2`; wasm prints `true` |
| R2.8 *sibling (review)* | `var s string; s++` | `invalid operation: s++ (non-numeric type string)` | js/both print `1`; wasm ICE |
| R2.9 *sibling (review)* | `var a S = "x"; var t string = "y"; a += t` | `invalid operation: a += t (mismatched types S and string)` | `Cannot assign string to S` (message only) |
| R2.10 *sibling (review)* | `i := 1; f := 2.0; i += f` | `invalid operation: i += f (mismatched types int and float64)` | `cannot use f (variable of type float64) as int value in assignment` (message only: the compound path checks `f` against `i` with `assertAssignable`, `statements.js:397`) |
| control | `c := 1i; c %= 2` | `operator % not defined on c` | same on all targets (must stay) |

### R3 `empty-interface-kinds`

Root: the empty interface has five forms (`ANY` for JS-dynamic values, `DECLARED_ANY` for Go `any` (`types.js:408`), the literal `interface{}`, `type MyAny any`, and a defined `type B interface{}`), plus `ANY` as the error-recovery type. Checks tell them apart ad hoc: `isAny` (`types.js:606`, basic `any` only), `isAnyLike` (`:707`, inside `identical` only), `_declared`, `ot === ANY` (`expressions.js:377`), `"any"` in `NON_INTEGER_BASICS` (`expressions.js:178`).

| ID | Program | Go | GoFront |
|---|---|---|---|
| R3.1 | `type MyAny any; var v MyAny = 2` | `2` | `Cannot assign untyped int to MyAny` |
| R3.2 | `type B interface{}; var p *B; var q *any = p` | `cannot use p (… *B) as *any value` | accepted on all targets |
| R3.3 | `v := missingVar; _ = *v` | one error (`undefined: missingVar`) | a second error `cannot dereference non-pointer type any` |
| R3.4 | `xs := []int{1, 2}; _ = xs[window.i]` (`js`) | n/a (JS-dynamic stays permissive) | `index window.i (value of type any) must be integer` |
| R3.5 | `templ Page(v any) { if v { <div hidden?={ v }>hi</div> } }` (`js`) | `non-boolean condition` | no diagnostic (`_checkTemplIf`, `_checkTemplCondAttr` `index.js:1237`) |
| control | `type B interface{}; var b B = 3; var a any = b`; `var q *B = p` | `3`; ok | correct (must stay) |

### R4 `builtin-operands`

Root: `BUILTIN_CHECK` (`expressions.js:81`) checks each builtin ad hoc. `append` tags and boxes each argument but never calls `assertAssignable` against the element type, nor checks a spread argument's slice type (`:96-113`); `len` (`_checkBuiltinLen`, `:2205`), `delete` (`:121`), `clear`, `copy` (`_checkBuiltinCopy`) and `min`/`max` skip unknown operand kinds, and `f(v...)` accepts a Go `any`. Only `cap` has an operand contract (`_capOperandOk`). Depends on Phase 3's classifier to keep JS-dynamic `any` permissive.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R4.1 | `var v any = []int{1}; _ = len(v)` | `invalid argument … for built-in len` | js/both accept; wasm ICE |
| R4.2 *sibling* | `var v interface{} = []int{1}; _ = len(v)` | same | same |
| R4.3 | `_ = append(v, 1)` (`v any`) | `invalid append: argument must be a slice` | js/both accept; wasm ICE |
| R4.4 | `delete(v, 1)` (`v any`) | `v … is not a map` | js/both accept; wasm ICE |
| R4.5 | `f(v...)` (`v any`, `f(xs ...int)`) | `cannot use v … as []int value` | js/both accept; wasm ICE |
| R4.6 | `var s []struct{ X int }; s = append(s, struct{ Y string }{"a"})` | `cannot use struct{Y string}{…} … as struct{X int} value in argument to append` | js/both print `1`; wasm ICE |
| R4.7 *sibling* | `var s []int; s = append(s, "a")` | `cannot use "a" … as int value in argument to append` | js/both print `1`; wasm ICE |
| R4.8 *sibling (review)* | `var v any = []int{1}; clear(v)` | `invalid argument: cannot clear v …: argument must be (or constrained by) map or slice` | accepted on all targets |
| R4.9 *sibling (review)* | `var v any = []int{1}; copy(v, []int{2})` | `invalid copy: argument must be a slice; have v …` | js/both accept; wasm ICE |
| R4.10 *sibling (review)* | `_ = len(5)` | `invalid argument: 5 (untyped int constant) for built-in len` | js/both accept; wasm ICE |
| R4.11 *sibling (review)* | `var v any = 1; _ = min(v, 2)` | `invalid argument: v … cannot be ordered` | js/both accept; wasm ICE (`anyref.lt_s`) |
| R4.12 *sibling (review)* | `a := []int{1}; b := []string{"x"}; _ = append(a, b...)` | `cannot use b (variable of type []string) as []int value in argument to append` | js/both accept; wasm ICE |
| control | `var v interface{} = []int{1}; for range v {}`; `cap(map[int]int{})`; `copy([]int{}, []string{})` | rejected | rejected (must stay) |

### R5 `addressability`

Root: `_checkAssignTarget` (`statements.js:301`) only rejects string elements and map-element paths; there is no general addressability rule (variable, pointer indirection, slice index, field or array element of an addressable operand, composite literal for `&` only). The `&` check (`_checkAddressOfExpr`, `expressions.js:582`) only rejects map elements and `wasm`-specific interiors, and `_reportUnaddressableRecv` (`expressions.js:667`) uses `_isTemporaryOperand` (`:685`), an inverse addressability rule nothing else calls.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R5.1 | `mk().X = 1` | `cannot assign to mk().X (neither addressable nor a map index expression)` | accepted on all targets |
| R5.2 | `P{}.X = 1` | same | accepted |
| R5.3 | `[2]int{1, 2}[0] = 3` | same | accepted |
| R5.4 *sibling* | `mk().X++` | same | accepted |
| R5.5 *sibling* | `mk().X += 1` | same | accepted |
| R5.6 *sibling* | `mk()[0] = 1` (`mk() [2]int`) | same | accepted |
| R5.7 *sibling* | `_ = &mk().X` | `invalid operation: cannot take address of mk().X` | js accepted; both/wasm a `wasm`-specific address error |
| R5.8 *sibling (review)* | `_ = &mk()` (`mk() P`) | `invalid operation: cannot take address of mk() (value of struct type P)` | accepted on all targets |
| R5.9 *sibling (review)* | `for mk().X = range []int{1} {}` | `cannot assign to mk().X (neither addressable nor a map index expression)` | accepted on all targets |
| R5.10 *sibling (review)* | `var y int; mk().X, y = 1, 2` | same | accepted on all targets |
| R5.11 *sibling (review)* | `var i any = P{}; i.(P).X = 1` | `cannot assign to i.(P).X (neither addressable nor a map index expression)` | accepted on all targets |
| R5.12 *sibling (review)* | `mk().A[0] = 1` (`P struct{ A [2]int }`) | `cannot assign to mk().A[0] (…)` | accepted on all targets |
| R5.13 *sibling (review)* | `_ = &[2]int{1, 2}[0]` | `invalid operation: cannot take address of [2]int{…}[0]` | js accepted; both/wasm a `wasm`-specific address error |
| control | `m[1].X = 2`; `mk().Inc()` (pointer method) | rejected | rejected with Go's message (must stay) |
| control | `ptr().X = 1`; `m[1] = 2`; `&P{X: 3}`; `mk()[0] = 7` (`mk() []int`) | `1 2 3`; `7` | same on all targets (must stay) |

### R6 `ad-hoc-type-structure`

Root: checks re-derive type structure locally. 51 sites in `src/typechecker` take one level of `named ? t.underlying : t` against 25 `_deepUnderlying` calls, so a type defined over another named type (`type A I`) loses its kind; `_checkForCond` tests `ct?.kind === "func"` on the named type (`statements.js:600`); `_sameStructFields` (`expressions.js:1235`) compares `t.fields` (which includes promoted fields) name by name instead of `identical` ignoring tags. The backends re-derive it too (about 49 one-level sites in `src/backend` and `src/lower`): `isStringRangeType` (`src/lower/range.js:110`, called by `src/backend/js/statements.js:1554`) only accepts `basic`/`untyped` string, so JS range over a defined string type falls through to byte indexing instead of rune decoding; `_getArrayElemType` (`src/backend/wasm/emit.js:1600`) looks a named type up by its own name when `underlying` is itself named, so `type A B` recurses forever on `wasm`.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R6.1 | `type I interface{ M() }; type A I; var a A; _ = a.(S)` | ok | `invalid type assertion: A is not an interface` |
| R6.2 *sibling* | `var a A = S{}` (same types) | ok (`true`) | `Cannot assign S to A` |
| R6.3 | `type MyFunc func(int); var fn MyFunc; for range fn {}` | `cannot range over fn … func must be func(yield func(...) bool)` | js/both accept; wasm ICE (`Maximum call stack size exceeded`) |
| R6.4 | `type E struct{ V int }; var a struct{ E }; b := struct{ E E }(a)` | `cannot convert a … to type struct{E E}` | js/both `TypeError … '__clone'`; wasm ICE |
| R6.5 | `type Word string; for i, r := range Word("ab") { fmt.Printf("%v:%c ", i, r) }` | `0:a 1:b` | js/both `0:� 1:�` (`"é"` gives rune `-9223372036854775808`); wasm correct |
| R6.6 *sibling (review)* | `type F func(); type G F; var g G = func() { fmt.Println("hi") }; g()` | `hi` | `Cannot assign func() void to G` |
| R6.7 *sibling (review)* | `type Seq func(func(int) bool); type Seq2 Seq; var s Seq2 = func(y func(int) bool) { y(1) }; for v := range s { … }` | `1` | `Cannot assign func(func(int) bool) void to Seq2` |
| R6.8 *sibling (review)* | `type A B; type B C; type C []int; var s A = A{1, 2}; fmt.Println(len(s))` (also `append`, `range`, `[]int(s)`) | `2` | js/both correct; wasm ICE (`Maximum call stack size exceeded` in `_getArrayElemType`) |
| control | `type M1 map[int]int; type M2 M1` (index, `delete`, `len`) | `0` | correct on all targets (must stay) |

### R7 `range-int-operand`

Root: range over an integer or constant operand (`_rangeOperandError`, `expressions.js:1511`, called from `statements.js:593`) checks neither the variable count nor that a constant operand is of integer kind. Go requires an untyped constant operand to be an untyped integer or rune constant: an untyped float constant is rejected even when its value is integral (`3.0`, `1e3`).

| ID | Program | Go | GoFront |
|---|---|---|---|
| R7.1 | `for i, v := range 3 {}` | `range over 3 (untyped int constant) permits only one iteration variable` | js/both accept; wasm ICE (`Unresolved identifier: v`) |
| R7.2 | `const k = 2.0; for i := range k {}` | `cannot range over k (untyped float constant 2)` | js/both print `0 1`; wasm ICE |
| R7.3 *sibling (review)* | `const n = 3.0; for i := range n {}` | `cannot range over n (untyped float constant 3)` | js/both print `012`; wasm ICE |
| R7.4 *sibling (review)* | `for range 1e3 { c++ }` | `cannot range over 1e3 (untyped float constant 1000)` | accepted on all targets (prints `1000`) |
| R7.5 *sibling (review)* | `n := 3; for i, v := range n {}` | `range over n (variable of type int) permits only one iteration variable` | js/both accept; wasm ICE (`Unresolved identifier: v`) |
| control | `const k float64 = 2; for i := range k {}` | `cannot range over k (constant 2 of type float64)` | rejected on all targets (must stay) |

### R8 `predeclared-scope`

Root: predeclared names win over user declarations. `mangleLocalTypes` (`src/compiler.js:737`) only reserves `BASIC_TYPES` (`:744`), so a local `type error` (or a local type named after an import, R8.6) is not renamed and leaks package-wide; in `renameLocalTypes` (`src/link/type-names.js:47`, rename loop `:76-90`), an outer block's `renameTypeRefs` walks into nested blocks without stopping at a nested `TypeDecl` of the same original name, overwriting the inner `TypeDecl`'s fresh `__L<n>` name with the outer one; `resolveTypeNode` (`src/typechecker/resolve.js:244`) checks `BASIC_TYPES[node.name]` (`:248`, including `any`) before `scope.lookup`/`this.types`, so package-level `type int32 = string` resolves to `int32`; and when `func len()` or `len :=` shadows a builtin, the checker already does not set `expr._builtinName`, but JS and WASM codegen (`_genBuiltinIdent` from `genCall`, `src/backend/js/expressions.js:2183`; `src/backend/wasm/emit-builtins.js:1080`; `src/backend/wasm/prescan.js:88`) dispatch on the callee name instead of `expr._builtinName`. Universe `error` is an entry in the package's `this.types` map (`src/typechecker/index.js:146`), so a package-level `type error` replaces it for every file of the package: the generated `gofront_gen.go` spells `error` in its wrapper signatures (`src/lower/fmt-formatters.js:66-75`) and `wasm` looks it up by name (`src/backend/wasm/index.js:1082`, plus `t.name === "error"` tests in `src/backend/wasm/` and `src/lower/`).

| ID | Program | Go | GoFront |
|---|---|---|---|
| R8.1 | `func f1() { type error struct{ Msg string }; … }; func f2() error { return MyErr{} }` | `e` | `Cannot assign MyErr to error` |
| R8.2 | `type int32 = string; var a int32 = "hi"; { type int32 = bool }; var c int32 = a` | `hi` | `Cannot assign string to bool` |
| R8.3 | package-level `type int32 = string; var x int32 = "a"` | `a` | `Cannot assign untyped string to int32` |
| R8.4 | `func len() int { return 1 }; fmt.Println(len())` | `1` | ICE (`reading '_asComplex'`; wasm `'_type'`) |
| R8.5 | `len := func() int { return 1 }; fmt.Println(len())` | `1` | same ICE |
| R8.6 (L4) | `import "strings"; func other() int { type strings = int; var x strings = 3; return x }; fmt.Println(other(), strings.ToUpper("ab"))` (also `type strings int`) | `3 AB` | `int has no field or method 'ToUpper'` on all targets |
| R8.7 *sibling (review)* | `func max(a, b int) int { return a }; fmt.Println(max(1, 2))` | `1` | `2` on all targets (silent: calls the builtin) |
| R8.8 *sibling (review)* | `func append(x int) int { return x + 1 }; fmt.Println(append(1))` | `2` | js/both print `1`; wasm ICE |
| R8.9 *sibling (review)* | `func println(s string) {}; println("x")` | no output | prints `x` on all targets |
| R8.10 *sibling (review)* | package-level `type any = int; var x any = 3; fmt.Println(x + 1)` | `4` | `operator + not defined on x (variable of type any)` |
| R8.11 *sibling (review)* | package-level `type error int; var e error = 3; fmt.Println(e)` (also with `_ = e; fmt.Print("")`) | `3` | `internal error in the generated Go … Cannot assign error to error` on all targets (`fmt.Print` form: js/both correct, wasm ICE, invalid module) |
| control | `func f(len int) int { return len }`; `copy := 5`; `new := 2`; local `type any = int` | `4`; `5`; `2`; `4` | correct on all targets (must stay) |

### R9 `generic-body-check`, `generic-func-value`

Root (R9.1–R9.2, R9.4–R9.8): `_binaryResultTypeTypeParam` (`assignability.js:120`) returns the type parameter for every arithmetic and ordered-comparison operator without checking the constraint's type set, so a generic body is only checked per instance (wasm monomorph) or never (js). This covers every operator, not only the integer-only ones: `+` needs every term numeric or string, `-`/`*`/`/` numeric, `%`/`&`/`|`/`^`/`&^` integer, a shifted operand integer, `<`/`<=`/`>`/`>=` ordered; a constraint with no type terms (`any`, `comparable`, method-only) allows none of them. Unary `-` on a type parameter already checks its terms. Root (R9.3, R9.9–R9.10): `_checkInstantiationExpr` (`src/typechecker/expressions.js:1555`) does not run constraint type inference (`_inferFromCoreTypes` in `src/typechecker/resolve.js:921`) when a generic function with multiple type parameters (`slices.Sort[S ~[]E, E cmp.Ordered]`) is partially instantiated as a value (`slices.Sort[[]int]`), leaving `expr._typeArgs` with 1 entry instead of 2 (`E` falls back to `undefined` in JS `_typeArgFactories` and `ANY` in WASM `monomorph.js:786`). User generics take the same path: the missing `E` is `any`, so its zero value prints `<nil>` (R9.9).

| ID | Program | Go | GoFront |
|---|---|---|---|
| R9.1 | `func M[T ~int \| ~float64](a, b T) T { return a % b }; M(5.5, 2.0)` | `operator % not defined on a (variable of type T constrained by N)` | js/both print `1.5`; wasm ICE |
| R9.2 *sibling* | same `M`, never called | same error | accepted on all targets |
| R9.3 | `f := slices.Sort[[]int]; f(xs)` | `[1 2]` | js/both ICE (`reading 'kind'`); wasm ICE in `cmp.go` |
| R9.4 *sibling (review)* | `func A[T any](a, b T) T { return a + b }` (unused) | `operator + not defined on a (variable of type T constrained by any)` | accepted on all targets |
| R9.5 *sibling (review)* | `func A[T ~int \| ~string](a, b T) T { return a - b }` (unused) | `operator - not defined on a (… constrained by ~int \| ~string)` | accepted on all targets |
| R9.6 *sibling (review)* | `func A[T comparable](a, b T) bool { return a < b }` (unused) | `invalid operation: a < b (type parameter T cannot use operator <)` | accepted on all targets |
| R9.7 *sibling (review)* | `func A[T ~int \| ~float64](a T) T { return a << 1 }` (unused) | `shifted operand a (… constrained by ~int \| ~float64) must be integer` | accepted on all targets |
| R9.8 *sibling (review)* | `func A[T ~int \| ~float64](a, b T) T { a %= b; return a }` (unused) | `operator % not defined on a (…)` | accepted on all targets (reaches `binaryResultType` once Phase 2 lands) |
| R9.9 *sibling (review)* | `func Z[S ~[]E, E any](s S) E { var z E; return z }; f := Z[[]int]; fmt.Println(f([]int{3}))` | `0` | `<nil>` on all targets (silent) |
| R9.10 *sibling (review)* | `f := slices.Index[[]int]; fmt.Println(f([]int{4, 5}, 5))` | `1` | js/both ICE (`reading 'kind'`); wasm correct |
| control | `slices.Sort[[]int](xs)` (call); `slices.Sort[[]int, int]` (value); `-a` with `T ~int \| ~string`; `M[T ~int \| ~int64]` with `%` | `[1 2]`; `[1 2]`; `operator - not defined`; ok | correct on all targets (must stay) |

### R10 `forwarded-tuple`, `node-positions`, `error-classification` (diagnostics only)

| ID | Root | Program / probe | Want | Got |
|---|---|---|---|---|
| R10.1 | `forwarded-tuple` | `func f() (float64, float64); func g(a, b int); g(f())` | `cannot use f() (value of type float64) as int value in argument to g` at `9:3` | `cannot use expression …` twice, no line:col (`_checkNumericCoercion`, `assignability.js:914`) |
| R10.2 | `forwarded-tuple` | `func f() { return g() }` (`g` returns 2) | `too many return values (have (int, string), want ())` | `(have 1, want 0)` |
| R10.3 | `node-positions` | parse `example/gom/src/types.go`, walk `ConstDecl` `BasicLit`s | `_line`/`_col` set | 5 of 5 missing (`parseConstDecl` `iota` substitution) |
| R10.4 | `node-positions` | `switch x := v.(type)` → `caseScope.localNode("x")` | declaring `Ident` | `null` (`defineLocal(stmt.assign, bindType)` without a node, `statements.js:800`) |
| R10.5 | `node-positions` | `func fn(int) {}; for x := range fn {}` | line:col `8:16` | no position (`_checkRangeIterInvalidFunc`, `statements.js:873`) |
| R10.6 | `error-classification` | `css bad(x string) { color: red; }` (`.templ`) | `CompileError` (unsupported) | `InternalCompilerError` (`genCssDecl` throws `Error`, `src/backend/js/templ.js:35`) |
| R10.7 | `error-classification` | `compileWasm("…_ = f + 1i…")` (`src/compiler.js:763`) | `InternalCompilerError` (module fails `WebAssembly.validate`) | `{ errors: [] }`, `validate(wasm) === false` |
| R10.8 | `error-classification` | R9.1 on `wasm` | `CompileError` | `InternalCompilerError` (`monomorph.js` re-check throws `Error`); fixed by R9.1, kept as a regression test |

### Review follow-ups (2026-11-18)

Scheduled from `plans/follow-ups.md`; each repro re-probed on `feat/checker-go-rules` at `a6767693` plus Phase 9 unmerged (`#242`, `a050ed96`) unless noted. Entry *Generic type declared over a struct type* no longer reproduces (`Pair[string, int](Named[int]{…})` compiles); deleted.

#### R11 `generic-body-check` (operand side)
Root: `_checkTypeParamOperator` and `_binaryResultTypeTypeParam` (`assignability.js`) look only at the operand that is a type parameter. The other operand is never converted to (untyped) or matched with (typed) the type parameter, an untyped left operand of a shift is typed as the count, and unary `!` tests `isBool` without the type set.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R11.1 | `func F[T ~int](a T, b int) T { return a + b }` | `mismatched types T and int` | accepted (js/wasm) |
| R11.2 *sibling* | same with `a + 1.5`; `T ~int \| ~float64` with `a + 1.5` stays valid; `func F[T ~int8](a T) T { return a + 200 }` | `cannot convert 1.5 (untyped float constant) to type T`; ok; `cannot use 200 … overflows` | accepted |
| R11.3 *sibling* | `func F[T ~bool](a T, b int) T { return a && b }`; `a == b` with `b int` | `mismatched types` | accepted |
| R11.4 | `func F[T ~uint8](s T) int { return 1 << s }; F(uint8(10))` | `1024` | js prints `0`; wasm panics `Error: 10` |
| R11.5 *sibling* | `1.5 << s`, `"a" << s` with `s T ~uint` | `shifted operand … must be integer` | accepted |
| R11.6 | `func F[T ~bool](a T) T { return !a }` | accepted | `! requires bool` |
| control | `a + b` (both `T`), `1 << s` with `s T ~uint` printed through `%T` → `int`, `a << 1`, `!a` with `T ~bool \| ~int` rejected | as Go | correct (must stay) |

#### R12 `builtin-type-param-constraints`
Root: the operand checks of `len`, `cap`, `clear`, `delete`, `append`, `copy`, `min`, `max` (`expressions.js:_lenOperandOk`, `_appendOperandOk`, `_checkDeleteOperand`, `_checkClearOperand`, `_orderedOperandOk`) return early for a `typeParam`, so a generic body is not checked against the type set.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R12.1 | `func f[T any](v T) int { return len(v) }` | `invalid argument: v (variable of type T constrained by any) for built-in len` | accepted (js/wasm) |
| R12.2 *sibling* | `append(v, 1)`, `delete(v, 1)` with `T any`; `min(a, b)` with `T any` | `invalid argument … for built-in append` / `delete` / `invalid argument: a … cannot be ordered` | accepted |
| control | `len(v)` with `T ~[]int \| ~string`; `cap(v)` with `T ~int` | ok; `invalid argument` | correct (must stay) |

#### R13 `comparable-constraint`
Root: `resolve.js:checkConstraint` returns early for `comparable`, so no type argument is ever checked against it, whether explicit, inferred at a call, or inferred in a partial instantiation.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R13.1 | `func c[C comparable](x C) {}; type P struct{ S []int }; c(P{})` | `P does not satisfy comparable` | accepted |
| R13.2 *sibling* | `c(map[int]int{})`; `c(func(){})`; `c[[]int](nil)` | `… does not satisfy comparable` | accepted |
| R13.3 *sibling* | `func g[T any](x T) { c(x) }` | `T does not satisfy comparable` | accepted |
| R13.4 *sibling* | `Pair[int](1, func(){})` with `B comparable`; `_ = slices.Index[[]func()]` | `func() does not satisfy comparable` | accepted (js ICE on the second without Phase 9) |
| control | `c(e)` with `e error` (interface types satisfy `comparable` since Go 1.20) | ok | correct (must stay) |

#### R14 `ad-hoc-type-structure` (generic types over a struct)
Root: `index.js:_genericUnderlyingOver` leaves the defined type in place for `type W[T any] S[T]` (JS has no class for it), so every read of `.underlying` one level deep sees a named type.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R14.1 | `type S[T any] struct{ X T }; type W[T any] S[T]; var w W[int]; w.X = 42; fmt.Println(w.X)` | `42` | js/both `Cannot set properties of null` |
| R14.2 *sibling* | `type S[T any] struct{ P *T }; type W[T any] S[T]; var s []W[int]; var a any = s` | `__ifs(s, ["P"])` as for `[]S[int]` | `__ity(s, …)` without the pointer-field list |
| control | `W[int](s)`, `W[int]{X: 3}`, `[]W[int]` asserted back from `any` (runtime) | `1`, `3 {3}`, `1` | correct on all targets (must stay) |

#### R15 `empty-interface-kinds` (condition text)
Root: `statements.js:_checkIfStmt` and `_checkForCond` word the error themselves for every non-boolean type.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R15.1 | `x := 1; if x {}`; `type MyAny any; var v MyAny; if v {}` | `non-boolean condition in if statement` | `If condition must be bool` |
| R15.2 *sibling* | `for v {}` with the same `v`; `var v any; if v {}` | `non-boolean condition in for statement` | `For condition must be bool`; `non-boolean condition in if statement` for plain `any` (correct) |
| control | `switch { case v: }`, `_ = v && true`, `_ = !v` with `v MyAny` | Go's messages | already Go's wording (must stay) |

#### R16 `predeclared-scope` (constants)
Root: `src/lexer/tokens.js` makes `true`, `false` and `nil` keyword tokens, so no declaration form can name them.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R16.1 | `func main() { true := 1; fmt.Println(true) }`; same with `nil` | `1` | `'[object Object]' declared and not used` |
| R16.2 *sibling* | `func f(false int) int { return false }`; `var true = 5`; `const true = 1`; `type S struct{ nil int }; s.nil`; `for nil := range 2` | their values | `Parse error: Expected type, got 'false'`; `expected 'IDENT'` (x3); `'[object Object]' declared and not used` |
| control | `x := true; y := nil` uses | universe values | correct (must stay) |

---

## Approach

### 1. Architecture & Design Decisions
- **Untyped conversion (R1).** Add `convertUntyped(t, target, node)` in `src/typechecker/assignability.js`: given an untyped constant or `nil` operand and a typed target, report Go's error when the kind does not fit (`mismatched types T and untyped K` for comparison operands, `cannot use nil as T value` for assignment, overflow for constants) and otherwise record the converted type on the node (`_type`), which the backends already read. Call it from `_binaryResultTypeCmp` (both orders), `_binaryResultTypeComplex`/`Numeric` for the untyped side, `checkShiftCount` (records the count as `uint` on `expr.right`, fixing R1.4 on wasm without backend changes), duplicate-case collection (convert each case to the tag type before comparing), `assertAssignable` for `nil` into a type parameter (nilable only if every type in the core type set is), and the both-untyped case (`nil == nil` has no type to convert to: Go's `operator == not defined on untyped nil`). `defaultType(untyped nil)` returns `null`, and `:=`/`var`/`const` (`src/typechecker/statements.js`, `src/typechecker/index.js`) report Go's message.
- **Operator typing (R2).** `_checkIncDecStmt` checks `x + 1` and the compound path checks `x op y` through `binaryResultType` with a synthetic `BinaryExpr` node positioned at the statement, so every operator rule applies to all three forms. The synthetic node carries the statement's spelling (`x++`, `a += t`) so messages read as Go's (`invalid operation: s++ (non-numeric type string)`, `invalid operation: a += t (mismatched types S and string)`). For `op=` the operand check replaces the rhs-to-lhs `assertAssignable` (`statements.js:397`) instead of adding to it, so one statement reports one error; `_checkCompoundIntegerOnly` and the operator part of `_checkDeclaredAnyOperator` fold into `binaryResultType`. `_binaryResultTypeString` and `_binaryResultTypeComplex` call `_checkIdenticalOperands` and return the typed operand's type (defined types survive).
- **Empty-interface kinds (R3).** One function `anyKind(t)` in `src/typechecker/types.js` returns `"dynamic"` (JS-dynamic `ANY`), `"go"` (`DECLARED_ANY`, `interface{}`, a defined type whose underlying is any of these), `"tainted"` (error recovery), or `null`. Identity keeps defined empty interfaces distinct (`*B` vs `*any`). Every ad-hoc test (`ot === ANY`, `NON_INTEGER_BASICS` `"any"`, templ conditions, `_declared` checks for operators) goes through it; JS-dynamic stays permissive everywhere.
- **Builtin operands (R4).** Each `BUILTIN_CHECK` entry validates its operand kinds from a small contract table (`len`/`cap`: string, array, pointer to array, slice, map, chan, extending the existing `_capOperandOk`; `append`: slice + `assertAssignable(elem, arg)` per element, `assertAssignable(slice, arg)` for `append(s, t...)`; `delete`: map; `clear`: map or slice; `copy`: slice destination (`_checkBuiltinCopy` keeps its element check); `min`/`max`: ordered; spread: slice), rejecting Go `any` (`anyKind === "go"`) with Go's message and accepting `"dynamic"`.
- **Addressability (R5).** `_isAddressable(expr)` in `src/typechecker/expressions.js` per the spec (variable; `*p`; slice index; field selector or array index of an addressable operand; field through a pointer). `_checkAssignTarget` uses it for `=`, `op=` and `++` (keeping the map-index exception and existing messages), and the `&` operand check uses it with the composite-literal exception. `_reportUnaddressableRecv` delegates to it and `_isTemporaryOperand` (its inverse) is deleted. Range assignments (`for x.F = range`) and tuple assignments go through `_checkAssignTarget` too. The JS backend's `_isAddressableExpr` (`src/backend/js/expressions.js:1143`) is a codegen decision on already-checked code and is left unchanged.
- **Type structure (R6).** Replace one-level `named ? t.underlying : t` with `_deepUnderlying` in the assertion, assignability-to-interface, conversion and range-condition paths that the gaps hit, then sweep the remaining sites across `src/typechecker/` (51 one-level sites at baseline). `_sameStructFields` is replaced by `identical(a, b, { ignoreTags: true })` over declared fields. Backends (Phase 10): `isStringRangeType` in `src/lower/range.js` unwraps named types (loop over `named.underlying`) so JS range over a defined string decodes runes, and the `wasm` element/size lookups (`_getArrayElemType`, `_getArraySize` in `src/backend/wasm/emit.js`) loop over `underlying` instead of re-resolving a type by its own name; the other backend one-level sites the Phase 10 fixture reaches are fixed the same way.
- **Range integers (R7).** `_checkForCond` rejects a second iteration variable when the operand's core type is an integer (constant or variable), and `_rangeOperandError` rejects a constant operand that is not of integer kind: an untyped float constant is rejected even when its value is integral (`3.0`, `1e3`), as Go does; an untyped rune constant is an integer.
- **Predeclared scope (R8).** `mangleLocalTypes` (`src/compiler.js`) reserves every predeclared type name (`error`, `any`, `comparable`, the basic names) and the package's import names; in `renameLocalTypes` (`src/link/type-names.js`), `renameTypeRefs` stops at nested blocks that redeclare the same local type name so inner `__L<n>` names are preserved. In `resolveTypeNode` (`src/typechecker/resolve.js`), `scope.lookup` and `this.types.get` precede `BASIC_TYPES[node.name]`, so user declarations of `int32` shadow the predeclared type. In JS and WASM codegen (`src/backend/js/expressions.js`, `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/prescan.js`), builtin call emission gates on `expr._builtinName` so user functions or variables named after builtins (`len`, `cap`, `min`, `max`, `append`, `println`, `copy`, etc.) emit as ordinary calls. Universe `error` (Phase 14) stays the `ERROR` object for stdlib signatures and backends whatever the package declares: generated Go (`src/lower/fmt-formatters.js` and the other `gofront_gen.go` generators) does not spell a universe name the package shadows, and `wasm` identifies the universe `error` by identity (`=== ERROR`), not by `types.get("error")` or `t.name === "error"`.
- **Generics (R9).** `_binaryResultTypeTypeParam` checks the operator against every term of the constraint's type set, with the same per-operator rule `binaryResultType` applies to a concrete operand (`+`: numeric or string; `-`/`*`/`/`: numeric; `%`/`&`/`|`/`^`/`&^`/shifted operand: integer, reusing `_checkIntegerOnlyOperator`; `<`…`>=`: ordered); a constraint with no type terms allows only `==`/`!=` (and only when comparable). It reports Go's message once at the definition. When an `InstantiationExpr` instantiates a generic function with fewer explicit type arguments than type parameters (`slices.Sort[[]int]`), `_checkInstantiationExpr` infers the remaining type parameters from constraint core types (`_inferFromCoreTypes` in `src/typechecker/resolve.js`) and records the complete `_typeArgs` list on `expr` and `expr.expr`, for stdlib and user generics alike.
- **Diagnostics (R10, Phases 11–13).** Forwarded tuple arguments and returns carry the call node (`_fwdIface` positions) and the tuple's arity; `parseConstDecl` copies the `iota` token position to substituted literals; the type-switch binding passes its `Ident`; `_checkRangeIterInvalidFunc` takes the range node. `genCssDecl` throws `UnsupportedError`; `compileWasm` runs `validateWasm`.

### 2. Invariants & Safety Bounds
- A program Go accepts and GoFront compiles today prints the same output on every target, except the fixed miscompiles (R1.4 on wasm, R2.7 on js/both, R6.5, R8.7–R8.9, R9.9).
- JS-dynamic `any` values (browser globals, `.d.ts` declarations, untyped imports) stay permissive: every new rejection applies only to `anyKind === "go"`.
- Emitted code for programs without the affected forms is byte-identical; `bundle-size`, `zero-alloc` and `bce-mathx` gates unchanged.
- `example/` and `stdlib/` compile unchanged (`npm run check`, stdlib build); if a rejection hits them, the phase fixes the call site and lists it in the release note.

### 3. Edge Cases & Error Handling
- **R1:** `x == nil` stays valid for pointers, slices, maps, chans, funcs and interfaces (including type parameters whose core types are all nilable). An untyped rune compares with any integer type. Untyped float constants that are exactly integers convert to integer targets (`x << 1.0`).
- **R2:** `s += "x"` on a defined string stays valid (R2.6). `x++` on a type parameter with a numeric constraint stays valid. `i += f` reports one error (the operand mismatch), not also an assignment error. A shift `x <<= n` keeps its own count rule (the count is not converted to `x`'s type).
- **R3:** `type MyAny any` behaves as Go `any` in operators and builtins (rejected), but is a distinct defined type for identity, like Go.
- **R5:** `m[k] = v` and `p.X = v` through a pointer result (`ptr().X = 1`) stay valid; `&T{}` stays valid; `mk()[0] = v` stays valid when `mk` returns a slice (a slice index is addressable).
- **R7:** `for i := range 'a'` (untyped rune) and `const n = 3; for i := range n` stay valid.
- **R8:** a local `type error` must not change the `error` seen by other functions or by `errors.New`; a package-level `type error` changes it for that package's own code only, never for stdlib signatures or the generated `gofront_gen.go`; method sets of user types named after predeclared types are unaffected; a parameter or local named after a builtin (`len`, `copy`, `new`) keeps working.
- **R9:** a generic body that uses `%` under a constraint whose terms are all integers stays valid; `+` under `~int | ~string` stays valid; the error appears once per definition, not per instance.

---

## Implementation Tasks

### Phase 1: Untyped operand conversion (root `untyped-conversion`)
- [x] Task 1.1: `convertUntyped` for comparison, arithmetic and type-parameter `nil` operands (R1.1–R1.3, R1.8–R1.11, R1.13, R1.14)
  - Files: `src/typechecker/assignability.js`
  - Test: reject fixtures `untyped_cmp_rune_string.go`, `untyped_cmp_string_int.go`, `untyped_complex_to_float.go`, `nil_type_param.go`, `nil_cmp_struct.go`, `nil_cmp_array.go`, `nil_cmp_int.go`, `nil_cmp_nil.go`, `untyped_cmp_ordered_string.go`; accept fixtures for nilable `== nil` on pointer/slice/map/func/interface/type param and `func f[T *int | []int]() T { return nil }`
  - Done when: each reject case reports Go's message on its line on all targets; no wasm ICE
- [x] Task 1.2: Untyped `nil` has no default type in `:=`, `var` and `const` (R1.5–R1.7)
  - Files: `src/typechecker/types.js` (`defaultType`), `src/typechecker/statements.js`, `src/typechecker/index.js` (`checkVarDecl`, `checkConstDecl`)
  - Test: reject fixtures `nil_var_decl.go`, `nil_const.go`, `nil_define.go`
  - Done when: Go's messages on all targets (both package-level and function-local `var`/`const`)
- [x] Task 1.3: Constant shift counts and duplicate cases use the converted type (R1.4, R1.12)
  - Files: `src/typechecker/assignability.js` (`checkShiftCount`), `src/typechecker/statements.js` (duplicate cases)
  - Test: `test/unit/types/numeric-operands.test.js` `x << 1.0` prints `2` on all targets; reject fixture `dup_case_float32.go`
  - Done when: both pass on all targets

### Phase 2: One operator typing path (root `operator-typing`)
- [x] Task 2.1: String and complex results keep defined types and require identical operands (R2.1–R2.3)
  - Files: `src/typechecker/assignability.js`
  - Test: `test/unit/types/numeric-operands.test.js` R2.1 (`xy`), R2.3 (`(0+3i)`) with `assertOutput`; reject fixture `defined_string_mismatch.go`
  - Done when: all targets give Go's result
- [x] Task 2.2: `x op= y` and `x++` type through `binaryResultType` (R2.4, R2.5, R2.7–R2.10)
  - Files: `src/typechecker/statements.js`, `src/typechecker/assignability.js` (folding `_checkCompoundIntegerOnly`)
  - Test: reject fixtures `compound_shift_float.go`, `incdec_empty_interface.go`, `compound_add_bool.go`, `incdec_string.go`, `compound_defined_string_mismatch.go`, `compound_int_float.go`; `test/unit/types/errors.test.js` asserts `i += f` (R2.10) reports exactly one error; R2.6 and `c %= 2` controls and the existing `any_compound_assign.go`/`any_compound_shift_count.go` cases unchanged
  - Done when: `_checkIncDecStmt` and the compound path call `binaryResultType` and no longer call `assertAssignable` for the rhs of `op=`; all conformance cases pass

### Phase 3: Empty-interface kinds (root `empty-interface-kinds`)
- [x] Task 3.1: `anyKind(t)` and identity of defined empty interfaces (R3.1, R3.2)
  - Files: `src/typechecker/types.js`, `src/typechecker/assignability.js`
  - Test: `test/unit/types/dynamic-types.test.js` R3.1 prints `2`; reject fixture `ptr_defined_empty_iface.go`; controls `var a any = b`, `var q *B = p` pass
  - Done when: all targets give Go's result
- [x] Task 3.2: Route ad-hoc `any` tests through `anyKind` (R3.3–R3.5)
  - Files: `src/typechecker/expressions.js`, `src/typechecker/index.js` (templ conditions)
  - Test: `test/unit/types/errors.test.js` R3.3 reports exactly one error; `dynamic-types.test.js` R3.4 compiles on `js`; `test/unit/compiler/templ.test.js` R3.5 reports `non-boolean condition`
  - Done when: `grep -rn "ot === ANY" src/typechecker` is empty and `NON_INTEGER_BASICS` has no `"any"`

### Phase 4: Builtin operand contracts (root `builtin-operands`)
- [x] Task 4.1: `len`, `cap`, `delete` and spread check operand kinds (R4.1, R4.2, R4.4, R4.5, R4.10)
  - Files: `src/typechecker/expressions.js`
  - Test: reject fixtures `builtin_len_any.go`, `builtin_len_empty_iface.go`, `builtin_len_int.go`, `builtin_delete_any.go`, `spread_any.go`; accept JS-dynamic `len(window.x)` on `js`
  - Done when: Go's messages on all targets, no wasm ICE
- [x] Task 4.2: `append` checks its slice, element and spread assignability (R4.3, R4.6, R4.7, R4.12)
  - Files: `src/typechecker/expressions.js`
  - Test: reject fixtures `append_any.go`, `append_elem_struct.go`, `append_elem_string_to_int.go`, `append_spread_mismatch.go`; accept `append([]struct{ X int }{}, A{5})` (assignable; its `wasm` codegen is `wasm-struct-types-plan.md` W1.8, so the accept case runs `js`/`both` until that lands) and `append(b, "x"...)` on `[]byte`
  - Done when: Go's messages on all targets
- [x] Task 4.3: `clear`, `copy`, `min` and `max` check operand kinds (R4.8, R4.9, R4.11)
  - Files: `src/typechecker/expressions.js`
  - Test: reject fixtures `builtin_clear_any.go`, `builtin_copy_any.go`, `builtin_min_any.go`; the existing `copy`/`min`/`max` accept cases unchanged
  - Done when: Go's messages on all targets, no wasm ICE

### Phase 5: Addressability (root `addressability`)
- [x] Task 5.1: `_isAddressable` and assignment targets (R5.1–R5.6, R5.9–R5.12)
  - Files: `src/typechecker/expressions.js`, `src/typechecker/statements.js`
  - Test: reject fixtures `assign_call_field.go`, `assign_lit_field.go`, `assign_lit_elem.go`, `incdec_call_field.go`, `opassign_call_field.go`, `assign_call_array_elem.go`, `range_assign_call_field.go`, `tuple_assign_call_field.go`, `assign_assert_field.go`, `assign_call_field_elem.go`; controls `m[k] = v`, `ptr().X = 1`, `mk()[0] = 1` on a slice result, `m[1].X = 2` (existing message)
  - Done when: Go's message on all targets; existing addressable fixtures pass
- [x] Task 5.2: `&` and method receivers use `_isAddressable` (R5.7, R5.8, R5.13)
  - Files: `src/typechecker/expressions.js`
  - Test: reject fixtures `addr_call_field.go`, `addr_call.go`, `addr_lit_elem.go` (Go's message on all targets, before the `wasm` address rule); `&T{}` and existing `addressable_*` fixtures pass
  - Done when: `_reportUnaddressableRecv` and the `&` check call `_isAddressable`; `_isTemporaryOperand` is deleted

### Phase 6: Type structure through shared helpers (root `ad-hoc-type-structure`)
Checker only; the backend sites are Phase 10. The phase spans 8 files because Task 6.3 is a mechanical one-expression substitution per site.
*After Task 15.3 (2026-11-18) a defined type's `underlying` is no longer a defined type, so a one-level lookup already reaches the underlying type: R6.1, R6.2, R6.6 (Task 6.1), R6.7 (Task 6.2) and R6.8 (Task 10.2) give Go's result on all targets (fixtures under Task 15.3). Still open here: R6.3 and R6.4 (Task 6.2), which are not chain defects, and the lookups a generic type declared over a struct type needs (the one case that keeps a defined `underlying`). Task 6.3's sweep is then tidying, not a fix.*
- [x] Task 6.1: Defined types over named types use `_deepUnderlying` in assertions, assignability and expressions (R6.1, R6.2, R6.6)
  - Files: `src/typechecker/expressions.js`, `src/typechecker/assignability.js`, `src/typechecker/constants.js`
  - Test: `test/unit/types/identity.test.js` R6.1/R6.2 print `true`, R6.6 prints `hi`
  - Done when: all targets print Go's output; one-level underlying lookups in `expressions.js`, `assignability.js` and `constants.js` are replaced or documented
- [x] Task 6.2: Range condition and struct conversion use the underlying type and `identical` (R6.3, R6.4, R6.7)
  - Files: `src/typechecker/statements.js` (`_checkForCond` and remaining one-level lookups), `src/typechecker/expressions.js` (`_sameStructFields` → `identical`), `src/typechecker/stdlib/shared.js`
  - Test: reject fixtures `range_defined_func.go`, `convert_embedded_vs_named_field.go`; accept fixture `range_func_defined_over_defined.go` (R6.7 prints `1`)
  - Done when: Go's results on all targets, no ICE
- [x] Task 6.3: Sweep remaining one-level underlying lookups in `types.js`, `index.js` and `resolve.js`
  - Files: `src/typechecker/types.js`, `src/typechecker/index.js`, `src/typechecker/resolve.js`
  - Test: `test/unit/types/identity.test.js` checks (no codegen) that the chain `type A B; type B C; type C []int` type-checks in `len`, `range`, index, conversion and `append`; the all-target fixture is Task 10.2
  - Done when: `grep -rn 'kind === "named" ? [a-zA-Z.]*\.underlying' src/typechecker` lists only sites with a comment saying why one level is intended

### Phase 7: Range over integers (root `range-int-operand`)
- [x] Task 7.1: Range over an integer permits one iteration variable (R7.1, R7.5)
  - Files: `src/typechecker/statements.js` (`_checkForCond`)
  - Test: reject fixtures `range_int_two_vars.go`, `range_int_var_two_vars.go`; accept `for i := range 3` and `n := 3; for i := range n`
  - Done when: Go's messages on all targets, no wasm ICE
- [x] Task 7.2: A constant range operand must be of integer kind (R7.2–R7.4)
  - Files: `src/typechecker/expressions.js` (`_rangeOperandError`), `src/typechecker/statements.js`
  - Test: reject fixtures `range_float_const.go` (`const k = 2.0`), `range_float_const_integral.go` (`const n = 3.0`), `range_float_lit.go` (`range 1e3`); accept `for i := range 'a'` and `const n = 3; for i := range n`; the `const k float64 = 2` control stays rejected
  - Done when: Go's messages on all targets, no wasm ICE

### Phase 8: Predeclared names can be shadowed (root `predeclared-scope`)
- [x] Task 8.1: Local types named after predeclared types or imports and nested local types are renamed per block (R8.1, R8.2, R8.6)
  - Files: `src/compiler.js` (`mangleLocalTypes`), `src/link/type-names.js` (`renameLocalTypes`)
  - Test: `test/unit/types/shadowing.test.js` R8.1 prints `e`, R8.2 prints `hi`; `test/unit/language/local-types.test.js` R8.6 (alias and defined type) prints `3 AB`, and a local `type strings` used inside its own function still works
  - Done when: all targets print Go's output
- [x] Task 8.2: Package-level type declarations shadow predeclared types (R8.3, R8.10)
  - Files: `src/link/type-names.js` (`mangleCollidingTypes`), `src/compiler.js` (`mangleLocalTypes`)
  - Test: `shadowing.test.js` R8.3 prints `a`, R8.10 prints `4`; local `type any = int` control unchanged
  - Done when: all targets print Go's output
- [x] Task 8.3: Calls to user declarations named after builtins emit as ordinary calls (R8.4, R8.5, R8.7–R8.9)
  - Files: `src/backend/js/expressions.js` (`genCall`/`_genBuiltinIdent`), `src/backend/wasm/emit-builtins.js` (`_emitBuiltinCall`), `src/backend/wasm/prescan.js`
  - Test: `shadowing.test.js` R8.4 (`1`), R8.5 (`1`), R8.7 (`1`), R8.8 (`2`), R8.9 (no output) with `assertOutput`; the `func f(len int)`, `copy := 5`, `new := 2` controls unchanged
  - Done when: all targets print Go's output, no ICE; builtin dispatch reads `expr._builtinName`, not the callee name

### Phase 9: Generic bodies and generic function values (roots `generic-body-check`, `generic-func-value`)
- [x] Task 9.1: Operators on type parameters are checked against the type set at the definition (R9.1, R9.2, R9.4–R9.8, R10.8)
  - Files: `src/typechecker/assignability.js`
  - Test: reject fixtures `generic_mod_float_term.go` (called), `generic_mod_float_term_unused.go`, `generic_add_any.go`, `generic_sub_int_string.go`, `generic_lt_comparable.go`, `generic_shift_float_term.go`, `generic_mod_assign_float_term.go`; accept `M[T ~int | ~int64]` with `%`, `T ~int | ~string` with `+`, `T cmp.Ordered` with `<`, `T comparable` with `==`
  - Done when: one `CompileError` per definition on all targets, no ICE
- [x] Task 9.2: Instantiated generic functions as values infer constraint type parameters (R9.3, R9.9, R9.10)
  - Files: `src/typechecker/expressions.js` (`_checkInstantiationExpr`), `src/typechecker/resolve.js` (`_inferFromCoreTypes`)
  - Test: `test/unit/types/generics.test.js` R9.3 prints `[1 2]`, R9.9 prints `0`, R9.10 prints `1`; the `slices.Sort[[]int, int]` and partial `First[[]int]` controls unchanged
  - Done when: all pass on all targets

### Phase 10: Backends read the full underlying type (root `ad-hoc-type-structure`, backend half)
- [x] Task 10.1: JS range over a defined string type decodes runes (R6.5)
  - Files: `src/lower/range.js` (`isStringRangeType`), `src/backend/js/statements.js`
  - Test: `test/unit/language/range-iter.test.js` R6.5 prints `0:a 1:b`, and `fmt.Println(i, r)` over `Word("é")` prints `0 233`, on all targets
  - Done when: passes on all targets
- [x] Task 10.2: `wasm` element and size lookups loop over `underlying` (R6.8)
  - Files: `src/backend/wasm/emit.js` (`_getArrayElemType`, `_getArraySize`), `src/backend/wasm/types.js`, `src/backend/wasm/module-emitter.js`, `src/backend/shared/named-underlying.js`, `src/backend/wasm/globals.js`, `src/backend/js/expressions.js`
  - Test: accept fixture `defined_chain_slice.go` (`type A B; type B C; type C []int` in `len`, `append`, `range`, index, `[]int(s)`), all targets; the `type M2 M1` map control unchanged
  - Done when: passes on all targets; no backend site resolves a named type through `checker.types.get(t.name)` of its own name

### Phase 11: Forwarded tuples (root `forwarded-tuple`)
- [x] Task 11.1: Forwarded tuple arguments report the call and its position (R10.1)
  - Files: `src/typechecker/assignability.js` (`_checkNumericCoercion`), `src/typechecker/statements.js` (forwarded-call arguments, `:546`)
  - Test: reject fixture `forwarded_tuple_arg_type.go` (`f()` text, one error); `test/unit/types/errors.test.js` asserts `9:3`
  - Done when: Go's text, count and position
- [x] Task 11.2: Forwarded tuple returns report the tuple's arity (R10.2)
  - Files: `src/typechecker/statements.js`
  - Test: reject fixture `return_forwarded_tuple_void.go` (`have (int, string)`)
  - Done when: Go's text on all targets

### Phase 12: Node positions (root `node-positions`)
- [x] Task 12.1: `iota`-substituted literals carry positions (R10.3)
  - Files: `src/parser/declarations.js` (`parseConstDecl`)
  - Test: `test/unit/parser/positions.test.js` walking `example/gom/src/types.go` const literals
  - Done when: no missing positions in the walk
- [x] Task 12.2: Type-switch bindings and invalid range functions carry positions (R10.4, R10.5)
  - Files: `src/typechecker/statements.js`
  - Test: `test/unit/types/errors.test.js` R10.5 has `at line 8:16`; type-switch `caseScope.localNode("x")` unit test returns the `Ident`
  - Done when: both pass

### Phase 13: Error classification (root `error-classification`)
- [x] Task 13.1: Unsupported `templ` CSS arguments are a `CompileError` (R10.6)
  - Files: `src/backend/js/templ.js`
  - Test: `test/unit/compiler/templ.test.js` R10.6 throws `CompileError`, not `InternalCompilerError`
  - Done when: passes
- [x] Task 13.2: `compileWasm` validates its module (R10.7)
  - Note: the R10.7 repro (`f + 1i`) is now rejected by the checker, so no source yields an invalid module; the test pins that a valid module is unchanged and the guard is `validateWasm`.
  - Files: `src/compiler.js` (`compileWasm`)
  - Test: `test/unit/compiler/compile-result.test.js` R10.7 `compileWasm` returns an `InternalCompilerError`
  - Done when: passes; valid modules unchanged

### Phase 14: Universe `error` survives a package-level `type error` (root `predeclared-scope`)
Last behavior phase: carries the docs update for Phases 1–14.
- [ ] Task 14.1: Generated Go does not spell a shadowed universe name (R8.11, `fmt.Println` form)
  - Files: `src/lower/fmt-formatters.js`, `src/lower/json-codecs.js`, `src/lower/gen-types.js`
  - Test: `test/unit/types/shadowing.test.js` R8.11 `fmt.Println(e)` prints `3` on all targets
  - Done when: passes; `gofront_gen.go` for programs without the shadow is byte-identical
- [ ] Task 14.2: `wasm` identifies universe `error` by identity (R8.11, `fmt.Print` form)
  - Files: `src/backend/wasm/index.js`, `src/backend/wasm/types.js`, `src/backend/wasm/boundary.js`
  - Test: `shadowing.test.js` R8.11 `_ = e; fmt.Print("")` compiles to a valid module on `wasm`; an `error`-returning stdlib call still works next to the shadow
  - Done when: passes; no `types.get("error")` or `name === "error"` test remains in `src/backend/wasm/` without a comment saying why the name is safe
- [ ] Task 14.3: Document the new rejections and fixed cases
  - Files: `docs/go-compatibility.md`
  - Test: none (docs)
  - Done when: `docs/go-compatibility.md` describes the new rejections (R1, R2, R4, R5, R7, R9) and the fixed defined-type and predeclared-name cases (R3, R6, R8)

### Phase 15: Object kinds and underlying types at declaration (roots `addressability`, `ad-hoc-type-structure`)
*Scheduled from review follow-ups (2026-11-18): the Phase 5 addressability entries and the `copy` entry routed here from `plans/follow-ups.md`. Landed before Phases 6–14 so they build on it. Gate for the remaining phases: `npm run fuzz:check` (checker-operand-rules Phase 1) passes, with the phase's fixed entries removed from `test/fuzz/check-baseline.txt`.*
- [x] Task 15.1: A scope binds each name to one object `{ kind, type, node, local }` (`kind`: `var`, `const`, `type`, `func`, `pkg`, `builtin`); a namespace records its members' kinds (`_kinds`)
  - Files: `src/typechecker/types.js` (`Scope`), `src/typechecker/index.js` (`addDefinitions`, `addPackageNamespace`, `getExportedKinds`, `_registerFuncDecl`), `src/compiler.js` (`exportedKinds` replaces `exportedTypeNames`), `src/link/stdlib.js` (`stdlibNamespace`), `src/typechecker/stdlib/shared.js`, `src/typechecker/stdlib/simd.js`, `src/dts-parser.js` (types and nested namespaces of a `.d.ts` namespace)
  - Test: the unit suite unchanged but for `test/unit/types/identity.test.js` reading `globals.get`
  - Done when: `Scope` has no `_consts`, `_typeNames`, `_packages`, `_locals` or `_localNodes` and the checker no `_funcDeclNames`; `lookup()` still returns a type
- [x] Task 15.2: Addressability reads the object kind (ledger *Package functions*, *Package-qualified type names*, *Dot-imported functions*)
  - Files: `src/typechecker/expressions.js` (`_isAddressableIdent`, `_isAddressableSelector`, `_isNamespaceVariable`)
  - Test: reject fixtures `assign_package_members.go`, `assign_imported_members/`, `assign_dot_imported_names/`, `addr_dts_nested_type_name/`; accept fixtures `assign_imported_variables/`, `assign_dts_namespace_members/` (a `.d.ts` namespace's values and functions stay assignable properties)
  - Done when: Go's message on all targets; the ten `names:assign:*` and `names:addr:*` entries are gone from the fuzzer baseline and no entry is added
- [x] Task 15.3: A type declared over a defined type takes that type's underlying type at its declaration (R6.1, R6.2, R6.6, R6.7, R6.8, ledger *copy on defined slices*)
  - Files: `src/typechecker/index.js` (`collectType`, `_underlyingOver`, `_genericUnderlyingOver`), `src/typechecker/resolve.js` (`instantiateGenericWithArgs`)
  - Test: accept fixtures `defined_over_defined_types.go`, `range_func_defined_over_defined.go`, `defined_chain_slice.go`, `generic_defined_over_generic.go`; reject fixture `copy_defined_chain_elem_mismatch.go`
  - Done when: Go's result on all targets; no declared type but a generic type declared over a struct type (ledger *Generic type declared over a struct type*) has a defined type as `underlying`
  - Fuzzer: with the kinds `MI2`, `MS2`, `I2` the grid has 55 entries fewer and 50 more than at `564d9663`. 44 of the 50 are `MI2`/`MS2`/`I2` now disagreeing exactly where `MI`/`MS`/`I` already do (they were rejected for the wrong reason before); the other 6 are `*I`/`[2]I` against `*I2`/`[2]I2` in `assign` and `*I` against `*I2` in `conv`, where the old representation agreed with Go by accident and the open roots `nested-assignability`/`dual-conversion-check` (checker-operand-rules O5) now show.

### Phase 16: Operands of type-parameter operators (root `generic-body-check`, operand side)
*Scheduled from review follow-ups (2026-11-18): the Phase 9 operand-matching, untyped-shift and unary `!` entries. Builds on Phase 9's `_checkTypeParamOperator`; lands after it.*
- [ ] Task 16.1: The other operand of a type-parameter operator is converted to or identical with the type parameter (R11.1–R11.3)
  - Files: `src/typechecker/assignability.js` (`_checkTypeParamOperator`, `_binaryResultTypeTypeParam`, `convertUntyped` for `typeParam`)
  - Test: reject fixtures `generic_add_int_param.go`, `generic_add_float_const.go`, `generic_and_bool_int.go`, `generic_add_int8_overflow.go`; accept `a + 1`, `a + 1.5` with `T ~int | ~float64`
  - Done when: Go's message on all targets; an untyped constant must be representable in every term of the type set
- [ ] Task 16.2: An untyped left operand of a shift keeps its untyped type (R11.4, R11.5)
  - Files: `src/typechecker/assignability.js`
  - Test: `test/unit/types/generics.test.js` R11.4 prints `1024` on all targets; reject fixtures `generic_shift_float_const_left.go`, `generic_shift_string_left.go`
  - Done when: `x := 1 << s` is `int` with `s T ~uint`
- [ ] Task 16.3: Unary `!` on a type parameter tests its type set (R11.6)
  - Files: `src/typechecker/expressions.js` (`_checkBoolUnaryOp`)
  - Test: accept fixture `generic_not_bool_param.go`; reject `!a` with `T ~bool | ~int` and `T any`
  - Done when: result type is `T`; controls unchanged

### Phase 17: Builtins on type parameters (root `builtin-type-param-constraints`)
*Scheduled from review follow-ups (2026-11-18).*
- [ ] Task 17.1: `len`, `cap`, `clear` and `delete` check every term of the type set (R12.1, R12.2)
  - Files: `src/typechecker/expressions.js` (`_lenOperandOk`, `_checkClearOperand`, `_checkDeleteOperand`)
  - Test: reject fixtures `generic_len_any.go`, `generic_clear_any.go`, `generic_delete_any.go`; accept `len` with `T ~[]int | ~string`
  - Done when: one `CompileError` per definition on all targets, no ICE
- [ ] Task 17.2: `append`, `copy`, `min` and `max` check the type set (R12.2)
  - Files: `src/typechecker/expressions.js` (`_appendOperandOk`, `_orderedOperandOk`)
  - Test: reject fixtures `generic_append_any.go`, `generic_min_any.go`; accept `min` with `T cmp.Ordered`
  - Done when: as Task 17.1

### Phase 18: `comparable` is a constraint (root `comparable-constraint`)
*Scheduled from review follow-ups (2026-11-18): *Bare comparable constraint* (routed here: same mechanism as the inferred-argument entry).*
- [ ] Task 18.1: `checkConstraint` tests `comparable` on explicit, call-inferred and partially instantiated type arguments (R13.1, R13.2, R13.4)
  - Files: `src/typechecker/resolve.js` (`checkConstraint`)
  - Test: reject fixtures `comparable_struct_slice.go`, `comparable_map.go`, `comparable_func_inferred.go`, `comparable_index_value.go`; accept `error`, structs of comparable fields, pointers, channels, arrays
  - Done when: Go's message on all targets; no wasm ICE for `slices.Index[[]func()]`
- [ ] Task 18.2: A type parameter satisfies `comparable` only through its constraint (R13.3)
  - Files: `src/typechecker/resolve.js`
  - Test: reject `generic_any_to_comparable.go`; accept `T comparable` and `T cmp.Ordered` forwarded to `comparable`
  - Done when: as Task 18.1

### Phase 19: Generic types declared over a struct (root `ad-hoc-type-structure`)
*Scheduled from review follow-ups (2026-11-18): *JS generic over struct* and *One-level underlying sites*.*
- [ ] Task 19.1: JS field stores and reads on a generic type over a struct use the struct (R14.1)
  - Files: `src/backend/js/index.js`, `src/backend/js/expressions.js` (both test `t.underlying?.kind === "struct"` one level deep)
  - Test: `test/unit/types/generics.test.js` R14.1 prints `42` on all targets
  - Done when: reads go through `_deepUnderlying`; no `Cannot set properties of null`
- [ ] Task 19.2: The checker's one-level `.underlying` reads see the struct (R14.2)
  - Files: `src/typechecker/assignability.js`, `src/typechecker/index.js`, `src/typechecker/resolve.js`, `src/typechecker/types.js` (the sites listed in the ledger entry)
  - Test: R14.2 annotations equal `[]S[int]`'s; the controls unchanged
  - Done when: `grep -rn "\.underlying\.kind" src/typechecker` shows no read that skips a named link

### Phase 20: Non-boolean conditions (root `empty-interface-kinds`, wording)
*Scheduled from review follow-ups (2026-11-18).*
- [ ] Task 20.1: `if` and `for` conditions report Go's `non-boolean condition in <stmt> statement` (R15.1, R15.2)
  - Files: `src/typechecker/statements.js` (`_checkIfStmt`, `_checkForCond`)
  - Test: reject fixtures `if_nonbool_int.go`, `if_nonbool_defined_any.go`, `for_nonbool_defined_any.go`
  - Done when: every non-boolean type gets the one wording
- [ ] Task 20.2: Existing assertions and docs use the new wording
  - Files: tests that match `must be bool`; `docs/go-compatibility.md` where it quotes the message
  - Test: `npm test`
  - Done when: `grep -rn "condition must be bool" src test docs` finds nothing

### Phase 21: `true`, `false` and `nil` can be redeclared (root `predeclared-scope`)
*Scheduled from review follow-ups (2026-11-18).*
- [ ] Task 21.1: The lexer reads `true`, `false` and `nil` as identifiers; the parser and checker resolve them through the universe scope (R16.1)
  - Files: `src/lexer/tokens.js`, `src/parser/expressions.js`, `src/typechecker/expressions.js`
  - Test: `test/unit/language/shadowing.test.js` R16.1 prints `1` on all targets; the controls
  - Done when: `x := true` and `y := nil` still type as before
- [ ] Task 21.2: Every declaration form accepts them (R16.2)
  - Files: `src/parser/declarations.js`, `src/parser/statements.js`, `src/backend/js/expressions.js`
  - Test: R16.2 programs print Go's output on all targets
  - Done when: shadowed names are mangled like other shadowed predeclared names (Phase 8)
