# Better Pointer Model Implementation Plan (v0.0.5)

Currently `&x` and `*p` are syntactically accepted but semantically transparent —
they compile to no-ops. Only `new(T)` produces actual pointer types with `{ value: T }`
boxing. This means multiple "pointers" to the same variable don't share mutations,
which is the most common use of pointers in Go.

## Key Insight

JavaScript has no pointer/address model, but it does have reference semantics for
objects. By boxing pointed-to values in `{ value: T }` wrapper objects and making `&`
actually allocate a box (or return an existing one), we can emulate shared references.
Struct and slice values are already objects (reference semantics for free), so boxing
is only needed for scalars (`int`, `float64`, `string`, `bool`).

The hard part is tracking which variables are "address-taken" so the compiler can
box them at declaration time, and rewriting all subsequent reads/writes to go through
`.value`.

---

## Current State

| Syntax | Parser | TypeChecker | CodeGen |
|---|---|---|---|
| `*T` type | `PointerType` node | `{ kind: "pointer", base: T }` | Transparent (no effect) |
| `&x` | `UnaryExpr{op: "&"}` | Returns operand type unchanged | `x` (no-op) |
| `*p` | `UnaryExpr{op: "*"}` | Returns operand type unchanged | `p` (no-op) |
| `new(T)` | `CallExpr` | Returns `{ kind: "pointer", base: T }` | `{ value: zeroOf(T) }` |
| `p.Field` | `SelectorExpr` | Routes through pointer base | `p.value.Field` |
| Pointer receiver `(c *C)` | `*` consumed and discarded | Same as value receiver | Same as value receiver |

---

## Scope of Changes

| Component | Change |
|---|---|
| `src/typechecker/expressions.js` | `&x` returns `pointer` type; `*p` returns base type |
| `src/typechecker/statements.js` | Mark address-taken variables; pointer assignability |
| `src/typechecker/types.js` | Add `isPointer()` predicate; update `assertAssignable` for pointer ↔ nil |
| `src/typechecker.js` | Pointer receiver methods get pointer-typed `this` |
| `src/codegen.js` | Track address-taken vars; initialise boxed locals |
| `src/codegen/expressions.js` | `&x` → box reference; `*p` → `.value`; auto-deref selectors |
| `src/codegen/statements.js` | Boxed variable reads/writes go through `.value` |

---

## Phase 1 — TypeChecker: `&` and `*` produce correct types (~2-3h)

**Files:** `src/typechecker/expressions.js`, `src/typechecker/types.js`

Currently `&` and `*` in `UnaryExpr` fall through and return the operand type. Fix this:

### `&` (address-of)

```js
case "&": {
    const ot = this.checkExpr(expr.operand, scope);
    // Mark the operand as address-taken for codegen
    if (expr.operand.kind === "Ident") {
        expr.operand._addressTaken = true;
        const sym = scope.lookup(expr.operand.name);
        if (sym) sym._addressTaken = true;
    }
    return { kind: "pointer", base: ot };
}
```

### `*` (dereference)

```js
case "*": {
    const ot = this.checkExpr(expr.operand, scope);
    if (ot === ANY) return ANY;
    if (ot.kind === "pointer") return ot.base;
    if (ot.kind === "named" && ot.underlying?.kind === "pointer") return ot.underlying.base;
    this.error(expr, `cannot dereference non-pointer type ${typeStr(ot)}`);
    return ANY;
}
```

### `isPointer()` predicate

Add to `src/typechecker/types.js`:

```js
export function isPointer(t) {
    if (!t) return false;
    if (t.kind === "pointer") return true;
    if (t.kind === "named") return t.underlying?.kind === "pointer";
    return false;
}
```

### Update `assertAssignable`

Allow `nil` → any pointer type:

```js
if (target.kind === "pointer" && source === NIL) return;
```

---

## Phase 2 — TypeChecker: pointer receivers (~2h)

**File:** `src/typechecker.js`

Currently pointer and value receivers are identical. When the receiver type is `*T`:

1. In `collectFunc()`, when the receiver has `*`, set `method._pointerReceiver = true`
2. In `checkFuncDecl()`, bind `this` as `{ kind: "pointer", base: structType }` for
   pointer receivers (currently bound as the struct type directly)
3. Allow calling pointer-receiver methods on both `T` and `*T` values (Go auto-takes
   address of an addressable value). Mark this in AST for codegen.

### Auto-addressing at call sites

When calling a pointer-receiver method on a non-pointer value:

```js
// In checkCall() or selector resolution:
if (method._pointerReceiver && receiver.kind !== "pointer") {
    expr._autoAddress = true; // codegen wraps receiver in { value: receiver }
}
```

---

