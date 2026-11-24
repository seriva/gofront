# Generics & Alias Semantics Fixes — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-24 (`/bs-plan`): generic and type-alias follow-ups from `checker-go-rules` (L13, L15, L19, L21, L22), `checker-operand-rules` (L42, L43), `codegen-fixes` (L82), and `js-dead-code-elimination` (L42 DCE sibling). Split from [`js-codegen-and-value-semantics-plan.md`](js-codegen-and-value-semantics-plan.md) for phase sizing; run sequentially with it because both touch `src/typechecker/expressions.js` and `src/backend/js/{expressions,statements,runtime}.js`.  
**Release note:** Methods declared on generic non-struct types (`type List[T any] []T`) and on type aliases of local structs (`type A = P`) now work on JavaScript and WebAssembly, method expressions on interfaces and type parameters (`N.M(x)`, `T.M(t)`) compile, and erased JavaScript generics now handle `clear`/`len`/`cap`/`copy`/`append`, `string(t)`/`T(x)` conversions, `switch` on struct/array tags, and returning `&v` of a struct parameter just like Go.

---

## Goal

Close the erased-JS-generics, generic-instantiation, and type-alias method bugs where valid Go either fails to compile, crashes at runtime, or silently returns wrong values on JavaScript (and for alias receivers, ICEs on WebAssembly or gets pruned by DCE).

**Done means:**
- Every failing row in *Verified Gaps* (G1–G7) compiles and produces Go's output across `js`, `both`, and `wasm` (`assertAllTargetsOutput` / `assertOutput`) in `test/unit/language/generics*.test.js`, `test/unit/types/methods.test.js`, and `test/unit/compiler/dce.test.js`.
- Zero `TypeError` / garbage `-922372036854775808` outputs on JS erased generics (`clear(M ~map)`, `len`/`cap` on `~*[N]T`, `copy`/`append` on `~string | ~[]byte`, `string(t)`, `T(1.5)`/`T(65)`, `switch x { case y: }`, `func makePtr[T any](v T) *T { return &v }`).
- `npm test`, `npm run check`, and `npm run test:e2e` pass.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `generic-nonstruct-method-drop`: instantiate and sync methods (preserving `_ptrRecv` and JS type-info) on generic non-struct types | `type W[T any] []T; func (w W[T]) Len() int`, generic map/array/basic types, pointer receivers | |
| **In scope: core** | Root `method-expr-iface-typeparam`: resolve method expressions on interfaces and type parameters in the checker and emit receiver-passing JS (with type-param boxing) | `N.M(n)`, `fn := N.M`, `T.M(t)` | |
| **In scope: core** | Root `alias-receiver-uncanonicalized`: canonicalize value-alias and pointer-alias receivers to the target struct name across checker, DCE reachability, JS, and WASM | `type A = P; func (a A) Get()`, `func (a *A) Set()`, `var p P; use(p)` under DCE | |
| **In scope: core** | Roots `js-typeparam-builtin-dispatch`, `js-typeparam-string-complex-conv`, `checker-untyped-to-complex-typeparam`: runtime-dispatched JS builtins (`clear`, `len`, `cap`, `copy`, `append`) and conversions (`string(t)`, `T(x)`) for union-constrained type parameters, plus checker support for `append([]byte{}, T...)` and untyped real → `~complex` | `clear(M ~map)`, `clear(S ~[]T)`, `len(T ~[]int \| ~*[3]int)`, `cap(...)`, `copy`/`append` (`~string \| ~[]byte`), `string(t)`, `T(1.5)`, `T(65)` | |
| **In scope: target-specific** | Roots `js-switch-typeparam-equality` & `js-typeparam-address-of-box` (`js`/`both` only): compare type-parameter `switch` tags via `__geq` and keep address-taken type-parameter params/locals unboxed when `$z_T` is a struct | `switch x { case y: }` on `T comparable`, `func makePtr[T any](v T) *T { return &v }` | WASM monomorphises concrete types and already passes both |
| **Excluded: deferred** | `(*p).Inc()` on `PT interface{ *T; Inc() }` (L107) | `func bump[T any, PT Incer[T]](p PT) { (*p).Inc() }` | Matches Go spec (*Method sets*: `*T` for a type parameter `T` has an empty method set; callers write `p.Inc()` or `PT(&(*p)).Inc()`, both already working). Kept in `plans/follow-ups.md` pending `go build` confirmation to drop |

