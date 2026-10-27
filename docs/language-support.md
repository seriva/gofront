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
| Slice → array conversion (`[N]T(slice)`) | ✓ — Go 1.20 <!-- no-fixture: JS-only; covered by test/unit/types/arrays.test.js --> |
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
| Per-iteration loop variables (Go 1.22) | ✓ <!-- fixture: package main; func Main() int { var fs []func() int; for i := 0; i < 3; i++ { fs = append(fs, func() int { return i }) }; return fs[0]()*100 + fs[1]()*10 + fs[2]() } --> |
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
| Method expressions with value receiver (`T.Method`) / method values (`x.Method`) | ✓ <!-- fixture: package main; type C struct { N int }; func (c C) Add(k int) int { return c.N + k }; func Main() int { c := C{N: 10}; f := C.Add; g := c.Add; return f(c, 5) + g(7) } --> |
| Method expressions on pointer receivers (`(*T).Method`) | ✓ — `(*T).M` is a `func(*T, …)`, also on generic types (`(*Box[int]).Set`) <!-- fixture: package main; type C struct { N int }; func (c *C) Inc() { c.N++ }; func Main() int { f := (*C).Inc; c := &C{N: 1}; f(c); return c.N } --> |
| Multi-value function forwarding (`f(g())`) | ✓ <!-- fixture: package main; func g() (int, int) { return 10, 20 }; func f(a, b int) int { return a + b }; func Main() int { return f(g()) } --> |
| Raw string literals (backticks), rune literals | ✓ <!-- fixture: package main; func Main() int { s := `raw`; r := 'A'; if s == "raw" && r == 65 { return 1 }; return 0 } --> |
| Numeric separators (`1_000_000`), binary/octal/hex literals | ✓ <!-- fixture: package main; func Main() int { a := 1_000; b := 0b101; c := 0o12; d := 0x1f; return a + b + c + d } --> |
| `[]byte(s)` conversions | ✓ <!-- fixture: package main; func Main() int { b := []byte("hello"); return len(b)*10 + int(b[0]) } --> |
| `[]rune(s)` conversions | ✓ — code points; `string(r)` and `string(r[i])` <!-- fixture: package main; func Main() int { r := []rune("héllo"); r = append(r, 'x'); if string(r[1]) != "é" || string(r) != "héllox" { return 0 }; return len(r) } --> |

### Standard library shims

Coverage of the Go standard library, per package. Anything not listed here is not available; importing it gives an error naming the package.

