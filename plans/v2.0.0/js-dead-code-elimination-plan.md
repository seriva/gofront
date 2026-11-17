# JS Dead-Code Elimination — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Split out of the former `web-platform-evolution-plan.md` (its Phase 4) on 2026-11-17, re-probed that day. Starts after [`incremental-builds-plan.md`](incremental-builds-plan.md): pruning selects among its cached per-declaration output and cached units store their helper set. Holds the deferred size work of `../v1.9.2/release-bundle-fixes-plan.md` and the shared runtime helpers of `../v1.9.3/js-codegen-fixes-plan.md`.  
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

**Method.** `main` at `4eb69a6`, 2026-11-17; probes in `.probes/web/` (deleted) with `compileDir`.

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| User-code DCE | `StdlibReach` (`src/lower/reachability.js`) indexes stdlib declarations only; unused user code is emitted | Re-probe: `main` calling only `(*Box).Used` next to `UnusedUserFunction`, `(*Box).UnusedMethod` and `type UnusedType` with a method → all three in the output |
| Roots | Output has no `export` statements and no `//gofront:export` directive exists; a package without `main` emits everything. `__pm`/`__vm` are read at run time by interface assertions; templ output calls `.Mount(...)` without an AST selector | 2026-11-13 probes (`package lib` without `main` → all emitted); `src/backend/js/runtime.js`, `src/backend/js/templ.js`. Roots therefore cannot be "`main` + an export directive" only |
| Stdlib method precision | Stdlib reachability is method-level by name only: one global set of selected names plus `IMPLICIT_METHODS` (`src/lower/reachability.js:16`) | Re-probe: `strings.Builder` with `WriteString` + `String` → class without `Len`/`Reset` (269,661 B); adding a user type whose `Len()`/`Reset()` `main` calls → `Builder` also emits `Len` and `Reset` (270,180 B) |
| Helpers per chunk | Each package chunk prepends its own copy of every helper it uses (`_prependHelpers`, `src/backend/js/index.js:687`) | Re-probe: `fmt.Println("hello")` bundle 251,135 B with 277 definitions of 77 distinct helpers (1.9.2: 286 of 74) |
| Stdlib footprint | `fmt.Println` hello world 24 kB (1.8.0) → 176 kB (1.9.1); the size is real call edges and helpers, not unpruned methods | `test/perf/bundle-size.baseline.json` `fmt-println`; *Excluded* row |

---

## Approach

### 1. Architecture & Design Decisions
- **One closure:** generalize `StdlibReach` into one closure over user and stdlib programs.
- **Roots:** (1) `main()` of the entry package, or every exported declaration of an entry package without `main`; (2) the generated test main under `gofront test`; (3) exports of `wasm` packages reached through the boundary facade (`wasmExportedSignatures`); (4) `init()` and side-effecting package-level initializers of every imported user package (the stdlib keeps its current rule); (5) `IMPLICIT_METHODS` and methods the JS backend calls without an AST selector (templ `Mount`); (6) declarations referenced by generated code (`json-codecs.js`, `fmt-formatters.js`, `errors-as.js`): reachability runs after those passes or takes their output as roots; (7) JS escape: when a value of a user type flows into an external declaration (`.d.ts` or typed-web function or property), all its methods are kept.
- **Interface dispatch:** a method named by a reached interface type is kept on every reached type (existing rule).
- **Receiver-qualified selection:** record selected method names per static receiver type when it is a concrete named type; selections through interface, type-parameter or `any` receivers and `IMPLICIT_METHODS` stay name-global.
- **Pruning:** filter unreached `FuncDecl`s, types and methods before JS codegen, as `stdlibJs` does; retained classes omit uncalled methods from the class body and from `__vm`/`__pm`.
- **Helpers once:** chunks report their helper set; the bundle emits the union once ahead of the first chunk (`mergeCompilationChunks`, `src/link/sourcemap.js:25`, shifting source-map offsets). Cached units store their helper set next to their emitted JS.
- **With the cache:** pruning selects among cached per-declaration output; only the closure is recomputed per build (about 5 ms in the 2026-11-13 profile), and never becomes part of a cache key.

