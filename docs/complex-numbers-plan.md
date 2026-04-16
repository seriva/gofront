# Complex Number Types Implementation Plan (v0.0.4)

Go has first-class complex number support: `complex64` and `complex128` types, imaginary
literals (`3i`), and three builtins: `complex(r, i)`, `real(z)`, `imag(z)`. Complex
numbers are rarely used in frontend code but are part of the Go spec and appear in
codebases that do signal processing, fractals, or mathematical visualisations.

## Key Insight

JavaScript has no native complex type, so we shim it with a two-field object:
`{ re: float64, im: float64 }`. The builtins `complex()`, `real()`, `imag()` map
directly to object construction and field access. Arithmetic operators (`+`, `-`, `*`,
`/`) need codegen changes to emit helper calls instead of native JS operators.

Two tree-shaken runtime helpers are needed: `__cmul(a, b)` and `__cdiv(a, b)` for
multiplication and division (which have non-trivial formulas). Addition and subtraction
can be inlined.

---

## Current State

- **No support at all.** `complex64`, `complex128`, `complex()`, `real()`, `imag()`,
  and imaginary literals (`3i`) are not recognised.
- The lexer treats `3i` as `INT("3") + IDENT("i")`.
- `complex64` and `complex128` are not in `BASIC_TYPES`.
- The builtins `complex`, `real`, `imag` are not registered.

---

## Go Semantics Reference

| Feature | Go behaviour |
|---|---|
| `complex64` | Complex with `float32` real and imaginary parts |
| `complex128` | Complex with `float64` real and imaginary parts |
| `complex(r, i)` | Construct complex from two floats; return type depends on argument types |
| `real(z)` | Extract real part as float |
| `imag(z)` | Extract imaginary part as float |
| `3i` | Untyped complex constant `complex(0, 3)` |
| `1 + 2i` | Untyped complex constant `complex(1, 2)` |
| Arithmetic | `+`, `-`, `*`, `/` all defined; no ordering (`<`, `>` etc.) |
| Comparison | `==` and `!=` only |
| `fmt.Sprintf("%v", z)` | Prints as `(1+2i)` |

### Type rules

- `complex(float32, float32)` → `complex64`
- `complex(float64, float64)` → `complex128`
- `complex(untyped, untyped)` → untyped complex → defaults to `complex128`
- `real(complex64)` → `float32`; `real(complex128)` → `float64`
- `imag(complex64)` → `float32`; `imag(complex128)` → `float64`

Since GoFront maps `float32` → `float64` at runtime, we simplify:
**`complex64` and `complex128` both map to the same runtime representation.** The type
checker tracks the distinction; codegen treats them identically.

---

## Scope of Changes

| Component | Change |
|---|---|
| `src/lexer.js` | Recognise imaginary literals (`3i`, `1.5i`, `0x1p2i`) |
| `src/typechecker/types.js` | Add `COMPLEX128`, `COMPLEX64`, `UNTYPED_COMPLEX`; add `isComplex()` predicate; update `BASIC_TYPES` |
| `src/typechecker.js` | Register `complex`, `real`, `imag` builtins; update `binaryResultType` for complex arithmetic |
| `src/typechecker/expressions.js` | Type-check `complex()`, `real()`, `imag()` builtins; handle imaginary literal type |
| `src/codegen.js` | Add tree-shaken `__cmul`, `__cdiv` helpers |
| `src/codegen/expressions.js` | Codegen for `complex()`, `real()`, `imag()`, imaginary literals, complex arithmetic |

---

## Phase 1 — Lexer: imaginary literals (~1-2h)

**File:** `src/lexer.js`

Add a new token type and recognise imaginary suffixes.

### New token

```js
IMAG: "IMAG",  // imaginary literal: 3i, 1.5i, 0xi, etc.
```

### In `readNumber()`

After reading a complete number (integer or float), check for a trailing `i`:

```js
readNumber() {
    // ... existing number reading ...
    let { n, isFloat } = /* existing logic */;

    // Check for imaginary suffix
    if (this.src[this.pos] === "i") {
        this.pos++;
        this.push(T.IMAG, n, startLine, startCol);
        return;
    }

    // ... existing token push ...
}
```

### Semicolon insertion

`IMAG` tokens need semicolon insertion (like `INT` and `FLOAT`). Add `T.IMAG` to the
set of tokens that trigger automatic semicolons:

