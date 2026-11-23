# Typed Web Platform — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Split out of the former `web-platform-evolution-plan.md` (its Phases 6–7) on 2026-11-17, re-probed that day. Starts after [`checker-go-rules-plan.md`](checker-go-rules-plan.md): Phase 1 here extends assignability, and Phase 4 types the globals that its Phase 3 classifies (`anyKind`: JS-dynamic `any` versus Go `any`), so the flip reuses that classifier instead of adding a second one. Ends `checker-strictness-plan.md` D3 permissiveness for the typed globals. [`gom-signals-plan.md`](gom-signals-plan.md) starts after this plan (`stdlib/gom/gom.go` is migrated in Phase 4). Motivating consumer: SimpleFPS' 1.9.2 adoption (`seriva/simplefps`), where the `any` rule forced hand-written `.d.ts` interfaces for every DOM and WebGPU value and the built-in `GPUDevice` assertion rejects every standard device.  
**Release note:** **Breaking:** `document`, `window` and the other browser globals are typed, so reading a property that only a specific element type has needs a type assertion first (see the migration guide). The DOM, Canvas, Fetch, WebSocket and WebGPU APIs are type-checked through the new `gofront/dom`, `gofront/canvas`, `gofront/fetch`, `gofront/websocket` and `gofront/webgpu` packages, a misspelled member is a compile error, and `x.(webgpu.Device)` accepts a standard browser device.  

---

## Goal

Remove `any` from the Web API globals and ship typed declaration packages for DOM, Canvas, Fetch, WebSocket and WebGPU, generated from WebIDL (`@webref/idl`) as `.d.ts`-form declarations loaded through the existing `.d.ts` path (pass-through assertions, closed members), with JS camelCase member names (user decisions 2026-11-13). Extend the `.d.ts` path with what the generated declarations need first, migrate the stdlib and examples, then flip the globals.

