# JS Names, `wasm` Panics and Type Expressions — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Holds the follow-ups split off from [`../v1.9.3/follow-ups-2026-11-16-plan.md`](../v1.9.3/follow-ups-2026-11-16-plan.md) and the 2026-11-16 ledger sweep that remain after the 2026-11-17 split by root cause. Moved out on 2026-11-17: `wasm` struct layout, type keys and rewrites (F8, F17, F24, F25, F28, F31, L5, L11, L13) → [`wasm-struct-types-plan.md`](wasm-struct-types-plan.md); file-scoped imports and qualified names (L6–L10), and on 2026-11-17 (later) export visibility (F5, F29) → [`package-scope-plan.md`](package-scope-plan.md); JS `new` of an anonymous struct (L14) → [`value-stores-plan.md`](value-stores-plan.md); local type named after an import (L4) → [`checker-go-rules-plan.md`](checker-go-rules-plan.md) Phase 8. Phase 1 needs the v1.9.3 Task 1.3 (`instanceKey`) merged (it is). Independent of the other v2.0.0 plans; start before [`incremental-builds-plan.md`](incremental-builds-plan.md), which restructures `src/compiler.js`.  
**Release note:** Types named after JavaScript built-ins such as `Map` or `WeakMap`, and WebAssembly types named after reserved words, now work; WebAssembly panics show Go's message for `panic(nil)`, `bool`, unsigned and `error` values and for large or unsigned slice bounds; and conversions through type aliases, struct tags in type arguments and parenthesised type literals now compile.  

---

## Goal

Fix the remaining review follow-ups by root cause: generated names that collide with JavaScript globals or reserved words (one escaping rule for the JS backend and the `wasm` facade), the operand width of `wasm` bounds checks, the host text of `wasm` panic values, and type expressions written in expression position. The original ledger IDs (F*, L*) are kept for traceability; every row was re-probed on 2026-11-17.

