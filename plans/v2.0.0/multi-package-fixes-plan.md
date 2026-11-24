# Multi-Package Linking, Lowering & Visibility Fixes — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-24 (`/bs-plan`): multi-package follow-ups from `codegen-fixes` Phase 6 (L83), `names-panics-type-exprs` Phases 1 & 3 (L84, L89), `package-scope` Phases 1 & 3 (L99, L102, L103), and `js-dead-code-elimination` Phase 1 (L111). Independent of [`typed-web-fixes-plan.md`](typed-web-fixes-plan.md), [`wasm-codegen-fixes-plan.md`](wasm-codegen-fixes-plan.md), [`generics-and-aliases-plan.md`](generics-and-aliases-plan.md), and [`js-codegen-and-value-semantics-plan.md`](js-codegen-and-value-semantics-plan.md) (shared files: `src/typechecker/index.js`, `src/typechecker/expressions.js`, `src/lower/gen-types.js`, `src/lower/fmt-formatters.js` — rebase if run in parallel).  
**Release note:** Local packages can now declare the same unexported or exported function, variable, constant and `init()` names without colliding in JavaScript bundles or failing to link on WebAssembly, `json.Unmarshal` and `fmt` work on imported local-package types and generic structs (`util.Pair[int]`), and dot-imported collision-renamed types work with dead-code elimination. **Breaking:** Calling a generic function in a `wasm` package from a `js` package and satisfying another package's interface with an unexported method declared outside that package are now compile errors; use a non-generic wrapper or move the generic function to a `both` package, and embed the package's type to satisfy sealed interfaces.

---

## Goal

Make multi-package GoFront projects (including hybrid JS+WASM apps) behave like Go across every build target: isolate package-level function/variable/constant/`init()` namespaces across JS bundles and WasmGC links, qualify imported local types reliably in generated `json`/`fmt` code, recognize imported generic types in `fmt`, preserve unmangled names for dot-imported mangled types, reject unsupported JS→WASM generic function calls at compile time instead of throwing `ReferenceError` at runtime, and enforce owning-package visibility for unexported interface methods.

**Done means:**
- Two or more local packages declaring identical top-level unexported/exported functions, variables, constants, `init()` functions, cross-kind type-vs-value names, or sharing a `package` name in different directories (`p1/util`, `p2/util`) compile, link, and produce Go's output on `js`, `both`, and `wasm` (`test/unit/compiler/pkg-collisions.test.js`, `test/unit/compiler/link.test.js`).
- `json.Unmarshal`/`json.Marshal`/`fmt` work on imported local-package types (default, aliased, multi-file dual-alias, dot-imported, indirect, shadowed alias) and `fmt.Println`/`%T` format imported generic structs (`util.Pair[int]`) on `js`, `both`, and `wasm` (`test/unit/compiler/packages.test.js`, `test/unit/wasm/fmt-any.test.js`, `test/unit/wasm/json.test.js`).
- Dot-imported collision-mangled types (`type Map int`, colliding `type Num int` / `type Box struct`) compile and survive JS DCE; JS→WASM generic function calls report a clear compile error; foreign types cannot satisfy foreign interfaces with unexported methods (`test/unit/compiler/packages.test.js`, `test/unit/wasm/boundary.test.js`).
- `docs/hybrid-wasm.md` documents the JS→WASM generic-function boundary rule; `npm test`, `npm run check`, and `npm run test:e2e` pass.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `iface-implements-ignores-method-pkg`: `implements()` enforces owning `_pkgId` on unexported interface methods across assignments, embeds, assertions, type switches, and generic constraints | `var _ util.I = Mine{}`, `i.(Mine)`, `switch i.(type)`, `func g[T util.I]` | |
| **In scope: core** | Root `mangled-type-export-symbol-mismatch`: restore unmangled names in `exportedSymbols`/`exportedKinds` alongside `exportedTypes` and resolve mangled dot-imported types in DCE | `import . "./util"; Map(3)`, `import . "./b"; Box{V: 2}` | |
| **In scope: core** | Roots `gen-types-unqualified-local-type` & `fmt-gen-imported-generic-scope`: qualify all non-local named types in `TypeSpeller`/`gofront_gen.go` (incl. dual-alias, dot-import, indirect, shadowed-alias), fix `declaringPackage(t)` for instantiated generics, and recognize imported generic instances in `FmtGen.isNamedInScope` | `json.Unmarshal` on `Wrap{B s.MyInt}`, `fmt.Println(util.Pair[int]{1, 2})`, `fmt.Printf("%T", q)` | |
| **In scope: core** | Root `flat-pkg-value-namespace`: isolate package-level `init()`, functions, variables, constants, and cross-kind collisions across linked JS and WASM packages (including same `pkgName` in distinct dirs) with cache-key safety | `util`/`other`/`main` all declaring `func helper()`, `func init()`, `var x`, `const k`, `a.Make`/`b.Make`, `p1/util` + `p2/util` | |
| **In scope: target-specific** | Root `wasm-boundary-generic-func-unchecked`: reject JS callers invoking/referencing a `wasm` package's generic function at compile time, and handle zero-instance `wasm` generic structs referenced from JS without raw `ReferenceError` | `util.Id(3)`, `util.Id[int](3)`, `f := util.Id[int]`, `util.Box[int]{}` | WASM monomorphisation runs only over `wasmUnits`; JS→`both` and WASM→`wasm` generics stay supported |
| **Excluded: runtime / platform** | Monomorphising `wasm` generic functions on demand from `js` call sites | `util.Id(3)` with `util` (`//gofront:target wasm`) | Requires JS↔WASM runtime type-argument dispatch tables and cross-target monomorphisation; use a `both` package or a non-generic wrapper in `wasm` |
| **Excluded: deferred** | Shadowing a promoted unexported method with a local method of the same name while still satisfying the foreign interface | `type Shadow struct { util.Base }; func (Shadow) secret() int` | `struct.methods` is keyed by bare name rather than `(pkgId, name)`; rare corner case deferred |
| **Excluded: deferred** | Dot-import + same-named unexported type in `json.Marshal` (L104) and dot-imported type colliding with package's own type in lowering (L100) | `import . "./util"; type box struct{}` | Distinct dot-import lowering namespace root; deferred to post-2.0.0 |

