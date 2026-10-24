# Performance, Minimization, and Simplification — Implementation Plan

**Version:** v1.6.1  
**Status:** Complete (2026-10-18)  
**Depends on:** [`plans/v1.6.1/test-suite-optimization-plan.md`](test-suite-optimization-plan.md)

---

## Goal

Implement targeted small-win optimizations, code deduplication, and structural simplifications across GoFront:
1. Lexer and WASM binary encoder allocations and performance.
2. Emitted JS runtime zero-allocation for string iteration and safe byte conversions.
3. Consolidate duplicated stdlib registries, browser global lists, and version resolution.
4. Reduce cyclomatic complexity in WASM stdlib dispatch and pass `npm run check`.

---

## Task Checklist

### Phase 1: Compiler Pipeline & WASM Encoder Hot Paths
- [x] **Task 1.1**: Optimize `Lexer.readIdent`, `_readDecimalNumber`, and unescaped `readString` in `src/lexer.js` with charCode scans and slice-once.
- [x] **Task 1.2**: Remove rest parameters from `Parser.prototype.match` in `src/parser/index.js`.
- [x] **Task 1.3**: Reuse module-level typed buffers for `encodeF32`, `encodeF64`, and cached `TextEncoder` in `src/backend/wasm/encode.js`.
- [x] **Task 1.4**: Streamline `encodeModule` in `src/backend/wasm/encode.js` to pre-calculate size and allocate a single `Uint8Array`.

### Phase 2: Emitted Runtime Zero-Allocation & Memory Safety
- [x] **Task 2.1**: Optimize string `range` loop in `src/backend/js/statements.js` to use indexed `codePointAt` (zero-allocation).
- [x] **Task 2.2**: Fast-path struct constructors in `src/backend/js/index.js` to skip object destructuring checks on positional calls (`arguments.length === 1`).
- [x] **Task 2.3**: Reuse shared `TextEncoder`/`TextDecoder` and eliminate stack-unsafe `String.fromCharCode(...b)` in `src/backend/js/stdlib/bytes.js`.

### Phase 3: Code Minimization & Deduplication
- [x] **Task 3.1**: Unify `BROWSER_GLOBALS` between `src/typechecker/types.js` and `src/typechecker/stdlib/core.js`.
- [x] **Task 3.2**: Centralize stdlib package lists (`src/resolver.js` imports `STDLIB_PACKAGES` from `src/typechecker/types.js`).
- [x] **Task 3.3**: Single source for version string (`src/cli-core.js` exports `GOFRONT_VERSION` to `src/index.js`).

### Phase 4: Complexity Reduction & Quality Gate
- [x] **Task 4.1**: Refactor cascading `if/else` in `src/backend/wasm/stdlib/packages.js` to table-driven lookup (`EXT_PKG_CONSTS`).
- [x] **Task 4.2**: Run full quality verification (`npm test`, `npm run check`, `npm run bench`).

### Phase 5: Round 2 Minimization, AST Walk Caching & WASM/JS Deduplication
- [x] **Task 5.1**: Slice-once token scanning and block declaration deduplication in `src/templ-lexer.js` and `src/dts-parser.js`.
- [x] **Task 5.2**: Single-pass tokenization and helper deduplication (`findPrevNonWs`) in `src/minifier.js`.
- [x] **Task 5.3**: Eliminate redundant `readFileSync` syscalls in `src/compiler.js` (`compileFiles` reuses `program._path` / `program._source`).
- [x] **Task 5.4**: Eliminate redundant `nodeMutatesVar` AST walks in `src/lower/captures.js` and precompute per-function mutation sets in `src/lower/ownership.js` (`fnMutates`).
- [x] **Task 5.5**: Deduplicate JS codegen helpers (`_isStringExprType`, `_genMapLitEntries`, `NAMED_ZERO_TABLE`, `_genStrictBinary`, `_fmtArgJs`, `slices.Grow`) in `src/backend/js/expressions.js`, `src/backend/js/stdlib/fmt.js`, and `src/backend/js/stdlib/slices.js`.
- [x] **Task 5.6**: Deduplicate WASM codegen and stdlib emitters (`_initNamedReturns`, `_buildEnvFields`, `resolveBranchDepthToOob`, `_emitNilValue`, `_coerceIntWidth`, relational ops, `emitDivRem`, `emitShift`, `emitTypeConversion`, `_emitStoreLhsFromTemp`, `_emitIncDecStep`, `emitSwitchStmt`, `_emitLazyErrorGlobal`, `_emitIoWriteString`, `_emitTimeGetNano`, `_emitTimeMethodYMD`) across `src/backend/wasm/`.

### Phase 6: Round 3 Parser Allocation Reduction, Loop Generator Unification & WASM Helpers
- [x] **Task 6.1**: Deduplicate identifier comma-list parsing with `Parser.prototype.parseIdentList` in `src/parser/index.js`, `src/parser/declarations.js` (`parseVarSpec`, `parseConstDecl`), and `src/parser/types.js` (`parseStructType`).
- [x] **Task 6.2**: Lift statement assignment operators to module-level `ASSIGN_OPS` Set in `src/parser/statements.js`, eliminating thousands of per-statement array allocations; consolidate `case`/`default` dispatch in `parseSwitch` and `_parseTypeSwitchBody`.
- [x] **Task 6.3**: Hoist unary operator table to module-level `UNARY_OPS` Set in `src/parser/expressions.js`.
- [x] **Task 6.4**: Extract `_genIteratorLoop` in `src/backend/js/statements.js`, deduplicating loop wrapping between `genIteratorFor` and `genIteratorForCond`.
- [x] **Task 6.5**: Hoist `i64.extend_i32_u` conversions in `_emitBuiltinLen` and `_emitBuiltinCap` in `src/backend/wasm/emit-builtins.js`.
- [x] **Task 6.6**: Unify package expression detection (`_isPkgExpr`) and interface boxing/unboxing helpers (`_emitBoxValue`, `_emitUnbox`) across `src/backend/wasm/emit.js`, `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/emit-stmts.js`, and stdlib emitters (`core.js`, `io.js`, `time.js`, `packages.js`).
- [x] **Task 6.7**: Precompute closure-mutated variables (`λ*`) in `src/lower/ownership.js` (`closureMutates`).