---

## Verified Gaps & Baseline Audit

**Method.** Read-only code inspection and `node --input-type=module -e` probes across `js`, `both`, and `wasm` on `main` (`dda372c4`, 2026-11-24).

### G1 `generic-nonstruct-method-drop` (L13)
Root: `instantiateGenericWithArgs` (`src/typechecker/resolve.js:1084-1093`) only creates `instantiated.methods = new Map()` when `instantiated.kind === "struct"`, leaving `named.methods === undefined` for slices/maps/arrays/basics/funcs; `_syncInstanceMethods` (`:1098-1118`) returns early when `!methods`, and `substituteType` (`:1111`) drops `_ptrRecv`. On JS, `_namedBoxInfo` (`src/backend/js/index.js:912-928`, line 924) requires own `_ptrRecv` on methods and `genMethod` (`:1242-1244`) sets `tpNames = null` for `staticNamed`, losing `$z_T` inside generic non-struct methods.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G1.1 (L13 repro) | `type W[T any] []T; func (w W[T]) Len() int { return len(w) }; W[int]{1, 2, 3}.Len()` | `3` | `W[int] has no field or method 'Len'` on `js`/`both`/`wasm` |
| G1.2 *sibling* | generic map/array/basic receivers (`type M[K comparable, V any] map[K]V`), pointer receiver `func (w *W[T]) Push(v T)`, method using `var z T` on JS | Go output on all targets | same missing-method error (and missing `$z_T` in JS method body) |

### G2 `method-expr-iface-typeparam` (L22)
Root: `_resolveMethodExprType` (`src/typechecker/expressions.js:846-857`) returns `null` for `interface` and `typeParam`, so `_checkSelectorExpr` (`:1090-1102`) falls through to `fieldType` without prepending the receiver to `params` → `Too many arguments: expected 0, got 1`. On JS, `src/backend/js/type-info.js:83` skips `_isMethodExpr` in `_isTypeParamMethodCall`, so `T.M` also needs type-info boxing when `T` is a named non-struct type.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G2.1 (L22 repro) | `type N interface{ M() int }; func f[T N](t T) int { return T.M(t) }` | `9` | `Too many arguments: expected 0, got 1` on `js`/`both`/`wasm` |
| G2.2 *sibling* | `N.M(n)`; `fn := N.M; fn(n)`; `T.M` instantiated with named non-struct `type MyInt int` implementing `N` | `9` | `Too many arguments: expected 0, got 1` |

### G3 `alias-receiver-uncanonicalized` (L42)
Root: `_unwrapPointerAliasReceiver` (`src/typechecker/index.js:1533-1543`) only rewrites pointer-alias receivers (`type C = *P`), leaving value-alias receivers (`type A = P`, `func (a A) Get()` and `func (a *A) Set()`) keyed under `"A"`. JS `_collectMethodMap` (`src/backend/js/index.js:644-648`) misses them when emitting class `P`, WASM (`src/backend/wasm/index.js:375-399`) ICEs with `Unknown field 'Get' on struct 'P'`, and DCE `_keepsMethod`/`_reachMethods` (`src/lower/reachability.js:637-648, 708`) tests uncanonicalized `"A"` against `this.escaped` / `u.byName` instead of `"P"`.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G3.1 (L42 repro) | `type P struct{ n int }; type A = P; func (a A) Get() int { return a.n }; var p P; p.Get()` | `0` | JS `p.Get is not a function`; WASM ICE `Unknown field 'Get' on struct 'P'` |
| G3.2 *sibling* | `func (a *A) Set(v int)` on `var p P` | sets `p.n` | JS `p.Set is not a function`; WASM ICE |
| G3.3 (L42 DCE) | `func use(x any){}; var p P; use(p)` (with `Get` declared on `A`) | `Get(` kept in JS output | `Get(` dropped by DCE |

