# Plan: `io.Reader` shim

## Goal

Complete the `io` package by adding the reader side. The writer side (`io.Writer`,
`io.WriteString`, `io.Discard`, `io.EOF`) already landed in v0.0.7. This plan adds
`io.Reader`, `io.ReadAll`, `strings.NewReader`, and `bytes.NewReader` so that Go code
that reads from in-memory sources compiles unchanged.

## Scope

| Symbol | Type | Behaviour |
|---|---|---|
| `io.Reader` | interface | `{ Read(p []byte) (int, error) }` — typed as `ANY` for compatibility |
| `io.ReadAll(r)` | `func(io.Reader) ([]byte, error)` | Reads entire reader; dispatches on concrete type |
| `strings.NewReader(s)` | `func(string) *strings.Reader` | Returns a reader shim over a string |
| `bytes.NewReader(b)` | `func([]byte) *bytes.Reader` | Returns a reader shim over a byte slice |
| `strings.Reader` | named type | `{ _src: string, _pos: int }` — methods: `Read`, `ReadAt`, `Len`, `Reset`, `Seek` |
| `bytes.Reader` | named type | `{ _src: Uint8Array, _pos: int }` — same method set |

## Approach

### TypeChecker

- `strings.NewReader` → returns `{ kind: "pointer", base: { kind: "named", name: "strings.Reader", underlying: ANY } }`
- `bytes.NewReader` → same pattern with `"bytes.Reader"`
- `io.ReadAll` → `func(ANY) ([]{byte}, error)` — accepts any reader
- `io.Reader` already registered as `ANY`; no change needed

### CodeGen

**`strings.NewReader(s)`** emits:
```js
{ _src: s, _pos: 0, Read(p) { const n = Math.min(p.length, this._src.length - this._pos); for (let i = 0; i < n; i++) p[i] = this._src.charCodeAt(this._pos + i); this._pos += n; return [n, n === 0 ? "EOF" : null]; }, Len() { return this._src.length - this._pos; }, Reset(s) { this._src = s; this._pos = 0; } }
```

**`bytes.NewReader(b)`** emits:
```js
{ _src: b, _pos: 0, Read(p) { const n = Math.min(p.length, this._src.length - this._pos); for (let i = 0; i < n; i++) p[i] = this._src[this._pos + i]; this._pos += n; return [n, n === 0 ? "EOF" : null]; }, Len() { return this._src.length - this._pos; }, Reset(b) { this._src = b; this._pos = 0; } }
```

**`io.ReadAll(r)`** emits a runtime dispatch:
```js
((r) => {
  const w = r?.value ?? r;
  if (typeof w._src === "string") {
    const s = w._src.slice(w._pos);
    w._pos = w._src.length;
    return [new TextEncoder().encode(s), null];
  }
  if (Array.isArray(w._src) || ArrayBuffer.isView(w._src)) {
    const b = w._src.slice(w._pos);
    w._pos = w._src.length;
    return [b, null];
  }
  // Generic: call Read in a loop
  const chunks = [];
  const buf = new Array(4096);
  let err = null;
  while (!err) {
    const [n, e] = w.Read(buf);
    if (n > 0) chunks.push(...buf.slice(0, n));
    err = e;
  }
  return [chunks, err === "EOF" ? null : err];
})(r)
```

### Method calls on `strings.Reader` / `bytes.Reader`

`r.Len()`, `r.Reset(s)` — when the typechecker sees a method call on a
`strings.Reader` or `bytes.Reader` named type, it resolves to `ANY` return so the call
passes through. Codegen emits the plain JS method call (the shim object has the methods).

## Edge cases

- Pointer to reader: `io.ReadAll` receives `*strings.Reader` — the `r?.value ?? r`
  dereference in the generic dispatch handles this.
- `io.Copy(dst, src)` — out of scope for this release; requires both reader and writer
  dispatch in one call. Add a note in the plan.
- `bufio.Scanner` / `bufio.Reader` — out of scope; requires line-at-a-time buffering.

## JS output examples

```go
r := strings.NewReader("hello world")
data, err := io.ReadAll(r)
fmt.Println(string(data))
```

```js
let r = { _src: "hello world", _pos: 0, Read(p) { ... }, Len() { ... }, Reset(s) { ... } };
let [data, err] = ((r) => { ... })(r);
console.log(__sprintf("%v", String.fromCharCode(...data)));
```

## Not in scope

- `io.Copy` — deferred to v0.0.9
- `bufio` package — deferred; requires stateful line buffering
- `io.LimitReader`, `io.MultiReader`, `io.TeeReader` — deferred
