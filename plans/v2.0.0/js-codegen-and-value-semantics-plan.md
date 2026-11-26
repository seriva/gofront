# JS Codegen, Value Semantics & Checker Soundness Fixes — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-24 (`/bs-plan`): follow-ups from `checker-go-rules` (L11, L14, L29, L33), `wasm-struct-types` (L45, L46), `codegen-fixes` (L72, L78, L79), `names-panics-type-exprs` (L85, L95, L98), and `value-stores` (L106, L108). Split from [`generics-and-aliases-plan.md`](generics-and-aliases-plan.md) for phase sizing; run sequentially with it because both edit `src/typechecker/expressions.js` and `src/backend/js/{expressions,statements,runtime}.js`. Reviewed 2026-11-24 (`/bs-plan review`): J1 parser root, J2/J5.3 evidence corrected, J3/J4/J5.3 siblings added, J2 split into its own phase, embedding phase moved last so its docs land in the last behaviour-changing phase, wide-int bitwise ops added to J5.3 (user decision).  
**Release note:** Type-switch `init` statements now work on JavaScript and WebAssembly, struct self-conversions (`T(src)`) copy values, slice-to-slice conversions (`[]int(s)`) share their backing array on JavaScript, whole-struct pointer stores (`*pt = v`) preserve slices of array fields, multi-level embedded fields and methods promoted from an embedded `*Num` work on every target, and JavaScript now handles `int64`/`uint64` range loops, `int` shifts and bitwise operators on values beyond 32 bits, and `nil` assertions to `any` like Go. **Breaking:** Non-constant `const` initializers (`const C = f(5)`), non-float arguments to `complex(a, b)`, and pointer-receiver methods promoted from a value-embedded scalar (`o.Inc()` with `struct{ Num }`, or `&o` as an interface needing `Inc`) on `both`/`wasm` are now compile errors; use `var`, convert `complex` arguments to `float64`/`float32`, or embed `*Num`.

---

## Goal

Close the remaining core language, value-semantics, JS-codegen, and checker-soundness follow-ups before v2.0.0 ships: wire type-switch `init` statements through every pipeline stage (parser included), close breaking-if-deferred checker holes (`const` initializers, `complex(a, b)`), restore Go value/sharing semantics for struct self-conversions, slice conversions, and pointer stores into structs with array fields, fix multi-level embedded selectors and methods promoted from embedded named scalars, and fix JS nil-`any` assertions, 64-bit integer range counters, and `int`/`uint`/`uintptr` shifts and bitwise operators beyond 32 bits.

**Done means:**
- Every failing row in *Verified Gaps* (J1–J5, siblings included) produces Go's output across `js`, `both`, and `wasm` (`assertAllTargetsOutput` / `assertOutput`) or Go's compile error (`assertErrorContains`), in the `Test:` files the tasks name.
- Every *control* row in *Verified Gaps* still passes (kept as positive tests in the same files).
- `npm test`, `npm run check`, and `npm run test:e2e` pass with zero regressions.
- `docs/go-compatibility.md` (Pointers row) names promoted pointer-receiver methods of value-embedded scalars among the `wasm`/`both` scalar-interior compile errors.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `typeswitch-init-omitted`: parse, type-check, capture-scan, and emit the `init` statement of a type switch across parser, checker, lowering, JS, and WASM | `switch y := 1; x := v.(type)`, `switch side(); v.(type)`, shadowed outer `y`, closure capture of `y`, unused `y` | |
| **In scope: core** | Roots `const-initializer-not-checked` & `complex-builtin-nonfloat-args`: reject non-constant expressions in `const` declarations (including `len`/`cap`/`min`/`max`/… calls on non-constant arguments) and require floating-point operands in `complex(a, b)` | `const C = f(5)`, `const C = x`, `const C = len(s)`, `const C = min(a, b)`, `complex(1, 2)` on `int` vars, `complex(1.5, n)` | Breaking to fix after v2.0.0 |
| **In scope: core** | Roots `struct-self-conversion-no-copy`, `js-slice-conversion-copies`, `struct-deref-store-replaces-arrays`: copy structs on `T(src)` across JS & WASM; share backing arrays on JS slice-to-slice conversions whose source's underlying or core type is a slice; copy array/nested-struct fields in place on every whole-struct store through a pointer (`*p = v` single, multi-value, tuple, generic, method receiver) across JS & WASM | `dst := T(src)`, `G[int](gs)`, `[]int(s)`, `[]int(Ints)`, `[]byte(B)`, generic `[]int(S)`, `[]rune(r)`, `*pt = T{…}`, `*pt = other`, `*t = T{…}` in a method, `*pt, n = mk()`, `set[T](p, v)` | |
| **In scope: core** | Root `js-embed-path-resolution`: resolve embedded anonymous-struct aliases and multi-level embedded structs (on both anonymous and named outer structs) in JS `_embedPath` | `type A = struct{ N int }; v.N`, `struct{ B; Y int }.AX.X`, `type Named struct{ B; Y int }.AX.X` | |
| **In scope: core** | Root `embedded-scalar-method-promotion`: methods promoted from an embedded named scalar. `*Num` embeds promote value- and pointer-receiver methods (direct calls and interface satisfaction) on all targets; value-embedded `Num` promotes pointer-receiver methods on `js` (direct and via `&o` as an interface) and is rejected on `both`/`wasm` with the scalar-interior diagnostic (direct and interface conversion) | `OuterPtr{*Num}.Inc()`, `OuterPtr{*Num}.Val()`, `var i interface{ Inc() } = OuterPtr{&x}`, `Outer{Num}.Inc()`, `var i interface{ Inc() } = &o` | Rejection matches existing WASM scalar-interior rule (`_isScalarInteriorOperand`) |
| **In scope: target-specific** | Roots `js-empty-iface-nil-assert`, `js-int64-range-counter`, `js-wide-int-bitwise` (`js`/`both` only): reject `nil` on concrete and generic `any` assertions; use `0n` counters for `int64`/`uint64` range loops; compute `<<`, `>>`, `&`, `\|`, `^`, `&^`, unary `^` (and `op=` forms, and `__tar`) on Number-backed `int`/`uint`/`uintptr` at 64 bits | `n.(any)`, `f[interface{}](n)`, `for i := range int64(5)`, `one << 40`, `x <<= 40`, `x \| 1`, `^x`, `or[int](x, 1)` | WASM already passes all three |
| **Excluded: runtime / platform** | Value-embedded scalar pointer-receiver promotions (`type Outer struct{ Num }; o.Inc()`, `&o` as `interface{ Inc() }`) in `wasm` / `both` packages | `Outer{Num}.Inc()` on `wasm` | WasmGC cannot take interior pointers to scalar struct fields; rejected cleanly alongside `&o.Num` and `o.Num.Inc()` |
| **Excluded: deferred** | Cosmetic nil-assertion panic text (`interface {} is nil` vs `interface is nil`, L80) | `x := n.(B)` panic wording | Non-blocking diagnostic polish; keep separate in `plans/follow-ups.md` |
| **Excluded: other root** | `wasm` package-level `complex128` constant in package `main` fails with `main.D: type 'complex128' is not yet supported across the wasm boundary (planned)` | `const D = complex(1, 2)` at package level, `wasm` | Boundary export of complex types, not a checker-constness root; J2 controls use function-local constants on `wasm` |

