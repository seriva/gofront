# `//go:embed` — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Split out of the former `web-platform-evolution-plan.md` (its Phases 1–2) on 2026-11-17, re-probed that day; the milestone goal and the "No Runtime" invariant now live in `plans/roadmap.md` *v2.0.0*. [`incremental-builds-plan.md`](incremental-builds-plan.md) starts after this plan: embedded files become cache-key inputs and watch targets there (the former Task 2.4). Independent of the checker, `wasm` struct and value-store plans.  
**Release note:** `//go:embed` compiles files into the bundle at build time as a `string`, `[]byte` or `embed.FS` (`ReadFile`) on every target, so shaders, templates and data load with no network request.  

---

## Goal

Support Go's `//go:embed` directive and package `embed` on `js`, `wasm` and `both`: a file embedded as a `string` or `[]byte`, and a set of files embedded as an `embed.FS` read with `ReadFile`, with Go's directive placement rules, Go's pattern semantics and a path check that cannot escape the package directory.

**Done means:**
- `//go:embed` compiles a file into a JS string literal or `Uint8Array` and, on `wasm`/`both`, into a string-table entry (`string`) or a passive data segment read with `array.new_data` (`[]byte`): `test/unit/compiler/embed-js.test.js`, `test/unit/compiler/embed-wasm.test.js`, `test/unit/wasm/data-section.test.js`.
- Invalid directives (wrong variable type, pattern escaping the package directory, no match, misplaced directive, missing `embed` import) are compile errors with the messages in *Edge Cases* (`test/unit/compiler/embed-resolve.test.js`, `test/unit/types/embed-check.test.js`).
- `embed.FS.ReadFile` returns the bytes of files matched by file, glob and directory patterns on `js`, `wasm` and `both` (`test/unit/stdlib/embed-fs.test.js`, `test/unit/compiler/embed-glob.test.js`, `test/unit/compiler/embed-manifest.test.js`).
- `docs/` describes `//go:embed` and `embed.FS` (replacing the "not supported yet" rows); `npm test` passes and programs without `//go:embed` emit byte-identical output.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | `//go:embed` on package-level `string`, `[]byte` and `embed.FS` variables with Go's rules | `import _ "embed"`, `//go:embed a.txt`, `//go:embed shaders/*.wgsl`, `all:assets` | |
| **In scope: target-specific** | Target-specific representation | JS: string literal / base64-decoded `Uint8Array` / path table. WASM: string-table entry (`string`), passive data segment via `array.new_data` (`[]byte`) | Idiomatic per backend; same bytes on every target |
| **Excluded: deferred** | `embed.FS` beyond `ReadFile` | `ReadDir`, `Open`, `fs.FS`, package `io/fs` | `io/fs` is excluded (`src/typechecker/stdlib/excluded.js`) and enumeration needs its own design; `ReadDir`/`Open` get a targeted diagnostic (user decision 2026-11-13) |
| **Excluded: deferred** | Watching embedded files in `gofront dev` | the former Task 2.4 | [`incremental-builds-plan.md`](incremental-builds-plan.md) Phase 2, with the other cache and watch inputs |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6`, 2026-11-17; probes in `.probes/web/` (deleted) with `compileDir`.

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Directive lexing | The lexer records `//go:embed` comment positions but discards the patterns | `src/lexer/lexer.js:211`: pushes only `{ line, col }` to `this.embedDirectives` (`:159`) |
| Type checking | `//go:embed` is hard-coded as unsupported and package `embed` is excluded | `src/typechecker/index.js:451` (`//go:embed is not supported yet`); `src/typechecker/stdlib/excluded.js:49`. Probe: `import _ "embed"` + `//go:embed asset.txt` + `var text string` → both errors, so the import Go requires must be accepted in the same phase as the directive |
| WASM data sections | `encodeModule` emits no Data (11) or DataCount (12) section and the GC opcode table has no `array.new_data`; `--emit-wat` prints no data segments | `src/backend/wasm/encode.js` (`grep array.new_data` → none); `src/backend/wasm/wat.js`. WASM strings are host strings from the module string table (`internString`, `src/backend/wasm/module-emitter.js`), so an embedded `string` needs no data segment; only `[]byte` does |

---

## Approach

