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
| Browser globals (`document`, `console`, etc.) | Predeclared as `any` for practical DOM access. `WebGL2RenderingContext`, `WebGLRenderingContext`, `GPUDevice`, `GPUAdapter`, `GPUQueue`, `ArrayBuffer`, `DataView`, and TypedArrays have full static typings with method-level checking. |
| `.d.ts` type imports (`import "js:./types.d.ts"`) | Type-safe interop with JavaScript libraries. |
| `.d.ts` tuple return mapping | TypeScript `[A, B]` in return position maps directly to Go multi-value return `(A, B)` (e.g. React/Preact hooks `state, setState := useState(...)`). |
| npm package resolution | Import types from `node_modules/` and `@types/` automatically. |
| `gofront/simd` (experimental) | Value-typed 4-wide float SIMD (`simd.F32x4`) compiling directly to native WASM `v128` instructions without GC overhead. |

### What's not implemented

| Feature | Reason | Prospect |
|---|---|---|
| `goto` | Neither backend has unstructured control flow; both would require a loop-plus-state-machine lowering. Rare in idiomatic Go. | Not planned. Reported in every target as `goto is not supported; restructure with labeled break/continue`. |
| `//go:embed` and `embed.FS` | Embedding files at compile time needs support in the resolver and asset pipeline. | Not supported yet. Reported as `//go:embed is not supported yet`. |
| Goroutines / channels / `select` | Go's concurrency model has no JS equivalent. A userland scheduler defeats the "no runtime" goal. | Out of scope. |
| `unsafe`, `reflect`, `cgo` | Require memory model or runtime type metadata that JS cannot provide. | Out of scope. `encoding/json` is supported through compile-time specialization without runtime reflection. |
| `time.Sleep` in `wasm`/`both` packages | Go's `time.Sleep` blocks OS threads; in GoFront `time.Sleep` is an async Promise helper for the single-threaded JS event loop. Synchronous WASM cannot block. | Supported in `js` packages via `await time.Sleep(...)`. |

### Standard library boundaries

GoFront supports standard library packages that compile to self-contained JavaScript and WebAssembly without a runtime scheduler, runtime reflection metadata, or operating-system services beyond what the browser provides (clock, random numbers, console):

| Category | Policy | Examples |
|---|---|---|
| **Supported on both backends** | Available in `js`, `wasm`, and `both` packages | `encoding/json`, `cmp`, `iter`, `slices`, `maps`, `strings`, `bytes` |
| **JS-only by design** | Available in `js` packages; targeted diagnostic in `wasm` | `regexp`, `time.Sleep`, `os.Getenv`, DOM APIs, host event loop |
| **Not supported: runtime** | Targeted diagnostic for the language features in every target; imported packages (`reflect`, `unsafe`, `runtime`) report it in `js` packages and are rejected as imports in `wasm` and `both` packages | Goroutines, channels, `select`, `reflect`, `unsafe`, `runtime`, `weak`, `unique` |
| **Not supported: small utility packages** | `import` reports `package '<path>' is not available` with a suggested alternative in `js` packages (`wasm` and `both` packages reject the import) | `bufio`, `net/url`, `context`, `log`, `encoding/csv`, `encoding/base32`, `container/*`, `hash/adler32`, `hash/crc32`, `hash/fnv`, `crypto/hmac`, `crypto/md5`, `crypto/sha1`, `crypto/sha512`, `crypto/subtle`, `math/rand/v2`, `math/cmplx`, `sync/atomic`, `unicode/utf16` |
| **Not supported: host OS** | Targeted diagnostic in `js` packages (`wasm` and `both` packages reject the import) | `net/http`, `net`, `os/exec`, file I/O in `os`, `syscall` |
| **Not supported: reflection** | Targeted diagnostic in `js` packages (`wasm` and `both` packages reject the import) | `text/template`, `html/template`, `encoding/xml`, `encoding/gob`, `flag` |
| **Not supported: large packages** | Targeted diagnostic in `js` packages (`wasm` and `both` packages reject the import) | `math/big`, `compress/*`, `archive/*`, `image/*`, `crypto/{aes,cipher,rsa,ecdsa,ed25519,x509,tls,elliptic}`, `encoding/{asn1,pem,ascii85}`, `text/{tabwriter,scanner}`, `go/*`, `debug/*`, `hash/{crc64,maphash}`, script and property tables in `unicode`, `//go:embed` |

### String semantics (both backends)

