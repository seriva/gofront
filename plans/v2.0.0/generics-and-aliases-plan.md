# Generics & Alias Semantics Fixes — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-24 (`/bs-plan`): generic and type-alias follow-ups from `checker-go-rules` (L13, L15, L19, L21, L22), `checker-operand-rules` (L42, L43), `codegen-fixes` (L82), and `js-dead-code-elimination` (L42 DCE sibling). Split from [`js-codegen-and-value-semantics-plan.md`](js-codegen-and-value-semantics-plan.md) for phase sizing; run sequentially with it because both touch `src/typechecker/expressions.js` and `src/backend/js/{expressions,statements,runtime}.js`.  
**Release note:** Methods declared on generic non-struct types (`type List[T any] []T`) and on type aliases of local types (`type A = P`) now work on JavaScript and WebAssembly, method expressions on interfaces and type parameters (`N.M(x)`, `T.M(t)`) compile, and generic code on JavaScript now gets the same results as Go for `clear`, `len`, `cap`, `copy`, `append`, `string(t)` and `T(x)` conversions, `switch` on struct or array values, and `&v` of a struct parameter. Declaring methods on an alias of an instantiated generic type (`type A = G[int]`) is now a compile error, as in Go.

---

## Goal

Close the erased-JS-generics, generic-instantiation, and type-alias method bugs where valid Go either fails to compile, crashes at runtime, or silently returns wrong values on JavaScript (and for alias receivers, ICEs on WebAssembly or gets pruned by DCE).

**Done means:**
- Every failing row in *Verified Gaps* (G1–G7, incl. review siblings) compiles and produces Go's output across `js`, `both`, and `wasm` (`assertAllTargetsOutput` / `assertOutput`) in `test/unit/types/generics.test.js`, `test/unit/language/named-type-methods.test.js`, and `test/unit/compiler/dce-methods.test.js`; G3.6 (`type A = G[int]` receiver) is rejected with `cannot define new methods on instantiated type G[int]` (`assertErrorContains`).
- `docs/language-support.md` rows for method expressions and methods on named non-struct types list the new forms (interface/type-param method expressions, generic non-struct receivers) with passing fixtures.
- Zero `TypeError` / garbage `-922372036854775808` outputs on JS erased generics (`clear(M ~map)`, `len`/`cap` on `~*[N]T`, `copy`/`append` on `~string | ~[]byte`, `string(t)`, `T(1.5)`/`T(65)`, `switch x { case y: }`, `func makePtr[T any](v T) *T { return &v }`).
- `npm test`, `npm run check`, and `npm run test:e2e` pass.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `generic-nonstruct-method-drop`: instantiate and sync methods (preserving `_ptrRecv` and JS type-info) on generic non-struct types | `type W[T any] []T; func (w W[T]) Len() int`, generic map/array/basic types, pointer receivers | |
| **In scope: core** | Root `method-expr-iface-typeparam`: resolve method expressions on interfaces and type parameters in the checker, substitute the type-parameter selector base during WASM monomorphisation, and emit receiver-passing JS (with type-param boxing) | `N.M(n)`, `fn := N.M`, `T.M(t)`, `g := T.M` with `T` = struct, `*S`, or named non-struct | |
| **In scope: core** | Root `alias-receiver-uncanonicalized`: canonicalize every local-alias receiver (value alias, pointer alias, chained alias; struct or named non-struct target) to the target type name once at checker method registration, so JS, WASM, and DCE reachability see the canonical name by construction; reject aliases of instantiated generic types as Go does | `type A = P; func (a A) Get()`, `func (a *A) Set()`, `type B = A`, `type A = I` (`type I int`), interface dispatch/assertion through alias-declared methods, `console.log(p)` escape under DCE, `type A = G[int]` (rejected) | |
| **In scope: core** | Roots `js-typeparam-builtin-dispatch`, `js-typeparam-string-complex-conv`, `checker-untyped-to-complex-typeparam`: runtime-dispatched JS builtins (`clear`, `len`, `cap`, `copy`, `append`) and conversions (`string(t)`, `T(x)`) for union-constrained type parameters, plus checker support for `append([]byte{}, T...)` and untyped real → `~complex` | `clear(M ~map)`, `clear(S ~[]T)`, `len(T ~[]int \| ~*[3]int)`, `cap(...)`, `copy`/`append` (`~string \| ~[]byte`), `string(t)`, `T(1.5)`, `T(65)`, `T(s)` for `T ~[]byte \| ~[]rune`, `S(t)` for `S ~string` from `T ~[]byte \| ~[]rune` | |
| **In scope: target-specific** | Roots `js-switch-typeparam-equality` & `js-typeparam-address-of-box` (`js`/`both` only): compare type-parameter `switch` tags via `__geq` and keep address-taken type-parameter params/locals unboxed when `$z_T` is a struct | `switch x { case y: }` on `T comparable`, `func makePtr[T any](v T) *T { return &v }` | WASM monomorphises concrete types and already passes both |
| **Excluded: deferred** | `(*p).Inc()` on `PT interface{ *T; Inc() }` (L107) | `func bump[T any, PT Incer[T]](p PT) { (*p).Inc() }` | Matches Go spec (*Method sets*: `*T` for a type parameter `T` has an empty method set; callers write `p.Inc()` or `PT(&(*p)).Inc()`, both already working). Kept in `plans/follow-ups.md` pending `go build` confirmation to drop |

