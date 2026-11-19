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
- `//go:embed` compiles a file into a JS string literal or `Uint8Array` and, on `wasm`/`both`, into a string-table entry (`string`) or a passive data segment read with `array.new_data` and unpacked into `[]byte`: `test/unit/compiler/embed-js.test.js`, `test/unit/compiler/embed-wasm.test.js`, `test/unit/wasm/data-section.test.js`.
- Invalid directives (wrong variable type, pattern escaping the package directory, no match, misplaced directive, missing `embed` import) are compile errors with the messages in *Edge Cases* (`test/unit/compiler/embed-resolve.test.js`, `test/unit/types/embed-check.test.js`).
- `embed.FS.ReadFile` returns a fresh copy of the bytes of files matched by file, glob and directory patterns on `js`, `wasm` and `both` (`test/unit/stdlib/embed-fs.test.js`, `test/unit/compiler/embed-glob.test.js`, `test/unit/compiler/embed-manifest.test.js`).
- `docs/go-compatibility.md` and `docs/language-support.md` describe `//go:embed` and `embed.FS` (replacing the "not supported yet" rows); `npm test` passes and programs without `//go:embed` emit byte-identical output.

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

**Method.** `main` at `4eb69a6` (2026-11-17) and re-verified at `258d4148` (2026-11-19); probes in `.probes/web/` (deleted) with `compileDir` and Go 1.26 (`go build`).

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Directive lexing | The lexer records `//go:embed` comment positions but discards the patterns | `src/lexer/lexer.js:211`: pushes only `{ line, col }` to `this.embedDirectives` (`:159`) |
| Type checking | `//go:embed` is hard-coded as unsupported and package `embed` is excluded | `src/typechecker/index.js:471` (`_checkEmbedDirectives`: `//go:embed is not supported yet`); `src/typechecker/stdlib/excluded.js:49`. Probe: `import _ "embed"` + `//go:embed asset.txt` + `var text string` → both errors, so the import Go requires must be accepted in the same phase as the directive. Existing test `test/unit/language/declarations.test.js:977` asserts this old message |
| WASM data sections | `encodeModule` emits no Data (11) or DataCount (12) section and the GC opcode table has no `array.new_data`; `--emit-wat` prints no data segments. Also `[]byte` uses `(array (mut i32))`, not `(array (mut i8))` | `src/backend/wasm/encode.js` (`grep array.new_data` → none; `ValType.i8` `:104` and `array.get_u` `:385` already exist); `src/backend/wasm/wat.js`; `src/backend/wasm/types.js:154` (`byte` → `"i32"`). WASM strings are host strings from the module string table (`internString`, `src/backend/wasm/module-emitter.js:990`), so an embedded `string` needs no data segment; `[]byte` reads raw bytes into `(array (mut i8))` via `array.new_data` and unpacks into `(array (mut i32))` |

---

## Approach