```js
const SEMI_TOKENS = new Set([
    T.IDENT, T.INT, T.FLOAT, T.IMAG, T.STRING, T.CHAR,
    // ...
]);
```

### Examples

| Input | Token |
|---|---|
| `3i` | `IMAG("3")` |
| `1.5i` | `IMAG("1.5")` |
| `0i` | `IMAG("0")` |
| `1_000i` | `IMAG("1000")` |
| `0x1p2i` | `IMAG("4")` (hex float evaluated, then imaginary) |

---

## Phase 2 — Type system (~1h)

**File:** `src/typechecker/types.js`

### New type constants

```js
export const COMPLEX128 = { kind: "basic", name: "complex128" };
export const COMPLEX64  = { kind: "basic", name: "complex64" };
export const UNTYPED_COMPLEX = { kind: "untyped", base: "complex128" };
```

### Update `BASIC_TYPES`

```js
export const BASIC_TYPES = {
    // ... existing ...
    complex64:  COMPLEX64,
    complex128: COMPLEX128,
};
```

### Predicates

```js
export function isComplex(t) {
    if (!t) return false;
    if (t.kind === "basic" && (t.name === "complex128" || t.name === "complex64")) return true;
    if (t.kind === "untyped" && t.base === "complex128") return true;
    if (t.kind === "named") return isComplex(t.underlying);
    return false;
}
```

### Update `isNumeric()`

Complex numbers are numeric in Go (arithmetic operators apply). Either extend
`isNumeric()` to include complex, or keep them separate and check `isNumeric(t) ||
isComplex(t)` where needed. Keeping them separate is cleaner because complex numbers
don't support ordering operators (`<`, `>`, `<=`, `>=`):

```js
// isNumeric stays unchanged — int + float64 only
// isComplexOrNumeric for contexts that allow complex:
export function isComplexOrNumeric(t) {
    return isNumeric(t) || isComplex(t);
}
```

### Update `defaultType()`

```js
if (t.kind === "untyped" && t.base === "complex128") return COMPLEX128;
```

### Update `typeStr()`

Already handled — basic types print their `name` field.

### Update `assertAssignable()`

Allow untyped complex → complex128/complex64:

```js
if (source.kind === "untyped" && source.base === "complex128") {
    if (target.name === "complex128" || target.name === "complex64") return;
}
```

Allow untyped int/float → complex (Go allows `var z complex128 = 5`):

```js
if (isComplex(target) && source.kind === "untyped" &&
    (source.base === "int" || source.base === "float64")) return;
```

---

## Phase 3 — Parser: imaginary literals (~1h)

**File:** `src/parser/expressions.js`

Handle `IMAG` tokens in `parsePrimary()`:

```js
if (this.match(T.IMAG)) {
    return {
        kind: "ImagLit",
        value: prev.value,
        loc: prev.loc,
    };
}
```

The `ImagLit` node represents just the imaginary part. The common pattern `1 + 2i` is
parsed as a `BinaryExpr` with `+` between `BasicLit(1)` and `ImagLit(2)` — the type
checker promotes this to complex.

---

## Phase 4 — TypeChecker: builtins and literals (~3-4h)

**File:** `src/typechecker/expressions.js`, `src/typechecker.js`

### Register builtins

```js
this.globals.define("complex", { kind: "builtin", name: "complex" });
this.globals.define("real",    { kind: "builtin", name: "real" });
this.globals.define("imag",    { kind: "builtin", name: "imag" });
```

### `ImagLit` type checking

In `checkExpr`:

```js
case "ImagLit":
    return UNTYPED_COMPLEX;
```

### `complex(r, i)` builtin

```js
case "complex": {
    if (expr.args.length !== 2) {
        this.error(expr, "complex() requires exactly 2 arguments");
        return ANY;
    }
    const rt = argTypes[0];
    const it = argTypes[1];

    // Both must be numeric (int or float, typed or untyped)
    if (!isNumeric(rt)) {
        this.error(expr, `cannot use ${typeStr(rt)} as float in complex()`);
        return ANY;
    }
    if (!isNumeric(it)) {
        this.error(expr, `cannot use ${typeStr(it)} as float in complex()`);
        return ANY;
    }

    // Determine result type:
    // float32 + float32 → complex64 (but float32 maps to float64 in GoFront)
    // float64 + float64 → complex128
    // untyped + untyped → untyped complex
    if (rt.kind === "untyped" && it.kind === "untyped") return UNTYPED_COMPLEX;
    return COMPLEX128;
}
```

