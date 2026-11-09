# v1.9.1 Review Follow-ups (2026-11-09) — Design Plan

**Version:** v1.9.1  
**Status:** Draft  
**Base branch:** main  
**Related:** [`../v1.9.0/follow-ups-2026-11-07-plan.md`](../v1.9.0/follow-ups-2026-11-07-plan.md) (origin of every ledger entry), [`../v1.9.0/runtime-pruning-plan.md`](../v1.9.0/runtime-pruning-plan.md)  
**Release note:** More Go programs now behave the same in JavaScript, in WebAssembly and in Go. This covers methods called on nil pointers, labeled `break` and `continue` inside `range` over a function, `int64` and `uint64` arithmetic with constants, interface checks on values in `any`, and `%T` and type switches on maps built in generic code. The compiler also rejects more programs that Go rejects, such as assigning an `any` to a concrete type without a type assertion, negative array lengths and invalid `switch` cases.

---

## Goal

Schedule and fix every reproducing entry of `plans/follow-ups.md` (25 entries, all logged during [`follow-ups-2026-11-07-plan.md`](../v1.9.0/follow-ups-2026-11-07-plan.md) Phases 1–9) for a v1.9.1 patch release. Entries are numbered `G01`–`G25` in ledger order. Re-probed on `main` @ `56f8be6` (code-identical to `87136d5`: the release commit changes only docs, `plans/`, and `package*.json`) with `.probes/reprobe.mjs` (`compileFiles` with `forceTarget` `js`, `both`, `wasm`, plus `assertValidWasm`) and `compileHybridProject` for the multi-package `G04`.
- **24 entries reproduce** and are scheduled in Phases 1–6. The re-probe widened several of them: `G05` also covers literal `[-1]int`; `G08` and `G09` also fail on WASM; `G13` also gives the wrong WASM message; `G21`–`G24` emit invalid WASM; `G23` also covers `int(x)`; `G25` adds `%T` printing empty on every target.
- **1 entry is deferred** (`G20`, untyped JS-interop values): see `Excluded: deferred`.
- **0 entries no longer reproduce.** No entry is scheduled in another open plan, because no other plan is open.

Grouped by subsystem:
1. Typechecker checks (Phase 1).
2. Typechecker `any` → concrete (Phase 2).
3. Parser and JS statements (Phase 3).
4. WASM codegen (Phase 4).
5. JS nil receivers and map keys (Phase 5).
6. Dynamic types, `fmt` `%T` and `encoding/json` (Phase 6).

Re-probe each phase's repros on its base commit before starting the phase, and drop any sub-repro that no longer reproduces.

Go is not installed in the probe environment, so the expected outputs below come from the ledger entries, which reviewers checked against go1.26. Diagnostics are asserted by a stable substring (`need type assertion`, `invalid array length`, `for cap`, `cannot convert`) rather than full Go text.

**Done means:**
- Every repro scheduled in Phases 1–6 is a passing test in its task's `Test:` file:
  - programs: `assertProgramOutput` (`both` + `wasm`), or `assertAllTargetsOutput` where plain `js` packages must also match; `compileHybridProject` for `G04`;
  - invalid programs: `assertErrorContains` on every target.
- No scheduled repro emits invalid WASM (`assertValidWasm`) or a JS `SyntaxError`, `ReferenceError` or `TypeError`.
- `npm test`, `npm run check` (including the example type-checks) and `npm run test:e2e` pass with zero regressions.
- `npm run bench` (raycast, json, fmt, particle) stays within 3% of its result on `87136d5` after Phase 5, which changes how JS calls pointer-receiver methods.
- `docs/go-compatibility.md` describes nil-receiver method calls and `%T` of generic map instantiations as matching Go (Task 6.4), and nothing in it contradicts the new behaviour.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Every reproducing ledger defect across the parser, typechecker, JS and WASM backends, `stdlib/internal/jsonrt` and the `fmt` formatters | `G01`–`G19`, `G21`–`G25` (24 entries, Phases 1–6) | |
| **In scope: target-specific** | Fix the failing target(s) and pin the working target(s) in the same test | JS-only: `G06`, `G07`, `G11`, `G12`, `G16`, `G18`, `G25` type switch. WASM-only: `G10`, `G14`, `G15`. Both backends: `G08`, `G09`, `G13`, `G19`, `G25b` | |
| **Excluded: runtime / platform** | Documented JS numeric and `any` semantics stay as documented in `docs/go-compatibility.md` | Sized numbers in an `any` (row "Sized numbers in an `any`"); `any(3) == any(3.0)` in `js` packages; types another package returns through `any` print as `<nil>` (row "`fmt` of a value in an `any`") | GoFront has no runtime type descriptors (roadmap guiding principle). `G25b` is in scope only because the map type is instantiated inside the calling package's own generic code, which that docs row already promises to describe. |
| **Excluded: deferred** | Untyped JS-interop values assigned to concrete types | `G20` `raw := localStorage.getItem("k"); var s string = raw` → compiles; want `need type assertion` only once bindings are typed | `_checkIfaceToConcrete` (`src/typechecker/assignability.js:446`) fires only for `source._declared` (an `any` written in source). DOM globals (`src/typechecker/types.js:81`) and `.d.ts` values without types are deliberately unchecked, and flagging them would break every DOM-using example (`example/preact`, `example/gom`, `example/templ`). Needs typed DOM / `.d.ts` bindings, which is a feature and not a patch fix. |

