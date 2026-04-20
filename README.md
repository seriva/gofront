## About

Go for the backend: simple, type-safe, no nonsense. JavaScript for the frontend: runs
everywhere, no setup. The problem is JavaScript's loose typing — and TypeScript never
quite felt like home either.

So I built GoFront. Go syntax and type safety, compiling to plain ES modules. One language
front and back, no runtime, no framework, no tsconfig.json.

Probably not useful. Definitely fun to build.

```go
package main

type Todo struct {
    id   int
    text string
    done bool
}

var todos []Todo

func addTodo(text string) {
    todos = append(todos, Todo{id: len(todos), text: text, done: false})
    render()
}

func main() {
    btn := document.getElementById("add-btn")
    btn.addEventListener("click", func() {
        addTodo(document.getElementById("input").value)
    })
}
```

Compiles to clean, readable JavaScript — no runtime, no framework.

GoFront source files use the `.go` extension so editors automatically apply Go syntax
highlighting, bracket matching, and indentation rules without any extra configuration.

---

## Install

```sh
npm install -g gofront
```

Requires Node.js 20+.

---

## How it works

GoFront is a four-stage compiler written in pure Node.js (no dependencies). Every stage
operates on the same AST (abstract syntax tree), running in a single pass per stage:

```
source text (.go files)
  → Lexer          tokenize + Go-style semicolon insertion
  → Parser         recursive-descent → AST
  → Type Checker   annotate AST with types + collect errors
  → Code Gen       AST → JavaScript string
```

### 1. Lexer (`src/lexer.js`)

Tokenises the source into a stream of tokens. Implements Go's semicolon insertion rules:
a semicolon is automatically inserted after a line's final token if that token is an
identifier, literal, `)`, `]`, `}`, or certain keywords (`return`, `break`, `continue`,
`fallthrough`). This is why Go doesn't need explicit semicolons — and neither does
GoFront.

### 2. Parser (`src/parser.js`)

A hand-written recursive-descent parser. No parser generators, no grammar files — just
straightforward top-down parsing. Produces an AST where every node is a plain JS object
with a `kind` field (`"FuncDecl"`, `"IfStmt"`, `"BinaryExpr"`, etc.).

Operator precedence is handled via a Pratt-style expression parser with numeric
precedence levels.

### 3. Type Checker (`src/typechecker.js`)

Three-pass type checker operating on the AST:

1. **Pass 1 — collect types**: register all `type` declarations (structs, interfaces,
   named types) so they can be referenced before definition.
2. **Pass 2 — collect functions & vars**: register function signatures and package-level
   variables. Resolve embedded struct fields and promote methods.
3. **Pass 3 — check bodies**: walk every function body, infer expression types, verify
   assignments and call arguments, and report errors with source location.

Types are plain JS objects (`{ kind: "basic", name: "int" }`, `{ kind: "slice",
elem: ... }`, etc.). The special `any` type acts as a recovery/escape hatch — any
operation on it is silently permitted, preventing cascading errors.

### 4. Code Generator (`src/codegen.js`)

Walks the typed AST and emits clean, readable JavaScript. No intermediate representation
— the codegen writes directly to an output buffer with indentation tracking.

Runtime helpers (`__len`, `__append`, `__s`, `__sprintf`, `__cmul`, `__cdiv`, `__error`,
`__errorIs`) are tree-shaken: only emitted when actually used. Optional inline source
maps are supported via VLQ-encoded mappings.

---

## Go → JavaScript mapping

Every Go construct compiles to a specific JavaScript pattern. The output is designed to be
readable and debuggable — no name mangling, no opaque wrappers.

### Data structures

| Go | JavaScript | Notes |
|---|---|---|
| `struct` | ES6 `class` | Single destructured-object constructor: `new Point({ X: 1, Y: 2 })` |
| Methods | Class instance methods | Receiver is `this` |
| Embedded structs | Flattened fields + delegation stubs | `Greet(...a) { return Base.prototype.Greet.call(this, ...a); }` |
| `[]T` (slice) | `Array` | `append` → spread, `len` → `.length` |
| `map[K]V` | Plain object `{}` | Key access via `[]`, iteration via `Object.entries()` |
| `nil` | `null` | |
| `error` | `__error` object | `error("msg")` → `__error("msg")`, `.Error()` → real method call. `toString()` for string context compat |
| Pointers (`*T`) | `{ value: T }` | `new(T)` allocates a boxed zero value |

