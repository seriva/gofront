# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Templ typechecking:** expressions inside `.templ` bodies are never type-checked (they are parsed only during JS codegen), so undefined names and type errors compile. Repro: `templ Hello(name string) { <p>{ name + undefinedVar }</p><p>{ name + 5 }</p> }` → got `gofront check` OK and emitted `String(name + undefinedVar)`, want `Undefined: 'undefinedVar'` and a mismatched-types error. (repo-structure review 2026-10-26, standalone; groundwork in repo-structure Phase 5, Out of Scope)
- **JS shadowed loop variable:** redeclaring a loop variable inside the loop body emits invalid JS. Repro: `for i := 0; i < 2; i++ { i := i; println(i) }` → got `ReferenceError: Cannot access 'i' before initialization` (emits `let i = i;`), want `0` and `1`. (PR #54, standalone, Out of Scope)