---

## Verified Gaps & Baseline Audit

**Method.** Read-only code inspection and `node --input-type=module -e` probes across `js`, `both`, and `wasm` on `main` (`dda372c4`, 2026-11-24). Review (2026-11-24, `368e33bf`): every repro re-run via `runProgram` (`test/unit/helpers.js`) on `js`/`both`/`wasm`; rows marked *review* are new siblings or probe-only feasibility patches (monkey-patched checker methods, never committed).

### G1 `generic-nonstruct-method-drop` (L13)
Root: `instantiateGenericWithArgs` (`src/typechecker/resolve.js:1084-1093`) only creates `instantiated.methods = new Map()` when `instantiated.kind === "struct"`, leaving `named.methods === undefined` for slices/maps/arrays/basics/funcs; `_syncInstanceMethods` (`:1098-1118`) returns early when `!methods`, and `substituteType` (`:1111`) drops `_ptrRecv`. On JS, `_namedBoxInfo` (`src/backend/js/index.js:912-928`, line 924) requires own `_ptrRecv` on methods and `genMethod` (`:1242-1244`) sets `tpNames = null` for `staticNamed`, losing `$z_T` inside generic non-struct methods.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G1.1 (L13 repro) | `type W[T any] []T; func (w W[T]) Len() int { return len(w) }; W[int]{1, 2, 3}.Len()` | `3` | `W[int] has no field or method 'Len'` on `js`/`both`/`wasm` |
| G1.2 *sibling* | generic map/array/basic receivers (`type M[K comparable, V any] map[K]V`), pointer receiver `func (w *W[T]) Push(v T)`, method using `var z T` on JS | Go output on all targets | same missing-method error (and missing `$z_T` in JS method body) |
| G1.3 *sibling (review 2026-11-24)* | `type B[T any] int; func (b B[T]) Z() T { var z T; return z }; fmt.Printf("%q", B[string](1).Z())` | `""` | with a probe-only checker patch (create `named.methods` for non-struct instances + `_syncInstanceMethods`), G1.1–G1.2 and interface boxing/assertion (`var l L = W[int]{1,2}`, `var p P = &w; p.Push(3)`, `l.(W[int])`) pass on all targets, but JS prints `%!q(<nil>)` (wasm `""`): confirms the `genMethod` `tpNames = null` half of the root; numeric `T` (`B[float64]` → `0`) masks it, so tests must use `T = string` |

### G2 `method-expr-iface-typeparam` (L22)
Root: `_resolveMethodExprType` (`src/typechecker/expressions.js:846-857`) returns `null` for `interface` and `typeParam`, so `_checkSelectorExpr` (`:1090-1102`) falls through to `fieldType` without prepending the receiver to `params` → `Too many arguments: expected 0, got 1`. On JS, `src/backend/js/type-info.js:83` skips `_isMethodExpr` in `_isTypeParamMethodCall`, so `T.M` also needs type-info boxing when `T` is a named non-struct type.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G2.1 (L22 repro) | `type N interface{ M() int }; func f[T N](t T) int { return T.M(t) }` | `9` | `Too many arguments: expected 0, got 1` on `js`/`both`/`wasm` |
| G2.2 *sibling* | `N.M(n)`; `fn := N.M; fn(n)`; `T.M` instantiated with named non-struct `type MyInt int` implementing `N` | `9` | `Too many arguments: expected 0, got 1` |
| G2.3 *review 2026-11-24 (probe-only checker patch: `_resolveMethodExprType` returns the interface / type-param constraint method)* | G2.1, `g := T.M; g(t)` with `T = *S` (pointer-receiver `M`), G2.2 | `9` on all targets | `wasm`: ICE `Type error … Undefined: 'T'` for every `T.M` form, because `substituteTypesInAst` (`src/backend/wasm/monomorph.js:~425-460`) rewrites `T(x)`, `make(T)`, `(*T)` but never a `SelectorExpr` whose base `Ident` is a type parameter; `N.M(n)` passes on `wasm`/`js`. `both`: `N.M(n)` → `N is not defined`. `js`/`both`: `T.M` with `T = MyInt` → `recv.M is not a function`. So the root spans checker + WASM monomorph + JS emit |

