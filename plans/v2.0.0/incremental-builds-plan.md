# Incremental Builds — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Split out of the former `web-platform-evolution-plan.md` (its Phase 3 and Task 2.4) on 2026-11-17, re-probed that day and reviewed/tightened on 2026-11-19. Starts after [`go-embed-plan.md`](go-embed-plan.md) (embedded files are cache-key inputs and watch targets), [`package-scope-plan.md`](package-scope-plan.md) (rebinds imports per file in `src/compiler.js`/`typechecker/index.js`) and [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md) Phase 1 (changes `mangleLocalTypes` in `src/compiler.js`). [`js-dead-code-elimination-plan.md`](js-dead-code-elimination-plan.md) builds on this cache. Fixes `test-harness-hardening-plan.md` G7 (shared `stdlibCache`) and `checker-strictness-plan.md` S22 (import cycles).  
**Release note:** `gofront dev` now reuses unchanged packages on rebuilds so saves finish in a fraction of the time, and also reloads when an embedded file or `.d.ts` file changes. Import cycles are now reported as compile errors naming the cycle path instead of crashing.  

---

## Goal

Keep compiled packages (user and Go-source stdlib) in a process-lifetime `PackageCache` of immutable units keyed by their full inputs, and memoize emitted stdlib JS per reached declaration set, so a warm `gofront dev` rebuild re-checks and re-emits only the edited package and its affected importers, with output byte-identical to a cold build. Build a package dependency graph first, turning import cycles into compile errors while preserving per-build diamond deduplication.

**Done means:**
- A warm `gofront dev` rebuild after a one-file edit re-checks and re-emits only the edited package and its affected importers and no Go-source stdlib package (cache counters in `test/unit/cli/incremental-build.test.js`), produces output byte-identical to a cold build including source maps (`test/unit/compiler/package-cache.test.js`, `test/unit/compiler/incremental-sourcemap.test.js`), and takes < 25 ms median for `example/gom` and `example/simple` on the JS target (`test/perf/dev-rebuild.js`, wired into `npm run bench`; about 270–300 ms on 2026-11-17).
- An import cycle is a compile error naming the import path across `gofront check`, `build`, `dev`, `test`, and single-file builds, and a three-layer diamond compiles each package once per build (`test/unit/compiler/import-cycles.test.js`).
- Editing an embedded file or a `js:` `.d.ts` file triggers a rebuild that invalidates only its package (`test/unit/cli/dev-server-embed.test.js`), and `docs/usage.md` describes the dev loop.
- Cached units pass deep-freeze checks across consecutive builds (`test/unit/compiler/ast-reusability.test.js`), the unit tests that failed with a shared `stdlibCache` (`test-harness-hardening-plan.md` G7) pass with `PackageCache` enabled by default, and `npm test` passes.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Package dependency graph (`no-package-dag`), immutable cached compilation units & per-package counters (`ast-unit-mutation`), memoized stdlib JS emission (`stdlib-js-reemit`), process-lifetime `PackageCache` (`per-build-cache-reset`), package-level invalidation & watcher inputs in `gofront dev` (`watcher-extension-filter`) | `PackageCache`, import cycles, diamonds, deep-frozen units, watcher inputs (`.go`, `.templ`, `.d.ts`, embedded files) | |
| **Excluded: deferred** | Declaration-level pruning and per-declaration JS emission on the cached output | user-code DCE, helpers once per bundle | [`js-dead-code-elimination-plan.md`](js-dead-code-elimination-plan.md), which introduces user reachability and declaration-level pruning on top of this cache |
| **Excluded: deferred** | Incremental `wasm` builds | `hybrid` 416 ms (2026-11-13) | The 25 ms budget is for the JS target; `wasm` links one module per build |
| **Excluded: deferred** | Live watching `gofront.json` in `gofront dev` | editing `gofront.json` target overrides while `dev` is running | `createSrcWatcher` watches `srcDir` only and `handleDev` reads `gofront.json` once at startup; `targetOverrides` changes are covered in the `PackageCache` key |

---

## Verified Gaps & Baseline Audit