## Phase 3 — TypeChecker: address-taken analysis (~2-3h)

**File:** `src/typechecker/statements.js`, `src/typechecker.js`

After Pass 3 (check bodies), run a lightweight address-taken pass. For every `&x`
where `x` is a local variable, mark it as address-taken. This drives codegen boxing.

### What needs boxing

Only scalar locals that have their address taken need boxing. Structs, slices, and maps
are already reference types in JS and don't need wrapping.

```js
function needsBoxing(variable) {
    if (!variable._addressTaken) return false;
    const t = defaultType(variable.type);
    // Structs, slices, maps, funcs are already reference types in JS
    if (t.kind === "struct" || t.kind === "slice" || t.kind === "map" ||
        t.kind === "func" || t.kind === "interface") return false;
    return true; // int, float64, string, bool need boxing
}
```

### Struct fields and composite literals

Taking the address of a struct field (`&s.X`) is trickier — the struct is already a
reference type, so `&s.X` can be emitted as a getter/setter wrapper object:

```js
// &s.X where X is int → { get value() { return s.X; }, set value(v) { s.X = v; } }
```

This is **Phase 6** (advanced). For Phase 3, emit a type-checker warning for `&s.X`
on non-struct field types and treat it as transparent (current behaviour) as a
known limitation documented in the plan.

---

## Phase 4 — CodeGen: boxed locals (~3-4h, core of the feature)

**Files:** `src/codegen.js`, `src/codegen/expressions.js`, `src/codegen/statements.js`

### Variable declaration

When a local variable is address-taken and needs boxing, emit a wrapped declaration:

```go
x := 42
p := &x
```

```js
// Before (current)
let x = 42;
let p = x;

// After
let x = { value: 42 };
let p = x;          // p and x are the same object
```

### Reading boxed variables

Every read of an address-taken variable appends `.value`:

```go
y := x + 1    // x is address-taken
```

```js
let y = x.value + 1;
```

### Writing boxed variables

Every write to an address-taken variable writes to `.value`:

```go
x = 10
```

```js
x.value = 10;
```

### `&` operator

For address-taken locals, `&x` simply emits `x` (the box object itself):

```js
// &x where x is boxed → x  (x is already { value: ... })
```

For structs (reference types), `&s` emits `s` directly (no boxing needed):

```js
// &myStruct → myStruct  (already a reference)
```

### `*` operator

Dereference emits `.value`:

```js
// *p → p.value
```

### Selector on pointer

Auto-deref selectors on pointer types:

```go
p := &myStruct
p.X = 5       // Go auto-derefs
```

```js
p.X = 5;      // JS: p is already a reference to the struct object
```

For boxed scalars accessed through a pointer:

```go
p := new(int)
*p = 42
fmt.Println(*p)
```

```js
let p = { value: 0 };
p.value = 42;
console.log(p.value);
```

### Implementation in codegen

Track boxed variables in a `Set` on the codegen instance:

```js
// src/codegen.js constructor
this._boxedVars = new Set();
```

Before generating a function body, scan for `_addressTaken` markers and populate
`_boxedVars`. In `genExpr()`:

```js
case "Ident":
    if (this._boxedVars.has(expr.name)) return `${expr.name}.value`;
    return expr.name;
```

In assignment targets, check the same set and route through `.value`.

**Special care**: the `&x` expression itself must NOT append `.value` — it returns
the box. Add an `_isAddressOf` context flag or check the parent node.

---

## Phase 5 — CodeGen: function parameters (~2h)

**File:** `src/codegen/expressions.js`, `src/codegen/statements.js`

When a function accepts `*T`, callers pass box objects and the function body reads
through `.value`. Two cases:

### Passing `&x` to a `*T` parameter

Already handled — `&x` emits `x` (the box) and the function receives the reference.

### Pointer receiver methods

For pointer-receiver methods, `this` refers to the struct object directly (structs
are already reference types). No change needed for structs.

For `_autoAddress` calls (calling pointer-receiver method on a value):

```go
c := Counter{N: 0}
c.Inc()   // Inc has *Counter receiver
```

```js
// Current: c.Inc() — works because structs are reference types
// No boxing needed for struct pointer receivers
```

This is a no-op for structs — JS reference semantics align. Only matters if we ever
have pointer receivers on non-struct types (rare in Go, not needed for v1).

---

## Phase 6 — Advanced: field address and slice element address (future)

**Not in v1 scope.** Documented here for completeness.

Taking the address of a struct field or slice element requires a getter/setter
wrapper:

```go
p := &s.X  // s is a struct, X is an int field
```

```js
let p = {
    get value() { return s.X; },
    set value(v) { s.X = v; }
};
```