### G3 `alias-receiver-uncanonicalized` (L42)
Root: `_unwrapPointerAliasReceiver` (`src/typechecker/index.js:1533-1543`) only rewrites pointer-alias receivers (`type C = *P`), leaving value-alias receivers (`type A = P`, `func (a A) Get()` and `func (a *A) Set()`) keyed under `"A"`. JS `_collectMethodMap` (`src/backend/js/index.js:644-648`) misses them when emitting class `P`, WASM (`src/backend/wasm/index.js:375-399`) ICEs with `Unknown field 'Get' on struct 'P'`, and DCE `_keepsMethod`/`_reachMethods` (`src/lower/reachability.js:655-666, 722-733`) tests uncanonicalized `"A"` against `this.escaped` / `u.byName` instead of `"P"`. All of these key off `decl.recvType.name`, so one rewrite in `_unwrapPointerAliasReceiver`'s place (called from `collectFunc`, `src/typechecker/index.js:1547`) fixes every consumer (review fix probe below).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G3.1 (L42 repro) | `type P struct{ n int }; type A = P; func (a A) Get() int { return a.n }; var p P; p.Get()` | `0` | JS `p.Get is not a function`; WASM ICE `Unknown field 'Get' on struct 'P'` |
| G3.2 *sibling* | `func (a *A) Set(v int)` on `var p P` | sets `p.n` | JS `p.Set is not a function`; WASM ICE |
| G3.3 (L42 DCE, repro corrected in review 2026-11-24) | `type A = P; func (a A) Get() int; func main() { var p P; console.log(p) }` (`P` escapes to JS) | `Get(` kept in JS output (as for `func (a P) Get()`) | `Get(` dropped (non-alias control keeps it). The logged repro `func use(x any){}; use(p)` is not a gap: `use` is Go, `P` does not escape, nothing selects `Get`, and the non-alias control drops `Get(` too (correct pruning) |
| G3.4 *sibling (review 2026-11-24)* | `type B = A; func (b B) Get() int`; `var g G = p; g.Get()`; `use(x any) { x.(interface{ Get() int }).Get() }` | `1`, `0` | JS `g.Get is not a function` / `interface conversion: main.P is not interface {}: missing method Get`; WASM `interface conversion: nil or unmatched type for method call` |
| G3.5 *sibling (review 2026-11-24)* | `type I int; type A = I; func (a A) Dbl() int { return int(a) * 2 }; var i I = 3; i.Dbl()` | `6` | JS `I.$Dbl is not a function`; WASM ICE `Cannot resolve struct for selector: Dbl` |
| G3.6 *sibling (review 2026-11-24)* | `type G[T any] struct{ v T }; type A = G[int]; func (a A) M() int` | compile error `cannot define new methods on instantiated type G[int]` | accepted; JS `(intermediate value).M is not a function`, WASM prints `3` |
| fix probe (review 2026-11-24) | probe-only patch: after `_unwrapPointerAliasReceiver`, rewrite `decl.recvType.name` to `resolveTypeNodeName(...)`'s local named target | G3.1–G3.5 Go output; DCE keeps `Get(` | all pass on `js`/`both`/`wasm`, incl. G3.3 with **no** `src/lower/reachability.js` change (`_keepsMethod`/`_reachMethods` key off `node.recvType.name`, now canonical) |
| control | `type C = *P; func (c C) Set(v int)`; `type A = struct{ n int }; func (a A) M()` | `5`; `invalid receiver type A` | passes on all targets (must stay) |

