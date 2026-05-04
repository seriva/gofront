# Parser declarations split — v1.0.1

## Goal

`src/parser/index.js` is 504 lines handling three distinct concerns: primitives
(token helpers), entry point (`parse()`, `parsePackage()`, `parseImport()`), and
top-level declarations (func, method, type, var, const). Extract declarations into
`src/parser/declarations.js`, matching the pattern already used for `statements.js`,
`expressions.js`, and `types.js`.

## Approach

**Affected stage:** Parser only. No TypeChecker or CodeGen changes.

### Extract to `src/parser/declarations.js`

Move these methods from `Parser` class body into a plain mixin object
`declarationParseMethods`, following the same pattern as `statementParseMethods` in
`statements.js`:

- `parseTopDecl()`
- `parseFuncOrMethod()`
- `parseAsyncFuncOrMethod()`
- `parseSignature()`
- `parseParamList()`
- `parseReturnType()`
- `parseTypeDecl()`
- `parseVarDecl()`
- `parseVarSpec()`
- `parseConstDecl()`
- `parseConstSpec()`
- Any private helpers used only by the above (`_parseTypeParams()` etc.)

### Update `src/parser/index.js`

```js
import { declarationParseMethods } from "./declarations.js";
// ...
Object.assign(Parser.prototype, declarationParseMethods);
```

`index.js` retains only: constructor, primitives (`peek`, `advance`, `expect`,
`match`, `skipSemi`, `err`), `parse()`, `parsePackage()`, `parseImport()`.
Target: ~150 lines.

### Update `src/templ-parser.js`

`TemplParser extends Parser` — verify no overridden declaration methods; none
expected. Smoke test: `templ.test.js` suite passes unchanged.

## Edge cases

- `parseReturnType(inTypeExpr)` uses default param — preserve exactly.
- `parseParamList` is called by both `parseSignature` and `templ-parser.js`
  indirectly — confirm cross-file call still resolves via prototype chain.
- `parseTypeDecl` calls `parseTypeParams()` (generic params) — keep in same file
  or extract together.

## JS output examples

No output change. Pure internal refactor.

## Sentrux rules update

`parser` layer already uses `src/parser/*` glob — `declarations.js` auto-covered.
No `rules.toml` change needed.

After implementation run `sentrux gate --save` only if quality signal improves
(shorter files → lower complexity scores).

## Test plan

1. `npm run test:unit` — all 1169 tests pass unchanged.
2. `npm run check` — Sentrux gate passes, no new coupling edges introduced.
3. Verify `parser/index.js` ≤ 160 lines after split.
