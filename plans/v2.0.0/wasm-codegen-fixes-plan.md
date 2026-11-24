# WebAssembly Codegen & WasmGC Validity Fixes — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-24 (`/bs-plan`): the remaining WasmGC ICE and invalid-module follow-ups from `checker-go-rules` (L26), `checker-operand-rules` (L35), `wasm-struct-types` (L50, L51), `codegen-fixes` (L76), and `names-panics-type-exprs` (L88, L92, L93, plus L94 which shares L50's exact root). L12 (`type W[B any] S[B]`) was re-probed (13/13 pass) and verified already fixed by `wasm-struct-types` Task 1.1 (`b311621a`). Independent of the JS/checker plans; only touches `src/backend/wasm/`.  
**Release note:** Fixes WebAssembly build failures and internal compiler errors for package-level `any`/float/complex variable initializers, slice-to-array conversions (`[N]T(s)`), `new(F)` on function types, defined complex types in `any` and arrays, comparing `[N]any` arrays or using them as map keys, local types declared inside generic functions, and structs with anonymous-interface fields.

---

## Goal

Eliminate the remaining WasmGC invalid-module and internal-compiler-error bugs on valid Go in `src/backend/wasm/`: match global constant-initializer opcodes to the global's Wasm type, unify `isReplaceableRef` and checker-aware `isComplex` for function pointers and defined complex types, implement slice-to-array conversions (`[N]T(s)` and `(*[N]T)(s)`), scan composite types recursively for `__any_eq`, `__any_hash`, and boundary anonymous-interface dispatchers, fix single-hop field selector dispatch on anonymous interfaces, and rename local types across monomorphised generic instantiations.

**Done means:**
- Every failing row in *Verified Gaps* (W1–W7) compiles to a `WebAssembly.validate`-clean module and produces Go's output on `wasm` (and matches `js`/`both` where applicable) in `test/unit/wasm/{strings_any,scalars,complex,pointers,fmt-any,arrays,map-keys,interfaces,boundary,generics}.test.js`.
- Zero `InternalCompilerError`, zero `WebAssembly.validate` failures, and zero null-pointer traps for `[N]C` / `var g [N]C` defined-complex arrays.
- `npm test`, `npm run check`, and `npm run test:e2e` pass.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: target-specific** | Root `wasm-global-const-init-type-mismatch`: emit Wasm const-init expressions only when the literal matches the global's `wType`; initialize mismatched globals in `__init_globals` with declared `goType` | `var a any = 1`, `var a any = 1.5`, `var f float64 = 1`, `var c complex128 = 1` | WASM global constant-expression rules |
| **In scope: target-specific** | Roots `wasm-func-pointer-missing-from-replaceable-ref` & `wasm-typename-complex-unresolved-in-backend`: include `isFuncType` and checker-aware `isComplex` (via `namedBase`) in `isReplaceableRef`, `emitZeroValue`, and `_zeroArrayConst` | `new(F)`, `*pf = fn`, `type C complex128; var r any = C(3+4i); fmt.Println(r)`, `var p *C = new(C)`, `var a [2]C`, `var g [2]C` | WasmGC pointer-box representation |
| **In scope: target-specific** | Root `wasm-monomorph-local-type-collision`: run `renameLocalTypes` after monomorphisation and before `monoChecker.checkAll`, without seeding stale template local types | `func g[T any](v T) { type Q struct{ X T } }` instantiated with `int` and `string`; local `type S []T` / `type A = T` / generic methods | WASM monomorphisation pipeline |
| **In scope: target-specific** | Root `wasm-missing-slice-to-array-conversion`: emit length check (with Go panic text) + array copy for `[N]T(s)` and `(*[N]T)(s)` in `emitTypeConversion` | `[2]int(s)`, `[2]S(s)`, `[0]int(s)`, `A(Sl{...})`, short-slice panic, `(*[2]int)(s)` | Missing WASM conversion lowering |
| **In scope: target-specific** | Root `wasm-prescan-misses-nested-any-in-arrays-and-map-keys`: recursive `containsInterfaceType` for both `_usesAnyEq` and `mod.usesAnyHash`, plus guard on unresolved `__any_hash` | `[2]any == [2]any`, `[2]I == [2]I`, `switch [2]any`, `map[[2]any]int`, `map[struct{ A any }]int` | WASM helper prescan |
| **In scope: target-specific** | Roots `wasm-prescan-misses-boundary-anon-interface-dispatchers` & `wasm-recv-type-name-selector-misreads-field-as-pkg`: recursively scan composites/structs/globals for anonymous-interface dispatchers, and stop `_getReceiverTypeName` from misreading `v.X` as `pkg.Type` when `recvType` is already resolved | `type Box struct{ v interface{ M() int } }`, `Box[interface{ M() struct{ X int } }]`, `func F(xs []interface{ M() int })`, `v.X.M()` | WASM interface dispatch & boundary generation |
| **Excluded: runtime / platform** | `(*[N]T)(s)` aliasing a non-zero slice offset (`s[1:]`) in WasmGC | `p := (*[2]int)(s[1:])` when `s[1:]` has `off > 0` | WasmGC GC arrays have no interior-slice pointer without fat-pointer array representation; reject non-zero-offset `(*[N]T)(s)` cleanly with `UnsupportedError` (or document copy/zero-offset limit) |
| **Excluded: deferred** | JS slice-to-array short-slice panic and JS `(*[2]int)(s)` conversion | `s := []int{1}; _ = [2]int(s)` on JS/both | Pre-existing JS-side gap outside WASM scope; log in `plans/follow-ups.md` if needed |