**Method.** Baseline from `main` at `4eb69a6` (2026-11-17; probes in `.probes/web/`, deleted) and review re-probes on 2026-11-19 (`main` at `732c2f39` / `feat/checker-go-rules`). Timing: in-process `compileDir` / `runCompile` with `{ sourceMap: true }`, one file's mtime bumped per build.

### Root `per-build-cache-reset`
| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Watch rebuild latency | `runDevBuild` re-runs `runCompile` from scratch on every save; only the bounded per-file parse cache survives | `src/cli/cli-core.js:1238`; `PARSE_CACHE_LIMIT = 16` (`src/compiler.js:78`) evicts stdlib sources. 2026-11-17: `gom` 269–303 ms, `simple` 271–282 ms warm |
| Stdlib recompiled per build | `stdlibCache: options.stdlibCache ?? new Map()` is per root compile, so every build re-parses and re-checks Go-source stdlib | `src/compiler.js:542`. Sharing `stdlibCache` cut a `json` compile from 254 ms to 6 ms (2026-11-13) but ≥ 4 unit tests fail because later passes mutate cached packages (`test-harness-hardening-plan.md` G7); `stdlibVariant` (`src/link/stdlib.js:326`) also ignores `natives` and `stdlibRoot` |

### Root `stdlib-js-reemit`
| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| `stdlibJs` re-emits on every build | Even with a warm shared `stdlibCache`, `spliceStdlibJs` re-runs `reachableStdlibDecls` and `new CodeGen(...).generateAll(filteredPrograms)` for every stdlib package on every build; `example/gom` has one user package, so user-package caching alone cannot reach 25 ms | `src/link/stdlib.js:433-498`. Probe 2026-11-19 (`compileDir` × 6 with shared `stdlibCache`, `sourceMap: true`): `example/gom/src` **70–94 ms**, `example/simple/src` **58–65 ms** (control: minimal no-stdlib package **1.6 ms**) |

### Root `ast-unit-mutation`
| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Lazy stdlib checking mutates cached ASTs | `decl._ensure()` lazily runs `probe.checkBody`, `mangleBody`, `checker.checkBody`, and `lowerStdlibRefs` on cached stdlib declarations when a later build reaches a new body | `src/link/stdlib.js:253-269`. Probe 2026-11-19: `deepFreeze` on `stdlibCache` after `sync.Mutex` / `sort.Ints`, then compiling `sync.RWMutex` / `sort.Strings` → `InternalCompilerError: Cannot assign to read only property 'name'` (`src/compiler.js:688`) / `TypeError: Cannot add property _typeRefOk, object is not extensible` (`src/typechecker/expressions.js:2133`) |
| `CodeGen.generateAll` & lowering mutate ASTs in place | `CodeGen.generateAll` / `CodeGen.generate` and the passes it invokes write ~20 properties onto AST nodes and splice statements in place: `decl._srcFileIdx` and `decl._pkgName` (`src/backend/js/index.js:363,710-711`), `_renameReservedIdents` (`_jsRenamed`, `Ident.name`, `FuncDecl.name`, `MethodDecl.recvName`, `Param.name`, `spec.names`, `_goName`, `_isStructKey` at `src/backend/js/index.js:367,433-582`), `markInBoundsIndexes` / `markRedundantNilChecks` (`_inBounds`, `_nonNil` at `src/lower/bounds.js:128,284,361,534`), expression/statement/templ codegen flags (`_complexWrapping`, `_ifaceKeying`, `_mapKeying`, `_pbsWrapping`, `_tpBoxing`, `_tfnTagging`, `_gmapTagging`, `_ityTagging`, `_ifaceBoxing`, `_isAddressOf`, `_callee` at `src/backend/js/expressions.js:642-784,951-959,1292,1639-1641,2218`; `_selfReslice`, `_initPre` at `src/backend/js/statements.js:707,1459`; `_className` at `src/backend/js/templ.js:63`), `splitForwardedTuples` / `normalizeDefers` / `hasDirectRecover` (`_hasDirectRecover` and `Block.stmts` splices at `src/lower/functions.js:50,54,396`), and `getOrCreateIteratorFuncLit` (`_iterStateName`, `_yieldFuncLit` at `src/lower/range.js:53,88`) | Proxy-tracked AST-write probe 2026-11-19 on `CodeGen.generateAll` (`target: "both", strict: true`); `deepFreeze` on `stdlibCache` then recompiling `fmt.Println` → `TypeError: Cannot assign to read only property '_srcFileIdx'` at `src/backend/js/index.js:710`. Boundary structural `cloneAst` (`src/link/wasm.js:117`) benchmark 2026-11-19: `example/gom/src` (5 user programs) **0.92 ms** on cache miss, **0 ms** on warm cache / `stdlibJs` hits |
| Front-end passes mutate `_parseCache` ASTs | `mangleCollidingTypes`/`renameLocalTypes` (`src/link/type-names.js:28-127`, called from `mangleLocalTypes` at `src/compiler.js:773`), `_resolveArrayTypeNode` (`src/typechecker/resolve.js:554-561`), and `p.target = pkgTarget` (`src/compiler.js:610`) mutate `_parseCache` ASTs in place (`mangleLocalTypes` evicts `_parseCache` only when a type is renamed, leaving lowering and `CodeGen._renameReservedIdents` mutations on cached ASTs) | `src/compiler.js:160-187,610,773-808` |
| Generic instantiation mutates exported types | `TypeChecker.instantiateGenericWithArgs` writes `_instances`, `_building`, `_buildSizes`, and `_cycleReported` directly onto the `generic` type descriptor exported by an imported package | `src/typechecker/resolve.js:777-806` |
| Module-global counters break byte-identity | `localTypeCounter` (`src/link/type-names.js:61`) and `iterStateCounter` (`src/lower/range.js:7`) increment across compiles in one process without resetting, producing different synthetic names between cached and cold builds. Controls: `defargCounter` (`src/lower/functions.js:55`), `fwdCounter` (`src/lower/functions.js:397`), and `recvCounter` (`src/backend/wasm/method-expr.js:363`) already reset per pass; `nextDeclId` (`src/typechecker/resolve.js:45,131`) only keys internal `generic._instances` lookups and never appears in emitted code | Code inspection & grep 2026-11-19 |

