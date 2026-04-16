# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Built-in `strings` package — `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `LastIndex`, `Count`, `Repeat`, `Replace`, `ReplaceAll`, `ToUpper`, `ToLower`, `TrimSpace`, `Trim`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `Split`, `Join`, `EqualFold`
- Built-in `strconv` package — `Itoa`, `Atoi`, `FormatBool`, `FormatInt`, `FormatFloat`, `ParseFloat`, `ParseInt`, `ParseBool` (multi-return with error for parse functions)
- Built-in `sort` package — `Ints`, `Float64s`, `Strings`, `Slice`, `SliceStable`, `SliceIsSorted`
- Built-in `math` package — `Abs`, `Floor`, `Ceil`, `Round`, `Sqrt`, `Cbrt`, `Pow`, `Log`, `Log2`, `Log10`, `Sin`, `Cos`, `Tan`, `Min`, `Max`, `Mod`, `Inf`, `IsNaN`, `IsInf`, `NaN` + constants `Pi`, `E`, `MaxFloat64`, `SmallestNonzeroFloat64`, `MaxInt`, `MinInt`
- Built-in `errors` package — `errors.New` (returns a plain string, consistent with GoFront's error model)
- Built-in `time` package (partial) — `time.Now` (→ `Date.now()`), `time.Since`, `time.Sleep` (async, ms conversion) + duration constants `Millisecond`, `Second`, `Minute`, `Hour`
- Expanded `fmt.Sprintf` format verbs — `%t` (bool), `%x`/`%X` (hex), `%o` (octal), `%b` (binary), `%q` (quoted string), `%e`/`%E` (scientific), `%g`/`%G` (general float), width specifiers (`%8d`), zero-padding (`%04d`), and precision (`%.2f`)
- Grouped `type (...)` declarations — multiple type definitions can be grouped in parentheses, matching Go syntax for `var (...)` and `const (...)`; works at top-level and inside function bodies
- Go Compatibility section in README — documents what matches Go, GoFront extensions, unimplemented features, and 16 semantic differences in one place
- Semantic difference tests — explicit tests encoding GoFront-specific behaviour for: `len()` on multi-byte strings, `range` over multi-byte strings (sequential indices vs byte offsets), `[n]T` as plain JS arrays, unchecked plain type assertions, comma-ok assertion semantics, and cross-package unexported symbol access
- ROADMAP.md updated against Go spec go1.26 — added 13 new rows to core language section, 5 to type system, 3 to builtins, and 3 new items to the implementation roadmap (range-over-func, complex types, grouped type declarations)
- Bit clear operator `&^` (AND NOT) — compiles to `& ~` in JavaScript
- Numeric literal separators (`1_000_000`, `0xFF_FF`) — underscores stripped at lex time
- Binary literals (`0b1010`, `0B1010`) and explicit octal literals (`0o777`, `0O777`)
- Hex float literals (`0x1.8p1`, `0xAp-2`) — evaluated at lex time to decimal values
- Three-index slice expressions (`s[lo:hi:max]`) — parsed and type-checked; `max` is ignored at runtime (JS has no slice capacity)
- `string(int)` conversion now produces the Unicode code point character (matching Go) — `string(65)` → `"A"` via `String.fromCodePoint`
- `fallthrough` inside type switch is now a compile error (matching Go spec)
- Unused local import detection — importing a cross-package dependency without using it is a type error (matching Go); `import _` side-effect imports are exempt
- Anonymous struct types — `struct { Name string; Age int }` can now be used as inline type expressions, composite literals, function return types, and variable declarations. Compiled to plain JS objects (no class emitted).
- Dot imports (`import . "pkg"`) — merges a package's exported symbols into the current scope so they can be used without a qualifier
- Untyped constants (Go spec §Constants) — constants declared without an explicit type (`const x = 5`) now carry an untyped type (`untyped int`, `untyped float64`, `untyped string`, `untyped bool`) that coerces to any compatible typed context. Literals also produce untyped types; variables and `:=` declarations materialize to the default type. Arithmetic between untyped constants stays untyped; mixing with typed values adopts the typed side. Iota constants are untyped.
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
- Node.js version requirement in README corrected from "25+" to "20+" (matching `package.json` `engines` field)
- `defer` inside nested control flow within `switch` cases (e.g. `defer` inside an `if`, `for`, or block inside a `case`) — the `_hasDefer` detection was only checking one level deep, so the try/finally wrapper was not emitted and `__defers` was undefined at runtime
- Unterminated block comments (`/* without */`) now throw a `LexError` with line/column context instead of being silently swallowed
- `genStmt` in codegen now throws on unhandled AST statement kinds instead of silently dropping them (matches `genExpr` behaviour)
- `isIntType()` in codegen now unwraps named types (`type MyInt = int`) so integer division correctly emits `Math.trunc()`
- Labeled `break`/`continue` now validate loop/switch depth — `continue MyLabel` outside a loop is now a compile error even when a label is present

### Changed
- Type assertions (`x.(T)`) now require the source expression to be an interface or `any` type — asserting from a concrete type is a compile error (matching Go)
- Plain type assertions (`x.(T)`) now panic at runtime on type mismatch (matching Go) — previously the value passed through unchecked
- Comma-ok type assertions (`v, ok := x.(T)`) now return the zero value of `T` on failure (matching Go) — previously the original value was returned
- Interface satisfaction checks now verify full method signatures — parameter types, parameter count, variadic flags, and all return types must match exactly (previously only method name and first return type were checked)
- Interface method declarations now preserve the variadic flag from the parser
- Source-map `buildSourceMap` uses a `Map` lookup instead of linear `.find()` scan — O(n) instead of O(n²)
- `isTypeKeyword()` / `isBuiltinKeyword()` in the parser now use module-level `Set`s instead of allocating arrays on every call
- Removed redundant `.includes()` check in `looksLikeType()` — the `T.IDENT` branch already covers type keyword values
- Simplified dead `if` guard in `_parsePrimary()` type-conversion path
- Removed unused `_label` parameter from watch-mode `buildOnce()`
- `defer` detection moved from codegen to type-checking phase — the typechecker now sets `body._hasDefer` on function body AST nodes during `checkFuncDecl`/`checkMethodDecl`/`FuncLit`, replacing the recursive `_hasDefer()` AST walk that ran on every function emit in codegen
- Map access with side-effecting key expressions (e.g. `m[getKey()]`) no longer double-evaluates the key — when the index contains a call expression, codegen now emits an IIFE `((__m, __k) => __m[__k] ?? zero)(m, getKey())` instead of the inline `(m[getKey()] ?? zero)` pattern; simple literal/variable keys still use the lean inline form
- `isIntType()` in codegen now recognises all sized integer types (`int8`–`int64`, `uint`–`uint64`, `uintptr`, `byte`, `rune`) via a `Set` lookup, not just `int` — ensures `Math.trunc` is emitted for integer division regardless of the declared type

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
