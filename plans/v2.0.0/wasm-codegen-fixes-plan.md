# WebAssembly Codegen & WasmGC Validity Fixes — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-24 (`/bs-plan`): the remaining WasmGC ICE and invalid-module follow-ups from `checker-go-rules` (L26), `checker-operand-rules` (L35), `wasm-struct-types` (L50, L51), `codegen-fixes` (L76), and `names-panics-type-exprs` (L88, L92, L93, plus L94 which shares L50's exact root). L12 (`type W[B any] S[B]`) was re-probed (13/13 pass) and verified already fixed by `wasm-struct-types` Task 1.1 (`b311621a`). Reviewed 2026-11-24 (`/bs-plan review`): user decisions recorded in *Scope* (W2 `new(F)` boxes `*F` but keeps the `&f` ban; W4 `(*[N]T)(s)` becomes a checker error on `wasm`/`both`). **Shared files:** `js-codegen-and-value-semantics` Task 2.1 also edits `emitTypeConversion` (`src/backend/wasm/emit-exprs.js`, Phase 4 here); `multi-package-fixes` edits `src/link/type-names.js` and `src/backend/wasm/monomorph.js` (Phase 2 here). Whichever plan lands second rebases.  
**Release note:** Fixes WebAssembly build failures and internal compiler errors for package-level `any`/float/complex variable initializers, `new` of a func type, defined complex types in `any`, pointers and arrays, comparing arrays or structs that hold interfaces and using them as map keys, local types declared inside generic functions, structs and parameters with anonymous-interface types, and slice-to-array conversions (`[N]T(s)`). Converting a slice to an array pointer (`(*[N]T)(s)`) never worked in `wasm` and `both` packages and is now a compile error there; convert to an array (`[N]T(s)`) instead.

---

## Goal

Eliminate the remaining WasmGC invalid-module and internal-compiler-error bugs on valid Go in `src/backend/wasm/`: match global constant-initializer opcodes to the global's Wasm type, make `isReplaceableRef` and zero values resolve func types and defined complex types through one checker-aware helper, rename local types across monomorphised generic instantiations, scan composite types recursively (one shared walker) for `__any_eq`, `__any_hash` and anonymous-interface dispatchers, fix single-hop field selector dispatch on anonymous interfaces, implement `[N]T(s)`, and reject `(*[N]T)(s)` in `wasm`/`both` packages with a clear compile error.

