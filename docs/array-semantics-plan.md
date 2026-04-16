# Better Array Semantics Implementation Plan (v0.0.4)

Arrays (`[N]T`) and slices (`[]T`) are currently indistinguishable at runtime — both
compile to plain JavaScript arrays. The compiler already tracks them as separate type
kinds (`"array"` with a `size` field vs `"slice"`), but this information is not used
for enforcement. Go treats arrays as fixed-size value types and slices as variable-length
reference types — GoFront conflates the two.

## Key Insight

Full Go array semantics (value-type copy on assignment, fixed capacity) would require
runtime wrappers that defeat the "no runtime" goal. Instead, we can get most of the
benefit through **compile-time enforcement only**: reject `append()` on arrays, check
bounds on constant indices, enforce length matching in assignments, and infer `[...]T`
sizes at compile time. The runtime representation stays as plain JS arrays — the type
checker does the heavy lifting.

No new runtime helpers are needed.

---

## Current State

| Aspect | Array `[N]T` | Slice `[]T` | Gap |
|---|---|---|---|
| AST node | `ArrayType{size, elem}` | `SliceType{elem}` | ✓ Distinct |
| Type kind | `{ kind: "array", size: N, elem }` | `{ kind: "slice", elem }` | ✓ Distinct |
| `[...]T` inference | `{ kind: "array", size: null }` | — | Size not computed |
| JS output | `[elem, ...]` | `[elem, ...]` | Identical |
| `len()` | `.length` | `.length` | No compile-time constant for arrays |
| `cap()` | `.length` | `.length` | Always equals `len()` |
| `append()` | Allowed | Allowed | Should be rejected on arrays |
| `copy()` | Allowed | Allowed | OK (Go allows this) |
| Bounds checking | None | None | Constant index > size not caught |
| Assignment | No length check | Reference | Arrays should check size match |
| Composite literal | Element count unchecked | Any count | Should match declared size |

---

## Scope of Changes

| Component | Change |
|---|---|
| `src/typechecker/expressions.js` | Reject `append()` on arrays; compile-time `len()` for arrays; bounds check on constant index; `[...]T` size inference |
| `src/typechecker/statements.js` | Array assignment length compatibility |
| `src/typechecker/types.js` | `isArray()` predicate; update `assertAssignable` for array size matching; update `typeStr` for inferred sizes |
| `src/typechecker.js` | Resolve `[...]T` size from composite literal element count |
| `src/codegen/expressions.js` | Compile-time `len()` optimisation for fixed arrays |

---

## Phase 1 — Infer `[...]T` size at compile time (~1-2h)

**Files:** `src/typechecker.js`, `src/typechecker/expressions.js`

Currently `[...]T{a, b, c}` produces `{ kind: "array", size: null }`. The size should
be set to the number of elements in the composite literal.

### In `checkCompositeLit`

When the type is an `ArrayType` with `inferLen: true`, count the elements and set the
size on the resolved type:

```js
if (typeNode.kind === "ArrayType" && typeNode.inferLen) {
    const elemCount = expr.elems.length;
    // Account for keyed elements — max key + 1 determines size
    let maxIndex = elemCount - 1;
    for (const e of expr.elems) {
        if (e.kind === "KeyValueExpr" && e.key?.value !== undefined) {
            maxIndex = Math.max(maxIndex, Number(e.key.value));
        }
    }
    resolvedType.size = maxIndex + 1;
}
```

### Update `typeStr`

Fix the display for inferred arrays so error messages don't show `[null]int`:

```js
case "array":
    return `[${t.size ?? "..."}]${typeStr(t.elem)}`;
```

---

## Phase 2 — Reject `append()` on arrays (~1h)

**File:** `src/typechecker/expressions.js`

In the `append` builtin handler, check if the first argument is an array type:

```js
case "append": {
    const sliceType = this.checkExpr(expr.args[0], scope);
    if (sliceType.kind === "array" ||
        (sliceType.kind === "named" && sliceType.underlying?.kind === "array")) {
        this.error(expr, `cannot append to array (type ${typeStr(sliceType)})`);
        return sliceType;
    }
    // ... existing slice handling ...
}
```

Go rejects `append()` on fixed arrays — this is the most common mistake when confusing
arrays and slices.

---

## Phase 3 — Compile-time bounds checking (~2-3h)

**File:** `src/typechecker/expressions.js`

When indexing an array with a constant integer, check against the declared size:

### Index bounds

In the `IndexExpr` handler:

```js
if (baseType.kind === "array" && baseType.size != null) {
    const idx = this._constIntValue(expr.index);
    if (idx !== null) {
        if (idx < 0) {
            this.error(expr, `invalid array index ${idx} (index must not be negative)`);
        } else if (idx >= baseType.size) {
            this.error(expr, `invalid array index ${idx} (out of bounds for ${typeStr(baseType)})`);
        }
    }
}
```

