# Range-over-Iterator Functions Implementation Plan (v0.0.5)

Go 1.23 feature: `for range` over functions with a `yield` callback.

## What the Feature Is

A function can be used as a range iterator if it matches one of these signatures:

```go
func(yield func() bool)           // no variables
func(yield func(K) bool)          // key only
func(yield func(K, V) bool)       // key and value
```

The iterator calls `yield` for each element. `yield` returns `false` when the loop
is broken. Example:

```go
func Pairs(s []string) func(yield func(int, string) bool) {
    return func(yield func(int, string) bool) {
        for i, v := range s {
            if !yield(i, v) { return }
        }
    }
}

for i, v := range Pairs([]string{"a", "b", "c"}) {
    fmt.Println(i, v)
}
```

## Key Insight

No new runtime helpers needed. JS closures handle the yield protocol naturally.
The hard part is `break`/`return` propagation — `yield` must return `false` when
the loop body breaks or returns early.

---

## Scope of Changes

| Component | Change |
|---|---|
| Parser | None — `RangeExpr` already wraps any expression |
| `src/typechecker/types.js` | Add `iteratorYieldParams()` predicate |
| `src/typechecker/statements.js` | Detect iterator range in `ForStmt`, bind loop variables |
| `src/codegen/statements.js` | Add `genIteratorFor()`, handle `break`/`continue`/`return` inside yield |
| `src/codegen.js` | Initialise iterator context flags in constructor |

---

## Phase 1 — Type Predicate (~1-2h)

**File:** `src/typechecker/types.js`

Add `iteratorYieldParams(t)` — the single gate for everything downstream:

```js
/**
 * Returns null if t is not an iterator function.
 * Returns { yieldParams: Type[] } if it is, where yieldParams are the
 * types the range variables will be bound to (0, 1, or 2 elements).
 */
export function iteratorYieldParams(t) {
    const fn = t?.kind === "named" ? t.underlying : t;
    if (fn?.kind !== "func") return null;
    if (fn.params.length !== 1) return null;
    const yieldFn = fn.params[0]?.kind === "named"
        ? fn.params[0].underlying : fn.params[0];
    if (yieldFn?.kind !== "func") return null;
    if (yieldFn.returns.length !== 1 || !isBool(yieldFn.returns[0])) return null;
    if (yieldFn.params.length > 2) return null;
    return { yieldParams: yieldFn.params };
}
```

---

## Phase 2 — TypeChecker (~2-3h)

**File:** `src/typechecker/statements.js`

Add `_checkRangeIterStmt(stmt, scope, returnType)` helper. When the `ForStmt` init
has a `RangeExpr` whose inner expression is an iterator function, call this instead
of the generic `DefineStmt` handler:

```js
_checkRangeIterStmt(defineStmt, scope, returnType) {
    const rangeExpr = defineStmt.rhs[0];
    const iterType = this.checkExpr(rangeExpr.expr, scope);
    const info = iteratorYieldParams(iterType);
    if (!info) return null; // not an iterator — fall through

    // Annotate for codegen
    rangeExpr._isIterator = true;
    rangeExpr._yieldParams = info.yieldParams;

    // Bind loop variables to their yield param types
    const lhs = defineStmt.lhs;
    for (let i = 0; i < lhs.length; i++) {
        const name = lhs[i].name ?? lhs[i];
        if (name === "_") continue;
        const varType = info.yieldParams[i] ?? ANY;
        scope.defineLocal(name, varType);
    }
    return info;
}
```

In `ForStmt`, call it before the generic init check:

```js
case "ForStmt": {
    const inner = new Scope(scope);
    let iterInfo = null;
    if (stmt.init?.rhs?.[0]?.kind === "RangeExpr") {
        iterInfo = this._checkRangeIterStmt(stmt.init, inner, returnType);
    }
    if (!iterInfo && stmt.init) {
        this.checkStmt(stmt.init, inner, returnType);
    }
    // ... rest unchanged ...
}
```

**Error messages to add:**

- Too many loop variables: `"range over iterator: too many loop variables (got N, max 2)"`
- Non-bool yield return: `"function is not a range iterator: yield callback must return bool"`
- `range` over a plain func with wrong shape: existing "cannot range over" message is sufficient

---

## Phase 3 — CodeGen: basic case (~2-3h)

**File:** `src/codegen/statements.js`

Plug the new path into `genFor()`:

```js
genFor(stmt) {
    if (this.isRangeFor(stmt)) {
        if (stmt.init.rhs[0]._isIterator) {
            this.genIteratorFor(stmt);
        } else {
            this.genRangeFor(stmt);
        }
        return;
    }
    // ... existing paths ...
}
```

Implement `genIteratorFor(stmt)`:

