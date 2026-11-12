# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Logical operators on defined bool operands:** `&&` and `||` of two operands of a defined bool type yield `bool`, not that type, so assigning the result to it is rejected. Repro: `type B bool; var b1, b2 B; var b3 B = b1 && b2` → got `Type error … Cannot assign bool to B`, want it to compile. (PR #194, follow-ups-2026-11-12 Phase 10, Out of Scope)
- **Non-integer array length:** A constant boolean expression is accepted as an array length, and the JavaScript output is then a syntax error. Repro: `var arr [1 == 1]int; fmt.Println(len(arr))` → got `SyntaxError: Unexpected identifier 'Object'` (js), want a compile-time type error rejecting the non-integer array bound. (PR #194, follow-ups-2026-11-12 Phase 10, Out of Scope)
