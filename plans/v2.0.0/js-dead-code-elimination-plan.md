# JS Dead-Code Elimination — Design Plan

**Version:** v2.0.0  
**Status:** Completed (2026-11-23)  
**Base branch:** main  
**Related:** Split out of the former `web-platform-evolution-plan.md` (its Phase 4) on 2026-11-17, re-probed that day. Starts after [`incremental-builds-plan.md`](incremental-builds-plan.md): extends its `PackageCache` (which memoizes `stdlibJs` by reached decl set) to memoize pruned user/stdlib JS chunks and their helper sets by reached decl + kept-method set. Holds the deferred size work of `../v1.9.2/release-bundle-fixes-plan.md` and the shared runtime helpers of `../v1.9.3/js-codegen-fixes-plan.md`.  
**Release note:** JavaScript bundles leave out functions, types and methods your program never uses, and each runtime helper appears once per bundle, so apps download less code.  

---

## Goal

One reachability closure over user and stdlib programs decides what the JS backend emits: unused user functions, types and methods are pruned, stdlib method selection is qualified by receiver type, and runtime helpers are emitted once per bundle. `gofront dev`, `build` and `test` prune identically.

**Done means:**
- Unused user functions, types and unselected methods are absent from emitted JS (`test/unit/compiler/dce-funcs.test.js`, `test/unit/compiler/dce-methods.test.js`), and every `example/*` and unit-suite program prints the same output as before.
- Stdlib method reachability is receiver-qualified: a user method named `Len` no longer keeps `strings.Builder.Len` (`test/unit/compiler/dce-stdlib-methods.test.js`).
- Each runtime helper is defined once per JS bundle (`test/unit/compiler/shared-helpers.test.js`).
- Every budget in `test/perf/bundle-size.baseline.json` is re-measured, none is above its 1.9.2 value, and the numbers are recorded in this plan.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | One reachability closure over user and Go-source stdlib programs for JS output; pruning of declarations and methods; helpers once per bundle | `js` packages and the JS side of `both` | |
| **Excluded: runtime / platform** | `wasm` output | — | Binaryen prunes release builds; dev-mode `wasm` keeps its stdlib reachability |
| **Excluded: deferred** | Shrinking the `fmt` hello world | `fmt` call-site specialization, runtime-helper slimming | `Println` reaches `printArg` → `fmtFloat` → `strconv` through real call edges, so reachability cannot remove them; needs per-call-site specialization (user decision 2026-11-13) |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6`, 2026-11-17; probes in `.probes/web/` (deleted) with `compileDir`. Review re-probed at `258d4148` / `002e5180`, 2026-11-19.

| Area (Root) | Finding | Evidence & Probe Reference |
|---|---|---|
| User-code DCE (`stdlib-only-reach`) | `StdlibReach` (`src/lower/reachability.js`) indexes stdlib declarations only; unused user code is emitted, and dependency packages emit eagerly in `resolveImports` (`src/compiler.js:383`) before the entry package is checked | Re-probe: `main` calling only `(*Box).Used` next to `UnusedUserFunction`, `(*Box).UnusedMethod` and `type UnusedType` with a method → all three in the output; multi-package `main` importing `./util` (`Used` + `Unused`) → `function Unused` emitted |
| Roots & AST traversal (`incomplete-ast-walk`) | Output has no `export` statements and no `//gofront:export` directive exists; a package without `main` emits everything. `__pm`/`__vm` are read at run time by interface assertions; templ output calls `.Mount(...)` without an AST selector. `forEachChild` (`src/lower/walk.js:11`) uses `Object.keys`, skipping non-enumerable `.templ` expression props (`src/backend/js/templ.js:263`), and `declNames` (`src/lower/reachability.js:31`) omits `TemplDecl`/`CssDecl`; `collectRefs` ignores local package selectors, dot-imports (`import . "./pkg"`, `src/compiler.js:441`), and `_genEntry`. `gofront_gen.go` (`p._generated`) emits `var _ = fmtrt.Register(...)` (`src/lower/fmt-formatters.js:693`) and `var _ = jsonrt.RegisterEncoder(...)` (`src/lower/json-codecs.js:583`) | 2026-11-13 probes (`package lib` without `main` → all emitted); `src/backend/js/runtime.js`, `src/backend/js/templ.js`; 2026-11-19 probe: `forEachChild` on `templ Page` with `if`/`for`/`switch`/`case`/`attr={}`/`@SubComp` visits `[]` (0 idents), missing non-enumerable `expr`, `exprs`, `forStmt` |
| Stdlib method precision (`global-method-names`) | Stdlib reachability is method-level by name only: one global set of selected names plus `IMPLICIT_METHODS` (`src/lower/reachability.js:16`); `computeEmbeddedStubs` (`src/lower/embedding.js:47`) derives `declared` from `methodDecls`, so pruning an outer shadowing method would spuriously promote the inner method | Re-probe: `strings.Builder` with `WriteString` + `String` → class without `Len`/`Reset` (269,661 B with `fmt`; 17,872 B with `println`); adding a user type whose `Len()`/`Reset()` `main` calls → `Builder` also emits `Len` and `Reset` (270,180 B / 18,419 B); 2026-11-19 probe: `SelectorExpr.expr._type` carries base `named` or `pointer`→`named` for generic calls (`Box[int].Val`) and method expressions (`Plain.M`, `(*Plain).P`) |
| Helpers per chunk (`per-chunk-helpers`) | Each package chunk (both user packages in `src/compiler.js` and stdlib packages spliced later by `stdlibJs` in `src/link/stdlib.js:433`) prepends its own copy of every helper it uses (`_prependHelpers`, `src/backend/js/index.js:687`) | Re-probe: `fmt.Println("hello")` bundle 251,135 B (251,103 B at `258d4148` / `002e5180`) with 277 definitions of 77 distinct helpers (1.9.2: 286 of 74) |
| Stdlib footprint | `fmt.Println` hello world 24 kB (1.8.0) → 176 kB (1.9.1); the size is real call edges and helpers, not unpruned methods | `test/perf/bundle-size.baseline.json` `fmt-println`; *Excluded* row |

