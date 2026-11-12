# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Deferred non-constant untyped arguments:** `defer f(x == 1)` and `defer f(1 << n)` hoist the value into a temp with its default type, so a defined-type or sized parameter rejects it. Repro: `type B bool; func f(b B) {}; func main() { x := 1; defer f(x == 1) }` → got `Type error … Cannot assign bool to B` (also `func f(z int8)` with `defer f(1 << n)` on a second compile of the file: `Cannot assign int to int8`), want it to compile. (feat/follow-ups-2026-11-12-phase-8, follow-ups-2026-11-12 Phase 8, Out of Scope)
