# CLI core extraction for testability — v1.0.1

## Goal

`src/index.js` (328 lines) mixes argument parsing, compilation logic, watch-mode
orchestration, and process I/O. The compilation and output logic (~21% of the file,
lines 144–215) is only reachable via `spawnSync` in tests — meaning c8 records zero
coverage for those paths.

Extract the compilable core into `src/cli-core.js` so tests can import and call it
directly.

## Approach

### New file: `src/cli-core.js`

Extract and export:

```js
// src/cli-core.js

export function runCompile(inputPath, isDir, options) {
  // current runCompile() body from index.js
  // options: { sourceMap, outputDir, checkOnly, dumpAst, dumpTokens }
  // returns { js, errors, exportedSymbols } or throws
}

export function maybeMinify(js, options) {
  // current maybeMinify() body
  // options: { sourceMap, minify, mangle }
  // returns string
}

export function handleInit(dir) {
  // current init scaffold logic
}

export function buildOutput(result, options) {
  // assemble final JS string (preambles + source map comment)
  // options: { sourceMap, outputFile, outputDir, inputPath }
  // returns string
}
```

### Update `src/index.js`

```js
import { runCompile, maybeMinify, handleInit, buildOutput } from "./cli-core.js";
```

`index.js` retains only: arg parsing, file I/O (`writeFileSync`, `stdout.write`),
watch-mode setup (`chokidar`/`fs.watch`), dev-server startup, process exit.
Target: ~120 lines (down from 328).

### Sentrux layer

`cli-core.js` sits at layer 1 (support), same as existing support modules. `index.js`
stays at layer 0 (cli). Import edge `cli(0) → support(1)` already exists.

## Test plan

Add `test/unit/compiler/cli-core.test.js`:

```js
import { runCompile, maybeMinify, buildOutput } from "../../../src/cli-core.js";

test("runCompile single file returns js and no errors", () => { ... });
test("runCompile directory bundles package", () => { ... });
test("runCompile --check only returns errors without js", () => { ... });
test("maybeMinify returns shorter output", () => { ... });
test("buildOutput appends sourceMappingURL when sourceMap true", () => { ... });
test("buildOutput prepends preambles", () => { ... });
```

These tests run in-process — c8 coverage now captures the previously dark paths.

## Edge cases

- Watch mode (`--watch`) stays in `index.js` — it requires `process` and file-system
  events; still subprocess-tested. But the _compilation_ step it calls now goes through
  `cli-core.js` and gets covered.
- `handleInit` writes files to disk — test with a `tmp` directory, clean up after.
- Source map + minify conflict check lives in `maybeMinify` — covered by existing
  CLI error-path tests once they import directly.

## Sentrux rules update

`src/cli-core.js` is a new file not covered by any layer glob. Add to `support` layer
in `.sentrux/rules.toml`:

```toml
[[layers]]
name  = "support"
paths = ["src/compiler.js", "src/resolver.js", "src/dts-parser.js",
         "src/dev-server.js", "src/minifier.js", "src/cli-core.js"]
order = 1
```

`cli-core.js` imports from codegen and typechecker (layers 2, 3) — both higher-order
than support (1). Legal. `src/index.js` imports `cli-core.js` — cli(0) → support(1),
also legal.

Run `sentrux gate --save` after extraction; splitting `index.js` reduces its complexity
score and should lift the overall quality signal above 6447.

## JS output examples

No output change. Refactor only.