---

## Verified Gaps & Baseline Audit

**Method.** Read-only code inspection and probes (`.probes/run.mjs` → `runProgram(src, { target })` from `test/unit/helpers.js`, per target `js`, `both`, `wasm`) on `main` (`368e33bf`, 2026-11-24). Line numbers are at `368e33bf`. No Go toolchain on the host: expected values follow the Go spec.

### J1 `typeswitch-init-omitted` (L33, L72)
Root: the parser drops the type switch `init`, and no later stage handles one:
- Parser `parseSwitch` (`src/parser/statements.js:316-357`) parses `init` but returns `_parseTypeSwitchBody(assign, expr, assignNode)` (`:372-392`), whose `TypeSwitchStmt` node has no `init` field; only `SwitchStmt` keeps it (`:356`).
- Checker `_checkTypeSwitchStmt` (`src/typechecker/statements.js:997-1019`) never checks an `init` in `inner` or calls `_reportUnused(inner, stmt)` (cf. `SwitchStmt` at `:778`).
- Lowering `captures.js` (`src/lower/captures.js:113-123`) walks only `node.expr` and the clauses.
- JS `genTypeSwitch` (`src/backend/js/statements.js:2559-2604`) has no `_genScopedInit` (unlike `genSwitch` at `:2530`).
- WASM `emitTypeSwitchStmt` (`src/backend/wasm/emit-stmts.js:3683`) has no `init` handling.
- Siblings already handling `init` once the node carries it: `init-order.js` `walkSwitch` (`:130-140`, shared with `SwitchStmt`), `lower/bounds.js` and `backend/js/index.js` rename walkers (generic child walk). `RECEIVER_STEP.TypeSwitchStmt` (`src/backend/js/expressions.js:94`) reads only `s.expr`; it must include `s.init` like `SwitchStmt` (`:93`).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| J1.1 (L33 repro) | `switch y := 1; x := v.(type) { case int: fmt.Println(y, x) }` | `1 2` on all targets | `Undefined: 'y'` on `js`/`both`/`wasm` |
| J1.2 (L72 repro) | `switch side(); v.(type) { case int: fmt.Println("int") }` | `init\nint` on all targets | `int` (lost `init`) on `js`/`both`/`wasm` |
| J1.3 *sibling* | outer `y := 99; switch y := 10; x := v.(type) { case string: f := func() string { return fmt.Sprint(y, ":", x) } … }; fmt.Println(y)` | `10:hi\n99` | `99:hi\n99` on `js`/`both`/`wasm` |
| J1.4 *sibling* | `switch y := 1; v.(type) { case int: }` | `declared and not used: y` | compiles, prints nothing, on `js`/`both`/`wasm` |

