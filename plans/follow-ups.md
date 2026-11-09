# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->

- **Typechecker switch:** An untyped bool constant tag skips case checking because of the `tagType.base !== "bool"` guard in `statements.js`. Repro: `switch true { case 5: }` → got compiles, want `cannot convert 5 (untyped int constant) to type bool`. (PR #154, follow-ups-2026-11-07 Phase 1, Out of Scope)
- **Typechecker switch:** A tagless `switch` accepts `case nil:`. Repro: `switch { case nil: }` → got compiles, want `cannot convert nil to type bool`. (PR #154, follow-ups-2026-11-07 Phase 1, Out of Scope)
- **Typechecker builtins:** `cap` accepts integer and bool arguments. Repro: `_ = cap(1)` → got compiles, want `invalid argument: 1 (untyped int constant) for cap`. (PR #154, follow-ups-2026-11-07 Phase 1, Out of Scope)
