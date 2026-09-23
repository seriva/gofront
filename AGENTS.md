# GoFront Agent Guide

# Part 1: Agent Workflow
> [!IMPORTANT]
> **IMMUTABLE SECTION:** Do not modify Part 1 unless explicitly instructed. This is a universal standard. Only adjust Part 2 (Project Context) for project-specific needs.

## 1. Context & Rules
- **Caveman Speak:** Communicate in "caveman" style (extreme density, zero fluff, drop grammar, `->` for correlations). Exception: human-facing docs (`README`, `CHANGELOG`, plans) must remain readable.
- **Plan-first:** Create `docs/vX.Y.Z/<feature>-plan.md` & update roadmap for non-trivial (multi-component, arch-altering, risky) features.
- **TDD:** Write failing tests first for non-trivial logic (if applicable).
- **Quality:** Run format/lint before every commit. Update `CHANGELOG.md` & `README.md` before PR.
- **Verify:** Run tests/compiler or ask user to visually verify before concluding/PR. Never assume.
- **Blockers:** Stop and ask user on ambiguity; do not guess.
- **Scope:** Stick strictly to requested task/plan. No unrequested features/refactoring.
- **Dependencies:** Use existing packages/standard lib. Ask before adding new dependencies.
- **Stuck:** If same approach fails twice, stop and ask user. Do not retry blindly.
- **Code Preservation:** Do not delete existing comments, docstrings, or unrelated code unless explicitly instructed.

## 2. Git Standards
- **No Auto-Commit:** Never run `git commit`, `git push`, or history-rewriting commands unless the user explicitly asks in the current turn. Make changes, run quality gates, report, then wait for the user to commit or instruct.
- **Branches:** Default branch is releasable; the pre-commit hook is the gate. Commit directly to it. Use a `feat/` or `fix/` branch + PR only when the user asks or the change is risky enough to want CI green before merge.
- **Commits:** Conventional Commits (`type(scope): subject`). Subject ≤72 chars, imperative mood. Body explains *why*. One logical change per commit.
- **Artifacts:** Never commit temporary agent session files (e.g., scratchpads, task checklists). Official feature plans should be committed.
- **Security:** Never commit secrets/API keys. Ensure `.env` is gitignored.
- **Self-Review:** Review `git diff` before commit. Strip debug logs/stray changes.

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

