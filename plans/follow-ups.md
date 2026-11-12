# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **WASM range assignment into an interface slice element:** A range assignment whose target is an element of an interface slice stores nothing in a `wasm` package. Repro: `out := make([]fmt.Stringer, 1); for _, out[0] = range []N{3, 4} {}; fmt.Println(out[0])` (`N` with a `String` method) → got `<nil>` on wasm, want `N4`. (feat/follow-ups-2026-11-11b-phase-5, follow-ups-2026-11-11b Phase 5, Out of Scope)
