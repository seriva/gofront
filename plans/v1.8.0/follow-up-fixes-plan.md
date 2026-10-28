# v1.8.0 Follow-up Fixes & Performance Hardening — Design Plan

**Version:** v1.8.0  
**Status:** Draft (2026-10-28)  
**Base branch:** main  
**Related:** Follows [`portable-go-plan.md`](portable-go-plan.md) and [`repo-structure-plan.md`](repo-structure-plan.md); unblocks downstream adoption ([`simplefps/plans/gofront-v1.8.0-adoption-plan.md`](../../../simplefps/plans/gofront-v1.8.0-adoption-plan.md)); addresses open ledger items from [`../follow-ups.md`](../follow-ups.md).  
**Release note:** Constant slice indexes in `both` packages no longer pay for bounds checks when the code proves the length first (for example with `_ = xs[15]`), and calls like `f(s.Items[s.Idx[i].N])` parse again. Many Go programs that failed to compile, built an invalid WebAssembly module, or printed different results on JS and WebAssembly now behave like Go.

---

## Goal

Resolve critical compiler correctness regressions and strict-mode performance gaps in GoFront v1.8.0 before final release tagging.

While v1.8.0 achieved language parity and strict-mode runtime safety across `js`, `wasm`, and `both` targets, two critical issues block downstream release adoption:
1. **Strict-mode slice bounds overhead (The 3× `mathx` regression):** In `both` packages, strict mode emits `__at`/`__ix` bounds-checking helper calls for every slice index. For constant-indexed slice math (`type Mat4 = []float32`), this causes a measured **3.0× slowdown on `Mat4Multiply`** and **2.3× slowdown on `TransformMat4`**. GoFront's index-check elision ([`src/lower/bounds.js`](../../src/lower/bounds.js)) currently only elides constant indices into fixed *arrays*, not slices. Adding bounds-check elimination (BCE) support for length guards and Go's idiomatic `_ = xs[k]` hint allows the compiler to prove slice bounds and emit raw `xs[k]` indexing.
2. **Generic instantiation lookahead parse error:** Commit `80add49` expanded generic instantiation to qualified names (`pkg.T[...]`), but in function call arguments like `fn(s.Meshes[s.Entries[i].Index])`, `looksLikeTypeArgList()` in [`src/parser/expressions.js`](../../src/parser/expressions.js) misidentifies indexed selector expressions as generic type arguments, causing a syntax error: `Parse error: expected ']' (got . ".")`.
3. **Follow-up ledger items:** Fix and retire open items logged in [`plans/follow-ups.md`](../follow-ups.md) to stabilize the v1.8.0 release.

**Done means:**
- `src/lower/bounds.js` elides `__at`/`__ix` for slice indices `0..k` when preceded by an explicit length check `len(xs) > k` or a Go BCE hint `_ = xs[k]`.
- Compiling `mathx` from SimpleFPS as a `both` package emits zero `__at`/`__ix` calls in `Mat4` matrix functions when BCE hints are present.
- `src/parser/expressions.js` disambiguates slice indexing inside call argument lists; `node src/index.js check app/src/...` on SimpleFPS passes with zero parse errors.
- Unit and regression tests cover BCE slice elision and qualified generic lookahead.
- Every repro scheduled in Phases 2–14 is a passing test in the task's `Test:` file (JS, `both` and `wasm` outputs equal to Go's where the task says so); `npm test` and `npm run check` pass.
- `plans/follow-ups.md` holds no entry tagged `follow-up-fixes`; the deferred rows below stay in the Boundary Matrix.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Compiler correctness & lowering optimizations | Slice BCE in `src/lower/bounds.js` (`_ = xs[k]` and `len(xs) > k`); parser lookahead disambiguation in `src/parser/expressions.js`; scheduled items from `plans/follow-ups.md` | |
| **In scope: target-specific** | Backend emission | Plain array indexing emitted in JS backend when `IndexExpr._inBounds = true` on slices | |
| **Excluded: runtime / platform** | No changes to runtime model | Goroutines, reflection, raw memory pointers | Incompatible with GoFront principles |
| **Excluded: deferred** | New features and unreferenced stdlib packages | Moving stdlib to pure Go (`stdlib-in-go-plan.md`); `bufio`, `net/url`, `context` | Scheduled for v1.9.0 |
| **Excluded: deferred** | Bugs in packages that v1.9.0 rewrites in Go source (`bytes`, `strings`, `strconv`, `errors`, `slices`, `time`, `math/rand`, `io`, `encoding/base64`) | `bytes.NewReader([]byte{0xff,'a'})`+`ReadRune` then `ReadByte` → JS `\x00`, want `a`; `bytes.IndexRune([]byte("a\xffb"), utf8.RuneError)` → `-1` all targets, want `1`; `strings.NewReplacer("a","1","","X").Replace("ab")` → `1b`, want `1XbX`; `strings.ToTitle("ǆ")` → `Ǆ`, want `ǅ`; `io.ReadAll(bytes.NewReader(nil))` → JS `Cannot read properties of null (reading 'length')`; `slices.Contains(nilSlice,1)` → JS `reading 'includes'` TypeError, want `false`; `strconv.FormatFloat(-0.0,'f',-1,64)` → `0`, want `-0`; `strconv.ParseFloat("1e39",32)` → `1e+39 <nil>`, want `+Inf` + range error (WASM: module fails validation on `fmt.Println(strconv.ParseFloat(...))`, see Task 9.4); `base64.StdEncoding.DecodeString("!!!")` → `...input byte 3`, want `byte 0`; `errors.Is(nil,nil)` → `false`, want `true`; `%T` of `errors.New("x")` → WASM `string`, want `*errors.errorString`; `rand.Perm(-1)` panics `invalid argument to Perm` on both targets, want `runtime error: makeslice: len out of range`; `t.Compare(t.Add(1))` → JS `0`, want `-1`; `fmt.Println(time.Time)` → WASM `{1577934245000000000 0 <nil>}`; `t.Clock()`/`t.Date()`/`t.In`/`time.UnixMilli`/`UnixMicro`/`bytes.ToTitle` in wasm → `Unsupported time.Time method 'Clock'`; `struct{D time.Duration}{time.Second}` `%v` → `{1000000000}` all targets, want `{1s}`; `json.Marshal(time.Date(...))` → JS `v.MarshalJSON is not a function`; `io.ReadAll(&io.LimitedReader{...})` → JS `w.Read is not a function`; `io.NewSectionReader(strings.NewReader(...),6,5).Read` → WASM `interface conversion: nil or unmatched type`; `fmt.Fprint(&bytes.Buffer, "héé")` → WASM `n=3`, want `5` | The hand-written JS/WASM members are replaced by compiled Go source in v1.9.0 Phase 3+; fixing them now is throwaway. Add each repro to that plan's Go-output cases (`test/unit/stdlib/*`). |
| **Excluded: deferred** | JS-only representation limits | `var u uint64 = 5; fmt.Println(^u, -u)` → JS `-6 -5`, want `18446744073709551610 18446744073709551611` (WASM printing half is Task 9.2); `any(uint64(1<<63))` → JS `9223372036854776000` | `uint64` above 2^53 does not fit a JS Number; needs a BigInt-backed `uint64` in JS (own design). |
| **Excluded: deferred** | Address of elements/fields in `js` packages | `a:=[2]int{1,2}; f:=func(){a=[2]int{7,8}}; p:=&a[0]; f(); *p` → JS `1`, want `7`; `a,b=b,a` with `p:=&b[0]` → JS `331`, want `131` (struct form `121`, want `221`); `u := &mpa["a"][0]` (`map[string]*[2]int`) → JS `Cannot set properties of undefined`; `p := &m["a"].X` through embedded `*In` → JS `1`, want `11` | `both`/`wasm` packages already reject these with the stable-address diagnostic; fixing `js` needs a new element-pointer model for legacy `js` packages. |
| **Excluded: deferred** | Experimental `gofront/simd` edge cases | `ptrT(&a)` with `a simd.F32x4` → `both` `NaN`, WASM validate `f32x4.add expected v128`; `any(a)==any(a)` → WASM validate `expected anyref, found v128`; `a < b` → `both` `true`, WASM `Unsupported WASM instruction opcode: 'v128.lt_s'` (want a type error); `map[[4]float32]int` NaN key → JS `102`, want `200`; facade `Set(s, new Float32Array([1,2]))` → JS keeps the caller's array (`Lane0` sees later writes, lanes `[1,2,NaN,NaN]`), WASM copies `[1,2,0,0]`; `Var(new Float32Array(4), new Float32Array(4))` with `...simd.F32x4` → WASM `0`, want `2` | `gofront/simd` stays experimental in v1.8.0; these belong to the SIMD promotion work, not release hardening. |
| **Excluded: deferred** | Low-value or design-level items | `fmt.Sscanln("1 2 3\n",&x,&y)` → `2 <nil>`, want `expected newline`; `os.Stderr` in Node writes to `process.stdout` (`HELPER_OS`, `src/backend/js/runtime.js:768`) | `Fscan*` family was trimmed in v1.8.0 Task 9.4 and `Sscanln` is rarely used; stderr routing waits until the test harnesses capture stderr separately. |

