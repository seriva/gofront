# GoFront Roadmap

## Purpose

This document has two jobs:

1. Show how GoFront currently stacks up against Go language and feature-wise.
2. Turn that comparison into a practical roadmap for future work.

GoFront is not trying to be a byte-for-byte Go implementation. It is a Go-inspired
language for the JavaScript platform. That distinction matters when deciding what is
missing because of implementation scope versus what is structurally different because
the target runtime is JavaScript.

This document is compared against the [Go Language Specification](https://go.dev/ref/spec)
(go1.26, January 2026).

## Status Key

| Status | Meaning |
|---|---|
| Strong match | Close to normal Go usage, with only minor lowering differences |
| Partial match | Supported, but semantics differ in important ways |
| Missing but feasible | Not implemented yet, but plausibly addable without breaking the platform model |
| Platform-limited | Could be approximated, but cannot fully match Go on JavaScript |
| Out of scope | Would require a very different runtime or product direction |

## Feature Matrix

### Core language and syntax

| Area | GoFront status | Notes |
|---|---|---|
| Package declarations | Strong match | Standard package syntax is supported. Directory-based compilation works like a single package unit. |
| Multi-file packages | Strong match | All `.go` files in a directory compile together, with shared package scope. |
| Imports | Partial match | Supports local GoFront packages, npm packages, and `js:` declaration imports. This is intentionally broader than Go, but not the same import ecosystem. |
| Semicolon insertion | Strong match | Mirrors Go-style automatic semicolon insertion. |
| Functions | Strong match | Named functions, closures, variadics, multiple returns, and named returns are all supported. |
| Methods | Strong match | Methods compile cleanly to instance methods on generated ES classes. |
| `init()` | Strong match | Multiple `init()` functions are supported and invoked before `main()`. |
| Short declarations `:=` | Strong match | Includes Go-style re-declaration rules. |
| `if` / `else` | Strong match | Includes `if init; cond {}` form. |
| `for` loops | Strong match | Supports classic, condition-only, infinite, and range-based loops. |
| Integer `range` | Partial match | Supports Go 1.22-style integer range, lowered to a C-style JS loop. |
| `switch` / `case` / `default` | Strong match | Basic value switches map well to JS `switch`. |
| `fallthrough` | Partial match | Supported for normal switches, but type-switch fallthrough is rejected to match Go rules. |
| Labeled statements | Strong match | Labeled `break` and `continue` are implemented and validated. |
| `defer` | Partial match | Implemented via try/catch/finally and a defer stack. Good behavior for most cases, but not identical to Go runtime internals. |
| `panic` / `recover` | Partial match | Usable and tested, but lowered to JS exceptions with a compiler-managed panic slot. |
| Type switches | Partial match | Supported, but based on JS `typeof`, `instanceof`, and null checks rather than Go runtime type descriptors. |
| Rune literals | Strong match | Single-quoted character constants with escape sequences compile to integer code point values. |
| Raw string literals | Strong match | Backtick-delimited raw strings are supported. |
| Blank identifier `_` | Strong match | Usable in declarations, assignments, range loops, and imports. |
| Multiple assignment | Strong match | Tuple swaps (`a, b = b, a`) and multi-value assignment are supported. |
| Compound assignment ops | Strong match | All compound assignment operators (`+=`, `-=`, `<<=`, etc.) are supported. |
| Grouped declarations | Partial match | `var (...)` and `const (...)` with iota are supported. Grouped `type (...)` is not yet supported. |
| Slice expressions | Partial match | Simple (`a[low:high]`) and three-index (`a[low:high:max]`) syntax is parsed. The `max` capacity bound is accepted but ignored at runtime. |
| String indexing / slicing | Partial match | `s[i]` and `s[low:high]` work, but `s[i]` returns a JS character rather than a Go byte value. |
| Named / blank imports | Strong match | Import aliases (`import m "pkg"`), dot imports (`import . "pkg"`), and blank imports (`import _ "pkg"`) are supported. |
| `goto` | Missing but feasible | Not implemented. Low priority since `goto` has no JS equivalent and is rare in modern Go code. |
| Method expressions | Missing but feasible | `T.Method` as a standalone function with an explicit receiver parameter is not supported. |
| Method values | Partial match | `x.Method` resolves as a JS property reference but does not replicate Go's automatic receiver binding. |
| Range over iterator functions | Missing but feasible | Go 1.23 range-over-func (`func(yield func(K, V) bool)`) protocol is not implemented. |
| `go` statement | Platform-limited | Explicitly rejected today. True goroutine semantics do not map cleanly to JS. |
| `select` | Platform-limited | Explicitly rejected today because channels do not exist. |
| `chan` types | Platform-limited | Explicitly rejected today. Any future support would be an approximation, not Go-equivalent semantics. |

### Type system

| Area | GoFront status | Notes |
|---|---|---|
| Basic types (`int`, `float64`, `string`, `bool`) | Strong match | Core user-facing behavior is close, subject to JS runtime limitations. |
| Sized integer aliases | Partial match | Accepted by the typechecker, but all collapse to JS `number` at runtime. |
| `float32` | Partial match | Accepted, but runtime is still JS `number`, not IEEE 754 single precision storage. |
| `byte` / `rune` | Partial match | Treated as integer-like types. Useful, but runtime identity is still JS numeric/string machinery. |
| Arrays | Partial match | Parsed, but fixed arrays are effectively treated like JS arrays/slices rather than distinct Go array values. |
| Slices | Partial match | Operationally good, but JS arrays do not have Go's distinct length/capacity/runtime behavior. |
| Maps | Partial match | Implemented as plain JS objects. Works for many cases, but key behavior and iteration semantics differ from Go maps. |
| Structs | Strong match | One of the strongest areas of the language. |
| Embedded structs | Partial match | Supported through flattening and delegation stubs rather than true Go field/method promotion machinery. |
| Interfaces | Partial match | Enforced at compile time, erased at runtime. No real Go interface value representation is emitted. |
| Interface embedding | Partial match | Embedded interface methods are flattened during type checking. |
| Type aliases | Strong match | Aliases work as transparent type-checker aliases. |
| Pointers | Partial match | `new(T)` returns `{ value: T }`, pointer receivers work, but this is not full Go pointer semantics. |
| Address-of / dereference | Partial match | Syntax is accepted, but lowering is effectively transparent in JS rather than true memory indirection. |
| Type assertions | Strong match | Compile-time: source must be interface or `any`. Plain assertions panic on mismatch. Comma-ok returns zero value on failure. Runtime checks use `typeof`/`instanceof`. |
| Complex types | Missing but feasible | `complex64`, `complex128`, imaginary literals (`3i`), and builtins (`complex`, `real`, `imag`) are not implemented. Could be shimmed with a two-field object. |
| Struct tags | Partial match | Parsed and accepted syntactically, but tag values are silently discarded. Not available at compile time or runtime. |
| Exported/unexported access control | Partial match | Uppercase names are exported across packages via `getExportedSymbols`. However, importing a lowercase name from another package does not produce an error. |
| Generics | Missing but feasible | Not present in the compiler or type system today. Harder than most syntax features, but still conceptually feasible. |
| Generic aliases | Missing but feasible | Go 1.24 parameterized type aliases are not supported. Depends on generics being implemented first. |
| Reflection-oriented type metadata | Platform-limited | GoFront erases most types at runtime, so full Go-style reflection would require a very different runtime model. |

### Builtins and standard library shape

| Area | GoFront status | Notes |
|---|---|---|
| `len`, `cap`, `append`, `copy`, `make`, `delete`, `new` | Partial match | All are present, but some semantics are adapted to JS data structures. |
| `clear`, `min`, `max` | Partial match | Useful additions, not the main compatibility concern. |
| `error` type | Partial match | Lowered to plain strings, which is practical but much simpler than Go error values. |
| `fmt` package | Partial match | Built-in namespace with a small formatting surface, not full stdlib parity. |
| `print`, `println` | Strong match | Supported as builtins and compiled to `console.log`. |
| `complex`, `real`, `imag` | Missing but feasible | Not implemented. Depends on complex type support being added first. |
| `close` | Platform-limited | Not implemented. Depends on channel support which is out of scope. |
| Broader stdlib parity | Missing but feasible | Many packages could be shimmed or bridged to JS libraries, but this is product scope, not just parser work. |
| `unsafe` | Out of scope | JavaScript offers no equivalent memory model. |
| `reflect` | Platform-limited | Possible only in a heavily reduced, GoFront-specific form unless runtime type metadata is added. |
| `cgo` | Out of scope | Not meaningful in the browser/plain JS target model. |

### Runtime and semantic differences

| Area | GoFront status | Notes |
|---|---|---|
| Integer overflow | Platform-limited | Go integer overflow rules do not survive lowering to JS `number`. |
| Integer precision | Platform-limited | Values above JS safe integer range cannot behave like Go integers. |
| Division behavior | Partial match | Integer division is lowered with `Math.trunc`, which gets close for many cases. |
| Map iteration order | Platform-limited | Go randomizes map iteration; JS object iteration is insertion-ordered. |
| Slice capacity | Platform-limited | `cap()` returns length because JS arrays do not expose Go capacity. |
| Nil/null | Partial match | `nil` maps to `null`, which is practical but not a full reproduction of Go's typed nil edge cases. |
| Error propagation | Partial match | Panic/recover uses JS exceptions, not Go stack unwinding internals. |
| Type erasure | Platform-limited | Compile-time types mostly disappear in the generated JS. |

### JavaScript and frontend-specific extensions

| Area | GoFront status | Notes |
|---|---|---|
| `async func` / `await` | Intentional divergence | Useful for frontend work, but not part of Go itself. |
| Browser globals | Intentional divergence | Predeclared as `any` for practical frontend use. |
| `.d.ts` imports | Intentional divergence | Excellent for JS interop, but this is GoFront-specific rather than Go-compatible. |
| npm package resolution | Intentional divergence | A platform advantage, not a Go parity feature. |

## Bottom-Line Comparison

### What already matches well

GoFront already covers a useful Go-like core: package-level compilation, structs,
methods, closures, multiple returns, named returns, range loops, switches, iota,
defer/recover, and enough type checking to make application code feel disciplined.
For frontend-oriented code, this is already a strong subset.

### What is mainly an implementation gap

The biggest missing pieces that still look feasible are generics, range-over-func
iterators (Go 1.23), complex number types, more complete type system fidelity,
stronger runtime checks for type assertions and interface values, better
array/pointer semantics, and a larger library surface.

### What is mostly blocked by the platform

The hardest mismatches are goroutines, channels, select, exact integer behavior,
map semantics, raw pointers, reflection, and anything depending on Go's runtime
type descriptors or scheduler. These can be approximated, but not faithfully cloned
on plain JavaScript.

## Roadmap Principles

1. Prefer features that improve day-to-day language ergonomics without requiring a heavy runtime.
2. Preserve readable generated JavaScript.
3. Avoid introducing partial support that looks like Go but behaves dangerously differently without clear rules.
4. Keep platform-limited areas explicit so users know where GoFront intentionally diverges.

## Implementation Roadmap

### Easy implementation wins to close gaps

These are the items that improve the Go story the most without pulling GoFront toward
a real runtime system.

| Item | Why it matters | Difficulty | Notes |
|---|---|---|---|
| Compatibility guide in docs | Makes it obvious where GoFront matches Go and where it intentionally diverges. | Low | Done. The README now has a "Go Compatibility" section covering what matches, extensions, missing features, and semantic differences. |
| Expanded semantic-difference tests | Locks in current behavior and prevents accidental regressions. | Low | Done. Tests added for: string `len()` on multi-byte chars, `range` over multi-byte strings, `[n]T` as plain arrays, unchecked plain type assertions, comma-ok assertion semantics, and unexported cross-package access. |
| Stronger interface method checks | Closes compile-time gaps without changing the JS runtime model. | Medium | Done. `implements()` now checks full method signatures: parameter types, parameter count, variadic flags, and all return types. Interface method declarations also preserve the variadic flag. |
| Stronger type assertion rules | Reduces trust-me behavior in plain assertions. | Medium | Done. Type assertions now require the source to be an interface or `any` (compile-time check). Plain assertions panic on mismatch and comma-ok returns zero value on failure (runtime checks), matching Go behavior. |
| Focused built-in/stdlib shims | Improves real-world usability without chasing full stdlib parity. | Medium | Best handled as a curated set of packages, not a full clone of Go's stdlib. |

Recommended order:

1. Publish a compatibility section in the docs.
2. Add tests that explicitly encode current semantic differences.
3. Tighten interface satisfaction checks.
4. Tighten type assertion behavior.
5. Add a few high-value library shims only where they fit the JS platform naturally.

### Hard things we might still do

These are real gaps, but they are harder because they either require non-trivial type
system work or start pushing against the no-runtime direction.

| Item | Why it matters | Difficulty | Runtime pressure |
|---|---|---|---|
| Generics | Biggest modern Go feature gap and the most visible missing language feature. | High | Low to moderate |
| Range over iterator functions | Go 1.23 feature. Would enable idiomatic iterator patterns and align with modern Go code. | Medium | Low |
| Complex number types | Completes numeric type coverage. Conceptually straightforward but requires new type kinds, builtins, and codegen. | Medium | Low |
| Better array semantics | Arrays are currently too close to slices. | Medium | Moderate |
| Better pointer model | Current pointer boxing is useful but shallow. | High | Moderate |
| Richer error values | Would make error handling feel more Go-like than plain strings. | Medium | Moderate |
| Grouped `type (...)` declarations | Minor parser gap. Would complete parity for declaration grouping syntax. | Low | None |
| Reduced runtime metadata for interfaces/assertions | Would improve type assertions and type switches. | High | High |
| Reduced reflection support | Useful for some patterns, but only if GoFront accepts a small runtime metadata story. | High | High |

Guidance:

1. Generics are the best hard feature to pursue because they improve parity without forcing concurrency or reflection work.
2. Array and pointer work should be done only if the team is willing to define a GoFront-specific model rather than pretend JS has Go memory semantics.
3. Runtime metadata should be treated as a line-crossing decision, not as a casual compiler enhancement.

### Things we do not want to do

These are the items that either conflict directly with the no-runtime goal or would
still fail to match Go faithfully on JavaScript even after substantial work.

| Item | Why we do not want it |
|---|---|
| True goroutine semantics | Would require a scheduler/runtime model that plain JS does not provide. |
| Native Go-style channels | Any implementation would be an approximation with different blocking and ownership semantics. |
| Real `select` semantics | Depends on real channels and scheduler behavior that JS does not have. |
| Exact integer overflow and full 64-bit integer behavior on plain JS numbers | Conflicts with the target runtime's numeric model. |
| `unsafe`-style memory access | JavaScript has no compatible memory model. |
| `cgo` | Outside the browser/plain JS execution model. |
| Full Go reflection parity | Conflicts with the current type-erasure and no-runtime design. |
| Pretending maps can exactly behave like Go maps | JS object semantics are fundamentally different, especially for ordering and keys. |

Practical rule:

If a feature needs a scheduler, real runtime type descriptors, raw memory access, or
non-JS numeric guarantees, it is probably outside the design target for GoFront.

## Suggested Order of Work

1. Docs and compatibility notes.
2. More semantic-difference tests.
3. Interface and type assertion tightening.
4. Generics.
5. Only after that: array, pointer, and richer error-model work.
6. Avoid runtime-metadata work unless the project explicitly changes its philosophy.

## Recommended Next Milestone

If the goal is to close the most important gaps while staying aligned with the current
project direction, the next milestone should be:

1. Document what GoFront intentionally does not try to match.
2. Tighten interface and type assertion behavior.
3. Add tests around the known semantic differences.
4. Start design work for generics.

That keeps the language honest about its limits, improves the safety story, and closes
real gaps without drifting into a runtime-heavy implementation strategy.