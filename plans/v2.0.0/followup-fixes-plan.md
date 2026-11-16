# v2.0.0 Review Follow-ups (2026-11-16): `wasm` and Package Names — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Split off from [`../v1.9.3/follow-ups-2026-11-16-plan.md`](../v1.9.3/follow-ups-2026-11-16-plan.md), which keeps the JavaScript miscompile fixes (its Phases 1–5). Start after [`checker-strictness-plan.md`](checker-strictness-plan.md) merges and before [`web-platform-evolution-plan.md`](web-platform-evolution-plan.md) Phase 3 (`PackageCache`), which restructures `src/compiler.js`. Phase 3 here needs the v1.9.3 Task 1.3 (`instanceKey`) merged. The deferred Tasks 5.2 and 5.4 of [`../v1.9.3/js-codegen-fixes-plan.md`](../v1.9.3/js-codegen-fixes-plan.md) are scheduled here as Phases 5 and 3. Rejecting unexported or `__` names of `js`/`both` packages stays with [`checker-strictness-plan.md`](checker-strictness-plan.md) (see the Excluded rows).  
**Release note:** More valid Go runs correctly on WebAssembly. Generic code over anonymous structs and `(*T)(nil)` compile, anonymous structs with embedded fields and as map keys work, and uncaught panics match Go more closely: `panic(nil)`, large slice bounds, and the messages of `bool`, unsigned and `error` panics. Types named after JavaScript built-ins such as `Map` or `WeakMap` now work in more places, and anonymous struct types, struct tags in type arguments and conversions through type aliases now parse and compile wherever Go allows them. **Breaking:** `wasm` packages now reject cross-package references to unexported or `__` names, which never worked at run time; export the name or reference it from inside its package. **Breaking:** an import now applies only to the file that declares it, as in Go, and an unused npm import is an error like any other unused import; add the import to each file that uses the package and remove unused ones.  

---

## Goal

Fix the 14 review follow-ups (F2, F5, F8, F17, F19–F22, F24, F25, F28–F31) that were moved out of the v1.9.3 follow-ups plan on 2026-11-16. They were re-probed that day against `feat/js-codegen-fixes` at `5e83fc3f` with the evidence and method recorded in *Verified Gaps*. Most are `wasm` parity gaps; F2 and F30 are package-level type names that shadow JavaScript built-ins, and F5 and F29 are `wasm`-only cross-package references that throw at run time and now become compile errors. Moving them to v2.0.0 lets them land on the hardened test harness (`WebAssembly.validate`, line:col diagnostics) and lets F5/F29 and F2/F30 follow the v2.0.0 rule that backward compatibility is not a goal, without keeping the v1.9.3-only asymmetries.

Phases 6–8 add the 14 entries left in `plans/follow-ups.md` on 2026-11-16 (L1–L14), re-probed that day against `feat/follow-ups-2026-11-16` at `2b4f619` (*Review follow-ups (2026-11-16, ledger sweep)*): front-end gaps around anonymous struct types and local type scope (Phase 6), npm imports and package scope, including file-scoped imports (Phase 7, **breaking** for stdlib imports used from a file that does not import them), and `wasm` facade, method-expression and generics gaps plus JS `new` of an anonymous struct (Phase 8). The assignment and value-semantics entries went to [`assignment-semantics-plan.md`](assignment-semantics-plan.md) the same day.

