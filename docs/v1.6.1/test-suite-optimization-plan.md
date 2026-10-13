# Test Suite Optimization — Design Plan

**Version:** v1.6.1  
**Status:** In Progress (2026-10-13)  
**Depends on:** [`docs/v1.6.1/wasm-gaps-plan.md`](wasm-gaps-plan.md)  
**Followed by:** [`docs/v2.0.0/native-go-engine.md`](../v2.0.0/native-go-engine.md)

---

## Goal

Optimize, condense, and reorganize the GoFront test suite to eliminate redundant test execution, repetitive filesystem boilerplate, and fragmented stdlib coverage without losing test cases or dropping code coverage below current baselines (93.98% lines / 82.84% branches). Reduce total unit test execution time from ~25s down to <5s and condense ~4,000–6,000 lines of boilerplate across `test/unit/`.

Done means:
- `compiler/cli.test.js` retains only 3–4 essential process-level smoke tests, removing 40 redundant `spawnSync` subprocess invocations and saving ~10.4s.
- Repetitive filesystem setup and teardown is replaced by a standardized `withTempDir` helper across all ~145 test call-sites.
- Pure declarative error and check tests (`types/errors.test.js`, `minifier.test.js`, `types/checks.test.js`) are refactored into compact table-driven arrays.
- Standard library tests for pure packages are unified via `compileHybrid` to test both JS and WASM backends simultaneously, preventing parity drift and removing duplicate JS-only/WASM-only test code.
- Stray test cases (e.g. `strings`/`strconv`/`fmt` in `wasm/maps.test.js` or `fmt` in `builtins/operators.test.js`) and unorganized root files are relocated into a clean taxonomy.
- Unit tests can run in parallel across multiple CPU cores, achieving <5s total test run time.
- All 1,837+ assertions pass, and `npm run test:coverage` verifies no coverage loss.

---

## Out of Scope

- **Deleting valid test assertions or reducing test coverage.** Every syntax form, type diagnostic, lowering step, and backend opcode assertion must remain verified.
- **Adding heavy external test dependencies.** The project maintains zero runtime dependencies and minimal dev dependencies; no migration to Vitest, Jest, or Mocha.
- **Altering compiler code generation or language semantics.** This optimization touches test files and test harness helpers only.
- **Modifying Playwright E2E browser tests or simplefps performance benchmarks.**

---

## Approach

### 1. CLI Test Deduplication (`cli.test.js` vs `cli-core.test.js`)
- `test/unit/compiler/cli.test.js` currently spawns 43 separate Node.js child processes (`spawnSync(process.execPath, [CLI, ...args])`) to test CLI flag parsing (`--version`, `--help`, `-o`, `--minify`, `--tokens`, `--ast`, `init`, etc.). This single file takes **11.2s** to run.
- `test/unit/compiler/cli-core.test.js` already tests the identical functionality directly in-process via `cli-core.js` in **~0.8s**.
- **Action:** Retain 3–4 smoke tests in `cli.test.js` to ensure the CLI shebang, command execution, and exit codes work in an actual process. Move any unique assertions into `cli-core.test.js` and remove the other 40 subprocess spawns.

### 2. Standardized Filesystem Helper (`withTempDir`)
- 145 test blocks manually execute:
  ```js
  const dir = mkdtempSync(join(tmpdir(), "gofront-..."));
  try {
    writeFileSync(join(dir, "main.go"), ...);
    // test body
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  ```
  Found across `test-runner.test.js` (25 times), `packages.test.js` (10 times), `asset-manager.test.js` (9 times), etc.
- **Action:** Provide a robust helper in `test/unit/helpers.js`:
  ```js
  export function withTempDir(files, fn) {
    const dir = mkdtempSync(join(tmpdir(), "gofront-test-"));
    try {
      for (const [relPath, content] of Object.entries(files)) {
        const fullPath = join(dir, relPath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content);
      }
      return fn(dir);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
  ```
- Simplifies multi-file fixtures into clean declarative object maps and guarantees cleanup on failure.

### 3. Table-Driven Test Structure for Declarative Suites
- Several test files repeat 5–8 lines of boilerplate per assertion:
  - `types/errors.test.js` (64 tests, 735 lines)
  - `minifier.test.js` (50 tests, 460 lines)
  - `types/checks.test.js` (78 tests, 1,027 lines)
- **Action:** Convert repetitive positive/negative test suites to standard Go-style table-driven tests (`const cases = [[name, code, expected], ...]; for (const [name, code, exp] of cases) test(name, () => ...);`).
- Preserves individual test reporting in `helpers.js` while reducing thousands of lines of boilerplate.

