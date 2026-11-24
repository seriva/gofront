# Usage & Tooling

## CLI

```
gofront dev [dir]                            watch + compile + asset sync + live reload (hybrid projects emit app.wasm; default port 3000)
gofront dev [dir] --port 8080                use a custom port
gofront build [dir]                          clean + compile + minify + vendor → production output (hybrid projects emit app.wasm)
gofront build [dir] --release                production bundle: minify + mangle + Binaryen wasm optimization (-O3 + GUFA)
gofront build [dir] --wasm-opt               optimize app.wasm with Binaryen (-O3 + GUFA)
gofront build [dir] --pwa                    also generate offline service worker (sw.js) + precache manifest
gofront build [dir] --source-map             include source maps (app.js.map and app.wasm.map)
gofront build [dir] --no-minify              skip minification
gofront build [dir] --no-mangle              minify but keep original identifiers
gofront build [dir] --emit-wat               also write app.wat next to app.wasm (hybrid projects)
gofront build [dir] --js-only                compile every package to JS (alias --target js; also for dev/check/-o)
gofront prep [dir] [--minify]                run asset copying + vendor bundling only (alias: gofront vendor)
gofront check <dir>                          type-check a single package and its _test.go files
gofront check <dir>/...                      type-check every package under <dir> (Go-style `./...`) and report all errors
gofront test <dir> [--dom]                   run tests for a single package
gofront test <dir>/... [--dom] [-v] [-run <regex>] [-bench <regex>]  run tests recursively
gofront <file.go>                            compile single file → stdout
gofront <dir>                                compile all *.go in directory → stdout
gofront <input> -o out.js                    write output to file (prints elapsed compile time; hybrid projects also write app.wasm)
gofront <input> -o out.js --release          compile + minify + optimize wasm with Binaryen
gofront <input> -o out.js --wasm-opt         compile + optimize wasm with Binaryen
gofront <input> -o out.js --emit-wat         also write app.wat
gofront <input> -o out.js --no-natives       run the Go bodies of standard library functions instead of host fast paths
gofront <input> -o out.js --copy-assets      compile + copy static assets
gofront <input> --check                      type-check only (single file / directory; a directory includes its _test.go files)
gofront <input> --watch                      watch for changes and recompile
gofront <input> -o out.js --serve            watch + serve with live reload (legacy; prefer gofront dev)
gofront <input> --source-map                 append inline source map
gofront <input> --minify                     minify output (built-in minifier)
gofront <input> --minify --mangle            minify and rename local identifiers
gofront <file.go> --ast                      dump AST (debug)
gofront <file.go> --tokens                   dump tokens (debug)
gofront init [dir]                           scaffold a new project
gofront --version / -v                       print version
gofront --help / -h                          print this help
```

### Building the examples

The apps under `example/` are not committed pre-built. Run `npm run build` in the
repository root to compile every example into `example/<name>/app.js` (the hybrid
example also writes `app.wasm`), then serve the example's directory, for example
`npx serve example/simple`, and open it in a browser. Without the build step the page
cannot load `app.js`.

### Checking packages

`gofront check <dir>/...` type-checks every package below `<dir>`, including `_test.go` files, and
reports the errors of all failing packages in one run. A package that imports a failed package is
listed as skipped, and the run exits with status 1 when anything failed:

```
FAIL pkg/a
Type error in x.go at line 2:13: cannot use "a" (untyped string constant) as int value in variable declaration
  ...
gofront: pkg/c — skipped (pkg/a failed)
gofront: pkg/ok — OK (8ms)
gofront: 3 packages — 1 ok, 1 failed, 1 skipped (20ms)
```

No test function runs; `gofront test` does that.

### The dev loop

`gofront dev [dir]` compiles the project, serves it and rebuilds when you save. It keeps the
packages it has compiled in memory, so a rebuild re-checks and re-emits only the package you
edited and the packages that import something whose exported API changed. Editing a function
body re-checks that package alone; the standard library is not rebuilt after the first build.
The output is the same as a full build from scratch, source maps included.

A rebuild starts when you change:

- a `.go` or `.templ` file in the source directory;
- a file that a `//go:embed` directive matched, whatever its extension (`asset.txt`, an
  embedded `.css` file, a shader);
