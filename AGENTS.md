# GoFront — Agent & Contributor Guide

## Project overview

GoFront is a Go-inspired language that compiles to JavaScript. Source files use the `.go`
extension so editors apply Go syntax highlighting automatically. The compiler is a pure
Node.js ESM project with no runtime dependencies.

## Compiler pipeline

```
source text
  → Lexer        (src/lexer.js)        → token stream
  → Parser       (src/parser.js)       → AST
  → TypeChecker  (src/typechecker.js)  → annotated AST + error list
  → CodeGen      (src/codegen.js)      → JavaScript string
```

Multi-file packages are handled by `src/compiler.js`, which runs all four stages across
all files in a directory as a single unit. `src/resolver.js` resolves npm and `@types/`
packages. `src/dts-parser.js` parses TypeScript `.d.ts` declaration files.

## Commands

```sh
npm test          # run the full test suite (~990 tests, no browser required)
npm run format    # format with Biome
npm run check     # lint with Biome

node src/index.js <file.go>                       # compile single file → stdout
node src/index.js <dir> -o out.js                 # compile directory → file
node src/index.js <input> --check                 # type-check only
node src/index.js <input> --watch                 # watch mode
node src/index.js <input> -o out.js --serve       # watch + dev server with live reload (port 3000)
node src/index.js <input> -o out.js --serve --port 8080  # custom port
node src/index.js <input> --source-map            # append inline source map
node src/index.js <input> --minify                # minify output with terser
node src/index.js <input> --minify --mangle       # minify and mangle identifiers
node src/index.js <file.go> --ast                 # dump AST (debug)
node src/index.js <file.go> --tokens              # dump tokens (debug)
node src/index.js init [dir]                      # scaffold new project
node src/index.js --version                       # print version
```

## Repository layout

```
src/
  lexer.js          tokenizer — Go-style semicolon insertion
  parser.js         recursive-descent parser → AST (core + declarations)
  parser/
    types.js        type expression parsing (slice, map, struct, interface)
    statements.js   block, control flow, simple statements
    expressions.js  operator precedence, unary, postfix, primary, literals
  typechecker.js    type inference, interface satisfaction, error reporting (core)
  typechecker/
    types.js        shared type constants, predicates, Scope, TypeCheckError
    stdlib.js       browser globals + all built-in package registrations
    statements.js   checkBlock, checkStmt
    expressions.js  checkExpr, checkCall, checkBuiltin, checkCompositeLit
  codegen.js        AST → JavaScript (core + struct/function generation)
  codegen/
    source-map.js   VLQ encoder and source map builder
    statements.js   genBlock, genStmt, genFor, genSwitch, etc.
    expressions.js  genExpr, genCall, genCompositeLit, helpers
  compiler.js       multi-file / directory compilation entry point
  resolver.js       npm and local package type resolution
  dts-parser.js     TypeScript .d.ts loader
  dev-server.js     static file server + SSE live reload (used by --serve)
  index.js          CLI entry point
test/
  run.js            test suite orchestrator (no framework, plain Node vm)
  helpers.js        shared compile/run/assert helpers
  fixtures/         .go and .d.ts files used by tests
  structs.test.js   structs, embedded structs, methods
  dom.test.js       DOM (jsdom) and external .d.ts
  lexer-parser.test.js  lexer, parser, dts-parser, codegen
  minifier.test.js  minifier and mangler
  language/         core language feature tests (7 files)
  types/            type system and type checking tests (6 files)
  builtins/         built-in functions, operators, stdlib, gom tests (5 files)
  compiler/         multi-file packages, CLI, imports tests (3 files)
example/
  simple/             vanilla DOM todo app (default example)
    src/              GoFront source files
    index.html        minimal HTML shell
    app.js            build output
  reactive/           same app using reactive.js signals + d.ts imports
    src/              GoFront source files + browser.d.ts
    index.html        HTML shell (loads reactive.js)
    reactive.js       signals-based reactive framework
    app.js            build output
  gom/                gom stdlib example (uses gom.* built-in namespace directly)
    src/              todo app source (package main, no imports needed)
      main.go
      render.go
      store.go
      styles.go
      types.go
      utils/utils.go
    index.html        HTML shell
    app.js            build output
docs/
  ROADMAP.md          release history + upcoming roadmap
  v0.0.5/             design documents for v0.0.5 features
  v0.0.6/             design documents for v0.0.6 features
  v0.0.7/             design documents for v0.0.7 features (gom built-in)
  v0.0.8/             design documents for v0.0.8 features (stdlib completeness)
  v0.0.9/             design documents for v0.0.9 features (templ support)
```

## Key design decisions

- **Structs → ES6 classes** with a single destructured-object constructor.
  `Point{X: 1, Y: 2}` → `new Point({ X: 1, Y: 2 })`.
- **Multiple returns → JS arrays.** `return a, b` → `return [a, b]`.
  Destructuring at call sites: `let [a, b] = f()`.
