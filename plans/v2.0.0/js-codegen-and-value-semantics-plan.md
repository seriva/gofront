# JS Codegen, Value Semantics & Checker Soundness Fixes — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-24 (`/bs-plan`): follow-ups from `checker-go-rules` (L11, L14, L29, L33), `wasm-struct-types` (L45, L46), `codegen-fixes` (L72, L78, L79), `names-panics-type-exprs` (L85, L95, L98), and `value-stores` (L106, L108). Split from [`generics-and-aliases-plan.md`](generics-and-aliases-plan.md) for phase sizing; run sequentially with it because both edit `src/typechecker/expressions.js` and `src/backend/js/{expressions,statements,runtime}.js`.  
**Release note:** Type-switch `init` statements now work on JavaScript and WebAssembly, struct self-conversions (`T(src)`) copy values, slice-to-slice conversions (`[]int(s)`) share their backing array on JavaScript, whole-struct pointer stores (`*pt = T{…}`) preserve slices of array fields, multi-level embedded fields and embedded `*Num` pointer methods work on JavaScript, and JavaScript now handles `int64`/`uint64` range loops, `int` shifts ≥ 32, and `nil` assertions to `any`/`interface{}` like Go. **Breaking:** Non-constant `const` initializers (`const C = f(5)`), non-float arguments to `complex(a, b)`, and calling a pointer-receiver method promoted from a value-embedded scalar on `both`/`wasm` are now compile errors; use `var`, convert `complex` arguments to `float64`/`float32`, or embed `*Num`.

---

## Goal

Close the remaining core language, value-semantics, JS-codegen, and checker-soundness follow-ups before v2.0.0 ships: wire type-switch `init` statements through every pipeline stage, close breaking-if-deferred checker holes (`const` initializers, `complex(a, b)`), restore Go value/sharing semantics for struct self-conversions, slice conversions, and pointer stores into structs with array fields, fix multi-level embedded selectors and embedded named-scalar pointer methods, and fix JS nil-`any` assertions, 64-bit integer range counters, and `int`/`uint` shifts ≥ 32.

**Done means:**
- Every failing row in *Verified Gaps* (J1–J9) produces Go's output across `js`, `both`, and `wasm` (`assertAllTargetsOutput` / `assertOutput`) or Go's compile error (`assertErrorContains` / reject fixtures).
- `npm test`, `npm run check`, and `npm run test:e2e` pass with zero regressions.
- `docs/go-compatibility.md` notes the `both`/`wasm` scalar-interior rule for promoted pointer-receiver methods on value-embedded scalars.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `typeswitch-init-omitted`: type-check, capture-scan, and emit `stmt.init` for `TypeSwitchStmt` across checker, lowering, JS, and WASM | `switch y := 1; x := v.(type)`, `switch side(); v.(type)`, shadowed outer `y`, closure capture of `y` | |
| **In scope: core** | Roots `const-initializer-not-checked` & `complex-builtin-nonfloat-args`: reject non-constant expressions in `const` declarations (including non-constant `len`/`cap`/`min`/`max` calls) and require floating-point operands in `complex(a, b)` | `const C = f(5)`, `const C = x`, `const C = len(s)`, `complex(1, 2)` on `int` vars, `complex(1.5, n)` | Breaking to fix after v2.0.0 |
| **In scope: core** | Roots `struct-self-conversion-no-copy`, `js-slice-conversion-copies`, `struct-deref-store-replaces-arrays`: copy structs on `T(src)` across JS & WASM, share backing arrays on JS `[]T(s)`, and copy array/nested-struct fields in place on `*pt = T{...}` and generic `*p = v` across JS & WASM | `dst := T(src)`, `G[int](gs)`, `[]int(s)`, `[]byte(b)`, `*pt = T{M: [2]int{1, 2}}` | |
| **In scope: core** | Root `js-embed-path-resolution`: resolve embedded anonymous-struct aliases and multi-level embedded structs (on both anonymous and named outer structs) in JS `_embedPath` | `type A = struct{ N int }; v.N`, `struct{ B; Y int }.A.X`, `type Named struct{ B; Y int }.A.X` | |
| **In scope: core** | Root `embedded-scalar-ptr-method`: support promoted pointer-receiver methods on `*Num` embeds across all targets and `Num` embeds on `js`; reject value-embedded scalar `o.Inc()` on `both`/`wasm` consistently with `&o.Num` / `o.Num.Inc()` | `OuterPtr{*Num}.Inc()` on `js`/`both`/`wasm`, `Outer{Num}.Inc()` on `js` | Matches existing WASM scalar-interior rule (`_isScalarInteriorOperand`) |
| **In scope: target-specific** | Roots `js-empty-iface-nil-assert`, `js-int64-range-counter`, `js-loose-wide-int-shift` (`js`/`both` only): reject `nil` on concrete and generic `any`/`interface{}` assertions, use `0n` counters for `int64`/`uint64` range loops, and use 64-bit shifts for `int`/`uint`/`uintptr` shifts (`<<`, `>>`, `<<=`, `>>=`, `__tar`) | `n.(any)`, `f[interface{}](n)`, `for i := range int64(5)`, `one << 40`, `x <<= 40` | WASM already passes all three |
| **Excluded: runtime / platform** | Value-embedded scalar pointer-receiver calls (`type Outer struct{ Num }; o.Inc()`) in `wasm` / `both` packages | `Outer{Num}.Inc()` on `wasm` | WasmGC cannot take interior pointers to scalar struct fields; rejected cleanly alongside `&o.Num` and `o.Num.Inc()` |
| **Excluded: deferred** | Cosmetic nil-assertion panic text (`interface {} is nil` vs `interface is nil`, L80) | `x := n.(B)` panic wording | Non-blocking diagnostic polish; keep separate in `plans/follow-ups.md` |