---

## Verified Gaps & Baseline Audit

**Method.** Read-only code inspection and `node --input-type=module -e` multi-package probes using `compileDir` / `withTempDir` on `main` (`dda372c4`, 2026-11-24).

### M1 `iface-implements-ignores-method-pkg` (L102)
Root: the checker already stamps `_pkgId` on interface methods (`src/typechecker/resolve.js:912`), declared methods (`src/typechecker/index.js:1636`), generic substitutions (`resolve.js:183`), embedded interface merges (`resolve.js:961`), and promoted struct methods (`index.js:89-93, 98-99, 1284-1292`). Only `implements(srcType, iface)` (`src/typechecker/assignability.js:1914-1944`) omits the `!isExported(name) && required._pkgId !== undefined && actual._pkgId !== required._pkgId` check in both its interface-to-interface (`:1921-1927`) and concrete-to-interface (`:1937-1942`) loops. (Must NOT live in `_implementsMethod` because `_checkFuncAssignable` at `:1820` shares it for plain funcs.)

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| M1.1 (L102 repro) | `util`: `type I interface { secret() int; Pub() int }`; `main`: `var _ util.I = Mine{}` | compile error | compiles and runs |
| M1.2 *sibling* | `var _ util.I = &Mine{}`; interface-to-interface `var _ util.I = localI`; embedded foreign `type Wrap interface { util.I }`; `util` embeds unexported `base`; `_ = i.(Mine)`; `switch i.(type) { case Mine: }`; `func g[T util.I](x T)` with `Mine{}` | compile error on all | all compile and run |
| control | `type Good struct { util.Base }`; `type Good struct { util.Base[int] }`; `var _ util.I = util.Impl{}`; same-pkg unexported method | `"ok"` | passes (must stay) |

