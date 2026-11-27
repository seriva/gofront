# Pre-Release Correctness Fixes — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-26 and expanded 2026-11-27 (pre-v2.0.0 release blockers from `typed-web-fixes` PR #325, `wasm-codegen-fixes` PR #331, `multi-package-fixes` PRs #333–#336, `js-codegen-and-value-semantics` PRs #338/#341/#342, and `generics-and-aliases` PR #345). Shares `src/backend/js/{expressions,index,statements}.js` and `src/typechecker/{expressions,index,resolve}.js` with `js-codegen-and-value-semantics`; run after `js-codegen-and-value-semantics` lands on `main`. Independent of `web-and-ui-fixes` (only `src/backend/js/{expressions,runtime}.js` overlap).  
**Release note:** Arrays and `make` slices of slices (`var a [1][]int`, `make([][]int, 1)`) now zero-initialize their elements on WebAssembly instead of crashing with a null-pointer dereference, JavaScript slice-to-array conversions (`[N]T(s)`, `(*[N]T)(s)`) now check length, handle nil slices, and deep-copy aggregate elements, and JavaScript now handles keyed literals of named slices (`Vec{2: "ok"}`), zero values of aliases to generic structs (`type IntPair = Pair[int]`), taking the address of or calling pointer methods on another local package's scalar variable (`&a.X`, `lib.GlobalNum.Inc()`), taking the address of named return variables or map/iterator `range` variables, and block-shadowing outer variables with `var` or `const` without throwing a `ReferenceError`. **Breaking:** Instantiating a generic type with a type argument that does not satisfy its constraint (`Box[int]{}`), declaring a generic type inside a function, assigning distinct same-named types across a dot import, non-integer constant keys in array or slice literals (`[2]int{"x": 1}`), and taking `&a.X` or calling pointer-receiver methods on another package's scalar variable in `wasm`/`both` packages are now compile errors.

---

## Goal

Close the last pre-release correctness blockers before cutting v2.0.0 across four focused areas:

1. **Breaking-if-deferred checker holes (Phase 1):** Enforce Go's compile-time rules that would be breaking to tighten after v2.0.0 — type-parameter constraints on generic type instantiations (`Box[int]{}`, `var b Box[int]`), rejecting function-local generic type declarations (`type L[T any] struct{...}` inside a function), preserving distinct type identity when one of two same-named imported types is dot-imported (`var y Box = a.One()`), and rejecting non-integer constant keys in array/slice literals (`[2]int{"x": 1}`).
2. **WebAssembly zero-initialized slice elements (Phase 2):** Initialize slice-typed elements of arrays, nested arrays, package-level array globals, and `make([][]T, n)` / `make([]NamedSlice, n)` to the empty-slice global (`emptyGlobalIndex`) instead of `ref.null`, eliminating null-pointer dereference crashes in common 2D slice and array-of-slice programs.
3. **JavaScript runtime conversions, cross-package scalar pointers, and zero values (Phase 3):** Make JS slice-to-array conversions (`[N]T(s)`, named `A2(s)`, `(*[N]T)(s)`) check length with Go's panic text, handle nil slices, and deep-copy struct/array elements; support taking `&a.X`, dot-imported `&X`, and `lib.GlobalNum.Inc()` on JS (and reject them with the scalar-interior error on `wasm`/`both`); emit keyed literals of named slice types (`Vec{2: "ok"}`, `Bytes{2: 65}`) as arrays/typed arrays; and construct zero structs for aliases of instantiated generic types (`type IntPair = Pair[int]; var p IntPair`).
4. **JavaScript variable boxing & block-shadowing TDZ (Phase 4):** Box address-taken scalar named return variables (`func g() (v int) { p := &v; ... }`) and `for range` map/iterator short-declared variables (`for _, v := range m`, `for k := range m`, `for v := range seq`), and extend `genBlock` / `_bodyRedeclares` TDZ handling from `:=` to `var` and `const` declarations (`{ var y = y + 1 }`, `for i := range 3 { _ = i; var i = 10 }`).

**Done means:**
- Every invalid-Go case in Phase 1 (P1–P4, incl. siblings) fails to compile with the expected diagnostic (`assertErrorContains`) in `test/unit/types/generics.test.js`, `test/unit/types/checks.test.js`, and `test/unit/compiler/packages.test.js`, while valid controls continue to compile and run.
- Every WASM slice-element zero-value case in Phase 2 (W1.1–W1.5: local `[N][]T`, `make([][]T, n)`, package-level `var a [N][]T`, nested `[N][M][]T`, named-slice elements `make([]Ints, n)`) produces Go's output on `js`, `both`, and `wasm` (`assertAllTargetsOutput`) in `test/unit/language/slices.test.js` (and `test/unit/wasm/` if needed).
- Every JS runtime case in Phase 3 (R1–R4, incl. siblings `lib.GlobalNum.Inc()` and dot-imported `GlobalNum.Inc()`) produces Go's output across all applicable targets (`test/unit/language/arrays.test.js`, `test/unit/compiler/packages.test.js`, `test/unit/language/slices.test.js`, `test/unit/types/generics.test.js`), and `&a.X` / `lib.GlobalNum.Inc()` in `wasm`/`both` packages report the scalar-interior compile error documented in `docs/hybrid-wasm.md`.
- Every JS boxing & block-shadowing case in Phase 4 (B1.1–B1.6, B2.1–B2.6) produces Go's output on `js` and `both` (and `wasm` where applicable) in `test/unit/language/pointers.test.js`, `test/unit/language/range-iter.test.js`, and `test/unit/language/declarations.test.js`.
- `npm test`, `npm run check`, and `npm run test:e2e` pass with zero regressions.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Roots `generic-struct-constraint-skipped`, `local-generic-type-accepted`, `dot-import-type-identity`, `array-lit-nonint-const-key`: enforce generic type-argument constraints in `instantiateGenericType`, reject `decl.typeParams` when `scope !== this.globals` in `collectType`, preserve distinct type identity across dot-import registration (`_bindImportedType` / `resolveType`), and reject non-integer constant keys in `_checkArrayLitKeys` | `Box[int]{}` where `T I`, `var b Box[int]`, `func f() { type L[T any] struct{} }`, `type L[T any] = []T` inside func, `var y Box = a.One()` with `import . "./b"`, `[2]int{"x": 1}`, `[]int{"x": 1}`, `[2]int{1.5: 1}` | |
| **In scope: core** | Root `cross-pkg-scalar-addr`: treat imported package-level scalar `var`s consistently across targets — live getter/setter accessor with bundle-unique `__index` on `js` (for `&a.X`, dot-imported `&X`, and pointer-receiver calls `lib.GlobalNum.Inc()` / `GlobalNum.Inc()`), and scalar-interior compile error on `both`/`wasm` via `_isScalarInteriorOperand` | `p := &a.X; *p = 7; a.X++`, `import . "./a"; p := &X`, `lib.GlobalNum.Inc()`, `GlobalNum.Inc()`, `&a.X == &a.X`, `&a.X == &b.X` | |
| **In scope: target-specific (`wasm`)** | Root `wasm-array-slice-elem-zero`: initialize slice-typed elements (plain or named) to `global.get sliceInfo.emptyGlobalIndex` in `_emitNewArray` / `emitZeroValue`, `emitMakeSlice`, and `_zeroArrayConst` | `var a [1][]int`, `make([][]int, 1)`, `append(m[0], 7)`, `[0]int(a[0])`, package-level `var a [2][]int`, `var a [2][2][]int`, `make([]Ints, 1)` | JS already represents zero slices as `null` without null-dereferencing on `len`/`append` |
| **In scope: target-specific (`js`, `both`)** | Roots `js-slice-to-array-conv`, `js-named-slice-keyed-lit`, `js-alias-generic-zero`, `js-addr-taken-named-return-and-range`, `js-block-shadow-var-const-tdz`: validate length, guard nil, deep-copy aggregate elements, and support `(*[N]T)(s)` in JS slice→array conversions; dispatch named-slice literals through `_genSliceOrArrayLit` / `_litIndexedShape`; construct instantiated generic structs in `_zeroForNamedType`; box address-taken scalar named returns and map/iter `range` short vars; handle `var`/`const` shadowing in `genBlock` and `_bodyRedeclares` | `[2]S(s)`, `[2][2]int(s)`, `[2]int([]int{1})`, `A2(s)`, `[0]int(nilSlice)`, `(*[2]int)(s)`, `(*[2]int32)(s)`, `Vec{2: "ok"}`, `Bytes{2: 65}`, `Vec{3: 9, 1: 4}`, `var p IntPair`, `var q PP`, `func g() (v int) { p := &v }`, `for _, v := range m { &v }`, `for v := range seq { &v }`, `{ var y = y + 1 }`, `for i := range 3 { _ = i; var i = 10 }` | WASM already passes `[N]T(s)`, `Vec{2: "ok"}`, `var p IntPair`, named return `&v`, and map/iter `&v`, and already rejects `(*[N]T)(s)` at compile time |
| **Excluded: runtime / platform** | `(*[N]T)(s)` and `&a.X` on scalar package vars in `wasm`/`both` packages | `(*[2]int)(s)`, `p := &a.X` in `wasm`/`both` | WasmGC cannot alias a slice backing array as an array pointer or take interior pointers to scalar globals; both report clear compile errors |
| **Excluded: deferred** | Smaller invalid-Go accepts (`plans/follow-ups.md` C2: L13, L19, L21, L22, L42, L56, L90, L91) and multi-package `fmt`/`json` dynamic types (C5: L102–L104) | `defer min(f2())`, `x := 1; x = 2`, `fmt.Printf("%T %v", sub.New(), ...)` | User decision 2026-11-26: keep v2.0.0 pre-release pass minimal; left open in `plans/follow-ups.md` |