| Package | Targets | Notes |
|---|---|---|
| `bufio` | js, wasm, both | Go source: Reader, Writer, Scanner, ReadWriter |
| `bytes` | js, wasm, both | Buffer, Reader and the search/split/trim helpers |
| `cmp` | js, wasm, both | Go source |
| `container/heap`, `container/list`, `container/ring` | js, wasm, both | Go source |
| `context` | js, wasm, both | Go source; no `Done()` channel (use `Err()` or `AfterFunc`) |
| `crypto/hmac`, `crypto/md5`, `crypto/sha1`, `crypto/sha512`, `crypto/subtle` | js, wasm, both | Go source |
| `crypto/rand` | js, wasm, both | `Read`, `Reader` |
| `crypto/sha256` | js, wasm, both | `Sum256`, `New` |
| `encoding/base32` | js, wasm, both | Go source |
| `encoding/base64` | js, wasm, both | Std, URL and Raw encodings |
| `encoding/binary` | js, wasm, both | `BigEndian` and `LittleEndian` byte-order accessors, `Read`, `Write`, `Size`, `Append*`; no varints |
| `encoding/csv` | js, wasm, both | Go source |
| `encoding/hex` | js, wasm, both | `EncodeToString`, `DecodeString`, `Encode`, `Decode`, `EncodedLen`, `DecodedLen` |
| `encoding/json` | js, wasm, both | Go source; struct tags, `Marshal`, `Unmarshal`, `Decoder`, `Encoder` |
| `errors` | js, wasm, both | `New`, `Is`, `As`, `Unwrap`, `Join` |
| `fmt` | js, wasm, both | Print, Sprint, Fprint, Errorf, Append, `Sscan*` |
| `hash`, `hash/adler32`, `hash/crc32`, `hash/fnv` | js, wasm, both | Go source |
| `html` | js, wasm, both | `EscapeString`, `UnescapeString` |
| `io` | js, wasm, both | Reader/Writer interfaces and helpers; no `Pipe` |
| `iter`, `maps`, `slices`, `sort` | js, wasm, both | Go 1.23 iterator APIs; no `iter.Pull` |
| `log` | js, wasm, both | Go source |
| `math`, `math/bits` | js, wasm, both | Some `math` members are Go source |
| `math/cmplx` | js, wasm, both | Go source |
| `math/rand`, `math/rand/v2` | js, wasm, both | Seeded generators (`math/rand` is a subset in `wasm`/`both`); no `ChaCha8` |
| `net/url` | js, wasm, both | Go source |
| `os` | js, wasm, both | `Stdout`, `Stderr`, `Stdin`, `File`; JS also has `Exit`, `Args`, `Getenv` |
| `path`, `path/filepath` | js, wasm, both | Lexical helpers only; no file-system walking |
| `regexp` | js | Backed by the JS `RegExp` engine |
| `strconv`, `strings`, `unicode`, `unicode/utf8`, `unicode/utf16` | js, wasm, both | `strings.Builder`, `Reader`, `Replacer` included |
| `sync`, `sync/atomic` | js, wasm, both | No `sync.Cond`, no `WaitGroup.Go` |
| `testing` | js, wasm, both | `T`, `B`, subtests, benchmarks; no fuzzing |
| `time` | js, wasm, both | `Sleep` is JS-only; no timers or tickers |
| `gom` | js | GoFront DOM package |
| `gofront/shared`, `gofront/simd` | wasm, both | Shared memory and SIMD helpers |

Notable members and behaviour per package, including GoFront's own packages:

