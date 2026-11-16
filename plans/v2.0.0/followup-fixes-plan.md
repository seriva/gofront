# v2.0.0 Review Follow-ups (2026-11-16): `wasm` and Package Names — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Split off from [`../v1.9.3/follow-ups-2026-11-16-plan.md`](../v1.9.3/follow-ups-2026-11-16-plan.md), which keeps the JavaScript miscompile fixes (its Phases 1–5). Start after [`checker-strictness-plan.md`](checker-strictness-plan.md) merges and before [`web-platform-evolution-plan.md`](web-platform-evolution-plan.md) Phase 3 (`PackageCache`), which restructures `src/compiler.js`. Phase 3 here needs the v1.9.3 Task 1.3 (`instanceKey`) merged. The deferred Tasks 5.2 and 5.4 of [`../v1.9.3/js-codegen-fixes-plan.md`](../v1.9.3/js-codegen-fixes-plan.md) are scheduled here as Phases 5 and 3. Rejecting unexported or `__` names of `js`/`both` packages stays with [`checker-strictness-plan.md`](checker-strictness-plan.md) (see the Excluded rows).  
**Release note:** More valid Go runs correctly on WebAssembly. Generic code over anonymous structs and `(*T)(nil)` compile, anonymous structs with embedded fields and as map keys work, and uncaught panics match Go more closely: `panic(nil)`, large slice bounds, and the messages of `bool`, unsigned and `error` panics. Types named after JavaScript built-ins such as `Map` or `WeakMap` now work in more places. **Breaking:** `wasm` packages now reject cross-package references to unexported or `__` names, which never worked at run time; export the name or reference it from inside its package.  

---

## Goal

Fix the 14 review follow-ups (F2, F5, F8, F17, F19–F22, F24, F25, F28–F31) that were moved out of the v1.9.3 follow-ups plan on 2026-11-16. They were re-probed that day against `feat/js-codegen-fixes` at `5e83fc3f` with the evidence and method recorded in *Verified Gaps*. Most are `wasm` parity gaps; F2 and F30 are package-level type names that shadow JavaScript built-ins, and F5 and F29 are `wasm`-only cross-package references that throw at run time and now become compile errors. Moving them to v2.0.0 lets them land on the hardened test harness (`WebAssembly.validate`, line:col diagnostics) and lets F5/F29 and F2/F30 follow the v2.0.0 rule that backward compatibility is not a goal, without keeping the v1.9.3-only asymmetries.

**Done means:**
- Every repro F2, F5, F8, F17, F19–F22, F24, F25 and F28–F31 in *Verified Gaps* (except the `Excluded` parts) prints Go 1.26.0's output, or gives the stated compile error, on every target its test names. Each is a test in the file named by its task.
- `npm test` passes, and `test/perf/zero-alloc.js`, `bce-mathx.js` and `bundle-size.js` pass with `bundle-size.baseline.json` unchanged.
- `test/unit/compiler/js-globals.test.js` (the rename-set registry test) passes unmodified, apart from new names added to `JS_RESERVED` handling.
- `docs/go-compatibility.md` (*Names that shadow JS globals*, the `defer`/`recover()` row, the runtime-panics row) describes the new behaviour.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Valid Go whose package-level type is named after a JS built-in and is miscompiled or crashes | F2 | |
| **In scope: target-specific** | `wasm` parity gaps and `wasm`-only boundary errors | F5, F8, F17, F19–F22, F24, F25, F28–F31; F5/F29 become compile errors only when the member belongs to a `wasm` package | |
| **Excluded: deferred** | Rejecting cross-package references to unexported or `__` names of `js`/`both` packages | `util.__Answer()`, `util.New(7).twice()`, `util.New(7).m` from a `js`/`both` package print `42`/`14`/`3` today (probe `b4`) | Go rejects them, but they work today, so rejecting them is breaking; `checker-strictness-plan.md` |
| **Excluded: deferred** | Message of an uncaught `wasm` panic whose value is a struct | `type P struct{ N int }; panic(P{3})` → `Error: [panic object]`; Go prints `panic: (main.P) 0x…` (an address), and `js`/`both` print `{"N":3}` | Go's text holds an address, so there is no exact target. Matching `js` needs a per-type formatter in the `wasm` boundary. `recover()` already returns the right value |
| **Excluded: deferred** | Package-level `js`/`both` struct types, or types with methods, named after JS built-ins | `type Set int` with a method → `type Set shadows the JavaScript global Set; rename the type` | Documented clear error, not a miscompile (same row in `../v1.9.3/js-codegen-fixes-plan.md`). Phase 5 only renames the method-less case that slips past the check (F2) |

