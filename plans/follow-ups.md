# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Index operand of a non-basic type:** An index operand whose type is a struct, pointer, slice, interface or unconstrained type parameter is accepted without a compile error. Repro: `s := []int{1}; type S struct{}; var x S; _ = s[x]` → got no error on any target, want `invalid argument: index x (variable of type S) must be integer`. (PR #197, follow-ups-2026-11-12 Phase 13, Out of Scope)
