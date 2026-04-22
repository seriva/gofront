# Plan: stdlib gaps — math, sort, strings, bytes, strconv

Fills in the most-used functions that are missing from already-present packages.
All changes are TypeChecker + CodeGen only — no parser or lexer work needed.

---

## `math` package additions

| Function | JS translation |
|---|---|
| `math.Atan(x)` | `Math.atan(x)` |
| `math.Atan2(y, x)` | `Math.atan2(y, x)` |
| `math.Asin(x)` | `Math.asin(x)` |
| `math.Acos(x)` | `Math.acos(x)` |
| `math.Exp(x)` | `Math.exp(x)` |
| `math.Exp2(x)` | `Math.pow(2, x)` |
| `math.Trunc(x)` | `Math.trunc(x)` |
| `math.Hypot(p, q)` | `Math.hypot(p, q)` |
| `math.Signbit(x)` | `x < 0 \|\| Object.is(x, -0)` |
| `math.Copysign(x, y)` | `Math.abs(x) * (y < 0 \|\| Object.is(y, -0) ? -1 : 1)` |
| `math.Dim(x, y)` | `Math.max(x - y, 0)` |
| `math.Remainder(x, y)` | `x - Math.round(x/y)*y` |

Already implemented — do not duplicate: `Abs`, `Floor`, `Ceil`, `Round`, `Sqrt`, `Cbrt`,
`Pow`, `Log`, `Log2`, `Log10`, `Sin`, `Cos`, `Tan`, `Min`, `Max`, `Mod`, `Inf`, `IsNaN`,
`IsInf`, `NaN`, `Pi`, `E`, `MaxFloat64`, `SmallestNonzeroFloat64`, `MaxInt`, `MinInt`.

---

## `sort` package additions

### `sort.Search`

Go: `sort.Search(n int, f func(int) bool) int` — binary search returning the smallest
index `i` in `[0, n)` for which `f(i)` is true. Returns `n` if none found.

```js
((n, f) => { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >>> 1; if (f(mid)) hi = mid; else lo = mid + 1; } return lo; })(n, f)
```

### Sorted-check helpers

| Function | JS translation |
|---|---|
| `sort.IntsAreSorted(a)` | `a.every((v,i,a) => i===0 \|\| a[i-1] <= v)` |
| `sort.Float64sAreSorted(a)` | same |
| `sort.StringsAreSorted(a)` | `a.every((v,i,a) => i===0 \|\| a[i-1] <= v)` |

---

## `strings` package additions

| Function | JS translation |
|---|---|
| `strings.Fields(s)` | `s.trim()===''?[]:s.trim().split(/\s+/)` |
| `strings.Cut(s, sep)` | `(before, after, found)` — inline split on first occurrence |
| `strings.CutPrefix(s, pre)` | `s.startsWith(pre) ? [s.slice(pre.length), true] : [s, false]` |
| `strings.CutSuffix(s, suf)` | `s.endsWith(suf) ? [s.slice(0,-suf.length), true] : [s, false]` |
| `strings.SplitN(s, sep, n)` | inline bounded split |
| `strings.SplitAfter(s, sep)` | split keeping separator at end of each part |
| `strings.SplitAfterN(s, sep, n)` | bounded `SplitAfter` |
| `strings.IndexAny(s, chars)` | `Math.min` of per-char `.indexOf`, or `-1` |
| `strings.LastIndexAny(s, chars)` | `Math.max` of per-char `.lastIndexOf`, or `-1` |
| `strings.ContainsAny(s, chars)` | `[...chars].some(c => s.includes(c))` |
| `strings.ContainsRune(s, r)` | `s.includes(String.fromCodePoint(r))` |
| `strings.IndexRune(s, r)` | `s.indexOf(String.fromCodePoint(r))` |
| `strings.IndexByte(s, b)` | `s.indexOf(String.fromCharCode(b))` |
| `strings.LastIndexByte(s, b)` | `s.lastIndexOf(String.fromCharCode(b))` |
| `strings.Map(f, s)` | `[...s].map(c=>String.fromCodePoint(f(c.codePointAt(0)))).join('')` |
| `strings.Title(s)` | `s.replace(/\b\w/g, c=>c.toUpperCase())` (deprecated in Go, still widely used) |
| `strings.ToTitle(s)` | `s.toUpperCase()` |
| `strings.TrimFunc(s, f)` | trim leading/trailing runes where `f(r)` is true |
| `strings.TrimLeftFunc(s, f)` | trim leading runes where `f(r)` is true |
| `strings.TrimRightFunc(s, f)` | trim trailing runes where `f(r)` is true |
| `strings.IndexFunc(s, f)` | first index where `f(r)` is true, or `-1` |
| `strings.LastIndexFunc(s, f)` | last index where `f(r)` is true, or `-1` |
| `strings.NewReplacer(pairs...)` | returns shim object with `.Replace(s)` method |

### Key translations

**`strings.Cut`** — returns `(before, after string, found bool)`:
```js
((s,sep)=>{ const i=s.indexOf(sep); return i<0?[s,"",false]:[s.slice(0,i),s.slice(i+sep.length),true]; })(s, sep)
```

**`strings.SplitN`** — `n<0` means no limit (same as `Split`):
```js
((s,sep,n)=>{ if(n===0) return []; if(n<0||sep==="") return s.split(sep); const r=[]; let cur=s; for(let i=1;i<n&&cur.length;i++){ const j=cur.indexOf(sep); if(j<0) break; r.push(cur.slice(0,j)); cur=cur.slice(j+sep.length); } r.push(cur); return r; })(s, sep, n)
```

