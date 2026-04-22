# Plan: `path` package

## Goal

Add a `path` shim for the functions Go developers use to manipulate slash-separated
paths. In a browser context these map directly to URL path segments, making `path` more
useful than `path/filepath` (which uses OS-specific separators). All functions are pure
string operations — trivial to implement inline with no helper overhead.

## Scope

| Function | Go signature | JS translation |
|---|---|---|
| `path.Base(p)` | `func(string) string` | last path element (after final `/`) |
| `path.Dir(p)` | `func(string) string` | everything up to final `/`, or `"."` |
| `path.Ext(p)` | `func(string) string` | file extension including `.`, or `""` |
| `path.Join(elem...)` | `func(...string) string` | join with `/`, clean result |
| `path.Clean(p)` | `func(string) string` | lexically clean path (remove `.`, `..`, double slashes) |
| `path.IsAbs(p)` | `func(string) bool` | `p.startsWith("/")` |
| `path.Match(pattern, name)` | `func(string, string) (bool, error)` | glob matching |
| `path.Split(p)` | `func(string) (dir, file string)` | splits into dir + file components |

## Approach

### TypeChecker

Register `path` as a namespace. `path.Match` returns `(bool, error)`.

```js
this.globals.define("path", {
  kind: "namespace",
  name: "path",
  members: {
    Base:  { kind: "func", params: [STRING], returns: [STRING] },
    Dir:   { kind: "func", params: [STRING], returns: [STRING] },
    Ext:   { kind: "func", params: [STRING], returns: [STRING] },
    Join:  { kind: "func", params: [STRING], returns: [STRING], variadic: true },
    Clean: { kind: "func", params: [STRING], returns: [STRING] },
    IsAbs: { kind: "func", params: [STRING], returns: [BOOL] },
    Split: { kind: "func", params: [STRING], returns: [STRING, STRING] },
    Match: { kind: "func", params: [STRING, STRING], returns: [BOOL, ERROR] },
  },
});
```

### CodeGen

Add `case "path":` in `_genStdlibCall` delegating to `_genPath(fn, a)`.

**`path.Base(p)`** — Go returns `"."` for empty string, strips trailing slashes:
```js
((p) => { if (!p) return "."; p = p.replace(/\/+$/, ""); const i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1) || "/"; })(p)
```

**`path.Dir(p)`** — Go returns `"."` when there is no directory component:
```js
((p) => { const i = p.lastIndexOf("/"); if (i < 0) return "."; if (i === 0) return "/"; return p.slice(0, i); })(p)
```

**`path.Ext(p)`** — extension is the suffix starting at the last `.` in the base:
```js
((p) => { const b = p.slice(p.lastIndexOf("/") + 1); const i = b.lastIndexOf("."); return i <= 0 ? "" : b.slice(i); })(p)
```

**`path.Join(...elems)`** — join non-empty parts with `/`, then clean:
```js
(((...a) => __pathClean(a.filter(Boolean).join("/"))))(elem1, elem2, ...)
```
Emit `__pathClean` as a tree-shaken helper (used by both `Join` and `Clean`):
```js
function __pathClean(p) {
  if (!p) return ".";
  const abs = p.startsWith("/");
  const parts = p.split("/").reduce((acc, s) => {
    if (s === "" || s === ".") return acc;
    if (s === "..") { if (acc.length && acc[acc.length-1] !== "..") acc.pop(); else if (!abs) acc.push(".."); }
    else acc.push(s);
    return acc;
  }, []);
  return (abs ? "/" : "") + (parts.join("/") || ".");
}
```

**`path.Clean(p)`**:
```js
__pathClean(p)
```

**`path.IsAbs(p)`**:
```js
p.startsWith("/")
```

**`path.Split(p)`** — returns `(dir, file)`:
```js
((p) => { const i = p.lastIndexOf("/"); return i < 0 ? ["", p] : [p.slice(0, i+1), p.slice(i+1)]; })(p)
```

**`path.Match(pattern, name)`** — translate glob pattern to regex:
```js
((pat, name) => {
  try {
    const re = new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$");
    return [re.test(name), null];
  } catch(e) {
    return [false, "syntax error in pattern"];
  }
})(pattern, name)
```

## Edge cases

- `path.Join()` with zero arguments returns `""` — handled by `filter(Boolean).join("/")` → `__pathClean("")` → `"."`. Match Go's behaviour.
- `path.Base("/")` returns `"/"` — handled by the `|| "/"` fallback.
- `path.Dir("/foo")` returns `"/"` — the `i === 0` guard returns `"/"`.
- `path.Clean("")` returns `"."` — the `if (!p)` guard handles this.
- `path.Match` — `[` character ranges and `{a,b}` brace expansion are not supported in
  this first pass. Document as a known limitation.

## `path/filepath`

`path/filepath` uses OS-specific separators. In a browser there is no OS, so `filepath`
is identical to `path`. Register `filepath` as an alias pointing to the same codegen
as `path`. This lets Go code that imports `path/filepath` compile unchanged.

## JS output examples

```go
base := path.Join("/usr", "local", "bin")   // "/usr/local/bin"
ext  := path.Ext("README.md")               // ".md"
dir  := path.Dir("/a/b/c.txt")              // "/a/b"
d, f := path.Split("/a/b/c.txt")            // "/a/b/", "c.txt"
```

```js
let base = __pathClean(["/usr","local","bin"].filter(Boolean).join("/"));
let ext  = ((p)=>{ const b=p.slice(p.lastIndexOf("/")+1); const i=b.lastIndexOf("."); return i<=0?'':b.slice(i); })("README.md");
let dir  = ((p)=>{ const i=p.lastIndexOf("/"); if(i<0)return"."; if(i===0)return"/"; return p.slice(0,i); })("/a/b/c.txt");
let [d,f]= ((p)=>{ const i=p.lastIndexOf("/"); return i<0?["",p]:[p.slice(0,i+1),p.slice(i+1)]; })("/a/b/c.txt");
```

## Semantic differences

- `path.Match` does not support `[...]` character class syntax or `{a,b}` alternation
  in this release. Complex patterns return `[false, "syntax error in pattern"]`.
- `path/filepath` is treated as identical to `path` — no OS-specific separator logic.
