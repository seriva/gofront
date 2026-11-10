# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **WASM imports:** A package used only in a constant array length is reported as unused on the wasm target. Repro: `package main; import ("fmt"; "math"); func main() { var a [math.MaxInt8]int; fmt.Println(len(a)) }` compiled with `forceTarget: "wasm"` → got `'math' imported and not used`, want `127`. (feat/follow-ups-2026-11-09-phase-1, follow-ups-2026-11-09 Phase 1, Out of Scope)
