# ANY error cascade suppression — v1.0.1

## Goal

When a name lookup fails (undefined variable, unresolved import, etc.) the typechecker
currently returns `ANY` and continues. Subsequent operations on that `ANY` value then
trigger further type errors — cascading noise that obscures the root cause.

Example: one undefined variable `x` in `x.Foo()` produces:
1. `undefined: x` (root cause)
2. `cannot call non-function type any` (cascade)
3. `cannot assign any to string` (cascade)

Goal: surface only the root error; suppress errors whose sole cause is propagating `ANY`
returned from a prior failure.

## Approach

### "Tainted ANY" flag

Introduce a lightweight marker on the `ANY` type object returned from error-recovery
paths. No new type kind; just a property:

```js
// src/typechecker/types.js
export const ANY = { kind: "basic", name: "any" };
export const TAINTED_ANY = { kind: "basic", name: "any", _tainted: true };
```

Return `TAINTED_ANY` (not `ANY`) from:
- Failed identifier lookup (`undefined: X`)
- Failed selector on unknown type (`X.Foo` where X unresolved)
- Failed call on tainted value
- Any expression that propagates a tainted operand

### Suppression rule

In `_checkExpr` and `checkCall`, before emitting an error, check:
```js
if (operandType?._tainted) return TAINTED_ANY; // suppress, propagate taint
```

Taint propagates through: binary ops, calls, selectors, index expressions, composite
literals. Does NOT propagate through: explicit `any` type annotations (user-declared
`var x any` returns plain `ANY`, not tainted).

### Guard: don't suppress root errors

Root errors (the first error in a chain) are always emitted. Only errors where ALL
operands are tainted are suppressed.

```js
// Emit error if at least one operand is NOT tainted:
const hasFreshError = args.some(a => !a?._tainted);
if (hasFreshError) this.err("cannot use ...", node);
else return TAINTED_ANY;
```

## Edge cases

- **User-declared `any`** — `var x any` should NOT suppress downstream. `ANY` (not
  `TAINTED_ANY`) returned for declared-any variables. Taint only from error paths.
- **Multi-file packages** — taint doesn't cross file boundaries; each file re-checks
  from its own scope. No change needed.
- **Existing tests** — some tests assert `errors.length === 1`; if those programs
  previously produced cascade errors that are now suppressed, tests would wrongly pass
  fewer errors. Audit after implementation; adjust assertions to match new (correct)
  behaviour.
- **`implements()` errors** — interface satisfaction errors are leaf errors (not
  downstream of a tainted value); should always emit regardless of taint.

## JS output examples

No output change. Error reporting only.

## Sentrux rules update

`TAINTED_ANY` lives in `src/typechecker/types.js` (layer 6, types). Used from
typechecker sub-modules (layer 3). Import direction types → typechecker is legal
(lower-order imports higher-order). No `rules.toml` change needed.

Run `sentrux gate --save` after if quality signal improves (fewer reported errors
reduces hotspot pressure on typechecker files).

## Test plan

1. Add positive test: single undefined var in complex expression produces exactly 1
   error (not 3+).
2. Add test: `var x any; x.Foo()` — user-declared any, should still warn (or not,
   depending on policy — document decision).
3. `npm run test:unit` — all existing tests pass; adjust any that over-counted cascade
   errors.
4. `npm run check` — clean.
