# strings.Builder / bytes.Buffer — Design Plan

## Goal

`strings.Builder` and `bytes.Buffer` are the idiomatic Go way to build strings and byte
slices incrementally. They appear in nearly every non-trivial Go program. Without them,
users fall back to string concatenation with `+`, which is both unidiomatic and a
well-known Go anti-pattern.

## Approach

Both types are implemented as built-in struct shims in `src/typechecker.js` and
`src/codegen.js` — the same pattern used for `sort.Slice`, `strings.Contains`, etc.
No new syntax is required.

### strings.Builder

Compiled representation: a plain object `{ _buf: "" }` (not a class — no import needed).

| Go method | JS output |
|---|---|
| `var b strings.Builder` | `let b = { _buf: "" }` |
| `b.WriteString(s)` | `b._buf += s` |
| `b.WriteByte(c)` | `b._buf += String.fromCodePoint(c)` |
| `b.WriteRune(r)` | `b._buf += String.fromCodePoint(r)` |
| `b.Write(bs)` | `b._buf += String.fromCharCode(...bs)` |
| `b.String()` | `b._buf` |
| `b.Len()` | `b._buf.length` |
| `b.Reset()` | `b._buf = ""` |

The zero value is usable (`var b strings.Builder` works without explicit init).

### bytes.Buffer

Compiled representation: `{ _buf: [] }` — internal buffer as a JS byte array.

| Go method | JS output |
|---|---|
| `var b bytes.Buffer` | `let b = { _buf: [] }` |
| `b.WriteString(s)` | `b._buf.push(...new TextEncoder().encode(s))` |
| `b.WriteByte(c)` | `b._buf.push(c)` |
| `b.Write(bs)` | `b._buf.push(...bs)` |
| `b.String()` | `new TextDecoder().decode(new Uint8Array(b._buf))` |
| `b.Bytes()` | `b._buf.slice()` |
| `b.Len()` | `b._buf.length` |
| `b.Reset()` | `b._buf = []` |
| `b.Read(p)` | Reads bytes into `p`, returns `[n, null]` or `[0, "EOF"]` |

### fmt.Fprintf / fmt.Fprintln / fmt.Fprint

With `bytes.Buffer` available, `fmt.Fprintf(w, ...)` becomes worth supporting:
- `fmt.Fprintf(&b, fmt, args...)` → `b.WriteString(__sprintf(fmt, ...args))`
- `fmt.Fprintln(&b, args...)` → `b.WriteString(__sprintf("%v\n", args...))`
- `fmt.Fprint(&b, args...)` → `b.WriteString(__sprintf("%v", args...))`

These are emitted inline — no new runtime helper needed.

## Edge cases

- **Reset after use**: zero-value semantics must hold after `Reset()`.
- **Concurrent writes**: not a concern — JS is single-threaded.
- **`io.Writer` interface satisfaction**: `bytes.Buffer` and `strings.Builder` should
  satisfy `io.Writer` (which requires `Write(p []byte) (n int, err error)`). This is
  automatically checked if `io.Writer` is defined in the type system.
- **`b.Grow(n)`**: hint-only in Go (pre-allocates capacity). Can be compiled to a no-op.

## Affected files

| File | Change |
|---|---|
| `src/typechecker.js` | Add `strings.Builder` and `bytes.Buffer` as known struct types with their method signatures |
| `src/codegen/expressions.js` | Emit inline JS for each method call |
| `src/codegen.js` | Emit zero values for `strings.Builder` and `bytes.Buffer` |
| `test/builtins/stdlib.test.js` | New section with Builder/Buffer tests |