### M2 `mangled-type-export-symbol-mismatch` (L89)
Root: `src/compiler.js:1335-1342` applies `withOriginalTypeNames` (`src/link/type-names.js:281-285`) only to `exportedTypes`, leaving `exportedSymbols` and `exportedKinds` keyed solely under mangled names (`Map$$util`, `Num$$b`). Qualified `util.Map(3)` is masked by a fallback in `resolve.js:2002`, but dot-imports (`src/compiler.js:702-718` → `addDefinitions`) read `exportedSymbols` and fail with `Undefined`, and DCE (`src/lower/reachability.js:598-601`, `_resolveName`) does not check `${name}$$${dep.pkgName}` for dot-imported types (unlike `_resolveQual` at `:613`).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| M2.1 (L89 live root) | `import . "./util"` (`type Map int`); `Map(3)` on `js` and `wasm` | `3` | `Undefined: 'Map'` |
| M2.2 *sibling* | `a`, `b` both `type Num int`; `import . "./b"; Num(2)` | `2` | `Undefined: 'Num'` |
| M2.3 *sibling* | `a`, `b` both `type Box struct{ V int }`; `import . "./b"; Box{V: 2}` on `js` | `2` | `ReferenceError: Box$$b is not defined` (pruned by DCE) |
| control | qualified `util.Map(3)` (`js`/`both`/`wasm`); `var _ = util.Map` (rejected as type-as-value) | `3`; compile error | passes (must stay) |

### M3 `wasm-boundary-generic-func-unchecked` (L83)
Root: WASM monomorphisation (`src/backend/wasm/monomorph.js:504-589`) runs solely across `options.wasmUnits` (`src/link/wasm.js:53-118`), and `collectFuncMeta` (`src/backend/wasm/boundary.js:712-727`) never exports polymorphic JS dispatchers for erased generic templates. The checker (`src/typechecker/expressions.js:2105-2157, 2792-2830`) never rejects `kind === "generic"` from a `wasm` package when `this.target === "js"`. Sibling: `genGenericClasses` (`src/backend/wasm/boundary.js:2787-2815`) omits `class Box` when a `wasm` generic struct has 0 instantiations in `wasm`, causing raw `ReferenceError: Box is not defined` in JS instead of the documented `TypeError("GoFront: no Box instance...")` (preserving `test/unit/wasm/boundary.test.js:2367-2391`).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| M3.1 (L83 repro) | `util` (`wasm`): `func Id[T any](s T) T`; `main` (`js`): `util.Id(3)` | compile error with actionable hint | compiles; runtime `ReferenceError: Id is not defined` |
| M3.2 *sibling* | `util.Id[int](3)`; `f := util.Id[int]`; `util` calls `Id(1)` internally + JS calls `util.Id(3)`; `import . "./util"; Id(3)` | compile error on all | runtime `ReferenceError: Id is not defined` |
| M3.3 *sibling* | `util` (`wasm`): `type Box[T any] struct{ V T }` (0 wasm instances); `main` (`js`): `util.Box[int]{V: 5}` | `TypeError("GoFront: no Box instance...")` or compile error (preserving `boundary.test.js:2367`) | runtime `ReferenceError: Box is not defined` |
| control | `js` calls `both` generic; `wasm` calls `wasm` generic; `js` calls `util.Make().Get()` on `Box[int]` returned from `wasm` | `3`, `3`, `42` | passes (must stay) |

