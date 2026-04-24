# Plan: Column numbers in error messages

## Goal

Improve compiler error messages by adding column numbers and a caret indicator pointing
to the exact token that caused the error. Both parse errors and type errors should show
`file.go:line:col` coordinates and a visual pointer:

```
Type error in main.go at line 5:3: cannot use string as int
  5 | x := "hello" + 1
        ^
```

## Current state

- **Lexer** (`src/lexer.js`) — already tracks `col` on every `Token`. `LexError` already
  includes `line:col`.
- **Parser** (`src/parser.js`) — parse errors already format as `file:line:col`. But AST
  nodes do not store `col` — only `line` is copied from the token.
- **TypeChecker** (`src/typechecker/types.js`) — `TypeCheckError` reads `node.line` but
  has no `col` to work with. The caret line is not emitted.

## Approach

### 1. Store `col` on AST nodes (Parser)

Every place the parser sets `node.line = token.line`, also set `node.col = token.col`.
The main sites are in `src/parser.js` and `src/parser/expressions.js`:

- Identifier nodes: `{ kind: "Ident", name, line, col }`
- Binary/unary expressions: carry the operator token's position
- Call expressions: carry the opening paren or function ident position
- Statement nodes: carry the first token's position

No new parser grammar is needed — this is purely metadata propagation.

### 2. Update `TypeCheckError` to use `col` (TypeChecker)

In `src/typechecker/types.js`, extend `TypeCheckError`:

```js
export class TypeCheckError extends Error {
  constructor(msg, node, filename, sourceCode) {
    const line = node?.line || node?._line;
    const col  = node?.col  || node?._col;
    const loc  = filename
      ? line ? ` in ${filename} at line ${line}:${col ?? 1}` : ` in ${filename}`
      : line  ? ` at line ${line}:${col ?? 1}` : "";

    let lineContext = "";
    if (line && sourceCode) {
      const lineStr = sourceCode.split("\n")[line - 1] ?? "";
      const caretPad = " ".repeat((col ?? 1) - 1);
      lineContext = `\n  ${line} | ${lineStr}\n  ${" ".repeat(String(line).length + 3)}${caretPad}^`;
    }
    super(`Type error${loc}: ${msg}${lineContext}`);
  }
}
```

### 3. Consistent `file:line:col` format

Update the location string in `TypeCheckError` to match the `file:line:col` format that
parse errors already use, so editors (VS Code problem matchers, etc.) can parse both
error types with the same pattern.

## Edge cases

- **Nodes without `col`** — some synthetic nodes created by the typechecker or parser may
  not carry position info. Fall back to `col = 1` silently; do not crash.
- **Tab characters** — caret position counts tab as 1 character (same as the source
  string index). This may misalign visually in terminals that render tabs as 4/8 spaces.
  Document as a known limitation; fixing requires tab-stop expansion.
- **Multi-line expressions** — the caret points to the start token of the node, which is
  correct for most cases. Long expressions that span lines will point to the opening token.
- **templ files** — `src/templ-lexer.js` already tracks `line`; confirm it also tracks
  `col` and propagate to templ AST nodes the same way.

## Changes required

| File | Change |
|---|---|
| `src/parser.js` | Copy `token.col` to AST nodes alongside `token.line` |
| `src/parser/expressions.js` | Same — expressions carry operator/ident col |
| `src/parser/statements.js` | Same — statement nodes carry first-token col |
| `src/typechecker/types.js` | Add `col` to `TypeCheckError`; emit caret line |
| `src/templ-lexer.js` | Verify `col` is tracked (likely already is) |
| `src/templ-parser.js` | Propagate `col` from tokens to AST nodes |

## Test plan

Add tests in `test/unit/lexer-parser.test.js`:

```js
test("type error includes column number", () => {
  const { errors } = compile(`package main; func main() { var x int = "s" }`);
  assertErrorContains(errors, ":1:"); // line 1, some column
});

test("type error caret points at token", () => {
  const { errors } = compile(`package main\nfunc main() {\n  var x int = "s"\n}`);
  assertContains(errors[0].message, "^");
});
```

## Output example

Before:
```
Type error in main.go at line 3: cannot use string as int
  3 |   var x int = "s"
```

After:
```
Type error in main.go at line 3:15: cannot use string as int
  3 |   var x int = "s"
                    ^
```