**Done means:**
- Every repro F2, F5, F8, F17, F19–F22, F24, F25 and F28–F31 in *Verified Gaps* (except the `Excluded` parts) prints Go 1.26.0's output, or gives the stated compile error, on every target its test names. Each is a test in the file named by its task.
- Every repro L1–L14 (and its controls) in *Review follow-ups (2026-11-16, ledger sweep)* prints Go's output or gives the stated error on the targets its task names; `npm run check` (`gofront check example/...`) and the stdlib build pass after L10 makes imports file-scoped.
- `npm test` passes, and `test/perf/zero-alloc.js`, `bce-mathx.js` and `bundle-size.js` pass with `bundle-size.baseline.json` unchanged.
- `test/unit/compiler/js-globals.test.js` (the rename-set registry test) passes unmodified, apart from new names added to `JS_RESERVED` handling.
- `docs/go-compatibility.md` (*Names that shadow JS globals*, the `defer`/`recover()` row, the runtime-panics row) describes the new behaviour.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Valid Go whose package-level type is named after a JS built-in and is miscompiled or crashes | F2 | |
| **In scope: target-specific** | `wasm` parity gaps and `wasm`-only boundary errors | F5, F8, F17, F19–F22, F24, F25, F28–F31; F5/F29 become compile errors only when the member belongs to a `wasm` package | |
| **In scope: core** | Front-end gaps: valid Go around anonymous struct types and local type scope that fails to parse or check, or collides | L1–L5 (Phase 6) | |
| **In scope: core** | Import and package scope as Go defines it: unused untyped imports on every target (as typed and stdlib imports already are) and dot untyped imports in `wasm`/`both`, qualified names on JS-dynamic values, exports limited to declared names, file-scoped imports (**breaking**) | L6–L10 (Phase 7); `example/simple/src/main.go` and `store.go` gain the imports they use from sibling files | |
| **In scope: target-specific** | `wasm` facade/method-expression/monomorph gaps and JS `new` of an anonymous struct | L11–L14 (Phase 8) | |
| **Excluded: deferred** | Rejecting assignment between distinct generic instances over different anonymous structs | `a := Box[struct{ X int }]{}; var b Box[struct{ S string }] = a` compiles (js `{{undefined}}`, probe `5b`) | The instances are distinct objects already; accepting the assignment is the identity rule `checker-strictness-plan.md` (S1, `identical` over instances) owns. L5 here only makes func/interface type arguments produce distinct instances, so that rule can then reject them |
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

### Review follow-ups (2026-11-16, ledger sweep)

**Method.** The 14 entries left in `plans/follow-ups.md` after the assignment entries moved to `assignment-semantics-plan.md`, re-probed on 2026-11-16 against `feat/follow-ups-2026-11-16` at `2b4f619` (go1.26.10). A throwaway driver (`.probes/fu/run.mjs`, deleted) wrote each program into a temp directory (with `node_modules/<pkg>/index.d.ts` where needed), ran `compileDir` with `forceTarget` `js`/`both`/`wasm`, and ran the bundle in-process. All 14 reproduce; controls (suffix letters) widen several. `example/` and `stdlib/` were scanned for files using a sibling file's import (`.probes/fu/scan.py`, deleted): only `example/simple/src/main.go` (`errors`, `utils`) and `store.go` (`utils`).