**Done means:**
- DOM, Canvas, Fetch, WebSocket and WebGPU code type-checks against generated declarations; `document`, `window` and the other WebIDL-defined globals are no longer `any`; a misspelled member is a compile error; `x.(webgpu.Device)` is a pass-through that accepts a standard device (`test/unit/stdlib/dom-typed.test.js`, `web-apis-typed.test.js`, `webgpu-typed.test.js`, `test/unit/types/browser-globals.test.js`).
- The `.d.ts` path supports `extends`, type assertions on `.d.ts` interfaces, optional parameters, nullable primitive types (`T | null`), `Promise<T>`, function types (with event-callback assignability), integer and `float32` types and dictionary arguments (`test/unit/types/dts-*.test.js`).
- A program that uses no Web API loads no declaration file and emits the same JS; `.d.ts` interface assertions (`x.(dom.HTMLInputElement)`) and `gofront/*` declaration imports emit no runtime code, and flipping the browser globals changes no emitted JS for migrated code.
- All `example/*` build and their E2E specs pass; `docs/` has a migration section with before/after examples; `npm run check` runs `gen-web-types.js --check`.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | `.d.ts` path extensions; generated `gofront/*` declaration packages; typed WebIDL-defined globals; migration of stdlib and examples | `gofront/dom`, `gofront/webgpu`, typed `document`/`window` | |
| **In scope: target-specific** | Typed web packages are `js` only | importing `gofront/dom` from a `wasm`/`both` package | Clear error elsewhere |
| **Excluded: deferred** | Web typing outside WebIDL | ECMAScript built-ins in `BROWSER_GLOBALS` (`Math`, `JSON`, `Date`, `RegExp`, `Promise`, `Error`, `Symbol`, `String`, `Number`, `Boolean`, `Array`, `Object`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURIComponent`, `decodeURIComponent`); hand-built WebGL contexts and typed arrays in `web.js`; PascalCase aliases on the new types | ES built-ins are not defined in WebIDL and stay JS-dynamic `any`; WebGL and typed arrays keep their current types; camelCase only (user decision 2026-11-13) |

---

## Verified Gaps & Baseline Audit

**Method.** `main` at `4eb69a6`, 2026-11-17; probes in `.probes/web/` (deleted) with `compileDir`. Rows without a re-probe keep their 2026-11-13 evidence (in this file's git history under `web-platform-evolution-plan.md`).

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Browser globals | `BROWSER_GLOBALS` (`src/typechecker/types.js:53`) has 59 entries (18 ES built-ins + 41 WebIDL entries), all `ANY`; values read from them flow into concrete types unchecked | Re-probe: `var title string = document.title`, `var w int = window.innerWidth`, `if window == nil {…}` all compile. Uses in `example/*/src`: `document.` 29, `localStorage.` 8, `JSON.` 7, `requestAnimationFrame(` 4, `fetch(` 1; stdlib files touching WebIDL host globals: `stdlib/gom/gom.go` (`document`), `stdlib/time/sleep_js.go` (`setTimeout`/`clearTimeout`, passing `float64` timeout and Go `any` id). `stdlib/regexp/regexp.go` touches only excluded ES `RegExp`; `stdlib/crypto/rand/rand.go` and `stdlib/math/math.go` use `//gofront:intrinsic`. Four unit/conformance tests use fake properties on `window`/`document` to test JS-dynamic `any`: `test/unit/fixtures/conformance/accept/browser_global_dynamic_use.go`, `builtin_len_js_dynamic.go`, `test/unit/types/dynamic-types.test.js:1629,1643`, `test/unit/types/checks.test.js:809` |
| Built-in WebGPU types | `GPUQueue`, `GPUDevice`, `GPUAdapter` are hand-built structural types (`src/typechecker/stdlib/web.js:299`, `:408`, `:419`, `:430`); `x.(GPUDevice)` compiles to a runtime check needing both upper- and lower-case method names, so every standard device fails it | Re-probe: `dev := raw.(GPUDevice)` → `raw != null && typeof raw.CreateBuffer === "function" && … && typeof raw.createBuffer === "function" …`. Existing tests referencing `GPUDevice`: `test/unit/types/webgl.test.js:193-207`, `test/unit/fixtures/conformance/reject/assign_web_type_names.go:7` |
| `.d.ts` path | Has pass-through assertions from `any`, closed members, properties and line:col on member/arity errors, but lacks inheritance, assertions from resolved `.d.ts` interface types, optional parameters, nullable primitive unions (`T \| null`), `Promise<T>`, arrow-function types, qualified `.d.ts` type references (`pkg.T`), dictionary arguments and integer types | Re-probe: `interface Child extends Base` → `No member 'id' in namespace Child` and `Cannot assign Child to Base`; `func f(b Base) { _ = b.(Child) }` → `invalid type assertion: Base is not an interface` (`src/typechecker/expressions.js:1665`); `opt(a: number, b?: number)` called as `opt(1)` → `Too few arguments: expected 2, got 1`; `parseType` (`src/dts-parser.js:284`) discards `\| null` on `string \| null`, so `_isNilless` (`src/typechecker/assignability.js:692`) rejects `localStorage.getItem("todos") == nil`; `_parseParenType` (`src/dts-parser.js:292`) discards `(a: T) => R` and returns `ANY` (and `example/preact/src/preact.d.ts:27` declares `effect: () => undefined \| (() => void)`, which parses `undefined` as `nil` and would reject `useEffect(func() {…})` if callback return `nil` does not accept `void`); `_parseNamedType` (`src/dts-parser.js:323`) discards `.B` in `A.B`. 2026-11-13: dictionary literals rejected (`Cannot assign map[string]any to Desc`), `number` always `float64` (`src/dts-parser.js`) |
| `gofront/*` resolution | Unknown `gofront/x` imports fall through `resolveAll` (`src/resolver.js:146-153`) as untyped npm imports (warning + 0 errors) instead of an unsupported-package error | Re-probe (2026-11-19): `import "gofront/unknown"` → `warning: cannot find types for 'gofront/unknown', treating as any`, 0 compile errors |
| Member naming | Everything uses JS camelCase; PascalCase aliases exist only for the hand-built WebGL/WebGPU types | `WEB_PASCAL_ALIAS_TYPES` (`src/backend/js/expressions.js:377`) |
| Generator inputs | `@webref/idl`, `webidl2`, `typescript`, `@webgpu/types` are not installed | Re-probe: `ls node_modules/…` → all missing; `@webref/idl` + `webidl2` become devDependencies (user decision 2026-11-13) |
| Strictness hand-off | The checker keeps JS-dynamic `ANY` permissive (D3) and classifies it with `anyKind` (`src/typechecker/types.js:623`) | `checker-strictness-plan.md` D3, S27 (14 arithmetic-on-global sites in 4 example files) |

---

## Approach

### 1. Architecture & Design Decisions
- **Declaration form (user decision 2026-11-13):** generated `.d.ts`-form files under `stdlib/gofront/<pkg>/` (`dom`, `canvas`, `fetch`, `websocket`, `webgpu`), loaded through `parseDts` + `checker.addDefinitions` like a consumer's `js:./interop.d.ts`. Rejected: Go-syntax declarations with a new extern directive.
- **`.d.ts` path extensions (Phase 1):** interface inheritance (`extends`: inherited members visible, derived assignable to base; `.d.ts` interface/class `namespace` types are tagged so `_checkTypeAssertExpr` accepts `b.(Child)` and `el.(dom.HTMLInputElement)` as pass-through assertions without accepting GoFront package namespaces, and `expressions.js:279` still renames local variables named after browser globals when their type is a `.d.ts` interface); optional parameters (arity range); nullable types (`T | null` / `T | undefined` marked `_nullable: true` so `_isNilless` allows `raw == nil` on `string | null` while keeping `string` operations); `Promise<T>` results (`await` yields `T`, formatted and compared in `types.js`); arrow-function types `(a: T) => R` parsed to `func` types (a `.d.ts` callback parameter accepts a Go `func` with fewer parameters—matching JS callback invocation—a `void` return when the `.d.ts` return is `void`/`nil`/`any` such as Preact's `() => undefined | (() => void)`, and a parameter whose type is `any` or a derived `.d.ts` interface, so `func()`, `func(e dom.Event)` and `func(e dom.MouseEvent)` all pass to `addEventListener`, while unrelated parameter types like `func(int)` are rejected); qualified `.d.ts` type names (`pkg.T` kept in `alias`); GoFront integer and `float32` type names in declarations (`number` stays `float64`); dictionary arguments (an interface the generator marks as a dictionary accepts `nil`, a `map[string]any` literal whose constant keys are members—checked recursively for nested dictionaries—and a field-only struct whose fields are members). Consumer `.d.ts` files keep their behaviour apart from these additions.
- **Packages, scoping & lazy loading:** `import "gofront/dom"` exposes `dom.HTMLInputElement` and emits no runtime JS `import`; typed globals need no import. Each `gofront/*` declaration package keeps its own scoped type table (bare names like `webgpu`'s `Device`/`Buffer`/`Texture` do not pollute global `checker.types` or collide with user types); `resolveType` resolves intra-package `.d.ts` type references against the declaring package's table and cross-package references (e.g. `dom.EventTarget` for `WebSocket`/`webgpu.Device`) via qualified names. Declarations load lazily (first import or first use of a typed global), parsed once per process. Because `.sentrux/rules.toml` places `src/dts-parser.js` in `support` (order 1) and `src/typechecker/*` in `typechecker` (order 4), `compiler.js` injects the lazy loader callback into `TypeChecker` (or `dts-parser.js`, which has zero imports, moves to a higher-order layer) so `sentrux check` stays green. Unknown `gofront/<x>` imports produce an unsupported-package error instead of falling through as untyped npm imports.
- **Generated, not hand-written:** `scripts/gen-web-types.js` (maintainers run it, output committed, `--check` in `npm run check`) reads WebIDL with `webidl2`; spec → package map, renames and fixes live in `scripts/web-types-overrides/`. The spec → package map covers all 41 WebIDL-defined `BROWSER_GLOBALS` (`dom` includes DOM/HTML/Events/UIEvents/Timers/Storage/Console/CSSOM/CSSOM-View/HR-Time/URL/FileAPI/Encoding/WebCrypto/IndexedDB; `fetch` includes Fetch + XHR `FormData`; `canvas` includes Canvas 2D; `websocket` includes WebSockets; `webgpu` includes WebGPU). Mapping: inheritance → `extends` (qualified when cross-package); mixins and partials merged; every integer IDL type → `int` (keeps `var w int = window.innerWidth` valid under the strict numeric rules); `double`/`float` → `float64`/`float32`; `DOMString`/`USVString` → `string`; nullable → nil-able (`| null`); unions, `any`, `object` → `any`; `sequence<T>` → `[]T`; `Promise<T>` kept; dictionaries → dictionary interfaces; enums → `string`; callbacks and event handlers → `func` types; constants and constructors.
- **Names:** members keep JS camelCase; type names are the WebIDL interface names, except `webgpu` drops the `GPU` prefix (`webgpu.Device`, `webgpu.CanvasContext`).
- **Typed globals (breaking):** every WebIDL-defined `BROWSER_GLOBALS` entry gets its generated type. Member chains are checked for the first time, so a specific element type needs a downcast: `document.getElementById("q").(dom.HTMLInputElement).value`; `HTMLCanvasElement.getContext` returns a union asserted to `canvas.CanvasRenderingContext2D`, `webgpu.CanvasContext` or `WebGL2RenderingContext`. Typed members follow every strict rule; what stays `any` (ES built-ins, IDL unions/`any`/`object`, `.d.ts` `any`, WebGL tables) keeps D3 permissiveness through `anyKind === "dynamic"`.
- **Migration order:** stdlib files and `example/*` are rewritten to compile under both untyped and typed globals first (assertions to declared interfaces are pass-throughs either way), then the globals flip, so every commit builds.
- **WebGPU:** `gofront/webgpu` replaces the hand-built `GPUDevice`/`GPUQueue`/`GPUAdapter` and their `WEB_PASCAL_ALIAS_TYPES` entries; assertions are typed pass-throughs, never structural runtime checks; the old names are removed outright.
- **Rename set unchanged:** retyping `BROWSER_GLOBALS` changes the types of its entries, never its membership, so `shadowsJsGlobal` and `test/unit/compiler/js-globals.test.js` are unaffected.

### 2. Invariants & Safety Bounds
- Typed web is free unless used: generated declarations emit no runtime code and are not loaded for a program that uses no Web API.
- Zero runtime dependencies: `@webref/idl` and `webidl2` are devDependencies used only by the generator; output is committed under `stdlib/` (shipped), `scripts/` is not.
- Every new `src/**/*.js` and `stdlib/**/*.go` file is covered by `.sentrux/rules.toml` (generated `.d.ts` files under `stdlib/gofront/` are not `.go` files and must not add a dead glob to `.sentrux/rules.toml`).
- Typed globals stay comparable to `nil` (`if window == nil`) so packages stay testable under `gofront test` without a DOM.

### 3. Edge Cases & Error Handling
- Code breaks where it reads a member the static type lacks, relies on a custom `window` property, or passes a wrong type; the fix is a downcast or a `.d.ts` declaration; `docs/` migration section with before/after examples.
- A WebGPU test double implementing only some `webgpu.Device` members is still assertable to the interface.
- A dictionary literal with an unknown key or a struct with an unknown field is rejected naming the member; a derived interface is assignable to its base but not the reverse without an assertion; an optional parameter may be omitted but extra arguments are rejected; a `gofront/*` import from a `wasm`/`both` package is a clear error.
- A consumer `interop.d.ts` keeps working (escape hatch for libraries such as PeerJS); event listeners take typed parameters (`func(e dom.MouseEvent)`).

---

## Implementation Tasks

> Split from the former `web-platform-evolution-plan.md` Phases 6–7 (re-probed 2026-11-17). Former task IDs in parentheses.

### Phase 1: `.d.ts` path extensions
- [x] Task 1.1: Interface inheritance and `.d.ts` interface assertions (former 6.1)
  - Files: `src/dts-parser.js`, `src/typechecker/assignability.js`, `src/typechecker/expressions.js`, `src/typechecker/resolve.js`
  - Test: `test/unit/types/dts-extends.test.js`: inherited members over one and two levels; `Child` assignable to `Base`; `Base` to `Child` rejected without assertion; `b.(Child)` on a resolved `Base` parameter (`func f(b Base)`) compiles as a pass-through (while a GoFront package namespace assertion `fmt.(int)` stays rejected); local variable named after a browser global with a `.d.ts` interface type still gets `$`-renamed; member errors carry line:col
  - Done when: inheritance and `.d.ts` interface assertions pass and existing `.d.ts` tests pass unchanged
- [ ] Task 1.2: Optional parameters, nullable unions, `Promise<T>`, function types and integer types (former 6.2)
  - Files: `src/dts-parser.js`, `src/typechecker/expressions.js`, `src/typechecker/assignability.js`, `src/typechecker/types.js`
  - Test: `test/unit/types/dts-optional.test.js`: `opt(1)` and `opt(1, 2)` compile, `opt()` and `opt(1, 2, 3)` are rejected (with line:col); `string | null` return compares to `nil` (`raw == nil`) and works as `string`; `await` on `Promise<Response>` is `Response` (`Promise<void>` is `void`); `int`, `uint32`, `float32` accepted; arrow-function types `(e: Base) => void` and `() => undefined | (() => void)` parse to `func` types and accept `func()`, `func(any)`, `func(Base)` and `func(Child)` while rejecting `func(int)`
  - Done when: optional params, nullable primitives, `Promise<T>`, integer/`float32` types and `.d.ts` callback types all type-check and `node src/index.js check example/...` (including `example/preact`) passes
- [ ] Task 1.3: Dictionary arguments (former 6.3)
  - Files: `src/dts-parser.js`, `src/typechecker/assignability.js`
  - Test: `test/unit/types/dts-dictionary.test.js`: a dictionary parameter accepts `nil`, a `map[string]any` literal with member keys (including nested dictionary literals) and a field-only struct; unknown key or field is an error naming it; a wrong member type is rejected; an unmarked interface behaves as today
  - Done when: the marker syntax is documented in `src/dts-parser.js`

### Phase 2: Declaration packages and the generator
- [ ] Task 2.1: Scoped `.d.ts` package namespaces and cross-package type resolution (former 6.4a)
  - Files: `src/dts-parser.js`, `src/typechecker/index.js`, `src/typechecker/resolve.js`, `src/typechecker/types.js`
  - Test: `test/unit/compiler/web-packages.test.js`: registering a scoped declaration package exposes `dom.T` without polluting global `checker.types` (a user `type Buffer struct{}` does not collide with `webgpu.Buffer`); intra-package and qualified cross-package (`dom.EventTarget`) `.d.ts` type references resolve in members, `extends` and assertions
  - Done when: package-scoped `.d.ts` types resolve intra- and cross-package without bare-name leakage
- [ ] Task 2.2: `gofront/*` declaration package resolution and lazy loading (former 6.4b)
  - Files: `src/compiler.js`, `src/resolver.js`, `src/typechecker/index.js`
  - Test: `test/unit/compiler/web-packages.test.js` with a fixture declaration directory (`options.stdlibRoot`): `import "gofront/dom"` loads lazily, parsed at most once per process, and emits no JS `import`; import from `wasm`/`both` is a clear error; unknown `gofront/x` produces an unsupported-package error (not an untyped npm warning); a `println`-only program loads no declaration file (counter); `sentrux check` passes with no layer violation
  - Done when: `gofront/*` declarations are parsed at most once per process and loaded only when used
- [ ] Task 2.3: The web-types generator (former 6.5)
  - Files: `scripts/gen-web-types.js`, `scripts/web-types-overrides/`, `package.json`, `biome.json`
  - Test: `test/unit/cli/gen-web-types.test.js`: deterministic output for a small IDL fixture (inheritance including cross-package, mixin, partial, optional and nullable members, union, dictionary, enum, callback, `Promise`, constant, constructor)
  - Done when: `@webref/idl` and `webidl2` are pinned devDependencies; two runs are byte-identical; `npm run check` runs `--check`; the mapping table is in the script header; generated files pass (or are excluded from) Biome

### Phase 3: Generated web packages
- [ ] Task 3.1: `gofront/dom` (former 7.1)
  - Files: `stdlib/gofront/dom/dom.d.ts` (generated), `scripts/web-types-overrides/`
  - Test: `test/unit/stdlib/dom-typed.test.js`: `Document`, `Element`, `HTMLElement`, `HTMLInputElement`, `Event`, `MouseEvent`; `addEventListener("click", func(e dom.MouseEvent) {…})` and `addEventListener("click", func() {…})`; a misspelled member is rejected; emitted JS equals the untyped program's
  - Done when: `el.(dom.HTMLInputElement).value` is a `string`
- [ ] Task 3.2: `gofront/canvas`, `gofront/fetch`, `gofront/websocket` (former 7.2)
  - Files: `stdlib/gofront/canvas/canvas.d.ts`, `stdlib/gofront/fetch/fetch.d.ts`, `stdlib/gofront/websocket/websocket.d.ts` (generated)
  - Test: `test/unit/stdlib/web-apis-typed.test.js`: canvas drawing calls without `any`; `var resp fetch.Response` / `resp := (await fetch(url)).(fetch.Response)` (global `fetch` flips in Phase 4) with `resp.ok` and `await resp.text()`; a `websocket.WebSocket` with `send` and a typed listener
  - Done when: the packages come from the generator and emit no runtime code
- [ ] Task 3.3: `gofront/webgpu`; remove the hand-built GPU types (former 7.3)
  - Files: `stdlib/gofront/webgpu/webgpu.d.ts` (generated), `src/typechecker/stdlib/web.js` (`createWebGPUMethods` and the `GPUQueue`/`GPUDevice`/`GPUAdapter` entries), `src/backend/js/expressions.js` (`WEB_PASCAL_ALIAS_TYPES`)
  - Test: `test/unit/stdlib/webgpu-typed.test.js` (and update `test/unit/types/webgl.test.js` and `test/unit/fixtures/conformance/reject/assign_web_type_names.go` to drop the removed `GPUDevice` cases): `webgpu.CanvasContext`, `webgpu.Buffer`, `webgpu.Texture`, `device.createRenderPipeline(descriptor)` with a dictionary; a test double with only standard lowercase members passes `x.(webgpu.Device)` at run time; a misspelled member fails `gofront check`; `GPUDevice` is an unknown type
  - Done when: SimpleFPS-style code can drop its `WebGPUDevice`/`GPUCanvasContext` interfaces and existing unit tests pass

### Phase 4: Migration and typed globals
- [ ] Task 4.1: Migrate Go-source stdlib ahead of the flip (former 7.4a)
  - Files: `stdlib/gom/gom.go`, `stdlib/time/sleep_js.go`
  - Test: `test/unit/builtins/gom.test.js`, `test/unit/builtins/dom.test.js`, `test/unit/stdlib/time.test.js`, passing on this commit (globals still `any`) and on Task 4.3
  - Done when: `stdlib/gom/gom.go` (unchanged emitted JS) and `stdlib/time/sleep_js.go` (`setTimeout` integer timeout and `clearTimeout` id) are valid against both untyped and generated global types
- [ ] Task 4.2: Migrate the examples ahead of the flip (former 7.4b)
  - Files: `example/*/src`
  - Test: the example `_test.go` files (`gofront test --dom example/...`) and `node src/index.js check example/...`, passing on this commit (globals still `any`) and on Task 4.3
  - Done when: every member chain on a Web API global in `example/` (including `_test.go` `children.item(0)`, attribute integer parsing and the S27 arithmetic sites under the strict numeric rules) is valid against both untyped and generated global types, and `.d.ts` interface assertions emit no runtime checks
- [ ] Task 4.3: Type the browser globals (former 7.5)
  - Files: `src/typechecker/types.js` (`BROWSER_GLOBALS`), `src/typechecker/stdlib/index.js`, `docs/usage.md`
  - Test: `test/unit/types/browser-globals.test.js` (and update the 4 JS-dynamic `any` tests in `test/unit/fixtures/conformance/accept/browser_global_dynamic_use.go`, `builtin_len_js_dynamic.go`, `test/unit/types/dynamic-types.test.js:1629,1643` and `test/unit/types/checks.test.js:809` to read from an excluded ES built-in instead of fake `window`/`document` properties): `document.getElementById("x")` is typed; `resp := await fetch(url)` is `fetch.Response`; a misspelled member is rejected; `window == nil` compiles; `var w int = window.innerWidth` compiles while `var f float64 = window.innerWidth` and `window.innerWidth * 0.5` are rejected; `JSON.stringify` and arithmetic on `Math.random()` stay permissive (`anyKind === "dynamic"`); a `println`-only program loads no declaration file; `js-globals.test.js` unchanged; all `example/*` build with unchanged emitted JS relative to Task 4.2 and `npm run test:e2e` passes
  - Done when: no WebIDL-defined `BROWSER_GLOBALS` entry is `ANY`; the 18 ES built-ins that stay `any` are listed in `Excluded: deferred`; `docs/usage.md` has the migration section