### G4 `js-typeparam-builtin-dispatch` (L15)
Root: JS builtin emitters branch on static AST type instead of runtime value shape for `typeParam` operands:
- `_genBuiltinClear` (`src/backend/js/expressions.js:2562-2577`) emits `(m)?.fill(null)` for `M ~map[K]V` and fills slices with `null` instead of the element's zero value (missing `ez` in `src/backend/js/type-info.js:129-153`).
- `_genBuiltinLen` (`:2550-2560`), `BUILTIN_GEN.cap` (`:445-449`), and `__len`/`__cap` (`src/backend/js/runtime.js:5-8, 152-158`) misclassify boxed array pointers `{ value: [1,2,3] }` (`~*[3]int`) as maps (`Object.keys(a).length === 1`) or `undefined` (`-922372036854775808`).
- `_genSliceSource` (`src/backend/js/expressions.js:2588-2593`) checks `_isStringExprType` statically instead of `typeof v === "string" ? __u8enc(v) : v` for `T ~string | ~[]byte`.
- Checker `_checkAppendArgs` / `_isStringIntoBytes` (`src/typechecker/expressions.js:3156-3183`) fails to check each union term of `T ~string | ~[]byte` in `append([]byte{}, v...)`.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G4.1 (L15 repro) | `clear(m)` (`M ~map[string]int`); `clear(s)` (`S ~[]int`); `clear(x)` (`T ~map \| ~[]int`) | `0`, `[0 0]`, `0 [0 0]` | JS `m?.fill is not a function` / `[-922372036854775808 ...]`; WASM passes |
| G4.2 (L15 repro) | `len(v)` (`T ~[]int \| ~*[3]int`); `cap(v)` (`T ~[3]int \| ~*[3]int`) on `&a` | `3`, `3` | JS `1`, `-922372036854775808`; WASM passes |
| G4.3 (L15 repro) | `copy(dst, src)` (`T ~string \| ~[]byte`); `append([]byte{}, v...)` (`T ~string \| ~[]byte`) | `2:hi`, `"hi"` | JS `copy` gives `\u0000\u0000`; `append` rejected by checker on all targets |
| control | `len(v)` on `T ~string \| ~map[string]int \| ~[3]int` | `3 2 3` | passes on all targets (must stay) |

### G5 `js-typeparam-string-complex-conv`, `checker-untyped-to-complex-typeparam` (L19, L21)
Roots:
1. `_genStringConversion` (`src/backend/js/expressions.js:3938-3956`) checks `base` statically, so `string(t)` for a `typeParam` falls through to `String(inner)` (`"99,100"` for `[]byte`, `"111,107"` for `[]rune`, `"65"` for `int`).
2. `_termConvertible` / `_isRealNumberType` (`src/typechecker/expressions.js:2512-2529`) excludes complex types, causing untyped `1.5` in `T(1.5)` (`T ~complex128`) to default to `float64` and be rejected.
3. `__tconv` (`src/backend/js/runtime.js:745-760`) lacks cases for `"complex128"`, `"complex64"`, and `"string"` (returning `v` raw: `65` instead of `"A"`, `[104, 105]` instead of `"hi"`).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G5.1 (L19 repro & siblings) | `string(t)` on `T ~string \| ~[]byte`, `T ~string \| ~[]rune`, `T ~int \| ~int32` | `"cd"`, `"ok"`, `"A"` | JS `"99,100"`, `"111,107"`, `"65"`; WASM passes |
| G5.2 (L21 repro) | `func f[T ~complex128]() T { return T(1.5) }` | `(1.5+0i)` | checker error `cannot convert untyped float64 to type complex128 (in T)` |
| G5.3 (L21 repro & siblings) | `T(65)`, `T([]byte("hi"))`, `T([]rune("ok"))` with `T ~string` | `"A"`, `"hi"`, `"ok"` | JS `"65"`, `[104 105]`, `<nil>`; WASM passes |
| control | `T(complex128(3+4i))`, `T(1+2i)` (`T ~complex128`) | `(3+4i)`, `(1+2i)` | passes on all targets (must stay) |