### Root `no-package-dag`
| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Local import cycles | `resolveImports` recurses into `compileDir` with no in-progress stack | `src/compiler.js:244,383`. Re-probe: `main → a → b → a` → `RangeError: Maximum call stack size exceeded` (`checker-strictness-plan.md` S22) |
| Sibling paths | `compileSingleFile` (`main.go → ./a → ..`) and `compilePackageTests` (`_test.go` importing a cycle) share `resolveImports`; in `gofront check ./...`, `e.packageDir` (`src/compiler.js:392-393`, `src/cli/cli-core.js:595-597`) must not turn cycle members into `skipped` | `src/compiler.js:383-395`, `510-528` |
| Controls | Diamond imports are already deduplicated per build by `depCache` (commit `4766b44f`); Go-source stdlib already detects cycles with an in-progress `null` sentinel | `src/compiler.js:379-397`; `src/link/stdlib.js:347-348` |

### Root `watcher-extension-filter`
| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Watcher ignores `.d.ts` and embedded files | `createSrcWatcher` reacts to `.css`, `.go` and `.templ` extensions only, and branches on `.css` before the rebuild branch (so an embedded `.css` file would only trigger `onCss` and never `onRebuild`) | `src/cli/cli-core.js:1287-1296` |

---

## Approach

### 1. Architecture & Design Decisions
- **Dependency graph (`src/compiler.js`):** Build a package-level DAG of direct and transitive local imports before checking (seeding the root package directory so `compileSingleFile` and `compilePackageTests` cycles are caught too). A cycle raises a `CompileError` with Go's `import cycle not allowed` and the path (`a imports b imports a`) with line:col at the first import of the cycle, without mis-tagging cycle members as `skipped` in `gofront check`. Preserve per-build diamond deduplication (`depCache`).
- **Immutability & deterministic names:** Stored units are never mutated by a later build.
  - Isolate AST writes at cache boundaries via a shared structural `cloneAst` (promoted from `cloneAstForWasm` in `src/link/wasm.js:117` to `src/lower/walk.js`, creating fresh node shells while sharing `_`-prefixed side references; 0.92 ms on `example/gom/src` on cache miss, 0 ms on warm cache hits):
    1. `parseGoFrontFile` (`src/compiler.js:160-187`) clones the stored baseline AST on checkout from `_parseCache`, so `mangleCollidingTypes`, `renameLocalTypes`, `_resolveArrayTypeNode`, `p.target`, `lower()`, and `CodeGen` never mutate cached baseline ASTs (and `mangleLocalTypes` no longer needs to evict `_parseCache` at `src/compiler.js:805-806`).
    2. Lazy stdlib `decl._ensure()` (`src/link/stdlib.js:253-269`) clones the reached `probeDecl` and `decl` before `probe.checkBody`, `mangleBody`, `checker.checkBody`, and `lowerStdlibRefs`, storing the checked declaration in a side `Map<origDecl, checkedDecl>` (which `StdlibReach` and `stdlibJs` read) without writing to frozen `pkg.unit.programs`.
    3. `stdlibJs` (`src/link/stdlib.js:433-444`) clones the filtered reached declarations on a `stdlibJs` memoization miss before `new CodeGen(...).generateAll(...)`, so `CodeGen` and lowering passes (`_srcFileIdx`, `_pkgName`, `_renameReservedIdents`, `markInBoundsIndexes`, `markRedundantNilChecks`, `splitForwardedTuples`, `normalizeDefers`, etc.) never touch frozen cached stdlib ASTs.
  - `TypeChecker.instantiateGenericWithArgs` (`src/typechecker/resolve.js:777-806`) stores `_instances`, `_building`, `_buildSizes`, and `_cycleReported` in `TypeChecker`-owned `Map` state keyed by the generic type object instead of mutating the exported `generic` descriptor on cached units.
  - Synthetic counters that did not reset (`localTypeCounter` in `src/link/type-names.js:61`, `iterStateCounter` in `src/lower/range.js:7`) are reset per package / per `lower()` call (matching `defargCounter`, `fwdCounter`, and `recvCounter`) so cached and cold builds emit byte-identical identifiers.
  - Tests deep-freeze stored units under a test flag to enforce zero post-store writes.
