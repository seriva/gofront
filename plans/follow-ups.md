# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Typechecker conversions:** Calling an alias of an anonymous struct type as a conversion is rejected. Repro: `type A = struct{ X int }; type S struct{ X int }; u := A(S{1})` → got `Cannot call non-function type struct{...}`, want a converted value. (feat/follow-ups-2026-11-16-phase-1, follow-ups-2026-11-16 Phase 1, Out of Scope)
