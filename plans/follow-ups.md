# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **JS json:** A multi-value call forwarded directly in a return whose result is `any` boxes the whole tuple, so the first value marshals as `null`. Repro: `func makePair() (T, int) { return T{1}, 1 }; func getPair() (any, int) { return makePair() }; v, _ := getPair(); b, err := json.Marshal(v); fmt.Println(string(b), err)` on js → got `null <nil>`, want `{"A":1} <nil>`. (PR #170, follow-ups-2026-11-09 Phase 7, Out of Scope)
