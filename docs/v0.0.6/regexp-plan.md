# regexp Package Shim — Design Plan

## Goal

Regular expressions are a fundamental tool for string validation and parsing —
especially on the frontend (email validation, URL checks, input sanitisation). Go's
`regexp` package compiles to JS's native `RegExp`, so the mapping is almost 1:1.

## Approach

`regexp` is a built-in namespace shim, like `strings` or `math`. No import statement
is needed; the namespace is always available.

The key difference from Go's `regexp` is that JS regexes are not compiled at runtime —
`regexp.MustCompile(pattern)` evaluates to a JS `RegExp` object directly. The returned
value is typed as `*Regexp` (an opaque `any`-compatible type) in the type checker.

### Core functions

| Go | JS output |
|---|---|
| `regexp.MustCompile(pat)` | `new RegExp(pat)` |
| `regexp.Compile(pat)` | `[new RegExp(pat), null]` (returns `(*Regexp, error)`) |
| `re.MatchString(s)` | `re.test(s)` |
| `re.FindString(s)` | `(re.exec(s)?.[0] ?? "")` |
| `re.FindStringIndex(s)` | `((m => m ? [m.index, m.index + m[0].length] : null)(re.exec(s)))` |
| `re.FindAllString(s, n)` | `[...s.matchAll(re)].slice(0, n < 0 ? undefined : n).map(m => m[0])` |
| `re.FindStringSubmatch(s)` | `[...(re.exec(s) ?? [])]` |
| `re.FindAllStringSubmatch(s, n)` | `[...s.matchAll(re)].slice(0, n < 0 ? undefined : n).map(m => [...m])` |
| `re.ReplaceAllString(s, repl)` | `s.replaceAll(re, repl)` |
| `re.ReplaceAllLiteralString(s, repl)` | `s.replaceAll(re, repl.replace(/\$/g, '$$$$'))` |
| `re.Split(s, n)` | `s.split(re).slice(0, n < 0 ? undefined : n)` |
| `re.String()` | `re.source` |
| `regexp.MatchString(pat, s)` | `[new RegExp(pat).test(s), null]` |
| `regexp.QuoteMeta(s)` | `s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` |

### Flag mapping

Go uses inline flags `(?i)`, `(?m)`, `(?s)` in the pattern string. These are passed
through to JS `RegExp` as-is — JS supports the same inline syntax.

For `re.FindAllString` and `re.FindAllStringSubmatch`, GoFront automatically adds the
`g` (global) flag to the underlying `RegExp` when `matchAll` is needed. This is handled
at codegen time by wrapping: `new RegExp(re.source, re.flags + "g")`.

## Edge cases

- **`MustCompile` vs `Compile`**: `MustCompile` panics in Go if the pattern is invalid.
  In GoFront it compiles to `new RegExp(pat)` which throws at runtime — equivalent
  behaviour.
- **`n = -1` means all matches**: The `n` parameter in `FindAll*` functions follows
  Go's convention where `-1` means unlimited. Mapped to `undefined` in `slice()`.
- **Named capture groups**: Go uses `(?P<name>...)` syntax; JS uses `(?<name>...)`.
  GoFront does not rewrite named groups — users should use JS-style named groups
  when interoperating with `FindStringSubmatch`.
- **`SubexpNames()`**: Returns capture group names. Not implemented in v0.0.6 (low
  usage, complex to shim).

## Type checker

`regexp.MustCompile` returns a new named type `*Regexp`. Methods are registered on
this type. The type checker resolves `re.MatchString(s)` as a method call on `*Regexp`.

## Affected files

| File | Change |
|---|---|
| `src/typechecker.js` | Add `regexp` namespace with `MustCompile`/`Compile` returning `*Regexp`; register `Regexp` methods |
| `src/codegen/expressions.js` | Emit inline JS for each `regexp.*` and `(*Regexp).*` call |
| `test/builtins/stdlib.test.js` | New section with regexp tests |