---

## Verified Gaps & Baseline Audit

**Method.** Read-only code inspection and `node --input-type=module -e` probes across `js`, `both`, and `wasm` on `main` (`dda372c4`, 2026-11-24).

### J1 `typeswitch-init-omitted` (L33, L72)
Root: `stmt.init` on `TypeSwitchStmt` is dropped at every stage:
- Checker `_checkTypeSwitchStmt` (`src/typechecker/statements.js:997-1019`) never checks `stmt.init` in `inner` or calls `_reportUnused(inner, stmt)`.
- Lowering `captures.js` (`src/lower/captures.js:113-123`) omits `walk(node.init)`.
- JS `genTypeSwitch` (`src/backend/js/statements.js:2559-2604`) ignores `stmt.init` (unlike `genSwitch` at `:2527-2532`).
- WASM `emitTypeSwitchStmt` (`src/backend/wasm/emit-stmts.js:3683-3765`) ignores `stmt.init`.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| J1.1 (L33 repro) | `switch y := 1; x := v.(type) { case int: fmt.Println(y, x) }` | `1 2` on all targets | `Undefined: 'y'` on `js`/`both`/`wasm` |
| J1.2 (L72 repro) | `switch side(); v.(type) { case int: fmt.Println("int") }` | `init\nint` on all targets | `int` (lost `init`) on `js`/`both`/`wasm` |
| J1.3 *sibling* | outer `y := 99; switch y := 10; x := v.(type) { case string: f := func() ... }` (shadowing + closure capture) | `10:hi\n99` | `99:hi\n99` on `js`/`both`/`wasm` |