**`strings.TrimFunc`**:
```js
((s,f)=>{ let l=0,r=s.length; while(l<r&&f(s.codePointAt(l)))l++; while(r>l&&f(s.codePointAt(r-1)))r--; return s.slice(l,r); })(s, f)
```

**`strings.IndexFunc`**:
```js
((s,f)=>{ for(let i=0;i<s.length;i++){ const cp=s.codePointAt(i); if(f(cp)) return i; if(cp>0xFFFF) i++; } return -1; })(s, f)
```

**`strings.NewReplacer`** — emit a plain JS object at call-site:
```js
((...pairs)=>{ const p=[]; for(let i=0;i<pairs.length;i+=2) p.push([pairs[i],pairs[i+1]]); return { _p:p, Replace(s){ let r=s; for(const [o,n] of this._p) r=r.split(o).join(n); return r; } }; })(old1, new1, ...)
```
Method calls on the result (`r.Replace(s)`) pass through as normal JS method calls since
the shim object carries the method.

---

## `bytes` package additions

The `bytes` shim currently lags behind `strings`. Add parity for the most-used functions.

| Function | JS translation |
|---|---|
| `bytes.ReplaceAll(b, old, new)` | split-join on byte arrays |
| `bytes.TrimPrefix(b, pre)` | slice off prefix if present |
| `bytes.TrimSuffix(b, suf)` | slice off suffix if present |
| `bytes.TrimLeft(b, cutset)` | trim leading bytes in cutset |
| `bytes.TrimRight(b, cutset)` | trim trailing bytes in cutset |
| `bytes.TrimFunc(b, f)` | trim leading/trailing bytes where `f(r)` is true |
| `bytes.IndexByte(b, c)` | `b.indexOf(c)` |
| `bytes.LastIndex(b, sub)` | find last occurrence of sub-slice |
| `bytes.LastIndexByte(b, c)` | `b.lastIndexOf(c)` |
| `bytes.Fields(b)` | split on whitespace bytes, filter empty |
| `bytes.Cut(b, sep)` | `(before, after []byte, found bool)` — split on first occurrence |
| `bytes.ContainsAny(b, chars)` | any char in cutset present in bytes |
| `bytes.ContainsRune(b, r)` | rune encoded as UTF-8 present in bytes |
| `bytes.Map(f, b)` | rune-level mapping |
| `bytes.SplitN(b, sep, n)` | bounded split |

### Key translations

**`bytes.ReplaceAll(b, old, new)`** — treat byte arrays as comparable sequences:
```js
((b,o,n)=>{ const r=[]; let i=0; while(i<=b.length-o.length){ if(o.every((v,j)=>b[i+j]===v)){r.push(...n);i+=o.length;}else r.push(b[i++]); } return r.concat(b.slice(i)); })(b, old, newb)
```

**`bytes.Cut`** — returns `(before, after []byte, found bool)`:
```js
((b,sep)=>{ for(let i=0;i<=b.length-sep.length;i++){ if(sep.every((v,j)=>b[i+j]===v)) return [b.slice(0,i),b.slice(i+sep.length),true]; } return [b.slice(),[],false]; })(b, sep)
```

---

## `strconv` package additions

| Function | JS translation |
|---|---|
| `strconv.Quote(s)` | `JSON.stringify(s)` — wraps in `"..."` with escape sequences |
| `strconv.Unquote(s)` | `JSON.parse(s)` wrapped in try/catch returning `(string, error)` |
| `strconv.AppendInt(dst, n, base)` | `[...dst, ...new TextEncoder().encode(n.toString(base))]` |
| `strconv.AppendFloat(dst, f, fmt, prec, bitSize)` | append float string bytes to slice |

`strconv.Quote` / `strconv.Unquote` use `JSON.stringify` / `JSON.parse` which match Go's
quoted-string format for ASCII. Unicode escapes differ slightly (`\uXXXX` vs `\UXXXXXXXX`)
but cover the overwhelming majority of real-world use.

---

## Implementation order

1. `math` additions — pure switch-case additions, no structural change.
2. `sort` additions — three new sorted-check cases + `sort.Search`.
3. `strings` additions — several switch cases; `Cut`/`SplitN` need tuple/array returns.
4. `bytes` additions — mirror the strings additions for byte slices.
5. `strconv.Quote`/`Unquote` — two cases; `Unquote` needs try/catch in emitted JS.
6. `strings.NewReplacer` — last; verify method-call dispatch works on the shim object.

---

## JS output examples

```go
words := strings.Fields("  foo  bar  ")
before, after, ok := strings.Cut("user:pass", ":")
i := sort.Search(len(a), func(i int) bool { return a[i] >= x })
quoted := strconv.Quote("hello\nworld")
```

```js
let words = "  foo  bar  ".trim()===''?[]:("  foo  bar  ").trim().split(/\s+/);
let [before, after, ok] = ((s,sep)=>{ const i=s.indexOf(sep); return i<0?[s,"",false]:[s.slice(0,i),s.slice(i+sep.length),true]; })("user:pass",":");
let i = ((n,f)=>{ let lo=0,hi=n; while(lo<hi){ const mid=(lo+hi)>>>1; if(f(mid))hi=mid; else lo=mid+1; } return lo; })(a.length,(i)=>a[i]>=x);
let quoted = JSON.stringify("hello\nworld");
```
