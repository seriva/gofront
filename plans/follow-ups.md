# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Parser:** an unnamed generic-instance parameter type inside a func type is rejected. Repro: `func call(f func(Stack[int]) int, s Stack[int]) int { return f(s) }` → got `Parse error: Expected type, got ')'`, want compiles. (PR #78, follow-up-fixes Phase 1, Out of Scope)
- **Typechecker:** a closure with named results and a bare `return` is rejected. Repro: `g := func() (xs []int) { xs = []int{1}; return }` → got `Type error: Missing return value`, want compiles. (PR #78, follow-up-fixes Phase 1, Out of Scope)
- **Generics:** WASM rejects promotion through an embedded generic instance of a method (`Get`) and of a field via a pointer embed (`*Inner[T]`). Repro: `type Inner[T any] struct{v T}; func (i Inner[T]) Get() T {return i.v}; type W[T any] struct{Inner[T]}; W[int]{}.Get()` in a `wasm` package → got `Unknown field 'Get' on struct 'W$int'`, want it compiles; `type P[T any] struct{*Inner[T]}; p.v` → got `No field 'v' on P$string`, want field promoted. (feat/follow-up-fixes-phase-2, follow-up-fixes Phase 2, Out of Scope)
