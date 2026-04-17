# goto Statement — Design Plan

## Goal

`goto` is the last unimplemented statement from the Go spec's statement grammar.
It is rare in idiomatic Go — almost all uses are in generated code, low-level parsers,
or state machines. Still, its absence means GoFront cannot compile a non-trivial subset
of real Go codebases.

## Approach

JavaScript has no `goto`. The standard translation is **labeled block + break**,
which works for forward jumps. Backward jumps require a loop wrapper.

### Forward jumps

```go
// Go
if err != nil {
    goto cleanup
}
// ... more work ...
cleanup:
    doCleanup()
```

```js
// JS (forward goto → labeled block + break)
outer: {
    if (err !== null) { break outer; }
    // ... more work ...
}
doCleanup();
```

The codegen wraps the region between the `goto` and its label in a labeled block.
`goto label` becomes `break label`.

### Backward jumps

Backward `goto` (jumping to a label that appears earlier in the code) requires
re-executing code — only possible with a loop:

```go
// Go
start:
    n++
    if n < 10 { goto start }
```

```js
// JS (backward goto → labeled while loop)
start: while (true) {
    n++;
    if (n < 10) { continue start; }
    break start;
}
```

The codegen detects whether the label appears before or after the `goto` in the AST,
and emits the appropriate form.

### Go spec restrictions (enforced by type checker)

The Go spec forbids:
1. `goto` jumping over a variable declaration into its scope.
2. `goto` jumping into a block from outside the block.

GoFront enforces rule 1 by scanning declarations between the `goto` and the target
label. Rule 2 is naturally prevented by the block structure of the AST.

## AST nodes

```js
{ kind: "GotoStmt",  label: string }
{ kind: "LabelStmt", label: string, stmt: Stmt }
```

`LabelStmt` already exists for labeled `break`/`continue` — it wraps a statement.
For `goto` targets, the label may appear on an empty statement.

## Compiler stages

| Stage | Change |
|---|---|
| Lexer | `goto` is already a reserved keyword — no change |
| Parser | Parse `GotoStmt` and `LabelStmt` (if not already handling empty-statement labels) |
| TypeChecker | Collect all labels in a function body; verify no declaration is jumped over |
| CodeGen | Emit labeled block (forward) or labeled while loop (backward); `goto` → `break`/`continue` |

## Edge cases

- **Multiple `goto` to the same label**: each generates a `break` to the same labeled
  block — the wrapper is shared.
- **`goto` inside a nested block**: the labeled block must be placed at the scope that
  encloses both the `goto` and the label.
- **`goto` across `defer`**: allowed in Go but semantically tricky. Document as a
  semantic difference if defer ordering diverges.
- **Label on last statement in function**: an empty label at end of function body is
  common (`done:` as a no-op target). Emit as a labeled empty block.

## JS output examples

```go
func process(items []string) {
    for i, s := range items {
        if s == "" { goto skip }
        println(s)
        skip:
    }
}
```

```js
function process(items) {
    for (const [i, s] of __s(items).entries()) {
        skip: {
            if (s === "") { break skip; }
            console.log(s);
        }
    }
}
```

## Affected files

| File | Change |
|---|---|
| `src/parser/statements.js` | Parse `GotoStmt`; handle empty-statement `LabelStmt` targets |
| `src/typechecker/statements.js` | Collect labels; check jump-over-declaration rule |
| `src/codegen/statements.js` | Emit labeled block (forward) or labeled while (backward) |
| `test/language/declarations.test.js` | Tests for forward goto, backward goto, jump-over-decl error |
