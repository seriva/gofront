# Typed Web Platform & `.d.ts` Fixes — Design Plan

**Version:** v2.0.0  
**Status:** In Progress  
**Base branch:** main  
**Related:** Scheduled from `plans/follow-ups.md` on 2026-11-24 (`/bs-plan`): the 7 review follow-ups logged by [`typed-web-platform-plan.md`](typed-web-platform-plan.md) Phases 1–4 (PRs #316–#319). Independent of [`multi-package-fixes-plan.md`](multi-package-fixes-plan.md), [`wasm-codegen-fixes-plan.md`](wasm-codegen-fixes-plan.md), [`generics-and-aliases-plan.md`](generics-and-aliases-plan.md), and [`js-codegen-and-value-semantics-plan.md`](js-codegen-and-value-semantics-plan.md) except shared checker edits in `src/typechecker/expressions.js` and `src/typechecker/index.js` (rebase if run in parallel).  
**Release note:** Slices of typed browser and WebGPU values such as `[]webgpu.CommandBuffer`, `[]webgpu.ColorTargetState` and `[]dom.Node` now type-check cleanly, `fmt.Sprintf("%T", …)` and assertion panics print their real type names instead of `[]interface {}`, and storing a browser function such as `console.log` in a variable no longer clones arguments or breaks variadic spreads. **Breaking:** Browser and WebGPU parameters and descriptor members that take a list now need a slice of their element type instead of `[]any` (write `queue.submit([]webgpu.CommandBuffer{cmd})` and `"targets": []webgpu.ColorTargetState{map[string]any{...}}`); invalid operations on typed browser values (`window + 1`, `el[0]`, `for range el`, `if el`, `fetch.Response{}` and `fetch.Response.clone`) and unused imports shadowed by a universe global in another file are now compile errors, so use `== nil`, a type assertion, or the runtime global instead.

---

## Goal

Close the `.d.ts` type-resolution, parser, soundness, runtime-type-name, and JS-interop gaps left after `typed-web-platform-plan.md` so real WebGPU and DOM programs (notably SimpleFPS: `dev.queue.submit([]webgpu.CommandBuffer{...})`, `dev.createRenderPipeline(...)` with `targets: []webgpu.ColorTargetState{}`) compile and run cleanly, and tighten the remaining permissive `.d.ts` holes before v2.0.0 ships (fixing them later would be breaking).

**Done means:**
- Every failing row in *Verified Gaps* passes: WebGPU `dev.queue.submit([]webgpu.CommandBuffer{enc.finish()})`, `dev.createBindGroupLayout(map[string]any{"entries": []webgpu.BindGroupLayoutEntry{}})` and `dev.createRenderPipeline(...)` with `"targets": []webgpu.ColorTargetState{...}` compile with 0 errors (`test/unit/compiler/web-packages.test.js`, `test/unit/types/dts-extends.test.js`, `test/unit/types/dts-dictionary.test.js`, `test/unit/stdlib/webgpu-typed.test.js`).
- `[]any` passed to a `.d.ts` array parameter or dictionary member (`submit([]any{cmd})`, `"targets": []any{...}`) is rejected with Go's `cannot use ... as []webgpu.X value` (T1.6; user decision 2026-11-24: breaking, no interop exception), and `test/unit/stdlib/webgpu-typed.test.js:59` is migrated to the typed slice.
- Invalid operations on `.d.ts` values (indexing, slicing, calling, `len`/`cap`/`append`/`delete`, deref, `for range`, `if`/`for` cond, arithmetic, ordering, logical, unary, constant equality, composite literals `fetch.Response{}`, and type-ref member selectors `fetch.Response.clone`) and unused sibling-shadowed imports are rejected with clear diagnostics (`test/unit/types/browser-globals.test.js`, `test/unit/compiler/imports.test.js`).
- `fmt.Sprintf("%T", …)` and failed type assertions print real `.d.ts` type names (`dom.Element`, `[]dom.Node`, `[]webgpu.Device`) instead of `""` or `[]interface {}`; stored browser functions (`fn := console.log`) preserve receiver binding, do not clone aggregates, and spread variadics with `...xs` (`test/unit/compiler/web-packages.test.js`).
- `npm test`, `npm run check`, and `npm run test:e2e` pass with zero regressions across `example/` and `stdlib/`.
- `docs/usage.md` *Typed browser globals* → *Migrating an existing program* lists the new fixes (typed slices instead of `[]any`, `!= nil` instead of `if el`, assert before indexing).

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Root `dts-unresolved-alias-leak` + `namespace-missing-notrangeable`: resolve `.d.ts` aliases recursively through composite types and at every expression boundary, and reject `for range` on `.d.ts` namespaces | `Plain[]`, `[]webgpu.CommandBuffer`, `[]dom.Node`, `Promise<Plain[]>`, `(xs: Plain[]) => void`, dictionary member `entries: BindGroupLayoutEntry[]`, `el[0]`, `for range el`, `if el`; `[]any` → `[]webgpu.X` rejected per Go (breaking, user decision) | |
| **In scope: core** | Root `dts-paren-type-collapses-non-func`: preserve parenthesised non-function types in `DtsParser._parseParenType` | `(ColorTargetState \| null)[]`, `(string \| null)[]`, `((T \| null))[]`, `(Foo)` | |
| **In scope: core** | Roots `dts-type-accepted-as-value`, `import-used-universe-fallback`, `namespace-operand-kind-loose`: reject `.d.ts` types in composite literals and value selectors, track import usage per file without `universe._used` fallback, and classify `.d.ts` namespaces out of `"loose"` in operators and untyped-constant conversion | `fetch.Response{}`, `Plain{}`, `fetch.Response.clone`, `import "gofront/fetch"` + sibling `fetch(...)`, `window + 1`, `w == 1`, `!w` | |
| **In scope: target-specific** | Roots `dts-type-name-missing-namespace`, `dts-func-value-treated-as-go-variadic` (`js` only): spell `.d.ts` namespace types in `goTypeName`/`FmtGen`/`gofront_gen.go` and tag `.d.ts` functions with `_hostFunc` so stored browser func values bind `this`, skip aggregate cloning, and use JS spreads | `goTypeName`, `FmtGen`, `fn := console.log; fn(p)`, `fn(xs...)`, `fn := document.createElement` | `.d.ts` and browser globals exist only in `js` packages |
| **Excluded: runtime / platform** | `.d.ts` or browser global types in `wasm` / `both` packages | `import "gofront/webgpu"` in `wasm` | Browser WebIDL APIs are JS-host only; already rejected by package target rules |
| **Excluded: deferred** | Package-level `type` named like a declaration import breaking `_useQualifiedTypeName` (L116) | `import "gofront/fetch"; type fetch int; func g(r fetch.Response)` | Separate symbol-shadowing root in `_useQualifiedTypeName`; low-impact edge case deferred to post-2.0.0 |
| **Excluded: deferred** | `JsonCodecGen` serialization of `.d.ts` namespace values | `json.Marshal(dom.Element)` | Host DOM/WebGPU objects are not Go structs; `TypeSpeller.spellable` keeps `namespace` unspellable for `JsonCodecGen` |

---

## Verified Gaps & Baseline Audit

**Method.** Read-only code inspection and `node --input-type=module -e` probes against `test/unit/helpers.js` on `main` (`dda372c4`, 2026-11-24; re-probed by `/bs-plan review` on `2822e9a7` (after gom-signals), same results except where a row says otherwise; line numbers below are as of `2822e9a7`). All 6 `example/` apps compile with 0 errors and were audited for compatibility (all null checks use `== nil`/`!= nil`; `stdlib/gom/gom.go` already uses `Object(el)[...]`).

### T1 `dts-unresolved-alias-leak`, `namespace-missing-notrangeable` (L112)
Roots:
1. `DtsParser._parseNamedType` (`src/dts-parser.js:406-422`) emits `{ kind: "basic", name: "any", alias: qualified }`. `TypeChecker.resolveType` (`src/typechecker/resolve.js:1616-1637`) only resolves top-level `basic.alias` and never descends into `slice.elem`, `promise.elem`, `func.params`/`returns`, `tuple.types`, `array.elem`, `map.key`/`value`, or `pointer.base`. Expression boundaries (`Ident` at `src/typechecker/expressions.js:317-320, 410`, `_fieldTypeNamespace` at `src/typechecker/resolve.js:1968-1993`, and `_checkCallExpr` return at `src/typechecker/expressions.js:2722-2725`) return raw `.d.ts` types without calling `resolveType`. Because an unresolved `basic.alias` has `kind: "basic", name: "any"` and no `_declared`, `anyKind(t)` (`src/typechecker/types.js:647-658`) treats it as JS-dynamic `any`. Assignability paths reach the same leak: `.d.ts` dictionary members come raw from `_dictionaryMember` (`src/typechecker/assignability.js:1128-1131`) into `_checkDictionaryLiteral` / `_checkDictionaryStruct`, both of which end in `assertAssignable`, which already calls `this.resolveType(target)` (`:1048`). The recursive `resolveType` therefore fixes the call-argument and dictionary-member paths at that one site, with no per-path change.
2. `_notRangeable` (`src/typechecker/expressions.js:2050-2066`) checks `struct | interface | pointer` (line 2064) and omits `namespace`, so even resolved `dom.Element` / `dom.HTMLCollection` values pass `for range el {}`.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| T1.1 (L112 repro) | `var xs []Plain = getPs()`; `takePs([]Plain{})`; `dev.queue.submit([]webgpu.CommandBuffer{enc.finish()})`; `var xs []dom.NotRestoredReasons = n.children` | 0 errors | `cannot use ... (value of type []T) as []T value` |
| T1.2 *sibling* | `var xs []Plain = await getProm()` (`Promise<Plain[]>`); `takeCb(func(xs []Plain) { _ = xs })`; `var xs []Plain = plainArr` (`declare const plainArr: Plain[]`); dictionary member (review, `2822e9a7`): `dev.createBindGroupLayout(map[string]any{"entries": []webgpu.BindGroupLayoutEntry{}})` | 0 errors | same `[]Plain` vs `[]Plain` assignability error; dictionary: `cannot use []webgpu.BindGroupLayoutEntry{} (value of type []webgpu.BindGroupLayoutEntry) as []webgpu.BindGroupLayoutEntry value in member entries of dictionary webgpu.BindGroupLayoutDescriptor` |
| T1.3 (L112 repro) | `el := document.getElementById("x"); _ = el[0]; _ = el[0:1]; el(); _ = len(el); for range el {}; if el {}` and `p := getP(); _ = p[0]; p(); _ = len(p); _ = cap(p); _ = append(p, 1); delete(p, "k"); _ = *p; _ = p.(int)` | compile error on every op | `0 errors` on all |
| T1.4 *sibling* | `p := getPs()[0]; _ = p[0]; p(); if p {}`; `plainVal` ops (`plainVal[0]`, `plainVal()`, `if plainVal {}`) | compile error on every op | `0 errors` |
| T1.5 *sibling* | `func f(el dom.Element) { for range el {} }`; `func f(ch dom.HTMLCollection) { for range ch {} }` | compile error (`cannot range over`) | `0 errors` |
| T1.6 *compat (breaking, review 2026-11-24)* | `dev.queue.submit([]any{enc.finish()})`; `dev.createBindGroupLayout(map[string]any{"entries": []any{map[string]any{"binding": 0}}})`; `"targets": []any{map[string]any{"format": "bgra8unorm"}}` (`test/unit/stdlib/webgpu-typed.test.js:59`; SimpleFPS `backend.go:222,441` and `[]any` `targets`/`buffers`/`layouts`/`colors`) | `cannot use ... (value of type []any) as []webgpu.X value` (Go slice identity; user chose breaking, no interop exception) | `0 errors` (member typed `[]any` via the unresolved alias / `_parseParenType` → `ANY`) |
| control | `p := await getPromP(); _ = p[0]; p(); if p {}`; `var p Plain = getSub()`; `func f(el dom.Element) { _ = el[0]; el(); if el {} }`; migration form `[]webgpu.ColorTargetState{map[string]any{"format": "x"}}` (0 errors) and `...{map[string]any{"formt": "x"}}` (`unknown member 'formt' in dictionary webgpu.ColorTargetState`) | rejected / 0 errors / rejected / 0 errors / error | passes (must stay) |

### T2 `dts-paren-type-collapses-non-func` (L114)
Root: `DtsParser._parseParenType` (`src/dts-parser.js:373-393`, line 385) executes `return inner.kind === "func" ? inner : ANY;`, discarding non-function parenthesised types. Five declarations in `stdlib/gofront/webgpu/webgpu.d.ts` (lines 327, 395, 497, 530, 777) use `(T | null)[]`.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| T2.1 (L114 repro) | `dev.createRenderPipeline(map[string]any{..., "fragment": map[string]any{"module": mod, "targets": []webgpu.ColorTargetState{}}})` | 0 errors (with T1) | `cannot use []webgpu.ColorTargetState{} as []any value in member targets` |
| T2.2 *sibling* | `parseDts`: `(ColorTargetState \| null)[]`, `(string \| null)[]`, `((ColorTargetState \| null))[]`, `(Foo)`, `(string \| number)[]` | preserve inner type (and `_nullable` where `\| null`) | all collapse to `ANY` / `[]any` |
| control | `((x: number) => void)[]`; `(() => void) \| null` | slice of func; nullable func | passes (must stay) |

### T3 `dts-type-accepted-as-value` (L115)
Root: two sites in `src/typechecker/expressions.js`: (1) `_isInvalidLiteralType` (`:3287-3294`) whitelists `"namespace"`, so composite literals of `.d.ts` types fall through to `_checkUnknownCompositeLit` and emit `[]`. The elided form never reaches that check: `_isInvalidLiteralType` returns `false` when `!expr.typeExpr` (`:3289`), and `checkCompositeLit`'s elided guard (`:3303`) only rejects `basic` hints, so `[]dom.Element{{}}` and `map[string]dom.Element{"a": {}}` also pass; (2) `_checkSelectorExpr` (`:1090-1102`) skips the field-of-type rejection when `expr.expr._isTypeRef && baseType.kind === "namespace"`, falling through to `this.fieldType(baseType, expr.field, expr)`.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| T3.1 (L115 repro) | `_ = fetch.Response{}`; `_ = fetch.Response.clone` | compile errors (`invalid composite literal type` / `(type) is not an expression`) | `0 errors`; emits `[];` and `Response.clone;` |
| T3.2 *sibling* | `_ = dom.Element{}`; `_ = &dom.Element{}`; elided `_ = []dom.Element{{}}` and `_ = map[string]dom.Element{"a": {}}` (review, `2822e9a7`); `_ = webgpu.BufferDescriptor{}` (dictionary: built with `map[string]any`, never a composite of the type); local `.d.ts` `_ = Plain{}`; `_ = webgpu.Device.createBuffer`; `_ = dom.Element.tagName`; `_ = dom.Element.remove` | compile errors | `0 errors` |
| control | `_ = Response` (universe global var); `_ = fetch.Response` (bare type); `fetch.Response(nil)`; `(*fetch.Response).clone`; `strings.Builder{}`; `declare namespace N { interface T {} }` | 0 errors / error / error / error / 0 errors / 0 errors | passes (must stay) |

### T4 `import-used-universe-fallback` (L117)
Root: `TypeChecker._importUsed` (`src/typechecker/index.js:466-470`) returns `this._fileScope(filename)._used.has(name) || this.universe._used.has(name)`. All four `trackImport` call sites (`src/resolver.js:252`, `src/link/stdlib.js:696`, `src/compiler.js:732`, `src/typechecker/index.js:315`) bind imports in `_fileScope(filename)`; `gofront/shared` and `gofront/simd` are never passed to `trackImport`. The `universe._used` fallback causes a sibling file's use of a universe builtin/global to suppress unused-import errors in `a.go`.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| T4.1 (L117 repro) | `a.go`: `import len "./sub"` + `b.go`: `println(len("abc"))`; `a.go`: `import "gofront/fetch"` + `b.go`: `_ = fetch("/x")` | `'len'` / `'fetch' imported and not used` | `0 errors` |
| T4.2 *sibling* | `a.go`: `import console "./sub"` + `b.go`: `console.log("hi")` | `'console' imported and not used` | `0 errors` |
| control | `a.go`: `import "gofront/fetch"; func A(r fetch.Response) bool { return r.ok }`; `a.go`: `import len "./sub"; _ = len.F()`; `gofront/simd` & `gofront/shared` | `0 errors` | passes (must stay) |

### T5 `namespace-operand-kind-loose` (L118)
Root: `operandKindOf` (`src/typechecker/operators.js:74-104`) has no `case "namespace":`, returning `"loose"` (which `operatorDefined` at `:132` allows for every operator). Cooperating omission: `CONST_REJECTING_KINDS` (`src/typechecker/assignability.js:57-65`) omits `"namespace"`, so `_convertUntypedConst` (`:812`) accepts `w + 1`, `w == 1`, `w == "x"`, `w && true`.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| T5.1 (L118 repro) | `_ = window + 1`; `import "gofront/dom"; func f(w dom.Window) { _ = w + 1 }` | invalid-operation compile error | `0 errors` |
| T5.2 *sibling* | `w + w`, `w - 1`, `w * 2`, `w < w`, `w == 1`, `w == "x"`, `w && true`, `w || false`, `!w`, `-w`, `+w`, `^w`; compound `w += 1` (review, `2822e9a7`; same operator-typing path) | compile error on every op | `0 errors` on all |
| control | `window == nil`, `w != nil`, `w == w2`, `e == n` (`extends`), `w == d` (mismatch error), `w << 1` (error), `1 << w` (error), `w++` (`non-numeric type dom.Window`), `switch w { case 1: }` (`cannot convert 1`), `map[dom.Element]int{}` key | 0 errors / 0 errors / 0 errors / 0 errors / error / error / error / error / error / 0 errors | passes (must stay) |

### T6 `dts-type-name-missing-namespace` (L113)
Root:
1. `goTypeName` (`src/backend/shared/fmt-types.js:55-131`) returns `"interface {}"` for `basic` with `name === "any"` (ignoring `t.alias`) and has no `case "namespace":`.
2. `FmtGen.typeName` (`src/lower/fmt-formatters.js:201-242`) and `FmtGen.key` (`:172-190`) have no `namespace` case, while `TypeSpeller.spellable` (`src/lower/gen-types.js:329-332`) returns `true` for unresolved `basic.alias` (emitting `[]any` + `__ity(x, "[]interface {}")`) and `false` for `namespace` (so once T1 resolves `e.children` to `[]dom.Node`, `fmt.Sprintf("%T", …)` falls back to `""`!).

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| T6.1 (L113 repro) | `var a any = e.children; _ = a.([]webgpu.Device)`; `fmt.Sprintf("%T", n.children)` | panic `is []dom.Node, not []webgpu.Device`; `"[]dom.NotRestoredReasons"` | panic `is []interface {}, not []interface {}`; `"[]interface {}"` |
| T6.2 *sibling* | `fmt.Sprintf("%T", el)`, `[]dom.Element{}`, `map[string]dom.Element{}`, `&el`, and boxed `var a any = e.children; fmt.Sprintf("%T", a)` | `"dom.Element"`, `"[]dom.Element"`, `"map[string]dom.Element"`, `"*dom.Element"`, `"[]dom.Node"` | `""` (empty string!) for resolved namespace types |
| T6.3 *sibling* | `goTypeName` on `Namespace(webgpu.Device)`, `[]Namespace(webgpu.Device)`, and `[]basic.alias("gofront/dom.Node")` | `"webgpu.Device"`, `"[]webgpu.Device"`, `"[]dom.Node"` | `"interface {}"`, `"[]interface {}"`, `"[]interface {}"` |

### T7 `dts-func-value-treated-as-go-variadic` (L119)
Root: `.d.ts` function types created by `funcType` (`src/dts-parser.js:908-925`) / `markHostAny` (`:1016-1043`) carry no marker distinguishing them from Go variadic funcs. Consequently: (1) `_calleeIsBrowserApi` (`src/backend/js/expressions.js:1748-1754`) only inspects the AST callee expression (`console.log`), so `fn := console.log; fn(p)` triggers `_callerCopiesArg` (`:1731-1742`) → `fn(p.__clone())` / `fn(a?.slice())`; (2) `_calleeIsGoVariadic` (`:1709-1725`) wraps spreads in `{ __sp: xs }` instead of `...xs`; (3) `_isStdlibFuncValue` (`:1476-1509`) matches `ns._type.kind === "namespace"` for `_dtsType` globals and emits an 8-branch arity wrapper that throws at >8 arguments instead of `${base}.${member}.bind(${base})`. *Review note (2026-11-24):* an uncommitted working-tree edit on `main` (another session) already adds `ns._type._dtsType` to the `_isStdlibFuncValue` exclusion; if it has landed when Task 3.3 starts, treat that part as done per **Implementation** 1 and keep only the tests it lacks.

| ID | Program / Probe | Expected | Observed on `main` |
|---|---|---|---|
| T7.1 (L119 repro) | `fn := console.log; fn(p)` (`type P struct{ X int }`) | `console.log.bind(console)` and `fn(p)` | 8-branch wrapper + `fn(p.__clone())` |
| T7.2 *sibling* | `fn := console.log; fn(arr)` (`[2]int`); `xs := []any{1}; fn(xs...)`; `fn := window.setTimeout` (>8 args); `fn := document.createElement; fn("div")` | `fn(a)`, `fn(...xs)`, `.bind(...)` with no 8-arg limit | `fn(arr?.slice())`, `fn({ __sp: xs })`, 8-branch wrapper throwing at >8 args for rest-param members; fixed-arity members get `((__a0, __a1) => document.createElement(__a0, __a1))` (receiver kept, passes `undefined` for omitted optionals; review, `2822e9a7`) |
| control | direct `console.log(p)`; Go variadic `func keep(xs ...any); fn := keep; fn(p)`; `var fn func(...any) = console.log; fn(p)` | `console.log(p)`; `fn(__ifv(p))`; `fn(__ifv(p))` | passes (must stay) |

---

## Approach

### 1. Architecture & Design Decisions
- **T1 (`resolveType` & expression boundaries):** Extend `TypeChecker.resolveType(t, seen)` (`src/typechecker/resolve.js`) to resolve `basic.alias` recursively through `slice`, `promise`, `func`, `tuple`, `array`, `map`, and `pointer` (preserving `_nullable`, `_hostAny`, `_hostFunc`, `variadic`, and returning `t` unchanged when no child changed so canonical `namespace` object identity required by `_dtsDerivesFrom` is preserved; stop at `namespace` without descending into `members`, and guard alias cycles with `seen`). Call `this.resolveType` on `.d.ts`-originated results in `Ident` (`src/typechecker/expressions.js`), `_fieldTypeNamespace` (`src/typechecker/resolve.js`), and `_checkCallExpr` return (`src/typechecker/expressions.js`). Call-argument and dictionary-member targets need no extra site: `assertAssignable` already resolves its target. Reject `u?.kind === "namespace"` in `_notRangeable` (`src/typechecker/expressions.js`). `[]any` → `[]<.d.ts type>` gets no interop exception (Go slice identity; user decision 2026-11-24).
- **T2 (`_parseParenType`):** In `src/dts-parser.js:_parseParenType` (line 385), return `inner` instead of `inner.kind === "func" ? inner : ANY`.
- **T3 (`.d.ts` type-as-value):** Remove `"namespace"` from `_isInvalidLiteralType` (`src/typechecker/expressions.js:3287-3294`), and make the literal-kind decision once for typed and elided literals: the elided guard in `checkCompositeLit` (`:3303`, `expr.typeExpr === null && hintType`) rejects a `namespace` hint as well as `basic`, so `[]dom.Element{{}}` fails with the same `invalid composite literal type dom.Element`. In `_checkSelectorExpr` (`:1090-1102`), when `expr.expr._isTypeRef && baseType?.kind === "namespace" && baseType._dtsType`, emit `${exprText(expr.expr)} (type) is not an expression` (leaving nested `declare namespace N` values unaffected via `!baseType._dtsType`).
- **T4 (`_importUsed`):** Drop `|| this.universe._used.has(name)` in `TypeChecker._importUsed` (`src/typechecker/index.js:466-470`).
- **T5 (`operandKindOf` & `CONST_REJECTING_KINDS`):** Return `"namespace"` in `operandKindOf` (`src/typechecker/operators.js`) and add `"namespace"` to `COMPARABLE_KINDS` (consistent with `_isComparable` in `resolve.js:1467-1491`, allowing JS reference equality `w == w2`, `e == n`, `w == nil` while rejecting `w + 1`, `w < w`, `!w`, `w && true`, `w == d`). Add `"namespace"` to `CONST_REJECTING_KINDS` (`src/typechecker/assignability.js`) so `w == 1` and `w == "x"` are rejected.
- **T6 (`goTypeName`, `FmtGen`, `gofront_gen.go`):** Add `case "namespace"` and `basic.alias` formatting to `goTypeName` (`src/backend/shared/fmt-types.js`). Reject `basic.alias` in `TypeSpeller.spellable` (`src/lower/gen-types.js`) so `JsonCodecGen` / `FmtGen` never silently spell an unresolved alias as `any`. In `FmtGen` (`src/lower/fmt-formatters.js`), add `namespace` to `key` and `typeName`, override `spellable`/`spell` for declaration-package `namespace` types (`t._pkg`) using `qualifierFor("gofront/" + t._pkg)`, emit `fmtrt.Arg{K: fmtrt.KInterface, T: ..., V: ...}` for leaf/local-`.d.ts` namespace values, and bind declaration packages in `checkGeneratedGo` (`src/link/stdlib.js`) so `gofront_gen.go` imports `"gofront/dom"` / `"gofront/webgpu"` cleanly.
- **T7 (`_hostFunc` & `.d.ts` method values):** Stamp `_hostFunc: true` (distinct from `_dts: true` used for callback assignability in `assignability.js:1818`) on function types built from `.d.ts` declarations in `src/dts-parser.js` (`funcType` / `markHostAny`). In `src/backend/js/expressions.js`, treat `ft?._hostFunc === true` as a browser API in `_calleeIsBrowserApi` and non-Go-variadic in `_calleeIsGoVariadic`; exclude `ns._type?._dtsType === true` from `_isStdlibFuncValue` and emit `${base}.${member}.bind(${base})` for `.d.ts` method values.

### 2. Invariants & Safety Bounds
- `resolveType` never clones `namespace` objects (preserving `ns === target` identity in `_dtsDerivesFrom`) and never enters `namespace.members` (avoiding infinite recursion on self-referential DOM interfaces like `Node.parentNode: Node`).
- `JsonCodecGen` continues to treat `namespace` types as unspellable (no generated JSON codecs for DOM/WebGPU objects).
- Explicit Go func types (`var fn func(...any) = console.log`) do not inherit `_hostFunc`, so Go interface boxing (`__ifv`) is preserved when converting to a Go function type.
- All 6 `example/` apps and `stdlib/` compile and pass E2E tests unchanged.

### 3. Edge Cases & Error Handling
- Self-referential `.d.ts` aliases (`type A = A`, `type A = A[]`) terminate via the `seen` guard in `resolveType`.
- `declare namespace N { interface T {} }`: `N` is a namespace qualifier (`!_dtsType`), so `N.T` in type position still resolves, while `N.T{}` and `N.T.field` are rejected because `T` has `_dtsType: true`.
- Bare browser globals like `Response` (a `var` in `universe`, not `_isTypeRef`) remain usable as values.
- `[]any{...}` passed where a `.d.ts` slice is expected (`submit`, `entries`, the five `(T | null)[]` members) becomes a Go mismatch error. The migration `[]webgpu.X{map[string]any{...}}` already type-checks, including dictionary-key checks on each element, and `nil` elements stay valid for the `| null` members (`[]webgpu.BindGroupLayout{nil}` compiles today).
- Direct `fmt.Sprintf("%T", localPlainVal)` (from a local `.d.ts` with no `gofront/*` package) prints `"Plain"` via `FmtGen`'s `fmtrt.Arg` fallback without trying to import an unimportable local `.d.ts` package into `gofront_gen.go`.

---

## Implementation Tasks

### Phase 1: `.d.ts` Alias Resolution & Parser Parenthesised Types (roots `dts-unresolved-alias-leak`, `namespace-missing-notrangeable`, `dts-paren-type-collapses-non-func`)
*Scheduled from review follow-ups (2026-11-24). Unblocks real WebGPU usage (`dev.queue.submit`, `dev.createRenderPipeline`).*
- [ ] Task 1.1: Resolve `.d.ts` aliases recursively in `resolveType`, resolve at expression boundaries, and reject `for range` on namespaces (T1.1–T1.5)
  - Files: `src/typechecker/resolve.js` (`resolveType`, `_fieldTypeNamespace`), `src/typechecker/expressions.js` (`Ident`, `_checkCallExpr`, `_notRangeable`)
  - Test: `test/unit/types/dts-extends.test.js`, `test/unit/types/browser-globals.test.js`, `test/unit/compiler/web-packages.test.js`: T1.1–T1.6 (`Plain[]`, `[]webgpu.CommandBuffer`, `[]dom.NotRestoredReasons`, `Promise<Plain[]>`, `(xs: Plain[]) => void`, `plainArr`, dictionary member `"entries": []webgpu.BindGroupLayoutEntry{}`, negative T1.6 `submit([]any{...})` / `"entries": []any{...}` asserting `as []webgpu.`, plus negative `assertErrorContains` cases for indexing, slicing, calling, `len`/`cap`/`append`/`delete`, deref, type assertion, `for range`, `if`/`for` on call/member results and resolved params) + controls
  - Done when: all T1.1–T1.2 cases compile with 0 errors, all T1.3–T1.6 cases fail with Go/GoFront diagnostics, and `example/` + `stdlib/` stay green
- [ ] Task 1.2: Preserve parenthesised non-function types in `DtsParser._parseParenType` (T2.1–T2.2)
  - Files: `src/dts-parser.js` (`_parseParenType`)
  - Test: `test/unit/types/dts-dictionary.test.js`, `test/unit/compiler/web-packages.test.js`, `test/unit/stdlib/webgpu-typed.test.js`: T2.2 (`(ColorTargetState | null)[]`, `(string | null)[]`, `((ColorTargetState | null))[]`, `(Foo)`, `(string | number)[]`, callback controls) and full WebGPU T2.1 `dev.createRenderPipeline(...)` with `targets: []webgpu.ColorTargetState{}`; migrate the existing `createRenderPipeline takes a dictionary` case (`webgpu-typed.test.js:59`, `"targets": []any{map[string]any{...}}`) to `[]webgpu.ColorTargetState{map[string]any{...}}` and add the `[]any` form as a negative case (T1.6), listed under `### Tests Changed`
  - Done when: all 5 parenthesised union array fields in `stdlib/gofront/webgpu/webgpu.d.ts` parse to their element types, `dev.createRenderPipeline` compiles with 0 errors, and `"targets": []any{...}` is rejected

### Phase 2: Checker Soundness for `.d.ts` Types, Operators & Unused Imports (roots `dts-type-accepted-as-value`, `import-used-universe-fallback`, `namespace-operand-kind-loose`)
- [ ] Task 2.1: Reject `.d.ts` types in composite literals and value member selectors (T3.1–T3.2)
  - Files: `src/typechecker/expressions.js` (`_isInvalidLiteralType`, `_checkSelectorExpr`)
  - Test: `test/unit/compiler/web-packages.test.js`, `test/unit/types/dts-dictionary.test.js`: negative `assertErrorContains` tests for `fetch.Response{}`, `dom.Element{}`, `&dom.Element{}`, elided `[]dom.Element{{}}` and `map[string]dom.Element{"a": {}}`, `webgpu.BufferDescriptor{}`, local `Plain{}`, `fetch.Response.clone`, `webgpu.Device.createBuffer`, `dom.Element.tagName`; controls for bare universe `Response`, `strings.Builder{}`, `declare namespace N`
  - Done when: every `.d.ts` type in composite-literal (typed or elided) or value-selector position fails at compile time with clear diagnostics
- [ ] Task 2.2: Restrict `_importUsed` to the importing file's scope (T4.1–T4.2)
  - Files: `src/typechecker/index.js` (`_importUsed`)
  - Test: `test/unit/compiler/imports.test.js`, `test/unit/compiler/web-packages.test.js`: T4.1 (`import len "./sub"` + sibling `len("abc")`, `import "gofront/fetch"` + sibling `fetch("/x")`), T4.2 (`import console "./sub"` + sibling `console.log`), plus controls (`fetch.Response` type-only use, same-file value use, `gofront/simd`/`gofront/shared`)
  - Done when: unused imports matching universe bindings are reported even when a sibling file uses the universe binding
- [ ] Task 2.3: Classify `.d.ts` namespaces out of `"loose"` in operators and untyped-constant conversion (T5.1–T5.2)
  - Files: `src/typechecker/operators.js` (`operandKindOf`, `COMPARABLE_KINDS`), `src/typechecker/assignability.js` (`CONST_REJECTING_KINDS`)
  - Test: `test/unit/types/browser-globals.test.js`, `test/unit/types/numeric-operands.test.js`: negative `assertErrorContains` tests for `window + 1`, `w + 1`, `w += 1`, `w + w`, `w - 1`, `w * 2`, `w < w`, `w == 1`, `w == "x"`, `w && true`, `w || false`, `!w`, `-w`, `+w`, `^w`; controls for `w == nil`, `w != nil`, `w == w2`, `e == n`, `w == d`
  - Done when: arithmetic, ordering, logical, unary, and constant-equality ops on `.d.ts` values fail at compile time while `nil` and same/derived-type reference equality keep passing

### Phase 3: Runtime Type Names & Stored Browser Func Values (roots `dts-type-name-missing-namespace`, `dts-func-value-treated-as-go-variadic`)
- [ ] Task 3.1: Format `.d.ts` namespace types and aliases in `goTypeName` and block unresolved aliases in `TypeSpeller.spellable` (T6.1, T6.3)
  - Files: `src/backend/shared/fmt-types.js` (`goTypeName`), `src/lower/gen-types.js` (`TypeSpeller.spellable`)
  - Test: `test/unit/compiler/web-packages.test.js`: unit assertions for `goTypeName` on `namespace`, `[]namespace`, and `basic.alias`, plus runtime assertion panic `a.([]webgpu.Device)` printing `not []webgpu.Device`
  - Done when: `goTypeName` never prints `interface {}` for `.d.ts` namespace types or aliases
- [ ] Task 3.2: Support `.d.ts` namespace types in `FmtGen` and bind declaration imports in `gofront_gen.go` (T6.1, T6.2)
  - Files: `src/lower/fmt-formatters.js` (`key`, `typeName`, `spellable`/`spell`, `describe`), `src/link/stdlib.js` (`checkGeneratedGo`)
  - Test: `test/unit/compiler/web-packages.test.js`: `fmt.Sprintf("%T", ...)` on `e.children`, boxed `var a any = e.children`, `el`, `[]dom.Element{}`, `map[string]dom.Element{}`, `&el`, and local `.d.ts` `Plain`, plus failed assertion `a.([]webgpu.Device)` printing `is []dom.NotRestoredReasons, not []webgpu.Device`
  - Done when: direct and `any`-boxed `fmt.Sprintf("%T", ...)` print the real `.d.ts` type names instead of `""` or `[]interface {}`
- [ ] Task 3.3: Tag `.d.ts` function types with `_hostFunc` and fix stored browser func values in JS codegen (T7.1–T7.2)
  - Files: `src/dts-parser.js` (`funcType`, `markHostAny`), `src/backend/js/expressions.js` (`_calleeIsBrowserApi`, `_calleeIsGoVariadic`, `_isStdlibFuncValue`)
  - Test: `test/unit/compiler/web-packages.test.js`, `test/unit/types/browser-globals.test.js`: `fn := console.log; fn(p)` (no `__clone`), `fn(arr)` (no `.slice`), `fn(xs...)` (`...xs`, no `__sp`), `fn := window.setTimeout` (>8 args / no 8-branch wrapper), `fn := document.createElement; fn("div")`; controls for Go variadic `fn := keep; fn(p)` and `var fn func(...any) = console.log`
  - Docs: `docs/usage.md` *Typed browser globals* → *Migrating an existing program*: add bullets for a list parameter or descriptor member (`[]webgpu.CommandBuffer{cmd}` / `[]webgpu.ColorTargetState{map[string]any{...}}` instead of `[]any`), a truthiness test on a browser value (`el != nil` instead of `if el`), and indexing or ranging an element (assert or use its API, e.g. `el.children.item(0)`)
  - Done when: stored browser functions bind `this` cleanly, skip Go aggregate cloning and `{ __sp }` wrapping, and leave Go variadic func semantics unchanged, and the docs bullets are present
