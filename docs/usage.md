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
gofront prep [dir] [--minify]                run asset copying + vendor bundling only (alias: gofront vendor)
gofront check <dir>                          type-check a single package
gofront check <dir>/...                      type-check every package under <dir> (Go-style `./...`)
gofront test <dir> [--dom]                   run tests for a single package
gofront test <dir>/... [--dom] [-v] [-run <regex>]  run tests recursively
gofront <file.go>                            compile single file → stdout
gofront <dir>                                compile all *.go in directory → stdout
gofront <input> -o out.js                    write output to file (prints elapsed compile time; hybrid projects also write app.wasm)
gofront <input> -o out.js --release          compile + minify + optimize wasm with Binaryen
gofront <input> -o out.js --wasm-opt         compile + optimize wasm with Binaryen
gofront <input> -o out.js --emit-wat         also write app.wat
gofront <input> -o out.js --copy-assets      compile + copy static assets
gofront <input> --check                      type-check only (single file / directory)
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
| `vendor` | `app/vendor.js` | Vendor bundle written by `prep`/`build` from `package.json` `dependencies`. Either a destination path string or `{ "dest": string \| string[], "packages": string[], "minify": boolean, "globals": { "<pkg>": string \| string[] } }` |
| `assetCopy` | `[]` | Static files copied by `prep`/`build`: `[{ "source": "node_modules/x/font.woff2", "dest": "app/fonts/font.woff2" }]` |

All settings live in this one place — top-level `"vendor"` / `"assetCopy"` keys in `package.json` are not read.

### Hybrid builds

When any package reached by the build carries `//gofront:target wasm` or `both`, `dev`,
`build` and `-o` also write a single `app.wasm` next to the JS bundle, and `--emit-wat`
adds a readable `app.wat`.

Passing `gofront build --release` (or `--wasm-opt`) optimizes the emitted WebAssembly
using Binaryen (`-O3` + GUFA), achieving ~23% smaller binary size and emitting `app.wasm.map`
when `--source-map` is enabled. In development (`gofront dev`), unoptimized WASM is served
directly for sub-10ms instant hot-reload. Everything about targets, boundary rules and the
loader is in the [Hybrid JS + WebAssembly Guide](hybrid-wasm.md).

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
```

- `testing.T` supports `Error`, `Errorf`, `Fatal`, `Fatalf`, `Fail`, `FailNow`, `Failed`,
  `Log`, `Logf`, `Skip`, `Skipf`, `Skipped`, `Helper`, `Run` and `Name`; `testing.Short()`
  and `testing.Verbose()` are available at package level.
- Output follows `go test`: `ok` / `FAIL` / `?  [no test files]` per package, non-zero exit
  when anything fails.
- `--dom` requires `jsdom` to be installed (it is a devDependency of GoFront itself; add it to
  your project when using a global install).
- Packages targeting `wasm` run inside the linked module, and `both` packages run once per
  backend (`pkg [js]`, `pkg [wasm]`). `t.Run` is not available in `wasm` test packages yet.
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

---

