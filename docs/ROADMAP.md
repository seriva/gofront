# GoFront Roadmap

GoFront's guiding principle is **no runtime** — features that need a scheduler, runtime
type descriptors, or raw memory access are out of scope.

Each release has a subfolder in `docs/` containing design documents for the planned
features (e.g. `docs/v0.0.5/`).

---

## v0.0.5

**Theme: Major language features.** These are high-complexity items that touch multiple
compiler stages. Design documents are in [`docs/v0.0.5/`](v0.0.5/).

| Feature | Difficulty | Status | Notes |
|---|---|---|---|
| Generics (`[T any]`) | High | ✓ | Type erasure approach. See [design plan](v0.0.5/generics-plan.md). |
| Range over iterator functions | Medium | ✓ | `func(yield func(K, V) bool)` protocol. See [design plan](v0.0.5/range-iter-plan.md). |
| Complex number types | Medium | ✓ | `complex64`/`complex128`, `complex()`, `real()`, `imag()`. See [design plan](v0.0.5/complex-numbers-plan.md). |
| Richer error values | Medium | ✓ | Custom error types, `errors.Is`/`Unwrap`, `%w` wrapping. See [design plan](v0.0.5/error-values-plan.md). |
| Better array semantics | Medium | ✓ | Compile-time bounds checking, `[...]T` inference, `append` rejection. See [design plan](v0.0.5/array-semantics-plan.md). |
| Better pointer model | High | ✓ | Address-taken scalars boxed as `{ value: T }`. See [design plan](v0.0.5/pointer-model-plan.md). |
| Slice → array conversion `[N]T(slice)` | Low | ✓ | Go 1.20 feature. |
| `bytes` stdlib shim | Medium | ✓ | `Contains`, `Split`, `Join`, `Replace`, `ToUpper`/`ToLower`, etc. |
| Built-in minifier (replace terser) | Medium | ✓ | Three-stage minifier: comment stripping, token compression, identifier mangling. See [design plan](v0.0.5/minifier-plan.md). |

---

## v0.0.6

**Theme: Standard library depth.** The language spec gap is nearly closed. v0.0.6
fills the most commonly used stdlib packages and the last missing spec statement.
Design documents are in [`docs/v0.0.6/`](v0.0.6/).

| Feature | Difficulty | Status | Notes |
|---|---|---|---|
| `strings.Builder` / `bytes.Buffer` | Low | ✓ | Idiomatic string/byte building via plain JS object shim. See [design plan](v0.0.6/strings-builder-plan.md). |
| `regexp` package | Medium | ✓ | Pattern matching via JS `RegExp`. `MustCompile`, `FindString`, `ReplaceAllString`, inline flags, etc. See [design plan](v0.0.6/regexp-plan.md). |
| `slices` package (Go 1.21) | Low | ✓ | `Sort`, `Contains`, `Index`, `Reverse`, `Clone`, `Compact`, `Insert`, `Delete`, and more. See [design plan](v0.0.6/slices-maps-packages-plan.md). |
| `maps` package (Go 1.21) | Low | ✓ | `Keys`, `Values`, `Clone`, `Copy`, `Equal`, `DeleteFunc`, etc. See [design plan](v0.0.6/slices-maps-packages-plan.md). |
| `html` package | Low | ✓ | `html.EscapeString` / `html.UnescapeString` via inline `replace` chains. See [design plan](v0.0.6/html-plan.md). |

---

## v0.0.7

**Theme: gomponents-style DOM components.** Browser-native declarative component model
inspired by [gomponents](https://github.com/maragudk/gomponents). Design documents are
in [`docs/v0.0.7/`](v0.0.7/).

| Feature | Difficulty | Status | Notes |
|---|---|---|---|
| Methods on named non-struct types | Medium | ✓ | `type Group []Node` and `type NodeFunc func(...)` with methods. Codegen: ES6 class wrapping the underlying value. See [design plan](v0.0.7/named-type-methods-plan.md). |
| `gom` component library | Low | | Browser-native Node interface (`Mount(parent any)`), `El`, `Attr`, `Text`, `If`, `Map`, `Group`, `Mount`. Pure GoFront once named-type methods land. |
| `gom/html` element helpers | Low | ✓ | `Div`, `A`, `Span`, `H1`–`H6`, `Ul`/`Ol`/`Li`, `Form`, `Input`, `Button`, etc. as thin wrappers over `gom.El`/`gom.Attr`. See `example/gom/gom/elements.go`. |
| `gom` example app | Low | ✓ | Full-featured todo app using `gom`, with feature parity to simple and reactive examples. |
| `io` package shim (optional) | Low | ✓ | `io.Writer`, `io.EOF`, `io.Discard`, `io.WriteString`. Enables shared Go code that accepts `io.Writer` to compile in GoFront unchanged. |

See [design plan](v0.0.7/gomponents-plan.md) for full details.

---

## Out of scope

Goroutines, channels, `select`, `unsafe`, full `reflect`, `cgo`, exact integer overflow,
Go-equivalent map semantics. These all require either a runtime scheduler or memory model
that conflicts with the "no runtime" principle.

`goto` — no clean JS translation in the general case (cross-scope jumps require a
runtime scheduler equivalent). See README § What's not implemented for the full list.
