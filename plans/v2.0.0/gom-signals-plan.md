# `gom` Signals — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Split out of the former `web-platform-evolution-plan.md` (its Phase 8) on 2026-11-17, re-checked that day. Starts after [`typed-web-platform-plan.md`](typed-web-platform-plan.md) Phase 4, which migrates `stdlib/gom/gom.go` to the typed globals. Independent of the checker, `wasm` and value-store plans.  
**Release note:** `.templ` text and attributes bound to a `gom.Signal` update in place when the signal changes, without re-rendering the page or diffing a virtual DOM.  

---

## Goal

Add `gom.Signal[T]`, `gom.Computed[T]` and `gom.Effect` and make `.templ` text and attribute expressions that read them update their DOM node surgically on `.Set()`, with effects owned by their mount root and disposed when the root is mounted again. No virtual DOM, no diffing, no runtime scheduler: synchronous publisher-subscriber closures in client JavaScript.

**Done means:**
- `.templ` text and attribute expressions that read a `gom.Signal` or `gom.Computed` update their DOM node on `.Set()` without remounting (`test/unit/builtins/gom-signals.test.js`, `test/unit/compiler/templ-reactive-text.test.js`, `test/unit/compiler/templ-reactive-attr.test.js`, `test/e2e/templ.spec.js`).
- A `.templ` expression that reads no signal compiles to the same JS as before.
- Re-mounting a root disposes its effects (verified via effect run counts and active subscriber assertions).
- `docs/` describes `gom.Signal`, `gom.Computed` and `gom.Effect` from the reader's point of view; all Playwright E2E tests pass.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Signals, computed values and effects in `gom`; templ reachability for non-enumerable AST expressions; reactive text and attribute expressions in `.templ`; disposal on re-mount | `gom.NewSignal`, `gom.NewComputed`, `gom.Effect`, `Get`, `Set`, `Subscribe` | |
| **In scope: target-specific** | `.templ` reactivity is `js` only | — | `.templ` compiles to JS |
| **Excluded: runtime / platform** | Concurrency scheduler, runtime reflection | goroutines, channels, `reflect` | GoFront "No Runtime" invariant |
| **Excluded: deferred** | Reactive `.templ` structure | signal-driven `if`/`for`/`switch` blocks, reactive component arguments, reactive `@templ.Raw` | Needs block remount and keyed-list design; v2.0.0 binds text and attribute expressions only |
| **Excluded: deferred** | SSR hydration, multi-tab state, worker RPC | `.templ` stream hydration, `SharedWorker` | v2.1+ |

---

