# Language Features & Stdlib

Everything below is available in `js` packages. The subset available inside `wasm`/`both`
packages is listed in the [hybrid guide](hybrid-wasm.md#what-wasm-packages-support).

### Core language

| Feature | Status |
|---|---|
| Variables (`var`, `:=` short re-declaration) | ✓ |
| Constants (`const`, `iota`, untyped constants) | ✓ |
| Functions, multiple returns, named returns, variadic | ✓ |
| `init()` functions | ✓ |
| Closures / function literals | ✓ |
| `async func` / `await` expressions | ✓ |
| `defer`, `panic()` / `recover()` | ✓ |
| `print` / `println` builtins | ✓ — compile to `console.log` |

### Types & data structures

| Feature | Status |
|---|---|
| Structs + methods (value & pointer receivers) | ✓ |
| Embedded structs (flattened fields + promoted methods) | ✓ |
| Anonymous struct types | ✓ — compile to plain JS objects |
| Interfaces (with embedding) | ✓ |
| Slices (`append`, `len`, `make`) | ✓ |
| Maps (`make`, `delete`, comma-ok) | ✓ |
| Arrays with compile-time enforcement | ✓ — reject `append`, bounds checking, size matching, `[...]T` inference, compile-time `len()` |
| Slice → array conversion (`[N]T(slice)`) | ✓ — Go 1.20 |
| Pointers (`&x`, `*p`, `new(T)`) | ✓ — scalar locals boxed as `{ value: T }` for shared mutation |
| `error` type | ✓ — interface `{ Error() string }`; custom error types, `errors.Is`/`Unwrap`, `%w` wrapping |
| Complex numbers (`complex64`, `complex128`, `3i`) | ✓ — `complex()`, `real()`, `imag()` builtins; `__cmul`/`__cdiv` helpers |
| Type definitions, type aliases (`type A = B`) | ✓ |
| Methods on named non-struct types | ✓ — `type T func(...)` or `type T []E` with methods; emitted as ES6 wrapper classes; satisfies interfaces |
| Type conversions, type assertions (plain & comma-ok) | ✓ |
| Type switch (`switch v := x.(type)`) | ✓ — compiles to `if/else if` with `typeof` / `instanceof` |
| Sized integers (`int8`–`int64`, `uint8`–`uint64`, `float32`) | ✓ — distinct types in the checker; `rune` = `int32`, `byte` = `uint8`; conversions truncate to width; arithmetic is float64 in `js` packages, exact in `wasm`/`both` |
| Generics (`func F[T any]`, `type S[T any] struct`) | ✓ — type erasure to JS; generic functions, structs, constraints (`any`, `comparable`, interfaces, unions), type inference |
| Struct field tags | ✓ — parsed and ignored (no reflection) |
| Struct and array equality (`a == b`) | ✓ — deep comparison via `__equal` helper |

### Control flow

| Feature | Status |
|---|---|
| `if` / `else if` / `else` (with init statement) | ✓ |
| `for` (C-style, condition-only, infinite, `range`) | ✓ |
| `range` over slice, map, string, integer | ✓ |
| Range over iterator functions (Go 1.23) | ✓ — `func(yield func(K, V) bool)` protocol; break/continue/return propagation |
| `switch` / `fallthrough` (with init statement) | ✓ |
| `break` / `continue` / labeled variants | ✓ |
| Terminating statement analysis | ✓ — missing `return` in non-void functions is a type error |

### Expressions & literals

| Feature | Status |
|---|---|
| Arithmetic, comparison, logical, bitwise operators | ✓ — includes `&^` (bit clear) |
| Compound assignment, increment / decrement | ✓ |
| Slice expressions (`s[lo:hi]`, `s[lo:hi:max]`) | ✓ |
| Variadic spread (`f(slice...)`, `append(a, b...)`) | ✓ |
| Positional struct literals (`Point{1, 2}`) | ✓ |
| Method expressions (`T.Method`) / method values (`x.Method`) | ✓ |
| Multi-value function forwarding (`f(g())`) | ✓ |
| Raw string literals (backticks), rune literals | ✓ |
| Numeric separators (`1_000_000`), binary/octal/hex literals | ✓ |
| `[]byte(s)` / `[]rune(s)` conversions | ✓ |

### Standard library shims

| Package | Functions |
|---|---|
| `fmt` | `Sprintf`, `Printf`, `Println`, `Print`, `Errorf`, `Fprintf`, `Fprintln`, `Fprint` — format verbs: `%v`, `%d`, `%s`, `%t`, `%x`, `%o`, `%b`, `%q`, `%e`, `%g`, `%w`, width/precision; **scanning**: `Sscan`, `Sscanln`, `Sscanf` |
| `strings` | `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `LastIndex`, `Count`, `Repeat`, `Replace`, `ReplaceAll`, `ToUpper`, `ToLower`, `TrimSpace`, `Trim`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `Split`, `Join`, `EqualFold`, `Fields`, `Cut`, `CutPrefix`, `CutSuffix`, `SplitN`, `SplitAfter`, `SplitAfterN`, `IndexAny`, `LastIndexAny`, `ContainsAny`, `ContainsRune`, `IndexRune`, `IndexByte`, `LastIndexByte`, `Map`, `Title`, `ToTitle`, `TrimFunc`, `TrimLeftFunc`, `TrimRightFunc`, `IndexFunc`, `LastIndexFunc`, `NewReplacer`; **`Builder`** type; **`NewReader`** → reader shim |
| `bytes` | `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `Join`, `Split`, `Replace`, `ToUpper`, `ToLower`, `TrimSpace`, `Equal`, `Count`, `Repeat`, `ReplaceAll`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `TrimFunc`, `IndexByte`, `LastIndex`, `LastIndexByte`, `Fields`, `Cut`, `ContainsAny`, `ContainsRune`, `Map`, `SplitN`; **`Buffer`** type; **`NewReader`** → reader shim |
| `strconv` | `Itoa`, `Atoi`, `FormatBool`, `FormatInt`, `FormatFloat`, `ParseFloat`, `ParseInt`, `ParseBool`, `Quote`, `Unquote`, `AppendInt`, `AppendFloat` |
| `sort` | `Ints`, `Float64s`, `Strings`, `Slice`, `SliceStable`, `SliceIsSorted`, `Search`, `IntsAreSorted`, `Float64sAreSorted`, `StringsAreSorted` |
| `math` | `Abs`, `Floor`, `Ceil`, `Round`, `Sqrt`, `Cbrt`, `Pow`, `Log`, `Log2`, `Log10`, `Sin`, `Cos`, `Tan`, `Atan`, `Atan2`, `Asin`, `Acos`, `Exp`, `Exp2`, `Trunc`, `Hypot`, `Signbit`, `Copysign`, `Dim`, `Remainder`, `Min`, `Max`, `Mod`, `Inf`, `IsNaN`, `IsInf`, `NaN` + `Pi`, `E`, `MaxFloat64`, `SmallestNonzeroFloat64`, `MaxInt`, `MinInt` |
| `math/rand` | `Intn`, `Float64`, `Float32`, `Int`, `Int63`, `Int63n`, `Int31`, `Int31n`, `Seed` (no-op), `Shuffle`, `Perm` |
| `math/bits` | `LeadingZeros32`, `TrailingZeros32`, `OnesCount32`, `RotateLeft32`, `LeadingZeros64`, `TrailingZeros64`, `OnesCount64`, `RotateLeft64` — also available in `wasm` packages |
| `errors` | `New`, `Is`, `Unwrap` — custom error types via interface satisfaction |
| `time` | `Now` → `time.Time`, `Since`, `Sleep`, `Parse`, `Unix`, `Date`; **`time.Time`** methods: `Format`, `String`, `Year`, `Month`, `Day`, `Hour`, `Minute`, `Second`, `Weekday`, `Unix`, `UnixMilli`, `Add`, `Sub`, `Before`, `After`, `Equal`; layout constants: `RFC3339`, `RFC3339Nano`, `DateOnly`, `TimeOnly`, `DateTime`; duration constants: `Millisecond`, `Second`, `Minute`, `Hour`; month/weekday constants |
| `html` | `EscapeString`, `UnescapeString` |
| `maps` | `Keys`, `Values`, `Clone`, `Copy`, `Equal`, `EqualFunc`, `Delete`, `DeleteFunc` |
| `slices` | `Contains`, `Index`, `Equal`, `Compare`, `Sort`, `SortFunc`, `SortStableFunc`, `IsSorted`, `IsSortedFunc`, `Reverse`, `Max`, `Min`, `MaxFunc`, `MinFunc`, `Clone`, `Compact`, `CompactFunc`, `Concat`, `Delete`, `DeleteFunc`, `Insert`, `Replace`, `Grow`, `Clip` |
| `regexp` | `MustCompile`, `Compile`, `MatchString`, `QuoteMeta`; **`*Regexp`** methods: `MatchString`, `FindString`, `FindStringIndex`, `FindAllString`, `FindStringSubmatch`, `FindAllStringSubmatch`, `ReplaceAllString`, `ReplaceAllLiteralString`, `Split`, `String`. Inline flags (`(?i)`, `(?m)`, `(?s)`) are extracted automatically into the JS `RegExp` constructor. |
| `unicode` | `IsLetter`, `IsDigit`, `IsSpace`, `IsUpper`, `IsLower`, `IsPunct`, `IsControl`, `IsPrint`, `IsGraphic`, `ToUpper`, `ToLower` |
| `unicode/utf8` | `RuneCountInString`, `RuneLen`, `ValidString`, `ValidRune`, `DecodeRuneInString`, `DecodeLastRuneInString`, `FullRuneInString`; constants `RuneError`, `MaxRune`, `UTFMax` |
| `path` | `Base`, `Dir`, `Ext`, `Join`, `Clean`, `IsAbs`, `Split`, `Match`; `"path/filepath"` is an alias |
| `os` | `Exit`, `Args`, `Getenv` |
| `io` | `Writer`, `Reader`, `ReadWriter`, `Closer` interface types; `ReadAll`, `EOF`, `Discard`, `WriteString` |
| `gom` | Browser-native declarative DOM component library. **Types**: `Node` (interface), `NodeFunc`, `Group`. **Core**: `El(tag, children...)`, `Text(s)`, `Mount(sel, node[, refs])`, `MountTo(sel, node[, refs])` — the optional `refs map[string]any` receives elements marked `ref="name"` in `.templ` templates. **Attributes**: `Attr`, `Class`, `Href`, `Type`, `Src`, `Placeholder`, `DataAttr`, `Style`, `For`, `Name`, `Value`, `Target`, `Rel`, `Alt`, `Title`, `Draggable`, `Role`, `AriaLabel`, `StyleAttr`; boolean: `Disabled`, `Checked`, `Selected`, `Readonly`. **Logic**: `If(cond, node)`, `Map(slice, fn)`. **Elements**: full HTML element set (`Div`, `Span`, `Button`, `Input`, `Ul`, `Li`, `Table`, `Form`, `Img`, `A`, `H1`–`H6`, …) |
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
| External `.d.ts` types | ✓ |
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

