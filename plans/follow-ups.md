# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Templ css:** a parameterized `css` declaration now surfaces as an internal compiler error because `genCssDecl` in `src/backend/js/templ.js` throws a bare `Error`. Repro: `compileFiles(["main.templ"], { forceTarget: "js" })` with `css bad(x string) { color: red; }` → got `InternalCompilerError: internal compiler error: css bad: parameterized css declarations are not yet supported`, want a `CompileError` without the internal-error wrapper (throw `UnsupportedError`). (PR #225, checker-strictness Phase 1, Out of Scope)
- **compileWasm:** the standalone `compileWasm` helper returns wasm bytes without running `validateWasm`. Repro: `compileWasm("package main\nfunc main() {\n\tvar a struct{ X int }\n\tvar b struct{ Y string }\n\ta = b\n}\n")` → got `{ wasm: Uint8Array(273), errors: [] }` with `WebAssembly.validate(wasm) === false`, want `InternalCompilerError`. (PR #225, checker-strictness Phase 1, Out of Scope)
- **Positions:** `BasicLit` nodes that `parseConstDecl` substitutes for `iota` carry no `_line`/`_col` (129 nodes in `example/` + `stdlib/`). Repro: parse `example/gom/src/types.go`, walk `ConstDecl.value` `BasicLit` nodes → got `_line: undefined`, want the line:col of the `iota` token or its `ConstSpec`. (PR #225, checker-strictness Phase 1, Out of Scope)
- **Positions:** the type-switch capture variable is defined without a declaring node, so `localNode` returns null (benign today because it is marked used immediately). Repro: inspect `caseScope.localNode(stmt.assign)` in `_checkTypeSwitchStmt` for `switch x := v.(type)` → got `null`, want the declaring identifier node. (PR #225, checker-strictness Phase 1, Out of Scope)
