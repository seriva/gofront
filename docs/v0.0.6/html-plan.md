# html Package Shim — Design Plan

## Goal

HTML escaping is essential for any frontend application that renders dynamic content
safely. Go's `html` package provides `EscapeString` and `UnescapeString` for converting
between raw text and HTML-safe representations. The JS equivalents are inline `replace`
chains — no external dependency needed.

## Approach

`html` is a built-in namespace shim, like `strings` or `math`. No import statement is
needed; the namespace is always available.

### Functions

| Go | JS output |
|---|---|
| `html.EscapeString(s)` | `s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&#34;").replace(/'/g,"&#39;")` |
| `html.UnescapeString(s)` | reverse chain: `&#39;` → `'`, `&#34;` → `"`, `&gt;` → `>`, `&lt;` → `<`, `&amp;` → `&` |

### Escape mapping

| Character | Escaped form |
|---|---|
| `&` | `&amp;` |
| `<` | `&lt;` |
| `>` | `&gt;` |
| `"` | `&#34;` |
| `'` | `&#39;` |

## Edge cases

- **Unescape order matters**: `&amp;` must be replaced last during unescaping to prevent
  double-unescaping (e.g. `&amp;lt;` → `&lt;` → `<` would be wrong). The implementation
  processes `&amp;` last.
- **Roundtrip safety**: `UnescapeString(EscapeString(s)) === s` for all inputs.
- **`&#34;` vs `&quot;`**: Go's `html` package uses `&#34;` for double-quotes (not
  `&quot;`). GoFront matches this exactly.

## Type checker

Both functions are registered on the `html` namespace with signature
`(string) string`.

## Affected files

| File | Change |
|---|---|
| `src/typechecker.js` | Add `html` namespace with `EscapeString` and `UnescapeString` |
| `src/codegen/expressions.js` | Emit inline replace chains for each call |
| `test/builtins/stdlib.test.js` | Tests for escaping, unescaping, roundtrip, edge cases |
