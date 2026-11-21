# `wasm` Struct Types — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Split out of the former `followup-fixes-plan.md` (now [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md)) on 2026-11-17 by root cause (its former Phases 2–3 and Tasks 8.2–8.3: F8, F17, F24, F25, F28, F31, L5, L11, L13), plus three `plans/follow-ups.md` entries with the same root (*WASM map keys*, *WASM struct conversion*, *WASM append of a named struct into an anonymous-struct slice*). Must merge before [`value-stores-plan.md`](value-stores-plan.md) Phase 4, whose embedded-field copy needs this layout. Independent of the other v2.0.0 plans.  
**Release note:** More programs that use anonymous structs work on WebAssembly: structs with embedded fields, anonymous structs as map keys, in slices and as type arguments of generic functions, and conversions between named and anonymous struct types. Generic functions that use `(*T)(nil)` and method expressions called with a `nil` receiver also compile on WebAssembly.  

---

## Goal

Every anonymous struct type has one WasmGC layout and one type key on `wasm`, so a value built in one place is read correctly everywhere else. Today the layout is built by four copies of the same field-list loop, and type identity by two key functions with different coverage while `typeToTypeNode` erases anonymous structs to `any`. Each copy and key was patched separately; this plan replaces them with one field list, one key, and concrete struct AST nodes in monomorphisation, then fixes the AST rewrites (monomorph cloning/substitution, method expressions) that lose a node's static type.