| ID | Area | Finding | Evidence & probe |
|---|---|---|---|
| L1 | Conversion through an alias of a composite type | The conversion branch in `checkCall` (`src/typechecker/expressions.js:1768-1773`) only accepts a `named`, `pointer` or `basic` callee type; an alias resolves to `struct`/`slice`/`func`, so `A(x)` falls through to *Cannot call* or to a call check | `type A = struct{ X int }; type S struct{ X int }; u := A(S{1})` → all targets `Cannot call non-function type struct{...}`, want `{1}`. `1b` `A(u)` same; `1c` `type L = []int; len(L(nil))` → `Cannot call non-function type []int`, want `0`; `1d` `type F = func() int; F(g)()` → `Too many arguments: expected 0, got 1`, want `2` (phase-1 branch) |
| L2 | Struct tag inside generic type arguments | The type-argument lookaheads reject any `STRING` token inside the brackets, including a struct tag inside `{…}`: `_looksLikeTypeArgListInType` (`src/parser/types.js:62-85`, no brace tracking) for package-level types, `looksLikeTypeArgList` (`src/parser/expressions.js:302-333`) for local ones | `type Box[T any] struct{ V T }; var c Box[struct{ X int \`json:"x"\` }]` → `Parse error at 6:10: Expected top-level declaration (got [ "[")`, want `0`; `2c` local `var c Box[…]` → `expected '{' (got ] "]")`. Without the tag (`2b`) js/both print `0` (wasm fails like F31) (phase-1 branch) |
| L3 | Parenthesised type literal as an expression | `parseOperand`'s `(` branch (`src/parser/expressions.js:499-503`) calls `parseExpr`, which only takes a type literal followed by `{` (composite) or `(` (conversion) | `u := (struct{ A [2]int })(s)` → `expected '{' (got ) ")")`, want `{[0 0]}`; `3c` `([]int)(nil)` → same; `14d` `new(struct{ A [2]int })` → same, want `0`. Control `3b` `struct{ A [2]int }(s)` works (phase-1 branch) |
| L4 | Function-local type named after an import | `renameLocalTypes` (`src/link/type-names.js:47`) renames a local type that clashes with a `reserved` name; the set built in `src/compiler.js` (~`:665-676`) holds package-level values and other packages' type names but not import names, so the local `strings` replaces the import package-wide | `func other() int { type strings = int; …}; func main() { fmt.Println(other(), strings.ToUpper("ab")) }` → `int has no field or method 'ToUpper'`, want `3 AB`; `4b` `type strings int` → `strings has no field or method 'ToUpper'` (phase-1 branch) |
| L5 | Generic instances over func/interface types with anonymous structs | `instanceKey` (`src/typechecker/resolve.js:124-143`) has a struct case but `func`/`interface` fall to `typeStr`, which prints `struct{...}`, so `Box[func(struct{ X int })]` and `Box[func(struct{ S string })]` are one instance | `a := Box[func(struct{ X int })]{V: …}; var b Box[func(struct{ S string })] = a; b.V(struct{ S string }{"hi"})` → js/both `-9223372036854775808`, wasm `Cannot assign func(struct{...}) void to func(any) void`; want a compile error. With distinct instances the assignment is still accepted until `checker-strictness-plan.md` lands (`5b`, Excluded row) (phase-1 branch) |
| L6 | Unused or dot untyped npm import | Untyped imports are bound as dynamic globals (`bindUntypedImports`, `src/resolver.js:121`) and never registered with `trackImport`; in `wasm`/`both` the import check skips them (`src/compiler.js:237-239`, "deferred to Ident lookup") | `//gofront:target wasm` `import "nope/zzz"; func main() { println("ok") }` → compiles (prints `ok`), want `'zzz' imported and not used`; `6b` `import . "nope/zzz"` → compiles, want `js: imports are not allowed in wasm packages`; `6c` the same unused import in a `js` package compiles, while `6d` unused `import "strings"` is rejected (PR #210) |
| L7 | Qualified type from an untyped import in `wasm` | Type positions resolve `zzz.T` before the untyped-import check, so the error is `Unknown type` | `import "nope/zzz"; var x zzz.T` (wasm) → `Unknown type 'zzz.T'`, want `'zzz' is only available in js packages` (PR #210) |
| L8 | Package exports leak imported names | `getExportedSymbols` (`src/typechecker/index.js:244-251`) exports every uppercase global, including `.d.ts` values bound into the package's globals (`_externalNames`) | `sub/sub.go` `import "mydep"; func Use() any { return Bar }` (`export declare const Bar: number;`), main `import "./sub"; println(sub.Bar)` → js compiles, then `ReferenceError: Bar is not defined`; want a compile error (`sub` has no `Bar`) (PR #210) |
| L9 | Composite literal of a qualified name on a JS-dynamic value | The checker accepts `console.T{}` (a selector on the dynamic `console`), so `js`/`both` emit it and `wasm` throws in `emitCompositeLit` (`src/backend/wasm/emit-exprs.js:523`) | wasm `_ = console.T{}` → `Error: Unknown struct in CompositeLit: any`; `9c` js/both compile silently; want a type error. `9b` `var x console.T` already reports `Unknown type 'console.T'` (PR #210) |
| L10 | Imports are package-wide | Imports (typed, stdlib and untyped) are bound in the package's `globals`, not per file | `a.go` `import "nope/zzz"; func f() { zzz.F() }`, `b.go` `func main() { zzz.G() }` → js compiles (`ReferenceError: zzz is not defined` at run time), want `Undefined: 'zzz'` in `b.go`; `10b` `strings` imported only in `a.go` and used in `b.go` → all targets print `b A`, Go: `undefined: strings`. Affects `example/simple` (scan above) (PR #210) |
| L11 | `wasm` type parameter named like a package struct, instantiated with an anonymous struct | F31's erased `$val` instance plus the parameter name: after substitution `new(S)` and `.X` resolve the package `S` | `type S struct{X int}; func f[S any](v S) *S { return new(S) }; fmt.Println(f[struct{ X int }](struct{ X int }{}).X)` (wasm) → `Cannot resolve struct for selector: X`, want `0`; `11b` `*f[struct{ X int }](…)` with `T` → `cannot use *f$val(expression) (value of type any) as struct{...} value in argument`, want `{0}` (phase-3 branch) |
| L12 | Facade class name that is a strict-mode reserved word | `facadeName` (`src/backend/wasm/boundary.js:2237`) only escapes JS global names (`shadowsJsGlobal`), and the struct class template (`:2823` `class ${name}`) does not call it; `JS_RESERVED` lives in `src/backend/js/names.js`, which `wasm` may not import | `//gofront:target wasm` `type yield struct{ X int }; func (y *yield) IsNil() bool …; type Outer struct{ *yield }; var o Outer; fmt.Println(o.IsNil())` → `SyntaxError: Unexpected strict mode reserved word`, want `true`. `12b`/`12c` without the embedding print `0`/`true` (PR #211) |
| L13 | `wasm` method expression with an untyped `nil` receiver | `rewriteMethods` (`src/backend/wasm/method-expr.js:345-356`) passes the receiver argument through as is; an untyped `nil` has no struct type, so the selector cannot resolve | `type undefined struct{ X int }; func (u *undefined) IsNil() bool { return u == nil }; fmt.Println((*undefined).IsNil(nil))` (wasm) → `Cannot resolve struct for selector: IsNil`, want `true`; `13b` same with `type U`; `13c` `(*U).IsNil(&U{})`, `(*U).IsNil((*U)(nil))` → `false true` (PR #211) |
| L14 | JS `new(T)` of an anonymous struct | The `new` builtin (`src/backend/js/expressions.js:479-486`) returns a struct object only for a named struct; an anonymous one (through an alias) falls to the scalar box `{ value: zero }` | `type T = struct{ A [2]int }; p := new(T); fmt.Println(p.A[0])` → js/both `TypeError: Cannot read properties of undefined (reading '0')`, want `0`; `14b` `type T = struct{ N int }; new(T).N` → js/both `-9223372036854775808`, want `0`; wasm right. `14c` named struct right (PR #213) |

---

## Approach

### 1. Architecture & Design Decisions
- **F5/F29: reject only what never worked.** `_namespaceMemberError` treats a name as unexported unless its first letter is an uppercase Unicode letter (Go's rule), but only when the namespace is a `wasm` package. A selector of a method on a type declared in a `wasm` package, from another package (`fieldType` and `_fieldTypeStruct` in `src/typechecker/resolve.js`), is rejected when the method is unexported (`cannot refer to unexported method twice`). `js`/`both` behaviour and `wasm` unexported fields (which work) stay as they are.
- **F2/F30: one rename, `Name$$pkg`.** `mangleCollidingTypes` already gives a package-level type a `$$pkg` suffix, keeps `%T` as `util.Box`, and carries the suffix into the facade class. Phase 5 moves `pkgTarget` computation ahead of `mangleLocalTypes` in `src/compiler.js` and adds two kinds of type to `renamed`. In a `wasm` package, a non-alias type named in `JS_BUILTIN_CLASSES` is added. In a `js`/`both` package, a method-less, non-struct, non-alias named type in `JS_BUILTIN_CLASSES` is added (the only kind the checker lets through, F2). `goTypeName` (`src/backend/shared/fmt-types.js`) also formats `Name$$pkg` as `pkg.Name`. The PR #207 prerequisites come first (Tasks 5.1, 5.2). Function-local types keep `__L<n>` (`js-codegen-fixes` Task 5.1).
- **F17/F25/F28:** these are fixes inside `wasm`'s anonymous-struct layout and map-key resolution. `toWasmType`, `goTypeKey` and `_resolveStructInfo` build anonymous struct fields from `t._structFields` (Declared fields only, preserving `f.embedded` and excluding promoted entries from `t.fields`), and `getAnonStructType` populates `embeds` so both literals and promoted selectors use the same WasmGC layout. In `src/backend/wasm/emit-maps.js`, `_structInfoForGoType` falls back to `this._resolveStructInfo({ _type: goType })` when `_resolveStructType` returns `null` for an anonymous struct key (array fields inside the struct are already hashed and compared recursively by `emitKeyHash`/`emitKeyEq`).
- **F31/F24/F8 (`wasm` monomorph):** this follows the PR #207 design notes. `rawTypeKey` gets a struct case (`st{A:arr2_int}` escaped so `_` and `:` stay distinct). `typeToTypeNode` returns a `StructType` with embedded names. `cloneAst` keeps `_structFields`, and `substituteInType` gets struct and pointer-in-paren cases (F8: `(*T)(nil)` keeps the substituted `T`).
- **F19/F22:** a slice bound of 64-bit type is compared as `i64` against the length/cap before it is wrapped. Unsigned `i32` bounds and indexes are zero-extended (`i64.extend_i32_u`) when passed to the panic helpers, and `_isI32IndexExpr` excludes `uint32` so `_ = xs[u32]` does not take the sign-extending `oob32` path.
- **F20/F21:** the host message is built by type before `emitPanicThrow`. `bool` gives `"true"`/`"false"`, unsigned 64-bit is converted as unsigned, and an `error` value uses the result of its `Error()` method (calling it the way `recover` printing does). `panic(nil)` (or `panic(a)` where `a` is a nil interface) on `wasm` panics with a synthesised runtime struct (`PANIC_NIL_STRUCT`) whose `Error()` is `"panic called with nil argument"` and whose `GofrontTypeName()` is `"*runtime.PanicNilError"` (so `fmt`'s `%T` and `%v` print `*runtime.PanicNilError panic called with nil argument`). `js`/`both` stay at `<nil>` because nil slices, functions and interfaces share `null` at run time on JS and changing `panic(nil)` there would alter existing output; the `defer`/`recover()` row in `docs/go-compatibility.md` documents this.
- **L2/L3 (parser):** both type-argument lookaheads count `{`/`}` and only reject literals at brace depth 0, so a tag inside a struct field list is part of the type. In operand position, `(` followed by a type literal (`struct`, `[`, `map`, `chan`, `func` without a body, `*`, `interface`) parses the type, expects `)`, and yields a `TypeExpr` that the following `(`/`{` turns into a conversion or composite literal; `new(<type literal>)` uses the same type parse. Parenthesised value expressions are unchanged.
- **L1 (conversions):** the conversion branch keys on `expr.func._isTypeRef` alone: any type the callee names (alias or not, any kind) is a conversion checked by `_checkConversionValidity`. Interface and type-parameter callees keep their existing branches above it.
- **L4 (local types):** `renameLocalTypes` also reserves every import name of the package's files, so a local `type strings …` becomes `strings__L<n>` and the import stays visible elsewhere.
- **L5 (instance keys):** `instanceKey` gains `func` (params, results, variadic, each through `instanceKey`) and `interface` (sorted method names with `instanceKey` signatures, embedded names) cases, so instances over different anonymous structs inside func or interface type arguments are distinct objects.
- **L6/L7/L10 (imports):** imports become file-scoped. The checker keeps a per-file import scope (`Map<filename, Map<name, binding>>`) between the package `globals` and the universe; package qualifiers, typed `.d.ts` namespaces and untyped dynamic globals are bound there instead of in `globals`, so a name imported only by another file is `Undefined`. Every import (untyped included) goes through `trackImport`, so an unused untyped import is `'zzz' imported and not used` on every target. In `wasm`/`both`, a dot import of an untyped package and any qualified type from one report the existing messages (`js: imports are not allowed in wasm packages`, `'zzz.T' is only available in js packages`).
- **L8 (exports):** `getExportedSymbols` skips `_externalNames` (imported `.d.ts` values and untyped globals), so a package exports only what it declares.
- **L9:** a composite literal whose type is a selector on a value (not a package namespace) is a type error on every target: `console.T is not a type`.
- **L11:** follows F31 (Phase 3): monomorph substitutes the type parameter before resolving names, so a parameter `S` shadows the package type `S` in `new(S)` and selectors, and `*f[struct{…}](…)` gets a struct instance instead of `$val`.
- **L12:** `JS_RESERVED` moves to `src/backend/shared/member-names.js` (re-exported from `src/backend/js/names.js` so JS callers do not change); `facadeName` escapes reserved words as well as globals, and every facade `class`/helper name goes through it.
- **L13:** when a method expression's receiver argument is untyped `nil`, `rewriteMethods` wraps it in a conversion to `_methodExprRecv` before building the call.
- **L14:** `new(T)` of any struct type (named or anonymous) returns the struct's zero value object, as `zeroValueForType` builds it for an anonymous struct, never the `{ value }` scalar box.

### 2. Invariants & Safety Bounds
- A program that compiles and runs correctly today prints the same output, except for the `$$pkg` names visible from hand-written JS (documented), the new F5/F29 compile errors on `wasm` packages, and the L6/L10 import errors (unused untyped imports, names imported only by another file).
- Emitted JS for programs without the affected names or `wasm` shapes is byte-identical. The bundle-size, zero-alloc and BCE gates are unchanged.
- `JS_BUILTIN_CLASSES` does not grow, and no type declaration that compiles today is rejected.

### 3. Edge Cases & Error Handling
- **F5:** `util.Ä()`-style non-ASCII uppercase stays exported (use `/\p{Lu}/u`).
- **F30:** a type renamed both by collision and by built-in name gets one `$$pkg` (no `$$util$$util`). `errors.As` into the renamed type, and promoted methods, must survive `pruneStdlibPrograms`.
- **F31:** the same anonymous struct written twice, or through an alias, shares one instance. Different ones get distinct instances.
- **L3:** `(x)(y)` where `x` is a value stays a call, and `(*p).f` stays a selector: only a type keyword or `[`/`*` that starts a type after `(` takes the type path; `(*T)(nil)` keeps working (it already parses).
- **L10:** a `_test.go` file imports what it uses too; the generated test main and generated Go (`gofront_gen.go`, fmt formatters) declare their own imports. Two files may import the same path under different names. Dot imports bind into the importing file only.
- **L10 migration:** `example/simple/src/main.go` gains `import "errors"` and `import "./utils"` and `store.go` gains `import "./utils"`; SimpleFPS and other user projects get the same `Undefined: 'pkg'` error per file, named in the breaking release note.
- **L12:** a struct named `yield` in a `js`/`both` package is unaffected (JS already renames it).

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

### Phase 6: Front end: anonymous struct types and local type scope (L1–L5)

> Scheduled from review follow-ups (`plans/follow-ups.md`, ledger sweep re-probed 2026-11-16).

- [ ] Task 6.1: Struct tags inside generic type arguments parse (L2)
  - Files: `src/parser/types.js` (`_looksLikeTypeArgListInType` tracks braces), `src/parser/expressions.js` (`looksLikeTypeArgList` rejects literals only at brace depth 0)
  - Test: `test/unit/parser/generics.test.js`: L2 at package level and as a local `var` print `0` with `assertJsTargetsOutput` (wasm joins after Phase 3, F31); `xs[i]` with a string index and `m["k"]` still parse as index expressions
  - Done when: all pass and the existing parser generics tests stay green
- [ ] Task 6.2: Parenthesised type literals in expressions and `new` (L3)
  - Files: `src/parser/expressions.js` (`(` + type literal → `TypeExpr`; `new(<type literal>)`)
  - Test: `test/unit/parser/generics.test.js` (or `test/unit/compiler/lexer-parser.test.js`): L3 `(struct{ A [2]int })(s)` → `{[0 0]}`, `([]int)(nil)` → `[]`, `new(struct{ A [2]int })` → `0` with `assertAllTargetsOutput`; controls `(f)(1)`, `(*p).f`, `(*T)(nil)` unchanged
  - Done when: all pass on every target
- [ ] Task 6.3: Conversions through any type the callee names (L1)
  - Files: `src/typechecker/expressions.js` (conversion branch keys on `_isTypeRef`)
  - Test: `test/unit/types/checks.test.js`: L1 → `{1}`, `1b` → `{1}`, `1c` → `0`, `1d` → `2` with `assertAllTargetsOutput`; negative: `type A = struct{ X int }; A(1)` → `assertErrorContains(…, "cannot convert")`
  - Done when: all pass; no `Cannot call non-function type` for a type callee
- [ ] Task 6.4: Instance keys for func and interface type arguments (L5)
  - Files: `src/typechecker/resolve.js` (`instanceKey` `func`/`interface` cases)
  - Test: `test/unit/types/generics.test.js`: `a := Box[func(struct{ X int })]{V: …}; a.V(struct{ X int }{1})` and `b := Box[func(struct{ S string })]{V: …}; b.V(struct{ S string }{"hi"})` in one program print `1` and `hi` on every target, and `fmt.Printf("%T", a)` ≠ `%T` of `b`; the same with `interface{ M(struct{ X int }) }` type arguments
  - Done when: the two instances are distinct on every target (the L5 assignment becomes an error with `checker-strictness-plan.md`'s identity rule; see the Excluded row)
- [ ] Task 6.5: Local types named after imports are renamed (L4)
  - Files: `src/compiler.js` (import names join the `reserved` set passed to `renameLocalTypes`)
  - Test: `test/unit/language/local-types.test.js`: L4 (alias) and `4b` (defined type) print `3 AB` on every target; a local `type strings` used inside its own function still works (`3`)
  - Done when: all pass

### Phase 7: Imports and package scope (L6–L10)
- [ ] Task 7.1: File-scoped imports (L10, **breaking**)
  - Files: `src/typechecker/index.js` (per-file import scope between `globals` and the universe; lookups use `_currentFile`), `src/resolver.js` (`bindUntypedImports` binds per file), `src/compiler.js` (namespaces and typed imports registered per file)
  - Test: `test/unit/compiler/imports.test.js` with `withTempDir` + `compileDir`: L10 → `assertErrorContains(…, "Undefined: 'zzz'")` at `b.go`; `10b` → `Undefined: 'strings'` at `b.go`; controls: both files import `strings` → `b A`; two files import the same path under different names; a `_test.go` file and the generated test main compile
  - Done when: all pass and `npm test` is green apart from `example/simple` (fixed in Task 7.2)
- [ ] Task 7.2: Migrate `example/simple` to file-scoped imports
  - Files: `example/simple/src/main.go`, `example/simple/src/store.go`
  - Test: `node src/index.js check example/...` (fails after 7.1 with `Undefined: 'errors'`/`'utils'` until the imports are added); the `example/simple` Playwright spec
  - Done when: `npm run check` and `npm run test:e2e` pass
- [ ] Task 7.3: Untyped npm imports are tracked like every import (L6, L7)
  - Files: `src/typechecker/index.js` (`defineUntypedImport` → `trackImport`), `src/compiler.js` (`wasm`/`both`: dot import of an untyped package → `js: imports are not allowed in wasm packages`), `src/typechecker/resolve.js` (qualified type from an untyped import in `wasm`/`both` → `_errJsOnly`)
  - Test: `test/unit/compiler/stdlib-go.test.js`: L6 → `'zzz' imported and not used` (wasm, both and `6c` js); `6b` → `js: imports are not allowed in wasm packages`; L7 → `'zzz.T' is only available in js packages`; the existing *rejected where it is used* tests stay green
  - Done when: all pass
- [ ] Task 7.4: Packages export only what they declare (L8)
  - Files: `src/typechecker/index.js` (`getExportedSymbols` skips `_externalNames`)
  - Test: `test/unit/compiler/packages.test.js` with `withTempDir` (a `node_modules/mydep` `.d.ts`): L8 → `assertErrorContains(…, "Bar")` (the existing missing-member message); control: `sub.Use()` and an exported `var Baz = 1` declared in `sub` still compile and print
  - Done when: all pass
- [ ] Task 7.5: Composite literal of a qualified name on a value is a type error (L9)
  - Files: `src/typechecker/expressions.js` (composite literal type check)
  - Test: `test/unit/types/checks.test.js`: L9 on `js`, `both` and `wasm` → `assertErrorContains(…, "console.T is not a type")`; control: `pkg.T{}` for an imported package type still compiles
  - Done when: all pass; no `Unknown struct in CompositeLit` from the emitter

### Phase 8: `wasm` facade, method expressions and generics; JS `new` (L11–L14)
- [ ] Task 8.1: Facade names escape strict-mode reserved words (L12)
  - Files: `src/backend/shared/member-names.js` (`JS_RESERVED` moves here), `src/backend/js/names.js` (re-export), `src/backend/wasm/boundary.js` (`facadeName` escapes reserved words; the struct `class` template uses it)
  - Test: `test/unit/wasm/boundary.test.js`: L12 → `true`; a `wasm` struct named `let` or `static` with a method used from the facade; `node scripts/check-layers.js` passes
  - Done when: all pass and `test/unit/compiler/js-globals.test.js` passes unmodified
- [ ] Task 8.2: Method expressions with an untyped `nil` receiver (L13)
  - Files: `src/backend/wasm/method-expr.js` (`rewriteMethods` converts an untyped `nil` receiver to `_methodExprRecv`)
  - Test: `test/unit/wasm/pointers.test.js`: L13 and `13b` → `true`; `13c` → `false true`; a method expression stored in a variable and called with `nil`
  - Done when: all pass on wasm and js/both print the same
- [ ] Task 8.3: Type parameters that share a package type's name (L11; after Phase 3)
  - Files: `src/backend/wasm/monomorph.js` (substitution before name resolution inside the instance body)
  - Test: `test/unit/wasm/generics.test.js`: L11 → `0`, `11b` → `{0}` with `assertAllTargetsOutput`; the L2 `Box[struct{ X int }]` case from Task 6.1 moves to `assertAllTargetsOutput`
  - Done when: all pass on every target
- [ ] Task 8.4: JS `new` of an anonymous struct type (L14)
  - Files: `src/backend/js/expressions.js` (`new` builtin returns the struct zero value for any struct type)
  - Test: `test/unit/language/structs.test.js`: L14 → `0`, `14b` → `0`, `new(struct{ N int })` (needs Task 6.2) → `0`, with `assertAllTargetsOutput`; `*p = T{…}` then reading `p.N` works
  - Done when: all pass; `bundle-size.js` passes (named structs emit the same JS)
