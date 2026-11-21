# Diagnostic Text Matches Go — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-19 (`/bs-plan follow-ups`): ledger *Assignment diagnostics text* (root `operand-text`, PRs #238, #240) and the four roots the conformance-harness fix (`f78f4e1b`) exposed, whose cases carry `// pending: <root>`. Verdicts (which programs are rejected) belong to [`checker-go-rules-plan.md`](checker-go-rules-plan.md) and [`checker-operand-rules-plan.md`](checker-operand-rules-plan.md); this plan changes only the text of errors that are already reported. Operator wording (Phase 4) lands after checker-operand-rules Phase 2, whose operator table decides which operator message applies.  
**Release note:** Compile errors now describe your code and types in Go's words, for example `cannot use b (variable of type []string) as []int value in argument to append` instead of `Cannot assign []string to []int`, so messages match Go's documentation and are easier to search for.

---

## Goal

GoFront's diagnostics name the right line and reject the right programs (the checker plans fix verdicts), but much of their text is GoFront's own: `Cannot assign X to Y`, `expression[0]` for an operand it cannot print, `struct{...}` for a type, a constant's source spelling instead of its value. Until 2026-11-18 the conformance harness could not see this, because every message embeds the source line and the `// ERROR` marker matched itself; the harness fix exposed 14 cases (marked pending) and a marker audit against `go build` found about a third of all reject markers (114 of 333, single-file cases) are not part of Go's message on their line. This plan makes the text Go's, through the four places that produce it: operand text, operand descriptions, type text, and the assignment and operator wordings.

**Done means:**
- `npm run conformance:go` (Go installed; Task 1.1) reports no reject marker that is not a substring of Go's message on that line, except the entries in its baseline tagged with an *Excluded* row below.
- `node test/unit/run.js types/conformance.test.js` passes with no `// pending: operand-text`, `assign-message-text`, `operator-message-text`, `type-text-elided` or `const-key-text` header left.
- `grep -rn 'Cannot assign' src/typechecker` returns only the single documented `here: convert it explicitly` site in `assignability.js`; `grep -nE '(struct|interface)\{\.\.\.\}' src/typechecker/types.js` finds nothing; `exprText` (`src/typechecker/operand-text.js`) never returns `"expression"` for a node kind that appears in a test.
- `npm test`, `npm run check` and the stdlib build pass; no program changes verdict and no accepted program changes output and `test/perf/bundle-size.baseline.json` is unchanged.

---

## Scope Rule & Boundary Matrix

**Scope rule:** a defect is in scope when GoFront reports an error on the line Go does and the text differs from Go's because of how GoFront prints an operand, a type, a constant, or the assignment or operator rule that failed.

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Tooling: a Go-backed audit of every reject marker (`npm run conformance:go`, manual, Go needed) with a baseline | `test/fuzz/conformance-go.js`, `test/fuzz/gocheck/` all-errors mode | |
| **In scope: core** | Root `operand-text`: one printer of an operand's source text (composite literals, index, selector, assertion, conversion and call operands) and one description of its kind (`variable of type T`, `constant 2 of type float64`, `untyped float constant 1000`) | D1.1–D1.6 | |
| **In scope: core** | Roots `type-text-elided`, `const-key-text`, `constraint-text`: types and constraints print in full (`interface{}`, `struct{X int}`, `~int \| ~float64`); duplicate keys and cases print the constant value | D2.1–D2.5 | |
| **In scope: core** | Root `assign-message-text`: every assignability failure reports `cannot use x (… of type X) as Y value in <context>` with Go's context names | D3.1–D3.4 | |
| **In scope: core** | Root `operator-message-text`: operator failures report Go's `mismatched types X and Y` / `operator op not defined on x (…)` | D4.1–D4.2 | |
| **Excluded: deferred** | Wrong verdicts (Go rejects, GoFront accepts, or the reverse) | everything in the checker fuzzer baseline | Owned by checker-go-rules and checker-operand-rules |
| **Excluded: deferred** | Error positions and columns, error counts per statement | checker-go-rules R10 | Root `node-positions` / `forwarded-tuple` in checker-go-rules |
| **Excluded: runtime / platform** | GoFront-only diagnostics with no Go counterpart | `wasm` package-boundary errors, `.d.ts` interop errors, `type Set shadows the JavaScript global Set` | No Go message to match; tagged `# excluded: gofront-only` in the audit baseline |
| **Excluded: runtime / platform** | The documented named/unnamed struct restriction (`Cannot assign A to struct{...} here: convert it explicitly …`) | the 11 `identity_*` reject cases Go compiles: `identity_map_key`, `identity_comma_ok_assertion`, `identity_comma_ok_assertion_redeclared`, `identity_comma_ok_map_lookup`, `identity_defer_argument`, `identity_embedded_struct_conversion`, `identity_forwarded_argument`, `identity_forwarded_return`, `identity_multi_value_declaration`, `identity_range_assignment`, `identity_switch_case` | Deliberate rejection (`docs/go-compatibility.md`, *range assignment, switch cases, … need an explicit conversion*); Go accepts these programs, so there is no Go text. Only `typeStr` (Task 2.1) changes their wording; tagged `# excluded: documented-restriction` |
| **Excluded: deferred** | Go's secondary lines (`previous case`, `have (…) want (…)`) | `duplicate case …` + `./main.go:8:7: previous case` | GoFront reports one line per error; the headline must match |

