# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Typechecker/JS promoted selectors:** A method promoted at a shallower depth than a same-named field is not selected: the flattened field map wins in the typechecker and the JS class keeps the field as an instance property over the stub method. Repro: `type In struct{ M int }; type A struct{ In }; type B struct{}; func (B) M() string { return "m" }; type C struct{ A; B }; fmt.Println(C{}.M())` → got `Cannot call non-function type int`, want `m`. (feat/follow-ups-2026-11-11b-phase-1, follow-ups-2026-11-11b Phase 1, Out of Scope)
