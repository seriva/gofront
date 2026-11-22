# JS Names, `wasm` Panics and Type Expressions — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Holds the follow-ups split off from [`../v1.9.3/follow-ups-2026-11-16-plan.md`](../v1.9.3/follow-ups-2026-11-16-plan.md) and the 2026-11-16 ledger sweep that remain after the 2026-11-17 split by root cause. Moved out on 2026-11-17: `wasm` struct layout, type keys and rewrites (F8, F17, F24, F25, F28, F31, L5, L11, L13) → [`wasm-struct-types-plan.md`](wasm-struct-types-plan.md); file-scoped imports and qualified names (L6–L10), and on 2026-11-17 (later) export visibility (F5, F29) → [`package-scope-plan.md`](package-scope-plan.md); JS `new` of an anonymous struct (L14) → [`value-stores-plan.md`](value-stores-plan.md); local type named after an import (L4) → [`checker-go-rules-plan.md`](checker-go-rules-plan.md) Phase 8. Phase 1 needs the v1.9.3 Task 1.3 (`instanceKey`) merged (it is). Independent of the other v2.0.0 plans, except that Task 4.1's `wasm` assertion is switched on by [`wasm-struct-types-plan.md`](wasm-struct-types-plan.md) Task 3.2, and `mangleLocalTypes` is also changed by [`checker-go-rules-plan.md`](checker-go-rules-plan.md) Task 8.1 (whichever lands second rebases); start before [`incremental-builds-plan.md`](incremental-builds-plan.md), which restructures `src/compiler.js`.  
**Release note:** Types named after JavaScript built-ins such as `Map` or `WeakMap`, WebAssembly types named after reserved words, conversions through type aliases, struct tags in type arguments and parenthesised type literals now work. On WebAssembly, slice bounds, `make` sizes and integer `range` counts of 2³² or more are no longer truncated, and panics show Go's message for `panic(nil)`, unsigned indexes and `bool`, unsigned, `error`, `Stringer` and defined-type values, also when the value is held in an interface.  

---

## Goal

Fix the remaining review follow-ups by root cause: generated names that collide with JavaScript globals or reserved words (one escaping rule for the JS backend and the `wasm` facade), the width and signedness of 64-bit and unsigned operands that `wasm` narrows to `i32` (slice bounds, indexes, `make` sizes, integer `range` counts), the host text of `wasm` panic values, and type expressions written in expression position. The original ledger IDs (F*, L*) are kept for traceability; every row was re-probed on 2026-11-17, and the sibling paths found in the 2026-11-17 review carry an ID suffix (F19a, L2f, …).

