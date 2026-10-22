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
| `goto` | No clean JS or WASM translation (neither backend has unstructured control flow). Rare in idiomatic Go. | Not planned. Reported in every target as `goto is not supported; restructure with labeled break/continue`. |
| Goroutines / channels / `select` | Go's concurrency model has no JS equivalent. A userland scheduler defeats the "no runtime" goal. | Out of scope. |
| `unsafe`, `reflect`, `cgo` | Require memory model or runtime type metadata that JS cannot provide. | Out of scope. |
| `time.Sleep` in `wasm`/`both` packages | Go's `time.Sleep` blocks OS threads; in GoFront `time.Sleep` is an async Promise helper for the single-threaded JS event loop. Synchronous WASM cannot block. | Supported in `js` packages via `await time.Sleep(...)`. |

### Semantic differences

These features are implemented for `js` packages but behave differently due to fundamental JS runtime
constraints. These are **not bugs** — they are deliberate trade-offs documented here so
you know exactly what to expect. Packages targeting `wasm` or `both` enforce strict
Go numeric semantics instead (sized integer wrapping, true `float32`, 64-bit integers,
divide-by-zero panics) — see the [hybrid guide](hybrid-wasm.md#strict-numeric-mode).

| Feature | GoFront | Go | Why |
|---|---|---|---|
| Map iteration order | Insertion-order (`Object.entries`) | Randomised | JS objects preserve insertion order. |
| Map keys | Keys are stringified: struct keys collapse to `"[object Object]"`, `NaN` equals itself and `-0` equals `0` | Field-wise struct equality, `NaN != NaN` | JS objects only have string keys. `wasm` packages hash struct keys field-wise and follow Go's float key rules. |
| `defer` / `recover()` | `try`/`finally` defer stack plus a panic stack; `recover()` only works when called directly by a deferred function; a panic inside a deferred function replaces the in-flight one | Same | Matches Go for the common cases; panic *values* are surfaced as `Error.message` strings. |
| Integer arithmetic | IEEE 754 float64 semantics; `a + b` never wraps | Wraps at type width | All JS numbers are float64. Conversions do truncate: `uint8(300) == 44`, `int8(200) == -56`. |
| Integer precision | Safe up to 2⁵³ | Full width per type (`int64` = 64 bits) | JS `number` limitation. A constant outside ±2⁵³ compiles to the nearest `Number` with a `constant … exceeds JS Number precision` warning. |
| `cap()` | Tracks capacity for slice views (`b[i:j]`, `b[i:j:k]`) and `make([]T, n, cap)`; equals `len()` for slices built by literals, `append` beyond capacity and other operations | May exceed `len()` | A plain JS array has no separate capacity, so only views carry one. |
| Fixed-size arrays (`[n]T`) | Compile-time enforcement (bounds, `append` rejected, size matching); copied on assignment; plain JS arrays at runtime | Fixed at compile time, value-type copy semantics | Runtime bounds enforcement adds overhead; compile-time checks catch most errors. |
| `nil` | Maps to `null`; `== nil` also matches `undefined` | Typed nil (distinct per type) | JS has no typed nil concept; JS interop values are often `undefined`. |
| `rune` / `byte` | Aliases of `int32` / `uint8`, all mapped to `number` | Aliases of `int32` / `uint8` | Type-level behaviour matches Go; at runtime every number is a float64. |
| `range` over string | Rune integers via `.codePointAt()` | Runes (UTF-8 code points) | Close match — values are code points, but indices are sequential rune positions (0, 1, 2, …), not byte offsets. |
| `len()` on strings | JS `.length` (UTF-16 code units) | Byte count (UTF-8) | Matching Go would require `TextEncoder` on every call. Use `utf8.RuneCountInString` for character counts. |
| `error` type | Interface `{ Error() string }` with `__error` runtime objects | Interface `{ Error() string }` | Close match. Custom error types, `errors.Is`/`Unwrap`, `%w` wrapping all work. `toString()` added for JS string context compat. |
| `errors.Is` | Walks the `Unwrap` chain comparing by identity **or by message** for `errors.New`/`fmt.Errorf` values (both backends) | Identity (or `Is` method) only | Two distinct `errors.New("x")` sentinels compare equal. Use distinct messages or a custom error type when identity matters. |
| `any == any` with numbers | `js` packages compare by JS value: `any(3) == any(3.0)` is `true`; `wasm` packages compare dynamic type first, so it is `false` | `false` (different dynamic types) | JS has a single `number` type. Compare after a type assertion in `both` packages to get identical results. |
| Struct field tags | Parsed and preserved for compile-time code generation (`encoding/json` honors `json:"..."` tags including `,omitempty`, `,string`, `-`, `-,`, and unexported field exclusion); general runtime reflection is not supported | Available via `reflect` | No reflection runtime; tags drive static compile-time code generation. |
| `encoding/json` | Implemented via static compile-time code generation without runtime reflection (`js` packages). Supports structs, maps, slices, primitives, pointers, `json.RawMessage`, `MarshalJSON` methods (pointer receivers only on addressable values, as in Go), and `UnmarshalJSON` methods. Not implemented: `Encoder`/`Decoder`, `Number`, and typed error values (`*json.SyntaxError`, `*json.UnmarshalTypeError`, …) — errors are plain `error`s with Go's messages. `int64` values beyond 2⁵³ lose precision on the JS side. Unsupported in `wasm` packages (reports compile diagnostic). | Standard library package with runtime reflection | Reflection-free compile-time specialization matches Go formatting and error messages. |
| `gofront/simd` | Experimental value-type 4-wide float SIMD (`simd.F32x4`). In WASM compiles to native `v128` instructions without GC allocation; in JS lowers to frozen 4-element arrays using `Math.fround` for 32-bit float parity. Cannot cross the JS↔WASM boundary yet, so exported struct fields and exported function parameters/results of type `F32x4` are rejected in `wasm`/`both` packages; `==` on `F32x4` and `fmt` formatting of `F32x4` are not supported in `wasm` packages. Completion is planned for v1.8.0. | Not in Go standard library | High-performance vector math targeting WebAssembly SIMD. |
| Pointers (`&x`, `*p`) | Struct pointers are the struct reference itself; address-taken scalar variables use a box struct (`$box_T`); pointers to struct fields (`&s.Field`) and slice/array elements (`&xs[i]`) use accessor refs (`$acc_T`) with getter/setter helpers under an abstract supertype `$ptr_T` in WASM, and accessor boxes in JS; slices and maps are references | True memory indirection | Shared mutation works for scalars, structs, fields, and slice/array elements across both JS and WASM/both packages. Pointers compare by identity: two `&s.X` taken separately compare equal (same target and field index), while boxes never equal accessor refs. Accessor refs cross the JS↔WASM boundary via copy-in/copy-out `{ value }` boxes with live getters and setters. |
| `x = x[lo:hi]` in `js` packages | Assigning a slice of `x` back to the same variable or field copies the elements when `x` is a plain JS array (not a typed array, and not itself a view made by an earlier slice expression) and the result stays within `len(x)`; the new `x` has `cap(x) == len(x)` and no longer shares with other slices of the old backing array. Every other slice expression shares the backing store, as in Go (`b[i:]`, `b[:n]`, `b[i:j:k]`, `x = x[:n]` beyond `len(x)`, typed-array slices) | Every slice expression shares the backing store | A shared view of part of a plain JS array is a `Proxy`, which is far slower to index; `x = x[:n]` usually drops the only reference to the old array, so the copy keeps hot loops fast. Assign to a new variable (`y := x[:n]`) when the sharing matters. |
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