---

## Verified Gaps & Baseline Audit

**Method.** Read-only code inspection and `node --input-type=module -e` probes against `test/unit/helpers.js` (`compile`, `runWasm`) on `main` (`dda372c4`, 2026-11-24).

### W1 `wasm-global-const-init-type-mismatch` (L76)
Root: `_collectPackageGlobals` (`src/backend/wasm/globals.js:298-360`, lines 310–344) sets `isConstInit = true` for `BasicLit` (`INT`/`RUNE`, `FLOAT`, `BOOL`) without checking whether `wType` matches the literal's Wasm constant kind, emitting `i32.const` for `anyref`/`f64`/`$complex128` or invalid `${wType}.const` opcodes (`anyref.const`, `[object Object].const`). `_makeGlobalInitFunc` (`:405-421`, line 417) also tags `lhs._type` with `expr._type` instead of the global's declared `goType`.

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W1.1 (L76 repro) | `var a any = 1` | valid module | `type error in constant expression[0] (expected anyref, got i32)` |
| W1.2 *sibling* | `var a any = true`; `var a any = 'a'`; `var a any = -5`; `var a any = 1.5`; `var a any = -1.5` | valid module | invalid constant expr / `Unsupported WASM instruction opcode: 'anyref.const'` |
| W1.3 *sibling* | `var f float64 = 1`; `var f float32 = 1`; `type F float64; var x F = 1`; `var c complex128 = 1`; `var c complex128 = 1.5` | valid module | invalid constant expr / `Unsupported WASM instruction opcode: '[object Object].const'` |
| control | `var a any = "hi"`, `1+2i`, `S{7}`, `nil`, `[]int{1,2}`, `int64(5)`, `1 + 2`; `var x int = 1.0` | valid module | passes (must stay) |