### J2 `const-initializer-not-checked`, `complex-builtin-nonfloat-args` (L98, L29)
Roots:
1. `checkConstDecl` (`src/typechecker/index.js:2119-2153`) never calls `this._isConstExpr(v, scope)`. In addition, `_isConstExpr` (`src/typechecker/expressions.js:2300-2339`, lines 2331–2335) accepts any `CONST_BUILTINS` call without verifying constant arguments / `_constLen != null`.
2. `_checkBuiltinComplex` (`src/typechecker/expressions.js:3218-3252`, lines 3227, 3231) checks `!isNumeric` instead of requiring floating-point typed operands (underlying `float32`/`float64`) of identical type (while still accepting untyped numeric constants).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| J2.1 (L98 repro & siblings) | `const C = f(5)`; `var x = 5; const C1 = x`; `s := []int{1,2}; const C2 = len(s)` | `is not constant` compile error | compiles silently (`const C1 = x` throws `ReferenceError` on JS / invalid WASM) |
| J2.2 (L29 repro & sibling) | `a, b := 1, 2; complex(a, b)`; `a := 1.5; b := 2; complex(a, b)` | `expected floating-point` / mismatched types compile error | compiles on JS (`(1+2i)`); invalid WasmGC (`expected f64, found i64`) |
| control | `const A = 1+2; B = len("abc"); C = len([3]int{}); D = complex(1,2); E = real(D)`; `complex(f32, 2)`; `complex(MyF(2), MyF(2))` | passes | passes (must stay) |

### J3 `struct-self-conversion-no-copy`, `js-slice-conversion-copies`, `struct-deref-store-replaces-arrays` (L14, L95, L106)
Roots:
1. JS `_genStructClassConversion` (`src/backend/js/expressions.js:2145-2166`, line 2152) skips cloning when `srcType?.name === targetName && !targetType?.typeArgs?.length`; WASM `emitTypeConversion` (`src/backend/wasm/emit-exprs.js:3220-3233`, line 3229) skips `emitCloneStruct` when `src.typeIndex === dst.typeIndex` (affecting BOTH non-generic `T(src)` and generic `G[int](gs)`!).
2. JS `_genSliceTypeConversion` (`src/backend/js/expressions.js:3895-3936`) allocates `new Uint8Array(inner)` / `Array.from(inner)` even when `src?.kind === "slice"` (instead of returning `inner` to share the backing array).
3. JS `_storeInto` (`src/backend/js/statements.js:1207-1265`) uses `Object.assign(pt, src)` for `case "structPtr"` (`:1240`) and `case "typeParamPtr"` (`:1244`) instead of `_emitCopyInto` (`:1270-1289`) / recursive `__copyInto`; WASM `_emitStructDerefAssign` (`src/backend/wasm/emit-stmts.js:1126-1154`) overwrites array/nested-struct field refs via `struct.set` instead of calling `_emitStructFieldsInto` (`:1068-1124`).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| J3.1 (L14 repro & sibling) | `dst := T(src); dst.X = 2` and `gdst := G[int](gs); gdst.X = 2` | `1 2 1 2` on all targets | JS `2 2 1 2`; WASM `2 2 2 2` |
| J3.2 (L95 repro & sibling) | `t := []int(s); t[0] = 99`; `tb := []byte(b); tb[0] = 'Z'` | `99 99`; `Zb Zb` | JS `1 99`; `ab Zb` (WASM passes) |
| J3.3 (L106 repro & siblings) | `*pt = T{M: [2]int{1, 2}}`; nested `Outer{Inner{M}}`; generic `func set[T any](p *T, v T) { *p = v }` | `[1 2]`, `[3 4] [5 6]` | `[0 0]`, `[0 0] [0 0]` on `js`, `both`, and `wasm` |

