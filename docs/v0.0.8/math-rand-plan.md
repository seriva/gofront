# Plan: `math/rand` package

## Goal

Add a `math/rand` shim that covers the most commonly used functions from Go's `math/rand`
package. All functions delegate to `Math.random()` — no seeding is needed since JS has
no seedable `Math.random`. `rand.Seed` is accepted as a no-op for source compatibility.

## Scope

| Function | JS translation |
|---|---|
| `rand.Intn(n)` | `Math.floor(Math.random() * n)` |
| `rand.Float64()` | `Math.random()` |
| `rand.Float32()` | `Math.random()` |
| `rand.Int()` | `Math.floor(Math.random() * 2147483647)` |
| `rand.Int63()` | `Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)` |
| `rand.Int63n(n)` | `Math.floor(Math.random() * n)` |
| `rand.Int31()` | `Math.floor(Math.random() * 2147483647)` |
| `rand.Int31n(n)` | `Math.floor(Math.random() * n)` |
| `rand.Seed(n)` | `/* no-op */` |
| `rand.Shuffle(n, swap)` | Fisher-Yates via `Math.random()` |
| `rand.Perm(n)` | Fisher-Yates returning `[0..n-1]` permutation |

## Approach

**TypeChecker** — add a `math/rand` namespace (keyed as `"rand"` in the import map,
since GoFront maps `import "math/rand"` to the `rand` local name automatically) with the
function signatures above. `rand.Seed` returns `void`.

**CodeGen** — add a `case "rand":` branch in `_genStdlibCall` that delegates to a new
`_genRand(fn, a)` method.

No new lexer or parser changes needed — `math/rand` is already a valid import path.

## Edge cases

- `rand.Shuffle` takes `(n int, swap func(i, j int))` — generate the inline Fisher-Yates
  loop calling the swap function.
- `rand.Perm` returns `[]int` — emit an inline array-build loop.
- `rand.Seed` must be accepted by the type checker (no-op at runtime) so existing Go code
  that seeds a global source compiles unchanged.

## JS output examples

```go
// Go
x := rand.Intn(10)
rand.Shuffle(len(s), func(i, j int) { s[i], s[j] = s[j], s[i] })
p := rand.Perm(5)
```

```js
// JS
let x = Math.floor(Math.random() * 10);
((n, f) => { for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); f(i, j); } })(s.length, (i, j) => { [s[i], s[j]] = [s[j], s[i]]; });
let p = ((n) => { const a = Array.from({length: n}, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; })(5);
```

## Semantic differences

- `rand.Seed` is a no-op — JS provides no seedable RNG in standard environments.
- All integer results are float64 under the hood (JS number limitation).