- **Memoized `stdlibJs` (`src/link/stdlib.js`):** Cache emitted stdlib JS keyed by `(pkg.key, sortedReachedDeclIds, natives)` inside `PackageCache`, so `spliceStdlibJs` skips `CodeGen.generateAll` when the reached set for a stdlib package is unchanged (bringing warm `gom`/`simple` rebuilds under 25 ms without changing JS backend architecture; per-declaration JS emission remains in `js-dead-code-elimination-plan.md`).
- **`PackageCache` (`src/compiler.js`, `src/link/stdlib.js`):** Process-lifetime cache (used by dev server and unit-test workers), holding user and Go-source stdlib units and replacing the per-compile `stdlibCache` default (`src/compiler.js:542`) once immutability lands. Each unit caches its baseline parsed ASTs, exported symbol/type/const/kind summaries + `elemAddrTaken` (hashed so importers skip re-checking when unchanged), declared top-level type names (to re-populate `typeOwners` deterministically), and emitted JS/CSS/mappings.
- **Cache key:** Per package: `path + mtimeMs + size` of every source file, its `js:` `.d.ts` imports, and its embedded files; resolved target; output-changing options (`sourceMap`, `forceTarget`, `targetOverrides`, `natives`, `stdlibRoot`, `strict`, `isTest`, `wasmTests`, `includeTests`, `testDriver`); direct dependency summary hashes (including `dep.elemAddrTaken`); and the set of colliding type names from `typeOwners`. A failed compile is never stored.
- **Invalidation & watcher (`src/cli/cli-core.js`):** `runDevBuild` passes the process-lifetime `PackageCache` through `runCompile`; a changed file invalidates its package and re-checks importers only when a dependency's summary hash changed. `compileFiles` returns the package's watched non-Go inputs (embedded files and `js:` `.d.ts` files), and `createSrcWatcher` triggers a rebuild when any watched file changes (including an embedded `.css` file, checked before the CSS-only branch).
- **Budget:** Deterministic cache counters are asserted in unit tests; the 25 ms figure is asserted by `test/perf/dev-rebuild.js` (median of 20 warm rebuilds, added to `npm run bench` in `package.json`, not `npm test`).