### J4 `js-embed-path-resolution`, `embedded-scalar-ptr-method` (L45, L46, L108)
Roots:
1. JS `_embedPath` (`src/backend/js/expressions.js:1524-1548`): line 1535 skips `inner.kind === "struct"` (embedded alias of anonymous struct `type A = struct{ N int }`, L45), and lines 1538/1542–1545 check `!x.embedded` when looking for `A` inside `B`, missing multi-level embedded `v.A.X` on both anonymous `struct{ B; Y int }` and named `type Named struct{ B; Y int }` (L46).
2. `pushValueEmbedStubs` (`src/lower/embedding.js:32-38, 68-74`) skips `_ptrRecv` methods and skips pointer embeds (`*Num`), so JS `_embedStub` (`src/backend/js/index.js:1167-1188`) emits no forwarding stub for `OuterPtr{*Num}.Inc()` or `Outer{Num}.Inc()`. On `wasm`, `OuterPtr{*Num}.Inc()` already passes, while `Outer{Num}.Inc()` bypasses `_isScalarInteriorOperand` (`src/typechecker/expressions.js:578-611, 937-952`) and produces invalid WasmGC (`expected (ref null $box_Num), found i64`) in `_emitEmbeddedMethodCall` (`src/backend/wasm/emit-builtins.js:1302-1344`).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| J4.1 (L45 + L46 repro & sibling) | `type A = struct{ N int }; v.N`; `struct{ B; Y int }.A.X`; `type Named struct{ B; Y int }; v.A.X = 99` | `5 5`; `7 7 7 8`; `99 99 99` | JS `0 5`; `7 0 7 8`; `7 99 7` (WASM passes) |
| J4.2 (L108 repro & sibling) | `OuterPtr{*Num}.Inc()` on `js`/`both`/`wasm`; `Outer{Num}.Inc()` on `js`; `Outer{Num}.Inc()` on `both`/`wasm` | `11` on all targets; `1` on `js`; clear scalar-interior compile error on `both`/`wasm` | JS `o.Inc is not a function` / `op.Inc is not a function`; WASM `Outer{Num}.Inc()` invalid WasmGC (`OuterPtr` passes!) |

### J5 `js-empty-iface-nil-assert`, `js-int64-range-counter`, `js-loose-wide-int-shift` (L78, L79, L85, L11)
Roots:
1. `_typeNameCheckExpr` (`src/backend/js/expressions.js:1982-2035`) returns `"true"` for `"any"` (skipping the null check at `:1934`), and `_typeCheckForType` (`src/backend/js/type-info.js:491-507`) returns `null` for empty `interface{}` so `f[interface{}](nil)` / `f[any](nil)` evaluates `?? true` (`expressions.js:1985`).
2. `_genIntRangeFor` (`src/backend/js/statements.js:1747-1768`) emits `let v = 0` (`Number`) even when the range count is `int64`/`uint64` (`BigInt`), so `i == 3` evaluates `Number === 3n` (`false`).
3. `_genBinaryExpr` (`src/backend/js/expressions.js:3579-3582`) and `_needsStrictCompoundStmt` (`src/backend/js/statements.js:2293-2302`) gate 64-bit shifts on `this.strict`, so `js` packages emit 32-bit JS `<<`/`>>` on `int`/`uint`/`uintptr`; `__tar` (`src/backend/js/runtime.js:738`) also uses 32-bit `a << b` / `a >> b` when `bits === 0`.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| J5.1 (L78 + L79 repros & siblings) | `v, ok := n.(any)`; `f[interface{}](n)`; `f[any](n)`; single-value `n.(any)`, `fSingle[any](n)`, `fSingle[interface{}](n)` | `<nil> false`; panics on single-value | JS `<nil> true`; no panic (WASM passes) |
| J5.2 (L85 repro & sibling) | `for i := range int64(5)` and `uint64(5)` with `if i == 3` | `3 3` | JS `-1 -1` (never matches); WASM `3 3` |
| J5.3 (L11 repro & siblings) | `one << 40`, `(1 << 40) >> 40`, `x <<= 40`, `uint(1) << 40`, `(-1 << 40) >> 40`, generic `shift[int](1, 40)` on `js` | `1099511627776`, `1`, `1099511627776`, `1099511627776`, `-1` | JS `256`, `0`, `256`, `256`, `0` (`both`/`wasm` pass except generic `__tar`) |

---

## Approach