### 1. Architecture & Design Decisions
- **Directive parsing:** `src/lexer/lexer.js` parses `//go:embed <pattern...>` into `{ line, col, patterns: string[] }`; patterns are space-separated and each is bare, double-quoted or back-quoted. `src/parser/declarations.js` attaches preceding directives to the following package-level `VarDecl`.
- **Import rule:** as in Go, a file that uses `//go:embed` must import `embed` (`import _ "embed"` for `string`/`[]byte`). Phase 1 removes `embed` from `EXCLUDED_STDLIB_PACKAGES` and adds `stdlib/embed/embed.go` (package clause only until Phase 3).
- **Path resolution and security:** `src/compiler.js` resolves patterns before type-checking, relative to the source file's directory, and attaches `{ path, bytes }[]` to the directive (the checker never reads files). Go's rules: no `.`/`..` elements, no leading or trailing slash, no absolute paths, no backslashes. Containment is checked on the real path with `relative()` + `isAbsolute()` (not `startsWith`, the v1.2.1 dev-server traversal bug), so a symlink out of the package directory is rejected.
- **Lowering:** `src/lower/globals.js` turns an embed `VarDecl` into an initializer node `EmbedData { files, as: "string" | "bytes" | "fs" }`, one node kind for both backends.
- **JS:** `string` → a string literal (a non-UTF-8 file uses the existing raw-byte representation, lone surrogates U+DC80–U+DCFF as `HELPER_U8ENC` does, so `[]byte(s)` round-trips); `[]byte` → a `Uint8Array` decoded once at package init from base64 (an on-demand runtime helper); `embed.FS` → an in-memory table of normalized paths, backed by `stdlib/embed/embed.go`.
- **WASM:** Section 12 (DataCount, before code) and Section 11 (Data, after code) in `encode.js`, `array.new_data` in its GC opcode table, data segments in `wat.js`. `[]byte` → a passive segment read with `array.new_data $array_byte $data_idx` plus slice-header construction (no linear memory); `string` → `internString`. Units are linked at AST level into one module (`src/link/wasm.js`), so segment indexes need no relocation.

### 2. Invariants & Safety Bounds
- `//go:embed` behaves identically on `js`, `wasm` and `both`; the same bytes on every target.
- No runtime network request and no runtime dependency; the compiler stays dependency-free.
- Programs without `//go:embed` emit byte-identical JS and wasm.
- Every new `src/**/*.js` and `stdlib/**/*.go` file is covered by a layer glob in `.sentrux/rules.toml`; `stdlib/embed/` needs a new entry.

### 3. Edge Cases & Error Handling
- **Path traversal:** `//go:embed ../secrets.env`, absolute paths, paths with `\`, and symlinks out of the package directory → `embed pattern escapes package directory`.
- **No match:** `pattern <pat> matches no files`.
- **Wrong type:** `cannot embed into variable of type <type>`.
- **Misplaced directives (Go's wording):** `go:embed cannot apply to var inside func`, `go:embed cannot apply to multiple vars`, `go:embed cannot apply to var with initializer`, `go:embed only allowed in Go files that import "embed"`; more than one file for `string`/`[]byte` → `multiple files for type <type>`.
- **Glob semantics are Go's:** `*` never crosses `/` (`path.Match`); a directory pattern embeds the tree, skipping names starting with `.` or `_` unless prefixed `all:`; matches are sorted.
- **Content:** a non-UTF-8 `string` embed round-trips through `[]byte(s)`; a `[]byte` embed keeps all 256 byte values through `--minify --mangle`; `js` and `wasm` output of a `both` package hold the same bytes; a file embedded by two variables is stored once per module.
- **`embed.FS` misses:** `ReadFile` of an unknown path returns `open <name>: file does not exist`; `ReadDir` and `Open` are compile errors through `EXCLUDED_STDLIB_MEMBERS`.

---

## Implementation Tasks

> Split from the former `web-platform-evolution-plan.md` Phases 1–2 (re-probed 2026-11-17). Former task IDs in parentheses.

### Phase 1: Directives, patterns and the `embed` import
- [ ] Task 1.1: Lex and parse `//go:embed` directives into AST var declarations (former 1.1)
  - Files: `src/lexer/lexer.js`, `src/parser/declarations.js`, `src/parser/index.js`
  - Test: `test/unit/parser/embed-directives.test.js`: pattern extraction (bare, double-quoted, back-quoted, several on one line) and AST attachment
  - Done when: `//go:embed asset.txt "b c.txt"` attaches `{ patterns: ["asset.txt", "b c.txt"], line, col }` to the following package-level `VarDecl`; a directive with no such declaration stays in `_embedDirectives` for the checker to reject
