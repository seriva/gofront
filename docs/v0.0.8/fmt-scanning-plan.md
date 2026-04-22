# Plan: `fmt` scanning — `Sscan`, `Sscanf`, `Sscanln`

## Goal

Add the input-parsing side of the `fmt` package. The formatting side (`Sprintf`,
`Printf`, `Println`, `Fprintf`, etc.) already exists. Adding `Sscan`/`Sscanf` makes
GoFront viable for code that parses strings — common in competitive programming and
input-processing utilities.

## Scope

| Function | Go signature |
|---|---|
| `fmt.Sscan(str, &v1, &v2, ...)` | Scans whitespace-separated tokens into pointers |
| `fmt.Sscanln(str, &v1, &v2, ...)` | Like `Sscan` but stops at newline |
| `fmt.Sscanf(str, format, &v1, ...)` | Scans with format verbs |

All three return `(n int, err error)` where `n` is the number of items successfully
scanned.

## Approach

### TypeChecker

Add to the `fmt` namespace:

```js
Sscan:   { kind: "func", params: [STRING, ...variadic ANY], returns: [INT, ERROR], variadic: true }
Sscanln: { kind: "func", params: [STRING, ...variadic ANY], returns: [INT, ERROR], variadic: true }
Sscanf:  { kind: "func", params: [STRING, STRING, ...variadic ANY], returns: [INT, ERROR], variadic: true }
```

The pointer arguments (`&v`) compile to `{ value: v }` wrapper objects. The scanner
must write back into `.value` to mutate the caller's variable.

### CodeGen — `fmt.Sscan` / `fmt.Sscanln`

Split the string on whitespace (or on newline boundary for `Sscanln`), then coerce each
token into the target type by inspecting the wrapper's current value type.

Emit an inline IIFE:

```js
((str, ...ptrs) => {
  const tokens = str.trim().split(/\s+/);
  let n = 0;
  for (let i = 0; i < ptrs.length && i < tokens.length; i++) {
    const t = tokens[i];
    const p = ptrs[i];
    if (typeof p.value === "number") p.value = Number(t);
    else if (typeof p.value === "boolean") p.value = t === "true";
    else p.value = t;
    n++;
  }
  return [n, n < ptrs.length ? "unexpected EOF" : null];
})(str, ptr1, ptr2, ...)
```

For `Sscanln`, split on `\n` first, then on whitespace within the first line.

### CodeGen — `fmt.Sscanf`

Parse the format string at compile time where possible, or emit a runtime parser.

Supported verbs: `%d` (int), `%f` / `%g` (float), `%s` (string), `%t` (bool),
`%v` (any — same as `%s` fallback).

Emit a runtime parser that walks the format string:

```js
((str, fmt, ...ptrs) => {
  let s = str, n = 0, p = 0;
  const fmtRe = /%[dfgstvq%]/g;
  let m;
  while ((m = fmtRe.exec(fmt)) !== null && p < ptrs.length) {
    // consume literal prefix
    const lit = fmt.slice(fmtRe.lastIndex - m[0].length - (fmt.slice(0, m.index).length - s.length), m.index);
    // ... match token from s, coerce, assign to ptrs[p++]
  }
  return [n, n < ptrs.length ? "input does not match format" : null];
})(str, format, ptr1, ptr2, ...)
```

The full runtime parser is non-trivial. A simpler approach for the first pass:
treat `%d`/`%f`/`%s`/`%v` as whitespace-separated tokens (same as `Sscan`) and ignore
literal format separators. This covers the vast majority of real usage.

## Edge cases

- Width specifiers (`%5d`) — ignored in the first pass; document as a known limitation.
- `%q` (quoted string) — ignored for now.
- Mismatched count (fewer tokens than pointers) — return `(n, "unexpected EOF")`.
- Non-pointer arguments — the typechecker accepts `ANY` variadic; the codegen assumes
  all extra arguments are `{ value: T }` wrappers (the result of `&v` in GoFront).

## JS output examples

```go
var x, y int
fmt.Sscan("42 99", &x, &y)

var name string
var age int
fmt.Sscanf("Alice 30", "%s %d", &name, &age)
```

```js
let x = 0, y = 0;
((str, ...ptrs) => { ... })("42 99", {value: x}, {value: y});

let name = "", age = 0;
((str, fmt, ...ptrs) => { ... })("Alice 30", "%s %d", {value: name}, {value: age});
```

## Semantic differences

- GoFront pointers are `{ value: T }` wrappers — the scanner writes back via `.value`.
  This works for scalar variables. Struct fields are not addressable (existing GoFront
  limitation) so `fmt.Sscanf` into a struct field is not supported.
- Width specifiers and most exotic verbs are not supported in the first pass.

## Not in scope

- `fmt.Scan` / `fmt.Scanln` (reads from stdin) — no stdin in the browser.
- `fmt.Fscan` (reads from `io.Reader`) — depends on io.Reader shim being stable first.
