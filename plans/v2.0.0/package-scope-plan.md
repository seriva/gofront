# Package Scope: Imports and Exports — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Split out of the former `followup-fixes-plan.md` (now [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md)) on 2026-11-17 by root cause: its former Phase 7 (L6–L10) and export visibility (F5, F29, plus the ledger entry *Struct literals*), re-probed that day. Export visibility on every target is a user decision (2026-11-17). Must merge before [`incremental-builds-plan.md`](incremental-builds-plan.md), which restructures `src/compiler.js`. L4 (a local type named after an import) has the same root as `checker-go-rules-plan.md` R8 (`mangleLocalTypes` reserves too few names) and is scheduled there.  
**Release note:** **Breaking:** an import now applies only to the file that declares it, as in Go, and an unused npm import is an error like any other unused import; add the import to each file that uses the package and remove unused ones. **Breaking:** a package can no longer use another package's unexported names, methods or fields (including positional struct literals that set them), on every target; export the name or move the code into that package. Packages now export only the names they declare, and using a type from an npm package in a WebAssembly package reports a clear error.  

---

## Goal

Make package boundaries work the way Go's do: imports are bound per file, tracked for use, and never part of the package's own declarations; and another package sees only exported names. Today every import kind is bound into the package-wide `globals` by a different path (`defineUntypedImport`, `addDefinitions` for `.d.ts` values, `addPackageNamespace` for GoFront packages), and only the last one is tracked for unused-import errors. That one root explains imports leaking between files, unused npm imports passing, and `.d.ts` names leaking into a package's exports. A second root, resolving `X.T` without checking what `X` is, explains the wrong errors for qualified types from npm imports and from JS values. A third root, no selector into another package checking export, lets unexported names, methods and fields cross package boundaries on every target.

