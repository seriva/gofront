## About

I love Go for the backend — simple, type-safe, no nonsense. I like JavaScript for the
frontend — runs everywhere, no setup. What I don't like is JavaScript's loose typing. And
I don't like TypeScript either. I know, controversial. It's fine, I just don't enjoy it.

So I built GoFront. Go syntax, type safety, compiles to plain ES modules. Same language
front and back, no runtime, no framework, no tsconfig.json.

Is this useful? Probably not, but it was fun to build:D

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

Runtime helpers (`__len`, `__append`, `__s`, `__sprintf`) are tree-shaken: only emitted
when actually used. Optional inline source maps are supported via VLQ-encoded mappings.

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
| `error` | `string` | `error("msg")` → `"msg"`, `.Error()` → the string itself |
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
| `for i, ch := range str` | `for (const [i, ch] of Array.from(s).entries())` |
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
| `min(a, b, ...)` | `Math.min(a, b, ...)` |
| `max(a, b, ...)` | `Math.max(a, b, ...)` |
| `clear(x)` | `.length = 0` (slice) or delete-loop (map) |
| `print` / `println` | `console.log` |
| `fmt.Sprintf` | `__sprintf` tree-shaken helper |

### Type system at runtime

All type checking happens at compile time. At runtime, types are erased — there are no
type tags, no reflection, no runtime overhead. Sized integers (`int8`–`int64`,
`uint8`–`uint64`) are all `number` at runtime. `float32` is `number`. The type checker
enforces correctness; JavaScript doesn't need to know.

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
      utils.go    ← Plural() — cross-package import demo
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
      utils.go    ← Plural()
    browser.d.ts  ← Signal interface · Signals/Reactive/ComponentContext namespaces
  reactive.js     ← signals framework (from microtastic)
  index.html      ← loads reactive.js + app.js
  app.js          ← generated output
