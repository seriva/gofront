# `wasm` Struct Types — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Split out of the former `followup-fixes-plan.md` (now [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md)) on 2026-11-17 by root cause (its former Phases 2–3 and Tasks 8.2–8.3: F8, F17, F24, F25, F28, F31, L5, L11, L13), plus three `plans/follow-ups.md` entries with the same root (*WASM map keys*, *WASM struct conversion*, *WASM append of a named struct into an anonymous-struct slice*). Must merge before [`value-stores-plan.md`](value-stores-plan.md) Phase 4, whose embedded-field copy needs this layout. Independent of the other v2.0.0 plans.  
**Release note:** More programs that use anonymous structs work on WebAssembly: structs with embedded fields, anonymous structs as map keys, in slices and as type arguments of generic functions, and conversions between named and anonymous struct types. Generic functions that use `(*T)(nil)` or name a type parameter like a package type, and method expressions called with a `nil` receiver, also compile on WebAssembly.  

---

## Goal

Every anonymous struct type has one WasmGC layout and one type key on `wasm`, so a value built in one place is read correctly everywhere else. Today the layout is built by four copies of the same field-list loop, and type identity by three key functions with different coverage. Each copy and key was patched separately; this plan replaces them with one field list and one key, then fixes the AST rewrites (monomorph substitution, method expressions) that lose a node's static type.

