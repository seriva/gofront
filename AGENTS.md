# GoFront — Agent & Contributor Guide

## Project Identity

GoFront is a Go-inspired language that compiles to JavaScript. The compiler is a pure Node.js ESM project (zero runtime dependencies) that takes `.go` and `.templ` source files through Lexer → Parser → TypeChecker → CodeGen to produce JavaScript output.

## Tech Stack

- **Node.js ESM** — pure ES modules, no CommonJS
- **Biome** — formatting and linting (`npm run format`, `npm run check`)
- **Sentrux** — architectural quality gate (layer boundaries, coupling, complexity, zero cycles)
- **Playwright** — E2E browser tests against compiled example apps
- **c8** — V8 code coverage for unit tests
- **No runtime dependencies** — the compiler has zero `dependencies` in package.json

## Core Standards

1. **Always use TDD.** Write failing tests first (positive + negative), implement the minimum to pass, then run the full suite (`npm run test:all`) and linter (`npm run check`).
2. **Every feature touches four stages.** Lexer → Parser → TypeChecker → CodeGen. Add the AST node, type-check it, emit JS for it, and throw on unhandled kinds.
3. **Negative tests verify error messages.** Use `assertErrorContains(errors, "substring")` — never just `assert(errors.length > 0)`.
4. **Update docs with code.** Every change must update `CHANGELOG.md` (under `## [Unreleased]`) and `README.md` if user-facing.
5. **Docs-first releases.** Create `docs/vX.Y.Z/<feature>-plan.md` design documents before writing any implementation code.

## Architecture

The compiler pipeline lives in `src/` and flows strictly downward: `index.js` (CLI) → `cli-core.js` → `compiler.js` → `lexer.js` / `parser.js` → `typechecker.js` → `codegen.js`. Parser, TypeChecker, and CodeGen each have a subdirectory splitting concerns (declarations, types, statements, expressions). Standard library type knowledge lives in `typechecker/stdlib/`, package resolution in `resolver.js`, and `.d.ts` support in `dts-parser.js`. Tests live in `test/unit/` (organized by domain: `language/`, `types/`, `builtins/`, `compiler/`) and `test/e2e/`. Examples in `example/` (simple, reactive, gom, templ) serve as E2E fixtures and documentation.

## Anti-Patterns

- **Never skip a compiler stage.** If you add syntax, it must be lexed, parsed, type-checked, *and* code-generated — no partial implementations.
- **Never add runtime dependencies.** The compiler must remain zero-dependency; all stdlib support compiles to inline JS.
- **Never use `assert(errors.length > 0)` as a negative test.** Always verify the exact error message substring.
- **Never modify `src/index.js` for logic.** It is the CLI entry point only — business logic belongs in `cli-core.js` or deeper.
- **Never commit without `npm run check` passing.** This runs Biome lint, Sentrux quality gate, and GoFront type-checks on the examples.

---

<details>
<summary><strong>Reference: Commands</strong></summary>