```

### Features demonstrated

Both apps cover: structs & methods, iota constants, named return values, closures,
slices, `for range`, `switch`, cross-package imports, multi-file same-package compilation,
`async`/`await`, `defer`/`recover`, localStorage persistence, and DOM APIs.

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
gofront <input> --check          type-check only
gofront <input> --watch          watch for changes and recompile
gofront <input> --source-map     append inline source map to output
gofront <input> --minify         minify output with terser
gofront <file.go> --ast          dump AST (debug)
gofront <file.go> --tokens       dump tokens (debug)
gofront init [dir]               scaffold a new project
gofront --version / -v           print version
gofront --help / -h              print this help
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

| Feature | Status |
|---|---|
| Variables (`var`, `:=` short re-declaration) | ✓ |
| Constants (`const`, `iota`) | ✓ |
| `if` / `else if` / `else` | ✓ |
| `if` with init statement (`if err := f(); err != nil`) | ✓ |
| Type definitions (`type MyType ...`) | ✓ |
| Functions, multiple returns | ✓ |
| Named return values | ✓ |
| Variadic parameters | ✓ |
| `init()` functions | ✓ |
| Structs + methods | ✓ |
| Anonymous struct types (`struct { Name string }`) | ✓ — compile to plain JS objects (no class emitted) |
| Embedded structs | ✓ |
| Pointer receivers | ✓ |
| Interfaces | ✓ |
| Interface embedding | ✓ |
| Closures | ✓ |
| Slices (`append`, `len`, `make`) | ✓ |
| Maps (`make`, `delete`, comma-ok) | ✓ — note: iteration order is insertion-order (JS), not randomised (Go) |
| `for`, `for range`, `for {}` | ✓ |
| `range` over string | ✓ |
| `switch` / `fallthrough` | ✓ |
| `switch` with init statement (`switch x := f(); x {}`) | ✓ |
| `new(T)` | ✓ |
| Type conversions | ✓ |
| Type assertions (`x.(T)`) | ✓ |
| Type switch (`switch x.(type)`, `switch v := x.(type)`) | ✓ — compiles to `if/else if` with `typeof` / `instanceof` checks |
| Slice expressions (`s[lo:hi]`, `s[lo:hi:max]`) | ✓ — three-index form is parsed; `max` is ignored at runtime (JS has no capacity) |
| `break` / `continue` / labeled `break` / labeled `continue` | ✓ |
| `cap()`, `copy()`, `panic()` | ✓ |
| Variadic spread (`f(slice...)`, `append(a, b...)`) | ✓ |
| Bitwise operators (`&`, `\|`, `^`, `&^`, `<<`, `>>`) | ✓ — `&^` (bit clear) compiles to `& ~` |
| Compound assignment (`+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `\|=`, `^=`, `<<=`, `>>=`) | ✓ |
| Increment / decrement (`i++`, `i--`) | ✓ |
| Raw string literals (backticks) | ✓ |
| Rune / char literals (`'a'`, `'\n'`) | ✓ — compiled to integer char codes |
| `defer` | ✓ |
| `panic()` / `recover()` | ✓ |
| `print` / `println` builtins | ✓ — compile to `console.log` |
| Pointer operators (`&`, `*`) | ✓ |
| `error` type / `error("msg")` / `.Error()` | ✓ |
| `async func` / `await` expressions | ✓ |
| `fmt.Sprintf` / `fmt.Printf` / `fmt.Println` / `fmt.Print` / `fmt.Errorf` | ✓ |
| External `.d.ts` types | ✓ |
| npm package types | ✓ |
| Multi-file packages | ✓ |
| Cross-package imports | ✓ |
| Import aliases (`import m "./pkg"`) | ✓ |
| Sized integer types (`uint`, `int8`–`int64`, `uint8`–`uint64`, `float32`) | ✓ — mapped to `int` / `float64` at runtime |
| Struct field tags (`` `json:"name"` ``) | ✓ — parsed and ignored (no reflection) |
| `[]byte(s)` conversion | ✓ — produces UTF-8 byte values via `TextEncoder` |
| `[]rune(s)` conversion | ✓ — produces Unicode code points via `Array.from` |
| `[...]T{...}` array length inference | ✓ |
| Side-effect imports (`import _ "pkg"`) | ✓ — dependency code is bundled; package namespace is not exposed |
| Dot imports (`import . "pkg"`) | ✓ — merges package exports into the current scope (no qualifier needed) |
| Unused local import detection | ✓ — unused cross-package imports are type errors (matching Go); `import _` exempt |
| `min()` / `max()` builtins | ✓ — compiles to `Math.min` / `Math.max` |
| `clear()` builtin | ✓ — zeroes slice length or deletes all map keys |
| `range` over integer (`for i := range n`) | ✓ — Go 1.22; also supports `for range n` |
| Type aliases (`type A = B`) | ✓ — transparent alias; no conversion needed between alias and original |
| Numeric literal separators (`1_000_000`) | ✓ — underscores stripped at lex time |
| Binary / octal literals (`0b1010`, `0o777`) | ✓ — passed through to JS which supports them natively |
| Hex float literals (`0x1.8p1`) | ✓ — evaluated at lex time to a decimal value |
| Untyped constants | ✓ — `const x = 5` produces an untyped int that coerces to `int` or `float64` on use (Go spec §Constants) |

---

## Go Compatibility