### 2. Invariants & Safety Bounds
- A cached build is byte-identical to a cold build, including source maps and synthetic identifier names.
- A unit stored in `PackageCache` is immutable (enforced by deep-freeze tests).
- `gofront build` output is unchanged.
- Layering: `cli/` → `compiler.js` → `link/` / `typechecker/` / `lower/` / `backend/` (`npm run check:layers`).

### 3. Edge Cases & Error Handling
- A file added to, removed from, or renamed in a package; a changed `.d.ts` or embedded file (including an embedded `.css` file); two builds with different `targetOverrides`, `forceTarget`, `natives`, `stdlibRoot`, or `strict` options in one process; a build that fails and is then fixed (the failed unit is never stored or served).
- Two local packages declaring the same top-level type name (`type Pt struct{}`): reusing one from cache still re-populates `typeOwners` and keys on collisions so the flat JS bundle never collides and stays byte-identical to a cold build.
- An edit that introduces an import cycle reports it; an edit that removes it rebuilds normally. Cycles are reported in `gofront check`, `build`, `dev`, `test`, and single-file builds, for self-imports, 2-package (`a ↔ b`), and longer cycles.

---

## Implementation Tasks

> Split from the former `web-platform-evolution-plan.md` Phase 3 and Task 2.4 (re-probed 2026-11-17, reviewed/re-probed 2026-11-19). Former task IDs in parentheses.

### Phase 1: Package dependency graph and immutable ASTs
- [x] Task 1.1: Package dependency graph, import cycles, and diamond preservation (former 3.1, graph half)
  - Files: `src/compiler.js`
  - Test: `test/unit/compiler/import-cycles.test.js`: self-import, 2-package cycle (`a → b → a`, covering `checker-strictness-plan.md` S22), `a → b → c → a`, `compileSingleFile` (`main.go → ./a → ..`), and `compilePackageTests` (`_test.go` cycle) give `import cycle not allowed` with path and line:col (not `Maximum call stack size exceeded`); `gofront check` reports cycle members as failed rather than `skipped`; a three-layer diamond compiles each package once (counter)
  - Done when: all pass and `npm test` passes
- [x] Task 1.2: Boundary AST cloning for `_parseCache` and shared `cloneAst` (former 3.2, front-end half)
  - Files: `src/lower/walk.js`, `src/link/wasm.js`, `src/compiler.js`
  - Test: `test/unit/compiler/ast-reusability.test.js`: deep-freezing raw ASTs stored in `_parseCache` and compiling twice in one process with function-local types, cross-package colliding types (`type Pt`), folded array lengths, JS-reserved identifiers (`class := 1`), `defer`, forwarded multi-value calls (`g(f())`), and strict-mode slice indexing succeeds without mutation errors and leaves cached baseline ASTs untouched
  - Done when: `cloneAst` in `src/lower/walk.js` replaces `cloneAstForWasm` in `src/link/wasm.js:117`, `parseGoFrontFile` returns a structural clone from `_parseCache`, and deep-frozen `_parseCache` entries are never mutated
- [x] Task 1.3: Per-package synthetic counters and checker-owned generic instantiation state (former 3.2, counters/generics half)
  - Files: `src/link/type-names.js`, `src/lower/range.js`, `src/typechecker/resolve.js`
  - Test: extend `test/unit/compiler/ast-reusability.test.js` with function-local types, range-over-func, and a frozen exported generic type (`type Box[T any] struct{ V T }`) instantiated across two compiles: consecutive compiles in one process emit byte-identical synthetic names (`localTypeCounter`, `iterStateCounter`) and never write `_instances`/`_building`/`_buildSizes`/`_cycleReported` onto the frozen generic type descriptor
  - Done when: `localTypeCounter` and `iterStateCounter` reset per package / `lower()` call, and `instantiateGenericWithArgs` stores instantiation state in `TypeChecker`-owned maps