---

## Verified Gaps & Baseline Audit

### Review follow-ups (2026-11-09)

All 25 ledger entries were re-probed on `main` @ `56f8be6`. Columns: js / both / wasm, as observed → wanted. "OK" means the program runs and prints what Go prints.

| Area | Finding | Evidence & probe |
|---|---|---|
| Typechecker `switch` | Untyped bool constant tag skips case checks; tagless `switch` accepts `case nil` | `G01` `switch true { case 5: }` → all compile, want `cannot convert 5 (untyped int constant) to type bool`. Cause: `src/typechecker/statements.js:405` keeps an untyped-bool tag untyped, so `_caseValueUnchecked` skips it. `G02` `switch { case nil: }` → js/both compile, wasm invalid `if[0] expected type i32, found ref.null`, want `cannot convert nil to type bool`. Cause: `_checkTaglessCase` (`statements.js:428`) returns early on `isNil`. (PR #154) |
| Typechecker builtins | `cap` accepts int, bool and int variables | `G03` `_ = cap(1)`, `cap(true)`, `n := 3; cap(n)` → js/both compile, wasm invalid `not enough arguments on the stack for i64.extend_i32_u`, want `invalid argument: 1 (untyped int constant) for cap`. Cause: `src/typechecker/expressions.js:1893` rejects only map and string. (PR #154) |
| Typechecker array lengths | Negative constant lengths are not rejected; JS then emits the AST node | `G05` `var a [math.MinInt8]int`, `const n = -1; var a [n]int`, and literal `var a [-1]int` → js/both `SyntaxError: Unexpected identifier 'Object'`, wasm prints `0`, want `invalid array length`. Cause: `_foldArrayLen` (`src/typechecker/resolve.js:340`) returns the raw `size` node when `n < 0`, and `_resolveArrayTypeNode` keeps it. The positive `[math.MaxInt8]int` → `127` everywhere (no regression). (PR #155) |
| Typechecker package types | A function-local type with the same name as an imported package's type rewrites the imported type | `G04`: `a/a.go` `type Pt struct{ X int }`; `lib/lib.go` `func Run() string { type Pt struct{ Z bool }; _ = Pt{true}; return fmt.Sprint(a.Pt{1}) }` (`compileHybridProject`) → all targets `Type error … Cannot assign untyped int to bool`, want `{1}`. Local `TypeDecl` dispatch: `statements.js:7` `collectType` → `src/typechecker/index.js:839`. (PR #155) |
| Typechecker `any` → concrete | Assignments, comma-ok, tuple, conversion and type-switch `default` from `any` skip the type-assertion check | `G21` `var a A; var b any = A{1}; a = b` → js/both `{1}`, wasm invalid `local.tee[0] expected type (ref null 16)`. Cause: `_checkAssignTypes` (`statements.js:198`) guards `!isAny(r)` before `assertAssignable`. `G22` `a, ok = m["k"]` (`map[string]any`) → js/both `{1} true`, wasm invalid. `n, err = getPair()` (`(any, error)`) → js/both `1 <nil>`, wasm invalid `expected type i64, found call of type anyref`. Extra: `var n int; n, err := getPair()` → same. `G23` `(*int)(x)` and extra `int(x)` with `x any` → all compile. Cause: `_checkConversionValidity` (`expressions.js:1141`) returns on `isAny(srcType)`. `G24` `switch v := x.(type) { default: var a A = v }` → js/both `{3}`, wasm invalid. Cause: `_checkTypeSwitchStmt` (`statements.js:516`) binds the bare `ANY` (not `_declared`) instead of `stmt.expr._type`. Want `need type assertion` for all. (PR #161) |
| Parser constraints | A type-set element next to methods in an interface fails to parse | `G17` `type Incer[T any] interface{ *T; Inc() }` (one-line and multi-line) → all `Parse error … expected 'IDENT' (got * "*")`. Full repro `func bump[T any, P Incer[T]]() T { var v T; P(&v).Inc(); P(&v).Inc(); return v }`, with `C` having `func (c *C) Inc()`: `bump[C]().n` → want `2`. Cause: `parseInterfaceType` (`src/parser/types.js:319`). (feat/follow-ups-2026-11-07-phase-5) |
| JS function-local types | A local variable with the same name as a local type in the same function hits the TDZ | `G06` `func a() { type Dup struct{ X int }; Dup := 1; fmt.Println(Dup) }` → js/both `ReferenceError: Cannot access 'Dup' before initialization`, wasm `1`. The emitted `Dup = Dup.__ph ? class Dup {…} : Dup` inside `a()` is shadowed by `let Dup = 1` (`src/backend/js/index.js:1027`, `:1035`). When the type is used before the variable (`_ = Dup{}`), all targets print `1`. (PR #155) |
| JS 64-bit constants | Untyped package constant operand of a 64-bit compound assignment is emitted as a Number | `G07` `const half = 1 << 51; var b uint64 = 1; b += half` → js/both `TypeError: Cannot mix BigInt and other types` (emits `BigInt.asUintN(64, (b) + (half))` with `const half = 2251799813685248`), wasm `2251799813685249`. Extra: `int64 -=` → same. (feat/follow-ups-2026-11-07-phase-3) |
| Labeled range-over-func | `break` / `continue` to the label of a range-over-func loop is broken on both backends | `G08` `outer: for x := range seq { fmt.Println(x); break outer }` → js/both `SyntaxError: Illegal continue statement: 'outer' does not denote an iteration statement`; wasm prints `0` then panics `range function continued iteration after function for loop body returned false`; want `0\ndone`. `continue outer` (seq `yield(0) && yield(1)`) → js/both SyntaxError, wasm `0\ndone`, want `0\n1\ndone`. Nested `for` with `continue outer` → wasm `0 0\ndone`, want `0 0\n1 0\ndone`. JS cause: `_emitIterTargetDispatch` (`src/backend/js/statements.js:1778`) emits `break/continue <lbl>` for every function label, including the iterator's own label, which is attached to a `{` block (`statements.js:416`). WASM: `_unwindIteratorTargets` (`src/backend/wasm/emit-stmts.js:3623`). (PR #156) |
| Map range into address-taken var | `for _, v = range m` with `&v` taken | `G09` `m := map[string]int{"a": 1}; var v int; p := &v; for _, v = range m {}; fmt.Println(*p)` → js/both `0`, wasm invalid `local.set[0] expected type (ref null 301), found struct.get`, want `1`. JS: `_rangeVarTarget` / `_emitRangeVar` (`statements.js:1439`, `:1450`) on the map path. (PR #156) |
| WASM unhashable keys | Panic message for a func, or a struct with a slice, omits or misnames the type | `G10` func in `any` key → wasm `runtime error: hash of unhashable type` (js/both correct, `… func()`). `G13` `type S struct{ s []int }` key → wasm without type name, want `… main.S`. `type L []int` key → wasm `… []int`, want `… main.L`. Cause: `src/backend/wasm/emit-builtins.js:1789`–`1797` (falls back when `goType` is unknown, and names the underlying type). (feat/follow-ups-2026-11-07-phase-4, PR #157) |
| JS unhashable keys | Struct containing a slice, or a defined slice, in an `any` map key does not panic | `G13` → js/both print `no panic`, want `runtime error: hash of unhashable type main.S` / `main.L`. `__ik` (`src/backend/js/runtime.js:740`) checks only `k.__t` slice/map/func tags. (PR #157) |
| JS nil pointer receivers | Pointer-receiver call, method expression, and promoted call through a nil embedded pointer throw | `G11` `var s *S; s.Ping()` → js/both `TypeError: Cannot read properties of null (reading 'Ping')`, wasm `ok` (emits `s.Ping()`). `G12` `g := (*MyInt).Ping; g(p)` with nil `p` → js/both TypeError, wasm `1` (the direct call `p.Ping()` already works). `G18` `type P struct{ *Base }; P{}.Ptr()` → js/both TypeError, wasm `1`. (PR #157, feat/follow-ups-2026-11-07-phase-6) |
| WASM interface assertions from `any` | Promoted methods through an embedded pointer, and Go-source stdlib named slices, are missed | `G14` `type PO struct{ *Inner }; var v any = PO{}; _, ok := v.(Mer)` → wasm `false`, js/both `true`. `G15` `var v any = sort.IntSlice{1}; _, ok := v.(sort.Interface)` → wasm `false`, js/both `true`. Dynamic assertion: `_emitCommaOkTypeAssert` (`src/backend/wasm/emit-stmts.js:1144`). (feat/follow-ups-2026-11-07-phase-5) |
| JS dynamic func/slice types | A defined func type is not told apart from its unnamed form; a nil defined slice loses its type; tagging mutates the shared func | `G16` `_, ok := any(func(s string) string{…}).(G); _, ok2 := any(S(nil)).(S)` → js/both `true false`, wasm `false true`. Extra: `var a any = G(id); var b any = id; a.(G), b.(G)` → js/both `true true`, wasm `true false` (shared func object tagged in place). (feat/follow-ups-2026-11-07-phase-5) |
| Generic map dynamic type | Maps built in a generic function and boxed into `any` have no type tag | `G25` `pair[K,V](k, v) any { return map[K]V{k: v} }`; type switch over `map[int]int` / `map[int][]int` / `map[string]int` → js/both `ii ii`, wasm `is si` (correct). Emits `__ifm({ [__ikt($z_K, k)]: … })` with no type. Extra `G25b`: `fmt.Printf("%T %T\n", pair(1, []int{2}), pair("s", 5))` → **all targets** print `" "`, want `map[int][]int map[string]int`. Non-generic `%T` of `map[int]int` is correct on all targets. (feat/follow-ups-2026-11-07-phase-9) |
| `encoding/json` | Nil slice of an unsupported element type in `any` | `G19` `var s []func(); var v any = s; json.Marshal(v)` → js/both `<nil>`, wasm `json: unsupported type: unsupported dynamic type` (from `EncodeDynamic`, `stdlib/internal/jsonrt/enc.go:226`), want `json: unsupported type: []func()`. The non-nil `[]func(){nil}` → `json: unsupported type: func()` on all targets (matches Go). (feat/follow-ups-2026-11-07-phase-7) |
| Typechecker interop `any` | Deferred | `G20`: see `Excluded: deferred`. Confirmed by the `source?._declared` guard at `assignability.js:447`. |

---

## Approach

### 1. Architecture & Design Decisions
- **Typechecker first (Phases 1–2).** Several invalid-WASM symptoms (`G02`, `G03`, `G21`–`G24`) are invalid programs. Once they are rejected, the WASM backend never sees them, so no WASM fix is planned for those entries.
- **`any` → concrete (Phase 2):** route every assignment-like flow (plain `=`, comma-ok map, tuple `=`, mixed `:=` redeclaration) through `assertAssignable` with the operand, so `_checkIfaceToConcrete` decides. The `_declared` flag stays the single switch that separates source-written `any` from interop values (`G20` stays excluded). A map value type or result type written as `any` must carry `_declared`. Verify this in Task 2.2 and set it in `resolveTypeNode` if it is missing. The type-switch `default` and multi-type captures bind `stmt.expr._type`, as Go does.
- **Negative array lengths (Task 1.3):** `_foldArrayLen` reports `invalid array length <expr> (untyped int constant <n>)` when it folds to a negative integer, and returns `0` so backends never see an AST node as a length.
- **Local vs imported types (Task 1.4):** `collectType` for a function-local `TypeDecl` must define into the function scope and never mutate a type object reached through a qualified import (`a.Pt`). The fix is in lookup and definition, not by renaming.
- **JS TDZ (Task 3.2):** hoisted function-local type placeholders (`var Dup = class { static __ph … }`, `src/backend/js/index.js:1035`) get a mangled JS name (for example `Dup$L1`) whenever the function also declares a value with the type's name. `fmt` and `%T` keep using the Go name from type info.
- **Labeled range-over-func (Tasks 3.4, 4.1):** the iterator's own label resolves through `_currentIterLoopLabel`, which already exists, as the `break` / `continue` target flag. `_emitIterTargetDispatch` skips labels that do not denote an enclosing JS iteration statement. WASM `_unwindIteratorTargets` must distinguish `continue L`, which resumes the yield (yield returns `true`), from `break L`, which makes yield return `false` and does not re-enter.
- **JS nil receivers (Phase 5):** a call through a static `*T` whose method has a pointer receiver emits static dispatch, `T.prototype.M.call(x, …args)`. ESM is strict, so `this` is `null` inside the method and Go nil-receiver semantics hold. Method expressions `(*T).M` lower to `(r, …a) => T.prototype.M.call(r, …a)`. Promoted calls through an embedded pointer use the embedded type's prototype. Calls through interfaces and value receivers stay unchanged. The perf gate is `npm run bench` (Done means).
  - Rejected: guarding every call with `x == null ? …` (adds branches on hot paths), and a nil sentinel object per type (breaks `== nil`).
- **JS unhashable keys (Task 5.4):** struct classes whose fields (transitively, through arrays) contain a slice, map or func get a static `__uh = "main.S"` set at class emission, and defined slice / map / func types tag with their defined name. `__ik` throws `hash of unhashable type <name>` when it sees `k.constructor.__uh`. This is a check once per insert, with no per-field walk.
- **JS dynamic func types (Task 6.1):** converting a func to a defined func type wraps the value in a fresh tagged function (`__tfn(f, "main.G")`) instead of tagging `f` in place. An unnamed func boxed into `any` is untagged, or tagged with its literal type, so `.(G)` fails. A nil defined slice boxed into `any` becomes a tagged nil-slice sentinel, using whatever representation `__isty` already accepts for tagged slices.
- **Generic map tags (Tasks 6.2–6.3):** map literals and `make` inside generic functions tag the map with the instantiated type string built at run time from the `__ti` type-info arguments (`$z_K`, `$z_V` already carry names). `%T` reads the same tag on JS. On WASM, the `fmt` type-name table (`src/lower/fmt-formatters.js`) must include monomorphised map instantiations.
- **JSON (Task 6.4):** the `encoding/json` dynamic encoder emits `FailType("[]func()")`-style messages from the static element type when a typed nil slice of an unsupported element reaches `EncodeDynamic`. On JS, the nil slice in `any` must keep its type (this shares the sentinel with Task 6.1, which lands first).

### 2. Invariants & Safety Bounds
- No new runtime type descriptors: every new tag is a compile-time string attached only where Go code boxes the value into `any` or declares a defined type (roadmap principle).
- `js` package semantics documented in `docs/go-compatibility.md` stay as written. Phase 5 adds behaviour (valid nil-receiver calls) and removes no documented difference.
- Zero-allocation hot paths (`test/perf/zero-alloc.js`) stay allocation-free. Static dispatch does not allocate, and wrapper funcs (Task 6.1) are created only at conversion sites.
- Examples keep type-checking (`npm run check`). If Phase 2 flags example code that relies on the `any` loophole, fix the example with an explicit assertion in the same task, and list it in the task's commit body.

### 3. Edge Cases & Error Handling
- `switch true { case x > 0: }` and `switch false {…}` must stay valid (Task 1.1 negative-and-positive pair).
- `cap` of a pointer to an array (`cap(&arr)`), a type parameter with a slice / array / chan core type, and a `chan` stay valid (Task 1.2).
- Array length `0` and the folded `[math.MaxInt8]int` stay valid. An overflowing length is out of scope.
- Phase 2: `var e error = b` with `b any` → still `need type assertion` (interface target with methods). `var c any = b` stays valid. `x, ok := m["k"]` with a fresh `x` stays valid (it takes type `any`).
- Phase 5: `x.M()` where `x` is a `*T` returned from a call (`newT().M()`) must evaluate `newT()` once. Use a temp or `.call` on the evaluated expression.
- Task 4.1: `return` from inside a labeled range-over-func body nested two iterators deep keeps working (existing tests in `test/unit/language/`).

---

## Implementation Tasks

Scheduled from review follow-ups (`plans/follow-ups.md` sweep 2026-11-09). Each task's `Test:` asserts the repro from `Verified Gaps`.

### Phase 1: Typechecker Checks
- [ ] Task 1.1: Check `switch` cases for untyped-bool tags and reject `case nil` in tagless switches (`G01`, `G02`)
  - Files: `src/typechecker/statements.js`
  - Test: `test/unit/types/switch-cases.test.js`. `switch true { case 5: }` → `assertErrorContains(…, "cannot convert 5 (untyped int constant) to type bool")`; `switch { case nil: }` → `"cannot convert nil to type bool"`; `switch true { case 1 > 0: }` and `switch { case x > 0: }` compile.
  - Done when: both negative cases error on `js`, `both`, `wasm`, and the positive cases run on all targets.
- [ ] Task 1.2: Reject `cap` of non-slice / array / chan operands (`G03`)
  - Files: `src/typechecker/expressions.js`
  - Test: `test/unit/builtins/cap.test.js`. `cap(1)` → `"invalid argument: 1 (untyped int constant) for cap"`; `cap(true)` and `n := 3; cap(n)` → `"for cap"`; `cap(s)` (slice), `cap(arr)`, `cap(&arr)` and a generic `[S ~[]E]` `cap(s)` stay valid.
  - Done when: no target produces invalid WASM for the three negative repros.
- [ ] Task 1.3: Reject negative constant array lengths (`G05`)
  - Files: `src/typechecker/resolve.js`
  - Test: `test/unit/types/array-length.test.js`. `var a [-1]int`, `const n = -1; var a [n]int` and `var a [math.MinInt8]int` → `assertErrorContains(…, "invalid array length")`; `[math.MaxInt8]int` → `127` (`assertAllTargetsOutput`); `[0]int` → `0`.
  - Done when: no negative-length program reaches a backend, and the JS output never contains `[object Object]`.
- [ ] Task 1.4: Keep function-local types from rewriting imported package types (`G04`)
  - Files: `src/typechecker/index.js`, `src/typechecker/statements.js`
  - Test: `test/unit/compiler/local-type-shadow.test.js` (`compileHybridProject`, for `js`, `both`, `wasm` targets of `lib`). The `G04` repro prints `{1}`; also `fmt.Sprint(Pt{true}, a.Pt{1})` → `{true} {1}`.
  - Done when: every target prints the Go output, and the existing function-local type tests (`test/unit/types/shadowing.test.js`, and the `F72` JSON case in `test/unit/builtins/json.test.js`) still pass.

### Phase 2: Typechecker `any` → Concrete Assignments
- [ ] Task 2.1: Check plain assignment statements from `any` (`G21`)
  - Files: `src/typechecker/statements.js`, `src/typechecker/assignability.js`
  - Test: `test/unit/types/any-assertion.test.js`. `var a A; var b any = A{1}; a = b` → `assertErrorContains(…, "need type assertion")`; `var c any; c = b` and `var e error; var x any; _ = x; e = nil` compile.
  - Done when: the error is reported on all targets and `npm run check` (example type-checks) passes.
- [ ] Task 2.2: Check comma-ok map, tuple `=` and mixed `:=` from `any` (`G22`)
  - Files: `src/typechecker/statements.js`, `src/typechecker/resolve.js`
  - Test: `test/unit/types/any-assertion.test.js`. `a, ok = m["k"]` (`map[string]any`), `n, err = getPair()` and `var n int; n, err := getPair()` (`(any, error)`) → `"need type assertion"`; `x, ok := m["k"]` with a fresh `x` compiles.
  - Done when: all three are rejected on every target and the positive case runs.
- [ ] Task 2.3: Reject conversions from `any` to concrete types (`G23`)
  - Files: `src/typechecker/expressions.js`
  - Test: `test/unit/types/any-assertion.test.js`. `(*int)(x)` and `int(x)` with `x any` → `"need type assertion"`; `any(x)`, `error(nil)` and `interface{ M() }(v)` where `v` implements it compile.
  - Done when: both negative repros error on all targets.
- [ ] Task 2.4: Bind the type-switch `default` and multi-type captures to the switch operand's type (`G24`)
  - Files: `src/typechecker/statements.js`
  - Test: `test/unit/types/any-assertion.test.js`. `switch v := x.(type) { default: var a A = v }` → `"need type assertion"`; `case A, B: var y any = v` compiles; `default: fmt.Println(v)` prints the value on all targets.
  - Done when: the negative case errors, no target emits invalid WASM, and the existing type-switch tests pass.

### Phase 3: Parser and JS Statement Codegen
- [ ] Task 3.1: Parse type-set elements next to methods in interfaces (`G17`)
  - Files: `src/parser/types.js`, `src/typechecker/resolve.js`
  - Test: `test/unit/parser/constraint-elements.test.js`. `type Incer[T any] interface{ *T; Inc() }` (one-line and multi-line) parses; the full `bump[C]().n` repro → `2` (`assertProgramOutput`); `Incer` used as an ordinary variable type → existing `cannot use type … outside a type constraint` style error (substring `constraint`).
  - Done when: the repro prints `2` on `both` and `wasm`.
- [ ] Task 3.2: Mangle hoisted local types that share a name with a local value (`G06`)
  - Files: `src/backend/js/index.js`
  - Test: `test/unit/language/local-types.test.js`. `func a() { type Dup struct{ X int }; Dup := 1; fmt.Println(Dup) }` → `1` (`assertAllTargetsOutput`); a variant that also prints `fmt.Sprintf("%T", struct-value)` keeps `main.Dup`.
  - Done when: no `ReferenceError` on `js` or `both`, and `%T` is unchanged.
- [ ] Task 3.3: Emit untyped constant operands of 64-bit compound assignments as BigInt (`G07`)
  - Files: `src/backend/js/statements.js`, `src/backend/js/expressions.js`
  - Test: `test/unit/language/int64.test.js`. `const half = 1 << 51; var b uint64 = 1; b += half` → `2251799813685249`; `int64 -= half` → `-2251799813685247`; `b |= half`, `b *= 3` → Go values (`assertProgramOutput`).
  - Done when: both the JS and WASM sides print the Go values.
- [ ] Task 3.4: Fix labeled `break` / `continue` on range-over-func loops in JS (`G08`, JS)
  - Files: `src/backend/js/statements.js`
  - Test: `test/unit/language/range-func.test.js`. The three `G08` repros (`break outer` → `0\ndone`; `continue outer` → `0\n1\ndone`; nested `for` with `continue outer` → `0 0\n1 0\ndone`) via `assertJsTargetsOutput`.
  - Done when: no `SyntaxError` and the output matches on `js` and `both`. The WASM side is fixed in Task 4.1, so this test pins JS only.
- [ ] Task 3.5: Assign ranged map values into address-taken variables through the box in JS (`G09`, JS)
  - Files: `src/backend/js/statements.js`
  - Test: `test/unit/language/range-assign.test.js`. The `G09` repro → `1`; the key form `for k = range m` with `&k` taken → the key (`assertJsTargetsOutput`).
  - Done when: `js` and `both` print `1`. WASM validity is covered in Task 4.2.

### Phase 4: WASM Codegen
- [ ] Task 4.1: Fix labeled `break` / `continue` unwinding through range-over-func in WASM (`G08`, WASM)
  - Files: `src/backend/wasm/emit-stmts.js`, `src/backend/wasm/emit.js`
  - Test: `test/unit/language/range-func.test.js`. Upgrade the Task 3.4 cases to `assertProgramOutput`.
  - Done when: all three repros match Go on `both` and `wasm`, with no panic for `break outer`.
- [ ] Task 4.2: Emit valid WASM for map range assignment into a boxed variable (`G09`, WASM)
  - Files: `src/backend/wasm/emit-stmts.js`
  - Test: `test/unit/language/range-assign.test.js`. Upgrade the Task 3.5 cases to `assertProgramOutput`.
  - Done when: `assertValidWasm` passes and `wasm` prints `1`.
- [ ] Task 4.3: Name the dynamic type in WASM unhashable-key panics (`G10`, `G13` WASM)
  - Files: `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/emit-maps.js`
  - Test: `test/unit/wasm/map-keys.test.js`. The func key → `runtime error: hash of unhashable type func()`; the struct `S` with a slice → `… main.S`; `type L []int` → `… main.L` (wasm side; the JS side follows in Task 5.4).
  - Done when: the three messages match Go exactly on `wasm`.
- [ ] Task 4.4: Include methods promoted through embedded pointers in WASM dynamic interface checks (`G14`)
  - Files: `src/backend/wasm/emit-stmts.js`, `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/prescan.js`
  - Test: `test/unit/wasm/iface-assert.test.js`. The `G14` repro → `true` (`assertProgramOutput`); a value-embedded `Inner` with a pointer-receiver `M` held as a `PO` value in `any` → `false` (Go method-set rule).
  - Done when: both match Go on `both` and `wasm`.
- [ ] Task 4.5: Match Go-source stdlib named slices against interfaces from `any` in WASM (`G15`)
  - Files: `src/backend/wasm/prescan.js`, `src/backend/wasm/emit-stmts.js`
  - Test: `test/unit/wasm/iface-assert.test.js`. `var v any = sort.IntSlice{1}; _, ok := v.(sort.Interface)` → `true`; the same for `sort.StringSlice` → `true`.
  - Done when: `wasm` prints `true` for both.

### Phase 5: JS Nil Receivers and Map Keys
- [ ] Task 5.1: Statically dispatch pointer-receiver calls through `*T` so nil receivers work (`G11`)
  - Files: `src/backend/js/expressions.js`
  - Test: `test/unit/language/nil-receiver.test.js`. `var s *S; s.Ping(); fmt.Println("ok")` → `ok` (`assertAllTargetsOutput`); a method that checks `if s == nil { return "nil" }` → `nil`; `newT().M()` evaluates `newT` once (count side effects).
  - Done when: all targets match Go and `npm run bench` is within 3% of the `87136d5` baseline.
- [ ] Task 5.2: Lower method expressions `(*T).M` to static dispatch (`G12`)
  - Files: `src/backend/js/expressions.js`
  - Test: `test/unit/language/nil-receiver.test.js`. `type MyInt int; g := (*MyInt).Ping; g(nil-ptr)` → `1`; a struct `(*S).M` with nil → Go output.
  - Done when: no `TypeError` on `js` or `both`.
- [ ] Task 5.3: Dispatch promoted pointer-receiver methods through nil embedded pointers (`G18`)
  - Files: `src/backend/js/expressions.js`, `src/lower/embedding.js`
  - Test: `test/unit/language/nil-receiver.test.js`. `type P struct{ *Base }; P{}.Ptr()` → `1`; two levels of embedding → `1`.
  - Done when: all targets print `1`.
- [ ] Task 5.4: Panic on unhashable struct and defined slice keys in `any` maps on JS (`G13` JS)
  - Files: `src/backend/js/runtime.js`, `src/backend/js/index.js`
  - Test: `test/unit/wasm/map-keys.test.js`. Upgrade the Task 4.3 struct and `L` cases to `assertAllTargetsOutput`; a hashable struct key `struct{ a int }` still works.
  - Done when: every target prints Go's message, and the hashable-key case is unchanged.

### Phase 6: Dynamic Types, `%T` and `encoding/json`
- [ ] Task 6.1: Tag defined func conversions with fresh wrappers and keep the type of nil defined slices in `any` on JS (`G16`)
  - Files: `src/backend/js/expressions.js`, `src/backend/js/runtime.js`
  - Test: `test/unit/types/dynamic-types.test.js`. The `G16` repro → `false true`; the shared-func repro → `true false` (`assertAllTargetsOutput`).
  - Done when: JS matches WASM and Go for both repros.
- [ ] Task 6.2: Tag maps built in generic functions with their instantiated type on JS (`G25`)
  - Files: `src/backend/js/expressions.js`, `src/backend/js/type-info.js`
  - Test: `test/unit/types/dynamic-types.test.js`. The `G25` type-switch repro → `is si` (`assertProgramOutput`); `make(map[K]V)` inside a generic function → the same.
  - Done when: JS prints `is si`.
- [ ] Task 6.3: Print `%T` of maps instantiated in generic code (`G25b`)
  - Files: `src/lower/fmt-formatters.js`, `src/backend/wasm/monomorph.js`
  - Test: `test/unit/stdlib/fmt-types.test.js`. `fmt.Printf("%T %T\n", pair(1, []int{2}), pair("s", 5))` → `map[int][]int map[string]int` (`assertProgramOutput`).
  - Done when: both the JS and WASM sides print the Go text.
- [ ] Task 6.4: Report nil unsupported slices in `any` from `json.Marshal`, and update the docs (`G19`)
  - Files: `stdlib/internal/jsonrt/enc.go`, `src/lower/json-codecs.js`, `docs/go-compatibility.md`
  - Test: `test/unit/wasm/json.test.js`. `var s []func(); var v any = s; _, err := json.Marshal(v)` → `json: unsupported type: []func()` on `both` and `wasm`; the non-nil `[]func(){nil}` keeps `json: unsupported type: func()`.
  - Done when: both targets print Go's error, and `docs/go-compatibility.md` states that nil-pointer method calls and `%T` of generic map instantiations behave as in Go (with no other compatibility row contradicted).
