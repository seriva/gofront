# Repository Structure Cleanup — Design Plan

**Version:** v1.8.0
**Status:** Draft
**Base branch:** main
**Related:** Assumes [`portable-go-plan.md`](portable-go-plan.md) is completed and merged into `main`, including WASM JSON (Phase 5), SIMD (Phase 6) and the docs and baseline work (Phase 7). This plan is the last structural change to the JS engine before the [`v2.0.0`](../v2.0.0/native-go-engine.md) port, so the port starts from the layout this plan leaves behind. Folder names follow the v2.0.0 package layout where one exists (`src/cli/` ↔ `internal/cli`, `src/lexer/` ↔ `internal/lexer`, `src/link/` ↔ `internal/compiler`). Incorporates an external structure review (2026-10-26); the points that were not adopted are recorded in the boundary matrix.
**Release note:** No change to the compiler's behaviour or output. The examples are no longer committed pre-built, so run `npm run build` before opening one in a browser. The published npm package is smaller.

---

## Goal

v1.8.0 is the last feature release of the JS engine and the source tree that v2.0.0 ports from. That tree currently has:
- an architecture gate with holes in it
- several 4–10k-line files that bundle many unrelated packages
- a WASM backend that also drives the whole pipeline and reaches into the JS backend
- JS codegen that runs the parser
- stdlib packages spread over up to four directories
- build output and example config committed alongside the sources

This plan fixes the structure without changing what the compiler emits. Every phase is a pure move or split. Each one is proven by byte-identical example output, unchanged unit, golden and conformance suites, and a stricter architecture gate.

