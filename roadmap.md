# GoFront Roadmap

## Purpose

This document has two jobs:

1. Show how GoFront currently stacks up against Go language and feature-wise.
2. Turn that comparison into a practical roadmap for future work.

GoFront is not trying to be a byte-for-byte Go implementation. It is a Go-inspired
language for the JavaScript platform. That distinction matters when deciding what is
missing because of implementation scope versus what is structurally different because
the target runtime is JavaScript.

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
| Type assertions | Partial match | Plain assertions are effectively unchecked at runtime; comma-ok assertions emit runtime checks. |
| Generics | Missing but feasible | Not present in the compiler or type system today. Harder than most syntax features, but still conceptually feasible. |
| Reflection-oriented type metadata | Platform-limited | GoFront erases most types at runtime, so full Go-style reflection would require a very different runtime model. |

### Builtins and standard library shape

| Area | GoFront status | Notes |
|---|---|---|
| `len`, `cap`, `append`, `copy`, `make`, `delete`, `new` | Partial match | All are present, but some semantics are adapted to JS data structures. |
| `clear`, `min`, `max` | Partial match | Useful additions, not the main compatibility concern. |
| `error` type | Partial match | Lowered to plain strings, which is practical but much simpler than Go error values. |
| `fmt` package | Partial match | Built-in namespace with a small formatting surface, not full stdlib parity. |
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

The biggest missing pieces that still look feasible are generics, more complete type
system fidelity, stronger runtime checks for type assertions and interface values,
better array/pointer semantics, and a larger library surface.

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

### Phase 1: High-leverage parity wins

These items improve language credibility without requiring a major runtime redesign.

| Priority | Item | Why it matters | Difficulty | Platform risk |
|---|---|---|---|---|
| P1 | Generics | Biggest modern Go feature gap. Unlocks reusable containers and APIs. | High | Moderate |
| P1 | Stronger type assertion semantics | Current plain assertions are runtime-trusting. Tightening this reduces surprising behavior. | Medium | Low |
| P1 | Better interface method identity checks | Brings compile-time behavior closer to Go and reduces false positives. | Medium | Low |
| P1 | Clear compatibility documentation in README/docs | Low engineering cost, high user value. Makes divergence explicit. | Low | None |
| P1 | Expanded negative tests for semantic differences | Prevents accidental drift and makes future tradeoffs deliberate. | Low | None |

Recommended deliverables:

1. Add a generic type parameter model to parser, typechecker, and codegen.
2. Decide whether plain type assertions should panic on failure or be rejected unless runtime-checkable.
3. Tighten interface satisfaction rules to mirror Go method signatures more closely.
4. Add a documented compatibility section that points users to this roadmap.

### Phase 2: Better data model fidelity

These items make existing supported features behave more like Go.

| Priority | Item | Why it matters | Difficulty | Platform risk |
|---|---|---|---|---|
| P2 | More explicit array semantics | Arrays are currently too slice-like. This is a meaningful semantic gap. | Medium | Moderate |
| P2 | Better pointer model | Current pointer boxing works for some cases but is not a complete abstraction. | High | Moderate |
| P2 | More faithful map behavior where possible | Cannot fully match Go, but some edge-case handling can improve predictability. | Medium | High |
| P2 | Richer error values | Moving beyond raw strings would make `error` closer to Go usage patterns. | Medium | Low |
| P2 | Broader built-in package surface | Improves practical adoption even if it is shim-based rather than stdlib-complete. | Medium | Low |

Recommended deliverables:

1. Decide whether arrays remain a compatibility surface or become a distinct runtime abstraction.
2. Formalize pointer behavior rather than relying on transparent `&` and `*` lowering.
3. Introduce a GoFront-specific error object shape if richer errors become necessary.
4. Prioritize a small set of high-value packages instead of chasing broad stdlib parity.

### Phase 3: Controlled runtime expansion

These items are possible only if GoFront is willing to carry a stronger runtime story.

| Priority | Item | Why it matters | Difficulty | Platform risk |
|---|---|---|---|---|
| P3 | Reduced reflection support | Some libraries and patterns need runtime type information. | High | High |
| P3 | Runtime interface metadata | Makes assertions and type switches more principled. | High | High |
| P3 | Optional richer runtime helpers | Could enable better semantics at cost of output simplicity. | High | Moderate |

Recommended deliverables:

1. Decide whether GoFront remains a minimal-runtime compiler or evolves into a language with a lightweight runtime library.
2. If yes, define a minimal metadata format for structs, interfaces, and asserted values.
3. Keep runtime additions opt-in when possible to preserve readable output for simple programs.

### Phase 4: Platform-limited experiments

These should be treated as research work, not commitments.

| Priority | Item | Why it matters | Difficulty | Platform risk |
|---|---|---|---|---|
| P4 | Channel-like abstraction | Could offer Go-inspired coordination patterns for async JS code. | Very high | Very high |
| P4 | `select`-like async multiplexing | Useful in theory, but will not behave like native Go `select`. | Very high | Very high |
| P4 | Worker-backed concurrency model | Might create a Go-like story for some apps, but only with strong restrictions. | Very high | Very high |

These items are worth exploring only if the project explicitly accepts that the result
will be Go-inspired, not Go-equivalent.

## Suggested Order of Work

1. Generics.
2. Type assertion and interface semantics.
3. Documentation of semantic differences and guarantees.
4. Array and pointer model improvements.
5. Richer error and library surface.
6. Optional runtime metadata.
7. Any channel/select experiment only after the language model above is stable.

## Non-Goals Unless Project Direction Changes

The following should be treated as non-goals unless GoFront deliberately becomes a
much heavier runtime system:

1. Exact goroutine scheduling semantics.
2. Native channel behavior identical to Go.
3. Exact integer overflow and full 64-bit integer behavior on plain JS numbers.
4. `unsafe`-style memory access.
5. `cgo`.
6. Full Go reflection parity without runtime type metadata.

## Recommended Next Milestone

If the goal is maximum value for minimum complexity, the next milestone should be:

1. Ship generics.
2. Tighten type assertion behavior.
3. Tighten interface satisfaction rules.
4. Publish a formal compatibility guide that explicitly lists semantic differences.

That milestone would significantly improve the answer to the question, "How much of Go
can I actually rely on here?" without forcing GoFront into a heavy runtime or a fake
concurrency model.