### 1. Architecture & Design Decisions
- **J1 (`TypeSwitchStmt.init`):** Check `stmt.init` in `inner` scope before `stmt.expr` and call `_reportUnused(inner, stmt)` in `src/typechecker/statements.js:_checkTypeSwitchStmt`; walk `node.init` in `src/lower/captures.js`; wrap `genTypeSwitch` in `_genScopedInit` in `src/backend/js/statements.js` (matching `genSwitch`); emit `stmt.init` inside a scoped local frame (saving/restoring shadowed outer locals after the switch) in `src/backend/wasm/emit-stmts.js:emitTypeSwitchStmt`.
- **J2 (`const` & `complex`):** Call `this._isConstExpr(v, scope)` for every initializer in `src/typechecker/index.js:checkConstDecl`, and tighten `_isConstExpr` (`src/typechecker/expressions.js`) so `CallExpr` only treats builtin calls as constant when their arguments are constant (or for `len`/`cap`, when `e._constLen != null` and the argument has no calls/side effects). In `_checkBuiltinComplex`, require both typed operands to have underlying `float32` or `float64` (identical types) and untyped operands to be numeric constants representable as float.
- **J3 (value semantics):** Remove the non-generic skip in JS `_genStructClassConversion` and the `src.typeIndex === dst.typeIndex` skip in WASM `emitTypeConversion` so `T(src)` always clones structs. In JS `_genSliceTypeConversion`, return `${inner}` directly when `src?.kind === "slice"`. In JS `_storeInto` (`structPtr` / `typeParamPtr`), use `_emitCopyInto` and a runtime `__copyInto(dst, src)` helper that recursively copies array/nested-struct fields in place; in WASM `_emitStructDerefAssign`, call `_emitStructFieldsInto(structInfo, tmpL, tmpR)`.
- **J4 (`_embedPath` & embedded scalar ptr methods):** In JS `_embedPath` (`src/backend/js/expressions.js`), allow `inner?.kind === "struct"` (embedded anonymous-struct alias) and match embedded fields in `B` (removing `!x.embedded` when looking for a promoted embedded field name `A`). In `src/lower/embedding.js` and `src/backend/js/index.js:_embedStub`, emit forwarding stubs for embedded `*Num` (value and pointer receivers, with nil check for value-recv) and for JS value-embedded `Num` (passing a getter/setter field box `{ get value() { return this.Num; }, set value(v) { this.Num = v; } }`, marked `ptrOnly: true`). In `src/typechecker/expressions.js:_markPtrRecvAddress`, reject promoted pointer-receiver methods on value-embedded scalars in `both`/`wasm` packages with the existing scalar-interior diagnostic (and document in `docs/go-compatibility.md`).
- **J5 (JS nil `any`, `int64` range, wide shifts):** Return `(${val} != null)` for `"any"` in `_typeNameCheckExpr` and `(v) => v != null` for empty `interface{}` / `any` in `_typeCheckForType` (`src/backend/js/type-info.js`). In `_genIntRangeFor` (`src/backend/js/statements.js`), emit `0n` when the range operand is 64-bit (`_is64BitInt`, plus BigInt conversion for `typeParam` if runtime `typeof n === "bigint"`). Route `<<`, `>>`, `<<=`, `>>=` on `WIDE_INT_NAMES` (`int`, `uint`, `uintptr`) through `__shl64`/`__shr64` even when `!this.strict`, and use `__shl64`/`__shr64` in `__tar` when `bits === 0`.

### 2. Invariants & Safety Bounds
- `_isConstExpr` never rejects valid Go constant expressions (`iota`, `len("abc")`, `len([3]int{})`, `complex(1, 2)`, `real(C)`, `unsafe`-free constant conversions, `min(1, 2)`).
- Slice-to-slice conversion sharing (`[]int(s)`) does not alter `[]byte(str)` or `[]rune(str)` (string → slice still allocates a new `Uint8Array` / `Int32Array`).
- `int` shift helpers in `js` packages (`__shl64` / `__shr64`) stay exact up to 2⁵³ for `int`/`uint` without slowing down non-shift arithmetic in loose `js` mode.

### 3. Edge Cases & Error Handling
- `switch y := 1; v.(type)` (no `x :=` binding) works alongside `switch y := 1; x := v.(type)` and rejects unused `y` (`declared and not used: y`).
- `OuterPtr{nil}.Inc()` passes `null` to `Num.$Inc` (matching Go nil-pointer receiver behavior); calling a value-receiver method `OuterPtr{nil}.Val()` panics on nil dereference as Go does.
- `n.(any)` on a non-nil value still succeeds; `n.(any)` on `nil` panics (single-value) or returns `<nil>, false` (comma-ok).