### J2 `const-initializer-not-checked`, `complex-builtin-nonfloat-args` (L98, L29)
Roots:
1. `checkConstDecl` (`src/typechecker/index.js:2122-2158`) never calls `this._isConstExpr(v, scope)`. In addition, `_isConstExpr` (`src/typechecker/expressions.js:2300-2339`, `CallExpr` branch `:2328-2335`) accepts any `CONST_BUILTINS` (`:3545`) call without checking its arguments are constant (or `_constLen != null` for `len`/`cap`).
2. `_checkBuiltinComplex` (`src/typechecker/expressions.js:3218-3252`, `:3227`, `:3231`) checks `!isNumeric` instead of requiring floating-point typed operands (underlying `float32`/`float64`); a typed `int` operand falls through to `COMPLEX128` (`:3251`).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| J2.1 (L98 repro & siblings) | `const C = f(5)`; `var x = 5; const C1 = x`; `s := []int{1,2}; const C2 = len(s)`; `a, b := 1, 2; const C3 = min(a, b)` | `is not constant` compile error | compiles and prints the runtime value (`5`, `5`, `2`, `1`) on `js`/`both`/`wasm` |
| J2.2 (L29 repro & sibling) | `a, b := 1, 2; complex(a, b)`; `a := 1.5; b := 2; complex(a, b)` | `expected floating-point` / mismatched types compile error | `js`/`both` print `(1+2i)` / `(1.5+2i)`; `wasm` invalid WasmGC (`struct.new[0] expected type f64, found local.get of type i64`) |
| control | `const A = 1+2; B = len("abc"); C = len([3]int{}); D = complex(1,2); E = real(D); F = min(1, 2); G = int(A)`; `var arr [3]int; const L = len(arr)`; `complex(f32, 2)`; `complex(MyF(2), MyF(2))` | passes | passes on `js`/`both` (must stay); on `wasm` only as function-local consts (package-level `D` hits the excluded boundary row) |
| control | `complex(f32Var, f64Var)` | `mismatched float types` | already rejected on all targets (`:3239-3245`) |

### J3 `struct-self-conversion-no-copy`, `js-slice-conversion-copies`, `struct-deref-store-replaces-arrays` (L14, L95, L106)
Roots:
1. JS `_genStructClassConversion` (`src/backend/js/expressions.js:2156-2176`, `:2163`) returns `null` (no clone) when `srcType?.name === targetName && !targetType?.typeArgs?.length`; WASM `emitTypeConversion` (`src/backend/wasm/emit-exprs.js:3195`, `:3229`) clones only when `src.typeIndex !== dst.typeIndex` (so both non-generic `T(src)` and generic `G[int](gs)` alias).
2. JS `_genSliceTypeConversion` (`src/backend/js/expressions.js:3906-3947`) allocates `new Uint8Array(inner)` / `new <TypedArray>(inner)` / `Array.from(inner)` even when the source is already a slice. Its source test `this._underlyingOf(expr.expr._type)` (`:3915`) is `slice` for named sources but not for a type parameter with a slice core type. A named-slice **target** (`Ints(s)`) takes another path and already shares (control).
3. JS `_storeInto` (`src/backend/js/statements.js:1235-1265`) emits `Object.assign(ptr, src)` for `structPtr` (`:1240`) and `typeParamPtr` (`:1244`) instead of the recursive in-place copy `_emitCopyInto` (`:1270-1289`) that `stable` targets use. The `structPtr` target carries no type: built by `_storeTarget` (`:1207`) and directly by `_genMultiAssignViaTemps` (`:1319`, multi-value `*p, n = …`). WASM `_emitStructDerefAssign` (`src/backend/wasm/emit-stmts.js:1126-1154`) overwrites array/nested-struct field refs via `struct.set` instead of `_emitStructFieldsInto` (`:1068-1124`); `_emitDerefAssign` (`:1166`) routes every `*p` store (single, multi, method receiver) there.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| J3.1 (L14 repro & siblings) | `dst := T(src); dst.X = 2` and `gdst := G[int](gs); gdst.X = 2` | `1 2 1 2` on all targets | `js`/`both` `2 2 1 2`; `wasm` `2 2 2 2` |
| J3.1 control | `u := U(src)` (distinct type, same fields) | `1 2` | passes on all targets |
| J3.2 (L95 repro & siblings) | `t := []int(s); t[0] = 99`; `tb := []byte(b); tb[0] = 'Z'`; `type Ints []int; []int(n)`; `type B []byte; []byte(B)`; `func conv[S ~[]int](s S) []int { return []int(s) }`; `r2 := []rune(r)` | writes visible through the source (`99 99`, `Zb Zb`, `9`, `Zb`, `8`, `Xé`) | `js`/`both`: source unchanged (`1 99`, `ab Zb`, `1`, `ab`, `2`, `hé`); `wasm` passes |
| J3.2 control | `Ints(s)` (named target); `[]byte(str)` | shares; copies | passes on all targets (must stay) |
| J3.3 (L106 repro & siblings) | `s := t.M[:]` then `*pt = T{M: [2]int{1, 2}}`; nested `Outer{In: Inner{M}}`; generic `func set[V any](p *V, v V) { *p = v }`; `*pt = other`; `func (t *T) reset() { *t = T{…} }`; `p := &arr[0]; *p = T{…}`; `*pt, n = mk()`; `*pu, n = T{…}, 6` | slice sees the new array (`[1 2]`, `[3 4]`, `[5 6]`, `[4 5]`, `[8 9]`, `[6 7]`, `[1 2] 3`, `[4 5] 6`) | `[0 0]` for every case on `js`/`both`/`wasm` |
| J3.3 control | `t = T{…}`, `w.In = T{…}`, `a = [2]int{…}` (no pointer) | slice sees the new array | passes on all targets |

