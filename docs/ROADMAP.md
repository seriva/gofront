# GoFront Roadmap

GoFront's guiding principle is **no runtime** — features that need a scheduler, runtime
type descriptors, or raw memory access are out of scope.

Each release has a subfolder in `docs/` containing design documents for the planned
features (e.g. `docs/v0.0.5/`).

---

## v0.0.5

**Theme: Major language features.** These are high-complexity items that touch multiple
compiler stages. Design documents are in [`docs/v0.0.5/`](v0.0.5/).

| Feature | Difficulty | Status |
|---|---|---|
| Generics (`[T any]`) | High | ✓ |
| Range over iterator functions | Medium | ✓ |
| Complex number types | Medium | ✓ |
| Richer error values | Medium | ✓ |
| Better array semantics | Medium | ✓ |
| Better pointer model | High | ✓ |
| Slice → array conversion `[N]T(slice)` | Low | ✓ |
| `bytes` stdlib shim | Medium | ✓ |
| Built-in minifier (replace terser) | Medium | ✓ |

---

## v0.0.6

**Theme: Standard library depth.** The language spec gap is nearly closed. v0.0.6
fills the most commonly used stdlib packages and the last missing spec statement.
Design documents are in [`docs/v0.0.6/`](v0.0.6/).

| Feature | Difficulty | Notes |
|---|---|---|
| `strings.Builder` / `bytes.Buffer` | Low | ✓ Idiomatic string/byte building. Maps cleanly to a plain JS object shim. See [design plan](v0.0.6/strings-builder-plan.md). |
| `regexp` package | Medium | Pattern matching via JS `RegExp`. `MustCompile`, `FindString`, `ReplaceAllString`, etc. See [design plan](v0.0.6/regexp-plan.md). |
| `slices` package (Go 1.21) | Low | `Sort`, `Contains`, `Index`, `Reverse`, `Clone`, `Compact`, `Insert`, `Delete`, etc. Maps to JS array methods. See [design plan](v0.0.6/slices-maps-packages-plan.md). |
| `maps` package (Go 1.21) | Low | `Keys`, `Values`, `Clone`, `Copy`, `Equal`. Maps to `Object.*` methods. See [design plan](v0.0.6/slices-maps-packages-plan.md). |
| `goto` statement | Medium | Last unimplemented spec statement. Forward → labeled block + break; backward → labeled while loop. See [design plan](v0.0.6/goto-plan.md). |
| `html` package | Low | `html.EscapeString` / `html.UnescapeString`. Replaces hand-rolled `esc()` helpers like the one in the example apps. |

---

## v0.0.7

**Theme: gomponents-style DOM components.** Browser-native declarative component model
inspired by [gomponents](https://github.com/maragudk/gomponents). Design documents are
in [`docs/v0.0.7/`](v0.0.7/).

| Feature | Difficulty | Notes |
|---|---|---|
| Methods on named non-struct types | Medium | `type Group []Node` and `type NodeFunc func(...)` with methods. Core compiler blocker for everything else. Codegen: ES6 class wrapping the underlying value. |
| `gom` component library | Low | Browser-native Node interface (`Mount(parent any)`), `El`, `Attr`, `Text`, `If`, `Map`, `Group`, `Mount`. Pure GoFront once named-type methods land. |
| `gom/html` element helpers | Low | `Div`, `A`, `Span`, `Class`, `ID`, `Href`, etc. as thin wrappers over `gom.El`/`gom.Attr`. |
| `gom` example app | Low | Rewrite the simple todo app using `gom` to validate the library. |
| `io` package shim (optional) | Low | `io.Writer` interface + `io.WriteString`. Enables code that compiles both server-side (standard Go) and browser-side (GoFront) unchanged. |

See [design plan](v0.0.7/gomponents-plan.md) for full details.

---

## Out of scope

Goroutines, channels, `select`, `unsafe`, full `reflect`, `cgo`, exact integer overflow,
Go-equivalent map semantics. These all require either a runtime scheduler or memory model
that conflicts with the "no runtime" principle.