**Done means:**
- Every failing row in *Verified Gaps* prints Go 1.26's output on `wasm` (and still on `js`/`both`), each as an `assertAllTargetsOutput` test in the file its task names, with `assertValidWasm` on the module.
- `grep -rn "rawFields" src/backend/wasm` finds no matches (`structFieldList` is the single helper called by `toWasmType`, `goTypeKey`, `isUnhashableGoType`, `_resolveStructInfo`, `module-emitter.js`, and `classifyAnonStruct`); `grep -rn "function rawTypeKey\|export function goTypeKey" src/backend/wasm` finds one key function.
- The `assertJsTargetsOutput` cases in `test/unit/language/value-semantics.test.js` (lines 856–917, 1003–1045, and 1047–1070) and `test/unit/types/generics.test.js` (lines 2388–2500; leaving lines 2057 & 2074 untouched) run on `assertAllTargetsOutput`.
- `npm test` passes; `test/perf/zero-alloc.js`, `bce-mathx.js` and `bundle-size.js` pass with `bundle-size.baseline.json` unchanged.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: target-specific** | Root `wasm-struct-field-list`: one declared-field list (with `embedded`) per struct type, used by every layout, boundary, key, hashability and map-key path on `wasm` | W1.1–W1.12 | |
| **In scope: target-specific** | Root `wasm-type-key`: one type key for every `wasm` decision that needs type identity (monomorph instances, anonymous struct names, map key helpers), plus `typeToTypeNode` and `goTypeName` preserving anonymous structs and interfaces | W2.1–W2.6 | |
| **In scope: target-specific** | Root `wasm-rewrite-types`: AST rewrites on `wasm` (monomorph cloning/substitution, method expressions) keep each node's static type | W3.1, W3.2, W3.4 | |
| **Excluded: deferred** | Value copies of struct fields (deep copy through pointers, captured variables, embedded fields under capture) | *WASM captured struct assignment*, *WASM struct literal with a value-struct field*, *WASM struct assignment (embedded, captured)* | Root `wasm-value-copy`, [`value-stores-plan.md`](value-stores-plan.md) Phase 4; needs this plan's field list first |
| **Excluded: deferred** | Implicit struct-copy rewrite for structs with embedded fields (`src/typechecker/assignability.js:1170`) | `type A struct{ E }; var s []struct{ E }; s = append(s, A{E{5}})` | Checker-layer guard (`_markStructCopy`) outside the `wasm`-only scope of this plan; explicit `struct{ E }(a)` works via W1.7 and the guard can be lifted in a checker follow-up once Phase 1 lands |
| **Excluded: deferred** | Checker `instanceKey` (`src/typechecker/resolve.js:126`) | `js`/`both` already give distinct instances for L5 (re-probe) | The checker key is correct for its use; this plan only unifies the `wasm` keys. Sharing one key across checker and backend would cross the `typechecker` → `backend` layer rule for no fixed defect |
| **Excluded: runtime / platform** | Channels in anonymous struct element types | `make(chan struct{ A [2]int }, 1)` | Channels are not supported in GoFront (parse error on every target) |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6`, 2026-11-17 (re-probed in review at `002e5180`, 2026-11-19). A throwaway driver (`.probes/`, deleted) ran each program with `go run` (go1.26.10, module mode) and `runProgram` (`test/unit/helpers.js:522`) on `js`/`both`/`wasm`. Unless stated, `js` and `both` print Go's output and only `wasm` is wrong. *sibling* rows were found by probing the root's other paths.

### W1 `wasm-struct-field-list`

Root: six copies of the same loop turn a struct type into a field list — `toWasmType` (`src/backend/wasm/types.js:307`), `goTypeKey` (`types.js:430`), `isUnhashableGoType` (`types.js:936`), `_resolveStructInfo` (`src/backend/wasm/emit.js:1129`, `rawFields` at `:1163`), `classifyAnonStruct` (`src/backend/wasm/boundary.js:251`), and the `resolvedStruct?.fields` branch of `module-emitter.js:238` — with the first five reading `t.fields` (which includes promoted fields of embedded structs) and dropping `f.embedded`, while `module-emitter.js:246` splits an embedded generic instance's name on `.` without stripping `$` (`Inner$int` instead of `Inner`). `getAnonStructType` (`src/backend/wasm/module-emitter.js:290`) sets `embeds: []`, and `_resolveFieldPath` (`emit.js:1190`) checks `ft?.kind === "PointerType"` but not checker type `ft?.kind === "pointer"`. Map keys use another path, `_resolveStructType` (`src/backend/wasm/emit-maps.js:22`), which resolves only named structs. A layout built by one path does not match the `struct.new`, `struct.get`, hashability check, or boundary return built by another.

| ID | Program | Go | `wasm` |
|---|---|---|---|
| W1.1 (F17) | `type P struct{ N int }; v := struct{ P; M int }{P: P{5}, M: 6}; fmt.Println(v.N, v.P.N, v.M)` | `5 5 6` | `0 5 6` |
| W1.2 *sibling* | same, positional `{P{5}, 6}` | `5 5 6` | `6 5 0` |
| W1.3 (F25) | `y := struct{ P; M *P }{P{1}, &P{2}}; y.N = 5; fmt.Println(y.N, y.M.N)` | `5 2` | ICE (`struct.new[1] expected …`) |
| W1.4 *sibling* | `xs := []struct{ P; M int }{{P{1}, 2}}; fmt.Println(xs[0].N, xs[0].M)` | `1 2` | `2 0` |
| W1.5 (F28) | `m := map[struct{ X int; S string; A [2]int }]int{a: 10}; m[a]` | `10` | `0` |
| W1.6 (ledger *WASM map keys*) | `m := map[struct{ X int }]int{}; m[u] = 10; m[u]` | `10` | `0` |
| W1.7 (ledger *WASM struct conversion*) | `type A struct{ E }; u := struct{ E }(a); b := A(u)` | `11 11` | ICE (invalid wasm) |
| W1.8 (ledger *append named into anonymous*) | `var s []struct{ X int }; s = append(s, A{5})` (`type A struct{ X int }`) | `1 5` | passes at `002e5180` via `_markStructCopy` (kept as regression test) |
| W1.9 *sibling (review)* | `type P struct{ N int }; v := struct{ *P }{&P{5}}; fmt.Println(v.N)` | `5` | `0` |
| W1.10 *sibling (review)* | `//gofront:target wasm` `type P struct{ N int }; func Make() struct{ P; M int } { return struct{ P; M int }{P: P{5}, M: 6} }` | compiles | ICE (`type error in return[0] (expected (ref null 19), got (ref 24))`) |
| W1.11 *sibling (review)* | `type P struct{ S []int }; p := &P{[]int{1}}; k := struct{ *P }{p}; m := map[any]int{k: 7}; fmt.Println(m[k])` | `7` | `runtime error: hash of unhashable type interface {}` |
| W1.12 *sibling (review)* | `type Inner[A any] struct{ Y A }; v := struct{ Inner[int]; X int }{Inner: Inner[int]{Y: 11}, X: 22}; fmt.Println(v.Y, v.X, v.Inner.Y)` (and `type S[A any] struct{ Inner[A]; X A }; type W[B any] S[B]` with `W[int]`) | `11 22 11` | `0 22 11` (and ICE `Unknown field 'Inner' on struct 'W$int'`) |
| control | `var u struct{ X int } = A{5}`; `struct{ A_int int }` next to `struct{ A int }` | `5`; `1 2` | correct |

### W2 `wasm-type-key`

