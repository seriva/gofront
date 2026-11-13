# v1.9.2 Release Bundle Fixes — Design Plan

**Version:** v1.9.2  
**Status:** In Progress  
**Base branch:** main  
**Related:** [`../v1.9.1/follow-ups-2026-11-09-plan.md`](../v1.9.1/follow-ups-2026-11-09-plan.md) (scheduled the first `U4` JSON-codec fix as `G29`; this plan finishes it), [`../v2.0.0/web-platform-evolution-plan.md`](../v2.0.0/web-platform-evolution-plan.md) (Phase 4 whole-program DCE, the home of the deferred size work). Consumer: SimpleFPS (`seriva/simplefps`, `plans/gofront-v1.9-adoption-plan.md`) is blocked on this release; it measured every number below on `gofront@1.9.1` (tag `1.9.1`, `9d0899c`).  
**Release note:** Builds that import `fmt`, `strings`, `strconv` or other standard library packages no longer produce a minified bundle with a syntax error, and programs that use `encoding/json` no longer carry JSON code for packages that never encode anything.  

---

## Goal

GoFront 1.9.0 compiles the standard library from Go source, and the Go source of `unicode/utf8` contains binary literals (`0b00000000`). The built-in minifier does not know `0b`/`0o` literals, so `gofront build` (default minify, with or without `--release`) rewrites them to `0 b00000000` and emits JavaScript that does not parse. Nothing in the test suite parses minified output, and the e2e specs run against `gofront dev` (unminified), so 1.9.0 and 1.9.1 shipped with it. Any program that imports more than `println` is hit (7 of 8 probe programs, 5 of 6 repo examples, SimpleFPS). This plan fixes the minifier, adds the missing parse gate, and removes the one reproducible size regression left after `G29`: JSON codecs generated for packages that never call `encoding/json` (`generateJsonCodecs` register-only path).

Three other 1.9 size effects are measured here and **not** fixed (see *Excluded: deferred*): the Go-source stdlib footprint (`fmt.Println` hello world 24 kB → 176 kB), the larger runtime helper set, and bulkier generated code for user types. They need method-level reachability (v2.0.0 Phase 4). The plan records baselines and adds size budgets so the effect is visible and cannot grow unnoticed.

**Done means:**
- `node --check` accepts the `gofront build` output of every `example/*` and of programs importing `fmt`, `strings`, `strconv`, `unicode/utf8`, `encoding/json`, `sort`, `time`, `bytes`: proven by `test/unit/compiler/minifier.test.js` (all numeric literal forms), `test/unit/compiler/minifier-stdlib.test.js` (new) and `npm run build` (`scripts/build-examples.js` gets a minified pass that parse-checks every example bundle and fails on a syntax error). The new tests and the new build pass fail on `9d0899c` with `Unexpected identifier 'b00000000'`.
- The 3-package JSON repro in *Verified Gaps* emits ≤ 5 `gfj_*` functions (all in the package that calls `json.Marshal`) instead of 51, proven by `test/unit/compiler/json-codec-scope.test.js` (new); dynamic encoding of values from a package with no JSON call stays byte-identical, proven by its differential cases (tags, `omitempty`, `MarshalJSON`, `MarshalText`, `float32`, embedded structs, `map[int]T`, pointers, `time.Time`).
- WASM JSON output is unchanged: `node test/unit/run.js` passes with no edit to `test/unit/wasm/json.test.js` or any other existing test expectation.
- `test/perf/bundle-size.js` (new, part of `npm test`) builds the fixture set with `--release` and fails when a bundle exceeds its ceiling in `test/perf/bundle-size.baseline.json` (post-fix measurement × 1.05).
- `docs/usage.md` has a *Bundle size* section (what a first `fmt`/`strconv`/`encoding/json` import costs, how to read the budget file) and `CHANGELOG.md` has one `### Fixed` entry; `npm run check` and `npm test` pass.

---

## Scope Rule & Boundary Matrix