### Functions

| Go | JavaScript |
|---|---|
| `func f(a int) int` | `function f(a)` |
| Multiple returns `return a, b` | `return [a, b]` — destructured at call site: `let [a, b] = f()` |
| Named returns | Variables pre-declared; bare `return` returns them |
| Variadic `func f(xs ...int)` | `function f(...xs)` |
| `func` literal (closure) | Arrow or function expression |
| `async func` / `await` | `async function` / `await` |
| `init()` | Emitted as `(function() { ... })()` immediately-invoked |
| `defer` | `try { ... } finally { deferred() }` |

### Control flow

| Go | JavaScript |
|---|---|
| `for init; cond; post {}` | `for (init; cond; post) {}` |
| `for cond {}` | `while (cond) {}` |
| `for {}` | `while (true) {}` |
| `for i, v := range slice` | `for (const [i, v] of arr.entries())` |
| `for k, v := range map` | `for (const [k, v] of Object.entries(m))` |
| `for i, r := range str` | `for (const [i, r] of Array.from(s, (c, i) => [i, c.codePointAt(0)]))` — `r` is a rune integer |
| `for i := range n` | `for (let i = 0; i < n; i++)` |
| `switch` / `fallthrough` | `switch` / case fall-through |
| `switch v := x.(type)` | `if/else if` with `typeof` / `instanceof` checks |
| `panic(msg)` | `throw new Error(msg)` |
| `recover()` | Captured in `defer` via `try/catch` |

### Builtins

| Go | JavaScript |
|---|---|
| `len(x)` | `__len(x)` (tree-shaken helper) or `Object.keys(x).length` for maps |
| `cap(x)` | `x.length` |
| `append(s, elems...)` | `[...s, ...elems]` |
| `copy(dst, src)` | Inline splice helper |
| `make([]T, n)` | `new Array(n).fill(zero)` |
| `make(map[K]V)` | `{}` |
| `delete(m, k)` | `delete m[k]` |
| `new(T)` | `{ value: zeroOf(T) }` |
| `min` / `max` | `Math.min` / `Math.max` |
| `clear(x)` | `.length = 0` (slice) or delete-loop (map) |
| `print` / `println` | `console.log` |
| `complex(r, i)` | `{ re: r, im: i }` |
| `real(z)` / `imag(z)` | `z.re` / `z.im` |
| `fmt.Sprintf` | `__sprintf` tree-shaken helper |

### Type system at runtime

All type checking happens at compile time. At runtime, types are erased — there are no
type tags, no reflection, no runtime overhead. Sized integers (`int8`–`int64`,
`uint8`–`uint64`) are all `number` at runtime. `float32` is `number`. Generic type
parameters are erased completely — `func Map[T, U any](...)` compiles to `function Map(...)`.
The type checker enforces correctness; JavaScript doesn't need to know.

---

## Examples — Todo App

There are two example apps — both implement the same todo app to show different aspects
of GoFront.

### Simple (vanilla DOM)

The default example. Zero dependencies, clean 1:1 compiled JS output. Showcases GoFront's
core language features with straightforward DOM manipulation.

```
example/simple/
  src/
    types.go      ← Todo struct · FilterAll/Active/Completed iota · Priority iota
    store.go      ← state as plain variables · add/toggle/remove/clear · visibleTodos()
                     · stats() with named returns · defer/recover · async persistence
    render.go     ← render() updates DOM via innerHTML · renderTodo() · renderFilterBar()
    styles.go     ← injectStyles() creates <style> element with all CSS
    main.go       ← createApp() builds DOM shell · setupEvents() · event delegation
    utils/
      utils.go    ← Plural() · generic Filter/Map — cross-package import demo
    browser.d.ts  ← minimal external type declarations (sleep)
  index.html      ← bare HTML shell, loads app.js as ES module
  app.js          ← generated output
```