**Done means:**
- Every failing row in *Verified Gaps* prints Go 1.26's output on `wasm` (and still on `js`/`both`), each as an `assertAllTargetsOutput` test in the file its task names, with `assertValidWasm` on the module.
- `grep -n "rawFields" src/backend/wasm` finds one definition (the shared `structFieldList`) and no copies; `grep -n "function rawTypeKey\|export function goTypeKey" src/backend/wasm` finds one key function.
- The `js-codegen-fixes` Task 3.2 cases in `test/unit/language/value-semantics.test.js` and the v1.9.3 follow-ups Task 1.3 cases in `test/unit/types/generics.test.js` run on `assertAllTargetsOutput` instead of `assertJsTargetsOutput`.
- `npm test` passes; `test/perf/zero-alloc.js`, `bce-mathx.js` and `bundle-size.js` pass with `bundle-size.baseline.json` unchanged.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: target-specific** | Root `wasm-struct-field-list`: one declared-field list (with `embedded`) per struct type, used by every layout, key and map-key path on `wasm` | W1.1–W1.8 | |
| **In scope: target-specific** | Root `wasm-type-key`: one type key for every `wasm` decision that needs type identity (monomorph instances, anonymous struct names, map key helpers) | W2.1–W2.4 | |
| **In scope: target-specific** | Root `wasm-rewrite-types`: AST rewrites on `wasm` (monomorph substitution, method expressions) keep each node's static type | W3.1–W3.4 | |
| **Excluded: deferred** | Value copies of struct fields (deep copy through pointers, captured variables, embedded fields under capture) | *WASM captured struct assignment*, *WASM struct literal with a value-struct field*, *WASM struct assignment (embedded, captured)* | Root `wasm-value-copy`, [`value-stores-plan.md`](value-stores-plan.md) Phase 4; needs this plan's field list first |
| **Excluded: deferred** | Checker `instanceKey` (`src/typechecker/resolve.js:125`) | `js`/`both` already give distinct instances for L5 (re-probe) | The checker key is correct for its use; this plan only unifies the `wasm` keys. Sharing one key across checker and backend would cross the `typechecker` → `backend` layer rule for no fixed defect |
| **Excluded: runtime / platform** | Channels in anonymous struct element types | `make(chan struct{ A [2]int }, 1)` | Channels are not supported in GoFront (parse error on every target) |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6`, 2026-11-17. A throwaway driver (`.probes/ff/`, deleted) ran each program with `go run` (go1.26.10, module mode) and `runProgram` (`test/unit/helpers.js:522`) on `js`/`both`/`wasm`. Unless stated, `js` and `both` print Go's output and only `wasm` is wrong. *sibling* rows were found by probing the root's other paths.

### W1 `wasm-struct-field-list`

Root: four copies of the same loop turn a struct type into a field list, each reading `t.fields` (which includes promoted fields of embedded structs) and dropping `f.embedded`: `toWasmType` (`src/backend/wasm/types.js:307`), `goTypeKey` (`types.js:430`), `_resolveStructInfo` (`src/backend/wasm/emit.js:1160`); `getAnonStructType` (`src/backend/wasm/module-emitter.js:289`) sets `embeds: []`. Map keys use a fifth path, `_resolveStructType` (`src/backend/wasm/emit-maps.js:21`), which resolves only named structs. A layout built by one path does not match the `struct.new` or `struct.get` built by another.

| ID | Program | Go | `wasm` |
|---|---|---|---|
| W1.1 (F17) | `type P struct{ N int }; v := struct{ P; M int }{P: P{5}, M: 6}; fmt.Println(v.N, v.P.N, v.M)` | `5 5 6` | `0 5 6` |
| W1.2 *sibling* | same, positional `{P{5}, 6}` | `5 5 6` | `6 5 0` |
| W1.3 (F25) | `y := struct{ P; M *P }{P{1}, &P{2}}; y.N = 5; fmt.Println(y.N, y.M.N)` | `5 2` | ICE (`struct.new[1] expected …`) |
| W1.4 *sibling* | `xs := []struct{ P; M int }{{P{1}, 2}}; fmt.Println(xs[0].N, xs[0].M)` | `1 2` | `2 0` |
| W1.5 (F28) | `m := map[struct{ X int; S string; A [2]int }]int{a: 10}; m[a]` | `10` | `0` |
| W1.6 (ledger *WASM map keys*) | `m := map[struct{ X int }]int{}; m[u] = 10; m[u]` | `10` | `0` |
| W1.7 (ledger *WASM struct conversion*) | `type A struct{ E }; u := struct{ E }(a); b := A(u)` | `11 11` | ICE (invalid wasm) |
| W1.8 (ledger *append named into anonymous*) | `var s []struct{ X int }; s = append(s, A{5})` (`type A struct{ X int }`) | `1 5` | ICE (`array.set[2] expected …`) |
| control | `var u struct{ X int } = A{5}`; `struct{ A_int int }` next to `struct{ A int }` | `5`; `1 2` | correct |

### W2 `wasm-type-key`

Root: `wasm` has two type-key functions with different coverage, `rawTypeKey` (`src/backend/wasm/monomorph.js:43`, no struct or func case: anonymous struct type arguments fall to the erased `$val` instance) and `goTypeKey` (`types.js:377`); `getAnonStructType` builds its name with `[^a-zA-Z0-9_]` → `_`, so distinct keys can collide.

| ID | Program | Go | `wasm` |
|---|---|---|---|
| W2.1 (F31) | `func id[T any](v T) T; st := struct{ A [2]int }{}; a := id(st); a.A[0] = 1; fmt.Println(st.A[0], a.A[0])` | `0 1` | ICE `Cannot resolve struct for selector: A` |
| W2.2 (F24) | `id[struct{ N int }](struct{ N int }{4}).N` | `4` | same ICE (`N`) |
| W2.3 *sibling* | `id(struct{ X int }{1})` and `id(struct{ S string }{"s"})` in one program | `1 s` | same ICE (`X`) |
| W2.4 (L5) | `Box[func(struct{ X int }) int]` and `Box[func(struct{ S string }) string]` in one program | `1 hi` + distinct `%T` | ICE `Cannot assign func(struct{...}) int to func(any) int` (js/both correct since checker-strictness) |

### W3 `wasm-rewrite-types`

Root: `wasm`-only AST rewrites build new nodes without the static type the emitter needs. `cloneAst` (`monomorph.js:221`) drops `_structFields` and `substituteInType` (`:179`) has no struct or parenthesised-pointer case; substitution happens after name resolution, so a type parameter named like a package type resolves to the package type; `rewriteMethods` (`src/backend/wasm/method-expr.js:345`) passes an untyped `nil` receiver through without a type.

| ID | Program | Go | `wasm` |
|---|---|---|---|
| W3.1 (F31 notes) | `func outer[T any](x T) T { return inner(struct{ A T }{A: x}).A }; outer(3)` | `3` | ICE (`A`) |
| W3.2 (F8) | `func f[T comparable](x T) int { p := (*T)(nil); if p == nil { return 0 }; return 1 }; f(3)` | `0` | ICE `Undefined: 'T'` |
| W3.3 (L11) | `type S struct{ X int }; func f[S any](v S) *S { return new(S) }; f[struct{ X int }](struct{ X int }{}).X` | `0` | ICE (`X`) |
| W3.4 (L13) | `type U struct{ X int }; func (u *U) IsNil() bool { return u == nil }; (*U).IsNil(nil)` (also `type undefined`) | `true` | ICE `Cannot resolve struct for selector: IsNil` |

---

## Approach

### 1. Architecture & Design Decisions
- **One field list (W1).** `structFieldList(t, checker)` in `src/backend/wasm/types.js` returns the declared fields of a struct type (from `t._structFields`, falling back to `t.fields` only for AST `StructType` nodes), each `{ name, goType, embedded }`, never promoted entries. `toWasmType`, `goTypeKey`, `_resolveStructInfo` and `_structInfoForGoType` call it; `getAnonStructType` takes it and fills `embeds` from `embedded` fields so promoted selectors and literals use one layout. `_resolveStructType` in `emit-maps.js` falls back to `_resolveStructInfo` for anonymous structs. Composite literals (`emitCompositeLit`) map keyed and positional elements onto the declared list.
- **One type key (W2).** `goTypeKey` becomes the only `wasm` key: it gains struct (declared fields with `~` for embedded, tags excluded), func (params, results, variadic) and interface cases, and escapes names reversibly (`_` → `__`, separators as `_s`/`_c`) so distinct keys never collide. `monomorph.js` `typeKey` calls it; `rawTypeKey` is deleted. Instance names stay valid JS/wasm identifiers.
- **Rewrites keep types (W3).** `cloneAst` copies `_structFields`; `substituteInType` handles struct, func and parenthesised pointer types; monomorph substitutes type parameters into the instance's scope before resolving names, so a parameter shadows a package type. `rewriteMethods` converts an untyped `nil` receiver to the method expression's receiver type.

### 2. Invariants & Safety Bounds
- Named struct types keep their current WasmGC types and names; programs without anonymous structs emit byte-identical modules.
- Two anonymous struct types share one WasmGC type exactly when Go considers them identical (ignoring tags); one generic instance per identical type argument.
- `wasm` modules pass `WebAssembly.validate` (the harness gate) for every test.

### 3. Edge Cases & Error Handling
- An alias of an anonymous struct (`type S = struct{ A [2]int }`) shares the struct's instance and layout.
- Embedded pointer fields (`struct{ *P }`) are stored as a reference field; promoted selectors dereference through it.
- Field names containing `_` (`A_int`) next to `A int` stay distinct (control row).
- A struct key with array fields hashes and compares arrays recursively (`emitKeyHash`/`emitKeyEq` already do); only the struct info lookup changes.

---

## Implementation Tasks

> Split from the former `followup-fixes-plan.md` (re-probed 2026-11-17) and three `plans/follow-ups.md` entries with the same root.

### Phase 1: One struct field list on `wasm` (root `wasm-struct-field-list`)
- [ ] Task 1.1: `structFieldList` and the layout paths (W1.3, W1.4)
  - Files: `src/backend/wasm/types.js` (`structFieldList`, `toWasmType`, `goTypeKey`), `src/backend/wasm/emit.js` (`_resolveStructInfo`), `src/backend/wasm/module-emitter.js` (`getAnonStructType` `embeds`)
  - Test: `test/unit/wasm/structs.test.js`: W1.3 → `5 2`, W1.4 → `1 2` with `assertAllTargetsOutput`
  - Done when: both pass; `rawFields` built in one place
- [ ] Task 1.2: Keyed and positional embedded fields in literals (W1.1, W1.2)
  - Files: `src/backend/wasm/emit-exprs.js` (`emitCompositeLit`)
  - Test: `test/unit/wasm/structs.test.js`: W1.1 and W1.2 → `5 5 6`
  - Done when: both pass on every target
- [ ] Task 1.3: Map keys, conversions and `append` across named and anonymous structs (W1.5–W1.8)
  - Files: `src/backend/wasm/emit-maps.js` (`_resolveStructType` fallback), `src/backend/wasm/emit-exprs.js` (struct conversion and slice element store use the shared layout)
  - Test: `test/unit/wasm/map-keys.test.js` W1.5, W1.6 → `10` (and a key differing only in `A[1]` misses); `test/unit/wasm/structs.test.js` W1.7 → `11 11`, W1.8 → `1 5`
  - Done when: all pass with valid modules

### Phase 2: One `wasm` type key (root `wasm-type-key`)
- [ ] Task 2.1: `goTypeKey` covers struct, func and interface types with reversible escaping
  - Files: `src/backend/wasm/types.js` (`goTypeKey`), `src/backend/wasm/module-emitter.js` (anonymous struct names from the key)
  - Test: `test/unit/wasm/structs.test.js`: key unit test (`struct{ A_int int }` vs `struct{ A int }`, `struct{ P }` vs `struct{ P P }`, func types differing only in a param) gives distinct keys; identical types written twice give one key
  - Done when: passes; existing wasm suite green
- [ ] Task 2.2: Monomorph uses `goTypeKey` (W2.1–W2.4)
  - Files: `src/backend/wasm/monomorph.js` (`typeKey` → `goTypeKey`, delete `rawTypeKey`)
  - Test: `test/unit/wasm/generics.test.js`: W2.1 → `0 1`, W2.2 → `4`, W2.3 → `1 s`, W2.4 → `1 hi` and distinct `%T`, with `assertAllTargetsOutput`; switch the `value-semantics.test.js` Task 3.2 cases and `generics.test.js` Task 1.3 cases to `assertAllTargetsOutput`
  - Done when: all pass on every target

### Phase 3: `wasm` rewrites keep static types (root `wasm-rewrite-types`)
- [ ] Task 3.1: `cloneAst` and `substituteInType` for struct, func and parenthesised pointer types (W3.1, W3.2)
  - Files: `src/backend/wasm/monomorph.js`
  - Test: `test/unit/wasm/generics.test.js`: W3.1 → `3`; W3.2 with `T` and with `Proxy` → `0`; `(*T)(&x)` → `1`
  - Done when: all pass on every target
- [ ] Task 3.2: Type parameters shadow package types in instance bodies (W3.3)
  - Files: `src/backend/wasm/monomorph.js`
  - Test: `test/unit/wasm/generics.test.js`: W3.3 → `0`; `*f[struct{ X int }](…)` → `{0}`; the [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md) Task 4.1 (L2) `Box[struct{ X int }]` case runs on every target
  - Done when: all pass on every target
- [ ] Task 3.3: Method expressions with an untyped `nil` receiver (W3.4)
  - Files: `src/backend/wasm/method-expr.js` (`rewriteMethods`)
  - Test: `test/unit/wasm/pointers.test.js`: W3.4 with `U` and `undefined` → `true`; `(*U).IsNil(&U{})`, `(*U).IsNil((*U)(nil))` → `false true`; a method expression stored in a variable and called with `nil`
  - Done when: all pass; `js`/`both` print the same