### G6 `js-switch-typeparam-equality` (L43)
Root: `_switchTagAndCases` (`src/backend/js/statements.js:2413-2494`) has no branch for `stmt.tag._type?.kind === "typeParam"`, falling through to JS `switch (tag)` (`===` reference equality). `genSwitch` (`:2534-2539`) and `_nodeUsesTypeInfo` (`src/backend/js/type-info.js:89-127`) also need to recognize `typeParam` switch tags.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G6.1 (L43 repro & siblings) | `func f[T comparable](x, y T) bool { switch x { case y: return true }; return false }` on `P{1}`, `[2]int{1, 2}`, `complex128`, `any(P{1})` | `true` on all | JS `false` on all 4; WASM `true` on all 4 |
| control | `f(5, 5)`; `x == y` on `P{1}` | `true` | passes (must stay) |

### G7 `js-typeparam-address-of-box` (L82)
Root: `isReferenceType(typeParam)` (`src/lower/boxing.js:6-25`) is `false`, so address-taken `typeParam` params and locals are added to `_boxedVars` and unconditionally wrapped in `{ value: v }` (`src/backend/js/expressions.js:1284-1288`, `statements.js:284, 504, 530, 2273`, `index.js:1543, 1565`). `_genUnaryExpr("&")` (`expressions.js:1328-1335`) returns `{ value: Box{11} }`, whereas concrete `*Box` callers expect the struct instance directly (as `&s[i]` already handles via `_typeParamIsStructJs` at `:1352-1353`).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G7.1 (L82 repro & sibling) | `func makePtr[T any](v T) *T { return &v }; makePtr(Box{11}).N` and local `x := v; return &x` | `11`, `99` | JS `-922372036854775808`; WASM `11`, `99` |
| control | `makePtr(42)`, `makePtr([2]int{3, 4})` | `42`, `3` | passes on all targets (must stay) |

---

## Approach

### 1. Architecture & Design Decisions
- **G1 (`resolve.js`, `js/index.js`, `js/expressions.js`):** Create and sync `named.methods` in `instantiateGenericWithArgs` / `_syncInstanceMethods` for **all** generic named types (not just structs), preserving `_ptrRecv` across `substituteType`. In JS codegen (`_namedBoxInfo`, `genMethod`), keep `tpNames` active on generic non-struct methods and pass type-info arguments when calling them.
- **G2 (`typechecker/expressions.js`, `js/expressions.js`, `js/type-info.js`):** Extend `_resolveMethodExprType` to handle `interface` and `typeParam` receivers (prepending `baseType` to `params` and marking `_isMethodExpr`). On JS, emit nil-checked interface dispatch or `__tbox($z_T, recv)` for `typeParam` method expressions and include `_isMethodExpr` in `_isTypeParamMethodCall`.
- **G3 (`typechecker/index.js`, `lower/reachability.js`):** Generalize `_unwrapPointerAliasReceiver` into `_canonicalizeAliasReceiver` so both value-alias (`type A = P`) and pointer-alias (`type C = *P`, `func (a *A)`) receivers rewrite to the canonical target type name at declaration registration (automatically fixing JS class emission and WASM method lookup). In `src/lower/reachability.js`, resolve receiver names through the package's alias map in `_keepsMethod` and `_reachMethods`.
- **G4 (`typechecker/expressions.js`, `js/expressions.js`, `js/runtime.js`, `js/type-info.js`):** Add `__clear(v, ez)` in `runtime.js` (checking `v instanceof Map` / plain-object map vs array/TypedArray filling with fresh `ez()`), extend `__len`/`__cap` to unwrap `{ value: arr }` array-pointer boxes (`v && typeof v === "object" && "value" in v && (Array.isArray(v.value) || ArrayBuffer.isView(v.value))`), emit runtime `typeof v === "string" ? __u8enc(v) : v` in `_genSliceSource` for `typeParam`, and check union terms in `_checkAppendArgs` (`src/typechecker/expressions.js`).
- **G5 (`typechecker/expressions.js`, `js/expressions.js`, `js/runtime.js`):** Allow untyped real constants to convert to complex union terms in `_termConvertible`. Route `string(t)` on a `typeParam` through a runtime helper `__tstr(v)` (handling `string`, `Uint8Array`, `Int32Array`/rune arrays, and integer code points) and add `"string"`, `"complex128"`, and `"complex64"` cases to `__tconv`.
- **G6 (`js/statements.js`, `js/type-info.js`):** Add a `typeParam` tag branch in `_switchTagAndCases` using `__geq(tag, caseVal)` (matching `BinaryExpr` `==`), wrap labeled `typeParam` switches in `{ ... }` in `genSwitch`, and register helper/type-info usage.
- **G7 (`js/expressions.js`, `js/statements.js`, `js/index.js`):** For address-taken `typeParam` params and locals (`_boxedVars`), branch on `this._typeParamIsStructJs(tpName)`: when `true`, hold the struct directly (cloned on entry, read as `v`, assigned via `__copyInto(v, rhs)`, `&v` returns `v`); when `false`, keep `{ value: v }`.

