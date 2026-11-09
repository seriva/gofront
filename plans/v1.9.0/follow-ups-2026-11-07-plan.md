# v1.9.0 Review Follow-ups (2026-11-07) — Design Plan

**Version:** v1.9.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** [`follow-ups-2026-11-03-plan.md`](follow-ups-2026-11-03-plan.md), [`compiler-shrinking-plan.md`](compiler-shrinking-plan.md), [`overlays-to-go-plan.md`](overlays-to-go-plan.md), [`runtime-pruning-plan.md`](runtime-pruning-plan.md)  
**Release note:** More Go programs now behave identically to Go across JavaScript and WebAssembly, including function-local types with the same name in different functions, cross-package type aliases and value parameters, interface type assertions and their failure messages, `unicode.IsPrint` on non-ASCII spaces, `os.Stderr` output under Node.js, `regexp` no-match results, ranging over a nil map, `complex64` constants in WebAssembly, output without a trailing newline in WebAssembly, `%p` of maps and slices, and printing generic values stored in `any`, and the compiler rejects more invalid programs that Go rejects. Templ components now support multi-value `switch` cases (`case a, b:`) and inline struct literals in `for` headers, and `b.Run` sub-benchmarks now run to the target duration and report their own result line.

---

## Goal

Schedule and fix the 55 reproducing defects in scope from the 76 open entries in `plans/follow-ups.md` (logged during [`follow-ups-2026-11-03-plan.md`](follow-ups-2026-11-03-plan.md) Phases 1–27, [`compiler-shrinking-plan.md`](compiler-shrinking-plan.md) Phases 2–4, and [`overlays-to-go-plan.md`](overlays-to-go-plan.md) Phases 1–3), re-probed on `feat/overlays-to-go` @ `9a214e3`. Of the 76 ledger entries:
- **4 no longer reproduce** on `9a214e3` (`F01`, `F20`, `F60`, `F67`) and are deleted from the ledger.
- **1 is already scheduled** in [`runtime-pruning-plan.md`](runtime-pruning-plan.md) Phase 1 Task 1.1 (`F73`, local `json` variable hijacking `.Marshal()`).
- **1 is a duplicate** (`F72` duplicates `F49`, same-named function-local types in different functions; both repros are verified in Task 2.3).
- **15 are excluded or deferred** in the [Scope Rule & Boundary Matrix](#scope-rule--boundary-matrix) (`F02`, `F54`, `F55`, and the 12 `fmt` repros `F09`, `F23`–`F30`, `F39`, `F65`, `F66` deferred to after [`overlays-to-go-plan.md`](overlays-to-go-plan.md) Phase 6).
- **55 distinct defects** (56 ledger lines) are scheduled across Phases 1–7, grouped by subsystem: parser & typechecker checks (Phase 1), package types, aliases & function-local types (Phase 2), JS loops, pointers, numerics & value copies (Phase 3), JS nil receivers, panic/recover & map keys (Phase 4), JS/WASM dynamic types & interface assertions (Phase 5), WASM control flow, captures, strings, builtins & facade (Phase 6), and `encoding/json`, templ & Go-source stdlib (Phase 7).
- `F56` is scheduled as a JS/WASM parity fix within GoFront's UTF-16 string model; Go's UTF-8 byte offsets stay excluded (see `Excluded: runtime / platform`).

**2026-11-09 sweep** (`main` @ `68d6a51`, after `overlays-to-go` merged): 7 new ledger entries (`F77`–`F83`, logged during `overlays-to-go` Phases 4–7) plus the 12 deferred `fmt` repros were re-probed:
- **9 deferred `fmt` repros no longer reproduce** (`F24`, `F25`, `F27`, `F28`, `F29`, `F30`, `F39`, `F65`, `F66`), fixed by Go-source `stdlib/fmt/`.
- **2 are already scheduled**: `F80` (WASM `fmt.Print` without trailing newline dropped) shares `lineBuf` with `F46` and is added to Task 6.4; `F81` (single-file build `fmt` of a struct prints `<nil>`) is covered by [`runtime-pruning-plan.md`](runtime-pruning-plan.md) Task 2.3 (`compileSingleFile` delegates to `compileFiles`).
- **1 is excluded** (`F26`: sized numbers in `any` on the JS side lose their type; documented in Task 9.1, see `Excluded: runtime / platform`).
- **7 defects are scheduled** in Phases 8–9: `F77`–`F79` (typechecker, JS, WASM codegen) and `F09`, `F23`, `F82`, `F83` (Go-source `fmt` and `testing`).

**2026-11-09 plan review** (`main` @ `0e9b0ab`): every scheduled repro re-probed (see [Review audit (2026-11-09)](#review-audit-2026-11-09)); all still reproduce except `F54` (deferred, now fixed). Two same-root-cause sub-repros were added to Tasks 1.1 and 2.4.

Re-probe each phase's entries on its base commit before starting the phase and drop any sub-repro that no longer reproduces.

**Done means:**
- Every repro scheduled in Phases 1–9 is a passing test in its task's `Test:` file, matching Go 1.26 output on every target the construct supports (`assertProgramOutput` for `both` + `wasm`, `assertAllTargetsOutput` where plain `js` packages must also match, `compileHybridProject` for multi-package repros, and JS-package tests for the JS-only `regexp`, templ and Node `os.Stderr` repros), or `assertErrorContains` with Go's diagnostic message for invalid Go programs. Behaviour that `docs/go-compatibility.md` documents as a deliberate JS-package difference (float64 `int`/`uint` arithmetic, nil map/pointer/func/slice in `any` comparing equal to `nil`, UTF-16 string offsets) stays as documented.
- Every WASM repro passes `assertValidWasm`; no repro produces an uncatchable WebAssembly trap where Go recovers a runtime panic, or emits invalid WAT/WASM.
- `npm test`, `npm run check`, and `npm run test:e2e` pass with zero regressions.
- `docs/go-compatibility.md` **String semantics** describes `for i := range s` as UTF-16 code-unit offsets on both backends (Task 3.3, e.g. `for i := range "a😀b"` → `0, 1, 3`).

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | All reproducing ledger defects across parser, typechecker, lowering, JS/WASM backends, JSON codecs, templ, and `stdlib/` except the `fmt` engine repros | `F03`–`F08`, `F10`–`F19`, `F21`, `F22`, `F31`–`F38`, `F40`–`F53`, `F56`–`F59`, `F61`–`F64`, `F68`–`F72`, `F74`–`F76` (55 distinct defects across Phases 1–7); 2026-11-09 sweep `F77`–`F79`, `F09`, `F23`, `F82`, `F83` (Phases 8–9) and `F80` (added to Task 6.4) | |
| **In scope: target-specific** | Fix the failing target(s) while pinning the working target(s) in the same test | JS-only (`F03`, `F04`, `F10`, `F11`, `F13`–`F19`, `F22`, `F31`, `F36`, `F41`, `F42`, `F56`, `F61`, `F68`–`F71`, `F78`) and WASM-only (`F07`, `F21`, `F32`, `F34`, `F35`, `F37`, `F38`, `F40`, `F43`, `F46`–`F48`, `F79`, `F80`) defects; JS-host-only features (`regexp` `F76`, templ `F58`, `F59`, Node `os.Stderr` `F75`) are tested in `js` packages; `F83` is tested through `gofront test -bench` | |
| **Excluded: runtime / platform** | Nominal WasmGC struct pointer identity cannot alias across distinct struct definitions | `F02` `type Base struct{n int}; type S Base; b := Base{1}; p := (*S)(&b)` in `both`/`wasm` → `cannot convert *Base to *S in a wasm package: pointers to distinct struct types cannot share storage; keep this code in a js package` | WasmGC struct types are nominal (`(type $Base (struct ...))` vs `(type $S (struct ...))`); two pointers of different nominal WasmGC struct types cannot alias the same heap struct without erasing struct types or maintaining shadow projections. The compiler already emits a targeted diagnostic. |
| **Excluded: runtime / platform** | Documented JS string and JS-package semantics stay as documented in `docs/go-compatibility.md` | `F56` Go's UTF-8 byte offsets (`for i, r := range "éa"` → Go `0 233\n2 97`; GoFront keeps UTF-16 offsets `0 233\n1 97`); `F16` `a == nil` for a nil `[]int` in `any` (JS `true`, WASM/Go `false`); `F69`/`F70` wrapping in plain `js` packages (float64 `int`/`uint` arithmetic, no wrap); `F26` sized numbers in `any` on the JS side (`var c any = float32(0.1); var d any = uint64(1); fmt.Println(c); fmt.Printf("%T\n", d)` → js/both `0.10000000149011612` / `int64` (also `uint32`/`int8` → `int`), wasm/Go `0.1` / `uint64`) | GoFront strings are JS UTF-16 strings on both backends, so `len`, `s[i]` and `s[i:]` use UTF-16 units; byte offsets from `range` would break `s[i:]`. JS has no typed nil (documented `nil` row). Plain `js` packages use float64 integer arithmetic by design; strict numeric rules apply to `both`/`wasm`. A JS `any` holds sized integers and `float32` as plain `number` and `int64`/`uint64` as plain `bigint` with no type tag (same cause as the documented `var a any = 3.0` → `%T` `int` row); tagging them would box every numeric value stored in `any` on hot paths. Task 9.1 documents it. |
| **Excluded: deferred** | WasmGC `SHARED_REPR` slice and array dynamic identity in `any` | `F55` `type A []int; var c any = A{1}; _, ok := c.([]int)` on wasm → `true` (want `false`) | `[]bool`/`[]uint8` and defined vs unnamed slices/arrays with identical element representations share WasmGC array/slice types (`SHARED_REPR`); distinguishing them dynamically inside `any` requires per-type WasmGC box wrappers (same root cause as deferred `L154` in `follow-ups-2026-11-03-plan.md`). `F54` (`var a any = []bool{true}; fmt.Println(a)` → wasm `[1]`) no longer reproduces on `0e9b0ab` (`[true]` on all targets) and is dropped. |
| **Excluded: deferred** | `fmt` engine repros, re-probed after [`overlays-to-go-plan.md`](overlays-to-go-plan.md) Phase 6 | `F09` `fmt.Printf("%T", any(Box[int]{}))` → js/both `main.Box`, want `main.Box[int]`; `F23` `fmt.Sprintf("%p", map[string]int(nil))` → js/both `0x1`, want `0x0`; `F24` `fmt.Sprintf("%+5v", []int{1})` → `  [1]`, want `[    1]`; `F25` `fmt.Sprintf("%s", (*T)(nil))` → `<nil>`, want `%!s(*main.T=<nil>)`; `F26` `var x any = float32(0.1); var u any = uint64(1); var a any = (*Color)(nil)` printed with `%T` → `0.10000000149011612 int64/int <nil>`, want `0.1 uint64 *main.Color`; `F27` `var x any = (*C)(nil); fmt.Sprint(x, []any{x})` → wasm `<nil> [<nil>]`, want `c [c]`; `F28` `fmt.Append(fb())` / `fmt.Appendf(fb3())` → js/both `TypeError`, want `hi world hi 42`; `F29` `fmt.Printf(f())` (`f() (string, Color)`) → wasm `T=int`, want `T=main.Color`; `F30` `fmt.Sprintf("%#v", any(M{map[string]int{}}))` → `main.M{M:map[interface {}]interface {}{}}`, want `main.M{M:map[string]int{}}`; `F65` `fmt.Printf("%#v", P{})` (`func (*P) GoString()`) → js/both `ptr.P`, want `main.P{}`; `F66` `fmt.Printf("%#v", &T{})` (`func (T) GoString()`) → wasm `&main.T{}`, want `val.T`; `F39` `defer func() { recover(); fmt.Println("\|") }(); var p *int; fmt.Println("n", *p)` → wasm `n \|`, want `\|` | `overlays-to-go` Tasks 4.4, 5.3 and 6.1 delete `src/backend/js/stdlib/fmt.js`, `src/backend/js/fmt-runtime.js` and the WASM `fmt` marshalling in `src/backend/wasm/stdlib/core.js` that these fixes would edit, and this plan's branch forks before those phases land. After `overlays-to-go` Phase 6 merges, re-probe these repros against Go-source `stdlib/fmt/` and record survivors in `plans/follow-ups.md`. **Re-probed 2026-11-09** on `main` @ `68d6a51` (row closed): `F24`, `F25`, `F27`–`F30`, `F39`, `F65`, `F66` fixed; `F09` and `F23` survive in narrower forms and are scheduled in Tasks 9.2 and 9.1; `F26` moved to `Excluded: runtime / platform`. |

---

## Verified Gaps & Baseline Audit

### Review follow-ups (2026-11-07)

All 76 entries in `plans/follow-ups.md` (`F01`–`F76`, lines 8–83) were re-probed on `feat/overlays-to-go` @ `9a214e3` using `.probes/reprobe.mjs` (`compileFiles` with `forceTarget` `js`, `both`, and `wasm` + `assertValidWasm` for single-package repros; `compileDir` / `compileHybridProject` for multi-package repros; `compileDir` + `runInDom` for `.templ` repros) against Go 1.26 (`go1.26.0 linux/amd64`).

**No longer reproducing on `9a214e3` (4 entries, deleted from `plans/follow-ups.md`):**
- `F01`: `switch x.(type) { case func(): return "f"; default: return "d" }` with `kind(1)` and `kind(func(int) string {...})` → `d d` on `js`, `both`, and `wasm` (feat/follow-ups-2026-11-03-phase-1).
- `F20`: `var d any; json.Unmarshal([]byte("[1, 2]"), &d); switch d.(type) { case []string: ... }` → no match on `js`, `both`, and `wasm`, fixed by unified `jsonrt` in `compiler-shrinking` Phase 4 (PR #116).
- `F60`: `var b strings.Builder; b.WriteString("a\xffb"); fmt.Println(b.Len())` → `3` on `js`, `both`, and `wasm`, fixed by moving `strings.Builder` to Go source in `compiler-shrinking` Phase 2 (PR #129).
- `F67`: `fmt.Println(unicode.ToUpper(-1))` → `-1` on `js`, `both`, and `wasm`, fixed by moving `unicode` predicates to Go source in `overlays-to-go` Phase 2 (PR #134).

**Already scheduled in [`runtime-pruning-plan.md`](runtime-pruning-plan.md) (1 entry, deleted from `plans/follow-ups.md`):**
- `F73`: Local variable `var json Config` calling `json.Marshal()` in a file importing `"encoding/json"` hijacked into `gfj_main_marshal1()` → scheduled in `runtime-pruning-plan.md` Phase 1 Task 1.1 (PR #141).

| Area | Finding | Evidence & probe |
|---|---|---|
| Parser struct tags | Struct tag after a `func`-typed field fails to parse | `F50` `var _ = struct{ F func() \`json:"f"\` }{}` → all `Parse error at main.go:4:27: Expected type, got 'json:"f"'`, want compiles (feat/follow-ups-2026-11-03-phase-19) |
| Typechecker `switch` | Untyped string constant tag with int case, and tagless `switch` with non-bool case accepted | `F05` `switch "foo" { case 5: }` → js/both compile, wasm validate `call[1] expected type externref, found i64.const`, want `cannot convert 5 (untyped int constant) to type string` (feat/follow-ups-2026-11-03-phase-3); `F57` `switch { case 5: }` → all compile (and in templ), want `invalid case 5 in switch (mismatched types untyped int and bool)` (feat/follow-ups-2026-11-03-phase-21) |
| Typechecker numerics | Fractional untyped float to `int` and `byte != int(q)` accepted | `F06` `var i int = 1.5` → js/both compile, wasm validate `local.set[0] expected type i64, found f64.const`, want `cannot use 1.5 (untyped float constant) as int value in variable declaration (truncated)` (feat/follow-ups-2026-11-03-phase-3); `F63` `s := "abc"; q := byte(97); _ = s[0] != int(q)` → js/both compile, wasm validate `i32.ne[1] expected type i32, found i64.extend_i32_u`, want `mismatched types` error (PR #130) |
| Typechecker builtins & `:=` | `cap("hello")` and comma-ok `x, ok := a.(int)` with no new variables accepted | `F62` `_ = cap("hello")` → js/both compile, wasm validate `not enough arguments on the stack`, want `invalid argument: "hello" (untyped string constant) for cap` (PR #130); `F12` `var x int; var ok bool; x, ok := a.(int)` → all compile with 0 errors, want `no new variables on left side of :=` (PR #113) |
| Typechecker maps | Comma-ok map lookup skips key assignability check, leaving 64-bit constant key untyped | `F61` `m := map[int64]string{1 << 60: "hello"}; v, ok := m[1<<60]; fmt.Println(v, ok)` → js/both `" false"`, wasm `"hello true"`, want `"hello true"` everywhere (PR #130) |
| Package types & aliases | Same-named type in `main` shadows `pkg.Pt{...}`; cross-package struct alias literal `p.A{42}` fails in JS | `F08` `package a; type Pt struct{ X int }` + `main` `type Pt struct{ Z bool }; fmt.Println(Pt{true}, a.Pt{1})` → all `Cannot assign untyped int to bool`, want `{true} {1}` (feat/follow-ups-2026-11-03-phase-5); `F10` `package p; type Base struct{ V int }; type A = Base` + `main` `p.A{42}` → js/both `ReferenceError: A is not defined` (wasm `{42}`), want `{42}` (feat/follow-ups-2026-11-03-phase-5) |
| Function-local types | Local types with the same name in different functions overwrite each other in the typechecker | `F49` `func a() { type Dup struct{ X int }; fmt.Println(Dup{1}) }; func b() { type Dup struct{ Y string }; fmt.Println(Dup{"y"}) }` → js/both `{}\n{y}`, wasm validate `struct.new[0] expected type externref, found i64.const`, want `{1}\n{y}` (feat/follow-ups-2026-11-03-phase-19); `F72` `f1()` `type Config struct{A int \`json:"a"\`}` + `f2()` `type Config struct{B string}` → all `{"B":""}`, want `{"a":1}` (PR #139) |
| Cross-package structs & array lengths | Cross-package struct value parameter is not cloned in prologue before pointer-receiver call; `[math.MaxInt8]int` emits `[object Object]` in JS | `F68` `func f(s pkg.S) { s.Inc() }; s := pkg.S{X: 1}; f(s); fmt.Println(s.X)` → js/both `2`, wasm `1`, want `1` (PR #137); `F71` `var a [math.MaxInt8]int; fmt.Println(len(a))` → js/both `SyntaxError: Unexpected identifier 'Object'`, wasm `0`, want `127` (PR #138) |
| JS pointers & boxing | Method call on converted struct pointer `(*S)(&b).Inc()` fails; address-taken comma-ok map var is unboxed | `F03` `type Base struct{n int}; type S Base; func (s *S) Inc() { s.n++ }; b := Base{1}; (*S)(&b).Inc()` → js `b.Inc is not a function`, want `2` (feat/follow-ups-2026-11-03-phase-2); `F04` `x, y := m["k"]; p := &x; *p = 9; fmt.Println(x, y)` → js/both `Cannot create property 'value' on number '3'`, wasm `9 true`, want `9 true` (feat/follow-ups-2026-11-03-phase-2) |
| JS loops & `range` | Stacked labels on `for` with hoisted shadowed init break `continue outer`; `for _, v = range m` throws `_$ is not defined`; `for i, r := range` over strings with astral runes counts runes on JS but UTF-16 offsets on WASM | `F11` `n := 1; outer: inner: for n := n + 1; n < 3; n++ { continue outer }` → js/both `Illegal continue statement: 'outer' does not denote an iteration statement` (PR #113); `F42` `var v int; for _, v = range m {}` → js/both `_$ is not defined`, wasm `1`, want `1` (feat/follow-ups-2026-11-03-phase-16); `F56` `for i, r := range "éa" { fmt.Println(i, r) }` → all `0 233\n1 97`, Go `0 233\n2 97` (feat/follow-ups-2026-11-03-phase-21); review re-probe `for i, r := range "éa😀b"` → js/both `0 1 2 3`, wasm `0 1 2 4` (UTF-16 offsets, consistent with `s[i:]`) |
| JS numerics & 64-bit constants | `uint` subtraction underflow does not wrap on JS; function-local untyped constant shifted with `uint64` emits Number | `F69` `var n uint = 3; fmt.Println(n-64 > 100)` → js/both `false`, wasm `true`, want `true` (feat/compiler-shrinking-phase-3); `F70` `var b uint64 = 1; var e uint = 3; const half = 1 << 51; b += half >> e` → js/both `Cannot mix BigInt and other types` (wasm `281474976710657`), want `281474976710657` (feat/compiler-shrinking-phase-3) |
| JS slice copies & cross-package element pointers | `append`/`copy` share struct element references on JS; `&xs[0]` taken in another package is not tracked by caller package | `F41` `a := []P{{1, 1}}; b := append([]P(nil), a...); b[0].N = 50; fmt.Println(a)` → js/both `[{50 1}]`, wasm `[{1 1}]`, want `[{1 1}]` (feat/follow-ups-2026-11-03-phase-16); `F44` `q := p.First(ys); ys[0] = p.S{9}; fmt.Println(q.A)` → js/both `1`, wasm `9`, want `9` (feat/follow-ups-2026-11-03-phase-16) |
| JS nil method values & expressions | `(*Box[int]).M(nil)` and `var s *S; f := s.Ping; f()` throw null-property TypeError on JS | `F13` `var b *Box[int]; g := (*Box[int]).M; g(b)` → js/both `Cannot read properties of null (reading 'M')`, wasm `0`, want `0` (PR #114); `F14` `var s *S; f := s.Ping; f()` → js/both `Cannot read properties of null (reading 'Ping')`, wasm `ping`, want `ping` (PR #114) |
| Panic/recover & `len(f())` | User `panic("runtime error: foo")` recovers as `error` on JS; `panic(rt("q"))` (`type rt string` implementing `error`) loses type; `len(getNil())` on `*[3]int` skips call on JS and panics on WASM | `F36` `panic("runtime error: foo"); _, ok := recover().(error)` → js/both `true`, wasm `false`, want `false` (PR #120); `F64` `panic(rt("q"))` → all `q\nfalse`, want `boom\ntrue` (PR #132); `F45` `fmt.Println(len(getNil()))` → js/both `3` (skips `getNil()`), wasm `panic: invalid memory address`, want `getNil\n3` (PR #123) |
| JS map keys in `any` | Unhashable slice in `any` variable used as `map[any]` key does not panic on JS | `F22` `var x any = []int{1}; m := map[any]int{}; m[x] = 1` → js/both `<nil>` (no panic), wasm `runtime error: hash of unhashable type []int`, want panic on all targets (PR #117) |
| JS/WASM `any` & type assertions | Typed nil `*int` equality and nil `[]int` assertion in `any` on JS; generic `any(v)` boxing on JS; promoted pointer-receiver method on struct value in `any`; `case fmt.Stringer:` matching `int` on JS; `iter.Seq[int]` and defined slice type switches on WASM; generic assertion panic text | `F15` `var p1, p2 *int; var a1, a2 any = p1, p2; a1 == a2` → js/both `false`, want `true` (PR #116); `F16` `var s []int; var a any = s; _, ok := a.([]int); fmt.Println(ok, a == nil)` → js/both `false true`, wasm/Go `true false` (`a == nil` → `true` on JS is the documented `nil` row; only `ok` is scheduled) (PR #116); `F17` `F[T](p)` and `Kind[Name](Name("a"))` → js/both `true str`, want `false T` (PR #116); `F18` `Step(&c)` (`*Counter` satisfying `Incer`) → js/both `__tbox(...).Inc is not a function`, want `6` (PR #116); `F19` `Outer{Inner}` value asserted to pointer-receiver `Mer` → js/both `true`, want `false` (PR #116); `F31` `switch v.(type) { case error: ... case fmt.Stringer: ... }` on `3` → js/both `s`, want `other` (feat/follow-ups-2026-11-03-phase-13); `F32` `any(seq).(iter.Seq[int])` → wasm `true`, want `false` (feat/follow-ups-2026-11-03-phase-13); `F34` `switch any([]int{1}).(type) { case S: ... case []int: ... }` → wasm `S`, want `slice` (PR #120); `F33` `var i any = "s"; _ = i.(int)` → all `interface conversion: type assertion failed`, want `interface conversion: interface {} is string, not int` (feat/follow-ups-2026-11-03-phase-13) |
| WASM nil traps, maps, captures & labels | Embedded nil pointer value-method call traps uncatchably; nil interface method value binding does not panic at binding; array map keys alias caller array; comma-ok into `any` fails validation; closure map literal key not captured; stacked labels ignore outer label; package/struct string zero is null; `print` without `\n` dropped; `println(MyBool(true))` prints `1`; `fmt.Println("n", *p)` flushes `"n"` before panic; facade skips promoted methods from unexported embedded struct | `F07` `P{}.Val()` → wasm `RuntimeError: dereferencing a null pointer`, want `recovered` (PR #111); `F35` `var n N; _ = n.Name` → wasm `<nil>`, want nil-deref panic (PR #120); `F21` `ar[key] = 5; key[0] = 9` → wasm `0 1 0`, want `5 1 5` (PR #117); `F37` `var x any; x, ok = mi["k"]` → wasm validate `local.set[0] expected type anyref, found local.tee of type i64` (PR #121); `F38` `map[string]int{k: 42}` in closure → wasm `Unresolved identifier: k` (PR #121); `F40` `outer: inner: for ... { break outer }` → wasm runs all iterations (PR #122); `F43` `var t T; var s string` → wasm `{<nil>} false false`, want `{} true true` (feat/follow-ups-2026-11-03-phase-16); `F46` `print("a", "b", 1)` → wasm `""`, want `ab1` (feat/follow-ups-2026-11-03-phase-17); `F47` `println(MyBool(true))` → wasm `1`, want `true` (PR #124); `F39` `fmt.Println("n", *p)` → wasm `n |`, want `|` (PR #122); `F48` `o.Public()` on facade → `o.Public is not a function`, want `7` (PR #125) |
| `fmt`, `json`, templ & stdlib | `fmt` `%T` of generic instances in `any`/`Box[T]`, nil map `%p`, `%+5v` slice width, `%s` of nil `*T`, `%#v` empty map field & `GoStringer` receiver mismatch, `any` var static types, nil Stringer in `any` on WASM, multi-value `fmt.Append*`/`Printf`; `json` nil unsupported map in `any`, cross-package nil pointer `Unmarshal` error package name, cross-package `any` `Marshal`; templ `case 1, 2:` and inline struct in `for` header; `unicode.IsPrint` non-ASCII spaces, `os.Stderr` fd under Node, `regexp` no-match slice | `F09` → js/both `main.Box main.Box[interface {}]`, want `main.Box[int] main.Box[float64]`; `F23` → js/both `0x1`, want `0x0`; `F24` → all `  [1]`, want `[    1]`; `F25` → all `<nil>`, want `%!s(*main.T=<nil>)`; `F26` → `0.10000000149011612 int64/int <nil>`, want `0.1 uint64 *main.Color`; `F27` → wasm `<nil> [<nil>]`, want `c [c]`; `F28` → js/both `TypeError`, want `hi world hi 42`; `F29` → wasm `T=int`, want `T=main.Color`; `F30` → all `main.M{M:map[interface {}]interface {}{}}`, want `main.M{M:map[string]int{}}`; `F65` → js/both `ptr.P`, want `main.P{}`; `F66` → wasm `&main.T{}`, want `val.T`; `F51` → both `<nil>`, want `json: unsupported type: map[float64]int`; `F52` → all `json: Unmarshal(non-pointer <nil>)`, want `json: Unmarshal(nil *sub.OtherItem)`; `F53` → all `json: unsupported type: unsupported dynamic type`, want `"text-hello"`; `F58` → `unexpected ','`; `F59` → `Unexpected token in expression: ''`; `F74` → all `true true`, want `false false`; `F75` → `stdout="err" stderr=""`, want `stderr="err"`; `F76` → `false false`, want `true true` |

### Review follow-ups (2026-11-09)

The 7 entries in `plans/follow-ups.md` (`F77`–`F83` here, logged during `overlays-to-go` Phases 4–7) and the 12 `fmt` repros deferred in the [Scope Rule & Boundary Matrix](#scope-rule--boundary-matrix) were re-probed on `main` @ `68d6a51` with a scratch script that compiles each program via `compileFiles` / `compileDir` with `forceTarget` `js`, `both` and `wasm`, validates the module with `new WebAssembly.Module`, and runs the bundle in a child `node` process (real `process.stdout`, so line buffering is observed). `F81` was re-probed through the CLI (`gofront b.go -o b.js && node b.js`) and `F83` through `gofront test . -bench . -v`. Expected outputs are Go 1.26 semantics from the ledger (no Go toolchain on the probe host).

**No longer reproducing on `68d6a51` (9 deferred `fmt` repros):** `F24` `%+5v` of `[]int{1}` → `[    1]`; `F25` `%s` of `(*T)(nil)` → `%!s(*main.T=<nil>)`; `F27` nil `*C` Stringer in `any` → `c [c]` on wasm; `F28` `fmt.Append(fb())` / `fmt.Appendf(fb3())` → `hi world hi 42`; `F29` `fmt.Printf(f())` → `T=main.Color` on wasm; `F30` `%#v` of `M{map[string]int{}}` → `main.M{M:map[string]int{}}`; `F39` `fmt.Println("n", *p)` → `|` only on wasm; `F65` `%#v` of `P{}` with `(*P) GoString` → `main.P{}`; `F66` `%#v` of `&T{}` with `(T) GoString` → `val.T`. All on `js`, `both` and `wasm`, fixed by Go-source `stdlib/fmt/` (`overlays-to-go` Phases 4–6).

**Already scheduled (2 entries, deleted from `plans/follow-ups.md`):**
- `F80`: `fmt.Print("hello")` in a wasm package → wasm `""`, js/both `hello`, want `hello` (PR #144). `os_write` appends to the same `lineBuf` in `WASM_IMPORTS_JS` (`src/backend/wasm/boundary.js:1920-1924`) that `F46` `print` leaves unflushed; only `os_exit` flushes it. Added as a second repro to Task 6.4.
- `F81`: `type P struct{X, Y int}; fmt.Println(P{1, 2})` in `b.go`, `gofront b.go -o b.js && node b.js` → `<nil>`, directory build `{1 2}` (feat/overlays-to-go-phase-5). Covered by [`runtime-pruning-plan.md`](runtime-pruning-plan.md) Task 2.3 (`compileSingleFile` delegates to `compileFiles`; its test runs `fmt.Sprintf("%v", P{1})` in a single-file build).

| Area | Finding | Evidence & probe |
|---|---|---|
| Typechecker interface → struct | A value of static type `any` is accepted where a struct is expected; JS runs it, WASM emits an invalid module | `F77` `type A struct{N int}; func f(a A) int { return a.N }; var x any = A{3}; println(f(x))` → js/both `3`, wasm validate `local.tee[0] expected type (ref null 0), found local.tee of type anyref`; `var a A = x` → js `{3}`; want `cannot use x (variable of interface type any) as A value in argument to f: need type assertion` (feat/overlays-to-go-phase-4) |
| JS `range` over nil map | `for range` over any map holding an explicit `nil` throws on JS: the range emits `Object.keys(m)` / `Object.entries(m)` (`_genRangeIterExpr`, `src/backend/js/statements.js:1746-1750`) with no null guard; the zero value of a struct field is unaffected | `F78` `type S struct{a int; m map[string]int}; s := S{1, nil}; for range s.m {}` → js/both `TypeError: Cannot convert undefined or null to object`, wasm no iteration; same for `S{m: nil}`, `var s S; s.m = nil`, `var mm map[string]int = nil; for k := range mm` and `for k, v := range` (`var s S; for range s.m` works); want no iteration (feat/overlays-to-go-phase-4) |
| WASM `complex64` constants | `var c complex64 = <untyped complex constant>` builds a `$complex128` struct into a `$complex64` local; `complex64(complex(1, 2))` and `complex(r, i)` with `float32` operands work | `F79` `var a complex64 = 1 + 2i` or `var b complex64 = complex(1.5, 2.5)` then `fmt.Println(a)` → wasm validate `local.tee[0] expected type (ref null 166), found struct.new of type (ref 272)`, js/both `(1.5+2.5i)`; want `(1+2i)` / `(1.5+2.5i)` (PR #144) |
| `fmt` generic values in `any` | A generic struct instantiated only inside a generic body and returned as `any` is missing from the `gff_<pkg>_value` lookup (`src/lower/fmt-formatters.js`), so `%v` prints `<nil>` and `%T` prints nothing; it works once `Box[float64]` appears as a static type elsewhere in the package | `F09` (narrowed) `type Box[T any] struct{ V T }; func wrap[T any](v T) any { return Box[T]{v} }; fmt.Println(wrap(1.5)); fmt.Printf("%T\|\n", wrap(2))` → all `<nil>` / `\|`, want `{1.5}` / `main.Box[int]\|` (original `F09` `%T` of `any(Box[int]{})` → `main.Box[int]` now passes) |
| `fmt` `%p` of maps and slices | `fmtPointer` (`stdlib/fmt/print.go:466-503`) accepts only `KChan`/`KFunc`/`KPtr`/`KUnsafePtr`; Go also accepts `reflect.Map` and `reflect.Slice`, and `docs/go-compatibility.md` documents `%p` ids for maps and slices | `F23` (narrowed) `fmt.Sprintf("%p", map[string]int(nil))` → all `%!p(map[string]int=map[])`, want `0x0`; `var s []int; fmt.Sprintf("%p", s)` → `%!p([]int=[])`, want `0x0`; non-nil map/slice → `%!p(...)`, want a `0x…` id |
| `fmt` describing `errors.New` values | When no method applies (`%w` outside `Errorf`, `%d`), an `errors.New` value is described with an empty type and no contents: `badVerb` writes `a.T` (`""`) and `printDesc` falls through to `<nil>` / `(unknown)` (`stdlib/fmt/print.go:304-318`, `:674-691`); a user error type `E{}` prints `%!w(main.E={})` correctly | `F82` `fmt.Sprintf("%w", errors.New("e1"))` → all `%!w(=<nil>)`, want `%!w(*errors.errorString=&{e1})`; `fmt.Sprintf("%d", errors.New("e1"))` → all `%!d(unknown)`, want `%!d(*errors.errorString=&{e1})` (PR #145) |
| `testing` sub-benchmarks | `(*B).Run` (`stdlib/testing/benchmark.go:117-133`) runs `f` once with `b.N == 1` and prints no row, and the parent benchmark prints its own row | `F83` `func BenchmarkX(b *testing.B) { b.Run("sub", func(b *testing.B) { for i := 0; i < b.N; i++ {}; if b.N > 1 { println("grew") } }) }` with `gofront test . -bench . -v` → `=== RUN BenchmarkX/sub` ×5, no `grew`, row `BenchmarkX 1000000000 0 ns/op`; want `b.N` growth to the target duration, a `BenchmarkX/sub` result row and no `BenchmarkX` row (PR #147) |

### Review audit (2026-11-09)

Plan review re-probe on `main` @ `0e9b0ab` (scratch `.probes/` scripts, deleted: `compileFiles` with `forceTarget` `js`/`both`/`wasm` + `new WebAssembly.Module` + child `node` run for single-package repros; `compileHybridProject` for `F08`, `F10`, `F44`, `F68`, `F52`, `F53`, `F48`; `compileDir` + `runInDom` for `F57`–`F59` templ). Every repro scheduled in Phases 1–9 still reproduces with the recorded output, except:

| Area | Finding | Evidence & probe |
|---|---|---|
| Deferred `F54` | Fixed upstream | `var a any = []bool{true}; fmt.Println(a)` → `[true]` on `js`, `both`, `wasm`; dropped from `Excluded: deferred`. `F55` still → wasm `true` |
| `F52` | Reproduces in a changed form | `var v any = sub.NewNil(); json.Unmarshal([]byte("{}"), v)` → all `json: Unmarshal(nil *main.OtherItem)` (was `non-pointer <nil>`); want `nil *sub.OtherItem`, so Task 7.1 is unchanged |
| Parser func types (`F50` root cause) | `parseReturnType(inTypeExpr = true)` (`src/parser/declarations.js:221-236`) only ends a result-less func type at `{ } ; EOF , ) :`, so a following tag string **or `=`** is parsed as a result type; `parseStructType` is not involved | `var f func() = func() {}` / `var g func(int) = nil` / `var f func(func(int) bool) = nil` → all `Parse error ... Expected type, got '='`; `var f func(func(int) bool)` (no init) parses. Added to Task 1.1 |
| Array length `F71` root cause | `_foldArrayLen` (`src/typechecker/resolve.js:338-350`) resolves only bare `Ident` constants via `scope.lookupConstExpr`; a `SelectorExpr` stays an AST node (JS prints `[object Object]`, WASM size `0`) and the import is never marked used | `var a [math.MaxInt8]int; fmt.Println(len(a))` with no other `math` use → all `'math' imported and not used`; with `math.Pi` also used → js/both `SyntaxError: Unexpected identifier 'Object'`, wasm `0`. Added to Task 2.4 |
| `F77` fix site | No `assignableTo` exists; `assertAssignable` returns early through `_assertAssignableEarlyReturn` (`src/typechecker/assignability.js:429-435`) whenever `isAny(source)` | Task 8.1 names the real symbol |

---

## Approach

### 1. Architecture & Design Decisions
- **Phase isolation by compiler stage and subsystem:** Each phase is scoped to 4–5 tasks across closely related modules so each PR stays focused (~150–500 net LOC):
  - **Phase 1 (Parser & Typechecker rules):** `src/parser/types.js`, `src/typechecker/{statements,assignability,expressions}.js`.
  - **Phase 2 (Package types, aliases, and function-local types):** Scope function-local `TypeDecl` bindings per function in `src/typechecker/statements.js` with a unique internal symbol (e.g. `Name$localN` for codegen/monomorph/JSON codecs while preserving `Name` for user-visible diagnostics and `%T`), and resolve `pkg.T{...}` composite literal types from the imported package namespace rather than the current package's same-named type (`checkCompositeLit` in `src/typechecker/expressions.js` → `SelectorExpr` case of type resolution in `src/typechecker/resolve.js`).
  - **Phase 3 (JS statements, loops, pointers, numerics, and slice copies):** Propagate all stacked loop labels onto the inner `for` when an init statement is hoisted into a block; emit UTF-16 offset advancement (`i += r > 0xffff ? 2 : 1`, matching WASM and `s[i:]`) in JS `for i, r := range s`; wrap negative `uint` subtraction results modulo 2⁶⁴ in `both` packages; fold/coerce function-local untyped constants to `BigInt` when paired with `uint64`/`int64`; and clone struct elements on JS slice `append`/`copy`/slicing.
  - **Phase 4 (JS nil receivers, panic/recover, and map keys):** Wrap JS method values/expressions on pointer receivers without eager dereferencing at binding time; tag runtime errors distinctly from user `panic("runtime error: ...")` strings and preserve defined string types implementing `error` across `panic`/`recover`; check for unhashable slice/map/func values inside `any` keys in `__ik` (`src/backend/js/runtime.js`); and evaluate `f()` in `len(f())` when `f()` returns a pointer to an array if `f()` contains a call, while returning the constant array length without dereferencing `nil` on WASM.
  - **Phase 5 (JS/WASM dynamic types and interface assertions):** Preserve dynamic type tags when assigning nil pointers/slices/funcs or type-parameter values into `any` variables (`var a any = ...`) so assertions and `any == any` match Go (`== nil` stays as documented for JS); exclude promoted pointer-receiver methods from value-type interface tables on JS; distinguish `iter.Seq[T]` from plain `func(func(T) bool)` and defined slice/array/map types from unnamed ones in WASM type assertions where static/box info is available; and format failed type assertion panics with `interface conversion: <iface> is <concrete>, not <target>`.
  - **Phase 6 (WASM control flow, captures, strings, builtins, and facade):** Emit a recoverable nil check before unwrapping an embedded struct pointer for a promoted value-receiver method call and when binding a method value on a nil interface; clone `[N]T` array keys on WASM map insert and `for k := range`; box comma-ok scalar results assigned to `any` lvalues; walk map literal keys in `src/lower/captures.js`; bind all stacked labels on a loop in `emit-stmts.js`; initialize WASM package-level strings, struct string fields, and `[N]string` arrays to `""` (`string.const ""`) instead of `ref.null extern`; flush buffered WASM stdout at program exit; unwrap named boolean types in `println`; and include exported methods promoted from unexported embedded structs on WASM facade classes.
  - **Phase 7 (`encoding/json`, templ, and stdlib):** Fix `encoding/json` cross-package dynamic types and nil unsupported containers in `any`, templ multi-expression `case a, b:` (`parseTemplSwitch` → `_checkTemplSwitch` → `_genTemplSwitch`) and brace-depth tracking in templ `for` headers, `unicode.IsPrint` non-ASCII whitespace exclusion, `os_write` `fd == 2` routing to `process.stderr.write`, and `stdlib/regexp` returning `nil` slices on no match. The `fmt` engine repros are deferred until `overlays-to-go` Phase 6 (see `Excluded: deferred`).
  - **Phase 8 (2026-11-09: typechecker, JS `range`, WASM `complex64`):** Reject non-interface targets for interface-typed operands in assignability (`src/typechecker/assignability.js`) with Go's `need type assertion` message; guard JS map range iteration (`_genRangeIterExpr` in `src/backend/js/statements.js`) against `null`; convert untyped complex constants to the declared `complex64` target in WASM variable initialisers.
  - **Phase 9 (2026-11-09: Go-source `fmt` and `testing`):** Accept `KMap`/`KSlice` in `fmtPointer` (`stdlib/fmt/print.go`); enumerate generic instantiations reached through generic bodies, and the `*errors.errorString` behind `errors.New`, as `fmt` lookup types (`src/lower/fmt-formatters.js`, or `collectProgramTypes` in `src/lower/gen-types.js` if [`runtime-pruning-plan.md`](runtime-pruning-plan.md) Task 2.3 has landed); run `b.Run` sub-benchmarks through `grow` and `reportBenchmark` like top-level benchmarks, and skip `grow`/`reportBenchmark` for a parent that called `b.Run` (today the parent is grown, rerunning every sub-benchmark at `N == 1`) (`stdlib/testing/benchmark.go`).

### 2. Invariants & Safety Bounds
- **Dual-target parity:** Every fix for a shared language/stdlib feature is verified on `js`, `both`, and `wasm`; every WASM module passes `assertValidWasm`.
- **Zero performance regression on hot paths:** Nil-check and slice-copy fixes must not regress `test/perf/zero-alloc.js`, `test/perf/bce-mathx.js`, or `test/perf/json-bench.js`.
- **Sentrux & Biome gates:** Every commit must pass `npm run check` and `npm test`.

### 3. Edge Cases & Error Handling
- **Function-local types (`F49`, `F72`):** Two functions in the same package declaring `type Config struct{...}` must each resolve their own struct layout in the typechecker, JS class emission, WASM struct registration, and `src/lower/json-codecs.js`, while `fmt.Sprintf("%T", Config{})` still prints `main.Config`.
- **`len(getNil())` (`F45`):** Per the Go spec, `len(x)` on `*[N]T` is a constant only if `x` does not contain function calls or channel receives; when `x` contains a function call (`len(getNil())`), `getNil()` is evaluated for its side effects and its `nil` return value does not panic, then `len` yields `N`.
- **`os.Stderr` under Node (`F75`):** `os_write(fd, s)` in `src/backend/js/index.js` and `src/backend/wasm/boundary.js` routes `fd === 2` to `process.stderr.write` when `process.stderr` exists (falling back to buffered `console.error` in browsers).
- **Unhashable `any` keys on JS (`F22`):** `__ik(k, tag)` only throws for a static `!`-prefixed tag. When the static key type is `any`, slices must panic but `[N]T` arrays (also plain JS arrays) and structs of comparable fields must stay hashable, so the dynamic check needs the value's type tag, not `Array.isArray`.
- **Type assertion panic text (`F33`):** Go's forms are `interface conversion: interface {} is string, not int` (concrete target), `interface conversion: interface {} is nil, not int` (nil operand), and `interface conversion: string is not main.I: missing method M` (interface target). WASM must produce the dynamic type name at runtime from the box's type id instead of the static string in `emit-exprs.js` `emitPanic`.
- **`uint` underflow in `both` packages (`F69`):** `uint` is a JS `number` (exact to 2⁵³, documented), so wrapping uses `r < 0 ? r + 2 ** 64 : r`; comparisons and sign match Go, while digits above 2⁵³ stay the documented `int`/`uint` precision limit. Plain `js` packages keep float64 semantics.
- **String `range` offsets (`F56`):** JS must advance `i` by 2 for astral runes so `s[i:]` and `len(s)` stay in the same UTF-16 units as WASM; BMP-only strings keep their current offsets.

---

## Implementation Tasks

### Phase 1: Parser & Typechecker Statements and Operators

*Phases 1–7 were scheduled from review follow-ups on 2026-11-07 (see Verified Gaps → Review follow-ups).*

- [x] Task 1.1: Parser: struct field tags after `func`-typed fields
  - Files: `src/parser/declarations.js`, `test/unit/compiler/lexer-parser.test.js`
  - Test: `F50` `var _ = struct{ F func() \`json:"f"\` }{}` compiles and runs on `js`, `both`, and `wasm`; same root cause: `var f func() = func() { fmt.Println("a") }; f()` → `"a"` and `var g func(int) = nil; fmt.Println(g == nil)` → `"true"` in `test/unit/compiler/lexer-parser.test.js`.
  - Done when: `parseReturnType(inTypeExpr = true)` in `src/parser/declarations.js` also ends a result-less func type at a `STRING` tag and at `=`, so struct tags after `func`-typed fields and `var f func(...) = ...` parse, and `test/unit/compiler/lexer-parser.test.js` passes.
- [x] Task 1.2: Typechecker: `switch` on untyped constant tag and tagless `switch` non-bool cases
  - Files: `src/typechecker/statements.js`, `test/unit/types/checks.test.js`, `test/unit/compiler/templ.test.js`
  - Test: `F05` `switch "foo" { case 5: }` → `assertErrorContains(errors, "cannot convert 5 (untyped int constant) to type string")`; `F57` `switch { case 5: }` (in `.go` and `.templ`) → `assertErrorContains(errors, "invalid case 5 in switch")`.
  - Done when: `_checkSwitchStmt` / `_checkCaseValue` in `src/typechecker/statements.js` validate case expressions against untyped constant tags and require `bool` cases when `tag == null` (today `_checkCaseValue` returns early on `!tag`; templ reaches it through `_checkTemplSwitch`), and both tests pass.
- [x] Task 1.3: Typechecker: reject fractional untyped float to `int` and `byte != int(q)` comparisons
  - Files: `src/typechecker/assignability.js`, `src/typechecker/expressions.js`, `test/unit/types/checks.test.js`
  - Test: `F06` `var i int = 1.5` → `assertErrorContains(errors, "cannot use 1.5 (untyped float constant) as int value in variable declaration (truncated)")`; `F63` `s := "abc"; q := byte(97); _ = s[0] != int(q)` → `assertErrorContains(errors, "mismatched types")`.
  - Done when: untyped float constants with non-zero fractional parts are rejected for integer types and distinct typed integer kinds (`uint8` vs `int`) are rejected in binary comparisons; `npm run check` and `test/unit/types/checks.test.js` pass.
- [x] Task 1.4: Typechecker: reject `cap` on strings and comma-ok `:=` with no new variables
  - Files: `src/typechecker/expressions.js`, `src/typechecker/statements.js`, `test/unit/types/checks.test.js`
  - Test: `F62` `_ = cap("hello")` → `assertErrorContains(errors, "invalid argument")`; `F12` `var a any = 1; var x int; var ok bool; x, ok := a.(int)` → `assertErrorContains(errors, "no new variables on left side of :=")`.
  - Done when: `cap` rejects string arguments and comma-ok short variable declarations enforce at least one newly declared variable on the LHS.
- [x] Task 1.5: Typechecker: check key assignability in comma-ok map lookups
  - Files: `src/typechecker/statements.js`, `test/unit/types/checks.test.js`
  - Test: `F61` `m := map[int64]string{1 << 60: "hello"}; v, ok := m[1<<60]; fmt.Println(v, ok)` → `"hello true"` on `js`, `both`, and `wasm` (and `v, ok = m[1<<60]` assignment form).
  - Done when: comma-ok map index statements type-check and tag the key expression with the map's key type so 64-bit constant keys emit as `BigInt` on JS.

### Phase 2: Package Types, Aliases, and Function-Local Types

- [x] Task 2.1: Package-qualified struct literal resolution when `main` defines a same-named type
  - Files: `src/typechecker/expressions.js`, `src/typechecker/resolve.js`, `test/unit/compiler/packages.test.js`
  - Test: `F08` `package a; type Pt struct{ X int }` and `package main; type Pt struct{ Z bool }; func main() { fmt.Println(Pt{true}, a.Pt{1}) }` → `"{true} {1}"` on `js`, `both`, and `wasm`.
  - Done when: composite literals with a `SelectorExpr` type (`a.Pt{1}`) resolve the struct definition from package `a`'s namespace instead of the unqualified `Pt` in `main`.
- [x] Task 2.2: Cross-package struct type alias literals in JS
  - Files: `src/backend/js/expressions.js`, `src/typechecker/expressions.js`, `test/unit/compiler/packages.test.js`
  - Test: `F10` `package p; type Base struct{ V int }; type A = Base` and `main` evaluating `fmt.Println(p.A{42})` → `"{42}"` on `js`, `both`, and `wasm`.
  - Done when: JS composite literal codegen unwraps cross-package type aliases to the target struct's emitted class name.
- [x] Task 2.3: Function-local types with identical names across functions
  - Files: `src/typechecker/statements.js`, `src/backend/js/index.js`, `src/backend/wasm/types.js`
  - Test: `F49` two functions `a()` and `b()` declaring incompatible `type Dup struct{...}` → `"{1}\n{y}"` on `both` and `wasm` in `test/unit/types/shadowing.test.js`.
  - Done when: function-local `TypeDecl` nodes register distinct scoped type identities so later functions do not overwrite earlier local types in the checker, JS class emitter, or WASM struct table, while `%T` still prints `main.Dup`.
- [x] Task 2.4: JS array length from package constant selector and cross-package struct value parameter cloning
  - Files: `src/typechecker/resolve.js`, `src/backend/js/expressions.js`, `src/backend/js/statements.js`
  - Test: `F71` `var a [math.MaxInt8]int; fmt.Println(len(a), math.Pi > 3)` → `"127 true"` and, with no other `math` use, `fmt.Println(len(a))` → `"127"` (no `'math' imported and not used`) on `js`, `both`, and `wasm` in `test/unit/compiler/packages.test.js`; `F68` `func f(s pkg.S) { s.Inc() }; s := pkg.S{X: 1}; f(s); fmt.Println(s.X)` → `"1"` on all targets.
  - Done when: `_foldArrayLen` in `src/typechecker/resolve.js` folds `SelectorExpr` package constants (marking the import used) so both backends see a literal length, and JS function prologues clone imported-package struct value parameters when mutated or passed to pointer-receiver methods.
- [x] Task 2.5: JSON codecs for same-named function-local types
  - Files: `src/lower/json-codecs.js`, `test/unit/builtins/json.test.js`
  - Test: `F72` `f1()` declaring `type Config struct{A int \`json:"a"\`}` and `f2()` declaring `type Config struct{B string}`, each calling `json.Marshal(Config{...})` → `'{"a":1}'` from `f1()` on `both` and `wasm`.
  - Done when: `json-codecs.js` keys generated encoders/decoders by the scoped local type identity from Task 2.3, so each function-local `Config` uses its own field layout and tags.

### Phase 3: JS Statements, Loops, Pointers, and Numerics

- [x] Task 3.1: JS pointer conversion method dispatch and comma-ok define boxing
  - Files: `src/backend/js/expressions.js`, `src/backend/js/statements.js`, `test/unit/language/pointers.test.js`
  - Test: `F03` `type Base struct{n int}; type S Base; func (s *S) Inc() { s.n++ }; b := Base{1}; (*S)(&b).Inc(); fmt.Println(b.n)` → `"2"` on `js`; `F04` `m := map[string]int{"k": 3}; x, y := m["k"]; p := &x; *p = 9; fmt.Println(x, y)` → `"9 true"` on `js`, `both`, and `wasm`.
  - Done when: method calls on converted struct pointers dispatch to the target type's prototype method on JS, and address-taken variables bound by comma-ok map lookups (and type assertions) are boxed as `{ value: ... }` on JS.
- [x] Task 3.2: JS stacked labels on `for` with hoisted init and `for _, v = range m` blank-key assignment
  - Files: `src/backend/js/statements.js`, `test/unit/language/control-flow.test.js`
  - Test: `F11` `n := 1; outer: inner: for n := n + 1; n < 3; n++ { continue outer }` → `"done"` on `js`, `both`, and `wasm`; `F42` `m := map[string]int{"a": 1}; var v int; for _, v = range m {}; fmt.Println(v)` → `"1"` on all targets.
  - Done when: hoisting a `for` init statement into an enclosing JS block keeps all loop labels attached to the loop statement for `continue`, and `for _, v = range m` with an existing value variable declares the temporary key binding properly.
- [x] Task 3.3: JS `for i, r := range s` UTF-16 offsets on astral runes (match WASM)
  - Files: `src/backend/js/statements.js`, `docs/go-compatibility.md`, `test/unit/language/control-flow.test.js`
  - Test: `F56` `s := "éa😀b"; for i, r := range s { fmt.Println(i, r, s[i:]) }` → `"0 233 éa😀b\n1 97 a😀b\n2 128512 😀b\n4 98 b"` on `js`, `both`, and `wasm` (`assertAllTargetsOutput`).
  - Done when: JS string range loops advance the index by the UTF-16 length of each decoded code point (2 for astral runes) so JS matches WASM and `s[i:]`, and the `for i := range` row in `docs/go-compatibility.md` **String semantics** describes UTF-16 code-unit offsets instead of rune counts.
- [x] Task 3.4: JS `uint` subtraction underflow wrapping and function-local untyped constants with `uint64`
  - Files: `src/backend/js/expressions.js`, `src/typechecker/const-fold.js`, `test/unit/builtins/operators.test.js`
  - Test: `F69` `var n uint = 3; fmt.Println(n-64 > 100)` → `"true"` on `both` and `wasm`; `F70` `var b uint64 = 1; var e uint = 3; const half = 1 << 51; b += half >> e; fmt.Println(b)` → `"281474976710657"` on `both` and `wasm`.
  - Done when: `uint` subtraction in `both` packages wraps negative results modulo 2⁶⁴ (`r < 0 ? r + 2 ** 64 : r`; plain `js` packages keep documented float64 semantics), and function-local untyped integer constants used in 64-bit (`int64`/`uint64`) shift/binary expressions emit as `BigInt`.
- [x] Task 3.5: JS slice copy/append/reslice struct element cloning and cross-package element pointer aliasing
  - Files: `src/backend/js/expressions.js`, `src/lower/ownership.js`, `test/unit/language/value-semantics.test.js`
  - Test: `F41` `a := []P{{1, 1}}; b := append([]P(nil), a...); b[0].N = 50; fmt.Println(a)` (plus `copy`) → `"[{1 1}]"` on `js`, `both`, and `wasm`; `F44` `package p; func First(xs []S) *S { return &xs[0] }` + `main` `q := p.First(ys); ys[0] = p.S{9}; fmt.Println(q.A)` → `"9"` on all targets.
  - Done when: copying/appending slices of value structs clones the struct elements into the new backing array while in-place element writes (`ys[0] = ...`) mutate fields in place so pointers returned from other packages stay live.

### Phase 4: JS Nil Receivers, Panic/Recover, and Map Keys

- [x] Task 4.1: JS method values and method expressions on nil pointers and nil generic pointers
  - Files: `src/backend/js/expressions.js`, `test/unit/language/pointers.test.js`
  - Test: `F13` `var b *Box[int]; g := (*Box[int]).M; fmt.Println(g(b))` → `"0"` on `js`, `both`, and `wasm`; `F14` `var s *S; f := s.Ping; f()` → `"ping"` on all targets.
  - Done when: JS method expressions `(*T).M` and method values `s.M` on pointer receivers do not read `.M` off a `null` receiver reference.
- [x] Task 4.2: JS user `panic("runtime error: ...")` vs runtime error and panic/recover of defined string `error` types
  - Files: `src/backend/js/statements.js`, `src/backend/js/runtime.js`, `src/backend/wasm/emit-stmts.js`
  - Test: `F36` `defer func() { r := recover(); _, ok := r.(error); fmt.Println(ok) }(); panic("runtime error: foo")` → `"false"` on `js`, `both`, and `wasm`; `F64` `type rt string; func (rt) Error() string { return "boom" }; defer func() { r := recover(); fmt.Println(r); _, ok := r.(rt); fmt.Println(ok) }(); panic(rt("q"))` → `"boom\ntrue"` on all targets in `test/unit/wasm/defer_recover.test.js`.
  - Done when: user string panics never masquerade as runtime `error` values on JS, and panicking with a defined string type preserves its dynamic type and `Error()` method across `recover()` on JS and WASM.
- [x] Task 4.3: JS unhashable slice in `any` map key panic
  - Files: `src/backend/js/runtime.js`, `src/backend/js/expressions.js`, `test/unit/wasm/maps.test.js`
  - Test: `F22` `defer func() { fmt.Println(recover()) }(); var x any = []int{1}; m := map[any]int{}; m[x] = 1` → `"runtime error: hash of unhashable type []int"` on `both` and `wasm`, plus `var y any = [1]int{1}; m[y] = 1` still succeeding.
  - Done when: `__ik` in `src/backend/js/runtime.js` (fed the dynamic type tag of `any` keys by the map-index codegen in `src/backend/js/expressions.js`) throws a recoverable runtime error matching Go's message for slices, maps, and functions (and structs/arrays containing them) while arrays and comparable structs stay hashable.
- [x] Task 4.4: `len(f())` side-effect evaluation when `f()` returns a nil array pointer on JS and WASM
  - Files: `src/backend/js/expressions.js`, `src/backend/wasm/emit-builtins.js`, `test/unit/language/pointers.test.js`
  - Test: `F45` `func getNil() *[3]int { fmt.Println("getNil"); return nil }; fmt.Println(len(getNil()))` (plus `cap(getNil())`) → `"getNil\n3"` on `js`, `both`, and `wasm`.
  - Done when: `len`/`cap` on `*[N]T` evaluates the operand for side effects when it contains a function call and returns `N` without dereferencing the pointer on both backends.

### Phase 5: Dynamic Types, Type Switches, and Interface Assertions (JS & WASM)

- [x] Task 5.1: JS typed nil non-struct pointers and nil slices/funcs in `any`
  - Files: `src/backend/js/expressions.js`, `src/backend/js/runtime.js`, `test/unit/wasm/interfaces.test.js`
  - Test: `F15` `var p1, p2 *int; var a1, a2 any = p1, p2; fmt.Println(a1 == a2)` → `"true"`; `F16` `var s []int; var a any = s; _, ok := a.([]int); fmt.Println(ok)` → `"true"` on `both` and `wasm` (`a == nil` is not asserted: documented JS `nil` row).
  - Done when: nil non-struct pointers and nil slices/funcs stored in `any` keep their dynamic type on JS so `any == any` and `.([]T)` match Go, without changing the documented JS `== nil` result.
- [x] Task 5.2: JS boxing and type switches inside generic functions and pointer-receiver methods on type parameters
  - Files: `src/backend/js/expressions.js`, `src/backend/js/type-info.js`, `test/unit/types/generics.test.js`
  - Test: `F17` `F(p)` (`var p *int`) and `Kind[Name](Name("a"))` → `"false T"`; `F18` `c := Counter(5); Step(&c); fmt.Println(c)` → `"6"` on `js`, `both`, and `wasm`.
  - Done when: `any(v)` inside generic functions uses the runtime type-parameter factory to box nil pointers/named strings and dispatch pointer-receiver constraint methods without re-boxing a pointer into a scalar box.
- [x] Task 5.3: JS interface assertions: promoted pointer-receiver methods on value structs and `case fmt.Stringer`
  - Files: `src/backend/js/expressions.js`, `src/backend/js/index.js`, `test/unit/wasm/interfaces.test.js`
  - Test: `F19` `var v any = Outer{}; _, ok := v.(Mer); fmt.Println(ok)` → `"false"`; `F31` `switch v.(type) { case error: return "d"; case fmt.Stringer: return "s" }` on `3` → `"other"` on `js`, `both`, and `wasm`.
  - Done when: value structs embedding a struct `Inner` by value do not claim `*Inner`'s pointer-receiver methods in interface assertions, and `case fmt.Stringer:` on JS checks Go `String() string` implementation rather than `Object.prototype.toString`.
- [x] Task 5.4: Named func type (`iter.Seq[int]`) and defined slice/map/array identity in `any` type assertions and switches
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/emit-stmts.js`, `test/unit/wasm/interfaces.test.js`
  - Test: `F32` `var b any = seq; _, ok := b.(iter.Seq[int]); fmt.Println(ok)` → `"false"` on `js`, `both`, and `wasm`; `F34` `type S []int; switch any([]int{1}).(type) { case S: return "S"; case []int: return "slice" }` → `"slice"` on all targets.
  - Done when: WASM boxes/tags defined func types (`iter.Seq[T]`) and defined slice types (`type S []int`) distinctly from unnamed `func(func(T) bool)` and `[]int` when converted to `any`.
- [x] Task 5.5: Failed type assertion panic message with concrete and target type names
  - Files: `src/backend/js/expressions.js`, `src/backend/wasm/emit-exprs.js`, `test/unit/wasm/interfaces.test.js`
  - Test: `F33` `defer func() { fmt.Println(recover().(error).Error()) }(); var i any = "s"; _ = i.(int)` → `"interface conversion: interface {} is string, not int"` on `both` and `wasm`, plus the nil-operand form (`interface {} is nil, not int`); update the existing `includes("type assertion failed")` assertions in `test/unit/wasm/interfaces.test.js` and `test/unit/wasm/strings_any.test.js`.
  - Done when: non-comma-ok type assertions (JS throw in `src/backend/js/expressions.js`, WASM `emitPanic` in `src/backend/wasm/emit-exprs.js`) include the interface name, dynamic concrete type name, and target type name in the panic message on both backends.

### Phase 6: WASM Control Flow, Captures, Strings, Builtins, and Facade

- [x] Task 6.1: WASM recoverable nil-dereference panic on embedded pointer value-method call and nil interface method value binding
  - Files: `src/backend/wasm/emit-exprs.js`, `test/unit/wasm/traps.test.js`
  - Test: `F07` `P{}.Val()` (`type P struct{ *Base }`) recovered → `"recovered"`; `F35` `var n N; _ = n.Name` recovered → `"runtime error: invalid memory address or nil pointer dereference"` on `js`, `both`, and `wasm`.
  - Done when: unwrapping an embedded struct pointer for a promoted value-receiver method call and evaluating a method value on an interface emit a recoverable nil check on WASM.
- [x] Task 6.2: WASM array map key copying on insert and range, comma-ok into `any`, and map-key closure capture
  - Files: `src/backend/wasm/emit-maps.js`, `src/backend/wasm/emit-stmts.js`, `src/lower/captures.js`
  - Test: `F21` `ar[key] = 5; key[0] = 9; for k := range ar { k[0]++ }` → `"5 1 5"`; `F37` `var x any; var ok bool; x, ok = mi["k"]` → `"5 true"`; `F38` `k := "hello"; f := func() { m := map[string]int{k: 42}; fmt.Println(len(m)) }; f()` → `"1"` on `js`, `both`, and `wasm` in `test/unit/wasm/maps.test.js`.
  - Done when: WASM clones `[N]T` array keys on map insertion and `range` iteration, boxes scalar values in comma-ok assignments to `any` targets, and `src/lower/captures.js` visits map literal keys.
- [x] Task 6.3: WASM stacked loop labels and package-level/struct/array string zero values
  - Files: `src/backend/wasm/emit-stmts.js`, `src/backend/wasm/module-emitter.js`, `test/unit/wasm/go_semantics.test.js`
  - Test: `F40` `outer: inner: for i := 0; i < 2; i++ { for j := 0; j < 2; j++ { fmt.Println(i, j); break outer } }` → `"0 0"`; `F43` `type T struct{ S string }; var t T; var s string; fmt.Println(t, s == "", t.S == "")` → `"{} true true"` on `js`, `both`, and `wasm`.
  - Done when: WASM loop emission registers all stacked labels on a loop for `break`/`continue`, and default-initialized package-level `string` globals, struct string fields, and `[N]string` arrays initialize to `""` instead of `ref.null extern`.
- [x] Task 6.4: WASM `print` flush without trailing newline and `println` of defined `bool` types
  - Files: `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/glue.js`, `src/backend/wasm/boundary.js`
  - Test: `F46` `print("a", "b", 1)` → `"ab1"`; `F80` `fmt.Print("hello")` → `"hello"`; `F47` `type MyBool bool; var b MyBool = true; println(b)` → `"true"` on `both` and `wasm` in `test/unit/wasm/stdlib.test.js`.
  - Done when: WASM host glue flushes the partial line buffer (`lineBuf` in `boundary.js`, filled by both `print` and `os_write`) after `main` returns, and `println` unwraps named boolean types.
- [x] Task 6.5: WASM facade promoted methods from unexported embedded structs
  - Files: `src/backend/wasm/boundary.js`, `test/unit/wasm/boundary.test.js`
  - Test: `F48` WASM package `type hidden struct{ v int }; func (h hidden) Public() int { return h.v }; type Outer struct{ hidden }` called via `o.Public()` from JS `main` → `"7"` in `test/unit/wasm/boundary.test.js`.
  - Done when: WASM boundary facade generation exposes exported methods promoted from unexported embedded struct fields on the exported outer struct's JS class.

### Phase 7: `encoding/json`, Templ, and Stdlib (`unicode`, `os`, `regexp`)

- [x] Task 7.1: `encoding/json`: nil unsupported map/slice in `any`, cross-package typed nil `Unmarshal` error package name, and cross-package `any` `Marshal`
  - Files: `src/lower/json-codecs.js`, `stdlib/internal/jsonrt/enc.go`, `stdlib/internal/jsonrt/dec.go`
  - Test: `F51` `var m map[float64]int; var v any = m; _, err := json.Marshal(v)` → `"json: unsupported type: map[float64]int"`; `F52` `var v any = sub.NewNil(); json.Unmarshal([]byte("{}"), v)` → `"json: Unmarshal(nil *sub.OtherItem)"`; `F53` `pkg.Encode(any(TextVal{"hello"}))` where `main` does not import `"encoding/json"` → `'"text-hello"'` on `js`, `both`, and `wasm` in `test/unit/builtins/json.test.js`.
  - Done when: `json-codecs.js` and `jsonrt` report unsupported map/slice types even when nil in `any`, preserve the defining package name for typed nil pointers in `Unmarshal`, and register dynamic types across linked packages when any package in the build uses `encoding/json`.
- [x] Task 7.2: Templ multi-value `case a, b:`
  - Files: `src/parser/templ.js`, `src/typechecker/index.js`, `src/backend/js/templ.js`
  - Test: `F58` `templ V(n int) { switch n { case 1, 2: <p>x</p> } }` with `V(2)` → `"<p>x</p>"` (plus a mismatched `case 1, "a":` → `assertErrorContains(errors, "cannot convert")`) in `test/unit/compiler/templ.test.js`.
  - Done when: `parseTemplSwitch` parses `caseTokens` as an expression list (today `parseExprTokens` parses one expression and fails with `unexpected ','`), `_checkTemplSwitch` runs `_checkCaseValue` on each expression, and `_genTemplSwitch` emits one JS `case` label per expression.
- [x] Task 7.3: Templ inline struct composite literals in `for` headers
  - Files: `src/lexer/templ-lexer.js`, `test/unit/compiler/templ.test.js`
  - Test: `F59` `templ V() { for _, s := range []struct{ A int }{{1}} { <p>{ s.A }</p> } }` → `"<p>1</p>"` in `test/unit/compiler/templ.test.js`.
  - Done when: the templ `for` header scanner tracks nested `{ ... }` braces in types and composite literals before opening the loop body.
- [x] Task 7.4: Go-source `unicode.IsPrint` non-ASCII spaces and `regexp` `nil` slices on no match
  - Files: `stdlib/unicode/unicode.go`, `stdlib/regexp/regexp.go`
  - Test: `F74` `fmt.Println(unicode.IsPrint(0xA0), unicode.IsPrint(0x3000))` → `"false false"` on `both` and `wasm` in `test/unit/stdlib/unicode.test.js`; `F76` `re := regexp.MustCompile("a"); fmt.Println(re.FindStringSubmatch("b") == nil, re.FindAllString("b", -1) == nil)` → `"true true"` in a `js` package (`regexp` is JS-only) in `test/unit/stdlib/regexp.test.js`.
  - Done when: `unicode.IsPrint` returns `false` for non-ASCII spaces (`r >= 0x80 && IsSpace(r)`), and `FindString*`/`FindAll*` methods in `stdlib/regexp/regexp.go` return `nil` (not `[]string{}`) when nothing matches.
- [x] Task 7.5: `os.Stderr` writes to `process.stderr` under Node
  - Files: `src/backend/js/index.js`, `src/backend/wasm/boundary.js`, `test/unit/stdlib/io.test.js`
  - Test: `F75` `os.Stderr.WriteString("err\n")` → stdout `""`, stderr `"err\n"` for a `js` package and a `both`/`wasm` package run under Node.
  - Done when: the `os_write` native in `src/backend/js/index.js` and the WASM `os_write` import in `src/backend/wasm/boundary.js` route `fd === 2` to `process.stderr.write` when available (falling back to buffered `console.error`), and `fd === 1` output is unchanged.

### Phase 8: Typechecker, JS Loops & WASM Complex64

*Phases 8–9 were scheduled from review follow-ups on 2026-11-09 (see Verified Gaps → Review follow-ups (2026-11-09)).*

- [ ] Task 8.1: Typechecker: reject assigning/passing `any` to concrete struct types
  - Files: `src/typechecker/assignability.js`, `test/unit/types/checks.test.js`
  - Test: `F77` `type A struct{N int}; func f(a A) int { return a.N }; var x any = A{3}; _ = f(x)` and `var a A = x` in `test/unit/types/checks.test.js` → `assertErrorContains(errors, "cannot use")` and `assertErrorContains(errors, "need type assertion")`.
  - Done when: `assertAssignable` in `src/typechecker/assignability.js` (today short-circuited by `_assertAssignableEarlyReturn` on `isAny(source)`) rejects assigning an interface-typed operand to a non-interface type without an explicit type assertion, and `npm run check` and `test/unit/types/checks.test.js` pass.
- [ ] Task 8.2: JS `for range` over nil maps (positional and keyed literals, variables)
  - Files: `src/backend/js/statements.js`, `test/unit/language/control-flow.test.js`
  - Test: `F78` `type S struct{a int; m map[string]int}; s := S{1, nil}; for range s.m {}`, `s2 := S{m: nil}; for k := range s2.m {}`, `var mm map[string]int = nil; for k, v := range mm {}` → compiles and executes with zero iterations across `js`, `both`, and `wasm` in `test/unit/language/control-flow.test.js`.
  - Done when: `_genRangeIterExpr` in `src/backend/js/statements.js` guards map iteration against null (`${iteree} ? Object.keys(${iteree}) : []` / `Object.entries`) and `test/unit/language/control-flow.test.js` passes.
- [ ] Task 8.3: WASM `complex64` variable and constant initializers
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/emit.js`, `test/unit/wasm/complex.test.js`
  - Test: `F79` `var c64 complex64 = complex(1.5, 2.5); f(c64)` and `var a complex64 = 1 + 2i` → passes `assertValidWasm` and prints `(1.5+2.5i)` / `(1+2i)` in `test/unit/wasm/complex.test.js`.
  - Done when: WASM expression emitter respects the target `complex64` type when lowering untyped complex constants and `complex(...)` calls, emitting `$complex64` structs instead of `$complex128`.

### Phase 9: Stdlib `fmt` & `testing`

- [ ] Task 9.1: `fmt`: `%p` pointer formatting for maps and slices
  - Files: `stdlib/fmt/print.go`, `docs/go-compatibility.md`, `test/unit/stdlib/fmt.test.js`
  - Test: `F23` `fmt.Sprintf("%p", map[string]int(nil))` → `"0x0"`, `fmt.Sprintf("%p", []int(nil))` → `"0x0"`, and non-nil map/slice printing a `0x...` hex identifier in `test/unit/stdlib/fmt.test.js`.
  - Done when: `fmtPointer` in `stdlib/fmt/print.go` handles `KMap` and `KSlice`, printing `"0x0"` when nil or delegating to `fmtrt.ArgPtrID` / `fmt0x64` when non-nil, matching the documented `%p` behavior; and `docs/go-compatibility.md` documents the `any` sized numeric behavior (`F26`).
- [ ] Task 9.2: `fmt`: register generic struct instantiations inside generic functions in `fmtrt.Lookup`
  - Files: `src/lower/fmt-formatters.js`, `test/unit/wasm/fmt-any.test.js`
  - Test: `F09` `type Box[T any] struct{ V T }; func wrap[T any](v T) any { return Box[T]{v} }; fmt.Println(wrap(1.5)); fmt.Printf("%T\n", wrap(2))` → `"{1.5}\nmain.Box[int]"` on `both` and `wasm` in `test/unit/wasm/fmt-any.test.js`.
  - Done when: `fmt-formatters.js` walks generic function instantiations to collect concrete types constructed and boxed into `any` inside generic functions, registering them in `gff_<pkg>_value`.
- [ ] Task 9.3: `fmt`: `%w` outside `Errorf` and `%d` description for `errors.New` values
  - Files: `stdlib/fmt/print.go`, `src/lower/fmt-formatters.js`, `test/unit/stdlib/fmt.test.js`
  - Test: `F82` `fmt.Sprintf("%w", errors.New("e1"))` → `%!w(*errors.errorString=&{e1})`, `fmt.Sprintf("%d", errors.New("e1"))` → `%!d(*errors.errorString=&{e1})` on `both` and `wasm` in `test/unit/stdlib/fmt.test.js`.
  - Done when: `badVerb` in `stdlib/fmt/print.go` and `fmt-formatters.js` describe `errors.New` (`*errors.errorString`) with its concrete pointer type and underlying struct value instead of an empty type name and `(unknown)`.
- [ ] Task 9.4: `testing`: `b.Run` sub-benchmark execution, N-growth and result reporting
  - Files: `stdlib/testing/benchmark.go`, `test/unit/stdlib/testing.test.js`
  - Test: `F83` `func BenchmarkX(b *testing.B) { b.Run("sub", func(b *testing.B) { for i := 0; i < b.N; i++ {}; if b.N > 1 { println("grew") } }) }` run via `gofront test` grows `b.N > 1`, prints the `=== RUN BenchmarkX/sub` line, and outputs a `BenchmarkX/sub` result row while suppressing the top-level parent result row in `test/unit/stdlib/testing.test.js`.
  - Done when: `(*B).Run` invokes `grow` and `reportBenchmark` for the sub-benchmark and marks the parent as having sub-benchmarks so `m.runBenchmark` skips the parent `grow` and result row.