### `real(z)` and `imag(z)` builtins

```js
case "real":
case "imag": {
    if (expr.args.length !== 1) {
        this.error(expr, `${name}() requires exactly 1 argument`);
        return ANY;
    }
    const zt = argTypes[0];
    if (!isComplex(zt)) {
        this.error(expr, `cannot use ${typeStr(zt)} as complex in ${name}()`);
        return ANY;
    }
    if (zt.kind === "untyped") return UNTYPED_FLOAT;
    if (zt.name === "complex64") return FLOAT64;  // float32 → float64 in GoFront
    return FLOAT64;
}
```

### Binary operators on complex

Update `binaryResultType()`:

```js
// Complex arithmetic: +, -, *, /
if (isComplex(lt) || isComplex(rt)) {
    // Promote: numeric + complex → complex
    if (!isComplexOrNumeric(lt) || !isComplexOrNumeric(rt)) {
        this.err(`invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`, node);
        return ANY;
    }
    // Only +, -, *, / allowed (no %, bitwise, shifts)
    if (op !== "+" && op !== "-" && op !== "*" && op !== "/") {
        this.err(`invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`, node);
        return ANY;
    }
    // Both untyped → untyped complex
    if (lt.kind === "untyped" && rt.kind === "untyped") return UNTYPED_COMPLEX;
    // Mixed: return complex128
    return COMPLEX128;
}
```

### Comparison operators

Only `==` and `!=` are allowed for complex:

```js
// In comparison handling:
if (CMP_OPS.has(op)) {
    if (isComplex(lt) || isComplex(rt)) {
        if (op !== "==" && op !== "!=") {
            this.err(`invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`, node);
            return ANY;
        }
    }
    return BOOL;
}
```

### Numeric-to-complex promotion in expressions

When `int` or `float64` is combined with `complex` via `+`, `-`, `*`, `/`, the result
is `complex`. This is handled by the updated `binaryResultType`. The codegen wraps the
real operand in `{ re: x, im: 0 }`.

---

## Phase 5 — CodeGen: runtime representation (~3-4h)

**Files:** `src/codegen.js`, `src/codegen/expressions.js`

### Runtime representation

```js
// complex128 value at runtime:
{ re: <number>, im: <number> }
```

### Tree-shaken helpers

Add to `src/codegen.js` preamble (emitted only when `_usesCmul` / `_usesCdiv` is set):

```js
function __cmul(a, b) {
    return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function __cdiv(a, b) {
    const d = b.re * b.re + b.im * b.im;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}
```

### `ImagLit` codegen

```js
case "ImagLit": {
    const v = expr.value;
    return `{ re: 0, im: ${v} }`;
}
```

### `complex(r, i)` codegen

```js
case "complex": {
    const r = this.genExpr(expr.args[0]);
    const i = this.genExpr(expr.args[1]);
    return `{ re: ${r}, im: ${i} }`;
}
```

### `real(z)` and `imag(z)` codegen

```js
case "real":
    return `${this.genExpr(expr.args[0])}.re`;

case "imag":
    return `${this.genExpr(expr.args[0])}.im`;
```

### Binary operators on complex

In `genExpr` for `BinaryExpr`, detect when either operand has a complex type and emit
helper calls or inline code:

```js
if (isComplex(expr._type) || isComplex(expr.left._type) || isComplex(expr.right._type)) {
    const l = this.genComplexOperand(expr.left);
    const r = this.genComplexOperand(expr.right);
    switch (expr.op) {
        case "+":
            return `{ re: ${l}.re + ${r}.re, im: ${l}.im + ${r}.im }`;
        case "-":
            return `{ re: ${l}.re - ${r}.re, im: ${l}.im - ${r}.im }`;
        case "*":
            this._usesCmul = true;
            return `__cmul(${l}, ${r})`;
        case "/":
            this._usesCdiv = true;
            return `__cdiv(${l}, ${r})`;
    }
}
```

### Promote real operand to complex

When one side of a binary op is real and the other complex, wrap the real operand:

