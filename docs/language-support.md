# Language Features & Stdlib

Everything below is available in `js` packages. The subset available inside `wasm`/`both`
packages is listed in the [hybrid guide](hybrid-wasm.md#what-wasm-packages-support).

### Core language

| Feature | Status |
|---|---|
| Variables (`var`, `:=` short re-declaration) | ✓ <!-- fixture: package main; func Main() int { var a = 1; a, b := 2, 3; return a + b } --> |
| Constants (`const`, `iota`, untyped constants) | ✓ <!-- fixture: package main; const ( A = iota; B; C ); func Main() int { return A + B + C } --> |
| Constant expressions | ✓ <!-- fixture: package main; const X = (1 << 10) + 24; func Main() int { return X } --> |
| Functions, multiple returns, named returns, variadic | ✓ <!-- fixture: package main; func f(a int, b int) int { return a + b }; func Main() int { return f(20, 22) } --> |
| `init()` functions | ✓ <!-- fixture: package main; var x = 1; func init() { x += 41 }; func Main() int { return x } --> |
| Closures / function literals | ✓ <!-- fixture: package main; func Main() int { f := func(x int) int { return x * 2 }; return f(21) } --> |
| `async func` / `await` expressions | ✓ <!-- no-fixture: JS-only language extension; not supported in WASM --> |
| `defer`, `panic()` / `recover()` | ✓ <!-- fixture: package main; func Main() int { defer func() { recover() }(); panic("test"); return 0 } --> |
| `print` / `println` builtins | ✓ — compile to `console.log` <!-- no-fixture: output side-effect only --> |
| Runtime panics (index, nil map, nil deref) | ✓ — `both` packages panic with Go's message on both backends (JS strict mode), and `recover()` catches them on both <!-- fixture: package main; func Main() (res int) { defer func() { if recover() != nil { res = 1 } }(); var m map[string]int; m["k"] = 1; return 0 } --> |

### Types & data structures

| Feature | Status |
|---|---|
| Structs + methods (value & pointer receivers) | ✓ <!-- fixture: package main; type S struct { N int }; func (s S) Val() int { return s.N }; func (s *S) Inc() { s.N++ }; func Main() int { s := S{41}; (&s).Inc(); return s.Val() } --> |
| Embedded structs (flattened fields + promoted methods) | ✓ <!-- fixture: package main; type Inner struct { X int }; func (i Inner) Get() int { return i.X }; type Outer struct { Inner }; func Main() int { o := Outer{Inner: Inner{X: 42}}; return o.X } --> |
| Anonymous struct types | ✓ — compile to plain JS objects <!-- fixture: package main; func Main() int { s := struct { X int }{X: 42}; return s.X } --> |
| Interfaces (with embedding) | ✓ <!-- fixture: package main; type Reader interface { Read() int }; type ReadCloser interface { Reader; Close() int }; type Impl struct { V int }; func (i Impl) Read() int { return i.V }; func (i Impl) Close() int { return 0 }; func Main() int { var rc ReadCloser = Impl{42}; return rc.Read() } --> |
| Slices (`append`, `len`, `make`) | ✓ <!-- fixture: package main; func Main() int { s := make([]int, 0, 2); s = append(s, 10, 32); return len(s)*100 + s[0] + s[1] } --> |
| Maps (`make`, `delete`, comma-ok) | ✓ <!-- fixture: package main; func Main() int { m := make(map[string]int); m["a"] = 42; v, ok := m["a"]; delete(m, "a"); _, ok2 := m["a"]; if ok && !ok2 { return v }; return 0 } --> |
| Arrays with compile-time enforcement | ✓ — reject `append`, bounds checking, size matching, `[...]T` inference, compile-time `len()` <!-- fixture: package main; func Main() int { a := [...]int{1, 2, 3}; return len(a)*10 + a[1] } --> |
| Slice → array conversion (`[N]T(slice)`) | ✓ — Go 1.20 <!-- no-fixture: pending WASM typed slice conversion in Task 0.8 --> |
| Pointers (`&x`, `*p`, `new(T)`) | ✓ — scalar locals boxed as `{ value: T }` for shared mutation <!-- fixture: package main; func Main() int { x := 42; p := &x; *p = 100; return x } --> |
| `error` type | ✓ — interface `{ Error() string }`; custom error types, `errors.Is`/`Unwrap`, `%w` wrapping <!-- fixture: package main; import "errors"; func Main() int { err := errors.New("err"); if err != nil && err.Error() == "err" { return 1 }; return 0 } --> |
| Complex numbers (`complex64`, `complex128`, `3i`) | ✓ — `complex()`, `real()`, `imag()` builtins; `__cmul`/`__cdiv` helpers <!-- fixture: package main; func Main() int { c := complex(1.0, 2.0) + 3i; if real(c) == 1.0 && imag(c) == 5.0 { return 1 }; return 0 } --> |
| Type definitions, type aliases (`type A = B`) | ✓ <!-- fixture: package main; type MyInt int; type Alias = MyInt; func Main() int { var a Alias = 42; return int(a) } --> |
| Generic type aliases (Go 1.24) | ✓ — `type A[T any] = B[T]` <!-- fixture: package main; type Box[T any] struct { Val T }; type Alias[T any] = Box[T]; func Main() int { b := Alias[int]{Val: 42}; return b.Val } --> |
| Methods on named non-struct types | ✓ — basic, slice, map and func types (`type Celsius float64`, `type Names []string`); value and pointer receivers; values stay plain JS values, methods dispatch statically, and values are boxed only inside interfaces; satisfies interfaces, type assertions and switches <!-- fixture: package main; type MyInt int; func (m MyInt) Double() int { return int(m * 2) }; func Main() int { x := MyInt(21); return x.Double() } --> |
| Type conversions, type assertions (plain & comma-ok) | ✓ <!-- fixture: package main; func Main() int { var x any = 42; n, ok := x.(int); if ok { return n }; return 0 } --> |
| Type switch (`switch v := x.(type)`) | ✓ — compiles to `if/else if` with `typeof` / `instanceof` <!-- fixture: package main; func check(x any) int { switch v := x.(type) { case int: return v; default: return 0 } }; func Main() int { return check(42) } --> |
| Sized integers (`int8`–`int64`, `uint8`–`uint64`, `float32`) | ✓ — distinct types in the checker; `rune` = `int32`, `byte` = `uint8`; conversions truncate to width; arithmetic is float64 in `js` packages, exact in `wasm`/`both` <!-- fixture: package main; func Main() int { var a int8 = 10; var b int16 = 20; var c int32 = 30; return int(a) + int(b) + int(c) } --> |
| Generics (`func F[T any]`, `type S[T any] struct`) | ✓ — type erasure to JS; generic functions, structs, constraints (`any`, `comparable`, interfaces, unions), type inference <!-- fixture: package main; func Identity[T any](x T) T { return x }; func Main() int { return Identity(42) } --> |
| Struct field tags | ✓ — parsed and preserved; `json:"…"` tags drive the compile-time `encoding/json` codecs (no reflection) <!-- no-fixture: struct tags are compile-time metadata for encoding/json --> |
| Struct and array equality (`a == b`) | ✓ — deep comparison via `__equal` helper <!-- fixture: package main; type Pt struct { X, Y int }; func Main() int { p1 := Pt{1, 2}; p2 := Pt{1, 2}; p3 := Pt{1, 3}; if p1 == p2 && p1 != p3 { return 1 }; return 0 } --> |
| Builtin `min`, `max`, and `clear` (Go 1.21) | ✓ — numbers and strings; float `NaN` propagates and `min(-0.0, 0.0)` is `-0` <!-- fixture: package main; func Main() int { a, b := 10, 20; s := min("b", "a"); if s != "a" { return 0 }; return min(a, b) + max(1, 2) } --> |

### Control flow

| Feature | Status |
|---|---|
| `if` / `else if` / `else` (with init statement) | ✓ <!-- fixture: package main; func Main() int { if x := 10; x > 5 { return x } else { return 0 } } --> |
| `for` (C-style, condition-only, infinite, `range`) | ✓ <!-- fixture: package main; func Main() int { sum := 0; for i := 0; i < 5; i++ { sum += i }; return sum } --> |
| Per-iteration loop variables (Go 1.22) | ✓ in JS; WASM pending Task 0.10 <!-- fixture: pending: Task 0.10 | package main; func Main() int { var fs []func() int; for i := 0; i < 3; i++ { fs = append(fs, func() int { return i }) }; return fs[0]()*100 + fs[1]()*10 + fs[2]() } --> |
| `range` over slice, map, string, integer | ✓ <!-- fixture: package main; func Main() int { sum := 0; for i, v := range []int{10, 20, 30} { sum += i + v }; return sum } --> |
| Range over iterator functions (Go 1.23) | ✓ — `func(yield func(K, V) bool)` protocol; break/continue/return propagation <!-- fixture: package main; func count(yield func(int) bool) { yield(1); yield(2); yield(3) }; func Main() int { sum := 0; for v := range count { sum += v }; return sum } --> |
| `switch` / `fallthrough` (with init statement) | ✓ <!-- fixture: package main; func Main() int { switch x := 2; x { case 1: return 10; case 2: return 20; default: return 0 } } --> |
| `break` / `continue` / labeled variants | ✓ <!-- fixture: package main; func Main() int { sum := 0; Outer: for i := 0; i < 5; i++ { for j := 0; j < 5; j++ { if i == 2 { break Outer }; sum++ } }; return sum } --> |
| Terminating statement analysis | ✓ — missing `return` in non-void functions is a type error <!-- no-fixture: compile-time analysis rejecting missing return --> |
| `goto` statement | ✗ — targeted diagnostic: `goto is not supported; restructure with labeled break/continue` <!-- fixture: diagnostic: goto is not supported => package main; func Main() int { goto L; L: return 1 } --> |

### Expressions & literals

| Feature | Status |
|---|---|
| Arithmetic, comparison, logical, bitwise operators | ✓ — includes `&^` (bit clear) <!-- fixture: package main; func Main() int { a := 10 + 2; b := 5 &^ 1; if a > 10 && b == 4 { return a + b }; return 0 } --> |
| Compound assignment, increment / decrement | ✓ <!-- fixture: package main; func Main() int { x := 10; x += 5; x++; x--; return x } --> |
| Slice expressions (`s[lo:hi]`, `s[lo:hi:max]`) | ✓ <!-- fixture: package main; func Main() int { s := []int{1, 2, 3, 4, 5}; sub := s[1:3]; return sub[0]*10 + sub[1] } --> |
| Variadic spread (`f(slice...)`, `append(a, b...)`) | ✓ <!-- fixture: package main; func Main() int { a := []int{10, 20}; b := []int{30, 40}; c := append(a, b...); return c[0] + c[1] + c[2] + c[3] } --> |
| Positional struct literals (`Point{1, 2}`) | ✓ <!-- fixture: package main; type Pt struct { X, Y int }; func Main() int { p := Pt{10, 20}; return p.X + p.Y } --> |
| Method expressions with value receiver (`T.Method`) / method values (`x.Method`) | ✓ — method expressions on both backends; method values JS-only (WASM in Task 0.19c) <!-- no-fixture: method values are JS-only until Task 0.19c; T.Method is covered by the pointer-receiver row and expressions.test.js --> |
| Method expressions on pointer receivers (`(*T).Method`) | ✓ — `(*T).M` is a `func(*T, …)`, also on generic types (`(*Box[int]).Set`) <!-- fixture: package main; type C struct { N int }; func (c *C) Inc() { c.N++ }; func Main() int { f := (*C).Inc; c := &C{N: 1}; f(c); return c.N } --> |
| Multi-value function forwarding (`f(g())`) | ✓ <!-- fixture: package main; func g() (int, int) { return 10, 20 }; func f(a, b int) int { return a + b }; func Main() int { return f(g()) } --> |
| Raw string literals (backticks), rune literals | ✓ <!-- fixture: package main; func Main() int { s := `raw`; r := 'A'; if s == "raw" && r == 65 { return 1 }; return 0 } --> |
| Numeric separators (`1_000_000`), binary/octal/hex literals | ✓ <!-- fixture: package main; func Main() int { a := 1_000; b := 0b101; c := 0o12; d := 0x1f; return a + b + c + d } --> |
| `[]byte(s)` conversions | ✓ <!-- fixture: package main; func Main() int { b := []byte("hello"); return len(b)*10 + int(b[0]) } --> |
| `[]rune(s)` conversions | ✓ — code points; `string(r)` and `string(r[i])` <!-- fixture: package main; func Main() int { r := []rune("héllo"); r = append(r, 'x'); if string(r[1]) != "é" || string(r) != "héllox" { return 0 }; return len(r) } --> |

### Standard library shims

Coverage of the Go 1.26 standard library, per package:

<!-- stdlib:begin -->
<!-- Generated by `npm run docs:stdlib` from stdlib/manifest.json; do not edit. -->

Members of each Go package (functions, types, methods, fields, constants and variables, as listed in Go's `api/go1.26.txt`) that GoFront provides. **Available** counts what works today out of the members in scope; **Not yet** is scheduled in the [portable Go plan](../plans/v1.8.0/portable-go-plan.md); **JS-only** members (included in the first two columns) are not available in `wasm`/`both` packages by design; **Excluded** members are out of scope.

| Package | Available | Not yet | JS-only | Excluded |
|---|---|---|---|---|
| `bufio` | 57 of 79 | 22 | 0 | 0 |
| `bytes` | 78 of 99 | 21 | 0 | 0 |
| `cmp` | 4 of 4 | 0 | 0 | 0 |
| `container/heap` | 6 of 11 | 5 | 0 | 0 |
| `container/list` | 21 of 21 | 0 | 0 | 0 |
| `container/ring` | 10 of 10 | 0 | 0 | 0 |
| `context` | 17 of 20 | 3 | 0 | 1 |
| `crypto/hmac` | 2 of 2 | 0 | 0 | 0 |
| `crypto/md5` | 4 of 4 | 0 | 0 | 0 |
| `crypto/rand` | 2 of 3 | 1 | 0 | 2 |
| `crypto/sha1` | 4 of 4 | 0 | 0 | 0 |
| `crypto/sha256` | 4 of 7 | 3 | 0 | 0 |
| `crypto/sha512` | 13 of 13 | 0 | 0 | 0 |
| `crypto/subtle` | 8 of 8 | 0 | 0 | 0 |
| `encoding/base32` | 19 of 19 | 0 | 0 | 0 |
| `encoding/base64` | 15 of 22 | 7 | 0 | 0 |
| `encoding/binary` | 13 of 33 | 20 | 0 | 0 |
| `encoding/csv` | 0 of 32 | 32 | 0 | 0 |
| `encoding/hex` | 7 of 15 | 8 | 0 | 0 |
| `encoding/json` | 5 of 68 | 63 | 0 | 0 |
| `errors` | 6 of 7 | 1 | 0 | 0 |
| `fmt` | 21 of 43 | 22 | 0 | 0 |
| `hash` | 5 of 32 | 27 | 0 | 0 |
| `hash/adler32` | 3 of 3 | 0 | 0 | 0 |
| `hash/crc32` | 12 of 12 | 0 | 0 | 0 |
| `hash/fnv` | 6 of 6 | 0 | 0 | 0 |
| `html` | 2 of 2 | 0 | 0 | 0 |
| `io` | 58 of 94 | 36 | 0 | 10 |
| `iter` | 2 of 2 | 0 | 0 | 2 |
| `log` | 0 of 43 | 43 | 0 | 0 |
| `maps` | 10 of 10 | 0 | 0 | 0 |
| `math` | 80 of 97 | 17 | 0 | 0 |
| `math/bits` | 50 of 50 | 0 | 0 | 0 |
| `math/cmplx` | 0 of 27 | 27 | 0 | 0 |
| `math/rand` | 12 of 45 | 33 | 0 | 0 |
| `math/rand/v2` | 0 of 51 | 51 | 0 | 8 |
| `net/url` | 60 of 60 | 0 | 0 | 0 |
| `os` | 10 of 10 | 0 | 3 | 188 |
| `path` | 9 of 9 | 0 | 0 | 0 |
| `path/filepath` | 9 of 19 | 10 | 0 | 8 |
| `regexp` | 15 of 49 | 34 | 49 | 0 |
| `slices` | 37 of 40 | 3 | 0 | 0 |
| `sort` | 36 of 40 | 4 | 0 | 0 |
| `strconv` | 41 of 43 | 2 | 0 | 0 |
| `strings` | 75 of 82 | 7 | 0 | 0 |
| `sync` | 39 of 39 | 0 | 0 | 7 |
| `sync/atomic` | 90 of 90 | 0 | 0 | 4 |
| `testing` | 94 of 94 | 0 | 0 | 72 |
| `time` | 100 of 134 | 34 | 5 | 11 |
| `unicode` | 52 of 52 | 0 | 0 | 257 |
| `unicode/utf16` | 7 of 7 | 0 | 0 | 0 |
| `unicode/utf8` | 19 of 19 | 0 | 0 | 0 |

Packages excluded as a whole, by reason:

| Reason | Packages |
|---|---|
| deferred | `archive/tar`, `archive/zip`, `compress/bzip2`, `compress/flate`, `compress/gzip`, `compress/lzw`, `compress/zlib`, `crypto`, `crypto/aes`, `crypto/cipher`, `crypto/des`, `crypto/dsa`, `crypto/ecdh`, `crypto/ecdsa`, `crypto/ed25519`, `crypto/elliptic`, `crypto/fips140`, `crypto/hkdf`, `crypto/hpke`, `crypto/mlkem`, `crypto/mlkem/mlkemtest`, `crypto/pbkdf2`, `crypto/rc4`, `crypto/rsa`, `crypto/sha3`, `crypto/tls`, `crypto/x509`, `crypto/x509/pkix`, `debug/buildinfo`, `debug/dwarf`, `debug/elf`, `debug/gosym`, `debug/macho`, `debug/pe`, `debug/plan9obj`, `embed`, `encoding`, `encoding/ascii85`, `encoding/asn1`, `encoding/pem`, `go/ast`, `go/build`, `go/build/constraint`, `go/constant`, `go/doc`, `go/doc/comment`, `go/format`, `go/importer`, `go/parser`, `go/printer`, `go/scanner`, `go/token`, `go/types`, `go/version`, `hash/crc64`, `hash/maphash`, `image`, `image/color`, `image/color/palette`, `image/draw`, `image/gif`, `image/jpeg`, `image/png`, `index/suffixarray`, `log/slog`, `math/big`, `mime`, `mime/quotedprintable`, `net/mail`, `net/netip`, `regexp/syntax`, `testing/cryptotest`, `testing/iotest`, `testing/slogtest`, `text/scanner`, `text/tabwriter`, `text/template/parse` |
| host | `database/sql`, `database/sql/driver`, `expvar`, `io/fs`, `io/ioutil`, `log/syslog`, `mime/multipart`, `net`, `net/http`, `net/http/cgi`, `net/http/cookiejar`, `net/http/fcgi`, `net/http/httptest`, `net/http/httptrace`, `net/http/httputil`, `net/http/pprof`, `net/rpc`, `net/rpc/jsonrpc`, `net/smtp`, `net/textproto`, `os/exec`, `os/signal`, `os/user`, `syscall`, `testing/fstest` |
| reflection | `encoding/gob`, `encoding/xml`, `flag`, `html/template`, `testing/quick`, `text/template` |
| runtime | `plugin`, `reflect`, `runtime`, `runtime/cgo`, `runtime/coverage`, `runtime/debug`, `runtime/metrics`, `runtime/pprof`, `runtime/trace`, `structs`, `testing/synctest`, `unique`, `weak` |
<!-- stdlib:end -->

Notable members and behaviour per package, including GoFront's own packages:

| Package | Functions |
|---|---|
| `fmt` | `Sprintf`, `Printf`, `Println`, `Print`, `Errorf`, `Fprintf`, `Fprintln`, `Fprint` — format verbs: `%v`, `%d`, `%s`, `%t`, `%x`, `%o`, `%b`, `%q`, `%e`, `%g`, `%w`, width/precision; **scanning**: `Sscan`, `Sscanln`, `Sscanf` |
| `strings` | `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `LastIndex`, `Count`, `Repeat`, `Replace`, `ReplaceAll`, `ToUpper`, `ToLower`, `TrimSpace`, `Trim`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `Split`, `Join`, `EqualFold`, `Fields`, `FieldsFunc`, `Cut`, `CutPrefix`, `CutSuffix`, `SplitN`, `SplitAfter`, `SplitAfterN`, `IndexAny`, `LastIndexAny`, `ContainsAny`, `ContainsRune`, `IndexRune`, `IndexByte`, `LastIndexByte`, `Map`, `Title`, `ToTitle`, `TrimFunc`, `TrimLeftFunc`, `TrimRightFunc`, `IndexFunc`, `LastIndexFunc`, `NewReplacer`; **`Builder`** type; **`NewReader`** → reader shim |
| `bytes` | `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `Join`, `Split`, `Replace`, `ToUpper`, `ToLower`, `TrimSpace`, `Equal`, `Count`, `Repeat`, `ReplaceAll`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `TrimFunc`, `IndexByte`, `LastIndex`, `LastIndexByte`, `Fields`, `FieldsFunc`, `Cut`, `ContainsAny`, `ContainsRune`, `Map`, `SplitN`, `Clone`; **`Buffer`** type; **`NewReader`** → reader shim |
| `strconv` | `Itoa`, `Atoi`, `FormatBool`, `FormatInt`, `FormatFloat`, `FormatUint`, `ParseFloat`, `ParseInt`, `ParseBool`, `ParseUint`, `Quote`, `Unquote`, `AppendInt`, `AppendFloat`, `AppendUint`, `AppendBool` |
| `sort` | `Ints`, `Float64s`, `Strings`, `Slice`, `SliceStable`, `SliceIsSorted`, `Search`, `IntsAreSorted`, `Float64sAreSorted`, `StringsAreSorted` |
| `math` | `Abs`, `Floor`, `Ceil`, `Round`, `Sqrt`, `Cbrt`, `Pow`, `Log`, `Log2`, `Log10`, `Sin`, `Cos`, `Tan`, `Atan`, `Atan2`, `Asin`, `Acos`, `Exp`, `Exp2`, `Trunc`, `Hypot`, `Signbit`, `Copysign`, `Dim`, `Remainder`, `Sinh`, `Cosh`, `Tanh`, `Float64bits`, `Float64frombits`, `Float32bits`, `Float32frombits`, `Min`, `Max`, `Mod`, `Inf`, `IsNaN`, `IsInf`, `NaN` + 24 constants (`Pi`, `E`, `Phi`, `Sqrt2`, `SqrtE`, `SqrtPi`, `SqrtPhi`, `Ln2`, `Log2E`, `Ln10`, `Log10E`, `MaxFloat64`, `SmallestNonzeroFloat64`, `MaxFloat32`, `SmallestNonzeroFloat32`, `MaxInt`, `MinInt`, `MaxInt32`, `MinInt32`, `MaxInt64`, `MinInt64`, `MaxUint32`, `MaxUint64`) |
| `math/rand` | `Intn`, `Float64`, `Float32`, `Int`, `Int63`, `Int63n`, `Int31`, `Int31n`, `Seed` (deterministic pure WASM PRNG), `Shuffle`, `Perm`, `Read` |
| `math/bits` | `LeadingZeros32`, `TrailingZeros32`, `OnesCount32`, `RotateLeft32`, `Reverse32`, `Len32`, `ReverseBytes16`, `ReverseBytes32`, `LeadingZeros64`, `TrailingZeros64`, `OnesCount64`, `RotateLeft64`, `Reverse64`, `Len64`, `ReverseBytes64` |
| `errors` | `New`, `Is`, `Unwrap`, `As`, `Join`, `ErrUnsupported` (Go-source overlay, `stdlib/errors`) — custom error types via interface satisfaction |
| `time` | `Now` → `time.Time`, `Since`, `Sleep` (JS-only), `Parse`, `Unix`, `Date`; **`time.Duration`** methods: `Seconds`, `Milliseconds`, `Microseconds`, `Nanoseconds`, `Minutes`, `Hours`, `String`; **`time.Time`** methods: `Format`, `String`, `Year`, `Month`, `Day`, `Hour`, `Minute`, `Second`, `Weekday`, `Unix`, `UnixMilli`, `UnixNano`, `Nanosecond`, `UTC`, `Local`, `IsZero`, `Add`, `Sub`, `Before`, `After`, `Equal`; layout constants: `RFC3339`, `RFC3339Nano`, `DateOnly`, `TimeOnly`, `DateTime`; duration constants: `Millisecond`, `Second`, `Minute`, `Hour`; month/weekday constants |
| `html` | `EscapeString`, `UnescapeString` |
| `cmp` | `Ordered`, `Compare`, `Less`, `Or` — written in Go (`stdlib/cmp`), compiled into the caller's target (`js`, `wasm` or `both`). |
| `iter` | `Seq`, `Seq2` — written in Go (`stdlib/iter`); range over them with `for v := range seq`. `Pull` and `Pull2` need coroutines and report `requires coroutines; out of scope (no runtime)`. |
| `maps` | `Clone`, `Copy`, `Equal`, `EqualFunc`, `Delete`, `DeleteFunc`; iterator members `All`, `Keys`, `Values`, `Insert`, `Collect` (Go-source overlay `stdlib/maps/iter.go`). `Keys` and `Values` return `iter.Seq`, as in Go 1.23: use `slices.Collect(maps.Keys(m))` or `slices.Sorted(maps.Keys(m))` for a slice. |
| `slices` | `Contains`, `ContainsFunc`, `Index`, `IndexFunc`, `BinarySearch`, `BinarySearchFunc`, `Equal`, `Compare`, `Sort`, `SortFunc`, `SortStableFunc`, `IsSorted`, `IsSortedFunc`, `Reverse`, `Max`, `Min`, `MaxFunc`, `MinFunc`, `Clone`, `Compact`, `CompactFunc`, `Concat`, `Delete`, `DeleteFunc`, `Insert`, `Replace`, `Grow`, `Clip`; iterator members `All`, `Values`, `Backward`, `Collect`, `AppendSeq`, `Sorted`, `SortedFunc`, `SortedStableFunc`, `Chunk` written in Go (`stdlib/slices/iter.go`, an overlay). They take `[]E` rather than a `Slice ~[]E` type parameter, so `Chunk` and `AppendSeq` of a named slice type return `[]E`. |
| `regexp` | `MustCompile`, `Compile`, `MatchString`, `QuoteMeta`; **`*Regexp`** methods: `MatchString`, `FindString`, `FindStringIndex`, `FindAllString`, `FindStringSubmatch`, `FindAllStringSubmatch`, `ReplaceAllString`, `ReplaceAllLiteralString`, `Split`, `String`. Inline flags (`(?i)`, `(?m)`, `(?s)`) are extracted automatically into the JS `RegExp` constructor. |
| `unicode` | `IsLetter`, `IsDigit`, `IsSpace`, `IsUpper`, `IsLower`, `IsPunct`, `IsControl`, `IsPrint`, `IsGraphic`, `ToUpper`, `ToLower` |
| `unicode/utf8` | `RuneCountInString`, `RuneLen`, `ValidString`, `ValidRune`, `DecodeRuneInString`, `DecodeLastRuneInString`, `FullRuneInString`; constants `RuneError`, `MaxRune`, `UTFMax` |
| `path` | `Base`, `Dir`, `Ext`, `Join`, `Clean`, `IsAbs`, `Split`, `Match`; `"path/filepath"` is an alias |
| `os` | `Exit`, `Args`, `Getenv` |
| `io` | `Writer`, `Reader`, `ReadWriter`, `Closer` interface types; `ReadAll`, `EOF`, `Discard`, `WriteString`, `Copy`, `CopyN`, `LimitReader` |
| `sync` | `Mutex`, `RWMutex`, `Once` (`Do`), `WaitGroup` (`Add`, `Done`, `Wait`) — single-threaded lightweight runtime shims |
| `crypto/rand` | `Read(b []byte)` backed by host `crypto.getRandomValues()` |
| `crypto/sha256` | `Sum256(data []byte)`, `New()` |
| `encoding/binary` | `LittleEndian`, `BigEndian` (`Uint16`, `Uint32`, `Uint64`, `PutUint16`, `PutUint32`, `PutUint64`, `AppendUint16`, `AppendUint32`, `AppendUint64`), `Read`, `Write`, `Size` |
| `encoding/hex` | `EncodeToString`, `DecodeString`, `EncodedLen`, `DecodedLen`, `Encode`, `Decode` |
| `encoding/base64` | `StdEncoding`, `URLEncoding`, `RawStdEncoding`, `RawURLEncoding` (`EncodeToString`, `DecodeString`, `EncodedLen`, `DecodedLen`), `NewEncoding` |
| `encoding/json` | `Marshal`, `MarshalIndent`, `Unmarshal`, `Valid`, `RawMessage` — codecs generated per type at compile time from `json` struct tags (`omitempty`, `string`, `-`, embedded-field promotion); calls `MarshalJSON` / `UnmarshalJSON` methods. `js` packages only. No `Encoder`/`Decoder`, `Number` or typed error values (`*json.SyntaxError`, …) |
| `gom` | Browser-native declarative DOM component library. **Types**: `Node` (interface), `NodeFunc`, `Group`. **Core**: `El(tag, children...)`, `Text(s)`, `Mount(sel, node[, refs])`, `MountTo(sel, node[, refs])` — the optional `refs map[string]any` receives elements marked `ref="name"` in `.templ` templates. **Attributes**: `Attr`, `Class`, `Href`, `Type`, `Src`, `Placeholder`, `DataAttr`, `Style`, `For`, `Name`, `Value`, `Target`, `Rel`, `Alt`, `Title`, `Draggable`, `Role`, `AriaLabel`, `StyleAttr`; boolean: `Disabled`, `Checked`, `Selected`, `Readonly`. **Logic**: `If(cond, node)`, `Map(slice, fn)`. **Elements**: full HTML element set (`Div`, `Span`, `Button`, `Input`, `Ul`, `Li`, `Table`, `Form`, `Img`, `A`, `H1`–`H6`, …) |
| `gofront/shared` | Fixed-size linear-memory buffers for zero-copy JS↔WASM sharing (`Float32`, `Float64`, `Int8`, `Int16`, `Int32`, `Uint8`, `Uint16`, `Uint32` via `shared.NewXxx(n)` and `.Subarray(lo, hi)`). Lowered to plain TypedArrays in `--js-only` builds. See the [hybrid guide](hybrid-wasm.md#shared-linear-memory-buffers-gofrontshared). |
| `gofront/simd` (experimental) | `F32x4` 4-lane `float32` vector: `F32x4{a, b, c, d}`, `Splat`, `NewF32x4`, `Add`, `Sub`, `Mul`, `Div`, `Min`, `Max`, `Dot3`, `Dot4`, `Lane`, `WithLane` (constant lane index); `LoadF32x4`/`StoreF32x4` on `shared.Float32`. WASM `v128` in `wasm` packages, `Math.fround` arrays in `js`. See the [hybrid guide](hybrid-wasm.md#wasm-simd-gofrontsimd-experimental). |
| `testing` | **`testing.T`**: `Error`, `Errorf`, `Fatal`, `Fatalf`, `Fail`, `Failed`, `FailNow`, `Log`, `Logf`, `Skip`, `Skipf`, `Skipped`, `Helper`, `Run`, `Name`. **Package functions**: `Short()`, `Verbose()`. Tests are `func TestXxx(t *testing.T)` in `*_test.go` files, excluded from normal compilation and run via `gofront test`. |

### Packages & imports

| Feature | Status |
|---|---|
| Multi-file packages | ✓ |
| Cross-package imports | ✓ |
| Import aliases (`import m "./pkg"`) | ✓ |
| Side-effect imports (`import _ "pkg"`) | ✓ |
| Dot imports (`import . "pkg"`) | ✓ |
| Unused import detection | ✓ |
| External `.d.ts` types | ✓ — TypeScript tuple returns map to Go multi-value results (`state, setState := useState(0)`); rest parameters become variadic |
| npm package type resolution | ✓ |
| `.templ` files in packages | ✓ — mix `.go` and `.templ` files freely; templ components and `css` declarations visible across the whole package |
| `//gofront:target` directives | ✓ — per-package `js` / `wasm` / `both` targets; see the [hybrid guide](hybrid-wasm.md) |

### `.templ` templates

| Feature | Status |
|---|---|
| `templ Name(params) { <html/> }` components | ✓ — compile to direct `createElement` calls; return a `gom.Node` |
| `{ expr }` interpolation, `attr={ expr }`, `attr?={ bool }` | ✓ |
| `@Component(args)`, `@templ.Raw(html)` | ✓ |
| `if` / `else if` / `else`, `for range`, `switch` inside bodies | ✓ |
| `css Name() { … }` scoped styles | ✓ — class `gfc_<name>_<hash>`, injected into `<head>` once; nested `&`, media queries and keyframes supported |
| `ref="name"` element capture | ✓ — stripped from output; populated into the `refs` map passed to `gom.Mount`/`gom.MountTo`; forwarded through nested `@Component()` calls |
| SVG elements | ✓ — created in the SVG namespace, `class` set via `setAttribute` |

---

