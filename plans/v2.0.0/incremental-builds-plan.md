# Incremental Builds — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Split out of the former `web-platform-evolution-plan.md` (its Phase 3 and Task 2.4) on 2026-11-17, re-probed that day. Starts after [`go-embed-plan.md`](go-embed-plan.md) (embedded files are cache-key inputs and watch targets), [`package-scope-plan.md`](package-scope-plan.md) (rebinds imports per file in `src/compiler.js`/`typechecker/index.js`) and [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md) Phase 1 (changes `mangleLocalTypes` in `src/compiler.js`). [`js-dead-code-elimination-plan.md`](js-dead-code-elimination-plan.md) builds on this cache. Fixes `test-harness-hardening-plan.md` G7 (shared `stdlibCache`) and `checker-strictness-plan.md` S22 (import cycles).  
**Release note:** `gofront dev` rebuilds after a save in a fraction of the time by reusing every package that did not change, also reloads when an embedded file or a `.d.ts` file changes, and an import cycle is now reported as an error naming the import path instead of crashing.  

---

## Goal

Keep compiled packages (user and Go-source stdlib) in a process-lifetime `PackageCache` keyed by their inputs, so a warm `gofront dev` rebuild re-checks and re-emits only the edited package and its importers, with output byte-identical to a cold build. Build a package dependency graph first, which also turns import cycles into compile errors and compiles a shared dependency once per build.

