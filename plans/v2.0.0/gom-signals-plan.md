# `gom` Signals — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Split out of the former `web-platform-evolution-plan.md` (its Phase 8) on 2026-11-17, re-checked that day. Starts after [`typed-web-platform-plan.md`](typed-web-platform-plan.md) Phase 4, which migrates `stdlib/gom/gom.go` to the typed globals. Independent of the checker, `wasm` and value-store plans.  
**Release note:** `.templ` text and attributes bound to a `gom.Signal` update in place when the signal changes, without re-rendering the page or diffing a virtual DOM.  

---

## Goal

Add `gom.Signal[T]` and `gom.Computed[T]` and make `.templ` text and attribute expressions that read them update their DOM node surgically on `.Set()`, with effects owned by their mount root and disposed when the root is mounted again. No virtual DOM, no diffing, no runtime scheduler: synchronous publisher-subscriber closures in client JavaScript.

**Done means:**
- `.templ` text and attribute expressions that read a `gom.Signal` update their DOM node on `.Set()` without remounting (`test/unit/builtins/gom-signals.test.js`, `test/unit/compiler/templ-reactive-text.test.js`, `test/unit/compiler/templ-reactive-attr.test.js`, `test/e2e/templ.spec.js`).
- A `.templ` expression that reads no signal compiles to the same JS as before.
- Re-mounting a root disposes its effects (subscriber counts asserted).
- `docs/` describes `gom.Signal` from the reader's point of view; all Playwright E2E tests pass.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Signals, computed values and an effect primitive in `gom`; reactive text and attribute expressions in `.templ`; disposal on re-mount | `gom.NewSignal`, `Get`, `Set`, `Subscribe`, `gom.Computed` | |
| **In scope: target-specific** | `.templ` reactivity is `js` only | — | `.templ` compiles to JS |
| **Excluded: runtime / platform** | Concurrency scheduler, runtime reflection | goroutines, channels, `reflect` | GoFront "No Runtime" invariant |
| **Excluded: deferred** | Reactive `.templ` structure | signal-driven `if`/`for`/`switch` blocks, reactive component arguments, reactive `@templ.Raw` | Needs block remount and keyed-list design; v2.0.0 binds text and attribute expressions only |
| **Excluded: deferred** | SSR hydration, multi-tab state, worker RPC | `.templ` stream hydration, `SharedWorker` | v2.1+ |

---

## Verified Gaps & Baseline Audit

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Templ reactivity | Templ codegen emits one-time mounts with no update mechanism | `src/backend/js/templ.js:85-89`: text expressions emit `document.createTextNode(String(expr))` (re-checked 2026-11-17); `expr` attributes emit `className = …` / `setAttribute(name, String(expr))`; `cond-bool` attributes (`name?={ expr }`) emit `if (expr) setAttribute(name, "")`, a boolean attribute, so there is no class-toggle syntax |
| No signals or disposal | `gom` has no signals and no unmount hook; re-rendering calls `gom.Mount` on the same selector again, which clears `innerHTML` | `stdlib/gom/gom.go` (the only file in `stdlib/gom/`): `Node` has only `Mount(parent any, refs any)`; `example/gom/src/render.go`, `example/templ/src/render.go` |

---

## Approach

### 1. Architecture & Design Decisions
- **Signals in `gom`:** `stdlib/gom/signals.go` adds `Signal[T]` (`Get`, `Set`, `Subscribe` returning an unsubscribe func) and `Computed[T]`; an internal effect primitive tracks dependencies (`Get` inside a running effect subscribes it).
- **Reactive `.templ`:** a text or attribute expression is reactive when it calls `Get` on a `gom.Signal`/`gom.Computed` or is itself of signal type, decided from checked types. It emits an effect that re-evaluates the whole expression, so compound expressions (`{ fmt.Sprintf("%d items", count.Get()) }`) update:
  ```javascript
  const ___node = document.createTextNode("");
  ___p.appendChild(___node);
  ___fx(function() { ___node.data = String(count.Get()); });
  ```
  `expr` attributes re-run today's assignment inside the effect; `cond-bool` attributes emit `toggleAttribute(name, !!v)`. Non-reactive expressions keep today's output.
- **Disposal:** effects created while mounting under `gom.Mount(sel, …)` belong to that root; mounting the same selector again disposes them before `innerHTML` is cleared.

### 2. Invariants & Safety Bounds
- No goroutines, scheduler or runtime reflection: reactivity is deterministic closure dispatch.
- Non-reactive templ output is unchanged.

### 3. Edge Cases & Error Handling
- `Set` with an equal value does not notify; an effect that sets a signal it reads must not recurse without bound (panic with a clear message); a `Computed` re-evaluates only when a dependency changed.
- A method named `Get` on a non-signal type is not reactive.

---

## Implementation Tasks

> Split from the former `web-platform-evolution-plan.md` Phase 8. Former task IDs in parentheses.

### Phase 1: Signals and disposal in `gom`
- [ ] Task 1.1: `gom.Signal[T]` and `gom.Computed[T]` (former 8.1)
  - Files: `stdlib/gom/signals.go`, `.sentrux/rules.toml` (if the new file needs a glob)
  - Test: `test/unit/builtins/gom-signals.test.js`: `Get`, `Set`, `Subscribe` and its unsubscribe, computed derivations, effect dependency tracking, no notification on an equal value, the bounded-recursion panic
  - Done when: a `Set` runs subscribers and dependent effects synchronously
- [ ] Task 1.2: Dispose effects when a root is mounted again (former 8.5)
  - Files: `stdlib/gom/gom.go`, `stdlib/gom/signals.go`
  - Test: `gom-signals.test.js`: after a second `gom.Mount("#app", …)`, a `Set` runs no effect of the first mount and the subscriber count is one mount's worth
  - Done when: re-rendering through `gom.Mount` does not accumulate effects

### Phase 2: Reactive `.templ`
- [ ] Task 2.1: Reactive expression detection (former 8.2)
  - Files: `src/parser/templ.js`, `src/backend/js/templ.js`
  - Test: `test/unit/compiler/templ-reactive-detect.test.js`: `{ sig.Get() }`, a compound expression reading a signal and a bare signal value are flagged; a non-signal `Get` is not
  - Done when: templates without signals emit the same JS as before
- [ ] Task 2.2: Surgical text bindings (former 8.3)
  - Files: `src/backend/js/templ.js`
  - Test: `test/unit/compiler/templ-reactive-text.test.js`: `.data` updates on `Set` with the same text node and parent before and after
  - Done when: dynamic text updates without recreating parents
- [ ] Task 2.3: Surgical attribute bindings (former 8.4)
  - Files: `src/backend/js/templ.js`
  - Test: `test/unit/compiler/templ-reactive-attr.test.js`: `class={ … }` and other `expr` attributes update on HTML and SVG elements; `disabled?={ sig.Get() }` toggles through `toggleAttribute`
  - Done when: attribute expressions that read a signal update in place
- [ ] Task 2.4: Docs and the `templ` example (former 8.6, signal part)
  - Files: `docs/language-support.md`, `docs/compilation-mapping.md`, `README.md`, `example/templ/src/render.templ`
  - Test: `test/e2e/templ.spec.js`: a signal-bound text in `example/templ` changes while its element stays the same DOM node
  - Done when: `docs/` describes `gom.Signal`; all Playwright E2E tests pass
