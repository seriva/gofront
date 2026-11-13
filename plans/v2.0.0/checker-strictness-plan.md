# v2.0.0 Checker Strictness — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Starts after [`test-harness-hardening-plan.md`](test-harness-hardening-plan.md) Phase 1 (`CompileError` with one entry per error, `compile()` on the production path, crashes propagate). Must merge before [`web-platform-evolution-plan.md`](web-platform-evolution-plan.md) Phase 6, which extends assignability, and Phase 7, which turns `any` DOM values into `int`/`float64`; independent of its Phases 1–5. Non-breaking half of the same review: [`../v1.9.3/js-codegen-fixes-plan.md`](../v1.9.3/js-codegen-fixes-plan.md).  
**Release note:** **Breaking:** the compiler now rejects programs that Go rejects, such as mixing numeric types (`int + float64`, or passing an `int` where a `float64` is expected), assigning between different anonymous struct or interface types, and doing arithmetic on an `any` value (values from browser globals and `.d.ts` declarations are unaffected). Add the conversion (`float64(n)`) or type assertion the error points at; these programs used to compile and then print wrong values or produce a WebAssembly module the browser refused to load.  

---

## Goal

Make the type checker reject the invalid Go it accepts today. In the 2026-11-13 review 31 of 68 deliberately invalid programs compiled; on `wasm` most of them then fail in the browser with `CompileError: WebAssembly.instantiate()`, on `js` they print wrong values or throw. Three root causes cover most cases: type identity is decided by comparing printed type names, numeric operands are never required to have the same type, and a Go `any` obtained through some paths is treated like the checker's permissive JS-interop `any`.

v2.0.0 is the release where backward compatibility is not a goal (`web-platform-evolution-plan.md`, user decision 2026-11-13), and Phase 7 of that plan already makes users revisit DOM code. Landing strictness first means one migration instead of two. The measured migration cost is small: `example/*` and `stdlib/` need no change, two unit tests encode the old leniency, and SimpleFPS has 10–11 `int` → `float64` call arguments (*Verified Gaps* S27).

**Done means:**
- Every repro S1–S21 and S23 in *Verified Gaps* is a compile error with its message and line:col on `js`, `both` and `wasm`, or compiles and prints Go's output (the false rejections S4 and S23). Proof: `node test/unit/run.js types/conformance.test.js` passes, and `grep -rl "// pending:" test/unit/fixtures/conformance` prints nothing.
- No printed-name identity comparison is left in the checker: `grep -rnE "typeStr\([^)]*\) [!=]== typeStr\(" src/typechecker` and `grep -n "_sigTypeStr" src/typechecker/assignability.js` print nothing.
- A linked module that fails `WebAssembly.validate` is never returned or written as `app.wasm`: `compileFiles` throws `InternalCompilerError`, and the CLI prints `internal compiler error: …` with the issue-tracker link. Proof: `test/unit/compiler/internal-errors.test.js`.
- `npm test` and `npm run check` (which runs `gofront check example/...`) pass. No file under `example/` or `stdlib/` changes in this plan (`git diff --stat main -- example stdlib` is empty at the end of Phase 6).
- `docs/go-compatibility.md` describes the numeric-operand, conversion and `any` rules as they are now (no change history, per `AGENTS.md` **Docs**). `CHANGELOG.md` has a `**Breaking:**` entry under `### Changed` that links to that section; `/dev-loop` writes it from the **Release note:** line.

---

## Scope Rule & Boundary Matrix

The checker rejects what Go rejects for the classes in *Verified Gaps*, with the same verdict on every target. JS-interop values keep their permissive type. Nothing that is valid Go and compiles today changes its emitted JS or WASM.

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Compile-time rejection of the classes in *Verified Gaps*; the two false rejections; a line:col on every expression diagnostic | S1–S21, S23, S24 | |
| **In scope: core** | Build-time validation of the linked WebAssembly; internal errors reported as such; backend "not supported" errors reported as user errors | S25, S26 | |
| **In scope: target-specific** | JS-dynamic `ANY` stays permissive (D2, D3) | Browser globals (`document`, `window`, …) until web plan Phase 7 types them (their members then follow every strict rule), ECMAScript built-ins (`Math`, `JSON`, …), `.d.ts` `any`, the hand-built WebGL/WebGPU tables in `src/typechecker/stdlib/web.js` | |
| **Excluded: runtime / platform** | Documented runtime differences of `js` packages | Unsized integer arithmetic that never wraps, no bounds checks, UTF-16 strings, `any == any` on numbers | Runtime semantics, not checking; `docs/go-compatibility.md` *Semantic differences* |
| **Excluded: deferred** | Full `go/types` parity | Every rule of the Go spec not listed in *Verified Gaps* | Open-ended; the conformance corpus grows by follow-up instead |
| **Excluded: deferred** | A transitional 1.9.x release that prints warnings for S5–S9 (D4) | `--strict`/warning mode | User decision 2026-11-13: errors only in 2.0.0; 1.9.3 stays a non-breaking patch |
| **Excluded: deferred** | Valid Go that is miscompiled | JS global shadowing, double evaluation, anonymous struct copy; generic instances over anonymous structs (`instanceKey` in `src/typechecker/resolve.js` prints them as `struct{...}`) | Non-breaking; `../v1.9.3/js-codegen-fixes-plan.md` and the `WASM generics over anonymous structs` entry in `plans/follow-ups.md` |
| **Excluded: deferred** | Import cycles (S22) | `gofront check` → `Maximum call stack size exceeded` | Web plan Task 3.1 (`PackageCache` dependency DAG) |
| **Excluded: deferred** | Reclassifying every backend `throw new Error` | The ~40 `Unsupported …`/`Cannot resolve …` throws in `src/backend/wasm/emit-*.js` | Each is either a checker gap or a backend bug: both are internal errors under S26. Only the two known user-facing "not supported" sites move to user errors (Task 1.4); others found later go to `plans/follow-ups.md` |
| **Excluded: deferred** | Parser error recovery (more than one syntax error per file) | `Parser` throws on the first `ParseError` | Separate design; the mutation fuzz found no crash here |

