# Compiler Architecture Hardening — Idea Seed

**Version:** v2.1.0  
**Status:** Idea (not yet audited; expand with `/bs-plan` after v2.0.0 ships)  
**Baseline snapshot (2026-11-22, `4dcb36c2`):** `src/` = 71,391 lines (`src/backend/wasm/` = 26,784, `src/typechecker/` = 15,271, `src/backend/js/` = 11,055), 153 distinct `._*` properties written onto AST/Type/Symbol objects, 40 functions ≥ 120 lines (top 4 in `backend/wasm/`: 876L / 703L / 576L / 534L), Sentrux quality `6019` (coupling `0.03`, 0 cycles, 0 god files), 7 Biome unused warnings, `check-baseline.txt` = 62 entries (51 non-excluded across 4 roots), `plans/follow-ups.md` = 87 open items (~7 WASM ICEs).

---

## Goal

Close the internal compiler-quality blind spots not owned by the remaining v2.0.0 feature plans or by [post-2.0-cleanup-plan.md](post-2.0-cleanup-plan.md) (which focuses on SLOC shrinking and test deduplication): eliminate cross-compile module-level singletons, tame in-place AST mutation and hidden `._*` side channels, break up the largest WASM emitter monoliths, replace brittle string/JSON heuristics in both backends, and clear any residual fuzz/ICE/lint debt that survives v2.0.0.

## Candidate Areas to Audit

1. **Module-level mutable state & cross-compile determinism (`src/backend/wasm/`, `src/typechecker/`)**
   - Move `v128Conv = { from, to }` (`src/backend/wasm/boundary.js:896-1016`) onto per-module `meta`/`mod` state so SIMD helper indices cannot leak across compiles in long-lived processes (`PackageCache` / dev server / test workers).
   - Pass `bundled` explicitly instead of mutating module-level `let bundled = null` in `src/backend/wasm/method-expr.js:65`.
   - Wrap the `printing` cycle-guard `Set` in `src/typechecker/types.js:687` in `try/finally` so a thrown error can never leave a type stuck in the set.
   - *(Note: `localTypeCounter`, `iterStateCounter`, and exported generic `_instances` mutation are already covered by v2.0.0 `incremental-builds-plan.md` Task 1.3.)*
2. **In-place AST `.kind` mutations & 153 hidden `._*` tags (`src/typechecker/`, `src/link/wasm.js`)**
   - `incremental-builds-plan.md` isolates cached ASTs with boundary `cloneAst`, but single-pass in-place mutations still cause pass-ordering bugs (e.g. PR #297's `defer int(x)` WASM ICE and `_constArrayLen` regression).
   - Audit and replace in-place `.kind` overwrites and `delete` rewrites in `src/typechecker/assignability.js:1512-1522` (`_markStructCopy`), `src/typechecker/expressions.js:1121,1401,2192,2576`, and `src/link/wasm.js:179-182,300-322`, plus `JSON.parse(JSON.stringify(target))` in `src/typechecker/index.js:760`.
   - Inventory the 153 `._*` properties written onto AST/Type objects; migrate cross-stage annotations toward typed side tables (following `src/lower/`) or a documented annotation contract.
3. **WASM mega-functions & `JSON.stringify` type keying (`src/backend/wasm/`)**
   - Decompose the 4 largest monoliths into focused helpers: `compileWasmModule` (`src/backend/wasm/index.js:325`, 876L), `emitRangeForStmt` (`src/backend/wasm/emit-stmts.js:2347`, 703L), `addBoundaryHelpers` (`src/backend/wasm/boundary.js:975`, 576L), and `emitMapSet` (`src/backend/wasm/emit-maps.js:621`, 534L).
   - Replace `JSON.stringify` type equality (`src/backend/wasm/emit.js:44`) and type-dedup cache keys (`src/backend/wasm/module-emitter.js:536,566,792,839,1035`) with a canonical `wasmTypeKey(wType)` helper that is order-independent and avoids repeated serialization.
4. **JS codegen string-inspection regexes (`src/backend/js/`)**
   - Replace duplicated `/^(new |\{|\[|Array|__nm\()|\$z_/.test(zero)` checks (`src/backend/js/expressions.js:2557,2703,3370`) with a type-driven `needsFreshZero(type)` predicate.
   - Replace scattered `!val.endsWith("n") && /^-?\d+$/.test(val)` BigInt patches (6+ sites across `index.js`, `expressions.js`, `statements.js`) with one typed literal emitter helper.
5. **Prototype-mixin state encapsulation & hidden dispatch (`TypeChecker`, `CodeGen`, `FunctionEmitter`)**
   - Audit the 51–83 `this.*` fields shared across `Object.assign(Class.prototype, ...)` mixins in `src/typechecker/`, `src/backend/js/`, and `src/backend/wasm/` and extract stateless helpers or explicit context objects where coupling is highest.
   - Audit string-indexed method dispatch tables like `STMT_GEN_DELEGATE` (`src/backend/js/statements.js:146-158`) that suppress static call edges in Sentrux while leaving implicit runtime coupling across mixin files.
6. **Package cache & incremental-build hardening (`src/link/package-cache.js`, `src/link/user-js.js`)**
   - `deepFreeze` (`src/link/package-cache.js:122-135`) calls `Object.freeze` on `Map`/`Set` instances, which only blocks own-property assignment—not `.set()`/`.add()`/`.delete()` mutations on cached collections (`exportedSymbols`, `exportedTypes`, etc.). Under `freezePackageCache(true)`, guard mutator methods on frozen `Map`/`Set` instances so test-time immutability checks actually catch collection writes.
   - Tighten `summaryHash` (`src/link/package-cache.js:247-299`): replace unescaped `out.join(",")` framing with length-prefixed or escaped tokens, and fix the `Map` key sort comparator (`String(a) < String(b) ? -1 : 1`) to return `0` on equality.
   - Revisit `filesSignature` (`mtimeMs:size` in `src/link/package-cache.js:171-182`) for same-size/same-mtime rewrites (follow-up from PR #310) and check whether `userEmitter.memo` (`src/link/user-js.js:43`) needs a bound in long-lived processes.
   - Consider replacing comment-sentinel string splicing (`/*__GOFRONT_USER:...*/` in `src/link/user-js.js` and `wasmMarker` in `src/link/wasm.js`) with structured chunk assembly, and check whether `cloneAst(programs)` in `src/link/user-js.js:159` can be dropped once in-place AST mutations (#2) are removed.
7. **Residual correctness, fuzz baseline & lint hygiene**
   - Re-probe anything not cleared by a pre-2.0.0 `/bs-plan follow-ups` pass: the ~7 WasmGC ICE entries in `plans/follow-ups.md`, the 4 remaining non-excluded `check-baseline.txt` roots (`R9`, `W1`, `builtin-complex-operands`, and 3 singletons), and the 7 Biome unused-symbol warnings (`emit-builtins.js`, `assignability.js`, `expressions.js`, `range-assign.test.js`, `simd.test.js`).
   - Once warnings are zero, consider tightening Biome unused-import/unused-var rules to errors so regressions fail `npm run check`.
