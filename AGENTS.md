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
npm test          # run the full test suite (~600 tests, no browser required)
npm run format    # format with Biome
npm run check     # lint with Biome

node src/index.js <file.go>              # compile single file → stdout
node src/index.js <dir> -o out.js        # compile directory → file
node src/index.js <input> --check        # type-check only
node src/index.js <input> --watch        # watch mode
node src/index.js <input> --source-map   # append inline source map
node src/index.js <input> --minify       # minify output with terser
node src/index.js <file.go> --ast        # dump AST (debug)
node src/index.js <file.go> --tokens     # dump tokens (debug)
node src/index.js init [dir]             # scaffold new project
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
  index.js          CLI entry point
test/
  run.js            test suite orchestrator (no framework, plain Node vm)
  helpers.js        shared compile/run/assert helpers
  fixtures/         .go and .d.ts files used by tests
  structs.test.js   structs, embedded structs, methods
  dom.test.js       DOM (jsdom) and external .d.ts
  lexer-parser.test.js  lexer, parser, dts-parser, codegen
  language/         core language feature tests (4 files)
  types/            type system and type checking tests (3 files)
  builtins/         built-in functions, operators, stdlib tests (3 files)
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
  compile to a `__sprintf` helper.
- **Standard library shims** — `strings`, `strconv`, `sort`, `math`, `errors`, and
  `time` are built-in namespaces (like `fmt`). They compile to inline JS: `strings`
  maps to JS string methods, `strconv` to `Number`/`parseInt`/`parseFloat`, `sort` to
  `Array.prototype.sort`, `math` to the `Math` object, `errors.New` is an identity,
  and `time` wraps `Date.now()`. Functions that return `(value, error)` in Go emit
  two-element arrays.
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
4. **Refactor** if needed while keeping all tests green.

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
6. **Run tests** — all new and existing tests must pass.
7. **CHANGELOG.md** — add an entry under `## [Unreleased]`.

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

process.exit(summarize());
```

Key points:
- Each file must end with `process.exit(summarize())` to report results and exit
  with a non-zero code on failure.
- Wrap each case in `test(name, fn)` — the harness catches and reports errors.
- Use `section(title)` to group related tests under a heading.
- New test files must be registered in `test/run.js` to be included in `npm test`.

## Changing the example app

See README.md § Examples for full descriptions of both apps.

```sh
npm run build:simple      # builds example/simple/app.js
npm run build:reactive    # builds example/reactive/app.js
```

Then open the respective `index.html` in a browser.