### G4 `js-typeparam-builtin-dispatch` (L15)
Root: JS builtin emitters branch on static AST type instead of runtime value shape for `typeParam` operands:
- `_genBuiltinClear` (`src/backend/js/expressions.js:2562-2577`) emits `(m)?.fill(null)` for `M ~map[K]V` and fills slices with `null` instead of the element's zero value (missing `ez` in `src/backend/js/type-info.js:129-153`).
- `_genBuiltinLen` (`:2550-2560`), `BUILTIN_GEN.cap` (`:445-449`), and `__len`/`__cap` (`src/backend/js/runtime.js:5-8, 152-158`) misclassify boxed array pointers `{ value: [1,2,3] }` (`~*[3]int`) as maps (`Object.keys(a).length === 1`) or `undefined` (`-922372036854775808`).
- `_genSliceSource` (`src/backend/js/expressions.js:2588-2593`) checks `_isStringExprType` statically instead of `typeof v === "string" ? __u8enc(v) : v` for `T ~string | ~[]byte`.
- Checker `_checkAppendArgs` / `_isStringIntoBytes` (`src/typechecker/expressions.js:3156-3183`) fails to check each union term of `T ~string | ~[]byte` in `append([]byte{}, v...)`.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G4.1 (L15 repro) | `clear(m)` (`M ~map[string]int`); `clear(s)` (`S ~[]int`); `clear(x)` (`T ~map \| ~[]int`) | `0`, `[0 0]`, `0 [0 0]` | JS `m?.fill is not a function` / `[-922372036854775808 ...]`; WASM passes |
| G4.1b *sibling (review 2026-11-24)* | `clear(s)` on `S ~[]St` then `s[0].a = 5`; `S ~[]string`; `S ~[]bool` | `[{5} {0}]`, `[""]`, `[false]` | JS `Cannot set properties of null (setting 'a')`, `["null"]` (`[false]` passes by accident); WASM passes |
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
| G5.4 *sibling (review 2026-11-24)* | `func a[T ~[]byte](s string) T { return T(s) }`; same with `T ~[]rune`; `func c[S ~string, T ~[]byte \| ~[]rune](t T) S { return S(t) }` | `[104 105]`, `[111 107]`, `zz`, `yy` | JS `[]`, `[-9223372036854775808 -9223372036854775808]`, `[122 122]`, `<nil>`; WASM passes. Same root 3: `__tconv` (`runtime.js:745-760`) falls to `default` (returns `v` raw) for slice and string targets |
| control | `T(complex128(3+4i))`, `T(1+2i)` (`T ~complex128`) | `(3+4i)`, `(1+2i)` | passes on all targets (must stay) |

### G6 `js-switch-typeparam-equality` (L43)
Root: `_switchTagAndCases` (`src/backend/js/statements.js:2413-2494`) has no branch for `stmt.tag._type?.kind === "typeParam"`, falling through to JS `switch (tag)` (`===` reference equality). `genSwitch` (`:2534-2539`) and `_nodeUsesTypeInfo` (`src/backend/js/type-info.js:89-127`) also need to recognize `typeParam` switch tags.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G6.1 (L43 repro & siblings) | `func f[T comparable](x, y T) bool { switch x { case y: return true }; return false }` on `P{1}`, `[2]int{1, 2}`, `complex128`, `any(P{1})` | `true` on all | JS `false` on all 4; WASM `true` on all 4 |
| G6.2 *sibling (review 2026-11-24)* | labeled `L: switch x { case y: break L }`; `switch y { case x: }` inside `for range ys`; `switch x { case any(P{1}): }` (tag `T`, case `any`) | `true`, `1`, `"p1"` | JS `false`, `-1`, `"no"`; WASM passes |
| control | `f(5, 5)`; `x == y` on `P{1}`; `switch { case x == y: }`; `switch any(y) { case any(x): }` | `true` | passes (must stay) |