**Done means:**
- A warm `gofront dev` rebuild after a one-file edit re-checks and re-emits only the edited package and its importers and no Go-source stdlib package (cache counters in `test/unit/cli/incremental-build.test.js`), produces output byte-identical to a cold build (`test/unit/compiler/package-cache.test.js`), and takes < 25 ms median for `example/gom` and `example/simple` on the JS target (`test/perf/dev-rebuild.js`; about 270–300 ms on 2026-11-17).
- An import cycle is a compile error naming the import path, and a package imported by several packages is compiled once per build (`test/unit/compiler/import-cycles.test.js`).
- Editing an embedded file or a `js:` `.d.ts` file triggers a rebuild (`test/unit/cli/dev-server-embed.test.js`).
- The unit tests that fail with a shared `stdlibCache` (`test-harness-hardening-plan.md` G7) pass with it; `npm test` passes.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Package dependency graph, process-lifetime cache of immutable compiled units, package-level invalidation in `gofront dev` | `PackageCache`, import cycles, diamonds, watcher inputs | |
| **Excluded: deferred** | Declaration-level pruning on the cached output | user-code DCE, helpers once per bundle | [`js-dead-code-elimination-plan.md`](js-dead-code-elimination-plan.md), which selects among this plan's per-declaration output |
| **Excluded: deferred** | Incremental `wasm` builds | `hybrid` 416 ms (2026-11-13) | The 25 ms budget is for the JS target; `wasm` links one module per build |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6`, 2026-11-17; probes in `.probes/web/` (deleted). Timing: in-process `runCompile(src, true, { sourceMap: true })`, one file's mtime bumped per build, last 4 of 6 builds.

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Watch rebuild latency | `runDevBuild` re-runs `runCompile` from scratch on every save; only the per-file parse cache survives | `src/cli/cli-core.js:1171`. Re-probe 2026-11-17: `gom` 269–303 ms, `simple` 271–282 ms warm (2026-11-13: 157 ms and 196 ms; the stricter checker made builds slower). 2026-11-13 profile of a warm `gom` rebuild: `backend/js` 26 ms, `lower/*` 27 ms, `typechecker/*` 30 ms, lexer + parser 15 ms, `link/stdlib.js` 8 ms, GC/other 28 ms |
| Stdlib recompiled per build | `gom` has one user package, so almost all of a rebuild is the Go-source stdlib; user-package invalidation alone cannot reach 25 ms | `PARSE_CACHE_LIMIT = 16` (`src/compiler.js:78`) evicts stdlib sources; `stdlibCache: options.stdlibCache ?? new Map()` (`:522`) is per root compile. Sharing it cut a `json` compile from 254 ms to 6 ms (2026-11-13) but ≥ 4 unit tests fail because later passes mutate cached packages (`test-harness-hardening-plan.md` G7) |
| AST mutation | ASTs are mutated during checking and lowering (`mangleLocalTypes`/`renameLocalTypes`, array-length folding in `_resolveArrayTypeNode`, lowering), so they cannot be reused across builds | `src/compiler.js` (`mangleLocalTypes`, `:737`); `plans/v1.9.1/follow-ups-2026-11-10-plan.md:109` (AST cloning rejected) |
| Import cycles | `resolveImports` recurses with no in-progress set | `src/compiler.js:244`. Re-probe: `main → a → b → a` → `Maximum call stack size exceeded` |
| Watcher inputs | `createSrcWatcher` reacts to `.css`, `.go` and `.templ` only | `src/cli/cli-core.js:1220` |

---

## Approach

### 1. Architecture & Design Decisions
- **Dependency graph:** build a package-level DAG of direct and transitive imports before checking. A cycle reports Go's `import cycle not allowed` with the path (`a imports b imports a`) at the first import of the cycle; each package is compiled once per build however many packages import it.
- **`PackageCache`** in `src/compiler.js`, living for the process (dev server, unit-test workers), holding user and Go-source stdlib units and replacing the per-compile `stdlibCache` default. Each unit caches: parsed file ASTs with unmutated baseline shapes; exported symbol and type summaries (hashed, to tell importers whether to re-check); lowered programs and emitted JS per top-level declaration (the shape `stdlibJs` and the marker splice in `src/link/stdlib.js` already use), so DCE can select declarations without re-emitting.
- **Immutability:** a stored unit is never written by a later build. Passes that rewrite in place run before the unit is stored or write to per-build side tables; tests deep-freeze stored units to find violations.
- **Cache key:** per package: path + mtime + size of every source file, of its `js:` `.d.ts` imports and of its embedded files; the resolved target; the options that change output (`sourceMap`, `forceTarget`, `targetOverrides`, natives). A failed compile is never stored.
- **Invalidation (`src/cli/cli-core.js`, `src/cli/dev-server.js`):** a changed file invalidates its package and its importers; importers whose dependency summary is unchanged reuse their cached checks. The watcher adds embedded files and `.d.ts` files.
- **Budget:** deterministic cache counters are asserted in unit tests; the 25 ms figure is asserted by `test/perf/dev-rebuild.js` (median of 20 warm rebuilds, in `npm run bench`, not `npm test`).

### 2. Invariants & Safety Bounds
- A cached build is byte-identical to a cold build, including source maps.
- A unit stored in `PackageCache` is immutable.
- `gofront build` output is unchanged.

### 3. Edge Cases & Error Handling
- A file added to, removed from or renamed in a package; a changed `.d.ts` or embedded file; a `gofront.json` target change; a build that fails and is then fixed (the failed unit is not served); two builds with different options in one process.
- An edit that introduces an import cycle reports it; an edit that removes it rebuilds normally. Cycles are reported in `gofront check`, `build`, `dev` and `test`, for a self-import and a longer cycle.

---

## Implementation Tasks

> Split from the former `web-platform-evolution-plan.md` Phase 3 and Task 2.4 (re-probed 2026-11-17). Former task IDs in parentheses.

### Phase 1: Package graph and cache
- [ ] Task 1.1: Package dependency graph, import cycles and diamonds (former 3.1, graph half)
  - Files: `src/compiler.js`
  - Test: `test/unit/compiler/import-cycles.test.js`: a self-import and `a → b → c → a` give `import cycle not allowed` with the path and line:col (not `Maximum call stack size exceeded`); a three-layer diamond compiles each package once (counter); `checker-strictness-plan.md` S22's `t24` program reports the cycle
  - Done when: all pass
- [ ] Task 1.2: `PackageCache` with its cache key (former 3.1, cache half)
  - Files: `src/compiler.js`, `src/link/stdlib.js`
  - Test: `test/unit/compiler/package-cache.test.js`: hit/miss counters; the key covers source files (mtime + size), `js:` `.d.ts` imports, embedded files, target and output options; a file added, removed or renamed; a failed compile is not stored
  - Done when: `PackageCache` holds user and Go-source stdlib units for the life of the process, replaces the `stdlibCache` default (`src/compiler.js:522`), and exports a reset for tests
- [ ] Task 1.3: Cached units are immutable across builds (former 3.2)
  - Files: `src/compiler.js`, `src/typechecker/resolve.js`, `src/lower/index.js`
  - Test: `test/unit/compiler/ast-reusability.test.js`: two consecutive builds through one cache equal two cold builds for programs with function-local types, folded array lengths, `encoding/json` and `fmt`, with stored units deep-frozen under a test flag
  - Done when: no pass writes to a stored unit, and the G7 tests pass with a shared cache

### Phase 2: Incremental `gofront dev`
- [ ] Task 2.1: Package-level rebuild in the dev server (former 3.3)
  - Files: `src/cli/cli-core.js`, `src/cli/dev-server.js`, `test/perf/dev-rebuild.js`
  - Test: `test/unit/cli/incremental-build.test.js`: a one-file edit re-checks only the edited package and importers whose dependency summary changed, re-checks no stdlib unit, and equals a cold build
  - Done when: the counters hold and `node test/perf/dev-rebuild.js` reports < 25 ms for `example/gom` and `example/simple`. If the budget is missed, stop and report the measured number; do not loosen it silently
- [ ] Task 2.2: Source maps across incremental rebuilds (former 3.4)
  - Files: `src/link/sourcemap.js`, `src/cli/cli-core.js`
  - Test: `test/unit/compiler/incremental-sourcemap.test.js`: mappings after three incremental edits equal a cold build's
  - Done when: passes
- [ ] Task 2.3: Watch embedded files and `.d.ts` imports (former 2.4)
  - Files: `src/cli/cli-core.js` (`createSrcWatcher`), `src/cli/dev-server.js`
  - Test: `test/unit/cli/dev-server-embed.test.js`: modifying an embedded file (any extension) or a `js:` `.d.ts` triggers a rebuild that invalidates only its package; `docs/` describes the dev loop
  - Done when: editing `asset.txt` triggers a rebuild in `gofront dev`
