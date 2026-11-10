# v1.9.1 Review Follow-ups (2026-11-10) — Design Plan

**Version:** v1.9.1  
**Status:** In Progress  
**Base branch:** main  
**Related:** [`follow-ups-2026-11-09-plan.md`](follow-ups-2026-11-09-plan.md) (origin of every ledger entry; its Phases 7–8 are independent of this plan; execute after `follow-ups-2026-11-09-plan.md` is merged into main)  
**Release note:** More invalid Go is now rejected with Go's error instead of building broken WebAssembly (`case nil` in `switch true`, `cap` of a struct or func, assigning an `any` to `error` without a type assertion, constraint interfaces used as ordinary types), while valid code that failed to compile now works: conversions to interface types such as `I(v)` and `interface{ M() }(v)`, and slices of funcs written directly as call arguments. Nil-pointer method calls, labeled `continue` across nested range-over-func loops, 64-bit `for` loop updates, range assignments into address-taken variables, unhashable map keys and `json.Marshal` of func arrays now behave as in Go on both JavaScript and WebAssembly, and returning or passing a multi-value call such as `return f()` into `any` results or parameters keeps the right values and types. On JavaScript, `complex64` values built from constants now hold `float32` precision, and `fmt` calls in any value of a templ `case a, b:` render correctly.

---

## Goal

