# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **WASM imports:** A package used only in a constant array length is reported as unused on the wasm target. Repro: `package main; import ("fmt"; "math"); func main() { var a [math.MaxInt8]int; fmt.Println(len(a)) }` compiled with `forceTarget: "wasm"` → got `'math' imported and not used`, want `127`. (feat/follow-ups-2026-11-09-phase-1, follow-ups-2026-11-09 Phase 1, Out of Scope)
- **Typechecker:** `switch true { case nil: }` is accepted and emits invalid WASM. Repro: `package main; func main() { switch true { case nil: } }` on the wasm target → got `i32.eq[1] expected type i32, found ref.null of type anyref`, want `cannot convert nil to type bool`. (PR #164, follow-ups-2026-11-09 Phase 1, Out of Scope)
- **Typechecker:** `cap` accepts struct and func operands and emits invalid WASM. Repro: `package main; func main() { type S struct{}; var s S; _ = cap(s) }` on the wasm target → got `not enough arguments on the stack for i64.extend_i32_u`, want `invalid argument: s (variable of type S) for cap`. (PR #164, follow-ups-2026-11-09 Phase 1, Out of Scope)
- **Typechecker:** An explicit conversion of a concrete value to an interface type is rejected, and the `interface{ M() }(v)` literal form does not parse. Repro: `type I interface{ M() }; type T struct{}; func (T) M() {}; func main() { _ = I(T{}) }` → got `cannot convert T to I`, want it to compile. (feat/follow-ups-2026-11-09-phase-2, follow-ups-2026-11-09 Phase 2, Out of Scope)
- **Typechecker:** `any` is assignable to a non-empty interface without a type assertion. Repro: `package main; func main() { var b any; var e error; e = b; _ = e }` → got no error, want `cannot use b (variable of type any) as error value in assignment: need type assertion`. (PR #165, follow-ups-2026-11-09 Phase 2, Out of Scope)
