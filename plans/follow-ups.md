# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Generics (JS):** `make([]T, n)` with a type-parameter size instantiated with `int64` allocates `new Array(3n)` (a one-element array) because the BigInt is not converted. Repro: `func mk[T ~int | ~int64](n T) int { return len(make([]int, n)) }; fmt.Println(mk(int64(3)))` → got `1` on js, want `3`. (feat/follow-ups-2026-11-12-phase-14, follow-ups-2026-11-12 Phase 14, Out of Scope)