### J4 `js-embed-path-resolution`, `embedded-scalar-method-promotion` (L45, L46, L108)
Roots:
1. JS `_embedPath` (`src/backend/js/expressions.js:1531-1555`): `:1542` skips embeds whose type is not a named struct in `structNames` (embedded alias of anonymous struct `type A = struct{ N int }`, L45), and the inner lookup (`:1547-1551`) tests `!x.embedded` when looking for `AX` inside `B`, missing multi-level embedded `v.AX.X` on anonymous `struct{ B; Y int }` and named `type Named struct{ B; Y int }` (L46).
2. `computeEmbeddedStubs` (`src/lower/embedding.js:40-…`) skips embedded named non-struct types behind a pointer (`:69-73`, `if (rawEmbed.kind !== "pointer")`), and `pushValueEmbedStubs` (`:32-38`) skips `_ptrRecv` methods, so JS `_embedStub` (`src/backend/js/index.js:1167-1188`) emits no stub for `*Num` (any method) or for `Num`'s pointer-receiver methods. Interface satisfaction on JS uses the same stubs.
3. WASM: a value-receiver method reached through an embedded `*Num` never unwraps the scalar box. Direct call: `_emitEmbeddedMethodCall` (`src/backend/wasm/emit-builtins.js:1302-1344`) ends the chain with `_emitNilBranch()` (`:1333`) and calls with the box ref. Itable: the promoted candidate (`src/backend/wasm/module-emitter.js:1461`) sets `needsValueDeref` with `structInfo: embedSInfo` (null for a scalar), and `src/backend/wasm/emit.js:1476` derefs only when `cand.structInfo` is set.
4. Checker: value-embedded `Num` pointer-receiver promotion (`o.Inc()`) bypasses `_isScalarInteriorOperand` (`src/typechecker/expressions.js:578-611`) in `_markPtrRecvAddress` (`:937-952`; `expr.expr` is `o`, not the scalar field), and `implements` (`src/typechecker/assignability.js:1914-1944`) has no `wasm`/`both` rule for `&o` reaching a scalar-interior pointer method, producing invalid WasmGC.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| J4.1 (L45 + L46 repro & sibling) | `type A = struct{ N int }; v.N, v.A.N`; `struct{ B; Y int }`: `w.X, w.AX.X, w.B.AX.X, w.Y`; `type Named struct{ B; Y int }; n.AX.X = 99; n.X, n.AX.X, n.B.X` | `5 5`; `7 7 7 8`; `99 99 99` | `js`/`both` `0 5`; `7 0 7 8`; `7 99 7` (`wasm` passes) |
| J4.2 (L108 repro & siblings, `*Num`) | `op := OuterPtr{&x}; op.Inc()` (x=10); `op.Val()` and `(&OuterPtr{&x}).Val()`; `var i interface{ Inc() } = OuterPtr{&x}; i.Inc()`; `var i interface{ Val() int } = OuterPtr{&x}` | `11`; `3`; `4`; `3` on all targets | `js`/`both` `… is not a function` for all; `wasm`: `Inc` direct and via interface pass, `Val` direct invalid WasmGC (`call[0] expected type i64, found br_on_null of type (ref 43)`), `Val` via interface invalid (`expected type i64, found local.get of type (ref null 42)`) |
| J4.3 (L108 sibling, value-embedded `Num`) | `var o Outer; o.Inc()`; `var i interface{ Inc() } = &o; i.Inc()` | `1` on `js`; scalar-interior compile error on `both`/`wasm` | `js` `o.Inc is not a function` / `i.Inc is not a function`; `both` same at run time; `wasm` invalid WasmGC (`call[0] expected type (ref null 166), found struct.get of type i64`) |
| J4 control | `Outer{Num}`: `o.Val()`; `var j interface{ Val() int } = Outer{4}` | `4`; `4` | passes on all targets (must stay) |

