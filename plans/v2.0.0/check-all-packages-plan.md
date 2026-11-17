# `gofront check` Reports Every Package — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Split out of the former `web-platform-evolution-plan.md` (its Phase 5) on 2026-11-17, re-probed that day. Independent of every other v2.0.0 plan (only `src/cli/cli-core.js` `handleCheck`); can ship first.  
**Release note:** `gofront check` now reports the errors of every package and its test files in one run instead of stopping at the first failing package.  

---

## Goal

`gofront check <pattern>` type-checks every matched package and its `_test.go` files, reports all errors in one run with a per-package summary, lists dependents of a failed package as skipped, and exits non-zero when anything failed, as `gofront test <pattern>` already does for builds.

**Done means:**
- `gofront check app/src/...` reports every failing package and `_test.go` file in one run and exits non-zero (`test/unit/cli/check-all-packages.test.js`).
- A package whose dependency failed is listed as `skipped (<pkg> failed)`, and no error is printed twice.
- `npm test` and `npm run check` (`gofront check example/...`) pass; `docs/` describes the output.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | `gofront check` in single-package and pattern mode | `handleCheck`, `_test.go` files, summary, exit code | |
| **Excluded: deferred** | Import cycles crashing `check` | `Maximum call stack size exceeded` | [`incremental-builds-plan.md`](incremental-builds-plan.md) Task 1.1 (the package graph) |

---

## Verified Gaps & Baseline Audit

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| `check` stops early | `handleCheck` (`src/cli/cli-core.js:572`) loops over package dirs and `runCompile` throws on the first failing package; `_test.go` files are filtered out of non-test builds | Re-probe 2026-11-17 (`.probes/web/`, deleted): packages `a` and `b`, each with one type error in `x.go` and one in `x_test.go`: `gofront check ./...` prints only `a.go`'s error; `gofront check ./b` prints `b.go`'s but not `b_test.go`'s. `gofront test <pattern>` reports every failing package with all errors (2026-11-13) |

---

## Approach

### 1. Architecture & Design Decisions
- **Collect, do not throw:** in pattern mode `handleCheck` compiles every package and records `{ dir, errors }`; a per-package summary (`ok` / `FAIL` / `skipped`) follows the errors; the exit code is non-zero when any package failed.
- **Test files:** `check` type-checks the same file set as `gofront test` (including `_test.go`) through a shared helper, without running anything, in single-package and pattern mode.
- **Skipped dependents:** a package that imports a failed package is `skipped (<pkg> failed)`; the dependency's errors are printed once.
- **Layering:** logic and formatting stay in `cli-core.js`; `src/index.js` only prints what they return.

### 2. Invariants & Safety Bounds
- A passing `check` prints and exits as today.

### 3. Edge Cases & Error Handling
- One package's error never hides another's; a skipped dependent is never reported as a second error.

---

## Implementation Tasks

> Split from the former `web-platform-evolution-plan.md` Phase 5 (re-probed 2026-11-17).

### Phase 1: Report every package and test file
- [ ] Task 1.1: Collect errors per package in `gofront check <pattern>` (former 5.1)
  - Files: `src/cli/cli-core.js` (`handleCheck`)
  - Test: `test/unit/cli/check-all-packages.test.js` with two failing packages: both packages' errors in one run, a per-package summary, non-zero exit
  - Done when: `gofront check ./pkg/...` no longer stops at the first failing package
- [ ] Task 1.2: Type-check `_test.go` files (former 5.2)
  - Files: `src/cli/cli-core.js`, `src/cli/test-runner.js`
  - Test: `check-all-packages.test.js`: a package whose only error is in `x_test.go` fails `check` in single-package and pattern mode; no test function runs
  - Done when: `check` compiles the same file set as `gofront test` through a shared helper
- [ ] Task 1.3: Dependents of a failed package are skipped (former 5.3)
  - Files: `src/cli/cli-core.js`
  - Test: `check-all-packages.test.js`: `b` imports failing `a` → `a`'s errors printed once, `b` listed as `skipped (a failed)`; `docs/` CLI reference updated
  - Done when: no error is reported twice
