# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **JS `switch` on map:** a nil map tag does not match `case nil` on JS. Repro: `var m map[string]int; switch m { case nil: fmt.Println("m nil") }` → js/both print nothing, want `m nil` (wasm correct). (feat/follow-ups-2026-11-10-phase-1, follow-ups-2026-11-10 Phase 1, Out of Scope)
- **Typechecker constraints:** embedding `comparable` in an interface is rejected. Repro: `type NM interface{ ~int; comparable }; func h[T NM](x T) T { return x }` → got `cannot embed non-interface type comparable`, want it to compile. (feat/follow-ups-2026-11-10-phase-1, follow-ups-2026-11-10 Phase 1, Out of Scope)
- **Interface conversion from `any`:** explicit conversion of an `any` variable to an interface with methods is accepted without a type assertion. Repro: `type I interface{ M() }; func main() { var a any; _ = I(a) }` → compiles on every target, want `need type assertion`. (#174, follow-ups-2026-11-10 Phase 2, Out of Scope)
- **JS stacked labels on range-over-func:** `continue` to the outer of two stacked labels on a range-over-func loop emits invalid JS. Repro: `func seq(y func(int) bool) { y(1) }; func main() { L1: L2: for x := range seq { _ = x; continue L1 } }` → `SyntaxError: Illegal continue statement: 'L1' does not denote an iteration statement`, want it to compile and run. (#174, follow-ups-2026-11-10 Phase 2, Out of Scope)
