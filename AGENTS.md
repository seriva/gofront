# GoFront Agent Guide

# Part 1: Agent Workflow
> [!IMPORTANT]
> **IMMUTABLE SECTION:** Do not modify Part 1 unless explicitly instructed. This is a universal standard. Only adjust Part 2 (Project Context) for project-specific needs.

## 1. Context & Rules
- **Map:** Maintain the `## Project Map` section in Part 2 natively using "caveman" style (extreme density, no grammar, `->` for correlations). Update on changes.
- **Caveman Speak:** Communicate, plan, and write docs in "caveman" style (extreme semantic density, zero fluff, drop grammar/articles). Maximize token efficiency.
- **Docs-first:** Create `docs/vX.Y.Z/<feature>-plan.md` before coding non-trivial features.
- **TDD:** Write failing tests first for non-trivial logic.
- **Quality:** Run format/lint before commits. Update `CHANGELOG.md` & `README.md`.
- **Verify:** Run tests/compiler or ask user to visually verify before concluding. Never assume.
- **Blockers:** Stop and ask user on ambiguity; do not guess.

## 2. Git Standards
- **Branches:** `main` is releasable (no direct commits). Use `feat/` or `fix/` -> PR.
- **Commits:** Conventional Commits (`type(scope): subject`). Subject ≤72 chars, imperative mood. Body explains *why*.
- **Artifacts:** Never commit agent-generated session artifacts (e.g., plan checklists).

---

# Part 2: Project Context

## Project Identity

GoFront is a Go-inspired language that compiles to JavaScript. The compiler is a pure Node.js ESM project (zero runtime dependencies) that takes `.go` and `.templ` source files through Lexer → Parser → TypeChecker → CodeGen to produce JavaScript output.

## Tech Stack

- **Node.js ESM** — pure ES modules, no CommonJS
- **Biome** — formatting and linting (`npm run format`, `npm run check`)
- **Sentrux** — architectural quality gate (layer boundaries, coupling, complexity, zero cycles)
- **Playwright** — E2E browser tests against compiled example apps
- **c8** — V8 code coverage for unit tests
- **No runtime dependencies** — the compiler has zero `dependencies` in package.json

## Architecture

The compiler pipeline lives in `src/` and flows strictly downward: `index.js` (CLI) → `cli-core.js` → `compiler.js` → `lexer.js` / `parser.js` → `typechecker.js` → `codegen.js`. Parser, TypeChecker, and CodeGen each have a subdirectory splitting concerns (declarations, types, statements, expressions). Standard library type knowledge lives in `typechecker/stdlib/`, package resolution in `resolver.js`, and `.d.ts` support in `dts-parser.js`. Tests live in `test/unit/` (organized by domain: `language/`, `types/`, `builtins/`, `compiler/`) and `test/e2e/`. Examples in `example/` (simple, reactive, gom, templ) serve as E2E fixtures and documentation.

## Core Rules & Anti-Patterns

- **Four Stages:** Every language feature must touch Lexer → Parser → TypeChecker → CodeGen. Add the AST node, type-check it, emit JS for it, and throw on unhandled kinds. Never skip a stage or use partial implementations.
- **Negative Tests Verify Messages:** Use `assertErrorContains(errors, "substring")` — never just `assert(errors.length > 0)`. Always write failing positive + negative tests first.
- **Never modify `src/index.js` for logic.** It is the CLI entry point only — business logic belongs in `cli-core.js` or deeper.
- **Never add runtime dependencies.** The compiler must remain zero-dependency; all stdlib support compiles to inline JS.
- **Never commit without `npm run check` passing.** This runs Biome lint, Sentrux quality gate, and GoFront type-checks on the examples.


## Project Map