---

## Verified Gaps & Baseline Audit

**Method.** Initially audited on `docs/follow-ups-2026-11-18` at `f78f4e1b` (conformance-harness fix on `3061597e`) and re-verified on `feat/checker-go-rules` at `258d4148`. Each failing conformance case and each ledger repro was built with `go build -gcflags=-e` (go1.26, module `go 1.24`) for Go's messages and compiled with GoFront on `js`/`both`/`wasm` (`runProgram`, `test/unit/helpers.js`); all three targets print the same text. The marker audit copied each single-file `test/unit/fixtures/conformance/reject/*.go` to a scratch module (deleted), ran `go build -gcflags=-e`, and counted a marker as a miss when no Go message on its line contains it (208 files, 333 markers, 114 misses; a few misses are files where Go reports two errors on one line, which Task 1.1 handles). 11 of the files are `identity_*` cases Go compiles without error: the documented struct-identity restriction (*Excluded*).

### D1 `operand-text`
Root: `src/typechecker/operand-text.js:exprText` already prints `Ident`, `BasicLit`, `ImagLit`, `ParenExpr`, `SelectorExpr`, `UnaryExpr`, `BinaryExpr`, `CallExpr`, and `IndexExpr`, but returns `"expression"` for `CompositeLit`, `TypeAssertExpr`, `TypeConversion`, `SliceExpr`, `FuncLit`, `InstantiationExpr`, `TypeExpr`, and `AwaitExpr`; `operandKind` ignores `node._const` (already attached by `checkExpr` → `_noteConst` at `src/typechecker/constants.js:202`, including function-local typed constants via `_evalConstIdent`), and `_checkExprStmt` (`src/typechecker/statements.js:109-112`) formats untyped constants as `untyped <T> value` instead of calling `operandKind`, so typed constants print as `variable of type T` and untyped constants omit their value; and 13 `cannot convert` sites in `src/typechecker/expressions.js` (`:1434`–`:2091`) print `cannot convert X to Y` without the operand or `to type`.

| ID | Program | Go | GoFront |
|---|---|---|---|
| D1.1 (`addr_lit_elem`) | `_ = &[2]int{1, 2}[0]` | `invalid operation: cannot take address of [2]int{…}[0] (value of type int)` | `… cannot take address of expression[0] (value of type int)` |
| D1.2 (`assign_lit_elem`, ledger) | `[2]int{1, 2}[0] = 3` | `cannot assign to [2]int{…}[0] (neither addressable nor a map index expression)` | `cannot assign to expression[0] …` |
| D1.3 (`assign_lit_field`, `assign_assert_field`) | `P{}.X = 1`; `i.(P).X = 1` | `cannot assign to P{}.X …`; `cannot assign to i.(P).X …` | `cannot assign to expression.X …` |
| D1.4 (`unused_conversion`) | `float64(x)` as a statement | `float64(x) (value of type float64) is not used` | `expression (value of type float64) is not used` |
| D1.5 (`convert_embedded_vs_named_field`) | `var a struct{ E }; _ = struct{ E E }(a)` | `cannot convert a (variable of type struct{E}) to type struct{E E}` | `cannot convert struct{...} to struct{...}` (13 sites in `expressions.js` omit operand and `to type`; elided types, D2) |
| D1.6 (ledger, `range_float_lit`, *siblings* `&k`, `len(1e3)`) | `const k float64 = 2; for i := range k {}` (`expressions.js:1723`); `for range 1e3 {}`; `_ = &k`; `_ = len(1e3)` | `cannot range over k (constant 2 of type float64)`; `… 1e3 (untyped float constant 1000)`; `cannot take address of k (constant 2 of type float64)`; `invalid argument: 1e3 (untyped float constant 1000) for built-in len` | `(variable of type float64)`; `(untyped float constant)` across all `operandKind` callers |

