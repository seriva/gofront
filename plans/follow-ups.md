# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **WASM range assignment:** assigning a slice range index to a declared `any` variable builds an invalid WebAssembly module. Repro: `var a any; for a = range []int{5, 6} {}; fmt.Println(a)` → got wasm `local.set[0] expected type anyref, found local.get of type i32`, want `1`. (feat/follow-ups-2026-11-11-phase-1, follow-ups-2026-11-11 Phase 1, Out of Scope)
