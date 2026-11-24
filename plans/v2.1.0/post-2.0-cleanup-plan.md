# Post-2.0.0 Cleanup & Shrinking — Idea Seed

**Version:** v2.1.0  
**Status:** Idea (not yet audited; expand with `/bs-plan` after v2.0.0 ships)  
**Baseline snapshot (2026-11-19, `feat/checker-go-rules`):** `src/` = 66,929 lines (`src/backend/wasm/` = 25,693, `src/typechecker/` = 12,712, `src/backend/js/` = 10,869), `test/unit/*.js` = 96,853 lines, `test/fuzz/` = 2,181 lines code + 5,826 lines `check-baseline.txt`, conformance fixtures = 286 files (3,832 lines).

---

## Goal

Reclaim SLOC and maintenance overhead added during the v2.0.0 checker, WASM, and typed-web-platform work without losing test coverage or Go-spec faithfulness (similar in spirit to v1.9.0's `compiler-shrinking` and `runtime-pruning` passes).

## Candidate Areas to Audit

1. **Differential fuzzer & baseline (`test/fuzz/`)**
   - Verify `test/fuzz/check-baseline.txt` holds only `# excluded:` entries after `checker-operand-rules`.
   - Decide whether to keep `test/fuzz/` (~2.2k lines) as an on-demand regression oracle or retire it (and `test/unit/cli/checkfuzz.test.js`) once `checker-operand-rules` and `value-stores` are complete.
2. **Test suite deduplication (`test/unit/`)**
   - Audit overlap between `test/unit/**/*.js` (grew from ~97k lines on 2026-11-19 to ~112k lines across 188 files by 2026-11-23) and `test/unit/fixtures/conformance/` (286+ files).
   - Consolidate repetitive per-repro tests into table-driven cases or conformance fixtures where coverage is identical.
3. **Checker `JS_DYNAMIC_ANY` & interop leftovers (`src/typechecker/`)**
   - After `typed-web-platform` types browser globals via WebIDL, audit remaining `JS_DYNAMIC_ANY` permissive branches and hand-written interop shims for dead or unnecessary paths.
4. **Backend & checker shrinking pass (`src/backend/wasm/`, `src/backend/js/`, `src/typechecker/`)**
   - Audit the largest files (`src/backend/js/expressions.js` 4.3kL, `src/backend/wasm/emit-stmts.js` 4.1kL, `src/backend/wasm/emit-exprs.js` 3.7kL, `src/typechecker/expressions.js` 3.5kL, `src/backend/wasm/boundary.js` 2.9kL, `src/backend/js/statements.js` 2.6kL) for dead helpers, duplicated store/layout logic left after `wasm-struct-types`, `value-stores`, and `js-dead-code-elimination`.
5. **Working notes cleanup**
   - Remove temporary checklists like `plans/v2.0.0/next-steps.md` if still present.
