# Plan: `unicode/utf8` package

## Goal

Add a `utf8` shim covering the functions Go developers use to work with strings as
sequences of Unicode code points rather than bytes. This is the correct answer to "how
many characters is this string?" — a question that comes up constantly when handling
user-visible text.

In GoFront, strings are JavaScript strings (UTF-16). The `utf8` shim operates on JS
strings rather than byte slices, which means the semantics are an approximation: byte
offsets returned are UTF-16 code unit offsets, not true UTF-8 byte offsets. This is
documented as a known semantic difference.

## Scope

| Function | Go signature | JS translation |
|---|---|---|
| `utf8.RuneCountInString(s)` | `func(string) int` | `[...s].length` (spread splits on code points) |
| `utf8.RuneLen(r)` | `func(rune) int` | code-point-to-UTF8-byte-length via ranges |
| `utf8.ValidString(s)` | `func(string) bool` | check for lone surrogates via regex |
| `utf8.ValidRune(r)` | `func(rune) bool` | `r>=0 && r<=0x10FFFF && !(r>=0xD800 && r<=0xDFFF)` |
| `utf8.RuneError` | `rune` constant | `0xFFFD` |
| `utf8.MaxRune` | `rune` constant | `0x10FFFF` |
| `utf8.UTFMax` | `int` constant | `4` |
| `utf8.DecodeRuneInString(s)` | `func(string) (rune, int)` | first code point + its code-unit size |
| `utf8.DecodeLastRuneInString(s)` | `func(string) (rune, int)` | last code point + size |
| `utf8.FullRuneInString(s)` | `func(string) bool` | `s.length > 0` (all JS strings are valid sequences) |

## Approach

### TypeChecker

Import path `"unicode/utf8"` maps to local name `utf8` (same pattern as `math/rand` →
`rand`). Register a `utf8` namespace:

```js
this.globals.define("utf8", {
  kind: "namespace",
  name: "utf8",
  members: {
    RuneCountInString:      { kind: "func", params: [STRING], returns: [INT] },
    RuneLen:                { kind: "func", params: [INT], returns: [INT] },
    ValidString:            { kind: "func", params: [STRING], returns: [BOOL] },
    ValidRune:              { kind: "func", params: [INT], returns: [BOOL] },
    DecodeRuneInString:     { kind: "func", params: [STRING], returns: [INT, INT] },
    DecodeLastRuneInString: { kind: "func", params: [STRING], returns: [INT, INT] },
    FullRuneInString:       { kind: "func", params: [STRING], returns: [BOOL] },
    RuneError: INT,   // constant
    MaxRune:   INT,
    UTFMax:    INT,
  },
});
```

Constants (`RuneError`, `MaxRune`, `UTFMax`) are handled as SelectorExpr in codegen,
same as `math.Pi` and `io.EOF`.

### CodeGen

Add `case "utf8":` in `_genStdlibCall` delegating to `_genUtf8(fn, a, expr)`.

Constants via SelectorExpr (no args):
```js
// utf8.RuneError → 0xFFFD
// utf8.MaxRune   → 0x10FFFF
// utf8.UTFMax    → 4
```

**`utf8.RuneCountInString(s)`**:
```js
[...s].length
```

**`utf8.RuneLen(r)`** — returns the number of UTF-8 bytes needed for rune `r`:
```js
((r) => r < 0 ? -1 : r <= 0x7F ? 1 : r <= 0x7FF ? 2 : r <= 0xFFFF ? (r>=0xD800&&r<=0xDFFF?-1:3) : r <= 0x10FFFF ? 4 : -1)(r)
```

**`utf8.ValidString(s)`** — a string with lone surrogates is invalid UTF-8:
```js
!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)
```

**`utf8.ValidRune(r)`**:
```js
r >= 0 && r <= 0x10FFFF && !(r >= 0xD800 && r <= 0xDFFF)
```

**`utf8.DecodeRuneInString(s)`** — returns `(rune, size)`:
```js
((s) => { if (!s) return [0xFFFD, 0]; const cp = s.codePointAt(0); return [cp, cp > 0xFFFF ? 2 : 1]; })(s)
```
Note: `size` here is JS code-unit size, not UTF-8 byte size. Documented as a semantic
difference.

**`utf8.DecodeLastRuneInString(s)`**:
```js
((s) => { if (!s) return [0xFFFD, 0]; const cp = s.codePointAt(s.length > 1 && s.charCodeAt(s.length-1) >= 0xDC00 && s.charCodeAt(s.length-1) <= 0xDFFF ? s.length-2 : s.length-1); return [cp, cp > 0xFFFF ? 2 : 1]; })(s)
```

**`utf8.FullRuneInString(s)`**:
```js
s.length > 0
```

## Edge cases

- Surrogate pairs: JS strings can contain lone surrogates (invalid Unicode). `ValidString`
  detects these. `RuneCountInString` via `[...s]` throws on lone surrogates in some
  engines — add a fallback: `s.length > 0 && /[\uD800-\uDFFF]/.test(s) ? s.length : [...s].length`.
- `RuneLen(-1)` returns `-1` (invalid rune) — the range check handles this.
- `DecodeRuneInString("")` returns `(RuneError, 0)` — handled by the empty-string guard.

## Semantic differences

- **Byte offsets are JS code-unit offsets**: `DecodeRuneInString` returns a size in JS
  `string` code units (1 or 2), not UTF-8 bytes (1–4). Code that uses these sizes for
  byte-level slicing will behave differently.
- **`RuneCountInString`** uses `[...s]` which splits on Unicode code points, so it
  counts grapheme clusters incorrectly for combining characters — same limitation as Go
  `utf8.RuneCountInString` itself, so this is consistent.

## JS output examples

```go
n := utf8.RuneCountInString("héllo")   // 5, not 6
ok := utf8.ValidString(s)
r, size := utf8.DecodeRuneInString("café")
```

```js
let n = [..."héllo"].length;
let ok = !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
let [r, size] = ((s) => { if (!s) return [0xFFFD, 0]; const cp = s.codePointAt(0); return [cp, cp > 0xFFFF ? 2 : 1]; })("café");
```