---

## Verified Gaps & Baseline Audit

The review probes ran 2026-11-13 against `src/` at 1.9.2 (`27a09f85`) through `compileFiles` / `compileDir` with `forceTarget`, with the output run in a child `node`. Kit: `.probes/review-2026-11-13/` (`run2.mjs`, `batch-types.txt`, `batch-types2.txt`, `batch-any.txt`, `strict-surface.mjs`, `fuzz.mjs`; gitignored). `/design-plan` re-probed everything on 2026-11-13 at HEAD `d94568cd`; `git diff 27a09f85 HEAD -- src test stdlib` is empty. It re-ran all five batches (same verdicts), ran one isolated program per row (case IDs `s01`…`s23b`, `r1`…`r6` below), a position census, a `WebAssembly.validate` timing and a strict-checker patch of the unit suite in a scratch copy (S27). No Go toolchain was available, so "Go rejects" comes from the Go spec. "Invalid wasm" means the module was emitted and `WebAssembly.instantiate` threw `CompileError`.

| ID | Area | Finding | Evidence & Probe Reference |
|---|---|---|---|
| S1 | Identity: anonymous structs | `var a struct{ X int }; var b struct{ Y string }; a = b` compiles. `js`/`both` print `{-9223372036854775808}` and `wasm` is invalid (`local.tee[0] expected type (ref null 164), found … (ref null 294)`). The same holds for `[]struct{ X int } = []struct{ Y string }`, `struct{ X int } = struct{ X string }` and `var f func(struct{ X int }) = g` with `g func(struct{ Y string })` | `s01`, `s01b`, `t07`, `t08`. `assertAssignable` ends in `typeStr(target) !== typeStr(source)` (`src/typechecker/assignability.js:357`), and `typeStr` prints every anonymous struct as `struct{...}` (`src/typechecker/types.js:569`). Func signatures compare `_sigTypeStr` strings (`assignability.js` `_sigParamsMatch`) |
| S2 | Identity: shadowed local types | Outer `type T struct{ A int }`, inner block `type T struct{ B string }`: `x = y` across them compiles; `js` prints `{-9223372036854775808}` and `wasm` is invalid | `s02`. Both are `named` type objects: outer `name: "T"`, inner `name: "T__L1"`, different objects, and `displayTypeName` strips `__L1`, so `typeStr` gives `T` for both. In-memory probe of `assertAssignable`: same declarations (also `Box[int]` and a type imported from `./a`) are the **same object** |
| S3 | Identity: anonymous interfaces | `var b interface{ Bar() string } = a` with `a interface{ Foo() int }` compiles. Passed on, it gives `TypeError: x.Bar is not a function` (`js`) or `interface conversion: nil or unmatched type for method call` (`wasm`). Named interfaces are rejected correctly (`Fooer does not implement Barer`) | `s03`, `t32`, `t09` (control). `_assertAssignableTypeMismatch` would run `implements()` and reject, but it is never reached because both sides print `interface{...}` |
| S4 | Identity: false rejection | `type A struct{ X int }; a := A{1}; var c struct{ X int } = a` → `Cannot assign A to struct{...}`; Go accepts (identical underlying types, one side unnamed). Unnamed → named interface (`var b Fooer = a`) already works | `s04` (wrong), `s04b` (ok), `t33`. `_identicalUnderlyingLiteral` compares `typeStr(tBase) === typeStr(sBase)` |
| S5 | Numeric: mixed arithmetic | `int + float64` → `3.5` on `both`, invalid wasm (`f64.add[0] expected type f64, found local.get of type i64`). `int32 + int64` → `TypeError: Cannot mix BigInt and other types` on `both`, `1` on `wasm`. `uint8 + int` → `44`. `Meters + Feet` (two defined float types) → `4`. Typed `complex128 + float64` → `(3+0i)` on `js`, invalid wasm | `n01`–`n04`, `r5`. `_binaryResultTypeNumeric` (`assignability.js:194`) accepts any numeric pair and returns `isFloat ? FLOAT64 : lt`; `_binaryResultTypeComplex` accepts any `isComplexOrNumeric` pair |
| S6 | Numeric: mixed comparison | `float64 == int`, `float64 < int` → `true false` on `both`, invalid wasm. `Celsius == Fahrenheit` and `S == string` (`type S string`) compile | `n09`, `t06`, `r6`. Only integer pairs are checked (`_checkIntegerCmpKinds`, `assignability.js:216`) |
| S7 | Numeric: integer-only operators | `5.5 % 2.0` → `1.5` on `both`, `2.75` on `wasm`. `a & b`, `a \| b` on floats → `0 7` on `both`, and a crash on `wasm`: `Unsupported WASM instruction opcode: 'f64.and'` | `n08`, `n10` |
| S8 | Numeric: implicit `int` → `float64` | `var f float64 = i` alone compiles: `3` on `both`, invalid wasm (`expected type f64, found … i64`). The same goes for `half(n)` (`n int`, parameter `float64`). This is deliberate today: `_isNumericCoercible` allows the pair `float64:int`. (`n05` is rejected only because of its later `var j int = f`.) | `s08`, `n06`. `assignability.js:671-694`. Message today is `Cannot assign int to float64` (SimpleFPS probe, S27) |
| S9 | `any` as escape hatch | `var v any = 2; v * 2` → `4` on `both`, crash on `wasm` (`Unsupported WASM instruction opcode: 'anyref.mul'`). The same happens through a map element, a func result, a range element and a generic `any` return. `-v`, `v()`, `for range v`, `if v`, `v[0]` also compile; `wasm` then crashes, is invalid or reports `Unsupported IndexExpr on type: {"kind":"basic","name":"any","_declared":true}`. Already rejected: a method call on `any`, `any` → `int` without an assertion, and arithmetic on a literal `interface{}` (positionless message) | `s09`, `s09c`–`s09j`, `a01`, `a04`, `s09b`; `a02`/`a03` (controls). `_binaryResultTypeNonComplex`: `if (isAny(lt) \|\| isAny(rt)) return ANY`. Source-written `any` resolves to `DECLARED_ANY` (`_declared: true`, `src/typechecker/resolve.js:226`), and the flag survives all the paths above |
| S9a | `any` producers that lose `_declared` | `recover() + 1`, `any(2) + 1`, `v.(any) + 1` and the `default:` binding of a type switch on `any` (`x + 1`) all compile and crash on `wasm` (`anyref.add`). Each yields plain `ANY`, so the strict rules of S9 would miss them | `r1`–`r4`. `recover: () => ANY` (`src/typechecker/expressions.js:146`); `BASIC_TYPES[expr.name]` for the `any` identifier (`expressions.js:227`, `types.js:355 any: ANY`) |
| S10 | Returns | `func f() int { return 1, 2 }` compiles | `s10`, `n12`. `_checkReturnStmt` (`src/typechecker/statements.js:345`) checks counts only for forwarded calls |
| S11 | `nil` to non-nilable | `var i int = nil` → `-9223372036854775808` on `js`; `var s string = nil` → `<nil>`; both give invalid wasm | `s11`, `s11b`. `_assertAssignableEarlyReturn` returns true for every `isNil(source)` |
| S12 | `range` operand | `for i := range 1.5` → `0 1` on `js`, invalid wasm; `for range b` (`b bool`) compiles | `s12`, `s12b`. `_checkRangeExpr` (`expressions.js:1392`) |
| S13 | String element assignment | `s := "abc"; s[0] = 'x'` compiles → `TypeError: Cannot assign to read only property '0'` (`js`), invalid wasm | `s13`, `t29`. `_checkAssignStmt` (`statements.js:286`) |
| S14 | Map element field assignment | `m := map[string]P{…}; m["a"].X = 2` compiles and prints `map[a:{2}]` | `s14`, `t17`. `_isMapElementOperand` (`expressions.js:477`) already implements the rule for `&m[k].f` |
| S15 | Addressability | `mk().Inc()` (pointer receiver, `mk()` returns a struct value) compiles | `s15`, `t27` |
| S16 | Labels | `for { break missing }` compiles → `SyntaxError: Undefined label 'missing'` when the JS loads; the `wasm` program never terminates (killed after 20 s). An unused label `L:` compiles | `s16`, `s16b`, `n28`. `_checkBranchStmt` (`statements.js:658`) never reads `stmt.label`; `LabeledStmt` only checks its body (`statements.js:60`) |
| S17 | Unused expression statements | `x + 1`, `f`, `x == 2` as statements compile | `s17`, `s17b`, `s17c`, `a08`. `checkStmt` `case "ExprStmt"` (`statements.js:51`) only type-checks |
| S18 | Duplicates | A second `case 1:` in a `switch` prints `a`; `map[string]int{"a": 1, "a": 2}` prints `map[a:2]` | `s18`, `s18b`. `_checkSwitchStmt` (`statements.js:479`) has no duplicate check; array/slice literals do (`expressions.js:1534`) |
| S19 | Struct literals | `S{1}` for a two-field struct compiles and prints `{1 }` | `s19`, `a06`. `_checkStructCompositeLit` (`expressions.js:2216`) |
| S20 | Impossible type assertion | `i.(S)` where `S` lacks `I`'s method compiles and returns `false` | `s20`, `n26`. `_checkTypeAssertExpr` (`expressions.js:1355`) |
| S21 | Uninstantiated generic function value | `fmt.Println(slices.Reverse)` prints `<nil>` on `both`; `wasm` reports `Undefined: 'Reverse$$slices'`. `f := Id` (user generic) prints `1` on `js`, and `wasm` reports `Undefined: 'Id'` | `s21`, `s21b`, `n11` |
| S22 | Import cycles | Excluded (web plan Task 3.1); listed because it is in the same corpus: `gofront check` → `Maximum call stack size exceeded` | `t24` |
| S23 | Scoping: false rejection | A local `type int32 = string; var s int32 = "aliased"` → `Cannot assign untyped string to int32`. A local `type float64 struct{ X int }` → `float64 has no field or method 'X'`. Go accepts both | `s23`, `s23b`, `n17`. `resolveTypeNode` checks `BASIC_TYPES[node.name]` before `scope.lookup` (`resolve.js:225`); `expressions.js:227` does the same for identifiers |
| S24 | Diagnostics without position | Of 7,014 `BinaryExpr` nodes parsed from `example/` + `stdlib/` (105 files), 6,697 have no position. All `CallExpr` (4,929), `SelectorExpr` (4,171), `IndexExpr`, `SliceExpr`, `KeyValueExpr`, `TypeAssertExpr`, `AwaitExpr`, `TypeExpr` nodes and 344 of 437 `CompositeLit` nodes have none either. Hence `Type error in main.go: Invalid operation: untyped string + int`, `Too few arguments: expected 2, got 1`, `No field 'B' on S`. `'x' declared and not used` points at the enclosing `func` line | Position census of the parser output. The parser sets `_line`/`_col` only in `parsePrimary` (`src/parser/expressions.js:455`) and on statements. `_reportUnused(scope, node)` (`src/typechecker/index.js:353`) reports at the block's node. Workarounds walk to a positioned operand: `_positioned` (`expressions.js:462`) and the JS `_warn` (`src/backend/js/index.js:698`). Backends read `_line` only on statements, declarations, func literals and `Ident` ref keys (`src/link/stdlib.js:167`) |
| S25 | No validation of emitted wasm | `WebAssembly.validate` runs only after `wasm-opt`; `finishWasm` (`src/compiler.js:129`) returns the unvalidated linked bytes. Cost of validating: 0.43 ms for a 102 kB module (`encoding/json` + `fmt` + `sort`) against a 432 ms compile | `src/backend/wasm/optimize.js:160`; timing probe (`WebAssembly.validate` ×5) |
| S26 | Internal errors look like user errors | Backend failures are plain `Error`s without a position, and the CLI prints `gofront: <message>` (`src/index.js` `catch (e) { log.fail(e.message) }`). Mutation fuzz (1,800 mutated example sources × 3 targets): 0 crashes, 0 hangs, 1 untagged `Unsupported expression kind: AssignStmt` (`wasm`). Two backend throws are real user-facing "not supported" diagnostics: `unsupportedMsg` (`src/backend/wasm/boundary.js:547`, `… is not yet supported across the wasm boundary (planned)`) and `_unsupportedMapKey` (`src/backend/wasm/emit-maps.js:267,413`) | `.probes/review-2026-11-13/fuzz.mjs`. Layering: `src/typechecker/types.js` is the lowest layer (`.sentrux/rules.toml` order 7) and already defines `TypeCheckError`; backend code cannot import `src/compiler.js` (order 1) |
| S27 | Migration surface | **`example/...`** (11 packages): 14 arithmetic-on-`any` binary nodes in 4 files, **all on JS-dynamic `ANY`** (browser globals), none on a declared `any`. A scratch copy with strict S5–S9 rules gives `gofront check example/...` → `11 packages — OK`. **`stdlib/`**: no site; compiled by every unit test that imports it. **Unit suite** with strict S5–S9: 4,788/4,792 pass. 2 failures are scratch-copy git artifacts. The other 2 encode the old leniency: `typed const int cannot implicitly assign to float64 param in strict Go` (`test/unit/language/declarations.test.js:329`) and `int8, int16, int64 all accepted` (`test/unit/types/checks.test.js:157`, `a + b + c` over three integer types). **SimpleFPS** `app/src/...`: 10 `Cannot assign int to float64` in `engine/rendering` (`backend.go:289`, `mesh.go` ×4 without position, `renderer.go:384`, `renderpasses.go:626` ×2 and `:633` ×2). `engine/scene` is blocked behind `rendering` in `check` and has at least one more site (`particleemitterentity.go`). `engine/systems` passes, so its `network.go` JS-dynamic arithmetic stays valid (D3). `_test.go` files are not counted (`check` skips them) | `.probes/review-2026-11-13/strict-surface.mjs`, with a variant that splits `_declared`/`_tainted`/plain `ANY`. Scratch copy `git ls-files \| cp -P --parents` with `_isNumericCoercible` → `false`, an error on `_declared` operands, mixed typed numeric operands, float `% & \| ^ &^` and mixed numeric comparisons; then `node test/unit/run.js` (2:48 wall) and `node src/index.js check` on both projects |