- **nil → null**, slices → JS arrays, maps → plain JS objects.
- **Embedded struct fields are flattened** into the outer class constructor.
  Promoted methods are emitted as delegation stubs:
  `Greet(...__a) { return Greeter.prototype.Greet.call(this, ...__a); }`
- **Runtime helpers** (`__len`, `__append`, `__s`, `__sprintf`) are tree-shaken —
  only emitted when used.
- **`fmt` package** is a built-in namespace (no import needed); `fmt.Sprintf` etc.
  compile to a `__sprintf` helper. `fmt.Fprintf`/`Fprintln`/`Fprint` accept any writer,
  including `*strings.Builder` and `*bytes.Buffer`.
- **Standard library shims** — `strings`, `strconv`, `sort`, `math`, `errors`, `time`,
  `unicode`, `os`, `regexp`, `slices`, `maps`, `html`, and `io` are built-in namespaces
  (like `fmt`). They compile to inline JS with no runtime overhead: `strings` maps to JS
  string methods, `strconv` to `Number`/`parseInt`/`parseFloat`, `sort` to
  `Array.prototype.sort`, `math` to the `Math` object, `errors.New` is an identity,
  `time` wraps `Date.now()`, `regexp` wraps JS `RegExp` (inline `(?i)`-style flags are
  extracted automatically), `slices` maps to JS array methods, `maps` to `Object.*`,
  `html` to inline `.replace()` chains, and `io` provides `io.Writer` / `io.Reader`
  interface types. Functions that return `(value, error)` in Go emit two-element arrays.
- **`gom` package** is a built-in DOM-rendering namespace (no import needed). Every
  `gom.*` call emits an inline JS object with a `Mount(parent)` method. Includes element
  helpers (`gom.Div`, `gom.Span`, …), attribute helpers (`gom.Class`, `gom.Attr`, …),
  and control flow (`gom.If`, `gom.Map`, `gom.Text`).
- **`strings.Builder` / `bytes.Buffer`** — value types that compile to plain JS objects
  (`{ _buf: "" }` and `{ _buf: [] }`). Methods dispatch inline; no class is generated.
- **`async func` / `await`** are first-class syntax; async functions emit
  `async function` in JS.
- **`defer`** compiles to try/finally.
- **`error` type** is a plain JS string at runtime; `error("msg")` is an identity,
  `.Error()` returns the string itself.

## Development workflow — TDD

This project follows **test-driven development**. Always write tests before
implementing a feature or fixing a bug.

1. **Write failing tests first.** Add at least one positive test (compiles + runs
   correctly) and one negative test (type error produces the expected message) to
   the most relevant test file. Run the tests and confirm they fail for the
   expected reason.
2. **Implement the minimum code** to make the failing tests pass.
3. **Run the full suite** (`npm test`) and verify nothing else broke.
4. **Run the linter** (`npm run check`) and fix any reported issues.
5. **Refactor** if needed while keeping all tests green.
6. **Update CHANGELOG.md** — add an entry under `## [Unreleased]` describing what
   changed (use `### Added`, `### Fixed`, `### Changed`, or `### Removed` as
   appropriate).
7. **Update README.md** if the change affects user-facing behaviour, CLI flags,
   supported syntax, built-in packages, or known semantic differences.

For bug fixes, start by writing a test that reproduces the bug, confirm it fails,
then fix the code.

## Adding a language feature

1. **Tests** — write tests first (see TDD workflow above). Add them to the most
   relevant test file. Tests are split into directories (`test/language/`,
   `test/types/`, `test/builtins/`, `test/compiler/`) plus root-level files for
   structs, DOM, and lexer-parser. Run a single file with
   `node test/language/core.test.js`, or `npm test` for the full combined run.
   Confirm the new tests fail before proceeding.
2. **Lexer** (`src/lexer.js`) — add any new keywords or token types.
3. **Parser** (`src/parser.js`) — add grammar rules; return a new AST node kind.
   Expression parsing lives in `src/parser/expressions.js`, statements in
   `src/parser/statements.js`, type expressions in `src/parser/types.js`.
4. **TypeChecker** (`src/typechecker.js`) — handle the new node in `_checkExpr`
   (`src/typechecker/expressions.js`) or `checkStmt`
   (`src/typechecker/statements.js`); return the correct type.
5. **CodeGen** (`src/codegen.js`) — handle the new node in `genExpr`
   (`src/codegen/expressions.js`) or `genStmt` (`src/codegen/statements.js`);
   throw on unhandled kinds so failures are loud.
6. **Run tests** — all new and existing tests must pass (`npm test`).
7. **Run the linter** — `npm run check` must report no errors.
8. **CHANGELOG.md** — add an entry under `## [Unreleased]`.
9. **README.md** — update the supported syntax, built-in packages, or semantic
   differences table if the feature is user-facing.

## Type system

