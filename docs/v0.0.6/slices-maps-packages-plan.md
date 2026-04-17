# slices / maps Packages — Design Plan

## Goal

Go 1.21 introduced the `slices` and `maps` standard library packages as the idiomatic
replacement for hand-rolled collection helpers. They are now the first thing Go
developers reach for — not having them makes GoFront feel dated. Both map cleanly to
JS array and object methods with zero runtime overhead.

## Approach

Both are built-in namespace shims, identical in structure to `strings` or `math`.

---

## slices package

| Go | JS output |
|---|---|
| `slices.Contains(s, v)` | `s.includes(v)` (primitives) / `s.some(x => __equal(x, v))` (structs) |
| `slices.Index(s, v)` | `s.indexOf(v)` / `s.findIndex(x => __equal(x, v))` |
| `slices.Equal(a, b)` | `__equal(a, b)` |
| `slices.Compare(a, b)` | Inline 3-way compare loop |
| `slices.Sort(s)` | `s.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)` |
| `slices.SortFunc(s, cmp)` | `s.sort(cmp)` |
| `slices.SortStableFunc(s, cmp)` | `s.toSorted(cmp)` (or stable sort polyfill) |
| `slices.IsSorted(s)` | Inline forward-scan loop |
| `slices.IsSortedFunc(s, cmp)` | Inline forward-scan loop with `cmp` |
| `slices.Reverse(s)` | `s.reverse()` |
| `slices.Max(s)` | `Math.max(...s)` |
| `slices.Min(s)` | `Math.min(...s)` |
| `slices.Clone(s)` | `s.slice()` |
| `slices.Compact(s)` | Inline dedup loop |
| `slices.CompactFunc(s, eq)` | Inline dedup loop with `eq` |
| `slices.Concat(ss...)` | `[].concat(...ss)` |
| `slices.Delete(s, i, j)` | `[...s.slice(0, i), ...s.slice(j)]` |
| `slices.Insert(s, i, vs...)` | `[...s.slice(0, i), ...vs, ...s.slice(i)]` |
| `slices.Replace(s, i, j, vs...)` | `[...s.slice(0, i), ...vs, ...s.slice(j)]` |
| `slices.Grow(s, n)` | `s` (no-op — JS arrays have no separate capacity) |
| `slices.Clip(s)` | `s.slice()` (no-op equivalent) |
| `slices.Contains` on struct slices | Uses `__equal` helper for deep comparison |

### Type checker note

`slices.Sort` requires the element type to be `ordered` (comparable with `<`).
In GoFront, this means `int`, `float64`, `string` — emit a type error for struct slices.
`slices.SortFunc` accepts any element type.

---

## maps package

| Go | JS output |
|---|---|
| `maps.Keys(m)` | `Object.keys(m)` |
| `maps.Values(m)` | `Object.values(m)` |
| `maps.Clone(m)` | `{ ...m }` |
| `maps.Copy(dst, src)` | `Object.assign(dst, src)` |
| `maps.Delete(m, keys...)` | Inline delete loop |
| `maps.Equal(m1, m2)` | `__equal(m1, m2)` |
| `maps.EqualFunc(m1, m2, eq)` | Inline key-by-key comparison with `eq` |
| `maps.Collect(seq)` | Inline loop consuming iterator (depends on range-iter) |

### Type checker note

`maps.Keys` returns `[]K` and `maps.Values` returns `[]V` — the element types are
inferred from the map type's key/value type parameters.

---

## Edge cases

- **`slices.Contains` on structs**: primitives can use `Array.includes`; structs need
  `__equal`. The typechecker knows the element type; codegen chooses the right form.
- **`slices.Sort` in-place**: JS `Array.sort` mutates in place — matches Go semantics.
- **`slices.SortStableFunc`**: JS `Array.toSorted` is ES2023. Fall back to a manual
  stable sort for older targets.
- **`maps.Keys` return order**: Go spec says the order is unspecified; JS `Object.keys`
  returns insertion order. This is already documented as a semantic difference.

## Affected files

| File | Change |
|---|---|
| `src/typechecker.js` | Add `slices` and `maps` namespaces with member types |
| `src/codegen/expressions.js` | Emit inline JS for each call |
| `test/builtins/stdlib.test.js` | New sections for slices and maps |
