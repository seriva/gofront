# v1.9.3 Review Follow-ups (2026-11-16) — Design Plan

**Version:** v1.9.3  
**Status:** In Progress  
**Base branch:** main  
**Related:** [`js-codegen-fixes-plan.md`](js-codegen-fixes-plan.md) is where most ledger entries came from (PRs #203–#207). The `wasm` parity gaps, the `wasm` package-boundary errors and the type names after JS built-ins (F2, F5, F8, F17, F19–F22, F24, F25, F28–F31, including that plan's deferred Tasks 5.2 and 5.4) moved to [`../v2.0.0/follow-ups-2026-11-16-wasm-plan.md`](../v2.0.0/follow-ups-2026-11-16-wasm-plan.md). [`../v2.0.0/checker-strictness-plan.md`](../v2.0.0/checker-strictness-plan.md) owns rejecting invalid Go that compiles today. Its own Excluded row hands "generic instances over anonymous structs" to this ledger (F23).  
**Release note:** More valid Go now runs correctly. Types named `yield` or `arguments` work, multiple and compound assignments run their side effects in Go's order, copies of anonymous structs no longer share arrays, and conversions to anonymous struct types and generic code over different anonymous structs compile. An import of an npm package without type declarations compiles and is treated as an untyped value.  

---

## Goal

Fix the 16 review follow-ups (F1, F3, F4, F6, F7, F9–F16, F18, F23, F26) that still reproduce in `plans/follow-ups.md` (re-probed 2026-11-16 against `feat/js-codegen-fixes` at `5e83fc3f`). They are valid Go programs that are miscompiled, crash at run time, or fail to compile or parse on the JavaScript targets or on every target. The other 14 follow-ups from that ledger moved to the v2.0.0 plan named under **Related** so they can land on the hardened test harness (`WebAssembly.validate`, line:col diagnostics) and under v2.0.0's no-backward-compatibility rule. The release theme is unchanged: a program that compiles and runs today is not rejected, and this plan adds no new compile errors.

**Done means:**
- Every repro F1, F3, F4, F6, F7, F9–F16, F18, F23 and F26 in *Verified Gaps* (except the `Excluded` parts) prints Go 1.26.0's output on every target its test names. Each is a test in the file named by its task.
- `npm test` passes, and `test/perf/zero-alloc.js`, `bce-mathx.js` and `bundle-size.js` pass with `bundle-size.baseline.json` unchanged.
- `test/unit/compiler/js-globals.test.js` (the rename-set registry test) passes unmodified, apart from new names added to `JS_RESERVED` handling.
- `docs/usage.md` (untyped npm imports) describes the new behaviour.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Valid Go that compiles and misbehaves, or fails to compile/parse, on the JavaScript targets or every target | F1, F3, F4, F6, F7, F9–F16, F18, F23, F26 | |
| **Excluded: deferred** | `wasm` parity gaps, `wasm`-only boundary errors (unexported and `__` members of `wasm` packages) and package-level type names after JS built-ins | F2, F5, F8, F17, F19–F22, F24, F25, F28–F31 | Moved to v2.0.0 on 2026-11-16: they land on the hardened test harness, F5/F29 and F2/F30 can follow v2.0.0's no-backward-compatibility rule instead of v1.9.3-only asymmetries, and the `src/compiler.js` edits of F1 and F2/F30 should not be made twice; `../v2.0.0/follow-ups-2026-11-16-wasm-plan.md` |
| **Excluded: deferred** | The "reslice-synced target" assignment-order form from the F11 ledger entry | The entry gave no repro for it. The `for`-post and generic `*p` forms are scheduled (Task 4.3) | No repro to write a test from. Re-record it in `plans/follow-ups.md` if Task 4.3's review finds one |

---

## Verified Gaps & Baseline Audit

### Review follow-ups (2026-11-16)

**Method.** Probes ran on 2026-11-16 against `feat/js-codegen-fixes` at `5e83fc3f` (PR #207 merged). They used the throwaway driver `.probes/fu-2026-11-16/run.mjs`, which is `.probes/review-2026-11-13/run2.mjs` extended with per-case `t=<targets>`, `hybrid` (`compileDir` without `forceTarget`, js main plus a `wasm`/`both`/`js` `util/` package) and a Go 1.26.0 oracle. Each case went through `compileFiles` with `forceTarget` `js`/`both`/`wasm` and ran in a child `node`. Expected outputs come from `go run` in **module mode** (`go.mod` `go 1.26`, which F21 needs for `panicnil=0`). `.probes/fu-2026-11-16/` is deleted. Each row therefore carries its repro.

The rows for F2, F5, F8, F17, F19–F22, F24, F25 and F28–F31 moved with their tasks to the v2.0.0 plan named under **Related**.

| ID | Area | Finding | Evidence & probe |
|---|---|---|---|
| F1 | Untyped npm import | An import with no resolvable `.d.ts` warns "treating as any", but the name is never bound. `resolveAll` stores `null` (`src/resolver.js:121-126`) and `resolveImports` skips `null` entries (`src/compiler.js:269-273`). Typed imports add their values as globals, and `prep`/`build` vendoring exposes a package under its name as a browser global (`docs/usage.md:77`) | `import "nope/zzz"; func main() { zzz.F() }` → `warning: cannot find types for 'nope/zzz', treating as any` then `Type error … 5:15: Undefined: 'zzz'`, want it to compile with `zzz` typed `any` (PR #203 design review, standalone). `import _ "nope/zzz"` test: `test/unit/compiler/stdlib-go.test.js:694` |
| F3 | Local named after its own type | `var T T = 4; T.Dbl()` emits `T.$Dbl(T)`: the static method call names the class `T`, which the local `let T` shadows (`genNamedTypeClass` static methods) | → js/both `TypeError: T.$Dbl is not a function`, want `8`. `wasm` is right (feat/js-codegen-fixes-phase-1) |
| F4 | Local type vs package-level value | A function-local `type A = int` takes over the package-level `var A`. `renameLocalTypes` (`src/link/type-names.js:45`) renames a local type only for duplicate local types, `reserved` names, or a later value *in the same function*. Package-level values are not considered | `var __A = "hi"; func other() int { type __A = int; var x __A = 3; return x }; …var s string = __A` → all targets `Cannot assign int to string`, want `5`. **Not only `__`:** the same with `A` fails the same way (`e04b`) (PR #203) |
| F6 | Type names that are strict-mode words | Class declarations emit the raw Go name (`class ${name}`, `src/backend/js/index.js:776`, `:795`, `:1020`), while references already go through `jsSafeName` (`undefined` → `undefined$`, `src/backend/js/names.js:49`) | `type yield struct{ X int }` → js/both `SyntaxError: Unexpected strict mode reserved word`, want `7`; `type arguments struct{X int}` → `Unexpected eval or arguments in strict mode`, want `3`; `type undefined struct{X int}; var a any = undefined{1}; _, ok := a.(undefined)` → `ReferenceError: undefined$ is not defined`, want `true`. `wasm` is right (PR #203) |
| F7 | Type parameter named like a package struct | The `new` builtin (`src/backend/js/expressions.js:465`) checks `s.structNames.has(arg.name)` before looking at the argument's type, so a type parameter `S` builds the package struct `S` | `type S struct{ X int }; func f[S any](v S) *S { return new(S) }; fmt.Println(*f[int](3))` → js/both `-9223372036854775808` (emitted `return new S();`), want `0`. Same with `__S`. `wasm` is right (PR #203) |
| F9 | Blank targets in multi-assignment (JS) | `_genMultiAssignWithBlanks` (`src/backend/js/statements.js:1130`) re-emits a right-hand side, and the all-blank form drops the trailing expressions | Local trace closure `t(s, v)`: `_, arr[t("i",0)] = t("x",5), t("y",6)` → js/both `ixyy [6 0]`, want `ixy [6 0]`; `_, _ = t("x",5), t("y",6)` → `x`, want `xy`. `wasm` is right (PR #204) |
| F10 | Comma-ok forms and assignment order | The comma-ok paths do not hoist target operands: JS `_genCommaOkTypeAssert` (`statements.js:995`) and `_genCommaOkMapIndex` (`:269`), `wasm` `_emitCommaOkTypeAssert` (`src/backend/wasm/emit-stmts.js:1253`) and `_emitCommaOkMapIndex` | `arr[t("i",0)], ok = fv().(int)` → every target `fi`, want `if`; `arr[t("i",1)], ok = m[ks("k")]` → `ki`, want `ik` (PR #204) |
| F11 | Assignment order in rarer JS forms | `_hoistLhsOperands` (`statements.js:942`) is not applied to a multi-assignment in a `for` post statement, nor to a generic `*p` target | `for k := 0; k < 1; k, arr[t("i",0)] = t("x",1), t("y",6) {}` → js/both `xyi`, want `ixy`; in `func run[T any]`: `*pn("p", p), arr[ti("i",0)] = t("x",v1), t("y",v2)` → `xypi`, want `pixy`. `wasm` is right (PR #204) |
| F12 | Compound assignment reads the target before a right-hand call | Go evaluates `x op= f()` as `x = x op f()` with the call first when it mutates `x` (oracle). JS emits `x += f()` and strict `_genStrictCompound` reads `x` first; `wasm` `_emitCompoundAssign` (`emit-stmts.js:1721`) loads the target first | `var x int32 = 100; next := func() int32 { x = 200; return 2 }`, each line from `x = 100`: `+=`, `/=`, `%= next()+1`, `<<=`, `>>=`, then `int` `+=` → Go `202 100 2 800 50 202`; js `102 100 1 400 25 102`; both `102 100 2 800 50 102`; wasm `102 50 1 400 25 102` (PR #204) |
| F13 | `*p` target in a JS multi-assignment | A `*p` target whose operand needs a nil check is emitted as a destructuring target `__nilcall(h)`, which is invalid JS | `*ps("p", s), arr[t("i",0)] = S{5}, t("y",6)` → js/both `SyntaxError: Invalid destructuring assignment target` (`[__nilcall(__h1), __h2[__h3]] = [new S(5), t("y", 6)]`), want `piy 5 6`. `wasm` is right (PR #204) |
| F14 | Alias of an anonymous struct | `type T = struct{ A [2]int }` emits an empty `class T {}` and `var s T` emits `new T()` (`_genTypeDeclBody`, `index.js:747`), so the value has no fields. `wasm` builds a null zero value. Ledger entries 21 and 31 are the same root cause | `var s T; s.A[0] = 1; fmt.Println(s.A[0])` → js/both `Cannot set properties of undefined (setting '0')`, wasm `RuntimeError: dereferencing a null pointer`, want `1`; `var s S; fmt.Println(s.A[0])` → `Cannot read properties of undefined`, want `0` (feat/js-codegen-fixes-phase-3, -phase-5) |
| F15 | Shallow anonymous struct copies (JS) | `_cloneJs` (`src/backend/js/expressions.js`) clones by field only for array and struct field types it recognises. It misses embedded fields, defined array types (`type Vec [2]int`) and type-parameter arrays. Type-switch bindings and range-over-func yielded values are not copied at all | `st := struct{ P; B [2]int }{}; cp := st; cp.P.A[0] = 7` → js/both `7 7`, want `0 7`; `func f(s struct{ V Vec }) { s.V[0] = 9 }` → `9`, want `0`; `switch v := a.(type) { case struct{ A [2]int }: v.A[0] = 5 }` then `a.(…).A[0]` → `5 5`, want `5 0`; range-over-func `v.A[0] = 4` changes the iterator's `s` → `4`, want `0`. `wasm` is right (PR #205) |
| F16 | Generic copy of a map or `[N]byte` (JS) | `__vclone` (`HELPER_VCLONE`, `src/backend/js/runtime.js:310-340`) already copies typed arrays (`ArrayBuffer.isView`), but its top-level check (`!isObj(zero)`) misses Go map zeros (`__nm()` / `__nilmap`, checked via `isShape` only on nested fields), so a top-level map argument falls through to `Object.assign` and is cloned | `dup[T any](v T) (T, T)` over `map[string]int{"a":1}`, `x["a"] = 9` → js/both `1 9 1`, want `9 9 9`; `dup([4]byte{1,2,3,4})` → `len` `4` (regression check) (PR #205) |
| F18 | Conversion to an anonymous struct type | `_parsePrimary` parses `struct{…}` only as a composite literal (`src/parser/expressions.js:560-563`), unlike the slice/array/map conversion path just above it (`:549-558`); on `js`/`both`, `_genTypeConversion` (`src/backend/js/expressions.js:3680`) and `_genTypeConversionCall` (`:2068`) also return the source struct instance uncloned instead of calling `_cloneAnonStruct` | `type S struct{ A [2]int }; var a any = struct{ A [2]int }(s)` → every target `Parse error at 9:32: expected '{' (got ( "(")`, want `{[1 2]}` (PR #205) |
| F23 | Generic struct over different anonymous structs | `instanceKey` (`src/typechecker/resolve.js:108`) falls back to `typeStr` (including for `named` types with `typeArgs`), which prints every anonymous struct as `struct{...}`, so `Box[struct{X int}]` and `Box[struct{S string}]` share one instance | `a := Box[struct{ X int }]{}; b := Box[struct{ S string }]{}; fmt.Println(a.V.X, b.V.S)` → every target `Type error: No field 'S' on struct{...}`, want `0 ` (feat/js-codegen-fixes-phase-5) |
| F26 | Typed nil `*V` calling a `__` method (JS) | `__mknil` (`src/backend/js/runtime.js:404`) skips every prototype key starting with `__` (including user methods suffixed as `__ref$`) and checks `vm.includes(k)` against unsuffixed names in `C.__vm` | `type I interface{ __ref() int }; var vp *V = nil; var i I = vp; i.__ref()` under `recover` → js/both `-9223372036854775808`, want `runtime error: invalid memory address or nil pointer dereference`. `wasm` is right (PR #207) |
| F27 | `wasm` facade member `__ref` | **No longer reproduces.** A `wasm` struct `S{ __ref, N int }` read as `s.__ref` from a js main prints `7`, and `__clone` does too (probe `h-wasm-dunder-clone-field` → `7 5 1`). Go would reject that read as unexported; see the Excluded rows of the v2.0.0 plan. Deleted from the ledger | (PR #207) |

---

## Approach

### 1. Architecture & Design Decisions
- **F1 (decision): bind as a dynamic global, do not reject.** The warning says "treating as any", and vendoring exposes packages as globals by name. So `resolveImports` (and the `compile` test helper in `test/unit/helpers.js`) binds the import's local name (the alias, else the last path element with non-identifier characters replaced as in `docs/usage.md:79`) to a JS-dynamic `any` value. It uses the checker's existing path for browser globals (`BROWSER_GLOBALS`-style untyped value, permissive member access), and the JS backend emits the bare name. On `wasm`/`both`, `Ident` (`src/typechecker/expressions.js:277`) reports it via `_errJsOnly` when referenced (while removing the blanket non-builtin `js: imports are not allowed` rejection in `resolveImports` for untyped npm imports so the error names the identifier). Rejected: turning the warning into an error, because `import z "nope/zzz"` compiles today (test-harness plan G2b relies on it).
- **F3:** the renamer treats a local whose name equals a package-level type that emits a class (struct, or `_isPlainNamedBox`/methods) like a shadowed global. It is suffixed `$`, so `T.$Dbl` keeps naming the class. This uses the same `_shadowsGlobal` mark and `jsBindingName` path as C2.
- **F6:** class-declaring and class-referencing sites (`genStruct`, `genNamedTypeClass`, the `$Ptr` class, `Object.defineProperty(${name}…)`, `_hoistLocalClass` in `src/backend/js/index.js`, and `new`, `instanceof`, `_typeNameCheckExpr`, `_namedBoxInfo`, `_zeroForNamedType`, `_genStructClone` in `src/backend/js/expressions.js`) apply `JS_RESERVED` `$`-escaping consistently while keeping `structNames`/`structFields` lookups on the unmangled type name.
- **F7:** `new` checks the argument's checker type first. A `typeParam` gets its zero from the instance's `$z_<T>` parameter (as `var x T` does), and only a non-type-parameter `TypeName` reaches `structNames`.
- **F9–F13 (assignment order):** this extends the C6 rule from `js-codegen-fixes`. When an assignment has a call anywhere, target operands are evaluated in source order, then each right-hand side once, then the stores. Blank targets still evaluate their right side. Comma-ok forms (`v, ok = x.(T)`, `v, ok = m[k]`) hoist target operands before the right side on both backends. A `*p` target whose base needs a nil check (or is a struct pointer on JS, which is the struct instance itself rather than a `{ value }` box) evaluates the right-hand sides into temporaries and writes into the nil-checked target (`Object.assign` for structs) rather than using `*p` as a destructuring target. Without calls, the output stays byte-identical.
- **F12:** when the right-hand side of `op=` contains a call, the value is bound first (`const r = rhs; x = x op r`) on every target and in both the strict and non-strict JS paths. Go's oracle shows the target is read *after* the call (`202`). Without a call the output is unchanged.
- **F14:** an alias whose right side is an anonymous struct is excluded from `structNames` (`_collectStructNames` checks `!d.isAlias`) and emits no class in `_genTypeDeclBody`. Zero values and composite literals of the alias use the anonymous-struct path (`_genAnonStructLit`/zero object), and `wasm` resolves the alias to its anonymous struct type before building the zero value.
- **F15/F16:** `_cloneJs` resolves a field's underlying type (defined arrays, embedded structs, type-parameter arrays via `__vclone`) before deciding to copy it. Type-switch bindings and range-over-func yielded values of value type go through `_cloneJs`. In `HELPER_VCLONE`, the top-level guard checks `!isShape(zero)` (instead of `!isObj(zero)`) so top-level Go maps (`__nm()` / `__nilmap` zero) are returned as-is while typed arrays continue to copy with `.slice()`.

### 2. Invariants & Safety Bounds
- A program that compiles and runs correctly on the current branch prints the same output, except for the `$` names visible from hand-written JS (documented). This plan adds no new compile errors.
- Emitted JS for programs without the affected names, calls in assignment operands, or affected anonymous-struct shapes is byte-identical. The bundle-size, zero-alloc and BCE gates are unchanged.
- `JS_BUILTIN_CLASSES` does not grow, and no type declaration that compiles today is rejected.

### 3. Edge Cases & Error Handling
- **F1:** an alias import (`import z "nope/zzz"`) binds `z`. A blank import binds nothing and still warns only when used by name (today it does not warn; unchanged). A path whose last element is not an identifier (`"nope/zz-z"`) uses the sanitised name.
- **F3:** a parameter or named result named after a type, and a type-switch binding `T := x.(type)`.
- **F6:** `%T` and `fmt` still print `main.yield`. A local type named `yield` takes the `__L` rename, so no `$` is needed there.
- **F12:** compound assignment to a map element (`m[k] += f()`) and to a field through a pointer keep evaluating the target operands before the call (C6 order). Only the *read* of the target moves after the call.
- **F14:** an alias of an alias (`type U = T`), and a generic struct field of the alias type.

---

## Implementation Tasks

> Scheduled from review follow-ups (`plans/follow-ups.md`, re-probed 2026-11-16).

### Phase 1: Parser and checker (F4, F18, F23)
- [ ] Task 1.1: Parse and clone conversions to an anonymous struct type (F18)
  - Files: `src/parser/expressions.js` (the `T.STRUCT` branch of `_parsePrimary`: `(` after the struct type → `TypeConversion`), `src/backend/js/expressions.js` (`_genTypeConversion` and `_genTypeConversionCall` clone into an anonymous plain object via `_cloneAnonStruct`)
  - Test: `test/unit/language/value-semantics.test.js` with `assertAllTargetsOutput`: `type S struct{ A [2]int }; s := S{[2]int{1, 2}}; u := struct{ A [2]int }(s); s.A[0] = 9; var a any = u; fmt.Printf("%T %v\n", a, u)` → `struct { A [2]int } {[1 2]}`; `test/unit/compiler/lexer-parser.test.js`: the AST is a `TypeConversion` with a `StructType` target
  - Done when: both pass on every target; `struct{…}{…}` literals still parse
- [ ] Task 1.2: Local types do not take over package-level values (F4)
  - Files: `src/compiler.js` (`mangleLocalTypes` adds package-level var/const/func names to the `reserved` set), `src/link/type-names.js` (`renameLocalTypes` doc comment)
  - Test: `test/unit/compiler/local-type-shadow.test.js` with `assertAllTargetsOutput`: the F4 repro (`__A`) and the plain `A` variant → `5`; a local type named after a package-level func
  - Done when: all print `5` on every target; programs without such a clash emit the same JS
- [ ] Task 1.3: Distinct generic instances for distinct anonymous struct type arguments (F23)
  - Files: `src/typechecker/resolve.js` (`instanceKey`: recurse with `instanceKey` on `named.typeArgs`, and add `struct` case with field names, embedded flags, tags and `instanceKey` of each field type)
  - Test: `test/unit/types/generics.test.js` with `assertJsTargetsOutput` (the v2.0.0 plan adds `wasm`): the F23 repro → `0 `, nested `Outer[Box[struct{ X int }]]` vs `Outer[Box[struct{ S string }]]`, and the same `struct{ X int }` written twice shares one instance (`a = Box[struct{ X int }]{}` assignable)
  - Done when: all pass on `js`/`both`

### Phase 2: Untyped npm imports (F1)
- [ ] Task 2.1: An untyped npm import is a dynamic `any` value (F1)
  - Files: `src/compiler.js` (`resolveImports`: bind the local name for `null` entries and defer untyped npm import rejection on `wasm`/`both` to `Ident` lookup), `src/typechecker/index.js` (helper defining a JS-dynamic global value), `src/typechecker/expressions.js` (`Ident` reports untyped npm imports via `_errJsOnly` on `wasm`/`both`), `test/unit/helpers.js` (`compile` binds `null` entries from `resolveAll`), `docs/usage.md` (*Vendoring npm packages*: an import without types is a dynamic global named after the package)
  - Test: `test/unit/compiler/stdlib-go.test.js`: `import "nope/zzz"; func main() { zzz.F() }` compiles with the warning, and the JS calls `zzz.F()`; `import z "nope/zzz"` binds `z`; on `forceTarget` `wasm` → `assertErrorContains(errors, "zzz")` with the JS-only message
  - Done when: all pass; the existing `nope/zzz` warning test is unchanged

### Phase 3: JS names of types, locals and nil methods (F3, F6, F7, F26)
- [ ] Task 3.1: Class names that are strict-mode words (F6)
  - Files: `src/backend/js/index.js` (`genStruct`, `genNamedTypeClass`, `$Ptr` class, `defineProperty` lines, `_hoistLocalClass`, `_renameIdentNode`), `src/backend/js/expressions.js` (`new`, `instanceof`, `_typeNameCheckExpr`, `_namedBoxInfo`, `_zeroForNamedType`, `_genStructClone`, and `getStructFields`/`structNames` lookups)
  - Test: `test/unit/types/shadowing.test.js` with `assertAllTargetsOutput`: `yield` → `7`, `arguments` → `3`, `undefined` assertion → `true`, plus `fmt.Printf("%T", yield{})` → `main.yield`
  - Done when: all pass on every target
- [ ] Task 3.2: A local named after a class-emitting type keeps the class reachable (F3)
  - Files: `src/typechecker/expressions.js` (mark bindings that shadow a package-level class type), `src/backend/js/index.js` (`jsBindingName` honours the mark for those locals)
  - Test: `test/unit/types/shadowing.test.js` with `assertAllTargetsOutput`: F3 → `8`; a parameter `func g(T T) int { return int(T.Dbl()) }`; a struct type `type R struct{N int}` with `var R R; R.M()`
  - Done when: all pass; locals that shadow no type emit the same JS
- [ ] Task 3.3: `new(T)` of a type parameter uses the instance's zero (F7)
  - Files: `src/backend/js/expressions.js` (`new` builtin: type-parameter check first)
  - Test: `test/unit/types/generics.test.js` with `assertAllTargetsOutput`: F7 with `S` and with `__S` → `0`; `f[struct{X int}]` and `f[S]` (the real struct) → `{0}`
  - Done when: all pass
- [ ] Task 3.4: Typed nil pointers panic on `__` methods (F26)
  - Files: `src/backend/js/runtime.js` (`__mknil` skips only runtime-owned `__` keys, not suffixed user members `__x$`, and matches `C.__vm` entries with or without the trailing `$`)
  - Test: `test/unit/language/structs.test.js` with `assertAllTargetsOutput`: F26 → `runtime error: invalid memory address or nil pointer dereference`; pointer-receiver `__` method on a typed nil still gets `nil` as receiver
  - Done when: all pass

### Phase 4: Assignment evaluation order (F9–F13)
- [ ] Task 4.1: Blank and `*p` targets in JS multi-assignment (F9, F13)
  - Files: `src/backend/js/statements.js` (`_genMultiAssignWithBlanks`; `*p` targets with a nil check or struct pointee evaluate RHS into temps and assign/copy via `Object.assign` instead of destructuring)
  - Test: `test/unit/language/codegen-regressions.test.js` with `assertAllTargetsOutput`: F9 → `ixy [6 0]` / `xy`; F13 → `piy 5 6`
  - Done when: all pass; multi-assignments without calls emit the same JS
- [ ] Task 4.2: Comma-ok forms evaluate target operands first (F10)
  - Files: `src/backend/js/statements.js` (`_genCommaOkTypeAssert`, `_genCommaOkMapIndex`), `src/backend/wasm/emit-stmts.js` (`_emitCommaOkTypeAssert`, `_emitCommaOkMapIndex`)
  - Test: `test/unit/language/codegen-regressions.test.js` with `assertAllTargetsOutput`: F10 → `if [3 0] true` / `ik [3 4] true`; comma-ok `:=` unchanged
  - Done when: all pass on every target
- [ ] Task 4.3: `for`-post and generic `*p` targets (F11)
  - Files: `src/backend/js/statements.js` (`for` post multi-assignment and generic `*p` targets through `_hoistLhsOperands`)
  - Test: `test/unit/language/codegen-regressions.test.js` with `assertAllTargetsOutput`: F11 → `ixy [6 0]` and `pixy`
  - Done when: all pass
- [ ] Task 4.4: Compound assignment reads the target after a right-hand call (F12)
  - Files: `src/backend/js/statements.js` (`_genAssignStmt`, `_inlineStrictCompound`), `src/backend/js/expressions.js` (`_genStrictCompound`), `src/backend/wasm/emit-stmts.js` (`_emitCompoundAssign`)
  - Test: `test/unit/compiler/strict-mode.test.js` with `assertAllTargetsOutput`: F12 → `202\n100\n2\n800\n50\n202`; plus `m[k] += f()` and `p.n += f()` where `f` mutates the target; the `e10`/`e11`/`e15` cases from `js-codegen-fixes` keep passing; codegen check that `x += y` (no call) emits the same JS
  - Done when: all pass on every target

### Phase 5: JS anonymous struct values (F14–F16)
- [ ] Task 5.1: Aliases of anonymous structs have fields (F14)
  - Files: `src/backend/js/index.js` (`_collectStructNames` skips `d.isAlias`; `_genTypeDeclBody` emits no class for an anonymous-struct alias), `src/backend/js/expressions.js` (zero value / literal of the alias uses the anonymous path), `src/backend/wasm/emit.js` (zero value of the alias)
  - Test: `test/unit/language/value-semantics.test.js` with `assertAllTargetsOutput`: both F14 repros → `1`, `0`; `type U = T`; copy `cp := s; cp.A[0] = 2` stays independent
  - Done when: all pass on every target
- [ ] Task 5.2: Field-wise copies for embedded, defined-array and type-parameter array fields; copy bindings (F15)
  - Files: `src/backend/js/expressions.js` (`_cloneJs` resolves the underlying field type), `src/backend/js/statements.js` (type-switch binding and range-over-func yield value copies)
  - Test: `test/unit/language/value-semantics.test.js` with `assertAllTargetsOutput`: the four F15 repros → `0 7`, `0`, `5 0`, `0`; a scalar-only anonymous struct still emits `__sclone`
  - Done when: all pass
- [ ] Task 5.3: Generic copies keep maps shared and copy typed arrays (F16)
  - Files: `src/backend/js/runtime.js` (`HELPER_VCLONE`: top-level `!isShape(zero)` check so Go map zeros `__nm` / `__nilm` return `x` uncloned)
  - Test: `test/unit/language/value-semantics.test.js` with `assertAllTargetsOutput`: F16 → `9 9 9` / `4`; `dup([2][]int{…})` still shares the slice
  - Done when: all pass
