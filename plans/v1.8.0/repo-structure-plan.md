# Repository Structure Cleanup — Design Plan

**Version:** v1.8.0
**Status:** In Progress  
**Base branch:** main
**Related:**
- **Order.** Assumes [`portable-go-plan.md`](portable-go-plan.md) is completed and merged into `main`, including WASM JSON (Phase 5), SIMD (Phase 6), the docs and baseline work (Phase 7) and the simplification Phases 8–11 (manifest and conformance retired, stdlib pruned, WASM accessor refs and clone elision removed). Must be merged **before [`v1.9.0/stdlib-in-go-plan.md`](../v1.9.0/stdlib-in-go-plan.md) starts**.
- **Relation to v1.9.0.** v1.9.0 deletes most of the hand-written stdlib emitters and type tables. This plan therefore leaves the stdlib code that v1.9.0 deletes alone, restructures everything around it, and finishes by rewriting the v1.9.0 plan's file references for the new layout.
- **Folder names** group files by pipeline stage and role (`src/cli/`, `src/lexer/`, `src/link/`). The v2.0.0 native engine is shelved, so they no longer need to mirror its package layout.
- **External review.** Incorporates an external structure review (2026-10-26). The points that were not adopted are recorded in the boundary matrix.

**Release note:** No change to the compiler's behaviour or output. The examples are no longer committed pre-built: run `npm run build` before opening one in a browser.

---

## Goal

v1.9.0, which moves the stdlib to Go, still has to land on this source tree, and the tree stays the long-term home of the compiler now that the native Go port is shelved. This plan prepares the tree for v1.9.0, and fixes these problems in it today:
- an architecture gate with holes in it
- a WASM backend that also drives the whole pipeline and reaches into the JS backend
- JS codegen that runs the parser
- a 4,665-line `wasm/index.js` and a 1,440-line `compiler.js`, each doing three jobs
- CLI logic in the entry point
- a flat `src/`
- build output and example config committed alongside the sources

It does this without changing what the compiler emits. Every phase is a pure move or split, and each is proven by byte-identical example output, unchanged unit and golden suites, and a stricter architecture gate.

The large WASM stdlib files (`wasm/stdlib/core.js` at 10,069 lines, `bytes.js` at 6,716) and the typechecker stdlib tables are **not** split here. v1.9.0 deletes most of their content package by package (its Tasks 3.2–8.4 and 9.2), so splitting them first would only make v1.9.0 delete code from new files under new names.

