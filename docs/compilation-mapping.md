# Go to JavaScript Mapping

Every Go construct compiles to a specific JavaScript pattern. The output is designed to be
readable and debuggable — no name mangling, no opaque wrappers. This page describes the
`js` target; `wasm` packages are covered in the [hybrid guide](hybrid-wasm.md).

### Data structures

| Go | JavaScript | Notes |
|---|---|---|
| `struct` | ES6 `class` | Positional constructor with zero-value defaults: `new Point(1, 2)`; a generated `__clone()` gives struct values Go copy semantics on assignment, call, return, `append`, and `range` |
| Methods | Class instance methods | Receiver is `this` (typed `*T` for pointer receivers) |
| Embedded structs | Flattened fields + delegation stubs | `Greet(...a) { return Base.prototype.Greet.call(this, ...a); }` |
| `[]T` (slice) | `Array` | `append` → `__append`, `len` → `__len` (both tree-shaken helpers). `b[i:j]` and `b[i:j:k]` → `__slice`: a `Proxy` view over the operand's array (offset, length, capacity) unless the result covers the whole array; `x = x[i:j]` within `len(x)` copies (`__reslice`); `make([]T, n, cap)` → `__mkslice` |
| `[]float32`, `[]int8`…`[]int32`, `[]uint8`/`[]byte`…`[]uint32`, `[]rune` | TypedArray (`Float32Array`, `Int32Array`, `Uint8Array`, …) | `[]float64` and `[]int` stay plain `Array`; slicing → `.subarray` (through `__slice`, which keeps a capacity beyond the length in a `WeakMap`), `copy` → `.set` |
| `simd.F32x4` | Frozen 4-element `Array` | Each lane rounded with `Math.fround`; operations go through tree-shaken `__simd_*` helpers |
| `[N]T` (array) | `Array` | Copied with `.slice()` on assignment so arrays keep value semantics; bounds and size checked at compile time |
| `map[K]V` | Plain object `{}` | Key access via `[]`, iteration via `Object.entries()` |
| `nil` | `null` | `== nil` compiles to loose `== null` so JS `undefined` also counts as nil |
| `error` | `__error` object | `error("msg")` → `__error("msg")`, `.Error()` → real method call. `toString()` for string context compat |
| `*T` where `T` is a struct | The struct object itself | `&s` and `*p` are no-ops; struct instances are already references |
| Named non-struct type with methods (`type Celsius float64`) | The underlying JS value | Methods compile to static class methods called with the receiver: `c.F()` → `Celsius.$F(c)`; pointer receivers get the `{ value }` box. Only when stored in an interface is the value boxed (`new Celsius(c)`, or `new Celsius$Ptr(p)` for `*T`) so dynamic calls, type assertions and `==` work. A named basic type without methods (`type Name string`) is boxed in an interface the same way, so `any(Name("x")).(string)` fails as in Go |
| `*T` where `T` is a scalar | `{ value: T }` box | `&x` boxes the variable, every read/write of `x` goes through `.value`; `new(T)` allocates a boxed zero value |

### Functions

| Go | JavaScript |
|---|---|
| `func f(a int) int` | `function f(a)` |
| Multiple returns `return a, b` | `return [a, b]` — destructured at call site: `let [a, b] = f()` |
| `.d.ts` tuple return `[A, B]` | Treated as a Go multi-value result: `a, b := useState(0)` → `let [a, b] = useState(0)` |
| Named returns | Variables pre-declared; bare `return` returns them |
| Variadic `func f(xs ...int)` | `function f(...xs)` |
| `func` literal (closure) | Arrow or function expression |
| `async func` / `await` | `async function` / `await` |
| `init()` | Emitted as `(function() { ... })()` immediately-invoked |
| `defer` | `try { ... } finally { deferred() }` |

### Control flow

| Go | JavaScript |
|---|---|
| `for init; cond; post {}` | `for (init; cond; post) {}` |
| `for cond {}` | `while (cond) {}` |
| `for {}` | `while (true) {}` |
| `for i, v := range slice` | `for (let __i0 = 0, __arr0 = s, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) { let i = __i0, v = __arr0[__i0]; … }` — no iterator allocation, nil-safe |
| `for k, v := range map` | `for (const [k, v] of Object.entries(m))`; single-variable form uses `Object.keys(m)` |
| `for i, r := range str` | `for (const [i, r] of Array.from(s, (c, i) => [i, c.codePointAt(0)]))` — `r` is a rune integer |
| `for i := range n` | `for (let i = 0; i < n; i++)` |
| `for v := range iterFunc` | Calls `iterFunc` with a generated `yield` closure; `break`/`return` propagate through its return value |
| `switch` / `fallthrough` | `switch` / case fall-through |
| `switch v := x.(type)` | `if/else if` with `typeof` / `instanceof` checks |
| `panic(msg)` | `throw new Error(msg)` |
| `recover()` | Captured in `defer` via `try/catch` |

### Builtins

| Go | JavaScript |
|---|---|
| `len(x)` | `__len(x)` (tree-shaken helper; `.length` for arrays/TypedArrays, `Object.keys().length` for maps); constant for fixed arrays |
| `cap(x)` | `__cap(x)` — a view's capacity, otherwise the length |
| `append(s, elems...)` | `__append(s, ...elems)` — nil-safe, preserves TypedArray type |
| `copy(dst, src)` | Inline helper: `.set` for TypedArrays, `splice` otherwise; returns the count |
| `make([]T, n)` | `new Array(n).fill(zero)`, or `new Float32Array(n)` etc. for sized numeric element types |
| `make(map[K]V)` | `{}` |
| `delete(m, k)` | `delete m[k]` |
| `new(T)` | `new T()` for structs, `{ value: zeroOf(T) }` for scalars |
| `min` / `max` | `Math.min` / `Math.max`; strings fold with `<` / `>` |
| `clear(x)` | `.length = 0` (slice) or delete-loop (map) |
| `print` / `println` | `console.log` |
| `complex(r, i)` | `{ re: r, im: i }` |
| `real(z)` / `imag(z)` | `z.re` / `z.im` |
| `fmt.Sprintf` | `__sprintf` tree-shaken helper |
| `json.Marshal(v)` / `json.Unmarshal(b, &v)` | `__json_marshal(__json_enc_T, v)` / `__json_unmarshal(__json_dec_T, b, v)` — one encoder/decoder function generated per type from its `json` struct tags; `MarshalJSON`/`UnmarshalJSON` methods are called directly |

### Type system at runtime

All type checking happens at compile time. At runtime, types are erased — there are no
type tags, no reflection, no runtime overhead. In `js` packages, sized integers (`int8`–`int64`,
`uint8`–`uint64`) and `float32` map to JavaScript `number`. Generic type
parameters are erased completely — `func Map[T, U any](...)` compiles to `function Map(...)`.
The type checker enforces correctness; JavaScript doesn't need to know. *(In `wasm` and `both`
packages, strict Go numeric semantics apply: true 64-bit integers, sized wrapping, and `float32` precision).*

---