```js
genComplexOperand(expr) {
    if (isComplex(expr._type)) return this.genExpr(expr);
    // Real value → complex with im: 0
    return `{ re: ${this.genExpr(expr)}, im: 0 }`;
}
```

### Comparison operators

```js
if (isComplex(expr.left._type) || isComplex(expr.right._type)) {
    const l = this.genComplexOperand(expr.left);
    const r = this.genComplexOperand(expr.right);
    if (expr.op === "==") return `(${l}.re === ${r}.re && ${l}.im === ${r}.im)`;
    if (expr.op === "!=") return `(${l}.re !== ${r}.re || ${l}.im !== ${r}.im)`;
}
```

### Zero value

Update `zeroValue()` for complex types:

```js
case "complex64":
case "complex128":
    return `{ re: 0, im: 0 }`;
```

---

## Phase 6 — `fmt.Sprintf` support (~1-2h)

**File:** `src/codegen/expressions.js` (sprintf helper)

### `%v` formatting

Go prints complex values as `(1+2i)`. Add a case to the `__sprintf` helper:

```js
// In __sprintf, when formatting a complex value:
if (typeof val === "object" && val !== null && "re" in val && "im" in val) {
    const sign = val.im >= 0 ? "+" : "";
    return `(${val.re}${sign}${val.im}i)`;
}
```

This handles `%v` and the default representation. `%f`, `%e`, `%g` on complex values
format each component separately (lower priority — defer to follow-up).

---

## Phase 7 — Type conversions (~1h)

**File:** `src/typechecker/expressions.js`, `src/codegen/expressions.js`

### `complex128(x)` and `complex64(x)` conversions

In the type checker, allow conversion from:
- `complex64` ↔ `complex128` (identity at runtime)
- `int` / `float64` → `complex128` / `complex64` (wrap as `{ re: x, im: 0 }`)

```js
// TypeChecker: TypeConversion where target is complex
if (isComplex(targetType)) {
    if (isComplex(sourceType) || isNumeric(sourceType)) return targetType;
    this.error(node, `cannot convert ${typeStr(sourceType)} to ${typeStr(targetType)}`);
    return targetType;
}
```

```js
// CodeGen: TypeConversion to complex
if (isComplex(targetType)) {
    if (isComplex(sourceType)) return this.genExpr(expr.expr); // identity
    return `{ re: ${this.genExpr(expr.expr)}, im: 0 }`;       // real → complex
}
```

### `float64(z)` where `z` is complex

Go does not allow this — you must use `real(z)`. The type checker should reject it:

```js
if (isNumeric(targetType) && isComplex(sourceType)) {
    this.error(node, `cannot convert ${typeStr(sourceType)} to ${typeStr(targetType)} (use real() or imag())`);
}
```

---

## Phase 8 — Compound assignment (~1h)

**File:** `src/codegen/statements.js`

Handle `+=`, `-=`, `*=`, `/=` on complex variables:

```go
z += 2i
z *= complex(0, 1)
```

```js
z = { re: z.re + 0, im: z.im + 2 };
z = __cmul(z, { re: 0, im: 1 });
```

In `genStmt` for `AssignStmt` with compound operators, check if the target is complex
and expand to full assignment with the appropriate complex operation.

---

## End-to-End Examples

### Basic usage

```go
package main

func main() {
    z := complex(3, 4)
    fmt.Println(real(z))   // 3
    fmt.Println(imag(z))   // 4
    fmt.Println(z)         // (3+4i)
}
```

Generated JavaScript:

```js
function main() {
    let z = { re: 3, im: 4 };
    console.log(z.re);     // 3
    console.log(z.im);     // 4
    console.log(`(${z.re}+${z.im}i)`);  // (3+4i)
}
```

### Arithmetic

```go
package main

func main() {
    a := complex(1, 2)
    b := complex(3, 4)
    sum := a + b
    prod := a * b
    fmt.Println(real(sum), imag(sum))   // 4 6
    fmt.Println(real(prod), imag(prod)) // -5 10
}
```

Generated JavaScript:

```js
function __cmul(a, b) {
    return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function main() {
    let a = { re: 1, im: 2 };
    let b = { re: 3, im: 4 };
    let sum = { re: a.re + b.re, im: a.im + b.im };
    let prod = __cmul(a, b);
    console.log(sum.re, sum.im);   // 4 6
    console.log(prod.re, prod.im); // -5 10
}
```

