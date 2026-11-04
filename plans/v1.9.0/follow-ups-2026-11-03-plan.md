# v1.9.0 Follow-up Fixes — Design Plan

**Version:** v1.9.0  
**Status:** In Progress (2026-11-03; re-probed 2026-11-03 on `ea3231a` and `a8cb777` for `stdlib-in-go` review follow-ups)  
**Base branch:** main  
**Related:** Schedules the open ledger in [`../follow-ups.md`](../follow-ups.md) (entries logged while executing [`../v1.8.0/follow-up-fixes-plan.md`](../v1.8.0/follow-up-fixes-plan.md), whose Done-means deferred their triage to v1.9.0) and the 34 review follow-up entries logged during [`stdlib-in-go-plan.md`](stdlib-in-go-plan.md) (PR #107). Task 8.2 builds on its per-type-parameter metadata in `_typeArgFactories`. Re-probe the phase's entries on its base commit before starting each phase; drop tasks whose repro stopped reproducing.  
**Release note:** Many Go programs that failed to compile, built an invalid WebAssembly module, or printed different results on JavaScript and WebAssembly now behave like Go, including nil pointers in interfaces, map keys, `fmt` verbs, `encoding/json` values stored in `any`, and generic types exported from WebAssembly packages. Templ components can now use every Go `for` form (three-clause, index-only, and ranging over maps, strings and integers) and a `switch` without a tag.  

---

## Goal

Fix the 170 entries of `plans/follow-ups.md` that still reproduce on `ea3231a` (182 re-probed: 10 no longer reproduce, 2 are deferred), logged during v1.8.0, plus the 32 reproducing entries from the 34 review follow-ups logged in [`stdlib-in-go-plan.md`](stdlib-in-go-plan.md) (re-probed on `a8cb777`: 32 scheduled in Phases 22–27, 1 deduped into Task 15.3, 1 excluded under no-runtime `reflect`), so that valid Go compiles, invalid Go is rejected with Go's diagnostic, and `js`, `both` and `wasm` outputs equal `go run` output. Each defect has a minimal repro (Verified Gaps) that becomes the task's failing test. Work is grouped by subsystem so each phase is one focused PR: front end (1, 22), typechecker (2–4, 23), JS backend (5–10, 24), `fmt` (11–12, 26), WASM backend (13–18, 25), JSON (19–20), templ and tooling (21), and Go-source stdlib/emitter fixes (26–27).

**Done means:**
- Every repro scheduled in Phases 1–27 is a passing test in the task's `Test:` file, with output equal to the `go run` value recorded in Verified Gaps on every target the task names (`assertProgramOutput` = `both` + `wasm`; plus `js` via `compile` + `runJs` where the gap is `js`-only); invalid-Go repros use `assertErrorContains` with Go's message text.
- Every WASM repro passes `assertValidWasm`; no repro listed here produces `Maximum call stack size exceeded`, an infinite loop, or an uncatchable trap.
- `npm test`, `npm run check` and `npm run test:e2e` pass; built `example/` outputs change only where a task fixes behaviour.
- `docs/go-compatibility.md` (JSON row) and `docs/language-support.md` (templ `for` row) no longer list limitations fixed by Phases 19–21.
- Every task is checked off; the deferred rows below stay in the Boundary Matrix; `plans/follow-ups.md` holds only entries logged while executing this plan.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Ledger defects in lexer, parser, typechecker, lowering, JS and WASM backends, JSON codecs, templ, `stdlib/` and `scripts/` that still reproduce on `ea3231a` / `a8cb777` | Every Verified Gaps row except the excluded/deferred ones below | |
| **In scope: target-specific** | Fix the failing target only; keep the working target's output pinned by the same test | JS-only rows (`js`/`both` wrong, `wasm` = Go) and WASM-only rows | |
| **Excluded: runtime / platform** | No new runtime model | Goroutines, reflection, raw addresses (`%p`/`%d` of pointers print stable per-object ids, not machine addresses); S08 `var x any = []int{3, 1}; sort.Slice(x, func(i, j int) bool { return false })` → `Cannot infer type arguments for generic function 'Slice$$sort'` | No memory addresses or `reflect.Swapper` exist in JS or WasmGC; `sort.Slice*` is generic over `S ~[]E` (`stdlib/sort/sort.go`) |
| **Excluded: deferred** | Map keys the WASM facade cannot carry | L57 exported `func Count(m map[any]int) int` from a wasm package → `map with unsupported key type 'any' is not yet supported across the wasm boundary (planned)`; L58-wasm exported `Keys(map[P]int)` (struct key) → same diagnostic (unexported `keys` gives `a` = Go) | Already a clear compile-time diagnostic; carrying `any`/struct keys across the boundary needs a facade key-encoding design of its own. |
| **Excluded: deferred** | Missing `json.Decoder.Token` | L166b `d.Token()` → `No field 'Token' on json.Decoder`, Go `[ <nil>` | New API surface (token stream state machine on both backends), not a defect; candidate for a later JSON feature plan. |
| **Excluded: deferred** | Narrow-element slice identity on WASM | L154 `func f(v any) string { switch v.(type) { case []uint8: return "u8"; case []int32: return "i32" }; return "other" }; f([]int32{1})` on wasm → `u8`, Go `i32` | `[]uint8`, `[]int32`, `[]bool` and `[]int16` share one WasmGC slice type; splitting them needs a type-descriptor design change of its own. |

---

## Verified Gaps & Baseline Audit

### Review follow-ups (2026-11-03)

First probed on `main` @ `3693116` (v1.8.0), then re-probed on `main` @ `ea3231a` (after stdlib-in-go, PR #107); the table shows `ea3231a` results. Harness: a throwaway one in `.probes/`: each repro as `package main`, compiled through `compileFiles` with `forceTarget` `js`, `both` and `wasm`, the module validated with `new WebAssembly.Module`, `main` run with stdout captured (same flow as `compileHybridProgram` in `test/unit/helpers.js`); expected values from `go run` with go1.26.10. Multi-package and facade repros through `compileHybridProject`; templ repros through `compileDir` + `runInDom`; `L170` by counting `__nilcall` in the emitted method. "all" = js, both and wasm. Probe IDs are the ledger line numbers (`Lnn`, sub-repros `a`/`b`/`c`); every entry came from PR #78–#88 or `feat/follow-up-fixes-phase-{2..14}` (v1.8.0 follow-up-fixes Phases 1–14), except L170 (simplefps adoption re-audit 2026-10-29, standalone).

| Area | Finding | Evidence & probe |
|---|---|---|
| Lexer | `1.` and `.5i` mis-lexed | L12 `z := 1.; Println(z)` → wasm `Cannot resolve struct for selector: ;` (js/both `1`), want `1`; L14 `c := .5i` → all `Undefined: 'i'`, want `(0+0.5i)` |
| Parser | `&^=` not parsed | L39 `x := 7; x &^= 4` → all `Unexpected token in expression: '='`, want `3` |
| Parser generics | Instance type in func-type param | L08 `func call(f func(Stack[int]) int, s Stack[int]) int` → all `Expected type, got ')'`, want `0` |
| Parser expressions | Conversions/types in expression position | L31 `Println([]int(nil) == nil)` → all `expected ')' (got ==)`, want `true`; L56 `m[k.(int)]` → all `expected 'IDENT' (got ()`, want `a`; L109a `append(b, []byte("bc")...)` → all `expected ')' (got ...)`, want `abc`; L109b `case func():` → all `Expected type, got ':'`, want `f` |
| Typechecker func literals | Named results unusable | L09 `g := func() (xs []int) { xs = []int{1}; return }` → all `Undefined: 'xs'`, want `[1]`; L110a package-level `var f = func() (res int) { res = 4; return }` → `Undefined: 'res'`, want `4`; L110b `func(n int) (r string) { r = "x"; return r }` → `Undefined: 'r'`, want `x` |
| Typechecker conversions | Parenthesised pointer types and `nil` | L18 `(*S)(&b)` (`type S Base`) → all `Cannot call non-function type *S`, want `1`; L29a `var x I = (*T)(nil)` → same, want `true`; L29b `NS(nil)`, `F(nil)`, `(*int)(nil)` → `cannot convert nil to NS`/`F`, `Undefined: 'int'`, want `true true true`; L109c `M(nil)` (named map) → `cannot convert nil to M` |
| Typechecker comma-ok in `var` | `var _, ok = x.(I)` rejected | L45b → all `assignment mismatch: 2 variables but 1 value`, want `true` (new) |
| Typechecker local types | Self-referential local type | L116 `func main() { type L struct{ next *L; v int } … }` → all `Unknown type 'L'`, want `2` |
| Typechecker termination | `fallthrough` into returning case | L128 `switch n { case 0: return 0; case 1: fallthrough; case 2: return 1; default: return 2 }` → all `missing return at end of function 'f'`, want `1` |
| Typechecker assignability | `float64` → `int` accepted | L20 `var y float64 = 1; var i int = y` → js/both `1`, wasm validate `local.tee expected i64, found f64`; Go `cannot use y (variable of type float64) as int value in variable declaration` |
| Typechecker switch cases | Mismatched case type accepted | L183 `switch name { case 5: }` (`name string`) → js/both run, wasm validate `call[1] expected externref, found i64.const`; Go `cannot convert 5 (untyped int constant) to type string`; templ `switch name { case 5: … }` → renders empty, want same error |
| Typechecker init cycles | Not diagnosed | L108 `const a = b; const b = a` → js/both TDZ `Cannot access 'a' before initialization`, wasm `<nil>`; Go `initialization cycle for a`; L114 `var x = func() int { { x := 1; _ = x }; return x }()` → js TDZ, wasm `0`; Go `initialization cycle: x refers to itself` |
| Diagnostics | Duplicate / cascade errors | L184 `func F(x Foo) {}` → `Unknown type 'Foo'` twice, want once; L186a `import "reflect"; _ = reflect.TypeOf(1)` → `package 'reflect' is not available` + `Undefined: 'reflect'`; L186b `_, _ = os.ReadFile("x")` → `os.ReadFile is not available` + `assignment mismatch: 2 variables but 1 value`; want the first error only |
| Diagnostics precision warning | No position; fires in float context | L187 package-level `var g float64 = 1<<53 + 1` → `warning: main.go: constant 9007199254740993 exceeds JS Number precision` (no line:col); L188 `var f float64 = 9007199254740993` → warns, Go rounds identically (`9.007199254740992e+15`), want no warning |
| Generics instantiation | Cycle crashes | L21a `func (s Stack[T]) Wrap() Stack[[]T]` (never called) → all `Maximum call stack size exceeded`; L21b body `x := Stack[[]T]{}` → js/both `0`, wasm `Monomorphisation exceeded maximum iteration limit`; Go `instantiation cycle` for both |
| Generics inference | Pointer arguments | L38 `func swap[T any](a, b *T)`; `swap(&x, &y)` → all `Cannot infer type arguments for generic function 'swap'`, want `2 1` |
| Generics conversion | `T(n)` in generic-type method | L48 `func (b Box[T]) Scaled(n int) T { return T(n) * 2 }` (`T Num`) → all `cannot convert int to type T: T is not constrained…`, want `6` |
| Generics promotion | Embedded generic instances | L15 `type W struct{ Inner[int] }; W{}.Get()` → all `No field 'Get' on W`, want `0`; L10b `type P[T any] struct{ *Inner[T] }; p.v` → wasm `No field 'v' on P$string` (js `x`); L111 `Deep{E{Base}}.Hello()` → wasm `Unknown field 'Hello' on struct 'Deep'` (js `1`) |
| JS packages | Same type name in two packages | L19 `a.Pt{X int}`, `b.Pt{Y string}` used from main → js `SyntaxError: Identifier 'Pt' has already been declared`, want `{1} {y}`; L19b `var x Box[a.Pt]; x = Box[b.Pt]{}` → compiles (then same SyntaxError), Go `cannot use Box[b.Pt]{} … as Box[a.Pt]` |
| JS aliases | Alias of struct | L22a `type A = Base; A{3}` → js/both `A is not defined`; L22b `A{V: 3}.Get()` → `.Get is not a function`; L22c `var t Base = A{V: 1}; u := t` → `t.__clone is not a function`; L22d `type W struct{ A }; w.V` → `Cannot read properties of undefined (reading 'V')`; wasm = Go (`{3}`, `3`, `{1} {2}`, `5`) |
| JS defined types | Over generic instance / alias | L17a `type S Base[int]; S{n: 3}` → js/both `<nil> 3 <nil>`, want `3 {3} 3`; L17b `type A = Base; type T A; T{n: 3}` → js `T is not defined`, want `3 {3}`; wasm = Go |
| Generic type names | `%T` of instances | L136 `Printf("%T", Box[int]{})` → js `main.Box`, wasm `main.Box$int`, want `main.Box[int]` |
| JS statements | `else if` init dropped | L23 `if a > 5 {} else if b := b + 1; b > 5 { println("elif") }` → js/both `else`, want `elif` |
| JS shadowing TDZ | `x := f(x)` forms | L24 `{ k, ok := m[k]; … }` → js/both `Cannot access 'k' before initialization`, want `7 true`; L144 `switch x := x + 1; x {…}` → same TDZ, want `two` |
| JS comma-ok redeclare | Reused `ok` | L43 `_, ok2 := a.(L); n, ok2 := b.(N)` and L107 `a, ok := x.(int); b, ok := y.(*T)` → js/both `Identifier 'ok…' has already been declared`, want `<nil> false` / `1 true true` |
| Tuple assignment | Nested index evaluated late | L37 `n, ps[n].A = 1, 50` → all `[{0} {50}]`, want `[{50} {0}]` |
| JS init order | Interface call reads later var | L115 `var viaIface = iface.Get()` (reads `later`) → js/both TDZ `Cannot access 'later'`, want `5` (wasm `5`) |
| JS nil receivers | Through interface / method value / expression | L25 `var li Lener = nl; li.Len()`, `nl.Len`, `(*L).Len` → js `Cannot read properties of null (reading 'Len')`, both `invalid memory address…`, wasm `interface conversion: nil or unmatched type for method call`; want `0 0 0`; L103 `var err error = (*E)(nil); err.(error); err.Error()` → same three failures, want `true e`; L132 `PGet` handles nil → want `-1`, same failures; L137 value method via interface on nil `*S` → js `Cannot read properties of null`, wasm `interface conversion…`, want `invalid memory address or nil pointer dereference` (both = Go) |
| JS nil dereference | Raw TypeErrors instead of Go panic | L26 `var p *S; _ = p.A` → js `Cannot read properties of null (reading 'A')`; L32a `*p = T{1}` → js/both `Cannot convert undefined or null to object`, wasm uncatchable `dereferencing a null pointer`; L32b `*e.(*T)` (nil `*T` in `any`) → js/both `interface conversion: type assertion failed`; L123a `var p *int; *p = 3` → js/both `Cannot set properties of null`, wasm uncatchable `illegal cast`; L123b `var ap *[3]int; ap[1]` → js/both `Cannot read properties of null`, wasm uncatchable `dereferencing a null pointer`; L123c `a := *ap` → wasm `[0 0 0]` no panic; want recovered `runtime error: invalid memory address or nil pointer dereference` everywhere |
| JS nil values | Nil conversions and zero values | L30a `error(nil) == nil` → js/both `false`; L65 `Println(error(nil))` → js `null`, want `<nil>`; L30b `map[string]int(nil)` → js `Cannot convert undefined or null to object`, want `0 true`; L30c `Println(make([][]int, 2))` → js `[<nil> <nil>]`, want `[[] []]`; L66 `Println(A{})` (`S []int` field) → js `{<nil>}`, want `{[]}` |
| JS nil slices | `append` keeps nil | L34 `ap = append(ap, ap...)` (nil) → js `false`, want `true`; L100 `append([]int(nil), []int{}...) == nil`, `append([]byte(nil), ""...) == nil` → js `false false`, want `true true` |
| JS numerics | Narrow shifts, generic wrap, float32, complex | L33 `var x int32 = 5; x << -1` → js/both `-2147483648`, want panic `negative shift amount`; L46a `Half[int](9)`, `Wrap[uint8](255)` (generic `x / 2`, `x + 1`) → js/both `4.5 256`, want `4 0`; L93 `Gen[T ~uint8|…](x T) T { return x - 1 }` on `uint8(0)` → js `-1`, want `255`; L75 `float32(1)/3` → js `0.3333333333333333` (both = Go), want `0.33333334`; L99 `func f() complex128 { return 1 }`, `var c complex128 = 5; c = 7; c == 7; c*2` → js/both `1`, `7 false (NaN+NaNi)`, want `(1+0i)`, `(7+0i) true (14+0i)` |
| JS strict nil checks | Redundant `__nilcall` | L170 `func (out *Vec3) TransformMat4(a *Vec3, m Mat4) *Vec3` in a `both` package → 3× `__nilcall(a)` and 3× `__nilcall(out)` (`let out = this`), want ≤1 for `a` and 0 for `out` (simplefps re-audit, Low) |
| JS dynamic types | Boxed identity of named/sized values | L50 `Printf("%T", any(N(1)))` → all `int`, want `main.N` (`any(N(1)) == any(1)` now `false` = Go); L101a `any(map[string]int(nil)) == nil` → js/both `true`, want `false` (the `any(uint64(1)) == any(uint32(1))` half is fixed); L101c `var a any = (*P)(nil); a == nil` → js `true`, want `false`; L45c `error(many{}).(interface{ Unwrap() []error })` → js `false`, want `true` |
| JS assertions & type switches | Wrong matches | L47 `any(new(L)).(*string)` → js `true`, want `false`; L120 `T{4}` in `any` matches pointer-receiver `Sizer` → js `sizer`, want `namer`; L155 decoded JSON map matches `case []any` → js `slice`, want `map`; L154 `any([]int32{1})` with `case []uint8:` first → all `u8`, want `i32`; L104b `var n any; n.(iter.Seq[int])` → js `true`, want `false`; L44b `Kind[Name](Name("a"))` with `case string:` before `case T:` → js `str`, wasm `other`, want `T` |
| JS generics | Method through constraint | L69 `func S[T fmt.Stringer](x T) string { return x.String() }; S(Color(2))` (`type Color int`) → js/both `x.String is not a function`, want `col` |
| JS map keys | Typed keys and composite encoding | L42a `for k := range map[int]string{1:"a"} { k + 1 }` → js/both `11`, want `2`; L42b `len(map[struct{A, B string}]bool{{"a b","c"}:…, {"a","b c"}:…})` → js `1`, want `2`; L42c `Println(map[[2]int]string{{1,2}:"a"})` → js `map[1,2:a]`, want `map[[1 2]:a]`; L51 `map[P]int{{Inf}:1, {-Inf}:2}` → js `1`, want `2`; L86 `map[struct{A int8}]int{{-1}:1, {5}:2}` → js `map[[object Object]:2]`, want `map[{-1}:1 {5}:2]` |
| JS map keys | Pointer and interface keys | L52 `len(map[*K]int{&K{1}:1, &K{1}:2})` → js `1`, want `2`; L54 `m := map[any]int{}; v, ok := m[1]` → js `<nil> false` (both = Go), want `0 false`; L55 `range map[any]int{nil: 1}` key `== nil` → js `false`, want `true`; L60a `len(map[any]int{int8(3):1, uint(3):2})` → js `1`, want `2`; L60b `m[[]int{1}] = 1` (`map[any]int`) → js/both no panic, wasm `runtime error: hash of unhashable type` (no type), want `runtime error: hash of unhashable type []int`; L101b `len(map[any]int{uint64(1):1, int64(1):2})` → js `1`, want `2` |
| Map printing | Key order and interface keys | L59b `Println(map[any]int{1:1,"1":2,L("1"):3})` → js/both `map[1:2 1:1 1:3]`, wasm `map[<nil>:3 1:1 1:2]`, want `map[1:3 1:2 1:1]`; L87 `Println(map[string]int{"b":1,"a":2,"B":3})` → all `map[a:2 b:1 B:3]`, want `map[B:3 a:2 b:1]` |
| fmt verbs (all) | Rounding, bad-verb floats, width | L61 `Printf("%.0f|%.1f|%.1v", 2.5, 0.25, 2.5)` → all `3|0.3|3`, want `2|0.2|2`; L72a `Printf("%d", 1e-7)` → all `%!d(float64=1e-7)`, want `%!d(float64=1e-07)`; L72b `Printf("%d", math.Inf(1))` → all `%!d(float64=Infinity)`, want `%!d(float64=+Inf)`; L77 `Printf("%5v|%-5v", []int{1}, []int{1})` → all `  [1]|[1]  `, want `[    1]|[1    ]` |
| fmt nil operands | Nil pointer / interface / map | L63 `var c *C; Printf("%d", c)` → all `%!d(<nil>)`, want `0`; L64 `var e error; Printf("%s|%.2v|%d", e, e, e)` → js `<nil>|<nil>|%!d(<nil>)`, wasm `<nil>|<n|%!d(string=<nil>)`, want `%!s(<nil>)|<nil>|%!d(<nil>)`; L73 `var m map[string]int; Printf("%#v", m)` → js `map[string]int{}`, want `map[string]int(nil)` |
| fmt identity | Pointers and funcs | L82 `Printf("%d", &x)` → js `{1}`, wasm `&{%!d(<nil>) %!d(bool=true) …}`, want a decimal id; L83 `f := func(){}; Printf("%v|%T", f, f)` → all `0x1|func() interface {}`, want `0x<id>|func()`; L91 `Sprintf("%p", p) == Sprintf("%p", &P{1})` → all `true`, want `false`; L96 wasm `Sprint(f, 1)` → `0x11`, want a space; L97 `var x any = &b; Printf("%p", x)` → all `%!p(…)`, want `0x…` |
| fmt static types | `%T`/`%v` through `any` and `T` | L68a `T([]int(nil))`, `T(map[string]int{})` via `Sprintf("%T", x)` → js/both `[]interface {}` / `map[interface {}]interface {}`, want `[]int map[string]int` (wasm = Go); L70 `var x any = float32(0.1)` → all `0.10000000149011612`, want `0.1`; L78 `var p *Color; var a any = p; Printf("%T %q", a, p)` → all `<nil> %!q(<nil>)`, want `*main.Color %!q(*main.Color=<nil>)`; L85/L102 `%T` of `any(uint64(1))`, `any(Color(2))`, `any((*P)(nil))` → js/both `int64 int <nil>`, wasm `int int <nil>`, want `uint64 main.Color *main.P` |
| fmt nil Stringers | Nil `*T` with pointer `String` | L62 `var g *G[int]; var x any = g; Println(x)`; `Sprint([]any{cp})` (nil `*C`) → all `<nil>` / `[<nil>]`, want `g` / `[c]`; L95 `Println(nilp())` (multi-value, nil `*P` with `String`) → js `<nil> <nil>`, want `P* <nil>` |
| fmt multi-value args | `f()` as the whole argument list | L89 `Printf(fa())` (`fa() (string, int)`) → js/both `v=%d` + `,5`, want `v=5`; L90 `Fprint(fw())` (`fw() (*os.File, string)`) → js `__w.Write is not a function`, wasm validate `struct.new[0] expected i32, found externref`, want `hello`; L94 `Println(c())` (`c() (any, int)` returning a struct) → wasm `<nil> 1`, want `{1} 1` |
| fmt `%#v` of `any` (JS) | Host type name | L67 `var x any = M{map[string]int{"k":1}}; Printf("%#v", x)` → js `main.M{M:struct { k int }{k:1}}`, want `main.M{M:map[string]int{"k":1}}` |
| WASM type switches | `iface.methods is not iterable` | L11 `switch err.(type) { case nil: …; case error: … }` and L53 `switch v.(type) { case error: … }` (on `any`) → wasm compile crash, want `nil` / `d` |
| WASM type identity | Defined and generic types | L44a/L98 `type L string`: `case L:` never matches, `desc("a")` → `L`; wasm `other L`, want `L string`; L44c `conv[Small](130)` (`type Small int8`) → wasm `130`, want `-126`; L104a `a.(iter.Seq[int])` → wasm `Undefined: 'iter'`, want `true` |
| WASM nil in interfaces | Typed nil dispatch | L103/L132/L137 (see JS nil receivers) wasm half; L105 `errors.As(retTyped(), &me)` with typed nil `*MyErr` → js and wasm `false`, want `true` |
| WASM dispatch | Named func/map; method values | L138 `var g Getter = MyFn(f); g.Get()` and named map → wasm `interface conversion: nil or unmatched type for method call`, want `3 1`; L117 `var n N = &A{"a"}; f := n.Name; f()` → js `Cannot read properties of undefined (reading 's')`, both nil-deref panic, wasm `Cannot resolve struct for selector: Name`, want `a` |
| WASM recover value | Runtime panics not `error` | L133 `recover().(error)` after index out of range → js and wasm `false`, want `true` |
| WASM locals & captures | Shadowing and capture slots | L27 `m := 7; func(){ m := f(m); m++ }()` → wasm `Unresolved identifier: m`, want `9 7`; L113 package `var cl = func() func() int { cl := 9; return func() int { return cl } }()` → validate `struct.new[0] expected (ref null 91), found (ref null 89)`, want `9`; L118 `k, e := add(1, 1); g := func() int { return k }` → validate `struct.new[0] expected i32, found i64`, want `2 0` |
| Type switch bindings | Shadow / capture | L119 `var x MyInt…; switch x := v.(type) { case int: x + 1 }` → js/both `NaN`, wasm validate `local.tee expected (ref null 92), found i64`, want `4`; L141 binding reassigned and captured → wasm validate `local.tee expected (ref null 88), found i64`, want `3` |
| WASM multi-value targets | Blank, computed, interface targets | L28 `var _, y = two()` → validate `local.set expected i32, found call i64`, want `2`; L122 `res[0], oks[0] = mi["k"]`, `res[1], oks[1] = a.(int)` → wasm `[0 0] [false false]`, want `[5 3] [true true]`; L142 `var x, y interface{}; x, y = two()` → validate `local.set expected anyref, found externref`, want `1 a` |
| WASM defer in switch | Capture slot type | L140 `defer func(){ … s … }()` in a switch clause in a loop → validate `struct.new[0] expected externref, found i64`, want `deferred2 1` / `deferred zero` |
| WASM control flow | Labels, case lists, struct tags | L139 `sw: switch 1 { case 1: switch 2 { case 2: break sw }; Println("unreached") }` → wasm prints `unreached`; L130 `switch g(5) { case g(1), g(5), g(6): }` → wasm also calls `g(6)`; L129 `switch p { case P{1, 2}: … }` → all `other`, want `p12` |
| WASM evaluation order | Arg side effects and panics | L131 `Println(h(1), h(3))` (h prints) → wasm `h1;1h3; 3`, want `h1;h3;1 3`; L143 `Println(name, g.Get())` where `Get` panics → wasm leaves `name ` before `|`, want nothing |
| Element pointers | Whole-element stores | L35a `q := first(ys)` (`&xs[0]` in callee); `ys[0] = S{9}; q.A` → all `1`, want `9`; L35b `p := &xs[0]; xs[1], xs[0] = S{4}, S{3}; p.A` → js/both `1`, want `3`; L41 reslice + append then `xs[idx()] = S{7}; p.A` → js/both `0`, want `7` |
| Value copies | Aliasing of map/range/boxed values | L49 `for k2 = range m {}; k2.N = 99; Println(m)` → wasm `map[{a 99}:2]`, want `map[{a 1}:2]`; L127 `pt, _ := m["a"]; pt.X = 100; m["a"]` → all `{100 1}`, want `{1 1}`; L106 `Println(w, copy(w, p))` → wasm `[0 0 0] 3`, want `[97 98 99] 3` |
| WASM pointers & values | Pointer-to-pointer, complex fields, string zeros | L126 `pp := new(*int); *pp = &x; **pp` → wasm `illegal cast`, want `9`; L112 `s.C = complex(1, 1)` (`C complex128` field) → validate `struct.set: Field 0 … is immutable`, want `(1+1i)`; L125 `var s [2]string; make([]string, 2)` → wasm `[<nil> <nil>] [<nil> <nil>]`, want `[ ] [ ]` |
| WASM fmt containers | Interface values print `<nil>` | L71 `Println([]any{A{1}})` → wasm `[<nil>]` (ledger saw a validation error), want `[{1}]`; L76 `[]error{Er{"x"}}`, `[]fmt.Stringer{Vs{}}`, `[]any{Vs{}}` → wasm `[<nil>] [<nil>] [<nil>]`, want `[er:x] [vs] [vs]`; L79 `[]any{&a}` → wasm `[<nil>]`, want `[ps]` |
| WASM builtin print | Signedness, spacing | L81 `println(uint32(4000000000))` → wasm `-294967296`, want `4000000000`; L88 `print("a","b",1,2)` → all `a b 1 2`, want `ab12` |
| WASM imports | Spurious `fmt_box_u64` | L92 `func g(x any){}; g(1)` → module imports `fmt_box_u64`, want none (Low) |
| WASM facade | Qualified names, generic classes | L16 exported `type S struct{ sb strings.Builder }` → `SyntaxError` at `const __gfw_h_strings.Builder = new WeakMap()`; L121 js main `g.Take(g.Box[int]{V: 4})` → `Box is not defined`, want `4`; L135a `func Mp() map[string]G[TB]` → `G is not defined`, want `2`; L135b `type Emb struct{ G[int] }`; `e.Get()` → `e.Get is not a function`, want `5` |
| JS json decode | Partial decode, keys, reuse | L145 `{"F":"x","B":true,"Sl":[1,"y"]}` into `R` → js `… false []`, want `… true [1 0]` (wasm = Go); L146 `{"x":"a"}` into `map[int]string` → js `<nil> 1`, want `json: cannot unmarshal number x into Go value of type int 0`; L161 into existing map → js `map[a:1]`, want `map[a:1 keep:1]`; L162 `" 1 "` into `RawMessage` → js `" 1 "`, want `"1"` |
| JS json encode in `any` | Runtime-shape guessing | L149a `any([3]byte{1,2,3})` → js `"AQID"`, want `[1,2,3]`; L149b `any(&n)` → js `{"value":5}`, want `5`; L149c `any(float32(0.1))` → js `0.10000000149011612`, want `0.1`; L163a `any(json.Number("12"))` → js `"12"`, want `12`; L163b `any(&rm)` → js `{"value":[1]}`, want `[1]`; L152 `any(T("x"))` with `MarshalText` → js `"x"`, want `"t-x"`; L167a `Marshal(func(){})` → js `null <nil>`, L167b `[]func(){}` value → js `[null] <nil>`, want `json: unsupported type: func()`; L168 `map[bool]int{true:1}` → js `{"true":1}`, want `json: unsupported type: map[bool]int` |
| JSON codec identity | Anonymous and local struct types | L148a `T{Nest struct{X int}}` error → js `Go struct field T.Nest.X`, want `.Nest.X`; L148b `any(struct{A int \`json:"a"\`}{1})` → js `{"A":1}`, want `{"a":1}`; L148c `var t struct{Nest struct{X int}}` → js `<nil>`, both/wasm `error in the generated encoding/json codecs; please report … cannot take the address of a field … of type any`; L158 two `type Dup` in different funcs → js `{"Y":""}`, wasm validate `struct.new[0] expected externref, found i64.const`, want `{"X":1} {"Y":"y"}`; L169 two anonymous structs → js `{"A":null} {"A":null}`, want `{"A":null} {"S":1}` |
| JSON error text | Messages differ from Go | L147 `"x"` into `json.Number` → all `trying to unmarshal "x" into Number`, want `"\"x\""`; L156 `Unmarshal([]byte("1"), any(5))` → js `non-pointer interface {}`, want `non-pointer int`; L157 typed nil `*Item` in `any` → js `json: Unmarshal(nil)`, wasm `json: Unmarshal(non-pointer <nil>)`, want `json: Unmarshal(nil *main.Item)` |
| WASM json dynamic types | Values in `any` | L150a `any(json.RawMessage("[1]"))` → wasm `json: unsupported type: unsupported dynamic type`, want `[1]`; L150b `any(json.Number("1"))` → same, want `1`; L163a wasm prints empty, want `12`; L151a `[]byte` + `[]bool` in `any` → wasm `"AQ==" "AQ=="`, want `"AQ==" [true]`; L151b `any([]rune("ab"))` → wasm unsupported, want `[97,98]`; L152 wasm `MarshalText` in `any` → unsupported, want `"t-x"`; L159 `[3]int` and `[2]int` in `any` → wasm `index out of range [2] with length 2`, want `[1,2,3] [4,5]` |
| WASM json generics & pointers | Codec generation gaps | L153 `json.Marshal(Box[int]{2})` in a both/wasm package → `json: cannot spell type kind typeParam`, want `{"V":2}`; L166 `func Dec[P any](p P) error { return json.NewDecoder(r).Decode(p) }; Dec(&x)` → wasm `json: Unmarshal(non-pointer struct {}) 0`, want `<nil> 1` (ledger's stack overflow is gone); L160 `S{P **int}` Unmarshal → js/both `Cannot read properties of undefined (reading 'value')`, wasm validate `local.set expected (ref null 38), found struct.new`, want `<nil> 1` |
| Templ `for` | Loop forms unsupported or wrong | L172 `for k := range m` (map) → `m is not iterable`; L173 `for i := 0; i < n; i++` → `i is not defined`; L174 `for _, x := range []int{1}` → `Parse error … Unexpected token in expression: ''`; L175 `for range xs` → never terminates (killed by `timeout 10`); L176 `for i := range n` (int) → `n is not iterable`; L177 `for i, r := range s` (string) → `__s.entries is not a function`; L185 `for i := range xs` → `<p>a</p><p>b</p>` (binds elements), `for i, _ := range xs { i + 1 }` → `01`,`11`; want Go semantics for each |
| Templ switch & attributes | Tagless switch; attr type | L178 `switch { case n > 3: … }` (n=5) → `small` (emits `switch ("")`), want `big`; L180 `<p hidden?={ name }>` (`name string`) → renders, want `must be bool` type error; L183-templ case type (see Typechecker switch cases) |
| Templ expressions | Positions and trailing tokens | L171 `{ name + undefinedVar }` on line 3 of `v.templ` → `Type error in v.templ at line 1:8` with a `package main` frame, want line 3; L179 `<p>{ name ) }</p>` → renders `<p>a</p>`, want a parse error |
| Templ variadic slots | Nil spread; non-`children` name | L181 `W(ns...)` with nil `ns` → `children is not iterable`, want `<div></div>`; L182 `templ W(items ...gom.Node) { <div>{ items... }</div> }` → `<div>[object Object],[object Object]</div>`, want both `<i>` mounted |
| Layer guard | Missing root crashes | L189 `node scripts/check-layers.js no-such-dir` → ENOENT stack trace from `readFileSync`, want `check-layers: cannot read no-such-dir/.sentrux/rules.toml` and exit 1 |

No longer reproducing on `ea3231a` (fixed by stdlib-in-go or earlier work; deleted from the ledger): L36/L74/L80/L84 64-bit JS arithmetic and printing; L45a `Errorf("%w")` matches `interface{ Unwrap() error }`; L13 `Stack[[2]int]{}`; L10a promotion through `W[T]{ Inner[T] }` on wasm; L40 `new(T)` in a generic function on wasm; L58 generic range over struct keys in JS (its exported-function form is the deferred facade row); L124 `time_Duration` vs `time.Duration` type keys; L134 facade class for `G[TA]` in a package importing `io`; L165a control characters in JSON syntax errors (`'\x01'`); `[]func(){}` composite literals now parse (the JSON half of L167 stays). Also no longer reproducing on `3693116`: L68b wasm `%v` of a nil map through `T` now prints `map[]` (= Go); L59a `Printf("%+v", H{map[any]int{5:1}})` now prints `{m:map[5:1]}` in js/both (its wasm form fails only because `main` exports `H`, the deferred facade-key row); L165b truncated `Decoder` stream now reports `unexpected EOF` on all targets (= Go); L164 `var ip *int; Unmarshal(b, &ip)` now sets `ip` in `js`, and `both`/`wasm` reject it with the documented `json.Unmarshal into a pointer to a pointer is not yet available` diagnostic. Partly fixed (remaining half kept above): L50 `any(N(1)) == any(1)` is `false` everywhere; L54 is correct in `both`; L166 no longer overflows the stack. Broader than logged: L105, L127, L129, L133 also fail in JS; L183 now builds an invalid WASM module.

### Review follow-ups from stdlib-in-go (2026-11-03)

Probed on `feat/follow-ups-2026-11-03` @ `a8cb777` (after Phases 1–2) using the same `.probes/` harness across `js`, `both` and `wasm`. Probe IDs (`S01`–`S34`) correspond to the 34 entries logged under *Deferred bugs found during review* in [`stdlib-in-go-plan.md`](stdlib-in-go-plan.md) (PR #94–#107, `stdlib-in-go` Phases 1–12). `S07` duplicates `L131` (Task 15.3); `S08` (`sort.Slice` on `any`) is excluded under the no-runtime `reflect` rule in the Boundary Matrix; the remaining 32 entries are scheduled in Phases 22–27.

| Area | Finding | Evidence & probe |
|---|---|---|
| Lexer & string literals | Astral rune literals rejected; `\x80`–`\xff` escapes become 2-byte UTF-8 | S19 `r := '😀'; Println(r)` → all `Lex error: Rune literal must contain exactly one character`, want `128512` (stdlib-in-go Phase 8); S15 `b := []byte("a\xffb"); Println(len(b), bytes.IndexRune(b, utf8.RuneError))` → all `4 -1`, want `3 1` (stdlib-in-go Phase 7) |
| Parser expressions & directives | Conversion-led index in call arg; `//gofront:native` before doc comment; `Id[*int]` | S33 `f(byte(digits[uint(u)&m]))` → all `Parse error: expected ']' (got ( "(")`, want `51` (stdlib-in-go Phase 12); S06 `//gofront:native str.Index` + `// doc` + `func Index…` → `decl.native === undefined`, want `"str.Index"` (PR #96, Phase 3); S03 `f := Id[*int]; *f(&x)` → all `*int (type) is not an expression`, want `4` (PR #95, Phase 2) |
| Constant folding | Untyped float addition folded in `float64` | S31 `Println(0.2 + 0.1)` → all `0.30000000000000004`, want `0.3` (stdlib-in-go Phase 12) |
| Typechecker rules | `s[0]` typed `int`; `cap(m)` accepted; forward type-param ref; `m[1<<60]` key | S29 `var c byte = "."[0]; cp(s[0])` → all `Cannot assign int to uint8`, want `true 46` (stdlib-in-go Phase 11); S05 `var m map[string]int; _ = cap(m)` → js/both compile, wasm validate fails, want `invalid argument: m (variable of type map[string]int) for cap` (PR #95, Phase 2); S04 `func F[S SliceIface[E], E any](s S) E` → all `Unknown type 'E'`, want `7` (PR #95, Phase 2); S02 `m := map[int64]string{1 << 60: "hello"}; Println(m[1<<60])` → js/both `""`, want `hello` (PR #94, Phase 1) |
| JS 64-bit numerics | `/` and `%` double-eval divisor; `(1 << k) - 1` emits Number | S01 `_ = int64(10) / f()` (`f` increments `count`) → js/both `2`, want `1` (PR #94, Phase 1); S32 `k := uint(3); var m uint64 = (1 << k) - 1; var n uint64 = 5; Println(n & m)` → js/both `TypeError: Cannot mix BigInt and other types`, want `5` (stdlib-in-go Phase 12) |
| JS statements & nil receivers | `for` post `/=` float div; `*p, err = f()`; shadowed named result TDZ; nil `*bytes.Buffer` | S28 `w := 345; for ; w > 100; w /= 10 {}` → js/both `34.5`, want `34` (stdlib-in-go Phase 11); S30 `*p, err = f()` → js/both `SyntaxError: Invalid destructuring assignment target`, want `9 <nil>` (stdlib-in-go Phase 11); S11 loop assigning named result `err = nil` then `_, err := g()` → js/both `Cannot access 'err' before initialization`, want `<nil>` (stdlib-in-go Phase 5); S16 `var b *bytes.Buffer; Println(b.String())` → js/both `Cannot read properties of null (reading 'String')`, want `<nil>` (stdlib-in-go Phase 7) |
| Runtime panics & conversions | Negative rune to `string`; JS `make` negative len; JS `panic` of non-string `error`; WASM unsigned `/` and `%`; WASM host panic | S10 `string(rune(-1)) == "\ufffd"` → all `Invalid code point -1`, want `true` (stdlib-in-go Phase 5); S26 `make([]int, -1)` recovered → js/both `Invalid array length`, want `runtime error: makeslice: len out of range` (stdlib-in-go Phase 10); S27 `panic(error(rt("q")))` recovered → js/both `[object Object]`, want `boom` (stdlib-in-go Phase 10); S25 `(1<<31)%uint32(n), (1<<31)/uint32(n)` (`n = 10`) → wasm `4294967288 4080218932`, want `8 214748364` (stdlib-in-go Phases 10, 12); S20 host import throwing in `wasm` cannot be recovered by `recover()` (stdlib-in-go Phase 8) |
| `fmt`, `errors.As` & `binary` | `Fprint` non-string spacing; `%#v` `GoStringer`; WASM `errors.As` multi-error & named basic; JS `binary.Read`/`Size` | S14 `fmt.Fprint(&sb, "b", 2, 3, "c")` → all `4 b23c`, want `5 b2 3c` (stdlib-in-go Phase 6); S23 `Printf("%#v\n", T{})` (`GoString() string`) → all `main.T{}`, want `pkg.T` (stdlib-in-go Phase 9); S07 `fmt.Println(next("a"), next("b"))` → wasm `a1b 1`, want `ab1 1` (deduped into L131 / Task 15.3); S09 `errors.As(errors.Join(e1, fmt.Errorf("n: %w", NotFound{"z"})), &nf)` → wasm `false`, want `true z` (stdlib-in-go Phase 5); S22 `errors.As(error(E(7)), &t)` (`type E byte`) → wasm `false 0`, want `true 7` (stdlib-in-go Phase 9); S21 `var a int64; binary.Read(&buf, LittleEndian, &a); a + 1` → js/both `Cannot mix BigInt and other types`, want `-4` (stdlib-in-go Phase 9); S24 `binary.Size(Point{})` (`X, Y int32`) → js/both `16`, want `8` (stdlib-in-go Phase 9) |
| Go-source stdlib & WASM size | `path.Match` class validation; `strconv.Unquote` `\r` + UTF-8; `ToUpper("ß")`; `bytes.Buffer` WASM size | S12 `path.Match("[z-a]", "b")` → all `false false`, want `false true` (#98, Phase 5); S13 `path.Match("[/]", "/")` → all `true <nil>`, want `false syntax error in pattern` (#98, Phase 5); S34 `strconv.Unquote("` + "`\\ré`" + `")` → all ` <nil>`, want `é <nil>` (stdlib-in-go Phase 12); S18 `strings.ToUpper("ß")` → all `S`, want `ß` (stdlib-in-go Phase 8); S17 `compileWasm` of `var b bytes.Buffer; b.WriteString("hi"); _ = b.Len()` → `wasm.length = 6633`, want `<= 4500` (stdlib-in-go Phase 7) |

---

## Approach

### 1. Architecture & Design Decisions
- Phases group by subsystem so one PR touches one area: front end (1, 22), typechecker declarations/conversions (2), typechecker checks/diagnostics (3), generics (4), JS types/packages (5), JS statements (6), JS nil (7), JS numerics (8), JS dynamic types (9), JS map keys (10), `fmt` verbs (11), `fmt` typed values (12), WASM interfaces (13), WASM locals/multi-value (14), WASM control flow (15), WASM pointers/copies (16), WASM print and imports (17), WASM facade (18), JSON JS (19), JSON WASM (20), templ and tooling (21), typechecker string/map/type-param rules (23), JS 64-bit/statement/nil-method fixes (24), runtime panics/rune conversions/WASM unsigned division (25), `fmt`/`errors.As`/`binary` emitter parity (26), and Go-source stdlib fixes + WASM import pruning (27).
- Cross-target rows test through `assertProgramOutput` (`both` + `wasm` vs Go text); `js`-only rows additionally run as a `js` package (`compile` + `runJs`) so the non-strict path is covered.
- Static type information beats runtime-shape guessing: `%T`, JSON encode of values in `any`, map-key decoding and boxed identity (Phases 9, 10, 12, 19) all take the type from the checker (`_type` on the operand or a type descriptor passed with the boxed value) rather than inspecting the JS value. Where JS cannot tell two types apart (Number for `int8` vs `uint`), box with a type tag at the conversion to `any` (the mechanism `type-info.js` already uses for named types).
- `%p`/`%d` of pointers and func values print per-object ids from a `WeakMap` counter on JS and from a host id table on WASM (externref keyed); identity is what Go programs observe, numeric value is not.
- Templ `for` lowers through the same range lowering as Go statements (`src/lower/range.js`) instead of the templ-specific `_genTemplFor` loop heuristics.
- WASM stdlib import pruning (Task 27.4) checks reachable declarations rather than raw `p.imports` on linked Go-source stdlib files so importing `bytes` for `bytes.Buffer` does not pull in `unicode`, `testing` and `fmt` host imports.

### 2. Invariants & Safety Bounds
- No change to the `int64`/`uint64` representation (BigInt in JS since stdlib-in-go) or to the WASM facade key types (deferred row).
- Strict (`both`) wrapping stays exactly Go's; non-strict `js` packages change only where a task names the `js` target.
- New nil checks must not add `__nilcall` on hot paths: Task 8.5 removes receiver checks and duplicate checks while Task 7.x adds checks only where a TypeError escaped before. `test/perf` mathx numbers must not regress.
- Every WASM fix keeps `assertValidWasm`; every new diagnostic uses Go's message text.

### 3. Edge Cases & Error Handling
- L20/L183/S05 turn currently accepted programs into compile errors; check `example/` and `test/unit` for accidental reliance before landing (Done when of Tasks 3.1/3.2/23.2).
- L21 must diagnose the cycle at declaration even when the method is never called (Go does).
- L33 shift panic: only for non-constant negative counts; constant negative counts are already compile errors.
- L60b `hash of unhashable type` panics at insertion time with Go's text including the dynamic type.
- L88 `print` spacing: `print` never adds spaces, `println` always does (Go spec), on both backends; `fmt.Fprint` adds a space only when neither adjacent operand is a string (S14, Task 26.1).
- S15 `\xNN` escapes in string literals represent raw bytes when converted to `[]byte` or indexed, while valid UTF-8 sequences decode as their rune in `for range` and `[]rune`.
- Templ L175 `for range xs` must not leak a loop variable; L176 `range n` with `n <= 0` renders nothing.
- Phase 19/20 pins in `test/unit/builtins/json.test.js` and `test/unit/wasm/json.test.js` that encode today's wrong outputs are updated in the same commit.

---

## Implementation Tasks

### Phase 1: Front End Accepts Valid Go

*Phases 1–21 were scheduled from review follow-ups on 2026-11-03 (see Verified Gaps → Review follow-ups).*

- [x] Task 1.1: Lexer: trailing-dot floats and leading-dot imaginary literals
  - Files: `src/lexer/lexer.js`, `test/unit/compiler/lexer-parser.test.js`
  - Test: L12 `z := 1.; fmt.Println(z)` → `1`; L14 `c := .5i; fmt.Println(c)` → `(0+0.5i)` (all targets via `assertProgramOutput`); `x.y` selectors and `1..` still lex as before.
  - Done when: both repros run on js/both/wasm.
- [x] Task 1.2: Parser: `&^=` compound assignment
  - Files: `src/lexer/tokens.js`, `src/parser/statements.js`, `test/unit/compiler/lexer-parser.test.js`
  - Test: L39 `x := 7; x &^= 4` → `3` on all targets; `x &^ 4` unchanged.
  - Done when: repro runs on all targets.
- [x] Task 1.3: Parser: generic instances in func-type parameters
  - Files: `src/parser/types.js`, `src/parser/expressions.js`, `test/unit/parser/generics.test.js`
  - Test: L08 `func call(f func(Stack[int]) int, s Stack[int]) int` → `0`; `Stack[[2]int]{}` stays green.
  - Done when: repro compiles and runs on all targets.
- [x] Task 1.4: Parser: conversions, func types and composite literals in expression position
  - Files: `src/parser/expressions.js`, `src/parser/statements.js`, `test/unit/compiler/lexer-parser.test.js`
  - Test: L31 `fmt.Println([]int(nil) == nil)` → `true`; L56 `m[k.(int)]` → `a`; L109a `append(b, []byte("bc")...)` → `abc`; L109b `switch x.(type) { case func(): … }` → `f`.
  - Done when: all four parse and run on all targets; existing `looksLikeTypeArgList` tests stay green.

### Phase 2: Typechecker Declarations and Conversions

- [x] Task 2.1: Named results in function literals
  - Files: `src/typechecker/expressions.js`, `src/typechecker/statements.js`, `test/unit/types/checks.test.js`
  - Test: L09 `g := func() (xs []int) { xs = []int{1}; return }` → `[1]`; L110a package-level `var f = func() (res int) { res = 4; return }` → `4`; L110b → `x`.
  - Done when: all three run on all targets.
- [x] Task 2.2: Parenthesised pointer-type and `nil` conversions
  - Files: `src/typechecker/expressions.js`, `src/parser/expressions.js`, `test/unit/types/pointers.test.js`
  - Test: L18 `(*S)(&b)` → `1`; L29a `var x I = (*T)(nil)` → `true`; L29b `NS(nil)`, `F(nil)`, `(*int)(nil)` → `true true true`; L109c `M(nil)` → `true`; `int(nil)` → `assertErrorContains(errors, "cannot convert nil")`.
  - Done when: positive repros run on all targets; the negative stays an error.
- [x] Task 2.3: Comma-ok in `var` declarations and self-referential local types
  - Files: `src/typechecker/statements.js`, `src/typechecker/resolve.js`, `test/unit/types/checks.test.js`
  - Test: L45b `var _, ok = error(many{}).(interface{ Unwrap() []error })` → `true` (also `var v, ok = m["k"]`); L116 local `type L struct{ next *L; v int }` → `2`.
  - Done when: both run on all targets.
- [x] Task 2.4: Termination analysis follows `fallthrough`
  - Files: `src/typechecker/termination.js`, `test/unit/types/checks.test.js`
  - Test: L128 switch ending `case 1: fallthrough; case 2: return 1; default: return 2` → `1`; a switch whose last clause falls off still → `missing return`.
  - Done when: repro compiles; negative keeps its error.

### Phase 3: Typechecker Checks and Diagnostics

- [x] Task 3.1: Reject implicit `float64` → `int` assignment
  - Files: `src/typechecker/assignability.js`, `test/unit/types/checks.test.js`
  - Test: L20 `var y float64 = 1; var i int = y` → `assertErrorContains(errors, "cannot use y (variable of type float64) as int value")`; untyped constants `var i int = 1.0` still accepted.
  - Done when: repro is a type error on all targets; `npm run check` (examples) and `npm test` stay green.
- [x] Task 3.2: Switch case types must match the tag
  - Files: `src/typechecker/statements.js`, `test/unit/types/checks.test.js`
  - Test: L183 `switch name { case 5: }` (`name string`) → `assertErrorContains(errors, "cannot convert 5 (untyped int constant) to type string")`; same for the templ form (`test/unit/compiler/templ.test.js`).
  - Done when: both forms are type errors; no invalid WASM is emitted.
- [x] Task 3.3: Initialization cycles for constants and shadowed package vars
  - Files: `src/typechecker/init-order.js`, `src/typechecker/constants.js`, `test/unit/language/init-order.test.js`
  - Test: L108 `const a = b; const b = a` → `assertErrorContains(errors, "initialization cycle")`; L114 `var x = func() int { { x := 1; _ = x }; return x }()` → same; `var x = func() int { x := 1; return x }()` still compiles.
  - Done when: both cycles are compile errors; the shadowed-only form compiles.
- [x] Task 3.4: One diagnostic per root cause
  - Files: `src/typechecker/resolve.js`, `src/typechecker/expressions.js`, `test/unit/types/errors.test.js`
  - Test: L184 `func F(x Foo) {}` → exactly one `Unknown type 'Foo'`; L186a → only `package 'reflect' is not available`; L186b → only `os.ReadFile is not available` (count errors, assert message).
  - Done when: each repro yields exactly one error.
- [x] Task 3.5: Precision warning position and float contexts
  - Files: `src/backend/js/expressions.js`, `src/typechecker/const-fold.js`, `test/unit/language/constants.test.js`
  - Test: L187 package-level `var g float64 = 1<<53 + 1` → no warning (float context, see L188); `var g int = 1<<53 + 1` → warning text contains `main.go at line 3:`; L188 `var f float64 = 9007199254740993` → no warning.
  - Done when: warnings carry `line:col` and fire only for integer-typed contexts.

### Phase 4: Generics Typechecking and Instantiation

- [x] Task 4.1: Instantiation-cycle diagnostic
  - Files: `src/typechecker/types.js`, `src/backend/wasm/monomorph.js`, `test/unit/types/generics.test.js`
  - Test: L21a `func (s Stack[T]) Wrap() Stack[[]T]` and L21b body `Stack[[]T]{}` → `assertErrorContains(errors, "instantiation cycle")` on all targets (no stack overflow, no monomorph limit error).
  - Done when: both give the diagnostic in < 1 s.
- [x] Task 4.2: Infer type arguments from pointer arguments
  - Files: `src/typechecker/expressions.js`, `test/unit/types/inference.test.js`
  - Test: L38 `swap(&x, &y)` → `2 1`; `func f[T any](p **T)` with `&&x`-equivalent infers `int`.
  - Done when: repro runs on all targets.
- [x] Task 4.3: Conversions to `T` inside methods of generic types
  - Files: `src/typechecker/expressions.js`, `src/typechecker/types.js`, `test/unit/types/generics.test.js`
  - Test: L48 `Box[float64]{}.Scaled(3)` → `6`; `func a[T any](n int) T { return T(n) }` still → `cannot convert`.
  - Done when: repro runs on all targets; negative keeps its error.
- [x] Task 4.4: Promotion through embedded generic instances
  - Files: `src/typechecker/types.js`, `src/lower/embedding.js`, `src/backend/wasm/emit-exprs.js`
  - Test: `test/unit/types/generics.test.js` — L15 `W{Inner[int]}.Get()` → `0`; L10b `P[string]{&Inner[string]{"x"}}.v` → `x`; L111 `Deep{}.Hello()` two levels → `1` (all targets).
  - Done when: all three run on js/both/wasm.

### Phase 5: JS Types, Aliases and Packages

- [x] Task 5.1: Package-qualified type identity and JS names
  - Files: `src/backend/js/index.js`, `src/typechecker/assignability.js`, `test/unit/compiler/packages.test.js`
  - Test: L19 `a.Pt{1}`, `b.Pt{"y"}` from main → `{1} {y}`; L19b `var x Box[a.Pt]; x = Box[b.Pt]{}` → `assertErrorContains(errors, "cannot use")`.
  - Done when: multi-package repro runs (js and hybrid); identity check rejects the mixed assignment.
- [x] Task 5.2: Aliases of struct types in JS
  - Files: `src/backend/js/expressions.js`, `src/backend/js/index.js`, `test/unit/language/declarations.test.js`
  - Test: L22a `A{3}` → `{3}`; L22b `A{V: 3}.Get()` → `3`; L22c copy → `{1} {2}`; L22d `W{A{5}}.V` → `5` (js and both; wasm pinned).
  - Done when: all four run on all targets.
- [x] Task 5.3: Defined types over generic instances and aliases keep fields
  - Files: `src/backend/js/index.js`, `src/typechecker/resolve.js`, `test/unit/language/named-type-methods.test.js`
  - Test: L17a `type S Base[int]` → `3 {3} 3`; L17b `type T A` (`A = Base`) → `3 {3}`.
  - Done when: both run on all targets.
- [x] Task 5.4: `%T` names of generic instances
  - Files: `src/typechecker/types.js`, `src/backend/shared/fmt-types.js`, `test/unit/wasm/generics.test.js`
  - Test: L136 `Printf("%T", Box[int]{})` → `main.Box[int]` on all targets (also `Pair[string, int]`).
  - Done when: repro prints Go's text on all targets.

### Phase 6: JS Statements, Scoping and Evaluation Order

- [x] Task 6.1: `else if` init statements
  - Files: `src/backend/js/statements.js`, `test/unit/language/control-flow.test.js`
  - Test: L23 → `elif`; a new name declared in the init is scoped to the chain.
  - Done when: repro prints `elif` on js/both.
- [x] Task 6.2: Shadowing declarations that read the outer name
  - Files: `src/backend/js/statements.js`, `test/unit/types/shadowing.test.js`
  - Test: L24 `{ k, ok := m[k]; … }` → `7 true`; L144 `switch x := x + 1; x {…}` → `two`; plus `for n := n; …` and a `case` body `x := f(x)`.
  - Done when: no TDZ ReferenceError for the four forms on js/both.
- [x] Task 6.3: Comma-ok `:=` that reuses an existing name
  - Files: `src/backend/js/statements.js`, `test/unit/types/shadowing.test.js`
  - Test: L43 → `<nil> false`; L107 → `1 true true`.
  - Done when: both run on js/both.
- [x] Task 6.4: Tuple assignment evaluates nested index operands first
  - Files: `src/lower/index.js`, `src/backend/js/statements.js`, `src/backend/wasm/emit-stmts.js`
  - Test: `test/unit/language/value-semantics.test.js` — L37 `n, ps[n].A = 1, 50` → `[{50} {0}]` on all targets.
  - Done when: repro matches Go on js/both/wasm.
- [x] Task 6.5: Package init order through interface method calls
  - Files: `src/typechecker/init-order.js`, `test/unit/language/init-order.test.js`
  - Test: L115 `var viaIface = iface.Get()` reading a later var → `5`.
  - Done when: repro prints `5` on all targets.

### Phase 7: JS Nil Semantics

- [x] Task 7.1: Nil pointer receivers through interfaces, method values and expressions
  - Files: `src/backend/js/expressions.js`, `src/backend/js/runtime.js`, `test/unit/language/pointers.test.js`
  - Test: L25 → `0 0 0`; L103 → `true e`; L132 → `-1`; L137 value method on nil `*S` via interface → recovered `invalid memory address or nil pointer dereference` (js and both; wasm half is Task 13.3).
  - Done when: four repros match Go on js/both.
- [x] Task 7.2: Nil dereference panics instead of TypeErrors
  - Files: `src/backend/js/expressions.js`, `src/backend/js/statements.js`, `test/unit/compiler/strict-panics.test.js`
  - Test: L26 (`js` target), L32a, L32b, L123a, L123b, L123c → recovered `runtime error: invalid memory address or nil pointer dereference` on js/both.
  - Done when: all six recover Go's message on js/both.
- [x] Task 7.3: Nil conversions produce nil values
  - Files: `src/backend/js/expressions.js`, `test/unit/language/core.test.js`
  - Test: L30a `error(nil) == nil` → `true`; L65 `Println(error(nil))` → `<nil>`; L30b `map[string]int(nil)` → `0 true`.
  - Done when: three repros match Go on js/both.
- [x] Task 7.4: Nil slices stay nil through `make` elements, struct zeroes and `append`
  - Files: `src/backend/js/expressions.js`, `src/backend/js/runtime.js`, `test/unit/language/value-semantics.test.js`
  - Test: L30c `make([][]int, 2)` → `[[] []]`; L66 `A{}` → `{[]}`; L34 → `true`; L100 → `true true`.
  - Done when: four repros match Go on js/both.

### Phase 8: JS Numeric Semantics and Strict Checks

- [x] Task 8.1: Negative shift counts on narrow integers panic
  - Files: `src/backend/js/expressions.js`, `test/unit/builtins/operators.test.js`
  - Test: L33 `var x int32 = 5; x << n` (`n := -1`) → recovered `runtime error: negative shift amount` for `int32`, `int16`, `int8`, `uint8`.
  - Done when: all four widths panic on js/both.
- [x] Task 8.2: Generic arithmetic wraps and truncates for the instantiated integer type
  - Files: `src/backend/js/expressions.js`, `test/unit/types/generics.test.js`
  - Test: L46a `Half[int](9)`, `Wrap[uint8](255)` → `4 0`; L93 `Gen(uint8(0))` → `255`. Builds on the per-`T` metadata stdlib-in-go added.
  - Done when: repros match Go on js/both; non-integer `T` unchanged.
- [x] Task 8.3: `float32` arithmetic rounds in `js` packages
  - Files: `src/backend/js/expressions.js`, `test/unit/builtins/operators.test.js`
  - Test: L75 `float32(1)/3` → `0.33333334` in a `js` package.
  - Done when: repro matches Go on js (both pinned).
- [x] Task 8.4: Untyped constants in complex context
  - Files: `src/backend/js/expressions.js`, `test/unit/types/complex.test.js`
  - Test: L99 `return 1` from `complex128` func → `(1+0i)`; `var c complex128 = 5; c = 7; c == 7; c*2` → `(7+0i) true (14+0i)`.
  - Done when: repro matches Go on js/both.
- [x] Task 8.5: Elide redundant strict nil checks
  - Files: `src/backend/js/expressions.js`, `src/lower/bounds.js`, `test/unit/compiler/strict-mode.test.js`
  - Test: L170 `TransformMat4` in a `both` package → emitted JS contains no `__nilcall(out)` (receiver alias of `this`) and at most one `__nilcall(a)`; a nil `a` still panics with Go's message.
  - Done when: counts hold; strict-panics tests stay green.

### Phase 9: JS Dynamic Types and Assertions

- [x] Task 9.1: Boxed values in `any` keep their dynamic type
  - Files: `src/backend/js/type-info.js`, `src/backend/js/runtime.js`, `test/unit/language/parity-matrix.test.js`
  - Test: L101a `any(map[string]int(nil)) == nil` → `false`; L101c typed nil pointer in `any` `== nil` → `false`; L45c `error(many{})` keeps `many`'s method set → `true`.
  - Done when: repros match Go on js/both.
- [x] Task 9.2: Assertions and type switches match Go's type identity
  - Files: `src/backend/js/type-info.js`, `src/backend/js/statements.js`, `test/unit/types/checks.test.js`
  - Test: L47 → `false`; L120 → `namer`; L155 → `map`; L154 (js half) → `i32`; L104b → `false`; L44b (js half) → `T str`.
  - Done when: six repros match Go on js/both.
- [x] Task 9.3: Method calls through constraints on named non-struct types
  - Files: `src/backend/js/expressions.js`, `test/unit/types/generics.test.js`
  - Test: L69 `S(Color(2))` → `col`; same for a named slice type with a method.
  - Done when: repro matches Go on js/both.

### Phase 10: JS Map Keys

- [x] Task 10.1: Typed key decoding in `range` (generic and non-generic)
  - Files: `src/backend/js/statements.js`, `src/lower/range.js`, `test/unit/wasm/maps.test.js`
  - Test: L42a `k + 1` over `map[int]string` → `2`; float keys likewise; a generic `Keys` over `map[int]int` returns ints.
  - Done when: repros match Go on js/both.
- [x] Task 10.2: Composite key encoding (structs, arrays, non-finite floats)
  - Files: `src/backend/js/runtime.js`, `test/unit/wasm/maps.test.js`
  - Test: L42b → `2`; L42c → `map[[1 2]:a]`; L51 `±Inf` struct keys → `2`; L86 → `map[{-1}:1 {5}:2]`.
  - Done when: repros match Go on js/both; no `JSON.stringify` on key values remains.
- [x] Task 10.3: Pointer and interface keys
  - Files: `src/backend/js/runtime.js`, `src/backend/js/expressions.js`, `test/unit/wasm/maps.test.js`
  - Test: L52 → `2`; L54 (js) → `0 false`; L55 → `true`; L60a → `2`; L60b → recovered `runtime error: hash of unhashable type []int` (wasm message gains the type too); L101b → `2`.
  - Done when: six repros match Go on js/both (L60b also wasm).
- [x] Task 10.4: Map printing uses Go's key order and text
  - Files: `src/backend/js/fmt-runtime.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test: L59b `map[any]int` with `int`, `string` and named-string keys → `map[1:3 1:2 1:1]`; L87 → `map[B:3 a:2 b:1]` (all targets).
  - Done when: both repros match Go on all targets.

*Phase 10 notes: the generic `Keys` half of L42a, L42b and the `both` half of L54 no longer reproduced on the base and were skipped (covered by existing behaviour); tests live in `test/unit/wasm/maps.test.js`.*

### Phase 11: fmt Verbs (Both Backends)

- [x] Task 11.1: Round-half-even precision and bad-verb float text
  - Files: `src/backend/js/fmt-runtime.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test: L61 `%.0f|%.1f|%.1v` of `2.5, 0.25, 2.5` → `2|0.2|2`; L72a `%d` of `1e-7` → `%!d(float64=1e-07)`; L72b `%d` of `+Inf` → `%!d(float64=+Inf)`.
  - Done when: three repros match Go on all targets.
- [x] Task 11.2: Width applies per element of composites
  - Files: `src/backend/js/fmt-runtime.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test: L77 `%5v|%-5v` of `[]int{1}` → `[    1]|[1    ]`; maps and structs likewise.
  - Done when: repro matches Go on all targets.
- [x] Task 11.3: Nil pointer, interface and map operands
  - Files: `src/backend/js/fmt-runtime.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test: L63 `%d` of nil `*C` → `0`; L64 → `%!s(<nil>)|<nil>|%!d(<nil>)`; L73 `%#v` of nil map → `map[string]int(nil)`.
  - Done when: three repros match Go on all targets.
- [x] Task 11.4: Pointer and func identity (`%p`, `%d`, `%v`, `%T` of funcs)
  - Files: `src/backend/js/fmt-runtime.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test: L91 distinct pointers to equal structs → different `%p`, same pointer twice → equal; L82 `%d` of `&x` → decimal digits only; L83 `%v` of a func → `0x` + hex id, `%T` → `func()`; L96 `Sprint(f, 1)` → contains a space; L97 `%p` of pointer in `any` → `0x…`.
  - Done when: five repros satisfy the properties on all targets.

### Phase 12: fmt Typed Values

- [x] Task 12.1: `%T` and `%v` use static types through `any` and type parameters
  - Files: `src/backend/shared/fmt-types.js`, `src/backend/js/fmt-runtime.js`, `src/backend/wasm/stdlib/core.js`
  - Test: `test/unit/builtins/fmt-verbs.test.js` — L50 `%T` of `any(N(1))` → `main.N`; L85/L102 → `uint64 main.Color *main.P`; L68a → `[]int map[string]int`; L70 `any(float32(0.1))` → `0.1`; L78 → `*main.Color %!q(*main.Color=<nil>)`.
  - Done when: six repros match Go on all targets.
- [x] Task 12.2: Nil pointers with pointer-receiver `String` keep their type
  - Files: `src/backend/js/fmt-runtime.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/builtins/fmt-stringer.test.js`
  - Test: L62 nil `*G[int]` in `any` → `g`, `Sprint([]any{nilC})` → `[c]`; L95 `Println(nilp())` → `P* <nil>`.
  - Done when: repros match Go on all targets.
- [x] Task 12.3: Multi-value calls as the whole argument list
  - Files: `src/backend/js/expressions.js`, `src/backend/wasm/emit-builtins.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test: L89 `Printf(fa())` → `v=5`; L90 `Fprint(fw())` → `hello`; L94 `Println(c())` (`(any, int)`, struct) → `{1} 1`.
  - Done when: three repros match Go on all targets; WASM validates.
- [x] Task 12.4: `%#v` of maps inside `any` in JS
  - Files: `src/backend/js/fmt-runtime.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test: L67 → `main.M{M:map[string]int{"k":1}}`.
  - Done when: repro matches Go on js/both.

### Phase 13: WASM Interfaces and Type Switches

- [x] Task 13.1: Type switches with `case nil` and interface cases
  - Files: `src/backend/wasm/types.js`, `src/backend/wasm/emit-stmts.js`, `test/unit/wasm/interfaces.test.js`
  - Test: L11 → `nil`; L53 `case error:` on `any` → `d`.
  - Done when: both compile, validate and match Go.
- [x] Task 13.2: Type identity of defined and generic types (L154 slice identity deferred, see Excluded: deferred)
  - Files: `src/backend/wasm/types.js`, `src/backend/wasm/monomorph.js`, `test/unit/wasm/interfaces.test.js`
  - Test: L44a/L98 `type L string` cases → `L string`; L44b (wasm) → `T str`; L44c `conv[Small](130)` → `-126`; L154 (wasm) → `i32`; L104a `a.(iter.Seq[int])` → `true`.
  - Done when: five repros match Go on wasm.
- [x] Task 13.3: Typed nil pointers inside interfaces
  - Files: `src/backend/wasm/emit.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/wasm/interfaces.test.js`
  - Test: L103 → `true e`; L132 → `-1`; L137 → recovered `invalid memory address or nil pointer dereference`; L25 (wasm) → `0 0 0`; L105 `errors.As` with typed nil → `true` (js too).
  - Done when: five repros match Go on wasm (L105 also js/both).
- [x] Task 13.4: Dispatch on named func/map types and method values from interfaces
  - Files: `src/backend/wasm/emit.js`, `src/backend/wasm/method-expr.js`, `src/backend/js/expressions.js`
  - Test: `test/unit/wasm/interfaces.test.js` — L138 → `3 1`; L117 `f := n.Name; f()` → `a` (all targets).
  - Done when: both repros match Go on all targets.
- [x] Task 13.5: Runtime panics recover as `error` values
  - Files: `src/backend/wasm/module-emitter.js`, `src/backend/js/runtime.js`, `test/unit/wasm/defer_recover.test.js`
  - Test: L133 `recover().(error)` after index out of range → `true`; `.Error()` → Go's text.
  - Done when: repro matches Go on all targets.

### Phase 14: WASM Locals, Captures and Multi-value Targets

- [x] Task 14.1: Shadowing and captured locals
  - Files: `src/lower/captures.js`, `src/backend/wasm/emit-stmts.js`, `test/unit/wasm/closures.test.js`
  - Test: L27 → `9 7`; L113 → `9`; L118 → `2 0`.
  - Done when: three repros validate and match Go.
- [x] Task 14.2: Type switch bindings that shadow or are captured
  - Files: `src/backend/wasm/emit-stmts.js`, `src/backend/js/statements.js`, `test/unit/wasm/closures.test.js`
  - Test: L119 → `4` (js/both `NaN` today); L141 → `3`.
  - Done when: both repros match Go on all targets.
- [x] Task 14.3: Multi-value assignment into blank, computed and interface targets
  - Files: `src/backend/wasm/emit-stmts.js`, `test/unit/wasm/go_semantics.test.js`
  - Test: L28 `var _, y = two()` → `2`; L122 → `[5 3] [true true]`; L142 → `1 a`.
  - Done when: three repros validate and match Go.
- [x] Task 14.4: Deferred closures in switch clauses inside loops
  - Files: `src/lower/captures.js`, `src/backend/wasm/emit-stmts.js`, `test/unit/wasm/defer_recover.test.js`
  - Test: L140 → `deferred2 1` then `deferred zero`.
  - Done when: repro validates and matches Go.

### Phase 15: WASM Control Flow and Evaluation Order

- [x] Task 15.1: Labeled `break` out of nested switches
  - Files: `src/backend/wasm/emit-stmts.js`, `test/unit/wasm/go_semantics.test.js`
  - Test: L139 → `end` only; labeled `continue` from a nested switch in a loop.
  - Done when: repro matches Go on wasm.
- [x] Task 15.2: Switch case lists short-circuit; struct-valued tags compare by value
  - Files: `src/backend/wasm/emit-stmts.js`, `src/backend/js/statements.js`, `test/unit/language/control-flow.test.js`
  - Test: L130 → `g 5`, `g 1`, `g 5` (no `g 6`); L129 `switch p { case P{1, 2}: }` → `p12` (all targets).
  - Done when: both repros match Go on all targets.
- [x] Task 15.3: Call arguments evaluate before output; panics leave no partial line
  - Files: `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/wasm/go_semantics.test.js`
  - Test: L131 → `h1;h3;1 3`; S07 `fmt.Println(next("a"), next("b"))` → `ab1 1`; L143 → `|` only.
  - Done when: all three repros match Go on wasm.

### Phase 16: Element Pointers, Value Copies and WASM Values

- [x] Task 16.1: Element pointers survive whole-element stores
  - Files: `src/backend/js/statements.js`, `src/backend/wasm/emit-stmts.js`, `src/lower/ownership.js`, `src/lower/index.js`, `test/unit/language/pointers.test.js`
  - Test: L35a pointer from a callee → `9`; L35b tuple swap → `3`; L41 reslice + append + call index → `7` (all targets). Whole-element stores into slices write in place only when the program takes some `&xs[i]` (`takesElementAddress`); L41 as logged already matched Go on `ea3231a`, so the test uses the reslice + append form that did not (`xs = xs[:1]; xs = append(xs, S{5}); xs[idx()] = S{7}` → `7`).
  - Done when: three repros match Go on all targets.
- [x] Task 16.2: Struct values copied out of maps, `range` keys and boxed operands
  - Files: `src/backend/wasm/emit-stmts.js`, `src/backend/js/statements.js`, `src/backend/js/expressions.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/language/value-semantics.test.js`
  - Test: L49 → `map[{a 1}:2]`; L127 → `{1 1}` (all targets); L106 `Println(w, copy(w, p))` → `[97 98 99] 3`.
  - Done when: three repros match Go on all targets.
- [x] Task 16.3: Recoverable nil writes and pointer-to-pointer on WASM
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/emit-stmts.js`, `src/backend/wasm/emit.js`, `src/backend/wasm/emit-builtins.js`, `src/typechecker/resolve.js`, `test/unit/wasm/traps.test.js`
  - Test: L123a–c and L32a (wasm) → recovered `invalid memory address or nil pointer dereference` (also `*p++`, `*p += 2`, `for i, v := range ap`); `for i := range ap` and `len(ap)` on a nil array pointer do not panic in Go (`0 1 2`, `3`); L126 `**pp` → `9` (`new(*int)` was typed `*any`).
  - Done when: no uncatchable trap; repros match Go on wasm.
- [x] Task 16.4: Complex struct fields and string zero values
  - Files: `src/backend/wasm/module-emitter.js`, `src/backend/wasm/emit.js`, `src/backend/wasm/emit-builtins.js`, `test/unit/wasm/structs.test.js`
  - Test: L112 `s.C = complex(1, 1)` → `(1+1i)`; L125 `[2]string`, `make([]string, 2)` → `[ ] [ ]`.
  - Done when: both repros validate and match Go.

### Phase 17: WASM Printing and Imports

- [x] Task 17.1: Interface values inside containers print their dynamic value
  - Files: `src/backend/wasm/prescan.js`, `src/backend/wasm/stdlib/core.js`, `src/backend/wasm/emit-builtins.js`, `test/unit/wasm/fmt-any.test.js`
  - Test: L71 `[]any{A{1}}` → `[{1}]`; L76 → `[er:x] [vs] [vs]`; L79 `[]any{&a}` → `[ps]`.
  - Done when: three repros match Go on wasm.
- [x] Task 17.2: Builtin `print`/`println` follow the spec
  - Files: `src/backend/wasm/emit-builtins.js`, `src/backend/wasm/types.js`, `src/backend/wasm/module-emitter.js`, `src/backend/wasm/prescan.js`, `src/backend/wasm/boundary.js`, `src/backend/js/expressions.js`, `test/unit/wasm/scalars.test.js`
  - Test: L81 `println(uint32(4000000000))` → `4000000000`; L88 `print("a","b",1,2)` → `ab12` (all targets).
  - Done when: both repros match Go on all targets.
  - Also: a `uint64` prints unsigned (`println_u64`); `print` ends each operand with `print_reset` so a following `println` keeps its own spacing.
- [x] Task 17.3: Import `fmt_box_u64` only when a 64-bit unsigned value reaches `any`
  - Files: `src/backend/wasm/prescan.js`, `test/unit/wasm/golden.test.js`
  - Test: L92 `func g(x any){}; g(1)` → module imports exclude `fmt_box_u64`; `g(uint64(1))` still imports it and prints correctly.
  - Done when: import list assertion passes.
  - Note: the scan keys on any expression whose static type holds a 64-bit unsigned integer, not on call arguments, so function trampolines with `any` parameters no longer trigger the import.

### Phase 18: WASM Facade

- [x] Task 18.1: Qualified stdlib types in facade identifiers
  - Files: `src/backend/wasm/boundary.js`, `test/unit/wasm/boundary.test.js`
  - Test: L16 exported struct with a `strings.Builder` (and `*strings.Reader`) field → `2` from a js main (`compileHybridProject`).
  - Done when: facade parses and runs.
- [x] Task 18.2: Generic instances in the facade
  - Files: `src/backend/wasm/boundary.js`, `src/backend/wasm/module-emitter.js`, `test/unit/wasm/boundary.test.js`
  - Test: L121 js main `g.Take(g.Box[int]{V: 4})` → `4`; L135a `Mp() map[string]G[TB]` → `2`; L135b embedded `G[int]` → `e.Get()` = `5`.
  - Done when: three hybrid repros run.

### Phase 19: JSON on the JS Backend

- [ ] Task 19.1: Decoding continues past type errors; map keys and reuse
  - Files: `src/backend/js/stdlib/json.js`, `src/lower/json-codecs.js`, `test/unit/builtins/json.test.js`
  - Test: L145 → `… R.F of type float64 true [1 0]`; L146 → `json: cannot unmarshal number x into Go value of type int 0`; L161 → `map[a:1 keep:1]`; L162 → `"1"`.
  - Done when: four repros match Go on js/both.
- [ ] Task 19.2: Encoding values in `any` from their static type
  - Files: `src/lower/json-codecs.js`, `src/backend/js/stdlib/json.js`, `test/unit/builtins/json.test.js`
  - Test: L149a → `[1,2,3]`; L149b → `5`; L149c → `0.1`; L163a → `12`; L163b → `[1]`; L152 → `"t-x"`; L167a/b → `json: unsupported type: func()`; L168 → `json: unsupported type: map[bool]int`.
  - Done when: repros match Go on js/both.
- [ ] Task 19.3: Codecs for anonymous and function-local struct types
  - Files: `src/lower/json-codecs.js`, `test/unit/builtins/json.test.js`
  - Test: L148a → `Go struct field .Nest.X`; L148b → `{"a":1}`; L148c → the type error on all targets (no "please report"); L158 → `{"X":1} {"Y":"y"}`; L169 → `{"A":null} {"S":1}`.
  - Done when: repros match Go on all targets; WASM validates.
- [ ] Task 19.4: Error messages match Go
  - Files: `src/backend/js/stdlib/json.js`, `stdlib/internal/jsonrt`, `test/unit/builtins/json.test.js`
  - Test: L147 → `…unmarshal "\"x\"" into Number`; L156 → `non-pointer int`; L157 → `json: Unmarshal(nil *main.Item)` (all targets).
  - Done when: three repros match Go on all targets.

### Phase 20: JSON on the WASM Backend

- [ ] Task 20.1: Dynamic types in `any`
  - Files: `src/lower/json-codecs.js`, `stdlib/internal/jsonrt`, `test/unit/wasm/json.test.js`
  - Test: L150a → `[1]`; L150b → `1`; L163a → `12`; L151a → `"AQ==" [true]`; L151b → `[97,98]`; L152 → `"t-x"`; L159 → `[1,2,3] [4,5]`.
  - Done when: seven repros match Go on wasm.
- [ ] Task 20.2: Generic structs and generic decode targets
  - Files: `src/lower/json-codecs.js`, `test/unit/wasm/json.test.js`
  - Test: L153 `Marshal(Box[int]{2})` in a both/wasm package → `{"V":2}`; L166 `Dec(&x)` → `<nil> 1`.
  - Done when: both repros match Go on all targets.
- [ ] Task 20.3: `**T` struct fields; docs
  - Files: `src/lower/json-codecs.js`, `docs/go-compatibility.md`, `test/unit/wasm/json.test.js`
  - Test: L160 `S{P **int}` ← `{"P":1}` → `<nil> 1` (all targets).
  - Done when: repro matches Go; the JSON row of `docs/go-compatibility.md` drops every limitation fixed in Phases 19–20.

### Phase 21: Templ and Tooling

- [ ] Task 21.1: Every Go `for` form in templ bodies
  - Files: `src/backend/js/templ.js`, `src/parser/templ.js`, `src/lexer/templ-lexer.js`
  - Test: `test/unit/compiler/templ.test.js` — L172 map → one `<b>` per key; L173 three-clause → `n` `<p>`; L174 composite literal header → `<p>1</p>`; L175 `for range xs` → two `<p>` (terminates); L176 `range n` → `0..n-1`; L177 string → byte index + rune pairs; L185 index-only → `0`,`1` and `i, _` → `1`,`2`.
  - Done when: seven repros render Go's output; `_genTemplFor` heuristics removed.
- [ ] Task 21.2: Tagless switch and conditional attribute types
  - Files: `src/backend/js/templ.js`, `src/typechecker/statements.js`, `test/unit/compiler/templ.test.js`
  - Test: L178 → `big`; L180 `hidden?={ name }` → `assertErrorContains(errors, "must be bool")`.
  - Done when: both behave as specified.
- [ ] Task 21.3: Templ expression positions and trailing tokens
  - Files: `src/parser/templ.js`, `src/compiler.js`, `test/unit/compiler/templ.test.js`
  - Test: L171 error on line 3 of `v.templ` → message contains `v.templ at line 3:`; L179 `{ name ) }` → parse error.
  - Done when: both repros yield the specified diagnostics.
- [ ] Task 21.4: Variadic slots: nil spread and any parameter name; docs
  - Files: `src/backend/js/templ.js`, `docs/language-support.md`, `test/unit/compiler/templ.test.js`
  - Test: L181 `W(ns...)` nil → `<div></div>`; L182 `items...` → both `<i>` mounted.
  - Done when: repros render as specified; the templ `for` row in `docs/language-support.md` lists all forms as supported.
- [ ] Task 21.5: `check-layers` reports a missing root
  - Files: `scripts/check-layers.js`, `test/unit/compiler/check-layers.test.js`
  - Test: L189 `node scripts/check-layers.js no-such-dir` → stderr `check-layers: cannot read no-such-dir/.sentrux/rules.toml`, exit 1, no stack trace.
  - Done when: test passes.

### Phase 22: Lexer, Parser and Literals (stdlib-in-go Follow-ups)

*Phases 22–27 were scheduled on 2026-11-03 from the 34 review follow-ups logged in [`stdlib-in-go-plan.md`](stdlib-in-go-plan.md) (see Verified Gaps → Review follow-ups from stdlib-in-go).*

- [ ] Task 22.1: Lexer: astral rune literals and raw-byte `\xNN` string escapes
  - Files: `src/lexer/lexer.js`, `src/backend/js/expressions.js`, `test/unit/compiler/lexer-parser.test.js`
  - Test: S19 `r := '😀'; fmt.Println(r)` → `128512` on all targets; S15 `b := []byte("a\xffb"); fmt.Println(len(b), bytes.IndexRune(b, utf8.RuneError))` → `3 1` on all targets; multi-rune literals `'ab'` still error.
  - Done when: both repros match Go on js/both/wasm; negative rune-literal tests stay green.
- [ ] Task 22.2: Parser: conversion-led index expressions in call arguments and `//gofront:native` before doc comments
  - Files: `src/parser/expressions.js`, `src/parser/declarations.js`, `test/unit/compiler/lexer-parser.test.js`
  - Test: S33 `f(byte(digits[uint(u)&m]))` → `51` on all targets; S06 `//gofront:native str.Index` separated from `func Index` by a `//` doc comment sets `decl.native === "str.Index"`.
  - Done when: both repros pass on all targets.
- [ ] Task 22.3: Parser and typechecker: lone pointer type arguments in generic instantiation (`Id[*int]`)
  - Files: `src/parser/expressions.js`, `src/typechecker/expressions.js`, `test/unit/parser/generics.test.js`
  - Test: S03 `func Id[T any](x T) T { return x }; f := Id[*int]; x := 4; fmt.Println(*f(&x))` → `4` on all targets; `Id[*int](&x)` direct call also works.
  - Done when: both forms compile and run on js/both/wasm.
- [ ] Task 22.4: Constant folding: exact untyped float addition and subtraction
  - Files: `src/typechecker/const-fold.js`, `test/unit/language/constants.test.js`
  - Test: S31 `fmt.Println(0.2 + 0.1)` → `0.3` on all targets; `const c = 0.2 + 0.1; fmt.Println(c == 0.3)` → `true`.
  - Done when: both repros match Go on all targets.

### Phase 23: Typechecker Rules for Strings, Maps and Type Parameters

- [ ] Task 23.1: String indexing yields `byte` (`uint8`)
  - Files: `src/typechecker/expressions.js`, `test/unit/types/checks.test.js`
  - Test: S29 `func cp(b byte) bool { return b == 46 }; func f(s string) bool { return cp(s[0]) }; var c byte = "."[0]; fmt.Println(f("."), c)` → `true 46` on all targets.
  - Done when: repro compiles and runs on all targets; `npm test` and `npm run check` stay green.
- [ ] Task 23.2: Reject `cap(m)` on maps
  - Files: `src/typechecker/expressions.js`, `test/unit/types/checks.test.js`
  - Test: S05 `var m map[string]int; _ = cap(m)` → `assertErrorContains(errors, "invalid argument: m (variable of type map[string]int) for cap")`; `len(m)` and `cap(s)` on slices/arrays stay valid.
  - Done when: `cap(m)` is rejected on all targets with Go's message.
- [ ] Task 23.3: Type-parameter constraints referencing later type parameters in the same list
  - Files: `src/typechecker/resolve.js`, `src/typechecker/expressions.js`, `test/unit/types/generics.test.js`
  - Test: S04 `type SliceIface[E any] interface { ~[]E }; func F[S SliceIface[E], E any](s S) E { return s[0] }; fmt.Println(F([]int{7}))` → `7` on all targets.
  - Done when: repro compiles, infers `E`, and runs on js/both/wasm.
- [ ] Task 23.4: 64-bit untyped constant map keys (`1 << 60`)
  - Files: `src/typechecker/const-fold.js`, `src/backend/js/expressions.js`, `test/unit/wasm/maps.test.js`
  - Test: S02 `m := map[int64]string{1 << 60: "hello"}; fmt.Println(m[1<<60])` → `hello` on all targets (also `map[uint64]int{1 << 63: 9}`).
  - Done when: both map-key repros match Go on js/both/wasm.

### Phase 24: JS Statements, 64-bit Numerics and Nil Method Calls

- [ ] Task 24.1: Evaluate 64-bit `/` and `%` operands once in JS
  - Files: `src/backend/js/expressions.js`, `src/backend/js/runtime.js`, `test/unit/builtins/operators.test.js`
  - Test: S01 `count := 0; f := func() int64 { count++; return 2 }; _ = int64(10) / f(); _ = int64(10) % f(); fmt.Println(count)` → `2` (1 per op) on js/both/wasm; same for `uint64`.
  - Done when: side-effecting divisors and dividends evaluate once on all targets.
- [ ] Task 24.2: Untyped constants shifted by a variable in 64-bit context emit BigInt
  - Files: `src/backend/js/expressions.js`, `src/typechecker/expressions.js`, `test/unit/builtins/operators.test.js`
  - Test: S32 `k := uint(3); var m uint64 = (1 << k) - 1; var n uint64 = 5; fmt.Println(n & m)` → `5` on js/both/wasm; `int64(1) << k` and `(1 << k)` assigned to `int64` likewise.
  - Done when: repros run without `Cannot mix BigInt and other types` on js/both.
- [ ] Task 24.3: Integer compound division `/=` in `for` post statements truncates
  - Files: `src/backend/js/statements.js`, `test/unit/language/loops.test.js`
  - Test: S28 `w := 345; for ; w > 100; w /= 10 {}; fmt.Println(w)` → `34` on js/both/wasm.
  - Done when: repro prints `34` on all targets.
- [ ] Task 24.4: Multi-value assignment into dereferenced pointers (`*p, err = f()`) and shadowed named results in loops
  - Files: `src/backend/js/statements.js`, `test/unit/language/pointers.test.js`
  - Test: S30 `*p, err = f()` → `9 <nil>` on js/both/wasm; S11 `func f() (err error)` assigning `err = nil` then shadowing `_, err := g()` inside a loop → `<nil>` on js/both/wasm.
  - Done when: both repros compile and match Go on all targets.
- [ ] Task 24.5: Direct method calls on nil pointers to Go-source struct types in JS
  - Files: `src/backend/js/expressions.js`, `src/backend/js/index.js`, `test/unit/stdlib/bytes.test.js`
  - Test: S16 `var b *bytes.Buffer; fmt.Println(b.String())` → `<nil>` on js/both/wasm.
  - Done when: repro prints `<nil>` on all targets.

### Phase 25: Runtime Panics, Rune Conversions and WASM Unsigned Division

- [ ] Task 25.1: Invalid rune-to-string conversion yields `U+FFFD`
  - Files: `src/backend/js/expressions.js`, `src/backend/wasm/boundary.js`, `test/unit/stdlib/utf8.test.js`
  - Test: S10 `x := rune(-1); fmt.Println(string(x) == "\ufffd")` and `string(rune(0x110000)) == "\ufffd"` and surrogate `string(rune(0xD800)) == "\ufffd"` → `true` on js/both/wasm.
  - Done when: out-of-range and surrogate runes convert to `"\ufffd"` without throwing on all targets.
- [ ] Task 25.2: `make([]T, n)` with negative `n` panics with Go's message in JS
  - Files: `src/backend/js/expressions.js`, `src/backend/js/runtime.js`, `test/unit/compiler/strict-panics.test.js`
  - Test: S26 `func f(n int) []int { return make([]int, n) }` with `f(-1)` and `make([]int, 0, -1)` recovered → `runtime error: makeslice: len out of range` / `cap out of range` on js/both/wasm.
  - Done when: both negative `len` and `cap` panic with Go's message on js/both.
- [ ] Task 25.3: `panic` and `recover` preserve non-string error values in JS
  - Files: `src/backend/js/statements.js`, `src/backend/js/runtime.js`, `test/unit/wasm/defer_recover.test.js`
  - Test: S27 `type rt string; func (e rt) Error() string { return "boom" }; defer func() { fmt.Println(recover()) }(); panic(error(rt("q")))` → `boom` on js/both/wasm; `recover().(rt)` is `rt("q")`.
  - Done when: non-string error values survive `panic`/`recover` on js/both.
- [ ] Task 25.4: WASM untyped constant `/` and `%` with unsigned right operand divide unsigned
  - Files: `src/backend/wasm/emit-exprs.js`, `test/unit/wasm/scalars.test.js`
  - Test: S25 `n := int32(10); fmt.Println((1<<31)%uint32(n), (1<<31)/uint32(n))` → `8 214748364` on js/both/wasm (also `uint64`).
  - Done when: repro matches Go on wasm.
- [ ] Task 25.5: WASM host imports raise recoverable Go panics
  - Files: `src/backend/wasm/boundary.js`, `src/backend/wasm/glue.js`, `test/unit/wasm/defer_recover.test.js`
  - Test: S20 a host import throwing inside a `defer` + `recover()` frame in a `wasm` package is caught by `recover()` and returns the error message.
  - Done when: test passes on wasm.

### Phase 26: `fmt`, `errors.As` and `encoding/binary` Emitter Parity

- [ ] Task 26.1: `fmt.Fprint` spacing between non-string operands and `%#v` `GoStringer` dispatch
  - Files: `src/backend/js/stdlib/fmt.js`, `src/backend/js/fmt-runtime.js`, `src/backend/wasm/stdlib/core.js`
  - Test: `test/unit/stdlib/fmt.test.js` — S14 `n, _ := fmt.Fprint(&sb, "b", 2, 3, "c"); fmt.Println(n, sb.String())` → `5 b2 3c`; S23 `type T struct{}; func (T) GoString() string { return "pkg.T" }; fmt.Printf("%#v\n", T{})` → `pkg.T` on all targets.
  - Done when: both repros match Go on js/both/wasm.
- [ ] Task 26.2: WASM `errors.As` walks multi-error (`Unwrap() []error`) trees and matches named basic error types
  - Files: `src/backend/wasm/stdlib/core.js`, `test/unit/stdlib/errors.test.js`
  - Test: S09 `errors.As(errors.Join(e1, fmt.Errorf("n: %w", NotFound{"z"})), &nf)` → `true z`; S22 `type E byte; func (E) Error() string { return "E" }; var t E; fmt.Println(errors.As(error(E(7)), &t), byte(t))` → `true 7` on all targets.
  - Done when: both repros match Go on wasm (js/both pinned).
- [ ] Task 26.3: JS `binary.Read` into 64-bit integers stores `BigInt` and `binary.Size` resolves named structs
  - Files: `src/backend/js/stdlib/binary.js`, `src/backend/js/runtime.js`, `test/unit/stdlib/binary.test.js`
  - Test: S21 `var a int64; binary.Read(&buf, binary.LittleEndian, &a); fmt.Println(a + 1)` → `-4` (and `uint64`); S24 `type Point struct { X, Y int32 }; fmt.Println(binary.Size(Point{}))` → `8` on all targets.
  - Done when: both repros match Go on js/both/wasm.

### Phase 27: Go-Source Stdlib Fixes and WASM Import Pruning

- [ ] Task 27.1: `path.Match` rejects inverted character ranges and `/` inside character classes
  - Files: `stdlib/path/path.go`, `test/unit/stdlib/path.test.js`
  - Test: S12 `ok, err := path.Match("[z-a]", "b"); fmt.Println(ok, err == path.ErrBadPattern)` → `false true`; S13 `ok, err := path.Match("[/]", "/"); fmt.Println(ok, err)` → `false syntax error in pattern` on all targets.
  - Done when: both repros pass four ways (`assertFourWay`).
- [ ] Task 27.2: `strconv.Unquote` preserves UTF-8 bytes in raw backtick strings with `\r`
  - Files: `stdlib/strconv/quote.go`, `test/unit/stdlib/strconv.test.js`
  - Test: S34 ``strconv.Unquote("`\ré`")`` → `"é" <nil>` on all targets (`assertFourWay`).
  - Done when: repro passes four ways.
- [ ] Task 27.3: `unicode.ToUpper`/`ToLower` and `strings.ToUpper`/`ToLower` preserve single-rune behavior on `ß`
  - Files: `src/backend/js/natives.js`, `src/backend/wasm/boundary.js`, `test/unit/stdlib/strings.test.js`
  - Test: S18 `fmt.Println(strings.ToUpper("ß"))` → `ß` and `unicode.ToUpper('ß')` → `'ß'` on all targets (`assertFourWay`).
  - Done when: repro passes four ways.
- [ ] Task 27.4: Prune unreachable stdlib `env.*` imports in WASM modules (`bytes.Buffer` size <= 4,500 B)
  - Files: `src/backend/wasm/prescan.js`, `src/backend/wasm/module-emitter.js`, `test/unit/stdlib/bytes.test.js`
  - Test: S17 `compileWasm` of `package main; import "bytes"; func main() { var b bytes.Buffer; b.WriteString("hi"); _ = b.Len() }` produces `wasm.length <= 4500`.
  - Done when: `wasm.length <= 4500` and all WASM stdlib tests pass.