### M4 `gen-types-unqualified-local-type`, `fmt-gen-imported-generic-scope` (L99, L103)
Roots:
1. `TypeSpeller.spellNamed` (`src/lower/gen-types.js:277-296`) only qualifies types containing `"$$"` or `"."`, emitting bare `MyInt` for unrenamed local-package types. In `gofront_gen.go`, expression-position conversions (`return MyInt(v)`) fail `checkIdent` with `Undefined: 'MyInt'` across default imports, aliased imports, dual-alias files (`s1`/`s2`), dot-imports, shadowed aliases (`var s = 99`), and indirect dependencies (`main` → `mid` → `leaf.Num`).
2. `FmtGen.isNamedInScope` (`src/lower/fmt-formatters.js:247-254`) checks `this.checker.types.get(t.name) === t`, which is always `false` for instantiated imported generic types (`util.Pair[int]`, where `checker.types.get("Pair")` holds the generic template, not the instance). Coupled bug: `TypeSpeller.declaringPackage(t)` (`src/lower/gen-types.js:216-225`) also compares `v === t`, falling back to `this.pkgName` (`"main"`) instead of `t._pkgName` (`"util"`).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| M4.1 (L99 repro) | `import s "./sub"` (`type MyInt int`); `type Wrap struct { B s.MyInt }`; `json.Unmarshal` on `js`/`both`/`wasm`; two files importing `s1 "./sub"` and `s2 "./sub"` | unmarshals cleanly | `internal error in the generated Go ... Undefined: 'MyInt'` |
| M4.2 *sibling* | default `import "./sub"`, dot-import `import . "./sub"`, indirect `main` → `mid` → `leaf.Num`, shadowed alias (`var s = 99` in sibling file), pointer `*s.MyInt` in `json.Unmarshal` | unmarshals cleanly | `Undefined: 'MyInt'` / `Undefined: 'Num'` |
| M4.3 (L103 repro) | `util`: `type Pair[T any] struct{ A, B T }`; `main`: `fmt.Println(util.Pair[int]{1, 2})` on `js`/`both`/`wasm` | `{1 2}` | `<nil>` on all 3 targets |
| M4.4 *sibling* | `%T`, `%+v`, `any`-boxed `util.Pair[int]`, `util.List[int]`, `&util.Pair[int]`, `Outer{P: util.Pair[int]}` | `util.Pair[int]`, `{A:1 B:2}`, `{1 2}`, etc. | `""` for `%T`, `<nil>` for all |
| control | collision-renamed `sub.MyInt` (`MyInt$$sub`); `json.Marshal`/`Unmarshal` on `util.Pair[int]`; same-pkg `main.Pair[int]`; non-generic `util.Pair` | passes | passes (must stay) |

### M5 `flat-pkg-value-namespace` (L84, L111)
Root: Local user packages share one flat JS module (`src/link/user-js.js`, `src/backend/js/index.js:432-458`) and one flat WasmGC module (`src/link/wasm.js:53-118`). Types have collision mangling (`mangleCollidingTypes`, `src/link/type-names.js:66-96`) and stdlib has full `$$`-mangling (`src/link/stdlib.js:129-207`), but user top-level `FuncDecl`, `VarDecl`, `ConstDecl`, and `init()` have none:
- WASM `checkLinkCollisions` (`src/link/wasm.js:181-217`) rejects any shared name (even `init`, despite `src/backend/wasm/index.js:368-373` already sequentially renaming `init` functions).
- JS emits bare `function helper()`, `let x`, `const k`, `function init()` and de-qualifies `pkg.Foo` to `jsBindingName(expr.field)` (`src/backend/js/expressions.js:1460`), causing silent function overwrites, `Identifier '...' has already been declared`, and hoisted `init()` TDZ crashes (`Cannot access 'M' before initialization`).
- Packages with the same `package` name in different directories (`p1/util`, `p2/util`) collide even under bare `$$pkgName` suffixes.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| M5.1 (L84 + L111 repro) | `util`, `other`, `main` each declare `func helper() int`; `util` + `main` on `wasm` | JS `2 1 5`; WASM `10 hi` | JS `1 1 1` (silent overwrite); WASM `cannot link wasm packages: 'helper'...` |
| M5.2 (L84 repro) | `a`, `b` (`both` or `js` or `wasm`) both export `func Make() int` | `1 2` on all targets | JS `2 2`; WASM `cannot link wasm packages: 'Make'...` |
| M5.3 *sibling* | `util` + `main` both declare `func init()` on `js`/`both`/`wasm` | both inits run in dependency order | JS/both `Cannot access 'M' before initialization`; WASM link error on `'init'` |
| M5.4 *sibling* | unexported/exported `var x`/`X` and `const k`/`K` across packages; cross-kind `sub` `type MyInt` vs `main` `var MyInt` or `type Box` vs `func Box()`; same-`pkgName` different dirs `p1/util` + `p2/util` | Go's output on all targets | JS `Identifier '...' has already been declared` or `2 2`; WASM link error |
| control | `util` + `main` both declare `type box struct` | `10 hi` on all targets | passes (must stay) |

---

## Approach