### J5 `js-empty-iface-nil-assert`, `js-int64-range-counter`, `js-wide-int-bitwise` (L78, L79, L85, L11)
Roots:
1. `_typeNameCheckExpr` (`src/backend/js/expressions.js:1993-…`) returns `"true"` for `"any"` (skipping the null check), and `_typeCheckForType` (`src/backend/js/type-info.js:491-507`) returns `null` for empty `interface{}`, so a generic `f[interface{}]` / `f[any]` evaluates `(factory?.is?.(v) ?? true)` (`expressions.js:1996`). Literal `n.(interface{})` and a defined empty interface already reject `nil` (controls).
2. `_genIntRangeFor` (`src/backend/js/statements.js:1747-1768`) emits `let v = 0` / `let __i = 0` (`Number`) even when the range count is `int64`/`uint64` (`BigInt`), so `i == 3` compares `Number === 3n` (`false`).
3. Number-backed wide ints (`int`, `uint`, `uintptr`; `WIDE_INT_NAMES` at `src/backend/js/expressions.js:215`) use 32-bit JS bitwise operators:
   - `_needsStrictOp` (`:4098-4110`) routes only `<<`/`>>` of wide Number types to the 64-bit path, never `&`, `|`, `^`, `&^`, and `_genBinaryExpr` (`:3591`) and `_needsStrictCompoundStmt` (`src/backend/js/statements.js:2293-2302`) consult it only when `this.strict`, so `js` packages also shift at 32 bits.
   - Unary `^` emits JS `~` (`:1319`).
   - `__tar` (`src/backend/js/runtime.js:688-…`) uses `a & b` / `a | b` / `a ^ b` / `a & ~b` (`:731-734`) and `a << b` / `a >> b` (`:738`) when `bits === 0`.
   - The 64-bit Number shift helpers `__shl64` / `__shr64` already exist (`runtime.js:589-617`); there is no Number-safe `&`/`|`/`^` helper.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| J5.1 (L78 + L79 repros & siblings) | `v, ok := n.(any)`; `f[interface{}](n)`; `f[any](n)` (comma-ok, `n` nil); single-value `_ = n.(any)` under `recover` | `<nil> false` ×3; panics | `js`/`both` `<nil> true` ×3; no panic (`wasm` passes) |
| J5.1 control | `m.(any)` non-nil; `n.(interface{})`; `type E interface{}; n.(E)` | `3 true`; `<nil> false`; `<nil> false` | passes on all targets |
| J5.2 (L85 repro & siblings) | `for i := range int64(5)`, `range uint64(5)`, `var n int64 = 4; for i := range n`, each with `if i == k` | `3 3 2` | `js`/`both` `-1 -1 -1` (never matches); `wasm` passes |
| J5.3 (L11 repro & shift siblings) | `one << 40`; `x := 1; x <<= 40`; `uint(1) << 40`; `var p uintptr = 1; p << 40`; `y := 1 << 41; y >>= 40`; generic `shift[int](1, 40)` | `1099511627776` ×4; `2`; `1099511627776` | `js`: `256` ×4, `0`, `256`; `both`: all pass except generic `256` (`__tar`); `wasm` passes |
| J5.3 (bitwise siblings) | `x := 1099511627776`: `x\|1`, `x&x`, `x^1`, `^x`; generic `or[int](x, 1)`, `and[int](x, x)`; `y := x; y \|= 1` | `1099511627777 1099511627776 1099511627777 -1099511627777`; `1099511627777 1099511627776`; `1099511627777` | `js` **and** `both`: `1 0 1 -1`; `1 0`; `1`; `wasm` passes |
| J5.3 control | `(one << 40) >> 40`; `m := -1; (m << 40) >> 40` | `1`; `-1` | correct on `js` only by coincidence (32-bit `<<40` = `<<8`, then `>>8`); keep as regression tests |

---

## Approach