### W2 `wasm-func-pointer-missing-from-replaceable-ref`, `wasm-typename-complex-unresolved-in-backend` (L92, L88)
Shared root: `isReplaceableRef` (`src/backend/wasm/types.js:619-631`) omits `isFuncType(goType, checker)` (so `toWasmType(*F)` returns `(ref null $closure_F)` while `_emitBuiltinNew` at `src/backend/wasm/emit-builtins.js:424` constructs `$box_F`) AND calls `isComplex(goType)` on the unresolved `TypeName("C")` instead of resolved `t` via `namedBase` (so `*C` parameters in `gofront_gen.go` / `var p *C` get `(ref null $complex128)` while `x._type` inside the body expects `(ref null $ptr_C)`). Siblings of `isComplex(TypeName)`: `emitZeroValue` (`src/backend/wasm/emit.js:1679`) and `_zeroArrayConst` (`src/backend/wasm/globals.js:144-179`) emit `array.new_default` (null elements) for `[N]C` / `var g [N]C` → runtime null-pointer trap.

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W2.1 (L92 repro) | `type F func() int; pf := new(F); fmt.Println(*pf == nil)` | `true` | `local.tee[0] expected type (ref null $closure), found struct.new of type (ref $box)` |
| W2.2 *sibling* | `new(func() int)`, `new(func(int) string)`, `var pf *F = new(F); *pf = fn; (*pf)()`, closure via `*F`, `func set(p *F)` | valid module + Go output | same Wasm type mismatch |
| W2.3 (L88 repro) | `type C complex128; var r any = C(3+4i); fmt.Println(r)` | `(3+4i)` | `struct.new[0] expected type (ref null 305), found local.get of type (ref null 168)` |
| W2.4 *sibling* | `type C64 complex64` & 2-level `type C2 C` in `any` → `fmt.Println` / `%T`; no-`fmt` `func box(p *C) any`, `var p *C = new(C)`, `func mk() *C` | valid module + Go output | same Wasm type mismatch |
| W2.5 *sibling* | `var a [2]C; real(a[0])`; `var g [2]C; real(g[0])` | `0` | runtime trap `dereferencing a null pointer` |
| control | `new(any)`, `new([]int)`, `new(map[string]int)`, `new(complex128)`, `var g [2]complex128`, `complex128` in `any` | passes | passes (must stay) |

### W3 `wasm-monomorph-local-type-collision` (L26)
Root: `renameLocalTypes` (`src/link/type-names.js:121-184`) runs before monomorphisation (`src/compiler.js:1421`). When `monomorphise` (`src/backend/wasm/monomorph.js:709-960`) clones a generic function or method into `g$int` and `g$string`, both keep bare `type Q`, so `g$string`'s `Q` overwrites `g$int`'s `Q` in `monoChecker.types` at line 956.

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W3.1 (L26 repro) | `func g[T any](v T) { type Q struct{ X T }; ... }; g(5); g("hi")` | `5\nhi` | `struct.new[0] expected type externref, found local.get of type i64` |
| W3.2 *sibling* | local `type S []T`, local alias `type A = T`, and local `type Q struct{ X T }` in generic method `func (b Box[T]) Show()` across `int` & `string` | Go output | invalid WasmGC type mismatch |
| control | single instantiation `g(5)`; local `type Q struct{ X int }` (no `T`); non-generic local struct | passes | passes (must stay) |

### W4 `wasm-missing-slice-to-array-conversion` (L93)
Root: `emitTypeConversion` (`src/backend/wasm/emit-exprs.js:3195-3311`) has no branch for `slice -> array` or `slice -> *array`, leaving `(ref null $slice_T)` on the stack where `(ref null $arr_T)` is expected (and silently omitting the `len(s) < N` panic when discarded).

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W4.1 (L93 repro) | `s := []int{1, 2, 3}; fmt.Println([2]int(s))` | `[1 2]` | `local.tee[0] expected type (ref null $arr), found ... (ref null $slice)` |
| W4.2 *sibling* | `[2]float64(s)`, `[2]string(s)`, `[2]S(s)`, `[0]int(s)`, `[2]any(s)`, `[2]int(s[1:])`, defined `type A [2]int; A(Sl{...})`, copy isolation (`s[0] = 99`), `(*[2]int)(s)`, `(*[0]int)(nil)` | Go output (and panic on `len(s) < N`) | invalid WasmGC; discarded short `[2]int([]int{1})` prints `<nil>` instead of panicking |

### W5 `wasm-prescan-misses-nested-any-in-arrays-and-map-keys` (L35)
Root: `_usesAnyEq` (`src/backend/wasm/prescan.js:79-103`) and `mod.usesAnyHash` (`src/backend/wasm/index.js:906-912`) only inspect top-level `anyref` / `isInterfaceType`, missing interfaces nested inside arrays and map-key structs/arrays. When `__any_hash` is omitted, `emitKeyHash` (`src/backend/wasm/emit-maps.js:95-99`) emits `call null` → func index `0` (`externref` import) → invalid WasmGC.

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W5.1 (L35 repro) | `func f(a, b [2]any) bool { return a == b }` (no `fmt`) | valid module | ICE `__any_eq was not declared` |
| W5.2 *sibling* | `[2]I == [2]I`, `[2][2]any == [2][2]any`, `[2]any != [2]any`, `switch a { case [2]any{1, 2}: }`, `map[[2]any]int` (no `fmt`) | valid module + Go output | ICE `__any_eq was not declared` |
| W5.3 *sibling* | `map[[2]any]int` (with `fmt`); `map[struct{ A any }]int` (with or without `fmt`) | valid module + Go output | `call[0] expected type externref, found local.get of type anyref` (missing `__any_hash`) |
| control | `struct{ A any } == struct{ A any }`; `any([2]any{1,2}) == any([2]any{1,2})` | passes | passes (must stay) |