## Verified Gaps & Baseline Audit

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Templ reactivity (`templ-one-time-codegen`) | Templ codegen emits one-time mounts with no update mechanism | `src/backend/js/templ.js:89-92` (`TemplExpr`) emits `document.createTextNode(String(expr))`; `src/backend/js/templ.js:169-185`: `expr` attributes emit `className = …` / `setAttribute(name, String(expr))`; `cond-bool` attributes (`name?={ expr }`) emit `if (expr) setAttribute(name, "")`, a boolean attribute, so there is no class-toggle syntax. Probe (2026-11-19): `s.Get()` on `s *gom.Signal[int]` (or an alias) has `recv._type` `pointer → named(Signal$$gom)`, whereas `v.Get()` on an addressable value `v gom.Signal[int]` has `recv._type` `named(Signal$$gom)` directly |
| Templ reachability (`templ-non-enumerable-ast`) | `StdlibReach` skips all Go expressions inside `.templ` bodies because `TemplParser` attaches `expr`/`exprs`/`forStmt`/`attr.expr` as non-enumerable properties and `forEachChild` iterates `Object.keys` (unlike `walkNodes` in `src/lower/gen-types.js:54-70`); bare signal bindings `{ sig }` emit `.Get()` in codegen without a `.Get()` AST node, so `Signal.Get`/`Computed.Get` are pruned when `.Get()` is not called elsewhere | `src/parser/templ.js:58-68`, `src/lower/walk.js:11-16`, `src/lower/reachability.js:39-57`. Probe (2026-11-19): `count.Get()` on a `gom.Signal` called only inside `.templ` crashes at runtime with `TypeError: count.Get is not a function`; siblings: `b.Len()` on `*strings.Builder` → `b.Len is not a function`, `strconv.Itoa(n)` → `Itoa$$strconv is not defined`; bare `{ s }` in `.templ` when `.go` only calls `gom.NewSignal` and `s.Set` prunes `Signal.Get` from emitted JS |
| Bare signal in `cond-bool` (`templ-cond-attr-bool-only`) | `_checkTemplCondAttr` rejects non-`bool` expressions, including `*gom.Signal[bool]` and `*gom.Computed[bool]` | `src/typechecker/index.js:1292-1300`. Probe (2026-11-19): `<input disabled?={ s }/>` → `Conditional attribute 'disabled' must be bool` |
| No signals or disposal (`no-signals-or-disposal`) | `gom` has no signals and no unmount hook; re-rendering calls `gom.Mount` on the same selector again, which clears `innerHTML`; Go `map[any]V` on JS cannot key disposal lists by DOM element because `__ik(el)` stringifies every `HTMLDivElement` to `"[object HTMLDivElement]"` | `stdlib/gom/gom.go` (the only file in `stdlib/gom/`, already covered by `stdlib/gom/**` in `.sentrux/rules.toml:77`): `Node` has only `Mount(parent any, refs any)`; `Mount` / `MountTo` (`stdlib/gom/gom.go:128-137`); `example/gom/src/render.go`, `example/templ/src/render.go`. Probe (2026-11-19): `m := map[any][]func(){}` with `el1 := document.querySelector("#a")` and `el2 := document.querySelector("#b")` collides on `__ik(el)` (`len(m[el1]) == len(m[el2]) == 3` instead of `2, 1`), whereas `el1 == el1b` and `Object.is(el1, el1b)` compare by JS reference identity (`true false`) |

---

## Approach

### 1. Architecture & Design Decisions
- **Signals in `gom`:** `stdlib/gom/signals.go` adds:
  - `Signal[T any]` created via `NewSignal[T any](v T) *Signal[T]` with `Get() T`, `Set(v T)` and `Subscribe(fn func(T)) func()` (returning an unsubscribe func). Using `T any` with JS `Object.is(s.val, v)` for equality avoids the Go `comparable` restriction so slices, maps and structs can live in signals (probed 2026-11-19: `s.val == v` on `T any` is rejected by the checker; `Object.is` compiles cleanly in both `runInDom` and `runJs` and handles `NaN`; primitives compare by value, structs/slices/maps by identity).
  - `Computed[T any]` created via `NewComputed[T any](fn func() T) *Computed[T]` with `Get() T` and `Subscribe(fn func(T)) func()`. Lazy when unobserved (evaluates on first `Get()` or `Subscribe()`, caches across repeated `Get()` calls while clean, and when unobserved marks itself dirty and unsubscribes on upstream change); when observed by an active `Effect`, outer `Computed` or `Subscribe` callback, recomputes on upstream change and notifies its subscribers only when `!Object.is(prev, next)`.
  - `Effect(fn func()) func()` tracks dependencies (`Get` inside a running effect subscribes it via a non-generic observer stack), clears its prior subscriptions before each re-run (so stale branch dependencies from `if cond.Get() { a.Get() } else { b.Get() }` are dropped and duplicate reads `s.Get() + s.Get()` subscribe once per run), returns an idempotent dispose func, and registers itself with the active mount scope when called during `Mount` or `MountTo`. Exporting `Effect` keeps Phase 1 independently testable without Phase 2 and lets `gom.NodeFunc` users author effects directly.
