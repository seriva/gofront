# Built-in Minifier — Design Plan

## Goal

Replace the `terser` dependency with a purpose-built minifier that understands GoFront's
own output. GoFront emits clean, predictable JavaScript — no JSX, no decorators, no
dynamic `eval` — which means a focused minifier can cover 100% of the output surface
without the full complexity of a general-purpose tool.

Removing terser eliminates the only external runtime dependency, keeps `npm install`
instant, and lets the compiler ship as a true zero-dependency tool.

## Approach

The minifier operates as a post-CodeGen text transformation pass in `src/minifier.js`,
invoked from `src/index.js` when `--minify` is passed. It works directly on the JS
string output — no second AST parse required.

### Stage 1 — Comment and whitespace stripping

- Remove all `// ...` line comments (safe: GoFront never emits URLs or directives in
  comments).
- Remove all `/* ... */` block comments.
- Collapse sequences of whitespace/newlines into a single space or nothing, depending on
  context.
- Strip leading/trailing whitespace from every line.

### Stage 2 — Token-level compression

Walk the token stream (simple regex-based tokenizer — identifiers, operators, strings,
numbers) and:

- Remove spaces around operators and punctuation where unambiguous:
  `a + b` → `a+b`, `{ return` → `{return`, `} else {` → `}else{`.
- Preserve spaces that prevent token merging:
  `return x` (not `returnx`), `let a` (not `leta`), `typeof x` (not `typeofx`).
- Keep string and template literal contents entirely intact.

### Stage 3 — Identifier mangling (optional, `--mangle` flag)

Map long internal identifiers to short names (`__append` → `_a`, local variables
`result` → `r`, etc.) using a frequency-sorted assignment. Skip:

- Exported class names and method names (accessed from outside by HTML/other JS).
- Identifiers starting with `__` that are tree-shaken helpers (already short).
- Property accesses on `any`-typed values (DOM API names, localStorage, etc.).

This stage is optional and disabled by default because it makes debugging harder. Users
opt in with `--minify --mangle`.

### Stage 4 — Literal folding

- Fold constant numeric expressions that GoFront emits inline:
  `Math.trunc(Number(65))` is never emitted, but `0 + 0` style patterns from iota
  sequences can be pre-evaluated.
- Shorten `null` checks: `=== null` stays as-is (already minimal).

## Edge cases

- **String contents**: never touch characters inside string literals or template
  literals. Track quote depth carefully, including escaped quotes (`\"`, `\'`, `` \` ``).
- **Regex literals**: GoFront emits `/\p{L}/u` style regexes in unicode shims. These
  must be preserved verbatim — no whitespace stripping inside `/pattern/flags`.
- **Source maps**: if `--source-map` is also passed, minification must be skipped or the
  source map must be regenerated. For v0.0.5 emit an error if both flags are combined.
- **`__sprintf` format strings**: the `%v` format string passed to `__sprintf` is a
  runtime string, not a compile-time constant — do not fold it.
- **IIFE wrappers**: GoFront emits `(function() { ... })()` for `init()`. The parens
  must be preserved.

## JS output examples

### Before minification

```js
function esc(s) {
  let out = "";
  for (const [_$, r] of Array.from(s, (__c, __i) => [__i, __c.codePointAt(0)])) {
    switch (r) {
      case 38: { out = out + "&amp;"; break; }
      case 60: { out = out + "&lt;"; break; }
      default: { out = out + String.fromCodePoint(r); break; }
    }
  }
  return out;
}
```

### After minification (stage 1 + 2)

```js
function esc(s){let out="";for(const[_$,r]of Array.from(s,(__c,__i)=>[__i,__c.codePointAt(0)])){switch(r){case 38:{out=out+"&amp;";break;}case 60:{out=out+"&lt;";break;}default:{out=out+String.fromCodePoint(r);break;}}}return out;}
```

### After mangling (stage 3, with `--mangle`)

```js
function esc(a){let b="";for(const[c,d]of Array.from(a,(e,f)=>[f,e.codePointAt(0)])){switch(d){case 38:{b=b+"&amp;";break;}case 60:{b=b+"&lt;";break;}default:{b=b+String.fromCodePoint(d);break;}}}return b;}
```

## Affected files

| File | Change |
|---|---|
| `src/minifier.js` | New file — implements all four stages |
| `src/index.js` | Replace dynamic terser import with `import { minify } from "./minifier.js"` |
| `package.json` | Remove `terser` from `devDependencies` |
| `test/minifier.test.js` | New test file — stage-level unit tests + round-trip tests |
| `test/run.js` | Register `minifier.test.js` |

## Size estimate

A GoFront-specific minifier needs no parser (output is already structured), no scope
analysis for stage 1–2, and only a simple symbol table for stage 3. Expected
implementation size: ~300–400 lines.

Expected output size reduction on a typical GoFront bundle: 30–40% (whitespace/comments
only), 50–60% with mangling.