**Done means:**
- **Layer coverage:** every `src/**/*.js` and `stdlib/**/*.go` file belongs to a Sentrux layer, except the documented false positive (`stdlib/math/extra.go`). `src/backend/js/` and `src/backend/wasm/` import each other only through the allowlisted boundary edge. `node scripts/check-layers.js`, run inside `npm run check`, fails on a new unlayered file, a dead glob or a new cross-backend import, and `sentrux check && sentrux gate` pass.
- **Unchanged output:** `npm run build` produces byte-identical `example/*/app.js` and `example/hybrid/app.wasm`, and `prep` a byte-identical `example/preact/vendor.js`, compared with the [baseline hashes](#baseline-build-hashes) recorded on `main` before Phase 1. `node test/unit/run.js` (count recorded with the baseline hashes, plus new ones) and `npm run test:e2e` pass.
- **File sizes and imports**, measured with `wc -l` and grep:
  - `src/backend/wasm/index.js` ≤ 1,800 lines (today 4,665) and imports nothing from `src/lexer/` or `src/parser/`.
  - `src/compiler.js` ≤ 750 (today 1,440).
  - `src/index.js` ≤ 220 (today 371).
  - `src/backend/js/templ.js` does not import the parser.
- **Repo and package:** `git ls-files 'example/*/app.js' 'example/*/app.wasm'` is empty. The root `package.json` has no `gofront` block. CI (`npm test`, `test:e2e`, Pages deploy) passes from a clean checkout.
- **Plan paths:** every repository path cited in `plans/v1.9.0/stdlib-in-go-plan.md` and `plans/roadmap.md` that refers to today's tree exists after this plan. The shelved `plans/v2.0.0/native-go-engine.md` is left as it is. Paths that a plan creates itself (for example `src/backend/js/natives.js`) are exempt. Checked by `test/unit/compiler/plan-paths.test.js`.

---

## Scope Rule & Boundary Matrix

A change is in scope when it moves, splits, renames or deletes code, config or files without changing compiler output, CLI behaviour or diagnostics, and makes the architecture gate, the module layout or the package contents easier to follow. Code that v1.9.0 deletes is left where it is.

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Pure move or split, output byte-identical | Gate: Sentrux layer coverage, guard script with a cross-backend check, dead WASM shims removed, stdlib mixins registered from one list. Repo: `.gitignore` dedupe, looped `build`, example outputs untracked, preact vendor config in `example/preact/gofront.json`. CLI logic out of `src/index.js`. `src/link/` from `compiler.js`. `compileWasm` moved to `compiler.js`; `wasm/index.js` split. `fmt-types.js` to `src/backend/shared/`. Templ expressions parsed in the templ parser. New folders: `src/cli/`, `src/lexer/`, `src/parser/templ.js`, `test/unit/cli/`, `test/perf/`; test discovery. `typechecker/stdlib/index.js`. File references in the roadmap, AGENTS.md and the v1.9.0 plan | |
| **Excluded: superseded by v1.9.0** | v1.9.0 deletes or replaces this code | Splitting `wasm/stdlib/core.js` per package (slices, strings, maps, sort, errors, utf8, bits, strconv) | v1.9.0 Tasks 3.2–3.4, 4.1–4.3, 6.3, 6.4, 7.3 and 8.4 delete those emitters. What remains afterwards (fmt, math, `errors.As`, `strings.Builder`, shared helpers) is small enough that splitting it then is a v1.9.x decision |
| **Excluded: superseded by v1.9.0** | | Splitting `wasm/stdlib/bytes.js` (`Buffer` methods) | v1.9.0 Task 5.2's done-when is "`bytes.js` in the WASM stdlib directory is gone" |
| **Excluded: superseded by v1.9.0** | | Splitting the typechecker `stdlib/core.js` and `extended.js` per package | v1.9.0 replaces the tables with Go declarations and Task 9.2 deletes what is left over. Only the entry-file rename (`stdlib.js` → `stdlib/index.js`) is done here |
| **Excluded: superseded by v1.9.0** | | A per-package "where does a stdlib package live" table in `docs/architecture.md` | v1.9.0 changes the answer for about 25 packages (one Go directory plus natives, instead of four places). The table belongs in v1.9.0 Task 9.3, which documents the new layout (already listed there) |
| **Excluded: deferred** | Valid, but not in this plan | Splitting `emit-stmts.js` (3.6k), `emit-exprs.js` (3.4k), `boundary.js` (3.3k), `js/expressions.js` (2.9k), `js/runtime.js` (2.8k), `wasm/stdlib/io.js` (3.6k), `packages.js` (2.4k), `time.js` (2.2k) | Each is one cohesive dispatch mixin or one runtime. v1.9.0 edits `boundary.js`, `io.js`, `packages.js`, `time.js` and the name-coupled sites in the others |
| **Excluded: deferred** | | Type-checking expressions inside `.templ` bodies | Today `{ name + undefinedVar }` passes `check` and `build` (see Verified Gaps). Fixing it changes diagnostics, so it is a behaviour change, logged in `plans/follow-ups.md`. Phase 5 does the groundwork: the AST then exists before the checker runs |
| **Excluded: deferred** | | Removing `wasm/boundary.js` → `js/runtime.js` (the `HELPER_*` imports) | Not a leak: the boundary emits JS facade code that calls the JS runtime helpers. The guard script allowlists exactly this edge |
| **Excluded: deferred** | | Moving `fmt-types.js` into `src/lower/` (reviewer option) | It formats Go types for `%T`/`%v` at emit time and analyses format strings, which is codegen work used by both backends, not lowering. `fmt` stays an emitter in v1.9.0, so the file stays |
| **Excluded: deferred** | | Moving `src/dts-parser.js` into `src/parser/` | It is part of package resolution (imported only by `resolver.js`), and parses TypeScript rather than Go |
| **Excluded: deferred** | | Folder-only Sentrux globs for the lexer (`src/lexer/*`) | `tokens.js` (types layer 7) and `lexer.js` (layer 6) share the folder. One glob would erase their ordering |
| **Excluded: deferred** | | Untracking `example/preact/vendor.js` | Only `gofront prep` writes it, and `npm run build` does not run `prep`. Generating it in CI changes the build pipeline |
| **Excluded: deferred** | | Raising Sentrux limits or editing `.sentrux/baseline.json` by hand | This plan must pass the existing gate, not loosen it |

---

## Verified Gaps & Baseline Audit

All probes ran at `ade5edb` on `feat/portable-go`, using a throwaway `git worktree` or temporary untracked files under `.probes/` (removed afterwards). At that commit portable-go Phases 4.4–7.2 were still open. The structural findings hold for the finished state, but line counts and line numbers will have moved. Each phase's first task re-runs the relevant `wc -l`/`grep -n` probe on its base commit and splits along the boundaries it finds, not the line numbers below.

**After portable-go Phases 8–11** (added 2026-10-27), several rows shrink or disappear: `stdlib/manifest.json`, `scripts/stdlib-manifest.js` and `test/conformance/` are deleted; the pruned packages (`container/*`, `encoding/base32`, `encoding/csv`, `sync/atomic`, `unicode/utf16`, `hash/{adler32,crc32,fnv}`, …) are gone, so most nested-stdlib gaps and the `fnv` false positive go with them; `wasm/index.js` loses the accessor helpers and the separate panic helpers. Rows marked *(obsolete)* are kept for history only.

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Sentrux: unlayered `src` | `src/colors.js`, `src/project-config.js`, `src/pwa.js`, `src/typechecker/constants.js` and `src/typechecker/const-fold.js` are in no layer, so violations involving them pass the gate | Probe: a glob matcher over `.sentrux/rules.toml` `paths` vs `src/**` prints those 5 plus `typechecker/expressions.js` as `UNLAYERED`. Injecting `import "../backend/js/index.js"` into `typechecker/constants.js` → `✓ All rules pass`; the same import in the layered `typechecker/statements.js` → `✗ layer_direction ... typechecker must not depend on backend`. `import "./pwa.js"` in `src/lexer.js` → `✓` |
| Sentrux: dead glob | The typechecker layer lists `src/typechecker/expressions/*`, which does not exist. Sentrux still assigns `expressions.js` a layer | Probe: inject into `typechecker/expressions.js` → `✗ ... typechecker must not depend on backend` |
| Sentrux: nested stdlib | `*` matches one directory level, so `stdlib/container/{heap,list,ring}`, `encoding/base32`, `sync/atomic`, `unicode/utf16` and `unicode/utf8/bytes.go` are unchecked. `**` works | Probe: `import "net/url"` in `stdlib/unicode/utf16/utf16.go` → `✓`; the same in `stdlib/sort/sort.go` → `✗ stdlib-leaf must not depend on stdlib-top`; with `stdlib/unicode/**` → `✗` |
| Sentrux: hidden violations *(obsolete after portable-go Phase 9 removes `hash/fnv`)* | Layering everything reveals exactly one violation, `stdlib/hash/fnv/fnv.go` → `src/backend/js/stdlib/bits.js`. This is the documented `math/bits` suffix false positive, so `hash` needs explicit globs | Probe: rules rewritten (6 src files added, `stdlib/*/` → `/**`) → that single `✗` |
| Review claim: upward imports | **Not confirmed as gate leaks.** In `rules.toml` a layer may import layers with a *higher* order number, and backend (2) → lower (3), typechecker (4), parser (5), lexer (6) is the allowed direction. The real problems are the next three rows | `.sentrux/rules.toml` header. `grep -rnE 'from "(\.\./)+(lexer\|tokens\|parser/\|typechecker/\|lower/)' src/backend` → 20 edges, none flagged |
| `compileWasm` in the backend | `wasm/index.js:3566` `compileWasm(source)` runs Lexer → Parser → TypeChecker → lower → `compileWasmModule`. It is a single-file test driver, used by `test/unit/helpers.js:16` and imported directly by `wasm/scalars.test.js`, `wasm/arrays.test.js` and `types/arrays.test.js`. It is the only reason `wasm/index.js` imports `lexer.js`, `parser/index.js` and `typechecker/index.js` | `grep -rn 'compileWasm\b' src test` |
| Parser in JS codegen | `backend/js/templ.js:5` imports `Parser` and builds new parsers during codegen (`:247` `parseFor`, `:297/:306/:317` `parseExpr`) for templ `{ expr }` and `for` headers | `grep -n 'new Parser' src/backend/js/templ.js` → 4 sites |
| `.templ` expressions unchecked | The checker never sees those expressions: `{ name + undefinedVar }` and `{ name + 5 }` pass `gofront check` (exit 0), and `build` emits `String(name + undefinedVar)` | Probe `.probes/tp/` (`main.go` + `view.templ`). Logged as a follow-up |
| Cross-backend imports | `wasm/stdlib/core.js:6` imports `fmtTypeDesc`/`fmtWantsTypes` from `js/fmt-types.js` (also used by `js/stdlib/fmt.js` and `js/fmt-runtime.js`). `wasm/boundary.js:48` imports `HELPER_*` from `js/runtime.js` (by design). Nothing in `js/` imports `wasm/` | `grep -rnE 'from "(\.\./)+js/' src/backend/wasm` |
| WASM mixins | `emit.js` mixes in each emitter with `copyMethods` (throws on duplicate names). `stdlibEmitters` in `wasm/stdlib/index.js` is exported but never imported, and `emit.js:1829-1840` lists every mixin by hand. v1.9.0 deletes emitters package by package and adds `wasm/natives.js`, so one registration list makes each deletion a single-line change | `src/backend/wasm/emit.js:1815-1840`. `grep -rn stdlibEmitters src test` → definition only |
| Dead shims | `src/backend/wasm/emit-stdlib.js` has no importers. The `Phase6/7/8Emitter`/`StdlibEmitter` aliases have no users. `typechecker/types.js:105` still points at `emit-stdlib.js` | `grep -rn 'emit-stdlib\|Phase[678]Emitter\|StdlibEmitter\b' src test` → self-references only |
| `wasm/index.js` | 4,665 lines: `ModuleEmitter` (298–2360), `compileWasmModule` (2459–3331), about 1,300 lines of pre-scan and global-init helpers (3331–4665), and `compileWasm` (3566). v1.9.0 Tasks 5.2, 5.3, 6.1 and 6.2 unwind name-coupled sites in this file | `grep -nE '^(export )?(class\|function\|const) ' src/backend/wasm/index.js` |
| `compiler.js` | 1,440 lines in the support layer, with three jobs: chunk and source-map merging (95–180), WASM unit linking (179–470), and the Go-source stdlib load/mangle/check/emit pipeline (473–933, incl. `checkStdlibPrograms`, which v1.9.0 Task 2.5 edits for lazy checking). Plus `resolveImports` and the public `compile*` entry points | `grep -n '^function\|^export function' src/compiler.js` |
| CLI entry | `src/index.js` (371 lines) contains `copyProjectAssets` (231), the single-shot flow (243–321) and the watch-mode reporters (332–368), contrary to the AGENTS.md rule "Never modify `src/index.js` for logic" | `src/index.js:231-368` |
| Flat `src/` | The lexer stage (`lexer.js`, `templ-lexer.js`, `tokens.js`), a parser-stage file (`templ-parser.js`), CLI/dev tooling (`cli-core`, `dev-server`, `test-runner`, `asset-manager`, `vendor`, `pwa`, `project-config`, `colors`, `minifier`) and pipeline drivers all sit in `src/` | `ls src` |
| Entry-file convention | `src/typechecker/stdlib.js` sits beside `src/typechecker/stdlib/`, while both backend `stdlib/` folders use an `index.js` | `ls src/typechecker` |
| v1.9.0 overlap | The v1.9.0 plan (on `main`, 2026-10-23) migrates `sort`, `slices`, `maps`, `errors`, `unicode/utf8`, `path`, `html`, `bytes`, `io`, `strings`, encodings, `sha256`, `bits`, `rand`, `sync`, `time` and `strconv` to Go. It targets `wasm/stdlib/` 20,717 → ≤ 8,000 lines. 14 of its task lines edit `wasm/stdlib/core.js`, 8 the typechecker `core`/`extended` tables, 2 `wasm/stdlib/bytes.js` (deleted in Task 5.2) | `git show main:plans/v1.9.0/stdlib-in-go-plan.md`, `grep -c` per path |
| v1.9.0 stale paths | The v1.9.0 plan predates PR #53 and this plan. It cites `runtime/stdlib/` 29 times, plus `src/lexer.js`, `src/cli-core.js`, `src/compiler.js` (`checkStdlibPrograms`), `src/backend/wasm/index.js` sites, `test/e2e/perf/` (4) and "add to `TEST_FILES`" | `grep -c` per path on the same file |
| Manifest in the npm package *(obsolete: deleted by portable-go Task 8.1)* | `stdlib/manifest.json` (377,470 bytes) is shipped because `files` includes `stdlib/`, but no runtime code loads it (`src/` only mentions it in comments). It is 11% of the unpacked package (3.43 MB) and about 23 KB of the 617 KB tarball | `npm pack --dry-run --json --ignore-scripts` → 159 files, unpacked 3,432,186, tarball 616,821 |
| Other stale paths *(mostly obsolete: v2.0.0 shelved 2026-10-27; roadmap rewritten)* | The roadmap's v2.0.0 theme and `native-go-engine.md:92` say the *v1.8.0* stdlib is in `runtime/stdlib/` (moved to `stdlib/` by PR #53, `b34b52f`). The roadmap's v1.8.0 row says `src/stdlib/go/`. `native-go-engine.md` §1.1 describes the *v2.0.0* target layout with `runtime/stdlib/`, which is a design choice and not stale | `grep -n 'runtime/stdlib\|src/stdlib/go' plans/roadmap.md plans/v2.0.0/native-go-engine.md` |
| Perf in `e2e/` | `test/e2e/perf/` holds Node/V8 scripts, not Playwright specs. Playwright skips them only because each project's `testMatch` names its specs. Referenced by `package.json` `test`/`bench`, `docs/hybrid-wasm.md:385`, and the v1.9.0 plan | `playwright.config.js:4,15-35` |
| Example config in root | The root `package.json` has a 30-line `gofront.vendor` block that only serves `example/preact`. `project-config.js` already reads `gofront.json` from a project root, and vendor destinations must lie inside it | `src/project-config.js:2-19`. Probe: `prep` with the root config and with a temporary `example/preact/gofront.json` → both `no bundler found`, because `esbuild` (a declared devDependency) is not installed locally. The byte comparison happens in Task 2.4 after `npm ci` |
| Committed build output | `example/*/app.js` (6) and `example/hybrid/app.wasm` are tracked, stale (rebuilding at HEAD changes 6 of 7) and touched by 40 commits. Nothing reads them from git | Worktree `npm run build && git status --short example` → 6 `M` |
| Build determinism | Two consecutive builds are byte-identical | `npm run build` twice → `sha256sum -c` all `OK` |
| `build` script | Six copies of one command chained with `&&`; a new example is silently left out | `package.json` `scripts.build` |
| `.gitignore` | 8 patterns appear twice | `grep -vE '^\s*(#\|$)' .gitignore \| sort \| uniq -d` |
| Unit test layout | `test/unit/compiler/` mixes CLI/tooling tests with compiler internals (21 files). `run.js` hand-lists 80 files; complete today, but a forgotten file never runs | Set comparison of `TEST_FILES` vs `find` → 80/80 |
| Public surface | No `main` or `exports`, only `bin: src/index.js` and `files: [src/, stdlib/]` | `node -e 'require("./package.json").main'` → `undefined` |
| Baseline suites | Unit 2680/2680 (16 s), conformance 40/40 (5 s; harness deleted by portable-go Task 8.3), `sentrux check` ✓ (Quality 6258), `sentrux gate` ✓ | At `ade5edb` |

### Baseline build hashes

Recorded on `main` at `e2d49f2` (portable-go merged, 2026-10-28) with:

```
npm run build && sha256sum example/*/app.js example/hybrid/app.wasm example/preact/vendor.js
```

Two consecutive builds were byte-identical. The unit suite at this commit is **2882/2882** (`node test/unit/run.js`), which replaces the 2680 figure above as the test-count floor. `vendor.js` is the committed file: `prep` is not part of `build`, and Task 2.4 compares a regenerated one against it.

Every phase checks against this list with `sha256sum -c` and pastes the output into its PR body.

```
213aa9f8565a252a48444c887c50c5f44badd5abeb621247555149a715de3fe5  example/gom/app.js
73f46a95f6e3339f8f1e0c26a338b71950f25cc1fea47410250973ed10213cff  example/hybrid/app.js
e96672af6e470062450911671ad94abac326309557765dafde8210ef90b73734  example/preact/app.js
05bcb401ec26abb5f2073c8514d03d68f6d315a56626024e44393522da27ad07  example/simple/app.js
51c3ef87554af5b0fcb7ff2950d82335ed831fe855836a77741f9c2e0ded7896  example/templ/app.js
4adf32f93d4374d737b1a748912d9830c61af5cda808ad4751b036f848796ea1  example/webgl/app.js
a6f198ae77289396b4029a784c52a0a7392c5ed7c426b78ba17458fe073ea680  example/hybrid/app.wasm
55b3244ba3786a45225ac45ba59cb729ae4f36692f502fdc25b6e9fb26031761  example/preact/vendor.js
```

---

## Approach

### 1. Architecture & Design Decisions

**Target layout of `src/`** (new or moved entries marked ★):

```
src/index.js              CLI entry: argument parsing + dispatch only
src/compiler.js           pipeline driver, resolveImports, public compile* (+ compileWasm ★)
src/resolver.js           package resolution
src/dts-parser.js         .d.ts parsing (resolution)
src/link/ ★               sourcemap.js, wasm.js, stdlib.js           (from compiler.js)
src/cli/ ★                cli-core, dev-server, test-runner, asset-manager, vendor,
                          pwa, project-config, colors, minifier
src/lexer/ ★              lexer.js, templ-lexer.js, tokens.js
src/parser/               … + templ.js ★ (was src/templ-parser.js)
src/typechecker/          … stdlib/index.js ★ (was stdlib.js)
src/lower/
src/backend/shared/ ★     fmt-types.js                               (from backend/js/)
src/backend/js/
src/backend/wasm/         … module-emitter.js ★, prescan.js ★, globals.js ★
src/backend/wasm/stdlib/  unchanged except the registry (v1.9.0 shrinks it)
```

v1.9.0 then adds `src/backend/js/natives.js` and `src/backend/wasm/natives.js` next to these, and keeps writing Go stdlib packages under `stdlib/`.

**Layer guard (`scripts/check-layers.js`).** A dependency-free Node script.
- It parses `[[layers]] paths` from `.sentrux/rules.toml` with a regex, because the file is flat and the project adds no TOML dependency. Globs become regexes (`*` = one segment, `**` = any depth).
- Check 1: every `src/**/*.js` and `stdlib/**/*.go` file matches some layer.
- Check 2: no glob is dead.
- Check 3 (cross-backend): it scans import specifiers in `src/backend/js/**` and `src/backend/wasm/**` and fails on an import of the other backend, except `ALLOW_CROSS = [["src/backend/wasm/boundary.js", "src/backend/js/runtime.js"]]`.
- `ALLOW` lists the documented unlayered file (`stdlib/math/extra.go`) with its reason.
- It exports `findLayerGaps(tomlText, files)` and `findCrossBackendImports(sources)` for unit tests, and runs in `npm run check` before `sentrux check`.

Sentrux only supports a linear order, so it cannot forbid imports between peer layers. The script covers that.

**Layer assignments.**
- `colors`, `project-config` and `pwa` go to support (1).
- `typechecker/constants`, `const-fold` and `expressions` go to typechecker (4).
- The dead `expressions/*` glob is removed.
- Nested stdlib packages use `**` (`encoding/**`, `unicode/**`, `internal/**`), re-probed against the pruned tree.
- After Phase 6: support = `src/compiler.js`, `src/resolver.js`, `src/dts-parser.js`, `src/link/*`, `src/cli/*`. Lexer = `src/lexer/lexer.js`, `src/lexer/templ-lexer.js`. Types = `src/lexer/tokens.js`, `src/typechecker/types.js`. Parser = `src/parser/*`. Backend gains `src/backend/shared/*`.
- New Go-source packages that v1.9.0 adds under `stdlib/` must be layered, or the guard fails. That is intended: it forces each new package into the dependency order v1.9.0's invariant describes (`cmp`, `iter`, `errors`, `io`, `unicode/utf8` as the base).

**Stdlib mixin registry.** `emit.js` loops over `stdlibEmitters` instead of listing the stdlib mixins by hand, and the non-stdlib mixins stay explicit. `copyMethods` throws on duplicate names. Mixins only add methods, so their order changes nothing. This is the one change to `wasm/stdlib/` in this plan, and it lets v1.9.0 delete an emitter, or register a natives mixin, by editing one array.

**`compileWasm` → `compiler.js`.** Moved verbatim and exported under the same name. `test/unit/helpers.js` and the three tests that import it switch to `src/compiler.js`. `wasm/index.js` drops its imports of `Lexer`, `Parser`, the `TypeChecker` class and `lower`. `monomorph.js` importing `TypeChecker` to re-check instantiations stays. No backend re-export is kept, because the package has no public JS API.

**`wasm/index.js` split.**
- `module-emitter.js`: `ModuleEmitter`.
- `prescan.js`: `_uses*`, `_scanImportsInBody`, `_scanInterface*`, `_scanFuncSigInterfaces`, `_someNode`, `importsAnyOf`, `hasErrorUsage`.
- `globals.js`: `_collectPackage{Consts,Globals}`, `_zero*Const`, `_arrayShape`, `_orderConstInits`, `_makeGlobalInitFunc`, `_makeInterfaceDispatcher`.

`index.js` keeps `compileWasmModule`, `STDLIB_IMPORTS` and its other exports under the same names and values (snapshot test). Task 7.3 maps the name-coupled sites that v1.9.0 cites in "`wasm/index.js`" to their new file.

**Templ expressions parsed by the templ parser.** `TemplParser`, which already imports `Parser` and sits in the parser layer, calls `parseExpr`/`parseFor` on the token runs it stores today, with the same synthetic EOF token. It puts the result on the node (`node.expr`, `node.forStmt`). `backend/js/templ.js` reads those fields and no longer imports `parser/`. It keeps the `tokens.js` import only if it needs `T` for something other than building parsers.

**`fmt-types.js` → `src/backend/shared/`.** Moved verbatim, with its three importers updated.

**`src/link/` from `compiler.js`.**
- `link/sourcemap.js`: chunk and map merging.
- `link/wasm.js`: unit registration, linking, AST cloning, collision checks, facade splicing.
- `link/stdlib.js`: `stdlibSuffix` … `importStdlibPackages`, including `checkStdlibPrograms`.

To avoid a cycle with `compiler.js`, `link/stdlib.js` takes `parseGoFrontFile`, `gwFilesIn` and the checker constructor as an injected `deps` argument. v1.9.0's lazy body checking (its Task 2.5) then lands in `link/stdlib.js`.

**CLI entry.** `copyProjectAssets`, the single-shot flow and the watch-mode reporters move to `cli-core.js` as `runSingleShot(inputPath, isDir, flags)` (returns an exit code) and `devReporters({ outputFile, copyAssets })`. Messages, streams and exit codes stay identical. v1.9.0's `--no-natives` flag then lands in `src/cli/cli-core.js`.

**Preact vendor config.** The root `package.json` `gofront` block moves to `example/preact/gofront.json`, with `dest: "vendor.js"`, because destinations resolve against the project directory. `findBundler` and package resolution use `createRequire` rooted in `example/preact/`, and Node walks up to the root `node_modules`.

**Test layout.**
- `run.js` builds `TEST_FILES` by walking its directory (skipping `fixtures/`), sorted, so v1.9.0's new test files are picked up without editing a list. `HEAVIEST_TEST_FILES` stays as a scheduling hint, and a missing entry throws.
- CLI and tooling tests move to `test/unit/cli/`.
- `test/e2e/perf/` moves to `test/perf/`. v1.9.0's sort and string-search benchmarks go there.

**Typechecker stdlib entry.** `typechecker/stdlib.js` becomes `typechecker/stdlib/index.js`, contents unchanged.

**Cross-plan path refresh.** The last task rewrites the file references in the roadmap, `AGENTS.md` and `plans/v1.9.0/stdlib-in-go-plan.md` (`runtime/stdlib/` → `stdlib/` and the `TEST_FILES` line were already fixed there on 2026-10-27; the shelved v2.0.0 plan is not touched):
- `src/lexer.js` → `src/lexer/lexer.js`.
- `src/cli-core.js` → `src/cli/cli-core.js`.
- `checkStdlibPrograms` in `src/compiler.js` → `src/link/stdlib.js`.
- `wasm/index.js` sites → the new file that holds them.
- `test/e2e/perf/` → `test/perf/`.

Only paths change. No task, scope or number in those plans is edited.

### 2. Invariants & Safety Bounds

- **Byte-identical output.** After every task, `npm run build` (and `prep` for preact) reproduces the recorded hashes. A task that changes a hash is wrong by definition: revert and retry.
- **No behaviour change.** Diagnostics (text and position), CLI messages, streams, exit codes and module export names are unchanged. Moved code is verbatim, and reformatting comes only from Biome.
- **Hands off v1.9.0's targets.** No method moves in or out of `wasm/stdlib/*.js`, `js/stdlib/*.js` or `typechecker/stdlib/{core,extended}.js`, so v1.9.0's line counts (20,717 / 2,976 / 1,715) and its per-file deletion tasks stay valid.
- **The gate only gets stricter.** `max_cycles` stays 0, and `max_coupling`, `max_cc` and `no_god_files` are unchanged. `sentrux gate` must not report degradation, and the baseline is never edited by hand.
- **Zero runtime dependencies.** The guard script and test discovery use only `node:` modules.
- **Test count.** Never fewer than 2680 unit tests plus the new ones. Discovery must find the same files plus new ones.
- **Package contents.** `npm pack --dry-run` lists the same files before and after each phase, modulo the paths this plan renames under `src/`.

### 3. Edge Cases & Error Handling

- **Cycles from extraction.** `link/stdlib.js` gets its dependencies injected. `compileWasm` in `compiler.js` adds a support → backend edge, which already exists. `prescan.js` and `globals.js` are free functions imported by `index.js` and `module-emitter.js` only, and never import `index.js`.
- **Templ parse timing.** Moving `parseExpr`/`parseFor` into `TemplParser` can only change *when* a templ syntax error is raised, not its text. Task 5.2 first pins the message, position and exit code for a malformed `{ a + }` and a malformed `for` header under both `build` and `check`. If `check` reports such errors where it did not before, the task either keeps the old timing (deferring the throw) or records the change in the Release note, whichever keeps the pinned outputs and exit codes unchanged.
- **Vendor resolution from a subdirectory.** If `prep example/preact` cannot resolve `preact` or the bundler, Task 2.4 stops and records why, instead of adding a path hack. The block then stays in the root `package.json`.
- **Fresh clone with no build.** An example opened without `npm run build` returns 404 for `app.js`. The README and `docs/usage.md` say to build first. CI builds first anyway.
- **Moving tests.** Moved unit tests keep their directory depth. `test/perf/` is one level shallower than `test/e2e/perf/`, so its relative imports and fixture paths are rewritten and both scripts run once from the new location.
- **Emitters added by portable-go.** The WASM JSON and SIMD emitters are registered through `stdlibEmitters` with the rest. Any JSON or SIMD code that landed in `wasm/index.js` moves with the Phase 4 split, by the same rules.
- **v1.9.0 started early.** If v1.9.0 work begins before this plan is merged, the phases that touch its files pause: Phase 3 (`compiler.js` stdlib pipeline), Phase 4 (`wasm/index.js`) and Phase 6 (`src/lexer.js`, `src/cli-core.js`). They rebase after the v1.9.0 phase in flight merges. Phases 1, 2, 5 and 7 do not overlap with v1.9.0 Phases 1–2.
- **v1.8.x fixes during the cleanup.** A fix that lands on `main` mid-plan is merged into the plan branch before the next phase, and the hashes are re-recorded in that phase's PR body.

---

## Implementation Tasks

### Phase 1: Architecture gate coverage & repo hygiene
*Before Task 1.1, record the baseline hashes on `main` (see [Baseline build hashes](#baseline-build-hashes)).*

- [x] Task 1.1: Layer guard script
  - Files: `scripts/check-layers.js`, `package.json` (add to `check` before `sentrux check`)
  - Test: `test/unit/compiler/check-layers.test.js`:
    - `findLayerGaps` on fixture TOML and file lists flags an unlayered file, a dead glob, `*` vs `**` depth, and `ALLOW`.
    - `findCrossBackendImports` flags a fixture `js → wasm` import and a non-allowlisted `wasm → js` import, and passes the `boundary.js → js/runtime.js` edge.
    - Real-repo cases land as `todo`: they list the unlayered src and stdlib files found on the base commit (re-probed after portable-go Phase 9) and the `core.js → fmt-types.js` edge.
  - Done when: the fixture cases pass, and the real-repo cases list exactly the files in Verified Gaps
- [x] Task 1.2: Complete the Sentrux layers
  - Files: `.sentrux/rules.toml`
  - Test: the real-repo layer-gap case from Task 1.1 is turned on. The cross-backend case stays `todo` until Task 5.1
  - Done when: the layer-gap check is clean, `sentrux check` and `sentrux gate` pass, and the `rules.toml` comment documents `math` as the only allowed gap
- [x] Task 1.3: Remove the dead WASM compatibility shims
  - Files: `src/backend/wasm/emit-stdlib.js` (delete), `src/backend/wasm/stdlib/index.js`, `src/backend/wasm/stdlib/core.js` (the trailing alias line only); also the comment at `src/typechecker/types.js:105`
  - Test: none new (deletion only). `grep -rn 'emit-stdlib\|Phase[678]Emitter\|StdlibEmitter\b' src test` must be empty
  - Done when: grep is empty, the hashes match and `wasm/golden.test.js` passes
- [x] Task 1.4: Register stdlib mixins through `stdlibEmitters`
  - Files: `src/backend/wasm/emit.js`, `src/backend/wasm/stdlib/index.js`
  - Test: new `test/unit/wasm/mixins.test.js`: every class in `stdlibEmitters` has its prototype methods on `FunctionEmitter.prototype`, and a duplicate name throws. Fails first against a temporary probe mixin added to the array
  - Done when: `emit.js` has no hand-listed stdlib `copyMethods` lines, and the hashes match
- [x] Task 1.5: Looped example build and `.gitignore` dedupe
  - Files: `scripts/build-examples.js` (exports `listExamples(root)`), `package.json` (`build`), `.gitignore`
  - Test: `test/unit/compiler/build-examples.test.js`: `listExamples` returns exactly the example directories that have `src/`, and skips a temp directory without one
  - Done when: `npm run build` reproduces the hashes, and the `.gitignore` duplicate check is empty

### Phase 2: CLI entry, build outputs & example config

- [x] Task 2.1: Move single-shot compilation into `cli-core.js`
  - Files: `src/index.js`, `src/cli-core.js`
  - Test: `test/unit/compiler/cli-core.test.js` adds `runSingleShot` cases: `--check` returns 0 with an `OK` line; `-o` output equals `compileDir`; a compile error returns 1 with the `log.fail` text; `--tokens` dumps tokens. Fails first because the export is missing
  - Done when: `index.js` has no compile/minify/write code, and the `cli.test.js` smoke tests pass unchanged
- [x] Task 2.2: Move the watch-mode reporters and asset copy into `cli-core.js`
  - Files: `src/index.js`, `src/cli-core.js`
  - Test: `cli-core.test.js`: `devReporters` with captured stderr. `onBuild` prints `OK — wrote …`; `onError` prints `ERROR` plus the formatted diagnostic; `copyAssets: true` calls the asset copy
  - Done when: `wc -l src/index.js` ≤ 220, and the dev-server tests pass unchanged
- [x] Task 2.3: Stop tracking the compiled examples
  - Files: `.gitignore` (`/example/*/app.js`, `/example/*/app.wasm`, with a comment that `vendor.js` stays tracked); `git rm --cached` for the 7 outputs
  - Test: `build-examples.test.js`: `git ls-files example` has no `app.js`/`app.wasm` and still has `example/preact/vendor.js`
  - Done when: on a fresh clone, `npm ci && npm test && npm run test:e2e` pass
- [x] Task 2.4: Move the preact vendor config into `example/preact/gofront.json`
  - Files: `package.json` (drop the `gofront` block), `example/preact/gofront.json` (new, `dest: "vendor.js"`), `docs/usage.md` (how to regenerate)
  - Test: in `test/unit/compiler/prep.test.js`, `loadProjectConfig("example/preact").vendor` has the preact packages and `loadProjectConfig(".")` has no `vendor`. After `npm ci`, `node src/index.js prep example/preact` → `sha256sum -c` on the recorded `vendor.js` hash
  - Done when: `vendor.js` is byte-identical, or the task stops per Edge Cases
- [x] Task 2.5: Document building the examples
  - Files: `README.md` (examples section), `docs/usage.md`
  - Test: none (docs); reviewed against the AGENTS.md docs and changelog rules
  - Done when: both say to run `npm run build` before opening an example, and the `CHANGELOG.md` `[Unreleased]` entry matches the Release note

### Phase 3: `src/link/` extracted from `compiler.js`

- [x] Task 3.1: Source-map merging → `src/link/sourcemap.js`
  - Files: `src/compiler.js`, `src/link/sourcemap.js`, `.sentrux/rules.toml` (add `"src/link/*"` to support)
  - Test: `test/unit/compiler/link.test.js`: `mergeCompilationChunks` on two fixture chunks gives the expected offset `mappings`. Fails first because the module is missing
  - Done when: source-map tests and hashes are unchanged, and `check-layers` passes
- [x] Task 3.2: WASM unit linking → `src/link/wasm.js`
  - Files: `src/compiler.js`, `src/link/wasm.js`
  - Test: `link.test.js`: `checkLinkCollisions` reports a duplicate top-level name across two units with the existing message
  - Done when: `test/unit/wasm/*` and the `example/hybrid` hashes are unchanged
- [x] Task 3.3: Go-source stdlib pipeline → `src/link/stdlib.js` with injected dependencies
  - Files: `src/compiler.js`, `src/link/stdlib.js`
  - Test: `link.test.js`: the mangling helper renames a top-level stdlib declaration with the package suffix, and leaves type parameters and overlay names alone
  - Done when: `stdlib-go.test.js` passes, `sentrux check` reports 0 cycles, and `wc -l src/compiler.js` ≤ 700

### Phase 4: `wasm/index.js` split

- [x] Task 4.1: `compileWasm` → `src/compiler.js`
  - Files: `src/backend/wasm/index.js`, `src/compiler.js`, `test/unit/helpers.js` (plus the import line in `wasm/scalars.test.js`, `wasm/arrays.test.js` and `types/arrays.test.js`)
  - Test: `test/unit/wasm/encode.test.js` asserts that `compileWasm` is exported from `src/compiler.js` and that the source of `wasm/index.js` has no import from `lexer`, `parser/` or `typechecker/index.js`. Fails first
  - Done when: all `wasm/` tests pass through the new import, the hashes match, and `wc -l src/compiler.js` ≤ 750
- [x] Task 4.2: `ModuleEmitter` → `wasm/module-emitter.js`
  - Files: `wasm/index.js`, `wasm/module-emitter.js`
  - Test: `wasm/encode.test.js`: the export list of `wasm/index.js` equals a snapshot taken after Task 4.1. Write the snapshot first
  - Done when: the snapshot is unchanged and the hashes match
- [x] Task 4.3: Pre-scan helpers → `wasm/prescan.js`
  - Files: `wasm/index.js`, `wasm/prescan.js`
  - Test: `wasm/encode.test.js`: `_usesFmtAny` returns true for a parsed program calling `fmt.Println(any(x))` and false otherwise
  - Done when: the hashes match
- [x] Task 4.4: Global and zero-init helpers → `wasm/globals.js`
  - Files: `wasm/index.js`, `wasm/globals.js`
  - Test: `wasm/encode.test.js`: `_orderConstInits` orders dependent constants topologically on a fixture
  - Done when: `wc -l src/backend/wasm/index.js` ≤ 1,800, and the hashes match

### Phase 5: Backend boundaries

- [x] Task 5.1: `fmt-types.js` → `src/backend/shared/`
  - Files: `src/backend/shared/fmt-types.js` (moved), its importers (`js/stdlib/fmt.js`, `js/fmt-runtime.js`, `wasm/stdlib/core.js` — the import line only), `.sentrux/rules.toml` (backend globs)
  - Test: the Task 1.1 real-repo cross-backend case is turned on and lists only the allowlisted edge
  - Done when: `check-layers` passes with the cross-backend check on, and the hashes match
- [x] Task 5.2: Parse templ `{ expr }` and attribute expressions in `TemplParser`
  - Files: `src/templ-parser.js`, `src/backend/js/templ.js`
  - Test: `test/unit/compiler/templ.test.js`:
    - Written first, passing on the old code: pinned error text, position and exit code for a malformed `{ a + }` under `build` and `check`.
    - New (fails first): the parsed templ AST for `{ name }` has `node.expr.kind === "Ident"`.
  - Done when: the pinned errors are unchanged, `templ.js` has no `parseExpr` call, and the `example/templ`/`gom` hashes match
- [x] Task 5.3: Parse templ `for` headers in `TemplParser`; drop the parser import from JS codegen
  - Files: `src/templ-parser.js`, `src/backend/js/templ.js`
  - Test: `templ.test.js`: pinned error for a malformed `for` header; parsed `for` nodes carry `node.forStmt`; the source of `templ.js` does not import `parser/`
  - Done when: `grep -n 'new Parser\|parser/index' src/backend/js/templ.js` is empty, and the hashes match

### Phase 6: `src/cli/`, `src/lexer/` and the test layout

- [x] Task 6.1: Test discovery in `run.js`
  - Files: `test/unit/run.js`
  - Test: new `test/unit/compiler/runner.test.js`: the exported `TEST_FILES` equals the sorted `find` result and contains every `HEAVIEST_TEST_FILES` entry. Fails first while the list is hand-written and a temporary extra test file exists
  - Done when: the same files plus the new ones run with the same pass count, and a missing heavy entry throws at startup
- [x] Task 6.2: Move the CLI and tooling modules to `src/cli/`
  - Files: `git mv` of `cli-core`, `dev-server`, `test-runner`, `asset-manager`, `vendor`, `pwa`, `project-config`, `colors` and `minifier` to `src/cli/`; import rewrites in `src/` and `test/`; `.sentrux/rules.toml`. Mechanical; exceeds the 3-file rule by design
  - Test: the `check-layers` real-repo cases and `sentrux check`
  - Done when: the hashes match, the suites pass, and `npm pack --dry-run` shows the new paths with `bin` unchanged
- [x] Task 6.3: Move the lexer files to `src/lexer/`, and `templ-parser.js` to `src/parser/templ.js`
  - Files: `git mv` of `lexer`, `templ-lexer` and `tokens` to `src/lexer/`, and `templ-parser.js` to `src/parser/templ.js`; import rewrites; `.sentrux/rules.toml`
  - Test: as for 6.2
  - Done when: the hashes match, and `ls src/*.js` lists only `index.js`, `compiler.js`, `resolver.js` and `dts-parser.js`
- [x] Task 6.4: Split `test/unit/compiler/` → `test/unit/cli/`
  - Files: `git mv` of the `cli`, `cli-core`, `dev-server`, `pwa`, `asset-manager`, `test-runner`, `prep` and `build-examples` tests; the `run.js` header comment and `HEAVIEST_TEST_FILES` paths
  - Test: the Task 6.1 discovery test
  - Done when: the unit pass count is unchanged
- [ ] Task 6.5: `test/e2e/perf/` → `test/perf/`
  - Files: `git mv test/e2e/perf test/perf`; relative imports and fixture paths in `raycast-bench.js`, `zero-alloc.js`, `json-bench.js` and `particle-bench.js`; `package.json` (`test`, `bench`)
  - Test: `node test/perf/zero-alloc.js` passes (already part of `npm test`). `node --expose-gc test/perf/raycast-bench.js --tris 1000 --rays 1000` completes
  - Done when: `npm test` passes, `ls test/e2e` has only specs and helpers, and `npm run test:e2e` is unchanged
- [ ] Task 6.6: Update the path references in the docs and agent guide
  - Files: `docs/architecture.md`, `docs/usage.md`, `docs/hybrid-wasm.md`, `AGENTS.md` (Part 2 **Architecture** only: the final `src/` layout, `src/link/`, `src/cli/`, `src/lexer/`, `src/backend/shared/`, `test/perf/`)
  - Test: `grep -rnE 'src/(lexer|templ-lexer|templ-parser|tokens|dev-server|pwa|minifier|vendor|asset-manager|test-runner|colors|project-config|cli-core)\.js|test/e2e/perf' docs AGENTS.md .sentrux package.json` is empty
  - Done when: grep is empty

### Phase 7: Typechecker entry & cross-plan paths

- [ ] Task 7.1: `typechecker/stdlib.js` → `typechecker/stdlib/index.js`
  - Files: `src/typechecker/stdlib.js` → `src/typechecker/stdlib/index.js` (`git mv`), its importers
  - Test: none new (rename). The full unit suite passes
  - Done when: `ls src/typechecker/stdlib.js` fails, and the hashes match
- [ ] Task 7.2: Roadmap paths
  - Files: `plans/roadmap.md`
    - Any JS-engine source path the roadmap cites matches the new layout (`src/cli/`, `src/lexer/`, `src/link/`, `test/perf/`).
    - `plans/v2.0.0/native-go-engine.md` is shelved and keeps its historical paths.
  - Test: new `test/unit/compiler/plan-paths.test.js`: every backticked `src/…`, `stdlib/…`, `test/…` and `scripts/…` path in `plans/roadmap.md` exists, except an explicit list of paths a plan creates itself
  - Done when: the test passes
- [ ] Task 7.3: v1.9.0 plan paths
  - Files: `plans/v1.9.0/stdlib-in-go-plan.md`, `test/unit/compiler/plan-paths.test.js` (add the file)
  - Changes (paths only; no task, scope or number changes):
    - `src/lexer.js` → `src/lexer/lexer.js`, `src/cli-core.js` → `src/cli/cli-core.js`, `src/compiler.js` (`checkStdlibPrograms`) → `src/link/stdlib.js`.
    - The `wasm/index.js` name-coupled sites → the file that now holds each site (`module-emitter.js`, `prescan.js`, `globals.js` or `index.js`).
    - All occurrences of `test/e2e/perf` (tasks, invariants, and test plan) → `test/perf`.
  - Test: `plan-paths.test.js` covers `stdlib-in-go-plan.md`. Exempt: the paths it creates (`src/backend/{js,wasm}/natives.js`, `scripts/gen-pdq.js`, `scripts/pdq-template.txt`, the new `stdlib/<pkg>/*.go` files, `test/unit/stdlib/*.test.js` and `test/unit/stdlib/harness.js`)
  - Done when: the test passes, and this plan (`repo-structure-plan.md`) is marked `Status: Completed`