### W6 `wasm-prescan-misses-boundary-anon-interface-dispatchers`, `wasm-recv-type-name-selector-misreads-field-as-pkg` (L50, L94, L51)
Roots:
1. `_scanFuncSigInterfaces` (`src/backend/wasm/prescan.js:231-274`) only scans top-level function param/return types (not composite types `[]T`, `map[K]V`, `*T`, `[N]T`, `struct{...}`), and `_collectInterfaceDispatchers` (`src/backend/wasm/index.js:1213-1252`) never scans exported struct fields or globals; `boundary.js:1584-1593` (`addIfaceHelpers`) then ICEs when a boundary-reachable anonymous interface lacks a dispatcher.
2. `_getReceiverTypeName` (`src/backend/wasm/emit.js:1368-1393`, lines 1388–1391) falls back to `${node.expr.name}.${node.field}` when `recvType` has no `.name`, misreading single-hop field selector `v.X` as package `"v"` type `"X"`, so `_emitMethodCall` (`src/backend/wasm/emit-builtins.js:1186`) looks up `__dispatch_v.X_M` instead of `anonIfaceName(recvType)`.

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W6.1 (L50 + L94 repros) | `type Box struct{ v interface{ M() int } }`; `type Box[T any] struct{ V T }; var b Box[interface{ M() struct{ X int } }]` | valid module (`main.Box`, `true`) | ICE `no wasm dispatcher for interface method anon_iface_...M` |
| W6.2 *sibling* | `func F(xs []interface{ M() int }) int`; `map[string]interface{ M() int }`; `*interface{ M() int }` | valid module | same missing-dispatcher ICE |
| W6.3 (L51 repro & siblings) | `v := struct{ X interface{ M() int } }{A{}}; v.X.M()`; named `Box{X: A{}}.X.M()`; generic `b.V.M()` | `9` | ICE `Cannot resolve struct for selector: M` |
| control | unexported `type box struct{...}`; `v := struct{ X I }{A{}}; v.X.M()`; chained `o.I.X.M()`; `xs[0].M()` | passes | passes (must stay) |

---

## Approach

### 1. Architecture & Design Decisions
- **W1 (`globals.js`):** In `_collectPackageGlobals`, gate `isConstInit = true` on matching Wasm types (`INT`/`RUNE`: `wType === "i32" || wType === "i64"`, or float const for `f32`/`f64`; `FLOAT`: `wType === "f32" || wType === "f64"`; `BOOL`: `wType === "i32"`). Everything else runs in `__init_globals`, with `_makeGlobalInitFunc` stamping the global's declared `goType` onto `lhs._type`.
- **W2 (`types.js`, `emit.js`, `globals.js`):** Add checker-aware `isComplex(t, checker)` / `isComplex64(t, checker)` using `namedBase(t, checker)` in `src/backend/wasm/types.js`. Update `isReplaceableRef` to check `isFuncType(goType, checker)` and resolved `isComplex(goType, checker)` (and `namedBase` pointer unwrapping). Pass `checker` to `isComplex` in `emitZeroValue` (`src/backend/wasm/emit.js:1679`) and handle complex array elements in `_zeroArrayConst` (`src/backend/wasm/globals.js:160`).
- **W3 (`monomorph.js`):** After monomorphisation emits specializations and before `monoChecker.checkAll(progs)` (`src/backend/wasm/monomorph.js:956`), call `renameLocalTypes(progs, topLevel)` (from `src/link/type-names.js`) and avoid seeding stale pre-monomorph generic-template local types into `monoChecker.types`.
- **W4 (`emit-exprs.js`):** Add `slice -> array` and `slice -> *array` branches in `emitTypeConversion`. Both unpack `(arr, off, len)` and panic with Go's exact message when `len < N`. `[N]T(s)` allocates a fresh `$arr_T` of length `N` and copies `N` elements from `off` (deep-cloning nested struct/array elements to preserve value semantics). `(*[N]T)(s)` returns `ref.null` when `s == nil && N == 0`, returns `arr` directly when `off == 0 && array.len(arr) === N`, and throws a clear `UnsupportedError` when `off > 0` or `array.len(arr) !== N` (since WasmGC GC arrays cannot form sub-array interior pointers without changing array representation).
- **W5 (`prescan.js`, `index.js`, `emit-maps.js`):** Add recursive `containsInterfaceType(goType, checker, seen)` (unwrapping `named`/`TypeName`, descending into `array` elements and non-pointer `struct` fields) in `src/backend/wasm/prescan.js` and reuse it in both `_usesAnyEq` and `mod.usesAnyHash` (`src/backend/wasm/index.js:906-912`). Throw an explicit internal error in `emit-maps.js:97` if `resolveFuncIndex("__any_hash")` is `null`.
- **W6 (`prescan.js`, `emit.js`, `emit-builtins.js`):** Make `_scanFuncSigInterfaces`'s `scanType` recurse through composites (with cycle guard) and also walk exported `TypeDecl` structs (`mod.structTypes`) and package `VarDecl`s. Guard `src/backend/wasm/emit.js:1388-1391` so `SelectorExpr` is only treated as `pkg.Type` when `!recvType || node.expr?._type?.kind === "namespace"`, and in `src/backend/wasm/emit-builtins.js:1186` compute `ifaceName` via `getReceiverTypeName(recvType) ?? anonIfaceName(recvType)`.

