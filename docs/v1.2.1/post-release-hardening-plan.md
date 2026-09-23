# Post-Release Hardening (v1.2.0 review follow-ups) — Design Plan

**Version:** v1.2.1  
**Status:** Completed (2026-09-23)  

---

## Goal

Address the findings of the v1.2.0 code review: two real bugs (dev-server path traversal, `--dom` jsdom resolution mismatch), two undocumented behaviour changes shipped in `1d3cc4f` (`== nil` codegen, multi-file top-level check ordering), drift from the `src/index.js` "routing only" rule, consumer-specific hardcoding in `vendor.js`, and a handful of small cleanups in the test runner. No new language features. Done means: every item below is fixed with a covering unit test, `CHANGELOG.md` and `README.md` reflect the actual behaviour, and `npm run check` + `npm run test:all` pass.

---

## Out of Scope

- `file.go:line:` prefixes on `t.Log`/`t.Error` output (Go-style caller attribution). Requires threading call-site positions through codegen for every `testing.T` method call; deferred to a later release.
- `-run` matching against subtest names (`TestParent/sub` with `/`-split regex). Top-level filtering only, as documented.
- Benchmarks, fuzzing, coverage — unchanged from the v1.2.0 plan.
- Any change to `== nil` semantics beyond documenting what already shipped.
- Refactoring `index.js` beyond moving the `test` and `prep` subcommand logic; the compile/watch path stays as-is.

---

## Approach

### 0. Async-aware unit test harness (bug, discovered during implementation) — `test/unit/helpers.js`

`test(name, fn)` calls `fn()` synchronously and prints `✓` immediately. The 25 `async` tests in `test-runner.test.js` and `prep.test.js` return promises that are never awaited; failures become unhandled rejections, and `run.js` calls `process.exit()` right after the last import — before they can surface. Net effect: every async test counts as passed the moment it starts, and at least one (`compilePackageTests throws ... reports compile error`) is actually red.

- `test()` records the returned promise (if any) in a `pending` array and defers the `✓`/`✗` print until it settles. Output is written through ordered slots so a deferred result still appears under its own `section()` header.
- `summarize()` becomes `async`, awaits all `pending` first.
- All 31 `process.exit(summarize() > 0 ? 1 : 0)` call sites → `process.exit((await summarize()) > 0 ? 1 : 0)`.
- Fix any async tests that turn red; align assertions to actual behaviour where the behaviour is correct (e.g. `[build failed]` output), fix the code where it is not.

### 1. Dev server path traversal (bug) — `src/dev-server.js`

`handleDevRequest` guards with `filePath.startsWith(resolvedServe)`. This is a string-prefix check, so serving `/x/app` also allows `/x/app-secret/...` via `/../app-secret/secret.txt` (reproduced: `200 LEAKED`).

- Replace with a `relative()`-based containment check, extracted to `isInsideDir(root, target)`:
  ```js
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  ```
  A bare `startsWith("..")` would also reject legitimate names like `..cache/`; the
  exact `..` / `../` match avoids that. `asset-manager.js` uses the same check for
  `assetCopy` destinations.
- Apply the same containment check before the SPA fallback and the directory-index branches (they all derive from `filePath`, so one early check suffices).

### 2. `--dom` jsdom resolution mismatch (bug) — `src/test-runner.js`

`validateTestOptions` accepts jsdom if resolvable from the project dir **or** from GoFront's own install, but the spawned child does a bare `import "jsdom"` with `cwd = project dir`. Under a global / `npx` install with no project-local jsdom, validation passes and the harness dies with `ERR_MODULE_NOT_FOUND`.