---

## Verified Gaps & Baseline Audit

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Slice bounds checks in JS | In `both` packages, slice indexing emits `__at(xs, i)` calls. In SimpleFPS `mathx`, `Mat4` indexing has 204 `__at` call sites, causing a 3.0× slowdown on `Mat4Multiply` and 2.3× on `Vec3.TransformMat4`. `src/lower/bounds.js` only inspects `u.kind === "array"`. | SimpleFPS audit 2026-10-23; probe `mathx-ab.mjs` |
| Parser generic lookahead | In call arguments, `looksLikeTypeArgList()` returns true if an identifier inside brackets starts with an uppercase letter and is followed by `)`. For `Add(s.Meshes[s.Entries[i].Index])`, it parses `s.Entries[i].Index` as a type argument, failing at `.Index`. | Minimal repro: `func Add(x int){}; func Test(s S, i int){ Add(s.Meshes[s.Entries[i].Index]) }` → `Parse error at 15:27: expected ']' (got . ".")` |

### Review follow-ups (2026-10-28)

Re-probed on `main` @ `7e634c1` with a throwaway harness that compiles a `package main` through `compileFiles` with `forceTarget` `js`, `both` and `wasm`, validates the module and runs `main` (same flow as `compileHybridProgram` in `test/unit/helpers.js`); multi-package, facade and templ items through `node src/index.js <dir> -o out.js`; SIMD facade items through `compileHybridProject`. "all" = js, both and wasm. Expected values are Go's.

