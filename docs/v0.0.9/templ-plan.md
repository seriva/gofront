# Plan: `.templ` file support

## Goal

Add native `.templ` file support to the GoFront compiler. `.templ` files use the same
syntax as the [templ](https://templ.guide) library for Go, allowing developers to write
declarative HTML components in a familiar authoring experience. The compiler translates
`templ` declarations to Go functions returning `gom.Node`, which then compile to DOM
manipulation JavaScript via the `gom` built-in.

This is a **syntax transformation only** — no new runtime is introduced. Every
`.templ` component becomes a regular GoFront function.

## Syntax overview

```
// hello.templ
package main

templ Hello(name string) {
    <div class="greeting">
        <p>Hello, { name }!</p>
    </div>
}

templ Layout(title string) {
    <html>
        <head><title>{ title }</title></head>
        <body>
            { children... }
        </body>
    </html>
}
```

The `templ` keyword introduces a component declaration. The body is an HTML block.
Go expressions appear in `{ }`. Child components are composed with `@`. Slot content
is passed via `{ children... }`.

## Compiler pipeline changes

```
.templ file
  → TemplLexer    (src/templ-lexer.js)   → token stream (Go + HTML modes)
  → TemplParser   (src/templ-parser.js)  → AST with TemplDecl nodes
  → [merge into package AST]
  → TypeChecker   (existing)             → type-check like a normal func
  → CodeGen       (existing + new case)  → emit gom.Node function
```

`.go` and `.templ` files in the same package directory are compiled together.
`compiler.js` detects `.templ` files and routes them through the templ lexer/parser
before merging their AST nodes into the package-level declaration list.

## Lexer (`src/templ-lexer.js`)

The templ lexer is a new file that extends the base GoFront lexer with an HTML mode.

**Two modes:**
- **Go mode** — standard GoFront token stream (function signatures, expressions, imports)
- **HTML mode** — entered when `{` opens a `templ` body; tokenises HTML tags, text, and
  `{ }` expression escapes back to Go mode

**Mode transitions:**
- `templ Name(params) {` → enter HTML mode for the body
- `{ expr }` inside HTML → momentary Go mode for the expression, then back to HTML
- `@component(args)` → Go mode for the call expression
- `{ children... }` → special `TemplChildren` token
- closing `}` at the templ body level → exit HTML mode

**Tokens produced in HTML mode:**

| Token | Example |
|---|---|
| `HtmlOpenTag` | `<div class="foo">` |
| `HtmlCloseTag` | `</div>` |
| `HtmlSelfClose` | `<input type="text"/>` |
| `HtmlText` | `Hello, ` |
| `TemplExpr` | `{ name }` → wrapped Go expression |
| `TemplComponent` | `@Hello(name)` |
| `TemplChildren` | `{ children... }` |
| `TemplIf` | `if cond {` inside template |
| `TemplFor` | `for _, v := range items {` inside template |
| `TemplSwitch` | `switch val {` inside template |

Attribute values that are Go expressions use `{ }`:
```
<div class={ cls }>   → HtmlOpenTag with expr attribute
```

## Parser (`src/templ-parser.js`)

Parses the token stream into AST nodes. A `TemplDecl` looks like:

```js
{
  kind: "TemplDecl",
  name: "Hello",           // component name
  params: [...],           // same as FuncDecl params
  children: bool,          // true if { children... } is used → adds ...gom.Node param
  body: TemplNode,         // the root HTML node
}
```

A `TemplNode` is:

```js
{
  kind: "TemplElement",
  tag: "div",
  attrs: [TemplAttr],      // static or expression attributes
  children: [TemplNode],
}

{ kind: "TemplText", value: "Hello, " }
{ kind: "TemplExpr", expr: GoExprAST }          // { name }
{ kind: "TemplComponent", call: CallExprAST }   // @Hello(name)
{ kind: "TemplChildren" }                        // { children... }
{ kind: "TemplIf", cond: GoExprAST, then: TemplNode, else_: TemplNode | null }
{ kind: "TemplFor", stmt: ForStmtAST, body: TemplNode }
{ kind: "TemplSwitch", stmt: SwitchStmtAST, cases: [...] }
```

`TemplAttr`:
```js
{ kind: "StaticAttr",  name: "class", value: "foo" }
{ kind: "ExprAttr",    name: "class", expr: GoExprAST }
{ kind: "BoolAttr",    name: "disabled" }        // <input disabled>
```

### Control flow inside templates

```
if show {
    <p>Visible</p>
} else {
    <p>Hidden</p>
}
```
This is a `TemplIf` node — the condition is a Go expression, the branches are template
bodies. No `@` or `{ }` needed; bare `if`/`for`/`switch` inside a template body are
parsed as template control flow.

```
for _, item := range items {
    <li>{ item.name }</li>
}
```
Emits `gom.Map(items, func(_, item) gom.Node { return gom.Li(...) })` or an equivalent
inline for-loop returning a `gom.Group`.

## TypeChecker

`TemplDecl` nodes are transformed into `FuncDecl` AST nodes before type-checking:

```
templ Hello(name string) { ... }
→
func Hello(name string) gom.Node { ... }
```

If `{ children... }` is used, an extra `children ...gom.Node` parameter is appended.

The body becomes a single `return` statement wrapping the root `gom.Node`. This means
the existing type-checker handles `TemplDecl` with zero changes — it sees a normal
`FuncDecl` returning `gom.Node`.

## CodeGen

`TemplDecl` → `genTemplDecl` which recursively walks the `TemplNode` tree and emits
`gom.*` calls, leveraging the built-in `gom` codegen from v0.0.9.

```
TemplElement("div", attrs, children)
  → gom.Div(...attrNodes, ...childNodes)
  → { Mount(parent) { const el = document.createElement("div"); ... } }

TemplText("Hello, ")
  → gom.Text("Hello, ")

TemplExpr(nameExpr)
  → gom.Text(fmt.Sprint(name))   or   gom.Text(String(name))

TemplComponent(@Hello(arg))
  → Hello(arg)    // direct function call, returns gom.Node

TemplChildren
  → gom.Group(children)   // spread the variadic children param

TemplIf(cond, then, else_)
  → gom.If(cond, thenNode)   or full if-expression

TemplFor(stmt, body)
  → gom.Map(slice, func(i, v) gom.Node { return bodyNode })
```

### `gom` auto-import

When a `.templ` file is compiled, `gom` is automatically added to the package's import
list. Users do not write `import "gom"` in `.templ` files.

### Expression interpolation

`{ expr }` where `expr` is a string → `gom.Text(expr)`
`{ expr }` where `expr` is a non-string → `gom.Text(fmt.Sprint(expr))` (auto-convert)

This matches templ's behaviour where all interpolated values are automatically escaped
and converted to strings.

### HTML escaping

Text content and `{ expr }` values are automatically HTML-escaped via the `html` built-in
(`html.EscapeString`). Raw HTML output is not supported (no `templ.Raw()` equivalent in
the first pass — document as a limitation).

## File handling in `compiler.js`

```js
// Current
const goFiles = files.filter(f => f.endsWith(".go"));

// New
const goFiles    = files.filter(f => f.endsWith(".go"));
const templFiles = files.filter(f => f.endsWith(".templ"));

// Templ files are lexed+parsed separately, then merged
const templDecls = templFiles.flatMap(f => parseTempl(f));
// TemplDecl → FuncDecl transformation happens here
const normalised = templDecls.map(templDeclToFuncDecl);
// Merged into the package AST before type-checking
packageAst.decls.push(...normalised);
```

## Edge cases

- **CSS class expressions**: `<div class={ cls }>` — emit `gom.Class(cls)` not `gom.Attr("class", cls)` so class assignment uses `el.className` (same as the rest of gom).
- **Boolean attributes**: `<input disabled>` → `gom.Disabled()` shorthand.
- **Self-closing tags**: `<input type="text"/>` → `gom.Input(gom.Type("text"))`.
- **`<style>` tag**: maps to `gom.Style(cssText)`.
- **Nested components**: `@Layout("title") { <p>child</p> }` — the content block becomes
  the `children` argument. Defer this block-children syntax to a follow-up; v0.0.9
  supports `{ children... }` only as a pass-through slot, not block-call syntax.
- **`switch` inside template**: map to a JS conditional chain; each `case` returns a
  `gom.Node`.
- **Whitespace**: collapse inter-element whitespace (same as HTML); preserve
  intra-element text.
- **Comments**: `<!-- HTML comments -->` are stripped. Go `//` comments above `templ`
  declarations are preserved as JS comments.

## Example: full round-trip

```
// todo.templ
package main

templ TodoItem(t Todo) {
    <li class={ todoClass(t) } draggable="true" data-id={ String(t.id) }>
        <input type="checkbox" checked?={ t.done }/>
        <span>{ t.text }</span>
        <button data-action="delete">✕</button>
    </li>
}

templ TodoList(todos []Todo) {
    <ul class="todo-list">
        for _, t := range todos {
            @TodoItem(t)
        }
    </ul>
}
```

Compiles to:

```js
function TodoItem(t) {
    return { Mount(parent) {
        const el = document.createElement("li");
        el.className = todoClass(t);
        el.setAttribute("draggable", "true");
        el.dataset["id"] = String(t.id);
        // input...
        // span...
        // button...
        parent.appendChild(el);
    }};
}

function TodoList(todos) {
    return { Mount(parent) {
        const el = document.createElement("ul");
        el.className = "todo-list";
        todos.forEach(t => TodoItem(t).Mount(el));
        parent.appendChild(el);
    }};
}
```

## What's not in scope for v0.0.9

- `@Layout("title") { ...block children... }` — block-call syntax (deferred)
- `templ.Raw(html)` — raw HTML injection
- `templ.Attributes` — spreading attribute maps
- CSS components (`css` keyword) — deferred
- Script components (`script` keyword) — deferred
- `.templ` file watching in `--watch` mode (add to existing watcher)

## Testing

Add `test/templ.test.js` covering:
- Basic element rendering
- Expression interpolation (string and non-string)
- Static and expression attributes
- Boolean attributes
- `@component` calls
- `if`/`for` control flow
- `{ children... }` pass-through
- Multi-file package with mixed `.go` and `.templ` files
- Error: unknown tag (warn, don't fail)
- Error: unclosed tag
