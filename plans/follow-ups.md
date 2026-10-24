# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **JS shifts:** a negative runtime shift count gives a fractional result instead of a panic. Repro: `var x int = 1; n := -1; return int64(x << n)` → got `0.5` path (2**-1), want panic `negative shift amount`. (PR #41, portable-go Phase 0.11, Low)
- **Const shifts:** `const c = 1 << -1` reports two errors. Repro: `const c = 1 << -1` → got `invalid shift count: -1 is negative` and `invalid shift count: negative shift count`, want one. (PR #41, portable-go Phase 0.11, Low)
- **JS shifts:** a constant count below 32 keeps the 32-bit operator even for int64/int. Repro: `var x int64 = 1<<40; return (x << 3) + (x >> 3)` → got JS `0`, want `8933531975680`. (PR #41, portable-go Phase 0.11, Out of Scope)
- **JS shifts:** int64 `<<` overflow is not wrapped to 64 bits. Repro: `var x int64 = 3; n := 62; return x << n` → got JS `13835058055282164000`, want `-4611686018427387904`. (PR #41, portable-go Phase 0.11, Out of Scope)
- **JS ints:** unary `-` on int8 does not wrap. Repro: `var a int8 = -128; return int64(-a)` → got JS `128`, want `-128`. (PR #41, portable-go Phase 0.11, Out of Scope)
- **Typechecker:** shift of a float64 operand is accepted. Repro: `var f float64 = 1; y := f << 2` → got no error, want `shifted operand must be integer`. (PR #41, portable-go Phase 0.11, Out of Scope)
- **JS unsigned:** `-uint16(c+1)` on a typed const fails. Repro: `const c uint16 = 3; var v = -uint16(c+1)` → got `JS compile failed`, want `65532`. (PR #41, portable-go Phase 0.11, Out of Scope)
- **JS unsigned:** unary `^`/`-` on uint/uint64/uintptr do not wrap (Number cannot hold 64 bits). Repro: `var u uint64 = 1; return -u` → got negative Number, want `18446744073709551615`. (PR #41, portable-go Phase 0.11, Out of Scope)
- **WASM fmt:** `fmt.Println(args...)` with `args []any` fails WASM validation. Repro: `args := []any{"x", 1}; fmt.Println(args...)` in a `both`-target `Main` → got `WebAssembly.validate failed: call[1] expected type externref, found local.tee of type anyref`, want it to compile and print `x 1`. (feat/portable-go-phase-0.12, portable-go Phase 0.12 Task 0.25, Out of Scope)
- **Embedded structs (JS):** `Out{In: In{3}}` with a positional inner literal fails to compile. Repro: `type In struct{A int}; type Out struct{In}; o := Out{In: In{3}}` → got `CodeGen: unhandled expression kind 'undefined'`, want a compiled struct with `o.A == 3`. (feat/portable-go-phase-0.12, portable-go Phase 0.12 Task 0.27, Out of Scope)
- **WASM fmt:** struct-keyed map keys print in insertion order, not Go's sorted order. Repro: `fmt.Sprint(map[K]int{K{2}: 2, K{1}: 3})` with `type K struct{A int}` → got WASM `map[{2}:2 {1}:3]`, want `map[{1}:3 {2}:2]`. (feat/portable-go-phase-0.12, portable-go Phase 0.12 Task 0.27, Out of Scope)
- **WASM globals:** taking the address of a package-level scalar silently writes nowhere. Repro: `var x int; func Main() int { p := &x; *p = 5; return x }` (both-target) → got WASM `0`, want `5`; the same goes for a pointer-receiver call on a package-level named scalar (`var g C; g.Inc(); g.Inc(); int(g)` → got WASM `0`, want `2`). (feat/portable-go-phase-0.12, portable-go Phase 0.12 Task 0.28, Out of Scope)