**Done means:**
- **Layer coverage:** every `src/**/*.js` and `stdlib/**/*.go` file belongs to a Sentrux layer, except the two documented false positives. `src/backend/js/` and `src/backend/wasm/` import each other only through the allowlisted boundary edge. `node scripts/check-layers.js`, run inside `npm run check`, fails on a new unlayered file, a dead glob or a new cross-backend import, and `sentrux check && sentrux gate` pass.
- **Unchanged output:** `npm run build` produces byte-identical `example/*/app.js` and `example/hybrid/app.wasm` compared with the [baseline hashes](#baseline-build-hashes) recorded on `main` before Phase 1. `prep` produces a byte-identical `example/preact/vendor.js`. `node test/unit/run.js` (2680 tests at baseline, plus new ones), `npm run conformance` (40/40) and `npm run test:e2e` all pass.
- **File sizes**, measured with `wc -l`:
  - No file in `src/backend/wasm/stdlib/` is over 4,000 lines (today `core.js` has 10,069 and `bytes.js` 6,716).
  - `src/backend/wasm/index.js` ≤ 1,800 lines (today 4,665) and imports nothing from `src/lexer/` or `src/parser/`.
  - `src/compiler.js` ≤ 750 (today 1,440).
  - `src/index.js` ≤ 220 (today 371).
  - `src/backend/js/templ.js` does not import the parser.
- **Stdlib location table:** `docs/architecture.md` has a per-package table of where each stdlib package is implemented. `test/unit/compiler/architecture-doc.test.js` fails when an in-scope manifest package is missing from it or a path in it does not exist.
- **Repo and package:** `git ls-files 'example/*/app.js' 'example/*/app.wasm'` is empty. The root `package.json` has no `gofront` block. `npm pack --dry-run` lists no `stdlib/manifest.json`. CI (`npm test`, `test:e2e`, Pages deploy) passes from a clean checkout.

---

## Scope Rule & Boundary Matrix

A change is in scope when it moves, splits, renames or deletes code, config or files without changing compiler output, CLI behaviour or diagnostics, and makes the architecture gate, the module layout or the package contents easier to follow.

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Pure move or split, output byte-identical | Gate: Sentrux layer coverage, guard script with a cross-backend check, dead WASM shims removed. Repo: `.gitignore` dedupe, looped `build`, example outputs untracked, preact vendor config in `example/preact/gofront.json`. CLI logic out of `src/index.js`. `src/link/` from `compiler.js`. `compileWasm` moved to `compiler.js`. WASM `stdlib/core.js` split per package; `wasm/index.js` and `wasm/stdlib/bytes.js` split. `fmt-types.js` to `src/backend/shared/`. Templ expressions parsed in the templ parser. New folders: `src/cli/`, `src/lexer/`, `src/parser/templ.js`, `test/unit/cli/`, `test/perf/`; test discovery. Stdlib: typechecker stdlib split per package, `typechecker/stdlib/index.js`, the location table, `manifest.json` out of the npm package | |
| **Excluded: deferred** | Valid, but not in this plan | Splitting `emit-stmts.js` (3.6k), `emit-exprs.js` (3.4k), `boundary.js` (3.3k), `js/expressions.js` (2.9k), `js/runtime.js` (2.8k), `wasm/stdlib/io.js` (3.6k), `packages.js` (2.4k), `time.js` (2.2k) | Each is one cohesive dispatch mixin or one runtime. Splitting them by AST kind is a different kind of change from per-package extraction, and v2.0.0 rewrites these files anyway. The worst offenders (10k and 6.7k lines) are handled here |
| **Excluded: deferred** | | Type-checking expressions inside `.templ` bodies | Today `{ name + undefinedVar }` passes `check` and `build` (see Verified Gaps). Fixing it changes diagnostics, so it is a behaviour change, logged in `plans/follow-ups.md`. Phase 6 does the structural groundwork: the AST then exists before the checker runs |
| **Excluded: deferred** | | Removing `wasm/boundary.js` → `js/runtime.js` (the `HELPER_*` imports) | Not a leak: the boundary emits JS facade code that calls the JS runtime helpers. v2.0.0 moves these helpers to `runtime/js/` for both engines. The guard script allowlists exactly this edge |
| **Excluded: deferred** | | Moving `fmt-types.js` into `src/lower/` (reviewer option) | It formats Go types for `%T`/`%v` at emit time and analyses format strings, which is codegen work used by both backends, not a lowering analysis. `src/backend/shared/` keeps it in the backend layer |
| **Excluded: deferred** | | Moving `src/dts-parser.js` into `src/parser/` | It is part of package resolution (imported only by `resolver.js`), parses TypeScript rather than Go, and has its own `internal/dts` in v2.0.0. It stays next to `resolver.js` |
| **Excluded: deferred** | | Folder-only Sentrux globs for the lexer (`src/lexer/*`) | `tokens.js` (types layer 7) and `lexer.js` (layer 6) live in the same folder. One glob would erase the ordering between them, so these keep per-file entries |
| **Excluded: deferred** | | Putting `manifest.json`, `scripts/manifest-overrides.json` and `test/unit/types/stdlib-coverage.gaps.json` in one directory (reviewer option) | Each sits beside its only reader or writer: overrides beside the generator, gaps beside its test, and the manifest beside the packages it describes (and at the path v2.0.0 embeds). Excluding the manifest from `files` removes the cost to the package without moving three files |
| **Excluded: deferred** | | Untracking `example/preact/vendor.js` | Only `gofront prep` writes it, and `npm run build` does not run `prep`. Generating it in CI needs a vendor step in e2e setup and in Pages, which changes the build pipeline |
| **Excluded: deferred** | | Per-package folders that colocate typechecker, JS, WASM and Go sources | This would cut across the layer rules (typechecker 4 vs backend 2). The location table plus per-package file names give the same discoverability |
| **Excluded: deferred** | | Raising Sentrux limits or editing `.sentrux/baseline.json` by hand | This plan must pass the existing gate, not loosen it |

---

## Verified Gaps & Baseline Audit

All probes ran at `ade5edb` on `feat/portable-go`, using a throwaway `git worktree` or temporary untracked files under `.probes/` (removed afterwards). At that commit portable-go Phases 4.4–7.2 were still open. The structural findings hold for the finished state, but line counts and line numbers will have moved, because finishing portable-go adds WASM JSON codecs and SIMD emitters under `src/backend/wasm/`. Each phase's first task re-runs the relevant `wc -l`/`grep -n` probe on its base commit and splits along the method boundaries it finds, not the line numbers below. Any new file in `src/backend/wasm/stdlib/` over 4,000 lines falls under the same size target.

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Sentrux: unlayered `src` | `src/colors.js`, `src/project-config.js`, `src/pwa.js`, `src/typechecker/constants.js` and `src/typechecker/const-fold.js` are in no layer, so violations involving them pass the gate | Probe: a glob matcher over `.sentrux/rules.toml` `paths` vs `src/**` prints those 5 files plus `typechecker/expressions.js` as `UNLAYERED`. Injecting `import "../backend/js/index.js"` into `typechecker/constants.js` → `✓ All rules pass`. The same import in the layered `typechecker/statements.js` → `✗ layer_direction ... typechecker must not depend on backend`. `import "./pwa.js"` in `src/lexer.js` → `✓ All rules pass` |
| Sentrux: dead glob | The typechecker layer lists `src/typechecker/expressions/*`, which does not exist (the module is one file). Sentrux still assigns `expressions.js` a layer: an injected backend import is caught | `.sentrux/rules.toml`. Probe: inject into `typechecker/expressions.js` → `✗ ... typechecker must not depend on backend` |
| Sentrux: nested stdlib | `*` matches only one directory level, so `stdlib/container/{heap,list,ring}`, `encoding/base32`, `sync/atomic`, `unicode/utf16` and `unicode/utf8/bytes.go` are unchecked. `**` works | Probe: `import "net/url"` in `stdlib/unicode/utf16/utf16.go` → `✓`. The same in `stdlib/sort/sort.go` → `✗ stdlib-leaf must not depend on stdlib-top`. With `stdlib/unicode/**` → `✗` (caught) |
| Sentrux: hidden violations | Layering everything reveals exactly one violation, `stdlib/hash/fnv/fnv.go` → `src/backend/js/stdlib/bits.js`. This is the documented `math/bits` suffix false positive, so `hash` needs explicit globs, not `**` | Probe: rules rewritten (6 src files added, `stdlib/*/` → `/**`) → that single `✗` |
| Review claim: upward imports | **Not confirmed as gate leaks.** The reviewer read backend → typechecker/parser/lexer imports as upward. In `rules.toml` a layer may import layers with a *higher* order number, and backend (2) → lower (3), typechecker (4), parser (5), lexer (6) is the allowed direction. The real problems are narrower: the next three rows | `.sentrux/rules.toml` header comment. `grep -rnE 'from "(\.\./)+(lexer\|tokens\|parser/\|typechecker/\|lower/)' src/backend` → 20 edges, none flagged by `sentrux check` |
| `compileWasm` in the backend | `src/backend/wasm/index.js:3566` `compileWasm(source)` runs Lexer → Parser → TypeChecker → lower → `compileWasmModule`. It is a single-file test driver: callers are `test/unit/helpers.js:16` and direct imports in `wasm/scalars.test.js`, `wasm/arrays.test.js`, `types/arrays.test.js`. It is the only reason `wasm/index.js` imports `lexer.js`, `parser/index.js` and `typechecker/index.js` (`monomorph.js` importing `TypeChecker` to re-check instantiations is legitimate) | `grep -rn 'compileWasm\b' src test` |
| Parser in JS codegen | `src/backend/js/templ.js:5` imports `Parser` and builds new parsers during codegen (`:247` `parseFor`, `:297/:306/:317` `parseExpr`) to turn templ `{ expr }` and `for` headers from tokens into AST | `grep -n 'new Parser' src/backend/js/templ.js` → 4 sites |
| `.templ` expressions unchecked | Because those expressions only become AST in codegen, the checker never sees them: `{ name + undefinedVar }` and `{ name + 5 }` (with `name string`) pass `gofront check` (exit 0) and `build` emits `String(name + undefinedVar)` | Probe `.probes/tp/`: `main.go` + `view.templ`; `node src/index.js check` → `OK`; built `app.js:8,11`. Logged as a follow-up (behaviour change, out of scope) |
| Cross-backend imports | `wasm/stdlib/core.js:6` imports `fmtTypeDesc`/`fmtWantsTypes` from `js/fmt-types.js`, which is also used by `js/stdlib/fmt.js` and `js/fmt-runtime.js`. `wasm/boundary.js:48` imports `HELPER_*` from `js/runtime.js` (by design, see matrix). Nothing in `js/` imports `wasm/` | `grep -rnE 'from "(\.\./)+js/' src/backend/wasm`. `grep -rln fmt-types.js src` |
| WASM stdlib size | `wasm/stdlib/core.js` is one 10,069-line class (`StdlibCoreEmitter`, about 100 methods). Approximate lines per package: slices 3,691, fmt/externref helpers 1,959, strings 1,570, bits 667, maps 543, errors 429, sort 323, strconv 225, math 220, testing 107 | Method start lines bucketed by name prefix. Largest: `emitBuilderMethodCall` (475), `emitSlicesReplace` (308), `emitStringsCall` (295) |
| WASM mixins | `emit.js` mixes in each emitter with `copyMethods`, which throws on duplicate names, so splitting is mechanically safe. `stdlibEmitters` in `wasm/stdlib/index.js` is exported but never imported, and `emit.js:1829-1840` lists every mixin by hand | `src/backend/wasm/emit.js:1815-1840`. `grep -rn stdlibEmitters src test` → definition only |
| Dead shims | `src/backend/wasm/emit-stdlib.js` has no importers. The `Phase6/7/8Emitter`/`StdlibEmitter` aliases in `wasm/stdlib/index.js` and `core.js:10069` have no users. `typechecker/types.js:105` still points at `emit-stdlib.js` | `grep -rn 'emit-stdlib\|Phase[678]Emitter\|StdlibEmitter\b' src test` → self-references only |
| `wasm/index.js` | 4,665 lines: `ModuleEmitter` (298–2360), `compileWasmModule` (2459–3331), about 1,300 lines of pre-scan and global-init helpers (3331–4665), and `compileWasm` (3566) | `grep -nE '^(export )?(class\|function\|const) ' src/backend/wasm/index.js` |
| `compiler.js` | 1,440 lines in the support layer, with three jobs: chunk and source-map merging (95–180), WASM unit linking (179–470), and the Go-source stdlib load/mangle/check/emit pipeline (473–933). Plus `resolveImports` and the public `compile*` entry points | `grep -n '^function\|^export function' src/compiler.js` |
| CLI entry | `src/index.js` (371 lines) has `copyProjectAssets` (231), the single-shot compile → minify → write → report flow (243–321) and the watch-mode reporters (332–368), contrary to the AGENTS.md rule "Never modify `src/index.js` for logic" | `src/index.js:231-368` |
| Flat `src/` | `src/` mixes the lexer stage (`lexer.js`, `templ-lexer.js`, `tokens.js`), a parser-stage file (`templ-parser.js`, already in the parser layer), CLI/dev tooling (`cli-core`, `dev-server`, `test-runner`, `asset-manager`, `vendor`, `pwa`, `project-config`, `colors`, `minifier`) and pipeline drivers (`compiler`, `resolver`, `dts-parser`). The later stages have folders. v2.0.0 maps the tooling to `internal/cli`, `internal/devserver` and `internal/minify` | `ls src`. `plans/v2.0.0/native-go-engine.md` §1.1 Repository Layout |
| Entry-file convention | `src/typechecker/stdlib.js` sits beside `src/typechecker/stdlib/`, while `backend/js/stdlib/` and `backend/wasm/stdlib/` use an `index.js` | `ls src/typechecker` |
| Stdlib scatter | One package can live in four places: `stdlib/<pkg>/`, `typechecker/stdlib/*.js`, `backend/js/stdlib/*.js` and `backend/wasm/stdlib/*.js`. `math`, `strconv`, `io`, `strings` and `unicode/utf8` are in all four. Some homes are hard to guess (`log` in `js/stdlib/math.js`, WASM `strings` partly in `wasm/stdlib/io.js`) | Grep of quoted import paths per non-excluded manifest package → 15 packages in 3 or more places (a heuristic that undercounts WASM) |
| Typechecker stdlib | `typechecker/stdlib/core.js` (1,079 lines, 14 packages) and `extended.js` (1,202 lines, 15 packages) are each one function of per-package `globals.define("<pkg>", …)` blocks, called in a fixed order from `typechecker/stdlib.js:17-18` | `grep -n 'globals.define("' src/typechecker/stdlib/{core,extended}.js` |
| Manifest in the npm package | `stdlib/manifest.json` (377,470 bytes) is shipped because `files` includes `stdlib/`, but no runtime code loads it. `src/` only mentions it in comments (`typechecker/stdlib/excluded.js:2`, `signature.js:3`), and its readers are `scripts/stdlib-manifest.js`, `scripts/docs-stdlib.js` and two unit tests. It is 11% of the unpacked package (3.43 MB) and about 23 KB of the 617 KB tarball. The reviewer's "~430 KB" is an overestimate | `npm pack --dry-run --json --ignore-scripts` → 159 files, unpacked 3,432,186, tarball 616,821. `grep -rn manifest src` |
| Stale stdlib paths | The roadmap's v2.0.0 theme and `native-go-engine.md:92` say the *v1.8.0* stdlib/manifest is in `runtime/stdlib/`. PR #53 (`b34b52f`) moved it to `stdlib/`. The roadmap's v1.8.0 row says `src/stdlib/go/`. `native-go-engine.md` §1.1 (`:127`, `:156`) describes the *v2.0.0* target layout with `runtime/stdlib/`, which is a design choice for the port and not stale | `grep -n 'runtime/stdlib\|src/stdlib/go' plans/roadmap.md plans/v2.0.0/native-go-engine.md` |
| Perf in `e2e/` | `test/e2e/perf/` (`raycast-bench.js`, `zero-alloc.js`, `raycast/` fixtures) are Node/V8 scripts, not Playwright specs. Playwright ignores them only because each project's `testMatch` names its specs. Referenced by `package.json` `test`/`bench`, `docs/hybrid-wasm.md:385` and v2.0.0 tasks | `playwright.config.js:4,15-35`. `grep -rn 'e2e/perf'` |
| Example config in root | The root `package.json` has a 30-line `gofront.vendor` block that only serves `example/preact` (dest `example/preact/vendor.js`). `project-config.js` already reads `gofront.json` from a project root, and vendor destinations must lie inside the project directory | `package.json` `gofront`. `src/project-config.js:2-19`. `src/vendor.js` `resolveDestinationPaths`. Probe: `prep example/preact` with a temporary `example/preact/gofront.json` → `no bundler found`; the same with the root config → same message. `esbuild` is a declared devDependency but not installed locally, so the byte comparison is done in Task 2.4 after `npm ci` |
| Committed build output | `example/*/app.js` (6) and `example/hybrid/app.wasm` are tracked, stale (rebuilding at HEAD changes 6 of 7) and touched by 40 commits. Nothing reads them from git: e2e `global-setup.js` and the Pages job build first | Worktree `npm run build && git status --short example` → 6 `M`. `git log --oneline -- 'example/*/app.js' 'example/*/app.wasm' \| wc -l` → 40 |
| Build determinism | Two consecutive builds are byte-identical, so hashes work as the regression oracle | `npm run build` twice → `sha256sum -c` all `OK` |
| `build` script | Six copies of `node src/index.js example/X/src -o example/X/app.js` chained with `&&`. A new example is silently left out | `package.json` `scripts.build` |
| `.gitignore` | 8 patterns appear twice (the top agent-artifact block duplicates the bootstrap-managed block) | `grep -vE '^\s*(#\|$)' .gitignore \| sort \| uniq -d` |
| Unit test layout | `test/unit/compiler/` mixes CLI/tooling tests (`cli`, `cli-core`, `dev-server`, `pwa`, `asset-manager`, `test-runner`, `prep`) with compiler internals (21 files). `run.js` hand-lists 80 files. The list is complete today, but a new file that is not added never runs | Set comparison of `TEST_FILES` vs `find test/unit -name '*.test.js'` → 80/80 |
| Public surface | No `main` or `exports` in `package.json`, only `bin: src/index.js` and `files: [src/, stdlib/]`. Moving modules under `src/` cannot break a user's import | `node -e 'require("./package.json").main'` → `undefined` |
| Baseline suites | Unit 2680/2680 (16 s), conformance 40/40 (5 s), `sentrux check` ✓ (Quality 6258), `sentrux gate` ✓ | At `ade5edb` |

### Baseline build hashes

The `sha256` prefixes below are from `ade5edb`. They show the format and confirm determinism, but they are **not** the oracle, because the finished portable-go plan changes the output. Before Phase 1, run the following on `main` and commit the full list into this section:

```
npm run build && sha256sum example/*/app.js example/hybrid/app.wasm example/preact/vendor.js
```

Every phase checks against that list with `sha256sum -c` and pastes the output into its PR body.

```
63c424ab66b0 example/gom/app.js
101ef64d3b6f example/hybrid/app.js
78390fedd5f1 example/preact/app.js
9dfe0a3cd112 example/simple/app.js
39b6ed40c07e example/templ/app.js
4adf32f93d43 example/webgl/app.js
662ece013a8b example/hybrid/app.wasm
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
src/typechecker/          … stdlib/index.js ★ (was stdlib.js), stdlib/pkg/<pkg>.js ★
src/lower/
src/backend/shared/ ★     fmt-types.js                               (from backend/js/)
src/backend/js/
src/backend/wasm/         … module-emitter.js ★, prescan.js ★, globals.js ★
src/backend/wasm/stdlib/  … slices, strings, fmt, math, maps, bytes-buffer, shared ★
```

**Layer guard (`scripts/check-layers.js`).** A dependency-free Node script.
- It parses the `[[layers]] paths` arrays out of `.sentrux/rules.toml` with a regex, because the file is flat and the project adds no TOML dependency. Globs become regexes (`*` = one segment, `**` = any depth).
- Check 1: every file in `src/**/*.js` and `stdlib/**/*.go` matches some layer.
- Check 2: no glob is dead (matches nothing).
- Check 3 (cross-backend): it scans import specifiers in `src/backend/js/**` and `src/backend/wasm/**` and fails on any import of the other backend, except `ALLOW_CROSS = [["src/backend/wasm/boundary.js", "src/backend/js/runtime.js"]]`.
- `ALLOW` lists the documented unlayered files (`stdlib/math/extra.go`, `stdlib/hash/fnv/fnv.go`) with reasons.
- The logic is exported as `findLayerGaps(tomlText, files)` and `findCrossBackendImports(sources)` so unit tests can drive it with fixtures.
- It runs in `npm run check` before `sentrux check`.

Sentrux cannot express "peer layers must not import each other". It only supports a linear order, so ordering `js` above `wasm` would allow one direction. The script covers what Sentrux can't.

**Layer assignments.** These are later rewritten to folder globs in Phase 7 where a folder maps to a single layer.
- `colors`, `project-config` and `pwa` go to support (1).
- `typechecker/constants`, `const-fold` and `expressions` go to typechecker (4).
- The dead `expressions/*` glob is removed.
- Nested stdlib packages use `**` (`container/**`, `encoding/**`, `sync/**`, `unicode/**`).
- `hash` stays explicit, so `fnv` remains deliberately unlayered.
- After Phase 7: support = `src/compiler.js`, `src/resolver.js`, `src/dts-parser.js`, `src/link/*`, `src/cli/*`. Lexer = `src/lexer/lexer.js`, `src/lexer/templ-lexer.js`. Types = `src/lexer/tokens.js`, `src/typechecker/types.js`. Parser = `src/parser/*`. `compiler.js` importing `cli/colors.js` for warning output is a same-layer edge and is allowed.

**`compileWasm` → `compiler.js`.** The single-file WASM driver moves verbatim and is exported from `src/compiler.js` under the same name. `test/unit/helpers.js` and the three tests that import it directly switch to `../../src/compiler.js`. `wasm/index.js` then drops its imports of `Lexer`, `Parser`, `TypeChecker` (the class) and `lower`. Whatever `compileWasmModule` still needs at runtime it receives from its caller, as it already does for `compiler.js`. A re-export from the backend is not kept, because the package has no public JS API.

**Templ expressions parsed by the templ parser.** Today `TemplParser` stores the raw token runs of `{ expr }`, attribute expressions and `for` headers, and `backend/js/templ.js` turns them into AST by constructing a `Parser`. After the change `TemplParser`, which already imports `Parser` and sits in the parser layer, calls `parseExpr`/`parseFor` on the same token arrays (with the same synthetic EOF token) when it builds each templ node. It stores the result on the node (`node.expr`, `node.forStmt`). `templ.js` reads those fields and no longer imports `parser/` or `tokens.js`, unless it needs `T` for something other than building parsers, in which case only that import stays. This is the groundwork the type-check follow-up needs, but this plan does not walk those nodes in the checker.

**`fmt-types.js` → `src/backend/shared/`.** Moved verbatim. The importers `js/stdlib/fmt.js`, `js/fmt-runtime.js` and `wasm/stdlib/core.js` (or `wasm/stdlib/fmt.js` after Phase 4) are updated. `"src/backend/shared/*"` joins the backend layer glob list.

**WASM mixin registry.** `emit.js` loops over `stdlibEmitters` instead of listing stdlib mixins by hand. The non-stdlib mixins stay explicit, in order. `copyMethods` throws on duplicate names, which is the safety net for every split. Mixins only add methods and never override them, so the order changes nothing.

**WASM `stdlib/core.js` split.** Methods move verbatim into new mixin classes, each appended to `stdlibEmitters`:
- `slices.js`: `emitSlices*`, `_emitSliceClear`, `_emitCallLess`.
- `strings.js`: `emitStrings*`, `Builder`/`Replacer` method calls, `_collectStringParts`, `_appendStringToByteSlice`.
- `fmt.js`: `emitFmt*`, the `*ToExternref` conversions, `_anyFmt*`.
- `math.js`: math and bits, plus `MATH_*` and `BINARY_MATH_IMPORTS`, which `stdlib/index.js` keeps re-exporting.
- `maps.js`: maps and sort, plus `_emitCallCmp*`.

`core.js` keeps errors, strconv, testing, the path constants and shared runtime helpers (about 1,300 lines). A module-level helper moves with its only user. A helper used by several files goes to a new `wasm/stdlib/shared.js`. Mixin files never import each other. The `stdlib/index.js` header comment lists every file.

**`wasm/index.js` split.**
- `module-emitter.js`: `ModuleEmitter`.
- `prescan.js`: `_uses*`, `_scanImportsInBody`, `_scanInterface*`, `_scanFuncSigInterfaces`, `_someNode`, `importsAnyOf`, `hasErrorUsage`.
- `globals.js`: `_collectPackage{Consts,Globals}`, `_zero*Const`, `_arrayShape`, `_orderConstInits`, `_makeGlobalInitFunc`, `_makeInterfaceDispatcher`.

`index.js` keeps `compileWasmModule`, `STDLIB_IMPORTS` and its other exports, each still exported under the same name and value (snapshot test). `wasm/stdlib/bytes.js`: the `bytes.Buffer` method bodies move to a new `BytesBufferEmitter` in `bytes-buffer.js`.

**`src/link/` from `compiler.js`.**
- `link/sourcemap.js`: chunk and map merging.
- `link/wasm.js`: unit registration, linking, AST cloning, collision checks, facade splicing.
- `link/stdlib.js`: `stdlibSuffix` … `importStdlibPackages`.

The stdlib loader calls back into the pipeline, so a direct import of `compiler.js` from `link/stdlib.js` would create a cycle and fail `max_cycles = 0`. Instead `link/stdlib.js` takes `parseGoFrontFile`, `gwFilesIn` and the checker constructor as a `deps` argument.

**CLI entry.** `copyProjectAssets`, the single-shot flow and the watch-mode reporters move to `cli-core.js` as `runSingleShot(inputPath, isDir, flags)` (returns an exit code) and `devReporters({ outputFile, copyAssets })`. `index.js` keeps argument parsing, the `--serve` validation and the dispatch. Messages, streams and exit codes stay identical.

**Preact vendor config.** The root `package.json` `gofront` block moves to `example/preact/gofront.json`, with `dest` changed from `example/preact/vendor.js` to `vendor.js` because destinations resolve against the project directory. The vendored packages still resolve from the root `node_modules`, because `findBundler` and package resolution use `createRequire` rooted in `example/preact/`, and Node walks up the directory tree. The `vendor.js` header comment and `docs/usage.md` say that `node src/index.js prep example/preact` regenerates it.

**Test layout.**
- `run.js` builds `TEST_FILES` by walking its directory (skipping `fixtures/`), sorted. `HEAVIEST_TEST_FILES` stays as a scheduling hint, and a missing entry throws.
- CLI and tooling tests move to `test/unit/cli/`, mirroring `src/cli/`.
- `test/e2e/perf/` moves to `test/perf/`. Playwright's `testDir: ./test/e2e` then contains only specs, and `package.json` `test`/`bench`, `docs/hybrid-wasm.md` and the v2.0.0 plan's perf paths are updated. Completed plans are historical and stay untouched.

**Typechecker stdlib.**
- `typechecker/stdlib.js` becomes `typechecker/stdlib/index.js`.
- Each `globals.define("<pkg>", …)` block and its private type constants move to `typechecker/stdlib/pkg/<pkg>.js`, which exports `define(globals, types)`. `bits` lives in `pkg/bits.js`.
- `index.js` calls the files in the current order, from an ordered array. Shared constants (for example `TIME_T`, used by `time` and `os`) go to the existing `stdlib/shared.js`.

**Location table.** `docs/architecture.md` gains a "Where a stdlib package lives" table: one row per non-excluded manifest package, with *Go source*, *Types*, *JS emitter* and *WASM emitter* columns. It is checked by a unit test, not generated, because WASM dispatch uses short names and cannot be derived reliably.

**Manifest out of the npm package.** `package.json` `files` becomes `["src/", "stdlib/", "!stdlib/manifest.json"]`. `npm pack --dry-run` verifies the result. The file stays in the repo at the same path, so `scripts/`, the tests and the v2.0.0 embed plan are unaffected.

### 2. Invariants & Safety Bounds

- **Byte-identical output.** After every task, `npm run build` reproduces the recorded hashes. A task that changes a hash is wrong by definition: revert and retry.
- **No behaviour change.** Diagnostics (text and position), CLI messages, streams, exit codes and module export names are unchanged. Moved code is verbatim, and reformatting comes only from Biome.
- **The gate only gets stricter.** `max_cycles` stays 0, and `max_coupling`, `max_cc` and `no_god_files` are unchanged. `sentrux gate` must not report degradation. If a split worsens coupling, the split is revised; the baseline is not edited.
- **Zero runtime dependencies.** The guard script and test discovery use only `node:` modules.
- **Test count.** Never fewer than 2680 unit tests plus the tests this plan adds. Discovery must find the same files (plus new ones).
- **Package contents.** Apart from `stdlib/manifest.json`, `npm pack --dry-run` lists the same files before and after each phase, modulo the paths this plan renames under `src/`.

### 3. Edge Cases & Error Handling

- **Cycles from extraction.** `link/stdlib.js` gets its dependencies injected. A WASM helper used by two mixins goes to `wasm/stdlib/shared.js`. `compileWasm` moving into `compiler.js` adds a support → backend edge, which already exists.
- **Mixin `this` coupling.** Methods stay inside mixins, and only free functions move to `shared.js`. A duplicate name surfaces as the `copyMethods` error when the module loads.
- **Templ parse timing.** Moving `parseExpr`/`parseFor` from codegen to `TemplParser` can only change *when* a templ expression syntax error is raised, not its text. Task 6.2 first pins the current message and position for a malformed `{ a + }` and a malformed `for` header, under both `build` and `check`. If `check` did not report these before (because it skipped codegen) and now does, that is a visible change: record it in the Release note, or keep the old timing by deferring the throw. The task picks whichever keeps the pinned outputs and the `check` exit code unchanged.
- **Typechecker definition order.** Task 8.1 first adds a snapshot of the ordered global names plus a stable JSON hash of their types. The split must keep it green.
- **Vendor resolution from a subdirectory.** If `prep example/preact` cannot resolve `preact` or the bundler from the subdirectory, Task 2.4 stops and records why instead of adding a `node_modules` path hack. The block then stays in the root `package.json`, and the matrix row moves to `Excluded: deferred`.
- **`files` negation.** If the installed npm version ignores the `!` entry, fall back to listing the stdlib package directories explicitly. The Task 8.4 test is the arbiter.
- **Fresh clone with no build.** Opening an example without `npm run build` gives a 404 for `app.js`. The README and `docs/usage.md` say to build first. CI is unaffected.
- **Moving tests.** Moved tests keep their directory depth, so only the `src/` targets that moved need rewriting. `test/perf/` is one level shallower than `test/e2e/perf/`, so its relative imports and fixture paths are rewritten and the scripts run once from the new location.
- **Emitters added by portable-go.** WASM JSON and SIMD emitters are registered through `stdlibEmitters` like the rest. Any of them inside `core.js` or `index.js` moves out in Phase 4 or 5 under the same rules.
- **v1.8.x fixes during the cleanup.** A fix that lands on `main` mid-plan is merged into the plan branch before the next phase, and the hashes are re-recorded in that phase's PR body.

---

## Implementation Tasks

### Phase 1: Architecture gate coverage & repo hygiene
*Before Task 1.1, record the baseline hashes on `main` (see [Baseline build hashes](#baseline-build-hashes)).*

- [ ] Task 1.1: Layer guard script
  - Files: `scripts/check-layers.js`, `package.json` (add to `check` before `sentrux check`)
  - Test: `test/unit/compiler/check-layers.test.js`:
    - `findLayerGaps` on fixture TOML and file lists flags an unlayered file, a dead glob, `*` vs `**` depth, and `ALLOW`.
    - `findCrossBackendImports` flags a fixture `js → wasm` import and a non-allowlisted `wasm → js` import, and passes the `boundary.js → js/runtime.js` edge.
    - A real-repo case (expected to fail at this point: 6 src + 9 stdlib files, plus the `core.js → fmt-types.js` edge) lands as `todo`.
  - Done when: the fixture cases pass and the real-repo case lists exactly the files in Verified Gaps
- [ ] Task 1.2: Complete the Sentrux layers
  - Files: `.sentrux/rules.toml`
  - Test: the real-repo layer-gap case from Task 1.1 is turned on. The cross-backend case stays `todo` until Task 6.1
  - Done when: the layer-gap check is clean, `sentrux check` and `sentrux gate` pass, and the `rules.toml` comment documents `fnv` and `math` as the only allowed gaps
- [ ] Task 1.3: Remove the dead WASM compatibility shims
  - Files: `src/backend/wasm/emit-stdlib.js` (delete), `src/backend/wasm/stdlib/index.js`, `src/backend/wasm/stdlib/core.js`; also the comment at `src/typechecker/types.js:105`
  - Test: none new (deletion only). `grep -rn 'emit-stdlib\|Phase[678]Emitter\|StdlibEmitter\b' src test` must be empty
  - Done when: grep is empty, the hashes match and `wasm/golden.test.js` passes
- [ ] Task 1.4: Register stdlib mixins through `stdlibEmitters`
  - Files: `src/backend/wasm/emit.js`, `src/backend/wasm/stdlib/index.js`
  - Test: new `test/unit/wasm/mixins.test.js`: every class in `stdlibEmitters` has its prototype methods on `FunctionEmitter.prototype`. Fails first against a temporary probe mixin added to the array
  - Done when: `emit.js` has no hand-listed stdlib `copyMethods` lines, and the hashes match
- [ ] Task 1.5: Looped example build and `.gitignore` dedupe
  - Files: `scripts/build-examples.js` (exports `listExamples(root)`), `package.json` (`build`), `.gitignore`
  - Test: `test/unit/compiler/build-examples.test.js`: `listExamples` returns exactly the example directories that have `src/`, and skips a temp directory without one
  - Done when: `npm run build` reproduces the hashes, and the `.gitignore` duplicate check is empty

### Phase 2: CLI entry, build outputs & example config

- [ ] Task 2.1: Move single-shot compilation into `cli-core.js`
  - Files: `src/index.js`, `src/cli-core.js`
  - Test: `test/unit/compiler/cli-core.test.js` adds `runSingleShot` cases: `--check` returns 0 with an `OK` line; `-o` output equals `compileDir`; a compile error returns 1 with the `log.fail` text; `--tokens` dumps tokens. Fails first because the export is missing
  - Done when: `index.js` has no compile/minify/write code, and the `cli.test.js` smoke tests pass unchanged
- [ ] Task 2.2: Move the watch-mode reporters and asset copy into `cli-core.js`
  - Files: `src/index.js`, `src/cli-core.js`
  - Test: `cli-core.test.js`: `devReporters` with captured stderr. `onBuild` prints `OK — wrote …`; `onError` prints `ERROR` plus the formatted diagnostic; `copyAssets: true` calls the asset copy
  - Done when: `wc -l src/index.js` ≤ 220, and the dev-server tests pass unchanged
- [ ] Task 2.3: Stop tracking the compiled examples
  - Files: `.gitignore` (`/example/*/app.js`, `/example/*/app.wasm`, with a comment that `vendor.js` stays tracked); `git rm --cached` for the 7 outputs
  - Test: `build-examples.test.js`: `git ls-files example` has no `app.js`/`app.wasm` and still has `example/preact/vendor.js`
  - Done when: on a fresh clone, `npm ci && npm test && npm run test:e2e` pass
- [ ] Task 2.4: Move the preact vendor config into `example/preact/gofront.json`
  - Files: `package.json` (drop the `gofront` block), `example/preact/gofront.json` (new, `dest: "vendor.js"`), `docs/usage.md` (how to regenerate)
  - Test: in `test/unit/compiler/prep.test.js`, `loadProjectConfig("example/preact").vendor` has the preact packages and `loadProjectConfig(".")` has no `vendor`. After `npm ci`, run `node src/index.js prep example/preact` → `sha256sum -c` on the recorded `vendor.js` hash
  - Done when: `vendor.js` is byte-identical, or the task stops per Edge Cases (vendor resolution)
- [ ] Task 2.5: Document building the examples
  - Files: `README.md` (examples section), `docs/usage.md`
  - Test: none (docs); reviewed against the AGENTS.md docs and changelog rules
  - Done when: both say to run `npm run build` before opening an example, and the `CHANGELOG.md` `[Unreleased]` entry matches the Release note

### Phase 3: `src/link/` extracted from `compiler.js`

- [ ] Task 3.1: Source-map merging → `src/link/sourcemap.js`
  - Files: `src/compiler.js`, `src/link/sourcemap.js`, `.sentrux/rules.toml` (add `"src/link/*"` to support)
  - Test: `test/unit/compiler/link.test.js`: `mergeCompilationChunks` on two fixture chunks gives the expected offset `mappings`. Fails first because the module is missing
  - Done when: source-map tests and hashes are unchanged, and `check-layers` passes
- [ ] Task 3.2: WASM unit linking → `src/link/wasm.js`
  - Files: `src/compiler.js`, `src/link/wasm.js`
  - Test: `link.test.js`: `checkLinkCollisions` reports a duplicate top-level name across two units with the existing message
  - Done when: `test/unit/wasm/*` and the `example/hybrid` hashes are unchanged
- [ ] Task 3.3: Go-source stdlib pipeline → `src/link/stdlib.js` with injected dependencies
  - Files: `src/compiler.js`, `src/link/stdlib.js`
  - Test: `link.test.js`: the mangling helper renames a top-level stdlib declaration with the package suffix, and leaves type parameters and overlay names alone
  - Done when: conformance is 40/40, `stdlib-go.test.js` passes, `sentrux check` reports 0 cycles, and `wc -l src/compiler.js` ≤ 700

### Phase 4: WASM `stdlib/core.js` split by package

- [ ] Task 4.1: `slices` → `wasm/stdlib/slices.js`
  - Files: `stdlib/core.js`, `stdlib/slices.js`, `stdlib/index.js`
  - Test: `wasm/mixins.test.js`: `SlicesEmitter` is registered and owns `emitSlicesReplace`. Fails first
  - Done when: `wasm/slices.test.js` and the stdlib parity tests pass, and the hashes match
- [ ] Task 4.2: `strings`, `Builder`, `Replacer` → `wasm/stdlib/strings.js`
  - Files: `stdlib/core.js`, `stdlib/strings.js`, `stdlib/index.js`
  - Test: `mixins.test.js`: `StringsEmitter` owns `emitStringsCall` and `emitBuilderMethodCall`
  - Done when: `wasm/strings_any.test.js` and the conformance `strings` fixtures pass, and the hashes match
- [ ] Task 4.3: `fmt` and externref/any-format helpers → `wasm/stdlib/fmt.js`, with cross-file helpers in `wasm/stdlib/shared.js`
  - Files: `stdlib/core.js`, `stdlib/fmt.js`, `stdlib/shared.js`
  - Test: `mixins.test.js`: `FmtEmitter` owns `_emitAnyToExternref` and the `_anyFmt*` helpers
  - Done when: `wasm/fmt-any.test.js` and the conformance `fmt` fixtures pass, and the hashes match
- [ ] Task 4.4: `math` + `bits` → `wasm/stdlib/math.js`; `maps` + `sort` → `wasm/stdlib/maps.js`
  - Files: `stdlib/core.js`, `stdlib/math.js`, `stdlib/maps.js`
  - Test: `mixins.test.js` checks ownership of `emitMathCall`, `_emitBitsArith`, `emitMapsEqual` and `emitSortCall`. `BINARY_MATH_IMPORTS` is still exported from `stdlib/index.js`
  - Done when: every `wasm/stdlib/` file except `bytes.js` is ≤ 4,000 lines, `core.js` ≤ 1,500, and the header comment lists every file

### Phase 5: `wasm/index.js` and `wasm/stdlib/bytes.js` split

- [ ] Task 5.1: `compileWasm` → `src/compiler.js`
  - Files: `src/backend/wasm/index.js`, `src/compiler.js`, `test/unit/helpers.js` (plus the import line in `wasm/scalars.test.js`, `wasm/arrays.test.js` and `types/arrays.test.js`)
  - Test: `test/unit/wasm/encode.test.js` asserts that `compileWasm` is exported from `src/compiler.js` and that `wasm/index.js`'s source has no import from `lexer`, `parser/` or `typechecker/index.js`. Fails first
  - Done when: all `wasm/` tests pass through the new import, the hashes match, and `wc -l src/compiler.js` ≤ 750
- [ ] Task 5.2: `ModuleEmitter` → `wasm/module-emitter.js`
  - Files: `wasm/index.js`, `wasm/module-emitter.js`
  - Test: `wasm/encode.test.js`: the export list of `wasm/index.js` equals a snapshot taken before the move (after Task 5.1). Write the snapshot first
  - Done when: the snapshot is unchanged and the hashes match
- [ ] Task 5.3: Pre-scan helpers → `wasm/prescan.js`
  - Files: `wasm/index.js`, `wasm/prescan.js`
  - Test: `wasm/encode.test.js`: `_usesFmtAny` returns true for a parsed program that calls `fmt.Println(any(x))` and false otherwise
  - Done when: the hashes match
- [ ] Task 5.4: Global and zero-init helpers → `wasm/globals.js`
  - Files: `wasm/index.js`, `wasm/globals.js`
  - Test: `wasm/encode.test.js`: `_orderConstInits` orders dependent constants topologically on a fixture
  - Done when: `wc -l src/backend/wasm/index.js` ≤ 1,800, and the hashes match
- [ ] Task 5.5: `bytes.Buffer` methods → `wasm/stdlib/bytes-buffer.js`
  - Files: `stdlib/bytes.js`, `stdlib/bytes-buffer.js`, `stdlib/index.js`
  - Test: `mixins.test.js`: `BytesBufferEmitter` owns the Buffer method emitters
  - Done when: `builtins/bytes.test.js` and the conformance `bytes` fixtures pass, every `wasm/stdlib/` file is ≤ 4,000 lines, and the hashes match

### Phase 6: Backend boundaries

- [ ] Task 6.1: `fmt-types.js` → `src/backend/shared/`
  - Files: `src/backend/shared/fmt-types.js` (moved), importers in `js/stdlib/fmt.js`, `js/fmt-runtime.js` and `wasm/stdlib/fmt.js`, `.sentrux/rules.toml` (backend globs)
  - Test: the Task 1.1 real-repo cross-backend case is turned on, and it lists only the allowlisted `boundary.js → js/runtime.js` edge
  - Done when: `check-layers` passes with the cross-backend check on, and the hashes match
- [ ] Task 6.2: Parse templ `{ expr }` and attribute expressions in `TemplParser`
  - Files: `src/templ-parser.js`, `src/backend/js/templ.js`
  - Test: `test/unit/compiler/templ.test.js`:
    - Written first, passing on the old code: pinned error text, position and exit code for a malformed `{ a + }` under `build` and `check`.
    - New (fails first): the parsed templ AST for `{ name }` has `node.expr.kind === "Ident"`.
  - Done when: the pinned errors are unchanged, `templ.js` has no `parseExpr` call, and the `example/templ`/`gom` hashes match
- [ ] Task 6.3: Parse templ `for` headers in `TemplParser`; drop the parser import from JS codegen
  - Files: `src/templ-parser.js`, `src/backend/js/templ.js`
  - Test: `templ.test.js`:
    - Pinned error for a malformed `for` header.
    - Parsed `for` nodes carry `node.forStmt`.
    - `templ.js`'s source does not import `parser/`.
  - Done when: `grep -n 'new Parser\|parser/index' src/backend/js/templ.js` is empty, and the hashes match

### Phase 7: `src/cli/`, `src/lexer/` and the test layout

- [ ] Task 7.1: Test discovery in `run.js`
  - Files: `test/unit/run.js`
  - Test: new `test/unit/compiler/runner.test.js`: the exported `TEST_FILES` equals the sorted `find` result and contains every `HEAVIEST_TEST_FILES` entry. Fails first while the list is hand-written and a temporary extra test file exists
  - Done when: `run.js` finds the same files plus the new ones with the same pass count, and a missing heavy entry throws at startup
- [ ] Task 7.2: Move the CLI and tooling modules to `src/cli/`
  - Files: `git mv` of `cli-core`, `dev-server`, `test-runner`, `asset-manager`, `vendor`, `pwa`, `project-config`, `colors` and `minifier` to `src/cli/`; import rewrites in `src/` and `test/`; `.sentrux/rules.toml` (support → `src/cli/*` + the root files + `src/link/*`). This is a mechanical move and exceeds the 3-file rule by design
  - Test: the `check-layers` real-repo cases and `sentrux check`
  - Done when: the hashes match, the suites pass, `check-layers` passes, and `npm pack --dry-run` shows the new paths with `bin` unchanged
- [ ] Task 7.3: Move the lexer files to `src/lexer/` and `templ-parser.js` to `src/parser/templ.js`
  - Files: `git mv` of `lexer`, `templ-lexer` and `tokens` to `src/lexer/`, and `templ-parser.js` to `src/parser/templ.js`; import rewrites; `.sentrux/rules.toml` (per-file lexer and types entries, parser covered by `src/parser/*`)
  - Test: as for 7.2
  - Done when: the hashes match, and `ls src/*.js` lists only `index.js`, `compiler.js`, `resolver.js` and `dts-parser.js`
- [ ] Task 7.4: Split `test/unit/compiler/` → `test/unit/cli/`
  - Files: `git mv` of the `cli`, `cli-core`, `dev-server`, `pwa`, `asset-manager`, `test-runner`, `prep` and `build-examples` tests; the `run.js` header comment and `HEAVIEST_TEST_FILES` paths
  - Test: the Task 7.1 discovery test
  - Done when: the unit pass count is unchanged
- [ ] Task 7.5: `test/e2e/perf/` → `test/perf/`
  - Files: `git mv test/e2e/perf test/perf`; the relative imports and fixture paths in `raycast-bench.js` and `zero-alloc.js`; `package.json` (`test`, `bench`)
  - Test: `node test/perf/zero-alloc.js` passes (it is already part of `npm test`). `node --expose-gc test/perf/raycast-bench.js --tris 1000 --rays 1000` runs to completion
  - Done when: `npm test` passes, `ls test/e2e` has only specs and helpers, and `npm run test:e2e` is unchanged
- [ ] Task 7.6: Update the path references
  - Files: `docs/architecture.md`, `docs/usage.md`, `docs/hybrid-wasm.md`, `AGENTS.md` (Part 2 **Architecture** only), `plans/v2.0.0/native-go-engine.md` (the `src/vendor.js` and `test/e2e/perf/` references)
  - Test: `grep -rnE 'src/(lexer|templ-lexer|templ-parser|tokens|dev-server|pwa|minifier|vendor|asset-manager|test-runner|colors|project-config|cli-core)\.js|test/e2e/perf' docs AGENTS.md plans/v2.0.0 .sentrux package.json` is empty
  - Done when: grep is empty

### Phase 8: Stdlib discoverability & package footprint

- [ ] Task 8.1: `typechecker/stdlib.js` → `typechecker/stdlib/index.js`; split the `core.js` packages into `typechecker/stdlib/pkg/<pkg>.js`
  - Files: `typechecker/stdlib.js` → `typechecker/stdlib/index.js` (+ its importers), `typechecker/stdlib/core.js` (deleted at the end), `typechecker/stdlib/shared.js`, the new `pkg/*.js` (mechanical; exceeds the 3-file rule by design)
  - Test: `test/unit/types/stdlib-coverage.test.js` gains a snapshot of the ordered global names plus a stable JSON hash of their types, written first against the current code
  - Done when: the snapshot is unchanged and the unit and conformance suites pass
- [ ] Task 8.2: Split the typechecker `extended.js` packages the same way
  - Files: `typechecker/stdlib/extended.js` (deleted), `typechecker/stdlib/index.js`, the new `pkg/*.js`
  - Test: the Task 8.1 snapshot
  - Done when: the snapshot is unchanged, and `typechecker/stdlib/` holds only `index.js`, `pkg/`, `shared.js`, `web.js`, `simd.js`, `signature.js` and `excluded.js`
- [ ] Task 8.3: Stdlib location table and its check
  - Files: `docs/architecture.md`, `test/unit/compiler/architecture-doc.test.js`
  - Test: every non-excluded package in `stdlib/manifest.json` has a row, and every path cell exists. Fails first because there is no table
  - Done when: the test passes and the table lists every in-scope package in the finished manifest (52 at `ade5edb`)
- [ ] Task 8.4: Keep `stdlib/manifest.json` out of the npm package
  - Files: `package.json` (`files`)
  - Test: `test/unit/compiler/manifest.test.js`: `npm pack --dry-run --json --ignore-scripts` lists no `stdlib/manifest.json` and still lists every `stdlib/**/*.go` and `src/index.js`. Fails first
  - Done when: the test passes, and `npm pack --dry-run` reports a smaller unpacked size than the Phase 8 base commit
- [ ] Task 8.5: Roadmap, agent guide and v2.0.0 baseline paths
  - Files: `plans/roadmap.md`, `AGENTS.md`, `plans/v2.0.0/native-go-engine.md`
    - `plans/roadmap.md`: the v1.8.0 row's `src/stdlib/go/` → `stdlib/`; the v2.0.0 theme says the v1.8.0 stdlib is in `stdlib/` and is embedded (moved to `runtime/stdlib/` by the port).
    - `AGENTS.md` (Part 2 **Architecture**): the final `src/` layout, `src/link/`, `src/cli/`, `src/lexer/`, `src/backend/shared/`, the WASM per-package mixins, `typechecker/stdlib/pkg/`, the location table and `test/perf/`.
    - `plans/v2.0.0/native-go-engine.md`: `:92` and every "v1.8.0 … `runtime/stdlib/`" statement → `stdlib/`. The §1.1 target layout keeps `runtime/stdlib/` and notes "moved from `stdlib/`". Every JS-engine source path it cites matches the new layout.
  - Test: the Task 8.3 doc test passes. `grep -n 'src/stdlib/go' plans/roadmap.md` is empty. A one-off script confirms every `src/…` path in `native-go-engine.md` exists (output in the PR body)
  - Done when: all three files describe the final layout, and the plan is marked `Status: Completed`