### 2. Invariants & Safety Bounds
- Non-generic and concrete-typed JS output is unchanged (zero extra runtime checks when static type is not `typeParam`).
- `clear(s)` on a generic slice of structs (`S ~[]MyStruct`) creates a fresh zero struct per element via `ez()` rather than aliasing one shared zero object across all indices.
- Generic pointer-to-struct mutation through `p := makePtr(Box{11}); p.N = 22` and reassigning `v = Box{33}` inside `makePtr` after taking `p := &v` both preserve pointer identity (via `__copyInto`).

### 3. Edge Cases & Error Handling
- `clear(nil)` on a nil generic map or nil generic slice is a safe no-op.
- `T(1.5)` for `T ~complex64` rounds real part to `Math.fround(1.5)` (`{ re: Math.fround(v), im: 0 }`); `T(65)` for `T ~string` converts integer code point via `String.fromCodePoint` (replacing invalid Unicode scalars with `U+FFFD`, matching `string(n)`).
- Chained type aliases (`type A = P; type B = A; func (b B) Get()`) canonicalize transitively to `P`.

---

## Implementation Tasks

### Phase 1: Generic & Alias Method Dispatch (roots `generic-nonstruct-method-drop`, `method-expr-iface-typeparam`, `alias-receiver-uncanonicalized`)
*Scheduled from review follow-ups (2026-11-24).*
- [ ] Task 1.1: Instantiate methods on generic non-struct types and preserve `_ptrRecv` and JS type-info (G1.1–G1.2)
  - Files: `src/typechecker/resolve.js` (`instantiateGenericWithArgs`, `_syncInstanceMethods`), `src/backend/js/index.js` (`_namedBoxInfo`, `genMethod`), `src/backend/js/expressions.js`
  - Test: `test/unit/language/generics.test.js`, `test/unit/types/methods.test.js`: G1.1 (`W[int]{1, 2, 3}.Len()`), G1.2 (generic map/array/basic types, pointer receiver `Push`, method body using `var z T`) on `js`, `both`, `wasm`
  - Done when: methods on generic non-struct defined types compile and run on all targets
- [ ] Task 1.2: Support method expressions on interfaces and type parameters (G2.1–G2.2)
  - Files: `src/typechecker/expressions.js` (`_resolveMethodExprType`, `_checkMethodExprSelector`), `src/backend/js/expressions.js`, `src/backend/js/type-info.js`
  - Test: `test/unit/types/methods.test.js`, `test/unit/language/generics.test.js`: G2.1–G2.2 (`N.M(n)`, `fn := N.M`, `T.M(t)` with struct and named non-struct `T`) on `js`, `both`, `wasm`
  - Done when: interface and type-parameter method expressions compile and return Go's output on all targets
- [ ] Task 1.3: Canonicalize alias method receivers in checker and DCE reachability (G3.1–G3.3)
  - Files: `src/typechecker/index.js` (`_unwrapPointerAliasReceiver` → `_canonicalizeAliasReceiver`), `src/lower/reachability.js` (`_keepsMethod`, `_reachMethods`)
  - Test: `test/unit/types/methods.test.js`, `test/unit/compiler/dce.test.js`: G3.1–G3.3 (`type A = P`, chained `type B = A`, value & pointer receivers on `js`/`both`/`wasm`, plus DCE retention when `P` escapes to `any`)
  - Done when: methods declared on local type aliases work on all targets and are retained when reachable through the underlying type

