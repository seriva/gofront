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

## Out of scope

Goroutines, channels, `select`, `unsafe`, full `reflect`, `cgo`, exact integer overflow,
Go-equivalent map semantics. These all require either a runtime scheduler or memory model
that conflicts with the "no runtime" principle.
