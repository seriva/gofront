# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Unused variable detection — local variables declared with `:=` or `var` that are never referenced are now type errors (matching Go semantics). Function parameters, constants, and `_` are exempt.
- `go`, `chan`, `select` are now recognized keywords — using goroutines, channels, or select produces clear parse errors (e.g. "goroutines are not supported in GoFront") instead of confusing "Undefined" messages
- Split `parser.js` (1,237 lines) into `parser/types.js`, `parser/statements.js`, and `parser/expressions.js` sub-modules using the mixin pattern
- Split `typechecker.js` (1,346 lines) into `typechecker/types.js`, `typechecker/statements.js`, and `typechecker/expressions.js` sub-modules
- Split `codegen.js` (1,348 lines) into `codegen/source-map.js`, `codegen/statements.js`, and `codegen/expressions.js` sub-modules
- Edge-case tests for map iteration order semantics (insertion order preserved after delete+re-add, non-alphabetical key insertion order)
- Edge-case tests for integer overflow / float64 semantics (no 32-bit wrapping, precision loss at 2^53, integer division truncation, float64 division by zero)
- Tests verifying `defer` in closures does not leak try/finally to parent function, and functions without `defer` produce no try/finally wrapper
- Two example apps: `example/simple/` (vanilla DOM, zero dependencies) and `example/reactive/` (signals-based using [reactive.js](https://github.com/seriva/microtastic) with `.d.ts` type imports). Both implement the same todo app to showcase different aspects of GoFront.

### Fixed
- `defer` inside nested control flow within `switch` cases (e.g. `defer` inside an `if`, `for`, or block inside a `case`) — the `_hasDefer` detection was only checking one level deep, so the try/finally wrapper was not emitted and `__defers` was undefined at runtime
- Unterminated block comments (`/* without */`) now throw a `LexError` with line/column context instead of being silently swallowed
- `genStmt` in codegen now throws on unhandled AST statement kinds instead of silently dropping them (matches `genExpr` behaviour)
- `isIntType()` in codegen now unwraps named types (`type MyInt = int`) so integer division correctly emits `Math.trunc()`
- Labeled `break`/`continue` now validate loop/switch depth — `continue MyLabel` outside a loop is now a compile error even when a label is present

### Changed
- Source-map `buildSourceMap` uses a `Map` lookup instead of linear `.find()` scan — O(n) instead of O(n²)
- `isTypeKeyword()` / `isBuiltinKeyword()` in the parser now use module-level `Set`s instead of allocating arrays on every call
- Removed redundant `.includes()` check in `looksLikeType()` — the `T.IDENT` branch already covers type keyword values
- Simplified dead `if` guard in `_parsePrimary()` type-conversion path
- Removed unused `_label` parameter from watch-mode `buildOnce()`
- `defer` detection moved from codegen to type-checking phase — the typechecker now sets `body._hasDefer` on function body AST nodes during `checkFuncDecl`/`checkMethodDecl`/`FuncLit`, replacing the recursive `_hasDefer()` AST walk that ran on every function emit in codegen

## [0.0.2] - 2026-04-14

### Added
- Test suite split into focused files (`language.test.js`, `types.test.js`,
  `structs.test.js`, `builtins.test.js`, `compiler.test.js`, `dom.test.js`,
  `lexer-parser.test.js`) with shared helpers in `test/helpers.js`; `test/run.js`
  is now a thin orchestrator. Each file can be run standalone with
  `node test/<file>.test.js`.
- Expanded CLI coverage tests: `--watch` mode (initial build, error path, `-o`
  output), `init` failure paths (mkdir/write errors), single-file unreadable input,
  output file write failure, npm import resolution, and local package bundling.
- Labeled `break` and `continue` statements — labels on `for` loops compile to native JS labeled statements, enabling `break Label` and `continue Label` across nested loops or from within a `switch` inside a `for`
- Rune / char literals (`'a'`, `'\n'`, `'\t'`, `'\\'`, `'\''`, `'\0'`) — tokenized by the lexer and emitted as integer char codes; fully usable in arithmetic and comparisons
- Variadic spread: `append(a, b...)` and `f(slice...)` now compile correctly to JS spread syntax (`...slice`)
- Import aliases (`import m "./pkg"`) — the alias is used as the namespace name for type checking and the bundled package qualifier, so `m.Func()` works identically to the inferred name
- `recover()` built-in: `defer`/`panic`/`recover()` now work together — `defer` compiles to try/catch/finally, and `recover()` inside a deferred closure captures and clears the panic value, preventing it from propagating
- Bug fix: calling an anonymous function literal directly (`func(){}()`) now emits valid JS `(function(){})()`
- Sized integer types (`uint`, `int8`, `int16`, `int32`, `int64`, `uint8`, `uint16`, `uint32`, `uint64`, `uintptr`, `float32`) — accepted as type annotations and mapped to `int` / `float64` at runtime
- Struct field tags (`` `json:"name"` ``) — parsed and silently ignored; no reflection, but code using standard Go tags now compiles without errors
- Bitwise compound assignments (`&=`, `|=`, `^=`, `<<=`, `>>=`) — lexer, parser, and codegen extended to match the existing arithmetic compound assignments
- Type switch (`switch x.(type)` and `switch v := x.(type)`) — compiles to an `if/else if` chain using `typeof`, `instanceof`, and `=== null` checks; supports `int`, `float64`, `string`, `bool`, `nil`, `error`, all sized integer aliases, and struct types
- `[]byte(s)` conversion — produces a plain JS array of UTF-8 byte values via `Array.from(new TextEncoder().encode(s))`
- `[]rune(s)` conversion — produces a plain JS array of Unicode code points via `Array.from(s, c => c.codePointAt(0))`
- Interface embedding — `type ReadWriter interface { Reader; Writer }` flattens embedded interface methods into the parent interface for satisfaction checks; diamond embedding is deduped; embedding non-interface types is a compile error
- `[...]T{...}` array length inference — the parser accepts `[...]` in array type position and the type checker infers the length from the composite literal
- Side-effect imports (`import _ "pkg"`) — the dependency is compiled and bundled but the package namespace is not exposed to the importer
- `min()` / `max()` builtins — compile to `Math.min` / `Math.max`
- `clear()` builtin — zeroes slice length (`.length = 0`) or deletes all map keys
- `range` over integer (`for i := range n`, `for range n`) — Go 1.22 integer range; compiles to a C-style `for` loop
- Type aliases (`type A = B`) — transparent alias in the type checker; the alias and original type are freely interchangeable without conversion

### Fixed
- `new(T)` for basic types (`new(int)`, `new(string)`, `new(bool)`, `new(float64)`) — the type-checker was incorrectly evaluating the type-name argument as a value expression, producing a false "Undefined" error; the argument is now treated as a type node
- Array type notation in error messages — `[3]int` was displayed as `[object Object]int`; the size AST node is now converted to a number when building the type object
- `[]int(slice)` generic slice conversion — when converting a non-string slice (e.g. `[]int(src)`) the codegen was applying the `.codePointAt(0)` string-rune path to all `[]int` conversions; it now only applies that path when the source expression is a `string`
- `LexError` messages now include the source line context for all error sites (unterminated strings, empty rune literals, multi-character rune literals, unknown rune escapes)

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
- 422 tests covering language features, type errors, edge cases, DOM (jsdom), external `.d.ts`, npm resolver, multi-file compilation, embedded structs, string formatting, and the example app
- CI via GitHub Actions (Node 25)
- Example todo app demonstrating structs, iota constants, named returns, closures, slices, maps, `for range`, `switch`, cross-package imports, `async`/`await`, localStorage persistence, and HTML5 drag-and-drop
