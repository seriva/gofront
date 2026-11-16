# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **WASM struct assignment:** `v = w` of a struct with an embedded struct field shares the embedded value when `v` is captured by a closure. Repro: `v := V{P{-4}, 7}; w := v; f := func() { v.M = 5 }; v = w; f(); fmt.Println(w, v)` (V embeds P) → wasm got `{{5} 7} {{5} 7}`, want `{{-4} 7} {{5} 7}`. (feat/assignment-semantics-phase-1, assignment-semantics Phase 1, Out of Scope)
- **Fuzzer transitive mutations:** `stmtConflicts` does not follow `ks(...)` calls inside closure bodies, so a statement can still depend on read-vs-call order. Repro: `node test/fuzz/difffuzz.js --mode order --stmts 12 --case 6873:0` → `xs[(f1(-4))&1] = ((a / 3) * -1)` passes `stmtConflicts`, want it regenerated. (PR #219, assignment-semantics Phase 1, Low)
- **Fuzzer closure order:** `f0`–`f2` are declared before `ks` but may call it, so the batch is rejected by Go. Repro: `node test/fuzz/difffuzz.js --mode order --stmts 12 --case 6873:0` → got `Undefined: 'ks'`, want a valid Go program. (PR #219, assignment-semantics Phase 1, Out of Scope)
- **Multi-assignment (non-Ident targets):** `lhsOperandBinds` only tracks `Ident` targets as assigned, so an operand mentioning a field or element target assigned in the same statement is read after the first store. Repro: `type SP struct{ P *int }; sa, sb := 1, 2; sp := SP{P: &sa}; sp.P, *sp.P = &sb, 99; fmt.Println(sa, sb)` → got `1 99`, want `99 2` (also `xs[0], *xs[0] = &xb, 99`). (PR #220, assignment-semantics Phase 2, Out of Scope)