### 1. Architecture & Design Decisions
- **J1 (`TypeSwitchStmt.init`):** Thread `init` from `parseSwitch` into `_parseTypeSwitchBody` (`init` field on the node). Check `stmt.init` in `inner` scope before `stmt.expr` and call `_reportUnused(inner, stmt)` in `_checkTypeSwitchStmt`; walk `node.init` inside the outer `scoped` in `src/lower/captures.js`; add `s.init` to `RECEIVER_STEP.TypeSwitchStmt`; wrap `genTypeSwitch` in `_genScopedInit` (matching `genSwitch`); emit `stmt.init` inside a scoped local frame (shadowed outer locals restored after the switch) in WASM `emitTypeSwitchStmt`.
- **J2 (`const` & `complex`):** Call `this._isConstExpr(v, scope)` for every initializer in `checkConstDecl` (error `<expr> (value of type T) is not constant`), and tighten the `_isConstExpr` `CallExpr` branch so a builtin call is constant only when its arguments are constant, or for `len`/`cap` when `e._constLen != null`. In `_checkBuiltinComplex`, require each typed operand's underlying type to be `float32` or `float64` (identical types), and untyped operands to be numeric constants representable as float.
- **J3 (value semantics):** Remove the non-generic same-name skip in JS `_genStructClassConversion` and the `typeIndex` equality skip in WASM `emitTypeConversion` so `T(src)` always clones structs. In JS `_genSliceTypeConversion`, return `inner` when the source's underlying type, or a type parameter's core type, is a slice (keeps the string → slice copies). Give the JS `structPtr` target its struct type (in `_storeTarget` and in the `derefs` of `_genMultiAssignViaTemps`) and emit `_emitCopyInto`; for `typeParamPtr` call a runtime `__copyInto(dst, src)` helper that recursively copies array / nested-struct fields in place. In WASM `_emitStructDerefAssign`, call `_emitStructFieldsInto(structInfo, tmpL, tmpR)` (copying from a fresh value when `r` is not a composite literal).
- **J4 (`_embedPath` & embedded scalar methods):**
  - In JS `_embedPath`, accept an embed whose resolved type is an anonymous struct (alias), and look for the promoted embedded field name (`AX`) among embedded fields of `B` too.
  - In `src/lower/embedding.js`, emit stubs for embedded `*Num` (value and pointer receivers, nil check before a value-receiver call) and for pointer-receiver methods of value-embedded `Num` on `js` packages. `_embedStub` passes a field box `{ get value() { return this.Num; }, set value(v) { this.Num = v; } }` to a pointer-receiver method of a value embed.
  - In WASM, after the last `*Num` link unwrap the scalar box (`struct.get $box_Num 0`) before a value-receiver call, in `_emitEmbeddedMethodCall` and in the itable dispatcher (give the candidate the box type so `emit.js:1476` derefs it).
  - In the checker, on `both`/`wasm` reject a pointer-receiver method promoted from a value-embedded scalar with the existing scalar-interior diagnostic: on a call or method value (`_markPtrRecvAddress`) and on an interface conversion of `*Outer` (`implements` / its caller's diagnostic).
- **J5 (JS nil `any`, `int64` range, wide ints):**
  - Return `(${val} != null)` for `"any"` in `_typeNameCheckExpr`, and `(v) => v != null` for empty `interface{}` / `any` in `_typeCheckForType`.
  - In `_genIntRangeFor`, emit `0n` counters when the range operand is 64-bit (`_is64BitInt`), plus a `typeof n === "bigint"` start for a `typeParam` count.
  - For Number-backed `int`/`uint`/`uintptr`, make `_needsStrictOp` return true for `<<`, `>>`, `&`, `|`, `^`, `&^` whether or not `this.strict`, and route them through `__shl64` / `__shr64` and a new Number-safe `__bit64(op, a, b, unsigned)` helper (fast path when both operands are in the 32-bit signed range). Unary `^x` becomes `-x - 1` on signed and `__bit64` on unsigned types. `__tar` uses the same helpers when `bits === 0`.

### 2. Invariants & Safety Bounds
- `_isConstExpr` never rejects valid Go constant expressions (`iota`, `len("abc")`, `len([3]int{})`, `len(arrVar)`, `complex(1, 2)`, `real(C)`, constant conversions, `min(1, 2)`).
- Slice-to-slice conversion sharing (`[]int(s)`) does not alter `[]byte(str)` or `[]rune(str)` (string → slice still allocates).
- The `wasm` path for `*Num` pointer-receiver promotion (`Inc` direct and via interface), which already passes, stays green.
- Wide-int bitwise helpers keep `int8…int32`/`uint8…uint32` (`bits !== 0`) on their existing 32-bit paths, and are exact for `int`/`uint` within ±2⁵³ (the documented Number range of `int` in JS).

### 3. Edge Cases & Error Handling
- `switch y := 1; v.(type)` (no `x :=` binding) works alongside `switch y := 1; x := v.(type)` and rejects unused `y` (`declared and not used: y`).
- `OuterPtr{nil}.Inc()` passes `null` to `Num.$Inc` (Go nil-pointer receiver, panics on `*n++`); `OuterPtr{nil}.Val()` panics on nil dereference as Go does, on every target.
- `n.(any)` on a non-nil value still succeeds; `n.(any)` on `nil` panics (single-value) or returns `<nil>, false` (comma-ok).
- `^x` and `x &^ y` on negative `int` values match Go's two's-complement results (`^-1 == 0`, `-1 &^ 1 == -2`).

---

## Implementation Tasks

### Phase 1: Type-Switch `init` (root `typeswitch-init-omitted`)
*Scheduled from review follow-ups (2026-11-24).*
- [x] Task 1.1: Parse and type-check `TypeSwitchStmt.init` (J1.1, J1.4)
  - Files: `src/parser/statements.js` (`parseSwitch`, `_parseTypeSwitchBody`), `src/typechecker/statements.js` (`_checkTypeSwitchStmt`)
  - Test: `test/unit/language/switches.test.js`: J1.1 compiles (no `Undefined: 'y'`) and J1.4 `assertErrorContains(…, "declared and not used: y")`, plus a parser test that the node carries `init`
  - Done when: the type switch `init` is in the AST, its names resolve in every clause, and an unused `init` variable is reported
- [x] Task 1.2: Capture-scan and emit `TypeSwitchStmt.init` on JS (J1.1–J1.3)
  - Files: `src/lower/captures.js`, `src/backend/js/statements.js` (`genTypeSwitch`), `src/backend/js/expressions.js` (`RECEIVER_STEP.TypeSwitchStmt`)
  - Test: `test/unit/language/switches.test.js`: J1.1, J1.2, J1.3 (shadowed `y` + closure capture) with `assertOutput(…, { targets: ["both", "js"] })`
  - Done when: type switch `init` runs once, before the switch expression, with its own scope and closure captures, on `js`/`both`
- [x] Task 1.3: Emit scoped `TypeSwitchStmt.init` on WASM (J1.1–J1.3)
  - Files: `src/backend/wasm/emit-stmts.js` (`emitTypeSwitchStmt`)
  - Test: `test/unit/language/switches.test.js`: J1.1–J1.3 with `assertAllTargetsOutput`, including the shadowed outer `y` printed after the switch
  - Done when: type switch `init` matches Go on `js`, `both`, and `wasm`

### Phase 2: Checker Soundness (roots `const-initializer-not-checked`, `complex-builtin-nonfloat-args`)
- [x] Task 2.1: Enforce constantness of `const` initializers and builtin arguments (J2.1)
  - Files: `src/typechecker/index.js` (`checkConstDecl`), `src/typechecker/expressions.js` (`_isConstExpr`)
  - Test: `test/unit/types/checks.test.js`: `assertErrorContains(…, "is not constant")` for `const C = f(5)`, `const C = x`, `const C = len(s)`, `const C = min(a, b)`; positive controls from the J2 control row (`len("abc")`, `len([3]int{})`, `len(arrVar)`, `complex(1, 2)`, `real(D)`, `min(1, 2)`, `int(A)`), function-local on `wasm`
  - Done when: runtime calls and variables in `const` initializers are rejected on all targets while valid Go constant expressions pass
- [x] Task 2.2: Require floating-point operands in `complex(a, b)` (J2.2)
  - Files: `src/typechecker/expressions.js` (`_checkBuiltinComplex`)
  - Test: `test/unit/types/checks.test.js`: `assertErrorContains` for `complex(intVar, intVar)` and `complex(floatVar, intVar)`; controls `complex(1, 2)`, `complex(f32, 2)`, `complex(MyF(2), MyF(2))`, and the existing `complex(f32Var, f64Var)` mismatch error
  - Done when: non-float `complex(a, b)` calls fail at compile time instead of miscompiling or producing invalid WasmGC

### Phase 3: Value Semantics in Conversions & Pointer Stores (roots `struct-self-conversion-no-copy`, `js-slice-conversion-copies`, `struct-deref-store-replaces-arrays`)
- [x] Task 3.1: Copy structs on self-conversion `T(src)` on JS/WASM and share the backing array on JS slice-to-slice conversions (J3.1–J3.2)
  - Files: `src/backend/js/expressions.js` (`_genStructClassConversion`, `_genSliceTypeConversion`), `src/backend/wasm/emit-exprs.js` (`emitTypeConversion`)
  - Test: `test/unit/language/value-semantics.test.js`: J3.1 (`T(src)`, generic `G[int](gs)`, control `U(src)`) and J3.2 (`[]int(s)`, `[]byte(b)`, `[]int(Ints)`, `[]byte(B)`, generic `[]int(S)`, `[]rune(r)`; controls `Ints(s)`, `[]byte(str)`) with `assertAllTargetsOutput`
  - Done when: struct self-conversions never alias and slice-to-slice conversions share backing storage on all targets
- [x] Task 3.2: Copy array and nested-struct fields in place on every whole-struct store through a pointer, JS & WASM (J3.3)
  - Files: `src/backend/js/statements.js` (`_storeTarget`, `_storeInto`, `_genMultiAssignViaTemps`), `src/backend/js/runtime.js` (`__copyInto`), `src/backend/wasm/emit-stmts.js` (`_emitStructDerefAssign`)
  - Test: `test/unit/language/value-semantics.test.js`: every J3.3 row (`*pt = T{…}`, nested `Outer{Inner{M}}`, generic `set`, `*pt = other`, method `*t = T{…}`, `*p` on `&arr[0]`, `*pt, n = mk()`, `*pu, n = T{…}, 6`) plus the J3.3 control row, with `assertAllTargetsOutput`
  - Done when: slices of struct array fields see updates written through any whole-struct pointer store on all targets

### Phase 4: JS Nil-`any` Assertions, 64-Bit Range Counters & Wide-Int Bitwise Ops (roots `js-empty-iface-nil-assert`, `js-int64-range-counter`, `js-wide-int-bitwise`)
- [x] Task 4.1: Reject `nil` on concrete and generic `any` / `interface{}` assertions in JS (J5.1)
  - Files: `src/backend/js/expressions.js` (`_typeNameCheckExpr`), `src/backend/js/type-info.js` (`_typeCheckForType`)
  - Test: `test/unit/language/interfaces.test.js`: J5.1 rows and controls (comma-ok and single-value `n.(any)`, `f[interface{}](n)`, `f[any](n)` on `nil` and non-nil values) with `assertAllTargetsOutput`
  - Done when: JS empty-interface assertions match Go/WASM on both `nil` and non-nil interfaces
- [x] Task 4.2: Use `0n` counters for JS `int64`/`uint64` range loops (J5.2)
  - Files: `src/backend/js/statements.js` (`_genIntRangeFor`)
  - Test: `test/unit/language/range-iter.test.js`: J5.2 (`range int64(5)`, `range uint64(5)`, `range n` with `n int64`, and a generic `range` over a `T ~int64` count) with `assertAllTargetsOutput`
  - Done when: 64-bit integer range counters compare and print like Go on `js`, `both`, and `wasm`
- [x] Task 4.3: 64-bit shifts and bitwise operators for Number-backed `int`/`uint`/`uintptr` in JS (J5.3)
  - Files: `src/backend/js/expressions.js` (`_needsStrictOp`, `_genBinaryExpr`, `_genStrictBinary`, unary `^`), `src/backend/js/statements.js` (`_needsStrictCompoundStmt`), `src/backend/js/runtime.js` (`__bit64`, `__tar`)
  - Test: `test/unit/language/operators.test.js`: every J5.3 row (shift, bitwise, compound, generic, and the coincidence controls), plus `int8`/`uint32` wraparound controls, with `assertAllTargetsOutput`
  - Done when: `<<`, `>>`, `&`, `|`, `^`, `&^`, unary `^` and their `op=` forms on `int`/`uint`/`uintptr` match Go on `js`, `both`, and `wasm`

### Phase 5: Embedded Fields & Scalar Method Promotions (roots `js-embed-path-resolution`, `embedded-scalar-method-promotion`)
- [x] Task 5.1: Fix JS `_embedPath` for embedded anonymous-struct aliases and multi-level embedded structs (J4.1)
  - Files: `src/backend/js/expressions.js` (`_embedPath`)
  - Test: `test/unit/types/embedding.test.js`: J4.1 (`type A = struct{ N int }`, anonymous `struct{ B; Y int }`, named `type Named struct{ B; Y int }` reads & writes through `v.AX.X`) with `assertAllTargetsOutput`
  - Done when: embedded anonymous-struct aliases and multi-level embedded field reads/writes match Go on all targets
- [x] Task 5.2: JS stubs for methods promoted from embedded named scalars (J4.2, J4.3 on `js`)
  - Files: `src/lower/embedding.js` (`computeEmbeddedStubs`, `pushValueEmbedStubs`), `src/backend/js/index.js` (`_embedStub`, `_embedStubCall`)
  - Test: `test/unit/types/embedding.test.js`: J4.2 (`*Num`: `Inc`, `Val`, both via interface) with `assertOutput(…, { targets: ["both", "js"] })`; J4.3 (`o.Inc()`, `&o` as `interface{ Inc() }`) on `js` only; J4 control row on all targets
  - Done when: `*Num` promoted methods (direct and via interface) work on `js`/`both`, and `Num` pointer-receiver promotions work on `js`
- [x] Task 5.3: Unwrap the scalar box for value-receiver methods promoted through `*Num` on WASM (J4.2 `wasm`)
  - Files: `src/backend/wasm/emit-builtins.js` (`_emitEmbeddedMethodCall`), `src/backend/wasm/module-emitter.js` (promoted candidates), `src/backend/wasm/emit.js` (itable value deref)
  - Test: `test/unit/types/embedding.test.js`: all J4.2 rows with `assertAllTargetsOutput` (the already-passing `Inc` rows stay green)
  - Done when: `OuterPtr{*Num}` `Val` and `Inc`, direct and via interface, match Go on `js`, `both`, and `wasm` and the module validates
- [ ] Task 5.4: Reject pointer-receiver promotions from value-embedded scalars on `both`/`wasm` and document the rule (J4.3 `both`/`wasm`)
  - Files: `src/typechecker/expressions.js` (`_markPtrRecvAddress`), `src/typechecker/assignability.js` (`implements` / conversion diagnostic), `docs/go-compatibility.md` (Pointers row; mirror the sentence in `docs/hybrid-wasm.md` § Pointers in `wasm` and `both` packages)
  - Test: `test/unit/types/embedding.test.js`: `assertErrorContains` with the scalar-interior message for `o.Inc()`, `o.Inc` (method value), and `var i interface{ Inc() } = &o` in `both` and `wasm` packages; the same programs still compile on `js`
  - Done when: J4.3 programs are rejected on `both`/`wasm` with the scalar-interior diagnostic (no invalid WasmGC) and run on `js`, and the docs name `o.Inc()` / `&o` as an `Inc` interface (with `type Outer struct{ Num }`) among the `wasm`/`both` compile errors, with `*Num` as the fix
