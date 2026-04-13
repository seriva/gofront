# Contributing to GoFront

## Getting started

```sh
git clone https://github.com/seriva/gofront.git
cd gofront
npm install
npm test
```

## Project layout

```
src/
  lexer.js        — tokenizer (Go-style semicolon insertion)
  parser.js       — recursive-descent parser → AST
  typechecker.js  — type inference and error reporting
  codegen.js      — AST → JavaScript (+ source maps)
  compiler.js     — multi-file / directory compilation
  resolver.js     — npm and local package resolution
  dts-parser.js   — TypeScript .d.ts type loader
  index.js        — CLI entry point
test/
  run.js          — test suite (no framework dependency)
  fixtures/       — .go and .d.ts files used by tests
example/
  src/          — GoFront source files (compiled to example/app.js)
  index.html    — static HTML/CSS
  app.js        — build output (generated)
```

## Running tests

```sh
npm test
```

The test suite runs entirely in Node — no browser required.

## CLI flags

```sh
node src/index.js <file.go>              # compile → stdout
node src/index.js <dir> -o out.js        # compile directory → file
node src/index.js <input> --check        # type-check only (no output)
node src/index.js <input> --watch        # watch mode — recompiles on change
node src/index.js <input> --source-map   # append inline source map
node src/index.js <input> --minify       # minify output with terser
node src/index.js <file.go> --ast        # dump AST (debug)
node src/index.js <file.go> --tokens     # dump tokens (debug)
node src/index.js init [dir]             # scaffold new project
```

## Making changes

1. Edit the relevant source file(s) in `src/`.
2. Add or update tests in `test/run.js` to cover the change.
3. Verify all tests pass: `npm test`.
4. Format code: `npm run format`.

## Compiler pipeline

```
source text
  → Lexer        (lexer.js)    → token stream
  → Parser       (parser.js)   → AST
  → TypeChecker  (typechecker.js) → annotated AST + errors
  → CodeGen      (codegen.js)  → JavaScript string
```

Each stage is a plain class. The easiest way to explore is to run
`gofront <file.go> --tokens` or `gofront <file.go> --ast`.

## Submitting a pull request

- Keep PRs focused — one feature or fix per PR.
- Include tests for new behaviour.
- Update `CHANGELOG.md` under an `## [Unreleased]` heading.