- [ ] Task 1.2: Resolve embed patterns to files before type-checking (former 1.2)
  - Files: `src/compiler.js`
  - Test: `test/unit/compiler/embed-resolve.test.js`, negative cases first: `..`, an absolute path, a backslash and a symlink out of the package → `embed pattern escapes package directory`; no match → `pattern <pat> matches no files`
  - Done when: every directive carries `{ path, bytes }[]` resolved relative to its file's directory, containment checked by `relative()`/`isAbsolute()` on the real path
- [ ] Task 1.3: Type-check embed variables and accept the `embed` import (former 1.3)
  - Files: `src/typechecker/index.js`, `src/typechecker/stdlib/excluded.js`, `stdlib/embed/embed.go`
  - Test: `test/unit/types/embed-check.test.js`: every message in *Edge Cases* (wrong type, misplaced directives, missing import, `multiple files for type string`)
  - Done when: `import _ "embed"` compiles on every target; `string` and `[]byte` variables with one matched file pass; `//go:embed is not supported yet` is gone; `npm run check:layers` covers `stdlib/embed/`

### Phase 2: Embedded `string` and `[]byte` on every target
- [ ] Task 2.1: Lower and emit embedded scalars in the JS backend (former 1.4)
  - Files: `src/lower/globals.js`, `src/backend/js/expressions.js`, `src/backend/js/runtime.js`
  - Test: `test/unit/compiler/embed-js.test.js`: string content, `[]byte` with all 256 byte values, a non-UTF-8 `string` round-tripping through `[]byte(s)`, identical results after `--minify --mangle`
  - Done when: embedded variables initialize at package load; the base64 decoder is emitted only when a `[]byte` embed exists
- [ ] Task 2.2: Data and DataCount sections in the wasm encoder (former 1.5)
  - Files: `src/backend/wasm/encode.js`, `src/backend/wasm/module-emitter.js`, `src/backend/wasm/wat.js`
  - Test: `test/unit/wasm/data-section.test.js`: Section 12 before code, Section 11 after it, passive segment bytes, `array.new_data` encoding
  - Done when: `WebAssembly.validate` accepts modules with passive data segments and `--emit-wat` prints them
- [ ] Task 2.3: Emit embedded scalars in the wasm backend (former 1.6)
  - Files: `src/backend/wasm/globals.js`, `src/backend/wasm/emit-exprs.js`
  - Test: `test/unit/compiler/embed-wasm.test.js`: `[]byte` via `array.new_data` and `string` via the string table in `wasm` and `both` packages, same bytes as JS; still valid after `--wasm-opt` when `binaryen` is installed
  - Done when: a `wasm` package reads an embedded `[]byte` with no linear-memory copy

### Phase 3: `embed.FS`
- [ ] Task 3.1: `embed.FS` with `ReadFile` in Go source (former 2.1)
  - Files: `stdlib/embed/embed.go`, `src/typechecker/stdlib/excluded.js`, `src/typechecker/index.js`
  - Test: `test/unit/stdlib/embed-fs.test.js`: `ReadFile` hit returns a copy, miss returns `open <name>: file does not exist`; `ReadDir` and `Open` are compile errors with the `EXCLUDED_STDLIB_MEMBERS` diagnostic
  - Done when: `var files embed.FS` under a directive type-checks (non-blank `import "embed"`) and `ReadFile` works on every target
- [ ] Task 3.2: Glob and directory patterns (former 2.2)
  - Files: `src/compiler.js`
  - Test: `test/unit/compiler/embed-glob.test.js`: `shaders/*.wgsl`, a directory pattern (recursive, skipping `.`/`_` names), `all:assets`, `*` not crossing `/`, sorted results
  - Done when: globs and directory patterns populate the file table with Go's semantics
- [ ] Task 3.3: File-table codegen for JS and wasm; docs (former 2.3)
  - Files: `src/lower/globals.js`, `src/backend/js/expressions.js`, `src/backend/wasm/globals.js`
  - Test: `test/unit/compiler/embed-manifest.test.js`: lookup by path at run time; a file embedded by two variables is stored once; `docs/` `//go:embed` section and compatibility rows
  - Done when: `files.ReadFile("shaders/light.wgsl")` returns the contents on `js` and `wasm`