### 2. Invariants & Safety Bounds
- `gofront dev`, `build` and `test` prune identically.
- `x.(I)` gives the same answer as before: `__vm`/`__pm` list exactly the emitted methods.
- Every `example/*` and unit-suite program prints the same output.

### 3. Edge Cases & Error Handling
- A method used as a method value or method expression, promoted through embedding (`src/lower/embedding.js`), of a type that escapes to JavaScript, or checked by a runtime interface assertion, is kept; templ `Mount` is kept.
- An interface method called dynamically (`var r io.Reader; r.Read(...)`) keeps the matching method on every instantiated type.
- A package without `main` keeps its exported declarations; `gofront test` keeps every test and benchmark; adding and removing the only call to a function in `gofront dev` gives the same output as a cold build.

---

## Implementation Tasks

> Split from the former `web-platform-evolution-plan.md` Phase 4 (re-probed 2026-11-17). Former task IDs in parentheses.

### Phase 1: User-code reachability and pruning
- [ ] Task 1.1: One closure over user and stdlib programs with explicit roots (former 4.1)
  - Files: `src/lower/reachability.js`, `src/lower/index.js`, `src/link/stdlib.js`
  - Test: `test/unit/compiler/reachability-user.test.js`: the reached set for each root kind above
  - Done when: one closure returns the reached declarations; emitted output is still unchanged (nothing pruned yet)
- [ ] Task 1.2: Prune unreferenced functions, constants, variables and types (former 4.2)
  - Files: `src/lower/reachability.js`, `src/backend/js/index.js`
  - Test: `test/unit/compiler/dce-funcs.test.js`: the re-probe's `UnusedUserFunction` and `UnusedType` are omitted; a side-effecting package-level `var` is kept; a package without `main` keeps its exports; `incremental-build.test.js` gains add-then-remove-the-only-call equals a cold build
  - Done when: `gofront test` and every `example/*` print the same output as before
- [ ] Task 1.3: Prune uncalled struct methods (former 4.3)
  - Files: `src/backend/js/index.js`, `src/lower/reachability.js`
  - Test: `test/unit/compiler/dce-methods.test.js`: an unselected method is absent from the class body, `__vm` and `__pm`; kept when named by a reached interface, used as a method value, promoted, or its type escapes to JavaScript
  - Done when: runtime interface assertions give the same results as before

### Phase 2: Stdlib precision, shared helpers, budgets
- [ ] Task 2.1: Receiver-qualified method reachability (former 4.4)
  - Files: `src/lower/reachability.js`, `src/link/stdlib.js` (`reachableStdlibDecls`)
  - Test: `test/unit/compiler/dce-stdlib-methods.test.js`: the re-probe (a user `Len`/`Reset` no longer keeps `strings.Builder.Len`/`Reset`); selections through interface, type-parameter and `any` receivers still keep the method on every reached type
  - Done when: passes with no output change in the stdlib suite
- [ ] Task 2.2: Each runtime helper once per bundle (former 4.5)
  - Files: `src/backend/js/index.js` (`_helpers`, `_prependHelpers`), `src/link/sourcemap.js` (`mergeCompilationChunks`), `src/compiler.js`
  - Test: `test/unit/compiler/shared-helpers.test.js`: each helper defined once in a `fmt` hello world (277 definitions of 77 on 2026-11-17) and a multi-package program; a helper used by one package is still emitted; source maps of the second chunk still point at the right lines; a warm `gofront dev` rebuild equals a cold build
  - Done when: no helper is defined twice in any `example/*` bundle and outputs are unchanged
- [ ] Task 2.3: Re-measure and tighten the bundle budgets (former 4.6)
  - Files: `test/perf/bundle-size.js`, `test/perf/bundle-size.baseline.json`
  - Test: `node test/perf/bundle-size.js` and `--self-test` with new cases for the user-DCE probe program and each JS `example/*` bundle; `docs/` notes that unused code is left out
  - Done when: every budget is at or below its 1.9.2 value, new cases have budgets, and before/after numbers are recorded under this task