---

## Approach

### 1. Architecture & Design Decisions
- **Settled decisions (user, 2026-11-13):**
  - **D1:** the implicit `int` → `float64` conversion is removed (S8). SimpleFPS fixes 10–11 call sites; nothing else changes.
  - **D2:** the three existing `any` types stay: `DECLARED_ANY` (Go `any`: assertion, type switch, `==`/`!=`, assignment to an interface), plain `ANY` (JS-dynamic interop: anything goes) and `TAINTED_ANY` (error recovery). No new type kinds. Strict rules key on `_declared`; Go-side producers that yield plain `ANY` today (S9a) are switched to `DECLARED_ANY`.
  - **D3:** arithmetic, calls and member access on JS-dynamic `ANY` stay permissive until web plan Phase 7 types the browser globals. Migration of `example/*` (14 sites) is not needed here; web plan Task 7.4 migrates them when the globals become typed and the strict rules start to apply. What stays `ANY` after Phase 7 (ECMAScript built-ins, IDL unions/`any`/`object`, `.d.ts` `any`, the WebGL tables) stays permissive in v2.0.0.
  - **D4:** errors only, in 2.0.0. No warning release.
- **Identity (S1–S4):** one exported `identical(a, b)` in `src/typechecker/types.js`, following the Go spec's identity rules:
  - Basic types match by name, after alias resolution (`byte`/`uint8`, `rune`/`int32`). `DECLARED_ANY`, `ANY`, `TAINTED_ANY` and an empty `interface{}` literal are identical to each other.
  - A `named` type is identical only to itself, compared by object (S2: `T` and `T__L1` are different objects). Instances are identical when they are the same object, or when they come from the same generic declaration and their type arguments are pairwise identical.
  - Structs: same fields in the same order, with the same names, identical types, embedding flag and tags.
  - Interfaces: the same method names with identical signatures, in any order.
  - Funcs: identical params and results and the same variadic flag; parameter names are ignored.
  - Slices, arrays (same length), maps, pointers: element-wise.
  - Recursion is guarded by an assumed-identical pair set.
  
  `typeStr` becomes display-only. The 14 equality sites and `_sigTypeStr`/`_sigParamsMatch` move to `identical` (or to `identical` on underlying types where the site means "identical underlying types").
