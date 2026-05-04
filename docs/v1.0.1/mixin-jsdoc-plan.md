# TypeChecker / CodeGen mixin documentation — v1.0.1

## Goal

Both `TypeChecker` and `CodeGen` use `Object.assign(X.prototype, methods)` to merge
sub-module method objects onto the class prototype. This works at runtime but causes two
practical problems:

1. **IDE blind spot** — autocomplete and "go to definition" on `this.checkExpr` in
   `expressions/calls.js` doesn't resolve; IDE sees the method as `any`.
2. **Stack trace noise** — errors show `Object.<anonymous>` instead of a meaningful
   call site.

v1.0.1 addresses the IDE problem with `@this` JSDoc annotations (low effort, immediate
gain) and documents the pattern explicitly. A full composition refactor is deferred to
a later release.

## Approach

### Phase 1 (v1.0.1): JSDoc `@this` annotations

Add `/** @this {TypeChecker} */` to every exported method object in each sub-module.
Pattern:

```js
// src/typechecker/expressions/calls.js
export const callCheckMethods = {
  /** @this {TypeChecker} */
  checkCall(node) { ... },

  /** @this {TypeChecker} */
  _resolveCallFnType(node) { ... },
};
```

Same for `expressions/core.js`, `expressions/composite.js`, `statements.js`,
`assignability.js`, `resolve.js`, `termination.js`, `codegen/statements.js`,
`codegen/expressions.js`, `codegen/stdlib/*.js`, `codegen/templ.js`.

Effect: VS Code and other LSP clients resolve `this.*` calls inside mixin methods
without any runtime change.

### Phase 2 (future): Composition pattern

Deferred. Would change calling convention to explicit `checker` parameter:

```js
// Future shape — NOT in v1.0.1
export function checkCall(checker, node) { ... }

// TypeChecker class body:
checkCall(node) { return checkCall(this, node); }
```

Rationale for deferral: threading `checker`/`cg` through ~120 methods is mechanical
but large; risks introducing bugs; should be a dedicated release with full coverage run.

## Affected files (Phase 1)

TypeChecker sub-modules (6 files):
- `src/typechecker/expressions/core.js`
- `src/typechecker/expressions/calls.js`
- `src/typechecker/expressions/composite.js`
- `src/typechecker/statements.js`
- `src/typechecker/assignability.js`
- `src/typechecker/resolve.js`
- `src/typechecker/termination.js`

CodeGen sub-modules (5+ files):
- `src/codegen/statements.js`
- `src/codegen/expressions.js`
- `src/codegen/stdlib/core.js`
- `src/codegen/stdlib/extended.js`
- `src/codegen/templ.js`

## Edge cases

- `@this` on object methods vs standalone functions — only methods in exported
  mixin objects need the annotation; private helpers called via `this._helper` inside
  the same file inherit context from the caller.
- `TemplParser extends Parser` — `Parser` prototype methods don't use mixin pattern;
  no change needed there.

## JS output examples

No output change. Annotation-only.

## Sentrux rules update

JSDoc annotations don't affect imports or structure — no `rules.toml` change needed.
`npm run check` must pass unchanged.

## Test plan

1. `npm run test:unit` — all tests pass (no behaviour change).
2. `npm run check` — no new lint errors.
3. Manual: open `expressions/calls.js` in VS Code, confirm `this.checkExpr` resolves.