### Helper: extract constant integer value

```js
_constIntValue(expr) {
    if (expr.kind === "BasicLit" && expr.type === "INT") return Number(expr.value);
    if (expr.kind === "Ident") {
        const val = this._constValues?.get(expr.name);
        if (val !== undefined && typeof val === "number") return val;
    }
    return null;
}
```

This catches `arr[5]` on a `[3]int` at compile time — a common off-by-one source.

---

## Phase 4 — Composite literal element count validation (~1-2h)

**File:** `src/typechecker/expressions.js`

When a composite literal has an explicit array size (`[3]int{1, 2, 3, 4}`), verify the
element count doesn't exceed the declared size:

```js
if (resolvedType.kind === "array" && resolvedType.size != null && !typeNode.inferLen) {
    const maxIndex = computeMaxIndex(expr.elems);
    if (maxIndex >= resolvedType.size) {
        this.error(expr,
            `array index ${maxIndex} out of bounds [0:${resolvedType.size}]`);
    }
}
```

### Keyed elements

Go allows sparse initialisation: `[5]int{2: 10, 4: 20}`. The max key determines the
highest used index, not the element count. The helper:

```js
function computeMaxIndex(elems) {
    let sequential = 0;
    let maxKeyed = -1;
    for (const e of elems) {
        if (e.kind === "KeyValueExpr" && e.key?.value !== undefined) {
            maxKeyed = Math.max(maxKeyed, Number(e.key.value));
        } else {
            sequential++;
        }
    }
    return Math.max(sequential - 1, maxKeyed);
}
```

---

## Phase 5 — Array assignment and type compatibility (~2-3h)

**File:** `src/typechecker/types.js`

### Size matching in `assertAssignable`

In Go, `[3]int` and `[4]int` are different types. Update `assertAssignable`:

```js
if (target.kind === "array" && source.kind === "array") {
    if (target.size != null && source.size != null && target.size !== source.size) {
        return `cannot use ${typeStr(source)} as ${typeStr(target)} (different array lengths)`;
    }
    return assertAssignable(target.elem, source.elem, ...);
}
```

### Array ↔ slice distinction

In Go, `[]int` and `[3]int` are incompatible types. Add a check:

```js
if (target.kind === "array" && source.kind === "slice") {
    return `cannot use ${typeStr(source)} as ${typeStr(target)}`;
}
if (target.kind === "slice" && source.kind === "array") {
    return `cannot use ${typeStr(source)} as ${typeStr(target)}`;
}
```

### `isArray()` predicate

Add to `src/typechecker/types.js`:

```js
export function isArray(t) {
    if (!t) return false;
    if (t.kind === "array") return true;
    if (t.kind === "named") return t.underlying?.kind === "array";
    return false;
}
```

---

## Phase 6 — Compile-time `len()` for fixed arrays (~1h)

**Files:** `src/typechecker/expressions.js`, `src/codegen/expressions.js`

### TypeChecker

When `len()` is called on a fixed array with known size, annotate with the constant
value for use downstream:

```js
case "len": {
    const argType = this.checkExpr(expr.args[0], scope);
    if (argType.kind === "array" && argType.size != null) {
        expr._constLen = argType.size;
    }
    return INT;
}
```

### CodeGen optimisation

When `_constLen` is set, emit the constant instead of calling `__len`:

```js
case "len": {
    if (expr._constLen != null) return String(expr._constLen);
    // ... existing __len() path ...
}
```

This is a minor optimisation, but it demonstrates that the compiler actually knows the
array size. In Go, `len([3]int{...})` is a compile-time constant.

---

## Phase 7 — Range over array preserves index type (~1h)

**File:** `src/typechecker/statements.js`

Currently `for i, v := range arr` works identically for arrays and slices. No changes
needed for basic functionality. However, add a check that range variables match:

- For arrays, the iteration variable count shouldn't use blank+value for zero-length
  arrays (minor, low priority).

This phase is mostly verification — confirm existing range codegen works correctly
with the tighter type checking from earlier phases.

---

## Phase 8 — Slicing arrays produces slices (~1h)

**File:** `src/typechecker/expressions.js`

Already implemented: slicing an array produces a slice type. Verify and document:

```js
// a[1:3] where a is [5]int → []int
if (baseType.kind === "array") {
    return { kind: "slice", elem: baseType.elem };
}
```

This matches Go semantics exactly. No changes needed — just add test coverage.

---

## End-to-End Examples

### Input: compile-time bounds check

```go
package main

func main() {
    arr := [3]int{10, 20, 30}
    x := arr[2]  // OK
    y := arr[5]  // Error: invalid array index 5 (out of bounds for [3]int)
}
```

### Input: reject append on array

```go
package main

func main() {
    arr := [3]int{1, 2, 3}
    arr = append(arr, 4)  // Error: cannot append to array (type [3]int)
}
```

