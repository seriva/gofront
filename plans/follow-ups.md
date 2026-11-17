# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them, groups them by root cause, and moves each into a plan (as a fix task or a deferred row), deleting it here.

Each entry names its root cause (the mechanism that produces it, not the path that exposed it) and its route: the open plan whose scope covers that root, or `unrouted`. Entries with the same root sit together. A defect with the same root as the task being fixed is part of that task and never lands here (`/dev-loop` **Follow-ups**).

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Root: `<root-slug>` (<mechanism, with `file:symbol`>). Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>) → <plan-slug | unrouted>
-->
- **JS discarded map literal:** a discarded map literal with computed keys is emitted as a statement starting with `{`. Root: `js-stmt-expr-start` (expression statements are not parenthesised when they begin with `{`). Repro: `func main() { _ = map[any]int{1: 1} }` on `js` → got `SyntaxError: Unexpected token ':'`, want it to run. (checker-strictness Phase 6, Out of Scope; re-probed 2026-11-17) → unrouted
- **Import of a test-only directory:** `resolveGwDir` treats a directory holding only `_test.go` files as an importable package, but `compileDir` drops test files and throws. Root: `resolve-gw-dir-includes-tests` (`src/resolver.js:resolveGwDir` counts `.go` files without excluding `_test.go`). Repro: `testonly/t_test.go` + `c/c.go` with `import "../testonly"`, then `gofront check <dir>/c` → got `No .go files found in .../testonly`, want a missing-package error that names the import. (#232, check-all-packages Phase 1, Out of Scope) → unrouted