| Package | Functions |
|---|---|
| `fmt` | `Sprintf`, `Printf`, `Println`, `Print`, `Errorf`, `Fprintf`, `Fprintln`, `Fprint`, `Sprint`, `Sprintln`, `Append`, `Appendf`, `Appendln` — format verbs: `%v`, `%+v`, `%#v`, `%T`, `%p`, `%d`, `%s`, `%t`, `%x`, `%X`, `%o`, `%O`, `%b`, `%q`, `%c`, `%U`, `%e`, `%E`, `%f`, `%F`, `%g`, `%G`, `%w`, width/precision, positional indexes (`%[1]d`), `fmt.Stringer` and `fmt.GoStringer`; **scanning**: `Sscan`, `Sscanln`, `Sscanf` |
| `strings` | `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `LastIndex`, `Count`, `Repeat`, `Replace`, `ReplaceAll`, `ToUpper`, `ToLower`, `TrimSpace`, `Trim`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `Split`, `Join`, `EqualFold`, `Fields`, `FieldsFunc`, `Cut`, `CutPrefix`, `CutSuffix`, `SplitN`, `SplitAfter`, `SplitAfterN`, `IndexAny`, `LastIndexAny`, `ContainsAny`, `ContainsRune`, `ContainsFunc`, `IndexRune`, `IndexByte`, `LastIndexByte`, `Map`, `Title`, `ToTitle`, `ToValidUTF8`, `TrimFunc`, `TrimLeftFunc`, `TrimRightFunc`, `IndexFunc`, `LastIndexFunc`, `Compare`, `Clone`, `Lines`, `SplitSeq`, `SplitAfterSeq`, `FieldsSeq`, `FieldsFuncSeq`, `NewReplacer`; **`Builder`**, **`Reader`**, **`Replacer`** types |
| `bytes` | `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `Join`, `Split`, `Replace`, `ToUpper`, `ToLower`, `TrimSpace`, `Equal`, `EqualFold`, `Compare`, `Count`, `Repeat`, `ReplaceAll`, `Trim`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `TrimFunc`, `TrimLeftFunc`, `TrimRightFunc`, `IndexByte`, `LastIndex`, `LastIndexByte`, `IndexAny`, `LastIndexAny`, `IndexRune`, `IndexFunc`, `LastIndexFunc`, `Fields`, `FieldsFunc`, `Cut`, `CutPrefix`, `CutSuffix`, `ContainsAny`, `ContainsRune`, `ContainsFunc`, `Map`, `SplitN`, `SplitAfter`, `SplitAfterN`, `ToTitle`, `ToValidUTF8`, `Runes`, `Clone`, `Lines`, `SplitSeq`, `SplitAfterSeq`, `FieldsSeq`, `FieldsFuncSeq`; **`Buffer`**, **`Reader`** types |
| `bufio` | **`Reader`**, **`Writer`**, **`Scanner`**, **`ReadWriter`**; `NewReader`, `NewReaderSize`, `NewWriter`, `NewWriterSize`, `NewScanner`, `NewReadWriter`; `ScanBytes`, `ScanRunes`, `ScanLines`, `ScanWords`, `ErrTooLong`, `ErrBufferFull`, `ErrInvalidUnreadByte`, `ErrInvalidUnreadRune`, `ErrNegativeCount`, `ErrAdvanceTooFar`, `ErrNegativeAdvance`, `ErrFinalToken`, `MaxScanTokenSize` |
| `strconv` | `Itoa`, `Atoi`, `FormatBool`, `FormatInt`, `FormatFloat`, `FormatUint`, `FormatComplex`, `ParseFloat`, `ParseInt`, `ParseBool`, `ParseUint`, `ParseComplex`, `Quote`, `QuoteToASCII`, `QuoteRune`, `QuoteRuneToASCII`, `Unquote`, `UnquoteChar`, `QuotedPrefix`, `CanBackquote`, `AppendInt`, `AppendFloat`, `AppendUint`, `AppendBool`, `AppendQuote`, `AppendQuoteToASCII`, `AppendQuoteRune`, `AppendQuoteRuneToASCII`, `IntSize`, `NumError`, `ErrRange`, `ErrSyntax` |
| `sort` | `Interface`, `Sort`, `Stable`, `Reverse`, `IsSorted`, `Ints`, `Float64s`, `Strings`, `Slice`, `SliceStable`, `SliceIsSorted`, `Search`, `SearchInts`, `SearchFloat64s`, `SearchStrings`, `Find`, `IntsAreSorted`, `Float64sAreSorted`, `StringsAreSorted`, `IntSlice`, `Float64Slice`, `StringSlice` |
| `math` | `Abs`, `Floor`, `Ceil`, `Round`, `RoundToEven`, `Sqrt`, `Cbrt`, `Pow`, `Pow10`, `Log`, `Log2`, `Log10`, `Log1p`, `Logb`, `Ilogb`, `Sin`, `Cos`, `Tan`, `Sincos`, `Atan`, `Atan2`, `Asin`, `Acos`, `Sinh`, `Cosh`, `Tanh`, `Asinh`, `Acosh`, `Atanh`, `Exp`, `Exp2`, `Expm1`, `Trunc`, `Hypot`, `Signbit`, `Copysign`, `Dim`, `Remainder`, `Mod`, `Modf`, `Frexp`, `Ldexp`, `Nextafter`, `Nextafter32`, `FMA`, `Erf`, `Erfc`, `Gamma`, `Lgamma`, `J0`, `J1`, `Y0`, `Y1`, `Float64bits`, `Float64frombits`, `Float32bits`, `Float32frombits`, `Min`, `Max`, `Inf`, `IsNaN`, `IsInf`, `NaN` + constants |
| `math/cmplx` | `Abs`, `Phase`, `Polar`, `Rect`, `Conj`, `Real`, `Imag`, `Sqrt`, `Exp`, `Log`, `Log10`, `Pow`, `Sin`, `Cos`, `Tan`, `Sinh`, `Cosh`, `Tanh`, `Asin`, `Acos`, `Atan`, `Asinh`, `Acosh`, `Atanh`, `Cot`, `Inf`, `NaN`, `IsInf`, `IsNaN` |
| `math/rand` & `math/rand/v2` | `math/rand`: deterministic `Seed`, `Intn`, `Float64`, `Float32`, `Int`, `Int63`, `Int63n`, `Int31`, `Int31n`, `Shuffle`, `Perm`, `Read`. `math/rand/v2`: `PCG` (`NewPCG`), `Rand` (`New`), `Zipf` (`NewZipf`), `Source`, `Int`, `IntN`, `Int32`, `Int32N`, `Int64`, `Int64N`, `Uint`, `UintN`, `Uint32`, `Uint32N`, `Uint64`, `Uint64N`, `Float64`, `Float32`, `NormFloat64`, `ExpFloat64`, `Perm`, `Shuffle` |
| `math/bits` | `LeadingZeros*`, `TrailingZeros*`, `OnesCount*`, `RotateLeft*`, `Reverse*`, `ReverseBytes*`, `Len*`, `Add*`, `Sub*`, `Mul*`, `Div*`, `Rem*`, `UintSize` |
| `errors` | `New`, `Is`, `Unwrap`, `As`, `Join`, `ErrUnsupported` — custom error types via interface satisfaction |
| `time` | `Now` → `time.Time`, `Since`, `Until`, `Sleep` (JS-only), `Parse`, `ParseInLocation`, `ParseDuration`, `Unix`, `UnixMilli`, `UnixMicro`, `Date`, `FixedZone`, `LoadLocation` (`""`/`"UTC"`/`"Local"`); **`time.Duration`** methods: `Seconds`, `Milliseconds`, `Microseconds`, `Nanoseconds`, `Minutes`, `Hours`, `Truncate`, `Round`, `Abs`, `String`; **`time.Time`** methods: `Format`, `AppendFormat`, `String`, `Year`, `Month`, `Day`, `YearDay`, `ISOWeek`, `Clock`, `Date`, `Hour`, `Minute`, `Second`, `Weekday`, `Unix`, `UnixMilli`, `UnixMicro`, `UnixNano`, `Nanosecond`, `UTC`, `Local`, `In`, `Location`, `Zone`, `IsDST`, `IsZero`, `Add`, `AddDate`, `Sub`, `Before`, `After`, `Equal`, `Compare`, `Truncate`, `Round`, `MarshalJSON`, `UnmarshalJSON`, `MarshalText`, `UnmarshalText`; layout, duration, month, and weekday constants |
| `context` | `Context`, `Background`, `TODO`, `WithCancel`, `WithCancelCause`, `WithDeadline`, `WithDeadlineCause`, `WithTimeout`, `WithTimeoutCause`, `WithValue`, `AfterFunc`, `WithoutCancel`, `Cause`, `CancelFunc`, `CancelCauseFunc`, `Canceled`, `DeadlineExceeded` (see [compatibility notes](go-compatibility.md)) |
| `html` | `EscapeString`, `UnescapeString` |
| `cmp` | `Ordered`, `Compare`, `Less`, `Or` |
| `iter` | `Seq`, `Seq2` — range over them with `for v := range seq`. `Pull` and `Pull2` require coroutines and report `requires coroutines; out of scope (no runtime)`. |
| `maps` | `Clone`, `Copy`, `Equal`, `EqualFunc`, `Delete`, `DeleteFunc`, `All`, `Keys`, `Values`, `Insert`, `Collect`. `Keys` and `Values` return `iter.Seq`, as in Go 1.23: use `slices.Collect(maps.Keys(m))` or `slices.Sorted(maps.Keys(m))` for a slice. |
| `slices` | `Contains`, `ContainsFunc`, `Index`, `IndexFunc`, `BinarySearch`, `BinarySearchFunc`, `Equal`, `EqualFunc`, `Compare`, `CompareFunc`, `Sort`, `SortFunc`, `SortStableFunc`, `IsSorted`, `IsSortedFunc`, `Reverse`, `Max`, `Min`, `MaxFunc`, `MinFunc`, `Clone`, `Compact`, `CompactFunc`, `Concat`, `Delete`, `DeleteFunc`, `Insert`, `Replace`, `Grow`, `Clip`, `Repeat`, `All`, `Values`, `Backward`, `Collect`, `AppendSeq`, `Sorted`, `SortedFunc`, `SortedStableFunc`, `Chunk`. Iterator functions take `[]E` rather than a `Slice ~[]E` type parameter, so `Chunk` and `AppendSeq` of a named slice type return `[]E`. |
| `container/heap`, `list`, `ring` | `heap`: `Interface`, `Init`, `Push`, `Pop`, `Remove`, `Fix`. `list`: `List`, `Element`, `New`. `ring`: `Ring`, `New` |
| `regexp` | `MustCompile`, `Compile`, `MatchString`, `QuoteMeta`; **`*Regexp`** methods: `MatchString`, `FindString`, `FindStringIndex`, `FindAllString`, `FindStringSubmatch`, `FindAllStringSubmatch`, `ReplaceAllString`, `ReplaceAllLiteralString`, `Split`, `String`. Inline flags (`(?i)`, `(?m)`, `(?s)`) are extracted automatically into the JS `RegExp` constructor. |
| `unicode`, `utf8`, `utf16` | `unicode`: `IsLetter`, `IsDigit`, `IsNumber`, `IsSpace`, `IsUpper`, `IsLower`, `IsTitle`, `IsPunct`, `IsSymbol`, `IsMark`, `IsControl`, `IsPrint`, `IsGraphic`, `Is`, `IsOneOf`, `In`, `ToUpper`, `ToLower`, `ToTitle`, `To`, `SimpleFold`, `RangeTable`, `Range16`, `Range32`, `SpecialCase`, and general-category tables (`L`, `Ll`, `Lu`, `Lt`, `Lm`, `Lo`, `M`, `Mn`, `Mc`, `Me`, `N`, `Nd`, `Nl`, `No`, `P`, `Pc`, `Pd`, `Ps`, `Pe`, `Pi`, `Pf`, `Po`, `S`, `Sm`, `Sc`, `Sk`, `So`, `Z`, `Zs`, `Zl`, `Zp`, `C`, `Cc`, `Cf`, `Cs`, `Co`, `ASCII_Hex_Digit`, `Hex_Digit`, `White_Space`, …). `unicode/utf8`: `RuneCount*`, `RuneLen`, `RuneStart`, `Valid*`, `DecodeRune*`, `DecodeLastRune*`, `EncodeRune`, `AppendRune`, `FullRune*`, constants. `unicode/utf16`: `Encode`, `Decode`, `EncodeRune`, `DecodeRune`, `AppendRune`, `IsSurrogate`, `RuneLen` |
| `path`, `path/filepath`, `net/url` | `path` & `path/filepath`: `Base`, `Dir`, `Ext`, `Join`, `Clean`, `IsAbs`, `Split`, `Match`, `Rel`, `ToSlash`, `FromSlash`, `Separator`, `ListSeparator`. `net/url`: `URL`, `Values`, `Userinfo`, `Error`, `Parse`, `ParseRequestURI`, `ParseQuery`, `QueryEscape`, `QueryUnescape`, `PathEscape`, `PathUnescape`, `JoinPath`, `User`, `UserPassword` |
| `os`, `log` | `os`: `Stdout`, `Stderr`, `Stdin`, `DevNull` (`both` and `wasm` packages); `Exit`, `Args`, `Getenv` (`js` packages). `log`: `Logger`, `New`, `Default`, `Print`, `Printf`, `Println`, `Fatal`, `Fatalf`, `Fatalln`, `Panic`, `Panicf`, `Panicln`, `SetOutput`, `SetFlags`, `SetPrefix`, `Flags`, `Prefix`, `Writer`, flag constants (`Ldate`, `Ltime`, `Lmicroseconds`, `Llongfile`, `Lshortfile`, `LUTC`, `Lmsgprefix`, `LstdFlags`) |
| `io` | `Reader`, `Writer`, `ReadWriter`, `Closer`, `ReadCloser`, `WriteCloser`, `ReadWriteCloser`, `Seeker`, `ReadSeeker`, `WriteSeeker`, `ReadWriteSeeker`, `ReaderFrom`, `WriterTo`, `ReaderAt`, `WriterAt`, `ByteReader`, `ByteScanner`, `ByteWriter`, `RuneReader`, `RuneScanner`, `StringWriter`; `ReadAll`, `ReadFull`, `ReadAtLeast`, `WriteString`, `Copy`, `CopyN`, `CopyBuffer`, `LimitReader`, `NewSectionReader`, `TeeReader`, `MultiReader`, `MultiWriter`, `NopCloser`, `Discard`, `EOF`, `ErrUnexpectedEOF`, `ErrShortWrite`, `ErrShortBuffer`, `ErrNoProgress`, `SeekStart`, `SeekCurrent`, `SeekEnd`; `LimitedReader`, `SectionReader` |
| `sync`, `sync/atomic` | `sync`: `Locker`, `Mutex`, `RWMutex`, `Once`, `WaitGroup`, `Map`, `Pool`, `Cond` (`NewCond`), `OnceFunc`, `OnceValue`, `OnceValues`. `sync/atomic`: `Bool`, `Int32`, `Int64`, `Uint32`, `Uint64`, `Uintptr`, `Pointer[T]`, `Value`, plus package-level `Load*`, `Store*`, `Add*`, `Swap*`, `CompareAndSwap*` |
| `hash/*`, `crypto/*` | `hash`: `Hash`, `Hash32`, `Hash64`. `hash/fnv`: `New32`, `New32a`, `New64`, `New64a`, `New128`, `New128a`. `hash/crc32`: `IEEE`, `Castagnoli`, `Koopman`, `IEEETable`, `MakeTable`, `New`, `NewIEEE`, `Checksum`, `ChecksumIEEE`, `Update`. `hash/adler32`: `New`, `Checksum`. `crypto/rand`: `Reader`, `Read`, `Prime`. `crypto/sha256`: `New`, `New224`, `Sum256`, `Sum224`. `crypto/sha512`: `New`, `New384`, `New512_224`, `New512_256`, `Sum512`, `Sum384`, `Sum512_224`, `Sum512_256`. `crypto/sha1`: `New`, `Sum`. `crypto/md5`: `New`, `Sum`. `crypto/hmac`: `New`, `Equal`. `crypto/subtle`: `ConstantTimeCompare`, `ConstantTimeSelect`, `ConstantTimeByteEq`, `ConstantTimeEq`, `ConstantTimeCopy`, `ConstantTimeLessOrEq`, `XORBytes` |
| `encoding/binary`, `hex`, `base64`, `base32`, `csv` | `encoding/binary`: `LittleEndian`, `BigEndian`, `ByteOrder`, `Read`, `Write`, `Size`; no varints, `NativeEndian` or `AppendByteOrder`. `encoding/hex`: `EncodeToString`, `DecodeString`, `EncodedLen`, `DecodedLen`, `Encode`, `Decode`, `ErrLength`. `encoding/base64` & `encoding/base32`: `StdEncoding`, `URLEncoding`, `RawStdEncoding`, `RawURLEncoding`, `HexEncoding`, `NewEncoding`, `Encoding` methods (`Encode*`, `Decode*`, `AppendEncode`, `AppendDecode`, `WithPadding`, `Strict`), `NewEncoder`, `NewDecoder`, `CorruptInputError`. `encoding/csv`: `Reader` (`NewReader`), `Writer` (`NewWriter`), `ParseError`, `ErrFieldCount`, `ErrBareQuote`, `ErrQuote`, `ErrTrailingComma` |
| `encoding/json` | `Marshal`, `MarshalIndent`, `Unmarshal`, `Valid`, `RawMessage`, `Number`, `Compact`, `Indent`, `HTMLEscape`, `Encoder` (`NewEncoder`, `Encode`, `SetIndent`, `SetEscapeHTML`), `Decoder` (`NewDecoder`, `Decode`, `Buffered`, `More`, `Token`, `UseNumber`, `DisallowUnknownFields`, `InputOffset`), `Delim`, `Token`, and typed error values (`*SyntaxError`, `*UnmarshalTypeError`, `*InvalidUnmarshalError`, `*UnsupportedTypeError`, `*UnsupportedValueError`, `*MarshalerError`) — codecs generated per type at compile time from `json` struct tags (`omitempty`, `string`, `-`, embedded-field promotion) on both `js` and `wasm`/`both` backends; calls `MarshalJSON`/`UnmarshalJSON` and `encoding.TextMarshaler`/`TextUnmarshaler` methods (see [compatibility notes](go-compatibility.md)). |
| `gom` | Browser-native declarative DOM component library. **Types**: `Node` (interface), `NodeFunc`, `Group`. **Core**: `El(tag, children...)`, `Text(s)`, `Mount(sel, node[, refs])`, `MountTo(sel, node[, refs])` — the optional `refs map[string]any` receives elements marked `ref="name"` in `.templ` templates. **Attributes**: `Attr`, `Class`, `Href`, `Type`, `Src`, `Placeholder`, `DataAttr`, `Style`, `For`, `Name`, `Value`, `Target`, `Rel`, `Alt`, `Title`, `Draggable`, `Role`, `AriaLabel`, `StyleAttr`; boolean: `Disabled`, `Checked`, `Selected`, `Readonly`. **Logic**: `If(cond, node)`, `Map(slice, fn)`. **Elements**: full HTML element set (`Div`, `Span`, `Button`, `Input`, `Ul`, `Li`, `Table`, `Form`, `Img`, `A`, `H1`–`H6`, …) |
| `gofront/shared` | Fixed-size linear-memory buffers for zero-copy JS↔WASM sharing (`Float32`, `Float64`, `Int8`, `Int16`, `Int32`, `Uint8`, `Uint16`, `Uint32` via `shared.NewXxx(n)` and `.Subarray(lo, hi)`). Lowered to plain TypedArrays in `--js-only` builds. See the [hybrid guide](hybrid-wasm.md#shared-linear-memory-buffers-gofrontshared). |
| `gofront/simd` (experimental) | `F32x4` 4-lane `float32` vector: `F32x4{a, b, c, d}`, `Splat`, `NewF32x4`, `Add`, `Sub`, `Mul`, `Div`, `Min`, `Max`, `MulAdd`, `Neg`, `Abs`, `Sqrt`, `Floor`, `Ceil`, `Trunc`, `RoundToEven`, `Dot3`, `Dot4`, `Sum`, `Lane`, `WithLane`, `Swizzle` (constant lane indexes), `Shuffle`; comparisons returning `Mask32x4` (`And`, `Or`, `Xor`, `AndNot`, `Not`, `Any`, `All`, `Bits`, `Lane`) and `Select`; `LoadF32x4`/`StoreF32x4` on `shared.Float32`, `LoadF32x4Slice`/`StoreF32x4Slice` on `[]float32`, and `Pad4`. WASM `v128` in `wasm` packages, `Math.fround` arrays in `js`. See the [hybrid guide](hybrid-wasm.md#wasm-simd-gofrontsimd). |
| `testing` | **`testing.T`**: `Error`, `Errorf`, `Fatal`, `Fatalf`, `Fail`, `Failed`, `FailNow`, `Log`, `Logf`, `Skip`, `Skipf`, `Skipped`, `Helper`, `Run`, `Name`, `Cleanup`, `Setenv`, `TempDir`, `Context`, `Deadline`, `Parallel`. **`testing.B`**: `N`, `Loop`, `ResetTimer`, `StartTimer`, `StopTimer`, `Elapsed`, `ReportAllocs`, `ReportMetric`, `SetBytes`, `Run`. **`testing.M`** (`TestMain(m *testing.M)` with `m.Run()`) and **`testing.TB`** interface. **Package functions**: `Short()`, `Verbose()`, `Testing()`, `AllocsPerRun`. Run via `gofront test` (and `gofront test -bench`). |

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