### Reactive (signals + d.ts imports)

Same app rebuilt with [reactive.js](https://github.com/seriva/microtastic), a tiny
signals-based reactive framework. Demonstrates how GoFront integrates with external JS
libraries via `.d.ts` type declarations — the GoFront code uses typed `Signal` values,
`Signals.create()`, `Signals.computed()`, `Signals.batch()`, and `Reactive.bind()`,
all described in a hand-written `browser.d.ts` shim.

```
example/reactive/
  src/
    types.go      ← Todo, Stats, AppElements structs
    store.go      ← Signal-typed state · Signals.create/computed/batch
    render.go     ← createAppShell() returns AppElements · ctx.computed/ctx.bind
    styles.go     ← injectStyles()
    main.go       ← wires everything together
    utils/
      utils.go    ← Plural() · generic Filter/Map
    browser.d.ts  ← Signal interface · Signals/Reactive/ComponentContext namespaces
  reactive.js     ← signals framework (from microtastic)
  index.html      ← loads reactive.js + app.js
  app.js          ← generated output
```

### Features demonstrated

Both apps cover: structs & methods, iota constants, named return values, closures,
slices, `for range`, `switch`, cross-package imports, multi-file same-package compilation,
`async`/`await`, `defer`/`recover`, localStorage persistence, DOM APIs, and generic
utility functions (`Filter[T]`, `Map[T, U]`).

The reactive example additionally demonstrates: external `.d.ts` type imports,
`declare namespace` patterns for typing JS libraries, and reactive UI updates via signals.

### Build and run

```sh
npm run build:simple      # → example/simple/app.js
npm run build:reactive    # → example/reactive/app.js
# open the respective index.html in a browser
```

---

## CLI

```
gofront <file.go>                compile single file → stdout
gofront <dir>                    compile all *.go in directory → stdout
gofront <input> -o out.js        write output to file (prints elapsed compile time e.g. "15ms")
gofront <input> --check                    type-check only
gofront <input> --watch                    watch for changes and recompile
gofront <input> -o out.js --serve          watch + serve with live reload (default port 3000)
gofront <input> -o out.js --serve --port 8080  use a custom port
gofront <input> --source-map               append inline source map (single file or directory; multi-file packages emit per-file mappings)
gofront <input> --minify                   minify output (built-in minifier)
gofront <input> --minify --mangle          minify and rename local identifiers
gofront <file.go> --ast                    dump AST (debug)
gofront <file.go> --tokens                 dump tokens (debug)
gofront init [dir]                         scaffold a new project
gofront --version / -v                     print version
gofront --help / -h                        print this help
```

---

## Multi-file packages

All `.go` files in a directory share the same namespace and are compiled as one unit.
The compiler (`src/compiler.js`) orchestrates this:

1. Parse each `.go` file in the directory into a separate AST.
2. Resolve imports: `js:` d.ts files, npm packages (via `node_modules/` and `@types/`),
   and local GoFront sub-packages (`import "./subpkg"`) which are compiled recursively.
3. Run the type checker across all ASTs as a single unit — types, functions, and
   variables declared in one file are visible in all other files of the same package.
4. Generate code for each AST and concatenate. Sub-package code is inlined as a preamble.

```
myapp/
  types.go     ← type Point struct { X, Y int }
  utils.go     ← func distance(a, b Point) float64 { ... }
  main.go      ← func main() { ... }
```

```sh
gofront myapp -o myapp/bundle.js
```

Cross-package imports are supported via relative paths:

```go
import "./mathpkg"

func main() {
    x := math.Add(1, 2)   // math package inlined into the bundle
}
```

---

## Type checking

GoFront performs static type checking before emitting any code, accurately tracking source
locations in error messages across multiple files:

```go
func greet(name string) {
    console.log("Hello, " + name)
}

greet(42)   // → Type error in src/main.go at line 5: cannot use int as string
```

External TypeScript type definitions are supported via `js:` imports:

```go
import "js:./dom.d.ts"
```

npm package types are resolved automatically from `node_modules/` and `@types/`.
The resolver (`src/resolver.js`) walks up the directory tree to find `node_modules`,
checks `package.json` `"types"` / `"typings"` fields, falls back to `index.d.ts`,
then tries `@types/`. The `.d.ts` parser (`src/dts-parser.js`) extracts type
signatures into GoFront's internal type representation.

---

## Language features

### Core language

| Feature | Status |
|---|---|
| Variables (`var`, `:=` short re-declaration) | ✓ |
| Constants (`const`, `iota`, untyped constants) | ✓ |
| Functions, multiple returns, named returns, variadic | ✓ |
| `init()` functions | ✓ |
| Closures / function literals | ✓ |
| `async func` / `await` expressions | ✓ |
| `defer`, `panic()` / `recover()` | ✓ |
| `print` / `println` builtins | ✓ — compile to `console.log` |

### Types & data structures

| Feature | Status |
|---|---|
| Structs + methods (value & pointer receivers) | ✓ |
| Embedded structs (flattened fields + promoted methods) | ✓ |
| Anonymous struct types | ✓ — compile to plain JS objects |
| Interfaces (with embedding) | ✓ |
| Slices (`append`, `len`, `make`) | ✓ |
| Maps (`make`, `delete`, comma-ok) | ✓ |
| Arrays with compile-time enforcement | ✓ — reject `append`, bounds checking, size matching, `[...]T` inference, compile-time `len()` |
| Slice → array conversion (`[N]T(slice)`) | ✓ — Go 1.20 |
| Pointers (`&x`, `*p`, `new(T)`) | ✓ — scalar locals boxed as `{ value: T }` for shared mutation |
| `error` type | ✓ — interface `{ Error() string }`; custom error types, `errors.Is`/`Unwrap`, `%w` wrapping |
| Complex numbers (`complex64`, `complex128`, `3i`) | ✓ — `complex()`, `real()`, `imag()` builtins; `__cmul`/`__cdiv` helpers |
| Type definitions, type aliases (`type A = B`) | ✓ |
| Type conversions, type assertions (plain & comma-ok) | ✓ |
| Type switch (`switch v := x.(type)`) | ✓ — compiles to `if/else if` with `typeof` / `instanceof` |
| Sized integers (`int8`–`int64`, `uint8`–`uint64`, `float32`) | ✓ — mapped to `number` at runtime |
| Generics (`func F[T any]`, `type S[T any] struct`) | ✓ — type erasure to JS; generic functions, structs, constraints (`any`, `comparable`, interfaces, unions), type inference |
| Struct field tags | ✓ — parsed and ignored (no reflection) |
| Struct and array equality (`a == b`) | ✓ — deep comparison via `__equal` helper |

### Control flow

| Feature | Status |
|---|---|
| `if` / `else if` / `else` (with init statement) | ✓ |
| `for` (C-style, condition-only, infinite, `range`) | ✓ |
| `range` over slice, map, string, integer | ✓ |
| Range over iterator functions (Go 1.23) | ✓ — `func(yield func(K, V) bool)` protocol; break/continue/return propagation |
| `switch` / `fallthrough` (with init statement) | ✓ |
| `break` / `continue` / labeled variants | ✓ |
| Terminating statement analysis | ✓ — missing `return` in non-void functions is a type error |

### Expressions & literals

| Feature | Status |
|---|---|
| Arithmetic, comparison, logical, bitwise operators | ✓ — includes `&^` (bit clear) |
| Compound assignment, increment / decrement | ✓ |
| Slice expressions (`s[lo:hi]`, `s[lo:hi:max]`) | ✓ |
| Variadic spread (`f(slice...)`, `append(a, b...)`) | ✓ |
| Positional struct literals (`Point{1, 2}`) | ✓ |
| Method expressions (`T.Method`) / method values (`x.Method`) | ✓ |
| Multi-value function forwarding (`f(g())`) | ✓ |
| Raw string literals (backticks), rune literals | ✓ |
| Numeric separators (`1_000_000`), binary/octal/hex literals | ✓ |
| `[]byte(s)` / `[]rune(s)` conversions | ✓ |

### Standard library shims

| Package | Functions |
|---|---|
| `fmt` | `Sprintf`, `Printf`, `Println`, `Print`, `Errorf`, `Fprintf`, `Fprintln`, `Fprint` — format verbs: `%v`, `%d`, `%s`, `%t`, `%x`, `%o`, `%b`, `%q`, `%e`, `%g`, `%w`, width/precision |
| `strings` | `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `LastIndex`, `Count`, `Repeat`, `Replace`, `ReplaceAll`, `ToUpper`, `ToLower`, `TrimSpace`, `Trim`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `Split`, `Join`, `EqualFold`; **`Builder`** type (`WriteString`, `WriteByte`, `WriteRune`, `Write`, `String`, `Len`, `Reset`, `Grow`) |
| `bytes` | `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `Join`, `Split`, `Replace`, `ToUpper`, `ToLower`, `TrimSpace`, `Equal`, `Count`, `Repeat`; **`Buffer`** type (`WriteString`, `WriteByte`, `Write`, `String`, `Bytes`, `Len`, `Reset`) |
| `strconv` | `Itoa`, `Atoi`, `FormatBool`, `FormatInt`, `FormatFloat`, `ParseFloat`, `ParseInt`, `ParseBool` |
| `sort` | `Ints`, `Float64s`, `Strings`, `Slice`, `SliceStable`, `SliceIsSorted` |
| `math` | `Abs`, `Floor`, `Ceil`, `Round`, `Sqrt`, `Cbrt`, `Pow`, `Log`, `Log2`, `Log10`, trig functions + `Pi`, `E`, `MaxFloat64`, `MaxInt`, `MinInt` |
| `errors` | `New`, `Is`, `Unwrap` — custom error types via interface satisfaction |
| `time` | `Now`, `Since`, `Sleep` + `Millisecond`, `Second`, `Minute`, `Hour` constants |
| `maps` | `Keys`, `Values`, `Clone`, `Copy`, `Equal`, `EqualFunc`, `Delete`, `DeleteFunc` |
| `slices` | `Contains`, `Index`, `Equal`, `Compare`, `Sort`, `SortFunc`, `SortStableFunc`, `IsSorted`, `IsSortedFunc`, `Reverse`, `Max`, `Min`, `MaxFunc`, `MinFunc`, `Clone`, `Compact`, `CompactFunc`, `Concat`, `Delete`, `DeleteFunc`, `Insert`, `Replace`, `Grow`, `Clip` |
| `regexp` | `MustCompile`, `Compile`, `MatchString`, `QuoteMeta`; **`*Regexp`** methods: `MatchString`, `FindString`, `FindStringIndex`, `FindAllString`, `FindStringSubmatch`, `FindAllStringSubmatch`, `ReplaceAllString`, `ReplaceAllLiteralString`, `Split`, `String` |
| `unicode` | `IsLetter`, `IsDigit`, `IsSpace`, `IsUpper`, `IsLower`, `IsPunct`, `IsControl`, `IsPrint`, `IsGraphic`, `ToUpper`, `ToLower` |
| `os` | `Exit`, `Args`, `Getenv` |

### Packages & imports

| Feature | Status |
|---|---|
| Multi-file packages | ✓ |
| Cross-package imports | ✓ |
| Import aliases (`import m "./pkg"`) | ✓ |
| Side-effect imports (`import _ "pkg"`) | ✓ |
| Dot imports (`import . "pkg"`) | ✓ |
| Unused import detection | ✓ |
| External `.d.ts` types | ✓ |
| npm package type resolution | ✓ |

---

## Go Compatibility

GoFront implements a practical subset of the
[Go Language Specification](https://go.dev/ref/spec) (go1.26). It is not aiming for
byte-level parity — it is a Go-inspired language for the JavaScript platform.

### GoFront extensions (not in Go)

These features are intentional additions for the JavaScript platform:

| Feature | Purpose |
|---|---|
| `async func` / `await` | First-class async syntax for frontend work. |
| Browser globals (`document`, `console`, etc.) | Predeclared as `any` for practical DOM access. |
| `.d.ts` type imports (`import "js:./types.d.ts"`) | Type-safe interop with JavaScript libraries. |
| npm package resolution | Import types from `node_modules/` and `@types/` automatically. |

### What's not implemented

| Feature | Reason | Prospect |
|---|---|---|
| `goto` | No clean JS translation. Rare in idiomatic Go. | Not planned. |
| Goroutines / channels / `select` | Go's concurrency model has no JS equivalent. A userland scheduler defeats the "no runtime" goal. | Out of scope. |
| `unsafe`, `reflect`, `cgo` | Require memory model or runtime type metadata that JS cannot provide. | Out of scope. |

### Semantic differences

These features are implemented but behave differently due to fundamental JS runtime
constraints. These are **not bugs** — they are deliberate trade-offs documented here so
you know exactly what to expect.

| Feature | GoFront | Go | Why |
|---|---|---|---|
| Map iteration order | Insertion-order (`Object.entries`) | Randomised | JS objects preserve insertion order. |
| Integer overflow | IEEE 754 float64 semantics | Wraps at type boundary (e.g. `int32`) | All JS numbers are float64. |
| Integer precision | Safe up to 2⁵³ | Full width per type (`int64` = 64 bits) | JS `number` limitation. |
| `cap()` | Always equals `len()` | May exceed `len()` | JS arrays have no separate capacity. |
| Fixed-size arrays (`[n]T`) | Compile-time enforcement (bounds, append rejected, size matching); plain JS arrays at runtime | Fixed at compile time, value-type copy semantics | Runtime enforcement adds overhead; compile-time checks catch most errors. |
| `nil` | Maps to `null` | Typed nil (distinct per type) | JS has no typed nil concept. |
| `rune` / `byte` | Treated as `int` | Distinct types with UTF-8 encoding | JS strings are UTF-16. |
| `range` over string | Rune integers via `.codePointAt()` | Runes (UTF-8 code points) | Close match — indices are byte-sequential, values are code points. |
| `len()` on strings | JS `.length` (UTF-16 code units) | Byte count (UTF-8) | Matching Go would require `TextEncoder` on every call. |
| `error` type | Interface `{ Error() string }` with `__error` runtime objects | Interface `{ Error() string }` | Close match. Custom error types, `errors.Is`/`Unwrap`, `%w` wrapping all work. `toString()` added for JS string context compat. |
| `defer` | `try`/`finally` with a defer stack | Runtime stack unwinding | Covers most cases but not identical to Go internals. |
| Struct field tags | Parsed, silently discarded | Available via `reflect` | No reflection = no use for tag values. |
| Pointers (`&x`, `*p`) | Address-taken scalars boxed as `{ value: T }`; structs/slices/maps are reference types (no boxing) | True memory indirection | Shared mutation works for scalars; struct fields and slice elements not yet addressable. |
| Three-index slice (`a[lo:hi:max]`) | `max` is parsed but ignored | Sets result capacity | JS arrays have no capacity. |
| Exported / unexported | Enforced for GoFront packages; external `.d.ts`/npm namespaces are exempt | Access enforced uniformly | External JS APIs use lowercase names by convention. |

---

## Roadmap

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the full roadmap and release history.
Design documents for planned features are organised by release under `docs/v*/`
(e.g. [`docs/v0.0.5/`](docs/v0.0.5/)).

---

## Tests

```sh
npm test
```

869 tests covering language features, type errors, edge cases, DOM (jsdom), external
`.d.ts`, npm resolver, multi-file compilation, embedded structs, string formatting, map
iteration order, integer overflow semantics, unused variable detection, unused import
detection, semantic difference verification, stdlib shim packages, generics (type params,
inference, constraints), and both example apps.