```sh
npm run build:all         # build all example apps
npm run build:simple      # builds example/simple/app.js
npm run build:reactive    # builds example/reactive/app.js
npm run build:gom         # builds example/gom/app.js
npm run build:templ       # builds example/templ/app.js
npm run test:unit         # run unit tests only (no browser required)
npm run test:e2e          # build all examples then run E2E tests (Playwright, headless Chromium)
npm run test:all          # run both unit and E2E
npm run test:coverage     # unit tests with V8 coverage report (via c8)
npm run format            # format with Biome
npm run check             # lint, architectural quality gate, and GoFront type-checks

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

</details>

<details>
<summary><strong>Reference: Repository Layout</strong></summary>

```
src/
  lexer.js          tokenizer — Go-style semicolon insertion
  templ-lexer.js    tokenizer for .templ files (mixed Go/HTML)
  parser.js         recursive-descent parser → AST (constructor, primitives, entry points)
  templ-parser.js   parser for templ declarations and HTML bodies
  parser/
    declarations.js top-level declarations (func, method, type, var, const)
    types.js        type expression parsing (slice, map, struct, interface)
    statements.js   block, control flow, simple statements
    expressions.js  operator precedence, unary, postfix, primary, literals
  typechecker.js    type inference, interface satisfaction, error reporting (core)
  typechecker/
    types.js        shared type constants, predicates, Scope, TypeCheckError
    stdlib.js       thin orchestrator — delegates to stdlib/core.js and stdlib/extended.js
    stdlib/
      core.js       browser globals, fmt, strings, bytes, strconv, sort, math, errors, time, unicode, os, slices, html, io
      extended.js   gom, maps, regexp, rand, utf8, path, strings.Builder/bytes.Buffer, built-in functions
    statements.js   checkBlock, checkStmt
    expressions.js  checkExpr, checkCall, checkBuiltin, checkCompositeLit
  codegen.js        AST → JavaScript (core + struct/function generation)
  codegen/
    source-map.js   VLQ encoder and source map builder
    statements.js   genBlock, genStmt, genFor, genSwitch, etc.
    expressions.js  genExpr, genCall, genCompositeLit, helpers
  compiler.js       compileSingleFile, compileDir, compileFiles — all compilation entry points
  resolver.js       npm and local package type resolution
  dts-parser.js     TypeScript .d.ts loader
  dev-server.js     static file server + SSE live reload (used by --serve)
  cli-core.js       runCompile, maybeMinify, handleInit — extracted for direct import in tests
  index.js          CLI entry point (arg parsing, file I/O, watch mode, process.exit only)
test/
  unit/             all unit tests
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
  e2e/              end-to-end browser tests (Playwright, v0.0.8)
example/
  simple/             vanilla DOM todo app (default example)
  reactive/           same app using reactive.js signals + d.ts imports
  gom/                gom stdlib example (uses gom.* built-in namespace directly)
docs/
  ROADMAP.md          release history + upcoming roadmap
  v0.0.5/ – v0.0.9/  design documents per release
```

</details>

<details>
<summary><strong>Reference: Key Design Decisions</strong></summary>

- **Structs → ES6 classes** with a single destructured-object constructor. `Point{X: 1, Y: 2}` → `new Point({ X: 1, Y: 2 })`.
- **Multiple returns → JS arrays.** `return a, b` → `return [a, b]`. Destructuring at call sites: `let [a, b] = f()`.
- **nil → null**, slices → JS arrays, maps → plain JS objects.
- **Embedded struct fields are flattened** into the outer class constructor. Promoted methods are emitted as delegation stubs.
- **Runtime helpers** (`__len`, `__append`, `__s`, `__sprintf`, `__equal`, `__cmul`, `__cdiv`, `__error`, `__errorIs`, `__timeFmt`, `__timeParse`, `__pathClean`) are tree-shaken — only emitted when used.
- **`fmt` package** is a built-in namespace (no import needed); `fmt.Sprintf` etc. compile to a `__sprintf` helper.
- **Standard library shims** — `strings`, `strconv`, `sort`, `math`, `errors`, `time`, `unicode`, `os`, `regexp`, `slices`, `maps`, `html`, and `io` are built-in namespaces. They compile to inline JS with no runtime overhead.
- **`gom` package** is a built-in DOM-rendering namespace. Every `gom.*` call emits an inline JS object with a `Mount(parent)` method.
- **`strings.Builder` / `bytes.Buffer`** — value types that compile to plain JS objects. Methods dispatch inline; no class is generated.
- **`async func` / `await`** are first-class syntax; async functions emit `async function` in JS.
- **`defer`** compiles to try/finally.
- **`error` type** compiles to `__error` objects `{ Error(), toString(), _msg, _cause }`.

</details>

<details>
<summary><strong>Reference: Type System</strong></summary>

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

`ANY` is the recovery / unknown type — any operation on it is permitted without error. `TAINTED_ANY` (`{ ..., _tainted: true }`) is returned from all error-recovery paths. Taint propagates through binary ops, selectors, calls, index, and slice expressions, short-circuiting before any further error is emitted.

Untyped types (`UNTYPED_INT`, `UNTYPED_FLOAT`, `UNTYPED_STRING`, `UNTYPED_BOOL`) are produced by literals and const declarations without an explicit type. They coerce to any compatible typed context via `assertAssignable`. Variables (`:=`, `var`) materialize untyped → default type via `defaultType()`.

</details>

<details>
<summary><strong>Reference: Known Semantic Differences from Go</strong></summary>

- **All JS numbers are float64** — no integer overflow wrapping, precision only to 2⁵³.
- **Strings are UTF-16** — `len()` returns `.length`, `range` iterates JS characters.
- **Maps are plain objects** — insertion-order iteration, not randomised.
- **`error` is a plain string**, not an interface.
- **Pointers are transparent** — `&x` / `*p` are accepted syntax but no indirection.
- **Goroutines / channels / `select`** are not implemented.

</details>

<details>
<summary><strong>Reference: Testing Conventions</strong></summary>

- Tests are split across focused files in `test/unit/` subdirectories; `test/unit/run.js` is the orchestrator.
- Shared helpers live in `test/unit/helpers.js`: `compile(src)`, `compileFile(path)`, `compileDir(dir)`, `runJs(js)`, `runInDom(js, html)`.
- Assertion helpers: `assertEqual`, `assertContains`, `assertErrorContains`, `assert`.
- Group related tests with `section("Name")` for readable output.
- Run a single file with `node test/unit/language/core.test.js`, or the full suite with `npm run test:all`.

### Writing a new test file

```js
import { fileURLToPath } from "node:url";
import { test, section, summarize, compile, runJs, assertEqual, assertErrorContains } from "./helpers.js";

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

