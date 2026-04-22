# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **E2E tests (Playwright)** — 74 end-to-end tests covering all three example apps
  (Simple, Reactive, Gom). Shared suite tests CRUD, filtering, priority mode,
  persistence (reload), drag-and-drop, and sync status. Per-app suites verify
  app-specific behaviour: scoped styles, stats bar, loading placeholder, `gom.If`
  conditional rendering. Infrastructure: `playwright.config.js` at root,
  `test/e2e/` with `global-setup.js` (builds all apps), `selectors.js`, `helpers.js`,
  and four spec files. New npm scripts: `test:e2e`, `test:e2e:ui`,
  `test:e2e:simple`, `test:e2e:reactive`, `test:e2e:gom`.

## [0.0.7] - 2026-04-22

### Added
- **Methods on named non-struct types** — methods can now be declared on any named type,
  not just structs. Named func and slice types with methods are emitted as ES6 wrapper
  classes (`class T { constructor(_fn) {...} }` / `class T { constructor(_items) {...} }`).
  - `type NodeFunc func(parent any)` with `func (n NodeFunc) Mount(parent any)` works
  - `type Group []Node` with `func (g Group) Mount(parent any)` works
  - Named non-struct types satisfy interfaces via their method sets
  - Composite literals: `Group{a, b}` → `new Group([a, b])`
  - Type conversions: `NodeFunc(fn)` → `new NodeFunc(fn)`
  - `append` on a named slice type returns the same named type (re-wraps the result)
  - `len`, `range`, and index access on named slice type variables correctly unwrap
  - Inside method bodies the receiver is automatically unwrapped to the underlying value
- **`gom` built-in namespace** — `gom` is now a first-class built-in namespace (like
  `fmt` or `strings`) registered in the typechecker and emitted inline by codegen. No
  source package to vendor — `import "gom"` is not needed; `gom.*` calls are available
  globally in any GoFront file. Every call compiles to an inline DOM object literal with
  a `Mount(parent)` method; zero runtime overhead. Provides: `El`, `Text`, `Attr`,
  `Class`, `Type`, `Href`, `Src`, `Placeholder`, `DataAttr`, `If`, `Map`, `Style`,
  `Mount`, `MountTo`. All HTML element helpers (`Div`, `Span`, `Button`, `Input`, `Li`,
  `Ul`, `Header`, `Footer`, `H1`–`H6`, `A`, `Strong`, `P`, `Form`, `Table`, `Tr`, `Th`,
  `Td`, and 30+ more) and attribute shorthands (`Class`, `For`, `Name`, `Value`,
  `Target`, `Draggable`, `AriaLabel`, `StyleAttr`, `Checked`, `Disabled`, `Selected`,
  `Readonly`, etc.) are all built in. Types `gom.Node`, `gom.NodeFunc`, and `gom.Group`
  are registered and usable in type annotations. The `example/gom/gom/` source directory
  is removed — the example app imports nothing and uses `gom.*` directly.
- **`gom` todo example** — `example/gom/` is a fully featured todo app with full parity
  to the simple and reactive examples: priority mode, input validation, localStorage
  persistence, sync-status indicator, urgent badge, filter bar, clear-completed,
  drag-and-drop reordering, and dark theme. All rendering uses pure gom nodes
  (`gom.El`, `gom.Map`, `gom.If`) — no `innerHTML`. Build with `npm run build:gom`.
- **`io` package shim** — `io.Writer` (accepted as a parameter/field type), `io.EOF`
  (sentinel error string), `io.Discard`, and `io.WriteString(w, s)`. `WriteString`
  dispatches to `strings.Builder`, `bytes.Buffer`, or any writer with a `WriteString`
  method, auto-dereferencing GoFront pointer wrappers. Enables shared Go code that
  accepts `io.Writer` to compile in GoFront unchanged.