- `validateTestOptions` returns the resolved absolute path (`req.resolve("jsdom")`) instead of a boolean.
- `generateTestHarness` accepts `options.jsdomPath` and emits `import { JSDOM } from ${JSON.stringify(pathToFileURL(jsdomPath).href)}`.
- Keep the two-step lookup order (project first, then GoFront's own tree) so a project-local jsdom always wins.

### 3. Document shipped behaviour changes — `CHANGELOG.md`

Commit `1d3cc4f` contained two semantic changes with no changelog entry:

- **`== nil` / `!= nil` now emit loose `==` / `!=` against `null`** (`src/codegen/expressions.js` `_genBinaryExpr`). Effect: `undefined` is treated as nil (unset struct fields, missing map values from JS interop). Add under **Changed** for 1.2.0 (retroactively, marked as such) or under 1.2.1 **Fixed** with a note that it shipped in 1.2.0 — pick the former; the entry should live with the version that changed the behaviour.
- **Multi-file top-level check ordering** (`src/typechecker/index.js` `_checkTopDeclsPass`): all package-level `var`/`const` initializers are now checked before any function body, so a function in `a.go` sees the inferred type of `var x = f()` declared in `b.go` instead of `any`. Add under **Fixed** in 1.2.0.
- Add a negative + positive unit test for the multi-file inference case in `test/unit/compiler/packages.test.js` if not already present (verify: grep for the new `packages.test.js` tests added in `1d3cc4f`; the diff shows +43 lines, likely this case — confirm and reference).

### 4. Move subcommand logic out of `src/index.js` — `src/cli-core.js`

`index.js` is 340 lines and contains real logic (`-run`/`-run=`/`--run` parsing, `prep` result formatting), contradicting the AGENTS.md rule and the v1.0.1 changelog claim (~130 lines).

- Add `parseTestArgs(argv) → { targetDir, verbose, dom, run }` to `cli-core.js`. `index.js` becomes: `const opts = parseTestArgs(args.slice(1)); const { exitCode } = await handleTest(opts.targetDir, opts); process.exit(exitCode);`
- Add `parsePrepArgs(argv) → { targetDir, vendorConfig }` and `formatPrepSummary({ assets, vendor }) → string[]` to `cli-core.js`; `index.js` just prints the lines to `stderr`.
- Remove the redundant `resolve()` in `handleTest` (`runTests` already resolves).
- Update the stale "~130 lines" claim: do **not** edit the v1.0.1 changelog entry; instead note the new line count in the 1.2.1 **Changed** entry.
- Sentrux: `cli-core.js` fan-out grows by zero (no new imports); verify `sentrux gate` still passes.

### 5. Vendor global-name mapping via config — `src/vendor.js`

`getExportNames` hardcodes `@emailjs/browser → emailjs`, `fuse.js → Fuse`, `prismjs → Prism`, `marked`. These are the `website` project's dependencies and do not belong in the compiler.

- Add `vendor.globals` to the vendor config schema (`package.json` / `gofront.json`):
  ```json
  "vendor": {
    "dest": ["app/vendor.js", "public/vendor.js"],
    "globals": { "fuse.js": ["Fuse"], "prismjs": ["Prism"], "@emailjs/browser": ["emailjs"] }
  }
  ```
- `getExportNames(pkgName, globals = {})` keeps the generic derivations (full name, unscoped base, sanitised identifier) and appends `globals[pkgName]` if present. Delete the four `if (pkgName === ...)` branches.
- `loadVendorConfig` returns `globals`; `bundleVendor` passes it to `generateVendorEntry(packages, globals)`.
- Migrate `website/package.json` (or `gofront.json`) to declare the mapping so the website keeps working. This is a cross-repo change — do it in the same session, but as a separate commit in the `website` repo.
- README: document `vendor.globals` in the `gofront prep` section.

### 6. Test-runner cleanups — `src/test-runner.js`

- Delete the no-op `bundleJsClean()` and its call site.
- `discoverTests(programs)` skips programs whose `_filename` is set and does not end with `_test.go`. Program nodes already carry `_filename` (set by the parser; used by `trackImport`); hand-built programs without one are still scanned so the public API stays usable. A `TestXxx(t *testing.T)` in a non-test file is silently ignored, matching Go.
- Collapse the duplicated result-reporting blocks in the emitted harness (`__onSubtestEnd` vs the top-level loop) into a single `__report(t, elapsed)` function inside the harness string. Output must be byte-identical before/after; lock it with a snapshot-style assertion on a fixture run (see Test Plan).

### 7. Docs

- `CHANGELOG.md`: new `[1.2.1]` section with **Fixed** (traversal, jsdom resolution, non-test-file discovery), **Changed** (CLI arg parsing moved to `cli-core.js`, `vendor.globals` replaces hardcoded names, harness dedup), plus the two retroactive 1.2.0 entries from §3.
- `README.md`: `vendor.globals` docs; note in the `gofront test --dom` section that jsdom is resolved from the project first, then GoFront's install.
- `docs/roadmap.md`: add v1.2.1 section (done alongside this plan).

---

## Edge Cases

- **Traversal:** `serveDir` itself (`rel === ""`) must be allowed (it is a directory → index fallback). Encoded traversal (`%2e%2e%2f`) is already decoded before `resolve`; verify it is still blocked after the change. Windows drive-letter absolute paths are covered by `isAbsolute(rel)`.
- **jsdom path injection:** the resolved path may contain spaces or non-ASCII; always go through `pathToFileURL(...).href` + `JSON.stringify`. `req.resolve("jsdom")` returns the CJS entry — a static `import { JSDOM }` from a CJS module works via Node's named-export detection (jsdom already works this way today since it is CJS); keep as-is but assert in a test.
- **`-run=` variants:** `parseTestArgs` must preserve current behaviour for `-run X`, `-run=X`, `--run X`, `--run=X`, and a trailing `-run` with no value (→ `null`).
- **`prep` with no assets and no vendor:** `formatPrepSummary` returns `[]`, nothing is printed, exit 0 — same as today.
- **`vendor.globals` for a package not in `packages`:** ignored silently (no warning); only consulted for packages actually bundled.
- **`vendor.globals` value shapes:** accept `string | string[]`; anything else → throw a clear config error.
- **`discoverTests` with `package foo_test` external test files:** still `_test.go` → still discovered. No change.
- **Harness dedup:** skipped subtests print their logs; failed top-level tests in non-verbose mode print a late `=== RUN` line first. Both paths must survive the merge unchanged.

---

## Tasks

### Task 0: Async-aware test harness
- Make `test()`/`summarize()` async-aware; update all `process.exit(summarize()...)` sites.
- Run `npm run test:unit`; triage every newly-red async test.

### Task 1: Dev server traversal fix
- Failing test first in `test/unit/compiler/dev-server.test.js`: sibling-prefix directory (`app` vs `app-secret`) must return 403 for `/../app-secret/secret.txt`; `serveDir` root and legitimate nested files still 200.
- Implement `relative()`/`isAbsolute()` check.

### Task 2: jsdom resolution
- Failing test in `test/unit/compiler/test-runner.test.js`: `generateTestHarness(js, names, { dom: true, jsdomPath })` emits a `file://` import specifier, not the bare `"jsdom"`.
- Refactor `validateTestOptions` → returns `{ jsdomPath }`; thread into `runTests`.

### Task 3: CLI extraction
- Tests in `test/unit/compiler/cli-core.test.js` for `parseTestArgs` (all `-run` forms, `-v`, `--dom`, positional dir, default `.`), `parsePrepArgs`, and `formatPrepSummary` (empty, assets-only, vendor-only with array dest + minify).
- Move logic; shrink `index.js`; confirm `sentrux gate` passes.

### Task 4: `vendor.globals`
- Tests in `test/unit/compiler/prep.test.js`: `getExportNames("fuse.js")` no longer includes `Fuse` by default; includes it when `globals["fuse.js"] = ["Fuse"]`; `loadVendorConfig` reads `globals` from both `package.json` and `gofront.json` (`gofront.json` wins); invalid shape throws.
- Remove hardcoded branches; update `website` config in its own repo/commit.

### Task 5: Test-runner cleanups
- Test: a `TestXxx` in a non-`_test.go` fixture file is not discovered/run.
- Capture current stdout of a fixture with pass + fail + skip + subtests (verbose and non-verbose) **before** the harness dedup; assert byte-equality after.
- Remove `bundleJsClean`.

### Task 6: Docs & changelog
- Retroactive 1.2.0 entries (§3), new 1.2.1 section, README updates, roadmap.

### Task 7: Verification
- `npm run check`, `npm run test:all` (unit + examples + examples:dom + e2e).
- Manual: `gofront --serve` on `example/simple`, request `/../` sibling path → 403; `gofront test --dom example/gom/src` from a directory that has no local jsdom (e.g. `cd /tmp && node /home/luuk/dev/gofront/src/index.js test --dom /home/luuk/dev/gofront/example/gom/src`) → runs instead of `ERR_MODULE_NOT_FOUND`.

---

## Test Plan

- **Unit — dev-server.test.js:** sibling-prefix traversal → 403; encoded `%2e%2e` traversal → 403; root `/` → 200 index; nested static file → 200; SPA fallback still 200 for `/blog`.
- **Unit — test-runner.test.js:** harness `file://` jsdom import; `discoverTests` ignores non-`_test.go` programs; output snapshot equality across harness dedup (verbose + non-verbose fixtures).
- **Unit — cli-core.test.js:** `parseTestArgs` matrix; `parsePrepArgs`; `formatPrepSummary`; `handleTest` passes options through unchanged.
- **Unit — prep.test.js:** `getExportNames` with/without `globals`; `loadVendorConfig` precedence; invalid `globals` shape error message via `assertErrorContains`.
- **Unit — packages.test.js:** multi-file `var x = f()` in `b.go` used in `a.go` type-checks with the inferred type (positive) and rejects a mismatched assignment (negative, `assertErrorContains`).
- **Integration:** `npm run test:examples` and `test:examples:dom` unchanged; `website` builds with `gofront prep` after config migration.
- **Negative:** `gofront test --dom` with jsdom nowhere resolvable → existing "requires 'jsdom'" error, exit 1.