### D2 `type-text-elided`, `const-key-text`
Root: `src/typechecker/types.js:typeStr` returns `t.name || "struct{...}"` / `"interface{...}"` for unnamed struct and interface types (including inline interface constraints with `unionConstraint` from `resolve.js:723`); `src/typechecker/expressions.js:2866` (duplicate map key, `exprText(elem.key)`) and `statements.js:699` (duplicate case) print the key's source text, not its constant value.

| ID | Program | Go | GoFront |
|---|---|---|---|
| D2.1 (`incdec_empty_interface`) | `var v interface{}; v++` | `invalid operation: v++ (non-numeric type interface{})` | `… (non-numeric type interface{...})` |
| D2.2 *sibling* (`append_elem_struct`, `convert_embedded_vs_named_field`) | any message naming an unnamed struct type | `struct{Y string}`, `struct{E}` | `struct{...}` |
| D2.3 (`duplicate_map_key_forms`) | `map[string]int{"a": 1, k: 2}` with `const k = "a"`; `0x1`, `1.0` keys | `duplicate key "a" in map literal`; `duplicate key 1 …` | `duplicate key k …`; `0x1`, `1.0` |
| D2.4 *sibling* (`duplicate_case_other_forms`) | `case 1, 0x1:`; `case 2.0:` (`switch f`); `case "a":` | `duplicate case 0x1 (constant 1 of type int) …`; `duplicate case 2.0 (constant 2 of type float64) …`; `duplicate case "a" (constant of type string) …` | `duplicate case 0x1 in expression switch` (headline prefix matches; the constant description is missing) |
| D2.5 (ledger *Inline union constraint text*, 2026-11-19) | `func M[T interface{ ~int \| ~float64 }](a, b T) T { return a % b }` | `… (variable of type T constrained by interface{~int \| ~float64})` | `constrained by interface{...}` (resolved `interface` type with `.unionConstraint` hits `typeStr` fallback; controls: `T ~int \| ~float64` and `T int \| float64` already print their terms via `assignability.js:361` from `7bfa9e0f`, and a named constraint prints `Num`) |

### D3 `assign-message-text`
Root: `src/typechecker/assignability.js` (`:877`, `:1145`, `:1352`, `:1362`, `:1388`, `:1396`, `:1409`) and `src/typechecker/statements.js` (`:507`, `:962`) report assignability failures as `Cannot assign ${typeStr(s)} to ${typeStr(t)}` (or `Cannot assign int to ...`), without the operand or the context Go names; the `nil` path names `assignment` for a struct-literal field. (`assignability.js:1139` is the excluded documented struct-identity restriction.)

| ID | Program | Go | GoFront |
|---|---|---|---|
| D3.1 (`append_spread_mismatch`) | `xs = append(xs, b...)` with `b []string` | `cannot use b (variable of type []string) as []int value in argument to append` | `Cannot assign []string to []int` |
| D3.2 (`append_elem_struct`) | `append(s, struct{ Y string }{"a"})` into `[]struct{ X int }` | `cannot use struct{Y string}{…} (value of type struct{Y string}) as struct{X int} value in argument to append` | `Cannot assign struct{...} to struct{...}` |
| D3.3 (`generic_over_struct_field_type`, `numeric_int32_to_int64`) | `var s string = w.X` (`w.X int`); `var b int64 = a` (`a int32`) | `cannot use w.X (variable of type int) as string value in variable declaration`; `… as int64 value …` | `Cannot assign int to string`; `Cannot assign int32 to int64` |
| D3.4 (`nil_to_non_nilable_contexts` line 21) | `Flags{on: nil}` with `on bool` | `cannot use nil as bool value in struct literal` | `… in assignment` |