- **Drag-and-drop: insert-before/after by cursor position** — all three examples now
  detect which half of the drop target the cursor is in. Hovering the top half shows a
  top accent border and inserts before; hovering the bottom half shows a bottom accent
  border and inserts after. Items can now be placed at any position including the very
  top and very bottom of the list.
- **Qualified type names in imports** — cross-package type annotations like `gom.Node`
  in function signatures now resolve correctly. `addPackageNamespace` registers exported
  types under both the simple name and the `pkg.TypeName` qualified form.

### Changed
- **`typechecker.js` split** — the built-in namespace and browser-global registration
  (`_setupGlobals`, ~800 lines) has been extracted into a new
  `src/typechecker/stdlib.js` sub-module, exported as `setupGlobals(globals, types)`.
  `typechecker.js` now delegates to it in a one-liner. No behaviour change; purely a
  code-organisation improvement. `src/typechecker.js` drops from ~2033 to ~1272 lines.
- **Reactive example** — overhauled to cover the full reactive.js API surface.
  The app shell is now a `Reactive.Component` using the complete lifecycle (`state`,
  `template`, `styles`, `mount`, `mountTo`, `refs`), eliminating all `querySelector`
  and `getElementById` calls from application code. New features demonstrated:
  `html` tagged template (via `htmlTag` wrapper), `data-html`, `data-visible`,
  `data-attr-*`, `data-bool-*`, `data-ref`, `Component.state()` auto-computed
  conversion, `Component.mount()` post-render hook, and `comp.refs.*` element access.
  The `ScanScope` struct and `setupScanBindings` function are removed — the Component
  itself is the scan scope. Inline validation errors use `data-if` (DOM removal);
  a priority hint uses `data-visible` (display toggle); the input placeholder and
  disabled state are driven reactively via `data-attr-placeholder` and
  `data-bool-disabled`.


## [0.0.6] - 2026-04-20

### Added
- **`html` package** — `EscapeString` and `UnescapeString`, compiling to inline `replace` chains. The hand-rolled `esc()` helpers in the example apps have been replaced with `html.EscapeString`.
- **`maps` package (Go 1.21)** — `Keys`, `Values`, `Clone`, `Copy`, `Equal`, `EqualFunc`, `Delete`, `DeleteFunc`. All map to inline `Object.*` calls. Also fixed `len()` on `any`-typed map values — `__len` now falls back to `Object.keys().length` for plain objects.
- **`slices` package (Go 1.21)** — `Contains`, `Index`, `Equal`, `Compare`, `Sort`, `SortFunc`, `SortStableFunc`, `IsSorted`, `IsSortedFunc`, `Reverse`, `Max`, `Min`, `MaxFunc`, `MinFunc`, `Clone`, `Compact`, `CompactFunc`, `Concat`, `Delete`, `DeleteFunc`, `Insert`, `Replace`, `Grow`, `Clip`. All map to inline JS array methods with no runtime overhead.
- **`regexp` package** — pattern matching via JS `RegExp`. Package-level: `MustCompile`, `Compile` (returns `(*Regexp, error)`), `MatchString`, `QuoteMeta`. Instance methods on `*Regexp`: `MatchString`, `FindString`, `FindStringIndex`, `FindAllString` (with `n` limit), `FindStringSubmatch`, `FindAllStringSubmatch`, `ReplaceAllString`, `ReplaceAllLiteralString`, `Split`, `String`. The global flag is automatically added for `matchAll`-based methods. Inline flags (`(?i)`, `(?m)`, `(?s)`) in the pattern string are extracted into the JS `RegExp` constructor's flags argument automatically.
- **`strings.Builder` and `bytes.Buffer`** — idiomatic string/byte building types. `strings.Builder` supports `WriteString`, `WriteByte`, `WriteRune`, `Write`, `String`, `Len`, `Reset`, and `Grow`; `bytes.Buffer` supports `WriteString`, `WriteByte`, `Write`, `String`, `Bytes`, `Len`, and `Reset`. Both compile to lightweight inline JS (no class generation). `fmt.Fprintf`, `fmt.Fprintln`, and `fmt.Fprint` are also now supported, accepting any writer (including `*strings.Builder` and `*bytes.Buffer`).
- **Dev server with live reload (`--serve`)** — new flag that starts a static file server
  and automatically reloads the browser after each successful recompile. Implies `--watch`.
  Serves files from the directory of the output file (`-o` is required). Default port is
  3000; use `--port <n>` to override. A small SSE-based reload client is injected into the
  compiled output — no extra dependencies, uses Node's built-in `http` module only.
  Can be combined with `--source-map`; the source map comment is always kept as the last
  line of the output.

