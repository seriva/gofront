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

Requires Node.js 25+.

---

## Example — Todo App

The only example is a full todo web app in `example/`, split across a
sub-package and four source files to showcase multi-file compilation.

```
example/
  src/
    utils/        ← sub-package: Plural(), Max(), Clamp() — pure utilities
      utils.go
    types.go      ← Todo struct · FilterMode & Priority consts (iota) · filterLabel()
    store.go      ← state management: add/toggle/remove/clear · visibleTodos()
                     · stats() with named returns · statusLine() via utils.Plural
    render.go     ← renderTodo() · renderFilterBar() · renderFooter() · render()
    main.go       ← priority-toggle state · submitInput() · event wiring · seed data
  index.html      ← HTML + CSS, loads app.js as an ES module
  app.js          ← generated output  (produced by build)
  build.sh        ← build script
```

**Features demonstrated:** structs & methods, iota constants, named return values,
closures, slices, maps, `for range`, `switch`, cross-package imports, multi-file
same-package compilation, DOM APIs.

**Build and run:**

```sh
sh example/build.sh
# → writes example/app.js
# open example/index.html in a browser
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

All `.go` files in a directory share the same namespace and are compiled as one unit:

```
myapp/
  types.go     ← type Point struct { X, Y int }
  utils.go     ← func distance(a, b Point) float64 { ... }
  main.go      ← func main() { ... }
```

```sh
node src/index.js myapp -o myapp/bundle.js
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

GoFront performs static type checking before emitting any code, accurately tracking source locations in error messages across multiple files:

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

---

## Language features

| Feature | Status |
|---|---|
| Variables (`var`, `:=` short re-declaration) | ✓ |
| Constants (`const`, `iota`) | ✓ |
| Functions, multiple returns | ✓ |
| Named return values | ✓ |
| Variadic parameters | ✓ |
| `init()` functions | ✓ |
| Structs + methods | ✓ |
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
| `new(T)` | ✓ |
| Type conversions | ✓ |
| Type assertions (`x.(T)`) | ✓ |
| Type switch (`switch x.(type)`, `switch v := x.(type)`) | ✓ — compiles to `if/else if` with `typeof` / `instanceof` checks |
| Slice expressions (`s[lo:hi]`) | ✓ |
| `break` / `continue` / labeled `break` / labeled `continue` | ✓ |
| `cap()`, `copy()`, `panic()` | ✓ |
| Variadic spread (`f(slice...)`, `append(a, b...)`) | ✓ |
| Bitwise operators (`&`, `\|`, `^`, `<<`, `>>`) | ✓ |
| Compound assignment (`+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `\|=`, `^=`, `<<=`, `>>=`) | ✓ |
| Increment / decrement (`i++`, `i--`) | ✓ |
| Raw string literals (backticks) | ✓ |
| Rune / char literals (`'a'`, `'\n'`) | ✓ — compiled to integer char codes |
| `defer` | ✓ |
| `panic()` / `recover()` | ✓ |
| `error` type / `error("msg")` / `.Error()` | ✓ |
| `async func` / `await` expressions | ✓ |
| `fmt.Sprintf` / `fmt.Printf` / `fmt.Println` / `fmt.Errorf` | ✓ |
| External `.d.ts` types | ✓ |
| npm package types | ✓ |
| Multi-file packages | ✓ |
| Cross-package imports | ✓ |
| Import aliases (`import m "./pkg"`) | ✓ |
| Sized integer types (`uint`, `int8`–`int64`, `uint8`–`uint64`, `float32`) | ✓ — mapped to `int` / `float64` at runtime |
| Struct field tags (`` `json:"name"` ``) | ✓ — parsed and ignored (no reflection) |
| `[]byte(s)` conversion | ✓ — produces UTF-8 byte values via `TextEncoder` |
| `[]rune(s)` conversion | ✓ — produces Unicode code points via `Array.from` |

---

## Limitations / Not implemented

The following Go features are not supported or behave differently from the Go specification.

### Not implemented

| Feature | Notes |
|---|---|
| Goroutines (`go` keyword) | No concurrency model — JS is single-threaded |
| Channels (`chan`, `<-`) | Depends on goroutines |
| `select` statement | Depends on channels |
| `goto` statement | Not planned |
| Generics (Go 1.18+) | No `[T Type]` type parameters |
| `[...]T{...}` array length inference | Not supported |
| Side-effect imports (`import _ "pkg"`) | Not supported |

### Behaves differently from Go

| Feature | GoFront behaviour | Go behaviour |
|---|---|---|
| Map iteration order | Insertion-order (JS `Object.entries`) | Randomised |
| Integer overflow | Silent IEEE 754 float64 wrap | Wraps at type boundary |
| `cap()` | Always equals `len()` | May exceed `len()` |
| Fixed-size arrays (`[n]T`) | Compiled as plain JS arrays (no length enforcement) | Fixed at compile time |
| `rune` / `byte` types | Treated as `int`; no UTF-8 semantics | Distinct types with proper encoding |
| `range` over string gives JS string characters, not rune code points | JS `Array.from(s)` iteration | Go UTF-8 rune iteration |
| `len()` on strings | Returns JS character count (UTF-16 code units) | Returns byte count (UTF-8) |

---

## Tests

```sh
npm test
```

422 tests covering language features, type errors, edge cases, DOM (jsdom), external `.d.ts`, npm resolver, multi-file compilation, embedded structs, string formatting, and the example app.