GoFront strings are JavaScript strings on both backends (`externref` in WebAssembly; string length, indexing, and range operate over UTF-16 code units):

| Construct | GoFront (JS and WASM) | Go |
|---|---|---|
| `len("héllo")` | `5` (UTF-16 code units) | `6` (UTF-8 bytes) |
| `"héllo"[1]` | `0xE9` (code unit) | `0xC3` (byte) |
| `for i := range "héllo"` | `i` counts runes `0, 1, 2, 3, 4` | `i` is byte offset `0, 1, 3, 4, 5` |
| `[]byte("héllo")`, `string(b)` | UTF-8, 6 bytes | UTF-8, 6 bytes |
| `[]rune(s)`, `string(r)`, `utf8.*InString` | Code points, as Go | Code points |

Consequences for portable code:
- **Byte operations**: Standard library packages that parse formats (`encoding/json`, `encoding/hex`, `crypto/sha256`) operate on `[]byte(s)` rather than string indexing so that byte offsets and multi-byte UTF-8 sequences are exact.
- **Escape sequences**: `\xNN` and octal escapes decode to the code point U+00NN (`len("\x00")` is 1 as in Go, but `"\xc3"` is the code point `Ã`, so `[]byte("\xc3")` yields the two UTF-8 bytes `0xc3 0x83`; use `[]byte{0xc3}` when raw byte literals are required).
- **Format offsets**: Byte offsets reported by `json.SyntaxError.Offset` count UTF-8 input bytes, matching Go.

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
| `defer` / `recover()` | `try`/`finally` defer stack plus a panic stack; `recover()` only works when called directly by a deferred function; a panic inside a deferred function replaces the in-flight one | Same | Matches Go for the common cases; panic *values* are surfaced as `Error.message` strings. |
| Integer arithmetic | IEEE 754 float64 semantics; `a + b` never wraps | Wraps at type width | All JS numbers are float64. Conversions do truncate: `uint8(300) == 44`, `int8(200) == -56`. |
| Integer precision | Safe up to 2⁵³ | Full width per type (`int64` = 64 bits) | JS `number` limitation. A constant expression outside ±2⁵³ compiles to the nearest `Number` with a `constant … exceeds JS Number precision` warning. |
| `cap()` | Tracks capacity for slice views (`b[i:j]`, `b[i:j:k]`), `make([]T, n, cap)` and `x = x[lo:hi]` copies; equals `len()` for slices built by literals, `append` beyond capacity and other operations | May exceed `len()` | A plain JS array has no separate capacity, so only views and resliced copies carry one. |
| Fixed-size arrays (`[n]T`) | Compile-time enforcement (bounds, `append` rejected, size matching); copied on assignment; plain JS arrays at runtime | Fixed at compile time, value-type copy semantics | Runtime bounds enforcement adds overhead; compile-time checks catch most errors. |
| `nil` | Maps to `null`; `== nil` also matches `undefined` | Typed nil (distinct per type) | JS has no typed nil concept; JS interop values are often `undefined`. |
| `rune` / `byte` | Aliases of `int32` / `uint8`, all mapped to `number` | Aliases of `int32` / `uint8` | Type-level behaviour matches Go; at runtime every number is a float64. |
| Strings and UTF-16 | JavaScript UTF-16 code units for string length, indexing, and range. Byte conversions (`[]byte(s)`) and standard library parsers operate on exact UTF-8 bytes | Byte count, byte index, rune range | See [String semantics](#string-semantics-both-backends) above. |
| Runtime panics in `both` packages | In `both` and `wasm` packages, out-of-range indexing panics with `index out of range [i] with length n`, writes to a nil map panic with `assignment to entry in nil map`, and nil struct pointer reads panic with `invalid memory address or nil pointer dereference`. Bounds checks are elided for provably in-bounds loops and for constant slice indexes after a length proof (`_ = xs[15]`, or `if len(xs) > 15 { ... }`) when the slice is never reassigned in the function. In `js` packages, standard JavaScript behavior applies | Same runtime panics | Matches Go runtime panic behavior in `both` and `wasm` packages without slowing hot paths. |
| `maps.Keys` / `maps.Values` | Return `iter.Seq` iterators, matching Go 1.23. Range over them directly or collect into a slice with `slices.Collect(maps.Keys(m))` | Return `iter.Seq` | Matches Go 1.23 iterator semantics. |
| `fmt` `%p` verb | Prints the bad-verb form `%!p(T=value)` because there are no addresses: a struct pointer prints its pointee (`%!p(*main.P=&{1})`), a nil pointer prints `%!p(<nil>)`, and a pointer to a scalar prints a small per-call number (`%!p(*int=0x1)`) that is not a stable identity and can differ between backends when the same pointer appears more than once | Prints the memory address | GoFront has no raw memory, so there is no address to print. Do not rely on `%p` output; compare pointers with `==` instead. |
| `error` type | Interface `{ Error() string }` with `__error` runtime objects | Interface `{ Error() string }` | Close match. Custom error types, `errors.Is`/`Unwrap`, `%w` wrapping all work. `toString()` added for JS string context compat. |
| `errors.Is` | Walks the `Unwrap` chain comparing by identity **or by message** for `errors.New`/`fmt.Errorf` values (both backends) | Identity (or `Is` method) only | Two distinct `errors.New("x")` sentinels compare equal. Use distinct messages or a custom error type when identity matters. |
| `any == any` with numbers | `js` packages compare by JS value: `any(3) == any(3.0)` is `true`; `wasm` packages compare dynamic type first, so it is `false` | `false` (different dynamic types) | JS has a single `number` type. Compare after a type assertion in `both` packages to get identical results. |
| Struct field tags | Parsed and preserved for compile-time code generation (`encoding/json` honors `json:"..."` tags including `,omitempty`, `,string`, `-`, `-,`, and unexported field exclusion); general runtime reflection is not supported | Available via `reflect` | No reflection runtime; tags drive static compile-time code generation. |
| `encoding/json` | Implemented via static compile-time code generation without runtime reflection on both backends (`js`, `wasm`, and `both` packages). Supports structs, maps, slices, primitives, pointers, `json.RawMessage`, `Number`, `Compact`, `Indent`, `HTMLEscape`, `Encoder`, `Decoder`, typed error values (`*json.SyntaxError`, `*json.UnmarshalTypeError`, `*json.InvalidUnmarshalError`, etc.), and `MarshalJSON`/`UnmarshalJSON` methods (pointer receivers only on addressable values, as in Go). `int64` values beyond 2⁵³ lose precision on the JS side (use `Decoder.UseNumber` and inspect `json.Number` as text to retain exact digits). In `wasm` and `both` packages codecs are generated as Go and linked into `app.wasm` (no host `JSON`), and 64-bit integers stay exact. A value stored in `any` is encoded only if its type is one the package builds with a composite literal, `&T{}`, `make` or `new`, or encodes elsewhere; `Unmarshal` into a pointer to a pointer (`var p *T; Unmarshal(b, &p)`) is a compile error there. | Standard library package with runtime reflection | Reflection-free compile-time specialization matches Go formatting and error messages. |
| `gofront/simd` | Experimental. Value-type 4-wide float SIMD (`simd.F32x4`). In WASM compiles to native `v128` instructions without GC allocation; in JS lowers to frozen 4-element arrays using `Math.fround` for 32-bit float parity. `F32x4` and the comparison result `Mask32x4` are ordinary value types (struct fields, map keys, `==`, `fmt`) and cross the JS↔WASM boundary as copied `Float32Array` and boolean-array values; in `wasm` packages a `[]F32x4` crosses as one copied `Float32Array` of `4n` floats; in `both` packages, which run as plain JavaScript, it stays an array of 4-element arrays. A `[]Mask32x4` crosses as an array of boolean arrays. | Not in Go standard library | High-performance vector math targeting WebAssembly SIMD. |
| Pointers (`&x`, `*p`) | Struct pointers are the struct reference itself; address-taken scalar variables use a single-field reference box; slices and maps are references. In `js` packages, pointers to scalar struct fields (`&s.Field`) and slice/array elements (`&xs[i]`) also work, using accessor references that read and write the underlying field or element. In `wasm` and `both` packages those are compile errors for every type other than structs and arrays (numbers, strings, bools, slices, maps, interfaces, pointers, funcs and SIMD vectors), as is `&pkgVar` on a package-level variable of those types, `&f` on any func-typed variable, and a pointer-receiver call on such an operand (`s.Count.Inc()` with `type Counter int`); see [Pointers in `wasm` and `both` packages](hybrid-wasm.md#pointers-in-wasm-and-both-packages) | True memory indirection | Shared mutation works for scalar locals, structs, and in `js` packages for fields and elements. Pointers compare by identity. WebAssembly has no pointer into a field or element of a managed object, so `wasm`/`both` reject them instead of giving wrong results. |
| `x = x[lo:hi]` in `js` packages | Assigning a sub-slice of a plain JS array `x` back to the same variable, global, or field within `len(x)` copies the elements into a plain array while preserving `cap(x)`, avoiding `Proxy` overhead on hot loops. Direct index writes through `x` (`x[i] = v`, `x[i] += v`, `x[i]++`) mirror immediately into the old backing array, and extending `x` (`x = x[:n]` beyond `len(x)` or `append` within `cap(x)`) syncs the copy back into a view over the old backing array. Unlike Go, writes through aliases of the old array are not visible in `x` until `x` is extended, writes to `x` through another reference (`&x[i]`, `copy`, `sort`/`slices` helpers, or a complex index expression) only reach the old array when `x` is extended, and sub-slices of the copy (`y := x[1:]`) have capacity capped at `len(x)`. Parameters, named results, typed arrays, and existing slice views are not copied and always share their backing store | Every slice expression shares the backing store | A shared view of part of a plain JS array is a `Proxy`, which is several times slower to index than a plain array (`for … range` reads the backing array directly). Assign to a new variable (`y := x[:n]`) when full backing-array sharing is required. |
| Slice views passed to JS | A partial view of a plain `[]T` is a fixed-length array to JS code: indexing, `length`, iteration, `Array.isArray` and `Array.prototype` methods that do not change the length work; `push`, `splice` that changes the length and `length =` leave the length unchanged, `Object.freeze` throws a `TypeError`, and `structuredClone`/`postMessage` are not supported. `Array.from(v)` copies it to a plain array | Not applicable | A view is a `Proxy` over the backing array. Copy it with `Array.from` before handing it to an API that resizes, freezes or clones arrays. |
| `time.Time` boundary crossing | Round-trips across the JS↔WASM boundary via Unix milliseconds (matching JS `Date`); sub-millisecond nanoseconds are truncated | Nanosecond precision everywhere | The JS shim operates on millisecond timestamps. Times created in WASM retain nanoseconds internally until crossing the boundary. |
| Exported / unexported | Enforced for GoFront packages; external `.d.ts`/npm namespaces are exempt | Access enforced uniformly | External JS APIs use lowercase names by convention. |

### Names that shadow JS globals

As in Go, a declaration may shadow a predeclared name: a package-level `func Array()`,
`var document int` or `const Object = 2`, a parameter, or a local `console := 1` are all
accepted in `js`, `wasm` and `both` packages, and Go code referring to the name gets the
declaration.

The JS bundle is one flat module scope, and generated code relies on the real globals
(`Array.from`, `Object.keys`, `Math.trunc`, …). So when a function, variable, constant,
parameter or named result has the same name as a browser global GoFront predeclares
(`console`, `document`, `window`, `Array`, `Object`, `Math`, `JSON`, `Date`, `Error`,
`String`, `Number`, `Promise`, `fetch`, `setTimeout`, …), it is emitted with a `$` suffix:

| Go source | JS output / WASM boundary facade |
|---|---|
| `func Array() int` | `function Array$()`; the facade of a `wasm`/`both` package exports `Array$` |
| `var document int` | `let document$` |
| `func f(console int)` | `function f(console$)` |

Go code never sees the suffix: references from the same package, from importing packages
(`util.Array()`) and through dot imports (`import . "./util"` then `Array()`) all use the
renamed binding. Builtins that are not JS globals (`len`, `append`, …) and type names are
not renamed.

The suffix is visible to hand-written JavaScript. Code that reaches into the bundle or the
WASM facade by name (an `import { Array$ } from "./app.js"`, a `<script>` calling an
exported function, a test harness) must use `Array$`, not `Array`; `Array` there is still
the browser's global. Pick a different Go name for exported functions you call from JS.

> [!WARNING]
> Type declarations are **not** renamed. A struct type, or a named type with methods, is
> emitted as a JS class of the same name, and a class named after a JavaScript built-in
> that generated helpers call (`Array`, `Object`, `Error`, `Map`, `Set`, `Number`,
> `String`, `Math`, `JSON`, `Promise`, `Date`, the typed-array constructors, …) would
> shadow it. GoFront therefore rejects such a declaration in `js` and `both` packages with
> `type Array shadows the JavaScript global Array; rename the type`; pick another name
> (`ArrayData`, `AppError`, …). Interfaces (`type Number interface{ ~int | ~float64 }`),
> method-less named types (`type String string`), aliases, DOM names (`type Element struct{…}`)
> and every type in a `wasm` package emit no conflicting class and are accepted.

---

