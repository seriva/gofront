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
| **In scope: core** | Root `package-wide-imports`: every import (GoFront package, stdlib, typed `.d.ts`, untyped npm, dot, renamed) is bound in the importing file's scope, tracked for use, and excluded from the package's exports | I1.1–I1.11 | |
| **In scope: core** | Root `qualified-type-names`: `X.T` in a type or composite-literal position resolves `X` first (package namespace, npm import, value) and reports by kind | I2.1–I2.2 | |
| **In scope: core** | Root `export-visibility`: a reference from another package to an unexported (or `__`) name, type, method or field is a compile error on every target, as in Go | E1–E7 | User decision 2026-11-17: all targets (breaking for `js`/`both`) |
| **Excluded: deferred** | Local type named after an import (L4) | `func other() int { type strings = int; … }` breaks `strings.ToUpper` elsewhere | Root `predeclared-scope` (`mangleLocalTypes` reserved set), [`checker-go-rules-plan.md`](checker-go-rules-plan.md) Phase 8 |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6` (2026-11-17) and re-audited at `258d4148` / `002e5180` (2026-11-19). A throwaway driver (`.probes/`, deleted) wrote each project into a temp directory (with `node_modules/<pkg>/index.d.ts` where needed) and compiled it with `compileHybridProject` (`test/unit/helpers.js:424`, `compileDir`). `nope/zzz` has no type declarations (untyped import). *sibling* rows were found by probing each root's other paths. `example/` and `stdlib/` were scanned for files using a sibling file's import: only `example/simple/src/main.go` (`errors`, `./utils`, and `sleep` from `js:./browser.d.ts`) and `example/simple/src/store.go` (`./utils`; also has an unused `import "js:./browser.d.ts"`).

### I1 `package-wide-imports`

Root: `defineUntypedImport` (`src/typechecker/index.js:191`) defines untyped npm imports in `this.globals`; `.d.ts` values go into `globals` through `checker.addDefinitions` (`src/compiler.js:334`, `:345`, iterating `resolved` package-wide rather than per file); Go-source stdlib packages go into `globals` and `this.types` through `bindStdlibImport` (`src/link/stdlib.js:542`, with `implicitImports` attached only to `programs[0]` at `:737`); local GoFront packages go through `addPackageNamespace` (`src/compiler.js:451`, skipped for subsequent files by `seenLocalPaths` at `:360`), and only `addPackageNamespace` (`:459`) and `bindStdlibImport` (`:557`) call `trackImport`. `getExportedSymbols` (`src/typechecker/index.js:263`) exports every uppercase name in `globals` (including `.d.ts` values, dot-imported names, and uppercase import aliases), and `getExportedTypes` (`:290`) exports all of `this.types` including imported types.

| ID | Project | Go / want | GoFront |
|---|---|---|---|
| I1.1 (L10) | `a.go` imports `nope/zzz` and uses `zzz.F()`; `b.go` uses `zzz.G()` without importing | `Undefined: 'zzz'` at `b.go` | compiles; `ReferenceError: zzz is not defined` at run time |
| I1.2 (L10b) | `a.go` imports `strings`; `b.go` uses `strings.ToUpper` without importing | `undefined: strings` at `b.go` | prints `b A` on all targets |
| I1.3 *sibling* | `a.go` has `import s "strings"`; `b.go` uses `s.ToUpper("b")` | `undefined: s` | prints `B` |
| I1.4 (L6) | `wasm` package `import "nope/zzz"`, unused | `'zzz' imported and not used` | prints `ok` |
| I1.5 (L6b) | `wasm` package `import . "nope/zzz"` | `js: imports are not allowed in wasm packages` | prints `ok` |
| I1.6 (L6c) | `js` package `import "nope/zzz"`, unused | `'zzz' imported and not used` | prints `ok` (an unused `import "strings"` is already rejected) |
| I1.7 (L8) | `sub` imports `mydep` (`export declare const Bar: number;`); `main` uses `sub.Bar` | compile error: `sub` has no `Bar` | compiles; `ReferenceError: Bar is not defined` |
| I1.8 *sibling* | `a.go` imports `strings` (or `./sub` with `type Box[T any]`, `type T`); `b.go` has `var b strings.Builder`, `var _ sub.Box[int]`, or bare `var _ T` without importing | `Unknown type` / `undefined` at `b.go` | compiles (package-wide `this.types`, `_resolveGenericTypeName`, `addPackageNamespace` bare-name insert) |
| I1.9 *sibling* | `a.go` imports `js:./h.d.ts` (values & `interface Foo`) or `import . "./sub"` (values & `type T`); `b.go` uses `helper()`/`Foo` or `Hi()`/`T` without importing | `Undefined` / `Unknown type` at `b.go` | compiles (package-wide `globals` and `this.types`) |
| I1.10 *sibling* | `sub` has `import . "../leaf"` or `import Leaf "../leaf"`; `main` uses `sub.LeafFn()` or `sub.Leaf` | compile error: `sub` has no `LeafFn` / `Leaf` | compiles (leaks into `getExportedSymbols`) |
| I1.11 *sibling* | `a.go` has `import "./sub"`; `b.go` has `import s "./sub"` and calls `s.Hi()` | compiles and runs | fails: `Undefined: 's'` (`seenLocalPaths` skips `b.go`) |

### I2 `qualified-type-names`

Root: `resolveTypeNode` (`src/typechecker/resolve.js:248`, `:324`) and `_resolveGenericTypeName` (`:595`) resolve `zzz.T` as a type name before checking what `zzz` is, and `case "SelectorExpr"` returns `ANY` when `this.types.has(qualified)` is false instead of checking the qualifier, so composite literals like `console.T{}`, `zzz.T{}` and `v.T{}` reach the backend as `ANY`.

| ID | Program | Want | GoFront |
|---|---|---|---|
| I2.1 (L7) | `wasm` package: `import "nope/zzz"; var x zzz.T` (and `_ = zzz.T{}`, `var y zzz.T[int]`) | `'zzz.T' is only available in js packages` (with line:col) | `Unknown type 'zzz.T'` (no line:col); `_ = zzz.T{}` hits wasm ICE `Unknown struct in CompositeLit: any` |
| I2.2 (L9) | `_ = console.T{}` (and local `v := 1; _ = v.T{}`) | `console.T is not a type` / `v.T is not a type` | js/both compile and run; wasm ICE `Unknown struct in CompositeLit: any` |
| control | `var x console.T` | `Unknown type 'console.T'` | correct |

### I3 `export-visibility`

Root: no selector, qualified type lookup, method expression or composite literal into another package checks Go's export rule. `_namespaceMemberError` (`src/typechecker/resolve.js:1365`) treats only `a`–`z` as unexported, so `__Answer` passes, and `isExported` (`:1426`, used by JSON fields) only checks ASCII `A`–`Z`. `resolveTypeNode` never checks export for `pkg.t`, `_fieldTypeStruct` / `_fieldTypeInterface` / `fieldType` / `_checkMethodExprSelector` (`src/typechecker/expressions.js:854`) never check owning-package visibility, anonymous structs and promoted embedded fields/methods do not preserve their originating package, and composite literals never check the owning package. On `wasm` packages the facade omits unexported members, so these crash at run time; on `js`/`both` they run. Re-probed 2026-11-17 and 2026-11-19 with `compileHybridProject` (`util` package, `main` uses it).

| ID | Project | Go | GoFront |
|---|---|---|---|
| E1 (F5) | `util` (`wasm`): `func __Answer() int`; `util.__Answer()` | `name __Answer not exported by package util` | `ReferenceError: __Answer$ is not defined` |
| E2 (F29) | `util` (`wasm`): `func (r Rec) twice() int`; `util.New(7).twice()` | `util.New(7).twice undefined (cannot refer to unexported method twice)` | `TypeError: New(...).twice is not a function` |
| E3 | `util` targeting `js` or `both`: `util.__Answer()`, `util.New(7).twice()` | rejected | print `42`, `14` |
| E4 | `util.New(7).m` (unexported field), `util` targeting `js` or `both` | rejected | prints `7` |
| E5 (ledger *Struct literals*) | `type S struct { A int; b int }`; `_ = sub.S{1, 2}`, `sub.S{b: 2}`, `util.Rec{1}`, or `sub.Pub{hidden: …}` (unexported embed) | `implicit assignment to unexported field` / `cannot refer to unexported field` | compiles |
| E6 *sibling* | `var x util.secret`, `_ = util.secret{}`, `var g util.box[int]` (unexported foreign type / generic type) | `name secret not exported by package util` | compiles |
| E7 *sibling* | `util.I` unexported interface method (`x.secret()`), embedded foreign interface (`type LocalI interface { util.I }`, `type LocalS struct { util.I }`), named non-struct unexported method (`util.N.twice`, `n.twice()`), foreign anonymous struct (`util.Make().a`), embedded foreign struct (`type Local struct { util.Rec }; l.m; l.twice()`), unexported embedded field (`util.Pub{}.hidden`), method expression (`util.Rec.twice`) | `cannot refer to unexported` | all compile |
| control | `type hidden struct { X int }; type Pub struct { hidden }`; `util.Pub{}.X` | compiles (exported field promoted through unexported embed) | compiles |

---

## Approach

### 1. Architecture & Design Decisions
- **Per-file import scope (I1).** The checker keeps `fileScopes: Map<filename, Scope>` (each with `this.universe` as parent, chained as `this.globals.parent = this._fileScope(this._currentFile)` in `_setCurrentFile`) so each file's scope holds its package qualifiers, typed `.d.ts` bindings/types, untyped npm globals and dot-imported names/types, while `this.globals` and `this.types` hold only the package's own declarations (imported types live on the file's namespace `_types` or file scope rather than leaking bare or qualified names into package-wide `this.types`). Because `this.globals.parent` tracks `_currentFile`, every `this.globals.lookup(...)` (including `_useQualifiedConsts` at `resolve.js:530` and `_resolveGenericTypeName` at `:616`) sees only the current file's imports, and `src/typechecker/expressions.js` (`:283`, `:294`, `:908`) checks `this._isImportScope(owner)` instead of `owner === this.globals`. `getExportedConsts()` evaluates each constant under its declaring file (or reads values cached during `_checkTopDeclsPass`) so a constant referencing a file-scoped import (e.g. `math.Pi`) does not lose its import when another file was checked last. `addDefinitions`, `defineUntypedImport`, `addPackageNamespace` and `bindStdlibImport` (`src/link/stdlib.js`) take the importing file and bind in that file's scope; `importStdlibPackages` computes `implicitImports` per file rather than attaching them only to `programs[0]`; `src/compiler.js` binds local packages and `.d.ts` imports per file (using `depCache` to compile each local dependency once rather than skipping later files via `seenLocalPaths`). `defineUntypedImport`, `addPackageNamespace` and `bindStdlibImport` all call `trackImport` against the file scope's `_used` set so unused package and untyped npm imports report `'name' imported and not used` identically. Because imports never enter `this.globals`, `getExportedSymbols` and `getExportedTypes` see only the package's own declared names and types.
- **Qualified names (I2).** One shared `_resolveQualifiedType(qual, member, node, scope)` helper used by `resolveTypeNode` (`TypeName`, `SelectorExpr`), `_resolveGenericTypeName`, `resolveTypeNodeName` and `_genericTypeRef` (`expressions.js:950`) resolves the qualifier `X` in the current file's scope first: a package namespace resolves the member type from the namespace (checking export and `_jsOnly`); an untyped import in a `wasm`/`both` package reports `_errJsOnly` with line:col; a value reports `X.T is not a type`; an unimported qualifier reports `Unknown type 'X.T'` (closing I1.8, I2, and E6 generics together). `checkCompositeLit` shares this lookup before the backend sees the literal.
- **Export visibility (I3).** One predicate `isExported(name)` (updating `src/typechecker/resolve.js:1426` to Go's rule: first character is a Unicode uppercase letter, `/^\p{Lu}/u`) and one check `_checkForeignMember(ownerPkg, name, node)` applied across: `_namespaceMemberError` (package-level values/funcs), `_resolveQualifiedType` (qualified foreign types `pkg.t`, including generics), `fieldType` / `_fieldTypeStruct` (removing the superseded ad-hoc `strings.*`/`bytes.*` `_`-prefix check at `resolve.js:1253-1262`) / `_fieldTypeInterface` / `_checkMethodExprSelector` (fields, methods and method expressions of values whose type or promoted member originates in another package, including named non-structs and anonymous structs), and composite-literal checking (keyed and positional elements setting unexported regular or embedded fields of a foreign struct). Every `TypeChecker` stamps a per-package identity (`this._pkgId`) on declared types, structs, interfaces and methods, and field/method promotion (`_resolveStructType`, `_offerStructEmbed`, `offerInterfaceMethods`, `_mergeInterfaceEmbed`) preserves each promoted field's/method's originating `_pkgId` so a local struct or interface embedding a foreign type still hides the foreign type's unexported members while allowing exported fields promoted through an unexported embed. Messages follow Go: `name X not exported by package p`, `… (cannot refer to unexported field x)`, `implicit assignment to unexported field x in struct literal of type p.T`.

### 2. Invariants & Safety Bounds
- Single-file packages, and multi-file packages where every file imports what it uses, compile to byte-identical JS.
- Generated files declare their own imports: the test main, `gofront_gen.go` and fmt formatters (`src/lower/fmt-formatters.js`) do not rely on a sibling file's imports.
- Stdlib packages compile unchanged (any file relying on a sibling's import is fixed in the same task and listed).

### 3. Edge Cases & Error Handling
- Two files import the same path under different names; one file imports it twice under two names.
- A `_test.go` file imports what it uses; the generated test main gets its own imports.
- Dot imports bind into the importing file only; a name dot-imported by two files from different packages is not a conflict.
- A blank import (`import _ "x"`) stays a side-effect import and is never "unused".
- A `js:./foo.d.ts` or typed `.d.ts` import may be used solely for its type declarations (e.g. `example/preact/src/fetch.go` uses `AbortControllerWrapper` from `js:./preact.d.ts`), so `.d.ts` imports stay file-scoped without false unused-import errors on type-only uses.
- **Export visibility:** non-ASCII uppercase (`util.Ä()`) stays exported; methods and fields promoted from an embedded foreign type follow the embedded type's package, while exported fields promoted through an unexported embedded struct remain accessible; a package's own `_test.go` files and `gofront_gen.go` share its `TypeChecker` (`_pkgId`) and may use its unexported names.
- **Migration:** `example/simple/src/main.go` gains `import "errors"`, `import "./utils"` and `import "js:./browser.d.ts"`; `example/simple/src/store.go` gains `import "./utils"` and drops its unused `import "js:./browser.d.ts"`; user projects get `Undefined: 'pkg'` per file, named in the release note.

---

## Implementation Tasks

> Split from the former `followup-fixes-plan.md` Phases 1 and 7 (re-probed 2026-11-17; audited 2026-11-19).

### Phase 1: Imports are bound per file (root `package-wide-imports`)
- [ ] Task 1.1: Per-file import scopes in the checker (I1.1–I1.3, I1.8–I1.9)
  - Files: `src/typechecker/index.js` (`fileScopes`, `_fileScope`, `_isImportScope`, chain `this.globals.parent` in `_setCurrentFile`, per-file `reportUnusedImports`, file-aware `getExportedConsts`), `src/typechecker/expressions.js` (`_isImportScope` in place of `owner === this.globals` at `:283`, `:294`, `:908`), `src/typechecker/resolve.js` (per-file type/qualified-type lookup in `resolveTypeNode`, `_resolveGenericTypeName`, `resolveTypeNodeName`, `_jsOnlyMember`, `_useQualifiedTypeName`)
  - Test: `test/unit/compiler/imports.test.js`: unit tests for file-scoped `addPackageNamespace`/`addDefinitions` (values and types) and per-file `reportUnusedImports`; `npm test` stays green while callers still pass default file
  - Done when: all pass and existing `npm test` is green
- [ ] Task 1.2: Wire compiler and stdlib per-file import binding (I1.1–I1.3, I1.8–I1.9, I1.11)
  - Files: `src/compiler.js` (per-file `.d.ts` and local package binding; remove `seenLocalPaths` skip while keeping `depCache` dedupe), `src/link/stdlib.js` (`bindStdlibImport` binds in `p._filename`'s scope; `implicitImports` computed per file)
  - Test: `test/unit/compiler/imports.test.js` with `withTempDir` + `compileDir`: I1.2 → `Undefined: 'strings'` at `b.go`, I1.3 → `Undefined: 's'`, I1.8 → `strings.Builder`, `sub.Box[int]`, and bare `T` rejected at `b.go`, I1.9 → `js:` `.d.ts` values/types and dot-imported values/types rejected at `b.go`, I1.11 → same local path under two names compiles; controls: both files import `strings` → `b A`; exported `const` referencing a file-scoped import in `a.go` with `b.go` not importing it; a `_test.go` file and generated `gofront_gen.go` compile
  - Done when: all pass; `npm test` green apart from `example/simple` (Task 1.3)
- [ ] Task 1.3: Migrate `example/simple` and any stdlib file to file-scoped imports
  - Files: `example/simple/src/main.go`, `example/simple/src/store.go`
  - Test: `node src/index.js check example/...` fails after 1.2 with `Undefined: 'errors'`/`'utils'`/`'sleep'` until `main.go` gains `errors`, `./utils`, `js:./browser.d.ts` and `store.go` gains `./utils` (dropping unused `js:./browser.d.ts`); the `example/simple` Playwright spec
  - Done when: `npm run check` and `npm run test:e2e` pass
- [ ] Task 1.4: Untyped npm imports are file-scoped and tracked (I1.1, I1.4–I1.6)
  - Files: `src/typechecker/index.js` (`defineUntypedImport` binds in the file scope and calls `trackImport`), `src/resolver.js` (`bindUntypedImports` takes per-file imports and passes the file), `src/compiler.js` (per-file `bindUntypedImports` and dot import of an untyped package in `wasm`/`both`)
  - Test: `test/unit/compiler/stdlib-go.test.js`: I1.1 → `Undefined: 'zzz'` at `b.go`, I1.4 and I1.6 → `'zzz' imported and not used`, I1.5 → `js: imports are not allowed in wasm packages`; update existing unused-import test at `:695` to reference `z`; the existing *rejected where it is used* tests stay green
  - Done when: all pass

### Phase 2: Exports and qualified names (roots `package-wide-imports`, `qualified-type-names`)
- [ ] Task 2.1: Packages export only what they declare (I1.7, I1.10)
  - Files: `src/typechecker/index.js` (`getExportedSymbols` and `getExportedTypes` read declared names/types only, excluding `.d.ts`, dot imports, and import aliases)
  - Test: `test/unit/compiler/packages.test.js` with a `node_modules/mydep` `.d.ts` and a `leaf` subpackage: I1.7 → missing-member error naming `Bar`; I1.10 → `sub.LeafFn` and `sub.Leaf` rejected; controls: `sub.Use()` and a declared `var Baz = 1` still compile and print
  - Done when: passes
- [ ] Task 2.2: `X.T` resolves its qualifier first (I2.1, I2.2)
  - Files: `src/typechecker/resolve.js` (shared `_resolveQualifiedType` across `resolveTypeNode` `TypeName`/`SelectorExpr`, `_resolveGenericTypeName`, `resolveTypeNodeName`), `src/typechecker/expressions.js` (composite literal type and `_genericTypeRef`)
  - Test: `test/unit/types/checks.test.js`: I2.1 (`var x zzz.T`, `_ = zzz.T{}`, `var y zzz.T[int]`) → `'zzz.T' is only available in js packages` with line:col; I2.2 (`console.T{}` and local `v.T{}`) on `js`, `both`, `wasm` → `is not a type`; controls `pkg.T{}` and `var x console.T` unchanged
  - Done when: all pass; no `Unknown struct in CompositeLit` from the emitter

### Phase 3: Export visibility on every target (root `export-visibility`)
- [ ] Task 3.1: Package-level names and types use Go's exported rule (E1, E3 names, E6)
  - Files: `src/typechecker/resolve.js` (update `isExported` to `/^\p{Lu}/u`, apply in `_namespaceMemberError` and `_resolveQualifiedType`)
  - Test: `test/unit/types/shadowing.test.js` with `compileHybridProject`: `util.__Answer()`, `var x util.secret`, `util.secret{}`, and `var g util.box[int]` from `js`, `both` and `wasm` packages → `assertErrorContains(…, "not exported by package util")`; `util.Ä()` stays exported; update existing assertion in `test/unit/compiler/imports.test.js:227` from `"cannot refer to unexported name"` to `"not exported by package"`
  - Done when: all pass
- [ ] Task 3.2: Fields, methods and method expressions of foreign types (E2, E3 methods, E4, E7)
  - Files: `src/typechecker/index.js` (stamp `_pkgId` on declared types/methods; preserve originating `_pkgId` on promoted fields/methods in `_offerStructEmbed` and `offerInterfaceMethods`), `src/typechecker/resolve.js` (stamp `_pkgId` on struct/interface literals; preserve `_pkgId` in `_resolveStructType` and `_mergeInterfaceEmbed`; `_checkForeignMember` in `fieldType`, `_fieldTypeStruct` removing the superseded `strings.*`/`bytes.*` `_`-prefix special case at `:1253-1262`, and `_fieldTypeInterface`), `src/typechecker/expressions.js` (`_checkForeignMember` in `_checkMethodExprSelector`)
  - Test: `test/unit/types/shadowing.test.js`: `util.New(7).twice()`, `util.New(7).m`, `util.N` unexported method (`n.twice()`, `util.N.twice`), `util.I` unexported method (`x.secret()`, `LocalI{ util.I }`, `LocalS{ util.I }`), `util.Make().a` (foreign anonymous struct), `Local{util.Rec}` accessing `l.m`/`l.twice()`, `util.Pub{}.hidden`, and `util.Rec.twice` from each target → `cannot refer to unexported`; control: promoted exported field/method through an embedded unexported foreign struct (`util.Pub{}.X`) still compiles
  - Done when: all pass
- [ ] Task 3.3: Struct literals setting foreign unexported fields (E5); fix call sites and docs
  - Files: `src/typechecker/expressions.js` (composite literal keyed and positional checks for regular and embedded foreign fields), plus any `example/`/`stdlib/` file the rule rejects, plus `docs/usage.md`, `docs/go-compatibility.md`, `docs/hybrid-wasm.md`
  - Test: `test/unit/types/checks.test.js` with `compileHybridProject`: `sub.S{1, 2}`, `sub.S{b: 2}`, and `sub.Pub{hidden: …}` → `implicit assignment to unexported field` / `cannot refer to unexported field`; `sub.S{A: 1}` compiles; `npm run check` and the stdlib build pass; `docs/` updated for file-scoped imports, unused npm imports, and package visibility
  - Done when: all pass; the release note lists any migrated call site