---

## Verified Gaps & Baseline Audit

**Method.** Read-only code inspection and probes via `compile`, `compileDir`, and `runProgram` from `test/unit/helpers.js` on `main` (`080c09f6`, 2026-11-26).

### Phase 1 Roots (Checker Soundness)

#### P1 `generic-struct-constraint-skipped` (PR #333, `multi-package-fixes` Phase 1)
Root: `_resolveGenericTypeNode` (`src/typechecker/resolve.js:780-790`) calls `_instantiateGenericAlias` (`:1155-1174`, which checks arity and calls `checkConstraint` for every `tp.constraint`) for generic aliases, but calls `instantiateGenericType` (`:1015-1018`) → `instantiateGenericWithArgs` (`:1043-1126`) for generic defined types (structs, slices, maps, etc.), which **never checks arity or `tp.constraint`**. Note: during type collection (`this._collectingTypes`), constraints referencing interfaces whose methods are collected later must wait via `this._pendingConstraintUses` (matching `_checkMapKey` at `:1547-1555`) or run after `collectMethods`.

| ID | Program / Probe | Expected | Observed on `main` (`js` / `wasm`) |
|---|---|---|---|
| P1.1 | `type I interface{ Foo() }; type Box[T I] struct{ V T }; func main() { _ = Box[int]{V: 1} }` | compile error (`does not satisfy constraint I`) | `OK (0 errors)` |
| P1.2 *sibling* | `var b Box[int]; _ = b` (non-literal type position, plus foreign `util.I` with unexported method and `type List[T comparable] []T; var x List[[]int]`) | compile error (`does not satisfy constraint`) | `OK (0 errors)` |
| control | `type Good[T I] = Box[T]; var b Good[int]` | `type int does not satisfy constraint I` | Passes (must stay) |

#### P2 `local-generic-type-accepted` (PR #336, `multi-package-fixes` Phase 4)
Root: `collectType` (`src/typechecker/index.js:1348-1405`) is called for both package-level `TypeDecl` (`scope = null`) and function-local `TypeDecl` (`scope !== null && scope !== this.globals`, via `CHECK_STMT_DELEGATE.TypeDecl` in `src/typechecker/statements.js:7`), and accepts `decl.typeParams` without checking whether `decl` is inside a function/block. Go forbids type parameters on local type declarations (both defined types and aliases). On `wasm`, local generic structs produce invalid WasmGC modules.

| ID | Program / Probe | Expected | Observed on `main` (`js` / `wasm`) |
|---|---|---|---|
| P2.1 | `func main() { type L[T any] struct{ k T }; l := L[int]{k: 3}; fmt.Println(l.k) }` | compile error (`type parameters` / `local type` not allowed) | `js`: `OK (0 errors)`; `wasm`: `internal compiler error: the generated WebAssembly is invalid` |
| P2.2 *sibling* | `func main() { type L[T any] []T; var x L[int]; _ = x }` | compile error | `OK (0 errors)` |
| P2.3 *sibling* | `func main() { type L[T any] = []T; var x L[int]; _ = x }` | compile error | `OK (0 errors)` |
| control | Package-level `type L[T any] struct{ k T }` and non-generic local `type L struct{ k int }` | compiles and runs | Passes (must stay) |

#### P3 `dot-import-type-identity` (PR #333, `multi-package-fixes` Phase 1)
Root: `addDefinitions` (`src/typechecker/index.js:226`) calls `_bindImportedType(file, name, type)` (`:281-288`) for every exported entry of a dot-imported package `b`, including the unmangled key `"Box"` whose `type` is `b`'s collision-renamed `Box$$b`. Unlike `addPackageNamespace` (`:393-407`), `_bindImportedType` does not track `this._ambiguousImported` and unconditionally overwrites `this.types.set("Box", bBox)` (clobbering `a`'s `Box`). Later, `resolveType(aBox)` (`src/typechecker/resolve.js:1634-1645`) sees `!aBox.methods` (true for struct named types, whose `methods` live on `underlying`), looks up `this.types.get("Box")` → `bBox`, sees `aBox` is not in `_ambiguousImported`, and replaces `aBox` with `bBox`, making `a.One()` appear identical to `b`'s `Box`.

| ID | Program / Probe | Expected | Observed on `main` (`js` / `both` / `wasm`) |
|---|---|---|---|
| P3.1 | `a`: `type Box struct{ V int }; func One() Box`; `b`: `type Box struct{ V int }`; `main`: `import "./a"; import . "./b"; var y Box = a.One()` | compile error (`cannot use a.One() … as Box value`) | `js`/`both`: compiles & prints `1`; `wasm`: invalid WasmGC ICE (`local.tee[0] expected type ...`) |
| P3.2 *sibling* | `b` also has `func Take(x Box) int`; `main`: `_ = Take(a.One())` | compile error | `js`/`both`: compiles & runs; `wasm`: invalid WasmGC ICE (`call[0] expected type ...`) |
| control | Non-dot `import "./a"; import "./b"; var y b.Box = a.One()` | `cannot use a.One() (value of type Box) as b.Box value` | Passes (must stay) |