### 1. Architecture & Design Decisions
- **M1 (`implements`):** In `src/typechecker/assignability.js:implements`, import `isExported` from `./types.js` and reject unexported method matches in both loops whenever `required._pkgId !== undefined && actual._pkgId !== required._pkgId`.
- **M2 (`exportedSymbols` / `exportedKinds` / dot-import DCE):** Add `withOriginalSymbolNames` / `withOriginalKinds` helpers alongside `withOriginalTypeNames` in `src/link/type-names.js` and apply them in `src/compiler.js:1335-1342` so unmangled type names are always exposed to importers (including dot-imports). In `src/lower/reachability.js:_resolveName`, check `[name, `${name}$$${dep.pkgName}`]` for dot-imported packages matching `_resolveQual`.
- **M3 (WASM boundary generics):** Stamp `_target: this.target` on generic func descriptors in `src/typechecker/index.js:_registerFuncDecl`, and reject `kind === "generic"` with `_target === "wasm"` when `this.target === "js"` in `src/typechecker/expressions.js` (`_checkInstantiationExpr` and `_resolveGenericFnType`) with a message directing callers to wrap it in a non-generic `wasm` function or move it to a `both` package. In `src/backend/wasm/boundary.js:genGenericClasses`, emit the stub `class Box` throwing `TypeError("GoFront: no Box instance...")` even when a `wasm` package exports a generic struct with 0 internal instantiations (preserving `test/unit/wasm/boundary.test.js:2367-2391`).
- **M4 (`TypeSpeller`, `gofront_gen.go`, `FmtGen`):**
  - In `src/lower/gen-types.js`, have `TypeSpeller.spellNamed` qualify **every** non-local named type (resolved by owning package identity, not just `$$`-renamed ones), using synthetic collision-free qualifiers (e.g. `_gf_pkg_<N>`) bound into `gofront_gen.go`'s scope by `bindReachedPackages` (`src/typechecker/index.js`) / `checkGeneratedGo` (`src/link/stdlib.js`) for dot-imported, dual-aliased, shadowed-alias, and indirectly reached local packages.
  - Fix `TypeSpeller.declaringPackage(t)` (`src/lower/gen-types.js:216-225`) to check `t._pkgName` before scanning `this.checker.types` by reference identity.
  - In `src/lower/fmt-formatters.js:isNamedInScope`, recognize instantiated generic types (`t._genericOf`) whose template exists in `this.checker.types` (by bare or qualified key).
- **M5 (Package value/func/`init` namespace isolation):**
  - Give each JS package chunk unique `init` names (`__init$<pkgSuffix>_<n>`) in `src/backend/js/index.js:_emitFuncDecls`, and exempt `"init"` in `src/link/wasm.js:checkLinkCollisions`.
  - Extend build-wide collision tracking (`src/link/type-names.js` / new `src/link/pkg-names.js` + `src/compiler.js`) to cover top-level `FuncDecl`, `VarDecl`, `ConstDecl`, and cross-kind collisions with `TypeDecl`, assigning a deterministic unique suffix per package path (`pkgKey`, disambiguating `p1/util` vs `p2/util`) and folding the collision map into `PackageCache` unit keys (`src/compiler.js:1019, 1060-1101`).
  - Keep non-colliding exported names unmangled (preserving JS external exports, `jsRoots`, and `packages.test.js:131`). For colliding top-level values/functions, rewrite declarations and scope-aware references inside the owning package (respecting local shadowing, params, struct literal keys, and `gofront_gen.go`), expose `mangledExports`, and thread them through `_mangle` → `_stdName` (reusing the existing `src/backend/js/expressions.js:1415-1422` and `src/link/wasm.js:279-296` stdlib reference-lowering path), DCE (`src/lower/reachability.js`), and the WASM facade (`src/backend/wasm/boundary.js`).

### 2. Invariants & Safety Bounds
- Non-colliding exported package names keep their bare JS identifier so external JS consumers and existing tests (`packages.test.js:131`) are unaffected.
- `PackageCache` keys include the package's value-mangling map so incremental rebuilds invalidate cleanly when a new package introduces or resolves a collision.
- Scope-aware renaming never rewrites shadowed local variables, function parameters, struct field names, or method names on unrelated receivers.