---

## Verified Gaps & Baseline Audit

### Review follow-ups (2026-11-16)

**Method.** Same as the v1.9.3 follow-ups plan: probes ran on 2026-11-16 against `feat/js-codegen-fixes` at `5e83fc3f` (PR #207 merged) through `compileFiles` with `forceTarget` `js`/`both`/`wasm` (and `hybrid` `compileDir` for the cross-package cases) and ran in a child `node`. Expected outputs come from `go run` in **module mode** (`go.mod` `go 1.26`, which F21 needs for `panicnil=0`). The throwaway driver `.probes/fu-2026-11-16/` was deleted. Line numbers are as of that commit and will drift once checker strictness and the web platform plan land: re-probe each repro before starting its phase.

| ID | Area | Finding | Evidence & probe |
|---|---|---|---|
| F2 | Method-less named basic type after a JS built-in | `type Map int` emits `class Map` (`_isPlainNamedBox` → `genNamedTypeClass`, `src/backend/js/index.js:757-776`), but `_checkGlobalTypeNamesPass` (`src/typechecker/index.js:658`) only rejects struct types or types with methods. Its comment wrongly says method-less named types emit no class | `type Map int; var x Map = 5; fmt.Println(x)` → js/both `ReferenceError: Cannot access 'Map' before initialization` (from `var __kt = __kt \|\| new Map()`), want `5`. `wasm` is right (PR #203) |
| F5 | `wasm` package `__` export | `_namespaceMemberError` (`src/typechecker/resolve.js:1331`) treats only `a`–`z` as unexported, so `util.__Answer` is accepted. The `wasm` facade exports only exported names, and the JS side emits `__Answer$()` | `//gofront:target wasm` `func __Answer() int { return 42 }`, js main `util.__Answer()` → `ReferenceError: __Answer$ is not defined`. Go: `name __Answer not exported by package util`. `js`/`both` packages: prints `42` (control, see the Excluded row) (PR #203) |
| F8 | `wasm` generic `(*T)(nil)` | Inside a generic function, `(*T)(nil)` fails the `wasm` re-check of the monomorphised body. The ledger message `WASM compile failed` has changed to a checker error | `func f[T comparable](x T) int { p := (*T)(nil); if p == nil { return 0 }; return 1 }; f(3)` with `forceTarget` `wasm` → `Type error … 6:9: Undefined: 'T'`, want `0`. The same with `Proxy` as the parameter name. `js`/`both` are right (PR #203) |
| F17 | `wasm` anonymous literal with an embedded field | `toWasmType` (`src/backend/wasm/types.js:308`), `goTypeKey` (`:431`) and `_resolveStructInfo` (`src/backend/wasm/emit.js:1160`) build `rawFields` from `t.fields` (which includes promoted fields) instead of `t._structFields` and drop `f.embedded`, while `getAnonStructType` (`src/backend/wasm/module-emitter.js:315`) sets `embeds: []` | `v := struct{ P; M int }{P: P{5}, M: 6}; fmt.Println(v.N, v.P.N, v.M)` → wasm `0 5 6`, want `5 5 6` (PR #205) |
| F19 | `wasm` slice bound ≥ 2³² | The bound is wrapped to `i32` before the check, so `1 << 32` becomes `0` and passes | `xs := []int{1,2,3}; n := 1 << 32; _ = xs[:n]` under `recover` → wasm `<nil>`, want `runtime error: slice bounds out of range [:4294967296] with capacity 3` (feat/js-codegen-fixes-phase-4) |
| F20 | Uncaught `wasm` panic text | The env `panic` import (`src/backend/wasm/boundary.js:1877`) applies `String(msg)` to the host value. A bool arrives as `1`, a `uint64` as signed `i64`, and an `error` as an opaque ref, which becomes `[panic object]` | `panic(true)` → `Error: 1`; `panic(uint64(1) << 63)` → `Error: -9223372036854775808`; `panic(errors.New("bad"))` → `Error: [panic object]`. Want `true` / `9223372036854775808` / `bad`, which Go prints and `js`/`both` already print (probe `b5`). Struct: see the Excluded row (PR #206) |
| F21 | `panic(nil)` on `wasm` | `_emitBuiltinPanic` (`src/backend/wasm/emit-builtins.js:805`) passes a nil `any` through, and `recover()` traps on the cast | `defer func() { r := recover(); fmt.Printf("%T %v\n", r, r) }(); panic(nil)` → wasm `RuntimeError: illegal cast`; Go 1.26 (module mode) `*runtime.PanicNilError panic called with nil argument`; `js`/`both` print `<nil> <nil>` (PR #206) |
| F22 | `uint32` bounds ≥ 2³¹ on `wasm` | `_emitSliceBoundsPanic` (`emit-exprs.js:776`) and `_isI32IndexExpr` (`:1211`, routing `uint32` to the shared `oob32` block in `src/backend/wasm/emit.js:361`) sign-extend `i32` bounds (`i64.extend_i32_s`) even when the operand is unsigned | `xs := make([]int, 3, 5); u32 := uint32(1) << 31; _ = xs[:u32]` → `[:-2147483648]`, want `[:2147483648] with capacity 5`; `_ = xs[u32]` → `index out of range [-2147483648]`, want `index out of range [2147483648] with length 3` (PR #206) |
| F24 | Explicit anonymous struct type argument | The parse error is gone (js/both print `4`). On `wasm` it now fails like F31 | `id[struct{ N int }](struct{ N int }{4}).N` → wasm `Cannot resolve struct for selector: N`, want `4` (feat/js-codegen-fixes-phase-5) |
| F25 | `wasm` anonymous struct with an embedded struct and a pointer field | Same root cause as F17: `toWasmType` / `goTypeKey` / `_resolveStructInfo` include promoted fields from `t.fields` in the anonymous struct's WasmGC field list, so it does not match the `struct.new` operands | `y := struct{ P; M *P }{P{1}, &P{2}}; y.N = 5; fmt.Println(y.N, y.M.N)` → `CompileError: … struct.new[1] expected type i64, found struct.new of type (ref 16)`, want `5 2` (feat/js-codegen-fixes-phase-5) |
| F28 | `wasm` map keyed by an anonymous struct with an array field | `_structInfoForGoType` (`src/backend/wasm/emit-maps.js:72`, via `_resolveStructType` at `:21-34`) only resolves named structs (`t.name`) and returns `null` for anonymous struct map keys instead of falling back to `_resolveStructInfo` | `m := map[struct{ X int; S string; A [2]int }]int{a: 10}; m[a]` → wasm `0`, want `10` (PR #207) |
| F29 | Unexported method of a `wasm` struct from another package | Selectors on values (`fieldType` at `src/typechecker/resolve.js:1174` and `_fieldTypeStruct` at `:1215`, `:1232`) are not checked for export, and the facade class has no unexported methods | `//gofront:target wasm` `func (r Rec) twice() int`, js main `util.New(7).twice()` → `TypeError: New(...).twice is not a function`, want a compile error. `js`/`both` print `14` (Excluded row). `wasm` unexported *fields* work (`util.New(7).m` → `3`) and are not changed (PR #207) |
| F30 | `wasm` package type named after a JS built-in (deferred `js-codegen-fixes` Task 5.2) | The facade `class WeakMap` shadows the global. The fix needs `mangleCollidingTypes` (`src/link/type-names.js:22`), `pruneStdlibPrograms` (`src/link/wasm.js:134`) keeping `$$` user types, and `spellNamed` (`src/lower/gen-types.js:223`), `FmtGen.isNamedInScope` (`src/lower/fmt-formatters.js:243`), `checkGeneratedGo` (`src/link/stdlib.js:569`) and `goTypeName` (`src/backend/shared/fmt-types.js:5`) resolving `util.WeakMap` for aliased and indirect imports (design notes from PR #207 in the ledger) | `type WeakMap struct{ N int }; func Make(n int) WeakMap`, js main `var z util.WeakMap; z.N = 2; fmt.Println(util.Make(3).N, z.N)` → `ReferenceError: Cannot access 'WeakMap' before initialization`, want `3 2` (PR #207) |
| F31 | `wasm` generics over anonymous structs (deferred `js-codegen-fixes` Task 5.4) | `rawTypeKey` (`src/backend/wasm/monomorph.js:43`) has no struct case, so these calls get the erased `$val` instance. The PR #207 notes add three more gaps: `cloneAst` (`:221`) drops `_structFields` and `substituteInType` (`:179`) has no struct case (nested `inner(struct{ A T }{A: x})`); embedded fields lose their names in the type node; and `getAnonStructType` (`src/backend/wasm/module-emitter.js:289`) maps both `_` and `:` to `_`, so `A_int` and `A:int` collide | `func id[T any](v T) T; st := struct{ A [2]int }{}; a := id(st); a.A[0] = 1; fmt.Println(st.A[0], a.A[0])` → wasm `Cannot resolve struct for selector: A`, want `0 1`. The Task 3.2 cases in `test/unit/language/value-semantics.test.js` stay on `assertJsTargetsOutput` until this is fixed (PR #207) |

---

## Approach

### 1. Architecture & Design Decisions
- **F5/F29: reject only what never worked.** `_namespaceMemberError` treats a name as unexported unless its first letter is an uppercase Unicode letter (Go's rule), but only when the namespace is a `wasm` package. A selector of a method on a type declared in a `wasm` package, from another package (`fieldType` and `_fieldTypeStruct` in `src/typechecker/resolve.js`), is rejected when the method is unexported (`cannot refer to unexported method twice`). `js`/`both` behaviour and `wasm` unexported fields (which work) stay as they are.
- **F2/F30: one rename, `Name$$pkg`.** `mangleCollidingTypes` already gives a package-level type a `$$pkg` suffix, keeps `%T` as `util.Box`, and carries the suffix into the facade class. Phase 5 moves `pkgTarget` computation ahead of `mangleLocalTypes` in `src/compiler.js` and adds two kinds of type to `renamed`. In a `wasm` package, a non-alias type named in `JS_BUILTIN_CLASSES` is added. In a `js`/`both` package, a method-less, non-struct, non-alias named type in `JS_BUILTIN_CLASSES` is added (the only kind the checker lets through, F2). `goTypeName` (`src/backend/shared/fmt-types.js`) also formats `Name$$pkg` as `pkg.Name`. The PR #207 prerequisites come first (Tasks 5.1, 5.2). Function-local types keep `__L<n>` (`js-codegen-fixes` Task 5.1).
- **F17/F25/F28:** these are fixes inside `wasm`'s anonymous-struct layout and map-key resolution. `toWasmType`, `goTypeKey` and `_resolveStructInfo` build anonymous struct fields from `t._structFields` (Declared fields only, preserving `f.embedded` and excluding promoted entries from `t.fields`), and `getAnonStructType` populates `embeds` so both literals and promoted selectors use the same WasmGC layout. In `src/backend/wasm/emit-maps.js`, `_structInfoForGoType` falls back to `this._resolveStructInfo({ _type: goType })` when `_resolveStructType` returns `null` for an anonymous struct key (array fields inside the struct are already hashed and compared recursively by `emitKeyHash`/`emitKeyEq`).
- **F31/F24/F8 (`wasm` monomorph):** this follows the PR #207 design notes. `rawTypeKey` gets a struct case (`st{A:arr2_int}` escaped so `_` and `:` stay distinct). `typeToTypeNode` returns a `StructType` with embedded names. `cloneAst` keeps `_structFields`, and `substituteInType` gets struct and pointer-in-paren cases (F8: `(*T)(nil)` keeps the substituted `T`).
- **F19/F22:** a slice bound of 64-bit type is compared as `i64` against the length/cap before it is wrapped. Unsigned `i32` bounds and indexes are zero-extended (`i64.extend_i32_u`) when passed to the panic helpers, and `_isI32IndexExpr` excludes `uint32` so `_ = xs[u32]` does not take the sign-extending `oob32` path.
- **F20/F21:** the host message is built by type before `emitPanicThrow`. `bool` gives `"true"`/`"false"`, unsigned 64-bit is converted as unsigned, and an `error` value uses the result of its `Error()` method (calling it the way `recover` printing does). `panic(nil)` (or `panic(a)` where `a` is a nil interface) on `wasm` panics with a synthesised runtime struct (`PANIC_NIL_STRUCT`) whose `Error()` is `"panic called with nil argument"` and whose `GofrontTypeName()` is `"*runtime.PanicNilError"` (so `fmt`'s `%T` and `%v` print `*runtime.PanicNilError panic called with nil argument`). `js`/`both` stay at `<nil>` because nil slices, functions and interfaces share `null` at run time on JS and changing `panic(nil)` there would alter existing output; the `defer`/`recover()` row in `docs/go-compatibility.md` documents this.

### 2. Invariants & Safety Bounds
- A program that compiles and runs correctly today prints the same output, except for the `$$pkg` names visible from hand-written JS (documented) and the new F5/F29 compile errors on `wasm` packages.
- Emitted JS for programs without the affected names or `wasm` shapes is byte-identical. The bundle-size, zero-alloc and BCE gates are unchanged.
- `JS_BUILTIN_CLASSES` does not grow, and no type declaration that compiles today is rejected.

### 3. Edge Cases & Error Handling
- **F5:** `util.Ä()`-style non-ASCII uppercase stays exported (use `/\p{Lu}/u`).
- **F30:** a type renamed both by collision and by built-in name gets one `$$pkg` (no `$$util$$util`). `errors.As` into the renamed type, and promoted methods, must survive `pruneStdlibPrograms`.
- **F31:** the same anonymous struct written twice, or through an alias, shares one instance. Different ones get distinct instances.

---

## Implementation Tasks

> Scheduled from review follow-ups (`plans/follow-ups.md`, re-probed 2026-11-16), moved from the v1.9.3 follow-ups plan.

### Phase 1: Package boundaries (F5, F29)
- [ ] Task 1.1: `wasm` packages reject unexported and `__` members from other packages (F5, F29)
  - Files: `src/typechecker/resolve.js` (`_namespaceMemberError` uses Go's uppercase rule for `wasm` namespaces; `fieldType` and `_fieldTypeStruct` reject unexported methods on types owned by another `wasm` package)
  - Test: `test/unit/types/shadowing.test.js` with `compileHybridProject`: F5 → `assertErrorContains(…, "cannot refer to unexported name util.__Answer")`; F29 → `"cannot refer to unexported method twice"`; controls: the same two from a `js` and a `both` package still print `42`/`14`, and `util.New(7).m` from `wasm` prints `3`
  - Done when: all pass

### Phase 2: `wasm` anonymous struct layout (F17, F25, F28)
- [ ] Task 2.1: Anonymous struct WasmGC field list uses declared fields and records embeds (F25)
  - Files: `src/backend/wasm/types.js` (`toWasmType` and `goTypeKey` read `t._structFields` and preserve `f.embedded`), `src/backend/wasm/emit.js` (`_resolveStructInfo` reads `t._structFields` and preserves `f.embedded`), `src/backend/wasm/module-emitter.js` (`getAnonStructType` populates `embeds` for embedded struct fields)
  - Test: `test/unit/wasm/structs.test.js` with `assertProgramOutput`: F25 → `5 2`; `assertValidWasm` on the module
  - Done when: passes
- [ ] Task 1.1: Keyed and positional embedded fields in anonymous struct literals (F17)
  - Files: `src/backend/wasm/emit-exprs.js` (`emitCompositeLit` keyed and positional embedded elements with the Task 2.1 layout)
  - Test: `test/unit/wasm/structs.test.js` with `assertProgramOutput`: F17 → `5 5 6`; positional form `{P{5}, 6}` → `5 5 6`
  - Done when: both pass
- [ ] Task 2.3: Map keys that are anonymous structs with array fields (F28)
  - Files: `src/backend/wasm/emit-maps.js` (`_structInfoForGoType` falls back to `this._resolveStructInfo({ _type: goType })` for anonymous struct keys)
  - Test: `test/unit/wasm/map-keys.test.js` with `assertProgramOutput`: F28 → `10`; a second key differing only in `A[1]` misses
  - Done when: both pass

### Phase 3: `wasm` generics over anonymous structs (F8, F24, F31)
- [ ] Task 3.1: Struct type keys and type nodes in monomorph (F31, F24)
  - Files: `src/backend/wasm/monomorph.js` (`rawTypeKey` struct case, `typeToTypeNode` `StructType` with embedded names), `src/backend/wasm/module-emitter.js` (`getAnonStructType` name escaping keeps `_` and `:` distinct)
  - Test: `test/unit/wasm/generics.test.js` with `assertProgramOutput`: F31 → `0 1`; F24 → `4`; `dup` → `0 1 0`; alias `type S = struct{ A [2]int }` with `id(struct{ N int }{3})` → `0 1 3`; two different anonymous type arguments of one generic; `struct{ A_int int }` vs `struct{ A int }` stay distinct
  - Done when: all pass; switch the `js-codegen-fixes` Task 3.2 cases in `value-semantics.test.js` and the Task 1.3 cases of the v1.9.3 follow-ups plan (`generics.test.js`) to `assertAllTargetsOutput`
- [ ] Task 3.2: Nested generics and embedded fields (F31 design notes)
  - Files: `src/backend/wasm/monomorph.js` (`cloneAst` keeps `_structFields`; `substituteInType` struct case)
  - Test: `test/unit/wasm/generics.test.js`: `outer[T]` calling `inner(struct{ A T }{A: x})` → no `structFieldList is not a function` crash and Go's output; `keep(struct{ P; K int }{…})` → valid WasmGC and Go's output
  - Done when: both pass
- [ ] Task 3.3: `(*T)(nil)` inside a generic function (F8)
  - Files: `src/backend/wasm/monomorph.js` (substitution through a parenthesised pointer conversion type)
  - Test: `test/unit/wasm/generics.test.js` with `assertProgramOutput`: F8 with `T` and with `Proxy` → `0`; `(*T)(&x)` → `1`
  - Done when: all pass

### Phase 4: `wasm` panics and bounds (F19–F22)
- [ ] Task 4.1: 64-bit slice bounds are checked before narrowing (F19)
  - Files: `src/backend/wasm/emit-exprs.js` (`emitSliceExpr` and `_emitSliceBound` compare `i64` bounds before narrowing to `i32`)
  - Test: `test/unit/compiler/strict-panics.test.js` with `assertProgramOutput`: F19 → `runtime error: slice bounds out of range [:4294967296] with capacity 3`; string `s[:n]` with `n = 1<<32`
  - Done when: both pass; `int` bounds below 2³² emit the same code
- [ ] Task 4.2: Unsigned 32-bit bounds and indexes print unsigned (F22)
  - Files: `src/backend/wasm/emit-exprs.js` (`_emitSliceBoundsPanic` and index-panic call sites zero-extend unsigned operands; `_isI32IndexExpr` excludes `uint32` from the sign-extending `oob32` path)
  - Test: `test/unit/compiler/strict-panics.test.js` with `assertProgramOutput`: both F22 lines
  - Done when: both pass
- [ ] Task 4.3: Uncaught `wasm` panics carry Go's text for `bool`, unsigned and `error` values (F20)
  - Files: `src/backend/wasm/emit-builtins.js` (`_emitBuiltinPanic`/`_emitScalarPanic` build the host message per type; `error` via `Error()`), `src/backend/wasm/boundary.js` (`panic` import keeps the passed string)
  - Test: `test/unit/wasm/defer_recover.test.js`: uncaught `panic(true)`, `panic(uint64(1)<<63)`, `panic(errors.New("bad"))` from a `wasm` export throw `Error` with message `true` / `9223372036854775808` / `bad`; `recover()` values unchanged
  - Done when: all pass
- [ ] Task 4.4: `panic(nil)` on `wasm` panics with `*runtime.PanicNilError` (F21)
  - Files: `src/backend/wasm/types.js` (`PANIC_NIL_STRUCT`), `src/backend/wasm/prescan.js`, `src/backend/wasm/module-emitter.js` (register `PANIC_NIL_STRUCT` with `Error() string` and `GofrontTypeName() string`), `src/backend/wasm/index.js` (runtime helper methods), `src/backend/wasm/emit-builtins.js` (`_emitBuiltinPanic` for `nil` and nil interface arguments, `emitRuntimeHelper`, `_emitTypeAssertFail`), `docs/go-compatibility.md` (`defer`/`recover()` row: `panic(nil)` on `wasm` vs `js`/`both`; runtime-panics row: 64-bit and unsigned bounds)
  - Test: `test/unit/wasm/defer_recover.test.js` with `assertWasmProgramOutput`: F21 (`panic(nil)` and `var a any; panic(a)`) → `*runtime.PanicNilError panic called with nil argument`; `js`/`both` output unchanged (`<nil> <nil>`)
  - Done when: both pass

### Phase 5: Package-level type names after JS built-ins (F2, F30)
- [ ] Task 5.1: Generated Go resolves renamed types through same-package, aliased and indirect imports (F30 prerequisite)
  - Files: `src/lower/gen-types.js` (`spellNamed`), `src/lower/fmt-formatters.js` (`FmtGen.isNamedInScope`), `src/link/stdlib.js` (`checkGeneratedGo` binds non-stdlib `$$`-renamed types under their qualifier)
  - Test: `test/unit/types/shadowing.test.js` with `compileHybridProject`: `import u "./util"; fmt.Printf("%T", u.Make(5))` with a `$$`-renamed `Box` → `util.Box`; the same through a package that re-exports the value
  - Done when: passes (no `Unknown type 'util.Box'`)
- [ ] Task 5.2: `pruneStdlibPrograms` keeps renamed user types (F30 prerequisite)
  - Files: `src/link/wasm.js` (`pruneStdlibPrograms` drops only unreachable stdlib `TypeDecl`s and keeps `$$` user types when stdlib programs are linked)
  - Test: `test/unit/types/shadowing.test.js` with `compileHybridProject`: a `wasm` package and the js main both declare `Box` (renamed `Box$$util` today), the `wasm` package imports `fmt` and `errors`; `var m Box; m.N = 42; fmt.Println(m.N)`, `errors.As` into the type, and a promoted method all print Go's output
  - Done when: passes (fails first with the null deref from the PR #207 notes)
- [ ] Task 5.3: Rename `wasm` types and method-less `js`/`both` named types after JS built-ins to `Name$$pkg` (F2, F30)
  - Files: `src/link/type-names.js` (`mangleCollidingTypes` takes the built-in names and the package target), `src/compiler.js` (compute `pkgTarget` before `mangleLocalTypes` and pass it), `src/backend/shared/fmt-types.js` (`qualify` formats `Name$$pkg` as `pkg.Name`), `docs/go-compatibility.md` (*Names that shadow JS globals*: `WeakMap$$util` in the facade and `Map$$main` for method-less named types; struct/method types in `js`/`both` keep the error)
  - Test: `test/unit/types/shadowing.test.js`: `h05` (F30) → `3 2` with the facade defining `class WeakMap$$util` and `%T` printing `util.WeakMap`; F2 → `5` on every target with `%T` `main.Map`; a second package also declaring `WeakMap` (no `$$util$$util`); a function-local `type Map` still gets `__L<n>`; the existing `type Array struct{}` rejection tests stay green
  - Done when: all pass; programs without such types emit the same JS
