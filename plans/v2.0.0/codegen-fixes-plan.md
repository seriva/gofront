# JS and `wasm` Codegen Fixes — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-19 (`/bs-plan follow-ups`): the one-off entries that share no root with an open plan, logged by checker-strictness Phase 6 and checker-go-rules Phases 3, 4, 8, 10 and the 2026-11-18 checker fuzzer. The rest of that sweep went to [`checker-go-rules-plan.md`](checker-go-rules-plan.md) (Phases 22–28), [`checker-operand-rules-plan.md`](checker-operand-rules-plan.md) (O4.11, O5.8, Phase 9), [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md) (Phase 5) and [`diagnostic-text-plan.md`](diagnostic-text-plan.md). The shadowed-builtin entry is split: its all-target `len` form is checker-go-rules Phase 28.  
**Release note:** **Breaking:** passing `xs...` to a function that is not variadic is now a compile error, as in Go; call it with the slice itself. Also fixes code that failed or misbehaved: `_ = map[...]...{...}` on JS, counting the runes of a string with `for range` on JS, and on WebAssembly comparing a value with an interface, type switches on `interface{}` and defined empty interfaces, defined pointer types such as `type P *int`, and user functions named `append` or `new` next to generic standard library code.

---

## Goal

Fix the follow-ups whose root is a single mechanism no open plan owns: two JS statement-emission bugs, one missing call-argument rule in the checker, and four `wasm` code-generation gaps. Each phase fixes its mechanism once and probes its other paths (*Verified Gaps*, "sibling" rows), so the fix covers more than the logged repro.

**Done means:**
- Every failing row in *Verified Gaps* gives Go 1.26's result on `js`, `both` and `wasm` (where the row's target applies): Go's output through `assertOutput`/`assertAllTargetsOutput` in the test file its task names, or Go's compile error in a `test/unit/fixtures/conformance/reject/*.go` case.
- No program in *Verified Gaps* produces an `InternalCompilerError` or an invalid `wasm` module; `npm run fuzz:check` loses every `# wasm-iface-equality` key and adds none.
- `npm test`, `npm run check` and the stdlib build pass; `test/perf/bundle-size.baseline.json` is unchanged or its change is explained in the phase PR.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Roots `js-stmt-expr-start`, `js-zero-var-string-range`: JS statement emission never starts a statement with `{`, and a zero-variable `range` over a string iterates once per rune | F1.1–F1.4 | |
| **In scope: core** | Root `spread-non-variadic`: `f(xs...)` requires a variadic `f` and no extra arguments beyond its fixed parameters | F2.1–F2.4 | |
| **In scope: target-specific** | Roots `wasm-iface-equality`, `wasm-typeswitch-empty-iface`, `wasm-defined-pointer`, `wasm-flat-mono-scope`: `wasm` codegen of `==` with an interface on either side, type tests against every empty-interface spelling, defined pointer types, and monomorphisation scopes | F3–F6 | |
| **Excluded: runtime / platform** | String offsets in UTF-16 code units | `for i := range "aéb"` prints `0 1 2` (Go `0 1 3`) on every target | Documented (`docs/go-compatibility.md`, *String semantics*): strings are JS strings on both backends |
| **Excluded: deferred** | A package function named `len` (or another builtin) breaking generated Go on every target | `func len(x string) int`; `fmt.Println(s)` → `internal error in the generated Go` | Root `predeclared-scope` (generated Go), checker-go-rules R8.12–R8.14, Phase 28 |

---

## Verified Gaps & Baseline Audit

**Method.** A driver in the session scratchpad (deleted) wrote each program as `main.go`, ran `go run` (go1.26) and `runProgram` (`test/unit/helpers.js`) on `js`/`both`/`wasm`, at `60ce661f` plus the conformance-harness fix and re-probed at `002e5180`; every root was confirmed by reading the code at `002e5180`. "ICE" = `InternalCompilerError`; "invalid" = the generated module fails `WebAssembly.validate`.

### F1 `js-stmt-expr-start`, `js-zero-var-string-range`
Roots: `src/backend/js/statements.js` emits the right-hand side of a blank-assignment discard (`_genAssignStmt` when `active.length === 0`, `:892–895`) and expression statements (`ExprStmt`, `:415–416`) as `${expr};`, so an object literal (a Go map literal) opens the statement with `{` and parses as a block; `_rangeExprLimit` (`:1408–1413`) and `_genRangeExprFor` (`:1415–1426`) bound a zero-variable string range by `.length` (UTF-16 units) instead of iterating code points, while the one- and two-variable forms (`_genStringRangeFor`, `:1704`) decode runes.