#### P4 `array-lit-nonint-const-key` (PR #325, `typed-web-fixes` Phase 2)
Root: `_checkArrayLitKeys` (`src/typechecker/expressions.js:2315-2347`) skips validation whenever `idx === null && this._isConstExpr(elem.key, scope)` (`:2324-2331`), assuming any non-folded constant expression is an unevaluated integer constant like `len(arr)`. Because `BasicLit` (`"x"`, `1.5`, `true`) satisfies `_isConstExpr`, non-integer constants silently skip the `index ... must be integer constant` error.

| ID | Program / Probe | Expected | Observed on `main` (`js` / `wasm`) |
|---|---|---|---|
| P4.1 | `_ = [2]int{"x": 1}` | compile error (`index "x" must be integer constant`) | `OK (0 errors)` |
| P4.2 *sibling* | `_ = []int{"x": 1}` and `_ = [2]int{1.5: 1}` and `_ = [2]int{true: 1}` | compile error (`must be integer constant`) | `OK (0 errors)` |
| control | `n := 1; _ = [2]int{n: 1}`; `var arr [3]int; _ = [4]int{len(arr): 1}`; `_ = [3]int{'a' - 'a': 1}` | rejects `n`; accepts `len(arr)` and integer/rune consts | Passes (must stay) |

### Phase 2 Root (WebAssembly Slice-Element Zero Values)

#### W1 `wasm-array-slice-elem-zero` (PR #331, `wasm-codegen-fixes` Phase 4)
Root: On WASM, a Go slice is a non-null WasmGC struct `{ arr, off, len, cap }` whose zero value is `global.get sliceInfo.emptyGlobalIndex` (`src/backend/wasm/emit.js:1701-1719`, `src/backend/wasm/globals.js:120`), never `ref.null`. Three array-allocation sites emit `array.new_default` (filling slots with `ref.null`) when the element type is a slice (or named slice):
1. `emitZeroValue` / `_emitNewArray` (`src/backend/wasm/emit.js:1680-1699, 1742-1757`) only checks `isStructType`, `isComplex`, `isArrayType`, and `isStringType` — missing `isSliceType`.
2. `emitMakeSlice` (`src/backend/wasm/emit-builtins.js:314-319`) only loops over `isStructType`, `isComplex`, and `isArrayType` — missing `isSliceType` (note: `make([]string, n)` already handles strings via `_emitNewArray` or its own branch; `make([][]T, n)` uses `array.new_default`).
3. `_zeroArrayConst` (`src/backend/wasm/globals.js:160-194`) only builds non-default elements for nested arrays, structs, and complex — missing slices (which can use `[{ op: "global.get", index: sliceInfo.emptyGlobalIndex }]`, already used in `globals.js:120`).

| ID | Program / Probe | Expected | Observed on `main` (`wasm`) |
|---|---|---|---|
| W1.1 | `var a [1][]int; fmt.Println(len(a[0]))` (and `[0]int(a[0])`) | `0` (`[]`) | `dereferencing a null pointer` |
| W1.2 | `m := make([][]int, 1); m[0] = append(m[0], 7); fmt.Println(m[0][0])` | `7` | `dereferencing a null pointer` |
| W1.3 *sibling* | Package-level `var a [2][]int; func main() { fmt.Println(len(a[0]), len(a[1])) }` | `0 0` | `dereferencing a null pointer` |
| W1.4 *sibling* | Nested `var a [2][2][]int; fmt.Println(len(a[1][1]))` | `0` | `dereferencing a null pointer` |
| W1.5 *sibling* | Named slice elem: `type Ints []int; m := make([]Ints, 1); m[0] = append(m[0], 5); fmt.Println(m[0][0])` | `5` | `dereferencing a null pointer` |
| control | `var a [1]struct{ xs []int }`, `a := [3][]int{2: {9}}`, `make([]string, 2)`, `var g [2]string` | `0`, `0 1`, `0 true`, `true true` | Passes (must stay) |

### Phase 3 Roots (JS Runtime Conversions, Cross-Package Scalar Pointers & Zero Values)

#### R1 `js-slice-to-array-conv` (PR #331, `wasm-codegen-fixes` Phase 4)
Root: Two coupled gaps in `src/backend/js/expressions.js`:
1. `_genArrayTypeConversion` (`:3922-3933`) emits bare `${inner}.slice(0, ${size})` for every slice→array conversion (`[N]T(s)` and named `type A2 [2]int; A2(s)` via `_resolvedConversionTargetNode` at `:2225-2226`), skipping: (a) nil guard (`[0]int(nilSlice)` crashes `.slice`), (b) length check (`len(s) < size` silently returns a short array instead of panicking with Go's `runtime error: cannot convert slice with length M to array or pointer to array with length N`), and (c) element cloning for struct/array elements (`[2]S(s)`, `[2][2]int(s)` alias `s`'s elements).
2. `_resolvedConversionTargetNode` (`:2217-2241`) has no `pointer` case, so `(*[N]T)(s)` (`_genTypeConversionCall` at `:2262-2270`) returns bare `arg` (or misses `{ value: ... }` boxing), and JS `PointerType` conversions have no handler — so `(*[2]int)(s)` dereferences `.value` on a plain array (`undefined`) and throws `Cannot set properties of undefined`, and skips the nil/length checks (`(*[0]int)(nilSlice)` → `nil`, `(*[2]int)(shortSlice)` → panic).

| ID | Program / Probe | Expected | Observed on `main` (`js` / `both`) |
|---|---|---|---|
| R1.1 | `s := []S{{1}, {2}}; a := [2]S(s); s[0].X = 9; fmt.Println(a)` (and `s := [][2]int{{1,2},{3,4}}; a := [2][2]int(s); s[0][0] = 9`) | `[{1} {2}]` (`1`) | `[{9} {2}]` (`9`) |
| R1.2 | `defer recover(); _ = [2]int([]int{1})` and named `type A2 [2]int; _ = A2([]int{1})` | panic `runtime error: cannot convert slice with length 1 to array or pointer to array with length 2` | `<nil>` (no panic; prints `[1 -922372036854775808]`) |
| R1.3 | `var s []int; fmt.Println([0]int(s))` | `[]` | `Cannot read properties of null (reading 'slice')` |
| R1.4 | `s := []int{1, 2}; p := (*[2]int)(s); p[0] = 7; fmt.Println(s[0])` and `[]int32` (`(*[2]int32)(s)`) on `js` | `7` (`9 2`, mutates `s` through `*p`) | `Cannot set properties of undefined (setting '0')` |
| R1.5 *sibling* | `var s []int; (*[0]int)(s) == nil` and `(*[2]int)([]int{1})` under `recover()` on `js` | `true`; panics with slice-length message | `true`; `<nil>` (no panic) |
| control | WASM `[2]S(s)`, `[2]int([]int{1})`, `[0]int(nilSlice)`, `A2(s)`; WASM/both `(*[2]int)(s)` compile error | Go output / compile error | Passes (must stay) |

#### R2 `cross-pkg-scalar-addr` (PR #336, `multi-package-fixes` Phase 4)
Root: Two halves across checker and JS backend:
1. `_isScalarInteriorOperand` (`src/typechecker/expressions.js:604-605`) returns `false` for every `SelectorExpr` whose base has `_type.kind === "namespace"`, allowing `&a.X` on another local package's scalar variable in `wasm`/`both` packages (where WASM emits a detached temporary box, giving `7 2` instead of `7 8`), even though dot-imported `&X` is already rejected with the scalar-interior error.
2. On JS (`src/backend/js/expressions.js:1328-1365`), bundled local packages emit their package-level variables as flat top-level `let X` / `let X$$a` bindings (never on an object `a`), so: (a) `_genUnaryExpr("&")` (`:1358-1362`) hits the `SelectorExpr` branch for `&a.X` and emits `((__o) => ... __o.X ...)(a)` → `ReferenceError: a is not defined`; and (b) for dot-imported `&X`, `X` is not in the importing package's `this._boxedVars`, so `:1328-1334` falls through to `:1364` (`{ value: X }`, a detached copy) or emits an unboxed read.