### Phase 2: Type-Parameter Builtins & Conversions (roots `js-typeparam-builtin-dispatch`, `js-typeparam-string-complex-conv`, `checker-untyped-to-complex-typeparam`)
- [ ] Task 2.1: Runtime-dispatched JS `clear`, `len`, and `cap` on type-parameter operands (G4.1–G4.2)
  - Files: `src/backend/js/expressions.js` (`_genBuiltinClear`, `_genBuiltinLen`, `BUILTIN_GEN.cap`), `src/backend/js/runtime.js` (`__clear`, `__len`, `__cap`), `src/backend/js/type-info.js` (`_callUsesTypeInfo`, `ez`)
  - Test: `test/unit/language/generics.test.js`: G4.1 (`clear` on `M ~map`, `S ~[]int`, `S ~[]MyStruct`, `T ~map | ~[]int`, nil) and G4.2 (`len`/`cap` on `T ~[]int | ~*[3]int` and `T ~[3]int | ~*[3]int`) on `js`, `both`, `wasm`
  - Done when: `clear`, `len`, and `cap` on type-parameter operands match Go on all targets
- [ ] Task 2.2: Support `~string | ~[]byte` type parameters in `copy` and `append([]byte{}, v...)` (G4.3)
  - Files: `src/typechecker/expressions.js` (`_checkAppendArgs`, `_isStringIntoBytes`), `src/backend/js/expressions.js` (`_genSliceSource`)
  - Test: `test/unit/language/generics.test.js`: G4.3 (`copy(dst, src)` and `append([]byte{}, v...)` with both `string` and `[]byte` instantiations) on `js`, `both`, `wasm`
  - Done when: `copy` and `append` with `~string | ~[]byte` type parameters compile and match Go on all targets
- [ ] Task 2.3: Fix generic `string(t)` and `T(x)` conversions for `~string`, `~[]byte`/`~[]rune`, and `~complex` (G5.1–G5.3)
  - Files: `src/typechecker/expressions.js` (`_termConvertible`), `src/backend/js/expressions.js` (`_genStringConversion`), `src/backend/js/runtime.js` (`__tconv`, `__tstr`)
  - Test: `test/unit/language/generics.test.js`: G5.1 (`string(t)` on `~string | ~[]byte`, `~string | ~[]rune`, `~int | ~int32`), G5.2 (`T(1.5)` on `~complex128` and `~complex64`), G5.3 (`T(65)`, `T([]byte("hi"))`, `T([]rune("ok"))` on `~string`) on `js`, `both`, `wasm`
  - Done when: all generic string and complex conversions compile and match Go on all targets

### Phase 3: JS Erased Type-Parameter `switch` & Address-Of (roots `js-switch-typeparam-equality`, `js-typeparam-address-of-box`)
- [ ] Task 3.1: Compare type-parameter `switch` tags with `__geq` in JS (G6.1)
  - Files: `src/backend/js/statements.js` (`_switchTagAndCases`, `genSwitch`), `src/backend/js/type-info.js` (`_nodeUsesTypeInfo`)
  - Test: `test/unit/language/generics.test.js`: G6.1 (`switch x { case y: }` on `T comparable` instantiated with struct, array, `complex128`, `any`, and labeled switch) on `js`, `both`, `wasm`
  - Done when: JS `switch` on type-parameter tags matches Go value equality across all comparable types
- [ ] Task 3.2: Keep address-taken type-parameter params and locals unboxed when `T` is a struct in JS (G7.1)
  - Files: `src/backend/js/expressions.js` (`_emitParamCopies`, `_genUnaryExpr`), `src/backend/js/statements.js` (boxed local init/read/write), `src/backend/js/index.js`
  - Test: `test/unit/language/generics.test.js`: G7.1 (`makePtr(Box{11})`, local `x := v; return &x`, mutating through returned `*Box`, reassigning `v = Box{22}` after taking `&v`, plus non-struct controls `42` and `[2]int{3, 4}`) on `js`, `both`, `wasm`
  - Done when: `&v` on a type-parameter param or local returns a valid `*T` for both struct and non-struct instantiations
