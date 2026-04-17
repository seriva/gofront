# GoFront Roadmap

GoFront's guiding principle is **no runtime** — features that need a scheduler, runtime
type descriptors, or raw memory access are out of scope.

Each release has a subfolder in `docs/` containing design documents for the planned
features (e.g. `docs/v0.0.5/`).

---

## v0.0.5

**Theme: Major language features.** These are high-complexity items that touch multiple
compiler stages. Design documents are in [`docs/v0.0.5/`](v0.0.5/).

| Feature | Difficulty | Notes |
|---|---|---|
| Generics (`[T any]`) | High | Biggest modern Go feature gap. Touches every compiler stage. See [design plan](v0.0.5/generics-plan.md). |
| Range over iterator functions | Medium | Go 1.23 `func(yield func(K, V) bool)` protocol. See [design plan](v0.0.5/range-iter-plan.md). |
| Complex number types | Medium | New type kind + builtins (`complex`, `real`, `imag`). See [design plan](v0.0.5/complex-numbers-plan.md). |
| Richer error values | Medium | Move `error` from plain string to an interface-like value. See [design plan](v0.0.5/error-values-plan.md). |
| Better array semantics | Medium | Arrays currently indistinguishable from slices at runtime. See [design plan](v0.0.5/array-semantics-plan.md). |
| Better pointer model | High | Current `{ value: T }` boxing is useful but shallow. See [design plan](v0.0.5/pointer-model-plan.md). |
| Slice → array conversion `[N]T(slice)` | Low | Go 1.20 feature; depends on array semantics work. |
| `bytes` stdlib shim | Medium | Parallel to `strings` shim but for `[]byte`. |
| Built-in minifier (replace terser) | Medium | Purpose-built for GoFront output. Removes the only external dependency. See [design plan](v0.0.5/minifier-plan.md). |

---

## v0.0.6

**Theme: Standard library depth.** The language spec gap is nearly closed. v0.0.6
fills the most commonly used stdlib packages and the last missing spec statement.
Design documents are in [`docs/v0.0.6/`](v0.0.6/).

| Feature | Difficulty | Notes |
|---|---|---|
| `strings.Builder` / `bytes.Buffer` | Low | Idiomatic string/byte building. Maps cleanly to a plain JS object shim. See [design plan](v0.0.6/strings-builder-plan.md). |
| `regexp` package | Medium | Pattern matching via JS `RegExp`. `MustCompile`, `FindString`, `ReplaceAllString`, etc. See [design plan](v0.0.6/regexp-plan.md). |
| `slices` package (Go 1.21) | Low | `Sort`, `Contains`, `Index`, `Reverse`, `Clone`, `Compact`, `Insert`, `Delete`, etc. Maps to JS array methods. See [design plan](v0.0.6/slices-maps-packages-plan.md). |
| `maps` package (Go 1.21) | Low | `Keys`, `Values`, `Clone`, `Copy`, `Equal`. Maps to `Object.*` methods. See [design plan](v0.0.6/slices-maps-packages-plan.md). |
| `goto` statement | Medium | Last unimplemented spec statement. Forward → labeled block + break; backward → labeled while loop. See [design plan](v0.0.6/goto-plan.md). |
| `html` package | Low | `html.EscapeString` / `html.UnescapeString`. Replaces hand-rolled `esc()` helpers like the one in the example apps. |

---

## Out of scope

Goroutines, channels, `select`, `unsafe`, full `reflect`, `cgo`, exact integer overflow,
Go-equivalent map semantics. These all require either a runtime scheduler or memory model
that conflicts with the "no runtime" principle.