Root: `wasm` has two type-key functions with different coverage — `rawTypeKey` (`src/backend/wasm/monomorph.js:43`, handles `func`/`FuncType` and `GenericTypeName` but has no `struct`/`StructType` or `interface` case, so anonymous struct and interface type arguments fall to `$val`) and `goTypeKey` (`src/backend/wasm/types.js:377`, handles `func`/`FuncType` and `struct`/`StructType` via `t.fields` without `embedded` or reversible identifier-safe escaping, and has no `GenericTypeName` or `interface` case) — while `getAnonStructType` builds its name with `[^a-zA-Z0-9_]` → `_`, so distinct keys can collide. In addition, `typeToTypeNode` (`src/backend/wasm/monomorph.js:99`) has no `struct`/`StructType` or `interface`/`InterfaceType` case and falls through to `{ kind: "TypeName", name: "any" }`, erasing anonymous struct and interface type arguments in monomorphised declarations and `func` signatures, and `goTypeName` (`src/backend/shared/fmt-types.js:39`, called by `nameInstances` at `monomorph.js:896`) has no `struct`/`StructType` case and formats anonymous struct type arguments in `%T` as `interface {}`.

| ID | Program | Go | `wasm` |
|---|---|---|---|
| W2.1 (F31) | `func id[T any](v T) T; st := struct{ A [2]int }{}; a := id(st); a.A[0] = 1; fmt.Println(st.A[0], a.A[0])` | `0 1` | ICE `Cannot resolve struct for selector: A` |
| W2.2 (F24) | `id[struct{ N int }](struct{ N int }{4}).N` | `4` | same ICE (`N`) |
| W2.3 *sibling* | `id(struct{ X int }{1})` and `id(struct{ S string }{"s"})` in one program | `1 s` | same ICE (`X`) |
| W2.4 (L5) | `Box[func(struct{ X int }) int]` and `Box[func(struct{ S string }) string]` in one program | `1 hi` + `main.Box[func(struct { X int }) int]` / `main.Box[func(struct { S string }) string]` | ICE `Cannot assign func(struct{...}) int to func(any) int` (js/both correct since checker-strictness) |
| W2.5 (L11) | `type S struct{ X int }; func f[S any](v S) *S { return new(S) }; f[struct{ X int }](struct{ X int }{}).X` | `0` | ICE (`X`); non-anon shadowing (`f[int]`, `var x S`, `Box[S]`, `[]S`, `S(v)`, `.(S)`, `case S:`) passes as controls |
| W2.6 *sibling (review)* | `func id[T any](v T) T { return v }; x := id[interface{ M() int }](A{}); y := id[interface{ K() int }](B{}); fmt.Println(x.M(), y.K())` | `1 2` | ICE `Cannot resolve struct for selector: M` |

### W3 `wasm-rewrite-types`

Root: `wasm`-only AST rewrites build new nodes without the static type the emitter needs. `cloneAst` (`src/backend/wasm/monomorph.js:221`) drops `_structFields` and turns `Map` instances (`fields` on checker struct types inside `_typeArgs`) into `{}`; `substituteInType` (`:179`) already handles `func` but has no `struct` case; `substituteTypesInAst` (`:371`, `CallExpr` branch) rewrites `T(x)` (`Ident`) into `TypeConversion` but does not rewrite parenthesised pointer conversions `(*T)(x)` / `(**T)(x)` (`UnaryExpr` `*` over `Ident`); `rewriteMethods` (`src/backend/wasm/method-expr.js:345`) passes an untyped `nil` receiver through without a type.

| ID | Program | Go | `wasm` |
|---|---|---|---|
| W3.1 (F31 notes) | `func outer[T any](x T) T { return inner(struct{ A T }{A: x}).A }; outer(3)` | `3` | ICE (`A`) |
| W3.2 (F8) | `func f[T comparable](x T) int { p := (*T)(nil); if p == nil { return 0 }; return 1 }; f(3)` | `0` | ICE `Undefined: 'T'` |
| W3.4 (L13) | `type U struct{ X int }; func (u *U) IsNil() bool { return u == nil }; (*U).IsNil(nil)` (also `type undefined` and generic `(*Box[int]).IsNil(nil)`) | `true` | ICE `Cannot resolve struct for selector: IsNil` |

---

## Approach