### 1. Architecture & Design Decisions
- **Directive parsing:** `src/lexer/lexer.js` parses `//go:embed <pattern...>` into `{ line, col, patterns: string[] }`; patterns are space-separated and each is bare, double-quoted or back-quoted. `src/parser/declarations.js` attaches preceding consecutive directives to the following `VarSpec` (for standalone `var x T` and inside grouped `var ( //go:embed ...\n x T )`, never before `var (`). Because `parseVarDecl()` is shared with `src/parser/statements.js` for local `var`s, `parseTopDecl()` passes `topLevel = true`; directives before a local `var` stay flagged (`inFunc: true`) so the checker reports `go:embed cannot apply to var inside func`.
- **Import rule:** as in Go, each file that uses `//go:embed` must import `"embed"` (`import _ "embed"` for `string`/`[]byte`, checked per-file in `p.imports`, not package-wide). Phase 1 removes `embed` from `EXCLUDED_STDLIB_PACKAGES`, adds `stdlib/embed/embed.go` (package clause only until Phase 3), and adds `stdlib/embed/**` to `stdlib-mid` (order 11) in `.sentrux/rules.toml` so Phase 3 can import `errors` (`stdlib-leaf`, order 12).
- **Path resolution and security:** `src/compiler.js` resolves patterns before type-checking, relative to the source file's directory (`dirname(p._path)`), and attaches `{ path, bytes }[]` to `_embedFiles` on the directive (re-resolving on every compile so `_parseCache` never serves stale file bytes; the checker never reads files). Go's rules: no `.`/`..` elements, no leading or trailing slash, no absolute paths, no backslashes. Containment is checked on the real path with `relative()` + `isAbsolute()` (not `startsWith`, the v1.2.1 dev-server traversal bug), so a symlink out of the package directory is rejected.
- **Lowering:** `lowerEmbeds(programs)` in `src/lower/globals.js` (called from `lower()` in `src/lower/index.js` for WASM and from `CodeGen.generate()` in `src/backend/js/index.js` for JS) attaches a side-table initializer node `spec._embedData = { kind: "EmbedData", as: "string" | "bytes" | "fs", _files }` without mutating `spec.value` (preserving `_parseCache` across recompiles). Keeping file bytes under `_files` ensures `cloneAstForWasm` (`src/link/wasm.js`), `forEachChild` (`src/lower/walk.js`), and `_scanImportsInBody` (`src/backend/wasm/prescan.js`) skip `_`-prefixed keys in O(1) and preserve `Uint8Array` by reference.
- **JS:** `string` → a string literal (a non-UTF-8 file uses the existing raw-byte representation, lone surrogates U+DC80–U+DCFF as `decodeRawBytes` in `src/lexer/lexer.js` and `HELPER_U8ENC` do, so `[]byte(s)` round-trips); `[]byte` → a `Uint8Array` decoded at package init from base64 (an on-demand runtime helper registered in `HELPER_MAP` in `src/backend/js/index.js`, storing each unique file's base64 string once per module while decoding a fresh `Uint8Array` per variable so mutating one does not mutate another); `embed.FS` → an in-memory table of normalized paths, backed by `stdlib/embed/embed.go`.
- **WASM:** Section 12 (DataCount, in `sections` before code so `codeStart` / `mod.codeOffsets` for `--source-map` stays exact) and Section 11 (Data, after code and before `sourceMappingURL`) in `encode.js`, `array.new_data` in its GC opcode table, data segments in `wat.js`. Because GoFront represents `[]byte` as `(array (mut i32))` (`src/backend/wasm/types.js:154`), each unique embedded file is stored once as raw bytes in a passive data segment, materialized into a packed `(array (mut i8))` via `array.new_data`, and unpacked by one shared WASM helper (`array.get_u` + `array.set`) into a fresh `(array (mut i32))` slice header (zero linear memory; mutating one `[]byte` variable does not affect another); `string` → `internString`. Units are linked at AST level into one module (`src/link/wasm.js`), so segment indexes need no relocation.

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
  - Test: `test/unit/parser/embed-directives.test.js`: pattern extraction (bare, double-quoted, back-quoted, several on one line, multiple consecutive directives), attachment to standalone `var` and `VarSpec` inside grouped `var (...)`, `inFunc` flag for local `var` inside a function, and unattached directives staying in `_embedDirectives` (including before `var (`)
  - Done when: `//go:embed asset.txt "b c.txt"` attaches `{ patterns: ["asset.txt", "b c.txt"], line, col }` to the following package-level `VarSpec`; misplaced and local-`var` directives are preserved for the checker to reject
- [ ] Task 1.2: Resolve embed patterns to files before type-checking (former 1.2)
  - Files: `src/compiler.js`
  - Test: `test/unit/compiler/embed-resolve.test.js`, negative cases first: `..`, an absolute path, a backslash and a symlink out of the package → `embed pattern escapes package directory`; no match → `pattern <pat> matches no files`
  - Done when: every directive carries `_embedFiles: { path, bytes }[]` resolved relative to its file's directory on every compile (not stale across `_parseCache`), containment checked by `relative()`/`isAbsolute()` on the real path
- [ ] Task 1.3: Type-check embed variables and accept the `embed` import (former 1.3)
  - Files: `src/typechecker/index.js`, `src/typechecker/stdlib/excluded.js`, `stdlib/embed/embed.go`, `.sentrux/rules.toml`
  - Test: `test/unit/types/embed-check.test.js`: every message in *Edge Cases* (wrong type, misplaced directives, local `var` in `func`, per-file missing import, `multiple files for type string`); update `test/unit/language/declarations.test.js` where it asserted `//go:embed is not supported yet`
  - Done when: `import _ "embed"` compiles on every target; `string` and `[]byte` variables with one matched file pass; `//go:embed is not supported yet` is gone; `npm run check:layers` covers `stdlib/embed/**` (in `stdlib-mid`)

### Phase 2: Embedded `string` and `[]byte` on every target
- [ ] Task 2.1: Lower embed directives into `EmbedData` side-table nodes (split from former 1.4)
  - Files: `src/lower/globals.js`, `src/lower/index.js`
  - Test: `test/unit/compiler/embed-lower.test.js`: `lowerEmbeds` attaches `spec._embedData = { kind: "EmbedData", as, _files }` without mutating `spec.value`, and recompiling a cached AST does not trigger `var with initializer`
  - Done when: `lower()` populates `spec._embedData` for `string`, `[]byte`, and `embed.FS` directives and `spec.value` remains `null`
- [ ] Task 2.2: Emit embedded scalars in the JS backend (former 1.4)
  - Files: `src/backend/js/index.js`, `src/backend/js/expressions.js`, `src/backend/js/runtime.js`
  - Test: `test/unit/compiler/embed-js.test.js`: string content, `[]byte` with all 256 byte values, a non-UTF-8 `string` round-tripping through `[]byte(s)`, two `[]byte` vars embedding the same file store the base64 once but mutate independently, identical results after `--minify --mangle`
  - Done when: `CodeGen.generate()` runs `lowerEmbeds`, embedded variables initialize at package load, and the base64 decoder helper (in `HELPER_MAP`) is emitted only when a `[]byte` embed exists
- [ ] Task 2.3: Data and DataCount sections in the wasm encoder (former 1.5)
  - Files: `src/backend/wasm/encode.js`, `src/backend/wasm/module-emitter.js`, `src/backend/wasm/wat.js`
  - Test: `test/unit/wasm/data-section.test.js`: Section 12 before code (keeping `mod.codeOffsets` accurate for source maps), Section 11 after code, passive segment bytes, `array.new_data` encoding
  - Done when: `WebAssembly.validate` accepts modules with passive data segments and `--emit-wat` prints them
- [ ] Task 2.4: Emit embedded scalars in the wasm backend (former 1.6)
  - Files: `src/backend/wasm/globals.js`, `src/backend/wasm/emit-exprs.js`, `src/backend/wasm/module-emitter.js`
  - Test: `test/unit/compiler/embed-wasm.test.js`: `[]byte` via passive segment + `array.new_data` into `(array (mut i8))` unpacked to `(array (mut i32))` and `string` via the string table (including non-UTF-8 round-trip) in `wasm` and `both` packages, same bytes as JS, independent mutability for two `[]byte` vars on the same file; still valid after `--wasm-opt` when `binaryen` is installed
  - Done when: a `wasm` package reads an embedded `[]byte` with no linear-memory copy

### Phase 3: `embed.FS`
- [ ] Task 3.1: `embed.FS` with `ReadFile` in Go source (former 2.1)
  - Files: `stdlib/embed/embed.go`, `src/typechecker/stdlib/excluded.js`, `src/typechecker/index.js`
  - Test: `test/unit/stdlib/embed-fs.test.js`: zero-value `var f embed.FS` `ReadFile` miss returns `open <name>: file does not exist`; `var files embed.FS` under a directive type-checks (requiring non-blank `import "embed"`); `ReadDir` and `Open` are compile errors with the `EXCLUDED_STDLIB_MEMBERS` diagnostic
  - Done when: `embed.FS` and `ReadFile` compile on every target and `ReadDir`/`Open` produce targeted diagnostics
- [ ] Task 3.2: Glob and directory patterns (former 2.2)
  - Files: `src/compiler.js`
  - Test: `test/unit/compiler/embed-glob.test.js`: `shaders/*.wgsl`, a directory pattern (recursive, skipping `.`/`_` names), `all:assets`, `*` not crossing `/`, sorted results
  - Done when: globs and directory patterns populate `_embedFiles` with Go's semantics
- [ ] Task 3.3: File-table codegen for JS and wasm; docs (former 2.3)
  - Files: `src/lower/globals.js`, `src/backend/js/expressions.js`, `src/backend/wasm/emit-exprs.js` (plus `docs/go-compatibility.md`, `docs/language-support.md`)
  - Test: `test/unit/compiler/embed-manifest.test.js`: `ReadFile` hit returns a fresh copy (mutating the returned slice does not affect a second `ReadFile`), miss returns `open <name>: file does not exist`, lookup by path at run time on `js`, `wasm`, and `both`; a file embedded by two variables is stored once per module
  - Done when: `files.ReadFile("shaders/light.wgsl")` returns the contents on `js` and `wasm` and `docs/go-compatibility.md` / `docs/language-support.md` document `//go:embed` and `embed.FS`