This is expensive and rare in frontend code. For v1, `&s.X` where `X` is a scalar
continues to be transparent (current behaviour). `&s` where `s` is a struct works
correctly because structs are reference types.

---

## Phase 7 — Pointer comparison and nil (~1h)

**Files:** `src/typechecker/expressions.js`, `src/codegen/expressions.js`

### Pointer equality

```go
p1 == p2   // same underlying box?
p == nil   // is pointer nil?
```

TypeChecker: allow `==` / `!=` between pointer types of the same base, and between
pointer and `nil`.

CodeGen: `p1 === p2` and `p === null` — works naturally with box objects (reference
equality).

### Nil pointer

`nil` for pointer types is `null`:

```go
var p *int     // p is nil
p == nil       // true
```

```js
let p = null;
p === null;    // true
```

---

## End-to-End Example

### Input

```go
package main

func swap(a *int, b *int) {
    tmp := *a
    *a = *b
    *b = tmp
}

func main() {
    x := 10
    y := 20
    swap(&x, &y)
    fmt.Println(x, y)  // 20 10
}
```

### Type Checker Output

- `x` and `y` marked `_addressTaken = true`, need boxing (scalar `int`)
- `&x` returns `{ kind: "pointer", base: INT }`
- `swap` params are `*int`, function body derefs with `*a` → `INT`

### Generated JavaScript

```js
function swap(a, b) {
    let tmp = a.value;
    a.value = b.value;
    b.value = tmp;
}

function main() {
    let x = { value: 10 };
    let y = { value: 20 };
    swap(x, y);
    console.log(x.value, y.value);  // 20 10
}
```

---

## Test File: `test/language/pointers.test.js`

Register in `test/run.js`. Write tests in phase order.

### Phase 1 — Type checking

```js
test("& produces pointer type")
test("* dereferences pointer type")
test("error: cannot dereference non-pointer type")
test("nil assignable to pointer type")
test("pointer type mismatch: *int vs *string → error")
```

### Phase 2 — Pointer receivers

```js
test("pointer receiver method mutates struct")
test("auto-address: call pointer-receiver method on value")
```

### Phase 3–4 — Boxed locals and shared mutation

```js
test("new(int) produces { value: 0 }")
test("address-taken int is boxed")
test("address-taken string is boxed")
test("shared mutation through pointer to int")
test("shared mutation through pointer to bool")
test("swap via pointers works correctly")
test("struct pointer does not double-box")
test("slice pointer does not double-box")
test("non-address-taken variable is not boxed")
```

### Phase 5 — Function parameters

```js
test("pass pointer to function, mutation visible to caller")
test("return pointer from function, dereference at call site")
test("pointer parameter reassignment does not affect caller")
```

### Phase 7 — Comparison and nil

```js
test("pointer equality: same box returns true")
test("pointer equality: different boxes returns false")
test("pointer to nil comparison")
test("var *int defaults to nil")
```

### End-to-end

```js
test("swap function via pointers")
test("linked list node with pointer to next")
test("closure captures address-taken variable by reference")
```

---

## Risk Summary

| Risk | Mitigation |
|---|---|
| Boxing breaks existing code that uses `&`/`*` transparently | Gate behind `_addressTaken` — only box when `&` is actually used; transparent mode is the default for unmarked variables |
| Performance: every read/write to boxed var adds `.value` | Only box scalars that are address-taken; structs/slices/maps are reference types and skip boxing |
| Closures capturing boxed variables | JS closures capture the box object by reference — correct behaviour for free |
| `&x` in composite literals (`Point{P: &x}`) | Same mechanism — `x` is the box, stored as a reference |
| Nested pointers (`**int`) | `new(*int)` → `{ value: { value: 0 } }`; each deref peels one `.value`. Low priority but works naturally. |
| Address of function parameters | Parameters marked address-taken are boxed at function entry: `let param = { value: param }` |
| `fmt.Println(x)` where `x` is boxed | Need to emit `x.value` — handled by the `Ident` case in `genExpr()` checking `_boxedVars` |

---

## V1 Scope

**In scope:**
- `&x` on local variables produces a pointer type and boxes the variable
- `*p` dereferences a pointer (emits `.value`)
- `new(T)` continues to work as before (already boxes)
- Shared mutation through pointers to scalar locals
- Pointer comparison (`==`, `!=`, `nil`)
- Pointer-receiver methods type-checked with `*T` receiver type
- Error messages for invalid dereference and type mismatches

**Out of scope (future):**
- Address of struct fields (`&s.X`) — requires getter/setter wrapper (Phase 6)
- Address of slice/map elements (`&s[i]`) — same issue
- Pointer arithmetic (not applicable to JS)
- Nested pointers beyond two levels (works but untested)
- `unsafe.Pointer` (permanently out of scope)