### 3. Edge Cases & Error Handling
- Multiple `func init()` declarations in the same package still execute in source order; across packages, dependency inits run before importer inits on both JS and WASM.
- Two `wasm` packages exporting the same function name (`a.Make`, `b.Make`) imported by a `js` `main` export distinct mangled names on the WASM module and facade, and JS calls route through `_stdName`.
- Cross-kind collisions (`sub` declares `type Box`, `main` declares `func Box()` or `var Box = 1`) are detected in the unified owner map so JS never emits duplicate `class Box` / `function Box` / `let Box`.

---

## Implementation Tasks

### Phase 1: Package Visibility & Mangled Type Exports (roots `iface-implements-ignores-method-pkg`, `mangled-type-export-symbol-mismatch`)
*Scheduled from review follow-ups (2026-11-24).*
- [ ] Task 1.1: Enforce owning `_pkgId` on unexported interface methods in `implements()` (M1.1–M1.2)
  - Files: `src/typechecker/assignability.js` (`implements`)
  - Test: `test/unit/compiler/packages.test.js`: M1.1–M1.2 (`var _ util.I = Mine{}`, `&Mine{}`, interface-to-interface, embedded foreign interface, unexported embedded interface in `util`, `i.(Mine)`, `switch i.(type)`, `func g[T util.I]` all rejected with `assertErrorContains`) + passing controls (`util.Base`, `util.Base[int]`, `util.Impl`, same-pkg)
  - Done when: foreign types cannot satisfy foreign interfaces with unexported methods unless promoted from that package
- [ ] Task 1.2: Restore unmangled names in `exportedSymbols`/`exportedKinds` and resolve mangled dot-imported types in DCE (M2.1–M2.3)
  - Files: `src/link/type-names.js`, `src/compiler.js`, `src/lower/reachability.js` (`_resolveName`)
  - Test: `test/unit/compiler/packages.test.js`, `test/unit/compiler/imports.test.js`: M2.1 (`import . "./util"; Map(3)` on `js`/`wasm`), M2.2 (`import . "./b"; Num(2)`), M2.3 (`import . "./b"; Box{V: 2}` under DCE) + controls
  - Done when: dot-imported collision-mangled types resolve in value/conversion/literal positions and survive JS DCE

### Phase 2: Reject Unsupported JS→WASM Generic Calls (root `wasm-boundary-generic-func-unchecked`)
- [ ] Task 2.1: Report a compile error when a `js` package calls or references a `wasm` package's generic function (M3.1–M3.2)
  - Files: `src/typechecker/index.js` (`_registerFuncDecl`), `src/typechecker/expressions.js` (`_checkInstantiationExpr`, `_resolveGenericFnType`)
  - Test: `test/unit/wasm/boundary.test.js`: negative `assertErrorContains` tests for inferred `util.Id(3)`, explicit `util.Id[int](3)`, func value `f := util.Id[int]`, already-instantiated `Id(1)` in `util`, and dot-imported `Id(3)`; controls for JS→`both` and WASM→`wasm` generics
  - Done when: JS→WASM generic function calls fail at compile time with an actionable message instead of runtime `ReferenceError`
- [ ] Task 2.2: Emit stub class for zero-instantiation exported WASM generic structs and document boundary rules (M3.3)
  - Files: `src/backend/wasm/boundary.js` (`genGenericClasses`, `collectBoundaryMeta`), `docs/hybrid-wasm.md`
  - Test: `test/unit/wasm/boundary.test.js`: M3.3 (`util.Box[int]{V: 5}` when `wasm` has 0 instances throws `GoFront: no Box instance` instead of `ReferenceError`), plus existing `boundary.test.js:2367-2391` unchanged
  - Done when: zero-instance exported WASM generic structs never throw raw `ReferenceError` and `docs/hybrid-wasm.md` documents JS→WASM generic limits

