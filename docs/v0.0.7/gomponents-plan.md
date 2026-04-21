# gomponents-style DOM components — Design Plan

## Goal

Enable gomponents-style declarative DOM composition in GoFront. The original
[gomponents](https://github.com/maragudk/gomponents) library renders to `io.Writer`
(HTML strings) for server-side use. GoFront targets the browser, so the Node interface
is redefined to target the DOM directly instead of an `io.Writer`. The programming model
— composable functions returning Nodes, variadic children, attribute vs element
discrimination — is preserved exactly.

## Why this matters

gomponents is the cleanest Go component model in existence: no templates, no codegen,
no magic. Just functions that return values. That maps perfectly to GoFront's "compile
to readable JS" philosophy.

---

## Approach

### Node interface (browser-native)

Instead of `Render(io.Writer) error`, GoFront's Node targets the DOM:

```go
type Node interface {
    Mount(parent any) // appends self to a DOM node
}
```

`El("div", Class("card"), Text("hello"))` creates a real `document.createElement("div")`
and returns a Node that, when mounted, appends the element to its parent.

This means no innerHTML, no string escaping, no XSS risk — the browser's own DOM API
handles all of that. It also means the output is immediately live and event-ready.

### Component library as pure GoFront code

The component library (`gofront/gom` or similar) is written in GoFront itself, not as a
compiler built-in. Once the two compiler gaps below are closed it needs zero new compiler
work. It ships as a standard example/template users can copy or import.

---

## Compiler gaps to close

### 1. Methods on named non-struct types (required)

gomponents defines two non-struct named types with methods:

```go
type NodeFunc func(parent any)
func (n NodeFunc) Mount(parent any) { n(parent) }

type Group []Node
func (g Group) Mount(parent any) {
    for _, n := range g {
        if n != nil { n.Mount(parent) }
    }
}
```

GoFront currently only supports methods on struct types (emitted as ES6 class methods).
Named function types and named slice types with methods need new codegen support.

**Codegen strategy:**

Named non-struct types with methods → ES6 class wrapping the underlying value:

```js
// type NodeFunc func(parent any)
class NodeFunc {
  constructor(_fn) { this._fn = _fn; }
  Mount(parent) { this._fn(parent); }
}

// type Group []Node
class Group {
  constructor(_items) { this._items = _items; }
  Mount(parent) {
    for (const n of __s(this._items)) { if (n !== null) n.Mount(parent); }
  }
}
```

Composite literals need updating too:
- `Group{nodeA, nodeB}` → `new Group([nodeA, nodeB])`
- `NodeFunc(myFunc)` → `new NodeFunc(myFunc)`

**Stages affected:** TypeChecker (method resolution on non-struct named types), CodeGen
(class emission for non-struct named types, composite literal for named slice/func types).

### 2. `io` package minimal shim (optional, for compatibility)

Not required for the DOM-native approach. If added, it enables GoFront code that also
compiles server-side with standard Go. `io.Writer` maps to an object with a
`Write([]byte)(int, error)` method. `io.WriteString` maps to calling `.Write()`.

Low priority for v0.0.6; can be deferred to v0.0.7.

---

## The component library

Once method-on-non-struct-types works, the full gomponents API can be written in pure
GoFront. Key pieces:

```go
package gom

type Node interface {
    Mount(parent any)
}

type NodeFunc func(parent any)
func (n NodeFunc) Mount(parent any) { n(parent) }
func (n NodeFunc) String() string { /* render to string for debugging */ return "" }

type Group []Node
func (g Group) Mount(parent any) {
    for _, n := range g {
        if n != nil { n.Mount(parent) }
    }
}

// El creates an element node.
func El(tag string, children ...Node) Node {
    return NodeFunc(func(parent any) {
        el := document.createElement(tag)
        for _, c := range children {
            if c == nil { continue }
            switch c.(type) {
            case attrNode:
                c.(attrNode).Apply(el)
            default:
                c.Mount(el)
            }
        }
        parent.(any).appendChild(el)
    })
}

// Text creates a safe text node.
func Text(s string) Node {
    return NodeFunc(func(parent any) {
        parent.(any).appendChild(document.createTextNode(s))
    })
}

// Attr creates an attribute node.
func Attr(name string, value string) Node { ... }

// If returns n when condition is true, nil otherwise.
func If(condition bool, n Node) Node {
    if condition { return n }
    return nil
}

// Map transforms a slice into a Group of Nodes.
func Map[T any](items []T, f func(T) Node) Group {
    out := Group{}
    for _, item := range items {
        out = append(out, f(item))
    }
    return out
}

// Mount mounts a node tree into a DOM element, replacing its children.
func Mount(selector string, n Node) {
    el := document.querySelector(selector)
    el.innerHTML = ""
    n.Mount(el)
}
```

Element helpers in a `gom/html` sub-package follow naturally:

```go
func Div(children ...Node) Node  { return gom.El("div", children...) }
func A(children ...Node) Node    { return gom.El("a", children...) }
func Class(v string) Node        { return gom.Attr("class", v) }
func ID(v string) Node           { return gom.Attr("id", v) }
func Href(v string) Node         { return gom.Attr("href", v) }
// ... etc
```

A full component then looks identical to server-side gomponents except it builds real
DOM nodes:

```go
func TodoItem(t Todo) gom.Node {
    return html.Li(
        html.Class("todo-item"),
        html.Input(html.Type("checkbox")),
        html.Span(gom.Text(t.text)),
    )
}

func main() {
    gom.Mount("#app", html.Ul(
        gom.Map(todos, TodoItem),
    ))
}
```

---

## What does NOT transfer from gomponents

| Original | Reason | GoFront alternative |
|---|---|---|
| `Render(io.Writer) error` | No io.Writer in browser | `Mount(parent any)` |
| `html/template.HTMLEscapeString` | Not needed — DOM text nodes auto-escape | `document.createTextNode` |
| `strings.Builder` in `.String()` | Needed for string representation | `strings.Builder` (v0.0.6) |
| `http` integration | Out of scope (no net/http) | GoFront is frontend-only |

---

## What transfers perfectly

- The `Node` interface as the universal abstraction
- `NodeFunc` (function type that satisfies an interface)
- `Group` (slice type that satisfies an interface)
- `El(tag, ...children)` with attribute/element discrimination
- `If`, `Map`, `Text`, `Raw`, `Attr`
- Composing components as plain Go functions
- Generics in `Map[T any]`

---

## Rollout plan

### v0.0.6 (compiler work)
1. Methods on named non-struct types — TypeChecker + CodeGen changes
2. `html.EscapeString` / `html.UnescapeString` (already planned)
3. `strings.Builder` (already planned, useful for `.String()` debug method)

### v0.0.6 (library)
4. `example/gom/` — bundles the `gom` library (`gom/gom.go`) and a todo app (`src/main.go`) in one folder

### v0.0.7 (optional)
6. `io` package shim — enables writing code that compiles both server-side (standard Go)
   and browser-side (GoFront) without changes
7. Class-level reactivity integration (signals + gom = fine-grained updates)

---

## Difficulty summary

| Item | Difficulty | Blocks what |
|---|---|---|
| Methods on named non-struct types | Medium | Everything — core blocker |
| `gom` library in pure GoFront | Low (once above lands) | Example app |
| `html` element helpers | Low | Ergonomics |
| `io` shim | Low | Standard Go compatibility |
