# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **WASM struct assignment:** `v = w` of a struct with an embedded struct field shares the embedded value when `v` is captured by a closure. Repro: `v := V{P{-4}, 7}; w := v; f := func() { v.M = 5 }; v = w; f(); fmt.Println(w, v)` (V embeds P) → wasm got `{{5} 7} {{5} 7}`, want `{{-4} 7} {{5} 7}`. (feat/assignment-semantics-phase-1, assignment-semantics Phase 1, Out of Scope)
