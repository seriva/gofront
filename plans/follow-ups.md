# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **WASM range assignment:** assigning a slice range index to a declared `any` variable builds an invalid WebAssembly module. Repro: `var a any; for a = range []int{5, 6} {}; fmt.Println(a)` → got wasm `local.set[0] expected type anyref, found local.get of type i32`, want `1`. (feat/follow-ups-2026-11-11-phase-1, follow-ups-2026-11-11 Phase 1, Out of Scope)
- **Typechecker struct embeds:** a struct embedding a user-declared interface does not get the interface's methods. Repro: `type Mer interface{ M() }; type T struct{}; func (T) M() {}; type S struct{ Mer }; var m Mer = S{T{}}; S{T{}}.M()` → got `S does not implement Mer` and `No field 'M' on S`, want it to compile and call `T.M`. (feat/follow-ups-2026-11-11-phase-2, follow-ups-2026-11-11 Phase 2, Out of Scope)
- **Typechecker promoted fields:** a promoted field and a promoted method with the same name at the same depth resolve to the field instead of being ambiguous. Repro: `type A struct{ M int }; type B struct{}; func (B) M() {}; type C struct{ A; B }; c := C{}; fmt.Println(c.M)` → got `0`, want `ambiguous selector c.M`. (feat/follow-ups-2026-11-11-phase-2, follow-ups-2026-11-11 Phase 2, Out of Scope)
- **WASM nil embedded pointer:** a promoted value-receiver method reached through a nil embedded pointer in an interface runs instead of panicking on WebAssembly. Repro: `type VMer interface{ VM() }; type Inner struct{}; func (i Inner) VM() { fmt.Println("inner") }; type PO struct{ *Inner }; var v any = PO{}; v.(VMer).VM()` with `recover` → got wasm `inner`, want `runtime error: invalid memory address or nil pointer dereference`. (#181, follow-ups-2026-11-11 Phase 2, Out of Scope)
