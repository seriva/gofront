# v1.9.3 Review Follow-ups (2026-11-16) — Design Plan

**Version:** v1.9.3  
**Status:** In Progress  
**Base branch:** main  
**Related:** [`js-codegen-fixes-plan.md`](js-codegen-fixes-plan.md) is where most ledger entries came from (PRs #203–#207). Its deferred Tasks 5.2 and 5.4 are scheduled here as Phases 9 and 7. [`../v2.0.0/checker-strictness-plan.md`](../v2.0.0/checker-strictness-plan.md) owns rejecting invalid Go that compiles today and runs (see the deferred rows below). Its own Excluded row hands "generic instances over anonymous structs" to this ledger (F23).  
**Release note:** More valid Go now runs correctly. Types named `yield`, `arguments` or after JavaScript built-ins such as `Map` work. Multiple and compound assignments run their side effects in Go's order, and copies of anonymous structs no longer share arrays. Generic code over anonymous structs and `(*T)(nil)` now compiles for WebAssembly. WebAssembly panics also match Go more closely: `panic(nil)`, large slice bounds, and the messages of uncaught `bool`, unsigned and `error` panics.  

---

## Goal

Fix the 31 review follow-ups that still reproduce in `plans/follow-ups.md` (re-probed 2026-11-16 against `feat/js-codegen-fixes` at `5e83fc3f`). They are valid Go programs that are miscompiled, crash at run time, or fail to compile on one target, plus two `wasm`-only cross-package references that throw at run time. The release theme is unchanged: a program that compiles and runs today is not rejected. The two exceptions are new errors for `wasm`-package members that the facade never had, so they never worked.

**Done means:**
- Every repro F1–F26 and F28–F31 in *Verified Gaps* (except the `Excluded` parts) prints Go 1.26.0's output, or gives the stated compile error, on every target its test names. Each is a test in the file named by its task.
- `npm test` passes, and `test/perf/zero-alloc.js`, `bce-mathx.js` and `bundle-size.js` pass with `bundle-size.baseline.json` unchanged.
- `test/unit/compiler/js-globals.test.js` (the rename-set registry test) passes unmodified, apart from new names added to `JS_RESERVED` handling.
- `docs/usage.md` (untyped npm imports), `docs/go-compatibility.md` (*Names that shadow JS globals*, the runtime-panics row) describe the new behaviour.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Valid Go that compiles and misbehaves, or fails to compile/parse, on any target | F1–F4, F6, F7, F9–F16, F18, F23, F26 | |
| **In scope: target-specific** | `wasm` parity gaps and `wasm`-only boundary errors | F5, F8, F17, F19–F22, F24, F25, F28–F31; F29/F5 become compile errors only when the member belongs to a `wasm` package | |
| **Excluded: deferred** | Rejecting cross-package references to unexported or `__` names of `js`/`both` packages | `util.__Answer()`, `util.New(7).twice()`, `util.New(7).m` from a `js`/`both` package print `42`/`14`/`3` today (probe `b4`) | Go rejects them, but they work today, so rejecting them is breaking; `../v2.0.0/checker-strictness-plan.md` |
| **Excluded: deferred** | Message of an uncaught `wasm` panic whose value is a struct | `type P struct{ N int }; panic(P{3})` → `Error: [panic object]`; Go prints `panic: (main.P) 0x…` (an address), and `js`/`both` print `{"N":3}` | Go's text holds an address, so there is no exact target. Matching `js` needs a per-type formatter in the `wasm` boundary. `recover()` already returns the right value |
| **Excluded: deferred** | The "reslice-synced target" assignment-order form from the F11 ledger entry | The entry gave no repro for it. The `for`-post and generic `*p` forms are scheduled (Task 4.3) | No repro to write a test from. Re-record it in `plans/follow-ups.md` if Task 4.3's review finds one |
| **Excluded: deferred** | Package-level `js`/`both` struct types, or types with methods, named after JS built-ins | `type Set int` with a method → `type Set shadows the JavaScript global Set; rename the type` | Documented clear error, not a miscompile (same row in `js-codegen-fixes-plan.md`). Phase 9 only renames the method-less case that slips past the check (F2) |

---

## Verified Gaps & Baseline Audit

### Review follow-ups (2026-11-16)

**Method.** Probes ran on 2026-11-16 against `feat/js-codegen-fixes` at `5e83fc3f` (PR #207 merged). They used the throwaway driver `.probes/fu-2026-11-16/run.mjs`, which is `.probes/review-2026-11-13/run2.mjs` extended with per-case `t=<targets>`, `hybrid` (`compileDir` without `forceTarget`, js main plus a `wasm`/`both`/`js` `util/` package) and a Go 1.26.0 oracle. Each case went through `compileFiles` with `forceTarget` `js`/`both`/`wasm` and ran in a child `node`. Expected outputs come from `go run` in **module mode** (`go.mod` `go 1.26`, which F21 needs for `panicnil=0`). `.probes/fu-2026-11-16/` is deleted. Each row therefore carries its repro.

| ID | Area | Finding | Evidence & probe |
|---|---|---|---|
| F1 | Untyped npm import | An import with no resolvable `.d.ts` warns "treating as any", but the name is never bound. `resolveAll` stores `null` (`src/resolver.js:121-126`) and `resolveImports` skips `null` entries (`src/compiler.js:269-273`). Typed imports add their values as globals, and `prep`/`build` vendoring exposes a package under its name as a browser global (`docs/usage.md:77`) | `import "nope/zzz"; func main() { zzz.F() }` → `warning: cannot find types for 'nope/zzz', treating as any` then `Type error … 5:15: Undefined: 'zzz'`, want it to compile with `zzz` typed `any` (PR #203 design review, standalone). `import _ "nope/zzz"` test: `test/unit/compiler/stdlib-go.test.js:694` |
| F2 | Method-less named basic type after a JS built-in | `type Map int` emits `class Map` (`_isPlainNamedBox` → `genNamedTypeClass`, `src/backend/js/index.js:757-776`), but `_checkGlobalTypeNamesPass` (`src/typechecker/index.js:658`) only rejects struct types or types with methods. Its comment wrongly says method-less named types emit no class | `type Map int; var x Map = 5; fmt.Println(x)` → js/both `ReferenceError: Cannot access 'Map' before initialization` (from `var __kt = __kt \|\| new Map()`), want `5`. `wasm` is right (PR #203) |
| F3 | Local named after its own type | `var T T = 4; T.Dbl()` emits `T.$Dbl(T)`: the static method call names the class `T`, which the local `let T` shadows (`genNamedTypeClass` static methods) | → js/both `TypeError: T.$Dbl is not a function`, want `8`. `wasm` is right (feat/js-codegen-fixes-phase-1) |
| F4 | Local type vs package-level value | A function-local `type A = int` takes over the package-level `var A`. `renameLocalTypes` (`src/link/type-names.js:45`) renames a local type only for duplicate local types, `reserved` names, or a later value *in the same function*. Package-level values are not considered | `var __A = "hi"; func other() int { type __A = int; var x __A = 3; return x }; …var s string = __A` → all targets `Cannot assign int to string`, want `5`. **Not only `__`:** the same with `A` fails the same way (`e04b`) (PR #203) |
| F5 | `wasm` package `__` export | `_namespaceMemberError` (`src/typechecker/resolve.js:1331`) treats only `a`–`z` as unexported, so `util.__Answer` is accepted. The `wasm` facade exports only exported names, and the JS side emits `__Answer$()` | `//gofront:target wasm` `func __Answer() int { return 42 }`, js main `util.__Answer()` → `ReferenceError: __Answer$ is not defined`. Go: `name __Answer not exported by package util`. `js`/`both` packages: prints `42` (control, see the Excluded row) (PR #203) |
| F6 | Type names that are strict-mode words | Class declarations emit the raw Go name (`class ${name}`, `src/backend/js/index.js:776`, `:795`, `:1020`), while references already go through `jsSafeName` (`undefined` → `undefined$`, `src/backend/js/names.js:49`) | `type yield struct{ X int }` → js/both `SyntaxError: Unexpected strict mode reserved word`, want `7`; `type arguments struct{X int}` → `Unexpected eval or arguments in strict mode`, want `3`; `type undefined struct{X int}; var a any = undefined{1}; _, ok := a.(undefined)` → `ReferenceError: undefined$ is not defined`, want `true`. `wasm` is right (PR #203) |
| F7 | Type parameter named like a package struct | The `new` builtin (`src/backend/js/expressions.js:465`) checks `s.structNames.has(arg.name)` before looking at the argument's type, so a type parameter `S` builds the package struct `S` | `type S struct{ X int }; func f[S any](v S) *S { return new(S) }; fmt.Println(*f[int](3))` → js/both `-9223372036854775808` (emitted `return new S();`), want `0`. Same with `__S`. `wasm` is right (PR #203) |
| F8 | `wasm` generic `(*T)(nil)` | Inside a generic function, `(*T)(nil)` fails the `wasm` re-check of the monomorphised body. The ledger message `WASM compile failed` has changed to a checker error | `func f[T comparable](x T) int { p := (*T)(nil); if p == nil { return 0 }; return 1 }; f(3)` with `forceTarget` `wasm` → `Type error … 6:9: Undefined: 'T'`, want `0`. The same with `Proxy` as the parameter name. `js`/`both` are right (PR #203) |
| F9 | Blank targets in multi-assignment (JS) | `_genMultiAssignWithBlanks` (`src/backend/js/statements.js:1130`) re-emits a right-hand side, and the all-blank form drops the trailing expressions | Local trace closure `t(s, v)`: `_, arr[t("i",0)] = t("x",5), t("y",6)` → js/both `ixyy [6 0]`, want `ixy [6 0]`; `_, _ = t("x",5), t("y",6)` → `x`, want `xy`. `wasm` is right (PR #204) |
| F10 | Comma-ok forms and assignment order | The comma-ok paths do not hoist target operands: JS `_genCommaOkTypeAssert` (`statements.js:995`) and `_genCommaOkMapIndex` (`:269`), `wasm` `_emitCommaOkTypeAssert` (`src/backend/wasm/emit-stmts.js:1253`) and `_emitCommaOkMapIndex` | `arr[t("i",0)], ok = fv().(int)` → every target `fi`, want `if`; `arr[t("i",1)], ok = m[ks("k")]` → `ki`, want `ik` (PR #204) |
| F11 | Assignment order in rarer JS forms | `_hoistLhsOperands` (`statements.js:942`) is not applied to a multi-assignment in a `for` post statement, nor to a generic `*p` target | `for k := 0; k < 1; k, arr[t("i",0)] = t("x",1), t("y",6) {}` → js/both `xyi`, want `ixy`; in `func run[T any]`: `*pn("p", p), arr[ti("i",0)] = t("x",v1), t("y",v2)` → `xypi`, want `pixy`. `wasm` is right (PR #204) |
| F12 | Compound assignment reads the target before a right-hand call | Go evaluates `x op= f()` as `x = x op f()` with the call first when it mutates `x` (oracle). JS emits `x += f()` and strict `_genStrictCompound` reads `x` first; `wasm` `_emitCompoundAssign` (`emit-stmts.js:1721`) loads the target first | `var x int32 = 100; next := func() int32 { x = 200; return 2 }`, each line from `x = 100`: `+=`, `/=`, `%= next()+1`, `<<=`, `>>=`, then `int` `+=` → Go `202 100 2 800 50 202`; js `102 100 1 400 25 102`; both `102 100 2 800 50 102`; wasm `102 50 1 400 25 102` (PR #204) |
| F13 | `*p` target in a JS multi-assignment | A `*p` target whose operand needs a nil check is emitted as a destructuring target `__nilcall(h)`, which is invalid JS | `*ps("p", s), arr[t("i",0)] = S{5}, t("y",6)` → js/both `SyntaxError: Invalid destructuring assignment target` (`[__nilcall(__h1), __h2[__h3]] = [new S(5), t("y", 6)]`), want `piy 5 6`. `wasm` is right (PR #204) |
| F14 | Alias of an anonymous struct | `type T = struct{ A [2]int }` emits an empty `class T {}` and `var s T` emits `new T()` (`_genTypeDeclBody`, `index.js:747`), so the value has no fields. `wasm` builds a null zero value. Ledger entries 21 and 31 are the same root cause | `var s T; s.A[0] = 1; fmt.Println(s.A[0])` → js/both `Cannot set properties of undefined (setting '0')`, wasm `RuntimeError: dereferencing a null pointer`, want `1`; `var s S; fmt.Println(s.A[0])` → `Cannot read properties of undefined`, want `0` (feat/js-codegen-fixes-phase-3, -phase-5) |
| F15 | Shallow anonymous struct copies (JS) | `_cloneJs` (`src/backend/js/expressions.js`) clones by field only for array and struct field types it recognises. It misses embedded fields, defined array types (`type Vec [2]int`) and type-parameter arrays. Type-switch bindings and range-over-func yielded values are not copied at all | `st := struct{ P; B [2]int }{}; cp := st; cp.P.A[0] = 7` → js/both `7 7`, want `0 7`; `func f(s struct{ V Vec }) { s.V[0] = 9 }` → `9`, want `0`; `switch v := a.(type) { case struct{ A [2]int }: v.A[0] = 5 }` then `a.(…).A[0]` → `5 5`, want `5 0`; range-over-func `v.A[0] = 4` changes the iterator's `s` → `4`, want `0`. `wasm` is right (PR #205) |
| F16 | Generic copy of a map or `[N]byte` (JS) | `__vclone` (`HELPER_VCLONE`, `src/backend/js/runtime.js:310-340`) already copies typed arrays (`ArrayBuffer.isView`), but its top-level check (`!isObj(zero)`) misses Go map zeros (`__nm()` / `__nilmap`, checked via `isShape` only on nested fields), so a top-level map argument falls through to `Object.assign` and is cloned | `dup[T any](v T) (T, T)` over `map[string]int{"a":1}`, `x["a"] = 9` → js/both `1 9 1`, want `9 9 9`; `dup([4]byte{1,2,3,4})` → `len` `4` (regression check) (PR #205) |
| F17 | `wasm` anonymous literal with an embedded field | `toWasmType` (`src/backend/wasm/types.js:308`), `goTypeKey` (`:431`) and `_resolveStructInfo` (`src/backend/wasm/emit.js:1160`) build `rawFields` from `t.fields` (which includes promoted fields) instead of `t._structFields` and drop `f.embedded`, while `getAnonStructType` (`src/backend/wasm/module-emitter.js:315`) sets `embeds: []` | `v := struct{ P; M int }{P: P{5}, M: 6}; fmt.Println(v.N, v.P.N, v.M)` → wasm `0 5 6`, want `5 5 6` (PR #205) |
| F18 | Conversion to an anonymous struct type | `_parsePrimary` parses `struct{…}` only as a composite literal (`src/parser/expressions.js:560-563`), unlike the slice/array/map conversion path just above it (`:549-558`); on `js`/`both`, `_genTypeConversion` (`src/backend/js/expressions.js:3680`) and `_genTypeConversionCall` (`:2068`) also return the source struct instance uncloned instead of calling `_cloneAnonStruct` | `type S struct{ A [2]int }; var a any = struct{ A [2]int }(s)` → every target `Parse error at 9:32: expected '{' (got ( "(")`, want `{[1 2]}` (PR #205) |
| F19 | `wasm` slice bound ≥ 2³² | The bound is wrapped to `i32` before the check, so `1 << 32` becomes `0` and passes | `xs := []int{1,2,3}; n := 1 << 32; _ = xs[:n]` under `recover` → wasm `<nil>`, want `runtime error: slice bounds out of range [:4294967296] with capacity 3` (feat/js-codegen-fixes-phase-4) |
| F20 | Uncaught `wasm` panic text | The env `panic` import (`src/backend/wasm/boundary.js:1877`) applies `String(msg)` to the host value. A bool arrives as `1`, a `uint64` as signed `i64`, and an `error` as an opaque ref, which becomes `[panic object]` | `panic(true)` → `Error: 1`; `panic(uint64(1) << 63)` → `Error: -9223372036854775808`; `panic(errors.New("bad"))` → `Error: [panic object]`. Want `true` / `9223372036854775808` / `bad`, which Go prints and `js`/`both` already print (probe `b5`). Struct: see the Excluded row (PR #206) |
| F21 | `panic(nil)` on `wasm` | `_emitBuiltinPanic` (`src/backend/wasm/emit-builtins.js:805`) passes a nil `any` through, and `recover()` traps on the cast | `defer func() { r := recover(); fmt.Printf("%T %v\n", r, r) }(); panic(nil)` → wasm `RuntimeError: illegal cast`; Go 1.26 (module mode) `*runtime.PanicNilError panic called with nil argument`; `js`/`both` print `<nil> <nil>` (PR #206) |
| F22 | `uint32` bounds ≥ 2³¹ on `wasm` | `_emitSliceBoundsPanic` (`emit-exprs.js:776`) and `_isI32IndexExpr` (`:1211`, routing `uint32` to the shared `oob32` block in `src/backend/wasm/emit.js:361`) sign-extend `i32` bounds (`i64.extend_i32_s`) even when the operand is unsigned | `xs := make([]int, 3, 5); u32 := uint32(1) << 31; _ = xs[:u32]` → `[:-2147483648]`, want `[:2147483648] with capacity 5`; `_ = xs[u32]` → `index out of range [-2147483648]`, want `index out of range [2147483648] with length 3` (PR #206) |
| F23 | Generic struct over different anonymous structs | `instanceKey` (`src/typechecker/resolve.js:108`) falls back to `typeStr` (including for `named` types with `typeArgs`), which prints every anonymous struct as `struct{...}`, so `Box[struct{X int}]` and `Box[struct{S string}]` share one instance | `a := Box[struct{ X int }]{}; b := Box[struct{ S string }]{}; fmt.Println(a.V.X, b.V.S)` → every target `Type error: No field 'S' on struct{...}`, want `0 ` (feat/js-codegen-fixes-phase-5) |
| F24 | Explicit anonymous struct type argument | The parse error is gone (js/both print `4`). On `wasm` it now fails like F31 | `id[struct{ N int }](struct{ N int }{4}).N` → wasm `Cannot resolve struct for selector: N`, want `4` (feat/js-codegen-fixes-phase-5) |
| F25 | `wasm` anonymous struct with an embedded struct and a pointer field | Same root cause as F17: `toWasmType` / `goTypeKey` / `_resolveStructInfo` include promoted fields from `t.fields` in the anonymous struct's WasmGC field list, so it does not match the `struct.new` operands | `y := struct{ P; M *P }{P{1}, &P{2}}; y.N = 5; fmt.Println(y.N, y.M.N)` → `CompileError: … struct.new[1] expected type i64, found struct.new of type (ref 16)`, want `5 2` (feat/js-codegen-fixes-phase-5) |
| F26 | Typed nil `*V` calling a `__` method (JS) | `__mknil` (`src/backend/js/runtime.js:404`) skips every prototype key starting with `__` (including user methods suffixed as `__ref$`) and checks `vm.includes(k)` against unsuffixed names in `C.__vm` | `type I interface{ __ref() int }; var vp *V = nil; var i I = vp; i.__ref()` under `recover` → js/both `-9223372036854775808`, want `runtime error: invalid memory address or nil pointer dereference`. `wasm` is right (PR #207) |
| F27 | `wasm` facade member `__ref` | **No longer reproduces.** A `wasm` struct `S{ __ref, N int }` read as `s.__ref` from a js main prints `7`, and `__clone` does too (probe `h-wasm-dunder-clone-field` → `7 5 1`). Go would reject that read as unexported; see the Excluded row. Deleted from the ledger | (PR #207) |
| F28 | `wasm` map keyed by an anonymous struct with an array field | `_structInfoForGoType` (`src/backend/wasm/emit-maps.js:72`, via `_resolveStructType` at `:21-34`) only resolves named structs (`t.name`) and returns `null` for anonymous struct map keys instead of falling back to `_resolveStructInfo` | `m := map[struct{ X int; S string; A [2]int }]int{a: 10}; m[a]` → wasm `0`, want `10` (PR #207) |
| F29 | Unexported method of a `wasm` struct from another package | Selectors on values (`fieldType` at `src/typechecker/resolve.js:1174` and `_fieldTypeStruct` at `:1215`, `:1232`) are not checked for export, and the facade class has no unexported methods | `//gofront:target wasm` `func (r Rec) twice() int`, js main `util.New(7).twice()` → `TypeError: New(...).twice is not a function`, want a compile error. `js`/`both` print `14` (Excluded row). `wasm` unexported *fields* work (`util.New(7).m` → `3`) and are not changed (PR #207) |
| F30 | `wasm` package type named after a JS built-in (deferred `js-codegen-fixes` Task 5.2) | The facade `class WeakMap` shadows the global. The fix needs `mangleCollidingTypes` (`src/link/type-names.js:22`), `pruneStdlibPrograms` (`src/link/wasm.js:134`) keeping `$$` user types, and `spellNamed` (`src/lower/gen-types.js:223`), `FmtGen.isNamedInScope` (`src/lower/fmt-formatters.js:243`), `checkGeneratedGo` (`src/link/stdlib.js:569`) and `goTypeName` (`src/backend/shared/fmt-types.js:5`) resolving `util.WeakMap` for aliased and indirect imports (design notes from PR #207 in the ledger) | `type WeakMap struct{ N int }; func Make(n int) WeakMap`, js main `var z util.WeakMap; z.N = 2; fmt.Println(util.Make(3).N, z.N)` → `ReferenceError: Cannot access 'WeakMap' before initialization`, want `3 2` (PR #207) |
| F31 | `wasm` generics over anonymous structs (deferred `js-codegen-fixes` Task 5.4) | `rawTypeKey` (`src/backend/wasm/monomorph.js:43`) has no struct case, so these calls get the erased `$val` instance. The PR #207 notes add three more gaps: `cloneAst` (`:221`) drops `_structFields` and `substituteInType` (`:179`) has no struct case (nested `inner(struct{ A T }{A: x})`); embedded fields lose their names in the type node; and `getAnonStructType` (`src/backend/wasm/module-emitter.js:289`) maps both `_` and `:` to `_`, so `A_int` and `A:int` collide | `func id[T any](v T) T; st := struct{ A [2]int }{}; a := id(st); a.A[0] = 1; fmt.Println(st.A[0], a.A[0])` → wasm `Cannot resolve struct for selector: A`, want `0 1`. The Task 3.2 cases in `test/unit/language/value-semantics.test.js` stay on `assertJsTargetsOutput` until this is fixed (PR #207) |

---

## Approach

### 1. Architecture & Design Decisions
- **F1 (decision): bind as a dynamic global, do not reject.** The warning says "treating as any", and vendoring exposes packages as globals by name. So `resolveImports` (and the `compile` test helper in `test/unit/helpers.js`) binds the import's local name (the alias, else the last path element with non-identifier characters replaced as in `docs/usage.md:79`) to a JS-dynamic `any` value. It uses the checker's existing path for browser globals (`BROWSER_GLOBALS`-style untyped value, permissive member access), and the JS backend emits the bare name. On `wasm`/`both`, `Ident` (`src/typechecker/expressions.js:277`) reports it via `_errJsOnly` when referenced (while removing the blanket non-builtin `js: imports are not allowed` rejection in `resolveImports` for untyped npm imports so the error names the identifier). Rejected: turning the warning into an error, because `import z "nope/zzz"` compiles today (test-harness plan G2b relies on it).
- **F5/F29: reject only what never worked.** `_namespaceMemberError` treats a name as unexported unless its first letter is an uppercase Unicode letter (Go's rule), but only when the namespace is a `wasm` package. A selector of a method on a type declared in a `wasm` package, from another package (`fieldType` and `_fieldTypeStruct` in `src/typechecker/resolve.js`), is rejected when the method is unexported (`cannot refer to unexported method twice`). `js`/`both` behaviour and `wasm` unexported fields (which work) stay as they are.
- **F2/F30: one rename, `Name$$pkg`.** `mangleCollidingTypes` already gives a package-level type a `$$pkg` suffix, keeps `%T` as `util.Box`, and carries the suffix into the facade class. Phase 9 moves `pkgTarget` computation ahead of `mangleLocalTypes` in `src/compiler.js` and adds two kinds of type to `renamed`. In a `wasm` package, a non-alias type named in `JS_BUILTIN_CLASSES` is added. In a `js`/`both` package, a method-less, non-struct, non-alias named type in `JS_BUILTIN_CLASSES` is added (the only kind the checker lets through, F2). `goTypeName` (`src/backend/shared/fmt-types.js`) also formats `Name$$pkg` as `pkg.Name`. The PR #207 prerequisites come first (Tasks 9.1, 9.2). Function-local types keep `__L<n>` (`js-codegen-fixes` Task 5.1).
- **F3:** the renamer treats a local whose name equals a package-level type that emits a class (struct, or `_isPlainNamedBox`/methods) like a shadowed global. It is suffixed `$`, so `T.$Dbl` keeps naming the class. This uses the same `_shadowsGlobal` mark and `jsBindingName` path as C2.
- **F6:** class-declaring and class-referencing sites (`genStruct`, `genNamedTypeClass`, the `$Ptr` class, `Object.defineProperty(${name}…)`, `_hoistLocalClass` in `src/backend/js/index.js`, and `new`, `instanceof`, `_typeNameCheckExpr`, `_namedBoxInfo`, `_zeroForNamedType`, `_genStructClone` in `src/backend/js/expressions.js`) apply `JS_RESERVED` `$`-escaping consistently while keeping `structNames`/`structFields` lookups on the unmangled type name.
- **F7:** `new` checks the argument's checker type first. A `typeParam` gets its zero from the instance's `$z_<T>` parameter (as `var x T` does), and only a non-type-parameter `TypeName` reaches `structNames`.
- **F9–F13 (assignment order):** this extends the C6 rule from `js-codegen-fixes`. When an assignment has a call anywhere, target operands are evaluated in source order, then each right-hand side once, then the stores. Blank targets still evaluate their right side. Comma-ok forms (`v, ok = x.(T)`, `v, ok = m[k]`) hoist target operands before the right side on both backends. A `*p` target whose base needs a nil check (or is a struct pointer on JS, which is the struct instance itself rather than a `{ value }` box) evaluates the right-hand sides into temporaries and writes into the nil-checked target (`Object.assign` for structs) rather than using `*p` as a destructuring target. Without calls, the output stays byte-identical.
- **F12:** when the right-hand side of `op=` contains a call, the value is bound first (`const r = rhs; x = x op r`) on every target and in both the strict and non-strict JS paths. Go's oracle shows the target is read *after* the call (`202`). Without a call the output is unchanged.
- **F14:** an alias whose right side is an anonymous struct is excluded from `structNames` (`_collectStructNames` checks `!d.isAlias`) and emits no class in `_genTypeDeclBody`. Zero values and composite literals of the alias use the anonymous-struct path (`_genAnonStructLit`/zero object), and `wasm` resolves the alias to its anonymous struct type before building the zero value.
- **F15/F16:** `_cloneJs` resolves a field's underlying type (defined arrays, embedded structs, type-parameter arrays via `__vclone`) before deciding to copy it. Type-switch bindings and range-over-func yielded values of value type go through `_cloneJs`. In `HELPER_VCLONE`, the top-level guard checks `!isShape(zero)` (instead of `!isObj(zero)`) so top-level Go maps (`__nm()` / `__nilmap` zero) are returned as-is while typed arrays continue to copy with `.slice()`.
- **F17/F25/F28:** these are fixes inside `wasm`'s anonymous-struct layout and map-key resolution. `toWasmType`, `goTypeKey` and `_resolveStructInfo` build anonymous struct fields from `t._structFields` (Declared fields only, preserving `f.embedded` and excluding promoted entries from `t.fields`), and `getAnonStructType` populates `embeds` so both literals and promoted selectors use the same WasmGC layout. In `src/backend/wasm/emit-maps.js`, `_structInfoForGoType` falls back to `this._resolveStructInfo({ _type: goType })` when `_resolveStructType` returns `null` for an anonymous struct key (array fields inside the struct are already hashed and compared recursively by `emitKeyHash`/`emitKeyEq`).
- **F31/F24/F8 (`wasm` monomorph):** this follows the PR #207 design notes. `rawTypeKey` gets a struct case (`st{A:arr2_int}` escaped so `_` and `:` stay distinct). `typeToTypeNode` returns a `StructType` with embedded names. `cloneAst` keeps `_structFields`, and `substituteInType` gets struct and pointer-in-paren cases (F8: `(*T)(nil)` keeps the substituted `T`).
- **F19/F22:** a slice bound of 64-bit type is compared as `i64` against the length/cap before it is wrapped. Unsigned `i32` bounds and indexes are zero-extended (`i64.extend_i32_u`) when passed to the panic helpers, and `_isI32IndexExpr` excludes `uint32` so `_ = xs[u32]` does not take the sign-extending `oob32` path.
- **F20/F21:** the host message is built by type before `emitPanicThrow`. `bool` gives `"true"`/`"false"`, unsigned 64-bit is converted as unsigned, and an `error` value uses the result of its `Error()` method (calling it the way `recover` printing does). `panic(nil)` (or `panic(a)` where `a` is a nil interface) on `wasm` panics with a synthesised runtime struct (`PANIC_NIL_STRUCT`) whose `Error()` is `"panic called with nil argument"` and whose `GofrontTypeName()` is `"*runtime.PanicNilError"` (so `fmt`'s `%T` and `%v` print `*runtime.PanicNilError panic called with nil argument`). `js`/`both` stay at `<nil>` because nil slices, functions and interfaces share `null` at run time on JS and changing `panic(nil)` there would alter existing output; the `defer`/`recover()` row in `docs/go-compatibility.md` documents this.

### 2. Invariants & Safety Bounds
- A program that compiles and runs correctly on the current branch prints the same output, except for the `$`/`$$pkg` names visible from hand-written JS (documented). The only new compile errors are F5/F29 on `wasm` packages.
- Emitted JS for programs without the affected names, calls in assignment operands, or affected anonymous-struct shapes is byte-identical. The bundle-size, zero-alloc and BCE gates are unchanged.
- `JS_BUILTIN_CLASSES` does not grow, and no type declaration that compiles today is rejected.

### 3. Edge Cases & Error Handling
- **F1:** an alias import (`import z "nope/zzz"`) binds `z`. A blank import binds nothing and still warns only when used by name (today it does not warn; unchanged). A path whose last element is not an identifier (`"nope/zz-z"`) uses the sanitised name.
- **F5:** `util.Ä()`-style non-ASCII uppercase stays exported (use `/\p{Lu}/u`).
- **F3:** a parameter or named result named after a type, and a type-switch binding `T := x.(type)`.
- **F6:** `%T` and `fmt` still print `main.yield`. A local type named `yield` takes the `__L` rename, so no `$` is needed there.
- **F12:** compound assignment to a map element (`m[k] += f()`) and to a field through a pointer keep evaluating the target operands before the call (C6 order). Only the *read* of the target moves after the call.
- **F14:** an alias of an alias (`type U = T`), and a generic struct field of the alias type.
- **F30:** a type renamed both by collision and by built-in name gets one `$$pkg` (no `$$util$$util`). `errors.As` into the renamed type, and promoted methods, must survive `pruneStdlibPrograms`.
- **F31:** the same anonymous struct written twice, or through an alias, shares one instance. Different ones get distinct instances.

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
  - Test: `test/unit/types/generics.test.js` with `assertJsTargetsOutput` (Phase 7 adds `wasm`): the F23 repro → `0 `, nested `Outer[Box[struct{ X int }]]` vs `Outer[Box[struct{ S string }]]`, and the same `struct{ X int }` written twice shares one instance (`a = Box[struct{ X int }]{}` assignable)
  - Done when: all pass on `js`/`both`

### Phase 2: Package boundaries (F1, F5, F29)
- [ ] Task 2.1: An untyped npm import is a dynamic `any` value (F1)
  - Files: `src/compiler.js` (`resolveImports`: bind the local name for `null` entries and defer untyped npm import rejection on `wasm`/`both` to `Ident` lookup), `src/typechecker/index.js` (helper defining a JS-dynamic global value), `src/typechecker/expressions.js` (`Ident` reports untyped npm imports via `_errJsOnly` on `wasm`/`both`), `test/unit/helpers.js` (`compile` binds `null` entries from `resolveAll`), `docs/usage.md` (*Vendoring npm packages*: an import without types is a dynamic global named after the package)
  - Test: `test/unit/compiler/stdlib-go.test.js`: `import "nope/zzz"; func main() { zzz.F() }` compiles with the warning, and the JS calls `zzz.F()`; `import z "nope/zzz"` binds `z`; on `forceTarget` `wasm` → `assertErrorContains(errors, "zzz")` with the JS-only message
  - Done when: all pass; the existing `nope/zzz` warning test is unchanged
- [ ] Task 2.2: `wasm` packages reject unexported and `__` members from other packages (F5, F29)
  - Files: `src/typechecker/resolve.js` (`_namespaceMemberError` uses Go's uppercase rule for `wasm` namespaces; `fieldType` and `_fieldTypeStruct` reject unexported methods on types owned by another `wasm` package)
  - Test: `test/unit/types/shadowing.test.js` with `compileHybridProject`: F5 → `assertErrorContains(…, "cannot refer to unexported name util.__Answer")`; F29 → `"cannot refer to unexported method twice"`; controls: the same two from a `js` and a `both` package still print `42`/`14`, and `util.New(7).m` from `wasm` prints `3`
  - Done when: all pass

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

### Phase 6: `wasm` anonymous struct layout (F17, F25, F28)
- [ ] Task 6.1: Anonymous struct WasmGC field list uses declared fields and records embeds (F25)
  - Files: `src/backend/wasm/types.js` (`toWasmType` and `goTypeKey` read `t._structFields` and preserve `f.embedded`), `src/backend/wasm/emit.js` (`_resolveStructInfo` reads `t._structFields` and preserves `f.embedded`), `src/backend/wasm/module-emitter.js` (`getAnonStructType` populates `embeds` for embedded struct fields)
  - Test: `test/unit/wasm/structs.test.js` with `assertProgramOutput`: F25 → `5 2`; `assertValidWasm` on the module
  - Done when: passes
- [ ] Task 6.2: Keyed and positional embedded fields in anonymous struct literals (F17)
  - Files: `src/backend/wasm/emit-exprs.js` (`emitCompositeLit` keyed and positional embedded elements with the Task 6.1 layout)
  - Test: `test/unit/wasm/structs.test.js` with `assertProgramOutput`: F17 → `5 5 6`; positional form `{P{5}, 6}` → `5 5 6`
  - Done when: both pass
- [ ] Task 6.3: Map keys that are anonymous structs with array fields (F28)
  - Files: `src/backend/wasm/emit-maps.js` (`_structInfoForGoType` falls back to `this._resolveStructInfo({ _type: goType })` for anonymous struct keys)
  - Test: `test/unit/wasm/map-keys.test.js` with `assertProgramOutput`: F28 → `10`; a second key differing only in `A[1]` misses
  - Done when: both pass

### Phase 7: `wasm` generics over anonymous structs (F8, F24, F31)
- [ ] Task 7.1: Struct type keys and type nodes in monomorph (F31, F24)
  - Files: `src/backend/wasm/monomorph.js` (`rawTypeKey` struct case, `typeToTypeNode` `StructType` with embedded names), `src/backend/wasm/module-emitter.js` (`getAnonStructType` name escaping keeps `_` and `:` distinct)
  - Test: `test/unit/wasm/generics.test.js` with `assertProgramOutput`: F31 → `0 1`; F24 → `4`; `dup` → `0 1 0`; alias `type S = struct{ A [2]int }` with `id(struct{ N int }{3})` → `0 1 3`; two different anonymous type arguments of one generic; `struct{ A_int int }` vs `struct{ A int }` stay distinct
  - Done when: all pass; switch the `js-codegen-fixes` Task 3.2 cases in `value-semantics.test.js` and the Task 1.3 cases to `assertAllTargetsOutput`
- [ ] Task 7.2: Nested generics and embedded fields (F31 design notes)
  - Files: `src/backend/wasm/monomorph.js` (`cloneAst` keeps `_structFields`; `substituteInType` struct case)
  - Test: `test/unit/wasm/generics.test.js`: `outer[T]` calling `inner(struct{ A T }{A: x})` → no `structFieldList is not a function` crash and Go's output; `keep(struct{ P; K int }{…})` → valid WasmGC and Go's output
  - Done when: both pass
- [ ] Task 7.3: `(*T)(nil)` inside a generic function (F8)
  - Files: `src/backend/wasm/monomorph.js` (substitution through a parenthesised pointer conversion type)
  - Test: `test/unit/wasm/generics.test.js` with `assertProgramOutput`: F8 with `T` and with `Proxy` → `0`; `(*T)(&x)` → `1`
  - Done when: all pass

### Phase 8: `wasm` panics and bounds (F19–F22)
- [ ] Task 8.1: 64-bit slice bounds are checked before narrowing (F19)
  - Files: `src/backend/wasm/emit-exprs.js` (`emitSliceExpr` and `_emitSliceBound` compare `i64` bounds before narrowing to `i32`)
  - Test: `test/unit/compiler/strict-panics.test.js` with `assertProgramOutput`: F19 → `runtime error: slice bounds out of range [:4294967296] with capacity 3`; string `s[:n]` with `n = 1<<32`
  - Done when: both pass; `int` bounds below 2³² emit the same code
- [ ] Task 8.2: Unsigned 32-bit bounds and indexes print unsigned (F22)
  - Files: `src/backend/wasm/emit-exprs.js` (`_emitSliceBoundsPanic` and index-panic call sites zero-extend unsigned operands; `_isI32IndexExpr` excludes `uint32` from the sign-extending `oob32` path)
  - Test: `test/unit/compiler/strict-panics.test.js` with `assertProgramOutput`: both F22 lines
  - Done when: both pass
- [ ] Task 8.3: Uncaught `wasm` panics carry Go's text for `bool`, unsigned and `error` values (F20)
  - Files: `src/backend/wasm/emit-builtins.js` (`_emitBuiltinPanic`/`_emitScalarPanic` build the host message per type; `error` via `Error()`), `src/backend/wasm/boundary.js` (`panic` import keeps the passed string)
  - Test: `test/unit/wasm/defer_recover.test.js`: uncaught `panic(true)`, `panic(uint64(1)<<63)`, `panic(errors.New("bad"))` from a `wasm` export throw `Error` with message `true` / `9223372036854775808` / `bad`; `recover()` values unchanged
  - Done when: all pass
- [ ] Task 8.4: `panic(nil)` on `wasm` panics with `*runtime.PanicNilError` (F21)
  - Files: `src/backend/wasm/types.js` (`PANIC_NIL_STRUCT`), `src/backend/wasm/prescan.js`, `src/backend/wasm/module-emitter.js` (register `PANIC_NIL_STRUCT` with `Error() string` and `GofrontTypeName() string`), `src/backend/wasm/index.js` (runtime helper methods), `src/backend/wasm/emit-builtins.js` (`_emitBuiltinPanic` for `nil` and nil interface arguments, `emitRuntimeHelper`, `_emitTypeAssertFail`), `docs/go-compatibility.md` (`defer`/`recover()` row: `panic(nil)` on `wasm` vs `js`/`both`; runtime-panics row: 64-bit and unsigned bounds)
  - Test: `test/unit/wasm/defer_recover.test.js` with `assertWasmProgramOutput`: F21 (`panic(nil)` and `var a any; panic(a)`) → `*runtime.PanicNilError panic called with nil argument`; `js`/`both` output unchanged (`<nil> <nil>`)
  - Done when: both pass

### Phase 9: Package-level type names after JS built-ins (F2, F30)
- [ ] Task 9.1: Generated Go resolves renamed types through same-package, aliased and indirect imports (F30 prerequisite)
  - Files: `src/lower/gen-types.js` (`spellNamed`), `src/lower/fmt-formatters.js` (`FmtGen.isNamedInScope`), `src/link/stdlib.js` (`checkGeneratedGo` binds non-stdlib `$$`-renamed types under their qualifier)
  - Test: `test/unit/types/shadowing.test.js` with `compileHybridProject`: `import u "./util"; fmt.Printf("%T", u.Make(5))` with a `$$`-renamed `Box` → `util.Box`; the same through a package that re-exports the value
  - Done when: passes (no `Unknown type 'util.Box'`)
- [ ] Task 9.2: `pruneStdlibPrograms` keeps renamed user types (F30 prerequisite)
  - Files: `src/link/wasm.js` (`pruneStdlibPrograms` drops only unreachable stdlib `TypeDecl`s and keeps `$$` user types when stdlib programs are linked)
  - Test: `test/unit/types/shadowing.test.js` with `compileHybridProject`: a `wasm` package and the js main both declare `Box` (renamed `Box$$util` today), the `wasm` package imports `fmt` and `errors`; `var m Box; m.N = 42; fmt.Println(m.N)`, `errors.As` into the type, and a promoted method all print Go's output
  - Done when: passes (fails first with the null deref from the PR #207 notes)
- [ ] Task 9.3: Rename `wasm` types and method-less `js`/`both` named types after JS built-ins to `Name$$pkg` (F2, F30)
  - Files: `src/link/type-names.js` (`mangleCollidingTypes` takes the built-in names and the package target), `src/compiler.js` (compute `pkgTarget` before `mangleLocalTypes` and pass it), `src/backend/shared/fmt-types.js` (`qualify` formats `Name$$pkg` as `pkg.Name`), `docs/go-compatibility.md` (*Names that shadow JS globals*: `WeakMap$$util` in the facade and `Map$$main` for method-less named types; struct/method types in `js`/`both` keep the error)
  - Test: `test/unit/types/shadowing.test.js`: `h05` (F30) → `3 2` with the facade defining `class WeakMap$$util` and `%T` printing `util.WeakMap`; F2 → `5` on every target with `%T` `main.Map`; a second package also declaring `WeakMap` (no `$$util$$util`); a function-local `type Map` still gets `__L<n>`; the existing `type Array struct{}` rejection tests stay green
  - Done when: all pass; programs without such types emit the same JS