### Fixed
- **`--source-map` now works for directory builds** — previously the flag was silently
  ignored when compiling a directory with `-o`; the inline source map is now correctly
  appended to the output file.
- **Per-file source maps for multi-file packages** — the `sources` array in the generated
  source map now lists each `.go` file individually (e.g. `src/main.go`, `src/store.go`)
  with paths relative to the output file, instead of a single directory entry. DevTools
  will show each source file separately and map breakpoints correctly.
- **Duplicate runtime helper declarations** — when a sub-package and its importer both
  used the same helper (e.g. `__append`), the bundled output contained two `function`
  declarations with the same name, which is a `SyntaxError` in ES module context. Helpers
  are now emitted as `var __name = __name || function(...) { ... };`, which is safe to
  appear multiple times.

## [0.0.5] - 2026-04-17

### Added
- **Generics (type parameters)** — Go-style generic functions and types:
  - Generic function declarations: `func Map[T any, U any](items []T, f func(T) U) []U`
  - Generic struct declarations: `type Box[T any] struct { Value T }`
  - Type inference: `Map(nums, fn)` infers T and U from argument types
  - Explicit type arguments: `Identity[int](42)`, `Box[string]{Value: "hi"}`
  - Constraints: `any`, `comparable`, named interfaces, union constraints (`~int | ~string`)
  - Methods on generic types: `func (s *Stack[T]) Push(v T)`
  - Generic functions as values: `Apply(Identity[int], 99)`
  - Type erasure to JavaScript — no runtime overhead, all complexity in the front-end
  - New `TILDE` token in lexer for `~` operator in union constraints
- **Better pointer model** — `&x` and `*p` now produce real pointer semantics instead
  of being no-ops:
  - `&x` on scalar locals (int, float64, string, bool) boxes the variable as `{ value: x }`
    and returns the box reference. All reads/writes to the variable go through `.value`.
  - `*p` dereferences a pointer by emitting `p.value`
  - Shared mutation through pointers works correctly: multiple pointers to the same
    variable see each other's changes
  - `swap(&x, &y)` pattern works as expected
  - Pointer comparison (`==`, `!=`) uses reference equality on box objects
  - `var p *int` initializes to `null`; `p == nil` compiles to `p === null`
  - `new(T)` continues to produce `{ value: zeroOf(T) }` as before
  - Structs, slices, and maps are reference types and skip boxing when `&` is applied
  - Closures capturing address-taken variables work correctly (JS captures the box object)
  - Type error for dereferencing non-pointer types: `*x` where `x` is not a pointer
  - `isPointer()` predicate added to type system utilities
- **Richer error values** — `error` is now an interface type `{ Error() string }` instead
  of a basic type (plain string). This is a **breaking change** at runtime:
  - `error("msg")`, `errors.New("msg")`, and `fmt.Errorf(...)` now return `__error` objects
    with `.Error()` and `.toString()` methods (tree-shaken runtime helper)
  - Custom error types: any struct with `Error() string` method satisfies the `error` interface
  - Type assertions on error values (`err.(MyError)`, comma-ok form) work naturally
  - `errors.Is(err, target)` — walks the error chain comparing by identity or `_msg`
  - `errors.Unwrap(err)` — returns the wrapped cause error or `nil`
  - `fmt.Errorf("...: %w", err)` — wraps errors with a cause chain; `%w` verb supported
    in `__sprintf` helper
  - Sentinel errors: package-level `var ErrX = errors.New("...")` work with `errors.Is`
  - `toString()` on error objects provides backward compatibility for `console.log(err)`
    and string interpolation contexts
  - **Migration**: `err === "msg"` string comparisons no longer work — use `err.Error() === "msg"`
    or `errors.Is(err, sentinel)` instead
