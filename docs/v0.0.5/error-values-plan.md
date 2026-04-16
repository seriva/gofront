# Richer Error Values Implementation Plan (v0.0.5)

The `error` type is currently a plain string at runtime. `error("msg")` is an identity,
`.Error()` returns the string itself, `errors.New` is an identity, and `fmt.Errorf`
returns a formatted string. This is a practical simplification but diverges from Go in
several important ways:

- Cannot define custom error types that implement the `error` interface
- Cannot use `errors.Is` / `errors.As` / `errors.Unwrap` for error chain inspection
- Cannot wrap errors (`fmt.Errorf("context: %w", err)`)
- Cannot type-switch on error values
- No distinction between the `error` interface and `string`

## Key Insight

In Go, `error` is an interface: `type error interface { Error() string }`. Any struct
with an `Error() string` method satisfies it. GoFront already has interface satisfaction
checking — the missing piece is making `error` an interface type instead of a basic type,
and wrapping string errors in a lightweight object so `.Error()` and type assertions work.

The runtime cost is minimal: one small object allocation per error. The `__error` helper
is tree-shaken — only emitted when error values are constructed.

---

## Current State

| Aspect | Current behaviour | Go behaviour | Gap |
|---|---|---|---|
| `error` type kind | `{ kind: "basic", name: "error" }` | Interface `{ Error() string }` | Fundamental mismatch |
| `error("msg")` | Identity — returns the string | N/A (not valid Go syntax) | GoFront extension |
| `errors.New("msg")` | Identity — returns the string | Returns `*errorString{s}` | No wrapping |
| `fmt.Errorf(...)` | Returns formatted string | Returns `*fmt.wrapError` or `*errorString` | No wrapping |
| `.Error()` | Codegen special-case returns string | Method call on interface | Fragile |
| Custom error types | Not possible | Any struct with `Error() string` | Core gap |
| `errors.Is(err, target)` | Not implemented | Chain comparison | Missing |
| `errors.As(err, &target)` | Not implemented | Chain type assertion | Missing |
| `errors.Unwrap(err)` | Not implemented | Returns wrapped error | Missing |
| `%w` verb in `fmt.Errorf` | Not supported | Wraps inner error | Missing |
| Type assertion on error | No — error is not an interface | `err.(*MyError)` works | Broken |
| nil error | `null` | Typed nil | OK (close enough) |

---

## Scope of Changes

| Component | Change |
|---|---|
| `src/typechecker/types.js` | Change `ERROR` from basic type to interface type; update `isError()` |
| `src/typechecker.js` | Register `error` as an interface; update stdlib returns |
| `src/typechecker/expressions.js` | Allow custom types to satisfy `error` interface; handle `errors.Is`/`As`/`Unwrap`; support `%w` |
| `src/codegen.js` | Add tree-shaken `__error` helper |
| `src/codegen/expressions.js` | `error()` and `errors.New()` emit `__error(msg)`; `fmt.Errorf` with `%w` emits wrapped error; `errors.Is`/`As`/`Unwrap` emit JS |
| `src/codegen/statements.js` | No changes expected |
| `src/parser.js` | No changes — `error` is already parsed as an identifier |

---

## Phase 1 — Change `error` to an interface type (~2-3h)

**File:** `src/typechecker/types.js`

Replace the basic type constant with an interface:

```js
export const ERROR = {
    kind: "interface",
    methods: new Map([
        ["Error", { kind: "func", params: [], returns: [STRING], async: false }],
    ]),
};
```

Update `isError()`:

```js
export function isError(t) {
    if (!t) return false;
    if (t === ERROR) return true;
    if (t.kind === "named" && t.underlying === ERROR) return true;
    // Check if it structurally satisfies the error interface
    if (t.kind === "named" && t.underlying?.kind === "interface") {
        return t.underlying.methods?.has("Error");
    }
    return false;
}
```

Remove `error` from `BASIC_TYPES` — it should not be treated as a basic type anymore.
Register it separately in the type checker's type map (Phase 2).

### Backward compatibility

This is the riskiest change. Existing code checks `t.kind === "basic" && t.name ===
"error"` in several places. All must use `isError(t)` instead. Audit and fix:

- `assertAssignable` — string-to-error assignability must be preserved for now
  (transition period)
- Binary comparisons (`err == nil`) — already work via interface nil semantics
- Return type matching — functions returning `error` must accept both string errors
  and custom error types

---

## Phase 2 — Register `error` as a type and update builtins (~1-2h)

**File:** `src/typechecker.js`

Register `error` in the types map instead of `BASIC_TYPES`:

```js
this.types.set("error", ERROR);
```

The `error()` builtin continues to work — it constructs a simple error from a string.
Update the stdlib return types to use the new `ERROR` constant (they already reference
it, so this should be automatic if `ERROR` is updated in place).