### 2. Invariants & Safety Bounds
- Every generated module passes `WebAssembly.validate` (enforced by compiler gate) and produces zero null-deref traps for zero-initialized arrays of defined complex types.
- `containsInterfaceType` and `scanType` maintain a `seen` `Set` so recursive struct types (`type Node struct{ Next *Node }`) always terminate.
- Unexported types never gain unnecessary boundary dispatchers unless actually called.

### 3. Edge Cases & Error Handling
- `[0]T(nil)` succeeds with a zero-length array; `(*[0]T)(nil)` returns `nil`; `(*[0]T)([]T{})` returns non-nil pointer to `[0]T`; `[1]T(nil)` panics with `len = 0, array len = 1`.
- Defined complex arrays `[2]C` inside structs (`type S struct{ A [2]C }`) and package globals (`var g [2]C`) both initialize each complex element to `(0+0i)`, never null.
- `new(F)` sets the box slot to `ref.null $closure_F` so `*pf == nil` is `true`, and `*pf = fn; (*pf)()` invokes the stored closure cleanly.

---

## Implementation Tasks

### Phase 1: Global Initializers, Replaceable-Ref Pointers & Monomorph Local Types (roots `wasm-global-const-init-type-mismatch`, `wasm-func-pointer-missing-from-replaceable-ref`, `wasm-typename-complex-unresolved-in-backend`, `wasm-monomorph-local-type-collision`)
*Scheduled from review follow-ups (2026-11-24).*
- [ ] Task 1.1: Guard Wasm global constant initializers by `wType` and pass declared `goType` to `__init_globals` (W1.1–W1.3)
  - Files: `src/backend/wasm/globals.js` (`_collectPackageGlobals`, `_makeGlobalInitFunc`)
  - Test: `test/unit/wasm/strings_any.test.js`, `test/unit/wasm/scalars.test.js`, `test/unit/wasm/complex.test.js`: W1.1–W1.3 (`var a any = 1 / true / 'a' / -5 / 1.5 / -1.5`, `var f float64/float32 = 1`, `var c complex128 = 1 / 1.5`) + controls
  - Done when: all mismatched-literal package globals initialize via `__init_globals` and produce valid WasmGC matching Go