- **Templ reachability:** `collectRefs` in `src/lower/reachability.js` traverses the non-enumerable `expr`, `exprs`, `forStmt` and `attr.expr` properties on templ AST nodes (matching `walkNodes` in `src/lower/gen-types.js:54-70`) so stdlib functions and methods (such as `Signal.Get`) called only inside `.templ` are kept. When a program with a `TemplDecl` reaches `Signal$$gom` or `Computed$$gom`, reachability also roots `Effect$$gom` (the mangled `gom.Effect`) and the `Get` method on `Signal$$gom` / `Computed$$gom` (compatible with both name-based and receiver-qualified method reachability) so emitted reactive bindings—including bare `{ sig }` where user code never spells `.Get()`—resolve both at runtime; `src/link/stdlib.js:662` already implicitly imports `gom` for every `TemplDecl`.
- **Reactive `.templ`:** in `src/backend/js/templ.js`, a text (`TemplExpr`) or attribute (`expr`, `cond-bool`) expression is reactive when its checked AST contains a `.Get()` call whose receiver type (unwrapping an optional `pointer` for `*gom.Signal[T]`, type aliases, or addressable value receivers) is `Signal$$gom` / `Computed$$gom`, or when the expression itself is of that signal type. For a top-level bare signal expression (`{ sig }`, `class={ sig }`, `disabled?={ boolSig }`), codegen emits `(${exprJs}).Get()` so it subscribes and reads the value (and `_checkTemplCondAttr` in `src/typechecker/index.js` accepts `*gom.Signal[bool]` / `*gom.Computed[bool]`). Reactive expressions allocate a fresh text-node variable via `this._freshVar("t")` (so sibling reactive text nodes in the same block do not collide) and emit an `Effect$$gom` call that re-evaluates the whole expression, so compound expressions (`{ fmt.Sprintf("%d items", count.Get()) }`) update:
  ```javascript
  const ___t1 = document.createTextNode("");
  ___p.appendChild(___t1);
  Effect$$gom(function() { ___t1.data = String(count.Get()); });
  ```
  `expr` attributes re-run today's assignment inside `Effect$$gom`; `cond-bool` attributes emit `toggleAttribute(name, !!v)`. Non-reactive expressions keep today's output.
- **Disposal:** `gom.Mount` and `gom.MountTo` maintain a stack of active mount scopes (handling nested mounts) and a slice of `{ el any; disposers []func() }` entries matched by `r.el == el` / `Object.is(r.el, el)` on the resolved DOM element (never `map[any][]func()`, which stringifies DOM elements to `"[object HTMLDivElement]"` and collides across roots, and not the selector string, so `"#app"` and `"div#app"` share a root). Effects created while mounting attach to that element's disposal list; calling `gom.Mount` on the element disposes all prior effects on it (including those added via `MountTo`) before `innerHTML` is cleared.

### 2. Invariants & Safety Bounds
- No goroutines, scheduler or runtime reflection: reactivity is deterministic closure dispatch.
- Non-reactive templ output is unchanged (and emits no `Effect$$gom`).

### 3. Edge Cases & Error Handling
- `Set` with an equal value (`Object.is`) does not notify; notification iterates a snapshot of the subscriber slice so subscribing or disposing during a notification is safe; an effect that sets a signal it reads must not recurse without bound (panic with a clear message); a `Computed` re-evaluates only when a dependency changed and notifies dependents only when its result changed (`!Object.is`).
- Dynamic branch dependencies (`if cond.Get() { a.Get() } else { b.Get() }`) unsubscribe stale dependencies before each re-run; reading the same signal twice in one run subscribes once.
- A method named `Get` on a non-signal type is not reactive.
- Nested `gom.Mount` calls restore the outer mount scope on return (including on panic via `defer`).

---

## Implementation Tasks

> Split from the former `web-platform-evolution-plan.md` Phase 8. Former task IDs in parentheses.