### G7 `js-typeparam-address-of-box` (L82)
Root: `isReferenceType(typeParam)` (`src/lower/boxing.js:6-25`) is `false`, so address-taken `typeParam` params and locals are added to `_boxedVars` and unconditionally wrapped in `{ value: v }` (`src/backend/js/expressions.js:1284-1288`, `statements.js:284, 504, 530, 2273`, `index.js:1543, 1565`). `_genUnaryExpr("&")` (`expressions.js:1328-1335`) returns `{ value: Box{11} }`, whereas concrete `*Box` callers expect the struct instance directly (as `&s[i]` already handles via `_typeParamIsStructJs` at `:1352-1353`).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| G7.1 (L82 repro & sibling) | `func makePtr[T any](v T) *T { return &v }; makePtr(Box{11}).N` and local `x := v; return &x` | `11`, `99` | JS `-922372036854775808`; WASM `11`, `99` |
| G7.2 *sibling (review 2026-11-24)* | `p := &v; v = w; return p` (`Box{1}`, `Box{33}`); `p := &v; return func() T { return *p }` | `33`, `7` | JS `-9223372036854775808` for both; WASM passes |
| control | `makePtr(42)`, `makePtr([2]int{3, 4})`; `p := makePtr(Box{11}); p.N = 22`; caller's `src` unchanged after `makePtr(src).N = 6` | `42`, `3`; `22 {22}`; `5` | passes on all targets (must stay) |

---

## Approach