- The `fileURLToPath` guard lets the file be run standalone and also imported by `test/run.js`.
- New test files must be registered in `test/unit/run.js` to be included in `npm run test:all`.

### E2E tests

- **Run with:** `npm run test:e2e` (automatically builds all examples first via `build:all`).
- Each example app has its own spec file (e.g., `simple.spec.js`, `reactive.spec.js`, `gom.spec.js`, `templ.spec.js`).

</details>

<details>
<summary><strong>Reference: Adding a Language Feature</strong></summary>

1. **Tests** — write tests first. Add them to the most relevant file in `test/unit/`. Confirm they fail before proceeding.
2. **Lexer** (`src/lexer.js` or `src/templ-lexer.js`) — add any new keywords or token types.
3. **Parser** (`src/parser.js` or `src/templ-parser.js`) — add grammar rules; return a new AST node kind. Subdirectory split: `declarations.js`, `types.js`, `statements.js`, `expressions.js`.
4. **TypeChecker** (`src/typechecker.js`) — handle the new node in `_checkExpr` or `checkStmt`; return the correct type.
5. **CodeGen** (`src/codegen.js`) — handle the new node in `genExpr` or `genStmt`; throw on unhandled kinds.
6. **Run tests** — `npm run test:all`.
7. **Run linter** — `npm run check`.
8. **CHANGELOG.md** — add entry under `## [Unreleased]`.
9. **README.md** — update if user-facing.

</details>

<details>
<summary><strong>Reference: Planning & Releases</strong></summary>

- **`docs/ROADMAP.md`** — single source of truth for past releases and the current roadmap.
- **`docs/v0.0.X/`** — one subfolder per planned release with design documents.

### Starting a new release

1. Create `docs/vX.Y.Z/` and add a `<feature>-plan.md` for each significant feature.
2. Add a `## vX.Y.Z` section to `docs/ROADMAP.md`.
3. Implement features following TDD.
4. When shipped, mark features ✓ in `docs/ROADMAP.md` and add a dated entry to `CHANGELOG.md`.

### Design document format

- **Goal** — what Go behaviour is being matched and why.
- **Approach** — which compiler stages are affected and key changes.
- **Edge cases** — known tricky inputs and handling.
- **JS output examples** — concrete before/after snippets.

</details>