### Imaginary literals

```go
package main

func main() {
    z := 1 + 2i
    w := z * 3i
    fmt.Println(real(w), imag(w))  // -6 3
}
```

Generated JavaScript:

```js
function __cmul(a, b) {
    return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function main() {
    let z = { re: 1, im: 2 };
    let w = __cmul(z, { re: 0, im: 3 });
    console.log(w.re, w.im);  // -6 3
}
```

---

## Test File: `test/types/complex.test.js`

Register in `test/run.js`. Write tests in phase order.

### Phase 1 — Lexer

```js
test("lexer: 3i produces IMAG token")
test("lexer: 1.5i produces IMAG token")
test("lexer: 0i produces IMAG token")
test("lexer: 1_000i strips underscores")
test("lexer: semicolon inserted after imaginary literal")
```

### Phase 2–3 — Types and parsing

```js
test("complex128 is a valid type")
test("complex64 is a valid type")
test("imaginary literal has untyped complex type")
test("var z complex128 zero value")
```

### Phase 4 — Builtins

```js
test("complex(r, i) returns complex128")
test("real(z) returns float64")
test("imag(z) returns float64")
test("error: complex() with wrong number of args")
test("error: real() on non-complex type")
test("error: imag() on non-complex type")
test("error: complex() with non-numeric args")
```

### Phase 5 — Arithmetic and codegen

```js
test("complex addition")
test("complex subtraction")
test("complex multiplication")
test("complex division")
test("complex equality")
test("complex inequality")
test("error: complex less-than comparison")
test("error: complex modulo")
test("real + imaginary literal produces complex")
test("int * complex promotes int to complex")
```

### Phase 6 — Formatting

```js
test("fmt.Println prints complex as (a+bi)")
test("fmt.Sprintf %v formats complex")
```

### Phase 7 — Conversions

```js
test("complex128(intVal) wraps as complex")
test("complex64 to complex128 conversion")
test("error: float64(complexVal) rejected")
```

### Phase 8 — Compound assignment

```js
test("+= on complex variable")
test("*= on complex variable")
```

### End-to-end

```js
test("mandelbrot iteration compiles and runs")
test("complex conjugate function")
test("complex absolute value via real and imag")
```

---

## Risk Summary

| Risk | Mitigation |
|---|---|
| `3i` breaking existing code with variable `i` | Only triggers when digit immediately precedes `i` with no space; `3 * i` still parses as multiplication |
| Object allocation per complex value | Acceptable — complex arithmetic is not a hot path in frontend code; JS engines optimise short-lived objects |
| Inline `{ re: ..., im: ... }` objects are verbose | Tree-shaken `__cmul`/`__cdiv` keep output readable; add/sub are one-liners |
| `isNumeric()` used broadly — complex must not match | Keep `isComplex` separate from `isNumeric`; use `isComplexOrNumeric` explicitly where needed |
| Untyped int/float promotion to complex in mixed expressions | Match Go behaviour: `1 + 2i` is `complex(1, 2)` via `BinaryExpr`; codegen wraps real operand |
| Compound assignment expansion | Straightforward — expand `z += w` to `z = z + w` with complex codegen handling |
| Complex values in maps/slices | Work naturally — `{ re, im }` objects are valid map values and slice elements |

---

## V1 Scope

**In scope:**
- `complex128` and `complex64` type kinds in the type system
- Imaginary literals (`3i`, `1.5i`) as `IMAG` tokens → `ImagLit` AST nodes
- `complex(r, i)`, `real(z)`, `imag(z)` builtins
- Complex arithmetic: `+`, `-`, `*`, `/` with tree-shaken `__cmul`, `__cdiv` helpers
- Complex comparison: `==`, `!=` only
- Numeric-to-complex promotion in mixed expressions
- Type conversions: `complex128(x)`, `complex64(x)` from numeric types
- Untyped complex constants
- Zero value: `{ re: 0, im: 0 }`
- Basic `fmt.Println` / `%v` formatting as `(a+bi)`

**Out of scope (future):**
- `cmplx` standard library package (`cmplx.Abs`, `cmplx.Exp`, `cmplx.Sqrt`, etc.)
- Per-component `%f`, `%e`, `%g` formatting
- Complex constants in `const` blocks with arithmetic
- `complex64` ↔ `complex128` precision differences (both are float64 at runtime)
