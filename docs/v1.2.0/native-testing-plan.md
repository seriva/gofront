# Native Unit Testing (`gofront test`) — Design Plan

**Version:** v1.2.0  
**Status:** Completed (2026-09-23)  

---

## Goal

Provide a native, Go-idiomatic unit testing experience for GoFront applications and libraries. Developers will be able to write `*_test.go` files, import the standard `testing` package, implement `func TestXxx(t *testing.T)`, and run `gofront test [dir]` with familiar Go-style test execution and terminal output.

Currently, GoFront does not distinguish between test files and production files during compilation, lacks a `testing` standard library shim, and offers no CLI command to discover or execute unit tests. This feature completes the developer workflow, allowing GoFront code to be tested natively without requiring external JavaScript wrappers or separate test harnesses, while preserving GoFront's zero-runtime-dependencies guarantee.

---

## Out of Scope

- **Benchmark and Fuzz Testing:** `BenchmarkXxx(b *testing.B)` and `FuzzXxx(f *testing.F)` are deferred to a future performance-focused release.
- **Cross-package Coverage Reports (`-coverpkg` / HTML):** GoFront will not embed an internal HTML coverage report engine. Standard Node/V8 coverage (such as `c8`) or lightweight statement counters can be added in a later iteration.
- **Full In-Browser Multi-Device E2E:** `gofront test` runs in Node.js (with optional JSDOM environment for DOM/component tests). Multi-browser end-to-end testing remains handled by Playwright.
- **External Test Framework Dependencies:** The `testing` package and test runner must remain 100% self-contained without adding runtime npm dependencies to `package.json`.

---

## Approach

### 1. Test File Separation & Discovery (`src/compiler.js`)

In Go, files ending in `_test.go` are excluded from regular package builds and are only compiled during test execution.

- Update `gwFilesIn(dir, options)` in `src/compiler.js`:
  - Add `{ includeTests = false }` option.
  - Normal compilation (`compileDir`, `compileSingleFile`, `gofront .`, `gofront build`): exclude `*_test.go` files so test code is never bundled into production builds.
  - Test compilation (`compilePackageTests`, `gofront test`): include both production `.go` / `.templ` files and `*_test.go` files.
- Package naming rules:
  - Support same-package test files (`package foo`) having full access to unexported functions, structs, and methods.
  - Support external test packages (`package foo_test`) accessing only exported identifiers through `import "."` or package import.

### 2. Standard Library `testing` Package (`src/typechecker/` & `src/codegen/`)

Register the `testing` package as a standard library built-in, similar to `fmt`, `strings`, and `bytes`.

#### TypeChecker (`src/typechecker/stdlib/testing.js` or `core.js`)
- Type definitions:
  - `testing.T`: struct pointer type with methods:
    - `t.Error(args ...any)`: marks test as failed and logs message.
    - `t.Errorf(format string, args ...any)`: formatted failure log.
    - `t.Fatal(args ...any)`: marks test as failed, logs message, and stops execution of the current test immediately.
    - `t.Fatalf(format string, args ...any)`: formatted fatal failure.
    - `t.Fail()`: marks test as failed without stopping execution.
    - `t.Failed() bool`: returns whether the test has failed.
    - `t.FailNow()`: stops execution of the current test immediately.
    - `t.Log(args ...any)`: logs informational message (displayed on failure or in `-v` verbose mode).
    - `t.Logf(format string, args ...any)`: formatted informational log.
    - `t.Skip(args ...any)`: logs message and marks test as skipped.
    - `t.Skipf(format string, args ...any)`: formatted skip log.
    - `t.Skipped() bool`: returns whether test was skipped.
    - `t.Helper()`: marks calling function as a test helper (adjusts file/line reporting).
    - `t.Run(name string, f func(t *testing.T))`: runs a hierarchical subtest.
    - `t.Name() string`: returns test name.

#### CodeGen (`src/codegen/stdlib/testing.js`)
- Emits an inline JavaScript class `__GoFront_T` supporting:
  - Failure tracking (`this.failed = false`).
  - Sentinel exception for immediate aborts: `class __GoFront_FailNow extends Error {}`.
  - Log buffering: buffers `Log` and `Error` messages so they can be printed cleanly according to test pass/fail status and verbosity settings.
  - Subtest management: `t.Run(name, fn)` creates a child `__GoFront_T` instance, executes it (sync or async), and propagates failure status to parent if failed.

### 3. Test Runner & Harness Generator (`src/test-runner.js`)

Add a dedicated test runner engine:

- **AST Inspection:**
  - After parsing the test files, scan top-level declarations for functions matching:
    ```go
    func Test<Name>(t *testing.T)
    ```
- **Harness Generation:**
  - Generate an executable JavaScript runner module that:
    1. Optionally initializes JSDOM (if `--dom` flag is active or DOM globals are referenced).
    2. Imports/inlines the compiled package bundle.
    3. Iterates over discovered test functions:
       - Prints `=== RUN   TestName` (in verbose mode or before run).
       - Executes `await fn(t)`.
       - Catches `__GoFront_FailNow` (handled as test failure, stops test, proceeds to next test).
       - Catches unhandled panics/exceptions (marks test failed, logs stack trace).
       - Computes elapsed time in seconds (`0.00s`).
       - Prints `--- PASS: TestName (0.00s)` or `--- FAIL: TestName (0.00s)` along with buffered diagnostic logs.
       - Prints `--- SKIP: TestName (0.00s)` if skipped.
    4. Outputs overall package summary: `PASS` or `FAIL` with total elapsed time.
    5. Returns process exit code: `0` if all tests passed, `1` if any test failed.