---

## Approach

### 1. Architecture & Design Decisions
- **One closure:** generalize `StdlibReach` into one package-scoped closure over user and stdlib programs (preserving `reachableStdlibDecls(rootPrograms, stdlibPrograms)` for `src/link/wasm.js:71,138`). Index declarations per package (avoiding collisions between unexported names in different user packages), index `TemplDecl` and `CssDecl` alongside `FuncDecl`/`TypeDecl`/`VarDecl`/`ConstDecl`, resolve local package `SelectorExpr` (`util.Used`), qualified `TypeName` (`util.Box`), and dot-imported local package names (`import . "./util"`, `src/compiler.js:441`) against the imported package, and walk non-enumerable `.templ` expression properties (`expr`, `exprs`, `forStmt`, `attrs[].expr`, see `src/backend/js/templ.js:263-278`).
- **Roots:** (1) `main()` of the entry package, or every exported declaration of an entry package without `main`; (2) `GofrontRunTests` in the generated `gofront_testmain_test.go` driver (`src/cli/test-runner.js:171`) under `gofront test` (even when testing `package main`); (3) exports of `wasm` packages reached through the boundary facade (`wasmExportedSignatures`); (4) `init()` and side-effecting package-level initializers (calls/receives via `hasCallOrReceive` in `src/lower/walk.js:31`) of the entry package and every imported user package, including blank imports `import _ "./pkg"` (the stdlib keeps its current rule); (5) `IMPLICIT_METHODS` and methods the JS backend calls without an AST selector (templ `Mount`); (6) generated code (`gofront_gen.go`, `p._generated === true` from `json-codecs.js`, `fmt-formatters.js`, `errors-as.js`): `collectRefs` follows `node._genEntry` from reached call sites into `gofront_gen.go` so dead user functions do not keep unused codecs, types, or stdlib alive, and `gofront_gen.go` skips root (4) except that `var _ = fmtrt.Register(...)` is reached whenever `internal/fmtrt` (or `fmt`) is reached (covering `fmt` function values and `testing`) and `var _ = jsonrt.RegisterEncoder(...)` is reached whenever `internal/jsonrt` dynamic encoding (`EncodeDynamic`) is reached (covering cross-package `registerOnly` codecs); (7) JS escape: when a value of a user type flows into an external declaration (`checker._externalNames` at `src/typechecker/index.js:142`, which includes `_untypedImports`) or a JS-dynamic `any` (`anyKind(t) === "dynamic"` at `src/typechecker/types.js:628`), all its methods are kept.
- **Interface dispatch:** a method named by a reached interface type is kept on every reached type (existing rule).
- **Receiver-qualified selection:** record selected method names per static receiver type when it is a concrete named type (unwrapping `*T` and generic instantiations to the base named type via `expr._type`, covering method calls, method values and method expressions `T.M`/`(*T).M`), propagating selections transitively through embedded types (`Outer.Used` → `Inner.Used`); selections through interface, type-parameter or `any` receivers and `IMPLICIT_METHODS` stay name-global.
- **Pruning & root assembly:** user-package JS emission (plus `css` and `codegen.warnings` collection) is coordinated at the root compile in `src/compiler.js` once the single closure has run (rather than emitting unpruned dependency JS eagerly inside `resolveImports`). Filter unreached `FuncDecl`s, `TemplDecl`s, `CssDecl`s, `VarDecl`s/`ConstDecl`s (keeping whole `ConstDecl` blocks intact when any spec in an `iota` group is reached so `iota` values never shift), types and methods before JS codegen (as `stdlibJs` does); retained classes omit uncalled methods from the class body, from embedded forwarding stubs (`_genEmbeddedMethodStubs` / `computeEmbeddedStubs`, which checks `resolvedType.methods` rather than the pruned `methodDecls` for shadowing so a pruned outer method never promotes an inner method), and from `__vm`/`__pm`. For named non-struct types (`genNamedTypeClass`, `_genTypeDeclBody`, `_namedBoxInfo` in `src/backend/js/index.js`), keep the box class whenever `_namedBoxInfo` is non-null (reached and boxed into an interface) even if all its methods were pruned.
- **Helpers once:** both user chunks (`src/compiler.js`) and Go-source stdlib chunks (`stdlibJs` in `src/link/stdlib.js:433`) suppress per-chunk `_prependHelpers` and report their helper set (including `HELPER_INJECT_STYLES` when `collectedCss.length > 0`). The root compile prepends the union once **after** `finishStdlibJs` has spliced stdlib chunks, shifting source-map offsets once (`src/link/sourcemap.js`). Direct `CodeGen` callers keep per-call helper emission by default.
- **With the cache:** extend `PackageCache` (from `incremental-builds-plan.md`, which caches immutable checked units and memoizes `stdlibJs` by reached decl set) to memoize emitted JS + helper set + CSS per `(unitKey, sortedReachedDeclIds, keptMethodsKey)`; only the closure is recomputed per build (about 5 ms in the 2026-11-13 profile), and never becomes part of a cache key.