Schedule and fix every reproducing entry of `plans/follow-ups.md` (18 entries, all logged during [`follow-ups-2026-11-09-plan.md`](follow-ups-2026-11-09-plan.md) Phases 1–6 reviews, PRs #164–#169) for the v1.9.1 patch release. Entries are numbered `H01`–`H18` in ledger order. Re-probed on `feat/follow-ups-2026-11-09` @ `f966c765` (Phase 6 merged; `main` @ `301ea104` does not yet contain the Phase 1–6 fixes these entries were found next to) with `.probes/reprobe.mjs` (`compileFiles` with `forceTarget` `js`, `both`, `wasm`, `WebAssembly.validate`, then run).

- **18 entries reproduce** and are scheduled in Phases 1–4. The re-probe widened several: `H01` reproduces only when the same file is compiled a second time in one process (parse cache), on any target; `H02`/`H03` also cover `cap(func)`; `H05` also covers `var e fmt.Stringer = b`; `H08` `break outer` fails on JS too; `H09` also covers ranging a string; `H15` also covers a defined map literal; `H17` covers any `[]func…{…}` call argument.
- **0 entries deferred, 0 no longer reproduce.** None is scheduled in another open plan (the only open plan, `follow-ups-2026-11-09`, has Phases 7–8 left: JSON interop codecs, `float32` constants, templ `fmt`, SIMD globals — no overlap).

Second sweep (2026-11-10, after 11-09 Phase 7 / PR #170): 1 new ledger entry, `H19`, re-probed on `feat/follow-ups-2026-11-09` @ `cbbc0020` with `.probes/h19.mjs` (same harness, `evictParseCache` per target). **It reproduces and is much wider than logged:** not a JSON bug but a general defect in forwarding a multi-value call (`return f()`, `g(f())`) into `any` results or parameters, on both backends. Scheduled in Phase 5; none deferred.

Third sweep (2026-11-10, after 11-09 Phase 8 / PR #171): 2 new ledger entries, `H20`–`H21`, re-probed on `feat/follow-ups-2026-11-09` @ `49a6d842`. **Both reproduce**; `H20` is wider than logged (every `complex64` built from an untyped constant on JS, not only `complex(float32, const)`). Scheduled in Phase 6; none deferred.

Grouped by subsystem:

1. Typechecker checks (Phase 1).
2. Parser, interface conversions and JS statements (Phase 2).
3. WASM codegen (Phase 3).
4. JS nil receivers, method expressions, map keys and `encoding/json` (Phase 4).
5. Multi-value call forwarding into interfaces (Phase 5).
6. `complex64` constants on JS and templ `case` formatters (Phase 6).

Re-probe each phase's repros on its base commit before starting the phase, and drop any sub-repro that no longer reproduces. Go is not installed in the probe environment, so expected outputs come from the ledger entries (checked against go1.26 by reviewers). Diagnostics are asserted by a stable substring.

**Done means:**

- Every repro in Phases 1–6 is a passing test in its task's `Test:` file: programs via `assertProgramOutput` (`both` + `wasm`), or `assertAllTargetsOutput` where plain `js` packages must also match; invalid programs via `assertErrorContains` on every target.
- No scheduled repro emits invalid WASM (`assertValidWasm`) or throws a JS `SyntaxError`/`TypeError`.
- Compiling the `H01` program twice in one process (`js` then `wasm`) succeeds both times (`test/unit/types/array-length.test.js`).
- `npm test`, `npm run check` (including example type-checks) and `npm run test:e2e` pass with zero regressions; `npm run bench` stays within 3% of its result on the plan's base commit after Phase 4 (it widens static dispatch for pointer-receiver calls).
- `docs/go-compatibility.md` `encoding/json` row states that a func array in an `any` fails with `json: unsupported type: func()` on every target (Task 4.5), and nothing in the doc contradicts the new behaviour.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Every reproducing ledger defect across the parser, typechecker, JS and WASM backends and the JSON codec generator | `H01`–`H18` (Phases 1–4); `H19` (Phase 5); `H20`–`H21` (Phase 6) | |
| **In scope: target-specific** | Fix the failing target(s) and pin the working target(s) in the same test | JS-only: `H07`, `H08` (JS side), `H11`–`H15`, `H18`, `H20`, `H21` (templ is JS-only). WASM-only: `H02`/`H03` invalid modules (fixed by rejecting in the typechecker), `H08` (WASM `continue`), `H09`, `H10`, `H16`. All targets: `H01`, `H04`, `H05`, `H06`, `H17`, `H19` returns. WASM-only: `H19` call arguments | |
| **Excluded: runtime / platform** | Documented JS `any` semantics stay as documented in `docs/go-compatibility.md` | Sized numbers in an `any`; `any(3) == any(3.0)` in `js` packages | No runtime type descriptors (roadmap guiding principle); no ledger entry touches them. |
| **Excluded: runtime / platform** | Interface-to-interface assignment beyond the empty-interface source | `var r io.Reader; var rw io.ReadWriter = r` (already rejected by method-set check) | `H05` is only the `_declared` `any` → non-empty interface hole; the general method-set check already exists and is not changed. |
| **Excluded: deferred** | Full flow-sensitive nil analysis of pointer receivers | A receiver read guarded by a non-nil condition on another variable (`if ok { return s.x }`) | Task 4.1 only makes `derefsReceiver` scope-aware and treats reads outside the unconditional body prefix as possibly skipped, which covers `H11`/`H12`. A real dataflow analysis is a feature, not a patch fix. |

---

## Verified Gaps & Baseline Audit

### Review follow-ups (2026-11-10)

All 18 ledger entries re-probed on `feat/follow-ups-2026-11-09` @ `f966c765` with `.probes/reprobe.mjs` (one `compileFiles` per target, `WebAssembly.validate`, run via a sink-bundled ESM module, like `runProgramModule` in `test/unit/helpers.js:506`), plus `.probes/h01.mjs` (one process per target vs. `js` then `wasm` in one process). Columns js / both / wasm, observed → wanted.

| Area | Finding | Evidence & probe |
|---|---|---|
| Typechecker imports (parse cache) | A package used only in a constant array length is reported unused on the **second** compile of the same file in one process | `H01` `var a [math.MaxInt8]int; fmt.Println(len(a))`: fresh process per target → all `127`/OK; `node .probes/h01.mjs js wasm` → js OK, wasm `'math' imported and not used` (also `both` after `js`). Want `127` every time. Cause: `_resolveArrayTypeNode` (`src/typechecker/resolve.js:377`) folds `node.size` into a `BasicLit` **in place** on the cached AST, so the next check takes the `node.size?.value !== undefined` branch and never calls `_useQualifiedConsts` (`resolve.js:367`). Affects `gofront dev` rebuilds and the test runner. (feat/follow-ups-2026-11-09-phase-1) |
| Typechecker `switch` | `switch true { case nil: }` is accepted | `H02` → js/both `x`, wasm invalid `i32.eq[1] expected type i32, found ref.null of type anyref`; want `cannot convert nil to type bool`. Cause: `_caseValueUnchecked` (`src/typechecker/statements.js:474`) returns `true` for `isNil(caseType)` regardless of tag type; Task 1.1 of the 11-09 plan only fixed the tagless form (`_checkTaglessCase`, `:456`). (PR #164) |
| Typechecker `cap` | `cap` accepts struct and func operands | `H03` `type S struct{}; var s S; _ = cap(s)` and `f := func(){}; _ = cap(f)` → js/both compile, wasm invalid `not enough arguments on the stack for i64.extend_i32_u`; want `invalid argument: s (variable of type S) for cap`. Cause: `src/typechecker/expressions.js:1904` is a blacklist (map, string, bool, numeric). (PR #164) |
| Typechecker conversions | Explicit conversion of a concrete value to an interface type is rejected | `H04` `type I interface{ M() }; type T struct{}; func (T) M(){}; v := I(T{}); v.M()` → all `cannot convert T to I`; want `m`. Cause: `_checkConversionValidity` (`expressions.js:1143`) has no interface-target branch and falls through to the final `cannot convert` (`:1228`). (feat/follow-ups-2026-11-09-phase-2) |
| Parser interface literals | `interface{ M() }(v)` does not parse as an expression | `H04b` `v := interface{ M() }(T{})` → all `Parse error … Unexpected token in expression: 'interface'`; want `m`. Cause: `parsePrimary` (`src/parser/expressions.js:575`–`596`) handles `[`/`map`/`struct` type literals but not `interface`. |
| Typechecker `any` → interface | `any` is assignable to a non-empty interface without assertion | `H05` `var b any; var e error; e = b` and `var e fmt.Stringer = b` → all compile; want `cannot use b (variable of type any) as error value in assignment: need type assertion`. Cause: `_checkIfaceToConcrete` (`src/typechecker/assignability.js:446`) bails when `_isConcreteTarget` is false (`:468`, every interface), then `_assertAssignableEarlyReturn` accepts it. (PR #165) |
| Typechecker constraint types | A constraint interface (type-set element) is accepted as an ordinary variable type | `H06` `type N interface{ ~int \| ~string }; var x N` → all compile and run; want `cannot use type N outside a type constraint: interface contains type constraints`. Type sets are recorded as `unionConstraint` / `_typeSetEmbeds` (`src/typechecker/resolve.js:513`–`538`) but no use-site check exists. (feat/follow-ups-2026-11-09-phase-3) |
| Parser call arguments | A func-element slice literal as a call argument fails to parse | `H17` `show([]func(){nil})` → all `Parse error … expected ')' (got { "{")`; also `show([]func() int{func() int { return 1 }})`. Same literal with `:=` parses. Cause: `looksLikeCompositeLitArg` (`src/parser/expressions.js:408`) stops at `func`/`(`/`)` and reports "not a composite literal", so the call-arg path parses a bare type. (feat/follow-ups-2026-11-09-phase-6) |
| JS 64-bit constants | Compound assignment with an untyped constant in a `for` post statement emits Number + BigInt | `H07` `const half = 1 << 51; var b uint64 = 1; for i := 0; i < 1; b += half { i++ }` → js/both `TypeError: Cannot mix BigInt and other types`, wasm `2251799813685249`. Task 3.3 of the 11-09 plan fixed the statement path; the post clause goes through `stmtInline` (`src/backend/js/statements.js:1379`, `:1958`). (PR #166) |
| JS labeled range-over-func | `continue outer` / `break outer` from a nested range-over-func loop emits an undefined label | `H08` `outer: for x := range seq { for y := range seq { fmt.Println(x, y); continue outer } }` (seq yields 0, 1) → js/both `SyntaxError: Undefined label 'outer'`; `break outer` → same. Want `0 0\n1 0\ndone` / `0 0\ndone`. Cause: `_emitIterTargetDispatch` (`statements.js:1794`) emits `break/continue <lbl>` for every function label minus the loop's own, including labels of enclosing iterator loops, which live outside the current callback function. (PR #166, PR #167) |
| WASM labeled range-over-func | `continue outer` from a nested iterator stops the outer iterator | `H08` wasm → `0 0\ndone`, want `0 0\n1 0\ndone` (`break outer` → `0 0\ndone`, correct). Unwinding: `_unwindIteratorTargets` (`src/backend/wasm/emit-stmts.js`). (PR #167) |
| WASM range into boxed var | Range assignment over a slice or string into an address-taken variable emits invalid WASM | `H09` `s := []int{10, 20}; var v int; p := &v; for _, v = range s {}; fmt.Println(*p)` → js/both `20`, wasm invalid `local.set[0] expected type (ref null 288), found array.get of type i64`; string form `for _, r = range "ab"` with `&r` → wasm invalid `found local.tee of type i32`, want `98`. The map path uses `_emitRangeAssignStore` (`emit-stmts.js:726`, handles `isBoxed`); the slice/string paths do not. (PR #167) |
| WASM interface method dispatch | Calling a method promoted through an embedded pointer on a boxed struct value panics | `H10` `type PO struct{ *Inner }; var v any = PO{&Inner{}}; m, ok := v.(Mer); m.M()` → js/both `inner`, wasm `interface conversion: nil or unmatched type for method call`. The assertion succeeds (fixed by 11-09 Task 4.4) but the dispatch function's candidate list lacks the promoted `PO` → `*Inner` entry; miss emitted at `src/backend/wasm/emit.js:1477`. (PR #167) |
| JS nil receivers (analysis) | Shadowed receiver name and conditional receiver reads mark the method as not nil-safe | `H11` `func (s *S) M() int { if true { s := &Other{val: 5}; return s.val }; return 0 }` on nil `*S` → js/both `TypeError … (reading 'M')`, wasm `5`. `H12` `if cond { return s.x }; return 0` with `cond == false` → js/both TypeError, wasm `0`. Cause: `derefsReceiver` (`src/backend/js/expressions.js:48`) is scope-unaware and path-insensitive; used by `_markNilSafeMethods` (`src/backend/js/index.js:602`). (PR #168) |
| JS nil receivers (generics) | Methods on nil pointers to generic structs keep direct calls | `H13` `type Gen[T any] struct{ val T }; func (g *Gen[T]) Ping() string { if g == nil { return "nil" }; … }; var g *Gen[int]; g.Ping()` → js/both TypeError, wasm `nil`. Cause: `_nilSafeMethodClass` (`expressions.js:1999`) returns `null` when `t.base.typeArgs?.length`. (PR #168) |
| JS method expressions | `(*S).V` on a value-receiver method runs with a nil pointer | `H14` `f := (*S).V; var s *S; f(s)` (with `defer recover`) → js/both `10\n<nil>`, wasm `runtime error: invalid memory address or nil pointer dereference`. Cause: method-expression lowering (`expressions.js:1170`–`1185`) calls the prototype with `recv` without the implicit `*recv` nil check. (PR #168) |
| JS map keys | A defined slice or map literal used directly as a `map[any]` key does not panic | `H15` `type L []int; m[L{1}] = 1` and `type M map[string]int; m[M{}] = 1` → js/both `no panic`, wasm `… main.L` (correct) / `… map[string]int`. Cause: `__ik` is called with `_ifaceKeyTag(expr._ifaceKeyType)` (`expressions.js:578`), which does not produce the `!<name>` unhashable tag for a statically defined slice/map key, and the literal itself carries no `__t`. (PR #168) |
| WASM map keys | Unhashable-key panic for a defined map type names the underlying type | `H16` `type M map[string]int; try(M{})` (`m[k] = 1` with `k any`) → js/both `… main.M`, wasm `… map[string]int`. Cause: `src/backend/wasm/emit-builtins.js:1788`–`1797` names `goType` by its underlying type for maps (11-09 Task 4.3 fixed slices only). (PR #168) |
| JS `encoding/json` | `json.Marshal` of a func array in `any` encodes `null` elements | `H18` `var a [2]func(); var v any = a; json.Marshal(v)` → js/both `[null,null] <nil>`, wasm ` json: unsupported type: func()` (correct). Cause: the JS dynamic encoder for `isFuncComposite` arrays (`src/lower/json-codecs.js:1217`) treats func elements like nil slices; Go's array encoder always walks elements and fails on the first func. (PR #169) |

### Review follow-ups (2026-11-10, second sweep)

Re-probed on `feat/follow-ups-2026-11-09` @ `cbbc0020` (11-09 Phase 7 merged) with `.probes/h19.mjs` (`compileFiles` per target after `evictParseCache`, `WebAssembly.validate`, run). Shared prelude `H`: `type T struct{ A int }; func makePair() (T, int) { return T{1}, 1 }`. Want = Go output.

| Area | Finding | Evidence & probe |
|---|---|---|
| Forwarded returns into `any` | `return f()` where a result of the enclosing func is an interface and the forwarded element is a struct loses the value (JS) or boxes it as a pointer (WASM); a forwarded `int` emits invalid WASM | `H19` `func getPair() (any, int) { return makePair() }; v, _ := getPair(); json.Marshal(v)` → js/both `null <nil>`, wasm `{"A":1} <nil>`; want `{"A":1} <nil>`. Widened: `v, n := getPair(); _, ok := v.(T); fmt.Printf("%v %T %v %d", v, v, ok, n)` → js/both `<nil>  false -9223372036854775808`, wasm `&{1} *main.T false 1`; want `{1} main.T true 1`. Same on named results `(v any, n int)`, in a func literal and inside a range-over-func body (js `<nil> … false`, wasm `&{1} 1 false`). `func mk() (int, string); func get() (any, string) { return mk() }` → js/both `7 s true`, wasm invalid module. Unaffected: `(error, int)` forwarding `*E` (no struct box), `(T, int)` → `(T, int)`, `defer show(makePair())` (already split into temps by `normalizeDefers`, `src/lower/functions.js:225`). Cause: `_checkReturnStmt` (`src/typechecker/statements.js:310`–`324`) calls `assertAssignable(expected[i], forwarded[i], stmt.values[0], …)` with the **same** call node for every `i`, so `_markIfaceBox` (`src/typechecker/assignability.js:303`) tags the whole call with element 0's `_ifaceSrc`/`_ifaceBox`; the JS backend then boxes the result tuple array, and the WASM backend boxes the element with the wrong representation. (PR #170) |
| Forwarded call arguments into `any` | `g(f())` where `g` takes an interface parameter boxes the forwarded struct as a pointer on WASM | `func show(v any, n int) { _, ok := v.(T); fmt.Println(v, n, ok) }; show(makePair())` → js/both `{1} 1 true`, wasm `&{1} 1 false`; method form `O{}.show(makePair())` → wasm invalid module; want `{1} 1 true`. Forward is recorded as `expr._multiForward` (`src/typechecker/expressions.js:1468`) with no per-element box marks; JS spreads (`expressions.js:1394`) and boxes per param, WASM does not. |
| JSON codec reachability | With the split in place, the forwarded boxed type must still get a dynamic codec | After 11-09 Task 7.3, dynamic codecs are generated only for `via === "boxed"` entries, which `collectProgramTypes` (`src/lower/gen-types.js:140`) reads from `node._ifaceSrc` in the AST walk. Per-element marks that live outside the walked AST would drop `T`'s codec and print `json: unsupported type`. |

### Review follow-ups (2026-11-10, third sweep)

Re-probed on `feat/follow-ups-2026-11-09` @ `49a6d842` (11-09 Phase 8 merged). `H20` with `.probes/r.mjs` (`compileFiles` per target after `evictParseCache`, run); `H21` with `.probes/q.mjs` / `.probes/p.mjs` (`withTempDir` + `compileDir` + `runInDom`, as in `test/unit/compiler/templ.test.js`).

| Area | Finding | Evidence & probe |
|---|---|---|
| JS `complex64` constants | Untyped constant components of a `complex64` keep float64 precision | `H20` `var c complex64 = complex(float32(1), 0.01); fmt.Println(imag(c) == 0.01)` → js/both `false`, wasm `true`; want `true`. Widened: `complex(0.01, float32(1))` + `real(c) == 0.01` → same; `var f float32 = 1; complex(f, 0.01)` vs `var w float32 = 0.01` → same; literal `var c complex64 = 1 + 0.01i` → same; `fmt.Println(float64(imag(c)))` → js/both `0.01`, wasm `0.009999999776482582` (Go). `complex128` → `true` everywhere. Emitted JS: `let c = { re: 1, im: 0.01 }`; literal form `{ re: { re: 1, im: 0 }.re + { re: 0, im: 0.01 }.re, … }`. Cause: `_checkBuiltinComplex` (`src/typechecker/expressions.js:1938`) returns `COMPLEX64` without tagging the untyped operand via `_tagFloat32Const` (`src/typechecker/assignability.js:234`, which drives `_genFloat32Const`, `src/backend/js/expressions.js:744`); an untyped complex constant converted to `complex64` gets only `_asComplex` (`_tagComplexConst`, `assignability.js:272`), and the `ImagLit` emitter (`expressions.js:703`) writes `expr.value` raw. (PR #171) |
| templ `fmt` in `case` lists | A `fmt` call in any but the first value of a templ `case a, b:` is not routed to a typed formatter | `H21` `templ Case(s string, g float32) { switch s { case "a", fmt.Sprintf("%0.1f", g): <span>ok</span> } }` + `Case("1.0", 1)` → `ReferenceError: Sprintf$$fmt is not defined`; want `<span>ok</span>`. Also `case "a", "b", fmt.Sprintf(…)` and `case "a", fmt.Sprint(n)` (`n int64`) → same. Working: `fmt` call as the first case value, the switch tag, an `if` condition, a `for` body and an attribute. Cause: 11-09 Task 8.2 made `walkNodes` (`src/lower/gen-types.js:59`) visit templ's non-enumerable parsed-expression properties `TEMPL_EXPR_PROPS = ["expr", "forStmt"]`, but `TemplCase` also stores `exprs` (all values of `case a, b:`, `parseExprListTokens`, `src/parser/templ.js:89`) and the backend emits every one (`src/backend/js/templ.js:221`). The typechecker already checks them (`src/typechecker/index.js:1147`). (PR #171) |

---

## Approach

### 1. Architecture & Design Decisions

- **Typechecker first (Phase 1).** `H02` and `H03` emit invalid WASM only because invalid programs reach the backend; rejecting them fixes every target with no backend change.
- **`H01` parse-cache safety (Task 1.5):** `_resolveArrayTypeNode` keeps folding in place for backends but records the original expression on the node (`node._sizeExpr`). Both the fresh and already-folded branches call `_useQualifiedConsts(node._sizeExpr ?? node.size)`. Rejected: cloning the AST per compile (cost on every build) and disabling folding (backends read the literal).
- **`H02` (Task 1.1):** `_caseValueUnchecked` keeps skipping `nil` only when the (defaulted) tag type is nilable (`NILABLE_KINDS`, interface, pointer, slice, map, func). Otherwise `cannot convert nil to type <tag>`.
- **`H03` (Task 1.2):** invert the `cap` check into a whitelist: slice, array, pointer to array, and type parameters whose core type is one of those. Everything else (struct, func, pointer to non-array, interface, map, string, bool, numeric) → `invalid argument: … for cap`, keeping the existing `_capOperandKind` wording and the `sharedInfo` branch.
- **`H05` (Task 1.3):** extend `_checkIfaceToConcrete` with a second rule: a `_declared` empty-interface source flowing into an interface target whose method set is non-empty → `need type assertion`. `_declared` stays the switch that leaves JS-interop values alone (`G20` stays deferred in the 11-09 plan).
- **`H06` (Task 1.4):** one helper `_rejectConstraintUse(type, node)` called where a resolved type becomes a value type: var/const declarations, struct fields, params/results, composite literal types, conversions. Fires when the resolved interface has `unionConstraint`, `_typeSetEmbeds`, or is `comparable`. Constraint positions (type-parameter lists, embedded elements of another constraint) never call it.
- **Interface conversions (Tasks 2.1–2.2):** `_checkConversionValidity` routes an interface target through `assertAssignable(target, src, …, "conversion")` and returns, so method-set errors keep Go's wording. `parsePrimary` gains `T.INTERFACE`: `parseInterfaceType()` then `(` → `TypeConversion` (an `interface{…}{` composite literal is invalid Go, so only the conversion form is accepted).
- **`H17` (Task 2.3):** in the call-argument path, replace the token-skipping `looksLikeCompositeLitArg` with a speculative `parseType()` from the current position, check for `{`, then restore `this.pos`. One mechanism handles `func(...) R`, `struct{…}`, `interface{…}` and nested brackets.
- **`H07` (Task 2.4):** `stmtInline` for an `AssignStmt` with a compound operator delegates to the same 64-bit operand coercion that the statement path got in 11-09 Task 3.3, rather than duplicating it.
- **`H08` JS (Task 2.5):** each iterator callback records the labels declared inside it (`_iterLocalLabels`). `_emitIterTargetDispatch` emits `break/continue <lbl>` only for labels declared in the current JS function body. For labels of an enclosing iterator loop it propagates the flag (`return false` with `__targetN` set) up to that loop's dispatcher, which already handles its own label inside its callback.
- **WASM (Phase 3):** `H08` makes `continue L` targeting an outer iterator return `true` from the outer yield (resume) after unwinding inner iterators. `H09` routes slice/string range value stores through `_emitRangeAssignStore`. `H10` adds embed-path candidates for value structs whose promoted method comes through an embedded pointer. `H16` names a defined map key by its Go name, as 11-09 Task 4.3 did for slices.
- **JS nil receivers (Tasks 4.1–4.3):**
  - `derefsReceiver` stops descending into a block once it declares the receiver name (`:=`, `var`, func-literal params).
  - A method is marked unsafe only if a receiver read occurs in its *unconditional prefix* (top-level statements before the first `if`/`switch`/`for`/`return`/`select` that could skip it). Otherwise the method is nil-safe and gets static dispatch.
  - `_nilSafeMethodClass` supports generic receivers by resolving the instantiated class name the JS backend already uses for `Gen[T]` methods.
- **`H14` (Task 4.3):** a method expression `(*T).M` where `M` has a value receiver lowers to `(r, …a) => T.prototype.M.call(__deref(r), …a)`, using the same nil-deref panic helper as `*p`.
- **`H15` (Task 4.4):** `_ifaceKeyTag` returns `!<goName>` when the static key type is a defined (or unnamed) slice, map or func type, so `__ik` throws with Go's name with no runtime tag lookup.
- **`H18` (Task 4.5):** the JS dynamic encoder for a func-holding **array** fails with `json: unsupported type: func()` (like WASM's `EncodeDynamic`). Nil func slices and maps keep encoding `null` (11-09 Task 6.4 deviation, matches Go's `sliceEncoder`).
- **`H19` forwarding (Phase 5):** the typechecker stops tagging the shared call node and records one mark holder per forwarded element (`call._fwdIface = [{ _ifaceSrc, _ifaceBox, _ifaceNamedType, _ifacePtrFields } | null]`) by calling `_markIfaceBox(expected[i], forwarded[i], holder_i)`. A new lowering pass `splitForwardedTuples` (next to `normalizeDefers` in `src/lower/functions.js`, run first in `lower()`) rewrites `return f()` and `g(f())` whose `_fwdIface` has any non-null holder into `__fwd$N, __fwd$M := f(); return __fwd$N, __fwd$M` / `g(__fwd$N, __fwd$M)`, copying each holder's marks onto the temp `Ident` that is now the operand. Both backends then take their existing per-value boxing path and `collectProgramTypes` sees `_ifaceSrc` on the temp idents. Forwards with no interface element keep the direct tuple path (no extra locals).
  - Rejected: teaching each backend to box tuple elements (two codegen paths, plus the iterator-return and named-result variants in each); and setting marks on the temp idents from the backend (marks must exist before codec collection).
- **`H20` (Tasks 6.1–6.2):** reuse the 11-09 Task 8.1 mechanism (`_f32Const` → `_genFloat32Const`, compile-time `Math.fround`), no runtime rounding. `_checkBuiltinComplex` calls `_tagFloat32Const(FLOAT32, argType, arg)` for each untyped argument when the result is `COMPLEX64`. For an untyped complex constant that takes type `complex64` (`_tagComplexConst`), the typechecker sets `_c64Const` and the JS backend emits the folded constant as `{ re: fround(re), im: fround(im) }` literal text instead of the per-operand expression.
- **`H21` (Task 6.3):** add `"exprs"` to `TEMPL_EXPR_PROPS` in `src/lower/gen-types.js`; `walkNodes` already recurses into arrays. Every pass using `walkNodes` (formatter sites, `collectProgramTypes`) then sees all case values, matching what the typechecker and backend already handle.

### 2. Invariants & Safety Bounds

- No new runtime type descriptors; every new tag is a compile-time string.
- The cached AST stays valid for later compiles: Task 1.5 adds only an extra property and never removes one; the existing `parse cache never serves renamed ASTs` test (`test/unit/compiler/packages.test.js:788`) keeps passing.
- Static dispatch (`T.prototype.M.call`) does not allocate; `test/perf/zero-alloc.js` stays allocation-free; `npm run bench` within 3% (Done means).
- Examples keep type-checking (`npm run check`). If Task 1.3 or 1.4 flags example code relying on a loophole, fix the example with an explicit assertion in the same task and say so in the commit body.

### 3. Edge Cases & Error Handling

- Task 1.1: `switch x { case nil: }` with `x` of type `error`, `*T`, `[]int`, `map`, `func` stays valid; `switch true { case x > 0: }` stays valid.
- Task 1.2: `cap(&arr)`, `cap(s)` for a named slice, and a generic `[S ~[]E]` `cap(s)` stay valid.
- Task 1.3: `var e error = b` where `b` is a concrete `*MyErr` stays valid; `var c any = b` stays valid; `e = b.(error)` compiles.
- Task 1.4: `func f[T N](x T)` and `interface{ N; M() }` used as a constraint stay valid; `comparable` as a var type is rejected with the same message.
- Task 2.1: `I(nil)`, `error(nil)` and `I(x)` with `x` of another interface type that has `M()` compile; `I(T2{})` where `T2` lacks `M` → `does not implement`.
- Task 2.3: `make([]func(), 3)` (bare type argument), `[]byte(s)` (conversion) and `f([]int{1}...)` keep parsing.
- Task 2.5 / 3.1: `break inner`, plain `break`/`continue`, and `return` from two iterators deep (existing `test/unit/language/range-func.test.js`) keep working.
- Task 4.1: a method that dereferences the receiver unconditionally (`return s.x` as first statement) keeps the direct call (fast path).
- Task 4.4: a hashable struct key and a string key keep working; an `[N]int` array key stays hashable.
- Phase 5: `f()` is evaluated exactly once; the split is a statement-level rewrite, so a forward inside an `if` init, a `switch` init or a `for` post must be skipped or hoisted into a block, never duplicated (`return f()` is always a statement; `g(f())` can be nested in an expression, in which case the pass wraps it as `func() R { a, b := f(); return g(a, b) }()` only if a probe shows that nesting occurs, otherwise leaves it). Named results: `return f()` still assigns every named result before deferred calls run. `return f()` inside a range-over-func body still goes through `_genIteratorReturn` with the temps.
- Phase 6: exact `float32` values (`complex(float32(1), 0.5)`) keep their emitted text; `complex128` and untyped complex constants used as `complex128` are unchanged; `cmplx`-style arithmetic on two `complex64` variables is out of scope (already rounded per op or not, unchanged). Task 6.3: the first case value is now reached twice (as `expr` and as `exprs[0]`); formatter registration must stay idempotent (one `gff_*` per call node).

---

## Implementation Tasks

Scheduled from review follow-ups (`plans/follow-ups.md` sweep 2026-11-10, `H01`–`H18`). Each task's `Test:` asserts the repro from `Verified Gaps`.

### Phase 1: Typechecker Checks

- [x] Task 1.1: Reject `case nil` against a non-nilable switch tag (`H02`)
  - Files: `src/typechecker/statements.js`
  - Test: `test/unit/types/switch-cases.test.js`. `switch true { case nil: }` → `assertErrorContains(…, "cannot convert nil to type bool")`; `var e error; switch e { case nil: }` and `var p *int; switch p { case nil: }` compile and run.
  - Done when: the negative case errors on `js`, `both`, `wasm` (no invalid WASM) and the positive cases print Go's output.
- [x] Task 1.2: Make `cap` accept only slice, array and pointer-to-array operands (`H03`)
  - Files: `src/typechecker/expressions.js`
  - Test: `test/unit/builtins/cap.test.js`. `cap(s)` with `s` a struct → `"invalid argument: s (variable of type S) for cap"`; `cap(f)` with `f` a func → `"for cap"`; existing positive cases (slice, array, `&arr`, generic `S ~[]E`) stay green.
  - Done when: no target produces invalid WASM for the struct and func repros.
- [x] Task 1.3: Require a type assertion for `any` → non-empty interface (`H05`)
  - Files: `src/typechecker/assignability.js`
  - Test: `test/unit/types/any-assertion.test.js`. `var b any; var e error; e = b` → `"need type assertion"`; `var s fmt.Stringer = b` → same; `var c any = b`, `e = b.(error)` and `var e2 error = &MyErr{}` compile.
  - Done when: both negatives error on all targets and `npm run check` (example type-checks) passes.
- [x] Task 1.4: Reject constraint interfaces used as ordinary types (`H06`)
  - Files: `src/typechecker/resolve.js`, `src/typechecker/index.js`, `src/typechecker/statements.js`
  - Test: `test/unit/types/generics.test.js`. `type N interface{ ~int | ~string }; var x N` → `assertErrorContains(…, "cannot use type N outside a type constraint")`; same for a struct field `F N`, a param `func f(n N)` and `var c comparable`; `func g[T N](x T) T { return x }` with `g(3)` → `3`.
  - Done when: every negative errors on all targets and the generic positive runs.
- [x] Task 1.5: Count package uses in folded array lengths on cached ASTs (`H01`)
  - Files: `src/typechecker/resolve.js`
  - Test: `test/unit/types/array-length.test.js`. Write the `H01` program to a temp dir, `compileFiles` it with `forceTarget: "js"` then `"wasm"` then `"both"` in the same process (no `evictParseCache`) → every compile has no errors and the WASM run prints `127`.
  - Done when: the second and third compiles no longer report `'math' imported and not used`, and `test/unit/compiler/packages.test.js` parse-cache tests pass.

### Phase 2: Parser, Interface Conversions and JS Statements

- [x] Task 2.1: Allow explicit conversions to interface types (`H04`)
  - Files: `src/typechecker/expressions.js`
  - Test: `test/unit/types/any-assertion.test.js`. `v := I(T{}); v.M()` → `m` (`assertAllTargetsOutput`); `I(nil)` compiles; `I(T2{})` with `T2` lacking `M` → `assertErrorContains(…, "does not implement")`.
  - Done when: the positive runs on every target and the negative keeps Go's wording.
- [x] Task 2.2: Parse `interface{…}(x)` conversion expressions (`H04b`)
  - Files: `src/parser/expressions.js`
  - Test: `test/unit/parser/constraint-elements.test.js`. `v := interface{ M() }(T{}); v.M()` → `m` (`assertAllTargetsOutput`); `interface{}(3)` → prints `3`.
  - Done when: both programs parse and print Go's output on every target.
- [x] Task 2.3: Detect composite-literal call arguments by parsing the type speculatively (`H17`)
  - Files: `src/parser/expressions.js`
  - Test: `test/unit/compiler/lexer-parser.test.js`. `show([]func(){nil})` → `false`; `show([]func() int{func() int { return 1 }})` → `1`; `make([]func(), 3)`, `[]byte("a")` and `f([]int{1}...)` keep parsing (`assertAllTargetsOutput`).
  - Done when: no `expected ')'` parse error for either repro and the existing parser tests pass.
- [x] Task 2.4: Emit BigInt operands for 64-bit compound assignments in `for` post statements (`H07`)
  - Files: `src/backend/js/statements.js`
  - Test: `test/unit/language/int64.test.js`. The `H07` repro → `2251799813685249`; `var n int64 = 0; for i := 0; i < 2; n -= half { i++ }` → `-4503599627370496` (`assertAllTargetsOutput`).
  - Done when: no `TypeError` on `js` or `both`, and `wasm` output is unchanged.
- [x] Task 2.5: Propagate labeled `break`/`continue` to enclosing range-over-func loops in JS (`H08`, JS)
  - Files: `src/backend/js/statements.js`
  - Test: `test/unit/language/range-func.test.js`. Nested `continue outer` → `0 0\n1 0\ndone`; nested `break outer` → `0 0\ndone` (`assertJsTargetsOutput`; WASM `continue` pinned in Task 3.1).
  - Done when: no `SyntaxError: Undefined label` on `js`/`both` and existing range-func tests pass.

### Phase 3: WASM Codegen

- [x] Task 3.1: Resume the outer iterator on `continue outer` from a nested range-over-func loop (`H08`, WASM)
  - Files: `src/backend/wasm/emit-stmts.js`
  - Test: `test/unit/language/range-func.test.js`. Upgrade the Task 2.5 cases to `assertProgramOutput`; add three levels deep with `continue outer` → Go output.
  - Done when: `wasm` prints `0 0\n1 0\ndone` and `break outer` still prints `0 0\ndone`.
- [x] Task 3.2: Store slice and string range values through the box of an address-taken variable (`H09`)
  - Files: `src/backend/wasm/emit-stmts.js`
  - Test: `test/unit/language/range-assign.test.js`. The slice repro → `20`; the string repro → `98`; the key form `for i = range s` with `&i` → `1` (`assertProgramOutput`).
  - Done when: `assertValidWasm` passes and `wasm` matches `js` for all three.
- [x] Task 3.3: Dispatch interface calls to methods promoted through an embedded pointer of a boxed struct value (`H10`)
  - Files: `src/backend/wasm/emit.js`, `src/backend/wasm/prescan.js`
  - Test: `test/unit/wasm/iface-assert.test.js`. The `H10` repro → `inner`; two levels (`type PO2 struct{ PO }`) → `inner`; a nil embedded pointer whose method checks `i == nil` → Go output (`assertProgramOutput`).
  - Done when: no `nil or unmatched type for method call` panic for any of the three.
- [x] Task 3.4: Name defined map types in WASM unhashable-key panics (`H16`)
  - Files: `src/backend/wasm/emit-builtins.js`
  - Test: `test/unit/wasm/map-keys.test.js`. The `H16` repro → `runtime error: hash of unhashable type main.M` on the wasm side; the unnamed `map[string]int{}` key keeps `… map[string]int`.
  - Done when: both messages match Go exactly on `wasm`.

### Phase 4: JS Nil Receivers, Method Expressions, Map Keys and `encoding/json`

- [x] Task 4.1: Make the JS nil-safe-method analysis scope-aware and limit unsafe marking to unconditional receiver reads (`H11`, `H12`)
  - Files: `src/backend/js/expressions.js`, `src/backend/js/index.js`
  - Test: `test/unit/language/nil-receiver.test.js`. `H11` → `5`; `H12` with `cond == false` → `0` (`assertAllTargetsOutput`); a method whose first statement is `return s.x` on nil → panics with Go's nil-dereference message on every target.
  - Done when: both repros match Go, and `npm run bench` is within 3% of the plan's base commit.
- [ ] Task 4.2: Statically dispatch nil-safe methods of generic struct pointers (`H13`)
  - Files: `src/backend/js/expressions.js`
  - Test: `test/unit/language/nil-receiver.test.js`. The `H13` repro → `nil`; non-nil `&Gen[int]{}` → `ok`; `Gen[string]` instantiation → `nil` (`assertAllTargetsOutput`).
  - Done when: no `TypeError` on `js`/`both`.
- [ ] Task 4.3: Nil-check the receiver of `(*T).M` method expressions for value-receiver methods (`H14`)
  - Files: `src/backend/js/expressions.js`
  - Test: `test/unit/language/nil-receiver.test.js`. The `H14` repro → `runtime error: invalid memory address or nil pointer dereference` (`assertAllTargetsOutput`); non-nil `f(&S{})` → `10`.
  - Done when: every target prints Go's panic message.
- [ ] Task 4.4: Panic on defined slice and map literal keys of `map[any]` on JS (`H15`)
  - Files: `src/backend/js/expressions.js`
  - Test: `test/unit/wasm/map-keys.test.js`. `m[L{1}] = 1` → `runtime error: hash of unhashable type main.L`; `m[M{}] = 1` → `… main.M` (`assertAllTargetsOutput`, relies on Task 3.4 for wasm); `m[[2]int{1, 2}] = 1` and a hashable struct key still work.
  - Done when: every target prints Go's message and hashable keys are unchanged.
- [ ] Task 4.5: Fail `json.Marshal` of func arrays in `any` on JS, and update the docs (`H18`)
  - Files: `src/lower/json-codecs.js`, `docs/go-compatibility.md`
  - Test: `test/unit/builtins/json.test.js`. `var a [2]func(); var v any = a; json.Marshal(v)` → ` json: unsupported type: func()` (`assertAllTargetsOutput`); nil `[]func()` in `any` keeps `null <nil>`.
  - Done when: every target prints Go's error, and the `encoding/json` row of `docs/go-compatibility.md` says func arrays in an `any` fail on every target (nil func slices still encode `null`).

### Phase 5: Multi-Value Call Forwarding into Interfaces

Scheduled from review follow-ups (`plans/follow-ups.md` sweep 2026-11-10, second pass, `H19`).

- [ ] Task 5.1: Record per-element interface-box marks for forwarded tuples and split forwarded `return f()` into temps (`H19` returns)
  - Files: `src/typechecker/statements.js`, `src/lower/functions.js`, `src/lower/index.js`
  - Test: `test/unit/types/dynamic-types.test.js`. With prelude `H`: `func getPair() (any, int) { return makePair() }` → `fmt.Printf("%v %T %v %d\n", v, v, ok, n)` prints `{1} main.T true 1`; named results `(v any, n int)` → same; the func-literal form → same; `func mk() (int, string) { return 7, "s" }; func get() (any, string) { return mk() }` → `7 s true` (`assertAllTargetsOutput`, so WASM must validate).
  - Done when: all four print Go's output on every target, and a forward with no interface element (`(T, int)` → `(T, int)`) emits no `__fwd$` temps in the JS output.
- [ ] Task 5.2: Split forwarded returns inside range-over-func bodies (`H19` iterator return)
  - Files: `src/lower/functions.js`
  - Test: `test/unit/language/range-func.test.js`. `func get() (any, int) { for range seq { return makePair() }; return nil, 0 }` → `{1} 1 true` (`assertAllTargetsOutput`); a `defer` in `get` that reads the named result sees the forwarded value.
  - Done when: both print Go's output on every target.
- [ ] Task 5.3: Split forwarded call arguments into interface parameters (`H19` call arguments)
  - Files: `src/typechecker/expressions.js`, `src/lower/functions.js`
  - Test: `test/unit/types/dynamic-types.test.js`. `show(makePair())` → `{1} 1 true`; `O{}.show(makePair())` → `{1} 1 true`; `fmt.Println(makePair())` keeps printing `{1} 1`; `defer show(makePair())` keeps printing `{1} 1 true` (`assertAllTargetsOutput`).
  - Done when: every target prints Go's output and `assertValidWasm` passes for the method form.
- [ ] Task 5.4: Keep dynamic JSON codecs for types boxed through forwarded tuples (`H19` JSON)
  - Files: `src/lower/gen-types.js`, `src/lower/json-codecs.js`
  - Test: `test/unit/builtins/json.test.js`. The original `H19` repro → `{"A":1} <nil>`; `show2(makePair())` where `show2(v any, _ int)` marshals `v` → `{"A":1} <nil>` (`assertAllTargetsOutput`); the 11-09 Task 7.3 codec-count test (`test/unit/builtins/json-codegen-size.test.js`) is unchanged.
  - Done when: every target prints `{"A":1} <nil>` and the codec count for never-boxed types does not grow.

### Phase 6: `complex64` Constants on JS and templ `case` Formatters

Scheduled from review follow-ups (`plans/follow-ups.md` sweep 2026-11-10, third pass, `H20`, `H21`).

- [ ] Task 6.1: Round untyped constant operands of `complex()` to float32 when the result is `complex64` (`H20` builtin)
  - Files: `src/typechecker/expressions.js`
  - Test: `test/unit/types/complex.test.js`. `var c complex64 = complex(float32(1), 0.01); fmt.Println(imag(c) == 0.01)` → `true`; `complex(0.01, float32(1))` + `real(c) == 0.01` → `true`; `var f float32 = 1; complex(f, 0.01)` vs `var w float32 = 0.01` → `true`; `fmt.Println(float64(imag(c)))` → `0.009999999776482582` (`assertAllTargetsOutput`).
  - Done when: all four print Go's output on every target, and `complex(1, 0.01)` as `complex128` still prints `true` for `imag(c) == 0.01`.
- [ ] Task 6.2: Emit untyped complex constants converted to `complex64` with float32-rounded components (`H20` literal)
  - Files: `src/typechecker/assignability.js`, `src/backend/js/expressions.js`
  - Test: `test/unit/types/complex.test.js`. `var c complex64 = 1 + 0.01i; fmt.Println(imag(c) == 0.01, float64(imag(c)))` → `true 0.009999999776482582`; `var d complex64 = 0.1; fmt.Println(float64(real(d)))` → `0.10000000149011612` (`assertAllTargetsOutput`).
  - Done when: both match Go on every target, and the emitted JS for a `complex128` constant is unchanged.
- [ ] Task 6.3: Walk every value of templ `case a, b:` lists in the shared AST walker (`H21`)
  - Files: `src/lower/gen-types.js`
  - Test: `test/unit/compiler/templ.test.js`. The `H21` component with `Case("1.0", 1)` → `#app` innerHTML `<span>ok</span>` (`runInDom`); `case "a", "b", fmt.Sprintf("%0.1f", g):` → same; `case "a", fmt.Sprint(n)` with `n int64 = 9007199254740993` and `s = "9007199254740993"` → `<span>ok</span>`; the existing Task 8.2 (11-09) templ `fmt` tests stay green.
  - Done when: no `Sprintf$$fmt is not defined` for any case position, and each `fmt` call gets exactly one `gff_` formatter in the JS output.