- **Numeric operands (S5–S8):** once untyped constants have converted, binary arithmetic needs identical operand types (complex included). Comparison needs one operand assignable to the other, which for basic and defined basic types means identical types. `%` and `& | ^ &^` need integers; shifts keep their rule. Messages follow `go/types`: `invalid operation: a + f (mismatched types int and float64)` (the wording `_checkIntegerCmpKinds` already uses) and `invalid operation: operator % not defined on x (variable of type float64)`. S8 reports through the existing float→int branch of `_checkNumericCoercion`: `cannot use i (variable of type int) as float64 value in variable declaration`.
- **Go `any` (S9):** with a `_declared` operand, the following are errors: binary operators other than `==`/`!=`, unary operators, `++`/`--`, compound assignment, calls, index and slice expressions, `range`, and use as a condition. Messages: `invalid operation: operator * not defined on v (variable of type any)`, `invalid operation: cannot call non-function v (variable of type any)`, `invalid operation: cannot index v (variable of type any)`, `cannot range over v (variable of type any)`, `non-boolean condition in if statement`. Plain `ANY` is untouched (D3).
- **Conformance corpus:** `test/unit/fixtures/conformance/{reject,accept}/`, one case per file (or per directory, compiled with `compileDir`, for multi-file and `.d.ts` cases). One runner, `test/unit/types/conformance.test.js`.
  - Reject cases mark the offending line with Go's `// ERROR "substring"` convention. The runner requires a `CompileError` on `js`, `both` and `wasm` (from `forceTarget`) whose `errors` contain an entry with that `line` and substring.
  - Accept cases end in a `// Output:` comment block, run with `assertAllTargetsOutput`. `// compile-only` and `// targets: js` headers cover interop cases that cannot run under `node`.
  - A `// pending: S<n>` header marks a case a later task fixes. The runner then requires the case to still fail, so the fixing task's first step (deleting the marker) is its failing test.
  - Reject fixtures avoid stdlib imports unless the case needs one, so the file stays fast.