### Built-in `error()` function

Keep `error(msg)` as a GoFront extension (not valid Go, but used widely). It constructs
a simple string-backed error object. Type: `func(string) error`.

---

## Phase 3 — Runtime error object (~2-3h)

**Files:** `src/codegen.js`, `src/codegen/expressions.js`

### Tree-shaken `__error` helper

Add to codegen preamble (emitted only when used):

```js
function __error(msg, cause) {
    return { Error() { return msg; }, _msg: msg, _cause: cause ?? null };
}
```

The `_msg` field is for fast string access. The `_cause` field supports error wrapping
(`%w`). The `Error()` method makes it satisfy the `error` interface at runtime.

### Update `error()` codegen

```js
case "error": {
    this._usesError = true;
    const arg = this.genExpr(expr.args[0]);
    return `__error(${arg})`;
}
```

Before: `error("bad input")` → `"bad input"`
After:  `error("bad input")` → `__error("bad input")`

### Update `errors.New()` codegen

```js
if (expr.func.field === "New") {
    this._usesError = true;
    return `__error(${a[0]})`;
}
```

Before: `errors.New("not found")` → `"not found"`
After:  `errors.New("not found")` → `__error("not found")`

### Update `fmt.Errorf()` codegen

```js
case "Errorf": {
    this._usesSprintf = true;
    this._usesError = true;
    // Check for %w verb — extract the wrapped error
    const fmtStr = expr.args[0];
    if (fmtStr.kind === "BasicLit" && fmtStr.value.includes("%w")) {
        // Last arg matching %w is the wrapped cause
        return `__error(__sprintf(${fmtArgs}), ${lastWrapArg})`;
    }
    return `__error(__sprintf(${fmtArgs}))`;
}
```

Before: `fmt.Errorf("wrap: %s", err)` → `__sprintf("wrap: %s", err)`
After:  `fmt.Errorf("wrap: %w", err)` → `__error(__sprintf("wrap: %w", err), err)`

### Update `.Error()` codegen

Replace the special-case string identity with a method call:

```js
// error.Error() → err.Error() (real method call now)
if (
    expr.func.kind === "SelectorExpr" &&
    expr.func.field === "Error" &&
    isError(expr.func.expr._type)
) {
    return `${this.genExpr(expr.func.expr)}.Error()`;
}
```

Before: `err.Error()` → `err`
After:  `err.Error()` → `err.Error()`

---

## Phase 4 — Custom error types (~2-3h)

**File:** `src/typechecker/expressions.js`, `src/typechecker.js`

This is the payoff: structs with an `Error() string` method now satisfy the `error`
interface.

### Interface satisfaction

The existing `implements(type, iface)` function already handles this. Once `ERROR` is
an interface, a struct like:

```go
type NotFoundError struct {
    Name string
}

func (e NotFoundError) Error() string {
    return "not found: " + e.Name
}
```

automatically satisfies `error` because it has `Error() string`. No new code needed
in the interface satisfaction checker — it already compares method sets.

### Returning custom errors

```go
func lookup(name string) (int, error) {
    return 0, NotFoundError{Name: name}
}
```

The type checker's `assertAssignable` sees `NotFoundError` (which implements `error`)
being returned where `error` is expected — this already passes with interface
satisfaction checking.

### CodeGen for custom errors

No special codegen — `NotFoundError{Name: "x"}` compiles to `new NotFoundError({ Name: "x" })` as any struct. Since the struct has an `Error()` method, the runtime object
already has `.Error()` on it.

---

## Phase 5 — Type assertions on errors (~2h)

**File:** `src/typechecker/expressions.js`, `src/codegen/expressions.js`

Since `error` is now an interface, type assertions work naturally:

```go
err := lookup("missing")
if ne, ok := err.(*NotFoundError); ok {
    console.log(ne.Name)
}
```

### TypeChecker

Type assertions on interfaces are already implemented. With `error` as an interface,
`err.(*NotFoundError)` type-checks via the existing `TypeAssertExpr` handler.

### CodeGen

Type assertions already compile to `instanceof` checks:

```js
// err.(*NotFoundError) with comma-ok
let [ne, ok] = (err instanceof NotFoundError) ? [err, true] : [null, false];
```

This works because custom error types are real classes. For built-in `__error` objects,
a type assertion to a concrete type correctly returns `false` — they're not instances
of any user class.

---

## Phase 6 — `errors.Is`, `errors.As`, `errors.Unwrap` (~3-4h)

**Files:** `src/typechecker.js`, `src/typechecker/expressions.js`,
`src/codegen/expressions.js`

### Type declarations

Add to the `errors` namespace in the type checker:

