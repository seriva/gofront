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
| `gom` built-in namespace | Low | ✓ | Browser-native component built-in: `El`, `Text`, `Attr`, `Class`, `If`, `Map`, `Style`, `Mount`, `MountTo` plus all HTML element and attribute helpers. Registered in typechecker + codegen like `fmt`/`strings` — no source package, zero runtime overhead. |
| `gom` element helpers | Low | ✓ | `Div`, `A`, `Span`, `H1`–`H6`, `Ul`/`Ol`/`Li`, `Form`, `Input`, `Button`, etc. All built into the `gom` namespace — no `elements.go` source file needed. |
| `gom` example app | Low | ✓ | Full-featured todo app using `gom`, with feature parity to simple and reactive examples. |
| `io` package shim (optional) | Low | ✓ | `io.Writer`, `io.EOF`, `io.Discard`, `io.WriteString`. Enables shared Go code that accepts `io.Writer` to compile in GoFront unchanged. |

See [design plan](v0.0.7/gomponents-plan.md) for full details.

---

## v0.0.8

**Theme: stdlib completeness + E2E testing.** The language spec is effectively done.
v0.0.8 closes the remaining gaps in the standard library shims and adds end-to-end
browser tests covering all three example apps.
Design documents are in [`docs/v0.0.8/`](v0.0.8/).

| Feature | Difficulty | Status | Notes |
|---|---|---|---|
| `math/rand` package | Low | ✓ | `rand.Intn`, `rand.Float64`, `rand.Shuffle`, `rand.Perm`, `rand.Seed` (no-op). Wraps `Math.random()`. See [design plan](v0.0.8/math-rand-plan.md). |
| `math` additions | Low | ✓ | `Atan`, `Atan2`, `Asin`, `Acos`, `Exp`, `Exp2`, `Trunc`, `Hypot`, `Signbit`, `Copysign`, `Dim`, `Remainder`. See [design plan](v0.0.8/stdlib-gaps-plan.md). |
| `sort` additions | Low | ✓ | `sort.Search` (binary search), `sort.IntsAreSorted`, `sort.Float64sAreSorted`, `sort.StringsAreSorted`. See [design plan](v0.0.8/stdlib-gaps-plan.md). |
| `strings` additions | Low | ✓ | `Fields`, `Cut`, `CutPrefix`, `CutSuffix`, `SplitN`, `SplitAfter`, `SplitAfterN`, `IndexAny`, `LastIndexAny`, `ContainsAny`, `ContainsRune`, `IndexRune`, `IndexByte`, `LastIndexByte`, `Map`, `Title`, `ToTitle`, `TrimFunc`, `TrimLeftFunc`, `TrimRightFunc`, `IndexFunc`, `LastIndexFunc`, `NewReplacer`. See [design plan](v0.0.8/stdlib-gaps-plan.md). |
| `bytes` additions | Low | ✓ | `ReplaceAll`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `TrimFunc`, `IndexByte`, `LastIndex`, `LastIndexByte`, `Fields`, `Cut`, `ContainsAny`, `ContainsRune`, `Map`, `SplitN`. See [design plan](v0.0.8/stdlib-gaps-plan.md). |
| `strconv` additions | Low | ✓ | `strconv.Quote`, `strconv.Unquote`, `strconv.AppendInt`, `strconv.AppendFloat`. See [design plan](v0.0.8/stdlib-gaps-plan.md). |
| `unicode/utf8` package | Low | ✓ | `RuneCountInString`, `RuneLen`, `ValidString`, `ValidRune`, `DecodeRuneInString`, `DecodeLastRuneInString`, `FullRuneInString`, `RuneError`/`MaxRune`/`UTFMax` constants. See [design plan](v0.0.8/unicode-utf8-plan.md). |
| `path` package | Low | ✓ | `Join`, `Base`, `Dir`, `Ext`, `Clean`, `IsAbs`, `Split`, `Match`. Also registers `path/filepath` as an alias. See [design plan](v0.0.8/path-plan.md). |
| `time` additions | Medium | ✓ | `t.Format(layout)`, `time.Parse`, `t.Year/Month/Day/Hour/Minute/Second`, `t.Add/Sub/Before/After/Equal`, `time.Date`, `time.Unix`, RFC3339/DateOnly/DateTime constants. See [design plan](v0.0.8/time-format-plan.md). |
| `io.Reader` shim | Medium | ✓ | `strings.NewReader`, `bytes.NewReader`, `io.ReadAll`. Completes the `io` package alongside the v0.0.7 writer side. See [design plan](v0.0.8/io-reader-plan.md). |
| `fmt` scanning | Medium | ✓ | `fmt.Sscan`, `fmt.Sscanln`, `fmt.Sscanf`. Parses whitespace-separated tokens into pointer targets. See [design plan](v0.0.8/fmt-scanning-plan.md). |
| E2E tests (Playwright) | Medium | ✓ | Shared test suite covering all three example apps: CRUD, filtering, priority mode, persistence, drag-and-drop, sync status. See [design plan](v0.0.8/e2e-plan.md). |
| Source map `sourcesContent` | Low | ✓ | Embed original `.go` source in the source map so browser DevTools can show it and honour breakpoints without fetching source files. |
| Example app modernisation | Low | ✓ | `slices.DeleteFunc` replaces local `utils.Filter`; `utf8.RuneCountInString` replaces `len([]rune(...))` across all three apps. |
| GoFront lint in `npm run check` | Low | ✓ | `--check` pass for all three example apps added to `npm run check` and the husky pre-commit hook. |

---

## v0.0.9

**Theme: `.templ` file support.** Native `.templ` parsing brings the
[templ](https://templ.guide) authoring experience to GoFront. Components are written in
familiar templ syntax and compiled directly to DOM manipulation JavaScript, with the
`gom` built-in (promoted in v0.0.7) as the runtime target.
Design documents are in [`docs/v0.0.9/`](v0.0.9/).

| Feature | Difficulty | Status | Notes |
|---|---|---|---|
| `.templ` file support | High | ✓ | Native `.templ` parsing: `templ` declarations, HTML bodies, `{ expr }` interpolation, `@component()` calls, `{ children... }` slots, `if`/`else if`/`else`, `for`, `switch` control flow, `@templ.Raw()` for trusted HTML injection. Compiles directly to DOM manipulation JS. See [design plan](v0.0.9/templ-plan.md). |
| Column numbers in error messages | Low | — | Store `col` from lexer tokens on AST nodes; emit `file:line:col` and a caret indicator in both parse and type errors. See [design plan](v0.0.9/column-numbers-plan.md). |
| Incremental compilation in watch mode | Medium | — | Parse cache keyed by file mtime; skip re-parsing unchanged files on every save. Rebuild timing logged to console. See [design plan](v0.0.9/incremental-watch-plan.md). |

---

## Out of scope

Goroutines, channels, `select`, `unsafe`, full `reflect`, `cgo`, exact integer overflow,
Go-equivalent map semantics. These all require either a runtime scheduler or memory model
that conflicts with the "no runtime" principle.

`goto` — no clean JS translation in the general case (cross-scope jumps require a
runtime scheduler equivalent). See README § What's not implemented for the full list.
