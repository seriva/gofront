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
| `.templ` files and `css` declarations | JSX-like component templates with scoped CSS, compiled to direct DOM calls. |
| `gom` built-in package | Declarative DOM node builders available without an import. |
| Browser globals (`document`, `console`, etc.) | Predeclared as `any` for practical DOM access. `WebGL2RenderingContext`, `WebGLRenderingContext`, `GPUDevice`, `GPUAdapter`, `GPUQueue`, `ArrayBuffer`, `DataView`, and TypedArrays have full static typings with method-level checking. |
| `.d.ts` type imports (`import "js:./types.d.ts"`) | Type-safe interop with JavaScript libraries. |
| npm package resolution | Import types from `node_modules/` and `@types/` automatically. |

### What's not implemented

| Feature | Reason | Prospect |
|---|---|---|
| `goto` | No clean JS translation. Rare in idiomatic Go. | Not planned. |
| Goroutines / channels / `select` | Go's concurrency model has no JS equivalent. A userland scheduler defeats the "no runtime" goal. | Out of scope. |
| `unsafe`, `reflect`, `cgo` | Require memory model or runtime type metadata that JS cannot provide. | Out of scope. |

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
| Integer precision | Safe up to 2⁵³ | Full width per type (`int64` = 64 bits) | JS `number` limitation. |
| `cap()` | Always equals `len()` | May exceed `len()` | JS arrays have no separate capacity. |
| Fixed-size arrays (`[n]T`) | Compile-time enforcement (bounds, `append` rejected, size matching); copied on assignment; plain JS arrays at runtime | Fixed at compile time, value-type copy semantics | Runtime bounds enforcement adds overhead; compile-time checks catch most errors. |
| `nil` | Maps to `null`; `== nil` also matches `undefined` | Typed nil (distinct per type) | JS has no typed nil concept; JS interop values are often `undefined`. |
| `rune` / `byte` | Aliases of `int32` / `uint8`, all mapped to `number` | Aliases of `int32` / `uint8` | Type-level behaviour matches Go; at runtime every number is a float64. |
| `range` over string | Rune integers via `.codePointAt()` | Runes (UTF-8 code points) | Close match — values are code points, but indices are sequential rune positions (0, 1, 2, …), not byte offsets. |
| `len()` on strings | JS `.length` (UTF-16 code units) | Byte count (UTF-8) | Matching Go would require `TextEncoder` on every call. Use `utf8.RuneCountInString` for character counts. |
| `error` type | Interface `{ Error() string }` with `__error` runtime objects | Interface `{ Error() string }` | Close match. Custom error types, `errors.Is`/`Unwrap`, `%w` wrapping all work. `toString()` added for JS string context compat. |
| `errors.Is` | Walks the `Unwrap` chain comparing by identity **or by message** for `errors.New`/`fmt.Errorf` values (both backends) | Identity (or `Is` method) only | Two distinct `errors.New("x")` sentinels compare equal. Use distinct messages or a custom error type when identity matters. |
| `any == any` with numbers | `js` packages compare by JS value: `any(3) == any(3.0)` is `true`; `wasm` packages compare dynamic type first, so it is `false` | `false` (different dynamic types) | JS has a single `number` type. Compare after a type assertion in `both` packages to get identical results. |
| Struct field tags | Parsed, silently discarded | Available via `reflect` | No reflection = no use for tag values. |
| Pointers (`&x`, `*p`) | Struct pointers are the object itself; address-taken scalars are boxed as `{ value: T }`; slices and maps are references | True memory indirection | Shared mutation works for scalars and structs. **`&s.Field` and `&xs[i]` compile to a detached copy** — writes through such a pointer do not reach the original. |
| Three-index slice (`a[lo:hi:max]`) | `max` is parsed but ignored | Sets result capacity | JS arrays have no capacity. |
| Exported / unexported | Enforced for GoFront packages; external `.d.ts`/npm namespaces are exempt | Access enforced uniformly | External JS APIs use lowercase names by convention. |

---