**Done means:**
- Every failing row in *Verified Gaps* prints Go 1.26's output, or gives the stated compile error with line:col, on every target its task names, each as a test in the file its task names.
- `npm test` passes, and `test/perf/zero-alloc.js`, `bce-mathx.js` and `bundle-size.js` pass with `bundle-size.baseline.json` unchanged; `test/unit/compiler/js-globals.test.js` passes unmodified apart from new names added to the escaping set.
- `docs/go-compatibility.md` (*Names that shadow JS globals*, the `defer`/`recover()` row, the runtime-panics row) describes the new behaviour.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `js-name-collision`: every generated JS identifier (package-level type classes, `wasm` facade classes and helpers) is escaped from JS globals and reserved words by one rule | F2, F30, L12 | |
| **In scope: target-specific** | Root `wasm-bounds-width`: a Go integer that `wasm` narrows to `i32` (`_emitIndexExprToI32` and its callers: slice expressions, `make`, integer `range`; the `oob32`/`oob64` index paths) is checked and reported at its Go width and signedness | F19 (+F19a, F19lo, F19s, F19m, F19r), F22 (+F22s, F22u) | |
| **In scope: target-specific** | Root `wasm-panic-value`: the host message of an uncaught `wasm` panic is built by one runtime formatter from the value's dynamic Go type, as Go's `printpanicval` does | F20 (+F20u32, F20m, F20g, F20d, F20i), F21 (+F21b, F21c) | |
| **In scope: core** | Root `type-in-expression`: a type written where an expression is parsed (type arguments with struct tags, parenthesised type literals, alias callees) is recognised as a type, and a type keyword that names a value in scope (`func bool()`, `string := …`) is called as that value | L1 (+L1e, L1f), L2 (+L2f, L2g, L2h), L3 (+L3e, L3p, L3f), L15 (+L15s, L15e, L15i) | |
| **Excluded: deferred** | Message of an uncaught `wasm` panic whose value is a struct (or pointer, slice, map, func) implementing neither `error` nor `Stringer` | `panic(P{3})` → `Error: [panic object]`; Go prints `panic: (main.P) 0x…` | Go's text holds an address, so there is no exact target. `recover()` already returns the right value |
| **Excluded: runtime / platform** | `panic(nil)` and a nil interface value on `js`/`both` | `recover()` returns `nil`, `%T` prints `<nil>` | Nil slices, maps, funcs, pointers and interfaces all lower to `null` on JS, so a nil `any` cannot be told apart at the `panic` site without boxing every interface value; documented in Task 3.3 |
| **Excluded: deferred** | Package-level `js`/`both` struct types, or types with methods, named after JS built-ins | `type Set int` with a method → `type Set shadows the JavaScript global Set; rename the type` | Documented clear error, not a miscompile; Task 1.3 only renames the method-less case that slips past the check (F2) |
| **Excluded: runtime / platform** | Bounds checks in plain `js` packages | `xs[i]` out of range in a `js` package returns `undefined` (re-probe: `int`, `uint32`, `uint64` indexes; also `s[:n]` on strings) | Documented: only `both`/`wasm` packages panic on out-of-range indexing (`docs/go-compatibility.md`, runtime panics) |
| **Excluded: runtime / platform** | `uint`/`int` beyond 2⁵³ on the JS side | `xs[uint(1)<<63]` in `both` reports `[9223372036854776000]` | Documented: `int`/`uint` are JS numbers, exact up to 2⁵³ (`docs/go-compatibility.md`, *Integer precision*) |
| **Excluded: deferred** | Moved to other plans on 2026-11-17 | F8, F17, F24, F25, F28, F31, L5, L11, L13; L6–L10, F5, F29; L14; L4 | See **Related** |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6`, 2026-11-17 (re-probed in review at `7504e49` and `002e5180`). A throwaway driver (`.probes/`, deleted) ran single-file programs with `go run` (go1.26, module mode) and `runProgram` (`test/unit/helpers.js:522`) on `js`/`both`/`wasm`, multi-package projects with `compileHybridProject` (`:424`), and uncaught Go panics with a built binary. Original evidence for each ID (2026-11-16) is in the git history of this file.

### `js-name-collision`

Root: JS identifier escaping is split. The JS backend renames value names it knows collide (`$` suffix) and the checker rejects struct types and types with methods named after JS built-ins (`_checkGlobalTypeNamesPass`, `src/typechecker/index.js:692`), but a method-less named non-struct type still emits `class Map`; the `wasm` facade escapes globals in `facadeName` (`src/backend/wasm/boundary.js:2242`) but not strict-mode reserved words, and `genHandleStruct` (`:2828`) along with `__wrap`/view sites (`:1711`, `:1768`, `:2674`, `:2686`, `:2705`) emits raw `${name}` without calling `facadeName`, so a reserved word passes through. `JS_RESERVED` lives in `src/backend/js/names.js`, which `wasm` may not import (`scripts/check-layers.js`).

| ID | Program | Go | GoFront |
|---|---|---|---|
| F2 | `type Map int; var x Map = 5; fmt.Println(x)` | `5` | js/both `ReferenceError: Cannot access 'Map' before initialization`; wasm `5` |
| F2b | `type Promise []int; type Symbol string` used in `main` | `[1] a` | js/both `Cannot access 'Symbol' before initialization`; wasm OK |
| F30 | `util` (`wasm`): `type WeakMap struct{ N int }; func Make(n int) WeakMap`; js main `var z util.WeakMap; z.N = 2; fmt.Println(util.Make(3).N, z.N)` | `3 2` | `ReferenceError: Cannot access 'WeakMap' before initialization`; same for `util` as `both` with `type Map int` |
| L12 | `wasm`: `type yield struct{ X int }; func (y *yield) IsNil() bool …; type Outer struct{ *yield }; var o Outer; fmt.Println(o.IsNil())` | `true` | `SyntaxError: Unexpected strict mode reserved word`; same for `type let struct{…}` returned by an export |
| control | `wasm` `util`: `type Map int; func Make(n int) Map` from js main; `wasm` method named `static`; js `type WeakSet int`, `type Proxy []int`, `type WeakRef struct{…}` (not in `JS_BUILTIN_CLASSES`) | `3`, `5`, `1 [2] 3` | OK |
| F30 prereq | `util` (`both` or `wasm`) and js main both declare `Box`; `import u "./util"; fmt.Printf("%T", u.Make(5))` | `util.Box` | `internal error in the generated Go … Unknown type 'util.Box'` (`checkGeneratedGo`, `src/link/stdlib.js:636`) |

F30 design notes (PR #207): the fix needs `mangleCollidingTypes` (`src/link/type-names.js:28`), `pruneStdlibPrograms` (`src/link/wasm.js:135`) keeping `$$` user types, and `spellNamed` (`src/lower/gen-types.js:225`), `FmtGen.isNamedInScope` (`src/lower/fmt-formatters.js:248`), `checkGeneratedGo` (`src/link/stdlib.js:572`) and `goTypeName` (`src/backend/shared/fmt-types.js:39`) resolving `util.WeakMap` for aliased and indirect imports.

### `wasm-bounds-width`

Root: `_emitIndexExprToI32` (`src/backend/wasm/emit-exprs.js:1384`) wraps an `i64` operand with `i32.wrap_i64` before any check (and leaves an unsigned `i32` operand unchecked), and its callers (`emitSliceExpr` `:792` for slice, array and string bounds; `make` length/capacity and map hint, `src/backend/wasm/emit-builtins.js:247-275`; the integer `range` limit, `src/backend/wasm/emit-stmts.js:2366`) check the wrapped value with signed `i32` comparisons. Separately, `_emitSliceBoundsPanic` (`:778`) and the `oob32` handler (`src/backend/wasm/emit.js:358`) sign-extend `i32` operands, `_isI32IndexExpr` (`:1179`) accepts `uint32` (any `i32`-lowered type), and `emitIndexPanicBody`/`emitSliceBoundsPanicBody` (`src/backend/wasm/index.js:52`, `:93`) format the `i64` with the signed `str_from_i64` (there is no `str_from_u64` import yet) and test `i < 0` with `i64.lt_s`.

| ID | Program (under `recover`) | Go | `wasm` |
|---|---|---|---|
| F19 | `xs := []int{1,2,3}; n := 1 << 32; _ = xs[:n]` | `slice bounds out of range [:4294967296] with capacity 3` | `<nil>` (no panic) |
| F19a | `var a [3]int; _ = a[:n]` | `… [:4294967296] with length 3` | `<nil>` |
| F19lo | `_ = xs[(1<<32)+1:]` | `… [4294967297:3]` | `<nil>` |
| F19s | `s := "abc"; _ = s[:n]` | `… [:4294967296] with length 3` | `<nil>` |
| F19m | `xs := make([]int, n); fmt.Println(len(xs))` (also `make([]int, 0, (1<<32)+1)`) | `4294967296` (allocates) | `0` / cap `1` |
| F19r | `n := (1<<32)+1; for i := range n { if i == 3 { break }; c++ }` | `3` | `1` |
| control | `_ = xs[n]` (64-bit index) | `index out of range [4294967296] with length 3` | same |
| F22a | `xs := make([]int, 3, 5); u32 := uint32(1) << 31; _ = xs[:u32]` | `slice bounds out of range [:2147483648] with capacity 5` | `[:-2147483648]` |
| F22b | same, `_ = xs[u32]` | `index out of range [2147483648] with length 3` | `[-2147483648]` |
| F22s | `s := "abc"; _ = s[u32]` | `index out of range [2147483648] with length 3` | `[-2147483648]` |
| F22u | `u := uint(1) << 63; _ = xs[u]` | `index out of range [9223372036854775808] with length 3` | `[-9223372036854775808]` |

### `wasm-panic-value`

Root: the host message is chosen per static form at the `panic` site. `_emitScalarPanic` (`src/backend/wasm/emit-builtins.js:847`) formats numbers and bools from the WasmGC box width with the signed `str_from_i32`/`str_from_i64` (`bool` → `1`, unsigned → negative); every other value goes to `emitPanicThrow` (`:59`) as an `anyref`, and the env `panic` import (`src/backend/wasm/boundary.js:1882`) applies `String(msg)`, which throws on a WasmGC object (`[panic object]`), so `error`/`Stringer` methods, defined types and interface-typed values are never consulted. `_emitBuiltinPanic` (`:806`) passes a nil `any` through.

| ID | Program | Go (`panic: …`) | `wasm` |
|---|---|---|---|
| F20 | uncaught `panic(true)`, `panic(uint64(1) << 63)`, `panic(errors.New("bad"))` from a `wasm` export | `true` / `9223372036854775808` / `bad` | `Error: 1` / `Error: -9223372036854775808` / `Error: [panic object]` |
| F20u32 | `panic(uint32(1) << 31)` | `2147483648` | `-2147483648` |
| F20m | `type MyErr struct{}` with `Error() string { return "mine" }`; `panic(MyErr{})` | `mine` | `[panic object]` |
| F20g | struct with `String() string { return "str" }`; `panic(Stringer{})` | `str` | `[panic object]` |
| F20d | `type Str string; panic(Str("s"))`; `type T int; panic(T(5))` (also `main.U(2147483648)`, `main.F(1.5)`, `main.B(true)`) | `main.Str("s")` / `main.T(5)` | `[panic object]` / per width |
| F20i | `var v any = errors.New("bad")` (also `true`, `7`); `panic(v)` | `bad` / `true` / `7` | `[panic object]` |
| control | `panic(1.5)`, `panic(float32(0.1))`, `panic(uint8(200))`, `var v any = "s"; panic(v)` | `1.5` / `0.1` / `200` / `s` | `1.5` / – / – / `s` |
| F21 | `defer func() { r := recover(); fmt.Printf("%T %v\n", r, r) }(); panic(nil)` | `*runtime.PanicNilError panic called with nil argument` | `RuntimeError: illegal cast` (js/both `<nil> <nil>`, undocumented) |
| F21b | same, `var a any; panic(a)` | same | `<nil> <nil>` |
| F21c | same, `var e error; panic(e)` | same | `<nil> <nil>` |

### `type-in-expression`

Root: where the parser or checker expects an expression, a type is recognised only in the forms it was written for. The type-argument lookaheads (`_looksLikeTypeArgListInType`, `src/parser/types.js:62`, rejects a literal at bracket depth 1; `looksLikeTypeArgList`, `src/parser/expressions.js:316`, rejects one at any depth) reject the `STRING` of a struct tag and the `INT` of an array length inside a struct; `_parsePrimary`'s `(` branch (`expressions.js:522`) parses an expression (and `parseCall` `:393` only parses `map`/slice/array type arguments), so a parenthesised type literal or `new(struct{…})` fails, although the unparenthesised forms already build `TypeConversion` nodes (`:555-604`); the conversion branch of `checkCall` (`src/typechecker/expressions.js:2175`) accepts only `named`/`pointer`/`basic` callee types (and `_genTypeConversionCall`, `src/backend/js/expressions.js:2124`, skips basic, `[]rune` and array conversions), so an alias of a composite type is called and an alias of `string`, `int64` or `[]rune` skips its JS conversion.

| ID | Program | Go | GoFront (all targets) |
|---|---|---|---|
| L1 | `type A = struct{ X int }; type S struct{ X int }; u := A(S{1})` | `{1}` | `Cannot call non-function type struct{...}` |
| L1c | `type L = []int; len(L(nil))` | `0` | `Cannot call non-function type []int` |
| L1d | `type F = func() int; F(g)()` | `2` | `Too many arguments: expected 0, got 1` |
| L1e | `type M = map[string]int; type P = *int; len(M(nil)), P(nil) == nil` | `0 true` | `Cannot call non-function type map[string]int` |
| L1f *sibling (review 2026-11-19)* | `type S = string; type I64 = int64; type R = []rune; fmt.Println(S(rune(65)), I64(5)+1, R("ab"))` | `A 6 [97 98]` | js/both `65` / `Cannot mix BigInt` / `Cannot call non-function type []int32`; wasm `Cannot call non-function type []int32` |
| control | `type A = G[int]` (generic alias) `A(B{3})` | `{3}` | OK |
| L2 | `type Box[T any] struct{ V T }; var c Box[struct{ X int \`json:"x"\` }]` (local) | `0` | `Parse error … expected '{' (got ] "]")` |
| L2p | same, package-level `var` | `0` | `Expected top-level declaration (got [ "[")` |
| L2h | `c := Box[struct{ X int \`json:"x"\` }]{}` | `0` | `Parse error … expected '{'` |
| L2f | `func Z[T any]() T`; `Z[struct{ X int \`json:"x"\` }]()` | `0` | `Parse error … expected '{'` |
| L2g | `Z[struct{ A [2]int }]()` | `{[0 0]}` | `Parse error … expected '{'` (`Z[[2]int]()` is a passing control) |
| L3 | `u := (struct{ A [2]int })(s)` | `{[0 0]}` | `Parse error … expected '{' (got ) ")")` |
| L3c | `([]int)(nil)` | `[]` | same |
| L3d | `new(struct{ A [2]int })` | `0` | same |
| L3e | `(map[string]int)(nil)`, `(func() int)(nil)` | `0 true` | same |
| L3p | `(*[]int)(nil)`, `(*struct{ X int })(nil)` | `true true` | same |
| L3f *sibling (review 2026-11-19)* | `var f func(); _ = (func())(f)`; `([]func())(x)`; `(func() int)(f)`; `(*map[int]int)(p)` | ok | `Expected type, got ')'` / `expected '{'` (ledger *Parenthesised conversion types*, fuzz tag `parser-conversion-type`; covered by Task 4.2) |
| L15 (ledger *Shadowed type keywords as callees*, PR #241) | `func bool() int { return 20 }; func main() { fmt.Println(bool()) }` | `20` | `Parse error: Unexpected token in expression: ')'` on all targets; root `src/parser/expressions.js:parsePrimary` parses a `TYPE_KEYWORDS` identifier followed by `(` as a `TypeConversion` without asking whether the name is a value in scope |
| L15s *sibling* | `string := func() int { return 3 }; fmt.Println(string())` | `3` | same parse error |
| L15e *sibling* | `func error() int { return 1 }; fmt.Println(error())` | `1` | same parse error |
| L15i *sibling* | `int := func(x float64) float64 { return x * 2 }; fmt.Println(int(1.5))` | `3` | `'int' declared and not used` (parsed as a conversion) |
| control | `(*p).f`, `(*T)(nil)` | `4 true` | OK |
| Go error | `([]int){1, 2}` | `syntax error: cannot parenthesize type in composite literal` | `Parse error … expected '{'` |

---

## Approach

### 1. Architecture & Design Decisions
- **Names (F2/F30/L12).** `mangleCollidingTypes` gives a package-level type a `$$pkg` suffix (keeping `%T` as `util.Box`) and is extended: in a `wasm` package, any non-alias type named in `JS_BUILTIN_CLASSES`; in a `js`/`both` package, a method-less non-struct non-alias named type in that set (the case the checker lets through). `goTypeName` formats `Name$$pkg` as `pkg.Name`. `JS_RESERVED` moves to `src/backend/shared/member-names.js` (re-exported from `src/backend/js/names.js`); `facadeName` escapes reserved words and globals, and every facade `class`/helper name (`genHandleStruct`, `outExpr`, `genIfaceFacade`, `genBothStruct`) goes through it. The PR #207 prerequisites (generated Go resolving renamed types, pruning keeping `$$` types) come first.
- **Bounds width (F19/F22).** One checked narrowing: `_emitIndexExprToI32` takes an `onOverflow` callback; for an operand that `_isI32IndexExpr` does not prove narrow it checks before `i32.wrap_i64` (or for an unsigned `i32` operand, tests `i32.lt_s 0` and zero-extends with `i64.extend_i32_u`) that the value fits (signed `i64`: sign-extending the wrapped value gives the same `i64`; unsigned `i64`: `i64.lt_u` against 2³¹) and calls the callback with the full `i64`. `emitSliceExpr` passes Go's slice-bounds panic (the `i64` reaches `__slice_bounds_panic` unwrapped), `make` passes `makeslice: len out of range` / `cap out of range` (Go's text for an unallocatable size; a WasmGC array cannot hold 2³¹ elements), and the map size hint clamps. Integer `range` whose limit is not provably narrow keeps an `i64` counter and limit with `i64.ge_u` for unsigned types and `i64.ge_s` for signed (the `i32` loop stays for `_isI32IndexExpr` limits). Unsigned `i32` operands are zero-extended (`i64.extend_i32_u`) when passed to the panic helpers, `_isI32IndexExpr` excludes unsigned types from the sign-extending `oob32` path, and the index and slice-bounds panic helpers take a signedness flag (calling a new `str_from_u64` import, `String(BigInt.asUintN(64, n))`, and skipping the negative-bound branch when unsigned) so a `uint`/`uint64` index ≥ 2⁶³ prints unsigned.
- **Panic values (F20/F21).** One runtime formatter, `__panic_text(anyref) → externref`, registered and emitted in `src/backend/wasm/index.js` and called by `emitPanicThrow` whenever no host message is passed (the `_emitScalarPanic` width switch is deleted), mirrors Go's `printpanicval` on the value's dynamic type: `error` → `Error()`, else `Stringer` → `String()`, else a boxed basic value by its box type (`bool` → `true`/`false`, unsigned widths → unsigned decimal via `str_from_u64`, floats and signed ints as today, strings unchanged), else a defined basic type as `main.T(v)` with strings quoted, else `[panic object]` (excluded). It is emitted as Go-level type assertions on the `any` (`v.(error)`, `v.(fmt.Stringer)`-shaped interface tests, then the scalar boxes and defined basic types the program panics with) through the existing interface-assertion lowering, so statically typed and interface-typed values share one path. `panic(nil)` (or a nil interface) on `wasm` panics with a synthesised runtime struct (`PANIC_NIL_STRUCT`, `Error()` = `"panic called with nil argument"`, `GofrontTypeName()` = `"*runtime.PanicNilError"`). `js`/`both` stay at `<nil>` (see *Excluded*); documented.
- **Type expressions (L1/L2/L3/L15).** Both type-argument lookaheads count `{`/`}` and reject literals only at brace depth 0 (array lengths at bracket depth > 1 stay accepted as today). In operand position (`_parsePrimary`), `(` followed by a type-literal start (`struct`, `[`, `map`, `interface`, `func` whose parameter list is not followed by a body, or `*` followed by one of these, recursively) parses a type and expects `)`; a following `(` builds the existing `TypeConversion` node (as the unparenthesised `[]int(x)`/`struct{…}(x)` forms at `expressions.js:555-604` do), and a following `{` is Go's error `cannot parenthesize type in composite literal`; `parseCall` (`new(<type literal>)`) uses the same type-literal check. A bare `*` keeps the expression path, so `(*p).f` and `(*T)(nil)` are unchanged. The conversion branch of `checkCall` keys on `expr.func._isTypeRef`: any type the callee names is a conversion checked by `_checkConversionValidity`, and `_genTypeConversionCall` (`src/backend/js/expressions.js:2124`) delegates basic, `[]rune` and array conversions to `_genTypeConversion`. For `<type keyword>(…)`, `_parsePrimary` parses an `Ident` call node and `checkCall` normalises an unshadowed 1-arg predeclared-type call back to a `TypeConversion` node checked by `_checkTypeConversion`.

### 2. Invariants & Safety Bounds
- A program that compiles and runs correctly today prints the same output, except: `$$pkg` names visible from hand-written JS (documented), and `wasm` panic texts.
- Emitted JS for programs without the affected names or shapes is byte-identical; bundle-size, zero-alloc and BCE gates unchanged. On `wasm`, bounds, `make` sizes and `range` limits that `_isI32IndexExpr` proves narrow emit the same code; only unproven `i64` operands gain the pre-wrap compare.
- `JS_BUILTIN_CLASSES` does not grow, and no type declaration that compiles today is rejected.

### 3. Edge Cases & Error Handling
- **F30:** a type renamed both by collision and by built-in name gets one `$$pkg` (no `$$util$$util`); `errors.As` into the renamed type and promoted methods survive `pruneStdlibPrograms`.
- **L12:** a struct named `yield` in a `js`/`both` package is unaffected (JS already renames it).
- **L3:** `(x)(y)` where `x` is a value stays a call, `(func() int { return 1 })()` stays a parenthesised function literal, `(*p).f` stays a selector, `(*T)(nil)` keeps working; `([]int){1, 2}` is rejected with Go's message, as `interface{…}{` already is.
- **F19r:** the `i64` `range` counter is used only when the limit is unproven; a loop variable that escapes already lives in an `i64` local and is unaffected.
- **F20:** a value implementing both `error` and `Stringer` uses `Error()` (Go's order); a panic in `Error()`/`String()` while formatting propagates as in Go (`panic: … [recovered]` text is not reproduced). `recover()` values are unchanged: only the host message changes.

---

## Implementation Tasks

> Remaining review follow-ups after the 2026-11-17 split (re-probed that day). Phase numbers restart because no task of the earlier draft had started.

### Phase 1: One JS name-escaping rule (root `js-name-collision`)
- [x] Task 1.1: Generated Go resolves renamed types through same-package, aliased and indirect imports (F30 prerequisite)
  - Files: `src/lower/gen-types.js` (`spellNamed`), `src/lower/fmt-formatters.js` (`FmtGen.isNamedInScope`), `src/link/stdlib.js` (`checkGeneratedGo`)
  - Test: `test/unit/types/shadowing.test.js` with `compileHybridProject`: `import u "./util"; fmt.Printf("%T", u.Make(5))` with a `$$`-renamed `Box` → `util.Box`; the same through a re-exporting package
  - Done when: passes (no `Unknown type 'util.Box'`)
- [x] Task 1.2: `pruneStdlibPrograms` keeps renamed user types (F30 prerequisite)
  - Files: `src/link/wasm.js` (`pruneStdlibPrograms`)
  - Test: `shadowing.test.js`: a `wasm` package and the js main both declare `Box`, the `wasm` package imports `fmt` and `errors`; `var m Box; m.N = 42`, `errors.As` into the type and a promoted method print Go's output
  - Done when: passes (fails first with the null deref from the PR #207 notes)
- [x] Task 1.3: Rename `wasm` types and method-less `js`/`both` named types after JS built-ins to `Name$$pkg` (F2, F30)
  - Files: `src/link/type-names.js` (`mangleCollidingTypes`), `src/compiler.js` (`pkgTarget` before `mangleLocalTypes`), `src/backend/shared/fmt-types.js` (`Name$$pkg` → `pkg.Name`)
  - Test: `shadowing.test.js`: F30 → `3 2` with `%T` `util.WeakMap`; `util` as `both` with `type Map int` → `3`; F2 → `5` on every target with `%T` `main.Map`; F2b → `[1] a`; a second package also declaring `WeakMap` (no `$$util$$util`); a local `type Map` still gets `__L<n>`; `type Array struct{}` rejection tests stay green
  - Done when: all pass; programs without such types emit the same JS
- [x] Task 1.4: Facade names escape strict-mode reserved words (L12)
  - Files: `src/backend/shared/member-names.js` (`JS_RESERVED`), `src/backend/js/names.js` (re-export), `src/backend/wasm/boundary.js` (`facadeName`, `genHandleStruct`, `outExpr`, `genIfaceFacade`, `genBothStruct`)
  - Test: `test/unit/wasm/boundary.test.js`: L12 → `true`; a `wasm` struct named `let` returned by an export and its method called from js main → Go's output; a method named `static` stays a passing control; `node scripts/check-layers.js` passes; `docs/go-compatibility.md` *Names that shadow JS globals* updated
  - Done when: all pass and `js-globals.test.js` passes unmodified

### Phase 2: `wasm` integers at Go width (root `wasm-bounds-width`)
- [x] Task 2.1: Checked narrowing for slice bounds and `make` sizes (F19, F19a, F19lo, F19s, F19m)
  - Files: `src/backend/wasm/emit-exprs.js` (`_emitIndexExprToI32` `onOverflow`, `emitSliceExpr`), `src/backend/wasm/emit-builtins.js` (`make` length, capacity, map hint), `src/backend/wasm/index.js` (`__slice_bounds_panic` takes the unwrapped `i64`)
  - Test: `test/unit/compiler/strict-panics.test.js`: F19, F19a, F19lo, F19s → Go's messages; F19m → `makeslice: len out of range` and `makeslice: cap out of range` on `wasm`; the 64-bit index control still passes
  - Done when: all pass on `wasm` and `both`; `bce-mathx.js` and `zero-alloc.js` pass (proven-narrow operands emit the same code)
- [x] Task 2.2: Unsigned operands print unsigned (F22a, F22b, F22s, F22u)
  - Files: `src/backend/wasm/emit-exprs.js` (`_emitSliceBoundsPanic`, `_isI32IndexExpr`), `src/backend/wasm/emit.js` (`oob32`/`oob64` handlers), `src/backend/wasm/index.js` (`emitIndexPanicBody`, `emitSliceBoundsPanicBody` signedness flag), `src/backend/wasm/module-emitter.js` + `src/backend/wasm/boundary.js` (`str_from_u64`)
  - Test: `strict-panics.test.js`: F22a, F22b, F22s and F22u → Go's messages; a negative `int` index still prints negative
  - Done when: all pass on `wasm`; `both` JS side unchanged
- [x] Task 2.3: Integer `range` over an unproven 64-bit or unsigned count (F19r)
  - Files: `src/backend/wasm/emit-stmts.js` (`emitRangeForStmt`)
  - Test: `test/unit/language/loops.test.js`: F19r → `3` (and `uint64(1)<<63` / `uint32(1)<<31` broken after 3 iterations → `3`) with `assertAllTargetsOutput`; `for i := range len(xs)` and `range 10` keep the `i32` loop (checked through the emitted WAT or `zero-alloc.js`); `docs/go-compatibility.md` runtime-panics row (64-bit and unsigned bounds, `make` sizes)
  - Done when: all pass; `bce-mathx.js` passes

### Phase 3: `wasm` panic values (root `wasm-panic-value`)
- [x] Task 3.1: One panic-text formatter for basic and defined basic values (F20 `bool`/`uint64`, F20u32, F20d)
  - Files: `src/backend/wasm/index.js` (register and emit `__panic_text`), `src/backend/wasm/emit-builtins.js` (`emitPanicThrow` calls it when no host message is passed; delete the `_emitScalarPanic` width switch)
  - Test: `test/unit/wasm/defer_recover.test.js`: exports panicking with `true`, `uint64(1)<<63`, `uint32(1)<<31`, `Str("s")`, `T(5)` and the same values held in `any` throw `Error` with Go's text (*Verified Gaps*); the float, `uint8` and string controls unchanged; `recover()` values unchanged
  - Done when: all pass
- [x] Task 3.2: `error` and `Stringer` values, static or in an interface (F20 `error`, F20m, F20g, F20i)
  - Files: `src/backend/wasm/index.js` (`__panic_text` `error`/`Stringer` arms)
  - Test: `defer_recover.test.js`: `errors.New("bad")`, `MyErr{}`, `Stringer{}`, `var v any = errors.New("bad")` and a type with both methods → `bad` / `mine` / `str` / `bad` / its `Error()`; a plain struct still `[panic object]`
  - Done when: all pass
- [x] Task 3.3: `panic(nil)` panics with `*runtime.PanicNilError` (F21, F21b, F21c)
  - Files: `src/backend/wasm/types.js` (`PANIC_NIL_STRUCT`), `src/backend/wasm/module-emitter.js` + `src/backend/wasm/index.js` (register struct and `Error()`/`GofrontTypeName()` helpers), `src/backend/wasm/emit-builtins.js` (`nil` and nil-interface arguments)
  - Test: `defer_recover.test.js`: `panic(nil)`, `var a any; panic(a)` and `var e error; panic(e)` → `*runtime.PanicNilError panic called with nil argument` on `wasm`; uncaught → `Error: panic called with nil argument`; `js`/`both` unchanged (`<nil> <nil>`); `docs/go-compatibility.md` `defer`/`recover()` row (new uncaught texts, only plain structs report `[panic object]`, `panic(nil)` on `js`/`both`)
  - Done when: all pass

### Phase 4: Types in expression position (root `type-in-expression`)
- [x] Task 4.1: Struct tags inside generic type arguments parse (L2)
  - Files: `src/parser/types.js` (`_looksLikeTypeArgListInType`), `src/parser/expressions.js` (`looksLikeTypeArgList`)
  - Test: `test/unit/parser/generics.test.js`: L2, L2p, L2h, L2f → `0` and L2g → `{[0 0]}` with `assertAllTargetsOutput` (`wasm` needs [`wasm-struct-types-plan.md`](wasm-struct-types-plan.md) Task 3.2; until it lands `assertJsTargetsOutput` with a note, which that task switches); `xs[i]` with a string index, `m["k"]`, `xs[S{1}.X]` and `Z[[2]int]()` still parse
  - Done when: all pass; existing parser generics tests green
- [x] Task 4.2: Parenthesised type literals in expressions and `new` (L3, L3f)
  - Files: `src/parser/expressions.js` (`_parsePrimary`, `parseCall`)
  - Test: `generics.test.js` (parser): L3 → `{[0 0]}`, L3c → `[]`, L3d → `0`, L3e → `0 true`, L3p → `true true`, L3f (`(func())(f)`, `([]func())(x)`, `(func() int)(f)`, `(*map[int]int)(p)`) with `assertAllTargetsOutput`; `([]int){1, 2}` → `cannot parenthesize type in composite literal` with line:col; controls `(f)(1)`, `(func() int { return 1 })()`, `(*p).f`, `(*T)(nil)` unchanged
  - Done when: all pass on every target
- [x] Task 4.3: Conversions through any type the callee names (L1, L1f)
  - Files: `src/typechecker/expressions.js` (conversion branch keys on `_isTypeRef`), `src/backend/js/expressions.js` (`_genTypeConversionCall` delegates basic, `[]rune` and array conversions to `_genTypeConversion`)
  - Test: `test/unit/types/checks.test.js`: L1 → `{1}`, L1c → `0`, L1d → `2`, L1e → `0 true`, L1f → `A 6 [97 98]` with `assertAllTargetsOutput`; generic alias control unchanged; `type A = struct{ X int }; A(1)` → `cannot convert`
  - Done when: all pass; no `Cannot call non-function type` for a type callee

### Phase 5: Type keywords that name values (root `type-in-expression`, callee side)
*Scheduled from review follow-ups (2026-11-19): ledger *Shadowed type keywords as callees*. Same decision point as Phase 4 (`_parsePrimary` choosing type or expression); lands after it.*
- [ ] Task 5.1: `_parsePrimary` parses `<type keyword>()` with zero (or >1) arguments as a call node (L15, L15s, L15e)
  - Files: `src/parser/expressions.js` (`_parsePrimary`, `TYPE_KEYWORDS`)
  - Test: `test/unit/types/shadowing.test.js`: L15 → `20`, L15s → `3`, L15e → `1` with `assertAllTargetsOutput`; `int(1.5)`, `string(rune(65))`, `[]byte("a")` still convert
  - Done when: all pass on every target; no parse error for a keyword callee with zero arguments
- [ ] Task 5.2: The checker resolves a 1-arg keyword callee to the value in scope before the predeclared type (L15i)
  - Files: `src/parser/expressions.js` (`_parsePrimary` drops the `isTypeKeyword` `TypeConversion` special case), `src/typechecker/expressions.js` (`checkCall` normalises an unshadowed 1-arg predeclared-type `CallExpr` to `TypeConversion` checked by `_checkTypeConversion`)
  - Test: `shadowing.test.js`: L15i → `3` on all targets; a package-level `func string() int` used beside `string(b)` in another package keeps the conversion there
  - Done when: passes; `'int' declared and not used` no longer reported for a called local