```js
this.globals.define("errors", {
    kind: "namespace",
    name: "errors",
    members: {
        New:    { kind: "func", params: [STRING], returns: [ERROR] },
        Is:     { kind: "func", params: [ERROR, ERROR], returns: [BOOL] },
        As:     { kind: "func", params: [ERROR, ANY], returns: [BOOL] },
        Unwrap: { kind: "func", params: [ERROR], returns: [ERROR] },
    },
});
```

### `errors.Unwrap(err)` codegen

```js
if (expr.func.field === "Unwrap") {
    const errExpr = this.genExpr(expr.args[0]);
    return `(${errExpr}?._cause ?? null)`;
}
```

Returns the wrapped error (set by `fmt.Errorf` with `%w`) or `null` if none.

### `errors.Is(err, target)` codegen

Walk the error chain comparing each error:

```js
if (expr.func.field === "Is") {
    this._usesErrorIs = true;
    return `__errorIs(${this.genExpr(expr.args[0])}, ${this.genExpr(expr.args[1])})`;
}
```

Tree-shaken helper:

```js
function __errorIs(err, target) {
    while (err !== null) {
        if (err === target) return true;
        if (typeof err === "object" && typeof target === "object" &&
            err._msg !== undefined && target._msg !== undefined &&
            err._msg === target._msg) return true;
        err = err?._cause ?? null;
    }
    return false;
}
```

### `errors.As(err, target)` codegen

Simplified version — since GoFront doesn't have real pointers for the target parameter,
`errors.As` can return a boolean and the caller uses a type assertion separately:

```js
if (expr.func.field === "As") {
    this._usesErrorAs = true;
    return `__errorAs(${this.genExpr(expr.args[0])}, ${this.genExpr(expr.args[1])})`;
}
```

```js
function __errorAs(err, target) {
    while (err !== null) {
        if (err instanceof target.constructor) {
            Object.assign(target, err);
            return true;
        }
        err = err?._cause ?? null;
    }
    return false;
}
```

**Note:** `errors.As` in Go takes a pointer-to-interface and populates it. In GoFront,
this requires the pointer model improvement. For v1, a simplified form works: return
the matched error value directly or use the comma-ok type assertion pattern as the
recommended alternative.

---

## Phase 7 — `%w` verb in `fmt.Errorf` (~1-2h)

**Files:** `src/codegen/expressions.js`, `src/typechecker/expressions.js`

### TypeChecker

In the `fmt.Errorf` handler, when the format string contains `%w`, verify the
corresponding argument is an `error` type:

```js
// In fmt function argument checking:
if (verb === "w") {
    if (!isError(argType)) {
        this.error(arg, `fmt.Errorf: %w requires error type, got ${typeStr(argType)}`);
    }
}
```

### CodeGen

The `%w` verb in the sprintf helper should format the wrapped error's message (call
`.Error()` if it's an object, or use the string directly). The cause is passed as the
second argument to `__error`:

```go
inner := errors.New("disk full")
outer := fmt.Errorf("write failed: %w", inner)
// errors.Unwrap(outer) == inner  ← true
```

```js
let inner = __error("disk full");
let outer = __error(__sprintf("write failed: %w", inner), inner);
// outer._cause === inner  ← true
```

