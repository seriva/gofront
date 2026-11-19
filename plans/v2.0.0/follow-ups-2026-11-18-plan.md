# Review Follow-ups (2026-11-18) — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-19 (`/bs-plan follow-ups`): the one-off entries that share no root with an open plan, logged by checker-strictness Phase 6 and checker-go-rules Phases 3, 4, 8, 10 and the 2026-11-18 checker fuzzer. The rest of that sweep went to [`checker-go-rules-plan.md`](checker-go-rules-plan.md) (Phases 22–27, R8.12), [`checker-operand-rules-plan.md`](checker-operand-rules-plan.md) (O4.11, O5.8, Phase 9), [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md) (Phase 5) and [`diagnostic-text-plan.md`](diagnostic-text-plan.md). The shadowed-builtin entry is split: its all-target `len` form is checker-go-rules R8.12.  
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
| **Excluded: deferred** | A package function named `len` (or another builtin) breaking generated Go on every target | `func len(x string) int`; `fmt.Println(s)` → `internal error in the generated Go` | Root `predeclared-scope` (generated Go), checker-go-rules R8.12 / Task 14.1 |

---

## Verified Gaps & Baseline Audit

**Method.** A driver in the session scratchpad (deleted) wrote each program as `main.go`, ran `go run` (go1.26) and `runProgram` (`test/unit/helpers.js`) on `js`/`both`/`wasm`, at `60ce661f` plus the conformance-harness fix; roots confirmed by reading the code at `3061597e` unless marked *not traced*. "ICE" = `InternalCompilerError`; "invalid" = the generated module fails `WebAssembly.validate`.

### F1 `js-stmt-expr-start`, `js-zero-var-string-range`
Roots: `src/backend/js/statements.js` emits the right-hand side of a blank assignment (`l.name === "_"` → `this.genExpr(e)`, around `:540`) and expression statements as `${expr};`, so an object literal (a Go map literal) opens the statement with `{` and parses as a block; `_rangeExprLimit` (`:1407`) bounds a zero-variable string range by `.length` (UTF-16 units) instead of iterating code points, while the one- and two-variable forms decode runes.