### 1. Architecture & Design Decisions
- **One field list (W1).** `structFieldList(t, checker)` in `src/backend/wasm/types.js` returns the declared fields of a struct type (from `t._structFields`, falling back to `Array.isArray(t.fields)` for AST `StructType` nodes and `boundary.js:185` normalized `{ kind: "struct", fields: [...] }` nodes, and only to `t.fields` Map entries when neither array is present), each `{ name, goType, embedded, typeName }`, never promoted entries. For an embedded field whose type is a monomorphised generic instance (`Inner$int`), `name` is the Go field name (`f.embeddedName ?? baseName.split("$")[0].split(".").pop()`) and `typeName` is the specialised struct name (`Inner$int`). `toWasmType`, `goTypeKey`, `isUnhashableGoType`, `_resolveStructInfo`, `module-emitter.js` (`resolvedStruct` and `getAnonStructType`), and `classifyAnonStruct` (`boundary.js`) call it; `getAnonStructType` fills `embeds` from `embedded` fields so promoted selectors, literals, conversions, hashability, and boundary exports use one layout. `_resolveFieldPath` (`emit.js`) handles both `PointerType` and checker `pointer` on embedded fields. `_resolveStructType` in `emit-maps.js` falls back to `structFieldList` / `getAnonStructType` for anonymous structs.
- **One type key & concrete struct/interface AST nodes (W2).** `goTypeKey` becomes the only `wasm` key: it uses `structFieldList` (with an identifier-safe embedded prefix such as `_e`, tags excluded), keeps `func` (params, results, variadic), adds `GenericTypeName` and `interface`/`InterfaceType` cases, and escapes names reversibly (`_` → `__`, separators as identifier-safe tokens `_s`/`_c`) so distinct keys never collide and every key is a valid JS/wasm identifier. `monomorph.js` `typeKey` calls it; `rawTypeKey` is deleted. `typeToTypeNode` (`monomorph.js`) gains `struct`/`StructType` and `interface`/`InterfaceType` support so monomorphised declarations keep concrete struct and interface types instead of `any`, and `goTypeName` (`src/backend/shared/fmt-types.js`) gains `struct`/`StructType` so `nameInstances` records Go's `struct { ... }` `%T` spelling on `wasm`.
- **Rewrites keep types (W3).** `cloneAst` copies `_structFields` and clones `Map` entries instead of turning `Map` into `{}`; `substituteInType` handles `struct` (`fields` Map and `_structFields`); `substituteTypesInAst`'s `CallExpr` branch rewrites parenthesised pointer conversions `(*T)(x)` / `(**T)(x)` (`UnaryExpr` `*` over a type-param `Ident`) into `TypeConversion`. `rewriteMethods` converts an untyped `nil` receiver to the method expression's receiver type.

### 2. Invariants & Safety Bounds
- Named struct types keep their current WasmGC types and names; programs without anonymous structs emit byte-identical modules.
- Two anonymous struct types share one WasmGC type exactly when Go considers them identical (ignoring tags); one generic instance per identical type argument.
- `wasm` modules pass `WebAssembly.validate` (the harness gate) for every test.

### 3. Edge Cases & Error Handling
- An alias of an anonymous struct (`type S = struct{ A [2]int }`) shares the struct's instance and layout.
- Embedded pointer fields (`struct{ *P }`) are stored as a reference field; promoted selectors dereference through it, and `isUnhashableGoType` checks `*P` (a pointer, comparable) rather than promoted fields of `P`.
- Field names containing `_` (`A_int`) next to `A int` stay distinct (control row).
- A struct key with array fields hashes and compares arrays recursively (`emitKeyHash`/`emitKeyEq` already do); only the struct info lookup changes.

---

## Implementation Tasks

> Split from the former `followup-fixes-plan.md` (re-probed 2026-11-17; reviewed and re-probed 2026-11-19 at `002e5180`) and three `plans/follow-ups.md` entries with the same root.

### Phase 1: One struct field list on `wasm` (root `wasm-struct-field-list`)
- [ ] Task 1.1: `structFieldList` and the core layout paths (W1.1–W1.4, W1.9, W1.11, W1.12)
  - Files: `src/backend/wasm/types.js` (`structFieldList`, `toWasmType`, `goTypeKey`, `isUnhashableGoType`), `src/backend/wasm/emit.js` (`_resolveStructInfo`, `_resolveFieldPath` for checker `pointer`), `src/backend/wasm/module-emitter.js` (`getAnonStructType` `embeds` and `resolvedStruct` layout)
  - Test: `test/unit/wasm/structs.test.js`: W1.1 and W1.2 → `5 5 6`, W1.3 → `5 2`, W1.4 → `1 2`, W1.9 (`struct{ *P }`) → `5`, W1.11 (`map[any]int` with `struct{ *P }` where `P` has `[]int`) → `7`, W1.12 (`struct{ Inner[int]; X int }` and `W[int]`) → `11 22 11` with `assertAllTargetsOutput`
  - Done when: all pass; `rawFields` removed from `types.js` and `emit.js`