### Phase 1: Signals and disposal in `gom`
- [x] Task 1.1: `gom.Signal[T]`, `gom.Computed[T]` and `gom.Effect` (former 8.1)
  - Files: `stdlib/gom/signals.go`
  - Test: `test/unit/builtins/gom-signals.test.js`: `NewSignal`/`Get`/`Set`/`Subscribe` and its unsubscribe, `NewComputed` lazy derivations (zero evaluations before `Get`, cached across repeated `Get`, re-evaluated on `Set`, and `Computed.Subscribe` / dependent `Effect` notified only when the derived value changes), `Effect` dependency tracking (including duplicate reads in one run and branch dependency cleanup) and disposal, no notification on `Object.is`-equal values (including `NaN`), slice/struct signal values, and the bounded-recursion panic
  - Done when: a `Set` runs subscribers and dependent effects synchronously
- [x] Task 1.2: Dispose effects when a root is mounted again (former 8.5)
  - Files: `stdlib/gom/gom.go`, `stdlib/gom/signals.go`
  - Test: `test/unit/builtins/gom-signals.test.js`: using `gom.NodeFunc` + `gom.Effect`, after a second `gom.Mount("#app", …)` (and after `gom.MountTo` followed by `gom.Mount`, plus equivalent selectors `"#app"` / `"div#app"`, two distinct sibling roots `"#a"` / `"#b"` confirming mounting `"#b"` does not dispose `"#a"`, and nested mounts), a `Set` runs no effect of the first mount and only the current mount's effects remain subscribed
  - Done when: re-rendering through `gom.Mount` does not accumulate effects or collide across DOM roots

### Phase 2: Reactive `.templ`
- [x] Task 2.1: Templ reachability and reactive expression detection (former 8.2)
  - Files: `src/lower/reachability.js`, `src/typechecker/index.js`, `src/backend/js/templ.js`
  - Test: `test/unit/compiler/templ-reactive-detect.test.js`: `{ sig.Get() }`, a compound expression reading a signal, a bare signal/computed value (`{ sig }`, `{ comp }`, `disabled?={ boolSig }`, `disabled?={ boolComp }`) even when `.Get()` is never called in `.go`, and a `Signal.Get()` or stdlib function called only inside `.templ` are detected and kept reachable (including `Effect$$gom` and `Get`); a non-signal `Get` is not flagged; non-bool bare signal in `cond-bool` is rejected
  - Done when: templates without signals emit the same JS as before and templ-only stdlib calls and bare-signal `.Get()` are never pruned
- [ ] Task 2.2: Surgical text bindings (former 8.3)
  - Files: `src/backend/js/templ.js`
  - Test: `test/unit/compiler/templ-reactive-text.test.js`: `{ sig.Get() }`, compound text expressions, multiple reactive text nodes in the same element (`<p>{ a.Get() } { b.Get() }</p>`), and bare `{ sig }` / `{ comp }` update `.data` on `Set` with the same text node and parent before and after
  - Done when: dynamic text updates without recreating parents
- [ ] Task 2.3: Surgical attribute bindings (former 8.4)
  - Files: `src/backend/js/templ.js`
  - Test: `test/unit/compiler/templ-reactive-attr.test.js`: `class={ … }` and other `expr` attributes (including bare `{ sig }` / `{ comp }`) update on HTML and SVG elements; `disabled?={ sig.Get() }`, `disabled?={ boolSig }` and `disabled?={ boolComp }` toggle through `toggleAttribute`
  - Done when: attribute expressions that read a signal update in place
- [ ] Task 2.4: Docs and the `templ` example (former 8.6, signal part)
  - Files: `docs/language-support.md`, `docs/compilation-mapping.md`, `README.md`, `example/templ/src/render.templ`, `example/templ/src/store.go`
  - Test: `test/e2e/templ.spec.js`: `syncMsg`/`syncCls` (`SyncStatus` in `example/templ/src/render.templ`, updated by `setSyncStatus`/`triggerSave` in `example/templ/src/store.go` without calling `render()`) updates `.sync-status` text and class in place while its element stays the same DOM node
  - Done when: `docs/` describes `gom.Signal`, `gom.Computed` and `gom.Effect`; all Playwright E2E tests pass
