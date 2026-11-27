# Web Interop & Reactive UI Fixes — Design Plan

**Version:** v2.0.0  
**Status:** Draft  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-25 (user-facing v2.0.0 bugs from `gom-signals` PR #321 & #322, `typed-web-fixes` PR #326, and GoFront 2.0 website adoption `730ff834`). Independent of `generics-and-aliases`, `js-codegen-and-value-semantics`, and `pre-release-fixes` (shared files: `src/backend/js/{expressions,runtime,index}.js` and `src/backend/wasm/natives.js` — rebase if landed after another active plan).  
**Release note:** Fixes five web and UI bugs: cross-origin browser `Window` values held in `any` (`ev.source == nil`, `window.opener == nil`, comparisons, type assertions, and variadic or `fmt` calls) no longer throw `SecurityError`, browser functions stored in typed Go function variables (`var g func(...any) = console.log`) now spread variadic `g(xs...)` arguments properly, and `fmt` `%T`/`%v` now print browser and local `.d.ts` objects, slices, and maps instead of `<nil>`. In addition, `.templ` text now preserves single spaces adjacent to `{ expr }` blocks and inline tags, and disposing a `gom.Effect` or `Subscribe` callback during a `gom.Computed` refresh no longer panics.

---

## Goal

Fix the five everyday user-facing bugs remaining in v2.0.0's new web platform and reactive UI stack before release:

1. **Cross-origin `any` runtime safety (`js`):** Guard `_genAnyNilCompare` (`Array.isArray(__a)`), `__ifeq`, `__va`, `__ifv`, `__isty`, and interface method assertions (`__hasm`) so nil checks (`ev.source == nil`, `window.opener == nil`, `a == nil`), equality (`a == other`), variadic calls (`fmt.Println(a)`), and type assertions (`a.([]int)`, `a.(error)`) never throw `SecurityError` on a cross-origin `WindowProxy`.
2. **Stored variadic browser functions (`js`):** Wrap variadic `_hostFunc` value expressions once in `genExpr` with a cross-origin-safe `__hva(f, n)` adapter so storing, assigning, returning, or passing them as Go variadic function types (`var g func(...any) = console.log`, `var add func(...string) = el.classList.add`, callback properties `host.cb`, factory returns `makeLog()`, callbacks `func(f func(...any))`) spreads `g(xs...)` cleanly.
3. **`fmt` `%T` / `%v` on browser and local `.d.ts` objects, slices & maps (`js`, `both`):** Record host `.d.ts` object type names in a `WeakMap` (`__gfHostT`) on interface entry without mutating host objects (including in `__ifv`), and add `fmtrt` intrinsics (`fmt_host_type`, `fmt_host_value`) so `fmt` prints real type names and readable values for direct/boxed `.d.ts` objects and local `.d.ts` slices/maps (including nil slices/maps) instead of `""` / `<nil>`.
4. **`.templ` inline whitespace:** Preserve single inline spaces next to `{ expr }`, `@Comp()`, `{ children... }`, void elements, and inline tags (`<p>Clicks: { x } times</p>`, `<span class="high-badge">{ hc } urgent</span>`, `<p><img src="a"> caption</p>`) while keeping multiline block indentation stripped.
5. **`gom` signals disposal during refresh:** Snapshot `o.deps`/`o.seen` and check `o.disposed`/`o.must` inside `changed(o)` so disposing an `Effect` or `Subscribe` callback during a `Computed` refresh (direct or chained) skips the observer cleanly instead of panicking with index out of range.

**Done means:**
- Cross-origin `Proxy` nil checks (`ev.source == nil`, `window.opener == nil`, `var a any = w; a == nil`, `a != nil`), equality (`a == other`, `a == a`), variadic calls (`take(a)`), and type assertions (`a.([]int)`, `a.(error)`, `a.(Stringer)`, `switch a.(type)` with `complex128`/`[]byte`) succeed without throwing `SecurityError`, covered in `test/unit/types/browser-globals.test.js`.
- Stored variadic browser methods, `.d.ts` callback properties, factory-returned variadic host functions, and top-level `.d.ts` variadic functions (with 0 or more fixed parameters) spread `g(xs...)`, nil slices, cross-origin arguments, and callback parameters (`func(f func(...any))`) without passing `{ __sp }`, covered in `test/unit/types/browser-globals.test.js`.
- `fmt.Sprintf("%T|%v", ...)` formats direct and `any`-boxed `gofront/dom` objects, frozen/cross-origin `WindowProxy` objects, local `.d.ts` objects, local `.d.ts` slices (non-nil, nil, and with `nil` elements) and maps (non-nil and nil), and structs containing them (with nil `dom.Element` and Go funcs still printing `<nil>`), covered in `test/unit/compiler/web-packages.test.js` (and WASM `fmt` unit tests stay green with zero new host imports).
- `.templ` renders inline spaces around `{ expr }`, `@Comp()`, `{ children... }`, void elements, and inline tags (`"Clicks: 0 times"`, `"Hello, World!"`, `"1 urgent"`, `"3 todos in session"`, `"Built with GoFront — Go compiled to JS"`) while preserving trimmed multiline indentation and multiline sibling `childNodes.length`, covered in `test/unit/compiler/templ.test.js`, `test/unit/compiler/templ-reactive-text.test.js`, and `test/e2e/templ.spec.js`.
- Disposing a `gom.Effect` or `Subscribe` callback inside a direct or chained `gom.Computed` refresh (1 or multiple deps) completes without panicking and skips the disposed observer, covered in `test/unit/builtins/gom-signals.test.js`; `npm test`, `npm run check`, and `npm run test:e2e` pass.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: target-specific (`js`)** | Root `js-any-nil-cross-origin`: JS runtime probes on `any` values must not throw on opaque cross-origin `WindowProxy` objects — guard `_genAnyNilCompare` with `Array.isArray(__a)`, and guard property probes in `__ifeq`, `__va`, `__ifv`, `__isty` (incl. `complex`), and `__hasm` (`error` / interface method checks) | `ev.source == nil`, `window.opener == nil`, `var a any = iframe.contentWindow; a == nil`, `a != nil`, `a == other`, `take(ev.source)`, `a.([]int)`, `a.(error)`, `a.(Stringer)`, `fmt.Sprintf("%T\|%v", w, w)` on cross-origin `WindowProxy` | |
| **In scope: target-specific (`js`)** | Root `js-host-variadic-value-spread`: wrap variadic `_hostFunc` value expressions (`!expr._callee`, skipping Go local/pkg `Ident`s and `ParenExpr`) once in `genExpr` with a cross-origin-safe `__hva(f, nFixed)` so `{ __sp: xs }` from Go variadic call sites unpacks to JS spread arguments | `var g func(...any) = console.log; g(xs...)`, `h = console.log`, `pass(console.log)`, `var add func(...string) = el.classList.add`, `host.cb`, `makeLog()`, `NS.log`, top-level `declare function myLog(...a: any[])`, fixed+variadic `declare function emit(tag: string, ...a: any[])`, `g(ev.source)` | |
| **In scope: target-specific (`js`, `both` stdlib)** | Root `fmt-host-object-and-local-dts`: tag `namespace` values entering interfaces in `globalThis.__gfHostT` (`WeakMap`, no object mutation; also skipped by `__ifv`) via `_dynTypeTag` / `_dynTagFlags` / `__ity`, read it in `__dtn`, and add `fmt_host_type` / `fmt_host_value` intrinsics in `fmtrt` (empty-string constant via existing `env.str` on WASM, zero new host imports) wired into `stdlib/fmt/print.go` | `fmt.Sprintf("%T\|%v", el, el)`, `var a any = el`, `plainObj`, `var la any = plainObj`, `plainList`, `var ll any = plainList`, nil `[]Plain` in `any`, `map[string]Plain` (non-nil & nil) in `any`, `[]dom.Element`, struct holding `.d.ts` fields, frozen/cross-origin `WindowProxy`, nil `dom.Element` (stays `<nil>`) | |
| **In scope: core (`templ` lexer)** | Root `templ-inline-whitespace-trimmed`: preserve a single inline space on same-line boundaries between inline nodes (text, `{ expr }`, `@Comp()`, `{ children... }`, void elements, inline tags) in `TemplLexer`, while keeping multiline indentation and leading/trailing block whitespace stripped | `<p>Clicks: { x } times</p>`, `<p>Hello, { name }!</p>`, `<p>{ hc } urgent</p>`, `<p>{ a } { b }</p>`, `<p>Before <span>mid</span> after</p>`, `<p><em>hi</em> <strong>there</strong></p>`, `<p><img src="a"> caption</p>`, `<span><strong>{ n }</strong> { todosWord(n) } in session</span>` | |
| **In scope: core (`gom` stdlib)** | Root `gom-changed-refresh-disposal`: snapshot `o.deps` and `o.seen` in `changed(o)` and abort/re-check `o.disposed` and `o.must` after each `refresh(d)` | `Effect` disposed inside `Computed`, `Subscribe` disposed inside `Computed`, multi-dep `Effect` disposed during first `Computed` refresh, chained `Computed` (`c2` → `c1`) disposing `Effect` | |
| **Excluded: runtime / platform** | Printing raw host objects on `wasm` | `fmt` on `wasm`-only packages | Browser `.d.ts` packages are `js`-only; WASM intrinsics return empty `""` using the existing string table with zero new host imports |
| **Excluded: deferred** | Reassigning package-level `var Fn = console.log` from another package (`plans/follow-ups.md` L74) and shadowed-name reassign scan (`plans/follow-ups.md` L75) | Cross-package host-func reassignment, shadowed `console` in `host-func.js` | Distinct checker/cross-package analysis roots; kept in `plans/follow-ups.md` |
| **Excluded: deferred** | `<pre>` / `<code>` verbatim multiline whitespace preservation in `.templ` | `<pre>  line 1\n  line 2</pre>` | Requires tag-context state in `TemplLexer`; separate feature outside inline space preservation |
| **Excluded: deferred** | `callsSignalGet` depth-0 `Get` field shadowing on embedded signals (`plans/follow-ups.md` L68) | `type Mid struct { Get func() string; *gom.Signal[int] }` | Rare struct-embedding corner case; separate root in `src/typechecker/types.js`, kept in `plans/follow-ups.md` |

---

## Verified Gaps & Baseline Audit

**Method.** Read-only code inspection and probes via `compile`, `compileDir`, `compileDts`, and `TemplLexer` from `test/unit/helpers.js` on `main` (`080c09f6`, 2026-11-26).

### U1 `js-any-nil-cross-origin` (from website GoFront 2.0 adoption, `730ff834`)
Root: JS runtime checks on `any`/interface values read hidden GoFront properties or method names directly off objects without guarding against throwing host objects (cross-origin `WindowProxy`):
- `_genAnyNilCompare` (`src/backend/js/expressions.js:3835-3840`) emits `((__a) => __a == null || __a.__nils === true)(x)`. `__nils` is only ever defined on a JS `Array` (`src/backend/js/runtime.js:502-503`).
- `HELPER_IFEQ` (`src/backend/js/runtime.js:910-937`) reads `a.__nilp` immediately after `a === b`.
- `HELPER_VA` (`src/backend/js/runtime.js:320-324`) reads `f.__sp` on any single-argument call to a variadic Go function (`take(ev.source)`, `fmt.Sprintf("%T", a)`).
- `__ifv` (`src/backend/js/runtime.js:393-400`) loops over fields of boxed structs (including `fmtrt.Arg{V: w}`) and reads `v.__v` / `Object.isExtensible(v)` (and mutates normal DOM objects with `Object.defineProperty(v, "__v", ...)`).
- `__isty` (`src/backend/js/runtime.js:514-551`) reads `v.__t` / `v.__nilp`, and `_typeNameCheckExpr` (`src/backend/js/expressions.js:2038-2046`) / `_ifaceMethodCheck` (`:2106-2117`) read `.re`, `.Error`, and interface method names (hit by `fmt.describe`, `typeName`, `printDesc`, and user assertions).

| ID | Program / Probe | Expected | Observed on `main` (`js`) |
|---|---|---|---|
| U1.1 | `ev.source == nil` (`dom.MessageEvent.source: any`) with cross-origin `Proxy` | `false` (no property read) | Emits `((__a) => __a == null \|\| __a.__nils === true)(ev.source)` → `SecurityError: get __nils` |
| U1.2 *sibling* | `window.opener == nil` (`dom.Window.opener: any`) and `var x any = iframe.contentWindow; x == nil` / `x != nil` | `false` / `true` | Emits `__a.__nils === true` → `SecurityError: get __nils` |
| U1.3 *sibling* | `var a, b any = crossWin1, crossWin2; a == b` (and `a == crossWin1`) | `false` (and `true`) | `a == crossWin1` passes (`a === b`); `a == b` reads `a.__nilp` in `__ifeq` → `SecurityError: get __nilp` |
| U1.4 *sibling* | `func take(xs ...any) int { return len(xs) }; take(ev.source)` | `1` | `__va` reads `f.__sp` → `SecurityError: get __sp` |
| U1.5 *sibling* | `_, ok := a.([]int)`, `_, ok := a.(error)`, `_, ok := a.(interface{ String() string })`, `switch a.(type) { case []byte: ... }` on cross-origin `Proxy` | `false` / `default` | `__isty` reads `v.__t` → `SecurityError: get __t`; `a.(error)` / `Stringer` read `.Error`/`.String` → `SecurityError` |
| U1.6 *sibling* | `fmt.Sprintf("%T", w)` / `fmt.Sprintf("%v", w)` / `fmt.Sprintf("%T", a)` on `dom.Window` holding cross-origin `Proxy` | `"dom.Window"` / `"[object]"` | `__ifv` reads `v.__v` on `Arg.V` → `SecurityError: get __v`; `any` hits `__va` → `SecurityError: get __sp` |
| control | `iframe.contentWindow == nil`, `switch a { case nil: }`, `var s []int; var a any = s; a == nil` | `false`, `default`, `true` (`__nils` sentinel) | Passes (`Array.isArray(crossOriginProxy)` verified `false` in Node without invoking `get` trap) |

### U2 `js-host-variadic-value-spread` (PR #326, `typed-web-fixes` Phase 3)
Root: `_genSpreadArg` (`src/backend/js/expressions.js:1735-1740`) emits `{ __sp: xs }` whenever `_calleeIsGoVariadic(call)` is true (any non-`_hostFunc` local/param `func(...T)`). When a variadic host function (`console.log`, `el.classList.add`, a `.d.ts` callback property `host.cb`, a `.d.ts` factory return `makeLog()`, `NS.log`, or a top-level `.d.ts` `declare function f(...a: any[])`) is stored in an explicit Go func type (`var g func(...any) = console.log`), assigned (`h = console.log`), or passed to a Go callback (`func(f func(...any))`), `_inferredVarType` / explicit type annotation drops `_hostFunc`, so call sites emit `g({ __sp: xs })`, which the host function receives as a literal object instead of spread arguments.

| ID | Program / Probe | Expected | Observed on `main` (`js`) |
|---|---|---|---|
| U2.1 | `var g func(...any) = console.log; g(xs...)` | `console.log("a", "b")` | Emits `g({ __sp: xs })` |
| U2.2 *sibling* | `var h func(...any); h = console.log; h(xs...)` | `console.log("a", "b")` | Emits `h({ __sp: xs })` |
| U2.3 *sibling* | `pass := func(f func(...any)) { f(xs...) }; pass(console.log)` | `console.log("a", "b")` | Emits `f({ __sp: xs })` |
| U2.4 *sibling* | `var add func(...string) = el.classList.add; add(cls...)` | `el.classList.add("a", "b")` with `this === el.classList` | Emits `add({ __sp: cls })` |
| U2.5 *sibling* | Top-level `.d.ts` `declare function myLog(...a: any[]): void` and fixed+variadic `declare function emit(tag: string, ...a: any[]): void` stored in typed vars and called with `xs...` | Spreads `xs` after fixed args (`emit("x", "a", "b")`) | Emits `g({ __sp: xs })` / `e("x", { __sp: xs })` |
| U2.6 *sibling* | `var xs []any = nil; g(xs...)`, non-spread `g("a", "b")`, and `g(crossOriginProxy)` | 0 args; `"a", "b"`; passes proxy without `SecurityError` | `g({ __sp: null })` for nil slice; unguarded `s.__sp` would throw on proxy |
| U2.7 *sibling* | `.d.ts` callback property `interface Host { cb: (...a: any[]) => void }; var g func(...any) = host.cb; g(xs...)` (`_dts: true`) | Spreads `xs` without `.bind(host)` | Emits `let g = host.cb; g({ __sp: xs })` (`_isHostMethodValue` skips `_dts`) |
| U2.8 *sibling* | `.d.ts` factory `declare function makeLog(): (...a: any[]) => void; var g func(...any) = makeLog(); g(xs...)` (`CallExpr`) | Spreads `xs` | Emits `let g = makeLog(); g({ __sp: xs })` |
| U2.9 *sibling* | `declare namespace NS { function log(...a: any[]): void }; var g func(...any) = NS.log; g(xs...)` | Spreads `xs` with `this === NS` | Emits `let g = NS.log?.bind(NS); g({ __sp: xs })` |
| control | `fn := console.log; fn(xs...)`; `console.log(xs...)`; Go variadic `var g func(...any) = goVar; g(xs...)`; `fn := console.log; var g func(...any) = fn; g(xs...)` | Spreads; Go variadic keeps slice identity; `fn` not double-wrapped | Direct & `fn :=` pass (must stay unwrapped at direct calls); `g = fn` currently fails until origin wraps |

### U3 `fmt-host-object-and-local-dts` (PR #326, `typed-web-fixes` Phase 3)
Root (two coupled halves):
1. `_dynTypeTag` (`src/backend/js/type-info.js:340-359`) returns `null` for `t.kind === "namespace"`, so raw browser/local `.d.ts` objects entering `any` carry no runtime type tag (`var a any = el` emits `let a = el`). Local `.d.ts` slices/maps/arrays (`plainList`, `map[string]Plain`, `[1]Plain`) *do* get `__ity(..., "[]Plain")` / `"map[string]Plain"` / `"[1]Plain"`, but `isLookupCase` (`src/lower/fmt-formatters.js:189-192`) excludes them because `gofront_gen.go` cannot spell local `.d.ts` types, and `typeName(a)` (`stdlib/fmt/print.go:255-266`) never reads runtime tags (and short-circuits on `a.V == nil`, which is `true` for JS `__nils` nil-slice sentinels).
2. `FmtGen.describe` (`src/lower/fmt-formatters.js:455-456`) emits `fmtrt.Arg{K: fmtrt.KInterface, T: "dom.Element", V: x}` for `namespace` types. `printDesc` (`stdlib/fmt/print.go:625-637`) delegates `KInterface` to `describe(a.V)`, which returns `KNone` for host JS objects; the `default` branch (`stdlib/fmt/print.go:696-698`) prints `<nil>` for every `KNone` with `verb == 'v'`, even when `a.V != nil` (or when `a.V` is a `__nils` / `__nilm` sentinel for a local `.d.ts` slice/map).

| ID | Program / Probe | Expected | Observed on `main` (`js`) |
|---|---|---|---|
| U3.1 | `el := document.getElementById("x"); var a any = el; fmt.Sprintf("%T\|%v", a, a)` | `"dom.Element\|[object HTMLDivElement]"` | `"\|<nil>"` |
| U3.2 *sibling* | `fmt.Sprintf("%T\|%v", el, el)` (direct `dom.Element`) | `"dom.Element\|[object HTMLDivElement]"` | `"dom.Element\|<nil>"` |
| U3.3 *sibling* | Local `.d.ts` `Plain`: direct `plainObj`, `var la any = plainObj`, `plainList`, `plainList[0]`, `var ll any = plainList`, `[1]Plain{plainObj}` direct & in `any` | `"Plain\|[object Plain]"`, `"[]Plain\|[[object Plain]]"`, `"[1]Plain\|[[object Plain]]"` | `"Plain\|<nil>"`, `"\|<nil>"`, `"[]Plain\|[<nil>]"`, `"\|<nil>"`, `"[1]Plain\|[<nil>]"`, `"\|<nil>"` |
| U3.4 *sibling* | `els := []dom.Element{el}; fmt.Sprintf("%T\|%v", els, els)` and `var elsAny any = els` | `"[]dom.Element\|[[object HTMLDivElement]]"` | `"[]dom.Element\|[<nil>]"` |
| U3.5 *sibling* | `type Box struct{ E dom.Element; P Plain }; fmt.Sprintf("%v", Box{el, plainObj})` | `"{[object HTMLDivElement] [object Plain]}"` | `"{<nil> <nil>}"` |
| U3.6 *sibling* | Cross-origin `Window` or frozen host object boxed into `any` and formatted with `%T`/`%v` | `"dom.Window\|[object]"` / `"dom.Element\|[object Frozen]"` (no `SecurityError` or mutation) | Cross-origin throws `SecurityError` in `__ifv` / `__va` / `describe`; `__ifv` mutates non-frozen host objects with `__v` |
| U3.7 *sibling* | `var nilList []Plain; var a any = nilList; fmt.Sprintf("%T\|%v", a, a)` | `"[]Plain\|[]"` (matches direct `nilList` and `[]int` in `any`) | `"\|<nil>"` (`a.V == nil` is `true` for `__nils` sentinel!) |
| U3.8 *sibling* | `m := map[string]Plain{"k": plainObj}; var ma any = m; fmt.Sprintf("%T\|%v", m, m)` and `fmt.Sprintf("%T\|%v", ma, ma)` (plus nil `map[string]Plain` in `any`) | `"map[string]Plain\|map[k:[object Plain]]"` and `"map[string]Plain\|map[]"` | Direct: `"map[string]Plain\|map[k:<nil>]"`; boxed: `"\|<nil>"` |
| U3.9 *sibling* | `var xs any = []Plain{nil, plainObj}; fmt.Sprintf("%v", xs)` | `"[<nil> [object Plain]]"` | `"<nil>"` |
| control | `var el dom.Element; fmt.Sprintf("%T\|%v", el, el)`; `var fn func(); var a any = fn; fmt.Sprintf("%v", a)`; `var fn2 = func(){}; var a2 any = fn2; fmt.Sprintf("%v", a2)`; Go typed nil slice/ptr in `any` | `"dom.Element\|<nil>"`; `"<nil>"` (does not dump JS function source) | Passes (must stay) |

### U4 `templ-inline-whitespace-trimmed` (PR #322, `gom-signals` Phase 2)
Root: `_lexHtmlBody` (`src/lexer/templ-lexer.js:301`) and `_lexCaseBody` (`:327`) call `this.skipWhitespace()` unconditionally before every `_lexHtmlNode()`, discarding same-line spaces *after* `{ expr }`, `</tag>`, `<void>`, `{ children... }`, and `@Comp()`. `_lexHtmlText` (`:647`) calls `.trim()`, discarding same-line spaces *before* `{ expr }`, `<tag>`, and `@Comp()`.

| ID | Program / Probe | Expected | Observed on `main` (`js`) |
|---|---|---|---|
| U4.1 | `<p>Clicks: { x } times</p>` (`x = 0`) | `"Clicks: 0 times"` | `"Clicks:0times"` |
| U4.2 *sibling* | `<p>Hello, { name }!</p>` (`name = "World"`) | `"Hello, World!"` | `"Hello,World!"` |
| U4.3 *sibling* | `<p>{ x } items</p>` and `<p>Count: { x }</p>` | `"0 items"`, `"Count: 0"` | `"0items"`, `"Count:0"` |
| U4.4 *sibling* | `<p>Before <span>mid</span> after</p>`, `<p><em>hi</em> <strong>there</strong></p>`, `<p>{ a } { b }</p>`, `<p>Before @Badge() after</p>`, `<p>Before { children... } after</p>` | `"Before mid after"`, `"hi there"`, `"1 2"`, `"Before <badge> after"`, `"Before <child> after"` | Spaces dropped around every inline boundary |
| U4.5 *sibling* | `example/templ/src/render.templ`: `<span class="high-badge">{ hc } urgent</span>` (`:95`), `<p class="tagline">Built with <a ...><strong>GoFront</strong></a> — Go compiled to JS</p>` (`:99`), and `<span><strong>{ n }</strong> { todosWord(n) } in session</span>` (`:122`) | `"1 urgent"`, `"Built with GoFront — Go compiled to JS"`, `"3 todos in session"` | `"1urgent"`, `"Built withGoFront— Go compiled to JS"`, `"3todosin session"` |
| U4.6 *sibling* | `<p><img src="a"> caption</p>` and `<p><img src="a"/> caption</p>` (void element without/with `/>`) | `" caption"` after `<img>` (both forms) | `<img src="a">` emits `HTML_OPEN`, space dropped |
| control | `<p>\n  Indented line\n</p>`, `<p>\n  Hello\n  { name }\n</p>` (newline before `{`), `<p>{ a }-{ b }</p>` (3 childNodes), `<div>\n  <span>a</span>\n  <span>b</span>\n</div>` (2 childNodes), `<div>\n  <span>a</span>\n  <!-- c --> <span>b</span>\n</div>` (2 childNodes), `<div>hello world</div>` | `"Indented line"`, no stray leading/indent space, `"a-b"` (3 nodes), 2 `<span>` children, `"hello world"` | Passes (must stay) |

### U5 `gom-changed-refresh-disposal` (PR #321, `gom-signals` Phase 1)
Root: `changed(o *observer)` (`stdlib/gom/signals.go:199-207`) iterates `o.deps`, calls `refresh(d)`, and immediately indexes `o.seen[i]`. When `refresh(d)` evaluates a `Computed` whose body calls `stop()` on `o` (`dispose(o)` → `untrack(o)`), `o.seen` is set to `nil` and `o.seen[i]` panics with `runtime error: index out of range [0] with length 0`.

| ID | Program / Probe | Expected | Observed on `main` (`js`) |
|---|---|---|---|
| U5.1 | `Effect` disposed from inside `Computed` during `s.Set(2)` | `"eff 10\nafter\n"` (no panic, `eff` skipped) | `runtime error: index out of range [0] with length 0` |
| U5.2 *sibling* | `c.Subscribe(...)` disposed from inside `Computed` during `s.Set(2)` | `"after\n"` (no panic, `sub` skipped) | `runtime error: index out of range [0] with length 0` |
| U5.3 *sibling* | `Effect` depending on `(c.Get(), s2.Get())`, disposed when `c` refreshes on `s.Set(2)` | `"eff 10 10\nafter\n"` | `runtime error: index out of range [0] with length 0` |
| U5.4 *sibling* | Chained `Computed` (`c2` reads `c1`; `c1` disposes `Effect` watching `c2` on `s.Set(2)`) | `"eff 11\nafter\n"` (no panic, `eff` skipped) | `runtime error: index out of range [0] with length 0` |
| control | `Effect` self-retriggering via `s.Set(2)` while `Computed` disposes it; normal `Effect`/`Computed` disposal inside another `Effect` | `"eff 10\neff 20\nafter\n"` / no panic | Passes (must stay) |

---

## Approach

### 1. Architecture & Design Decisions

1. **Cross-origin safe JS runtime probes (Phase 1, Task 1.1):**
   - In `_genAnyNilCompare` (`src/backend/js/expressions.js:3838`), emit:
     `((__a) => __a == null || (Array.isArray(__a) && __a.__nils === true))(${this.genExpr(operand)})`.
     `Array.isArray` inspects the JS exotic Array slot without triggering `[[Get]]`, so cross-origin `WindowProxy` objects return `false` safely, while nil-slice sentinels (`const n = []` with `__nils: true`) still test `true`.
   - In `HELPER_IFEQ` (`src/backend/js/runtime.js:910-937`), keep the fast paths (`a === b`, null/undefined checks) untouched and wrap the subsequent property-inspection checks (`__nilp`, `__gfUnbox`, `__v`, `constructor`, `__t`) in `try { ... } catch { return false; }`.
   - In `HELPER_VA` (`src/backend/js/runtime.js:320-324`), guard `f.__sp !== undefined` in `try { ... } catch {}` so passing a cross-origin `WindowProxy` to any Go variadic function (including `fmt.Sprintf`/`fmt.Println`) never throws `SecurityError`.
   - In `HELPER_IFACE_BOX` (`src/backend/js/runtime.js`):
     - In `__ifv` (`:396`), wrap the nested-field `__v` check/define in `try { ... } catch {}` so boxing structs containing a cross-origin `WindowProxy` (such as `fmtrt.Arg{V: w}`) never throws.
     - In `__isty` (`:514`), wrap the body after the null/primitive check in `try { ... } catch { return false; }`, and add `if (k === "complex") return typeof v === "object" && typeof v.re === "number" && typeof v.im === "number";`.
     - Add `__hasm(v, ms, mu)` inside `HELPER_IFACE_BOX` to check interface method presence (`typeof v[jm] === "function"`, optional `Unwrap` `__multi` check, and `!(v.__v === true && v.constructor.__pm?.includes(m))`) inside `try { ... } catch { return false; }`.
   - In `src/backend/js/expressions.js`:
     - Update `_typeNameCheckExpr` (`:2038-2046`) so `complex128`/`complex64` emit `__isty(val, "", "complex")` and `error` emits `__hasm(val, [["Error", "Error"]], null)` (or a 1-arg `error` check via `__hasm`, calling `this.useHelper("ifaceBox")`).
     - Update `_ifaceMethodCheck` (`:2106-2117`) to emit `__hasm(val, pairs, multiUnwrap)` (calling `this.useHelper("ifaceBox")`), making `fmt.describe` (`error`, `Stringer`, `GoStringer`), `typeName` (`GofrontTypeName`), `printDesc` (`GofrontFmt`), and user interface assertions cross-origin safe.

2. **Host variadic function value adapter (Phase 1, Task 1.2):**
   - Add `HELPER_HVA` (`__hva`) in `src/backend/js/runtime.js` and register `["hva", HELPER_HVA]` in `src/backend/js/index.js`:
     ```js
     var __hva = __hva || function(f, n) {
       if (typeof f !== "function") return f;
       return (...a) => {
         const s = a.length === n + 1 ? a[n] : undefined;
         let sp = false;
         if (s !== null && typeof s === "object") { try { sp = "__sp" in s; } catch {} }
         return sp ? f(...a.slice(0, n), ...(s.__sp ?? [])) : f(...a);
       };
     };
     ```
     Guarding `"__sp" in s` in `try/catch` (outside the call to `f(...)`) prevents `SecurityError` when a cross-origin `WindowProxy` is passed as the `(n+1)`-th argument, without swallowing exceptions thrown by `f(...)`.
   - Wrap variadic `_hostFunc` values at **one shared place** in `genExpr(expr)` (`src/backend/js/expressions.js`, right after the `_ityTag` / `_ifaceBox` blocks and before `switch (expr.kind)` so `_ityTag` wraps the adapter rather than the raw function):
     - Helper `_needsHostVariadicWrap(expr)`: true when `!expr._callee && !expr._hvaWrapping && expr.kind !== "ParenExpr" && expr._type?._hostFunc === true && expr._type.variadic === true`, EXCEPT when `expr.kind === "Ident"` and the name is a Go local/package variable (not in `BROWSER_GLOBALS`, `this.checker?._externalNames`, or `this.jsImports`, since Go locals were already wrapped at their initializer).
     - When true, set `expr._hvaWrapping = true`, call `this.useHelper("hva")`, compute `nFixed = Math.max(0, (expr._type.params?.length ?? 1) - 1)`, and return `__hva(${this.genExpr(expr)}, ${nFixed})` (clearing `expr._hvaWrapping = false` in `finally`).
   - This single mechanism covers `_genHostMethodValue` (`console.log`, `el.classList.add`, `NS.log`), callback properties (`host.cb` with `_dts: true`), factory calls (`makeLog()`), indexed host funcs, and external/browser/npm `Ident`s (`myLog`, `emit`), while leaving direct calls (`expr._callee === true`) completely unwrapped and missing host methods (`undefined`) passing through unchanged.

3. **WeakMap host type tags & `fmtrt` host formatting (Phase 2):**
   - **Tagging without mutation (`Task 2.1`):**
     - In `src/backend/js/type-info.js`:
       - `_dynTypeTag(t)` (`:340`): add `if (t.kind === "namespace") return goTypeName(t);` (`goTypeName` is already imported at `:16` and returns `dom.Element` or `Plain`).
       - `_dynTagFlags(t)` (`:282`): add `if (t?.kind === "namespace") return ", false, false, true";`.
     - In `src/backend/js/runtime.js`:
       - Extend `__ity(x, t, ptr, sl, host)` (`:494`): handle `if (host)` **first** (before `x.__nilm` at `:497`, which would throw on cross-origin proxies!). When `host` is truthy, if `x !== null && x !== undefined && (typeof x === "object" || typeof x === "function")`, store `(globalThis.__gfHostT ??= new WeakMap()).set(x, t)` and return `x` immediately — never reading properties or calling `Object.isExtensible` / `Object.defineProperty`. For non-host objects where `!Object.isExtensible(x)` (e.g. a frozen `[]Plain` array), also fall back to storing the tag in `globalThis.__gfHostT`.
       - In `__ifv` (`:396`): skip defining `__v` on any nested field value `v` already tracked in `globalThis.__gfHostT?.has(v)` so boxing `Box{E: el}` or `fmtrt.Arg{V: el}` never mutates host objects.
       - Update `__dtn(v)` (`:552`): check `globalThis.__gfHostT?.get(v)` first, and wrap `v.__t` / `v.constructor` access in `try { ... } catch { return "object"; }` so failed type assertions on host or cross-origin objects report the real `.d.ts` type name cleanly.
   - **Register `fmt_host_type` and `fmt_host_value` intrinsics (`Task 2.2`):**
     - Register both `//gofront:intrinsic` signatures in `src/typechecker/types.js` (`INTRINSICS`): `["fmt_host_type", "func(any) string"]` and `["fmt_host_value", "func(any) string"]`.
     - In `src/backend/js/index.js` (`JS_INTRINSICS`):
       - `fmt_host_type`: for non-null objects/functions, check `globalThis.__gfHostT?.get(v)` first, else (in `try/catch`) `typeof v.__t === "string" ? v.__t : ""`; return `""` otherwise.
       - `fmt_host_value`: return `""` for `v === null || v === undefined || typeof v !== "object"`. Inside `try/catch`:
         - `if (v.__nils === true) return "[]";` (nil local `.d.ts` slice in `any`)
         - `if (v.__nilm === true) return "map[]";` (nil local `.d.ts` map in `any`)
         - `if (v.__nilp === true) return "";` (nil pointer sentinel → stays `<nil>`)
         - Recursive helper for arrays (`Array.isArray(v)` → `[elem0 elem1]`, formatting `null`/`undefined` elements as `"<nil>"`) and maps (`v.__map === true || (typeof v.__t === "string" && v.__t.startsWith("map["))` → sorted `map[k:v ...]`), otherwise `String(v)`.
         - In `catch`: `try { return String(v); } catch { return "[object]"; }` (cross-origin `WindowProxy` fallback).
     - In `src/backend/wasm/natives.js` (`WASM_INTRINSICS`): add `fmt_host_type` and `fmt_host_value` with `prepare: (mod) => mod.getStringImportIndex()` and `emit: (e) => e.emitBasicLit({ kind: "BasicLit", litKind: "STRING", value: "" })` (uses the existing string table import — zero new host imports).
   - **Wire into `fmtrt` and `fmt` (`Task 2.3`):**
     - Expose `HostType(v any) string` and `HostValue(v any) string` in `stdlib/internal/fmtrt/fmtrt.go` backed by `//gofront:intrinsic fmt_host_type` / `fmt_host_value`.
     - Wire into `stdlib/fmt/print.go`:
       - `typeName(a)` (`:255`): if `a.T != ""`, return `a.T`. If `a.V != nil`, try `fmtrt.Lookup(a.V)` and `a.V.(interface{ GofrontTypeName() string })`. Finally return `fmtrt.HostType(a.V)` (runs even when `a.V == nil` is `true` for a JS `__nils` sentinel so nil `[]Plain` in `any` returns `"[]Plain"`, while real `nil` returns `""`).
       - `printDesc` (`:696`): in the `KNone` fallback when `verb == 'v'`, check `if s := fmtrt.HostValue(a.V); s != ""` BEFORE `if a.V == nil || verb == 'v'` (so `__nils` prints `"[]"`, `__nilm` prints `"map[]"`, host objects print `String(v)`, and real `nil` / Go funcs return `""` and fall through to `<nil>`).

4. **`.templ` inline whitespace preservation (Phase 3, Task 3.1):**
   - Export `VOID_ELEMENTS` from `src/lexer/templ-lexer.js` and import it in `src/parser/templ.js` (single source of truth; respects `lexer/` → `parser/` layer order).
   - In `src/lexer/templ-lexer.js`, add `_skipHtmlWhitespace()` used by `_lexHtmlBody` (`:301`) and `_lexCaseBody` (`:327`) returning `{ hadSpace, hadNewline }`.
   - Define `INLINE_PREV_TOKENS = new Set([TT.HTML_TEXT, TT.TEMPL_EXPR, TT.TEMPL_COMP, TT.TEMPL_CHILDREN, TT.HTML_CLOSE, TT.HTML_SELF])` and helper `_isInlinePrevToken(tok)` (true if `tok` is in `INLINE_PREV_TOKENS`, or `tok.type === TT.HTML_OPEN && VOID_ELEMENTS.has(tok.value.tag)`).
   - Track a local `inlinePrev` boolean in `_lexHtmlBody` / `_lexCaseBody` (reset to `false` whenever `hadNewline` is true, and whenever `_skipHtmlComment()` spans a newline, so `<span>a</span>\n<!-- c --> <span>b</span>` never emits a stray space across lines; updated from `_isInlinePrevToken(this.tokens.at(-1))` after lexing non-comment nodes).
   - When `hadSpace && !hadNewline && inlinePrev`, look ahead at the next character:
     - If the next node is closing (`}` or `</`), a control-flow keyword (`if`, `for`, `switch`, `case`, `default`, `else`), EOF, or an HTML comment (`<!--`): drop the space.
     - If the next node is plain text (`_lexHtmlText`): pass `leadingSpace = true` so the text token starts with a single `" "` (keeping one text node, e.g. `" times"`).
     - Otherwise (next node is `{`, `@`, or an opening/self-closing `<tag>`): emit a single `Token(TT.HTML_TEXT, " ", line, col)`.
   - In `_lexHtmlText(leadingSpace = false)` (`:630`):
     - Compute `raw = this.src.slice(start, this.pos)` and `core = raw.trim()`.
     - Check whether `raw` ends with **same-line** horizontal whitespace (`const trail = /\s+$/.exec(raw); const hasSameLineSpace = Boolean(trail && !/[\r\n]/.test(trail[0]));`) AND stopped before inline content (`{`, `@`, or `<` not followed by `/` or `!`). (Testing `!/[\r\n]/.test(trail[0])` avoids falsely matching indentation spaces after `\n` in `<p>\n  Hello\n  { name }\n</p>`.)
     - If `core`: emit `(leadingSpace ? " " : "") + core + (trailingInlineSpace ? " " : "")`.

5. **`gom` signals disposal during `changed(o)` (Phase 3, Task 3.2):**
   - In `stdlib/gom/signals.go`, update `changed(o *observer)` (`:199-207`):
     ```go
     func changed(o *observer) bool {
         deps, seen := o.deps, o.seen
         for i, d := range deps {
             refresh(d)
             if o.disposed {
                 return false
             }
             if o.must {
                 return true
             }
             if d.version != seen[i] {
                 return true
             }
         }
         return false
     }
     ```
   - Snapshotting `deps, seen` guarantees `seen[i]` can never go out of bounds even if `refresh(d)` triggers `untrack(o)` (either via `dispose(o)` on an `Effect`/`Subscribe`, direct or through chained `Computed`s, or via a `Computed` losing subscribers). Returning `false` on `o.disposed` prevents `publish` (`:221`) and `evaluate` (`:139`) from running a disposed observer.

### 2. Invariants & Safety Bounds
- **No host object mutation:** `__ity(..., host=true)` uses `WeakMap` only and checks `if (host)` before reading any property; `__ifv` skips `__gfHostT` objects; DOM nodes, frozen host objects, and cross-origin `WindowProxy` values are never mutated or queried for extensibility.
- **Zero new WASM host imports:** `fmt_host_type` and `fmt_host_value` compile to empty-string constants on WASM via the existing `env.str` string table.
- **Direct browser call performance:** `__hva` is only emitted when a variadic host function is evaluated as a value (`!expr._callee`), never at direct `console.log(...)` call sites.
- **Go variadic slice identity preserved:** Non-host Go variadic functions still receive `{ __sp: xs }` unchanged and unwrap via `__va`.
- **Multiline `.templ` DOM structure preserved:** Newline-containing whitespace (including around HTML comments) between sibling elements still emits zero text nodes, preserving `childNodes.length` expectations across all existing `.templ` tests and examples.

### 3. Edge Cases & Error Handling
- **Cross-origin `WindowProxy` everywhere in `any`:** Nil checks, `==`, variadic calls (`__va`, `__hva`), struct boxing (`__ifv`), type switches (`__isty`), interface assertions (`__hasm`), and `fmt` (`String(v)` wrapped in `try/catch` → `"[object]"`) all avoid uncaught `SecurityError`.
- **Nil `.d.ts` value vs nil `.d.ts` slice/map in `fmt`:** `var el dom.Element; fmt.Sprintf("%v", el)` has `a.V == nil` (`null`), so `HostValue` returns `""` and `printDesc` prints `<nil>`; `var s []Plain; var a any = s` holds the `__nils` sentinel, so `HostType` returns `"[]Plain"` and `HostValue` returns `"[]"`; nil `map[string]Plain` in `any` returns `"map[string]Plain"` / `"map[]"`.
- **Go functions in `any`:** `fmt_host_value` ignores `typeof v === "function"`, so an unlooked-up Go function never dumps its JS source text.
- **Nil slice spread & proxy args in `__hva`:** `var xs []any; g(xs...)` passes `{ __sp: null }`; `"__sp" in s` is `true` and `...(s.__sp ?? [])` spreads 0 arguments; `g(crossOriginWin)` catches the `has` trap and passes `crossOriginWin` directly without swallowing errors thrown by `f`.
- **Multi-line `.templ` text and comments:** `<p>\n  Hello { name }\n</p>` strips `\n  ` before `Hello`, keeps `" "` before `{ name }`, and strips `\n` before `</p>`, rendering `"Hello World"`; `<p>\n  Hello\n  { name }\n</p>` sees `\n` in the trailing whitespace run so indentation spaces after `\n` do not leak; `<div>\n  <span>a</span>\n  <!-- c --> <span>b</span>\n</div>` resets `inlinePrev` across the newline so no stray text node is emitted.

---

## Implementation Tasks

### Phase 1: Web Interop Runtime Safety & Stored Browser Functions
- [ ] Task 1.1: Make `any == nil`, `__ifeq`, `__va`, `__ifv`, `__isty`, and interface assertions cross-origin safe on JS
  - Files: `src/backend/js/expressions.js`, `src/backend/js/runtime.js`
  - Test: `test/unit/types/browser-globals.test.js` — add tests using a `Proxy` whose `get`, `has`, `isExtensible`, `ownKeys`, and `getOwnPropertyDescriptor` traps throw `SecurityError` for `ev.source == nil`, `window.opener == nil`, `var a any = iframe.contentWindow; a == nil` / `a != nil`, `a == other` / `a == a`, passing `ev.source` to a Go variadic `func(...any)`, boxing a struct holding `ev.source` into `any`, and asserting `a.([]int)`, `a.(error)`, `a.(interface{ String() string })`, and `switch a.(type)` with `complex128`/`[]byte`, plus nil-slice-in-`any` control (`a == nil` still `true`).
  - Done when: `_genAnyNilCompare` guards `__a.__nils === true` with `Array.isArray(__a)`, `__ifeq` / `__va` / `__ifv` / `__isty` / `__hasm` catch property-access errors on opaque host objects cleanly, `_typeNameCheckExpr` (`complex128`/`complex64`/`error`) and `_ifaceMethodCheck` route through `__isty`/`__hasm`, and all new and existing tests in `browser-globals.test.js` pass.
- [ ] Task 1.2: Unpack `{ __sp }` in stored variadic browser function values via `__hva`
  - Files: `src/backend/js/runtime.js`, `src/backend/js/index.js`, `src/backend/js/expressions.js`
  - Test: `test/unit/types/browser-globals.test.js` — add tests for `var g func(...any) = console.log; g(xs...)`, `var h func(...any); h = console.log; h(xs...)`, callback `func(f func(...any)) { f(xs...) }`, `var add func(...string) = el.classList.add; add(cls...)`, `fn := console.log; var g func(...any) = fn; g(xs...)`, `.d.ts` callback property `host.cb`, `.d.ts` factory `makeLog()`, `NS.log`, nil slice `g(nilSlice...)`, non-spread `g("a", "b")`, `g(crossOriginProxy)`, top-level `.d.ts` `declare function myLog(...a: any[])`, and fixed+variadic `declare function emit(tag: string, ...a: any[])`, plus direct `console.log(xs...)` staying unwrapped.
  - Done when: cross-origin-safe `HELPER_HVA` is registered and applied via one shared wrap check in `genExpr` for variadic `_hostFunc` value expressions (skipping direct callees, `ParenExpr`, and Go local/package `Ident`s), all new spread cases pass with expected arguments and `this` binding, and existing stored-func and Go variadic tests pass.

### Phase 2: `fmt` `%T` / `%v` for `.d.ts` Objects & Local `.d.ts` Slices/Maps
- [ ] Task 2.1: Tag `.d.ts` objects in a `WeakMap` on interface entry without mutating them
  - Files: `src/backend/js/type-info.js`, `src/backend/js/runtime.js`
  - Test: `test/unit/compiler/web-packages.test.js` — verify `var a any = el` and `var la any = plainObj` record `"dom.Element"` / `"Plain"` in `__gfHostT` without defining properties on `el` (verified with `Object.freeze(fakeEl)`, `Object.getOwnPropertyNames(fakeEl)` after boxing in `any` and in `Box{E: fakeEl}`, and a throwing cross-origin `Proxy`), and verify failed type assertions on boxed host objects report `"dom.Element"` via `__dtn`.
  - Done when: `_dynTypeTag` returns `goTypeName(t)` for `namespace`, `_dynTagFlags` passes the `host` flag to `__ity`, `__ity` handles `if (host)` before reading `x.__nilm` (and falls back to `__gfHostT` for non-extensible non-host objects), `__ifv` skips `__gfHostT` objects, and `__dtn` reads `__gfHostT` safely.
- [ ] Task 2.2: Register `fmt_host_type` and `fmt_host_value` intrinsics in checker and JS/WASM backends
  - Files: `src/typechecker/types.js`, `src/backend/js/index.js`, `src/backend/wasm/natives.js`
  - Test: `test/unit/compiler/web-packages.test.js` — verify the intrinsics are registered with exact signatures (`func(any) string`) and compile cleanly on both JS and WASM targets without adding new WASM host imports.
  - Done when: `INTRINSICS`, `JS_INTRINSICS` (handling `__gfHostT`, `__t`, `__nils`, `__nilm`, `__nilp`, recursive arrays with `null` → `"<nil>"`, sorted maps, and `try/catch` `String(v)` → `"[object]"`), and `WASM_INTRINSICS` (empty string via existing `env.str`) are wired and existing unit tests pass.
- [ ] Task 2.3: Expose `fmtrt.HostType` / `fmtrt.HostValue` and wire into `fmt`
  - Files: `stdlib/internal/fmtrt/fmtrt.go`, `stdlib/fmt/print.go`
  - Test: `test/unit/compiler/web-packages.test.js` — add tests for `fmt.Sprintf("%T|%v", ...)` on direct `dom.Element`, `any`-boxed `dom.Element`, direct & boxed local `.d.ts` `Plain`, `[]Plain` direct & boxed (non-nil, nil, and with `nil` element), `map[string]Plain` direct & boxed (non-nil and nil), `[1]Plain` direct & boxed, `[]dom.Element` direct & boxed in `any`, struct holding `dom.Element` and `Plain`, frozen & cross-origin `WindowProxy` objects (both direct `dom.Window` and `any`-boxed), plus nil `dom.Element` and Go func controls (still `<nil>`).
  - Done when: all U3 gaps print real type names and formatted values on `js`, nil and Go-func controls still print `<nil>`, and `npm test` (including all WASM `fmt` tests) and `npm run check` pass.

### Phase 3: `.templ` Inline Whitespace & `gom` Signal Disposal
- [ ] Task 3.1: Preserve inline spaces around `{ expr }`, void elements, and inline tags in `TemplLexer`
  - Files: `src/lexer/templ-lexer.js`, `src/parser/templ.js`
  - Test: `test/unit/compiler/templ.test.js`, `test/unit/compiler/templ-reactive-text.test.js`, `test/e2e/templ.spec.js` — add unit tests for `<p>Clicks: { x } times</p>` (including reactive signal updates), `<p>Hello, { name }!</p>`, `<p>{ x } items</p>`, `<p>Count: { x }</p>`, `<p>Before <span>mid</span> after</p>`, `<p><em>hi</em> <strong>there</strong></p>`, `<p>{ a } { b }</p>`, `<p>Before @Badge() after</p>`, `<p>Before { children... } after</p>`, `<p><img src="a"> caption</p>`, `<p><img src="a"/> caption</p>`, multiline `<p>\n  Hello { name }\n</p>`, multiline `<p>\n  Hello\n  { name }\n</p>`, multiline comment `<div>\n  <span>a</span>\n  <!-- c --> <span>b</span>\n</div>`, and multiline sibling element controls (`childNodes.length === 2`); tighten `test/e2e/templ.spec.js` assertions on `.high-badge` (`"1 urgent"`), `.tagline` (`"Built with GoFront — Go compiled to JS"`), and `.stats-bar` (`"3 todos in session"`).
  - Done when: all inline spacing cases render spaces accurately, multiline formatting indentation and comments emit no spurious text nodes, `VOID_ELEMENTS` is shared from `templ-lexer.js`, and `npm test && npm run test:e2e` pass.
- [ ] Task 3.2: Snapshot observer deps/seen and check disposal in `gom` `changed(o)`
  - Files: `stdlib/gom/signals.go`
  - Test: `test/unit/builtins/gom-signals.test.js` — add tests for disposing an `Effect` inside a `Computed` refresh (1 dep and 2 deps), disposing an `Effect` from a chained `Computed` (`c2` → `c1`), and disposing a `Computed.Subscribe` callback inside a `Computed` refresh, and verify no panic occurs and the disposed observer does not run.
  - Done when: `changed(o)` snapshots `deps, seen` and exits cleanly on `o.disposed` / `o.must`, all new and existing tests in `gom-signals.test.js` pass, and `npm test && npm run check` pass.