### Phase 3: Generated-Go Local Type Qualification & Imported Generic `fmt` (roots `gen-types-unqualified-local-type`, `fmt-gen-imported-generic-scope`)
- [ ] Task 3.1: Qualify all non-local named types in `TypeSpeller` / `gofront_gen.go` and fix `declaringPackage` (M4.1–M4.2)
  - Files: `src/lower/gen-types.js` (`TypeSpeller.spellNamed`, `qualifierFor`, `declaringPackage`, `importPaths`), `src/typechecker/index.js` (`bindReachedPackages`), `src/link/stdlib.js` (`checkGeneratedGo`)
  - Test: `test/unit/compiler/packages.test.js`, `test/unit/wasm/json.test.js`: M4.1–M4.2 (`json.Unmarshal` on default, aliased, dual-alias `s1`/`s2`, dot-imported, indirect `main`→`mid`→`leaf.Num`, shadowed-alias `var s = 99`, and `*s.MyInt` across `js`, `both`, `wasm`)
  - Done when: `gofront_gen.go` qualifies every imported local-package type cleanly without `Undefined` errors
- [ ] Task 3.2: Recognize imported generic instances in `FmtGen.isNamedInScope` (M4.3–M4.4)
  - Files: `src/lower/fmt-formatters.js` (`isNamedInScope`, `spellableNamed`, `typeName`)
  - Test: `test/unit/wasm/fmt-any.test.js`, `test/unit/compiler/packages.test.js`: M4.3–M4.4 (`fmt.Println`, `%T`, `%+v`, `any`-boxed `util.Pair[int]`, `util.List[int]`, `&util.Pair[int]`, `Outer{P: util.Pair[int]}` on `js`, `both`, `wasm`)
  - Done when: imported generic structs and composites format identically to Go (`{1 2}`, `util.Pair[int]`) on all targets

### Phase 4: Multi-Package Top-Level Value, Function & `init()` Isolation (root `flat-pkg-value-namespace`)
- [ ] Task 4.1: Give each package unique `init()` names in JS and exempt `"init"` in WASM link checks (M5.3)
  - Files: `src/backend/js/index.js` (`_emitFuncDecls`), `src/link/wasm.js` (`checkLinkCollisions`)
  - Test: `test/unit/compiler/link.test.js`, `test/unit/compiler/packages.test.js`: M5.3 (`util` + `main` both defining `func init()`, plus multiple `init()` in one package, across `js`, `both`, `wasm`)
  - Done when: `init()` runs in Go dependency order across all linked packages without TDZ crashes or link errors
- [ ] Task 4.2: Compute build-wide top-level value/type collision maps with unique per-path suffixes and scope-aware AST mangling (M5.1, M5.2, M5.4)
  - Files: `src/link/pkg-names.js` (new helper paired with `src/link/type-names.js`), `src/compiler.js`
  - Test: `test/unit/compiler/link.test.js`, `test/unit/compiler/package-cache.test.js`: unit tests for collision detection (unexported funcs/vars/consts, exported funcs/vars/consts, cross-kind type-vs-value, `p1/util` vs `p2/util`), local-shadow preservation, and `PackageCache` invalidation when collisions change
  - Done when: every colliding top-level value/function across local packages gets a unique mangled name without altering non-colliding exports
- [ ] Task 4.3: Thread mangled local exports through checker namespaces, dot-imports, and reachability DCE (M5.1, M5.2, M5.4)
  - Files: `src/typechecker/index.js` (`addPackageNamespace`, `addDefinitions`), `src/typechecker/resolve.js` (`_fieldTypeNamespace`), `src/lower/reachability.js` (`_resolveQual`, `_resolveName`)
  - Test: `test/unit/compiler/pkg-collisions.test.js`: qualified calls (`a.Make()`, `b.Make()`), dot-imported colliding values/funcs, and DCE pruning of unused colliding helpers on `js` and `both`
  - Done when: mangled local exports stamp `_stdName` consistently and survive DCE when reachable
- [ ] Task 4.4: Wire mangled local symbols through JS expressions, WASM linker, and WASM facade (M5.1, M5.2, M5.4)
  - Files: `src/backend/js/expressions.js`, `src/backend/wasm/boundary.js`, `src/link/wasm.js`
  - Test: `test/unit/compiler/pkg-collisions.test.js`, `test/unit/wasm/boundary.test.js`: M5.1–M5.4 across `js`, `both`, `wasm`, and hybrid (`js` `main` importing two `wasm` packages both exporting `Make`, plus `p1/util` + `p2/util`, `var`/`const`, cross-kind `type Box` vs `func Box()`)
  - Done when: all M5.1–M5.4 probes produce Go's output across `js`, `both`, `wasm`, and hybrid targets with zero collisions
