# Plan: Incremental compilation in watch mode

## Goal

Make `--watch` mode only reparse and re-typecheck files that have actually changed,
instead of recompiling the entire package from scratch on every save. For typical
projects (5–20 source files), a full rebuild takes ~50ms; incremental should bring
per-save latency to <10ms for single-file edits.

## Current state

`src/index.js` calls `buildOnce()` on every file-system event. `buildOnce()` calls
`compileDir()` or `compileFiles()`, which reads and parses every file from disk every
time. There is no caching at any stage.

The typechecker runs across all files as a single unit (it needs the full symbol table),
so true incremental type-checking requires more thought. The quick win is **parse
caching** — reuse the AST for files that haven't changed.

## Approach

### Phase 1: Parse cache (high value, low risk)

Add a module-level cache in `src/compiler.js`:

```js
// Map<filePath, { mtime: number, ast: ParsedFile }>
const parseCache = new Map();
```

In `compileFiles`, before parsing each file:

```js
const mtime = statSync(filePath).mtimeMs;
const cached = parseCache.get(filePath);
if (cached && cached.mtime === mtime) {
  parsed = cached.ast;
} else {
  parsed = parse(source, filePath);
  parseCache.set(filePath, { mtime, ast: parsed });
}
```

Parsing is the cheapest stage but this sets the pattern for later phases.

### Phase 2: Change detection in the watcher

Track which file triggered the change event and log it:

```js
watch(watchTarget, { recursive: true }, (_event, filename) => {
  if (!filename?.match(/\.(go|templ)$/)) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => buildOnce(filename), 80);
});
```

`buildOnce(changedFile)` passes the hint to `compileFiles` so it can prioritise
invalidating only the changed file's cache entry and skip re-reading others.

### Phase 3: TypeChecker invalidation

The typechecker operates on all ASTs simultaneously and maintains a global scope. A
change to one file can affect type resolution in another (e.g. an exported type changes).
Full incremental type-checking is therefore out of scope for this release.

However, we can skip the typecheck pass entirely when `--check` is not set and there
are no type errors in the current run — re-run it only when a file changes. The
typechecker is fast (~5ms for small packages), so this is a minor gain. The real win
remains in parse caching and avoiding disk I/O.

### Phase 4: Codegen cache

Each file's AST produces a JS string. Cache the codegen output per file:

```js
// Map<filePath, { astHash: string, js: string }>
const codegenCache = new Map();
```

Since ASTs are objects, hash them cheaply by JSON-stringifying the relevant subset, or
simply use the file mtime as a proxy (if the AST is from cache, the codegen output is
also from cache).

### Rebuild timing output

Add per-rebuild timing to the watch log so the improvement is visible:

```
[10:32:01] gofront: rebuilt in 8ms (1 file changed)
[10:32:05] gofront: rebuilt in 3ms (cached, 0 files changed)
```

## Changes required

| File | Change |
|---|---|
| `src/compiler.js` | Add `parseCache` map; check mtime before parsing each file |
| `src/index.js` | Pass changed filename to `buildOnce`; log rebuild time and file count |
| `src/index.js` | Expose cache invalidation so tests can reset state |

## Edge cases

- **File deleted** — remove from cache on the next build; `statSync` will throw, catch
  and treat as a new file (or propagate the error cleanly).
- **File renamed** — the old path stays in cache indefinitely. Cap cache size at the
  number of files in the package, or clear stale entries after each build by diffing
  the current file list against cache keys.
- **`.d.ts` files** — `dts-parser.js` results should also be cached by mtime; they
  change rarely but are re-read on every build today.
- **Sub-package imports** — `compileDir` for local imports (`./subpkg`) should share
  the same cache instance, not create a fresh one per recursive call.
- **`--check` mode** — cache is useful here too; type errors are the output, so only
  re-typecheck changed files' packages.
- **Clock skew / same-mtime edits** — on fast saves within 1ms resolution, mtime may
  not change. If needed, add a content hash fallback (SHA-1 of first 512 bytes), but
  this is unlikely to be an issue in practice.

## Test plan

Add tests in `test/unit/compiler/`:

```js
test("parse cache is reused on second compile of same source", () => {
  // compile twice with same content; assert parse was called once
  // (spy on internal parse fn or check cache hit count via exposed counter)
});

test("cache invalidates when file content changes", () => {
  // write file, compile, write different content, compile again
  // assert output differs
});
```

Watch-mode timing is best verified manually: run `--watch` on the `gom` example and
confirm the rebuild log shows reduced times after the first build.

## Expected improvement

| Scenario | Before | After (estimated) |
|---|---|---|
| Single file change, 5-file package | ~50ms | ~15ms |
| Single file change, 20-file package | ~120ms | ~20ms |
| No-change rebuild (debounce fires) | ~50ms | ~2ms |

The biggest win is skipping disk I/O and re-parsing for unchanged files. TypeChecker
and CodeGen remain full-package operations for correctness.
