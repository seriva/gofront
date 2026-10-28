# v1.8.0 Follow-up Fixes & Performance Hardening — Design Plan

**Version:** v1.8.0  
**Status:** Draft (2026-10-28)  
**Base branch:** main  
**Related:** Follows [`portable-go-plan.md`](portable-go-plan.md) and [`repo-structure-plan.md`](repo-structure-plan.md); unblocks downstream adoption ([`simplefps/plans/gofront-v1.8.0-adoption-plan.md`](../../../simplefps/plans/gofront-v1.8.0-adoption-plan.md)); addresses open ledger items from [`../follow-ups.md`](../follow-ups.md).  
**Release note:** Fixes parser lookahead on selector index expressions, and adds slice bounds-check elimination (BCE) so high-throughput math in `both` packages incurs zero strict-mode overhead.

---

## Goal

Resolve critical compiler correctness regressions and strict-mode performance gaps in GoFront v1.8.0 before final release tagging.

While v1.8.0 achieved language parity and strict-mode runtime safety across `js`, `wasm`, and `both` targets, two critical issues block downstream release adoption:
1. **Strict-mode slice bounds overhead (The 3× `mathx` regression):** In `both` packages, strict mode emits `__at`/`__ix` bounds-checking helper calls for every slice index. For constant-indexed slice math (`type Mat4 = []float32`), this causes a measured **3.0× slowdown on `Mat4Multiply`** and **2.3× slowdown on `TransformMat4`**. GoFront's index-check elision ([`src/lower/bounds.js`](../../src/lower/bounds.js)) currently only elides constant indices into fixed *arrays*, not slices. Adding bounds-check elimination (BCE) support for length guards and Go's idiomatic `_ = xs[k]` hint allows the compiler to prove slice bounds and emit raw `xs[k]` indexing.
2. **Generic instantiation lookahead parse error:** Commit `80add49` expanded generic instantiation to qualified names (`pkg.T[...]`), but in function call arguments like `fn(s.Meshes[s.Entries[i].Index])`, `looksLikeTypeArgList()` in [`src/parser/expressions.js`](../../src/parser/expressions.js) misidentifies indexed selector expressions as generic type arguments, causing a syntax error: `Parse error: expected ']' (got . ".")`.
3. **Follow-up ledger items:** Fix and retire open items logged in [`plans/follow-ups.md`](../follow-ups.md) to stabilize the v1.8.0 release.

**Done means:**
- `src/lower/bounds.js` elides `__at`/`__ix` for slice indices `0..k` when preceded by an explicit length check `len(xs) > k` or a Go BCE hint `_ = xs[k]`.
- Compiling `mathx` from SimpleFPS as a `both` package emits zero `__at`/`__ix` calls in `Mat4` matrix functions when BCE hints are present.
- `src/parser/expressions.js` disambiguates slice indexing inside call argument lists; `node src/index.js check app/src/...` on SimpleFPS passes with zero parse errors.
- Unit and regression tests cover BCE slice elision and qualified generic lookahead.
- Full `/design-plan follow-ups` can be run to sweep and schedule the remaining open items in `plans/follow-ups.md`.

---

## Scope Rule & Boundary Matrix

| Category | Rule | Examples / Members | Reason (Excluded rows) |
|---|---|---|---|
| **In scope: core** | Compiler correctness & lowering optimizations | Slice BCE in `src/lower/bounds.js` (`_ = xs[k]` and `len(xs) > k`); parser lookahead disambiguation in `src/parser/expressions.js`; scheduled items from `plans/follow-ups.md` | |
| **In scope: target-specific** | Backend emission | Plain array indexing emitted in JS backend when `IndexExpr._inBounds = true` on slices | |
| **Excluded: runtime / platform** | No changes to runtime model | Goroutines, reflection, raw memory pointers | Incompatible with GoFront principles |
| **Excluded: deferred** | New features and unreferenced stdlib packages | Moving stdlib to pure Go (`stdlib-in-go-plan.md`); `bufio`, `net/url`, `context` | Scheduled for v1.9.0 |

---

## Verified Gaps & Baseline Audit

| Area | Finding | Evidence & Probe Reference |
|---|---|---|
| Slice bounds checks in JS | In `both` packages, slice indexing emits `__at(xs, i)` calls. In SimpleFPS `mathx`, `Mat4` indexing has 204 `__at` call sites, causing a 3.0× slowdown on `Mat4Multiply` and 2.3× on `Vec3.TransformMat4`. `src/lower/bounds.js` only inspects `u.kind === "array"`. | SimpleFPS audit 2026-10-23; probe `mathx-ab.mjs` |
| Parser generic lookahead | In call arguments, `looksLikeTypeArgList()` returns true if an identifier inside brackets starts with an uppercase letter and is followed by `)`. For `Add(s.Meshes[s.Entries[i].Index])`, it parses `s.Entries[i].Index` as a type argument, failing at `.Index`. | Minimal repro: `func Add(x int){}; func Test(s S, i int){ Add(s.Meshes[s.Entries[i].Index]) }` → `Parse error at 15:27: expected ']' (got . ".")` |

---

## Implementation Tasks

### Phase 1: Critical Compiler Fixes & BCE Optimization

- [ ] Task 1.1: Fix generic instantiation lookahead in parser
  - Files: `src/parser/expressions.js`, `test/unit/parser/generics.test.js`
  - Test: Unit test with nested selector indexing inside function arguments (`fn(s.Meshes[s.Entries[i].Index])`) parses as `CallExpr` containing `IndexExpr`, not `InstantiationExpr`.
  - Done when: `gofront check` passes on the repro and on SimpleFPS (`app/src/game`, `app/src/engine/scene`, `app/src`).

- [ ] Task 1.2: Slice Bounds-Check Elimination (BCE) in lowering
  - Files: `src/lower/bounds.js`, `test/unit/compiler/bounds.test.js`
  - Test: In a `both` package, a function starting with `_ = xs[15]` or `if len(xs) > 15 { ... }` marks `xs[0]` through `xs[15]` as `_inBounds = true`. Emitted JS contains raw `xs[0]` instead of `__at(xs, 0)`.
  - Done when: Constant slice indices preceded by a length proof or BCE hint are elided in the JS backend for `both` packages.

- [ ] Task 1.3: End-to-end SimpleFPS verification
  - Files: `test/perf/`
  - Test: Run `gofront check` across SimpleFPS; compile `engine/mathx` with BCE hints and verify `__at` count in matrix functions drops to 0.
  - Done when: `check` passes cleanly across all SimpleFPS packages; `mathx` matrix functions emit zero `__at` calls.

---

### Phase 2: Follow-up Ledger Fixes (To be scheduled via `/design-plan follow-ups`)

*(Additional phases and tasks to be appended here by `/design-plan follow-ups plans/v1.8.0/follow-up-fixes-plan.md` to triage and resolve items from `plans/follow-ups.md`).*