- [ ] Task 1.2: Fix `isReplaceableRef` for func & defined complex types and use checker-aware `isComplex` for `[N]C` zero init (W2.1–W2.5)
  - Files: `src/backend/wasm/types.js` (`isReplaceableRef`, `isComplex`, `isComplex64`), `src/backend/wasm/emit.js` (`emitZeroValue`), `src/backend/wasm/globals.js` (`_zeroArrayConst`)
  - Test: `test/unit/wasm/pointers.test.js` (W2.1–W2.2: `new(F)`, `new(func...)`, `*pf = fn`, `(*pf)()`, closure, `*F` param), `test/unit/wasm/complex.test.js` (W2.4–W2.5: `var p *C = new(C)`, `func mk() *C`, `var a [2]C`, `var g [2]C`), `test/unit/wasm/fmt-any.test.js` (W2.3–W2.4: defined `C`, `C64`, `C2` in `any` → `fmt.Println` & `%T`)
  - Done when: `new(F)`, `*C`, defined complex in `any` → `fmt`, and `[N]C` zero values all compile cleanly and match Go without null traps
- [ ] Task 1.3: Rename local types across monomorphised generic instantiations (W3.1–W3.2)
  - Files: `src/backend/wasm/monomorph.js` (`monomorphise`)
  - Test: `test/unit/wasm/generics.test.js`: W3.1–W3.2 (local struct, slice, and alias inside generic function and generic method instantiated with `int` and `string`), plus regression test in `test/unit/wasm/structs.test.js` for already-fixed L12 (`type W[B any] S[B]`)
  - Done when: multiple instantiations of generic functions/methods with local types produce distinct types and valid WasmGC

### Phase 2: Slice-to-Array Conversion, Any-Eq/Hash Prescan & Anonymous Interfaces (roots `wasm-missing-slice-to-array-conversion`, `wasm-prescan-misses-nested-any-in-arrays-and-map-keys`, `wasm-prescan-misses-boundary-anon-interface-dispatchers`, `wasm-recv-type-name-selector-misreads-field-as-pkg`)
- [ ] Task 2.1: Implement slice-to-array (`[N]T(s)`) and slice-to-array-pointer (`(*[N]T)(s)`) conversions on WASM (W4.1–W4.2)
  - Files: `src/backend/wasm/emit-exprs.js` (`emitTypeConversion`)
  - Test: `test/unit/wasm/arrays.test.js`: W4.1–W4.2 (`[2]int(s)`, `[2]float64(s)`, `[2]string(s)`, `[2]S(s)`, `[0]int(s)`, `[2]any(s)`, `[2]int(s[1:])`, defined `A(Sl{...})`, copy isolation, `len(s) < N` panic under `recover()`, `(*[2]int)(s)`, `(*[0]int)(nil)`)
  - Done when: slice-to-array conversions copy elements, enforce length bounds with Go's panic, and produce valid WasmGC
- [ ] Task 2.2: Scan arrays and structs recursively for `__any_eq` and `__any_hash` (W5.1–W5.3)
  - Files: `src/backend/wasm/prescan.js` (`containsInterfaceType`, `_usesAnyEq`), `src/backend/wasm/index.js` (`usesAnyHash`), `src/backend/wasm/emit-maps.js` (`emitKeyHash`)
  - Test: `test/unit/wasm/arrays.test.js` (no-`fmt` `[2]any ==`, `[2]I ==`, `[2][2]any ==`, `switch [2]any`), `test/unit/wasm/map-keys.test.js` (`map[[2]any]int`, `map[struct{ A any }]int`, `map[[1][2]any]int`, with and without `fmt`)
  - Done when: nested interface equality and map hashing declare `__any_eq` and `__any_hash` without relying on `fmt`
- [ ] Task 2.3: Scan boundary-reachable composites for anonymous-interface dispatchers and fix single-hop selector dispatch (W6.1–W6.3)
  - Files: `src/backend/wasm/prescan.js` (`_scanFuncSigInterfaces`), `src/backend/wasm/emit.js` (`_getReceiverTypeName`), `src/backend/wasm/emit-builtins.js` (`_emitMethodCall`)
  - Test: `test/unit/wasm/interfaces.test.js`, `test/unit/wasm/boundary.test.js`: W6.1–W6.2 (`Box{v interface{ M() int }}`, `Box[interface{ M() struct{ X int } }]`, `[]interface{ M() int }`, `map[string]interface{ M() int }`, `*interface{ M() int }`), W6.3 (`v.X.M()` on anonymous, named, and generic structs) + controls
  - Done when: boundary-reachable anonymous interfaces with 0 implementors build cleanly and single-hop `v.X.M()` calls dispatch without ICE