---

## Implementation Tasks

### Phase 1: Type-Switch `init` & Checker Soundness (roots `typeswitch-init-omitted`, `const-initializer-not-checked`, `complex-builtin-nonfloat-args`)
*Scheduled from review follow-ups (2026-11-24).*
- [ ] Task 1.1: Type-check, capture-scan, and emit `TypeSwitchStmt.init` on JS (J1.1–J1.3)
  - Files: `src/typechecker/statements.js` (`_checkTypeSwitchStmt`), `src/lower/captures.js`, `src/backend/js/statements.js` (`genTypeSwitch`)
  - Test: `test/unit/language/switches.test.js`: J1.1 (`switch y := 1; x := v.(type)`), J1.2 (`switch side(); v.(type)`), J1.3 (shadowed `y` + closure capture), and negative unused-`y` test on `js`/`both`
  - Done when: type-switch `init` variables are scoped, captured, unused-checked, and executed on `js`/`both`
- [ ] Task 1.2: Emit scoped `TypeSwitchStmt.init` on WASM (J1.1–J1.3)
  - Files: `src/backend/wasm/emit-stmts.js` (`emitTypeSwitchStmt`)
  - Test: `test/unit/language/switches.test.js`: run J1.1–J1.3 across all targets (`assertAllTargetsOutput`) including shadowed outer local restoration after the switch
  - Done when: type-switch `init` matches Go on `js`, `both`, and `wasm`
- [ ] Task 1.3: Enforce constantness of `const` initializers and builtin arguments (J2.1)
  - Files: `src/typechecker/index.js` (`checkConstDecl`), `src/typechecker/expressions.js` (`_isConstExpr`)
  - Test: `test/unit/types/checks.test.js` (or conformance reject fixtures): negative `assertErrorContains(..., "is not constant")` for `const C = f(5)`, `const C = x`, `const C = len(s)`, `const C = min(a, b)`; positive controls for `len("abc")`, `len([3]int{})`, `complex(1, 2)`, `real(D)`, `int(A)`
  - Done when: runtime calls and variables in `const` initializers are rejected on all targets while valid Go constant expressions pass
- [ ] Task 1.4: Require floating-point operands in `complex(a, b)` (J2.2)
  - Files: `src/typechecker/expressions.js` (`_checkBuiltinComplex`)
  - Test: `test/unit/types/checks.test.js`: negative `assertErrorContains` tests for `complex(intVar, intVar)`, `complex(floatVar, intVar)`, `complex(f32Var, f64Var)`; controls for `complex(1, 2)`, `complex(f32, 2)`, `complex(MyF(2), MyF(2))`
  - Done when: non-float and mismatched-float `complex(a, b)` calls fail at compile time instead of miscompiling or producing invalid WasmGC

### Phase 2: Value Semantics in Conversions & Pointer Stores (roots `struct-self-conversion-no-copy`, `js-slice-conversion-copies`, `struct-deref-store-replaces-arrays`)
- [ ] Task 2.1: Copy structs on self-conversion `T(src)` on JS/WASM and share backing array on JS `[]T(s)` (J3.1–J3.2)
  - Files: `src/backend/js/expressions.js` (`_genStructClassConversion`, `_genSliceTypeConversion`), `src/backend/wasm/emit-exprs.js` (`emitTypeConversion`)
  - Test: `test/unit/language/value-semantics.test.js` (or `test/unit/language/conversions.test.js`): J3.1 (`T(src)` and generic `G[int](gs)` copy isolation on all targets), J3.2 (`[]int(s)` and `[]byte(b)` backing-array sharing on all targets, plus `[]byte(str)` control)
  - Done when: struct self-conversions never alias and slice-to-slice conversions share backing storage on all targets