### 2. Invariants & Safety Bounds
- `gofront dev`, `build` and `test` prune identically.
- `x.(I)` gives the same answer as before: `__vm`/`__pm` and embedded forwarding stubs list exactly the emitted methods.
- Every `example/*` and unit-suite program prints the same output.

### 3. Edge Cases & Error Handling
- A method used as a method value or method expression, promoted through embedding (`src/lower/embedding.js`), of a type that escapes to JavaScript, or checked by a runtime interface assertion, is kept; templ `Mount` is kept.
- A function, component, CSS declaration, or stdlib call referenced only inside a `.templ` body (`{ expr }`, `@Comp()`, `for`, `if`, `switch`, `attr={ expr }`) is kept.
- A named non-struct type boxed into `any` whose own methods are all uncalled still emits its box class so `new T(...)` never throws `ReferenceError`.
- An interface method called dynamically (`var r io.Reader; r.Read(...)`) keeps the matching method on every instantiated type.
- A package without `main` keeps its exported declarations; `gofront test` roots at `GofrontRunTests` and keeps every test and benchmark; adding and removing the only call to a function in `gofront dev` gives the same output as a cold build.

---

## Implementation Tasks

> Split from the former `web-platform-evolution-plan.md` Phase 4 (re-probed 2026-11-17, review-tightened 2026-11-19). Former task IDs in parentheses.