| ID | Program | Go | GoFront |
|---|---|---|---|
| F1.1 (ledger *JS discarded map literal*) | `_ = map[any]int{1: 1}` | runs | `SyntaxError: Unexpected token ':'` on js/both |
| F1.2 *sibling* | `_ = map[string]int{"a": 1}`; `_, _ = map[any]int{1: 1}, 2`; `if _ = map[any]int{1: 1}; true {}` | runs | same `SyntaxError` |
| F1.3 (ledger *JS zero-variable string range*, PR #245) | `type Word string; c := 0; for range Word("😀") { c++ }` | `1` | js/both `2`; wasm `1` |
| F1.4 *sibling* | `for range "😀é" { c++ }` (literal); `s := "😀"; for range s { c++ }` | `2`; `1` | js/both `3`; `2`; wasm correct |
| control | `_ = P{X: 1}` (struct literal); `var _ = map[any]int{1: 1}`; `for _ = range "😀é"`; `for i := range "😀é"` (indices, documented UTF-16) | runs; runs; `2`; `0 2` | correct (must stay) |

### F2 `spread-non-variadic`
Root: `src/typechecker/expressions.js:_checkCallArgs` (`:2346`) ignores the call's `_spread` flag when `!fnType.variadic` (and runs `_checkArgCount` before checking `_spread`, so a 0-parameter function gets `Too many arguments`), does not reject extra arguments before the spread on a variadic callee, and `_checkCallExpr` (`:2147–2196`) / `_checkAppendArgs` (`:2546`) do not reject `_spread` on non-`append` builtins, type conversions, or `append` calls with extra fixed arguments before the spread.

| ID | Program | Go | GoFront |
|---|---|---|---|
| F2.1 (ledger) | `func f(xs []int) {}; f([]int{1}...)` | `cannot use ... in call to non-variadic f` | accepted (all targets) |
| F2.2 *sibling* | method `T{}.f([]int{1}...)`; func value `g := func(xs []int) {}; g([]int{1}...)`; 0-param `func h() {}; h([]int{1}...)`; `defer f([]int{1}...)` | `cannot use ... in call to non-variadic <callee>` | accepted (`Too many arguments` on 0-param `h`) |
| F2.3 *sibling* | `func f(a int, xs ...int) {}; f(1, 2, []int{1}...)`; `func g(xs ...int) {}; g(1, []int{2}...)` | `too many arguments in call to f` / `g` | accepted on js/both; wasm invalid on `f` |
| F2.4 *sibling* | `len([]int{1}...)`; `append([]int{}, 1, []int{2}...)`; `type S []int; S([]int{1}...)` | `invalid use of ... with built-in len`; `too many arguments in call to append`; `invalid use of ... in conversion to S` | accepted (all targets) |
| control | `append(s, t...)`; `fmt.Println(xs...)` with `xs []any`; `min([]int{1}...)` | ok; ok; rejected | correct (must stay) |

### F3 `wasm-iface-equality`
Root: in `src/backend/wasm/emit-exprs.js:emitBinaryExpr` (`:2180–2318`), `leftType` only adopts `right._type` when `left._type?.kind === "untyped"` (`:2271`), so `a == b` / `a != b` with a concrete left operand and an interface right operand emits `left` as its concrete Wasm type and `right` as `anyref`; when either side is complex (`:2183`), `emitBinaryExpr` enters `emitComplexBinary` even when the other side is an interface (`any == complex64` and `complex64 == any`). In `src/backend/wasm/emit-stmts.js:_emitCaseListMatch` (`:3465`, shared by `emitSwitchStmt` and `_emitFallthroughSwitch`), a case value is emitted with `tagWType` instead of boxing `tagTmp` to `anyref` when the case value is an interface, and `src/backend/wasm/prescan.js:_usesAnyEq` (`:75`) checks `isAnyRef(n.tag)` on `SwitchStmt` without checking case values. `npm run fuzz:check` tag `wasm-iface-equality` (94 entries: 44 `binary:==` and 50 `switch:tag`).

| ID | Program | Go | GoFront |
|---|---|---|---|
| F3.1 (ledger) | `var a int; var b any; fmt.Println(a == b)` | `false` | wasm invalid; js/both correct |
| F3.2 *sibling* | `a := "x"; var b any = "x"; a == b`; `s == i` with `S` struct and `I interface{}` / non-empty `I`; `a != b`; `[2]int{1, 2} == b`; `&x == b`; `var c complex64 = 1+2i; var b any = c; c == b && b == c` | `true`; `true`; `false`; `true`; `true`; `true` | wasm invalid |
| F3.3 *sibling* | `var b any = 2; switch 2 { case b: … }` (with and without `fallthrough`, and without `fmt` import); `switch s { case i: … }` with non-empty `I` | `hit` | wasm invalid |
| control | `b == a` (interface left, non-complex); `switch b { case 2: }` | `false`; `hit` | correct (must stay) |

### F4 `wasm-typeswitch-empty-iface`
Root: `src/backend/wasm/emit-stmts.js:_emitTypeTest` (`:1486–1504`) — the single shared type-test helper called by `emitTypeSwitchStmt` (`:3580`), `_emitCommaOkTypeAssert` (`:1262`), and `TypeAssertExpr` (`src/backend/wasm/emit-exprs.js:387`) — checks `targetGoType.name === "any" || targetGoType.name === "interface{}"` (`:1499`). An `interface{}` literal has `kind: "InterfaceType"` / `"interface"` with no `name`, and a defined empty interface (`type B interface{}`, `type C B`) has `kind: "named"`, so both fall through to scalar box lookup (`getIfaceBoxType`, `:1564`) and never match. In addition, `isAnyType` in `src/backend/wasm/types.js` (`:682–696`, used by `emitExpr` at `emit-exprs.js:67` when re-boxing a bound variable into `anyref`) misses `kind === "InterfaceType"` and `namedUnderlying`.

| ID | Program | Go | GoFront |
|---|---|---|---|
| F4.1 (ledger) | `type B interface{}; var x any = B(1); switch v := x.(type) { case B: fmt.Println(v) }` | `1` | wasm prints nothing; js/both `1` |
| F4.2 *sibling* | `switch v := x.(type) { case interface{}: fmt.Println(v) }`; `type C B; switch v := x.(type) { case C: fmt.Println(v) }` | `1`; `1` | wasm prints nothing |
| F4.3 *sibling* | `v, ok := x.(B)` and `v, ok := x.(interface{})` with `x any = 1`; single-value `v := x.(B)` and `v := x.(interface{})` | `1 true`; `1` | wasm `<nil> false`; wasm panics `interface conversion: interface {} is int, not main.B` / `interface {}` |
| control | `case any:`; `_, ok := x.(B)` with `var x any` (nil) | `1`; `false` | correct (must stay) |

### F5 `wasm-defined-pointer`
Root: two pointer paths in `src/backend/wasm/` test `kind === "pointer"` or read `.base` without unwrapping defined types via `namedBase` (`src/backend/shared/named-underlying.js`): (1) dereference read/write/compound/inc-dec (`_emitDerefExpr` in `src/backend/wasm/emit-exprs.js:1897`, `_emitDerefAssign` `:1136`, compound assign `:1940`, and inc/dec `:2080` in `src/backend/wasm/emit-stmts.js`) read `operandGoType?.base ?? operandGoType` directly (and `_isPointerGoType`/`_ptrBaseType` at `emit-exprs.js:1862–1872` only unwrap one `named` level), so `*p` on `type P1 *int` treats `P1` itself as the pointee type and emits a pointer-box access instead of `i64`; and (2) `_resolveStructInfo` (`src/backend/wasm/emit.js:1144`), `isPointerToStruct` (`src/backend/wasm/types.js:479`), `_structNameOf` (`emit-stmts.js:1442`), and `_emitNilCheck` (`emit-exprs.js:632`, `emit-stmts.js:1116`) only unwrap `pointer`/`PointerType`/`StarExpr`, so selectors and dereferences on `type PS *S` cannot resolve struct `S`.

| ID | Program | Go | GoFront |
|---|---|---|---|
| F5.1 (ledger) | `type P1 *int; x := 3; var p P1 = &x; fmt.Println(*p)` | `3` | wasm invalid; js/both `3` |
| F5.2 *sibling* | `type P2 P1`; `type Opt[T any] *T` with `Opt[int]`; `var p P1 = new(int); *p = 4; *p += 2; *p++` | `3`; `3`; `7` | wasm invalid / ICE `Unsupported WASM instruction opcode: '[object Object].add'` |
| F5.3 *sibling* | `type S struct{ X int }; type PS *S; s := S{3}; var p PS = &s; p.X = 9; p.X += 2; fmt.Println(p.X)` | `11` | wasm ICE `Cannot resolve struct for selector` / `selector assignment` / `compound selector: X` |
| control | `type P1 *int; var p P1; fmt.Println(p == nil)` | `true` | correct (must stay) |

### F6 `wasm-flat-mono-scope`
Root: `src/backend/wasm/monomorph.js:monomorphise` (`:649`, `:864–883`) re-checks all linked user and stdlib ASTs with one shared `TypeChecker` (`monoChecker.checkAll(progs)`), so any unexported user package declaration (`func`, `var`, or `const`) named after a predeclared builtin overwrites that builtin in `monoChecker.globalScope` when checking stdlib programs (or another linked user `wasm` package).

| ID | Program | Go | GoFront |
|---|---|---|---|
| F6.1 (ledger) | `func append(x int) int { return x + 1 }; s := []int{3, 1}; slices.Sort(s); fmt.Println(append(1), s)` | `2 [1 3]` | wasm ICE `Type error in utf8.go … Too many arguments`; js/both correct |
| F6.2 *sibling* | `func new(x int) int`, `func copy(x int) int`, `func make(x int) int`, `func panic(x int) int`, or `var append = 42` with `slices.Sort`; `func append(x int) int` in `main` with `util.Grow[int]` calling builtin `append` in `./util` | `2 [1 3]`; `42 [1 3]`; `2 [1 2]` | wasm ICE in `strconv`/`float.go`/`utf8.go`/`util.go` |
| control | `type Ordered int` beside `slices.Sort`; `type byte struct{ X int }` beside `slices.Sort` | `1 [1 3]` | correct (must stay) |

---

## Approach

### 1. Architecture & Design Decisions
- **F1.** The JS backend wraps an expression statement (including a blank-assignment discard in `_genAssignStmt` and `ExprStmt`) in parentheses when its emitted text starts with `{`; one helper in `src/backend/js/statements.js` is used by both emission paths. In `_genRangeExprFor`, a zero-variable string range (`this._isStringRangeType(iterType)`) iterates `for (const _$ of ${iteree} ?? "")` (code points).
- **F2.** `_checkCallArgs` (`src/typechecker/expressions.js`) rejects `_spread` against a non-variadic `fnType` before `_checkArgCount` with Go's message naming `exprText(expr.func)`, and rejects `argTypes.length > fnType.params.length` when `_spread` is present on a variadic call. In `_checkCallExpr` / `_checkAppendArgs`, `_spread` on a non-`append` builtin reports `invalid use of ... with built-in <name>`, `_spread` on `append` with `expr.args.length > 2` reports `too many arguments in call to append`, and `_spread` on a type conversion reports `invalid use of ... in conversion to <T>`.
- **F3.** In `src/backend/wasm/emit-exprs.js:emitBinaryExpr`, when `op === "==" || op === "!="` and either operand is an interface (`isInterfaceType(..., this.mod.checker)`, checked before `isComplex`), both sides are emitted as `"anyref"` and compared via `_emitAnyEq`. In `src/backend/wasm/emit-stmts.js:_emitCaseListMatch` (used by `emitSwitchStmt` and `_emitFallthroughSwitch`), when a case expression is an interface and `tagWType !== "anyref"`, `tagTmp` is boxed to `"anyref"` and compared with `_emitAnyEq`; `src/backend/wasm/prescan.js:_usesAnyEq` also scans switch case expressions for `isAnyRef`.
- **F4.** `src/backend/wasm/types.js` adds `isEmptyInterface(goType, checker)` (`isInterfaceType(goType, checker) && !isNonEmptyInterface(goType, checker)`) and unifies `isAnyType` with `isInterfaceType` so `InterfaceType` AST nodes and `namedUnderlying` chains are recognised everywhere. `src/backend/wasm/emit-stmts.js:_emitTypeTest` uses `isEmptyInterface` to match every non-nil value (`ref.is_null; i32.eqz`), covering `emitTypeSwitchStmt`, `_emitCommaOkTypeAssert`, and `TypeAssertExpr` (`src/backend/wasm/emit-exprs.js:387`) in one shared helper.
- **F5.** `src/backend/wasm/` resolves defined pointer types through `namedBase(t, checker)` (`src/backend/shared/named-underlying.js`): `isPointerToStruct` (`src/backend/wasm/types.js`), `_isPointerGoType`/`_ptrBaseType`, `_emitDerefExpr`, and `_emitNilCheck` (`src/backend/wasm/emit-exprs.js`), `_emitDerefAssign`, deref compound assignment, deref inc/dec, `_emitStructDerefAssign`, and `_structNameOf` (`src/backend/wasm/emit-stmts.js`), and `_resolveStructInfo` (`src/backend/wasm/emit.js`).
- **F6.** `src/backend/wasm/monomorph.js:monomorphise` keeps `monoChecker.types` and cross-package value declarations (`$$`-mangled stdlib declarations and exported declarations of linked user packages) shared while scoping each package's unexported value declarations (`func`, `var`, `const`, including shadows of predeclared builtins) to programs of that package (`p.pkg?.name`).

### 2. Invariants & Safety Bounds
- Programs without the affected forms emit byte-identical JS and `wasm`.
- F2 rejects only programs Go rejects; `append`, `fmt.Println(xs...)` and every stdlib variadic call stay valid.

### 3. Edge Cases & Error Handling
- F1: a discarded func literal or array literal does not start with `{` and stays unwrapped.
- F3: interface-to-interface comparison and `nil` comparisons keep their current path; `any == complex64` and `complex64 == any` use interface equality rather than `emitComplexBinary`.
- F4: a type switch `case B, int:` with several types binds `any`, as Go does; `x.(B)` and `x.(interface{})` on a nil interface still panic (single-value) or return `false` (comma-ok).

---

## Implementation Tasks

### Phase 1: JS statement emission (roots `js-stmt-expr-start`, `js-zero-var-string-range`)
*Scheduled from review follow-ups (2026-11-19). Two roots in one phase by file locality: both are statement emission in `src/backend/js/statements.js`, one task each.*
- [x] Task 1.1: Expression statements that would start with `{` are parenthesised (F1.1, F1.2)
  - Files: `src/backend/js/statements.js`
  - Test: `test/unit/language/expressions.test.js` F1.1 and F1.2 (including `if _ = map[any]int{1: 1}; true {}`) run on js/both (`assertOutput`); the struct-literal control
  - Done when: Go's result on js/both; no other emitted statement changes
- [x] Task 1.2: Zero-variable string `range` iterates runes (F1.3, F1.4)
  - Files: `src/backend/js/statements.js` (`_genRangeExprFor`)
  - Test: `test/unit/language/range-iter.test.js` F1.3 → `1`, F1.4 → `2`, `1` on all targets; one-variable index control unchanged
  - Done when: Go's output on all targets

### Phase 2: Spread arguments (root `spread-non-variadic`)
- [x] Task 2.1: `...` to a non-variadic callee, non-`append` builtin, or type conversion is an error (F2.1, F2.2, F2.4)
  - Files: `src/typechecker/expressions.js` (`_checkCallExpr`, `_checkCallArgs`)
  - Test: reject fixtures `spread_non_variadic_func.go`, `spread_non_variadic_method.go`, `spread_non_variadic_func_value.go`, `spread_non_variadic_zero_param.go`, `spread_builtin_len.go`, `spread_type_conversion.go`
  - Done when: Go's message on all targets
- [x] Task 2.2: Extra arguments before a spread are counted on variadic calls and `append` (F2.3, F2.4)
  - Files: `src/typechecker/expressions.js` (`_checkCallArgs`, `_checkAppendArgs`)
  - Test: reject fixtures `spread_extra_fixed_args.go` (`too many arguments in call to f`), `spread_append_extra_args.go` (`too many arguments in call to append`); `append(s, t...)` and `fmt.Println(xs...)` controls in `test/unit/types/checks.test.js`
  - Done when: Go's message on all targets, no wasm invalid module

### Phase 3: `wasm` comparisons with an interface operand (root `wasm-iface-equality`)
- [x] Task 3.1: `==` and `!=` with an interface on either side (including against complex operands) box the concrete side (F3.1, F3.2)
  - Files: `src/backend/wasm/emit-exprs.js`, `test/fuzz/check-baseline.txt`
  - Test: `test/unit/wasm/interfaces.test.js` F3.1 → `false`, F3.2 → `true`, `true`, `false`, `true`, `true`, `true` on all targets (or `wasm` for struct-vs-interface until checker-operand-rules JS struct-vs-interface lands)
  - Done when: valid module, Go's output; all 44 `binary:==:... # wasm-iface-equality` keys removed from `test/fuzz/check-baseline.txt`
- [x] Task 3.2: `switch` case values that are interfaces box a concrete tag and mark `_usesAnyEq` (F3.3)
  - Files: `src/backend/wasm/emit-stmts.js`, `src/backend/wasm/prescan.js`, `test/fuzz/check-baseline.txt`
  - Test: `test/unit/wasm/interfaces.test.js` F3.3 → `hit` (plain, fallthrough, and without `fmt`) on all targets; tag-side control unchanged
  - Done when: valid module, Go's output; all remaining 50 `switch:tag:... # wasm-iface-equality` keys removed from `test/fuzz/check-baseline.txt` (0 `# wasm-iface-equality` keys left)

### Phase 4: `wasm` type tests against empty interfaces (root `wasm-typeswitch-empty-iface`)
- [ ] Task 4.1: `isEmptyInterface` and `isAnyType` recognise every empty-interface spelling, and `_emitTypeTest` matches every non-nil value in type switches (F4.1, F4.2)
  - Files: `src/backend/wasm/types.js`, `src/backend/wasm/emit-stmts.js` (`_emitTypeTest`)
  - Test: `test/unit/wasm/iface-assert.test.js`: F4.1, F4.2 (`interface{}` and chained `type C B`) → `1`; `case nil` and multi-type cases unchanged
  - Done when: Go's output on all targets
- [ ] Task 4.2: Comma-ok and single-value assertions to `interface{}` and defined empty interfaces succeed for non-nil values and fail on `nil` (F4.3)
  - Files: `src/backend/wasm/emit-stmts.js`, `src/backend/wasm/emit-exprs.js`
  - Test: `test/unit/wasm/iface-assert.test.js`: F4.3 (`v, ok := x.(B)`, `v, ok := x.(interface{})` → `1 true`; `v := x.(B)`, `v := x.(interface{})` → `1`); `x.(B)` and `x.(interface{})` on a nil interface still panic / report `false`
  - Done when: Go's output on all targets

### Phase 5: `wasm` defined pointer types (root `wasm-defined-pointer`)
- [ ] Task 5.1: Dereference read, write, compound assignment, and inc/dec unwrap defined pointer types through `namedBase` (F5.1, F5.2)
  - Files: `src/backend/wasm/types.js`, `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/emit-stmts.js`
  - Test: `test/unit/wasm/pointers.test.js`: F5.1 → `3`, F5.2 → `3`, `3`, `7` on all targets
  - Done when: valid modules, Go's output
- [ ] Task 5.2: Selectors through a defined pointer to a struct resolve the struct for reads, writes, and compound ops (F5.3)
  - Files: `src/backend/wasm/emit.js` (`_resolveStructInfo`), `src/backend/wasm/emit-stmts.js` (`_structNameOf`)
  - Test: `test/unit/wasm/pointers.test.js`: F5.3 → `11` on all targets
  - Done when: no ICE, Go's output on all targets

### Phase 6: Monomorphisation scopes (root `wasm-flat-mono-scope`)
- [ ] Task 6.1: `monomorphise` scopes each package's unexported value declarations to its own ASTs while keeping types and cross-package symbols shared (F6.1)
  - Files: `src/backend/wasm/monomorph.js` (`monomorphise`)
  - Test: `test/unit/wasm/generics.test.js` F6.1 → `2 [1 3]` on all targets; multi-package user `wasm` generic call when `main` shadows `append`; existing monomorph tests pass
  - Done when: no ICE; a stdlib or imported package body never resolves another package's unexported declarations
- [ ] Task 6.2: Every builtin the stdlib generics call can be shadowed by a user function, variable, or constant (F6.2)
  - Files: `src/backend/wasm/monomorph.js`
  - Test: `test/unit/wasm/generics.test.js` table over user functions named `append`, `new`, `copy`, `make`, `cap`, `panic`, `min`, `max` and `var append = 42` beside `slices.Sort`/`maps.Keys` (`len` excluded: checker-go-rules Phase 28), each printing Go's output on `wasm`
  - Done when: all rows pass