- **Slice → array conversion** — `[N]T(slice)` converts a slice to a fixed-size array
  (Go 1.20 feature). Emits `.slice(0, N)` in JS. Array → slice `[]T(arr)` also supported.
- **Complex number types** — full support for `complex64`, `complex128`, and untyped complex constants:
  - Imaginary literals (`3i`, `1.5i`, `0i`) as `IMAG` tokens with semicolon insertion
  - `complex(r, i)`, `real(z)`, `imag(z)` builtins with correct type inference
  - Complex arithmetic (`+`, `-`, `*`, `/`) with tree-shaken `__cmul`/`__cdiv` helpers
  - Complex comparison (`==`, `!=` only; ordering operators rejected)
  - Numeric-to-complex promotion in mixed expressions (`3 * z`)
  - Type conversions: `complex128(x)`, `complex64(x)` from numeric types
  - `float64(complexVal)` rejected with "use real() or imag()" guidance
  - Compound assignment (`+=`, `-=`, `*=`, `/=`) on complex variables
  - `fmt.Sprintf("%v", z)` formats complex as `(a+bi)`
  - Zero value `{ re: 0, im: 0 }` for complex types
  - Unary `-`/`+` on complex values
  - Runtime representation: `{ re: number, im: number }` objects
- **Built-in minifier** (`src/minifier.js`) — replaces the `terser` dependency with a
  purpose-built minifier that understands GoFront's output:
  - Stage 1: comment and whitespace stripping
  - Stage 2: token-level compression (preserves strings, templates, regexes)
  - Stage 3: identifier mangling (opt-in via `--mangle` flag)
  - Stage 4: constant numeric literal folding
  - `--source-map` and `--minify` combined now emit a clear error
- **Better array semantics** — compile-time enforcement for fixed-size arrays:
  - `[...]T` size inference from composite literal element count
  - Reject `append()` on array types (type error)
  - Compile-time bounds checking for constant array indices
  - Composite literal element count validation against declared array size
  - Array assignment size matching (`[3]int` ≠ `[4]int`, `[]int` ≠ `[3]int`)
  - Compile-time `len()` for fixed arrays emits constant instead of `__len()`
  - Slicing arrays produces slice types (`arr[1:3]` on `[5]int` → `[]int`)
- **Range over iterator functions** (Go 1.23) — `func(yield func(V) bool)` and
  `func(yield func(K, V) bool)` iterator protocols:
  - `for v := range iterFunc` and `for k, v := range iterFunc` syntax
  - `break`, `continue`, and `return` inside iterator loops propagate correctly via
    yield return value
  - Iterator functions can be stored in variables or returned from other functions
  - Works with all existing `for range` features (labels, blank identifiers)