| Area | Finding | Evidence & probe |
|---|---|---|
| Lexer floats | `.5` rejected | `x := .5` → all `Unexpected token in expression: '.'`, want `0.5` (phase-4.4) |
| Lexer identifiers | Non-ASCII letters rejected | `θ := 1.5` → `Lex error: Unexpected character: 'θ'` (phase-4.4) |
| Parser predeclared names | `new` as parameter name | `func (x *T) Swap(new int32) (old int32)` → `Expected type, got 'new'` (phase-4.3) |
| Parser labels | Empty labeled statement | `func f() { L: }` → `Unexpected token in expression: '}'` (final audit) |
| Parser generics | Embedded instantiated type | `type W[T any] struct{ Inner[T]; w int }` → `Expected type, got ';'` (PR #43) |
| Parser generics | Array type arg in assertion | `_, ok := x.(Stack[[2]int])` → `expected '{' (got ])` (PR #43) |
| Typechecker type switch | `case nil` with binding | `switch e := err.(type) { case nil: _ = e }` → all `Unknown type 'nil'`, want `nil` printed (PR #55) |
| Typechecker map literal | Elided key on non-struct key type now emits invalid JS | `map[string]int{{1}: 1}` → no diagnostic, JS run `SyntaxError: Unexpected token ':'`; want a type error naming `string` as an invalid literal type (PR #43; worse than ledger, which saw an internal message) |
| Typechecker multi-value return | `return f()` forwarding rejected | `func (h *hm) Write(p []byte) (n int, err error) { return h.inner.Write(p) }` (`inner` an interface field) → `Cannot assign (int, error) to int`; `return t.App(make([]byte,0,20))` → `Cannot assign ([]uint8, error) to []uint8`; `return r.ReadRune()` (`*strings.Reader`) → `Cannot assign (int32, int, error) to int32`; `return s.sb.Write(p)` (`sb strings.Builder`) → `Cannot assign (int, error) to int` (phase-4.3/4.4/5.1/9; ledger repro used `hash/crc32`, which v1.8.0 removed, so restated with an interface field) |
| Typechecker results | Grouped named results | `func Polar(x float64) (r, theta float64)` → `Unknown type 'r'` (phase-4.4) |
| Typechecker interfaces | `interface{}` ≠ `any` in signatures | `Do(f func(uint8) interface{}) []interface{}` vs interface using `any` → `impl does not implement Bag` (PR #55) |
| Typechecker defined types | `type S3 Base` loses fields | `S3{n: 5}.N()` → JS/both print `<nil>`, WASM `Cannot resolve struct for selector: n`; want `5` (phase-0.13) |
| Typechecker shifts/consts | Invalid code accepted / duplicate errors | `var f float64 = 1; y := f << 2` → no error, want `shifted operand ... must be integer`; `const c uint16 = 3; var v = -uint16(c+1)` → js `constant -4 overflows uint16` (= Go) but both/wasm print `65532` (ledger's expected `65532` was wrong; Go rejects it); `const c = 1 << -1` → two errors, want one (PR #41) |
| Generics receivers | Receiver type vs `T[T]` mismatch | `func (s Stack[T]) Copy() Stack[T] { c := s; return c }` → `Cannot assign Stack to Stack[T]`; `p := l; for p.Next != nil { p = p.Next }` in `(*List[T]).Last` → `Cannot assign List[T] to List` (PR #43, final audit) |
| Generics func values | `f := Id[int]` | all `Undefined: 'int'` + `Cannot index type Id`, want `3` from `f(3)` (PR #43) |
| Generics type args | Missing validation | `3 + Sum[float64](1,2)` in an `int` func → JS `6`, WASM validate `i64.add expected i64, found f64`, want type error; `Id[int,int](1)` and `strings.ToUpper[int]("a")` compile (`1`, `A`), want errors; `func a[T any](n int) T { return T(n) }` compiles, want `cannot convert n ... to type T` (PR #43, PR #55) |
| Generics expansion / identity | Stack overflow; cross-package collision | `type T[X any] struct{ n *T[[]X] }; var t T[int]` → all `Maximum call stack size exceeded`, want instantiation-cycle error; `Box[a.Pt]` + `Box[b.Pt]` (dirs `./a`, `./b`) → `No field 'X' on Pt` (PR #43) |
| JS keyed literal | Positional embedded literal inside keyed outer | `Out{In: In{3}}`, `Outer{Base: Base{7}, v: "x"}` → js/both `CodeGen: unhandled expression kind 'undefined'`; WASM `3` / `7 x` (phase-0.12, phase-0.13; two ledger entries) |
| Loop variable shadowing | `i := i` in a for body | JS/both `Cannot access 'i' before initialization`; WASM never terminates (first run OOM'd the batch, re-run killed by `timeout 30`); want `0`,`1` (PR #54; WASM half new) |
| JS package vars | Two `var _ = ...` | `Identifier '_' has already been declared` (final audit) |
| Nil slice conversion | `[]int(nil)` | JS `object null is not iterable`; WASM validate `local.set expected (ref null 85), found ref.null anyref`; want `[]` (phase-9) |
| JS make/new | Named slice and array `new` | `type S []int; make(S,5)` → JS `0 {}`, WASM `5 [0 0 0 0 0]`; `p := new([4]byte); (*p)[0] = 1` → JS `Cannot set properties of null`, WASM validate `local.tee expected (ref null 23), found struct.get anyref` (PR #47, PR #51) |
| JS nil pointers | Nil receiver, deref, `clear` | `l.Next.Len()` with nil `l.Next` → JS `Cannot read properties of null (reading 'Len')`, WASM `2`; `var p *S; _ = *p` → JS no panic (`recover()` = `<nil>`), WASM uncatchable `dereferencing a null pointer`; `clear(xs)` on `[]int{1,2}` → JS `[]`, want `[0 0]` (PR #43, final audit) |
| JS strict int ops | Precedence, mask, int8 negate | `byte(0x80 \| r>>6&0x3F)` r=0xFFFD → both `255`, want `191`; `int(((x32-y32-1)>>31)&1)` → both `-1`, want `1`; `var a int8 = -128; int64(-a)` → js/both `128`, want `-128`; `math.Modf(-3.0)` frac → JS `Signbit` false, want true (phase-9, phase-4.3, PR #41, PR #48) |
| JS int64 shifts | No 64-bit semantics | x=1<<40: `(x<<3)+(x>>3)` → js/both `0`, want `8933531975680`; x=3,n=62: `x<<n` → both `13835058055282164000`, want `-4611686018427387904`; x=1<<50,n=35 → both `3.8685626227668134e+25`, want `0`; `x << n`, n=-1 → js `-2147483648`, both/wasm `0`, want panic `negative shift amount` (PR #41, final audit) |
| Variadic | Spread aliasing and nil | `set := func(xs ...int){xs[0] = -1}; set(a[1:]...)` → JS `[1 2 3]`, want `[1 -1 3]`; `set(nx...)` nil → JS `nx is not iterable`; `nilp()` → `false` all, want `true` (PR #42, final audit) |
| Tuple assignment | Index operands evaluated late | `k := 0; xs := []int{0,2}; k, xs[k] = 1, 5` → all `[0 5]`, want `[5 2]` (final audit) |
| Slice element pointers | Whole-element store replaces the element | `p := &xs[0]; xs[0] = S{9}; p.A` → all `1`, want `9`; `first[T](xs []T) *T { return &xs[0] }` then `p.V = 7` → JS `1`, WASM `7` (PR #44, final audit) |
| JS dynamic types | Named string assertion | `var a any = L("x"); _, ok := a.(string)` → JS `true`, WASM `false` (phase-5.1) |
| JS dynamic types | Assertion to type parameter | `As[*Other](fmt.Errorf("%w", &MyErr{}))` → JS `true`, WASM `false` (ledger's WASM compile error is gone) (phase-9) |
| Type switch | Same method name, different signature | `switch err.(type) { case interface{ Unwrap() error }: ...; case interface{ Unwrap() []error }: ... }` on `errors.Join` → JS `single`, WASM compile error `.for is not iterable`; want `multi` (phase-9) |
| JS generics conversions | `T(x)` is identity | `Half[int](9)`, `conv[int8](200)`, `Wrap[uint8](255)` → JS `4.5 200 256`, WASM `4 -56 0` (= Go) (phase-4.4) |
| Erased generics | Identity, `==`, zero value | `mk[int]().(*Stack[string])` → JS `true`, want `false`; `eq[any](P{1},P{1})` → JS `false`, want `true`; `var z T; xs[0] = z` on `[]int` → JS `[<nil> 5]`, want `[0 5]`; the same program fails WASM validation `call expected (ref null 81), found (ref null 79)` (PR #42, PR #43) |
| JS composite map keys | Text-encoded keys | `len(map[T]int{T{"x y","z"}:1, T{"x","y z"}:2})` → JS `1`, want `2`; `Println(map[K]int{K{"a",5}:1, K{"a 1",0}:2})` → JS `map[{a 1 0}:2 {a 5}:1]`, want `map[{a 5}:1 {a 1 0}:2]` (PR #42) |
| JS fmt nil Stringers | No dispatch / throws | `[]*C{nil,{1}}` → JS `[<nil> c]`, want `[c c]`; `var g *G[int]` → JS `<nil>`, want `g`; `var p *Color` (value `String`) → JS `Cannot read properties of null (reading 'value')`, want `<nil>` (PR #45) |
| JS fmt generics | Stringer lost through `T` | `Show(Color(2))` with `fmt.Sprint(x)` → JS `2`, want `col` (PR #45) |
| JS fmt composites | Map in `any` struct, embedded | `var a any = A{M: map[string]int{"k":1}}` → JS `{{1}}`, want `{map[k:1]}`; `Out{In{3},1}` → JS `{{3} 0 1}`, want `{{3} 1}` (PR #45, PR #42) |
| fmt verbs (all) | Bad-verb and precision handling | `%x` of 3.5 → `%!x(float64=3.5)`, want `0x1.cp+01`; `%c` of 3.5 → throws `Invalid code point 3.5`, want `%!c(float64=3.5)`; `%.3v\|%.2v` of `3.14159`,`"abc"` → `3.14159\|abc`, want `3.14\|ab`; `%U` of `int32(-1)` → `U+0001`, want `U+FFFFFFFFFFFFFFFF`; `%q` of nil `[]string` → `""`, want `[]` (final audit, PR #46, phase-4.4) |
| fmt floats (all) | float32 and large float64 | `float32(0.1)` → `0.10000000149011612`, want `0.1`; `float32(1)/3` → `0.3333333432674408`, want `0.33333334`; `float64(9007199254740992)` → `9007199254740992`, want `9.007199254740992e+15` (final audit, phase-5.1) |
| WASM Println separators | Empty / trailing-space strings | `Println("", "\|")` → WASM `\|`, want ` \|`; `Println(0, "a ", true)` → `0 a true`, want `0 a  true`; `Println(2, "", nil)` → WASM validate `call expected i64, found ref.null anyref` (PR #45/#52, phase-4.4, phase-9) |
| WASM unsigned printing | Printed signed | `[1]uint32{3465168386}` → `[-829798910]`; uint32 method result `^uint32(0)` → `-1`; `var x uint32 = 3304433030` → `-990534266`; `any(uint64(1<<63))` → `-9223372036854775808`; `-u` (uint64 1) → `-1` (phase-4.3/4.4, PR #52, PR #44) |
| WASM fmt maps / `%p` | Order and ids | `map[K]int{K{2}:2, K{1}:3}` → WASM `map[{2}:2 {1}:3]`, want `map[{1}:3 {2}:2]`; `Sprintf("%p\|%p", &x, &x)` → WASM `...0x1\|...0x2`, JS `0x1\|0x1` (phase-0.12, phase-11) |
| fmt multi-value args | `Println(f())` | `Println(strings.Cut("a=b","="))` → JS `[a b true]`, WASM `1`, want `a b true`; `Println(w.Write(...))` → JS `[2 <nil>]` (phase-9, PR #55) |
| WASM fmt func values | Invalid module | `fmt.Println(func(){})` (wasm) → validate `call expected i32, found struct.new`, want an address-style output or a diagnostic (final audit) |
| WASM append/copy string | Invalid module | `append(b, "hello"...)` → validate `local.tee expected (ref null 24), found call externref`; `copy(e.enc[:], "ABC...")` → validate `local.set expected (ref null 25), found call externref` (PR #50, phase-4.3) |
| WASM constants | Compare, complex return, local const | `c <= rune(s[i+1])` (`const c = 0xdc00`) → validate `i64.le_s expected i64, found array.get i32`; `func f() complex128 { return 1 }` → validate `type error in return[0]`; `const th float64 = 1 << 30` inside a func → `Unresolved identifier: th` (phase-4.3, phase-4.4) |
| WASM `any` boxing | 64-bit ints, nil maps, named ints | `any(uint64(1))` → validate `local.tee expected anyref, found i64`; `var m map[string]int; var a any = m; a == nil` → WASM `true`, want `false`; `fmt.Println(any(Color(1)))` with `--wasm-opt` → `call param types must match` (builds without it); `iter.Seq[int](f)` not separately confirmed (the probe failed validation on `any(u)` first) (final audit, phase-5.1, PR #72) |
| WASM package init | Forward refs, zero values | `var x1 = y1 + 1; var y1 = compute()` → `Unsupported WASM instruction opcode: 'anyref.add'`; `const (A = B + 1; B = C * 2; C = 3); var z1 = A + 1` → same; `var big [100]P; big[99].B` → `dereferencing a null pointer` (PR #72, PR #42) |
| WASM pointers | Pointer-to-pointer, named map receiver | `p := &T{3}; pp := &p; (*pp).X` → validate `local.tee expected (ref null 1), found (ref null 86)`; `type M map[int]int; func (m *M) Set(){*m = M{1:1}}` → validate failure (phase-5.1, phase-10) |
| WASM fallthrough | Only first body runs | `switch 3 { case 3: v += 100; fallthrough; case 2: v += 10; fallthrough; case 1: v++ }` → WASM `100`, want `111` (phase-4.3) |
| WASM multi-value targets | Lost writes / wrong `:=` | `w[2*3], w[2*3+1] = add(1, 2)` → WASM `w[6] == 0`, want `3`; `h, c1 := addc(x,y); h, c2 := addc(h, c0)` → WASM `1 0 0`, both `0 0 1` (= Go) (phase-4.3, phase-4.4) |
| WASM generics | Nested instance, named results | `[]Box[Box[int]]` + `slices.Values` → validate `call_ref expected (ref null 82), found (ref null 99)`; `func (x *Pointer[T]) Swap(nv *T) (old *T)` → `Undefined: 'old'` (PR #44, phase-4.3) |
| WASM interfaces | Dispatch and recoverable traps | `fmt.Println(w.Write([]byte("xy")))` via interface → validate `call expected i32, found call anyref`; `var g Getter = &x` (`MyInt` value method) → `interface conversion: nil or unmatched type for method call`, want `42`; nil `*N` calling value method under `recover` → uncatchable `illegal cast`, JS `rec true` (PR #55, PR #51, PR #44) |
| WASM facade names | Qualified names in identifiers | `G[time.Duration]` exported from a wasm package → `SyntaxError: Missing initializer in const declaration` at `const __gfw_h_G$time.Duration`; wasm main with interface method returning `fmt.Stringer` → now `internal: no wasm dispatcher for interface method fmt.Stringer.String` (ledger saw a SyntaxError) (final audit, triage) |
| JS json Marshal | Nil maps, tags in `any`, errors | nil map → `{}`, want `null`; `P{}` with nil map field → js `{"M":{}}`, both throws `Cannot define property __v`; `omitempty` empty map → `{"m":{}}`, want `{}`; `map[string]any{"p": A{"S"}}` → `{"p":{"S":"S"}}`, want `{"p":{"street":"S"}}`; `math.Inf(1)` → `unsupported value: Infinity`, want `+Inf`; `RawMessage("[1, 2]")` → `[1, 2]`, want `[1,2]` (phase-5.1) |
| JS json Unmarshal | Marker key, arrays, errors | `{"a":1,"b":2}` into `map[string]int` → `len 3`, want `2`; `{"a":1}` into `map[string]any` → `2`, want `1`; `[1,2]` into `[3]int` → `[1 2]`, want `[1 2 0]`; nil `*Item` → `json: Unmarshal(nil)`, want `json: Unmarshal(nil *main.Item)`; non-pointer `[]int` → `<nil>`, want `json: Unmarshal(non-pointer []int)` (phase-5.1, PR #57) |
| WASM json dynamic types | Slice reached only via `any` | `var a any = get()` (`get() []T` returns nil); `json.Marshal(a)` → WASM `json: unsupported type: unsupported dynamic type`, want `null <nil>` (phase-5.1) |
| Templ type checking | Body expressions unchecked | `templ V(class string, ...) { <p>{ class + undefinedVar }</p><p>{ class + 5 }</p> }` → build OK, emits `String(class + undefinedVar)`; want `Undefined: 'undefinedVar'` and mismatched types (repo-structure review) |
| Templ reserved names | Body not renamed | same probe → `function V(class$, xs)` but `___e1.className = class;` → `SyntaxError: Unexpected token ';'` (PR #73) |
| Templ for loops | Errors swallowed | `for _, x := range xs { <p>{ x + }</p> }` → build OK; `_genTemplFor` has a bare `catch {}` (`src/backend/js/templ.js:213-222`) (repo-structure Phase 5) |
| Layer guard | Stale allowlists, template literals, shared dir | `scripts/check-layers.js`: no staleness check for `ALLOW`/`PENDING_CROSS` (`findLayerGaps` L72-86); `SPEC_RE` only matches `["']` quotes, so ``import(`../wasm/emit.js`)`` is missed; `backendOf` returns `null` for `src/backend/shared/`, so shared files are never checked (PR #69, PR #73) |
| Test harness | Flaky / unpinned tests | `test/unit/cli/cli.test.js:123` dev smoke still `timeout: 500` (startup 183–528 ms measured earlier, CI failures on PR #72/#73); `test/unit/discover.js:24` `found.sort()` – removing it fails no test; `plan-paths.test.js:248-256` only checks an exempt glob still cites a path, not that the path is still missing (PR #72–#75) |
| CLI | Unwritable `-o`; vendor bytes | `node src/index.js <dir> -o /proc/x/app.js` → hangs, killed by `timeout 15` (exit 124), want error + exit 1; `src/cli/vendor.js:447` names the entry `.gofront-vendor-entry-${Date.now()}.mjs`, which esbuild writes into `vendor.js` (PR #70, repo-structure Phase 2) |
| Diagnostics | Duplicate wasm import error; no precision warning | `//gofront:target wasm` + `import "reflect"` → `js: imports are not allowed in wasm packages` and `package 'reflect' is not available: ...`, want only the second; `const c = 9007199254740993` in js → no warning, prints `9007199254740992` (final audit) |
| `example/hybrid` | SIMD bounce differs; test leaks state | `Step` applies low then high bounce (`sim.go:126-131`), `stepOne` uses `else if` (`sim.go:158-170`); `TestLoadConfig` leaves `currentConfig.Name == "custom"` (`sim_test.go:6-19`) (PR #59, PR #60) |

No longer reproducing (deleted from the ledger): promoted field through `Deep2{*Out{*In}}` → `4` on all targets; dynamic format string `"%v %d %s\n"` with a struct → `{1} 3 x` on all targets; `%#v` of a nested pointer prints `(*main.N)(0xc000010000)`, which is what Go does (Go never follows nested pointers); `fmt.Println(e)` with nil `*MyErr` → `my` on all targets, as in Go (its `%T` half is deferred above). The parser-lookahead entry (`80add49`) is Task 1.1.

---

## Approach

### 1. Architecture & Design Decisions
- Phase 1 as above. Phases 2–14 group the re-probed follow-ups by subsystem: front end (2), typechecker (3, 4), JS backend (5–8), WASM backend (9–11), JSON (12), templ (13), tooling/diagnostics/example/docs (14).
- Bugs in packages that v1.9.0 rewrites in Go source are deferred (Boundary Matrix): fixing hand-written members now is throwaway.
- Cross-target fixes are tested through `assertProgramOutput` / `compileHybridProgram` (`test/unit/helpers.js`) so JS (`both`) and WASM must both equal Go's output; JS-only items use `compile` + `runJs`.

### 2. Invariants & Safety Bounds
- No change to the `js`-package pointer model or the JS `uint64` representation (deferred rows).
- Strict-mode (`both`) wrapping stays exactly Go's; non-strict `js` packages keep current Number semantics except where a task says otherwise.

### 3. Edge Cases & Error Handling
- New diagnostics use `assertErrorContains` with the exact message; WASM fixes must pass `assertValidWasm`.
- Task 13.2 changes behaviour pinned in `test/unit/compiler/templ.test.js`; update those pins in the same commit.

---

## Implementation Tasks

### Phase 1: Critical Compiler Fixes & BCE Optimization

- [ ] Task 1.1: Fix generic instantiation lookahead in parser
  - Files: `src/parser/expressions.js`, `test/unit/parser/generics.test.js`
  - Test: Unit test with nested selector indexing inside function arguments (`fn(s.Meshes[s.Entries[i].Index])`) parses as `CallExpr` containing `IndexExpr`, not `InstantiationExpr`.
  - Done when: `gofront check` passes on the repro and on SimpleFPS (`app/src/game`, `app/src/engine/scene`, `app/src`).

- [ ] Task 1.2: Slice Bounds-Check Elimination (BCE) in lowering
  - Files: `src/lower/bounds.js`, `test/unit/compiler/bounds.test.js`
  - Test: In a `both` package, a function starting with `_ = xs[15]` or `if len(xs) > 15 { ... }` marks `xs[0]` through `xs[15]` as `_inBounds = true`. Emitted JS contains raw `xs[0]` instead of `__at(xs, 0)`.
  - Done when: Constant slice indices preceded by a length proof or BCE hint are elided in the JS backend for `both` packages.

- [ ] Task 1.3: End-to-end SimpleFPS verification
  - Files: `test/perf/`
  - Test: Run `gofront check` across SimpleFPS; compile `engine/mathx` with BCE hints and verify `__at` count in matrix functions drops to 0.
  - Done when: `check` passes cleanly across all SimpleFPS packages; `mathx` matrix functions emit zero `__at` calls.

---

### Phase 2: Front End Accepts Valid Go

*Phases 2–14 were scheduled from review follow-ups on 2026-10-28 (see Verified Gaps → Review follow-ups).*

- [ ] Task 2.1: Lexer: leading-dot floats and Unicode identifiers
  - Files: `src/lexer/lexer.js`, `test/unit/compiler/lexer-parser.test.js`
  - Test: `x := .5; fmt.Println(x)` prints `0.5`; `θ := 1.5; fmt.Println(θ)` prints `1.5` (all targets via `assertProgramOutput`); a lone `.` still errors.
  - Done when: both repros compile and run on js/both/wasm.
- [ ] Task 2.2: Parser: predeclared names as identifiers and empty labeled statements
  - Files: `src/parser/declarations.js`, `src/parser/statements.js`, `test/unit/compiler/lexer-parser.test.js`
  - Test: `func (x *T) Swap(new int32) (old int32) { old = x.v; x.v = new; return old }` → `1 2`; `func f() { L: }` parses.
  - Done when: both repros compile; `new(T)` still works in the same file.
- [ ] Task 2.3: Parser: embedded generic instances and array type arguments in assertions
  - Files: `src/parser/types.js`, `src/parser/expressions.js`, `test/unit/types/generics.test.js`
  - Test: `type W[T any] struct{ Inner[T]; w int }` compiles and promotes `v`; `x.(Stack[[2]int])` → `true`.
  - Done when: both repros compile and run on all targets.
- [ ] Task 2.4: Typechecker: `case nil` with a binding; invalid elided map key
  - Files: `src/typechecker/statements.js`, `src/typechecker/expressions.js`, `test/unit/types/checks.test.js`
  - Test: `switch e := err.(type) { case nil: _ = e; fmt.Println("nil") }` → `nil`; `map[string]int{{1}: 1}` → `assertErrorContains(errors, "invalid composite literal type string")`.
  - Done when: the switch runs on all targets; the map literal is a type error, never emitted JS.

### Phase 3: Typechecker Signatures and Constants

- [ ] Task 3.1: Forward multi-value calls in `return`
  - Files: `src/typechecker/statements.js`, `test/unit/types/checks.test.js`
  - Test: the four repros (interface field `Write`, `t.App(make(...))`, `r.ReadRune()`, `s.sb.Write(p)` on a `strings.Builder` field) compile and print `2 <nil>` / `[1] <nil>` / `97 1 <nil>` / `2`; a count mismatch still errors.
  - Done when: all four compile on all targets.
- [ ] Task 3.2: Grouped named result lists
  - Files: `src/typechecker/resolve.js`, `test/unit/types/checks.test.js`
  - Test: `func Polar(x float64) (r, theta float64) { return x, 0 }` → `2 0`.
  - Done when: repro runs on all targets; `(a, b int, err error)` also accepted.
- [ ] Task 3.3: `interface{}` and `any` are identical in method signatures
  - Files: `src/typechecker/assignability.js`, `test/unit/types/checks.test.js`
  - Test: `impl` with `Do(func(uint8) interface{}) []interface{}` satisfies `Bag` declared with `any` → `true`.
  - Done when: repro compiles; a real signature mismatch still reports `does not implement`.
- [ ] Task 3.4: Defined types over named structs keep their fields
  - Files: `src/typechecker/types.js`, `src/backend/wasm/emit-exprs.js`, `test/unit/language/named-type-methods.test.js`
  - Test: `type Base struct{n int}; type S3 Base; func (s S3) N() int { return s.n }; S3{n: 5}.N()` → `5` on all targets.
  - Done when: JS no longer prints `<nil>` and WASM no longer reports `Cannot resolve struct for selector`.
- [ ] Task 3.5: Shift and constant diagnostics
  - Files: `src/typechecker/const-fold.js`, `src/typechecker/expressions.js`, `test/unit/language/constants.test.js`
  - Test: `f << 2` (float64 `f`) → error containing `must be integer`; `-uint16(c+1)` (typed const `c uint16 = 3`) → `constant -4 overflows uint16` for `both` and `wasm` too; `const c = 1 << -1` → exactly one error.
  - Done when: the three negative tests pass on every target.

### Phase 4: Generics Typechecking

- [ ] Task 4.1: Receiver type parameters in method bodies
  - Files: `src/typechecker/assignability.js`, `src/typechecker/types.js`, `test/unit/types/generics.test.js`
  - Test: `Stack[T].Copy` (`c := s; return c`) → `0`; `(*List[T]).Last` walking `p = p.Next` → `2`.
  - Done when: both compile and run on all targets.
- [ ] Task 4.2: Instantiated generic functions as values
  - Files: `src/typechecker/expressions.js`, `src/backend/js/expressions.js`, `src/backend/wasm/monomorph.js`
  - Test: in `test/unit/types/generics.test.js`, `f := Id[int]; fmt.Println(f(3))` → `3` via `assertProgramOutput`.
  - Done when: repro runs on all targets.
- [ ] Task 4.3: Validate explicit type arguments
  - Files: `src/typechecker/expressions.js`, `test/unit/types/generics.test.js`
  - Test: `return 3 + Sum[float64](1, 2)` in an `int` func → `mismatched types`; `Id[int, int](1)` → `got 2 type arguments`; `strings.ToUpper[int]("a")` → `not a generic function`; `T(n)` with `T any` → `cannot convert`.
  - Done when: the four negative tests pass with those messages; valid explicit instantiations still compile.
- [ ] Task 4.4: Instantiation cycles and package-qualified type arguments
  - Files: `src/typechecker/types.js`, `src/typechecker/resolve.js`, `test/unit/types/generics.test.js`
  - Test: `type T[X any] struct{ n *T[[]X] }; var t T[int]` → `instantiation cycle`; a two-package project (`compileDir` with `a.Pt{X int}`, `b.Pt{Y string}`) using `Box[a.Pt]` and `Box[b.Pt]` compiles and prints `1 s`.
  - Done when: no stack overflow; the two-package project builds.

### Phase 5: JS Backend Crashes

- [ ] Task 5.1: Positional embedded literal inside a keyed literal
  - Files: `src/backend/js/expressions.js`, `test/unit/language/structs.test.js`
  - Test: `Out{In: In{3}}` → `o.A == 3`; `Outer{Base: Base{7}, v: "x"}` → `7 x` (all targets).
  - Done when: no `unhandled expression kind` error.
- [ ] Task 5.2: Shadowed loop variable
  - Files: `src/backend/js/statements.js`, `src/backend/wasm/emit-stmts.js`, `test/unit/language/loops.test.js`
  - Test: `for i := 0; i < 2; i++ { i := i; println(i) }` → `0`,`1` on all targets (WASM run under a loop guard that fails instead of hanging).
  - Done when: JS has no TDZ error and WASM terminates.
- [ ] Task 5.3: Repeated `var _` and `[]T(nil)`
  - Files: `src/backend/js/index.js`, `src/backend/js/expressions.js`, `src/backend/wasm/emit-exprs.js`
  - Test: in `test/unit/language/declarations.test.js`, `var _ = f(); var _ = g()` runs both initialisers; `fmt.Println([]int(nil))` → `[]` (all targets).
  - Done when: no `already been declared` / `not iterable` / validation errors.
- [ ] Task 5.4: `make` of a named slice and `new` of an array
  - Files: `src/backend/js/expressions.js`, `src/backend/wasm/emit-builtins.js`, `test/unit/builtins/core.test.js`
  - Test: `type S []int; make(S, 5)` → `5 [0 0 0 0 0]`; `p := new([4]byte); (*p)[0] = 1` → `[1 0 0 0]` (all targets).
  - Done when: both repros match on all targets.
- [ ] Task 5.5: Nil pointers in JS: receivers, dereference, `clear`
  - Files: `src/backend/js/expressions.js`, `src/backend/js/runtime.js`, `test/unit/language/pointers.test.js`
  - Test: `(*List).Len` on a list ending in nil → `2`; `var p *S; _ = *p` under `recover` → message containing `nil pointer dereference`; `clear(xs)` on `[]int{1,2}` → `[0 0]`.
  - Done when: the three repros pass on `js` and `both`.

### Phase 6: JS Numeric and Value Semantics

- [ ] Task 6.1: Strict 32-bit and 8-bit integer operators; `math.Modf` sign
  - Files: `src/backend/js/expressions.js`, `src/backend/js/stdlib/math.js`, `test/unit/builtins/operators.test.js`
  - Test: `byte(0x80 | r>>6&0x3F)` (r=0xFFFD) → `191`; `int(((x32-y32-1)>>31)&1)` → `1`; `int64(-a)` (int8 -128) → `-128`; `math.Signbit(frac of Modf(-3))` → `true` (all targets).
  - Done when: `both` matches WASM and Go for all four.
- [ ] Task 6.2: 64-bit shifts in `both`
  - Files: `src/backend/js/expressions.js`, `src/backend/js/runtime.js`, `src/backend/wasm/emit-exprs.js`
  - Test: in `test/unit/builtins/operators.test.js`, `(x<<3)+(x>>3)` (x=1<<40) → `8933531975680`; `3<<62` → `-4611686018427387904`; `(1<<50)<<35` → `0`; runtime count `-1` → panic `negative shift amount` (all targets).
  - Done when: all four match Go on js(both)/wasm.
- [ ] Task 6.3: Variadic spread aliasing and nil
  - Files: `src/backend/js/expressions.js`, `src/backend/wasm/variadic.js`, `test/unit/wasm/variadic.test.js`
  - Test: closure `set(a[1:]...)` writing `xs[0] = -1` → `[1 -1 3]`; `set(nx...)` with nil `nx` → no panic; `nilp()` → `true` (all targets).
  - Done when: the three repros match Go everywhere.
- [ ] Task 6.4: Tuple assignment evaluates index operands first
  - Files: `src/backend/js/statements.js`, `src/backend/wasm/emit-stmts.js`, `test/unit/language/value-semantics.test.js`
  - Test: `k := 0; xs := []int{0, 2}; k, xs[k] = 1, 5` → `[5 2]` (all targets).
  - Done when: repro matches Go; existing swap tests stay green.
- [ ] Task 6.5: Whole-element stores keep element pointers valid
  - Files: `src/backend/js/statements.js`, `src/backend/wasm/emit-stmts.js`, `test/unit/language/pointers.test.js`
  - Test: `p := &xs[0]; xs[0] = S{9}; p.A` → `9`; `first[T]` + `p.V = 7` → `xs[0].V == 7` (all targets).
  - Done when: both repros print Go's values on js/both/wasm.

### Phase 7: Dynamic Types, Erased Generics and Map Keys

- [ ] Task 7.1: Assertions from named types to predeclared types
  - Files: `src/backend/js/expressions.js`, `src/backend/js/runtime.js`, `test/unit/language/parity-matrix.test.js`
  - Test: `var a any = L("x"); _, ok := a.(string)` → `false` (all targets); `a.(L)` → `true`.
  - Done when: JS matches WASM.
- [ ] Task 7.2: Type assertion to a type parameter
  - Files: `src/backend/js/expressions.js`, `test/unit/types/generics.test.js`
  - Test: `As[*Other](fmt.Errorf("%w", &MyErr{}))` → `false`; `As[*MyErr](&MyErr{})` → `true` (all targets).
  - Done when: JS checks the instantiated type.
- [ ] Task 7.3: Type switch on interfaces with same-named methods
  - Files: `src/backend/js/statements.js`, `src/backend/wasm/emit-stmts.js`, `test/unit/wasm/interfaces.test.js`
  - Test: `errors.Join(a, b)` against `interface{ Unwrap() error }` then `interface{ Unwrap() []error }` → `multi` (all targets).
  - Done when: JS picks the right case and WASM compiles.
- [ ] Task 7.4: Conversions to a type parameter in JS
  - Files: `src/backend/js/expressions.js`, `test/unit/types/generics.test.js`
  - Test: `Half[int](9)`, `conv[int8](200)`, `Wrap[uint8](255)` → `4 -56 0` (all targets).
  - Done when: JS truncates and wraps like WASM.
- [ ] Task 7.5: Erased generics: instantiation identity, `==` on `any`, zero values
  - Files: `src/backend/js/expressions.js`, `src/backend/js/runtime.js`, `src/backend/wasm/monomorph.js`
  - Test: in `test/unit/types/generics.test.js`, `mk[int]().(*Stack[string])` → `false`; `eq[any](P{1}, P{1})` → `true`; `mut(c...)` with `var z T` on `[]int{4,5}` → `[0 5]` (all targets).
  - Done when: all three match Go and the WASM module validates.
- [ ] Task 7.6: Struct map keys in JS
  - Files: `src/backend/js/runtime.js`, `test/unit/wasm/maps.test.js`
  - Test: `len(map[T]int{T{"x y","z"}:1, T{"x","y z"}:2})` → `2`; `Println(map[K]int{K{"a",5}:1, K{"a 1",0}:2})` → `map[{a 5}:1 {a 1 0}:2]`; ranging yields struct keys (all targets).
  - Done when: no key collisions; print order matches Go.

### Phase 8: fmt Parity (JS and Shared Verbs)

- [ ] Task 8.1: Nil pointers with `String` methods in JS
  - Files: `src/backend/js/fmt-runtime.js`, `test/unit/builtins/fmt-stringer.test.js`
  - Test: `[]*C{nil, {1}}` → `[c c]`; `var g *G[int]` → `g`; `var p *Color` (value `String`) → `<nil>` (all targets).
  - Done when: JS matches WASM and Go.
- [ ] Task 8.2: `String` dispatch through a type parameter
  - Files: `src/backend/js/expressions.js`, `src/backend/js/fmt-runtime.js`, `test/unit/builtins/fmt-stringer.test.js`
  - Test: `Show(Color(2))` with `fmt.Sprint(x)` → `col` (all targets).
  - Done when: repro prints `col` on JS.
- [ ] Task 8.3: Composite values inside `any` and embedded structs
  - Files: `src/backend/js/fmt-runtime.js`, `src/backend/shared/fmt-types.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test: `var a any = A{M: map[string]int{"k":1}}` → `{map[k:1]}`; `Out{In{3},1}` → `{{3} 1}` (all targets).
  - Done when: both repros match Go on JS.
- [ ] Task 8.4: Bad verbs and precision
  - Files: `src/backend/js/fmt-runtime.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test: `%x` of 3.5 → `0x1.cp+01`; `%c` of 3.5 → `%!c(float64=3.5)`; `%.3v|%.2v` → `3.14|ab`; `%U` of `int32(-1)` → `U+FFFFFFFFFFFFFFFF`; `%q` of nil `[]string` → `[]` (all targets).
  - Done when: all five match Go; no throw.
- [ ] Task 8.5: Shortest float formatting
  - Files: `src/backend/js/fmt-runtime.js`, `src/backend/wasm/stdlib/core.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test: `float32(0.1)` → `0.1`; `float32(1)/3` → `0.33333334`; `[]float32{0.1}` → `[0.1]`; `float64(9007199254740992)` → `9.007199254740992e+15` (all targets).
  - Done when: `%v` uses Go's shortest `%g` rules for both widths.

### Phase 9: WASM fmt Parity

- [ ] Task 9.1: `Println` separators around empty and space-ended strings
  - Files: `src/backend/wasm/stdlib/core.js`, `src/backend/wasm/emit-builtins.js`, `test/unit/wasm/fmt-any.test.js`
  - Test: `Println("", "|")` → ` |`; `Println(0, "a ", true)` → `0 a  true`; `Println(2, "", nil)` → `2  <nil>` (all targets).
  - Done when: WASM matches Go and the third module validates.
- [ ] Task 9.2: Unsigned values print unsigned
  - Files: `src/backend/wasm/stdlib/core.js`, `src/backend/wasm/emit-builtins.js`, `test/unit/wasm/fmt-any.test.js`
  - Test: `[1]uint32{3465168386}` → `[3465168386]`; uint32 method result `^uint32(0)` → `4294967295`; `uint32(3304433030)` → `3304433030`; `any(uint64(1<<63))` → `9223372036854775808`; `-u` (uint64 1) → `18446744073709551615` (wasm).
  - Done when: all five match Go on WASM.
- [ ] Task 9.3: Struct map key order and stable `%p` ids
  - Files: `src/backend/wasm/stdlib/core.js`, `test/unit/wasm/fmt-any.test.js`
  - Test: `map[K]int{K{2}:2, K{1}:3}` → `map[{1}:3 {2}:2]`; `Sprintf("%p|%p", &x, &x)` → equal ids on JS and WASM.
  - Done when: both match across targets.
- [ ] Task 9.4: Multi-value calls as `Println` arguments
  - Files: `src/backend/js/stdlib/fmt.js`, `src/backend/wasm/emit-builtins.js`, `test/unit/builtins/fmt-verbs.test.js`
  - Test: `Println(strings.Cut("a=b", "="))` → `a b true`; `Println(strconv.ParseFloat("1.5", 64))` → `1.5 <nil>` (all targets).
  - Done when: JS spreads the tuple and WASM prints every value.
- [ ] Task 9.5: Func values in WASM `fmt`
  - Files: `src/backend/wasm/emit-builtins.js`, `test/unit/wasm/fmt-any.test.js`
  - Test: `fmt.Println(func(){})` in a wasm package → a valid module that prints an address-style `0x…` value, or `assertErrorContains(errors, "func values cannot be formatted")`.
  - Done when: no module validation failure.

### Phase 10: WASM Expressions and Globals

- [ ] Task 10.1: `append` and `copy` from a string
  - Files: `src/backend/wasm/emit-builtins.js`, `test/unit/wasm/slices.test.js`
  - Test: `append(b, "hello"...)` → `len 5`; `copy(e.enc[:], "ABC…567")` → `e.enc[1] == 'B'` (66) (all targets).
  - Done when: both modules validate and match JS.
- [ ] Task 10.2: Constants in WASM: mixed-width compare, complex results, local consts
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/emit-stmts.js`, `test/unit/wasm/scalars.test.js`
  - Test: `c <= rune(s[i+1]) && rune(s[i+1]) < 0xe000` → `true`; `func f() complex128 { return 1 }` → `(1+0i)`; local `const th float64 = 1 << 30` → `1` (all targets).
  - Done when: all three validate and match.
- [ ] Task 10.3: Boxing into `any`: 64-bit ints, typed nil maps, named ints under `--wasm-opt`
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/types.js`, `test/unit/wasm/fmt-any.test.js`
  - Test: `x := any(uint64(1)); fmt.Println(x)` → `1`; `var a any = nilMap; a == nil` → `false`; `iter.Seq[int](f)` ranges once; `fmt.Println(any(Color(1)))` builds with `--wasm-opt` (in `test/unit/wasm/optimize.test.js`).
  - Done when: all modules validate (incl. Binaryen) and outputs match Go.
- [ ] Task 10.4: Package initialisation order and zero values
  - Files: `src/backend/wasm/globals.js`, `test/unit/wasm/structs.test.js`
  - Test: `var x1 = y1 + 1; var y1 = compute()` → `3`; `const (A = B + 1; B = C * 2; C = 3); var z1 = A + 1` → `8`; `var big [100]P; big[99].B` → `0`; `type Q struct{X [3]int}; var q Q; q.X[1]` → `0` (wasm).
  - Done when: all four compile and run without traps.
- [ ] Task 10.5: Pointers to pointers and pointer receivers on named maps
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/method-expr.js`, `test/unit/wasm/pointers.test.js`
  - Test: `p := &T{3}; pp := &p; (*pp).X` → `3`; `type M map[int]int; (m *M) Set` then `len(g)` → `1` (all targets).
  - Done when: both modules validate and match Go.

### Phase 11: WASM Statements, Generics, Interfaces and Facade

- [ ] Task 11.1: `fallthrough` chains
  - Files: `src/backend/wasm/emit-stmts.js`, `test/unit/wasm/go_semantics.test.js`
  - Test: `switch 3 { case 3: v += 100; fallthrough; case 2: v += 10; fallthrough; case 1: v++ }` → `111` (all targets).
  - Done when: WASM runs every fallen-through body.
- [ ] Task 11.2: Multi-value assignment to computed indexes and mixed `:=`
  - Files: `src/backend/wasm/emit-stmts.js`, `test/unit/wasm/go_semantics.test.js`
  - Test: `w[2*3], w[2*3+1] = add(1, 2)` → `w[6] == 3`; `h, c1 := addc(x, y); h, c2 := addc(h, c0)` (x=0xffffffff, y=0, c0=1) → `0 0 1` (all targets).
  - Done when: both match Go on WASM.
- [ ] Task 11.3: Nested generic instances and named results in generic methods
  - Files: `src/backend/wasm/monomorph.js`, `test/unit/wasm/generics.test.js`
  - Test: `[]Box[Box[int]]` summed via `slices.Values` → `3`; `(*Pointer[T]).Swap(nv *T) (old *T)` → `1` (all targets).
  - Done when: module validates and `old` resolves.
- [ ] Task 11.4: Interface dispatch and recoverable nil traps
  - Files: `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/types.js`, `test/unit/wasm/interfaces.test.js`
  - Test: `fmt.Println(w.Write([]byte("xy")))` via interface → `2 <nil>`; `var g Getter = &x` (`MyInt(42)`) → `42`; nil `*N` value-method call under `recover` → recovered; `var p *S; _ = *p` under `recover` → recovered (all targets; recover tests in `test/unit/wasm/defer_recover.test.js`).
  - Done when: no validation failure, no `interface conversion` error, no uncatchable trap.
- [ ] Task 11.5: Facade identifiers for qualified type names
  - Files: `src/backend/wasm/boundary.js`, `test/unit/wasm/boundary.test.js`
  - Test: wasm package exporting `G[time.Duration]` → facade JS parses and `Make().Get()` returns `1000000000`; wasm main with `Mk(n Named) fmt.Stringer` → builds and prints `x`.
  - Done when: both projects build and run via `compileHybridProject`.

### Phase 12: JSON

- [ ] Task 12.1: JS `json.Marshal` parity
  - Files: `src/backend/js/stdlib/json.js`, `test/unit/builtins/json.test.js`
  - Test: nil map → `null`; `P{}` nil map field → `{"M":null}` (also in `both`); `omitempty` empty map → `{}`; struct with tags inside `any` → `{"p":{"street":"S"}}`; `+Inf` → `json: unsupported value: +Inf`; `RawMessage("[1, 2]")` → `[1,2]` (all targets).
  - Done when: all six match WASM and Go.
- [ ] Task 12.2: JS `json.Unmarshal` parity
  - Files: `src/backend/js/stdlib/json.js`, `test/unit/builtins/json.test.js`
  - Test: `map[string]int` len → `2`; `map[string]any` len → `1`; `[3]int` from `[1,2]` → `[1 2 0]`; nil `*Item` → `json: Unmarshal(nil *main.Item)`; non-pointer `[]int` → `json: Unmarshal(non-pointer []int)` (all targets).
  - Done when: all five match WASM and Go.
- [ ] Task 12.3: WASM JSON for types reached only through `any`
  - Files: `src/lower/json-codecs.js`, `test/unit/wasm/json.test.js`
  - Test: `var a any = get()` (`get() []T` returns nil); `json.Marshal(a)` → `null <nil>` (wasm).
  - Done when: no `unsupported dynamic type` error for slice/array/map types stored in `any`.

### Phase 13: Templ

- [ ] Task 13.1: Rename reserved-name parameters in templ bodies
  - Files: `src/backend/js/templ.js`, `test/unit/compiler/templ.test.js`
  - Test: `templ V(class string) { <p class={ class }>{ class }</p> }` → body uses `class$`; output parses (`new Function`) for `class`, `function`, `delete`, `let`, `this`, `typeof`.
  - Done when: generated JS is valid for every reserved name the signature renames.
- [ ] Task 13.2: Report errors in templ `for` loops
  - Files: `src/backend/js/templ.js`, `test/unit/compiler/templ.test.js`
  - Test: `for _, x := range xs { <p>{ x + }</p> }` and `for x := range { <p>hi</p> }` → build fails with `Parse error`; update the tests that pinned the old swallow behaviour.
  - Done when: `gofront build` exits 1 for both; valid loops unchanged.
- [ ] Task 13.3: Type-check templ expressions
  - Files: `src/typechecker/index.js`, `src/parser/templ.js`, `test/unit/compiler/templ.test.js`
  - Test: `{ name + undefinedVar }` → `Undefined: 'undefinedVar'`; `{ name + 5 }` → mismatched-types error; `example/templ` still checks clean.
  - Done when: both negative tests pass and `npm run check` is green.

### Phase 14: Tooling, Diagnostics, Example and Docs

- [ ] Task 14.1: Layer guard: stale entries, template-literal imports, shared code
  - Files: `scripts/check-layers.js`, `test/unit/compiler/check-layers.test.js`
  - Test: an `ALLOW` key for a missing file and a `PENDING_CROSS` pair with no matching import → reported stale; ``import(`../wasm/emit.js`)`` from a JS backend file → cross-backend finding; `src/backend/shared/x.js` importing `../js/runtime.js` → finding.
  - Done when: the three fixtures fail the guard and the real tree passes.
- [ ] Task 14.2: Deterministic test-harness checks
  - Files: `test/unit/cli/cli.test.js`, `test/unit/compiler/runner.test.js`, `test/unit/compiler/plan-paths.test.js`
  - Test: dev smoke test polls stderr for `dev server running` (deadline ≥ 5 s) then kills the child; discovery test builds an unsorted fixture and fails if `found.sort()` is removed; plan-paths test fails when every path an exempt entry matches exists (probe file in a temp root).
  - Done when: each new assertion fails against a mutated helper (recorded in the commit body) and passes on the real one.
- [ ] Task 14.3: CLI: unwritable output paths and reproducible vendor bundles
  - Files: `src/cli/cli-core.js`, `src/cli/vendor.js`, `test/unit/cli/cli-core.test.js`
  - Test: `-o /proc/x/app.js` → `cannot write` error and exit 1 within 5 s; two `prep` runs of `example/preact` (in `test/unit/cli/prep.test.js`) produce byte-identical `vendor.js`.
  - Done when: no hang; vendor hash stable.
- [ ] Task 14.4: Diagnostics: one error for unavailable wasm imports; precision warning for literals
  - Files: `src/compiler.js`, `src/backend/js/expressions.js`, `test/unit/compiler/targets.test.js`
  - Test: wasm `import "reflect"` → exactly one error, `package 'reflect' is not available`; `const c = 9007199254740993` in js → warning containing `exceeds JS Number precision`.
  - Done when: both assertions pass.
- [ ] Task 14.5: `example/hybrid` SIMD bounce and test isolation
  - Files: `example/hybrid/src/sim/sim.go`, `example/hybrid/src/sim/sim_test.go`
  - Test: in `sim_test.go`, `Reset(1001,800,600)` then 300× `Step(0.016,400,300,100,100)` → energy equals the scalar `stepOne` result (674529.9 ± 0.1); `TestLoadConfig` restores `DefaultConfigJSON` (assert `ConfigName()` after cleanup).
  - Done when: `gofront test example/hybrid/src/sim` passes and E2E hybrid spec stays green.
- [ ] Task 14.6: User docs
  - Files: `docs/language-support.md`, `docs/go-compatibility.md`, `README.md`
  - Test: `node test/unit/compiler/plan-paths.test.js` and `npm run check` stay green.
  - Done when: limitations fixed in Phases 2–13 (leading-dot floats, Unicode identifiers, `fallthrough` in WASM, generic function values, templ type checking, etc.) are no longer listed, and remaining known gaps match the Boundary Matrix.