### 4. Stdlib Consolidation & Parity Unification
- Pure standard library packages (`fmt`, `strings`, `strconv`, `math`, `math/bits`, `slices`, `bytes`, `io`, `path`, `html`, `unicode`, `time`) have separate, disjoint test implementations:
  - `builtins/stdlib.test.js` (2,428 lines, 204 tests) tests JS only.
  - `wasm/stdlib.test.js` (1,468 lines, 45 tests) tests WASM and parity.
  - `wasm/gaps_postaudit.test.js` (507 lines) tests recent additions.
  - `wasm/maps.test.js` lines 555–640 contains stray stdlib tests.
- **Action:**
  - Standardize pure stdlib testing on `compileHybrid(src).run("Main")`. One test case executes both JS and WASM, verifies identical stdout and return values, and prevents drift.
  - Relocate stray tests from `wasm/maps.test.js` and `builtins/operators.test.js` into their respective stdlib modules.
  - Merge `wasm/gaps_postaudit.test.js` into the main stdlib suite.

### 5. Test Suite Taxonomy & Organization
- Move orphan test files currently in `test/unit/` root to proper subdirectories:
  - `dom.test.js` → `builtins/dom.test.js` (or `dom/dom.test.js`)
  - `structs.test.js` → `language/structs.test.js`
  - `templ.test.js` → `compiler/templ.test.js`
  - `lexer-parser.test.js` → `frontend/lexer-parser.test.js` (or `compiler/`)
  - `lower.test.js` → `compiler/lower.test.js`
  - `minifier.test.js` → `compiler/minifier.test.js`
- Clean up outdated historical section headers (`"New features"`, `"New type checks"`).

### 6. Parallel Test Execution
- `test/unit/run.js` currently imports 60 test files sequentially in a single process.
- **Action:** Support parallel execution across CPU cores (via worker threads or Node 20+ native runner `node --test`).
- With 60 independent test files running concurrently across available cores, execution time drops by 4x–5x.

---

## Edge Cases

- **Process Exit Trapping:** In-process CLI testing (`cli-core.js`) must intercept and mock `process.exit` and `process.stderr.write` so failed CLI commands do not terminate the test runner process.
- **Async Temp Dir Cleanup:** `withTempDir` must support both synchronous and async/promise-returning callbacks, ensuring cleanup runs only after promises settle.
- **Dual Target Parity Exceptions:** Browser-facing stdlib features (`dom`, `.templ`, `gom`, `async`/`await`) only target JS and must remain tested via `runJs` / `runInDom` rather than `compileHybrid`.
- **Node Version Compatibility for WASM:** `compileHybrid` tests rely on WasmGC (Node 22+). For environments running Node 20, WASM execution tests must cleanly skip or degrade with clear warnings while running JS checks.

---

## Implementation Tasks

- [ ] **Phase 1: CLI Deduplication.** Condense `compiler/cli.test.js` to 3–4 process smoke tests and route detailed flag assertions through `compiler/cli-core.test.js`. Verify ~10s speedup.
- [ ] **Phase 2: Filesystem Helper.** Implement `withTempDir` in `test/unit/helpers.js` (sync & async support). Refactor `compiler/test-runner.test.js`, `compiler/packages.test.js`, and `compiler/asset-manager.test.js`.
- [ ] **Phase 3: Table-Driven Refactoring.** Convert `types/errors.test.js`, `minifier.test.js`, and `types/checks.test.js` to table-driven test definitions.
- [ ] **Phase 4: Stdlib Unification.**
  - [ ] Relocate misplaced tests in `wasm/maps.test.js#L555-L640` and `builtins/operators.test.js`.
  - [ ] Merge `wasm/gaps_postaudit.test.js` into standard stdlib suites.
  - [ ] Migrate pure stdlib tests from `builtins/stdlib.test.js` to use `compileHybrid` for unified JS + WASM coverage.
- [ ] **Phase 5: Reorganize Directory Hierarchy.** Move root test files (`dom.test.js`, `structs.test.js`, `templ.test.js`, `minifier.test.js`, `lower.test.js`, `lexer-parser.test.js`) into logical subdirectories and update `test/unit/run.js` imports.
- [ ] **Phase 6: Parallel Execution.** Add parallel worker execution to `test/unit/run.js` or provide a `node --test` runner target.
- [ ] **Phase 7: Verification & Gates.** Run full suite, verify total time <5s, confirm 100% pass rate, and verify coverage >= 93.9% with `npm run test:coverage`.

---

## Test Plan

- **Parity & Regression Gate:**
  - Run `node test/unit/run.js` to confirm all 1,837+ tests continue to pass.
  - Run `c8 --include='src/**' --reporter=text node test/unit/run.js` to confirm line coverage stays >= 93.98% and branch coverage >= 82.84%.
- **Speed Gate:**
  - Measure unit test suite runtime before and after: execution must drop from ~25s to <5s.
- **Filesystem Leak Gate:**
  - Verify zero orphaned `gofront-*` directories remaining in `/tmp` after running the suite.
- **E2E & Check Gate:**
  - Run `npm run check` (Biome + Sentrux + typecheck) and `npm run test:e2e` to verify no regressions.
