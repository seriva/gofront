# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them, groups them by root cause, and moves each into a plan (as a fix task or a deferred row), deleting it here.

Each entry names its root cause (the mechanism that produces it, not the path that exposed it) and its route: the open plan whose scope covers that root, or `unrouted`. Entries with the same root sit together. A defect with the same root as the task being fixed is part of that task and never lands here (`/dev-loop` **Follow-ups**).

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Root: `<root-slug>` (<mechanism, with `file:symbol`>). Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>) → <plan-slug | unrouted>
-->
- **JS discarded map literal:** a discarded map literal with computed keys is emitted as a statement starting with `{`. Root: `js-stmt-expr-start` (expression statements are not parenthesised when they begin with `{`). Repro: `func main() { _ = map[any]int{1: 1} }` on `js` → got `SyntaxError: Unexpected token ':'`, want it to run. (checker-strictness Phase 6, Out of Scope; re-probed 2026-11-17) → unrouted
- **IncDec on constant:** `++` on a constant is accepted. Root: `addressability` (`statements.js:_checkIncDecStmt` has no assignability check). Repro: `const k = 1; k++` → got js `InternalCompilerError`, wasm accepts, want `cannot assign to k`. (PR #235, checker-go-rules Phase 2, Out of Scope) → checker-go-rules
- **wasm type switch:** a case on a defined empty interface does not match on wasm. Root: `wasm-typeswitch-empty-iface` (wasm type-switch matching against defined empty interface). Repro: `type B interface{}; var x any = B(1); switch v := x.(type) { case B: fmt.Println(v) }` → got `` on wasm, want `1`. (PR #236, checker-go-rules Phase 3, Out of Scope) → unrouted
- **Condition messages:** `if v` / `for v` on a defined empty interface report `If condition must be bool` rather than Go's `non-boolean condition`. Root: `empty-interface-kinds` (`statements.js:_checkIfStmt`, `_checkForCond`, `assignability.js:_checkIfaceToConcrete` test `._declared`). Repro: `type MyAny any; var v MyAny = true; if v {}` → got `If condition must be bool`, want `non-boolean condition in if statement`. (PR #236, checker-go-rules Phase 3, Low) → checker-go-rules
