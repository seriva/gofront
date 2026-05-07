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
- **Never commit superpowers session artifacts.** Checkbox-driven plan files, `docs/superpowers/`, and agentic scaffolding are session-local only. Design docs belong exclusively in `docs/vX.Y.Z/<feature>-plan.md` using the narrative format (Goal → Approach → Edge Cases → Test Plan).