Types are plain JS objects:
```
{ kind: "basic",     name: "int"|"float64"|"string"|"bool"|"any"|"void"|"nil"|"error" }
{ kind: "slice",     elem: Type }
{ kind: "map",       key: Type, value: Type }
{ kind: "struct",    fields: Map<string,Type>, methods: Map<string,FuncType>, _embeds: Type[] }
{ kind: "interface", methods: Map<string,FuncType> }
{ kind: "func",      params: Type[], returns: Type[], variadic?: bool, async?: bool }
{ kind: "named",     name: string, underlying: Type }
{ kind: "pointer",   base: Type }
{ kind: "namespace", name: string, members: {[name]: Type} }  ← packages / fmt
{ kind: "builtin",   name: string }
{ kind: "tuple",     types: Type[] }  ← multiple return values
{ kind: "untyped",   base: "int"|"float64"|"string"|"bool" }  ← untyped constants
```

`ANY` is the recovery / unknown type — any operation on it is permitted without error.

Untyped types (`UNTYPED_INT`, `UNTYPED_FLOAT`, `UNTYPED_STRING`, `UNTYPED_BOOL`) are
produced by literals and const declarations without an explicit type. They coerce to
any compatible typed context via `assertAssignable`. Variables (`:=`, `var`) materialize
untyped → default type via `defaultType()`. Binary ops between untyped values stay
untyped; mixing untyped + typed yields the typed side.

## Known semantic differences from Go

See the "Semantic differences" table in README.md § Go Compatibility for the full list.
Key items to be aware of when working on the compiler:

- **All JS numbers are float64** — no integer overflow wrapping, precision only to 2⁵³.
- **Strings are UTF-16** — `len()` returns `.length`, `range` iterates JS characters.
- **Maps are plain objects** — insertion-order iteration, not randomised.
- **`error` is a plain string**, not an interface.
- **Pointers are transparent** — `&x` / `*p` are accepted syntax but no indirection.
- **Goroutines / channels / `select`** are not implemented.

## Testing conventions

- Tests are split across focused files in `test/` subdirectories; `test/run.js` is the orchestrator.
- Shared helpers live in `test/helpers.js`: `compile(src)`, `compileFile(path)`,
  `compileDir(dir)`, `runJs(js)`, `runInDom(js, html)`.
- Assertion helpers: `assertEqual`, `assertContains`, `assertErrorContains`, `assert`.
- Negative tests must call `assertErrorContains(errors, "substring")` — not just
  `assert(errors.length > 0)` — so the error message is verified too.
- Group related tests with `section("Name")` for readable output.
- Run a single file with `node test/language/core.test.js`, a directory's files
  individually, or the full suite with `npm test`.

### Writing a new test file

Every test file imports from `test/helpers.js` and follows this structure:

```js
import { fileURLToPath } from "node:url";
import { test, section, summarize, compile, runJs, assertEqual, assertErrorContains } from "../helpers.js";

section("Feature name");

test("descriptive name", () => {
  const { js, errors } = compile(`package main; ...`);
  assertEqual(errors.length, 0);
  assertEqual(runJs(js), "expected output");
});

test("rejects bad input", () => {
  const { errors } = compile(`package main; ...`);
  assertErrorContains(errors, "expected error substring");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(summarize() > 0 ? 1 : 0);
}
```

Key points:
- The `fileURLToPath` guard lets the file be run standalone (`node test/feature.test.js`)
  and also imported by `test/run.js` without triggering early exit.
- Wrap each case in `test(name, fn)` — the harness catches and reports errors.
- Use `section(title)` to group related tests under a heading.
- New test files must be registered in `test/run.js` to be included in `npm test`.

## Planning and roadmap

Release planning follows a docs-first workflow:

- **`docs/ROADMAP.md`** — the single source of truth for past releases and the current
  roadmap. Update this file when a release ships or when the scope of an upcoming release
  changes.
- **`docs/v0.0.X/`** — one subfolder per planned release, containing design documents for
  the features in that release. When starting work on a new release, create the folder and
  add a design document for each non-trivial feature before writing any code.

### Starting a new release

1. Create `docs/vX.Y.Z/` and add a `<feature>-plan.md` for each significant feature.
2. Add a `## vX.Y.Z` section to `docs/ROADMAP.md` with the theme and a feature table.
3. Implement the features following the TDD workflow above.
4. When the release ships, mark features ✓ in `docs/ROADMAP.md` and add a dated entry to
   `CHANGELOG.md`.

### Design document format

A plan file should cover:
- **Goal** — what Go behaviour is being matched and why it matters.
- **Approach** — which compiler stages are affected (Lexer / Parser / TypeChecker /
  CodeGen) and what the key changes are.
- **Edge cases** — known tricky inputs and how they are handled.
- **JS output examples** — concrete before/after code snippets.

## Changing the example app

See README.md § Examples for full descriptions of both apps.

```sh
npm run build:simple      # builds example/simple/app.js
npm run build:reactive    # builds example/reactive/app.js
npm run build:gom         # builds example/gom/app.js
```

Then open the respective `index.html` in a browser.