### Phase 1: User-code reachability and pruning
- [x] Task 1.1: One package-scoped closure over user and stdlib programs with explicit roots (former 4.1)
  - Files: `src/lower/reachability.js`, `src/link/stdlib.js`, `src/compiler.js`
  - Test: `test/unit/compiler/reachability-user.test.js`: the reached set for each root kind above, including multi-package local selectors (`util.Used`), qualified types (`util.Box`), dot-imports (`import . "./util"`), blank imports (`import _ "./sideeffect"`), `_genEntry` calls into `gofront_gen.go` plus conditional `fmtrt.Register`/`jsonrt.RegisterEncoder` retention, `.templ` non-enumerable expressions (`{ helper() }`, `@Comp()`, `if`/`for`/`switch`/`case`, `attr={}`), `CssDecl`, `GofrontRunTests`, and `checker._externalNames` / `anyKind === "dynamic"` escapes
  - Done when: one closure returns the reached declarations across user and stdlib packages (with `reachableStdlibDecls` unchanged for `src/link/wasm.js`); emitted output is still unchanged (nothing pruned yet)
- [x] Task 1.2: Prune unreferenced functions, templ/css decls, constants, variables and types (former 4.2)
  - Files: `src/lower/reachability.js`, `src/backend/js/index.js`, `src/compiler.js`
  - Test: `test/unit/compiler/dce-funcs.test.js`: the re-probe's `UnusedUserFunction` and `UnusedType` are omitted; multi-package `util.Unused` is omitted while `util.Used` and dot-imported used symbols are kept; a function called only from a `.templ` body is kept; a pruned `CssDecl` emits no CSS; an `iota` `ConstDecl` group keeps correct values; side-effecting package-level `var`s in entry and imported packages are kept; a package without `main` keeps its exports; cross-package `json.Marshal(anyVal)` (`registerOnly`) and `fmt` function values still work; `test/unit/cli/incremental-build.test.js` gains add-then-remove-the-only-call equals a cold build
  - Done when: `gofront test` and every `example/*` print the same output as before
- [x] Task 1.3: Prune uncalled struct and named-type methods (former 4.3)
  - Files: `src/backend/js/index.js`, `src/lower/reachability.js`, `src/lower/embedding.js`
  - Test: `test/unit/compiler/dce-methods.test.js`: an unselected method is absent from the class body, embedded stubs, `__vm` and `__pm`; kept when named by a reached interface, used as a method value/expression, promoted through embedding, or its type escapes to JavaScript; pruning an outer shadowing method never promotes the inner embedded method; a named non-struct type boxed into `any` with all methods pruned still emits its box class
  - Done when: runtime interface assertions and embedded method calls give the same results as before