**Done means:**
- Every failing row in *Verified Gaps* (W1–W6) compiles to a `WebAssembly.validate`-clean module and prints Go's output on `wasm` in `test/unit/wasm/{strings_any,scalars,complex,pointers,fmt-any,generics,arrays,map-keys,interfaces,boundary}.test.js`; rows marked *JS ok* also match on `both` (W4 struct/array-element copy isolation and short-slice panics are asserted `wasm`-only, see *Excluded*).
- `(*[N]T)(s)` in a `wasm` or `both` package fails to compile with `cannot convert a slice to an array pointer in a wasm package` (negative test in `test/unit/types/pointers.test.js` using `assertErrorContains`); `js` packages still compile it.
- `renameLocalTypes` lives in the `lower` layer and `npm run check` (Biome + Sentrux layers) passes with `src/backend/wasm/monomorph.js` importing it.
- `npm test`, `npm run check`, and `npm run test:e2e` pass; `docs/hybrid-wasm.md` and `docs/go-compatibility.md` describe `[N]T(s)` support and the `(*[N]T)(s)` rule.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: target-specific** | Root `wasm-global-const-init-type-mismatch`: emit a Wasm const-init expression only when the literal's constant kind matches the global's `wType`; every other literal global initialises in `__init_globals` with its declared `goType` | `var a any = 1`, `var a any = 1.5`, `var f float64 = 1`, `var f float64 = (1)`, `var c complex64 = 2`, `var a, b any = 1, 2` | |
| **In scope: target-specific** | Root `wasm-backend-unresolved-typename` (was `wasm-func-pointer-missing-from-replaceable-ref` + `wasm-typename-complex-unresolved-in-backend`): one checker-aware `resolvedKind` helper in `src/backend/wasm/types.js` (resolve `TypeName`/`Ident` through `checker.types`, then `namedBase`) used by `isReplaceableRef`, `emitZeroValue` and `_zeroArrayConst` for func and complex types. **User decision (2026-11-24):** `*F` gets a box so `new(F)` works; the checker's `&f` ban on `wasm`/`both` stays | `new(F)`, `new(func() int)`, `*pf = fn`, `struct{ P *F }{new(F)}`, `type C complex128` in `any`/`*C`/`[2]C`/`var g [2]C`/`struct{ A [2]C }`/`struct{ P *C }` | |
| **In scope: target-specific** | Root `wasm-monomorph-local-type-collision`: run `renameLocalTypes` on the monomorphised programs before `monoChecker.checkAll`, after moving it to the `lower` layer (backend may not import `src/link/`) | `func g[T any](v T) { type Q struct{ X T } }` with `int` and `string`; local `type S []T`, `type A = T`, `type Q T2[T]`, local types in closures and generic methods | |
| **In scope: target-specific** | Root `wasm-prescan-shallow-type-scan`: one cycle-guarded component-type walker in `src/backend/wasm/prescan.js` used by `_usesAnyEq` (operand types and map keys), `mod.usesAnyHash`, and `_scanFuncSigInterfaces` (params, results, struct fields, package vars) | `[2]any == [2]any`, `struct{ A any }` locals, `map[[2]any]int`, `map[K]int` with `K struct{ A any }`, `eq[[2]any]`, `func F([]interface{ M() int })`, `var G interface{ M() int }` | |
| **In scope: target-specific** | Root `wasm-recv-type-name-selector-misreads-field-as-pkg`: `_getReceiverTypeName` treats `x.Y` as `pkg.Type` only when `x` is a package name | `v.X.M()`, `b.X.M()`, `p.X.M()` (pointer), package-var `v.X.M()`, generic `b.V.M()` | |
| **In scope: target-specific** | Root `wasm-missing-slice-to-array-conversion`: `emitTypeConversion` lowers `[N]T(s)` (length check with Go's panic text + element copy) | `[2]int(s)`, `[2]S(s)`, `[2][2]int(s)`, `[0]int(s)`, `A(Sl{…})`, `[2]int(s[1:])`, generic `[2]T(s)`, discarded `_ = [2]int(s)` | |
| **In scope: core** | **User decision (2026-11-24):** `(*[N]T)(s)` is a checker error in `wasm`/`both` packages (same rule family as `&xs[i]` and `&f`) | `p := (*[2]int)(s)`, `(*[0]int)(nil)` | |
| **Excluded: runtime / platform** | `&f` on a func-typed variable stays rejected on `wasm`/`both` | `var f F; p := &f` | User decision 2026-11-24: lifting the ban needs checker, escape and docs work outside this plan; logged in `plans/follow-ups.md` |
| **Excluded: runtime / platform** | Aliasing `(*[N]T)(s)` on WasmGC | `p := (*[2]int)(s); p[0] = 7` | A pointer to an array is the GC array itself; a slice with an offset or spare capacity has no array of its own to point at. Rejected at compile time (row above) instead of giving wrong results |
| **Excluded: deferred** | JS-side slice-to-array gaps | `[2]S(s)` / `[2][2]int(s)` alias their elements on JS; short-slice panic text on JS; `(*[N]T)(s)` in `js` packages crashes | Outside this `wasm` plan; logged in `plans/follow-ups.md` (2026-11-24) |
| **Excluded: deferred** | `fmt` of a local type declared in a generic function | `func g[T any](v T) { type Q struct{ X T }; fmt.Println(Q{v}) }` prints `<nil>` on JS and `wasm` | Root is `src/lower/fmt-formatters.js` (`genericBodyTypes`), not the `wasm` backend; logged in `plans/follow-ups.md`. W3 tests print fields, not whole values |

---

## Verified Gaps & Baseline Audit

**Method.** Read-only code inspection and probes through `runProgram(src, { target })` from `test/unit/helpers.js` on `main` (`368e33bf`, 2026-11-24). Review re-probe (2026-11-24): 30 W1, 26 W2, 14 W3 (+4 `fmt`), 18 W4 (`wasm` + `both`), 24 W5, 25 W6 programs; W3 fix feasibility checked on a throwaway `src/` copy (rename-before-`checkAll` makes all 9 failing W3 programs pass).

### W1 `wasm-global-const-init-type-mismatch` (L76)
Root: `_collectPackageGlobals` (`src/backend/wasm/globals.js:211`, literal block `:298-344`) sets `isConstInit = true` for `BasicLit` `INT`/`RUNE` (emits `i32.const` unless `wType === "i64"`), `FLOAT` (emits `${wType}.const`) and `BOOL` without checking `wType`, so an `anyref`/`f32`/`f64`/`$complex*` global gets `i32.const`, `anyref.const` or `[object Object].const`. `_makeGlobalInitFunc` (`:405`, line 417) tags `lhs._type` with `expr._type` instead of the global's `goType`.

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W1.1 (L76 repro) | `var a any = 1` | `1` | `type error in constant expression[0] (expected anyref, got i32)` |
| W1.2 *sibling* | `var a any = true / 'a' / -5 / false`; `var a any = 1.5 / -1.5`; `var a, b any = 1, 2`; no-`fmt` `println(a.(int))` | Go output | `expected anyref, got i32` / `Unsupported WASM instruction opcode: 'anyref.const'` |
| W1.3 *sibling* | `var f float64 = 1 / -1 / 'a' / (1)`; `var f float32 = 1`; `type F float64; var x F = 1`; `var c complex128 = 1`; `var c complex64 = 2`; `var c complex128 = 1.5` | Go output | `expected f64/f32/(ref null …), got i32` / `'[object Object].const'` |
| control | `var a any = "hi" / 1+2i / 1 + 2`; `var e error = nil`; `var x int = 1.0`; `var u uint8 = 'a'`; `var i int64 = 1`; `type B bool; var b B = true`; `const K = 1; var a any = K`; `const f float64 = 1` | Go output | passes (must stay) |

### W2 `wasm-backend-unresolved-typename` (L92, L88)
Root: `isReplaceableRef` (`src/backend/wasm/types.js:619-631`) resolves `TypeName` into a local `t` but then tests `isComplex(goType)` on the unresolved node and never tests func types. `isComplex`/`isComplex64` are `src/typechecker/types.js:612-635` (re-exported by `src/backend/wasm/types.js:14`): checker-free, so `TypeName("C")` for `type C complex128` is not complex. Effects: `toWasmType(*F)` is `(ref null $closure_F)` while `_emitBuiltinNew` (`src/backend/wasm/emit-builtins.js:391`, box path `:424-431`) builds `$box_F`; `*C` maps to `(ref null $complex128)` where `$ptr_C` is expected. Same unresolved test in `emitZeroValue` (`src/backend/wasm/emit.js:1615`, line 1679) and `_zeroArrayConst` (`src/backend/wasm/globals.js:144-179`, no complex branch), so `[N]C` zero-fills with null.

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W2.1 (L92 repro) | `type F func() int; pf := new(F); fmt.Println(*pf == nil)` | `true` | `local.tee[0] expected type (ref null $closure), found struct.new of type (ref $box)` |
| W2.2 *sibling* | `new(func() int)`; `var pf *F = new(F); *pf = fn; (*pf)()`; unexported `struct{ P *F }{new(F)}` | Go output | same Wasm type mismatch |
| W2.3 (L88 repro) | `type C complex128; var r any = C(3+4i); fmt.Println(r)` | `(3+4i)` | `struct.new[0] expected type (ref null 305), found local.get of type (ref null 168)` |
| W2.4 *sibling* | `type C64 complex64` in `any` → `Println`/`%T`; `type C2 C` in `any`; no-`fmt` `func box(p *C) any`, `var p *C = new(C)`, `func mk() *C`; unexported `struct{ P *C }` with `*v.P = 5` | Go output | same Wasm type mismatch |
| W2.5 *sibling* | `var a [2]C; real(a[0])`; `var g [2]C`; `type C2 C; var g [2]C2`; unexported `struct{ A [2]C }` zero value | `0` | runtime trap `dereferencing a null pointer` |
| control | `new(any)`, `new([]int)`, `new(map[string]int)`, `new(complex128)`, `var g [2]complex128`, `var g C`, `make([]C, 2)`, `map[int]C`, `map[C]int`, `C` arithmetic/`==`/`real`/`imag` | Go output | passes (must stay) |
| control (unchanged) | `var f F; p := &f` on `wasm` | compile error | `cannot take the address of a variable of func type F in a wasm package` (`src/typechecker/expressions.js:752-758`; kept by user decision) |

### W3 `wasm-monomorph-local-type-collision` (L26)
Root: `renameLocalTypes` (`src/link/type-names.js:121-186`) runs before monomorphisation (`src/compiler.js:1421`), when each generic body exists once. `monomorphise` (`src/backend/wasm/monomorph.js:709-960`) clones the body into `g$int` and `g$string`; both keep bare `type Q`, and `monoChecker.checkAll(progs)` (`:956`) registers one `Q` for both. `src/backend/wasm/` (Sentrux layer `backend`, order 2) may not import `src/link/` (layer `support`, order 1; `.sentrux/rules.toml`); `renameLocalTypes` and its helpers only import `src/lower/walk.js`, so they can move to `lower` (order 3).

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W3.1 (L26 repro) | `func g[T any](v T) { type Q struct{ X T }; fmt.Println(Q{v}.X) }; g(5); g("hi")` | `5\nhi` | `struct.new[0] expected type externref, found local.get of type i64` |
| W3.2 *sibling* | local `type S []T`; local alias `type A = T`; `type Q T2[T]`; local type inside a closure in `g`; generic method `func (b Box[T]) Show()` with local `Q`; `g(5); g(1.5)` | Go output | invalid WasmGC type mismatch |
| control | single instantiation `g(5)`; local `type Q struct{ X int }` (no `T`); two generic funcs each with local `Q` (`g(5); h("hi")`) | Go output | passes (must stay) |

### W4 `wasm-missing-slice-to-array-conversion` (L93)
Root: `emitTypeConversion` (`src/backend/wasm/emit-exprs.js:3195-3311`) has no `slice → array` branch, leaving `(ref null $slice_T)` where `(ref null $arr_T)` is expected; a discarded `_ = [2]int([]int{1})` is emitted (blank assignments are emitted: `_ = s[5]` panics) but has no length check, so it does not panic. `slice → *array` passes the checker (`_convertible`, `src/typechecker/expressions.js:1823-1826`) and has no lowering either; on JS it crashes at run time (`Cannot read properties of undefined`), so no program using it works on any target today.

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W4.1 (L93 repro) | `s := []int{1, 2, 3}; fmt.Println([2]int(s))` | `[1 2]` (*JS ok*) | `local.tee[0] expected type (ref null $arr), found … (ref null $slice)` |
| W4.2 *sibling* | `[2]float64(s)`, `[2]string(s)`, `[2]byte([]byte("hi"))`, `[0]int(s)`, `[2]any(s)`, `[2]int(s[1:])`, `type A [2]int; A(Sl{4, 5})`, copy isolation `s[0] = 99`, generic `func f[T any](s []T) [2]T` | Go output (*JS ok*) | invalid WasmGC |
| W4.3 *sibling* | `[2]S(s)` then `s[0].X = 9`; `[2][2]int(s)` then `s[0][0] = 9` | `[{1} {2}]`, `[[1 2] [3 4]]` | invalid WasmGC (JS prints the mutated values: excluded) |
| W4.4 *sibling* | `s := []int{1}; fmt.Println([2]int(s))` and `_ = [2]int(s)` under `recover()` | `runtime error: cannot convert slice with length 1 to array or pointer to array with length 2` | invalid WasmGC / no panic (`<nil>`) |
| W4.5 (user decision) | `(*[2]int)(s)`, `(*[0]int)(nil)` in a `wasm`/`both` package | compile error | invalid WasmGC on `wasm`; JS crashes at run time |

### W5 `wasm-prescan-shallow-type-scan` (L35)
Root: `_usesAnyEq` (`src/backend/wasm/prescan.js:79-103`) decides on `toWasmType(operand) === "anyref"`, top-level `isInterfaceType` map keys, and `mod.structTypes` entries with an `anyref` field (anonymous structs are not registered yet at prescan). `mod.usesAnyHash` (`src/backend/wasm/index.js:906-912`) only checks top-level interface map keys. Neither descends into array elements or struct fields. With `__any_hash` missing, `emitKeyHash` (`src/backend/wasm/emit-maps.js:86`, interface branch `:95-99`) emits `call` with a null index → func 0 (an `externref` import) → invalid WasmGC.

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W5.1 (L35 repro) | `func f(a, b [2]any) bool { return a == b }` (no `fmt`) | `true` | ICE `__any_eq was not declared` |
| W5.2 *sibling* | `[2]I == [2]I`, `[2][2]any ==`, `[2]any !=`, `switch a { case [2]any{1, 2}: }`, `a == b` on local `struct{ A any }` values, `[1]struct{ A any } ==`, `map[[2]any]int`, `map[[1][2]any]int`, `map[[1]I]int`, `eq[T comparable]` with `[2]any`, `put[K comparable]` with `[2]any` key (all no `fmt`) | Go output | ICE `__any_eq was not declared` |
| W5.3 *sibling* | `map[[2]any]int` (with `fmt`); `map[struct{ A any }]int` (with or without `fmt`); `type K struct{ A any }; map[K]int` | Go output | `call[0] expected type externref, found local.get of type anyref` (missing `__any_hash`) |
| control | `struct{ A any }` params compared with `fmt` imported; `type K struct{ A any }; K{1} == K{1}`; `[1]K ==`; `any([2]any{1,2}) == any([2]any{1,2})`; `map[any]int` | Go output | passes (must stay) |

### W6 `wasm-prescan-shallow-type-scan` (dispatchers; L50, L94) and `wasm-recv-type-name-selector-misreads-field-as-pkg` (L51)
Roots:
1. `_scanFuncSigInterfaces` (`src/backend/wasm/prescan.js:231-274`) only checks the top level of function param/result types; `_collectInterfaceDispatchers` (`src/backend/wasm/index.js:1213-1252`) has no scan of struct fields or package vars. `addIfaceHelpers` (`src/backend/wasm/boundary.js:1584-1593`) then throws for a boundary-reachable anonymous interface with no dispatcher. Same shallow-scan root as W5: one walker fixes both.
2. `_getReceiverTypeName` (`src/backend/wasm/emit.js:1368-1393`, lines 1388–1391) returns `${node.expr.name}.${node.field}` for any `SelectorExpr` whose base has a `name`, reading field selector `v.X` as package `v` type `X`; `_emitMethodCall` (`src/backend/wasm/emit-builtins.js:1157`, line 1186: `recvTypeName ?? anonIfaceName(recvType)`) then looks up `__dispatch_v.X_M`. A composite-literal base (`Box{X: A{}}.X.M()`) has no `name`, so it passes.

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W6.1 (L50 + L94 repros) | `type Box struct{ v interface{ M() int } }`; `type Box[T any] struct{ V T }; var b Box[interface{ M() struct{ X int } }]` | `main.Box`, `true` | ICE `no wasm dispatcher for interface method anon_iface_...M` |
| W6.2 *sibling* | `func F(xs []interface{ M() int })`, `map[string]interface{ M() int }`, `*interface{ M() int }`, `[1]interface{ M() int }`, `struct{ V interface{ M() int } }` param, `func(interface{ M() int })` param, `func F() []interface{ M() int }`, `var G interface{ M() int }`, `var G []interface{ M() int }`, exported `type Box struct{ V interface{ M() int } }` | Go output | same missing-dispatcher ICE |
| W6.3 (L51 repro & siblings) | `v := struct{ X interface{ M() int } }{A{}}; v.X.M()`; `b := Box{X: A{}}; b.X.M()`; `p := &box{A{}}; p.X.M()`; package var `v.X.M()`; generic `b.V.M()` | `9` | ICE `Cannot resolve struct for selector: M` |
| control | unexported `type box struct{ v interface{…} }`; `struct{ X I }` with named `I`; `Box{X: A{}}.X.M()`; chained `o.I.X.M()`; `xs[0].M()`; method value `f := v.X.M`; local named `fmt` with `fmt.X.M()` | Go output | passes (must stay) |

---

## Approach

### 1. Architecture & Design Decisions
- **W1 (`globals.js`):** In `_collectPackageGlobals`, set `isConstInit` only when the literal's kind matches `wType`: `INT`/`RUNE` → `i32`/`i64` (as today) or `f32`/`f64` (`${wType}.const` with the numeric value); `FLOAT` → `f32`/`f64`; `BOOL` → `i32`. Every other literal falls through to `pending` (`__init_globals`), where `_makeGlobalInitFunc` stamps the global's declared `goType` (pass it in each `pending` entry) on `lhs._type`. `var x int = 1.0` moves to `__init_globals`; its output stays `1`.
- **W2 (`types.js`, `emit.js`, `globals.js`):** Add one exported helper in `src/backend/wasm/types.js`, `resolvedType(goType, checker)`: `TypeName`/`Ident` → `checker.types.get(name)`, then `namedBase`. `isReplaceableRef` tests `isFuncType(goType, checker) || isComplex(resolvedType(goType, checker))` next to slices/maps/pointers, so `*F` and `*C` are boxes everywhere (`new`, params, fields). `emitZeroValue` (line 1679) and `_zeroArrayConst` use `isComplex(resolvedType(elem, checker))`; `_zeroArrayConst` builds each complex element as a constant `f64.const 0; f64.const 0; struct.new $complexN` (`f32` for `complex64`). Do not change `src/typechecker/types.js` `isComplex` (shared with the checker and the JS backend).
- **W3 (`lower/`, `link/`, `monomorph.js`):** Move `renameLocalTypes` and its private helpers (`freshLocalName`, `valueNames`, `declaresValue`, `declaredParams`, `renameTypeRefs`, `withLocals`, `declaredNames`, `withTypeParams`, `isTypeRef`, `FUNC_KINDS`/`VALUE_DECL_KINDS`) to new `src/lower/local-types.js`. `freshLocalName` and `renameTypeRefs` are exported from there because `mangleCollidingTypes` (`src/link/type-names.js:66-96`, lines 82 and 94) keeps using them. `src/link/type-names.js` re-exports `renameLocalTypes` so `src/compiler.js`, `src/link/stdlib.js` and `test/unit/types/identity.test.js` keep their imports. In `monomorphise`, call `renameLocalTypes(progs)` right before `monoChecker.checkAll(progs)` (`:956`). Renamed `Q__L<n>` names are new to `checker.types`, so the seeding loop (`:946-951`) skips them and `checkAll` collects them fresh; `%T` drops the `__L<n>` suffix (`displayTypeName`).
- **W5 + W6.1 (`prescan.js`, `index.js`, `emit-maps.js`):** Add one cycle-guarded walker `forEachComponentType(goType, checker, visit, { through })` in `src/backend/wasm/prescan.js` (unwraps `named`/`TypeName`; `through` picks which kinds it descends: arrays + struct fields for comparability, everything incl. slices/maps/pointers/funcs/struct fields for dispatchers). `containsInterfaceType(t)` = walker over comparable components finding a non-`ERROR`-only interface. `_usesAnyEq`: operand test becomes `isAnyRef(n) || containsInterfaceType(n._type)` for `==`/`!=`/switch tag/case; map keys use `containsInterfaceType`. `mod.usesAnyHash` uses `containsInterfaceType` on map keys. `emitKeyHash` throws `internal: __any_hash was not declared` when `resolveFuncIndex` returns `null`. `_scanFuncSigInterfaces.scanType` uses the walker (all kinds) and also scans struct fields of `TypeDecl`s and package `VarDecl` types.
- **W6.2 (`emit.js`):** In `_getReceiverTypeName`, use the trailing `SelectorExpr` fallback (`:1388-1391`) only when `node.expr?._type?.kind === "namespace"` or `node.expr?._isNamespace` (the package-ident tags used in `src/backend/wasm/emit-exprs.js:795` and `src/backend/js/index.js:510`). With `null` returned, `_emitMethodCall:1186` already falls back to `anonIfaceName(recvType)`; no `emit-builtins.js` change.
- **W4 (`emit-exprs.js`, `typechecker/expressions.js`):** In `emitTypeConversion`, when the source is a slice and the target's underlying type is an array: unpack `(arr, off, len)`, panic when `len < N` with `runtime error: cannot convert slice with length <len> to array or pointer to array with length <N>` through the existing panic-text path, then build `$arr_T` of length `N` from `arr[off..off+N)`, cloning struct and array elements (the same clone the array-assignment path uses) so the result shares nothing with `s`. In the checker, `_convertible`'s `slice → pointer` branch (`:1823-1826`) reports `cannot convert a slice to an array pointer in a wasm package; convert to an array ([N]T(s)) instead` when `_isWasmPackage()` (same shape as `_errFuncAddress`, `:752-758`).

### 2. Invariants & Safety Bounds
- Every generated module passes `WebAssembly.validate` (enforced by the compiler gate) and zero-initialised arrays of defined complex types never hold null.
- `forEachComponentType` keeps a `seen` `Set` so recursive types (`type Node struct{ Next *Node }`, `type L []L`) terminate.
- Unexported types never gain boundary dispatchers they do not need (control: unexported `box`).
- `src/backend/` imports nothing from `src/link/` (Sentrux layers); `src/typechecker/types.js` `isComplex` semantics are unchanged.
- The `&f` rule (`_errFuncAddress`) and its docs stay as they are.

### 3. Edge Cases & Error Handling
- `[0]T(nil)` succeeds with a zero-length array; `[1]T(nil)` panics with `cannot convert slice with length 0 to array or pointer to array with length 1`.
- `var x int = 1.0` and `var u uint8 = 'a'` keep their output after W1 moves non-matching literals to `__init_globals`.
- `new(F)` boxes `ref.null $closure_F`, so `*pf == nil` is `true`, and `*pf = fn; (*pf)()` calls the stored closure.
- Local types in generic bodies are renamed per instantiation; `%T` of such a value is out of scope (`fmt` formatter gap, *Excluded*), so W3 tests print fields.

---

## Implementation Tasks

### Phase 1: Package Globals & Resolved Pointer/Zero Types (roots `wasm-global-const-init-type-mismatch`, `wasm-backend-unresolved-typename`)
*Scheduled from review follow-ups (2026-11-24).*
- [ ] Task 1.1: Guard Wasm global constant initializers by `wType` and pass declared `goType` to `__init_globals` (W1.1–W1.3)
  - Files: `src/backend/wasm/globals.js` (`_collectPackageGlobals`, `_makeGlobalInitFunc`)
  - Test: `test/unit/wasm/strings_any.test.js` (W1.1–W1.2 `any` globals incl. no-`fmt` assertion), `test/unit/wasm/scalars.test.js` (W1.3 float globals incl. `(1)`, `'a'`, defined `F`), `test/unit/wasm/complex.test.js` (W1.3 `complex128`/`complex64` globals) + W1 controls
  - Done when: every W1 program prints Go's output on `wasm` and the W1 controls still pass
- [ ] Task 1.2: Add `resolvedType` and box func and defined complex pointees in `isReplaceableRef` (W2.1–W2.4)
  - Files: `src/backend/wasm/types.js` (`resolvedType`, `isReplaceableRef`)
  - Test: `test/unit/wasm/pointers.test.js` (W2.1–W2.2: `new(F)`, `new(func() int)`, `*pf = fn; (*pf)()`, `struct{ P *F }`), `test/unit/wasm/complex.test.js` (W2.4: `var p *C = new(C)`, `func mk() *C`, `func box(p *C) any`, `struct{ P *C }`), `test/unit/wasm/fmt-any.test.js` (W2.3–W2.4: `C`, `C64`, `C2` in `any` → `Println` and `%T`) + W2 controls
  - Done when: W2.1–W2.4 build valid modules with Go's output; `&f` still reports `cannot take the address of a variable of func type`
- [ ] Task 1.3: Zero-fill `[N]C` arrays with complex zeros in locals, fields and globals (W2.5)
  - Files: `src/backend/wasm/emit.js` (`emitZeroValue`), `src/backend/wasm/globals.js` (`_zeroArrayConst`)
  - Test: `test/unit/wasm/complex.test.js`: `var a [2]C`, `var g [2]C`, `type C2 C; var g [2]C2`, `type s struct{ A [2]C }` zero value, `complex64` variant; control `var g [2]complex128`
  - Done when: `real(a[0])` prints `0` for every W2.5 program with no null-pointer trap

### Phase 2: Monomorphised Local Types (root `wasm-monomorph-local-type-collision`)
- [ ] Task 2.1: Move `renameLocalTypes` to the `lower` layer
  - Files: `src/lower/local-types.js` (new), `src/link/type-names.js` (re-export)
  - Test: `test/unit/types/identity.test.js`: new case importing `renameLocalTypes` from `src/lower/local-types.js` that renames two same-named local `TypeDecl`s in two `FuncDecl`s to distinct `__L<n>` names (fails first: module missing); existing `src/link/type-names.js` import keeps passing
  - Done when: `renameLocalTypes` is defined only in `src/lower/local-types.js`, existing callers are unchanged, and `npm run check` passes
- [ ] Task 2.2: Rename local types after monomorphisation (W3.1–W3.2)
  - Files: `src/backend/wasm/monomorph.js` (`monomorphise`)
  - Test: `test/unit/wasm/generics.test.js`: W3.1–W3.2 (local struct, slice, alias, `T2[T]`, closure-local and generic-method-local types across `int`/`string` and `int`/`float64`, printing fields) + W3 controls; plus a regression test in `test/unit/wasm/structs.test.js` for the already-fixed L12 (`type W[B any] S[B]`)
  - Done when: every W3 program prints Go's output on `wasm` and `npm run check` passes with `monomorph.js` importing from `src/lower/`

### Phase 3: Component-Type Prescan & Anonymous-Interface Dispatch (roots `wasm-prescan-shallow-type-scan`, `wasm-recv-type-name-selector-misreads-field-as-pkg`)
- [ ] Task 3.1: Add `forEachComponentType`/`containsInterfaceType` and use them for `__any_eq` and `__any_hash` (W5.1–W5.3)
  - Files: `src/backend/wasm/prescan.js` (`forEachComponentType`, `containsInterfaceType`, `_usesAnyEq`), `src/backend/wasm/index.js` (`usesAnyHash`), `src/backend/wasm/emit-maps.js` (`emitKeyHash` guard)
  - Test: `test/unit/wasm/arrays.test.js` (no-`fmt` `[2]any ==`, `[2]I ==`, `[2][2]any ==`, `!=`, `switch [2]any`, local `struct{ A any }` `==`, `[1]struct{ A any } ==`, generic `eq[[2]any]`), `test/unit/wasm/map-keys.test.js` (`map[[2]any]int`, `map[[1][2]any]int`, `map[[1]I]int`, `map[struct{ A any }]int`, `map[K]int`, generic `put[[2]any]`, each with and without `fmt`) + W5 controls
  - Done when: every W5 program prints Go's output on `wasm` without importing `fmt`
- [ ] Task 3.2: Scan component types, struct fields and package vars for anonymous-interface dispatchers (W6.1–W6.2)
  - Files: `src/backend/wasm/prescan.js` (`_scanFuncSigInterfaces`)
  - Test: `test/unit/wasm/boundary.test.js`: W6.1 (`Box{v interface{ M() int }}`, `Box[interface{ M() struct{ X int } }]`), W6.2 (slice, map, pointer, array, struct, func-param and result composites; `var G interface{…}`; `var G []interface{…}`; exported field) + unexported-`box` control
  - Done when: every W6.1–W6.2 program builds a valid module with Go's output
- [ ] Task 3.3: Read `x.Y` as `pkg.Type` only for package names in `_getReceiverTypeName` (W6.3)
  - Files: `src/backend/wasm/emit.js` (`_getReceiverTypeName`)
  - Test: `test/unit/wasm/interfaces.test.js`: W6.3 (`v.X.M()` on anonymous struct, named `b.X.M()`, pointer `p.X.M()`, package var, generic `b.V.M()`) + W6 controls (`Box{X: A{}}.X.M()`, chained, indexed, method value, local named `fmt`); existing qualified-receiver tests (`simd.F32x4` methods) keep passing
  - Done when: every W6.3 program prints `9` on `wasm`

### Phase 4: Slice-to-Array Conversions (root `wasm-missing-slice-to-array-conversion`; user decision on `(*[N]T)(s)`)
- [ ] Task 4.1: Lower `[N]T(s)` on WASM with Go's length panic and an element copy (W4.1–W4.4)
  - Files: `src/backend/wasm/emit-exprs.js` (`emitTypeConversion`)
  - Test: `test/unit/wasm/arrays.test.js`: W4.1–W4.2 with `assertProgramOutput` (*JS ok*); W4.3 copy isolation for `[2]S(s)` and `[2][2]int(s)` and W4.4 short-slice panics (printed and discarded, under `recover()`) with `assertWasmProgramOutput`
  - Done when: every W4.1–W4.4 program prints Go's output on `wasm`, including the panic text `cannot convert slice with length 1 to array or pointer to array with length 2`
- [ ] Task 4.2: Reject `(*[N]T)(s)` in `wasm`/`both` packages and document slice-to-array conversions (W4.5)
  - Files: `src/typechecker/expressions.js` (`_convertible` slice→pointer branch, new `_errSliceArrayPointer`), `docs/hybrid-wasm.md` (pointers section + feature list), `docs/go-compatibility.md` (pointers row)
  - Test: `test/unit/types/pointers.test.js`: `assertErrorContains(errors, "cannot convert a slice to an array pointer in a wasm package")` for `(*[2]int)(s)` and `(*[0]int)(nil)` on `wasm` and `both`; positive case: a `js` package still compiles `(*[2]int)(s)`
  - Done when: W4.5 fails to compile with that message on `wasm`/`both`, `js` packages are unchanged, and both docs pages describe `[N]T(s)` and the `(*[N]T)(s)` rule
