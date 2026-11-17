# `gofront check` Reports Every Package — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Split out of the former `web-platform-evolution-plan.md` (its Phase 5) on 2026-11-17, re-probed and reviewed that day. Independent of every other v2.0.0 plan; can ship first. Shared code: Task 1.3 tags dependency failures in the local-package loop of `resolveImports` (`src/compiler.js`), which [`incremental-builds-plan.md`](incremental-builds-plan.md) Task 1.1 also rewrites (cycle detection, package graph): whichever lands second rebases.  
**Release note:** `gofront check` now reports the errors of every package and its test files in one run instead of stopping at the first failing package.  

---

## Goal

`gofront check <pattern>` type-checks every matched package and its `_test.go` files, reports all errors in one run with a per-package summary, lists dependents of a failed package as skipped, and exits non-zero when anything failed, as `gofront test <pattern>` already does for builds. Single-package `check` (and the legacy `gofront <dir> --check`) type-checks the same file set as `gofront test`.

**Done means:**
- `gofront check <root>/...` over packages `a`, `b` (each with one error in `x.go` and one in `x_test.go`) prints all four errors in one run, a per-package summary, and exits non-zero (`test/unit/cli/check-all-packages.test.js`).
- `gofront check <dir>`, `gofront <dir> --check` and `gofront check <root>/...` fail on a package whose only error is in `x_test.go`, and a test-only directory is checked instead of aborting the run (same test file).
- A package whose dependency failed is listed as `skipped (<dep> failed)` whatever the directory order, and each failing package's errors are printed exactly once, including a failing dependency outside the pattern root (same test file).
- `npm test` and `npm run check` (`gofront check example/...`, now including its 11 packages' `_test.go` files) pass; `docs/usage.md` describes the output.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | `check-stops-early`: pattern-mode `handleCheck` collects per-package results instead of letting the first error escape | `handleCheck`, `reportCheck`, exit code in `src/index.js` | |
| **In scope: core** | `check-file-set`: every `check` entry point type-checks a directory through `compilePackageTests` (the file set `gofront test` uses) | `handleCheck` single + pattern mode, `runSingleShot` `checkOnly` on a directory, test-only directories | |
| **In scope: core** | `dep-failure-attribution`: a dependency's `CompileError` is tagged with the failing package's directory where the compiler compiles it | `resolveImports` local-package loop, skipped dependents | |
| **Excluded: deferred** | Import cycles crashing `check` | `Maximum call stack size exceeded` (each cycle package now reports it as its own failure instead of aborting the run) | [`incremental-builds-plan.md`](incremental-builds-plan.md) Task 1.1 (the package graph and cycle path) |
| **Excluded: deferred** | External test packages (`package x_test`) | `Mixed package names in <dir>: ext, ext_test` | Unsupported by `gofront test` too; `check` now reports what `test` reports. Needs its own design (separate package compile) |
| **Excluded: deferred** | Single-file `check` (`gofront check main.go`, project `srcDir` resolving to `main.go`) | stays `runCompile(file, false)` | A file has no package test set; Go's `go vet file.go` also ignores tests |

---

## Verified Gaps & Baseline Audit

Probes 2026-11-17 (review), `.probes/` (deleted). Fixture: `a/a.go` `var x int = "s"`, `a/a_test.go` `var y string = 1`, same for `b`; `c` imports `../a` and is clean; `ok/ok.go` clean with only `ok_test.go` failing.

### Root `check-stops-early`
| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Pattern mode | `handleCheck` (`src/cli/cli-core.js:572`) loops `runCompile(dir, true, …)` with no `try`; the first `CompileError` escapes to `src/index.js:108` | `gofront check ./...` → only `a.go`'s error, exit 1; `b`, `ok` never checked |
| Control | `gofront test ./...` reports each failing package (`FAIL a [build failed]`, `FAIL b …`) via `runTestsRecursive` + `reportBuildFailure` (`src/cli/test-runner.js:346`) | Same fixture: `a`, `b`, `ok` each reported with all their errors |
| Existing tests pin the throw | `test/unit/cli/test-runner.test.js:470` asserts `handleCheck("<dir>/...")` throws on a failing package | Must change to assert the collected result; `cli-core.test.js:884` (single mode throws) and `:688` (invalid target config throws before the loop) stay |

### Root `check-file-set`
| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Single-package `check` | `runCompile(dir, true)` → `compileDir` (`src/compiler.js:498`) → `gwFilesIn(dir, { includeTests: false })` | `gofront check ./b` → `b.go`'s error only; `gofront check ./ok` → `OK`, exit 0 |
| Legacy `--check` (sibling) | `runSingleShot` (`src/cli/cli-core.js:1016`) `checkOnly` uses the same `runCompile` | `gofront .probes/cap/ok --check` → `OK`, exit 0 |
| Test-only directory (sibling) | `findPackageDirs` lists dirs with any `.go` file, but `compileDir` drops `_test.go` and throws | `check <root>/...` with `testonly/t_test.go` only → `No .go files found in …/testonly`, whole run aborts |
| Shared helper exists | `compilePackageTests` (`src/compiler.js:504`) = `gwFilesIn(includeTests: true)` + `isTest: true`; `isTest` only affects code generation (`src/backend/js/index.js:343`, `src/link/wasm.js:39`), not checking; without `testDriver` no driver is generated (`src/compiler.js:720`) | `compilePackageTests(d, {})` over all 11 `example/...` package dirs → 0 failures |

### Root `dep-failure-attribution`
| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Dependency errors carry no package | Local imports compile through nested `compileDir(depDir, { isDependency: true })` (`src/compiler.js:376`); the thrown `CompileError.errors[]` have only `{ line, col }` and a message naming a basename (`Type error in a.go …`) | `compileDir(".probes/cap/c")` → `CompileError [{ keys: [line, col], msg: "Type error in a.go …" }]` |
| Dependent printed as its dependency's error | `gofront check ./c` prints `a.go`'s error under `c`; in pattern mode `a`'s errors would print twice once collection lands | Probe above |
| Order | `findPackageDirs` sorts alphabetically, so a dependent can be checked before its dependency | `aa` imports `../zz` (failing): `check ./...` reports `z.go`'s error while checking `aa` |
| Dependency outside the pattern root | `../shared` imported from `app/src/...` is never a pattern package, so its errors only ever surface through a dependent | Follows from `findPackageDirs(root)` + `resolveGwDir`; covered by a Task 1.3 test |

---

## Approach

### 1. Architecture & Design Decisions
- **Collect, do not throw (pattern mode):** `handleCheck` wraps each package's compile in `try/catch` and records `{ dir, status: "ok" | "fail" | "skipped", errors?, dep?, elapsedMs }`. Any error thrown by the per-package compile is collected (as `reportBuildFailure` does for `test`); config errors (`projectTargetOptions`, no package dirs) are raised before the loop and still throw. `handleCheck` returns `{ …, packages, failed }`.
- **Output and exit:** `reportCheck` prints `FAIL <rel dir>` plus each failing package's diagnostics (through `formatDiagnostic` from `src/cli/colors.js`, as `test-runner.js` does), the `ok` lines as today, `skipped (<dep> failed)` lines, then `N packages — X ok, Y failed, Z skipped`, and returns the exit code. `src/index.js` only does `process.exit(reportCheck(…))`; no logic moves into it.
- **Single-package mode keeps throwing:** `gofront check <dir>` still throws its `CompileError` (one package, nothing to collect); only its file set changes.
- **One file-set decision:** every `check` on a directory (pattern, single-package, legacy `--check`) calls `compilePackageTests(dir, opts)` (already shared with `runTests`). No new helper in `test-runner.js`. Single-file targets keep `runCompile(file, false)`.
- **Attribution where the decision is made:** in `resolveImports`, the `compileDir(depDir, { isDependency: true })` call catches a `CompileError` and sets `e.packageDir = depKey` if not already set (innermost failing package wins), then rethrows. `handleCheck` treats `e.packageDir && e.packageDir !== resolve(dir)` as "skipped, `dep` = `e.packageDir`". Rejected: re-parsing imports in `cli-core.js` (duplicates resolver logic; drifts from what the compiler actually compiles).
- **Print each package's errors once:** a dependency that is itself a pattern package prints only its own result (which includes its `_test.go` errors, unlike the dependency compile); a dependency outside the pattern prints the tagged errors once under its relative path, the first time a dependent hits it. Order-independent: `aa` checked before failing `zz` is still `skipped (zz failed)`.

### 2. Invariants & Safety Bounds
- A passing `check` prints the same `OK` lines and exits 0 as today; only the totals line gains counts.
- Tagging changes no message, no error order and nothing for a successful compile; `CompileError.message` is untouched (`gofront build`/`dev` output unchanged).
- Layering: `cli/` → `compiler.js` only (`npm run check:layers`).

### 3. Edge Cases & Error Handling
- One package's error never hides another's; a skipped dependent is never reported as a second error.
- Diamonds (`c` and `d` both import failing `a`): `a`'s errors once, both dependents skipped.
- Transitive (`c` → `b` → `a`, `a` fails): innermost tag wins → `b` and `c` both `skipped (a failed)`.
- A dependent with its own errors behind a failed dependency is `skipped` (its body is not checked, as `go build` does).
- Non-`CompileError` failures (`InternalCompilerError`, the excluded cycle `RangeError`) are untagged and collected as that package's `FAIL`.
- `package x_test` files now fail `check` with `Mixed package names` (excluded; matches `test`).

---

## Implementation Tasks

> Split from the former `web-platform-evolution-plan.md` Phase 5 (re-probed 2026-11-17). Estimated ~120–180 production LOC across `src/cli/cli-core.js`, `src/compiler.js`, `src/index.js`.

### Phase 1: Report every package and test file
- [x] Task 1.1: Collect per-package results in `gofront check <pattern>` (former 5.1)
  - Files: `src/cli/cli-core.js` (`handleCheck`, `reportCheck`), `src/index.js` (exit code from `reportCheck`)
  - Test: `test/unit/cli/check-all-packages.test.js`: `a`, `b` failing in `x.go` → `handleCheck("<root>/...")` returns both with `status: "fail"` and their errors, `failed: true`; `reportCheck` output has `FAIL a`, `FAIL b`, the totals line, and returns 1; all-ok returns 0. Update `test/unit/cli/test-runner.test.js:470` from `assertThrows` to the collected result.
  - Done when: `gofront check ./pkg/...` no longer stops at the first failing package and exits 1 when any failed
- [x] Task 1.2: Type-check `_test.go` files through `compilePackageTests` (former 5.2)
  - Files: `src/cli/cli-core.js` (`handleCheck` both modes, `runSingleShot` `checkOnly` on a directory)
  - Test: `check-all-packages.test.js`: a package whose only error is in `x_test.go` fails `handleCheck(dir)`, `handleCheck("<root>/...")` and `runSingleShot(dir, true, { checkOnly: true })` (returns 1); a test-only directory is checked (fails on its error, passes when clean) instead of `No .go files found`; no test function runs (a `TestX` that would `panic` leaves no output)
  - Done when: every `check` entry point on a directory compiles the same file set as `gofront test`, and `npm run check` passes
- [x] Task 1.3: Skip dependents of a failed package (former 5.3)
  - Files: `src/compiler.js` (`resolveImports` local-package loop: tag `CompileError.packageDir`), `src/cli/cli-core.js` (`handleCheck`, `reportCheck`), `docs/usage.md` (check output, summary, skipped lines)
  - Test: `check-all-packages.test.js`: `c` imports failing `a` → `a`'s errors printed once, `c` `skipped (a failed)`; same with dependent sorting first (`aa` → `zz`); diamond (`c`, `d` → `a`); transitive (`c` → `b` → `a`); dependency outside the pattern root printed once under its relative path. A `test/unit/compiler/` case asserts `compileDir(c)` throws a `CompileError` with `packageDir` = `a`'s dir and unchanged `message`.
  - Done when: no error is reported twice and every skipped line names the innermost failed package