### Phase 2: Stdlib precision, shared helpers, budgets
- [x] Task 2.1: Receiver-qualified method reachability (former 4.4)
  - Files: `src/lower/reachability.js`, `src/link/stdlib.js` (`reachableStdlibDecls`)
  - Test: `test/unit/compiler/dce-stdlib-methods.test.js`: the re-probe (a user `Len`/`Reset` no longer keeps `strings.Builder.Len`/`Reset`); generic receiver calls (`Box[int].Val`) and method expressions (`T.M`/`(*T).M`) keep the method; promoted method calls propagate transitively to embedded receiver types; selections through interface, type-parameter and `any` receivers still keep the method on every reached type
  - Done when: passes with no output change in the stdlib and `wasm` suites
- [x] Task 2.2: Each runtime helper once per bundle (former 4.5)
  - Files: `src/backend/js/index.js` (`_helpers`, `_prependHelpers`), `src/link/stdlib.js` (`stdlibJs`, `spliceStdlibJs`), `src/link/sourcemap.js`, `src/compiler.js`
  - Test: `test/unit/compiler/shared-helpers.test.js`: each helper (including `HELPER_INJECT_STYLES`) defined once in a `fmt` hello world (277 definitions of 77 on 2026-11-17) and a multi-package program; a helper used by one package or only by stdlib is still emitted; ESM `jsImports` (`example/preact`) still run cleanly; source maps of the second chunk still point at the right lines; a warm `gofront dev` rebuild equals a cold build
  - Done when: no helper is defined twice in any `example/*` bundle and outputs are unchanged
- [x] Task 2.3: Re-measure and tighten the bundle budgets (former 4.6)
  - Files: `test/perf/bundle-size.js`, `test/perf/bundle-size.baseline.json`, `docs/architecture.md`
  - Test: `node test/perf/bundle-size.js` and `--self-test` with new cases for the user-DCE probe program and each JS `example/*` bundle (building `example/preact` from its project dir so vendored imports resolve); `docs/architecture.md` notes that unused user and stdlib code is left out
  - Done when: every budget is at or below its 1.9.2 value, new cases have budgets, and before/after numbers are recorded under this task
  - Measured (`--release` `app.js` bytes; 1.9.2 = tag `1.9.2`, P1 = `6d3a7dc4` after Phase 1, now = after Task 2.2; ceiling = new budget, 1.05x now, old 1.9.2 budget in parens):

    | fixture | 1.9.2 | P1 | now | ceiling (old) |
    |---|---|---|---|---|
    | println | 46 | 46 | 46 | 49 (49) |
    | fmt-println | 168513 | 170951 | 116647 | 122480 (176939) |
    | fmt-sprintf | 175795 | 178453 | 120437 | 126459 (184585) |
    | strconv | 87828 | 89010 | 71218 | 74779 (92220) |
    | strings | 21318 | 22061 | 16253 | 17066 (22384) |
    | json-unmarshal | 266321 | 270266 | 154132 | 161839 (279638) |
    | json-unmarshal-any | 279398 | 283787 | 166567 | 174896 (293368) |
    | json-marshal | 40042 | 40430 | 31451 | 33024 (42045) |
    | multipackage | 175757 | 43639 | 31511 | 33087 (184545) |
    | user-dce (new) | 28632 | 16375 | 12918 | 13564 |
    | example-simple (new) | 241065 | 244979 | 157876 | 165770 |
    | example-gom (new) | 250891 | 256788 | 157162 | 165021 |
    | example-templ (new) | 233722 | 238936 | 156509 | 164335 |
    | example-hybrid (new) | 202516 | 205885 | 145434 | 152706 |
    | example-preact (new) | 400009 | 394156 | 243774 | 255963 |
    | example-webgl (new) | 14512 | 14580 | 14538 | 15265 |

  - `example-webgl` is 26 B above 1.9.2 (14512): the bundle is almost all runtime and not investigated further; it is 42 B below Phase 1. Its budget is new, so no 1.9.2 budget is exceeded.
  - Bundle helper definitions (non-release `fmt.Println("hello")`): 277 definitions of 77 helpers before Task 2.2, 76 of 76 after (`var __x =` helpers); no `example/*` bundle defines a helper twice.