**Done means:**
- Every failing row in *Verified Gaps* prints Go 1.26's output, or gives the stated compile error with line:col, on every target its task names, each as a test in the file its task names.
- `npm test` passes, and `test/perf/zero-alloc.js`, `bce-mathx.js` and `bundle-size.js` pass with `bundle-size.baseline.json` unchanged; `test/unit/compiler/js-globals.test.js` passes unmodified apart from new names added to the escaping set.
- `docs/go-compatibility.md` (*Names that shadow JS globals*, the `defer`/`recover()` row, the runtime-panics row) describes the new behaviour.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `js-name-collision`: every generated JS identifier (package-level type classes, `wasm` facade classes and helpers) is escaped from JS globals and reserved words by one rule | F2, F30, L12 | |
| **In scope: target-specific** | Root `wasm-bounds-width`: `wasm` bounds checks compare and report operands at their Go width and signedness | F19, F22 | |
| **In scope: target-specific** | Root `wasm-panic-value`: the host message of an uncaught `wasm` panic is built from the Go value's type | F20, F21 | |
| **In scope: core** | Root `type-in-expression`: a type written where an expression is parsed (type arguments with struct tags, parenthesised type literals, alias callees) is recognised as a type | L1, L2, L3 | |
| **Excluded: deferred** | Message of an uncaught `wasm` panic whose value is a struct | `panic(P{3})` → `Error: [panic object]`; Go prints `panic: (main.P) 0x…` | Go's text holds an address, so there is no exact target; matching `js` needs a per-type formatter in the boundary. `recover()` already returns the right value |
| **Excluded: deferred** | Package-level `js`/`both` struct types, or types with methods, named after JS built-ins | `type Set int` with a method → `type Set shadows the JavaScript global Set; rename the type` | Documented clear error, not a miscompile; Phase 2 only renames the method-less case that slips past the check (F2) |
| **Excluded: runtime / platform** | Bounds checks in plain `js` packages | `xs[i]` out of range in a `js` package returns `undefined` (re-probe: `int`, `uint32`, `uint64` indexes) | Documented: only `both`/`wasm` packages panic on out-of-range indexing (`docs/go-compatibility.md`, runtime panics) |
| **Excluded: deferred** | Moved to other plans on 2026-11-17 | F8, F17, F24, F25, F28, F31, L5, L11, L13; L6–L10, F5, F29; L14; L4 | See **Related** |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6`, 2026-11-17. A throwaway driver (`.probes/ff/`, deleted) ran single-file programs with `go run` (go1.26.10, module mode) and `runProgram` (`test/unit/helpers.js:522`) on `js`/`both`/`wasm`, and multi-package projects with `compileHybridProject` (`:424`). Original evidence for each ID (2026-11-16) is in the git history of this file.

### `js-name-collision`

Root: JS identifier escaping is split. The JS backend renames value names it knows collide (`$` suffix) and the checker rejects struct types and types with methods named after JS built-ins (`_checkGlobalTypeNamesPass`, `src/typechecker/index.js:658`), but a method-less named basic type still emits `class Map`; the `wasm` facade escapes globals in `facadeName` (`src/backend/wasm/boundary.js:2237`) but not strict-mode reserved words, and its struct `class` template does not call it. `JS_RESERVED` lives in `src/backend/js/names.js`, which `wasm` may not import.

| ID | Program | Go | GoFront |
|---|---|---|---|
| F2 | `type Map int; var x Map = 5; fmt.Println(x)` | `5` | js/both `ReferenceError: Cannot access 'Map' before initialization`; wasm `5` |
| F30 | `util` (`wasm`): `type WeakMap struct{ N int }; func Make(n int) WeakMap`; js main `var z util.WeakMap; z.N = 2; fmt.Println(util.Make(3).N, z.N)` | `3 2` | `ReferenceError: Cannot access 'WeakMap' before initialization` |
| L12 | `wasm`: `type yield struct{ X int }; func (y *yield) IsNil() bool …; type Outer struct{ *yield }; var o Outer; fmt.Println(o.IsNil())` | `true` | `SyntaxError: Unexpected strict mode reserved word` |

F30 design notes (PR #207): the fix needs `mangleCollidingTypes` (`src/link/type-names.js:22`), `pruneStdlibPrograms` (`src/link/wasm.js:134`) keeping `$$` user types, and `spellNamed` (`src/lower/gen-types.js:223`), `FmtGen.isNamedInScope` (`src/lower/fmt-formatters.js:243`), `checkGeneratedGo` (`src/link/stdlib.js:569`) and `goTypeName` (`src/backend/shared/fmt-types.js:5`) resolving `util.WeakMap` for aliased and indirect imports.

### `wasm-bounds-width`

Root: `wasm` narrows 64-bit bounds to `i32` before comparing (`emitSliceExpr`/`_emitSliceBound`, `src/backend/wasm/emit-exprs.js`), and `_emitSliceBoundsPanic` (`:776`) and `_isI32IndexExpr` (`:1177`, routing `uint32` to the shared `oob32` block in `src/backend/wasm/emit.js`) sign-extend `i32` operands even when unsigned.

| ID | Program (under `recover`) | Go | `wasm` |
|---|---|---|---|
| F19 | `xs := []int{1,2,3}; n := 1 << 32; _ = xs[:n]` | `slice bounds out of range [:4294967296] with capacity 3` | `<nil>` (no panic) |
| F22a | `xs := make([]int, 3, 5); u32 := uint32(1) << 31; _ = xs[:u32]` | `slice bounds out of range [:2147483648] with capacity 5` | `[:-2147483648]` |
| F22b | same, `_ = xs[u32]` | `index out of range [2147483648] with length 3` | `[-2147483648]` |

### `wasm-panic-value`

Root: the env `panic` import (`src/backend/wasm/boundary.js:1877`) applies `String(msg)` to the host value, so the message depends on the WasmGC representation, not the Go type; `_emitBuiltinPanic` (`src/backend/wasm/emit-builtins.js:805`) passes a nil `any` through.

| ID | Program | Go | `wasm` |
|---|---|---|---|
| F20 | uncaught `panic(true)`, `panic(uint64(1) << 63)`, `panic(errors.New("bad"))` from a `wasm` export | `true` / `9223372036854775808` / `bad` | `Error: 1` / `Error: -9223372036854775808` / `Error: [panic object]` |
| F21 | `defer func() { r := recover(); fmt.Printf("%T %v\n", r, r) }(); panic(nil)` | `*runtime.PanicNilError panic called with nil argument` | `RuntimeError: illegal cast` (js/both `<nil> <nil>`, documented) |

### `type-in-expression`

Root: where the parser or checker expects an expression, a type is recognised only in the forms it was written for. The type-argument lookaheads (`_looksLikeTypeArgListInType`, `src/parser/types.js:62`; `looksLikeTypeArgList`, `src/parser/expressions.js:302`) reject any `STRING` inside the brackets, struct tags included; `parseOperand`'s `(` branch (`expressions.js:499`) parses an expression, so a parenthesised type literal fails; the conversion branch of `checkCall` (`src/typechecker/expressions.js`) accepts only `named`/`pointer`/`basic` callee types, so an alias of a composite type is called.

| ID | Program | Go | GoFront (all targets) |
|---|---|---|---|
| L1 | `type A = struct{ X int }; type S struct{ X int }; u := A(S{1})` | `{1}` | `Cannot call non-function type struct{...}` |
| L1c | `type L = []int; len(L(nil))` | `0` | `Cannot call non-function type []int` |
| L1d | `type F = func() int; F(g)()` | `2` | `Too many arguments: expected 0, got 1` |
| L2 | `type Box[T any] struct{ V T }; var c Box[struct{ X int \`json:"x"\` }]` (local) | `0` | `Parse error … expected '{' (got ] "]")` |
| L3 | `u := (struct{ A [2]int })(s)` | `{[0 0]}` | `Parse error … expected '{' (got ) ")")` |
| L3c | `([]int)(nil)` | `[]` | same |
| L3d | `new(struct{ A [2]int })` | `0` | same |

---

## Approach

### 1. Architecture & Design Decisions
- **Names (F2/F30/L12).** `mangleCollidingTypes` gives a package-level type a `$$pkg` suffix (keeping `%T` as `util.Box`) and is extended: in a `wasm` package, any non-alias type named in `JS_BUILTIN_CLASSES`; in a `js`/`both` package, a method-less non-struct non-alias named type in that set (the case the checker lets through). `goTypeName` formats `Name$$pkg` as `pkg.Name`. `JS_RESERVED` moves to `src/backend/shared/member-names.js` (re-exported from `src/backend/js/names.js`); `facadeName` escapes reserved words and globals, and every facade `class`/helper name goes through it. The PR #207 prerequisites (generated Go resolving renamed types, pruning keeping `$$` types) come first.
- **Bounds width (F19/F22).** A 64-bit bound is compared as `i64` against length/cap before narrowing; unsigned `i32` operands are zero-extended (`i64.extend_i32_u`) when passed to the panic helpers, and `_isI32IndexExpr` excludes `uint32` from the sign-extending `oob32` path.
- **Panic values (F20/F21).** The host message is built by Go type before `emitPanicThrow`: `bool` → `"true"`/`"false"`, unsigned 64-bit → unsigned decimal, `error` → its `Error()` result. `panic(nil)` (or a nil interface) on `wasm` panics with a synthesised runtime struct (`PANIC_NIL_STRUCT`, `Error()` = `"panic called with nil argument"`, `GofrontTypeName()` = `"*runtime.PanicNilError"`). `js`/`both` stay at `<nil>` (nil slices, functions and interfaces share `null` on JS); documented.
- **Type expressions (L1/L2/L3).** Both type-argument lookaheads count `{`/`}` and reject literals only at brace depth 0. In operand position, `(` followed by a type-literal start (`struct`, `[`, `map`, `func` without a body, `*`, `interface`) parses a type, expects `)`, and yields a `TypeExpr` that a following `(`/`{` turns into a conversion or composite literal; `new(<type literal>)` uses the same type parse. The conversion branch keys on `expr.func._isTypeRef`: any type the callee names is a conversion checked by `_checkConversionValidity`.

### 2. Invariants & Safety Bounds
- A program that compiles and runs correctly today prints the same output, except: `$$pkg` names visible from hand-written JS (documented), and `wasm` panic texts.
- Emitted JS for programs without the affected names or shapes is byte-identical; bundle-size, zero-alloc and BCE gates unchanged.
- `JS_BUILTIN_CLASSES` does not grow, and no type declaration that compiles today is rejected.

### 3. Edge Cases & Error Handling
- **F30:** a type renamed both by collision and by built-in name gets one `$$pkg` (no `$$util$$util`); `errors.As` into the renamed type and promoted methods survive `pruneStdlibPrograms`.
- **L12:** a struct named `yield` in a `js`/`both` package is unaffected (JS already renames it).
- **L3:** `(x)(y)` where `x` is a value stays a call, `(*p).f` stays a selector, `(*T)(nil)` keeps working.

---

## Implementation Tasks

> Remaining review follow-ups after the 2026-11-17 split (re-probed that day). Phase numbers restart because no task of the earlier draft had started.

### Phase 1: One JS name-escaping rule (root `js-name-collision`)
- [ ] Task 1.1: Generated Go resolves renamed types through same-package, aliased and indirect imports (F30 prerequisite)
  - Files: `src/lower/gen-types.js` (`spellNamed`), `src/lower/fmt-formatters.js` (`FmtGen.isNamedInScope`), `src/link/stdlib.js` (`checkGeneratedGo`)
  - Test: `shadowing.test.js` with `compileHybridProject`: `import u "./util"; fmt.Printf("%T", u.Make(5))` with a `$$`-renamed `Box` → `util.Box`; the same through a re-exporting package
  - Done when: passes (no `Unknown type 'util.Box'`)
- [ ] Task 1.2: `pruneStdlibPrograms` keeps renamed user types (F30 prerequisite)
  - Files: `src/link/wasm.js` (`pruneStdlibPrograms`)
  - Test: `shadowing.test.js`: a `wasm` package and the js main both declare `Box`, the `wasm` package imports `fmt` and `errors`; `var m Box; m.N = 42`, `errors.As` into the type and a promoted method print Go's output
  - Done when: passes (fails first with the null deref from the PR #207 notes)
- [ ] Task 1.3: Rename `wasm` types and method-less `js`/`both` named types after JS built-ins to `Name$$pkg` (F2, F30)
  - Files: `src/link/type-names.js` (`mangleCollidingTypes`), `src/compiler.js` (`pkgTarget` before `mangleLocalTypes`), `src/backend/shared/fmt-types.js` (`Name$$pkg` → `pkg.Name`)
  - Test: `shadowing.test.js`: F30 → `3 2` with `%T` `util.WeakMap`; F2 → `5` on every target with `%T` `main.Map`; a second package also declaring `WeakMap` (no `$$util$$util`); a local `type Map` still gets `__L<n>`; `type Array struct{}` rejection tests stay green
  - Done when: all pass; programs without such types emit the same JS
- [ ] Task 1.4: Facade names escape strict-mode reserved words (L12)
  - Files: `src/backend/shared/member-names.js` (`JS_RESERVED`), `src/backend/js/names.js` (re-export), `src/backend/wasm/boundary.js` (`facadeName`, struct `class` template)
  - Test: `test/unit/wasm/boundary.test.js`: L12 → `true`; a `wasm` struct named `let` or `static` with a method used from the facade; `node scripts/check-layers.js` passes; `docs/go-compatibility.md` *Names that shadow JS globals* updated
  - Done when: all pass and `js-globals.test.js` passes unmodified

### Phase 2: `wasm` bounds at Go width (root `wasm-bounds-width`)
- [ ] Task 2.1: 64-bit slice bounds are checked before narrowing (F19)
  - Files: `src/backend/wasm/emit-exprs.js` (`emitSliceExpr`, `_emitSliceBound`)
  - Test: `test/unit/compiler/strict-panics.test.js`: F19 → Go's message; string `s[:n]` with `n = 1<<32`
  - Done when: both pass; `int` bounds below 2³² emit the same code (`bce-mathx.js`)
- [ ] Task 2.2: Unsigned 32-bit bounds and indexes print unsigned (F22)
  - Files: `src/backend/wasm/emit-exprs.js` (`_emitSliceBoundsPanic`, `_isI32IndexExpr`), `src/backend/wasm/emit.js` (`oob32` callers)
  - Test: `strict-panics.test.js`: F22a and F22b → Go's messages; `docs/go-compatibility.md` runtime-panics row
  - Done when: both pass on `wasm` and `both`

### Phase 3: `wasm` panic values (root `wasm-panic-value`)
- [ ] Task 3.1: Uncaught panics carry Go's text for `bool`, unsigned and `error` values (F20)
  - Files: `src/backend/wasm/emit-builtins.js` (`_emitBuiltinPanic`/`_emitScalarPanic`), `src/backend/wasm/boundary.js` (`panic` import keeps the passed string)
  - Test: `test/unit/wasm/defer_recover.test.js`: the three F20 exports throw `Error` with `true` / `9223372036854775808` / `bad`; `recover()` values unchanged
  - Done when: all pass
- [ ] Task 3.2: `panic(nil)` panics with `*runtime.PanicNilError` (F21)
  - Files: `src/backend/wasm/types.js` (`PANIC_NIL_STRUCT`), `src/backend/wasm/module-emitter.js` (register it with `Error()` and `GofrontTypeName()`), `src/backend/wasm/emit-builtins.js` (`nil` and nil-interface arguments)
  - Test: `defer_recover.test.js`: `panic(nil)` and `var a any; panic(a)` → `*runtime.PanicNilError panic called with nil argument` on `wasm`; `js`/`both` unchanged (`<nil> <nil>`); `docs/go-compatibility.md` `defer`/`recover()` row
  - Done when: both pass

### Phase 4: Types in expression position (root `type-in-expression`)
- [ ] Task 4.1: Struct tags inside generic type arguments parse (L2)
  - Files: `src/parser/types.js` (`_looksLikeTypeArgListInType`), `src/parser/expressions.js` (`looksLikeTypeArgList`)
  - Test: `test/unit/parser/generics.test.js`: L2 at package level and as a local `var` → `0` with `assertAllTargetsOutput` (`wasm` needs `wasm-struct-types` Phase 2; until then `assertJsTargetsOutput` with a note); `xs[i]` with a string index and `m["k"]` still parse
  - Done when: all pass; existing parser generics tests green
- [ ] Task 4.2: Parenthesised type literals in expressions and `new` (L3)
  - Files: `src/parser/expressions.js`
  - Test: `generics.test.js` (parser): L3 → `{[0 0]}`, L3c → `[]`, L3d → `0` with `assertAllTargetsOutput`; controls `(f)(1)`, `(*p).f`, `(*T)(nil)` unchanged
  - Done when: all pass on every target
- [ ] Task 4.3: Conversions through any type the callee names (L1)
  - Files: `src/typechecker/expressions.js` (conversion branch keys on `_isTypeRef`)
  - Test: `test/unit/types/checks.test.js`: L1 → `{1}`, L1c → `0`, L1d → `2` with `assertAllTargetsOutput`; `type A = struct{ X int }; A(1)` → `cannot convert`
  - Done when: all pass; no `Cannot call non-function type` for a type callee