A change is in scope only if it (a) makes release/minified output valid, or (b) removes generated code that no call site of the program needs and whose absence is provable by differential tests, or (c) measures size so regressions are caught. Making the Go-source stdlib or the generated user code smaller by new analysis is not a patch-release change.

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Minifier numeric tokens, parse gate for built bundles, JSON register-only scoping, size budgets, docs | `_scanNumber` (`src/cli/minifier.js`), `scripts/build-examples.js`, `generateJsonCodecs` (`src/lower/json-codecs.js`), `test/perf/bundle-size.js` | |
| **In scope: target-specific** | JS-only fixes where the other target has its own mechanism | Minifier is JS-only. Register-only codecs are skipped for `js` packages only: WASM has no reflection and keeps them | |
| **Excluded: runtime / platform** | Breaks a GoFront invariant | A JS parser inside the compiler to validate output at build time; reflection-based JSON on WASM | AGENTS.md: the compiler has zero runtime dependencies, so the gate lives in tests and `scripts/`, not in `gofront build`. WASM has no reflection (no `EncodeDynamic` equivalent), so `both`/`wasm` packages must keep their registered encoders |
| **Excluded: deferred** | Valid but needs its own design or measurement | Go-source stdlib footprint (`fmt`/`strconv`/`unicode`/`slices`/`math`); runtime helper footprint; user-code codegen growth; `json.Unmarshal` size; WASM register-only order dependence; `__w<N>` declarations | See *Verified Gaps* rows 8–10 for baselines. Method-level reachability is v2.0.0 Phase 4 (`reachableStdlibDecls`, `src/lower/reachability.js`, called at `src/link/stdlib.js:472`, only prunes whole declarations); user-code growth is the price of nil-receiver wrappers, type tags and checked assertions that make 1.9 match Go semantics; `__w<N>` (589 declarations, ≈ 40 kB in SimpleFPS) is referenced once by its own declaration but is unproven dead (may be a WASM facade table) so it needs a probe before any task; WASM order dependence is unprobed (needs a WASM fixture) |

---

## Verified Gaps & Baseline Audit

Probe setup (scratch, deleted afterwards): published `gofront@1.8.0` and `gofront@1.9.1` installed in scratch dirs and run on the same sources; this repo at tag `1.9.1` (`9d0899c`) read for root causes. Fixtures: `hello/<prog>/main.go` single-file programs; `mp/` three packages (`main`, `cfg` with a plain struct and `json.Marshal`, `world` with 10 structs and no JSON call); `mp2/` same with `cfg.Dump(v any)`; SimpleFPS `app/src` at `be6cbe7` + gofront-1.9 Phase 1 changes.