### Input: size mismatch

```go
package main

func main() {
    var a [3]int
    var b [4]int
    a = b  // Error: cannot use [4]int as [3]int (different array lengths)
}
```

### Input: `[...]T` inference

```go
package main

func main() {
    arr := [...]string{"a", "b", "c"}
    fmt.Println(len(arr))  // 3 (compile-time constant)
}
```

Generated JavaScript:

```js
function main() {
    let arr = ["a", "b", "c"];
    console.log(3);  // len() resolved at compile time
}
```

---

## Test File: `test/types/arrays.test.js`

Register in `test/run.js`. Write tests in phase order.

### Phase 1 — `[...]T` size inference

```js
test("[...]int infers size from element count")
test("[...]int with keyed elements infers max index + 1")
test("[...]string composite literal compiles and runs")
test("typeStr for inferred array prints size, not null")
```

### Phase 2 — Reject append on arrays

```js
test("error: append on [3]int")
test("error: append on named array type")
test("append on []int still works")
```

### Phase 3 — Compile-time bounds checking

```js
test("error: constant index out of bounds")
test("error: negative constant index")
test("no error: constant index within bounds")
test("no error: variable index (not checked at compile time)")
test("bounds check with const-declared index")
```

### Phase 4 — Composite literal validation

```js
test("error: too many elements in [3]int{1,2,3,4}")
test("error: keyed element index out of bounds [3]int{5: 1}")
test("no error: exact element count matches")
test("no error: sparse init within bounds [5]int{2: 10, 4: 20}")
```

### Phase 5 — Assignment compatibility

```js
test("error: assign [3]int to [4]int")
test("error: assign []int to [3]int")
test("error: assign [3]int to []int")
test("no error: assign [3]int to [3]int")
test("no error: assign [3]int to same named type")
```

### Phase 6 — Compile-time len()

```js
test("len([3]int{...}) compiles to constant 3")
test("len([]int{...}) still uses __len helper")
test("len on named array type resolves to constant")
```

### Phase 8 — Slicing produces slice

```js
test("arr[1:3] on [5]int produces []int")
test("can append to result of slicing an array")
```

### End-to-end

```js
test("array as function parameter preserves type")
test("range over array works correctly")
test("array in struct field")
test("nested arrays [2][3]int")
```

---

## What Does NOT Change

- **Runtime representation**: Arrays remain plain JS arrays. No wrapper class, no
  `Object.freeze`, no length enforcement at runtime.
- **Codegen for array literals**: `[3]int{1, 2, 3}` still emits `[1, 2, 3]`.
- **`copy()` on arrays**: Remains allowed (Go allows `copy` with arrays as of Go 1.22).
- **`cap()` on arrays**: Returns `len()` (JS has no capacity concept).
- **Three-index slice `a[lo:hi:max]`**: `max` remains parsed but ignored.
- **Value-type copy semantics**: Array assignment in Go copies the entire array. In
  GoFront, JS reference semantics apply — both variables point to the same underlying
  array. Emulating value copies would require `[...arr]` on every assignment, which is
  expensive and breaks the mental model for JS developers. This is a documented semantic
  difference, not a bug.

---

## Risk Summary

| Risk | Mitigation |
|---|---|
| Rejecting `append()` on arrays breaks existing code | Scan example apps and tests first; fix any arrays that should be slices |
| Array/slice incompatibility breaks existing assignments | Phase 5 is the most disruptive — run full test suite after each sub-step; consider a transitional warning before hard error |
| Constant bounds checking false positives | Only check when index is provably constant (`BasicLit` or known `const`); variable indices are unchecked |
| `[...]T` size inference with complex keyed literals | Handle `KeyValueExpr` keys that are constant expressions; reject non-constant keys gracefully |
| breaking change: code that assigns `[]int` to `[N]int` | Natural Go migration — the types were always distinct, code was relying on GoFront's lax checking |
| compile-time `len()` optimisation visible in output | Only applies when size is statically known — safe; falling back to `__len` for dynamic cases |

---

## V1 Scope

**In scope:**
- `[...]T` size inference at compile time
- Reject `append()` on array types
- Compile-time bounds checking for constant indices
- Composite literal element count validation
- Array size matching in assignments (`[3]int` ≠ `[4]int`)
- Array/slice type incompatibility (`[]int` ≠ `[3]int`)
- Compile-time `len()` constant folding for fixed arrays
- `isArray()` predicate and clean `typeStr` for arrays

**Out of scope (documented semantic differences):**
- Value-type copy semantics for arrays (JS reference semantics apply)
- Runtime length enforcement (no `Object.freeze` or proxy wrappers)
- `cap()` distinct from `len()` (JS arrays have no capacity)
- Bounds checking for non-constant indices (would need runtime checks)
- Multi-dimensional array size propagation (`[2][3]int` inner size tracking)