### 1. Architecture & Design Decisions
- **G1 (`resolve.js`, `js/index.js`, `js/expressions.js`):** Create and sync `named.methods` in `instantiateGenericWithArgs` / `_syncInstanceMethods` for **all** generic named types (not just structs), preserving `_ptrRecv` across `substituteType`. In JS codegen (`_namedBoxInfo`, `genMethod`), keep `tpNames` active on generic non-struct methods and pass type-info arguments when calling them.
- **G2 (`typechecker/expressions.js`, `wasm/monomorph.js`, `js/expressions.js`, `js/type-info.js`):** Extend `_resolveMethodExprType` to handle `interface` and `typeParam` receivers (method from the interface / constraint's core interface; `_checkMethodExprSelector` already prepends `baseType` to `params` and marks `_isMethodExpr`). In WASM `substituteTypesInAst`, rewrite a `SelectorExpr` whose base `Ident` is in `typeSubstMap` to a `TypeExpr` of the concrete type (`(*S)` for pointer args) so `desugarMethodExprs` sees a concrete receiver (G2.3). On JS, emit nil-checked interface dispatch for interface method expressions (also in `both`, G2.3 `N is not defined`) and `__tbox($z_T, recv)` for `typeParam` method expressions, and include `_isMethodExpr` in `_isTypeParamMethodCall`.
- **G3 (`typechecker/index.js` only):** Generalize `_unwrapPointerAliasReceiver` into `_canonicalizeAliasReceiver` so value-alias (`type A = P`, `type A = I`), chained (`type B = A`), and pointer-alias (`type C = *P`, `func (a *A)`) receivers rewrite `decl.recvType.name` to the canonical local target type name at `collectFunc`. JS class emission, WASM method lookup, and DCE `_keepsMethod`/`_reachMethods` key off that name, so they are fixed by construction (review fix probe: G3.1–G3.5 pass with no backend or `reachability.js` change; `reachability.js` keeps its existing `canonicalRecv`). An alias whose target is a generic instance (`named._genericOf`) reports `cannot define new methods on instantiated type G[int]` (G3.6); non-local targets keep the existing `_isNonLocalNamed` rejection path.
- **G4 (`typechecker/expressions.js`, `js/expressions.js`, `js/runtime.js`, `js/type-info.js`):** Add `__clear(v, ez)` in `runtime.js` (checking `v instanceof Map` / plain-object map vs array/TypedArray filling with fresh `ez()`), extend `__len`/`__cap` to unwrap `{ value: arr }` array-pointer boxes (`v && typeof v === "object" && "value" in v && (Array.isArray(v.value) || ArrayBuffer.isView(v.value))`), emit runtime `typeof v === "string" ? __u8enc(v) : v` in `_genSliceSource` for `typeParam`, and check union terms in `_checkAppendArgs` (`src/typechecker/expressions.js`).
- **G5 (`typechecker/expressions.js`, `js/expressions.js`, `js/runtime.js`):** Allow untyped real constants to convert to complex union terms in `_termConvertible`. Route `string(t)` on a `typeParam` through a runtime helper `__tstr(v)` (handling `string`, `Uint8Array`, `Int32Array`/rune arrays, and integer code points) and add `"string"` (decoding `Uint8Array` / rune arrays, `String.fromCodePoint` for integers), `"complex128"`, and `"complex64"` cases to `__tconv`, plus `[]byte` / `[]rune` targets from a string source (`__u8enc` / code-point array; G5.4); the zero factory's `k` tag (`__ti`, `runtime.js:683-687`) must distinguish those slice kinds.
- **G6 (`js/statements.js`, `js/type-info.js`):** Add a `typeParam` tag branch in `_switchTagAndCases` comparing each case the way `BinaryExpr` `==` does for the same operand types (`__geq($z_T, tag, caseVal)` when the case is `T`; interface equality on the boxed tag when the case is interface-typed, G6.2 `case any(P{1})`), wrap labeled `typeParam` switches in `{ ... }` in `genSwitch`, and register helper/type-info usage.
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
- [x] Task 1.1: Instantiate methods on generic non-struct types and preserve `_ptrRecv` and JS type-info (G1.1–G1.3)
  - Files: `src/typechecker/resolve.js` (`instantiateGenericWithArgs`, `_syncInstanceMethods`), `src/backend/js/index.js` (`genMethod` `tpNames`; `_namedBoxInfo` only if a test needs it), `src/backend/js/expressions.js` (type-info args at generic non-struct method call sites)
  - Test: `test/unit/types/generics.test.js`: G1.1 (`W[int]{1, 2, 3}.Len()`), G1.2 (generic map/array/basic types, pointer receiver `Push`), G1.3 (`B[string](1).Z()` → `""`; `W[int]` through an interface, `l.(W[int])`) via `assertAllTargetsOutput`
  - Done when: methods on generic non-struct defined types compile and run on all targets, and `var z T` inside them is `T`'s zero value on JS
- [x] Task 1.2: Resolve interface and type-parameter method expressions in the checker and WASM monomorphisation (G2.1–G2.3)
  - Files: `src/typechecker/expressions.js` (`_resolveMethodExprType`), `src/backend/wasm/monomorph.js` (`substituteTypesInAst`: type-param selector base)
  - Test: `test/unit/types/generics.test.js`: G2.1–G2.3 (`N.M(n)`, `fn := N.M`, `T.M(t)` and `g := T.M` with `T` = struct, `*S`, `MyInt`) via `assertWasmProgramOutput`, plus a `js`-target assertion for `T.M(t)` with struct `T` (already passes once checked)
  - Done when: the checker accepts every G2 form and `wasm` prints Go's output for all of them (no `Undefined: 'T'` ICE)
- [x] Task 1.3: Emit interface and type-parameter method expressions in JS (G2.1–G2.3)
  - Files: `src/backend/js/expressions.js` (method-expr emission `:~1425`, `:~1639`), `src/backend/js/type-info.js` (`_isTypeParamMethodCall`)
  - Test: `test/unit/types/generics.test.js`: upgrade the Task 1.2 cases to `assertAllTargetsOutput` (`both` `N.M(n)`; `T.M` with named non-struct `MyInt` via `__tbox`; nil interface receiver panics as in Go)
  - Done when: every G2 form prints Go's output on `js`, `both`, and `wasm`
- [x] Task 1.4: Canonicalize alias method receivers at checker registration (G3.1–G3.6)
  - Files: `src/typechecker/index.js` (`_unwrapPointerAliasReceiver` → `_canonicalizeAliasReceiver`)
  - Test: `test/unit/language/named-type-methods.test.js`: G3.1, G3.2, G3.4, G3.5 (value/pointer/chained alias receivers, alias of `type I int`, interface dispatch and assertion) via `assertAllTargetsOutput`, G3.6 negative (`assertErrorContains(errors, "cannot define new methods on instantiated type G[int]")`), pointer-alias and anonymous-struct-alias controls; `test/unit/compiler/dce-methods.test.js`: G3.3 (`console.log(p)` keeps `Get(` for a method declared on `A`)
  - Done when: methods declared on local type aliases work on all targets and survive DCE exactly like methods declared on the target type, with no change to `src/lower/reachability.js` or either backend

### Phase 2: Type-Parameter Builtins & Conversions (roots `js-typeparam-builtin-dispatch`, `js-typeparam-string-complex-conv`, `checker-untyped-to-complex-typeparam`)
- [x] Task 2.1: Runtime-dispatched JS `clear`, `len`, and `cap` on type-parameter operands (G4.1–G4.2)
  - Files: `src/backend/js/expressions.js` (`_genBuiltinClear`, `_genBuiltinLen`, `BUILTIN_GEN.cap`), `src/backend/js/runtime.js` (`__clear`, `__len`, `__cap`), `src/backend/js/type-info.js` (`_callUsesTypeInfo`, `ez`)
  - Test: `test/unit/types/generics.test.js`: G4.1–G4.1b (`clear` on `M ~map`, `S ~[]int`, `S ~[]MyStruct` then field write, `S ~[]string`, `T ~map | ~[]int`, nil) and G4.2 (`len`/`cap` on `T ~[]int | ~*[3]int` and `T ~[3]int | ~*[3]int`) on `js`, `both`, `wasm`
  - Done when: `clear`, `len`, and `cap` on type-parameter operands match Go on all targets
- [x] Task 2.2: Support `~string | ~[]byte` type parameters in `copy` and `append([]byte{}, v...)` (G4.3)
  - Files: `src/typechecker/expressions.js` (`_checkAppendArgs`, `_isStringIntoBytes`), `src/backend/js/expressions.js` (`_genSliceSource`)
  - Test: `test/unit/types/generics.test.js`: G4.3 (`copy(dst, src)` and `append([]byte{}, v...)` with both `string` and `[]byte` instantiations) on `js`, `both`, `wasm`
  - Done when: `copy` and `append` with `~string | ~[]byte` type parameters compile and match Go on all targets
- [x] Task 2.3: Fix generic `string(t)` and `T(x)` conversions for `~string`, `~[]byte`/`~[]rune`, and `~complex` (G5.1–G5.4)
  - Files: `src/typechecker/expressions.js` (`_termConvertible`), `src/backend/js/expressions.js` (`_genStringConversion`), `src/backend/js/runtime.js` (`__tconv`, `__tstr`, `__ti` kind tags)
  - Test: `test/unit/types/generics.test.js`: G5.1 (`string(t)` on `~string | ~[]byte`, `~string | ~[]rune`, `~int | ~int32`, incl. `int32(0x110000)` → `"�"`), G5.2 (`T(1.5)` on `~complex128` and `~complex64`), G5.3 (`T(65)`, `T([]byte("hi"))`, `T([]rune("ok"))` on `~string`), G5.4 (`T(s)` for `T ~[]byte` / `~[]rune`; `S(t)` for `S ~string` from `T ~[]byte | ~[]rune`) on `js`, `both`, `wasm`
  - Done when: all generic string and complex conversions compile and match Go on all targets

### Phase 3: JS Erased Type-Parameter `switch` & Address-Of (roots `js-switch-typeparam-equality`, `js-typeparam-address-of-box`)
- [x] Task 3.1: Compare type-parameter `switch` tags with `__geq` in JS (G6.1–G6.2)
  - Files: `src/backend/js/statements.js` (`_switchTagAndCases`, `genSwitch`), `src/backend/js/type-info.js` (`_nodeUsesTypeInfo`)
  - Test: `test/unit/types/generics.test.js`: G6.1 (`switch x { case y: }` on `T comparable` instantiated with struct, array, `complex128`, `any`), G6.2 (labeled switch with `break L`, switch inside `for range`, interface-typed case `any(P{1})`), plus the G6 controls, on `js`, `both`, `wasm`
  - Done when: JS `switch` on type-parameter tags matches Go value equality across all comparable types
- [ ] Task 3.2: Keep address-taken type-parameter params and locals unboxed when `T` is a struct in JS (G7.1–G7.2)
  - Files: `src/backend/js/expressions.js` (`_emitParamCopies`, `_genUnaryExpr`), `src/backend/js/statements.js` (boxed local init/read/write), `src/backend/js/index.js`
  - Test: `test/unit/types/generics.test.js`: G7.1 (`makePtr(Box{11})`, local `x := v; return &x`), G7.2 (reassigning `v = Box{33}` after `p := &v`, `*p` read in a closure), plus the G7 controls (mutating through returned `*Box`, caller copy unchanged, non-struct `42` and `[2]int{3, 4}`) on `js`, `both`, `wasm`
  - Docs: `docs/language-support.md`: method-expression rows add interface and type-parameter forms (`N.M`, `T.M`) and the named non-struct methods row adds generic receivers (`type List[T any] []T`), each with a `<!-- fixture: … -->` that passes
  - Done when: `&v` on a type-parameter param or local returns a valid `*T` for both struct and non-struct instantiations, and the updated `docs/language-support.md` fixtures pass
