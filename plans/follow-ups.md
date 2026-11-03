# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **JS type switch:** a `case func():` (or any func-type case) on an `any` always matches in JS because the check is emitted as `if (true)`, so non-func values and funcs of other signatures take that case. Repro: `switch x.(type) { case func(): return "f"; default: return "d" }` with `kind(1)` and `kind(func(int) string {...})` → got `f f` on js/both, want `d d` (wasm prints `d`). (feat/follow-ups-2026-11-03-phase-1, follow-ups-2026-11-03 Phase 1, Out of Scope)