The `__sprintf` helper needs a `%w` case that calls `.Error()` on the argument (or
converts to string if it's already a string for backward compatibility).

---

## Phase 8 — Sentinel errors and package-level error vars (~1h)

**File:** `src/typechecker/statements.js`

Common Go pattern:

```go
var ErrNotFound = errors.New("not found")
var ErrTimeout  = errors.New("timeout")

func lookup() error {
    return ErrNotFound
}

if errors.Is(err, ErrNotFound) { ... }
```

This already works with the changes above — `errors.New` returns an `__error` object,
package-level variables hold references, and `errors.Is` compares by identity. No
additional changes needed, but add explicit test coverage.

---

## Migration and Backward Compatibility

### Breaking change: error is no longer a string

This is a **breaking change** at runtime. Code that relies on error values being plain
strings will break. Migration path:

| Pattern | Before | After | Migration |
|---|---|---|---|
| `console.log(err)` | Prints string | Prints `[object Object]` | Use `err.Error()` |
| `err + " suffix"` | String concat works | Object concat | Use `err.Error() + " suffix"` |
| `err === "msg"` | Works | Fails (object vs string) | Use `err.Error() === "msg"` or `errors.Is` |
| String interpolation | Works | Prints `[object Object]` | Use `.Error()` |

### Transition strategy

To soften the migration, the `__error` helper can include a `toString()` method:

```js
function __error(msg, cause) {
    return {
        Error() { return msg; },
        toString() { return msg; },
        _msg: msg,
        _cause: cause ?? null,
    };
}
```

This makes `console.log(err)` and string concatenation (`"prefix: " + err`) work
naturally, since JS calls `toString()` in string contexts. The `===` string comparison
still breaks (by design — use `errors.Is` or `.Error()`).

---

## End-to-End Examples

### Custom error types

```go
package main

type ValidationError struct {
    Field   string
    Message string
}

func (e ValidationError) Error() string {
    return e.Field + ": " + e.Message
}

func validate(name string) error {
    if len(name) == 0 {
        return ValidationError{Field: "name", Message: "required"}
    }
    return nil
}

func main() {
    err := validate("")
    if err != nil {
        console.log(err.Error())
    }
    if ve, ok := err.(ValidationError); ok {
        console.log("field:", ve.Field)
    }
}
```

Output:
```
name: required
field: name
```

### Error wrapping

```go
package main

func readConfig() error {
    return fmt.Errorf("read config: %w", errors.New("file not found"))
}

func main() {
    err := readConfig()
    console.log(err.Error())

    inner := errors.Unwrap(err)
    console.log(inner.Error())

    console.log(errors.Is(err, errors.New("file not found")))
}
```

Output:
```
read config: file not found
file not found
false
```

Note: `errors.Is` returns `false` here because `errors.New` creates a new object each
time — identity comparison fails. Sentinel errors (package-level vars) work correctly.

---

## Test File: `test/types/errors.test.js`

Register in `test/run.js`. Write tests in phase order.

### Phase 1 — Error as interface type

```js
test("error type has Error() method")
test("error is assignable from struct with Error() string")
test("error is not assignable from struct without Error()")
test("error return type accepts nil")
test("error return type accepts custom error struct")
```

### Phase 3 — Runtime error objects

```js
test("error(msg) creates object with .Error() method")
test("errors.New(msg) creates object with .Error() method")
test("fmt.Errorf creates error object")
test("error toString() works in string context")
test("error comparison with nil works")
```

### Phase 4 — Custom error types

```js
test("struct with Error() string satisfies error interface")
test("return custom error from function returning error")
test("custom error .Error() method called correctly")
test("multiple custom error types in same package")
```

### Phase 5 — Type assertions on errors

```js
test("type assertion on error to concrete type")
test("type assertion comma-ok on error")
test("type switch on error value")
test("type assertion fails for non-matching error type")
```

### Phase 6 — errors.Is / As / Unwrap

```js
test("errors.Unwrap returns wrapped error")
test("errors.Unwrap returns nil for non-wrapped error")
test("errors.Is matches sentinel error")
test("errors.Is walks error chain")
test("errors.Is returns false for different sentinel")
test("errors.As finds matching type in chain")
```

### Phase 7 — %w verb

```js
test("fmt.Errorf with %w wraps error")
test("fmt.Errorf with %w: Unwrap returns original")
test("error: %w requires error argument")
test("fmt.Errorf without %w does not wrap")
```

### Phase 8 — Sentinel errors

```js
test("package-level error vars as sentinels")
test("errors.Is with sentinel across function call")
```

### Backward compatibility

```js
test("error toString() in console.log context")
test("error toString() in string concatenation")
test("error comparison with nil still works")
test("(value, error) return pattern still works")
```

---

## Risk Summary

| Risk | Mitigation |
|---|---|
| Breaking change: error is no longer a string | Add `toString()` to `__error` for soft migration; document in CHANGELOG |
| Existing `err === "msg"` comparisons break | These are rare and wrong in Go anyway; provide clear migration guidance |
| `isError()` callers checking `kind === "basic"` | Audit all call sites; update to use `isError()` predicate everywhere |
| Performance: object allocation per error | Tiny one-time cost; errors are exceptional path, not hot loop |
| `errors.As` needs pointer semantics | Defer full `As` to pointer model plan; provide simplified version or recommend type assertion |
| Error in composite literal position | `error` as interface can't be used in `error{...}` — must use `errors.New()` or custom type |
| fmt.Errorf `%w` parsing complexity | Only handle single `%w` per format string (Go 1.13); multiple `%w` (Go 1.20) is a follow-up |

---

## V1 Scope

**In scope:**
- `error` as an interface type `{ Error() string }` in the type system
- `error("msg")` and `errors.New("msg")` produce `__error` runtime objects
- `.Error()` is a real method call, not a codegen special-case
- Custom error types (structs with `Error() string` method) satisfy `error`
- Type assertions and type switches on error values
- `errors.Unwrap(err)` — returns wrapped error or nil
- `errors.Is(err, target)` — walks error chain
- `fmt.Errorf("...: %w", err)` — wraps errors with cause chain
- `toString()` on error objects for soft backward compatibility
- Tree-shaken `__error`, `__errorIs` helpers

**Out of scope (future):**
- `errors.As` with full pointer semantics (depends on pointer model plan)
- Multiple `%w` verbs in a single `fmt.Errorf` (Go 1.20 feature)
- `errors.Join` (Go 1.20)
- Custom `Is()` / `Unwrap()` methods on error types (Go allows overriding these)
- Stack traces on errors
