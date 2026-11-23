# Go Compatibility Differences

GoFront implements a practical subset of the
[Go Language Specification](https://go.dev/ref/spec) (go1.26). It is not aiming for
byte-level parity — it is a Go-inspired language for the JavaScript platform.

### GoFront extensions (not in Go)

These features are intentional additions for the JavaScript platform:

| Feature | Purpose |
|---|---|
| `async func` / `await` | First-class async syntax for frontend work. |
| `//gofront:target js \| wasm \| both` | Per-package compilation target for hybrid JS + WebAssembly builds. See the [hybrid guide](hybrid-wasm.md). |
| `gofront/shared` | Zero-copy linear-memory buffers shared as TypedArrays across the JS↔WASM boundary. |
| `.templ` files and `css` declarations | JSX-like component templates with scoped CSS, compiled to direct DOM calls. |
| `gom` built-in package | Declarative DOM node builders available without an import. |
| Browser globals (`document`, `console`, etc.) | Predeclared as dynamic JavaScript values for practical DOM access: arithmetic, calls and indexing on them are not type-checked, unlike on a Go `any` (see [Type checking](#type-checking)). `WebGL2RenderingContext`, `WebGLRenderingContext`, `ArrayBuffer`, `DataView`, and TypedArrays have full static typings with method-level checking. WebGPU objects are typed through `gofront/webgpu` (`webgpu.Device`, `webgpu.Adapter`, `webgpu.Queue`). |
| `.d.ts` type imports (`import "js:./types.d.ts"`) | Type-safe interop with JavaScript libraries. |
| `.d.ts` tuple return mapping | TypeScript `[A, B]` in return position maps directly to Go multi-value return `(A, B)` (e.g. React/Preact hooks `state, setState := useState(...)`). |
| npm package resolution | Import types from `node_modules/` and `@types/` automatically. |
| `gofront/simd` (experimental) | Value-typed 4-wide float SIMD (`simd.F32x4`) compiling directly to native WASM `v128` instructions without GC overhead. |

### What's not implemented

| Feature | Reason | Prospect |
|---|---|---|
| `goto` | Neither backend has unstructured control flow; both would require a loop-plus-state-machine lowering. Rare in idiomatic Go. | Not planned. Reported in every target as `goto is not supported; restructure with labeled break/continue`. |
| Method values taken from an interface (`f := iface.Method`) | Taking a method value from an interface variable is not supported yet. | JavaScript fails when the value is called and WebAssembly fails to compile; call the method directly or wrap it in a func literal. |
| Goroutines / channels / `select` | Go's concurrency model has no JS equivalent. A userland scheduler defeats the "no runtime" goal. | Out of scope. |
| `unsafe`, `reflect`, `cgo` | Require memory model or runtime type metadata that JS cannot provide. | Out of scope. `encoding/json` is supported through compile-time specialization without runtime reflection. |
| `time.Sleep` in `wasm`/`both` packages | Go's `time.Sleep` blocks OS threads; in GoFront `time.Sleep` is an async Promise helper for the single-threaded JS event loop. Synchronous WASM cannot block. | Supported in `js` packages via `await time.Sleep(...)`. |

### Standard library boundaries

GoFront supports standard library packages that compile to self-contained JavaScript and WebAssembly without a runtime scheduler, runtime reflection metadata, or operating-system services beyond what the browser provides (clock, random numbers, console):

| Category | Policy | Examples |
|---|---|---|
| **Supported on both backends** | Available in `js`, `wasm`, and `both` packages | `encoding/json`, `cmp`, `iter`, `slices`, `maps`, `strings`, `bytes` |
| **JS-only by design** | Available in `js` packages; a `wasm` or `both` package gets `package 'regexp' is only available in js packages` (or `'time.Sleep' is only available in js packages`) | `regexp`, `gom`, `time.Sleep`, `time.AfterFunc`, `time.Timer`, DOM APIs, host event loop |
| **Not supported: runtime** | Targeted diagnostic in every target, for the language features and for importing `reflect`, `unsafe` or `runtime` | Goroutines, channels, `select`, `reflect`, `unsafe`, `runtime`, `weak`, `unique` |
| **Not supported: small utility packages** | `import` reports `package '<path>' is not available` with a suggested alternative in every target | `bufio`, `net/url`, `log`, `encoding/csv`, `encoding/base32`, `container/*`, `hash/adler32`, `hash/crc32`, `hash/fnv`, `crypto/hmac`, `crypto/md5`, `crypto/sha1`, `crypto/sha512`, `crypto/subtle`, `math/rand/v2`, `math/cmplx`, `sync/atomic`, `unicode/utf16` |
| **Not supported: host OS** | Targeted diagnostic in every target: on the `import`, or on use for file I/O in `os` (`os.ReadFile is not available`) | `net/http`, `net`, `os/exec`, file I/O in `os`, `syscall` |
| **Not supported: reflection** | Targeted diagnostic on `import` in every target | `text/template`, `html/template`, `encoding/xml`, `encoding/gob`, `flag` |
| **Not supported: large packages** | Targeted diagnostic in every target: on the `import`, and on use for the `unicode` tables | `math/big`, `compress/*`, `archive/*`, `image/*`, `crypto/{aes,cipher,rsa,ecdsa,ed25519,x509,tls,elliptic}`, `encoding/{asn1,pem,ascii85}`, `text/{tabwriter,scanner}`, `go/*`, `debug/*`, `hash/{crc64,maphash}`, script and property tables in `unicode` |

### Standard library behaviour

Most packages (`fmt`, `slices`, `sort`, `maps`, `errors`, `io`, `os`, `unicode`, `strings`, `bytes`, `strconv`, `time`, `math/bits`, `math/rand`, `crypto/rand`, `sync`, `encoding/hex`, `encoding/base64`, `encoding/binary`, `crypto/sha256` and the others under [`stdlib/`](../stdlib/)) are written in Go from the real packages' algorithms, so they follow Go's signatures and results on `js`, `wasm` and `both` packages alike:

- **Sorting:** `sort.Slice`, `slices.SortFunc` and friends break ties in the same order as Go, and `NaN` values sort before every other float. Use `sort.SliceStable` or `slices.SortStableFunc` when equal elements must keep their input order.
- **Generic helpers on named types:** `slices` and `maps` functions accept named slice and map types such as `type IDs []int`, and return the same named type.
- **Errors:** `strconv` parse failures are `*strconv.NumError` values wrapping `strconv.ErrSyntax` or `strconv.ErrRange`, so use `errors.Is` or `errors.As` instead of comparing text. `base64` reports Go's error positions, and `time` formats and parses every layout.
- **Numbers:** `strconv.FormatFloat` and `ParseFloat` round exactly as Go does for bit sizes 32 and 64, including `-0`, hexadecimal floats and `1e39` as `float32`. `strconv.Atoi` and `strconv.Itoa` use `int`, which is exact up to 2⁵³ in JavaScript output; `ParseInt` and `ParseUint` return exact `int64` and `uint64`.
- **Host fast paths:** Searching, sorting primitive slices, trimming and case conversion in `strings`, `bytes`, `slices` and `sort`, and the digit conversion in `strconv.FormatFloat` and `ParseFloat`, call the host (`indexOf`, `toExponential`, `Number`) where it gives Go's result. The Go body runs for every other case. Pass `--no-natives` when compiling an input (`gofront <input> -o out.js --no-natives`) to run the Go bodies everywhere, for example to compare results.
- **Still provided by the compiler:** `encoding/json` (generated per-type codecs), `gofront/shared` and `gofront/simd`. Every other package listed here, including `fmt` and `errors.As`, is Go source that you can read under `stdlib/`.

### Embedding files with `//go:embed`

Put a file's contents into the build with `//go:embed`, so shaders, templates and data load with no network request. Import `embed` in the file (`import _ "embed"` is enough when you only embed a `string` or `[]byte`):

```go
package main

import "embed"

//go:embed shader.wgsl
var shader string // the file's text

//go:embed logo.png
var logo []byte // the file's bytes

//go:embed templates/*.html assets
var files embed.FS

func main() {
	page, err := files.ReadFile("templates/index.html")
	_, _ = page, err
}
```

It works the same in `js`, `wasm` and `both` packages, and the bytes are the same on every target. Rules are Go's:

- The directive goes right above a package-level `var` with one name and no initializer; comments and blank lines may sit between them. A directive before `var (` applies to nothing and is an error, as are one inside a function and one in a file that does not import `embed`.
- The variable is a `string`, a `[]byte` (or `[]uint8`) or an `embed.FS`, directly or through a type alias. A `string` or `[]byte` takes exactly one file (`multiple files for type string` otherwise); an `embed.FS` takes any number.
- Patterns are relative to the directory of the file that declares the variable, separated by spaces; quote one that contains a space (`"my file.txt"`). They are `path.Match` globs (`*` never matches `/`), and a directory embeds its whole tree except names starting with `.` or `_`, unless you write `all:assets`. A glob that names a directory or a dot file explicitly embeds it. Paths cannot contain `.` or `..` elements, start or end with `/`, or contain `\`, and a symlink leading out of the package directory is refused (`embed pattern escapes package directory`). A pattern that matches nothing is an error.
- A `string` holds the file's bytes as they are, so `[]byte(s)` returns them unchanged even for a file that is not UTF-8. A `[]byte` is a fresh copy for each variable.
- `embed.FS.ReadFile(name)` returns a fresh copy of the file's bytes, or `open <name>: file does not exist`. `ReadDir` and `Open` are not available, because `io/fs` is not: they report `embed.FS.ReadDir is not available`. `ReadFile` of a directory name reports a missing file instead of Go's `is a directory` error.
- A file embedded by several variables is stored once in the output.

### String semantics (both backends)

GoFront strings are JavaScript strings on both backends (`externref` in WebAssembly; string length, indexing, and range operate over UTF-16 code units):

| Construct | GoFront (JS and WASM) | Go |
|---|---|---|
| `len("héllo")` | `5` (UTF-16 code units) | `6` (UTF-8 bytes) |
| `"héllo"[1]` | `0xE9` (code unit) | `0xC3` (byte) |
| `for i := range "héllo"` | `i` is a UTF-16 code-unit offset `0, 1, 2, 3, 4` (an astral rune such as `😀` advances it by 2) | `i` is byte offset `0, 1, 3, 4, 5` |
| `[]byte("héllo")`, `string(b)` | UTF-8, 6 bytes | UTF-8, 6 bytes |
| `[]rune(s)`, `string(r)`, `utf8.*InString` | Code points, as Go | Code points |

Consequences for portable code:
- **Byte operations**: Standard library packages that parse formats (`encoding/json`, `encoding/hex`, `crypto/sha256`) operate on `[]byte(s)` rather than string indexing so that byte offsets and multi-byte UTF-8 sequences are exact.
- **`strings` offsets**: `strings.Index`, `LastIndex`, `IndexRune`, `IndexFunc` and the other search functions return UTF-16 code unit offsets, the same units as `len(s)` and `s[i:j]`, so `s[strings.Index(s, sub):]` always works. For ASCII text they equal Go's byte offsets; for other text they differ, as `len` does. `bytes` functions work on UTF-8 bytes and return byte offsets.
- **Escape sequences**: `\xNN` and octal escapes are raw bytes, as in Go: `"\xc3\xa9"` is `é`, while a lone `"\xc3"` is one invalid byte, so `[]byte("\xc3")` has length 1. Astral rune literals such as `'😀'` are one rune.
- **Format offsets**: Byte offsets reported by `json.SyntaxError.Offset` count UTF-8 input bytes, matching Go.

### Type checking

GoFront rejects the invalid Go listed here, with the same verdict and message in `js`, `wasm` and `both` packages. The checker does not implement every rule of the Go specification; the rules below are the ones it enforces. Each error names a line and column: the offending expression or operand, or the declaring identifier for `declared and not used`.

#### Numeric operands need identical types

Go does not convert between numeric types implicitly, and neither does GoFront. Convert one operand, or the argument, where the error points:

```go
n := 3
f := 1.5
total := n + f          // invalid operation: n + f (mismatched types int and float64)
total = float64(n) + f  // ok

func half(x float64) float64 { return x / 2 }
half(n)          // cannot use n (variable of type int) as float64 value in argument
half(float64(n)) // ok
```

- **Arithmetic** (`+ - * /`, including `complex64` and `complex128`) needs two operands of identical type. A defined type such as `type Celsius float64` only mixes with itself, so `Celsius + Fahrenheit` and `Celsius + float64` are errors.
- **Comparison** (`== != < <= > >=`) needs one operand assignable to the other, which for numbers and strings means identical types: `float64 == int` and `Celsius == Fahrenheit` are errors.
- **Untyped constants** adapt to the other operand: `x + 1.5` and `x * 2` are fine for a `float64` `x`, and `1 << n` takes its type from the context. The shift count of `<<` and `>>` may have any integer type, and a float constant that is a whole number counts as an integer (`x << 1.0`). A constant of the wrong kind is an error: `s == 'a'` with a string `s` is `mismatched types string and untyped rune`, and `f + 1i` with a `float64` `f` is an error too.
- **Strings and complex numbers** follow the same rule: `a + b` needs identical string types, and the result keeps a defined type such as `type Name string`.
- **Integer-only operators**: `%`, `&`, `|`, `^` and `&^` (and their compound forms) need integer operands; `f % 2` on a `float64` is `operator % not defined on f (variable of type float64)`.
- **Compound assignment and `++`/`--`** apply the operator's rule: `f <<= 1` on a `float64`, `s++` on a string (`non-numeric type string`), `b += true`, and `a += t` with two different defined string types are errors. `s += "x"` on a defined string type is fine.
- **Assignment contexts** (variable declarations, assignments, call arguments, returns, struct fields, composite literal elements) follow the same rule: an `int` is not a `float64` value.
- **Conversions** between numeric types, from a number to a string, and between a string and `[]byte` or `[]rune` are always explicit. Converting a struct to another struct type ignores field tags when the field names, types and order match.

#### Type identity

Two types are the same type only when Go says so:

- A defined type (`type T ...`) is identical only to itself. A type declared inside a function that shadows an outer `T` is a different type, and so is a same-named type from another package.
- A type declared over another defined type (`type Temp Celsius` with `type Celsius float64`) has that type's underlying type and none of its methods: `Temp` takes `float64` constants and operators, converts to and from `Celsius` and `float64`, and is identical to neither. The same holds for defined function, slice, map, array, struct and interface types.
- An instantiated generic type (`Box[int]`) is identical to another instance of the same declaration with identical type arguments.
- Unnamed struct types are identical when they have the same fields in the same order with the same names, types, embedding and tags; `struct{ X int }` and `struct{ Y string }` are different types.
- Unnamed interface types are identical when they have the same methods with identical signatures. Func types are identical when parameters and results match; parameter names do not count.
- Slices, arrays (with the same length), maps and pointers are identical when their element types are.
- `byte` is `uint8` and `rune` is `int32`.

A defined struct type and an unnamed struct type with identical non-embedded fields assign to each other, in variable declarations, assignments, struct fields, composite literal elements, plain call arguments and returns:

```go
type Point struct{ X, Y int }

var p Point = struct{ X, Y int }{1, 2} // ok
var u struct{ X, Y int } = p           // ok
```

`range` assignment, `switch` cases, multi-value calls, comma-ok forms, `defer` arguments, map keys and structs with embedded fields need an explicit conversion (`struct{ X, Y int }(p)`). Defined slice, array, map, func and interface types assign to the matching unnamed type in every context without a conversion.

#### Go `any` versus JavaScript values

A Go `any` holds a value of some type and says nothing about which one. You can compare it with `==` and `!=`, pass it where `any` or `interface{}` is expected, and look inside it with a type assertion or a type switch. Arithmetic, unary operators, `++`, calls, indexing, slicing, `range` and use as a condition are errors until you assert the type:

```go
var v any = 2
_ = v * 2       // invalid operation: v * 2 (mismatched types any and untyped int)
_ = v.(int) * 2 // ok

if s, ok := v.(string); ok { ... }
```

A defined empty interface such as `type MyAny any` behaves like `any` here, but it is its own type: a `*MyAny` is not assignable to `*any`. A Go `any` is not a boolean, so it cannot be a `templ` `if` condition either.

A value is a Go `any` when your code declares it so (a variable, parameter, result, map or slice element of type `any`), or when it comes from `recover()`, `any(x)`, `x.(any)` or the `default:` clause of a type switch on an `any`.

Values that come from JavaScript stay dynamic: browser globals and their members (`document`, `window`, `console`), ECMAScript built-ins (`Math`, `JSON`) and values declared `any` in a `.d.ts` file. Typed Web APIs such as `WebGL2RenderingContext`, `webgpu.Device` (from `gofront/webgpu`), `ArrayBuffer` and TypedArrays are checked statically. The checker lets you do arithmetic on dynamic values, call them, index them, read members and assign them to a typed variable (`width := window.innerWidth * 2`) without an assertion. A dynamic value you store in a variable you declared as `any` is a Go `any` from then on.

#### nil

`nil` is a value of pointer, slice, map, func and interface types. `var n int = nil` and `var s string = nil` are errors, as is any other assignment of `nil` to a number, string, bool, struct or array, and comparing such a value with `nil` (`n == nil` is `mismatched types int and untyped nil`). `nil` has no type of its own: `x := nil` (`use of untyped nil in assignment`), `var x = nil`, `const c = nil` and `nil == nil` are errors. In a generic function, `nil` is a value of type `T` only when every type in `T`'s constraint is nilable (`T *int | []int`). Dynamic JavaScript values (see above) accept `nil`.

#### Statements and assignments

- **Return counts**: `return 1, 2` in a function with one result is `too many return values (have 2, want 1)`.
- **`range`** accepts integers, strings, slices, arrays, pointers to arrays, maps and iterator funcs. Ranging over an integer takes at most one iteration variable (`for range n` or `for i := range n`). Floats (also constants such as `3.0` or `1e3`), bools, structs, interfaces and a Go `any` are errors.
- **Invalid assignment targets**: `s[0] = 'x'` on a string, `m[k].f = v` on a map of structs (assign the whole element, or keep pointers in the map), and `m[k][0] = v` on a map of arrays are errors.
- **Pointer methods** cannot be called on a value that is not addressable: `mk().Inc()` with `mk` returning a struct value is `cannot call pointer method Inc on C`. Store the result in a variable first.
- **Assignment targets and `&`** must be addressable: a variable, a pointer indirection, a slice element, or a field or array element of an addressable value. Call results, literals, type assertions, constants, string elements and map entries are not (`mk().X = 1`, `mk().X++`, `&mk()`, `k++` on a constant), except that a map index itself can be assigned (`m[k] = v`) and `&T{}` is allowed. Store the value in a variable first. A function, type or constant is not a variable either, also when it belongs to an imported package: `fmt.Println = nil`, `&strings.Builder` and `Fn = nil` for a dot-imported `Fn` are errors, while a package's variables stay assignable (`pkg.Count = 2`).
- **Labels** belong to one function. `break L` needs `L` to label an enclosing `for` or `switch` statement and `continue L` an enclosing loop, a label that nothing uses is `label L defined and not used`, and a repeated label is an error.
- **Unused values**: only calls and `await` expressions may stand alone as a statement. `x + 1`, `x == 2`, a function name, a conversion such as `float64(x)`, and builtins that only compute a value (`len`, `cap`, `append`, `make`, `new`, `min`, `max`, `complex`, `real`, `imag`) are `... is not used`. Calls to functions, methods, func values, `panic`, `recover`, `print`, `copy`, `delete` and `clear` are fine.

#### Operators and comparisons

GoFront applies Go's operator rules to every kind of operand, with Go's messages:

- **Ordering and logic**: `<`, `<=`, `>` and `>=` work on integers, floats and strings (and defined types over them), not on booleans, pointers, structs or interfaces. `&&`, `||` and `!` need booleans, `^` and `&^` integers, and unary `-` and `+` numbers. An untyped rune counts as an integer for `%` and `^`.
- **Equality**: `==` and `!=` need one operand assignable to the other. An interface compares with any value that implements it (`i == T{}`, `a == [2]int{1, 2}`), and with `nil`; comparing it with a value that does not implement it, such as `s == 1` for an `error` `s`, is an error. A slice, map or func compares only with `nil`.
- **Shifts** need an integer left operand and a non-negative integer count. An untyped constant being shifted takes its type from the context, which must be an integer type: `var f float64 = 1 << s` is an error, while `var v any = 1 << s` is an `int`.
- **Constants** are exact: `1 + 0i` converts to an integer, `float32(0.1)` rounds, and a constant too large for `float32`, `float64` or `int` (including a `range` operand) is `constant ... overflows`. Complex constants fold by value.
- **Conversions** follow Go's rules in every form: slices of different element types, floats to `string` and `int(1.5)` are errors.
- **Methods and `switch`**: receivers must be a defined type (not an interface, pointer or predeclared type), a `switch` tag must be comparable, and tagless `case` expressions must be booleans.
- **Comparable types**: a map key type and the operands of `==` and `!=` must be comparable. `map[[]int]int`, a key struct with a slice, map or func field, and an unconstrained type parameter as key (`map[K]int` with `K any`) are `invalid map key type ...`; comparing structs or arrays that contain a slice, map or func is `struct containing []int cannot be compared`, including against an interface (`i == p`).
- **Complex `++` and `--`** add or subtract one on every target, for variables, fields, map elements and `for` post statements.

#### Builtin operands

- **`len`** takes a string, array (or pointer to one), slice or map: `len(5)`, `len(p)` with `p` an `*int`, and `len(v)` with `v` a Go `any` are `invalid argument: ... for built-in len`. `delete` needs a map, `clear` a map or slice, `copy` and `append` slices (`copy` may take a string source into a `[]byte`), and `min` and `max` integers, floats or strings.
- **`append`** checks each element against the slice's element type (`append([]int{}, "a")` is an error) and `xs...` against the slice type, except that a string spreads into a `[]byte`. A call `f(xs...)` likewise needs `xs` to match the variadic parameter's slice type.
- **`xs...`** passes a slice as the whole variadic argument, so it needs a variadic callee and fills every parameter: `f(xs...)` with `func f(xs []int)` is `cannot use ... in call to non-variadic f`, `f(1, xs...)` with `func f(xs ...int)` is `too many arguments in call to f`, and `len(xs...)` or `T(xs...)` is `invalid use of ...`. Only `append(s, xs...)` takes a spread among the builtins.
- Dynamic JavaScript values (see above) are accepted by all of these.

#### Literals and duplicates

- **Struct literals**: a positional literal lists every field (`S{1}` for a struct with two fields is `too few values in struct literal of type S`); a keyed literal may omit fields, and the two forms do not mix.
- **Duplicate `switch` cases** of integer, float or string constants are `duplicate case 1 (constant of type int) in expression switch`; constants are compared by value after conversion to the tag's type, so `1` and `0x1` collide and `case a:` with a variable does not. A `switch` on an interface keeps the constants' own types (`case 1` and `case 1.0` differ). Boolean and complex constants are not compared.
- **Duplicate map keys** in a literal, `map[string]int{"a": 1, "a": 2}`, are `duplicate key "a" in map literal`, with the same value rules; boolean keys are compared too. Duplicate indexes in a slice or array literal are an error as well.

#### Type assertions

A type assertion `x.(T)` or a type switch case `case T:` on an interface value `x` is an error when `T` is a concrete type that can never be the dynamic type of `x`, because `T` lacks a method of `x`'s interface (or has it only on the pointer receiver):

```go
type I interface{ M() }
type S struct{}

var i I
_ = i.(S) // impossible type assertion: i.(S)
```

Asserting to an interface type, and asserting on an empty interface or `any`, is always allowed.

#### Generic function bodies

A generic function body is checked once, where it is defined, against every type its constraint allows, even if the function is never called. An operator must work for each of those types: `+` for numbers and strings, `-`, `*` and `/` for numbers, `%`, `&`, `|`, `^`, `&^` and shifts for integers, and `<`, `<=`, `>`, `>=` for ordered types. A constraint without type terms (`any`, `comparable`, or one that only lists methods) allows only `==` and `!=`, and only when the type is comparable:

```go
func Mod[T ~int | ~float64](a, b T) T { return a % b }
// invalid operation: operator % not defined on a (variable of type T constrained by ...)

func Sum[T ~int | ~float64](a, b T) T { return a + b } // ok
func Add[T any](a, b T) T { return a + b }             // invalid operation: operator + not defined on a
```

The same rule applies to the builtins `len`, `cap`, `append`, `copy`, `clear`, `delete`, `min` and `max`: every type in the constraint must be a valid argument, so `len(v)` needs a constraint such as `~[]int | ~string`, and `append` and `copy` need every slice in it to have the same element type:

```go
func Len[T any](v T) int { return len(v) }
// invalid argument: v (variable of type T constrained by any) for built-in len

func Size[T ~[]int | ~string](v T) int { return len(v) } // ok
```

Narrow the constraint (an integer-only set for `%`, `cmp.Ordered` for `<` and `min`) to fix these.

#### Generic functions as values

A generic function is called with inferred type arguments (`Id(3)`) or instantiated explicitly before it is used as a value (`f := Id[int]`, `slices.SortFunc(xs, cmp.Compare[int])`). Using it without either, as in `f := Id` or `fmt.Println(slices.Reverse)`, is `cannot use generic function Id without instantiation`. GoFront does not infer the type arguments from the target of an assignment or from a parameter type, so `var f func(int) int = Id` and `slices.SortFunc(xs, cmp.Compare)` need the explicit `[int]`.

#### Values and type parameters

A value whose type is a type parameter converts or assigns only as its type set allows: `var t T = n` with `n int`, `var n int = t`, `string(t)` with `T any` and `T(a)` with `a any` are errors, and `any(t)` always works. `range` over a type parameter works through its core type only (`T ~[]int` is fine, `T any` or `T ~float64` is not), and a type parameter has no fields even when its core type is a struct. An untyped constant on the left of a shift takes the type of the context, so `1 << s` in a generic function over `~uint8` yields `1024` when `s` is `uint8(10)` and the result is `int`, and ranging over a value of a `~func(func(V) bool)` type parameter yields each value.

#### Constraints

A constraint with several union elements or embedded constraints intersects them: `interface{ ~int; ~string }` is empty, and `==` on it is rejected. `~T` needs a `T` that is a plain type, not an interface or a type parameter, and `comparable` as a map key or type argument must be satisfied by a type that is comparable. Constraint interfaces such as `comparable` and `interface{ ~int }` can only be used as constraints, not as variable types.

#### Builtin argument counts

Every builtin checks how many arguments it gets, on every target: `len()` is `not enough arguments for len() (expected 1, found 0)` and `len(a, b)` is `too many arguments for len() (expected 1, found 2)`. `min` and `max` unify their arguments, so `max(1, 2.5)` is `2.5` while `max(i, 2.5)` with an `int` `i` is an error.

#### Scope of local types

A type declared inside a function or block exists only there. Using it in another function, or after the block that declares it, is an error: the name is unknown there. A local type never changes what a package-level or dot-imported name of the same spelling means elsewhere.

#### Names used as values

A type, a builtin or a package is not a value. It may stand only where Go allows it: as the callee of a conversion or call, the operand of `*` in a type, or the left side of a selector. Elsewhere each is an error with Go's message:

```go
_ = P           // P (type) is not an expression
fmt.Println(int) // int (type) is not an expression
_ = len         // len (built-in) must be called
_ = strings     // use of package strings not in selector
_ = strings.Builder // strings.Builder (type) is not an expression
var pv P
_ = pv.X{}      // pv.X is not a type
_ = int{}       // invalid composite literal type int
```

#### Names that shadow predeclared types

As in Go, your own declarations may reuse a predeclared name: a type named like a basic type, `any`, `error` or `comparable` (`type int32 = string`, `type error int`), a function or variable named like a builtin or basic type (`func len() int`, `func bool() int`, `max := 3`), and a local type named like an import. The name means your declaration in its scope, at package level or from a local declaration to the end of its block, nested blocks included, and keeps its predeclared meaning everywhere else: the standard library's `error` results, `errors.New` and `fmt` still use the built-in `error` interface next to a package's own `type error`.

```go
type error int

func main() {
	var e error = 3
	_, err := strconv.Atoi("x") // err is the built-in error interface
	fmt.Println(e, err != nil)  // 3 true
}
```

#### Internal compiler errors

A failure inside the compiler after type checking (lowering, code generation or linking), and a linked WebAssembly module that fails `WebAssembly.validate`, stop the build with `internal compiler error: ...` and a link to the issue tracker. These are bugs in GoFront, not problems in your program; the build never writes an invalid `app.wasm`. Valid Go that a target does not support, such as an unsupported value across the WebAssembly boundary, stays an ordinary compile error that names the construct.

### Semantic differences

These features are implemented for `js` packages but behave differently due to fundamental JS runtime
constraints. These are **not bugs** — they are deliberate trade-offs documented here so
you know exactly what to expect. Packages targeting `wasm` or `both` enforce strict
Go numeric semantics instead (sized integer wrapping, true `float32`, 64-bit integers,
divide-by-zero panics) — see the [hybrid guide](hybrid-wasm.md#strict-numeric-mode).

| Feature | GoFront | Go | Why |
|---|---|---|---|
| Map iteration order | Insertion-order (`Object.entries`) | Randomised | JS objects preserve insertion order. |
| Map keys | Keys are stringified: keys of a named struct type are told apart field by field, struct keys of an unnamed struct type collapse to `"[object Object]"`, array keys join their elements with commas, `NaN` equals itself and `-0` equals `0` | Field-wise struct equality, `NaN != NaN` | JS objects only have string keys. `wasm` packages hash struct keys field-wise and follow Go's float key rules. |
| `defer` / `recover()` | `try`/`finally` defer stack plus a panic stack; `recover()` only works when called directly by a deferred function; a panic inside a deferred function replaces the in-flight one | Same | Matches Go for the common cases. `recover()` returns the panic value with its type on every target (`panic(42)` recovers an `int`); an uncaught panic reaches JavaScript as an `Error` whose message is the value's text. On WebAssembly that text is Go's: an `error` prints its `Error()`, a `Stringer` its `String()`, `bool`, unsigned numbers, floats and complex numbers print as written (`true`, `9223372036854775808`, `(1+2i)`), a defined type such as `type T int` or `type C complex128` prints as `main.T(5)` or `main.C(1+2i)`, and the same holds for a value held in an `any`; only structs, arrays, pointers, slices, maps, funcs, `simd` vectors and `shared` buffers that implement neither `error` nor `String()` report `[panic object]`, where Go prints a type and address for the Go types. `panic(nil)` (and a panic with a nil `any` or `error`) recovers a `*runtime.PanicNilError` on WebAssembly, as in Go 1.21 and later, and an uncaught one reaches JavaScript as "panic called with nil argument"; on JavaScript and in the JavaScript half of `both` packages, `recover()` returns `nil` there, because a nil `any` cannot be told from other nil values without boxing every interface value. |
| Integer arithmetic | `int64`/`uint64` wrap at 64 bits as BigInt on all targets; other integer types use IEEE 754 float64 semantics in `js` packages (`a + b` never wraps) and wrap at type width in `wasm`/`both` | Wraps at type width | `int64`/`uint64` are exact BigInt across all targets. For other integer types in `js` packages, all JS numbers are float64. Conversions do truncate: `uint8(300) == 44`, `int8(200) == -56`. |
| Integer precision | `int64`/`uint64` are exact 64-bit BigInt on all targets; `int`/`uint` are safe up to 2⁵³ | Full width per type (`int64` = 64 bits) | `int64` and `uint64` are exact BigInt across all targets (`js`, `wasm`, `both`) and across the WASM facade. `int`, `uint`, and narrower types map to JS `number` (exact up to 2⁵³); hot loops should use `int` for performance. Constant literals outside ±2⁵³ typed as `int` emit a warning. |
| `cap()` | Tracks capacity for slice views (`b[i:j]`, `b[i:j:k]`), `make([]T, n, cap)` and `x = x[lo:hi]` copies; equals `len()` for slices built by literals, `append` beyond capacity and other operations | May exceed `len()` | A plain JS array has no separate capacity, so only views and resliced copies carry one. |
| Fixed-size arrays (`[n]T`) | Compile-time enforcement (bounds, `append` rejected, size matching, an integer constant length such as `3`, `N` or `len(other)` of an array); copied on assignment; plain JS arrays at runtime | Fixed at compile time, value-type copy semantics | Runtime bounds enforcement adds overhead; compile-time checks catch most errors. |
| `nil` | Maps to `null`; `== nil` also matches `undefined`. A nil slice or func stored in an `any` or `interface{}` still compares equal to `nil` (a nil slice keeps its type for assertions and type switches), while a nil map or pointer stored in an `any` or interface is not equal to `nil`, as in Go | Typed nil (distinct per type); a nil map, pointer or func in an interface is not a nil interface | JS has no typed nil concept; JS interop values are often `undefined`. In `wasm` packages a nil map, pointer or func in an `any` is not equal to `nil`, a type switch sees its type, and it can be asserted to an interface its type implements and have its methods called, as in Go. A method with a pointer receiver can be called on a nil pointer (`var p *T; p.M()`, `(*T).M(p)`) and receives `nil`, as in Go, on every target. |
| `rune` / `byte` | Aliases of `int32` / `uint8`, all mapped to `number` | Aliases of `int32` / `uint8` | Type-level behaviour matches Go; at runtime every number is a float64. |
| Strings and UTF-16 | JavaScript UTF-16 code units for string length, indexing, and range. Byte conversions (`[]byte(s)`) and standard library parsers operate on exact UTF-8 bytes | Byte count, byte index, rune range | See [String semantics](#string-semantics-both-backends) above. |
| Runtime panics in `both` packages | In `both` and `wasm` packages, out-of-range indexing panics with `index out of range [i] with length n`, writes to a nil map panic with `assignment to entry in nil map`, and nil struct pointer reads panic with `invalid memory address or nil pointer dereference`. In `wasm` packages, reading through a nil pointer (`*p`, value-receiver calls), calling a nil func value, and calling a method on a nil interface or on a nil pointer stored in one also panic with the same message. Slice expressions panic with Go's bounds text on every target (`slice bounds out of range [:5] with capacity 3`, `[2:1]`), and so do string slices in `both` and `wasm` packages; in `js` packages a string slice out of range returns the clamped substring. In `wasm` packages 64-bit and unsigned bounds, indexes, `make` sizes and integer `range` counts keep their Go width: a slice bound or index of 2^32 or more panics with its full value (a `uint32` or `uint64` prints unsigned), `make` with a length or capacity of 2^31 or more panics with `makeslice: len out of range` or `makeslice: cap out of range` because a WebAssembly array cannot hold that many elements, and `for i := range n` counts to any 64-bit or unsigned `n`. Bounds checks are elided for provably in-bounds loops and for constant slice indexes after a length proof (`_ = xs[15]`, or `if len(xs) > 15 { ... }`) when the slice is never reassigned in the function. In `js` packages, standard JavaScript behavior applies | Same runtime panics | Matches Go runtime panic behavior in `both` and `wasm` packages without slowing hot paths. |
| Evaluation order | Function calls in an expression or statement run once each, in source order. A multiple assignment evaluates every index, field and pointer operand on its left before it stores anything, with two exceptions. First, a complex (`complex64` or `complex128`) compound assignment whose target holds a call and whose right side has none (`m[k()] += z`, `cs[i()] += z`) runs that call more than once on the `js` and `both` targets. Second, when an earlier target of a multiple assignment is not a plain variable (a struct field, a slice, array or map element, or a pointer dereference), a later target operand that depends on it (a pointer, index or field) is read after the first store on every target (`sp.P, *sp.P = &sb, 99` stores to the new pointee and `sp.I, xs[sp.I] = 1, 99` writes the new index; Go uses the old ones). Reading a variable in the same statement as a call that changes it is unspecified in Go: GoFront reads plain operands before the call, and gc often reads them after (`a + f()` where `f` changes `a`) | Same rules, with gc's own choice for the unspecified cases | Do not depend on the order of a variable read against a call, since the spec leaves it open. Moving every call out of every expression to match gc would add temporaries to ordinary code. |
| `maps.Keys` / `maps.Values` | Return `iter.Seq` iterators, matching Go 1.23. Range over them directly or collect into a slice with `slices.Collect(maps.Keys(m))` | Return `iter.Seq` | Matches Go 1.23 iterator semantics. |
| `fmt` of a value in an `any` | `Print`, `Println`, `Sprint`, `Fprint` and `Append` describe each type at compile time from the code of the package that calls them. A struct, map, slice or pointer that reaches an `any` prints as Go does when that package mentions its type; one it never mentions, for example a value another package returns as `any`, prints as `<nil>`. An integer-valued `float64` stored in an `any` variable (such as `var a any = 3.0`) prints as `3` like Go, but `%T` reports `int`. `%T` of a map, slice or array that generic code builds and boxes into an `any` (`map[K]V` inside `func pair[K comparable, V any]`, `[]V` inside `func one[V any](v V) any`, `[2]V` inside `func two[V any](v V) any`) prints the instantiated type (`map[string]int`, `[]int`, `[2]int`) on every target | Reads the type at run time | GoFront has no run-time type information. Print the value where its type is known (`fmt.Println(lib.New())` instead of passing it through `any` first) or give the type a `String` method. |
| `fmt` `%p` verb | Prints `0x` and a small hex id instead of an address: the same pointer or func gets the same id in every call and different ones get different ids, numbered from 1 in order of first appearance; a nil pointer, func, map or slice prints `0x0`. A map or slice has one id per value, so two slices of the same backing array made by reslicing can print different ids, unlike in Go. `%d` of a pointer to a scalar prints the id in decimal, and `%v` of a func prints the id | Prints the memory address | GoFront has no raw memory, so the ids are not real addresses and differ from run to run in Go. Do not rely on the digits; compare pointers with `==` instead. |
| Sized numbers in an `any` | In the JavaScript output (`js` packages and the JS side of `both` packages) an `any` holds `int8`, `int16`, `int32`, `uint8`, `uint16`, `uint32` and `float32` as a plain number and `int64`/`uint64` as a plain `bigint`, with no type tag. `fmt` therefore prints a `float32` in an `any` with its `float64` digits (`float32(0.1)` prints `0.10000000149011612`), and `%T` reports `int` for the narrower integer types (a rune literal such as `'a'` included) and `int64` for `uint64`. `wasm` packages and the WebAssembly side of `both` keep the type (`0.1`, `uint64`, and `int32` for `'a'`, so `v.(rune)` matches) | Keeps the dynamic type (`0.1`, `uint64`) | A JS number or bigint cannot say which Go type it came from, and tagging every number stored in an `any` would slow hot paths. Print the value before it goes into the `any` (`fmt.Println(x)` on the typed variable), or convert it back with a type assertion. |
| `error` type | Interface `{ Error() string }` with `__error` runtime objects | Interface `{ Error() string }` | Close match. Custom error types, `errors.Is`/`Unwrap`, `%w` wrapping all work. `toString()` added for JS string context compat. |
| `errors.Is` | Walks the `Unwrap` chain comparing by identity **or by message** for `errors.New`/`fmt.Errorf` values (both backends) | Identity (or `Is` method) only | Two distinct `errors.New("x")` sentinels compare equal. Use distinct messages or a custom error type when identity matters. |
| `any == any` with numbers | `js` packages compare by JS value: `any(3) == any(3.0)` is `true`; `wasm` packages compare dynamic type first, so it is `false` | `false` (different dynamic types) | JS has a single `number` type. Compare after a type assertion in `both` packages to get identical results. |
| Struct field tags | Parsed and preserved for compile-time code generation (`encoding/json` honors `json:"..."` tags including `,omitempty`, `,string`, `-`, `-,`, and unexported field exclusion); general runtime reflection is not supported | Available via `reflect` | No reflection runtime; tags drive static compile-time code generation. |
| `encoding/json` | Implemented via static compile-time code generation without runtime reflection on both backends (`js`, `wasm`, and `both` packages). Supports structs, maps, slices, primitives, pointers, `json.RawMessage` (with `MarshalJSON` and `UnmarshalJSON`), `Number`, `Compact`, `Indent`, `HTMLEscape`, `Encoder`, `Decoder`, typed error values (`*json.SyntaxError`, `*json.UnmarshalTypeError`, `*json.InvalidUnmarshalError`, etc.), and `MarshalJSON`/`UnmarshalJSON` methods (pointer receivers only on addressable values, as in Go). The package can be imported under an alias; `json.Marshal`, `json.MarshalIndent` and `json.Unmarshal` must be called directly, because the compiler generates a codec for each call's type, so using one as a value (`f := json.Marshal`) is a compile error. `int64` and `uint64` values stay exact on every target; `int` and `uint` values beyond 2⁵³ lose precision on the JS side (use `int64`, or `Decoder.UseNumber` and `json.Number`, to keep exact digits). Every target uses the same generated Go codecs and the same support code, so results and error messages agree; the codecs are linked into `app.wasm` in `wasm` and `both` packages (no host `JSON`, 64-bit integers stay exact) and compiled to JavaScript in the others. A value stored in `any` is encoded only if its type is one the package builds with a composite literal, `&T{}`, `make` or `new`, converts to an interface (`var v any = t`), or encodes elsewhere; in `js` packages a struct field whose type or map key comes from a `.d.ts` file encodes as `null` when nil and fails with `json: unsupported type: <Name>` otherwise, and `Unmarshal` into such a field is a compile error; in `wasm` and `both` packages `Unmarshal` into a pointer to a pointer (`var p *T; Unmarshal(b, &p)`) is a compile error. In the JavaScript output (`js` packages and the JS side of `both` packages) a value stored in `any` is encoded from the static type it had when it entered the interface, so arrays, pointers, `json.Number`, anonymous structs and `encoding.TextMarshaler` values encode as in Go; a `float32` is recognised by its value, so a `float64` that holds exactly a `float32` value encodes with the shorter `float32` spelling, an integer beyond 2⁵³ loses its exact value, and a nil map or slice of an unsupported type encodes as `null`. On every target a nil slice of an unsupported element type (`[]func()`) in an `any` encodes as `null` and a non-nil one fails with `json: unsupported type: func()`, and an array of funcs (`[2]func()`) in an `any` always fails with `json: unsupported type: func()`, as in Go. | Standard library package with runtime reflection | Reflection-free compile-time specialization matches Go formatting and error messages. |
| `gofront/simd` | Experimental. Value-type 4-wide float SIMD (`simd.F32x4`). In WASM compiles to native `v128` instructions without GC allocation; in JS lowers to frozen 4-element arrays using `Math.fround` for 32-bit float parity. `F32x4` and the comparison result `Mask32x4` are ordinary value types (struct fields, map keys, `==`, `fmt`) and cross the JS↔WASM boundary as copied `Float32Array` and boolean-array values; in `wasm` packages a `[]F32x4` crosses as one copied `Float32Array` of `4n` floats; in `both` packages, which run as plain JavaScript, it stays an array of 4-element arrays. A `[]Mask32x4` crosses as an array of boolean arrays. | Not in Go standard library | High-performance vector math targeting WebAssembly SIMD. |
| Pointers (`&x`, `*p`) | Struct pointers are the struct reference itself; address-taken scalar variables use a single-field reference box; slices and maps are references. In `js` packages, pointers to scalar struct fields (`&s.Field`) and slice/array elements (`&xs[i]`) also work, using accessor references that read and write the underlying field or element. In `wasm` and `both` packages those are compile errors for every type other than structs and arrays (numbers, strings, bools, slices, maps, interfaces, pointers, funcs and SIMD vectors), as is `&pkgVar` on a package-level variable of those types, `&f` on any func-typed variable, and a pointer-receiver call on such an operand (`s.Count.Inc()` with `type Counter int`); see [Pointers in `wasm` and `both` packages](hybrid-wasm.md#pointers-in-wasm-and-both-packages) | True memory indirection | Shared mutation works for scalar locals, structs, and in `js` packages for fields and elements. Pointers compare by identity. WebAssembly has no pointer into a field or element of a managed object, so `wasm`/`both` reject them instead of giving wrong results. |
| `x = x[lo:hi]` in `js` packages | Assigning a sub-slice of a plain JS array `x` back to the same variable, global, or field within `len(x)` copies the elements into a plain array while preserving `cap(x)`, avoiding `Proxy` overhead on hot loops. Direct index writes through `x` (`x[i] = v`, `x[i] += v`, `x[i]++`) mirror immediately into the old backing array, and extending `x` (`x = x[:n]` beyond `len(x)` or `append` within `cap(x)`) syncs the copy back into a view over the old backing array. Unlike Go, writes through aliases of the old array are not visible in `x` until `x` is extended, writes to `x` through another reference (`&x[i]`, `copy`, `sort`/`slices` helpers, or a complex index expression) only reach the old array when `x` is extended, and sub-slices of the copy (`y := x[1:]`) have capacity capped at `len(x)`. Parameters, named results, typed arrays, and existing slice views are not copied and always share their backing store | Every slice expression shares the backing store | A shared view of part of a plain JS array is a `Proxy`, which is several times slower to index than a plain array (`for … range` reads the backing array directly). Assign to a new variable (`y := x[:n]`) when full backing-array sharing is required. |
| Slice views passed to JS | A partial view of a plain `[]T` is a fixed-length array to JS code: indexing, `length`, iteration, `Array.isArray` and `Array.prototype` methods that do not change the length work; `push`, `splice` that changes the length and `length =` leave the length unchanged, `Object.freeze` throws a `TypeError`, and `structuredClone`/`postMessage` are not supported. `Array.from(v)` copies it to a plain array | Not applicable | A view is a `Proxy` over the backing array. Copy it with `Array.from` before handing it to an API that resizes, freezes or clones arrays. |
| `time.Time` boundary crossing | Copied field by field with nanosecond precision; JS code may pass a `Date` and reads a `Time` as a `Date` through `_d` | Nanosecond precision everywhere | A `Date` carries no zone name, only an offset. |
| Exported / unexported | Enforced between GoFront packages on every target: another package cannot use an unexported name, type, field, method, method expression or struct-literal field (`name x not exported by package p`, `cannot refer to unexported field x`); external `.d.ts`/npm namespaces are exempt | Access enforced uniformly | External JS APIs use lowercase names by convention. |
| Imports per file | An import applies only to the file that declares it, and an unused import of an npm package is an error like any other unused import | Same | Each file imports what it uses; a package exports only what it declares. |

### Names that shadow JS globals

As in Go, a declaration may shadow a predeclared name: a package-level `func Array()`,
`var document int` or `const Object = 2`, a parameter, or a local `console := 1` are all
accepted in `js`, `wasm` and `both` packages, and Go code referring to the name gets the
declaration.

The JS bundle is one flat module scope, and generated code relies on the real globals
(`Array.from`, `Object.keys`, `Math.trunc`, `new Map()`, `BigInt.asIntN`, …). So when a
function, variable, constant, parameter, named result, local, `templ` component or `css`
component has the same name as a global the output reads, it is emitted with a `$` suffix.
The names renamed are:

- the browser globals GoFront predeclares (`console`, `document`, `window`, `Array`,
  `Object`, `Math`, `JSON`, `Date`, `Error`, `String`, `Number`, `Promise`, `fetch`,
  `setTimeout`, …);
- the JavaScript built-ins that generated code and the WebAssembly loader use: `Map`,
  `Set`, `WeakMap`, `WeakSet`, `WeakRef`, `BigInt`, `Proxy`, `Reflect`, `ArrayBuffer`,
  `DataView`, every typed-array constructor (`Uint8Array`, `Int32Array`, `Float64Array`,
  `BigUint64Array`, …), `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`,
  `WebAssembly`, `NaN`, `Infinity`, `undefined`, `globalThis`, `process`, `Function`,
  `Iterator` and a few more host functions (`queueMicrotask`, `structuredClone`);
- any name that starts with `__`, the prefix of the runtime's own helpers (`__len`,
  `__append`, …).

| Go source | JS output / WASM boundary facade |
|---|---|
| `func Array() int` | `function Array$()`; the facade of a `wasm`/`both` package exports `Array$` |
| `func Map(xs []int) []int` | `function Map$(xs)`; the facade exports `Map$` |
| `var document int` | `let document$` |
| `const NaN = 2.0` | `const NaN$`, so `math.NaN()` still returns the real `NaN` |
| `func f(console int)` | `function f(console$)` |
| `BigInt := 2` | `let BigInt$`, so `int64` arithmetic in the same function still works |
| `templ Map(msg string)` / `css Object()` | `function Map$(msg)` / `function Object$()` |
| `var __append = 7` | `let __append$` |

Go code never sees the suffix: references from the same package, from importing packages
(`util.Array()`) and through dot imports (`import . "./util"` then `Array()`) all use the
renamed binding. Builtins that are not JS globals (`len`, `append`, …) and labels are not
renamed. A struct field or method is renamed only when its name starts with `__`
(`__clone` is `__clone$` on the JS object), because the runtime uses such names itself;
`fmt` and `%+v` still print the Go name. This applies to the JS output and to `both`
structs that cross the WASM boundary; hand-written JavaScript reads the field as `r.__t$`.
Fields of `wasm` package structs are reached through the facade, which applies the same
rule: a field or interface method that begins with `__` gets the `$` suffix on the JS side,
and every other name is unchanged.

The suffix is visible to hand-written JavaScript. Code that reaches into the bundle or the
WASM facade by name (an `import { Array$ } from "./app.js"`, a `<script>` calling an
exported function, a test harness) must use `Array$` or `Map$`, not `Array` or `Map`; the
unsuffixed name there is still the browser's global. Pick a different Go name for exported
functions you call from JS.

> [!WARNING]
> Package-level struct types and types with methods in `js` and `both` packages are **not**
> renamed. Each is emitted as a JS class of the same name, and a class named after a JavaScript
> built-in that generated helpers call (`Array`, `Object`, `Error`, `Map`, `Set`, `Number`,
> `String`, `Math`, `JSON`, `Promise`, `Date`, the typed-array constructors, …) would
> shadow it. GoFront therefore rejects such a declaration in `js` and `both` packages with
> `type Array shadows the JavaScript global Array; rename the type`; pick another name
> (`ArrayData`, `AppError`, …). Interfaces (`type Number interface{ ~int | ~float64 }`),
> method-less named types (`type String string`), aliases, DOM names (`type Element struct{…}`)
> and every type in a `wasm` package emit no conflicting class and are accepted.

A package-level type that Go allows but whose class would still shadow a built-in is
renamed instead: a method-less named non-struct type in a `js` or `both` package
(`type Map int`) and any type in a `wasm` package (`type WeakMap struct{ N int }`) is
emitted as `Map$$main` / `WeakMap$$util` (the type name, `$$`, the package name). Go code,
`%T` (`main.Map`, `util.WeakMap`) and error messages are unaffected; only hand-written
JavaScript that reaches the type by name sees the suffix. A type named after a JavaScript
reserved word (`let`, `yield`, `static`, …) gets the same `$` suffix the other names get, so a
`wasm` struct called `let` is `let$` in the facade.

Types declared inside a function are the exception: they can use these names freely
(`type Map struct{ N int }` in `main` works in every target, and `%T` prints `main.Map`).

---