### Phase 2: Immutable `PackageCache` and cached stdlib JS
- [ ] Task 2.1: Immutable stdlib units and memoized `stdlibJs` emission (former 3.2, stdlib/codegen half)
  - Files: `src/link/stdlib.js`
  - Test: extend `test/unit/compiler/ast-reusability.test.js`: deep-freezing cached stdlib units (`programs`, `exportedTypes`, `namespace`) after compiling `sync.Mutex` + `fmt.Println` + `sort.Ints`, then compiling `sync.RWMutex`, `sort.Strings`, `slices.Sort`, and `encoding/json` (JS and `both`/`wasm`), succeeds without mutation errors and produces output byte-identical to cold builds; `stdlibJs` memoization counter hits on unchanged reached sets
  - Done when: `decl._ensure()` checks/mangles cloned declarations in a side map without mutating frozen `pkg.unit.programs`, `stdlibJs` clones filtered reached declarations on a memoization miss before `CodeGen.generateAll`, and `stdlibJs` memoizes emitted JS by `(pkg.key, reachedDeclIds, natives)`
- [ ] Task 2.2: `PackageCache` with complete cache key and `typeOwners` tracking (former 3.1, cache half)
  - Files: `src/compiler.js`, `src/link/stdlib.js`
  - Test: `test/unit/compiler/package-cache.test.js`: hit/miss counters; key covers source files (`mtimeMs + size`), `js:` `.d.ts` imports, embedded files, resolved target, output options (`sourceMap`, `forceTarget`, `targetOverrides`, `natives`, `stdlibRoot`, `strict`, `isTest`, `wasmTests`, `includeTests`, `testDriver`), dependency summary hashes (`elemAddrTaken`), and `typeOwners` collisions; file added, removed, or renamed; failed compile is never stored
  - Done when: `PackageCache` holds user and Go-source stdlib units, exports a reset helper for tests, and cached builds are byte-identical to cold builds
- [ ] Task 2.3: Switch `compileFiles` default to process-lifetime `PackageCache` and verify G7
  - Files: `src/compiler.js`, `src/link/stdlib.js`
  - Test: `test/unit/compiler/ast-reusability.test.js` with deep-freeze flag enabled on the default cache; run G7 unit tests (`test/unit/stdlib/sync.test.js`, `test/unit/stdlib/sort.test.js`, full `npm test`)
  - Done when: `compileFiles` uses `PackageCache` by default (replacing `stdlibCache: options.stdlibCache ?? new Map()` at `src/compiler.js:542`), deep-freeze checks pass, and `npm test` passes with zero G7 failures

### Phase 3: Incremental `gofront dev`
- [ ] Task 3.1: Package-level incremental rebuild in `gofront dev` and rebuild benchmark (former 3.3)
  - Files: `src/cli/cli-core.js`, `src/compiler.js`, `package.json`, `test/perf/dev-rebuild.js`
  - Test: `test/unit/cli/incremental-build.test.js`: a one-file edit re-checks only the edited package and importers whose dependency summary changed, re-checks no stdlib unit, and equals a cold build
  - Done when: the counters hold and `node test/perf/dev-rebuild.js` (added to `npm run bench`) reports < 25 ms median for `example/gom` and `example/simple`. If the budget is missed, stop and report the measured number; do not loosen it silently
- [ ] Task 3.2: Source maps across incremental rebuilds (former 3.4)
  - Files: `src/link/sourcemap.js`, `src/compiler.js`, `src/link/stdlib.js`
  - Test: `test/unit/compiler/incremental-sourcemap.test.js`: mappings after three incremental edits equal a cold build's (cached unit mappings and `spliceStdlibJs` line shifts do not accumulate across rebuilds)
  - Done when: passes
- [ ] Task 3.3: Watch embedded files and `.d.ts` imports in `gofront dev` and update docs (former 2.4)
  - Files: `src/cli/cli-core.js` (`createSrcWatcher`, `setupDevWatchers`), `docs/usage.md`
  - Test: `test/unit/cli/dev-server-embed.test.js`: modifying an embedded file (any extension, e.g. `asset.txt` or an embedded `.css` file) or a `js:` `.d.ts` file triggers a rebuild that invalidates only its package
  - Done when: editing `asset.txt`, an embedded `.css` file, or a `js:` `.d.ts` file triggers a rebuild in `gofront dev`, and `docs/usage.md` describes the dev loop