### 4. CLI Subcommand (`src/cli-core.js` & `src/index.js`)

In accordance with GoFront architecture rules (`src/index.js` = argument routing only, `src/cli-core.js` = business logic):

- **Command Syntax:**
  ```bash
  gofront test                     # run tests in current directory
  gofront test <dir>               # run tests in specified directory
  gofront test -v                  # verbose output (always print t.Log and subtests)
  gofront test -run <regex>        # run only tests matching regex pattern
  gofront test --dom               # initialize JSDOM environment for DOM/gom/templ tests
  ```
- **Execution Workflow (`src/cli-core.js`):**
  - `handleTest(targetDir, options)`:
    1. Collects package files and `*_test.go` files using `gwFilesIn(targetDir, { includeTests: true })`.
    2. If no `*_test.go` files found, prints `?   <package>  [no test files]` and exits with code 0.
    3. Compiles package and test ASTs using `compilePackageTests`.
    4. Executes the test harness via Node subprocess or temporary module execution.
    5. Returns test summary `{ passed, failed, skipped, duration }` and exit code.

---

## Tasks

### Task 1: Test File Filtering in Compiler
- Update `gwFilesIn` in `src/compiler.js` to exclude `*_test.go` by default.
- Verify regular builds ignore `*_test.go`.
- Add unit test verifying `*_test.go` is excluded from standard package compilation.

### Task 2: `testing` Package in TypeChecker & CodeGen
- Add `testing.T` type definition and methods to `src/typechecker/stdlib/core.js` (or `src/typechecker/stdlib/testing.js`).
- Implement `src/codegen/stdlib/testing.js` with `__GoFront_T` runtime class, `FailNow` sentinel, and log formatting.
- Wire into `src/codegen/stdlib/index.js`.
- Add unit tests verifying `import "testing"` and `t.*` method type checking and JS emission.

### Task 3: Test Discovery & Harness Generator
- Create `src/test-runner.js`:
  - Identify `Test*` functions from AST.
  - Generate the runner entrypoint with Go-compatible test formatting (`=== RUN`, `--- PASS`, `--- FAIL`).
  - Support test filtering by name regex (`-run`).
  - Support async tests (`await`).
  - Support `--dom` environment via JSDOM.

### Task 4: CLI Integration (`src/cli-core.js` & `src/index.js`)
- Add `handleTest(targetDir, options)` in `src/cli-core.js`.
- Add `gofront test` command handler in `src/index.js`.
- Add `--help` documentation for `gofront test`.

### Task 5: Testing & Verification
- Add compiler unit tests in `test/unit/compiler/test-runner.test.js`.
- Create fixture packages with passing tests, failing tests, fatal aborts, and subtests.
- Verify Sentrux architecture gate passes (`npm run check`).

---

## Edge Cases

1. **Packages Without Tests:** If a directory has `.go` files but no `*_test.go`, report `?   <pkg>  [no test files]` and exit 0 without error.
2. **Empty Test Files:** If a `*_test.go` file exists but contains no `Test*` functions, compile without error and report 0 tests run.
3. **`t.Fatal()` / `t.Fatalf()` Abort Isolation:** A fatal error must immediately stop the currently executing test, but must not crash the test runner or skip subsequent tests.
4. **Unhandled Panics / JS Errors:** If test code panics (`panic("boom")`) or triggers a runtime error (e.g. `nil` dereference), the runner must catch the error, format it as `--- FAIL: TestName (panic: boom)`, and proceed to next tests.
5. **Subtests with `t.Run()`:**
   - Names should be reported as `TestParent/ChildName`.
   - Child failure must mark parent `t.Failed()` as true.
   - Failures in subtests must be indented and attributed accurately.
6. **Async Tests:** GoFront functions that perform async operations (e.g. `fetch`, promises) must be properly awaited so test completion is not reported prematurely.
7. **DOM Testing:** Frontend components (`gom`, `.templ`) manipulating `document` or `window` must run cleanly when `--dom` is provided, setting up a simulated DOM before test execution.

---

## Test Plan

### Unit Tests
- `test/unit/compiler/test-runner.test.js`:
  - File filtering: ensures `*_test.go` is ignored during regular `compileDir` and included during `compilePackageTests`.
  - Type checking: validates correct signatures for `func TestFoo(t *testing.T)` and catches invalid signatures.
  - Harness generation: verifies emitted harness includes all discovered `Test*` functions and skips non-test functions.
  - Execution semantics:
    - Passing test returns exit code 0.
    - Failing test (`t.Error` / `t.Errorf`) returns exit code 1.
    - Fatal test (`t.Fatal` / `t.Fatalf`) halts test immediately and returns exit code 1.
    - Subtests (`t.Run`) execute in sequence and bubble failure up.
    - Filtering (`-run`) executes only matched test names.
    - DOM test: verifies `document.createElement` works when `--dom` is enabled.

### Regression & Quality Gate
- Run `npm run test:unit` to ensure all 1,184 existing tests pass.
- Run `npm run check` to verify Biome formatting, Sentrux quality gate, and example type checking.
