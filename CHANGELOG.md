# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Labeled `break` and `continue` statements — labels on `for` loops compile to native JS labeled statements, enabling `break Label` and `continue Label` across nested loops or from within a `switch` inside a `for`
- Rune / char literals (`'a'`, `'\n'`, `'\t'`, `'\\'`, `'\''`, `'\0'`) — tokenized by the lexer and emitted as integer char codes; fully usable in arithmetic and comparisons
- Variadic spread: `append(a, b...)` and `f(slice...)` now compile correctly to JS spread syntax (`...slice`)
- `recover()` built-in: `defer`/`panic`/`recover()` now work together — `defer` compiles to try/catch/finally, and `recover()` inside a deferred closure captures and clears the panic value, preventing it from propagating
- Bug fix: calling an anonymous function literal directly (`func(){}()`) now emits valid JS `(function(){})()`

## [0.0.1] - 2026-04-12

### Added
- Initial release of the GoFront compiler
- Go-inspired syntax compiling to JavaScript
- Structs, interfaces, methods, closures
- Multiple return values and named returns
- Variadic parameters
- `init()` functions with FIFO execution before `main`
- Short variable re-declaration (`:=` where at least one LHS name is new)
- Slices, maps, `make`, `append`, `len`, `cap`, `copy`
- `for` loops: C-style, `for range`, `while`-style, infinite
- `range` over strings
- `switch` / `case` / `fallthrough` / `default`
- `defer` with LIFO execution and try/finally semantics
- `error` type as plain strings; `error("msg")` / `.Error()`
- `async func` and `await` expressions
- Embedded structs: field access, composite-literal initialisation via embedded type key, and method promotion to the outer struct
- `fmt` package: `fmt.Sprintf`, `fmt.Printf`, `fmt.Println`, `fmt.Print`, `fmt.Errorf` with `%s`, `%d`, `%v`, `%f`, `%%` format verbs
- Type checking with interfaces, struct fields, and basic types
- Interface satisfaction checks return type as well as method presence
- Type checks: `break`/`continue` outside loop, `fallthrough` outside switch, reassigning a `const` are now compile errors
- External `.d.ts` type definitions (`js:` prefix)
- npm package type resolution via `@types/` and `package.json` `types` field
- Multi-file packages and cross-package imports
- Source maps via `--source-map` flag
- `--check` (type-check only), `--ast`, `--tokens` debug flags
- `--watch` mode with debounced recompilation
- `--minify` flag — minifies output with terser (`module: true, compress: true, mangle: true`)
- `gofront init [dir]` to scaffold a new project
- `--version` / `-v` flag
- `--help` output
- Source files use `.go` extension for automatic editor syntax highlighting
- 191 tests covering language features, type errors, edge cases, DOM (jsdom), external `.d.ts`, npm resolver, multi-file compilation, embedded structs, string formatting, and the example app
- CI via GitHub Actions (Node 25)
- Example todo app demonstrating structs, iota constants, named returns, closures, slices, maps, `for range`, `switch`, cross-package imports, `async`/`await`, localStorage persistence, and HTML5 drag-and-drop