| # | Area | Finding | Evidence & Probe Reference |
|---|---|---|---|
| 1 | Minifier numeric literals (**blocker**) | `_scanNumber` knows `0x` and decimal only: `0b…`, `0o…`, `0B…`, `0O…` and `_` separators split into a number token plus an identifier token, and `compressTokens` puts a space between them, so the output is a syntax error. `0x…n` is fine | `src/cli/minifier.js:213-225`. `minify()` of the published 1.9.1: `const a=0b00000000;` → `const a=0 b00000000;`; `0o17` → `0 o17`; `0B101` → `0 B101`; `1_000` → `1 _000`; `0b1n` → `0 b1n`; `x=0b11\|0b01;` → `x=0 b11\|0 b01;`; `0xFFn` unchanged. Each new `Function(out)` throws |
| 2 | Release/build output | Every program that pulls `unicode/utf8` (via `fmt`, `strings`, `strconv`, `encoding/json`) has 12 broken literals; the app does not load | Hello programs `gofront build --release`: `fmt.Println`, `Sprintf`, `strconv.Itoa`, `strings.ToUpper`, `json.Unmarshal` ×2, `json.Marshal` → 12 `0 b` literals each, `node --check` exit 1 (`Unexpected identifier 'b00000000'`); `println`-only → 0. 1.8.0: 0 everywhere, exit 0. Repo examples via `node src/index.js build example/<e> -o …`: `simple`, `gom`, `templ`, `preact`, `hybrid` contain 12 `0 b` literals, `webgl` 0. SimpleFPS `npm run build` → `public/app.js` 1,117,931 B, `node --check` exit 1. The vendor bundle path (`vendorConfig: { minify: true }`, `src/cli/cli-core.js:331`) uses the same minifier |
| 3 | Test gap | No test parses minified output of a stdlib-importing program; `npm run build` builds the examples unminified; the e2e specs use the dev server | `test/unit/compiler/minifier.test.js`: 31 tests, no `0b`/`0o`/`_` literal. `grep -rn "node --check\|vm.Script\|new Function" test scripts` → only `new Function` on compiled (unminified) JS in `templ.test.js`, `test-runner.test.js`, `arrays.test.js`. `scripts/build-examples.js` runs `node src/index.js example/<name>/src -o example/<name>/app.js` (no `build`, no minify). `test/e2e/*.spec.js` run `gofront dev`. SimpleFPS Playwright smoke on 1.9.1 (dev server) passes 2/2 while its release bundle does not parse |
| 4 | JSON codecs in packages with no JSON call | A package without `json.*` call sites becomes `registerOnly` as soon as any package has one and unconditionally `flagDynamic()`s, so it generates encoders for every composite type it builds | `src/lower/json-codecs.js:1443-1451` (`registerOnly`, `flagDynamic`), `:1196` (`programTypes`), `:537-547` (`genEncAny`), `:1426-1435` (`jsonTargets`/`noteJsonUse` include `js`). Repro `mp/`: 1.8.0 65,422 B, 0 codec functions; 1.9.1 182,589 B, 51 `gfj_*` functions: `cfg` 5, `main` 8, `world` 38 (only `cfg` calls `json.Marshal`, on a struct without interface fields) |
| 5 | JS needs no registered encoders for correctness | The JS runtime falls back to `EncodeDynamic`, which handles values and struct tags without a registered encoder | `mp2/` (`cfg.Dump(v any)` marshals `world.New1()`, `[]any{…}`, `map[string]any{…}`; `T1` has `json:"a"`, `json:"b,omitempty"`, `json:"-"`), `gofront build --no-minify`, run with node, both import orders (`world`/`cfg` and `cfg`/`world`): identical output `{"a":1,"l":[1]}` and `[{"a":1,"l":[1]}]`, with 0 vs 38 `world` encoders. Not probed: `MarshalJSON`, `MarshalText`, `float32`, embedded structs, `map[int]T`, `time.Time` (Task 2.2 covers them) |
| 6 | Order dependence | Register-only generation depends on package order: `options.jsonBuild` is set by the first package with a call site and earlier packages return `null` | `json-codecs.js:1444-1445` (`return null` when `jsonBuild` is false), `src/compiler.js:449`. `mp2/`: import order `world, cfg` → `world` 0 encoders; `cfg, world` → 38. Harmless for JS (row 5); recorded because the fix must not add a new order dependence |
| 7 | SimpleFPS codec share | 152 `gfj_*` functions, 43.8 kB; 17.3 kB of them are in packages with no JSON call | Release bundle parsed with `rolldown/parseAst` after patching the literal bug: `scene` 63 fns 14,050 B, `engine` 17 fns 2,317 B, `main` 11 fns 942 B (no call sites); `assets` 31 fns 12,398 B, `systems` 11 fns 7,582 B, `game` 19 fns 6,548 B (real call sites: 5 `Unmarshal`, 1 `Marshal`) |
| 8 | Size baselines, tiny programs | Go-source stdlib costs far more than 1.8.0's inlined natives; `Marshal` is smaller | `build --release` bytes of `app.js`, 1.8.0 → 1.9.1: `println` 42 → 42; `fmt.Println` 24,333 → 175,999 (7.2×: runtime helpers 81,968, `strconv` 33,168, `fmt` 30,571, `utf8` 5,021); `fmt.Sprintf` 24,365 → 175,878; `strconv.Itoa`+`FormatFloat` 5,479 → 87,839; `strings.ToUpper`+`Split` 76 → 21,173; `json.Unmarshal` (struct) 55,797 → 264,723 (helpers 131,286, `fmt` 37,251, `strconv` 33,374, `jsonrt` 17,935); `Unmarshal` with an `any` field 55,665 → 280,044; `json.Marshal` 55,238 → 38,790 |
| 9 | SimpleFPS size attribution | +282 kB: stdlib +142 kB, JSON codecs +44 kB, user code +100 kB, helpers −7 kB | `build --release` 835,917 B (1.8.0) → 1,117,931 B (1.9.1); gzip 181,847 → 226,248. Top-level statements grouped by `$$pkg` suffix: `strconv` +44.4 kB, `fmt` +37.6, `internal` +19.9, `slices` +7.8, `unicode` +7.7, `math` +7.6, `encoding` +6.5, `strings` +6.2, `regexp` +3.7; user code 462,707 → 562,909 B (`Renderer` 27,871 → 36,558 B); helper statements 1,259 → 1,735 but 359,731 → 353,008 B. Pattern counts 1.8.0 → 1.9.1: `__ifn(` 0 → 82, `__ity(` 0 → 320, `__pm` 0 → 74, `__isty(` 0 → 46, `__tafail(` 0 → 66, `__unnil(` 0 → 82 |
| 10 | Consumer bound | The SimpleFPS acceptance bound (≤ 877,000 B, 1.05× of 1.8.0) cannot be met by this patch | Only ≈ 17 kB (row 7) is removable here; the rest is rows 8–9 (deferred). Expected SimpleFPS `app.js` after this plan ≈ 1.10 MB |

