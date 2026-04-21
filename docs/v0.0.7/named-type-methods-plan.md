# Methods on Named Non-Struct Types — Design Plan

## Goal

Allow methods to be declared on any named type, not just structs. This is the core
compiler blocker for v0.0.7's `gom` component library, which requires:

```go
type NodeFunc func(parent any)
func (n NodeFunc) Mount(parent any) { n(parent) }

type Group []Node
func (g Group) Mount(parent any) {
    for _, n := range g { n.Mount(parent) }
}
```

Both types must be able to satisfy the `Node` interface via their `Mount` method.

## Approach

### Type checker

Methods are currently only attached to struct underlying types. The fix is to store
methods on the `named` type object itself for all non-struct named types:

```
Before: named → underlying (struct) → methods Map
After:  named → methods Map  (for non-struct)
        named → underlying (struct) → methods Map  (unchanged for structs)
```

Changes in `src/typechecker.js`:
- `collectType`: initialize `named.methods = new Map()` for all non-alias, non-struct named types.
- `collectFunc`: when receiver's underlying type is not a struct, attach the method to
  `recvNamedType.methods` instead of `underlying.methods`.
- `fieldType`: check `type.methods` on the named type itself before falling through to
  the struct underlying check.

Changes in `src/typechecker/expressions.js`:
- `SelectorExpr`: widen the `_isMethodValue` check from `struct`-only to any type with
  a `methods` map (i.e. `base?.methods?.has(field)`).

### Code generator

Named non-struct types with methods are emitted as ES6 wrapper classes:

| Go type form | JS class shape |
|---|---|
| `type T func(...)` | `class T { constructor(_fn) { this._fn = _fn; } }` |
| `type T []E` | `class T { constructor(_items) { this._items = _items; } }` |
| `type T map[K]V` | `class T { constructor(_map) { this._map = _map; } }` |

#### Method bodies — automatic receiver unwrapping

At the top of every method on a non-struct named type, the receiver variable is bound
to the unwrapped underlying value:

```js
// Go: func (g Group) Mount(parent any) { for _, n := range g { ... } }
Mount(parent) {
    const g = this._items;   // ← automatic unwrap
    for (const [_, n] of __s(g).entries()) { ... }
}
```

This means all existing codegen for slices, functions, maps just works inside method
bodies — no special cases needed there.

#### Composite literals and type conversions

| Go expression | JS output |
|---|---|
| `Group{a, b}` | `new Group([a, b])` |
| `Group{}` | `new Group([])` |
| `NodeFunc(fn)` | `new NodeFunc(fn)` |
| `T(val)` where `T` has underlying slice | `new T(val)` |

#### Operations on named slice type variables (outside methods)

When a named slice type variable is used in slice operations, it must be unwrapped:

| Go | JS |
|---|---|
| `append(g, x)` | `new Group(__append(g._items, x))` |
| `len(g)` | `g._items.length` (via `__len` or inline) |
| `for _, n := range g` | iterates `g._items` |
| `g[i]` | `g._items[i]` |

The type of the expression (available from `expr._type`) is used to detect when
unwrapping is needed.

## Edge cases

- **Type alias vs type definition**: only type definitions get the wrapper class.
  `type T = []Node` remains a plain alias with no methods.
- **Interface satisfaction**: the type checker's `implements` check must look up
  methods on the named type's own `methods` map, not just the underlying.
- **Pointer receivers** (`*T`): GoFront's pointer model is transparent, so pointer
  receiver methods on non-struct types are treated the same as value receivers.
- **Method expressions** (`T.Method`): widen the existing struct-only check to cover
  any named type with a methods map.
- **Append return type**: `append(g, x)` where `g` is `Group` must return `Group`
  (re-wrap), not `[]Node`.

## JS output example

```go
type Group []Node
func (g Group) Mount(parent any) {
    for _, n := range g {
        if n != nil { n.Mount(parent) }
    }
}
```

Compiles to:

```js
class Group {
  constructor(_items) { this._items = _items; }
  Mount(parent) {
    const g = this._items;
    for (const n of __s(g)) { if (n !== null) n.Mount(parent); }
  }
}
```

## Affected files

| File | Change |
|---|---|
| `src/typechecker.js` | `collectType`, `collectFunc`, `fieldType` |
| `src/typechecker/expressions.js` | `SelectorExpr` method-value detection |
| `src/codegen.js` | `genTypeDeclWithMethods`, new `genNamedTypeClass` |
| `src/codegen/statements.js` | `genMethod` receiver unwrapping |
| `src/codegen/expressions.js` | `CompositeLit`, type conversions, `append`, `len`, `IndexExpr`, `SliceExpr`, `RangeStmt` for named slice types |
| `test/language/declarations.test.js` | New section for named-type methods |