```js
genIteratorFor(stmt) {
    const range = stmt.init.rhs[0];
    const lhs = stmt.init.lhs.map(e => e.name ?? this.genExpr(e));
    const iteree = this.genExpr(range.expr);
    const yieldParams = range._yieldParams;

    // Use unique flag names for nested iterator loops
    const d = this._iterDepth++;
    const breakFlag = `__broke${d}`;
    const retFlag = `__returned${d}`;
    const retVar = `__retVal${d}`;

    // Yield callback param names (blank vars get _$N to avoid JS syntax error)
    const cbParams = lhs.map((n, i) => n === "_" ? `_$${i}` : n);

    this.line("{");
    this.indented(() => {
        this.line(`let ${breakFlag} = false;`);
        this.line(`let ${retFlag} = false;`);
        this.line(`let ${retVar};`);

        const params = yieldParams.length === 0 ? "" : cbParams.join(", ");
        this.line(`${iteree}(function(${params}) {`);
        this.indented(() => {
            // Save and set iterator context
            const prev = {
                in: this._inIteratorBody,
                break: this._iterBreakFlag,
                ret: this._iterReturnFlag,
                retVar: this._iterReturnVar,
            };
            this._inIteratorBody = true;
            this._iterBreakFlag = breakFlag;
            this._iterReturnFlag = retFlag;
            this._iterReturnVar = retVar;

            this.genBlock(stmt.body);

            // Restore context
            this._inIteratorBody = prev.in;
            this._iterBreakFlag = prev.break;
            this._iterReturnFlag = prev.ret;
            this._iterReturnVar = prev.retVar;

            this.line("return true;");
        });
        this.line("});");
        this.line(`if (${retFlag}) return ${retVar};`);
    });
    this.line("}");
    this._iterDepth--;
}
```

Initialise in `src/codegen.js` constructor:

```js
this._inIteratorBody = false;
this._iterDepth = 0;
this._iterBreakFlag = null;
this._iterReturnFlag = null;
this._iterReturnVar = null;
```

---

## Phase 4 — Break / Continue / Return Propagation (~3-4h)

**File:** `src/codegen/statements.js`

Modify `genStmt` to intercept these when `_inIteratorBody` is true:

### `BranchStmt`

```js
case "BranchStmt":
    if (this._inIteratorBody && !stmt.label) {
        if (stmt.keyword === "break") {
            this.line(`${this._iterBreakFlag} = true; return false;`);
            break;
        }
        if (stmt.keyword === "continue") {
            this.line("return true;");
            break;
        }
    }
    // ... existing fallthrough ...
```

### `ReturnStmt`

```js
case "ReturnStmt":
    if (this._inIteratorBody) {
        if (stmt.values.length === 0 && !this._namedReturnVars?.length) {
            this.line(`${this._iterReturnFlag} = true; return false;`);
        } else {
            const vals = (stmt.values.length > 0
                ? stmt.values.map(v => this.genExpr(v))
                : this._namedReturnVars ?? []
            );
            const stored = vals.length === 1 ? vals[0] : `[${vals.join(", ")}]`;
            this.line(`${this._iterReturnFlag} = true; ${this._iterReturnVar} = ${stored}; return false;`);
        }
        break;
    }
    // ... existing return gen ...
```

### Propagation table

| Inside yield callback | After iterator call |
|---|---|
| Normal end of body | `return true;` | nothing |
| `break` | `__brokeN = true; return false;` | nothing |
| `continue` | `return true;` | nothing |
| `return` (void) | `__returnedN = true; return false;` | `if (__returnedN) return __retValN;` |
| `return expr` | `__returnedN = true; __retValN = expr; return false;` | `if (__returnedN) return __retValN;` |

### Example output

```go
for i := range Counter(10) {
    if i == 3 { break }
    console.log(i)
}
```

```js
{
    let __broke0 = false;
    let __returned0 = false;
    let __retVal0;
    Counter(10)(function(i) {
        if (i === 3) {
            __broke0 = true; return false;
        }
        console.log(i);
        return true;
    });
    if (__returned0) return __retVal0;
}
```

---

## Phase 5 — Edge Cases (~1-2h)

- **Blank vars:** `for _, v := range iter` — `_` maps to `_$0` in the callback params
- **Nested iterator loops:** Unique flag names (`__broke0`, `__broke1`, ...) via `_iterDepth` counter handle this correctly
- **`defer` inside iterator body:** Defers are pushed onto the outer function's `__defers` list — correct Go semantics (defer fires on function return, not loop exit). No special handling needed.
- **`AssignStmt` variant** (`i, v = range iter` without `:=`): same `_checkRangeIterStmt` / `genIteratorFor` paths apply; check `stmt.init.kind` for both `DefineStmt` and `AssignStmt`
- **Labeled `break`/`continue`** targeting the iterator loop: emit a type-checker error — `"labeled break/continue inside range-over-iterator is not supported"` (rare edge case, defer to follow-up)

---

## Test File: `test/language/range-iter.test.js`

Register in `test/run.js`. Write tests in this order:

### Phase 1 — Basic correctness
```js
test("range over 0-param iterator")
test("range over 1-param iterator (key only)")
test("range over 2-param iterator (key and value)")
test("range over factory function returning iterator")
test("range over inline function literal")
test("iterator that yields 0 elements — body never runs")
```

### Phase 2 — Break propagation
```js
test("break exits iterator loop")
test("break stops iterator from invoking yield again")
test("break in nested if inside iterator body")
```

### Phase 3 — Continue propagation
```js
test("continue skips rest of body but iterates further")
```

### Phase 4 — Return propagation
```js
test("return inside iterator loop returns from outer function")
test("return with value propagates correctly")
test("return with multi-value propagates correctly")
```

### Phase 5 — Edge cases
```js
test("blank var _ in range iterator")
test("nested iterator loops iterate independently")
test("break in inner loop does not break outer loop")
test("defer inside iterator body fires on function return not loop exit")
```

### Phase 6 — TypeChecker errors
```js
test("error: yield callback must return bool")
test("error: too many loop variables for 1-param yield")
test("error: range over plain func is rejected")
```

---

## Risks

| Risk | Mitigation |
|---|---|
| `return` inside iterator body with named return values | Check `_namedReturnVars` when storing `__retValN` |
| Nested iterator loops sharing flag names | Use `_iterDepth` counter for unique names |
| `defer` / try-catch interaction | Defer uses outer function scope — no conflict; add explicit test |
| Labeled `break` targeting outer non-iterator loop | Falls through to existing labeled-break codegen; only breaks inside the yield callback are intercepted |
| `AssignStmt` range variant overlooked | Test both `:=` and `=` forms |
