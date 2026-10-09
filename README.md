# GoFront
[![npm version](https://img.shields.io/npm/v/gofront.svg)](https://www.npmjs.com/package/gofront) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)


> Go syntax and type safety, compiling to a seamless hybrid of JavaScript (ES modules) and WebAssembly (WasmGC).

## About

Go for the backend: simple, type-safe, no nonsense. JavaScript for the frontend: runs
everywhere, no setup. The problem is JavaScript's loose typing — and TypeScript never
quite felt like home either.

So I built GoFront. Go syntax and type safety, compiling to a **seamless hybrid of
JavaScript (ES modules) and WebAssembly (WasmGC)**. One language across the entire
stack, no runtime, no framework, no tsconfig.json.

### Why Hybrid?

Traditional web architectures force a painful choice:
- **Pure JavaScript:** Excellent DOM ergonomics and dynamic UI, but plagued by IEEE-754 float quirks, JIT deoptimizations, and garbage-collection micro-stutters during heavy compute.
- **Pure WebAssembly:** Predictable, high-performance execution for tight loops and math, but manipulating the DOM across host calls is notoriously slow, awkward, and requires heavy glue-code runtimes.

**GoFront gives you the best of both worlds in a single codebase:**
- **UI and DOM stay in JavaScript:** `.templ`, `gom`, event listeners, and browser APIs compile to native ES modules with zero-cost DOM access.
- **Compute runs in WebAssembly:** Simulation, physics, collision detection, and tight math loops compile to WasmGC with true integers, real `float32`, and near-zero memory churn.
- **The compiler owns the boundary:** It sees both sides and generates all the glue automatically. You write standard Go imports (`import "./physics"`) and the compiler handles the rest.

Probably not useful. Definitely fun to build.

```go
// physics/sim.go — compiled to WebAssembly (WasmGC)
//gofront:target wasm
package physics

type Body struct {
    X, Y, VX, VY float32
}

func Step(b *Body, dt float32) {
    b.X += b.VX * dt
    b.Y += b.VY * dt
}
```

```go
// main.go — compiled to clean JavaScript (ES module)
//gofront:target js
package main

import (
    "./physics"
    "gom"
)

var body = physics.Body{X: 0, Y: 0, VX: 10, VY: 5}

func onTick() {
    physics.Step(&body, 0.016) // calls directly into WasmGC with zero manual glue code
    render()
}
```

With built-in support for declarative DOM rendering via the [`gom`](https://www.gomponents.com) standard library, JSX-like [`.templ`](https://templ.guide/) files, and seamless integration with external JavaScript libraries through TypeScript definition files (`.d.ts`), GoFront is designed specifically as a frontend development target. Build complex, reactive user interfaces entirely in Go.

```go
package main

type Todo struct {
    id   int
    text string
    done bool
}

var todos []Todo

func addTodo(text string) {
    todos = append(todos, Todo{id: len(todos), text: text, done: false})
    render()
}

func main() {
    btn := document.getElementById("add-btn")
    btn.addEventListener("click", func() {
        addTodo(document.getElementById("input").value)
    })
}
```

Compiles to clean, readable JavaScript and WebAssembly — no runtime, no framework.

GoFront source files use the `.go` extension so editors automatically apply Go syntax
highlighting, bracket matching, and indentation rules without any extra configuration.

---

## Install & Quick Start

```sh
npm install -g gofront
mkdir my-app && cd my-app
gofront init
gofront dev
```

Then open `http://localhost:3000` — the page live-reloads on every save.

Requires Node.js 20+ (WasmGC requires Node ≥ 22 or a modern browser).

---

## Examples

There are five example apps. Four implement the same todo app to show different aspects
of GoFront; the fifth is a WebGL2 3D showcase demonstrating typed graphics APIs and
zero-allocation rendering.

### Simple (vanilla DOM)

The default example. Zero dependencies, clean 1:1 compiled JS output. Showcases GoFront's
core language features with straightforward DOM manipulation.

```
example/simple/
  src/
    types.go      ← Todo struct · FilterAll/Active/Completed iota · Priority iota
    store.go      ← state as plain variables · add/toggle/remove/clear · visibleTodos()
                     · stats() with named returns · defer/recover · async persistence
    render.go     ← render() updates DOM via innerHTML · renderTodo() · renderFilterBar()
    styles.go     ← injectStyles() creates <style> element with all CSS
    main.go       ← createApp() builds DOM shell · setupEvents() · event delegation
    utils/
      utils.go    ← Plural() · generic Filter — cross-package import demo
    browser.d.ts  ← minimal external type declarations (sleep)
  index.html      ← bare HTML shell, loads app.js as ES module
  app.js          ← generated output
```

### Reactive (signals + d.ts imports)

Same app rebuilt with [reactive.js](https://github.com/seriva/microtastic), a tiny
signals-based reactive framework. Demonstrates how GoFront integrates with external JS
libraries via `.d.ts` type declarations — the entire reactive API surface is typed via a
hand-written `browser.d.ts` shim and exercised from GoFront source.

> **Note:** Microtastic is now archived. This example is kept as a reference for
> `.d.ts` interop with third-party signal libraries. For new projects, use the native
> `.templ` or `gom` approaches shown below.

```
example/reactive/
  src/
    types.go      ← Todo, Stats, AppElements structs
    store.go      ← reactive state: Signals.create/computed/computedAsync/batch/update
    render.go     ← Reactive.Component lifecycle · ctx.bind* · setupStatsBar
    styles.go     ← per-section cssClass() scoped styles
    main.go       ← async boot, Reactive.mount loading placeholder, signal.subscribe/once
    utils/
      utils.go    ← Plural() · generic Filter
    browser.d.ts  ← Signal · ComponentContext · Signals/Reactive namespaces · htmlTag
  reactive.js     ← signals framework (from microtastic)
  index.html      ← loads reactive.js, exposes helpers, imports app.js
  app.js          ← generated output
```

The reactive example covers the full reactive.js API surface:

| Category | Features used |
|---|---|
| HTML helpers | `html` tagged template (via `htmlTag`), `trusted`, `join` |
| CSS | `cssClass` scoped styles with nested `&` selectors |
| Signals | `create`, `computed`, `computedAsync`, `batch`, `get`, `peek`, `set`, `update`, `subscribe`, `once` |
| Reactive namespace | `mount` (loading placeholder), `createComponent`, `scan` |
| Component context | `bind`, `bindAttr`, `bindBoolAttr`, `bindClass`, `bindText`, `bindStyle`, `bindMultiple`, `computed` |
| Component lifecycle | `state`, `template`, `styles`, `mount`, `mountTo`, `appendTo`, `refs` (via `data-ref`) |
| Component instance | `signal`, `effect`, `on` (auto-cleanup event listeners) |
| Scan attributes | `data-model`, `data-text`, `data-html`, `data-if`, `data-visible`, `data-class-*`, `data-attr-*`, `data-bool-*`, `data-on-*`, `data-ref` |

### templ (template files + direct DOM codegen)

Same todo app using GoFront's `.templ` file format — a JSX-like syntax embedded directly
in `.go` packages. `templ` declarations compile to direct `document.createElement` calls
with no intermediate representation, producing `{Mount(p){}}` objects that are fully
compatible with the `gom.Node` interface.

```
example/templ/
  src/
    render.templ  ← UI as templ declarations: TodoItem, TodoList, Header, InputRow, StatsBar, AppView, …
    render.go     ← helper functions (todoItemClass, filterLabel, …) + render() entry point
    types.go      ← Todo struct, filter/priority constants
    store.go      ← state, mutations, localStorage persistence
    styles.go     ← appStyles() CSS string
    main.go       ← event setup, entry point
    utils/        ← Filter[T], Plural, HasText
  app.js          ← generated output
  index.html      ← HTML shell
```

`.templ` syntax at a glance:

```go
css cardStyle() {
    background: #ffffff;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

templ TodoItem(t Todo) {
    <li class={ todoItemClass(t) } draggable="true" data-id={ t.id }>
        <input type="checkbox" checked?={ t.done }/>
        <span class="todo-text">{ t.text }</span>
        if t.isUrgent() {
            <span class="badge">urgent</span>
        }
    </li>
}

templ AppView() {
    <div class={ cardStyle() }>
        @Header(highCount(), syncMsg, syncCls)
        @TodoList(visibleTodos())
    </div>
}
```

Key syntax features:
- `css Name() { ... }` — scoped CSS declarations (templ.guide spec); compiles to a deterministic scoped class name (`gfc_<name>_<hash>`) and injects styles automatically into `<head>`
- `{ expr }` — interpolate any Go expression (strings auto-cast, others use `String()`)
- `attr={ expr }` — dynamic attribute value (expression)
- `attr?={ expr }` — boolean attribute (present/absent based on truthiness)
- `@Component(args)` — call another templ component and mount it as a child
- `if cond { } else if cond { } else { }` — conditional rendering (arbitrary depth)
- `for _, v := range slice { }` — loop rendering inside template bodies
- `switch expr { case v: ... default: ... }` — switch rendering inside template bodies
- `@templ.Raw(htmlStr)` — inject raw/trusted HTML (uses `insertAdjacentHTML`)
- `ref="name"` — capture the element at mount time into an optional `refs map[string]any`
  passed as `gom.Mount("#app", AppView(), refs)`; no `querySelector` needed afterwards
- Components are called like regular functions (`AppView()`, `TodoItem(t)`) and return
  a `gom.Node`-compatible object, so `gom.Mount("#app", AppView())` works directly.

### gom (stdlib component library + todo app)

Browser-native declarative DOM components inspired by
[gomponents](https://www.gomponents.com). `gom` is a **built-in stdlib package** — no
import path needed, available in every GoFront program just like `fmt` or `strings`. It
uses **methods on named non-struct types** so that plain functions and slices can satisfy
the `Node` interface without any struct boilerplate.

```
example/gom/
  src/
    types.go  ← Todo struct, filter/priority constants
    store.go  ← state, mutations, localStorage persistence
    render.go ← gom node builders (pure node tree, no innerHTML)
    styles.go ← appStyles() CSS string
    main.go   ← event setup, submitInput, entry point
    utils/    ← Filter[T], Plural, HasText
  app.js      ← generated output
  index.html  ← HTML shell
```

Key types and functions (all accessed as `gom.*`, no import needed):
- `gom.Node` — interface with a single `Mount(parent any)` method
- `gom.NodeFunc` — `type NodeFunc func(parent any)` with `Mount` method; any function becomes a `Node`
- `gom.Group` — `type Group []Node` with `Mount` method; composes children in order
- `gom.El(tag, children...)` — creates an element node
- `gom.Text(s)` — creates a text node
- `gom.Attr(name, val)` — generic attribute node; named shortcuts: `gom.Class`, `gom.Href`, `gom.Type`, etc.
- `gom.If(cond, node)` — conditionally renders a node
- `gom.Map(slice, fn)` — maps a slice to a `Group` of nodes
- `gom.Style(css)` — returns a `Node` that injects a `<style>` element; styles are part of the node tree
- `gom.Mount(selector, n)` — mounts a node into the DOM, replacing the element's content
- `gom.MountTo(selector, n)` — appends a node without clearing; used to inject styles into `<head>`
- HTML element helpers: `gom.Div`, `gom.Span`, `gom.Button`, `gom.Input`, `gom.Ul`, `gom.Li`, … (full HTML element set)

### Features demonstrated

The simple and reactive examples cover: structs & methods, iota constants, named return
values, closures, slices, `for range`, `switch`, cross-package imports, multi-file
same-package compilation, `async`/`await`, `defer`/`recover`, localStorage persistence,
DOM APIs, and generic utility functions (`Filter[T]`, `Map[T, U]`).

The reactive example additionally demonstrates: external `.d.ts` type imports,
`declare namespace` patterns for typing JS libraries, the full reactive signal graph
(source signals → computed signals → async computed → DOM bindings), reactive UI with
no `querySelector` or `getElementById` in application code, and `Reactive.Component`
as the primary composition unit (state, template, styles, mount lifecycle, `data-ref`
element refs, auto-cleanup event listeners).

The gom example additionally demonstrates: **the `gom` built-in stdlib package**,
styles as nodes (`gom.Style` + `gom.MountTo`), `gom.Map` for list rendering, the
declarative node-tree pattern (no `innerHTML`, no `querySelector`), and full feature
parity with the other examples (priority mode, validation, localStorage persistence,
sync status, drag-and-drop reordering).

The templ example additionally demonstrates: **`.templ` file compilation**, template
components with parameters, scoped `css` declarations (`css Name() { ... }`), `{ expr }` interpolation,
`attr?={}` conditional boolean attributes, `@Component()` calls inside templates, `if / else if / else` chains,
`switch` blocks, `for range` loops, and `@templ.Raw()` for trusted HTML injection —
all inside template bodies.

### WebGL2 (3D showcase)

A 3D rotating colored cube rendered with WebGL2 shaders. Demonstrates GoFront's static
WebGL2 typings, `Float32Array` / `Uint16Array` slice mapping, zero-allocation `for range`
loops, and continuous `requestAnimationFrame` rendering — all with zero per-frame heap
allocations.

```
example/webgl/
  src/
    main.go       ← shaders, mat4 math, vertex/index buffers, render loop
  app.js          ← generated output
  index.html      ← canvas element
```

### Build and run

```sh
npm run build             # compile all example applications
# open the respective index.html in a browser
```

---

## The Hybrid Architecture: JS + WasmGC

GoFront apps can run **partly as JavaScript and partly as WebAssembly (WasmGC)**, chosen per package:

```
                     GoFront Source Code
     ┌───────────────────────┬───────────────────────┐
     │  //gofront:target js  │ //gofront:target wasm │
     │  UI, DOM, WebGL, Game │ Collision, Raycasting │
     └───────────┬───────────┴───────────┬───────────┘
                 │                       │
                 │   GoFront Compiler    │
                 ▼                       ▼
           ┌───────────┐           ┌───────────┐
           │  app.js   │ ◄───────► │ app.wasm  │
           └─────┬─────┘  Boundary └─────┬─────┘
                 │         Facade        │
                 ▼                       ▼
            DOM & Browser          Tight Loops & Math
          Dynamic & Ergonomic      Predictable & Fast
```

### Package Targets

Each package declares its target at the top of any of its source files (before the `package` clause):

```go
//gofront:target wasm     // compiled to WebAssembly only
//gofront:target both     // compiled to both JS and WASM; each side uses its own copy
package physics           // no directive = js (default)
```

| Target | Compiled to | May import | Best for |
|---|---|---|---|
| `js` (default) | JavaScript ES module | anything | DOM manipulation, UI components (`gom`, `.templ`), browser APIs, `async`/`await` |
| `wasm` | WebAssembly GC module | `wasm`, `both`, stdlib (WASM subset) | Physics, spatial indexing, raycasting, simulation, tight numeric loops |
| `both` | JS *and* WASM | `both`, stdlib (WASM subset) | Shared math/utility libraries (e.g. `mathx`, `vec3`). Strict Go numeric semantics; no package-level mutable state |

- **Zero Boundary Overhead for Shared Types:** `both` packages never create a boundary overhead — JS callers use the JS copy and WASM callers use the WASM copy.
- **Strict Go Numeric Semantics:** Code compiled to `wasm` (and JS emitted for `both` packages) follows strict Go numeric rules: sized-integer wrapping, true `float32` rounding, and integer divide-by-zero panics.

### Seamless Compile-Time Boundary

Every `wasm` and `both` package an application imports is automatically linked into a single `app.wasm` module, emitted right alongside `app.js` by `gofront build`, `gofront dev`, and `-o`.

The compiler analyzes both sides of the boundary and synthesizes a facade into `app.js`:
- **Functions & Methods:** WASM functions, methods, and literal constants can be invoked directly from JS code as if they were native JS functions.
- **Primitives & Strings:** Numbers, booleans, strings, and `any` pass through or convert directly across the boundary.
- **Structs & Memory:**
  - `both` struct values cross by copy into their matching JS classes (with write-back for `*T` parameters).
  - `wasm` structs become opaque handle classes with stable identity. Reading aggregate fields through handles (`b.Pos.X`, `b.Tags[0]`) provides live views into WASM memory.
- **Slices & Arrays:** Slices and arrays copy element-wise in both directions; TypedArrays (`Float32Array`, `Int32Array`, etc.) are natively accepted.
- **Closures:** Function values and callbacks cross the boundary transparently in both directions.
- **WASM Loader:** The generated JS bundle automatically fetches `app.wasm` relative to the page (customizable via `globalThis.__GOFRONT_WASM_URL` or `globalThis.__GOFRONT_WASM_BYTES`).
- **WAT Inspection:** Passing `--emit-wat` writes human-readable `app.wat` alongside the binary module.
- **Binaryen Optimization:** Passing `--release` or `--wasm-opt` optimizes `app.wasm` via Binaryen (`-O3` + GUFA), achieving ~23% smaller binaries and generating `app.wasm.map` source maps.

### Real-World Benchmark: 3D Raycasting

Splitting an app into high-level JavaScript orchestration and low-level WebAssembly compute delivers the best of both worlds. On a real-world Möller–Trumbore raycast benchmark (131,072 triangles, 100,000 rays; run via `npm run bench`):

| Target | Throughput | Allocation | Engine Stability |
| :--- | :--- | :--- | :--- |
| **Pure JS** | `26,720 rays/s` ▰▰▰▰▰▰▰▰▱▱ | `6.20 B / ray` | Subject to periodic V8 young-gen GC pauses |
| **Hybrid WASM** | `31,293 rays/s` ▰▰▰▰▰▰▰▰▰▰ | `0.86 B / ray` | **Near-zero alloc (7.2× less)**, smooth 60 FPS |

- **+17.1% higher throughput:** Direct WasmGC typed arrays, local-cached scratch globals, and hardware-trapped nil dereferences outperform JIT-compiled JS.
- **86% memory churn reduction:** Dropping allocations from 6.2 B/ray to 0.86 B/ray prevents garbage collection pauses from causing micro-stutter in 60 FPS loops.
- **Minimal boundary overhead:** The boundary trampoline consumes only ~0.5% of total runtime, ensuring batch computations cross between JS and WASM with virtually zero penalty.

For the full rules — `both`-package restrictions, strict numeric mode, which types can cross the boundary, loader overrides, and how `gofront test` runs hybrid packages — see the **[Hybrid JS + WebAssembly Guide](docs/hybrid-wasm.md)**.

---

## Usage & Tooling

GoFront includes a fully-featured CLI for building, dev-serving (with live reload), and type-checking your projects.

For detailed command flags, project configuration (`gofront.json`), multi-file package resolution, and type-checking rules, see the **[Usage & Tooling Guide](docs/usage.md)**.

---

## Documentation

* [Usage & Tooling Guide](docs/usage.md) — CLI, project config, testing, multi-file packages
* [Hybrid JS + WebAssembly Guide](docs/hybrid-wasm.md) — package targets, `both` rules, boundary types, loader
* [Language Features & Stdlib](docs/language-support.md) — what is implemented, stdlib shims
* [Go to JS Mapping](docs/compilation-mapping.md) — what each construct compiles to
* [Go Compatibility Differences](docs/go-compatibility.md) — where GoFront deliberately differs from Go
* [Compiler Architecture & Internals](docs/architecture.md) — pipeline stages and source layout

---

## Roadmap

See [`docs/roadmap.md`](docs/roadmap.md) for the full roadmap and release history.
Design documents for planned features are organised by release under `docs/v*/`
(e.g. [`docs/v0.0.8/`](docs/v0.0.8/), [`docs/v1.2.0/`](docs/v1.2.0/), [`docs/v1.3.0/`](docs/v1.3.0/)).

---

## Tests

```sh
npm test                  # unit, zero-alloc perf, and example tests (~1600+ tests, no browser required)
npm run test:e2e          # E2E browser tests (Playwright, headless Chromium)
npm run bench             # Möller–Trumbore raycast benchmark comparing pure JS vs hybrid WASM
```

**Unit tests** (~1,600+) cover language features, type errors, edge cases, DOM (jsdom),
external `.d.ts`, npm resolver, multi-file compilation, embedded structs, string
formatting, map iteration order, integer overflow semantics, unused variable detection,
unused import detection, semantic difference verification, stdlib shim packages, generics,
the `testing` framework itself, and `.templ` file compilation (element rendering,
interpolation, boolean attrs, component calls, scoped `css` declarations with class hashing,
`if/else/else-if` chains, `for range`, `switch/case/default`, `@templ.Raw()` raw HTML injection,
SVG namespace handling, mixed `.go`+`.templ` packages).

**E2E tests** (~105, Playwright) run all five example apps in a real browser and verify
CRUD, filtering, priority mode, persistence (reload), drag-and-drop reordering, and sync
status. Per-app suites check app-specific behaviour: scoped styles, stats bar, loading
placeholder, `gom.If` conditional rendering, templ-specific features (scoped `css` injection,
`if/else` priority hint, `for` loop rendering, conditional bool attributes), and the WebGL2 cube
rendering.