| ID | Program / Probe | Expected | Observed on `main` (`js` / `both` / `wasm`) |
|---|---|---|---|
| R2.1 | `a`: `var X = 1`; `main`: `p := &a.X; *p = 7; a.X++; fmt.Println(*p, a.X)` | `js`: `7 8`; `both`/`wasm`: scalar-interior compile error | `js`/`both`: `ReferenceError: a is not defined`; `wasm`: prints `7 2` (detached copy) |
| R2.2 *sibling* | `a`: `var X = 1`; `main`: `import . "./a"; p := &X; *p = 7; X++; fmt.Println(*p, X)` | `js`: `7 8`; `both`/`wasm`: scalar-interior compile error | `js`: runtime error (`p.value = 7` on unboxed/detached value); `both`/`wasm`: compile error (already passes) |
| R2.3 *sibling (PR #342)* | `lib` (`both`): `type Num int; var GlobalNum Num; func (n *Num) Inc() { *n++ }`; `main`: `lib.GlobalNum.Inc(); fmt.Println(lib.GlobalNum)` | `js`: `1`; `both`/`wasm`: scalar-interior compile error | `js`/`both`: `ReferenceError: lib is not defined`; `wasm`: prints `0` (detached copy) |
| R2.4 *sibling* | Same `lib` dot-imported in `main`: `GlobalNum.Inc(); fmt.Println(GlobalNum)` | `js`: `1`; `both`/`wasm`: scalar-interior compile error | `js`: runtime error (`n.value++` on unboxed `0`); `both`/`wasm`: compile error (already passes) |
| control | `&a.St.V` and `&a.Arr[1]` | `js`: `7 99`; `both`/`wasm`: scalar-interior compile error | Passes (must stay) |

#### R3 `js-named-slice-keyed-lit` (PR #336, `multi-package-fixes` Phase 4)
Root: `genCompositeLit` (`src/backend/js/expressions.js:3055-3058`) checks `_isSliceOrArrayType(t)` (which only matches AST `SliceType`/`ArrayType`, not named `TypeName`) and falls through to `_genFallbackCompositeLit` (`:2813-2833`). `_genFallbackCompositeLit` checks `_litArrayType(expr)` (arrays only, not slices), so a keyed named-slice literal (`Vec{2: "ok"}`, `Bytes{2: 65}`) hits line 2823 (`expr.elems[0]?.kind === "KeyValueExpr"`) and emits a plain JS object `{ 2: "ok" }` instead of a dense array/TypedArray via `_litIndexedShape` (`:2969-2980`)!

| ID | Program / Probe | Expected | Observed on `main` (`js` / `both` / `wasm`) |
|---|---|---|---|
| R3.1 | `type Vec []string; v := Vec{2: "ok"}; fmt.Println(len(v), v[2])` | `3 ok` | `js`: `1 ok` (`{ 2: "ok" }`); `both`: `index out of range [2] with length undefined`; `wasm`: `3 ok` |
| R3.2 *sibling* | `type Bytes []byte; b := Bytes{2: 65}; type Vec []int; v := Vec{3: 9, 1: 4}; fmt.Println(len(b), b[2], len(v), v[0], v[1], v[3])` | `3 65 4 0 4 9` | `js`: `1 65 2 -922372036854775808 4 9`; `both`: `index out of range [2] with length undefined`; `wasm`: `3 65 4 0 4 9` |
| control | Unkeyed `Vec{"a", "b"}`, named array `type A [3]string; A{2: "ok"}`, unnamed `[]string{2: "ok"}` | Go output on all targets | Passes (must stay) |

#### R4 `js-alias-generic-zero` (PR #335, `multi-package-fixes` Phase 3)
Root: `zeroValueForTypeNode` (`src/backend/js/expressions.js:3366-3373`) delegates `TypeName`/`Ident` (`IntPair`, `PP`) to `_zeroForNamedType(name)` (`:3337-3361`). While `zeroValueForType` (`:3457-3461`) calls `this._genericStructNew(t.name, t.typeArgs)` before `_zeroForNamedType`, `_zeroForNamedType` looks up `const named = this.checker?.types.get(name)` and directly returns `new Pair()` without passing `named.typeArgs` (so `Pair`'s `[__tz]` zero factories are missing and fields initialize to `null`, crashing nested `PP` on `q.A.A`).

| ID | Program / Probe | Expected | Observed on `main` (`js` / `both` / `wasm`) |
|---|---|---|---|
| R4.1 | `type Pair[T any] struct{ A, B T }; type IntPair = Pair[int]; type PP = Pair[Pair[int]]; var p IntPair; var q PP; fmt.Println(p.A == 0, p.B, q.A.A)` | `true 0 0` | `js`/`both`: `Cannot read properties of null (reading 'A')` (`p.B` is `null`); `wasm`: `true 0 0` |
| control | `new(IntPair)`, struct field `Wrap{ P IntPair }`, `make([]IntPair, 1)` | `0 0 0` | Passes (must stay) |

### Phase 4 Roots (JS Variable Boxing & Block-Shadowing TDZ)

#### B1 `js-addr-taken-named-return-and-range` (PR #345, `generics-and-aliases` Phase 3)
Root: Two places in JS codegen emit scalar bindings without consulting `this._boxedVars`:
1. `_withNamedReturns` (`src/backend/js/index.js:1401-1424`) always emits `let ${varName} = ${zero};` (`:1413`) instead of `{ value: ${zero} }` when `this._boxedVars.has(varName)`, while the function body reads/writes `${varName}.value` (and naked returns / `_genBody` `finally` at `:1460` / `genReturn` must unwrap/assign `.value`).
2. `_genIterFor` (`src/backend/js/statements.js:1848-1900`, via `_rangeAssignTemps` at `:1828-1846`, which returns early on `init.kind !== "AssignStmt"`) destructures short-declared `for k, v := range m` variables directly unboxed instead of binding temporaries and declaring `let v = { value: __r1$ };`; `_genRangeOverFunc` similarly leaves short-declared iterator callback parameters unboxed when `&v` is taken.

| ID | Program / Probe | Expected | Observed on `main` (`js` / `both` / `wasm`) |
|---|---|---|---|
| B1.1 | `func g() (v int) { p := &v; v = 42; fmt.Print(*p, " "); return }; fmt.Println(g())` | `42 42` | `js`/`both`: `Cannot create property 'value' on number '0'`; `wasm`: `42 42` |
| B1.2 *sibling* | `type Num int; func (n *Num) Inc() { *n++ }; func g() (n Num) { n.Inc(); return }; fmt.Println(g())` | `1` | `js`/`both`: `Cannot create property 'value' on number '0'`; `wasm`: `1` |
| B1.3 *sibling* | `func g() (v int) { p := &v; defer func() { *p += 10 }(); return 5 }; fmt.Println(g())` | `15` | `js`/`both`: `Cannot create property 'value' on number '0'`; `wasm`: `15` |
| B1.4 | `var out []*int; for _, v := range map[string]int{"a": 10} { out = append(out, &v) }; fmt.Println(*out[0])` | `10` | `js`/`both`: `-922372036854775808`; `wasm`: `10` |
| B1.5 *sibling* | `var out []*string; for k := range map[string]int{"a": 10} { out = append(out, &k) }; fmt.Println(*out[0])` | `a` | `js`/`both`: `<nil>`; `wasm`: `a` |
| B1.6 | `func seq(yield func(int) bool) { yield(7); yield(8) }; var out []*int; for v := range seq { out = append(out, &v) }; fmt.Println(*out[0], *out[1])` | `7 8` | `js`/`both`: `-922372036854775808 -922372036854775808`; `wasm`: `7 8` |
| control | Slice `for _, v := range []int{10, 20}`, int `for i := range 2`, string `for _, r := range "ab"` with `&v`/`&i`/`&r` | `10 20`, `0 1`, `97 98` | Passes on all targets (must stay) |

#### B2 `js-block-shadow-var-const-tdz` (PR #338 & PR #341, `js-codegen-and-value-semantics` Phases 1 & 4)
Root: `genBlock` (`src/backend/js/statements.js:162-183`) calls `_definesShadowedRead(stmt)` (`:197-210`) and `_definesAfterOuterUse(stmt, earlier)` (`:188-193`) to split a block before a shadowing declaration that would otherwise put earlier reads or its own initializer into JS's `let`/`const` temporal dead zone. Both helpers return `false` for anything other than `stmt.kind === "DefineStmt"`, ignoring `VarDecl` (`var y = y + 1`, `var a, y = 1, y + 2`, `var i = 10`) and `ConstDecl` (`const y = 99`). Similarly, `_bodyRedeclares` (used by `_genIntRangeBody` at `:1756` and slice/string range loops) misses `VarDecl`/`ConstDecl` redeclarations of the loop variable.

| ID | Program / Probe | Expected | Observed on `main` (`js` / `both` / `wasm`) |
|---|---|---|---|
| B2.1 | `y := 10; { var y = y + 1; fmt.Println(y) }; fmt.Println(y)` | `11\n10` on `js`/`both` *(note: `wasm` prints `1\n10`, separate WASM local-alloc bug)* | `js`/`both`: `ReferenceError: Cannot access 'y' before initialization` |
| B2.2 *sibling* | `y := 10; { fmt.Print(y, " "); const y = 99; fmt.Print(y, " ") }; fmt.Println(y)` | `10 99 10` | `js`/`both`: `ReferenceError: Cannot access 'y' before initialization`; `wasm`: `10 99 10` |
| B2.3 *sibling* | `y := 10; switch 1 { case 1: fmt.Print(y, " "); const y = 99; fmt.Print(y, " ") }; fmt.Println(y)` | `10 99 10` | `js`/`both`: `ReferenceError: Cannot access 'y' before initialization`; `wasm`: `10 99 10` |
| B2.4 | `sum := 0; for i := range 3 { _ = i; var i = 10; sum += i }; fmt.Println(sum)` | `30` | `js`/`both`: `ReferenceError: Cannot access 'i' before initialization`; `wasm`: `30` |
| B2.5 *sibling* | `sum := 0; for _, v := range []int{1, 2} { _ = v; var v = 10; sum += v }; fmt.Println(sum)` | `20` | `js`/`both`: `ReferenceError: Cannot access 'v' before initialization`; `wasm`: `20` |
| B2.6 *sibling* | `y := 10; { var a, y = 1, y + 2; fmt.Println(a, y) }; fmt.Println(y)` | `1 12\n10` on `js`/`both` | `js`/`both`: `ReferenceError: Cannot access 'y' before initialization` |
| control | `y := 10; { y := y + 1; fmt.Println(y) }` (`:=` shadowing) | `11` | Passes (must stay) |

---

## Approach

### 1. Architecture & Design Decisions

1. **Phase 1 — Checker Soundness (`src/typechecker/{resolve,index,expressions}.js`):**
   - **P1 (`generic-struct-constraint-skipped`):** Add a shared helper `_checkGenericTypeArgs(generic, typeArgs, node)` in `src/typechecker/resolve.js` called from both `_instantiateGenericAlias` and `instantiateGenericType` (passing `node` from `_resolveGenericTypeNode` at `:786`). Check type-argument count first; for each `tp` with `tp.constraint`, defer via `this._pendingConstraintUses` when `this._collectingTypes` is true (so interface methods are collected before `implements()` runs), otherwise resolve `tp.constraint` inside `this._inDeclContext(generic.declNode, ...)` and call `this.checkConstraint(typeArgs[i], constraint, node, { typeParams, typeArgs, name: generic.declNode.name, scope: this.globals })`. Skip constraint checks when `typeArgs[i]` is the declaration's own `typeParam` (during self-referential struct collection like `Next *List[T]`) or `_tainted`.
   - **P2 (`local-generic-type-accepted`):** At the top of `collectType(decl, scope = null)` (`src/typechecker/index.js:1348`), when `decl.typeParams?.length > 0 && scope && scope !== this.globals`, emit `this.err("type cannot have type parameters", decl)` (matching Go's `"function-local type cannot have type parameters"` / `"type cannot have type parameters"`) and return early without registering a broken generic template.
   - **P3 (`dot-import-type-identity`):**
     - In `_bindImportedType(file, key, type, visible = true)` (`src/typechecker/index.js:281-288`), check `const prior = this.types.get(key)`. If `prior && prior !== type && prior.kind === "named"`, record both `prior` and `type` in `this._ambiguousImported ??= new WeakSet()`. Only write `this.types.set(key, type)` when `type.name === key` or `!prior` (never let a collision-renamed `Box$$b` overwrite another package's bare `"Box"` in the global `this.types` table; `this._fileScope(file).importedTypes.set(key, type)` still binds `"Box" -> bBox` for the dot-importing file!).
     - In `resolveType(t)` (`src/typechecker/resolve.js:1639-1645`), also guard `found.name === t.name` before replacing `t` with `this.types.get(t.name)` so a differently-named type can never substitute for `t`.
   - **P4 (`array-lit-nonint-const-key`):** In `_checkArrayLitKeys` (`src/typechecker/expressions.js:2321-2333`), inspect the checked key type `const kt = this.checkExpr(elem.key, scope)`. Only treat an unevaluated constant (`idx === null && this._isConstExpr(elem.key, scope)`) as an unknown integer constant when `kt` is actually an integer type or untyped int/rune (e.g., `this._isIntOrUntypedInt(kt)` — not `string`, `float`, `bool`, `complex`, etc.); otherwise fall through to `this.err(\`index ${text} must be integer constant\`, elem.key)`.

2. **Phase 2 — WASM Zero-Initialized Slice Elements (`src/backend/wasm/{emit,emit-builtins,globals}.js`):**
   - **W1 (`wasm-array-slice-elem-zero`):**
     - Add one shared helper or branch in `_emitNewArray(elemType, arrInfo, emitLen)` (`src/backend/wasm/emit.js:1742-1757`): when `elemType?.kind !== "pointer" && isSliceType(elemType, this.mod.checker)`, emit `global.get sliceInfo.emptyGlobalIndex`, `emitLen()`, and `array.new` (`arrInfo.typeIndex`) — O(1) instructions for any array size, initializing every slot to the shared immutable empty-slice struct!
     - Because `emitZeroValue` (`emit.js:1695`) already delegates non-struct/non-complex/non-array element arrays to `_emitNewArray`, fixing `_emitNewArray` immediately fixes local `var a [N][]T`, `var a [N][M][]T` (nested arrays call `emitZeroValue` per slot), and `var a [N]NamedSlice`.
     - In `emitMakeSlice` (`src/backend/wasm/emit-builtins.js:314-370`), when the element is a slice (`elemGoType?.kind !== "pointer" && isSliceType(elemGoType, this.mod.checker)`), use `this._emitNewArray(elemGoType, arrInfo, () => this.pushInstruction({ op: "local.get", index: capTmp }))` (just like `make([]string, n)` does) instead of bare `array.new_default`.
     - In `_zeroArrayConst(goType, mod, depth)` (`src/backend/wasm/globals.js:160-194`), add an `else if (elem?.kind !== "pointer" && elem?.kind !== "StarExpr" && isSliceType(elem, checker))` branch that sets `one = [{ op: "global.get", index: mod.getSliceType(this_elem).emptyGlobalIndex }]` (using `array.new` when `size > 64` or `array.new_fixed` for `size <= 64`; note `array.new` is a valid WasmGC constant expression too, or for `size > 64` fall back to `null` so the start function runs `emitZeroValue`).

3. **Phase 3 — JS Runtime Conversions, Cross-Package Scalar Pointers & Zero Values (`src/backend/js/{expressions,runtime}.js`, `src/typechecker/expressions.js`, `docs/hybrid-wasm.md`):**
   - **R1 (`js-slice-to-array-conv`):**
     - Add a compact runtime helper `__s2a(s, n, ptr, clone)` in `src/backend/js/runtime.js` (registered in `src/backend/js/index.js`):
       - If `s == null`: if `n > 0` throw `new Error(\`runtime error: cannot convert slice with length 0 to array or pointer to array with length ${n}\`)`; return `ptr ? null : (typed ? new Ctor(0) : [])`.
       - If `s.length < n`: throw `new Error(\`runtime error: cannot convert slice with length ${s.length} to array or pointer to array with length ${n}\`)`.
       - If `ptr`: return `{ value: s.subarray ? s.subarray(0, n) : s }` (sharing the backing slice; for plain arrays `s` directly when `s.length === n` or an index-proxied/shared view — wait: for plain JS `Array` of structs/ints when `len(s) >= n`, `(*[N]T)(s)` points at `s`'s backing elements `0..n-1`; `{ value: s }` shares `s` directly for `p[i] = v` and `(*p)[i]`, and `len(*p)` is always compile-time constant `N`!). Verify whether `(*[N]T)(s)` needs a `Proxy` or `{ value: s }` (`s.subarray(0, n)` for TypedArrays, and for plain arrays `{ value: s }` if `s.length === n`, or a lightweight view / `s` — check `fmt.Println(*p)` so printing `*p` only prints `n` elements!).
       - If `!ptr` (value `[N]T(s)`): slice `0..n` (`s.slice(0, n)`), and if `clone` is passed (for struct/array element types), map `clone` over each element (`arr.map(clone)`).
     - Wire `_genArrayTypeConversion` (`src/backend/js/expressions.js:3922-3933`) to call `__s2a` (passing element `_cloneJs` when `_aggregateBase(elem)` is true, and typed-array ctor when `elem` is a typed-array scalar).
     - Wire `_resolvedConversionTargetNode` (`:2217-2241`) and `_genTypeConversion` (`:3876-3920`) for `PointerType` whose base is an `ArrayType` (`(*[N]T)(s)`) to call `__s2a(s, size, true)` (on `js` packages; `wasm`/`both` already reject it at check time).
   - **R2 (`cross-pkg-scalar-addr`):**
     - In `_isScalarInteriorOperand` (`src/typechecker/expressions.js:589-607`), when `node.kind === "SelectorExpr" && node.expr?._type?.kind === "namespace"`, return `false` only if the member is NOT a variable (i.e. check `ns._kinds?.get(node.field)` — return `false` for `"func"`, `"const"`, `"type"`, or non-GoFront `.d.ts` namespaces, and fall through to `this._isScalarStorageType(type)` for GoFront package `var`s!). This rejects `&a.X` on `wasm`/`both` with the exact same scalar-interior error as dot-imported `&X`.
     - In `src/backend/js/expressions.js` `_genUnaryExpr("&")` (`:1328-1365`):
       - Before the struct-field `SelectorExpr` branch (`:1358`), if `expr.operand.kind === "SelectorExpr"` and the base is a bundled GoFront package (`this.bundledPackages.has(this.genExpr(expr.operand.expr))` or `expr.operand._stdName`), resolve the flat JS binding name `const ref = expr.operand._stdName ?? jsBindingName(expr.operand.field)` and emit a live getter/setter accessor with bundle-unique `__target`/`__index`:
         `Object.defineProperties({ get value() { return ${ref}; }, set value(v) { ${ref} = v; } }, { __target: { value: globalThis }, __index: { value: ${JSON.stringify(`__gf_var:${ref}`)} } })`.
       - In the `Ident` branch (`:1328-1335`), when `!this._boxedVars.has(expr.operand.name)` and the ident refers to an imported (dot-imported) package scalar variable (e.g. `expr.operand._stdName` or `this.checker?._importedGlobalVar` / `!isLocal`), emit the same live getter/setter accessor around `this.genExpr(expr.operand)` instead of a detached `{ value: x }` copy!
     - Update `docs/hybrid-wasm.md` § Pointers in `wasm` and `both` packages to note that taking the address of another package's scalar variable (`&pkg.X`) follows the same scalar-interior rule on `wasm`/`both`.
   - **R3 (`js-named-slice-keyed-lit`):**
     - In `_genFallbackCompositeLit` (`src/backend/js/expressions.js:2813-2833`), replace `this._litArrayType(expr)` with `this._litIndexedShape(expr)` (which already handles both named arrays AND named slices, computing `size = max(indices) + 1` and `elem`!). When `shape` is non-null, emit `_genArrayLitElems(shape, expr)` wrapped in `new ${ctor}([...])` when `typedArrayConstructorForElem(shape.elem)` is non-null, else `[...]`.
   - **R4 (`js-alias-generic-zero`):**
     - In `_zeroForNamedType(name)` (`src/backend/js/expressions.js:3337-3361`), right after looking up `const named = this.checker?.types.get(name)`, if `named?.kind === "named" && named.typeArgs?.length`, delegate to `const gen = this._genericStructNew(named.name, named.typeArgs); if (gen) return gen;` — matching `zeroValueForType` (`:3458-3460`)!

4. **Phase 4 — JS Variable Boxing & Block-Shadowing TDZ (`src/backend/js/{index,statements}.js`):**
   - **B1 (`js-addr-taken-named-return-and-range`):**
     - In `_withNamedReturns` (`src/backend/js/index.js:1401-1424`), when `this._boxedVars.has(varName)`, initialize `let ${varName} = { value: ${zero} };` instead of unboxed `${zero}`. In `genReturn` (`src/backend/js/statements.js`) and `_genBody` `finally` (`src/backend/js/index.js:1460`), read/write `${varName}.value` whenever `this._boxedVars.has(varName)` so both naked `return` and explicit `return expr` with `defer` mutations through `*p` work identically to Go.
     - In `_genIterFor` (`src/backend/js/statements.js:1848-1900`), extend `_rangeAssignTemps` (or add a companion path for `DefineStmt`) so any short-declared map `k`/`v` in `this._boxedVars` binds a temporary (`__r0$` / `__r1$`) in `for (let [...] of ...)` and emits `let ${name} = { value: __r${i}$ };` inside the loop body (fresh box per iteration, matching Go 1.22+ loop-var semantics). In `_genRangeOverFunc`, wrap any boxed yield parameter (`v` in `this._boxedVars`) by binding `__rv${i}` in the callback signature and declaring `let ${v} = { value: __rv${i} };` at the top of the callback body.
   - **B2 (`js-block-shadow-var-const-tdz`):**
     - Extract one small helper `_declaredNames(stmt)` in `src/backend/js/statements.js` returning the newly declared variable/constant names of `DefineStmt` (`!l._redecl`), `VarDecl` (every `spec.names`), and `ConstDecl` (every `spec.names`).
     - Update `_definesAfterOuterUse(stmt, earlier)` (`:188-193`) and `_bodyRedeclares(body, names)` to use `_declaredNames(stmt)`, so `genBlock`, `switch`/`type-switch` clauses, and all `for range` loops open a nested `{ ... }` before a shadowing `var` or `const` that follows an outer read.
     - Update `_definesShadowedRead(stmt)` (`:197-210`) to also check `VarDecl` specs whose `spec.value` reads any name declared in that `VarDecl` (and update `_genShadowingDefine` to evaluate `VarDecl` initializers into temps in the outer scope before opening the nested `{ let ... }` block, preserving boxing if any name is in `this._boxedVars`).

### 2. Invariants & Safety Bounds
- **Generic self-reference preserved:** Recursive generic definitions (`type Node[T comparable] struct{ Next *Node[T] }`) must not fail constraint checks during declaration collection when `typeArgs[i]` is the declaration's own `typeParam`.
- **Zero WASM overhead for non-slice arrays:** `_emitNewArray` continues to emit `array.new_default` for scalar/pointer/interface elements; slice elements use a single `global.get` + `array.new` (O(1) code size regardless of array length).
- **Pointer identity & `%p` stability on JS:** `&a.X == &a.X` is `true`, `&a.X == &b.X` is `false`, and `fmt.Sprintf("%p", &a.X)` is stable because `__target: globalThis` and `__index: "__gf_var:<uniqueBinding>"` plug directly into `__peq` / `__ifeq` / `__pid` (`src/backend/js/runtime.js:813,942,977`).
- **`(*[N]T)(s)` preserves backing-array sharing on JS:** Writing `p[0] = 7` or `(*p)[0] = 7` mutates the original slice `s`, while `[N]T(s)` never aliases `s` (even for struct or nested-array elements).

### 3. Edge Cases & Error Handling
- **Deferred generic constraint checks during `collectTypes`:** A package-level `var b Box[MyType]` or `type Wrapper struct{ B Box[MyType] }` declared before `func (MyType) Foo()` is collected must validate `MyType` against `I` *after* `collectMethods` runs (using `_pendingConstraintUses`), so valid programs are never falsely rejected due to declaration order.
- **`(*[N]T)(s)` where `len(s) > N` on JS:** For TypedArrays (`Int32Array`, `Uint8Array`, etc.), `s.subarray(0, N)` returns a zero-copy view of length `N` that shares the exact backing buffer. For plain JS arrays (`[]int`, `[]S`), if `s.length > N`, reading `fmt.Println(*p)` or ranging over `*p` must see length `N` while mutations write through to `s` (a tiny `Proxy` or length-`N` view when `s.length > N`, and direct `s` when `s.length === N`).
- **Dot-imported scalar variable with collision rename (`X$$b`):** Both `a.X` and dot-imported `X` use `expr._stdName ?? jsBindingName(name)`, so collision-renamed package variables (`X$$b`) bind to the exact renamed `let X$$b` in the JS bundle.
- **Large global arrays of slices on WASM (`var a [100][]int`):** `_zeroArrayConst` can emit `[global.get emptyGlobalIndex, i32.const size, array.new arrTI]` (valid WasmGC constant expression for any `size`, no 64-element cap needed!), or fall back to start-function init if `elem` is a nested array (`var a [100][2][]int`).

---

## Implementation Tasks

### Phase 1: Breaking-if-Deferred Checker Soundness (roots `generic-struct-constraint-skipped`, `local-generic-type-accepted`, `dot-import-type-identity`, `array-lit-nonint-const-key`)
*Scheduled from review follow-ups (2026-11-26).*
- [ ] Task 1.1: Enforce type-parameter arity and constraints on generic type instantiations (P1.1–P1.2)
  - Files: `src/typechecker/resolve.js` (`_resolveGenericTypeNode`, `instantiateGenericType`, `_instantiateGenericAlias`, `_checkGenericTypeArgs`), `src/typechecker/index.js` (`_flushConstraintUses` if needed for deferred generic type-arg checks)
  - Test: `test/unit/types/generics.test.js`: `assertErrorContains(errors, "does not satisfy constraint")` for `Box[int]{V: 1}`, `var b Box[int]`, `List[[]int]` (`comparable`), and foreign `util.I` with unexported method; positive controls: `Box[Good]{}` declared before `func (Good) Foo()`, recursive `type Node[T comparable] struct{ Next *Node[T] }`, and generic alias `Good[int]`
  - Done when: every generic type instantiation (struct, slice, map, alias, composite literal, `var`, parameter) enforces arity and constraints in the same shared helper without breaking forward-declared methods or recursive generic types
- [ ] Task 1.2: Reject generic type declarations inside functions and blocks (P2.1–P2.3)
  - Files: `src/typechecker/index.js` (`collectType`)
  - Test: `test/unit/types/generics.test.js`: `assertErrorContains` on `js` and `wasm` for function-local `type L[T any] struct{ k T }`, `type L[T any] []T`, and `type L[T any] = []T` (no WASM invalid-module ICE); controls: package-level generic type and non-generic local type still pass
  - Done when: any `TypeDecl` with `typeParams` inside a non-global scope reports a clear compile error on all targets
- [ ] Task 1.3: Preserve distinct package type identity under dot-imports (P3.1–P3.2)
  - Files: `src/typechecker/index.js` (`_bindImportedType`), `src/typechecker/resolve.js` (`resolveType`)
  - Test: `test/unit/compiler/packages.test.js`: P3.1 (`var y Box = a.One()`) and P3.2 (`Take(a.One())`) with `import "./a"` + `import . "./b"` report `cannot use` on `js`, `both`, and `wasm` (no WASM ICE); non-dot control and existing dot-import colliding-type tests stay green
  - Done when: a dot-imported collision-renamed type never overwrites another package's bare type table entry or aliases it in `resolveType`
- [ ] Task 1.4: Reject non-integer constant keys in array and slice literals (P4.1–P4.2)
  - Files: `src/typechecker/expressions.js` (`_checkArrayLitKeys`)
  - Test: `test/unit/types/checks.test.js`: `assertErrorContains(errors, "must be integer constant")` for `[2]int{"x": 1}`, `[]int{"x": 1}`, `[2]int{1.5: 1}`, and `[2]int{true: 1}`; controls: `[4]int{len(arr): 1}`, `[3]int{'a' - 'a': 1}`, and non-constant `n` error still pass
  - Done when: `_checkArrayLitKeys` only exempts unevaluated constants whose checked type is an integer or untyped integer/rune

### Phase 2: WebAssembly Zero-Initialized Slice Elements (root `wasm-array-slice-elem-zero`)
- [ ] Task 2.1: Initialize slice-typed array and `make` slice elements to the empty-slice global in WASM (W1.1–W1.2, W1.4–W1.5)
  - Files: `src/backend/wasm/emit.js` (`_emitNewArray`), `src/backend/wasm/emit-builtins.js` (`emitMakeSlice`)
  - Test: `test/unit/language/slices.test.js`: W1.1 (`var a [1][]int; len(a[0])`, `[0]int(a[0])`), W1.2 (`make([][]int, 1)` + `append`), W1.4 (`var a [2][2][]int`), W1.5 (`type Ints []int; make([]Ints, 1)` + `append`) with `assertAllTargetsOutput`
  - Done when: `_emitNewArray` fills slice-typed element arrays via `global.get emptyGlobalIndex` + `array.new` and `emitMakeSlice` routes slice elements through it, eliminating null-pointer dereferences across all local/nested/named cases
- [ ] Task 2.2: Initialize package-level global arrays of slices in WASM (W1.3)
  - Files: `src/backend/wasm/globals.js` (`_zeroArrayConst`)
  - Test: `test/unit/language/slices.test.js`: W1.3 (`var a [2][]int` and `var big [70][]int` and `var nested [2][2][]int` at package level) with `assertAllTargetsOutput`, plus existing string/struct global array controls
  - Done when: package-level arrays (including large and nested arrays) whose elements are slices initialize every slot to the empty-slice global and validate/run on `wasm`

### Phase 3: JS Runtime Conversions, Cross-Package Scalar Pointers & Zero Values (roots `js-slice-to-array-conv`, `cross-pkg-scalar-addr`, `js-named-slice-keyed-lit`, `js-alias-generic-zero`)
- [ ] Task 3.1: Fix JS `[N]T(s)`, named `A2(s)`, and `(*[N]T)(s)` slice-to-array conversions (R1.1–R1.5)
  - Files: `src/backend/js/runtime.js` (`HELPER_S2A` / `__s2a`), `src/backend/js/index.js` (register helper), `src/backend/js/expressions.js` (`_genArrayTypeConversion`, `_resolvedConversionTargetNode`, `_genTypeConversion`)
  - Test: `test/unit/language/arrays.test.js`: R1.1 (`[2]S(s)`, `[2][2]int(s)` deep copy), R1.2 (`[2]int([]int{1})`, named `A2([]int{1})` panic message), R1.3 (`[0]int(nilSlice)`) with `assertAllTargetsOutput`; R1.4–R1.5 (`(*[2]int)(s)`, `(*[2]int32)(s)`, `(*[2]int)(s3)` where `len(s3) == 3`, `(*[0]int)(nilSlice) == nil`, `(*[2]int)([]int{1})` panic) on `js`
  - Done when: JS slice-to-array value conversions check length, handle nil, and deep-copy aggregate elements matching Go/WASM, and `(*[N]T)(s)` aliases the slice backing array on `js` with length/nil checks
- [ ] Task 3.2: Fix cross-package scalar address-of (`&a.X`, dot-imported `&X`, `lib.GlobalNum.Inc()`, `GlobalNum.Inc()`) on JS and reject on WASM/both (R2.1–R2.4)
  - Files: `src/typechecker/expressions.js` (`_isScalarInteriorOperand`), `src/backend/js/expressions.js` (`_genUnaryExpr`), `docs/hybrid-wasm.md`
  - Test: `test/unit/compiler/packages.test.js`: R2.1 (`p := &a.X; *p = 7; a.X++` plus `&a.X == &a.X`, `&a.X == &b.X`, collision-renamed `b.X`), R2.2 (`import . "./a"; p := &X; *p = 7; X++`), R2.3 (`lib.GlobalNum.Inc()`), and R2.4 (dot-imported `GlobalNum.Inc()`) pass on `js`, and report the scalar-interior compile error on `both` and `wasm`; `&a.St.V` and `&a.Arr[1]` controls stay green
  - Done when: `&a.X`, dot-imported `&X`, and pointer-receiver method calls on imported scalar package vars mutate live package variables with stable pointer equality on `js`, report the scalar-interior compile error on `both`/`wasm`, and `docs/hybrid-wasm.md` notes imported package scalar variables
- [ ] Task 3.3: Emit named-slice keyed literals as arrays/TypedArrays in JS (R3.1–R3.2)
  - Files: `src/backend/js/expressions.js` (`_genFallbackCompositeLit`)
  - Test: `test/unit/language/slices.test.js`: R3.1 (`type Vec []string; Vec{2: "ok"}`) and R3.2 (`type Bytes []byte; Bytes{2: 65}`, out-of-order `type Ints []int; Ints{3: 9, 1: 4}`) with `assertAllTargetsOutput`
  - Done when: `_genFallbackCompositeLit` uses `_litIndexedShape(expr)` for named slices as well as named arrays and matches Go/WASM on `js` and `both`
- [ ] Task 3.4: Construct zero values for aliases of instantiated generic structs in JS (R4.1)
  - Files: `src/backend/js/expressions.js` (`_zeroForNamedType`)
  - Test: `test/unit/types/generics.test.js`: R4.1 (`type IntPair = Pair[int]`, `type PP = Pair[Pair[int]]`, `var p IntPair`, `var q PP`) plus existing `new(IntPair)` / struct field / `make([]IntPair, 1)` controls with `assertAllTargetsOutput`
  - Done when: `_zeroForNamedType` delegates instantiated generic types (`named.typeArgs?.length > 0`) to `_genericStructNew` and all R4 cases match Go on `js`, `both`, and `wasm`

### Phase 4: JS Variable Boxing & Block-Shadowing TDZ (roots `js-addr-taken-named-return-and-range`, `js-block-shadow-var-const-tdz`)
*Scheduled from review follow-ups (2026-11-27).*
- [ ] Task 4.1: Box address-taken scalar named return variables in JS (B1.1–B1.3)
  - Files: `src/backend/js/index.js` (`_withNamedReturns`, `_genBody`), `src/backend/js/statements.js` (`genReturn`)
  - Test: `test/unit/language/pointers.test.js`: B1.1 (`func g() (v int) { p := &v; v = 42; ... return }`), B1.2 (`func g() (n Num) { n.Inc(); return }`), and B1.3 (`defer func() { *p += 10 }(); return 5`) with `assertAllTargetsOutput`
  - Done when: address-taken scalar named return variables are initialized as `{ value: zero }`, read/written via `.value` on naked and explicit returns (including `defer`), and match Go on `js`, `both`, and `wasm`
- [ ] Task 4.2: Box address-taken short-declared map and iterator `range` variables in JS (B1.4–B1.6)
  - Files: `src/backend/js/statements.js` (`_genIterFor`, `_genRangeOverFunc`)
  - Test: `test/unit/language/range-iter.test.js`: B1.4 (`for _, v := range map` with `&v`), B1.5 (`for k := range map` with `&k`), B1.6 (`for v := range seq` with `&v`, verifying distinct per-iteration pointers), plus slice/int/string controls (B1.7–B1.9) with `assertAllTargetsOutput`
  - Done when: every short-declared map key/value and range-over-func iteration variable in `_boxedVars` gets a fresh `{ value: ... }` box per iteration and matches Go on all targets
- [ ] Task 4.3: Handle `var` and `const` shadowing without TDZ in JS `genBlock` and range bodies (B2.1–B2.6)
  - Files: `src/backend/js/statements.js` (`_declaredNames`, `_definesAfterOuterUse`, `_definesShadowedRead`, `_genShadowingDefine`, `_bodyRedeclares`)
  - Test: `test/unit/language/declarations.test.js`: B2.1 (`{ var y = y + 1 }`) and B2.6 (`{ var a, y = 1, y + 2 }`) on `js`/`both`, and B2.2 (`{ fmt.Print(y); const y = 99 }`), B2.3 (`switch` clause `const y = 99`), B2.4 (`for i := range 3 { _ = i; var i = 10 }`), and B2.5 (`for _, v := range []int{1, 2} { _ = v; var v = 10 }`) with `assertAllTargetsOutput`
  - Done when: `VarDecl` and `ConstDecl` shadowing outer variables or loop variables in blocks, switch clauses, and range bodies never throw `ReferenceError: Cannot access ... before initialization` on `js`/`both`