| ID | Program | Go | GoFront |
|---|---|---|---|
| F1.1 (ledger *JS discarded map literal*) | `_ = map[any]int{1: 1}` | runs | `SyntaxError: Unexpected token ':'` on js/both |
| F1.2 *sibling* | `_ = map[string]int{"a": 1}`; `_, _ = map[any]int{1: 1}, 2` | runs | same `SyntaxError` |
| F1.3 (ledger *JS zero-variable string range*, PR #245) | `type Word string; c := 0; for range Word("😀") { c++ }` | `1` | js/both `2`; wasm `1` |
| F1.4 *sibling* | `for range "😀é" { c++ }` (literal); `s := "😀"; for range s { c++ }` | `2`; `1` | js/both `3`; `2`; wasm correct |
| control | `_ = P{X: 1}` (struct literal); `for i := range "😀é"` (indices, documented UTF-16) | runs; `0 2` | correct (must stay) |

### F2 `spread-non-variadic`
Root: `src/typechecker/expressions.js:_checkCallArgs` ignores the call's `_spread` flag when `!fnType.variadic`, and for a variadic callee does not reject extra arguments before the spread.

| ID | Program | Go | GoFront |
|---|---|---|---|
| F2.1 (ledger) | `func f(xs []int) {}; f([]int{1}...)` | `cannot use ... in call to non-variadic f` | accepted (all targets) |
| F2.2 *sibling* | method `T{}.f([]int{1}...)`; func value `g := func(xs []int) {}; g([]int{1}...)` | same, naming `T{}.f` / `g` | accepted |
| F2.3 *sibling* | `func f(a int, xs ...int) {}; f(1, 2, []int{1}...)` | `too many arguments in call to f` | accepted on js/both; wasm invalid |
| control | `append(s, t...)`; `fmt.Println(xs...)` with `xs []any` | ok | correct (must stay) |

### F3 `wasm-iface-equality`
Root (*not traced past the module*): equality emission in `src/backend/wasm/emit-exprs.js` handles an interface left operand (`any == int` works) but emits an invalid module when only the right operand is an interface; the `wasm` switch lowers a case value that is an interface the same way. `npm run fuzz:check` tag `wasm-iface-equality` (94 entries).

| ID | Program | Go | GoFront |
|---|---|---|---|
| F3.1 (ledger) | `var a int; var b any; fmt.Println(a == b)` | `false` | wasm invalid; js/both correct |
| F3.2 *sibling* | `a := "x"; var b any = "x"; a == b`; `s == i` with `S` struct and `I interface{}`; `a != b` | `true`; `true`; `false` | wasm invalid |
| F3.3 *sibling* | `var b any = 2; switch 2 { case b: … }` | `hit` | wasm invalid |
| control | `b == a` (interface left); `switch b { case 2: }` | `false`; `hit` | correct (must stay) |

### F4 `wasm-typeswitch-empty-iface`
Root (*not traced past the module*): `wasm` type tests (`emitTypeSwitchStmt`, `src/backend/wasm/emit-stmts.js:3556`, and the comma-ok assertion) match the spelling `any` as "every value" but treat `interface{}` and a defined empty interface as a concrete type that never matches.

| ID | Program | Go | GoFront |
|---|---|---|---|
| F4.1 (ledger) | `type B interface{}; var x any = B(1); switch v := x.(type) { case B: fmt.Println(v) }` | `1` | wasm prints nothing; js/both `1` |
| F4.2 *sibling* | `switch v := x.(type) { case interface{}: … }` | `1` | wasm prints nothing |
| F4.3 *sibling* | `v, ok := x.(B)` with `x any = 1` | `1 true` | wasm `<nil> false` |
| control | `case any:` | `1` | correct (must stay) |

### F5 `wasm-defined-pointer`
Root (*not traced*): a defined type whose underlying type is a pointer (`type P1 *int`) is not mapped to the pointer representation on `wasm`; validation fails at `struct.new` in the function that takes `&x`, and a selector through a defined pointer to a struct cannot find the struct.

| ID | Program | Go | GoFront |
|---|---|---|---|
| F5.1 (ledger) | `type P1 *int; x := 3; var p P1 = &x; fmt.Println(*p)` | `3` | wasm invalid; js/both `3` |
| F5.2 *sibling* | `type P2 P1`; `type Opt[T any] *T` with `Opt[int]`; `var p P1 = new(int); *p = 4` | `3`; `3`; `4` | wasm invalid |
| F5.3 *sibling* | `type S struct{ X int }; type PS *S; var p PS = &S{3}; fmt.Println(p.X)` | `3` | wasm ICE `Cannot resolve struct for selector: X` |

### F6 `wasm-flat-mono-scope`
Root: `src/backend/wasm/monomorph.js:monomorphisePrograms` checks user and stdlib ASTs with one shared `TypeChecker` (`new TypeChecker()`, `:864`), so a user package function named after a builtin replaces it in the stdlib generic bodies it instantiates.

| ID | Program | Go | GoFront |
|---|---|---|---|
| F6.1 (ledger) | `func append(x int) int { return x + 1 }; s := []int{3, 1}; slices.Sort(s); fmt.Println(append(1), s)` | `2 [1 3]` | wasm ICE `Type error in utf8.go … Too many arguments`; js/both correct |
| F6.2 *sibling* | `func new(x int) int { return x }` with `slices.Sort` | `2 [1 3]` | wasm ICE `Cannot assign strconv.decimal to int` |
| control | `type Ordered int` beside `slices.Sort` | `1 [1 3]` | correct (must stay) |

---

## Approach

### 1. Architecture & Design Decisions
- **F1.** The JS backend wraps an expression statement (including a blank-assignment discard) in parentheses when its emitted text starts with `{`; one helper used by both emission paths. A zero-variable string range iterates `for (const _ of s)` (code points), the form the one-variable path already decodes.
- **F2.** `_checkCallArgs` rejects `_spread` against a non-variadic `fnType` with Go's message naming the callee text, and counts fixed arguments before a spread.
- **F3.** `wasm` `==`/`!=` normalise operand order: when exactly one side is an interface, the concrete side is boxed and compared with the interface comparison helper, whichever side it is on; the switch lowering reuses it for case values.
- **F4.** `wasm` type tests classify the case type with the checker's `anyKind` (Go `any`, `interface{}`, a defined empty interface: all match every non-nil value, keeping the static type for the binding).
- **F5.** `wasm` type mapping resolves a defined type through `_deepUnderlying` before choosing a pointer representation, and selector resolution follows a defined pointer to its struct.
- **F6.** `monomorphisePrograms` checks each package's AST with its own package scope over the shared universe, so stdlib bodies never see a user package's declarations.

### 2. Invariants & Safety Bounds
- Programs without the affected forms emit byte-identical JS and `wasm`.
- F2 rejects only programs Go rejects; `append`, `fmt.Println(xs...)` and every stdlib variadic call stay valid.

### 3. Edge Cases & Error Handling
- F1: a discarded func literal or array literal does not start with `{` and stays unwrapped.
- F3: interface-to-interface comparison and `nil` comparisons keep their current path.
- F4: a type switch `case B, int:` with several types binds `any`, as Go does.

---

## Implementation Tasks

### Phase 1: JS statement emission (roots `js-stmt-expr-start`, `js-zero-var-string-range`)
*Scheduled from review follow-ups (2026-11-19). Two roots in one phase by file locality: both are statement emission in `src/backend/js/statements.js`, one task each.*
- [ ] Task 1.1: Expression statements that would start with `{` are parenthesised (F1.1, F1.2)
  - Files: `src/backend/js/statements.js`
  - Test: `test/unit/language/expressions.test.js` F1.1 and F1.2 run on js/both (`assertOutput`); the struct-literal control
  - Done when: Go's result on js/both; no other emitted statement changes
- [ ] Task 1.2: Zero-variable string `range` iterates runes (F1.3, F1.4)
  - Files: `src/backend/js/statements.js` (`_rangeExprLimit`, `_genRangeExprFor`)
  - Test: `test/unit/language/range-iter.test.js` F1.3 → `1`, F1.4 → `2`, `1` on all targets; one-variable index control unchanged
  - Done when: Go's output on all targets

### Phase 2: Spread arguments (root `spread-non-variadic`)
- [ ] Task 2.1: `...` to a non-variadic callee is an error (F2.1, F2.2)
  - Files: `src/typechecker/expressions.js` (`_checkCallArgs`)
  - Test: reject fixtures `spread_non_variadic_func.go`, `spread_non_variadic_method.go`, `spread_non_variadic_func_value.go`
  - Done when: Go's message on all targets
- [ ] Task 2.2: Extra arguments before a spread are counted (F2.3)
  - Files: `src/typechecker/expressions.js`
  - Test: reject fixture `spread_extra_fixed_args.go` (`too many arguments in call to f`); `append(s, t...)` and `fmt.Println(xs...)` controls in `test/unit/types/checks.test.js`
  - Done when: Go's message on all targets, no wasm invalid module

### Phase 3: `wasm` comparisons with an interface operand (root `wasm-iface-equality`)
- [ ] Task 3.1: `==` and `!=` with the interface on the right box the concrete side (F3.1, F3.2)
  - Files: `src/backend/wasm/emit-exprs.js`
  - Test: `test/unit/wasm/interfaces.test.js` F3.1 → `false`, F3.2 → `true true false` on all targets
  - Done when: valid module, Go's output; the `# wasm-iface-equality` fuzz keys gone
- [ ] Task 3.2: `switch` case values that are interfaces use the same comparison (F3.3)
  - Files: `src/backend/wasm/emit-stmts.js`
  - Test: F3.3 → `hit` on all targets; tag-side control unchanged
  - Done when: valid module, Go's output

### Phase 4: `wasm` type tests against empty interfaces (root `wasm-typeswitch-empty-iface`)
- [ ] Task 4.1: A type switch case of any empty-interface spelling matches every non-nil value (F4.1, F4.2)
  - Files: `src/backend/wasm/emit-stmts.js` (`emitTypeSwitchStmt`)
  - Test: `test/unit/wasm/iface-assert.test.js`: F4.1, F4.2 → `1`; `case nil` and multi-type cases unchanged
  - Done when: Go's output on all targets
- [ ] Task 4.2: Comma-ok and single-value assertions to an empty-interface type succeed for non-nil values (F4.3)
  - Files: `src/backend/wasm/emit-exprs.js` (type assertion emission)
  - Test: F4.3 → `1 true`; `x.(B)` on a nil interface still panics / reports `false`
  - Done when: Go's output on all targets

### Phase 5: `wasm` defined pointer types (root `wasm-defined-pointer`)
- [ ] Task 5.1: A defined type over a pointer uses the pointer representation (F5.1, F5.2)
  - Files: `src/backend/wasm/types.js`, `src/backend/wasm/emit-exprs.js`
  - Test: `test/unit/wasm/pointers.test.js`: F5.1 → `3`, F5.2 → `3`, `3`, `4` on all targets
  - Done when: valid modules, Go's output
- [ ] Task 5.2: Selectors through a defined pointer to a struct resolve the struct (F5.3)
  - Files: `src/backend/wasm/emit-exprs.js` (selector resolution)
  - Test: F5.3 → `3` on all targets
  - Done when: no ICE

### Phase 6: Monomorphisation scopes (root `wasm-flat-mono-scope`)
- [ ] Task 6.1: Each package's AST is checked in its own package scope during monomorphisation (F6.1)
  - Files: `src/backend/wasm/monomorph.js` (`monomorphisePrograms`)
  - Test: `test/unit/wasm/generics.test.js` F6.1 → `2 [1 3]` on all targets; existing monomorph tests pass
  - Done when: no ICE; a stdlib body never resolves a user package name
- [ ] Task 6.2: Every builtin the stdlib generics call can be shadowed by a user function (F6.2)
  - Files: `src/backend/wasm/monomorph.js`
  - Test: table over user functions named `append`, `new`, `copy`, `make`, `cap`, `panic`, `min`, `max` beside `slices.Sort`/`maps.Keys` (`len` excluded: R8.12), each printing Go's output on `wasm`
  - Done when: all rows pass