**Done means:**
- Every failing row in *Verified Gaps* gives Go's error (or GoFront's documented message for npm imports) with line:col on every target its row names, as a test in the file its task names.
- `npm run check` (`gofront check example/...`), the stdlib build and `npm run test:e2e` pass after `example/simple` gains the imports it uses.
- `npm test` passes; emitted JS for single-file packages is byte-identical (`bundle-size.baseline.json` unchanged).
- `docs/` describes file-scoped imports, the unused npm import error and package visibility; the release note names both breaking changes.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `package-wide-imports`: every import (GoFront package, stdlib, typed `.d.ts`, untyped npm, dot, renamed) is bound in the importing file's scope, tracked for use, and excluded from the package's exports | I1.1–I1.7 | |
| **In scope: core** | Root `qualified-type-names`: `X.T` in a type or composite-literal position resolves `X` first (package namespace, npm import, value) and reports by kind | I2.1–I2.2 | |
| **In scope: core** | Root `export-visibility`: a reference from another package to an unexported (or `__`) name, method or field is a compile error on every target, as in Go | E1–E5 | User decision 2026-11-17: all targets (breaking for `js`/`both`) |
| **Excluded: deferred** | Local type named after an import (L4) | `func other() int { type strings = int; … }` breaks `strings.ToUpper` elsewhere | Root `predeclared-scope` (`mangleLocalTypes` reserved set), [`checker-go-rules-plan.md`](checker-go-rules-plan.md) Phase 8 |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6`, 2026-11-17. A throwaway driver (`.probes/ff/`, deleted) wrote each project into a temp directory (with `node_modules/<pkg>/index.d.ts` where needed) and compiled it with `compileHybridProject` (`test/unit/helpers.js:424`, `compileDir`). `nope/zzz` has no type declarations (untyped import). *sibling* rows were found by probing the root's other paths. `example/` and `stdlib/` were scanned on 2026-11-16 for files using a sibling file's import: only `example/simple/src/main.go` (`errors`, `utils`) and `store.go` (`utils`).

### I1 `package-wide-imports`

Root: `defineUntypedImport` (`src/typechecker/index.js:183`) defines untyped npm imports in `this.globals`; `.d.ts` values go into `globals` through `checker.addDefinitions` (`src/compiler.js:340`); GoFront packages through `addPackageNamespace` (`:428`), which is the only path that calls `trackImport` (`:441`). `getExportedSymbols` (`index.js:246`) exports every uppercase name in `globals`, including the imported `.d.ts` values.

| ID | Project | Go / want | GoFront |
|---|---|---|---|
| I1.1 (L10) | `a.go` imports `nope/zzz` and uses `zzz.F()`; `b.go` uses `zzz.G()` without importing | `Undefined: 'zzz'` at `b.go` | compiles; `ReferenceError: zzz is not defined` at run time |
| I1.2 (L10b) | `a.go` imports `strings`; `b.go` uses `strings.ToUpper` without importing | `undefined: strings` at `b.go` | prints `b A` on all targets |
| I1.3 *sibling* | `a.go` has `import s "strings"`; `b.go` uses `s.ToUpper("b")` | `undefined: s` | prints `B` |
| I1.4 (L6) | `wasm` package `import "nope/zzz"`, unused | `'zzz' imported and not used` | prints `ok` |
| I1.5 (L6b) | `wasm` package `import . "nope/zzz"` | `js: imports are not allowed in wasm packages` | prints `ok` |
| I1.6 (L6c) | `js` package `import "nope/zzz"`, unused | `'zzz' imported and not used` | prints `ok` (an unused `import "strings"` is already rejected) |
| I1.7 (L8) | `sub` imports `mydep` (`export declare const Bar: number;`); `main` uses `sub.Bar` | compile error: `sub` has no `Bar` | compiles; `ReferenceError: Bar is not defined` |

### I2 `qualified-type-names`

Root: type positions resolve `zzz.T` as a type name before checking what `zzz` is, and a composite literal's type is not checked to be a type when its qualifier is a value.

| ID | Program | Want | GoFront |
|---|---|---|---|
| I2.1 (L7) | `wasm` package: `import "nope/zzz"; var x zzz.T` | `'zzz.T' is only available in js packages` | `Unknown type 'zzz.T'` (no line:col) |
| I2.2 (L9) | `_ = console.T{}` | `console.T is not a type` (Go: `undefined: console`) | js/both compile and run; wasm ICE `Unknown struct in CompositeLit: any` |
| control | `var x console.T` | `Unknown type 'console.T'` | correct |

### I3 `export-visibility`

Root: no selector into another package checks export. `_namespaceMemberError` (`src/typechecker/resolve.js`) treats only `a`–`z` as unexported, so `__Answer` passes; selectors on values (`fieldType`, `_fieldTypeStruct`) and positional composite literals never check the owning package. On `wasm` packages the facade omits unexported members, so these crash at run time; on `js`/`both` they run. Re-probed 2026-11-17 with `compileHybridProject` (`util` package, `main` uses it).

| ID | Project | Go | GoFront |
|---|---|---|---|
| E1 (F5) | `util` (`wasm`): `func __Answer() int`; `util.__Answer()` | `name __Answer not exported by package util` | `ReferenceError: __Answer$ is not defined` |
| E2 (F29) | `util` (`wasm`): `func (r Rec) twice() int`; `util.New(7).twice()` | `util.New(7).twice undefined (cannot refer to unexported method twice)` | `TypeError: New(...).twice is not a function` |
| E3 | `util` targeting `js` or `both`: `util.__Answer()`, `util.New(7).twice()` | rejected | print `42`, `14` |
| E4 | `util.New(7).m` (unexported field), `util` targeting `js` or `both` | rejected | prints `7` |
| E5 (ledger *Struct literals*) | `type S struct { A int; b int }`; `_ = sub.S{1, 2}` / `util.Rec{1}` | `implicit assignment to unexported field` | compiles; prints `1` |

---

## Approach

### 1. Architecture & Design Decisions
- **Per-file import scope (I1).** The checker keeps `fileScopes: Map<filename, Scope>` between the package scope and the universe; each file's scope holds its package qualifiers, typed `.d.ts` namespaces, untyped npm globals and dot-imported names. Lookups use `_currentFile`. `addDefinitions`, `defineUntypedImport` and `addPackageNamespace` take the importing file and bind there; every one calls `trackImport`, so all import kinds report `imported and not used` the same way. `.d.ts` values bound by a typed import are reached through the import's namespace or, for the existing global-style `.d.ts` bindings, through the file scope; they are no longer in `globals`, so `getExportedSymbols` only sees declared names.
- **Qualified names (I2).** `resolveTypeNode` for a `SelectorExpr`/qualified `TypeName` looks up the qualifier first: a package namespace resolves the member type; an untyped import in a `wasm`/`both` package reports `_errJsOnly`; a value reports `X.T is not a type`. The composite-literal check applies the same lookup before the backend sees the literal.

- **Export visibility (I3).** One predicate `isExported(name)` (Go's rule: first character is a Unicode uppercase letter, `/\p{Lu}/u`) and one check `_checkForeignMember(ownerPkg, name, node)` applied by `_namespaceMemberError` (package-level names), `fieldType`/`_fieldTypeStruct` (fields and methods of values whose type is declared in another package, including promoted members) and composite-literal checking (keyed and positional elements setting unexported fields of a foreign struct). Messages follow Go: `name X not exported by package p`, `… (cannot refer to unexported field x)`, `implicit assignment to unexported field x in struct literal of type p.T`.

### 2. Invariants & Safety Bounds
- Single-file packages, and multi-file packages where every file imports what it uses, compile to byte-identical JS.
- Generated files declare their own imports: the test main, `gofront_gen.go` and fmt formatters (`src/lower/fmt-formatters.js`) do not rely on a sibling file's imports.
- Stdlib packages compile unchanged (any file relying on a sibling's import is fixed in the same task and listed).

### 3. Edge Cases & Error Handling
- Two files import the same path under different names; one file imports it twice under two names.
- A `_test.go` file imports what it uses; the generated test main gets its own imports.
- Dot imports bind into the importing file only; a name dot-imported by two files from different packages is not a conflict.
- A blank import (`import _ "x"`) stays a side-effect import and is never "unused".
- **Export visibility:** non-ASCII uppercase (`util.Ä()`) stays exported; methods promoted from an embedded foreign type follow the embedded type's package; a package's own `_test.go` files may use its unexported names; generated code is exempt only where it is the owning package.
- **Migration:** `example/simple/src/main.go` gains `import "errors"` and `import "./utils"`, `store.go` gains `import "./utils"`; user projects get `Undefined: 'pkg'` per file, named in the release note.

---

## Implementation Tasks

> Split from the former `followup-fixes-plan.md` Phases 1 and 7 (re-probed 2026-11-17).

### Phase 1: Imports are bound per file (root `package-wide-imports`)
- [ ] Task 1.1: Per-file import scope for package, stdlib and typed imports (I1.1–I1.3)
  - Files: `src/typechecker/index.js` (file scopes, `_currentFile` lookup), `src/compiler.js` (namespaces and `.d.ts` definitions registered per file)
  - Test: `test/unit/compiler/imports.test.js` with `withTempDir` + `compileDir`: I1.1 → `Undefined: 'zzz'` at `b.go`, I1.2 → `Undefined: 'strings'` at `b.go`, I1.3 → `Undefined: 's'`; controls: both files import `strings` → `b A`; same path under two names; a `_test.go` file and the generated test main compile
  - Done when: all pass; `npm test` green apart from `example/simple` (Task 1.2)
- [ ] Task 1.2: Migrate `example/simple` and any stdlib file to file-scoped imports
  - Files: `example/simple/src/main.go`, `example/simple/src/store.go`
  - Test: `node src/index.js check example/...` fails after 1.1 with `Undefined: 'errors'`/`'utils'` until the imports are added; the `example/simple` Playwright spec
  - Done when: `npm run check` and `npm run test:e2e` pass
- [ ] Task 1.3: Untyped npm imports are file-scoped and tracked (I1.4–I1.6)
  - Files: `src/typechecker/index.js` (`defineUntypedImport` binds in the file scope and calls `trackImport`), `src/resolver.js` (`bindUntypedImports` passes the file), `src/compiler.js` (dot import of an untyped package in `wasm`/`both`)
  - Test: `test/unit/compiler/stdlib-go.test.js`: I1.4 and I1.6 → `'zzz' imported and not used`; I1.5 → `js: imports are not allowed in wasm packages`; the existing *rejected where it is used* tests stay green
  - Done when: all pass

### Phase 2: Exports and qualified names (roots `package-wide-imports`, `qualified-type-names`)
- [ ] Task 2.1: Packages export only what they declare (I1.7)
  - Files: `src/typechecker/index.js` (`getExportedSymbols` reads declared names only)
  - Test: `test/unit/compiler/packages.test.js` with a `node_modules/mydep` `.d.ts`: I1.7 → the missing-member error naming `Bar`; controls: `sub.Use()` and a declared `var Baz = 1` still compile and print
  - Done when: passes
- [ ] Task 2.2: `X.T` resolves its qualifier first (I2.1, I2.2)
  - Files: `src/typechecker/resolve.js` (qualified type names), `src/typechecker/expressions.js` (composite literal type)
  - Test: `test/unit/types/checks.test.js`: I2.1 → `'zzz.T' is only available in js packages` with line:col; I2.2 on `js`, `both`, `wasm` → `console.T is not a type`; controls `pkg.T{}` and `var x console.T` unchanged; `docs/` updated for file-scoped imports and the unused npm import error
  - Done when: all pass; no `Unknown struct in CompositeLit` from the emitter

### Phase 3: Export visibility on every target (root `export-visibility`)
- [ ] Task 3.1: Package-level names use Go's exported rule (E1, E3 names)
  - Files: `src/typechecker/resolve.js` (`isExported`, `_namespaceMemberError`)
  - Test: `test/unit/types/shadowing.test.js` with `compileHybridProject`: `util.__Answer()` from `js`, `both` and `wasm` packages → `assertErrorContains(…, "not exported by package util")`; `util.Ä()` stays exported
  - Done when: all pass
- [ ] Task 3.2: Fields and methods of foreign types (E2, E3 methods, E4)
  - Files: `src/typechecker/resolve.js` (`fieldType`, `_fieldTypeStruct`)
  - Test: `shadowing.test.js`: `util.New(7).twice()` and `util.New(7).m` from each target → `cannot refer to unexported`; promoted exported method through an embedded foreign type still compiles
  - Done when: all pass
- [ ] Task 3.3: Struct literals setting foreign unexported fields (E5); fix call sites
  - Files: `src/typechecker/expressions.js` (composite literal), plus any `example/`/`stdlib/` file the rule rejects
  - Test: `test/unit/types/checks.test.js` with `compileHybridProject`: `sub.S{1, 2}` and `sub.S{b: 2}` → `implicit assignment to unexported field b`; `sub.S{A: 1}` compiles; `npm run check` and the stdlib build pass; `docs/` package visibility
  - Done when: all pass; the release note lists any migrated call site