Size: 80 assertion lines in 43 test files match `Cannot assign`.

### D4 `operator-message-text`
Root: `src/typechecker/assignability.js:392` falls back to `Invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}` when no operator rule produced Go's text.

| ID | Program | Go | GoFront |
|---|---|---|---|
| D4.1 (`compound_add_bool`) | `var b bool; b += true` | `invalid operation: operator + not defined on b (variable of type bool)` | `Invalid operation: bool + untyped bool` |
| D4.2 (`identity_compound_assignment`) | `u += a` with `u struct{ X int }`, `a A` | `invalid operation: u += a (mismatched types struct{X int} and A)` | `Invalid operation: struct{...} + A` |

---

## Approach

### 1. Architecture & Design Decisions
- **Marker audit (Task 1.1).** `test/fuzz/gocheck` already collects every `types.Error` into `found` (`main.go:77-84`) and returns `found[0]`; it gains an all-errors field returning the full `found` list, and `test/fuzz/conformance-go.js` sends every reject case (single-file and Go directory cases, the latter through `pkgs`; `.d.ts` directory cases are tagged `# excluded: gofront-only`) and reports each marker that is not a substring of a Go message on its line, against a baseline file in the `check-baseline.txt` format. Manual like `fuzz:check`; Go is not needed by `npm test`.
- **Operand text, constant values, and conversions (Phase 1).** `exprText` adds printers for the missing AST kinds (`CompositeLit` as `T{…}` / `P{}`, `TypeAssertExpr` `x.(T)`, `TypeConversion` `T(x)`, `SliceExpr` `x[a:b:c]`, `FuncLit`, `InstantiationExpr` `f[T]`, `TypeExpr`, `AwaitExpr`, plus type-node printers), matching `go/types` (`ExprString`). Because `checkExpr` already runs `_noteConst` (`src/typechecker/constants.js:202`) and attaches `node._const` (including function-local typed constants via `_evalConstIdent`), `operandKind` reads `node?._const` directly (falling back to `node?._type?.kind === "untyped"` when `isUntypedConst` is omitted) so every caller prints `constant V of type T` (typed) or `untyped K constant V` (untyped) without threading `scope`; `_checkExprStmt` (`statements.js:109-112`) routes constant untyped expressions through `operandKind` while keeping `untyped K value` for non-constant untyped expressions (`x == 1`). One `_convertError(operand, srcType, targetType, ...)` in `expressions.js` replaces the 13 bare `cannot convert X to Y` sites (`:1434`–`:2091`; `:1545` keeps its `in a wasm package: …` suffix) with `cannot convert <operand> (<kind>) to type <T>`.
- **Types and constants (Phase 2).** `typeStr` prints unnamed struct and interface types in full, with Go's spacing (`struct{X int}`, `interface{M()}` omitting `void` returns, `interface{}`, `interface{~int | ~float64}` for `unionConstraint` / `_comparable` / `_typeSetEmbeds`, with `_resolveInterfaceType` at `resolve.js:723` or `operand-text.js` type-node printing handling unresolved AST union terms), and a depth guard for recursive types (`namespace{...}` stays GoFront-specific). Duplicate key messages print the folded constant value; duplicate case messages format `this._constIdentityType(e, stmt.tag?._type)` as `(constant V of type T)`, omitting `V` when `exprText(e)` already equals `V` (`duplicate case "a" (constant of type string)`).
- **Assignment wording (Phase 3).** One `_assignError(source, target, operand, ctx)` in `assignability.js` builds `cannot use <operand text> (<operand kind>) as <T> value in <ctx>` (used by `assignability.js` and `statements.js:507`, `:962`; `_assertNestedAssignable` and `_checkArrayAssignable` report the outer composite `source`/`target` types, and range target mismatches at `statements.js:507`, `:962` print `cannot use <lhs> (value of type int) as <T> value in assignment`); `ctx` is threaded from callers (`variable declaration`, `assignment`, `return statement`, `argument to f`, `struct literal`, `map literal`, `array or slice literal`, `map index`, `range clause`). The documented named/unnamed struct restriction (`assignability.js:1139`, *Excluded*) keeps its `Cannot assign ... here: convert it explicitly ...` wording (only `typeStr` updates its type text in Task 2.1).
- **Operator wording (Phase 4).** The `Invalid operation` fallback at `assignability.js:392` is replaced by Go's two forms; after checker-operand-rules Phase 2 the fallback should be reachable only for mismatched operand types or untyped-vs-typed operator mismatches (e.g. `b += true`).