GoFront implements a practical subset of the
[Go Language Specification](https://go.dev/ref/spec) (go1.26). It is not aiming for
byte-level parity — it is a Go-inspired language for the JavaScript platform. This
section explains exactly where GoFront matches Go, where it intentionally diverges, and
where JS fundamentally prevents matching Go semantics.

For a detailed feature-by-feature matrix and roadmap, see [ROADMAP.md](ROADMAP.md).

### What matches Go

The core language surface is well covered. All of these compile and behave as a Go
developer would expect:

- **Declarations**: `var`, `:=` (with re-declaration), `const` (with `iota`), `type`,
  `func`, methods, `init()`.
- **Control flow**: `if`/`else` (with init statement), `for` (classic, condition-only,
  infinite, `range`), `switch`/`case`/`default`/`fallthrough`, type switches, labeled
  `break`/`continue`, `defer`, `panic`/`recover`.
- **Types**: `int`, `float64`, `string`, `bool`, sized integers (`int8`–`int64`,
  `uint8`–`uint64`), `float32`, `byte`, `rune`, `error`, slices, maps, arrays, structs,
  interfaces (with embedding), pointers (`*T`, `&x`), type aliases, function types.
- **Expressions**: all arithmetic, comparison, logical, and bitwise operators (including
  `&^`), compound assignment, increment/decrement, type conversions, type assertions
  (plain and comma-ok), slice expressions (`a[lo:hi]`, `a[lo:hi:max]`), composite
  literals, `[...]T{...}` inference, rune literals, raw string literals, variadic
  spread, blank identifier `_`.
- **Builtins**: `len`, `cap`, `append`, `copy`, `make`, `delete`, `new`, `clear`, `min`,
  `max`, `print`, `println`, `panic`, `recover`, `fmt.Sprintf`/`Printf`/`Println`/`Errorf`.
- **Packages**: multi-file packages, cross-package imports, import aliases,
  dot imports, blank imports, unused import detection.

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
| Generics (`[T any]`) | Touches every compiler stage. Large effort, limited runtime payoff on a JS target. | Feasible — highest-priority future feature. |
| Range over iterator functions (Go 1.23) | `func(yield func(K, V) bool)` protocol. | Feasible. |
| Complex numbers (`complex64`, `complex128`, `3i`) | Would need a runtime complex type. Rarely used in frontend. | Feasible but low priority. |
| `goto` | No clean JS translation. Rare in idiomatic Go. | Not planned. |
| Method expressions (`T.Method`) | Requires function-wrapping with explicit receiver. | Feasible. |
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
| Fixed-size arrays (`[n]T`) | Plain JS arrays (no length enforcement) | Fixed at compile time | Runtime enforcement adds overhead for no JS benefit. |
| `nil` | Maps to `null` | Typed nil (distinct per type) | JS has no typed nil concept. |
| `rune` / `byte` | Treated as `int` | Distinct types with UTF-8 encoding | JS strings are UTF-16. |
| `range` over string | JS characters (UTF-16 via `Array.from`) | Runes (UTF-8 code points) | UTF-16 vs UTF-8 mismatch. |
| `len()` on strings | JS `.length` (UTF-16 code units) | Byte count (UTF-8) | Matching Go would require `TextEncoder` on every call. |
| `error` type | Plain string | Interface `{ Error() string }` | Practical simplification for JS. |
| `defer` | `try`/`finally` with a defer stack | Runtime stack unwinding | Covers most cases but not identical to Go internals. |
| Struct field tags | Parsed, silently discarded | Available via `reflect` | No reflection = no use for tag values. |
| Pointers (`&x`, `*p`) | Syntax accepted, semantically transparent | True memory indirection | JS has no pointer model. |
| Three-index slice (`a[lo:hi:max]`) | `max` is parsed but ignored | Sets result capacity | JS arrays have no capacity. |
| Type assertions (plain) | Unchecked at runtime | Panics on failure | Comma-ok form does emit runtime checks. |
| Exported / unexported | Uppercase names exported across packages | Access enforced per-identifier | Cross-package access to lowercase names is not yet an error. |

---

## Tests

```sh
npm test
```

552 tests covering language features, type errors, edge cases, DOM (jsdom), external `.d.ts`, npm resolver, multi-file compilation, embedded structs, string formatting, map iteration order, integer overflow semantics, unused variable detection, unused import detection, semantic difference verification, and both example apps.