- [ ] Task 1.2: Boundary classification and struct conversions (W1.7, W1.8, W1.10)
  - Files: `src/backend/wasm/boundary.js` (`classifyAnonStruct` uses `structFieldList`)
  - Test: `test/unit/wasm/boundary.test.js`: W1.10 (`func Make() struct{ P; M int }`) compiles with valid wasm; `test/unit/wasm/structs.test.js`: W1.7 → `11 11`, W1.8 → `1 5` (regression); switch `test/unit/language/value-semantics.test.js` lines 1047–1070 (`conversion to an embedding anonymous struct drops the source type`) to `assertAllTargetsOutput`
  - Done when: all pass with valid modules; `grep -rn "rawFields" src/backend/wasm` finds no matches
- [ ] Task 1.3: Anonymous struct map keys (W1.5, W1.6)
  - Files: `src/backend/wasm/emit-maps.js` (`_resolveStructType` fallback to `structFieldList` / `getAnonStructType`)
  - Test: `test/unit/wasm/map-keys.test.js`: W1.5, W1.6 → `10` (and a key differing only in `A[1]` misses; an anonymous struct with an embedded field as a map key hits)
  - Done when: all pass with valid modules

### Phase 2: One `wasm` type key and anonymous-struct `typeToTypeNode` (root `wasm-type-key`)
- [ ] Task 2.1: `goTypeKey` covers `struct`, `func`, `interface`, and `GenericTypeName` with reversible identifier-safe escaping
  - Files: `src/backend/wasm/types.js` (`goTypeKey`), `src/backend/wasm/module-emitter.js` (anonymous struct names from the key)
  - Test: `test/unit/wasm/structs.test.js`: key unit test (`struct{ A_int int }` vs `struct{ A int }`, `struct{ P }` vs `struct{ P P }`, func types differing only in a param, interface types) gives distinct identifier-safe keys; identical types written twice give one key
  - Done when: passes; existing wasm suite green
- [ ] Task 2.2: Monomorph uses `goTypeKey`, `typeToTypeNode` supports anonymous structs and interfaces, and `goTypeName` formats anonymous structs (W2.1–W2.6)
  - Files: `src/backend/wasm/monomorph.js` (`typeKey` → `goTypeKey`, delete `rawTypeKey`, `typeToTypeNode` handles `struct`/`StructType` and `interface`/`InterfaceType`), `src/backend/shared/fmt-types.js` (`goTypeName` handles `struct`/`StructType`)
  - Test: `test/unit/wasm/generics.test.js`: W2.1 → `0 1`, W2.2 → `4`, W2.3 → `1 s`, W2.4 → `1 hi` and `main.Box[func(struct { X int }) int]` / `main.Box[func(struct { S string }) string]`, W2.5 (`f[struct{ X int }]`) → `0`, W2.6 (`id[interface{ M() int }]` and `id[interface{ K() int }]`) → `1 2`, with `assertAllTargetsOutput`; switch `test/unit/language/value-semantics.test.js` (lines 856–917, 1003–1045) and `test/unit/types/generics.test.js` (lines 2388–2500) to `assertAllTargetsOutput`
  - Done when: all pass on every target; `rawTypeKey` deleted

### Phase 3: `wasm` rewrites keep static types (root `wasm-rewrite-types`)
- [ ] Task 3.1: `cloneAst`, `substituteInType`, and `substituteTypesInAst` for structs and parenthesised pointer conversions (W3.1, W3.2)
  - Files: `src/backend/wasm/monomorph.js` (`cloneAst` keeps `_structFields` and clones `Map` entries; `substituteInType` adds `struct`; `substituteTypesInAst` `CallExpr` handles `UnaryExpr("*")` over type-param `Ident` such as `(*T)(nil)` / `(**T)(nil)`)
  - Test: `test/unit/wasm/generics.test.js`: W3.1 → `3`; W3.2 with type param `T` and `Proxy` → `0`; `(*T)(&x)` → `1`; `(**T)(nil)` → `0`
  - Done when: all pass on every target
- [ ] Task 3.2: Method expressions with an untyped `nil` receiver (W3.4)
  - Files: `src/backend/wasm/method-expr.js` (`rewriteMethods`)
  - Test: `test/unit/wasm/pointers.test.js`: W3.4 with `U`, `undefined`, and generic `Box[int]` → `true`; `(*U).IsNil(&U{})`, `(*U).IsNil((*U)(nil))` → `false true`; a method expression stored in a variable and called with `nil`
  - Done when: all pass; `js`/`both` print the same