### 2. Invariants & Safety Bounds
- Text only: no program changes verdict, error count or position, and no accepted program changes output.
- The documented `here: convert it explicitly with T(v)` restriction (`assignability.js:1139`) stays intact as excluded in the Scope Boundary Matrix.

### 3. Edge Cases & Error Handling
- Recursive types (`type L struct{ next *L }` printed unnamed) must not loop: `typeStr` stops at named types and has a depth guard.
- JS-dynamic `any` values have no Go spelling; their operand kind stays GoFront's (`value of type any`).
- Generic instances print as Go does (`Box[int]`), unchanged.

---

## Implementation Tasks

### Phase 1: Marker audit and operand text (root `operand-text`)
*Scheduled from review follow-ups (2026-11-19): ledger *Assignment diagnostics text* and the `// pending: operand-text` cases.*
- [x] Task 1.1: `npm run conformance:go` audits every reject marker against Go
  - Files: `test/fuzz/gocheck/main.go` (all-errors mode), `test/fuzz/conformance-go.js`, `package.json`
  - Test: `test/unit/cli/conformance-go.test.js` (no Go needed): marker extraction, baseline read/write and the substring rule on canned Go output; then `npm run conformance:go -- --write-baseline` writes `test/fuzz/conformance-go-baseline.txt`
  - Done when: the audit runs over all reject cases and its baseline lists today's misses with a tag per root (`D1`–`D4`, `excluded: gofront-only`, `excluded: documented-restriction`)
- [x] Task 1.2: `exprText` prints composite literal, assertion, conversion, slice, func literal, instantiation and type-node operands (D1.1–D1.4)
  - Files: `src/typechecker/operand-text.js` (`exprText`, `litText`, type-node printers)
  - Test: remove `// pending: operand-text` from `addr_lit_elem`, `assign_lit_elem`, `assign_lit_field`, `assign_assert_field`, `unused_conversion`; `test/unit/types/checks.test.js` table of node kinds → text (including `SliceExpr`, `FuncLit`, `InstantiationExpr`, `TypeExpr`, `AwaitExpr`)
  - Done when: those cases pass; no `"expression"` fallback for the tabled kinds
- [x] Task 1.3: `operandKind` reads `node._const` to carry the constant value across all callers (D1.6)
  - Files: `src/typechecker/operand-text.js` (`operandKind`), `src/typechecker/statements.js` (`_checkExprStmt` at `:109-112`)
  - Test: reject fixture `range_typed_float_const.go` (`constant 2 of type float64`, including a function-local `const k float64 = 2`); `range_float_lit` marker corrected to Go's `(untyped float constant 1000)`; sibling assertions in `test/unit/types/checks.test.js` for `const k float64 = 2; _ = &k` (`constant 2 of type float64`), `len(1e3)` (`untyped float constant 1000`), and `1 + 2` unused statement (`untyped int constant 3`) vs `x == 1` (`untyped bool value`)
  - Done when: Go's constant-value operand kind on all targets across `range` and sibling callers
- [x] Task 1.4: Shared `_convertError` prints operand, kind, and `to type T` (D1.5)
  - Files: `src/typechecker/expressions.js` (`_convertError` replacing the 13 `cannot convert` sites at `:1434`–`:2091`)
  - Test: remove `// pending: operand-text` from `convert_embedded_vs_named_field`; update `test/unit/wasm/generics.test.js:1131` and `test/unit/types/pointers.test.js:295` expecting the old `cannot convert X to Y` without `to type`
  - Done when: `convert_embedded_vs_named_field` passes on all targets; `D1` audit keys removed