- `src/` - **compiler**, **pipeline**, **core logic**
  - `index.js` - **CLI entry point** → invokes `cli-core.js`
  - `cli-core.js` - **CLI business logic** → orchestrates `compiler.js`
  - `compiler.js` - **core compiler pipeline integration** → flows through `lexer` → `parser` → `typechecker` → `codegen`
  - `lexer.js` - **tokenizer**, **lexical analysis** → feeds token stream to `parser`, uses `tokens.js`
  - `tokens.js` - **lexer tokens definition** → imported by `lexer.js` and `parser/`
  - `resolver.js` - **package resolution** → used by `typechecker/resolve.js`
  - `dts-parser.js` - **TypeScript `.d.ts` definitions parsing** → feeds ambient types to `typechecker/`
  - `minifier.js` - **code minification** → applied after `codegen/`
  - `dev-server.js` - **development server** → watches `src/` and rebuilds
  - `templ-lexer.js` - **templating lexer** → feeds `templ-parser.js`
  - `templ-parser.js` - **templating parser** → generates HTML AST for `codegen/templ.js`
  - `parser/` - **syntax analysis**, **AST**
    - `index.js` - **parser entry** → consumes `lexer.js` stream, outputs AST for `typechecker/`
    - `declarations.js` - **parsing declarations**
    - `expressions.js` - **parsing expressions**
    - `statements.js` - **parsing statements**
    - `types.js` - **parsing type definitions**
  - `typechecker/` - **semantic analysis**, **type validation**
    - `index.js` - **typechecker entry** → consumes AST from `parser/`, validates for `codegen/`
    - `assignability.js` - **type assignability rules** → enforces type safety
    - `expressions.js` - **typechecking expressions**
    - `statements.js` - **typechecking statements**
    - `types.js` - **type representations** → defines internal type AST
    - `resolve.js` - **type resolution** → uses `resolver.js` for imports
    - `termination.js` - **control flow**, **termination analysis** → checks return paths
    - `stdlib/` - **standard library typings**
      - `core.js` - **core built-in types** → injected into global scope
      - `extended.js` - **extended standard library types**
  - `codegen/` - **JavaScript generation**, **emission**
    - `index.js` - **codegen entry** → consumes validated AST from `typechecker/`, outputs final JS
    - `expressions.js` - **emitting expressions**
    - `statements.js` - **emitting statements**
    - `templ.js` - **emitting templating code** → consumes AST from `templ-parser.js`
    - `runtime.js` - **runtime helpers** → injected into output bundle
    - `source-map.js` - **source map generation**
    - `stdlib/` - **standard library JS implementations** → imported dynamically based on `typechecker` resolution
      - `builder.js`, `bytes.js`, `errors.js`, `fmt.js`, `gom.js`, `html.js`, `io.js`, `maps.js`, `math.js`, `os.js`, `path.js`, `rand.js`, `regexp.js`, `slices.js`, `sort.js`, `strconv.js`, `strings.js`, `time.js`, `unicode.js`, `utf8.js`
- `test/` - **testing suite**
  - `unit/` - **unit tests** (`c8` code coverage)
    - `builtins/` - **tests for builtins**
    - `compiler/` - **tests for compiler pipeline**
    - `language/` - **tests for language features**
    - `types/` - **tests for types**
    - `fixtures/` - **test fixtures**
    - `helpers.js`, `run.js` - **test runner utils**
    - `dom.test.js`, `lexer-parser.test.js`, `minifier.test.js`, `structs.test.js`, `templ.test.js`
  - `e2e/` - **Playwright E2E browser tests** → validates output against `example/` apps
    - `global-setup.js`, `helpers.js`, `selectors.js`
    - `gom.spec.js`, `reactive.spec.js`, `shared.spec.js`, `simple.spec.js`, `templ.spec.js`
- `example/` - **E2E fixtures**, **documentation apps**
  - `simple/`, `reactive/`, `gom/`, `templ/`
- `docs/` - **documentation**, **planning**, **version history**
  - `v0.0.5/` to `v1.0.1/` - **historical plans**
  - `roadmap.md` - **project roadmap**
- `AGENTS.md` - **Agent Guide**, **architecture rules**, **strict standards**
- `CHANGELOG.md` - **project changelog**
- `README.md` - **project overview**
- `biome.json` - **formatting**, **linting config**
- `package.json` - **dependencies**, **scripts** (`npm run check`)
- `playwright.config.js` - **E2E config**
