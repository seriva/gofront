# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Typechecker:** An index, slice bound or `make` size of a non-integer type is accepted when it is not a constant. Repro: `s := []int{1}; f := 1.5; _ = s[f]` and `_ = make([]int, f)` → got no error, want `invalid argument: index f (variable of type float64) must be integer`. (feat/follow-ups-2026-11-12-phase-12, follow-ups-2026-11-12 Phase 12, Out of Scope)
- **Generics:** Type arguments are not inferred from an array parameter. Repro: `func arr[V any](a [2]V) any { return a }; arr([2]int{1, 2})` → got `Cannot infer type arguments for generic function 'arr'`, want it to compile with `V=int`. (feat/follow-ups-2026-11-12-phase-12, follow-ups-2026-11-12 Phase 12, Out of Scope)
- **JS generic boxing:** A struct value boxed by a generic function after a pointer to the same struct type was boxed prints as a pointer. Repro: `func gen[T any](v T) any { return v }; type S struct{ A int }; fmt.Printf("%T|%v\n", gen(&S{4}), gen(&S{4})); fmt.Printf("%T|%v\n", gen(S{5}), gen(S{5}))` → got `*main.S|&{5}` for the second line (js/both), want `main.S|{5}`; wasm is correct. (feat/follow-ups-2026-11-12-phase-12, follow-ups-2026-11-12 Phase 12, Out of Scope)
- **`len` of an array variable as an array length:** `len(arr)` of an array variable is not folded to a constant when used as an array length, so the call leaks into the JavaScript output. Repro: `var base [3]int; func main() { var a [len(base)]int; fmt.Println(len(a)) }` → got `SyntaxError: Unexpected identifier 'Object'` (js), want `3`. (PR #196, follow-ups-2026-11-12 Phase 12, Out of Scope)