- **`bytes` stdlib shim** — `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `Join`,
  `Split`, `Replace`, `ToUpper`, `ToLower`, `TrimSpace`, `Equal`, `Count`, `Repeat` —
  parallel to the `strings` shim but operating on `[]byte` slices

### Changed
- **`terser` removed** — replaced by the built-in minifier; `terser` is no longer a
  devDependency. The `--minify` flag now uses `src/minifier.js` directly.

## [0.0.4] - 2026-04-17

### Added
- **Method expressions** (`T.Method`) — `TypeName.MethodName` now produces a first-class function whose first argument is the receiver, e.g. `f := Point.Dist; f(p)` (Go spec §Method expressions)
- **Method values** (`.bind()`) — `p.Dist` stored in a variable now binds the receiver via `.bind(p)`, so calling the stored function later behaves correctly (Go spec §Method values)
- **Struct and array equality** — `==` and `!=` on struct and array types now perform deep value comparison via a tree-shaken `__equal` helper; comparing two non-nil slices or maps is now a type error (Go spec §Comparison operators)
- **Terminating statement analysis** — non-void functions that lack a return on some path now produce a `missing return` compile error (Go spec §Terminating statements). Handles `if/else`, `switch` with `default`, `TypeSwitchStmt`, and `panic()` calls.
- **Const expression repetition** — in a `const (...)` block, omitting the expression on subsequent specs now correctly repeats the previous expression with the updated `iota` value, e.g. `Read = 1 << iota; Write; Exec` gives 1, 2, 4 (Go spec §Constant declarations §Iota)
- **Exported/unexported identifier enforcement** — accessing a lowercase-named symbol from a GoFront package via `pkg.name` is now a type error (`cannot refer to unexported name`). External `.d.ts` / npm namespaces are exempt. (Go spec §Exported identifiers)
- **String indexing returns byte** — `s[i]` on a string now compiles to `s.charCodeAt(i)`, returning an integer byte value instead of a JS character (Go spec §Index expressions)
- **`unicode` package** — `IsLetter`, `IsDigit`, `IsSpace`, `IsUpper`, `IsLower`, `IsPunct`, `IsControl`, `IsPrint`, `IsGraphic`, `ToUpper`, `ToLower` — implemented using Unicode-aware JS regex and `codePointAt`/`fromCodePoint`
- **`os` package** (partial) — `Exit` (→ `process.exit`), `Args` (→ `process.argv`), `Getenv` (→ `process.env[...]`)
- **Multi-value function forwarding** — `f(g())` where `g()` returns multiple values is now valid and compiles to `f(...g())` (Go spec §Calls)

### Fixed
- **Blank identifier `_ = expr`** in regular `=` assignments — `_ = someFunc()` and `x, _ = f()` no longer produce `Undefined: '_'` errors
- **Positional (unkeyed) struct literals** — `Point{1, 2}` now correctly generates `new Point({ X: 1, Y: 2 })` instead of an empty struct; also works inside slices (`[]Point{{1, 2}, {3, 4}}`)
- **`interface{}` assignability** — assigning any concrete value to an `interface{}`-typed variable or parameter is now accepted (previously only the `any` alias worked)
- **Comma-ok with `=`** — `v, ok = m["key"]` (map index) and `v, ok = x.(T)` (type assertion) now work with regular `=` assignment, not just `:=`; missing map keys return the zero value
- **`for range` string yields rune integers** — the value variable in `for i, r := range s` is now an integer code point (`r == 65`) rather than a JS character string
- **Type switch multi-case capture variable** — `switch v := x.(type) { case int: ...; case string: ... }` no longer spuriously reports `'v' declared and not used`
- **Slice/map `== nil`** comparison is still valid — the new incomparable-type check correctly allows `slice == nil` while rejecting `slice1 == slice2`

### Tests
- Added 49 tests covering all new features and bug fixes, distributed across the existing test files
- Updated `test/language/core.test.js`: `range over string` test updated to expect rune integers (correct Go behavior)
- Updated `test/builtins/operators.test.js`: `s[i]` test updated to expect `charCodeAt` integer result
- Updated `test/compiler/imports.test.js`: unexported-access test now asserts the error is emitted rather than silently accepted

## [0.0.3] - 2026-04-16

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
- Test suite restructured: `language.test.js`, `builtins.test.js`, `types.test.js`, and `compiler.test.js` split into subdirectories (`test/language/`, `test/builtins/`, `test/types/`, `test/compiler/`) with 3–4 focused files each, mirroring the `src/` submodule pattern
- Removed `ROADMAP.md` — condensed roadmap is now an inline section in `README.md`

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