---

## Approach

### 1. Architecture & Design Decisions
- **Minifier (`src/cli/minifier.js`).** Teach `_scanNumber` the full numeric literal grammar the tokenizer can meet: `0[xX][0-9a-fA-F_]+`, `0[bB][01_]+`, `0[oO][0-7_]+`, decimal with `_` separators, fraction, exponent, optional BigInt `n`. Tokens stay single tokens, so `compressTokens` only separates them from identifiers where JS requires it. The constant folder (`_tryFoldAt`, uses `Number(tok.value)`) keeps working: `Number("0b11")` is 3, and a literal with `_` is `NaN`, which the folder already declines. Rejected: normalising literals to decimal in the backend (fixes only GoFront's own output, not vendor bundles passed through `--minify`).
- **Parse gate in tests and scripts, not in the compiler.** `scripts/build-examples.js` keeps its unminified build and adds a second pass per example: `node src/index.js build example/<name> -o <tmp>/<name>` (default minify, no `--release`, so no Binaryen), then copies each emitted `*.js` to a temporary `.mjs` and runs `node --check` on it (ESM-safe, no dependency), failing with the file and the `SyntaxError`. `gofront build` itself gets no parser (zero-dependency rule).
- **JSON register-only scoping (`generateJsonCodecs`).** A package without `json.*` call sites generates register-only encoders only if its target is `wasm`/`both` and `jsonBuild.wasm` is set. `js` packages return `null` (row 5: the JS runtime encodes their values dynamically). A `both` package keeps them (the generated Go source is shared by both halves). WASM output stays byte-identical. Rejected: a whole-program pre-pass that decides `dynamic` from the static types at every `Marshal` site: it would also trim `wasm`/`both` output but changes WASM codegen order and needs a WASM fixture matrix, so it is deferred (*Excluded: deferred*).
- **Size budgets (`test/perf/bundle-size.js`).** Builds the fixture set (the 8 hello programs from *Verified Gaps* plus the `mp/` repro) with `--release`, compares `app.js` byte counts with ceilings from `test/perf/bundle-size.baseline.json` (post-fix measurement × 1.05) and prints the table. Run from `npm test`. It records the 1.9 stdlib footprint instead of hiding it.

### 2. Invariants & Safety Bounds
- Minified output must be the same program: for every literal form, `eval(minify(src)) === eval(src)`, and stdlib-importing programs print the same output minified and unminified.
- WASM output is unchanged: only the JS-only `registerOnly` branch changes, and no existing `test/unit/wasm/*` expectation is edited.
- JS dynamic encoding output is unchanged for every probed shape (Task 2.2); the compiler stays zero-dependency; `npm run check` (including `scripts/check-layers.js` and sentrux) passes.

### 3. Edge Cases & Error Handling
- Numeric forms the scanner must keep splitting correctly: `1..toString()`, `1.5.toFixed(1)`, `.5`, `5.`, `1e3`, `1E-3`, `0xFFn`, `0b1n`, `0o7n`, `1_000n`, `0b11|0b01`, `a?.5:1`, and legacy `017`/`08` (JS accepts them in sloppy scripts; the minifier must not fuse or split them).
- **Differential divergence (Task 2.2).** If dynamic encoding of any probed shape differs once `js` packages stop registering encoders, stop and ask: the options are to keep registration for the diverging shape (types with `MarshalJSON`/`MarshalText`, `float32`) or to fix the runtime fallback; do not silently keep or drop either.
- **Budget noise.** Sizes come from the compiler alone (no timestamps; `sw.js` is not measured), so the ceiling is exact bytes plus 5%; a budget failure prints old/new bytes per fixture.
- **WASM register-only order dependence** (`mp2/` shows it for JS): left as is; the plan changes nothing for `wasm`/`both`.

---

## Implementation Tasks

### Phase 1: Valid minified output
- [x] Task 1.1: Scan every numeric literal form in the minifier
  - Files: `src/cli/minifier.js`
  - Test: `test/unit/compiler/minifier.test.js`: a table of ≥ 20 literals (*Edge Cases* list plus `0b00000000`, `0B101`, `0o17`, `0O7`, `0xFFn`, `1_000`, `1_0.0_1e1_0`) asserting `new Function("return " + minify(expr))()` equals the unminified value and that `minify(src)` never contains a number token followed by a space and a letter/`_`; plus folding cases (`0b11*2` folds to `6`, `1_000+1` is left unfolded)
  - Done when: the table passes and fails on `9d0899c` with `0 b…`; `0xFFn` and decimal output are byte-identical to 1.9.1
- [ ] Task 1.2: Minified stdlib-importing programs parse and behave like the unminified ones
  - Files: `test/unit/compiler/minifier-stdlib.test.js` (new), `test/unit/helpers.js` (a `checkSyntax(js)` helper that copies to a temp `.mjs` and runs `node --check`)
  - Test: compile programs importing `fmt`, `strings`, `strconv`, `unicode/utf8`, `encoding/json`, `sort`, `time`, `bytes` (js target), minify with and without `mangle`, assert `checkSyntax` passes and, for programs that print, stdout equals the unminified run
  - Done when: passes after Task 1.1 and fails on `9d0899c` with `Unexpected identifier 'b00000000'` (shown in the commit body)
- [ ] Task 1.3: Add a minified, parse-checked build pass to `npm run build`
  - Files: `scripts/build-examples.js`, `test/unit/cli/build-examples.test.js`
  - Test: a helper `checkBundle(dir)` exported from the script: a fixture directory with a deliberately invalid `app.js` makes it throw with the file path and the `SyntaxError` text; the six repository examples pass through the minified pass
  - Done when: `npm run build` builds all examples twice (plain, minified), exits non-zero for an invalid minified bundle, and fails on `9d0899c` for `simple`, `gom`, `templ`, `preact` and `hybrid`

### Phase 2: JSON code only where the target needs it
- [ ] Task 2.1: Skip register-only codecs for JS-only packages
  - Files: `src/lower/json-codecs.js`
  - Test: `test/unit/compiler/json-codec-scope.test.js` (new): the `mp/` fixture (`main`, `cfg` with a plain struct and `json.Marshal`, `world` with 10 structs and no JSON call) compiles to ≤ 5 `gfj_*` functions, all in `cfg`, and none named `gfj_world_*`/`gfj_main_*`; a `both` package without call sites still registers its encoders when another package calls `json.Marshal`
  - Done when: the repro goes 51 → ≤ 5 functions and `node test/unit/run.js` passes with no edited WASM expectation
- [ ] Task 2.2: Dynamic encoding of values from JSON-free packages stays identical
  - Files: `test/unit/compiler/json-codec-scope.test.js`, `src/lower/json-codecs.js` (only if a gap appears; see *Edge Cases*)
  - Test: differential cases through `json.Marshal(v any)`, `[]any`, `map[string]any` and a struct `any` field, with the type declared in a package that has no JSON call: tags (`json:"a"`, `omitempty`, `-`, `,string`), `MarshalJSON`, `MarshalText`, `float32` fields, embedded struct, `map[int]T`, nested pointers, `time.Time`; expected strings fixed from Go semantics and equal to the 1.9.1 output
  - Done when: every case equals the expected string in both import orders of the packages
- [ ] Task 2.3: Add size budgets and user docs
  - Files: `test/perf/bundle-size.js` (new), `test/perf/bundle-size.baseline.json` (new), `docs/usage.md` (plus the `CHANGELOG.md` entry and the `npm test` wiring in `package.json`)
  - Test: the script measures the nine fixtures with `--release`, fails with old/new bytes when one exceeds its ceiling, and `--self-test` proves it fails for a ceiling set 1 byte below the measured size
  - Done when: `npm test` runs it and passes; `docs/usage.md` has a *Bundle size* section listing the budget table and how to update it
