# Checker: Go Rules Applied Everywhere — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Schedules the review follow-ups that [`checker-strictness-plan.md`](checker-strictness-plan.md) deferred at completion (its *Review follow-ups found while executing this plan* row, 41 entries), re-probed 2026-11-17 on `main` at `4eb69a6` and grouped by root cause. Entries whose root belongs to another plan are routed in `plans/follow-ups.md` (see *Excluded*). L4 from the former `followup-fixes-plan.md` joined R8 on 2026-11-17 (same root). Independent of [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md); `mangleLocalTypes` (Task 8.1) is also changed by its Task 1.3, so whichever lands second rebases; merges before [`typed-web-platform-plan.md`](typed-web-platform-plan.md) Phase 1, which extends assignability; that plan's Phase 4 reuses this plan's Phase 3 `anyKind` when it types the browser globals.  
**Release note:** **Breaking:** the compiler rejects more programs that Go rejects: comparing a value with a constant or `nil` of the wrong kind, `nil` without a type, `append` and `len` with the wrong arguments, assigning to a field of a function result, two-variable `range` over an integer, and invalid operators inside generic functions. Defined string, complex and interface types, `type MyAny any`, and functions or types that reuse a predeclared name such as `len` or `error` now work as in Go.  

---

## Goal

Close the checker gaps the checker-strictness reviews found, by fixing the mechanism behind each group instead of each repro. The 34 entries scheduled here come from 13 root causes (*Verified Gaps*). Most of them share one pattern: a Go rule is applied in some places and not others because each check re-derives a type property on its own (whether an operand is untyped and must be converted, whether a type is Go `any`, what a named type's underlying type is, whether an expression is addressable). The phases below add or reuse one shared helper per rule and route every path through it, so siblings the reviews have not hit yet are fixed too. Each root's sibling paths were probed (*Verified Gaps*, "sibling" rows).

**Done means:**
- Every failing row in *Verified Gaps* gives Go 1.26's result on `js`, `both` and `wasm`: the stated compile error with line:col (a `test/unit/fixtures/conformance/reject/*.go` case) or Go's output (an `accept/*.go` case or an `assertOutput` test in the file its task names). `node test/unit/run.js types/conformance.test.js` passes with no `// pending:` line added by this plan.
- No program in the *Verified Gaps* tables produces an `InternalCompilerError` on any target.
- Each root has one implementation: `grep -n "ot === ANY" src/typechecker` and `grep -n '"any"' src/typechecker/expressions.js` (the `NON_INTEGER_BASICS` entry) find nothing; `_checkIncDecStmt` and the compound-assignment path call `binaryResultType`; `_checkAssignTarget` and the `&` operand check call one `_isAddressable`.
- `npm test`, `npm run check` (`gofront check` on `example/`) and the stdlib build pass; `test/perf/bundle-size.baseline.json` is unchanged.
- `docs/go-compatibility.md` describes the new rejections and the fixed defined-type cases.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `untyped-conversion`: an untyped constant or `nil` operand is converted to the other operand's or target's type (with representability), and has a default type or none (`nil`) | R1.1–R1.12 | |
| **In scope: core** | Root `operator-typing`: every operator form (`x op y`, `x op= y`, `x++`) types through `binaryResultType`, and string/complex results keep the operand's defined type | R2.1–R2.6 | |
| **In scope: core** | Root `empty-interface-kinds`: one classification of JS-dynamic `any`, Go `any` (every spelling), defined empty interfaces and error-tainted types | R3.1–R3.5 | |
| **In scope: core** | Root `builtin-operands`: builtins check their operand kinds and element assignability from one contract per builtin | R4.1–R4.7 | |
| **In scope: core** | Root `addressability`: one `_isAddressable(expr)` per the spec, used by every assignment form and `&` | R5.1–R5.7 | |
| **In scope: core** | Root `ad-hoc-type-structure`: checks read a named type's underlying type through `_deepUnderlying` and struct identity through `identical`, never one level or field-by-field | R6.1–R6.5 | |
| **In scope: core** | Root `range-int-operand`: range over an integer or constant operand | R7.1–R7.2 | |
| **In scope: core** | Root `predeclared-scope`: user declarations shadow predeclared and imported names at package and block scope | R8.1–R8.6 | |
| **In scope: core** | Roots `generic-body-check`, `generic-func-value`: generic bodies are checked against the constraint once, at the definition; an instantiated generic function is a value | R9.1–R9.3 | |
| **In scope: core** | Roots `forwarded-tuple`, `node-positions`, `error-classification`: diagnostics only (count, position, error class); no change to accepted programs | R10.1–R10.8 | |
| **Excluded: deferred** | Entries that no longer reproduce against real Go | *Duplicate bool cases* (`switch b { case 1 == 1: case true: }`), *Impossible assertions* (`i.(J)` with conflicting `M`): `go run` (1.26.10) accepts both | Not defects: Go accepts them. Deleted |
| **Excluded: deferred** | `wasm` struct layout | *WASM map keys* (`map[struct{ X int }]int` lookup → `0`, want `10`), *WASM struct conversion* (`struct{ E }(a)` → invalid wasm), sibling `append(s, A{5})` into `[]struct{ X int }` → invalid wasm (Go: `1`) | Root `wasm-struct-field-list`, scheduled in [`wasm-struct-types-plan.md`](wasm-struct-types-plan.md) Phase 1 (W1.6–W1.8) |
| **Excluded: deferred** | Cross-package unexported field in a positional literal | *Struct literals*: `sub.S{1, 2}` with unexported `b` compiles | Root `export-visibility`, scheduled in [`package-scope-plan.md`](package-scope-plan.md) Phase 3 (E5) |
| **Excluded: deferred** | Codegen defects without a checker root | *Pointer method on dereferenced named scalar* (`(*p).Inc()` on `type Num int` → `0` on **every** target, want `1`); *JS codegen* (`_ = map[any]int{1: 1}` → `SyntaxError` on js/both) | Backend roots: `deref-receiver` scheduled in [`value-stores-plan.md`](value-stores-plan.md) Phase 5 (V5.1); `js-stmt-expr-start` `unrouted` in `plans/follow-ups.md` |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6` (checker-strictness merged). A throwaway driver (`.probes/cs/`, deleted) wrote each program as `main.go`, ran `go run` (go1.26.10, `go.mod` `go 1.26`) for the expected result, and `runProgram` (`test/unit/helpers.js:522`) with `target` `js`/`both`/`wasm`. "ICE" = `InternalCompilerError`. Rows marked *sibling* were not in the ledger: they were found by probing the root's other paths. Line numbers are as of `4eb69a6`.

### R1 `untyped-conversion`

Root: there is no step that converts an untyped operand to the other operand's (or the target's) type. `_checkCmpOperandTypes` (`src/typechecker/assignability.js:294`) returns early when either side is untyped or `nil` (`_isTypedBasicOperand`, `:304`); `_binaryResultTypeComplex` (`:187`) accepts any untyped operand; `defaultType` (`src/typechecker/types.js:632`) gives untyped `nil` a type in `:=`/`var`/`const` (`src/typechecker/statements.js:192`, `src/typechecker/index.js:1577`, `:1626`); duplicate-case detection compares constants before conversion to the tag type (`src/typechecker/statements.js:644`); a constant shift count keeps its float type (`checkShiftCount`, `src/typechecker/assignability.js:972`) and `emitShift` (`src/backend/wasm/emit-exprs.js:2872`) emits it with `toWasmType(right._type)` (`f64`).

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

Root: `BUILTIN_CHECK` (`expressions.js:79`) checks each builtin ad hoc. `append` tags and boxes each argument but never calls `assertAssignable` against the element type (`:96-113`); `len`/`cap` (`_checkBuiltinLen`, `:2205`) and `delete` (`:121`) skip unknown operand kinds, and `f(v...)` accepts a Go `any`. Depends on Phase 3's classifier to keep JS-dynamic `any` permissive.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R4.1 | `var v any = []int{1}; _ = len(v)` | `invalid argument … for built-in len` | js/both accept; wasm ICE |
| R4.2 *sibling* | `var v interface{} = []int{1}; _ = len(v)` | same | same |
| R4.3 | `_ = append(v, 1)` (`v any`) | `invalid append: argument must be a slice` | js/both accept; wasm ICE |
| R4.4 | `delete(v, 1)` (`v any`) | `v … is not a map` | js/both accept; wasm ICE |
| R4.5 | `f(v...)` (`v any`, `f(xs ...int)`) | `cannot use v … as []int value` | js/both accept; wasm ICE |
| R4.6 | `var s []struct{ X int }; s = append(s, struct{ Y string }{"a"})` | `cannot use struct{Y string}{…} … as struct{X int} value in argument to append` | js/both print `1`; wasm ICE |
| R4.7 *sibling* | `var s []int; s = append(s, "a")` | `cannot use "a" … as int value in argument to append` | js/both print `1`; wasm ICE |
| control | `var v interface{} = []int{1}; for range v {}` | rejected | rejected (range already checks) |

### R5 `addressability`

Root: `_checkAssignTarget` (`statements.js:301`) only rejects string elements and map-element paths; there is no general addressability rule (variable, pointer indirection, slice index, field or array element of an addressable operand, composite literal for `&` only). The `&` check and `_reportUnaddressableRecv` (`expressions.js:667`) have their own partial rules.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R5.1 | `mk().X = 1` | `cannot assign to mk().X (neither addressable nor a map index expression)` | accepted on all targets |
| R5.2 | `P{}.X = 1` | same | accepted |
| R5.3 | `[2]int{1, 2}[0] = 3` | same | accepted |
| R5.4 *sibling* | `mk().X++` | same | accepted |
| R5.5 *sibling* | `mk().X += 1` | same | accepted |
| R5.6 *sibling* | `mk()[0] = 1` (`mk() [2]int`) | same | accepted |
| R5.7 *sibling* | `_ = &mk().X` | `invalid operation: cannot take address of mk().X` | js accepted; wasm a `wasm`-specific address error |
| control | `m[1].X = 2`; `mk().Inc()` (pointer method) | rejected | rejected with Go's message (must stay) |

### R6 `ad-hoc-type-structure`

Root: checks re-derive type structure locally. 51 sites in `src/typechecker` take one level of `named ? t.underlying : t` against 25 `_deepUnderlying` calls, so a type defined over another named type (`type A I`) loses its kind; `_checkForCond` tests `ct?.kind === "func"` on the named type (`statements.js:600`); `_sameStructFields` (`expressions.js:1235`) compares `t.fields` (which includes promoted fields) name by name instead of `identical` ignoring tags. `isStringRangeType` (`src/lower/range.js:110`, called by `src/backend/js/statements.js:1554`) only accepts `basic`/`untyped` string, so JS range over a defined string type falls through to byte indexing instead of rune decoding.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R6.1 | `type I interface{ M() }; type A I; var a A; _ = a.(S)` | ok | `invalid type assertion: A is not an interface` |
| R6.2 *sibling* | `var a A = S{}` (same types) | ok (`true`) | `Cannot assign S to A` |
| R6.3 | `type MyFunc func(int); var fn MyFunc; for range fn {}` | `cannot range over fn … func must be func(yield func(...) bool)` | js/both accept; wasm ICE (`Maximum call stack size exceeded`) |
| R6.4 | `type E struct{ V int }; var a struct{ E }; b := struct{ E E }(a)` | `cannot convert a … to type struct{E E}` | js/both `TypeError … '__clone'`; wasm ICE |
| R6.5 | `type Word string; for i, r := range Word("ab") { fmt.Printf("%v:%c ", i, r) }` | `0:a 1:b` | js/both `0: 1:`; wasm correct |

### R7 `range-int-operand`

Root: range over an integer or constant operand (`_rangeOperandError`, `statements.js:593`) checks neither the variable count nor that a constant operand is an integer.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R7.1 | `for i, v := range 3 {}` | `range over 3 (untyped int constant) permits only one iteration variable` | js/both accept; wasm ICE (`Unresolved identifier: v`) |
| R7.2 | `const k = 2.0; for i := range k {}` | `cannot range over k (untyped float constant 2)` | js/both print `0 1`; wasm ICE |

### R8 `predeclared-scope`

Root: predeclared names win over user declarations. `mangleLocalTypes` (`src/compiler.js:737`) only reserves `BASIC_TYPES` (`:744`), so a local `type error` (or a local type named after an import, R8.6) is not renamed and leaks package-wide; in `renameLocalTypes` (`src/link/type-names.js:81`), an outer block's `renameTypeRefs` walks into nested blocks without stopping at a nested `TypeDecl` of the same original name, overwriting the inner `TypeDecl`'s fresh `__L<n>` name with the outer one; `resolveTypeNode` (`src/typechecker/resolve.js:248`) checks `BASIC_TYPES[node.name]` before `scope.lookup`/`this.types`, so package-level `type int32 = string` resolves to `int32`; and when `func len()` or `len :=` shadows a builtin, the checker already does not set `expr._builtinName`, but JS and WASM codegen (`src/backend/js/expressions.js:2183`, `src/backend/wasm/emit-builtins.js:1080`, `src/backend/wasm/prescan.js:88`) dispatch on `func.name` instead of `expr._builtinName`.

| ID | Program | Go | GoFront |
|---|---|---|---|
| R8.1 | `func f1() { type error struct{ Msg string }; … }; func f2() error { return MyErr{} }` | `e` | `Cannot assign MyErr to error` |
| R8.2 | `type int32 = string; var a int32 = "hi"; { type int32 = bool }; var c int32 = a` | `hi` | `Cannot assign string to bool` |
| R8.3 | package-level `type int32 = string; var x int32 = "a"` | `a` | `Cannot assign untyped string to int32` |
| R8.4 | `func len() int { return 1 }; fmt.Println(len())` | `1` | ICE (`reading '_asComplex'`; wasm `'_type'`) |
| R8.5 | `len := func() int { return 1 }; fmt.Println(len())` | `1` | same ICE |
| R8.6 (L4) | `import "strings"; func other() int { type strings = int; var x strings = 3; return x }; fmt.Println(other(), strings.ToUpper("ab"))` (also `type strings int`) | `3 AB` | `int has no field or method 'ToUpper'` on all targets |

### R9 `generic-body-check`, `generic-func-value`

Root (R9.1–R9.2): `_binaryResultTypeTypeParam` (`assignability.js:120`) returns the type parameter for every arithmetic operator without checking the constraint's type set, so a generic body is only checked per instance (wasm monomorph) or never (js). Root (R9.3): `_checkInstantiationExpr` (`src/typechecker/expressions.js:1561`) does not run constraint type inference (`_inferFromCoreTypes` in `src/typechecker/resolve.js:921`) when a generic function with multiple type parameters (`slices.Sort[S ~[]E, E cmp.Ordered]`) is partially instantiated as a value (`slices.Sort[[]int]`), leaving `expr._typeArgs` with 1 entry instead of 2 (`E` falls back to `undefined` in JS `_typeArgFactories` and `ANY` in WASM `monomorph.js:787`).

| ID | Program | Go | GoFront |
|---|---|---|---|
| R9.1 | `func M[T ~int \| ~float64](a, b T) T { return a % b }; M(5.5, 2.0)` | `operator % not defined on a (variable of type T constrained by N)` | js/both print `1.5`; wasm ICE |
| R9.2 *sibling* | same `M`, never called | same error | accepted on all targets |
| R9.3 | `f := slices.Sort[[]int]; f(xs)` | `[1 2]` | js/both ICE (`reading 'kind'`); wasm ICE in `cmp.go` |

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

---

## Approach

### 1. Architecture & Design Decisions
- **Untyped conversion (R1).** Add `convertUntyped(t, target, node)` in `src/typechecker/assignability.js`: given an untyped constant or `nil` operand and a typed target, report Go's error when the kind does not fit (`mismatched types T and untyped K` for comparison operands, `cannot use nil as T value` for assignment, overflow for constants) and otherwise record the converted type on the node (`_type`), which the backends already read. Call it from `_binaryResultTypeCmp` (both orders), `_binaryResultTypeComplex`/`Numeric` for the untyped side, `checkShiftCount` (records the count as `uint` on `expr.right`, fixing R1.4 on wasm without backend changes), duplicate-case collection (convert each case to the tag type before comparing), and `assertAssignable` for `nil` into a type parameter (nilable only if every type in the core type set is). `defaultType(untyped nil)` returns `null`, and `:=`/`var`/`const` (`src/typechecker/statements.js`, `src/typechecker/index.js`) report Go's message.
- **Operator typing (R2).** `_checkIncDecStmt` checks `x + 1` and the compound path checks `x op y` through `binaryResultType` with a synthetic `BinaryExpr` node positioned at the statement, so every operator rule applies to all three forms. `_binaryResultTypeString` and `_binaryResultTypeComplex` call `_checkIdenticalOperands` and return the typed operand's type (defined types survive).
- **Empty-interface kinds (R3).** One function `anyKind(t)` in `src/typechecker/types.js` returns `"dynamic"` (JS-dynamic `ANY`), `"go"` (`DECLARED_ANY`, `interface{}`, a defined type whose underlying is any of these), `"tainted"` (error recovery), or `null`. Identity keeps defined empty interfaces distinct (`*B` vs `*any`). Every ad-hoc test (`ot === ANY`, `NON_INTEGER_BASICS` `"any"`, templ conditions, `_declared` checks for operators) goes through it; JS-dynamic stays permissive everywhere.
- **Builtin operands (R4).** Each `BUILTIN_CHECK` entry validates its operand kinds from a small contract table (`len`/`cap`: string, array, pointer to array, slice, map, chan; `append`: slice + `assertAssignable(elem, arg)`; `delete`: map; spread: slice), rejecting Go `any` (`anyKind === "go"`) with Go's message and accepting `"dynamic"`.
- **Addressability (R5).** `_isAddressable(expr)` in `src/typechecker/expressions.js` per the spec (variable; `*p`; slice index; field selector or array index of an addressable operand; field through a pointer). `_checkAssignTarget` uses it for `=`, `op=` and `++` (keeping the map-index exception and existing messages), and the `&` operand check uses it with the composite-literal exception. `_reportUnaddressableRecv` delegates to it.
- **Type structure (R6).** Replace one-level `named ? t.underlying : t` with `_deepUnderlying` in the assertion, assignability-to-interface, conversion and range-condition paths that the gaps hit, then sweep the remaining sites across `src/typechecker/` (51 one-level sites at baseline). `_sameStructFields` is replaced by `identical(a, b, { ignoreTags: true })` over declared fields. `isStringRangeType` in `src/lower/range.js` unwraps named types (`_deepUnderlying`/loop over `named.underlying`) so JS range over a defined string decodes runes.
- **Range integers (R7).** `_checkForCond` rejects a second iteration variable when the operand's core type is an integer, and a constant operand that is not representable as `int`.
- **Predeclared scope (R8).** `mangleLocalTypes` (`src/compiler.js`) reserves every predeclared type name (`error`, `any`, `comparable`, the basic names) and the package's import names; in `renameLocalTypes` (`src/link/type-names.js`), `renameTypeRefs` stops at nested blocks that redeclare the same local type name so inner `__L<n>` names are preserved. In `resolveTypeNode` (`src/typechecker/resolve.js`), `scope.lookup` and `this.types.get` precede `BASIC_TYPES[node.name]`, so user declarations of `int32` shadow the predeclared type. In JS and WASM codegen (`src/backend/js/expressions.js`, `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/prescan.js`), builtin call emission gates on `expr._builtinName` so user functions or variables named after builtins (`len`, `cap`, `min`, `max`, `copy`, etc.) emit as ordinary calls.
- **Generics (R9).** `_binaryResultTypeTypeParam` checks the operator against every term of the constraint's type set (reusing `_checkIntegerOnlyOperator` per term) and reports Go's message once at the definition. When an `InstantiationExpr` instantiates a generic function with fewer explicit type arguments than type parameters (`slices.Sort[[]int]`), `_checkInstantiationExpr` infers the remaining type parameters from constraint core types (`_inferFromCoreTypes` in `src/typechecker/resolve.js`) and records the complete `_typeArgs` list on `expr` and `expr.expr`.
- **Diagnostics (R10).** Forwarded tuple arguments and returns carry the call node (`_fwdIface` positions) and the tuple's arity; `parseConstDecl` copies the `iota` token position to substituted literals; the type-switch binding passes its `Ident`; `_checkRangeIterInvalidFunc` takes the range node. `genCssDecl` throws `UnsupportedError`; `compileWasm` runs `validateWasm`.

### 2. Invariants & Safety Bounds
- A program Go accepts and GoFront compiles today prints the same output on every target, except the fixed miscompiles (R6.5, R1.4 on wasm).
- JS-dynamic `any` values (browser globals, `.d.ts` declarations, untyped imports) stay permissive: every new rejection applies only to `anyKind === "go"`.
- Emitted code for programs without the affected forms is byte-identical; `bundle-size`, `zero-alloc` and `bce-mathx` gates unchanged.
- `example/` and `stdlib/` compile unchanged (`npm run check`, stdlib build); if a rejection hits them, the phase fixes the call site and lists it in the release note.

### 3. Edge Cases & Error Handling
- **R1:** `x == nil` stays valid for pointers, slices, maps, chans, funcs and interfaces (including type parameters whose core types are all nilable). An untyped rune compares with any integer type. Untyped float constants that are exactly integers convert to integer targets (`x << 1.0`).
- **R2:** `s += "x"` on a defined string stays valid (R2.6). `x++` on a type parameter with a numeric constraint stays valid.
- **R3:** `type MyAny any` behaves as Go `any` in operators and builtins (rejected), but is a distinct defined type for identity, like Go.
- **R5:** `m[k] = v` and `p.X = v` through a pointer result (`ptr().X = 1`) stay valid; `&T{}` stays valid.
- **R8:** a local `type error` must not change the `error` seen by other functions or by `errors.New`; method sets of user types named after predeclared types are unaffected.
- **R9:** a generic body that uses `%` under a constraint whose terms are all integers stays valid; the error appears once per definition, not per instance.

---

## Implementation Tasks

### Phase 1: Untyped operand conversion (root `untyped-conversion`)
- [ ] Task 1.1: `convertUntyped` for comparison, arithmetic and type-parameter `nil` operands (R1.1–R1.3, R1.8–R1.11)
  - Files: `src/typechecker/assignability.js`
  - Test: reject fixtures `untyped_cmp_rune_string.go`, `untyped_cmp_string_int.go`, `untyped_complex_to_float.go`, `nil_type_param.go`, `nil_cmp_struct.go`, `nil_cmp_array.go`, `nil_cmp_int.go`; accept fixtures for nilable `== nil` on pointer/slice/map/func/interface/type param and `func f[T *int | []int]() T { return nil }`
  - Done when: each reject case reports Go's message at its line:col on all targets; no wasm ICE
- [ ] Task 1.2: Untyped `nil` has no default type in `:=`, `var` and `const` (R1.5–R1.7)
  - Files: `src/typechecker/types.js` (`defaultType`), `src/typechecker/statements.js`, `src/typechecker/index.js` (`checkVarDecl`, `checkConstDecl`)
  - Test: reject fixtures `nil_var_decl.go`, `nil_const.go`, `nil_define.go`
  - Done when: Go's messages on all targets (both package-level and function-local `var`/`const`)
- [ ] Task 1.3: Constant shift counts and duplicate cases use the converted type (R1.4, R1.12)
  - Files: `src/typechecker/assignability.js` (`checkShiftCount`), `src/typechecker/statements.js` (duplicate cases)
  - Test: `test/unit/types/numeric-operands.test.js` `x << 1.0` prints `2` on all targets; reject fixture `dup_case_float32.go`
  - Done when: both pass on all targets

### Phase 2: One operator typing path (root `operator-typing`)
- [ ] Task 2.1: String and complex results keep defined types and require identical operands (R2.1–R2.3)
  - Files: `src/typechecker/assignability.js`
  - Test: `test/unit/types/numeric-operands.test.js` R2.1 (`xy`), R2.3 (`(0+3i)`) with `assertOutput`; reject fixture `defined_string_mismatch.go`
  - Done when: all targets give Go's result
- [ ] Task 2.2: `x op= y` and `x++` type through `binaryResultType` (R2.4, R2.5, R2.6)
  - Files: `src/typechecker/statements.js`
  - Test: reject fixtures `compound_shift_float.go`, `incdec_empty_interface.go`; R2.6 control and the existing `any_compound_assign.go`/`any_compound_shift_count.go` cases unchanged
  - Done when: `_checkIncDecStmt` and the compound path call `binaryResultType`; all conformance cases pass

### Phase 3: Empty-interface kinds (root `empty-interface-kinds`)
- [ ] Task 3.1: `anyKind(t)` and identity of defined empty interfaces (R3.1, R3.2)
  - Files: `src/typechecker/types.js`, `src/typechecker/assignability.js`
  - Test: `test/unit/types/dynamic-types.test.js` R3.1 prints `2`; reject fixture `ptr_defined_empty_iface.go`; controls `var a any = b`, `var q *B = p` pass
  - Done when: all targets give Go's result
- [ ] Task 3.2: Route ad-hoc `any` tests through `anyKind` (R3.3–R3.5)
  - Files: `src/typechecker/expressions.js`, `src/typechecker/index.js` (templ conditions)
  - Test: `test/unit/types/errors.test.js` R3.3 reports exactly one error; `dynamic-types.test.js` R3.4 compiles on `js`; `test/unit/compiler/templ.test.js` R3.5 reports `non-boolean condition`
  - Done when: `grep -n "ot === ANY" src/typechecker` is empty and `NON_INTEGER_BASICS` has no `"any"`

### Phase 4: Builtin operand contracts (root `builtin-operands`)
- [ ] Task 4.1: `len`, `cap`, `delete` and spread check operand kinds (R4.1, R4.2, R4.4, R4.5)
  - Files: `src/typechecker/expressions.js`
  - Test: reject fixtures `builtin_len_any.go`, `builtin_len_empty_iface.go`, `builtin_delete_any.go`, `spread_any.go`; accept JS-dynamic `len(window.x)` on `js`
  - Done when: Go's messages on all targets, no wasm ICE
- [ ] Task 4.2: `append` checks its slice and element assignability (R4.3, R4.6, R4.7)
  - Files: `src/typechecker/expressions.js`
  - Test: reject fixtures `append_any.go`, `append_elem_struct.go`, `append_elem_string_to_int.go`; accept `append([]struct{ X int }{}, A{5})` (assignable; its `wasm` codegen is `wasm-struct-types-plan.md` W1.8, so the accept case runs `js`/`both` until that lands)
  - Done when: Go's messages on all targets

### Phase 5: Addressability (root `addressability`)
- [ ] Task 5.1: `_isAddressable` and assignment targets (R5.1–R5.6)
  - Files: `src/typechecker/expressions.js`, `src/typechecker/statements.js`
  - Test: reject fixtures `assign_call_field.go`, `assign_lit_field.go`, `assign_lit_elem.go`, `incdec_call_field.go`, `opassign_call_field.go`, `assign_call_array_elem.go`; controls `m[k] = v`, `ptr().X = 1`, `m[1].X = 2` (existing message)
  - Done when: Go's message on all targets; existing addressable fixtures pass
- [ ] Task 5.2: `&` and method receivers use `_isAddressable` (R5.7)
  - Files: `src/typechecker/expressions.js`
  - Test: reject fixture `addr_call_field.go` (Go's message on all targets, before the `wasm` address rule); `&T{}` and existing `addressable_*` fixtures pass
  - Done when: `_reportUnaddressableRecv` and the `&` check call `_isAddressable`

### Phase 6: Type structure through shared helpers (root `ad-hoc-type-structure`)
- [ ] Task 6.1: Defined types over named types use `_deepUnderlying` in assertions, assignability and expressions (R6.1, R6.2)
  - Files: `src/typechecker/expressions.js`, `src/typechecker/assignability.js`, `src/typechecker/constants.js`
  - Test: `test/unit/types/identity.test.js` R6.1/R6.2 print `true`
  - Done when: all targets print Go's output; one-level underlying lookups in `expressions.js`, `assignability.js` and `constants.js` are replaced or documented
- [ ] Task 6.2: Range condition and struct conversion use the underlying type and `identical` (R6.3, R6.4)
  - Files: `src/typechecker/statements.js` (`_checkForCond` and remaining one-level lookups), `src/typechecker/expressions.js` (`_sameStructFields` → `identical`), `src/typechecker/stdlib/shared.js`
  - Test: reject fixtures `range_defined_func.go`, `convert_embedded_vs_named_field.go`
  - Done when: Go's messages on all targets, no ICE
- [ ] Task 6.3: Sweep remaining one-level underlying lookups in `types.js`, `index.js` and `resolve.js`
  - Files: `src/typechecker/types.js`, `src/typechecker/index.js`, `src/typechecker/resolve.js`
  - Test: accept fixture with a chain `type A B; type B C; type C []int` used in `len`, `range`, index, conversion and `append`
  - Done when: `grep -rn 'kind === "named" ? [a-zA-Z.]*\.underlying' src/typechecker` lists only sites with a comment saying why one level is intended
- [ ] Task 6.4: JS range over a defined string type decodes runes (R6.5)
  - Files: `src/lower/range.js` (`isStringRangeType`), `src/backend/js/statements.js`
  - Test: `test/unit/language/range-iter.test.js` R6.5 prints `0:a 1:b` on all targets
  - Done when: passes on all targets

### Phase 7: Range over integers (root `range-int-operand`)
- [ ] Task 7.1: One iteration variable and integer constants for integer ranges (R7.1, R7.2)
  - Files: `src/typechecker/statements.js`
  - Test: reject fixtures `range_int_two_vars.go`, `range_float_const.go`; accept `for i := range 3`, `const n = 3.0` (representable) as Go does
  - Done when: Go's messages on all targets, no wasm ICE

### Phase 8: Predeclared names can be shadowed (root `predeclared-scope`)
- [ ] Task 8.1: Local types named after predeclared types or imports and nested local types are renamed per block (R8.1, R8.2, R8.6)
  - Files: `src/compiler.js` (`mangleLocalTypes`), `src/link/type-names.js` (`renameLocalTypes`)
  - Test: `test/unit/types/shadowing.test.js` R8.1 prints `e`, R8.2 prints `hi`; `test/unit/language/local-types.test.js` R8.6 (alias and defined type) prints `3 AB`, and a local `type strings` used inside its own function still works
  - Done when: all targets print Go's output
- [ ] Task 8.2: Package-level and local declarations shadow predeclared types and builtins (R8.3–R8.5)
  - Files: `src/typechecker/resolve.js` (`resolveTypeNode`), `src/backend/js/expressions.js` (`genCall`), `src/backend/wasm/emit-builtins.js` (`_emitBuiltinCall`, plus `src/backend/wasm/prescan.js`)
  - Test: `shadowing.test.js` R8.3 (`a`), R8.4 (`1`), R8.5 (`1`) with `assertOutput`
  - Done when: all targets print Go's output, no ICE

### Phase 9: Generic bodies and generic function values (roots `generic-body-check`, `generic-func-value`)
- [ ] Task 9.1: Operators on type parameters are checked against the type set at the definition (R9.1, R9.2, R10.8)
  - Files: `src/typechecker/assignability.js`
  - Test: reject fixtures `generic_mod_float_term.go` (called) and `generic_mod_float_term_unused.go`; accept `func M[T ~int | ~int64](a, b T) T { return a % b }`
  - Done when: one `CompileError` per definition on all targets, no ICE
- [ ] Task 9.2: Instantiated generic functions as values infer constraint type parameters (R9.3)
  - Files: `src/typechecker/expressions.js` (`_checkInstantiationExpr`), `src/typechecker/resolve.js` (`_inferFromCoreTypes`)
  - Test: `test/unit/types/generics.test.js` R9.3 prints `[1 2]` on all targets
  - Done when: passes on all targets

### Phase 10: Diagnostics (roots `forwarded-tuple`, `node-positions`, `error-classification`)
Three small diagnostics-only roots in one phase: each is under ~40 production LOC.
- [ ] Task 10.1: Forwarded tuple calls report the call, its arity and position (R10.1, R10.2)
  - Files: `src/typechecker/assignability.js`, `src/typechecker/statements.js`
  - Test: reject fixtures `forwarded_tuple_arg_type.go` (`f()` text, `9:3`), `return_forwarded_tuple_void.go` (`have (int, string)`)
  - Done when: both match Go's text and position
- [ ] Task 10.2: Positions on `iota` literals, type-switch bindings and invalid range functions (R10.3–R10.5)
  - Files: `src/parser/declarations.js`, `src/typechecker/statements.js`
  - Test: `test/unit/parser/positions.test.js` walking `example/gom/src/types.go` const literals; `test/unit/types/errors.test.js` R10.5 has `at line 8:16`; type-switch `localNode` unit test
  - Done when: no missing positions in the walk; R10.5 message has line:col
- [ ] Task 10.3: User-facing unsupported features and invalid modules are classified (R10.6, R10.7)
  - Files: `src/backend/js/templ.js`, `src/compiler.js` (`compileWasm`), `docs/go-compatibility.md`
  - Test: `test/unit/compiler/templ.test.js` R10.6 throws `CompileError`, not `InternalCompilerError`; `test/unit/compiler/compile-result.test.js` R10.7 `compileWasm` returns an `InternalCompilerError`
  - Done when: both pass; `docs/go-compatibility.md` updated for Phases 1–10