- [ ] Task 2.2: Copy array and nested-struct fields in place on `*pt = T{...}` and generic `*p = v` across JS & WASM (J3.3)
  - Files: `src/backend/js/statements.js` (`_storeInto`), `src/backend/js/runtime.js` (`__copyInto`), `src/backend/wasm/emit-stmts.js` (`_emitStructDerefAssign`)
  - Test: `test/unit/language/value-semantics.test.js`: J3.3 (`*pt = T{M: [2]int{1, 2}}` updating slice `t.M[:]`, nested `Outer{Inner{M}}`, and generic `set(&o, ...)`) on `js`, `both`, and `wasm`
  - Done when: slices of struct array fields see updates written through whole-struct pointer stores on all targets

### Phase 3: Embedded Fields & Scalar Pointer-Receiver Promotions (roots `js-embed-path-resolution`, `embedded-scalar-ptr-method`)
- [ ] Task 3.1: Fix JS `_embedPath` for embedded anonymous-struct aliases and multi-level embedded structs (J4.1)
  - Files: `src/backend/js/expressions.js` (`_embedPath`)
  - Test: `test/unit/types/embedding.test.js`: J4.1 (`type A = struct{ N int }`, anonymous `struct{ B; Y int }`, named `type Named struct{ B; Y int }` reads & writes through `v.A.X`) on `js`, `both`, `wasm`
  - Done when: embedded anonymous-struct aliases and multi-level embedded field reads/writes match Go on all targets
- [ ] Task 3.2: Support promoted pointer-receiver methods on embedded named scalars and document WASM scalar-interior rule (J4.2)
  - Files: `src/lower/embedding.js` (`pushValueEmbedStubs`), `src/backend/js/index.js` (`_embedStub`), `src/typechecker/expressions.js` (`_markPtrRecvAddress`), `docs/go-compatibility.md`
  - Test: `test/unit/types/embedding.test.js`: `OuterPtr{*Num}.Inc()` on `js`/`both`/`wasm`, `Outer{Num}.Inc()` on `js`, and negative `assertErrorContains` test for `Outer{Num}.Inc()` on `both`/`wasm`
  - Done when: `OuterPtr{*Num}` works on all targets, `Outer{Num}.Inc()` works on `js` and gives a clear compile error on `both`/`wasm`, and `docs/go-compatibility.md` notes the rule

### Phase 4: JS Nil-`any` Assertions, 64-Bit Range Counters & Shifts (roots `js-empty-iface-nil-assert`, `js-int64-range-counter`, `js-loose-wide-int-shift`)
- [ ] Task 4.1: Reject `nil` on concrete and generic empty-interface (`any` / `interface{}`) assertions in JS (J5.1)
  - Files: `src/backend/js/expressions.js` (`_typeNameCheckExpr`), `src/backend/js/type-info.js` (`_typeCheckForType`)
  - Test: `test/unit/language/interfaces.test.js`: J5.1 (comma-ok and single-value `n.(any)`, `f[interface{}](n)`, `f[any](n)` on `nil` and non-nil values) across `js`, `both`, and `wasm`
  - Done when: JS empty-interface assertions match Go/WASM on both `nil` and non-nil interfaces
- [ ] Task 4.2: Use `0n` for JS `int64`/`uint64` range loops and 64-bit shifts for JS `int`/`uint` shifts ≥ 32 (J5.2–J5.3)
  - Files: `src/backend/js/statements.js` (`_genIntRangeFor`, `_needsStrictCompoundStmt`), `src/backend/js/expressions.js` (`_genBinaryExpr`), `src/backend/js/runtime.js` (`__tar`)
  - Test: `test/unit/language/range-iter.test.js` (J5.2: `for i := range int64(5)` and `uint64(5)`), `test/unit/language/operators.test.js` (J5.3: `one << 40`, `(1 << 40) >> 40`, `x <<= 40`, `uint(1) << 40`, `(-1 << 40) >> 40`, generic `shift[int](1, 40)`) across `js`, `both`, and `wasm`
  - Done when: 64-bit integer range counters and `int`/`uint` shifts ≥ 32 match Go on `js`, `both`, and `wasm`