### Phase 2: Types and constant values in messages (roots `type-text-elided`, `const-key-text`, `constraint-text`)
- [x] Task 2.1: `typeStr` prints unnamed struct, interface, and inline-union interface types in full (D2.1, D2.2, D2.5)
  - Files: `src/typechecker/types.js` (`typeStr` for `struct` and `interface` including `unionConstraint` / `_comparable` / `_typeSetEmbeds`), `src/typechecker/resolve.js` (`_resolveInterfaceType` union term resolution if not formatted via `operand-text.js`)
  - Test: remove `// pending: type-text-elided` from `incdec_empty_interface`; add reject fixture `generic_mod_inline_iface.go` (`constrained by interface{~int | ~float64}`); `test/unit/types/identity.test.js` table: `struct{X int}`, `struct{E}`, `interface{M()}`, `interface{}`, a self-referential unnamed type; update the 7 `identity_*.go` conformance fixtures asserting `struct{...}`
  - Done when: those cases pass; `grep -nE '(struct|interface)\{\.\.\.\}' src/typechecker/types.js` is empty; `conformance.test.js` and unit tests pass
- [x] Task 2.2: Duplicate map keys and cases print the constant value (D2.3, D2.4)
  - Files: `src/typechecker/expressions.js` (duplicate map key at `:2866`), `src/typechecker/statements.js` (duplicate case at `:699`)
  - Test: remove `// pending: const-key-text` from `duplicate_map_key_forms`; `duplicate_case_other_forms` markers extended to Go's `(constant 1 of type int)`, `(constant 2 of type float64)`, and `(constant of type string)`
  - Done when: Go's headline on all targets; `D2` audit keys removed

### Phase 3: Assignment wording (root `assign-message-text`)
- [ ] Task 3.1: One `_assignError` with operand, kind and context (D3.1–D3.3)
  - Files: `src/typechecker/assignability.js` (`_assignError` replacing `:877`, `:1145`, `:1352`–`:1409`, passing outer types through `_assertNestedAssignable` and `_checkArrayAssignable`), `src/typechecker/statements.js` (`:507`, `:962`), conformance reject fixtures asserting `Cannot assign`
  - Test: remove `// pending: assign-message-text` from `append_spread_mismatch`, `append_elem_struct`, `generic_over_struct_field_type`; update `numeric_int32_to_int64` and the other non-`identity_*`-restriction reject fixtures asserting `Cannot assign` to Go's wording so `conformance.test.js` stays green on this commit; `assignability.js:1139` keeps its documented `here: convert it explicitly` wording
  - Done when: `grep -rn 'Cannot assign' src/typechecker` returns only `assignability.js:1139`; `conformance.test.js` passes
- [ ] Task 3.2: Every caller passes Go's context name (D3.4)
  - Files: `src/typechecker/expressions.js` (composite literals, calls, `delete`, map index), `src/typechecker/statements.js` (returns, range)
  - Test: remove `// pending: assign-message-text` from `nil_to_non_nilable_contexts`; a context table in `test/unit/types/checks.test.js` (one row per context: `variable declaration`, `assignment`, `return statement`, `argument to f`, `struct literal`, `map literal`, `array or slice literal`, `map index`, `range clause`)
  - Done when: Go's context on all targets
- [ ] Task 3.3: Remaining unit test assertions and docs use the new wording
  - Files: the 17 `.test.js` files asserting `Cannot assign` (`test/unit/**`), `docs/usage.md` (`:59`)
  - Test: `npm test`; `npm run conformance:go` loses every `D3` key
  - Done when: `grep -rn "Cannot assign" test/unit docs/` finds only the documented `identity_*` restriction and GoFront-only diagnostics tagged in the audit baseline

### Phase 4: Operator wording (root `operator-message-text`)
*Lands after checker-operand-rules Phase 2 (operator table).*
- [ ] Task 4.1: Mismatched operand types report Go's `mismatched types X and Y` (D4.2)
  - Files: `src/typechecker/assignability.js` (`:392` fallback)
  - Test: (`identity_compound_assignment` lost its `// pending: operator-message-text` header in Task 2.1: `typeStr` now prints `struct{X int}`); update `test/unit/compiler/templ.test.js:1220` (`Invalid operation: string + untyped int`)
  - Done when: Go's text on all targets
- [ ] Task 4.2: An operator not defined on its operand reports Go's `operator op not defined on x (…)` (D4.1)
  - Files: `src/typechecker/assignability.js` (`:384`–`:392`, including untyped-vs-typed operands such as `b += true`)
  - Test: remove `// pending: operator-message-text` from `compound_add_bool`
  - Done when: no `Invalid operation:` (capitalised) message remains in `src/typechecker`; `npm run conformance:go` baseline holds only `excluded:` keys
