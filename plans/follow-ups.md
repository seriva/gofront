# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **JS `switch` on map:** a nil map tag does not match `case nil` on JS. Repro: `var m map[string]int; switch m { case nil: fmt.Println("m nil") }` → js/both print nothing, want `m nil` (wasm correct). (feat/follow-ups-2026-11-10-phase-1, follow-ups-2026-11-10 Phase 1, Out of Scope)