- a `.d.ts` file that a `js:` import names.

A `.css` file that nothing embeds only reloads the page's styles. Files outside the source
directory are not watched. A file that a glob newly matches is read at the next rebuild, which
a save of any `.go` file triggers; if the build is failing, any change in the source
directory triggers one.

### Project configuration

`gofront dev`, `build`, `prep`, `check` and `test` read optional settings from a `gofront.json`
file or a `"gofront": { … }` object in `package.json`:

| Key | Default | Description |
|---|---|---|
| `src` | `app/src`, `src` or `main.go` | Package directory (or single file) to compile |
| `serveDir` | `app`, `.` or `public` (first with `index.html`) | Directory served by `dev` and mirrored into the build |
| `outDir` | `public` | Release output directory for `build` |
| `output` | `app/app.js` | Dev-mode compiled bundle path |
| `port` | `3000` | Dev server port |
| `assetExtensions` | `[]` | Extra file extensions (e.g. `[".bmesh", ".mat"]`) copied from `serveDir` into `outDir` on `build`, in addition to the built-in web asset list (html, css, js, json, images, fonts, audio, video, wasm) |
| `vendor` | `app/vendor.js` | Vendor bundle written by `prep`/`build` from `package.json` `dependencies`. Either a destination path string or `{ "dest": string \| string[], "packages": string[], "minify": boolean, "globals": {…}, "namedExports": {…} }` — see [Vendoring npm packages](#vendoring-npm-packages) |
| `assetCopy` | `[]` | Static files copied by `prep`/`build`: `[{ "source": "node_modules/x/font.woff2", "dest": "app/fonts/font.woff2" }]` |
| `targets` | `{}` | Per-package target overrides keyed by directory relative to `src` (`"."` = root package): `{ "engine/physics": "wasm" }`. Replaces the package's `//gofront:target` directive |

All settings live in this one place — top-level `"vendor"` / `"assetCopy"` keys in `package.json` are not read.

### Vendoring npm packages

`prep` and `build` bundle the listed `packages` (default: every `package.json` dependency)
with Rolldown or esbuild from your devDependencies, and expose them as browser globals so
GoFront code can call them through `.d.ts` declarations. Subpath entries such as
`"preact/hooks"` are bundled as separate modules.

- Each package's module namespace (or its default export) is assigned to `window` under
  the package name, the name without its npm scope, and a sanitized identifier
  (`preact/hooks` → `preact_hooks`).
- `globals` adds names per package: a string or an array of extra global names, or an
  object `{ "<global>": "<export>" }` binding individual exports.
- `namedExports` binds individual exports as globals: an array of export names
  (`["h", "render"]` → `window.h = preact.h`, …) or an object `{ "<global>": "<export>" }`.
- An import without a `.d.ts` file compiles with a warning and is an untyped dynamic
  global named after the last path segment, with characters that are not valid in an
  identifier replaced by `_` (`import "pkg/sub-mod"` binds `sub_mod`). Give it an alias to
  choose the name (`import m "pkg/sub-mod"` binds `m`), which is needed when the vendored
  global differs, since `import "preact/hooks"` binds `hooks`, not `preact_hooks`. Its
  members are unchecked, and `wasm` and `both` packages reject using it.

```json
"gofront": {
  "vendor": {
    "dest": "app/vendor.js",
    "packages": ["preact", "preact/hooks"],
    "globals": { "preact/hooks": ["preact_hooks"] },
    "namedExports": {
      "preact": ["h", "render"],
      "preact/hooks": ["useState", "useEffect"]
    }
  }
}
```

The Preact example keeps this configuration in `example/preact/gofront.json`. After
`npm install`, regenerate its committed `vendor.js` from the repository root with
`node src/index.js prep example/preact`.

### Hybrid builds

When any package reached by the build carries `//gofront:target wasm` or `both`, `dev`,
`build` and `-o` also write a single `app.wasm` next to the JS bundle, and `--emit-wat`
adds a readable `app.wat`. `--js-only` forces a pure-JS build regardless of directives.

Passing `gofront build --release` (or `--wasm-opt`) optimizes the emitted WebAssembly
using Binaryen (`-O3` + GUFA), achieving ~23% smaller binary size and emitting `app.wasm.map`
when `--source-map` is enabled. In development (`gofront dev`), unoptimized WASM is served
directly for sub-10ms instant hot-reload. Everything about targets, boundary rules and the
loader is in the [Hybrid JS + WebAssembly Guide](hybrid-wasm.md).

### Bundle size

The standard library is compiled from Go source, so the first import of a package adds that
package and the parts of it your code reaches. Functions, types and methods that nothing in
your program uses, in your own packages as well as in the standard library, are left out of
the JavaScript bundle. A program that only uses `println` produces a bundle of a few dozen
bytes; importing `fmt` makes it roughly 115 kB, because `fmt` pulls in `strconv`,
`unicode/utf8` and the runtime helpers they need. These are the sizes of `app.js` from
`gofront build --release` for small programs:

| Program imports | `app.js` |
|---|---|
| nothing (`println` only) | 46 B |
| `strings` (`ToUpper`, `Split`) | 16 kB |
| `encoding/json` (`Marshal` of a struct) | 31 kB |
| `strconv` (`Itoa`, `FormatFloat`) | 71 kB |
| `fmt` (`Println`) | 117 kB |
| `fmt` (`Sprintf`) | 120 kB |
| `encoding/json` (`Unmarshal` into a struct) | 154 kB |
| `encoding/json` (`Unmarshal` with an `any` field) | 167 kB |

Pages are usually served compressed, which shrinks these files to roughly a fifth of the
numbers above. Use `gofront build --release` for the smallest output, and check it with
your own program: the size depends on which functions you call, not only on which packages
you import.

---

## Testing

Tests live in `*_test.go` files next to the code they test. They are excluded from normal
builds and compiled only by `gofront test`.

```go
package utils

import "testing"

func TestPlural(t *testing.T) {
    if got := Plural(2, "item"); got != "items" {
        t.Errorf("Plural(2) = %q, want %q", got, "items")
    }
    t.Run("one", func(t *testing.T) {
        if Plural(1, "item") != "item" {
            t.Fatal("singular form broken")
        }
    })
}
```

```sh
gofront test                       # uses the project's src dir
gofront test app/src/...           # every package under app/src, Go-style summary per package
gofront test app/src -v            # === RUN / --- PASS lines for every test and subtest
gofront test app/src -run 'Plural' # only tests whose name matches the regex
gofront test app/src --dom         # run under JSDOM: document/window available for gom and .templ components
gofront test app/src -bench .      # also run BenchmarkXxx functions and print ns/op
```

- `testing.T` supports `Error`, `Errorf`, `Fatal`, `Fatalf`, `Fail`, `FailNow`, `Failed`,
  `Log`, `Logf`, `Skip`, `Skipf`, `Skipped`, `Helper`, `Run`, `Name`, `Cleanup`, `Setenv`,
  `Context`, `Deadline` and `Parallel`, and `testing.TB` is implemented by both `*testing.T`
  and `*testing.B`. `testing.Short()`, `testing.Verbose()` and `testing.Testing()` work in
  every package. `t.Fatal` and `t.FailNow` stop the test, and a test that calls them still
  fails if it recovers the panic. Tests run one at a time, so `Parallel` does nothing.
- `t.Context()` returns a `context.Context` that is canceled just before the test's cleanup
  functions run. The `context` package provides `Background`, `TODO`, `WithCancel` and
  `WithValue`; its `Context` has no `Done` channel, so poll `Err`.
- `-run` takes a regular expression per level of the name: `-run 'TestGroup/beta'` runs only
  the subtest `beta` of `TestGroup`.
- `func TestMain(m *testing.M)` runs setup and teardown around the tests; call `m.Run()` and
  pass its result to `os.Exit`, or return and let the runner use it.
- `BenchmarkXxx(b *testing.B)` functions run with `-bench <regex>`; use `b.N` or `b.Loop()`,
  and `b.ResetTimer()` or `b.ReportAllocs()` as in Go.
- In a `js` package a test may be `async func TestXxx(t *testing.T)` and use `await`, and a
  subtest may be an `async func` passed to `t.Run`. The runner waits for each async test and
  for the async subtests it starts, in order, so a failure after an `await` still fails the
  test (and its parent) before the package summary. An `async` test cannot be combined with a
  `TestMain` in the same package: the build reports an error, so remove `TestMain` or make
  the tests synchronous.
- Output follows `go test`: `ok` / `FAIL` / `?  [no test files]` per package, non-zero exit
  when anything fails.
- `--dom` requires `jsdom` to be installed (it is a devDependency of GoFront itself; add it to
  your project when using a global install).
- Packages targeting `wasm` run inside the linked module, and `both` packages run once per
  backend (`pkg [js]`, `pkg [wasm]`). Subtests, cleanups and benchmarks work in `wasm` test
  packages too.
  See the [hybrid guide](hybrid-wasm.md#testing-hybrid-packages).

---

## Multi-file packages

All `.go` files in a directory share the same namespace and are compiled as one unit.
The compiler (`src/compiler.js`) orchestrates this:

1. Parse each `.go` file in the directory into a separate AST.
2. Resolve imports: `js:` d.ts files, npm packages (via `node_modules/` and `@types/`),
   and local GoFront sub-packages (`import "./subpkg"`) which are compiled recursively.
3. Run the type checker across all ASTs as a single unit — types, functions, and
   variables declared in one file are visible in all other files of the same package.
   Imports are the exception: as in Go, an import applies only to the file that
   declares it.
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
import "./geometry"

func main() {
    x := geometry.Add(1, 2)   // geometry package inlined into the bundle
}
```

### Imports belong to a file

Each file lists the packages it uses. A file that uses `strings` without importing it
reports `Undefined: 'strings'`, even when a sibling file imports it, and an import a
file never uses is an error, for an npm package without types as well as for a
standard-library or local one:

```go
// a.go
package main

import "strings"

func Upper(s string) string { return strings.ToUpper(s) }

// b.go
package main

func Lower(s string) string { return strings.ToLower(s) } // Undefined: 'strings'
```

A package exports only the names it declares: a name it imports, or dot-imports from
another package, is not reachable through it (`sub.Leaf` is an error when `sub` only
imports `leaf`). Import the package directly where you need it.

### Visibility between packages

As in Go, a name is exported when it starts with an uppercase letter (any Unicode
uppercase letter; `_` and `__name` are not). Another package can use only exported
names, on every target (`js`, `wasm` and `both`):

```go
// util/util.go
package util

type Rec struct {
    X int
    m int
}

func New(n int) Rec { return Rec{X: n, m: n} }
func (r Rec) twice() int { return r.m * 2 }
func secret() int { return 1 }
```

```go
// main.go
util.secret()           // name secret not exported by package util
var r util.Rec = util.New(7)
r.m                     // r.m undefined (cannot refer to unexported field m)
r.twice()               // r.twice undefined (cannot refer to unexported method twice)
util.Rec{1, 2}          // implicit assignment to unexported field m in struct literal of type util.Rec
util.Rec{m: 2}          // cannot refer to unexported field m in struct literal of type util.Rec
```

The same applies to unexported types (`var x util.secret`), to fields and methods that
reach you through an embedded struct or interface, to struct types written inline, and
to method expressions (`util.Rec.twice`). An exported field or method promoted through
an unexported embedded struct stays usable. Export the name, or move the code into the
package that owns it. A dot import (`import . "./util"`) binds only the exported
names, so `secret()` is undefined and `var b box` is an unknown type there. A package's own files, its `_test.go` files and the code the
compiler generates for it can use its unexported names.

---

## Type checking

GoFront performs static type checking before emitting any code, accurately tracking source
locations in error messages across multiple files:

```go
func greet(name string) {
    console.log("Hello, " + name)
}

greet(42)
// → Type error in src/main.go at line 5:7: cannot use int as string
//     5 | greet(42)
//           ^
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

A TypeScript tuple in return position maps to a Go multi-value result, and rest
parameters become variadic parameters, so hook-style APIs read like Go:

```ts
declare function useState(initialState: any): [state: any, setState: (value: any) => void];
declare function h(type: any, props?: any, ...children: any[]): VNode;
```

```go
count, setCount := useState(0) // assigning to a single variable is a compile error
```

### Typed browser globals

`document`, `window`, `fetch`, `console`, `localStorage`, `setTimeout`, `requestAnimationFrame`
and the other Web API globals are typed from the browser's own API, so a misspelled member or a
wrong argument is a compile error:

```go
document.getElementByID("app") // → No member 'getElementByID' in namespace Document
var w int = window.innerWidth  // whole-number members are int
resp := await fetch("/todos")  // resp is a fetch.Response
ok := resp.ok                  // bool
```

Typed globals need no import and add nothing to the generated code. A program that uses no
Web API never loads the declarations. Like any pointer or interface value they can be compared
with `nil` (`if document == nil`), which keeps a package testable without a DOM.

`document.querySelector` and `getElementById` return the generic `Element` (or `nil`), so a
member that only a specific element has needs a type assertion first. Import the package that
names the element types, and assert the type you expect; the assertion is free and emits no
runtime check:

```go
import "gofront/dom"

// before: input := document.querySelector(".todo-input")
input := document.querySelector(".todo-input").(dom.HTMLInputElement)
text := input.value
input.focus()
```

The same applies to `getContext`, which returns one of several context types (import `gofront/canvas` for the 2D one):

```go
import (
	"gofront/canvas"
	"gofront/dom"
)

el := document.getElementById("game").(dom.HTMLCanvasElement)
ctx := el.getContext("2d").(canvas.CanvasRenderingContext2D)
```

Event listeners take typed parameters, and a listener may leave parameters off:

```go
button.addEventListener("click", func(e dom.MouseEvent) { println(e.clientX) })
button.addEventListener("click", func() { save() })
```

Migrating an existing program, fix what the compiler reports:

- **A member the element type lacks** (`input.value`, `canvasEl.getContext`): assert the element type as above.
- **A number read as `int` or `float64`**: whole-number members such as `window.innerWidth` and `event.clientX` are `int`, fractional ones such as `rect.width` are `float64`. Convert where you mix them (`float64(e.clientX) > rect.top`).
- **A fractional timer delay** (`setTimeout(f, 10.5)`, or a `float64` variable): the delay of `setTimeout` and `setInterval` is an `int` number of milliseconds, so pass a whole number or convert with `int(delay)`.
- **An attribute or value parsed as a number** (`int(el.getAttribute("data-id"))`): the value is a string, so use `strconv.Atoi`.
- **A property the browser does not declare** (a custom `window.myConfig`, or a CSS property such as `style.display`): declare it in a `.d.ts` file you import with `js:` and assert to it, or use the API form (`style.setProperty("display", "none")`).
- **A library that adds globals** (PeerJS and similar): keep its `.d.ts` as before. Consumer declarations are unchanged.
- **A list passed as `[]any`** (`queue.submit([]any{cmd})`, a `"targets": []any{...}` member): a parameter or descriptor member that takes a list wants a slice of its element type, so write `queue.submit([]webgpu.CommandBuffer{cmd})` and `"targets": []webgpu.ColorTargetState{map[string]any{"format": "bgra8unorm"}}`.
- **A browser value used as a condition** (`if el {`): compare it instead, `if el != nil {`.
- **Indexing or ranging an element** (`el[0]`, `for range el`): an element is not a Go slice or map, so use its API (`el.children.item(0)`) or assert the value to the type you mean before indexing it.

The ECMAScript built-ins among the globals (`Math`, `JSON`, `Date`, `RegExp`, `Promise`, `Error`,
`Symbol`, `String`, `Number`, `Boolean`, `Array`, `Object`, `parseInt`, `parseFloat`, `isNaN`,
`isFinite`, `encodeURIComponent` and `decodeURIComponent`) are not part of the Web API and stay
dynamic: `JSON.stringify(todos)` and `Math.random() * 2` need
no assertions.

The types come from the `gofront/dom`, `gofront/canvas`, `gofront/fetch`, `gofront/websocket` and
`gofront/webgpu` packages, which are for `js` packages only. Import one to name its types
(`dom.HTMLInputElement`, `fetch.Response`, `websocket.WebSocket`, `webgpu.Device`).

---