- **Positions (S24):** every expression node gets `_line`/`_col` at its leftmost token, the same place the JS `_warn` fallback and `_positioned` already resolve to. Warning text and backend output therefore do not change. Statements and declarations keep their current positions. The unused-variable error moves to the variable's declaring identifier.
- **Validation gate (S25, S26):** `finishWasm` validates the linked bytes before `wasm-opt` (the post-optimisation check stays). New error classes:
  - `InternalCompilerError extends Error` (in `src/compiler.js`, next to the harness plan's `CompileError`) wraps any non-`CompileError` thrown by lowering, codegen, linking or the gate. Its `message` is `internal compiler error: <original message>` plus `This is a bug in GoFront, not in your program; please report it at https://github.com/seriva/gofront/issues`, and `cause` holds the original error.
  - `UnsupportedError extends Error` (in `src/typechecker/types.js`, beside `TypeCheckError`, so backends can import it) marks "valid Go this target does not support yet". `compileFiles` converts it and `TypeCheckError` into `CompileError`.
  
  `src/index.js` stays untouched (it prints `e.message`). `optimizeWasm`'s own failures (missing Binaryen binary) are not wrapped.

### 2. Invariants & Safety Bounds
- Valid programs compile to byte-identical JS and WASM. Check: `npm run build` before and after each phase, then `cmp` of every `example/**/app.js` and `app.wasm`, and `test/perf/bundle-size.js` budgets unchanged.
- No rule is enforced on one target only: the corpus runner checks every reject case on `js`, `both` and `wasm`.
- Every new diagnostic has a corpus case or an `assertErrorContains` test that checks the message, plus a line:col.
- Plain `ANY` keeps every behaviour it has today (D3). A compile-only corpus case does arithmetic on a `.d.ts` `any` value and on a WebGL handle.
- The gate adds no dependency and no measurable build time (0.43 ms per 100 kB, S25). `npm run check:layers` stays green: `UnsupportedError` lives in the bottom layer.
- `CompileError.message` for user errors keeps today's format, so CLI output only changes where a new position or a new diagnostic appears.

### 3. Edge Cases & Error Handling
- Untyped constants still convert to the other operand's type: `x + 1.5` with `x float64` is valid. `x + 1.5` with `x int` is the existing constant-truncation error, and `x + 1` with `x float64` is valid.
- Shifts keep their rule: the result has the left operand's type, and the count may be any integer type.
- Defined types: `Celsius + Celsius` stays valid; `Celsius + float64` (typed) is a mismatch; `Celsius + 1.5` is valid.
- Generic code: operands of type-parameter type keep going through `_binaryResultTypeTypeParam`, which is not changed here. `_isGenericCallResult` becomes redundant once mixed operands are errors, and is removed with D1.
- Recursive types (`type L struct{ next *L }`) and generic structs: `identical` terminates, and `Box[int]` vs `Box[string]` stays distinct (`t12` control).
- Same-named types from two packages stay distinct (`t10` control, rejected today).
- Struct conversion `T(x)` ignores tags (Go rule) and keeps using `_sameStructFields`, now with `identical` field types.
- `any == 2`, `v != "x"` stay valid (`s09h` accept case); `any` in `switch v { case 1: }` stays valid.
- Type switch: inside a `case int:` clause the binding is `int`. In `default:` and multi-type clauses it is the switch operand's type (`DECLARED_ANY` for an `any` operand, S9a).
- Interop: `window == nil`, `document.title + "x"` and `.d.ts` `any` arithmetic keep compiling (D3).
- Error recovery: an operation on `TAINTED_ANY` never adds an error, and one mismatch reports once per expression through the existing `_reportedAt` de-duplication.
- Labels: `continue L` must name an enclosing `for`. `break L` must name an enclosing `for`, `switch` or `select`. A label used only by `goto` is still reported through the existing `goto` error.
- `return f()` forwarding keeps its separate count check (`statements.js`, already correct).

---

## Implementation Tasks

Each phase is one `/dev-loop` (phase branch `feat/checker-strictness-phase-<N>` off epic branch `feat/checker-strictness`). Phase 1 needs `test-harness-hardening-plan.md` Phase 1 merged (`CompileError`, production-path `compile()`).

### Phase 1: Diagnostics groundwork (S24–S26, corpus)
- [ ] Task 1.1: Positions on every expression node, and on unused-variable errors
  - Files: `src/parser/expressions.js`, `src/typechecker/types.js` (`Scope` records each local's declaring node), `src/typechecker/index.js` (`_reportUnused`)
  - Test: `test/unit/parser/positions.test.js` (new): every `BinaryExpr`, `CallExpr`, `SelectorExpr`, `IndexExpr`, `SliceExpr`, `KeyValueExpr`, `CompositeLit`, `TypeAssertExpr`, `AwaitExpr` in a sample program has `_line`/`_col` at its leftmost token. `test/unit/types/checks.test.js`: `"s" + a` on line 6 reports `at line 6:`; `f(1)` reports its line; `s.B` reports its line; `x := 1` unused on line 4 reports `at line 4:2`
  - Done when: the new tests pass, `npm test` passes, and `cmp` of `example/**/app.js`/`app.wasm` before and after `npm run build` shows no difference
- [ ] Task 1.2: Conformance corpus runner, seeded
  - Files: `test/unit/types/conformance.test.js` (new), `test/unit/fixtures/conformance/reject/*.go`, `test/unit/fixtures/conformance/accept/*.go`
  - Test: the runner itself; one reject file per isolated repro, marked `// pending: S<n>`:
    - S1: `s01`, `s01b`, `t07`, `t08`
    - S2: `s02`
    - S3: `s03`, `t32`
    - S5: `n01`–`n04`, `r5`
    - S6: `n09`, `t06`, `r6`
    - S7: `n08`, `n10`
    - S8: `s08`, `n06`
    - S9: `s09`, `s09c`–`s09g`, `s09i`, `s09j`, `r1`–`r4`
    - S10: `s10`
    - S11: `s11`, `s11b`
    - S12: `s12`, `s12b`
    - S13–S15: `s13`, `s14`, `s15`
    - S16: `s16`, `s16b`
    - S17: `s17`, `s17b`, `s17c`
    - S18: `s18`, `s18b`
    - S19: `s19`
    - S20: `s20`, plus an impossible `case S:` in a type switch
    - S21: `s21`, `s21b`

    Ten non-pending controls that are rejected today: `t09`, `t10`, `t12`, `n07`, `n13`, `n14`, `n16`, `n19`, `n23`, `s09b`.

    Accept cases:
    - Pending: `s04` and `s23`/`s23b` (`// pending: S4`, `S23`).
    - Not pending: `s04b`, `s09h`, `Celsius + Celsius`, `x + 1.5` with `x float64`, `int64 << uint8`, `n30`, `a10`.
    - Compile-only (`// targets: js`): arithmetic on a `.d.ts` `any` value.

    The repro text for each ID is in *Verified Gaps* (and in `.probes/review-2026-11-13/` while it exists).
  - Done when: `node test/unit/run.js types/conformance.test.js` passes with every case either pending or passing; deleting a `// pending:` line makes that case fail; the file runs in under 30 s (`DEBUG_TIMINGS=1`)
- [ ] Task 1.3: Validate linked WebAssembly and report internal compiler errors
  - Files: `src/compiler.js` (`InternalCompilerError`, exported `validateWasm(bytes)` called from `finishWasm`, wrapping of the lowering/codegen/link stages), `src/typechecker/types.js` (`UnsupportedError`)
  - Test: `test/unit/compiler/internal-errors.test.js` (new):
    - `validateWasm` throws `InternalCompilerError` for a hand-encoded module whose function body is `i32.add` on an empty stack, and returns for a valid one.
    - An exported `asInternalError(fn)` wraps a thunk that throws `Error("boom")` into `InternalCompilerError` with `message` starting `internal compiler error: boom` and containing the issues URL, keeps `cause`, and passes `CompileError` through unchanged.
    - `UnsupportedError` and `TypeCheckError` thrown inside the wrapped stage come out as `CompileError`.
  - Done when: the new tests pass, `npm test` passes, and `compileFiles` never returns `wasm` bytes that fail `WebAssembly.validate`
- [ ] Task 1.4: Backend "not supported" diagnostics are user errors
  - Files: `src/backend/wasm/boundary.js` (`unsupportedMsg` sites), `src/backend/wasm/emit-maps.js` (`_unsupportedMapKey` sites)
  - Test: in `test/unit/wasm/map-keys.test.js` and `test/unit/wasm/boundary.test.js`, the existing unsupported-key and unsupported-boundary cases additionally assert the thrown error is a `CompileError`, not an `InternalCompilerError`, and that the message has no `internal compiler error` prefix
  - Done when: those tests pass and `npm test` passes

### Phase 2: Type identity (S1–S4)
- [ ] Task 2.1: Structural `identical(a, b)`
  - Files: `src/typechecker/types.js`
  - Test: `test/unit/types/identity.test.js` (new), on type objects resolved from small programs through the checker:
    - Different: anonymous structs that differ in field name, field type, tag, embedding or order; anonymous interfaces with different method sets; funcs with different param, result or variadic; `[2]int`/`[3]int`; outer `T`/inner `T__L1`; `Box[int]`/`Box[string]`; two packages' `P`.
    - Identical: recursive `type L struct{ next *L }` with itself (terminates), `byte`/`uint8`, `DECLARED_ANY`/`ANY`/`interface{}`.
  - Done when: the new tests pass (no callers yet)
- [ ] Task 2.2: Assignability decides identity structurally (S1, S2, S3, S4)
  - Files: `src/typechecker/assignability.js` (7 `typeStr` equality sites, `_identicalUnderlyingLiteral`, `_sigTypeStr`/`_sigParamsMatch` → `identical`)
  - Test: delete `// pending:` from the S1, S2, S3 reject cases and from the S4 accept case. `npm test` stays green, so same-declaration assignments still pass
  - Done when: those corpus cases pass on all targets and `grep -nE "typeStr\([^)]*\) [!=]== typeStr\(|_sigTypeStr" src/typechecker/assignability.js` prints nothing
- [ ] Task 2.3: Conversions, `copy`, element checks and type-set terms use `identical`
  - Files: `src/typechecker/expressions.js` (`_interfaceTerms`, `_checkBuiltinCopy`, `_checkElemTypeCompatible`, `_sameStructFields`, `_pointerConversionOk`, `_checkConversionValidity`), `src/typechecker/resolve.js` (`_termAccepts`)
  - Test: new reject cases:
    - `copy(dst, src)` with `[]struct{ X int }`/`[]struct{ Y string }` → `arguments to copy dst and src have different element types`.
    - `(*struct{ X int })(p)` with `p *struct{ Y string }` → `cannot convert`.
    - A constraint `interface{ struct{ X int } }` instantiated with `struct{ Y string }` → `does not satisfy`.

    New accept case: `struct{ X int }(A{1})` with tags differing.
  - Done when: those cases pass and `grep -rnE "typeStr\([^)]*\) [!=]== typeStr\(" src/typechecker` prints nothing

### Phase 3: Numeric operands (S5–S8)
- [ ] Task 3.1: Arithmetic requires identical operand types (S5)
  - Files: `src/typechecker/assignability.js` (`_binaryResultTypeNumeric`, `_binaryResultTypeComplex`)
  - Test: delete `// pending:` from the S5 cases (`invalid operation: a + f (mismatched types int and float64)`). Rewrite `int8, int16, int64 all accepted` (`test/unit/types/checks.test.js:157`) to convert explicitly, and add its mixed form as a reject case
  - Done when: the S5 cases and the `Celsius + Celsius` / untyped-constant accept cases pass, and `npm test` passes
- [ ] Task 3.2: Comparison requires assignable operands (S6)
  - Files: `src/typechecker/assignability.js` (`_checkIntegerCmpKinds` → `_checkCmpOperandTypes`)
  - Test: delete `// pending:` from the S6 cases (`mismatched types float64 and int`, `Celsius and Fahrenheit`, `S and string`); `s09h` (`any == 2`) and `window == nil` stay accepted
  - Done when: those cases pass and `npm test` passes
- [ ] Task 3.3: `%` and bit operators require integer operands (S7)
  - Files: `src/typechecker/assignability.js`
  - Test: delete `// pending:` from the S7 cases (`operator % not defined on a (variable of type float64)`, the same for `&` and `|`). New reject case: compound `f %= 2.0`
  - Done when: those cases pass on `wasm` as compile errors instead of the `f64.and` crash, and `npm test` passes
- [ ] Task 3.4: Remove the `float64:int` leniency (D1, S8)
  - Files: `src/typechecker/assignability.js` (`_isNumericCoercible`, `_checkNumericCoercion`, `_isGenericCallResult`)
  - Test: delete `// pending:` from the S8 cases (`cannot use i (variable of type int) as float64 value in variable declaration`, the same for `argument`). Flip `typed const int cannot implicitly assign to float64 param in strict Go` (`test/unit/language/declarations.test.js:329`) to a negative test with that message
  - Done when: those tests pass, `npm test` and `npm run check` pass, and `example/`/`stdlib/` are unchanged

### Phase 4: Go `any` versus JS-dynamic values (S9)
- [ ] Task 4.1: Go-side `any` producers yield `DECLARED_ANY` (S9a)
  - Files: `src/typechecker/expressions.js` (`recover`, the `any` identifier in conversions, `x.(any)`), `src/typechecker/statements.js` (type-switch `default`/multi-type binding)
  - Test: `test/unit/types/checks.test.js`:
    - `var n int = recover()` → `need type assertion`
    - `var n int = any(2)` → `need type assertion`
    - `var n int = v.(any)` → `need type assertion`
    - `var n int = x` in a type-switch `default:` → `need type assertion`

    A `.d.ts` `any` value assigned to `int` stays accepted.
  - Done when: those tests pass and `npm test` passes
- [ ] Task 4.2: Operators on a Go `any` are errors
  - Files: `src/typechecker/assignability.js` (`_binaryResultTypeNonComplex`), `src/typechecker/expressions.js` (unary operators), `src/typechecker/statements.js` (`++`/`--`, compound assignment)
  - Test: delete `// pending:` from the S9 arithmetic and unary cases (`s09`, `s09c`–`s09e`, `s09i`, `s09j`, `r1`–`r4`): `invalid operation: operator * not defined on v (variable of type any)`. New reject case: `v++`. The `.d.ts` compile-only accept case stays green
  - Done when: those cases pass, `npm test` passes, and `npm run check` passes (examples untouched: their 14 sites are JS-dynamic)
- [ ] Task 4.3: Calls, indexing, `range` and conditions on a Go `any` are errors
  - Files: `src/typechecker/expressions.js` (call, `IndexExpr`, `SliceExpr`, `_checkRangeExpr`), `src/typechecker/statements.js` (`if`/`for` conditions, `!`/`&&`/`||` operands)
  - Test: delete `// pending:` from `s09f`, `s09g` and the call/range halves of `a04` (`cannot call non-function v (variable of type any)`, `cannot range over v (variable of type any)`, `cannot index v (variable of type any)`, `non-boolean condition in if statement`)
  - Done when: those cases pass and `npm test` and `npm run check` pass

### Phase 5: Statements and assignments (S10–S16)
- [ ] Task 5.1: Return count; `nil` to a non-nilable type (S10, S11)
  - Files: `src/typechecker/statements.js` (`_checkReturnStmt`), `src/typechecker/assignability.js` (`_assertAssignableEarlyReturn`: `nil` only into pointer, slice, map, func, interface and type-parameter targets; JS-dynamic `ANY` keeps accepting it)
  - Test: delete `// pending:` from `s10` (`too many return values`) and `s11`/`s11b` (`cannot use nil as int value in variable declaration`). Existing `nil` tests for maps, slices, funcs, pointers, interfaces and generics stay green
  - Done when: those cases pass and `npm test` passes
- [ ] Task 5.2: `range` operand kinds (S12)
  - Files: `src/typechecker/expressions.js` (`_checkRangeExpr`)
  - Test: delete `// pending:` from `s12`/`s12b` (`cannot range over 1.5 (untyped float constant)`, `cannot range over b (variable of type bool)`); range over int, string, slice, array, `*array`, map and iterator funcs stays green
  - Done when: those cases pass and `npm test` passes
- [ ] Task 5.3: Assignability of the left side (S13–S15)
  - Files: `src/typechecker/statements.js` (`_checkAssignStmt`, `++`/`--`), `src/typechecker/expressions.js` (pointer-receiver call on a non-addressable operand, reusing `_isMapElementOperand`)
  - Test: delete `// pending:` from `s13` (`cannot assign to s[0] (neither addressable nor a map index expression)`), `s14` (`cannot assign to struct field m["a"].X in map`) and `s15` (`cannot call pointer method Inc on C`). `m["a"] = P{2}`, `p.X = 1` through a pointer, and `v.Inc()` on an addressable `v` stay green
  - Done when: those cases pass and `npm test` passes
- [ ] Task 5.4: Undefined, misplaced and unused labels (S16)
  - Files: `src/typechecker/statements.js` (`LabeledStmt`, `_checkBranchStmt`)
  - Test: delete `// pending:` from `s16` (`break label not defined: missing`) and `s16b` (`label L defined and not used`). New reject case: `continue L` where `L` labels a `switch` (`invalid continue label L`). Existing labeled `break`/`continue` tests (including range-over-func) stay green
  - Done when: those cases pass, the `wasm` hang in `s16` becomes a compile error, and `npm test` passes

### Phase 6: Expressions, literals and docs (S17–S21, S23)
- [ ] Task 6.1: Unused expression statements (S17)
  - Files: `src/typechecker/statements.js` (`checkStmt` `ExprStmt`)
  - Test: delete `// pending:` from `s17`/`s17b`/`s17c` (`x + 1 (value of type int) is not used`). Calls, `await` calls and conversions-as-calls to funcs stay valid statements
  - Done when: those cases pass and `npm test` passes
- [ ] Task 6.2: Duplicate `switch` cases and map keys; struct literal value count (S18, S19)
  - Files: `src/typechecker/statements.js` (`_checkSwitchStmt`), `src/typechecker/expressions.js` (map literal keys, `_checkStructCompositeLit`)
  - Test: delete `// pending:` from `s18` (`duplicate case 1 in expression switch`), `s18b` (`duplicate key "a" in map literal`) and `s19` (`too few values in struct literal of type S`). Non-constant duplicate cases stay valid
  - Done when: those cases pass and `npm test` passes
- [ ] Task 6.3: Impossible type assertions; generic functions used without instantiation (S20, S21)
  - Files: `src/typechecker/expressions.js` (`_checkTypeAssertExpr`, value use of a generic func ident/selector), `src/typechecker/statements.js` (type-switch cases)
  - Test: delete `// pending:` from `s20` and its type-switch twin (`impossible type assertion: i.(S)` / `impossible type switch case`) and from `s21`/`s21b` (`cannot use generic function slices.Reverse without instantiation`). `f := Id[int]` and calls with inference stay valid
  - Done when: those cases pass and `npm test` passes
- [ ] Task 6.4: Local declarations shadow predeclared type names (S23)
  - Files: `src/typechecker/resolve.js` (`resolveTypeNode` `TypeName`), `src/typechecker/expressions.js` (identifier lookup at `:227`)
  - Test: delete `// pending:` from the `s23`/`s23b` accept cases (`aliased`, `3`). The predeclared `int32`/`any` still resolve when not shadowed
  - Done when: those cases pass, `grep -rl "// pending:" test/unit/fixtures/conformance` prints nothing, and `npm test` passes
- [ ] Task 6.5: Document the strict rules
  - Files: `docs/go-compatibility.md` (a *Type checking* section on numeric operands needing identical types and explicit conversions, `any` needing an assertion while browser globals and `.d.ts` values stay dynamic, with a short example of each fix; update the *Browser globals* row), `docs/language-support.md` (rows that mention numeric promotion or `any`, if any)
  - Test: none (docs only); `npm run check` stays green
  - Done when: the docs describe only current behaviour (no change history or plan references), and the section is the anchor the `CHANGELOG.md` **Breaking:** entry links to
