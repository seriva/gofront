# Modern Dev Environment & Tooling Enhancements — Design Plan

**Version:** v1.3.0  
**Status:** Draft  

---

## Goal

Elevate GoFront's developer experience (DX), project scaffolding, and build pipeline to modern frontend standards by integrating proven workflow patterns from Microtastic into GoFront.

Currently, GoFront features a capable compiler, native asset manager, and basic SSE dev server. However, project setup requires manual wiring (running `gofront init` creates only an isolated `main.go` file without an HTML harness, `package.json`, or scripts), daily development requires verbose CLI invocations (`gofront src -o app.js --serve --copy-assets`), live reload breaks whenever Go code has compilation errors because the client script is embedded in the compiled JS bundle, and bundling external npm packages often fails in the browser due to missing Node polyfills.

This plan resolves these DX friction points while strictly preserving GoFront's core principle of **zero mandatory runtime dependencies**.

---

## Out of Scope

- **Adding Mandatory Dependencies to GoFront:** GoFront's root `dependencies` in `package.json` must remain empty (`{}`). All dev server, SSE, and scaffolding logic will use standard Node.js APIs (`node:http`, `node:fs`, `node:path`). Bundling plugins (such as Rolldown Node polyfills) are dynamically loaded from consumer `devDependencies`.
- **CSS Preprocessors (Sass/Less):** Pure CSS and browser-native styling remain the standard.
- **Language Syntax Changes:** All features in this plan are tooling and environment additions; parser and type checker semantics are untouched.

---

## Approach

### 1. Turn-Key Scaffolding (`gofront init`)

#### Problem
Currently, `handleInit` in `src/cli-core.js` only creates a single `main.go` file in the target directory. A newcomer cannot view anything in a browser until they manually write an `index.html`, set up `package.json` with npm scripts, configure a `.gitignore`, and configure code formatting.

#### Solution
Enhance `handleInit(targetDir, options)` to scaffold a complete, turn-key browser project:

```
my-app/
├── app/
│   ├── index.html       # HTML harness with root DOM container & script tag
│   └── src/
│       └── main.go      # GoFront entry point (renders hello-world or Gom component)
├── .gitignore           # Ignores dist/, public/, app/vendor.js, node_modules/
└── package.json         # Pre-configured scripts: dev, build, check, test
```

1. **Pre-Configured `package.json` Scripts:**
   ```json
   {
     "name": "my-app",
     "type": "module",
     "scripts": {
       "dev": "gofront dev",
       "build": "gofront build",
       "test": "gofront test",
       "check": "gofront check"
     }
   }
   ```
2. **Safety:** If files already exist in `targetDir`, do not overwrite them; warn the user.

---

### 2. High-Level Semantic CLI Commands (`dev`, `build`, `test`, `check`, `init`)

#### Problem
Developers currently have to memorize and pass complex multi-flag combinations:
- Development: `gofront app/src -o app/app.js --serve --copy-assets`
- Production: `gofront app/src -o public/app.js --minify --mangle --copy-assets`

#### Solution: Strict Subcommands (No Backward Compatibility Baggage)
Replace ambiguous positional flags and legacy fallback hacks with clean, first-class semantic subcommands in `src/cli-core.js` and `src/index.js`. Legacy positional invocations and multi-flag combinations are dropped in favor of explicit subcommands:

#### A. `gofront dev [dir] [options]`
Automates local development in a single command:
1. Detects project configuration (`package.json` or `gofront.json`).
2. Runs asset synchronization (`assetCopy`).
3. Runs incremental compilation with watch mode enabled.
4. Starts the local dev server on port `3000` (or `--port <number>`) with live reload.
5. Emits clear console feedback:
   ```
   gofront: dev server running → http://localhost:3000
   gofront: watching app/src for changes...
   ```

#### B. `gofront build [dir] [options]`
Orchestrates an optimized production release:
1. Cleans target output directory (`public/` by default, or `--out-dir <dir>`).
2. Runs type checking.
3. Compiles GoFront sources with `--minify --mangle` and sourcemaps.
4. Bundles external vendor dependencies (`bundleVendor`).
5. Synchronizes static assets into the output directory.
6. Optionally generates a PWA offline service worker if `--pwa` is specified.
7. Reports build timing and file size summary.

#### C. `gofront check [dir]`
Runs the static type checker across the directory without emitting JavaScript output.

#### D. `gofront test [dir] [options]`
Discovers and executes GoFront unit tests matching `*_test.go`.

#### E. `gofront init [dir]`
Scaffolds a clean, turn-key GoFront project.

---

### 3. Resilient Dev Server & Live Reload (`src/dev-server.js`)

#### A. HTML-Level SSE Client Injection
* **Current Issue:** GoFront injects `liveReloadClient` at the bottom of the **compiled JS bundle**. If a developer introduces a compilation or type error, the JS bundle is never updated (or throws a syntax error on execution), which severs the SSE connection. When the developer fixes the error, the browser fails to reload automatically.
* **Fix:** Move live-reload client injection to `dev-server.js` by intercepting HTML responses (similar to Microtastic's `#injectReloadScript`). The server injects a small inline `<script>` tag before `</body>` when serving `index.html`. The SSE connection remains open even across fatal compilation errors.

#### B. SSE Keep-Alive Heartbeat
Browsers and reverse proxies terminate idle SSE streams after 30–60 seconds of inactivity. Add an interval to `createDevServer` that sends an SSE comment ping every 30 seconds:
```js
setInterval(() => {
  for (const client of clients) {
    try { client.write(": keep-alive\n\n"); }
    catch { clients.delete(client); }
  }
}, 30000);
```

#### C. Browser Error Overlay
When compilation fails during `gofront dev`:
- Broadcast a `{ type: "error", message: err.message, loc: { line, col, file } }` payload over the SSE connection.
- The injected client renders a high-contrast compiler error modal overlay displaying the file path, error description, and source code snippet with a caret pointer.
- Once compilation succeeds, the overlay is dismissed automatically or triggers a page refresh.

#### D. Non-Destructive CSS Hot-Reloading
When asset watch detects changes to `.css` files:
- Dev server sends `event: css-update\ndata: {"file": "styles.css"}`.
- Injected client refreshes the matching `<link rel="stylesheet">` with a cache-busting timestamp (`styles.css?t=123456`) without reloading the page, preserving application/canvas state.

---

### 4. Node Polyfills for External NPM Packages (`src/vendor.js`)

#### Problem
When developers import npm packages in GoFront (`import "js:lodash"` or imported npm modules in `package.json`), `bundleVendor` uses Rolldown or esbuild to bundle them. Many packages rely on Node.js built-ins (`process`, `Buffer`, `events`, `util`, `path`). Without polyfills, bundling these packages fails or produces runtime errors in the browser (`process is not defined`, `Buffer is not defined`).

#### Solution
In `src/vendor.js`, when bundling with Rolldown:
1. Dynamically check if `@rolldown/plugin-node-polyfills` is installed in consumer `devDependencies`.
2. If available, automatically register it in the Rolldown bundling configuration:
   ```js
   const bundle = await rolldownFn({
     input: entryFile,
     cwd: projectRoot,
     plugins: [nodePolyfillsPlugin()],
   });
   ```
3. If an imported dependency fails due to missing Node globals and the polyfill plugin is not installed, output a helpful tip:
   ```
   gofront: tip: npm package requires Node built-ins. Install @rolldown/plugin-node-polyfills:
     npm install --save-dev @rolldown/plugin-node-polyfills
   ```

---

### 5. Offline PWA & Service Worker Generation (`gofront build --pwa`)

#### Goal
Provide zero-configuration offline caching for GoFront browser applications, tools, and 2D/3D games.

#### Implementation
1. Add a Service Worker template (`src/templates/sw.tpl`):
   - Cache-first strategy for static assets (HTML, JS, CSS, fonts, audio, images).
   - Network-first strategy with cache fallback for data requests.
   - Automated cache invalidation on new builds based on version hash.
2. When `gofront build --pwa` is invoked:
   - Walk the output directory (`public/`).
   - Collect all generated asset paths.
   - Emit `public/sw.js` with the pre-cache manifest.
   - If `index.html` does not register the service worker, automatically inject the registration snippet.

---

## Edge Cases

- **Custom Ports:** `gofront dev --port 8080` or `serverPort` in `gofront.json` must be respected; if occupied, cleanly exit with `EADDRINUSE` diagnostic.
- **Root and Subdirectory Builds:** `gofront init` executed in an existing directory should detect package names from the directory basename and handle relative imports accurately.
- **Graceful Shutdown:** `gofront dev` must cleanly terminate child watchers, close the HTTP server, and end SSE client streams on `SIGINT` (Ctrl+C) and `SIGTERM`.
- **Existing Files during `init`:** Ensure `gofront init` does not overwrite existing `index.html`, `package.json`, or `.gitignore` files.

---

## Implementation Breakdown (Phases & Tasks)

### Phase 1: Resilient Dev Server & Live Reload
- **Target Files:** `src/dev-server.js`
- [x] **Task 1.1 — HTML SSE Injection:** Intercept HTML file requests in the dev server and dynamically inject the SSE client script before `</body>` (or append if omitted). Ensure compiled JS bundles remain unmodified.
- [x] **Task 1.2 — SSE Keep-Alive & Reconnection:** Add a 15-second heartbeat timer emitting `: ping\n\n` comments over open SSE streams. Update client script with exponential backoff auto-reconnect (1s, 2s, 4s).
- [x] **Task 1.3 — Browser Compiler Error Overlay:** Build and inject the `<div id="gofront-error-overlay">` component. Broadcast `{ type: "build-error", message }` events on compiler failures to display the overlay, and `{ type: "reload" }` to automatically dismiss it when compilation succeeds.
- [x] **Task 1.4 — Non-Destructive CSS Hot-Reload:** Track `.css` asset changes in the file watcher. Broadcast `{ type: "css-update", file }` events to refresh `<link rel="stylesheet">` hrefs via cache-busting timestamp without full page reload.

### Phase 2: Semantic CLI Commands (`dev`, `build`, `check`, `test`, `init`)
- **Target Files:** `src/cli-core.js`, `src/index.js`, `src/cli.js`
- [x] **Task 2.1 — Command Dispatcher:** Implement strict, unambiguous subcommand dispatching for `dev`, `build`, `check`, `test`, and `init`. Drop legacy positional flag combinations and fallback hacks.
- [x] **Task 2.2 — `gofront dev` Workflow:** Wire directory watch, compilation to memory/output, static asset copying, and dev server lifecycle into a unified single-command workflow.
- [x] **Task 2.3 — `gofront build` Workflow:** Wire clean output directory creation, type validation, compilation with `--minify`, and vendor dependency bundling into an optimized production release pipeline.

### Phase 3: Scaffolding Overhaul (`gofront init`)
- **Target Files:** `src/cli-core.js` (`handleInit`)
- [x] **Task 3.1 — Template Generation:** Update `handleInit` to scaffold a modern project directory structure (`app/index.html`, `app/src/main.go`, `package.json`, `.gitignore`).
- [x] **Task 3.2 — Clean Scripts & Zero Runtime Deps:** Configure generated `package.json` with `dev`, `build`, `test`, and `check` scripts using `gofront`. Ensure `dependencies` is empty `{}` and no extraneous tooling like Biome is introduced.
- [x] **Task 3.3 — Safety Guardrails:** Guard against overwriting existing files in destination directory.

### Phase 4: Rolldown Node Polyfills for External NPM Packages
- **Target Files:** `src/vendor.js`
- [x] **Task 4.1 — Dynamic Plugin Detection:** In `bundleVendor`, check if `@rolldown/plugin-node-polyfills` is resolvable. If present, register it in the Rolldown plugins array.
- [x] **Task 4.2 — Diagnostic Guidance:** If external npm packages import Node.js built-ins (`buffer`, `events`, `path`, etc.) and the polyfill plugin is not installed, emit a friendly diagnostic suggesting `npm i -D @rolldown/plugin-node-polyfills`.

### Phase 5: Offline PWA & Service Worker Generation
- **Target Files:** `src/cli-core.js`, `src/pwa.js`
- [x] **Task 5.1 — Asset Manifest Collection:** Implement `--pwa` flag for `gofront build` that gathers hashes of all emitted HTML, JS, CSS, and static assets.
- [x] **Task 5.2 — Service Worker Emission:** Generate `public/sw.js` with stale-while-revalidate caching logic and inject registration snippet into `public/index.html`.

---

## Test Plan

### Unit Tests (`test/unit/compiler/`)
1. **Scaffolding (`test/unit/compiler/init_test.js`):**
   - Verify `handleInit` creates `app/index.html`, `app/src/main.go`, `package.json`, and `.gitignore`.
   - Verify `package.json` contains valid `dev`, `build`, `test`, `check` scripts.
   - Verify `handleInit` refuses to overwrite existing files.
2. **Dev Server (`test/unit/compiler/dev_server_test.js`):**
   - Verify HTML requests receive injected SSE reload script before `</body>`.
   - Verify compiled JS requests do not contain injected reload client.
   - Verify SSE client receives keep-alive comment frames.
   - Verify CSS file changes emit `css-update` events instead of full reload.
3. **Vendor Bundling (`test/unit/compiler/vendor_polyfills_test.js`):**
   - Verify `bundleVendor` detects and applies `@rolldown/plugin-node-polyfills` when available.
4. **Service Worker (`test/unit/compiler/pwa_test.js`):**
   - Verify `sw.js` manifest correctly collects all static files from build output.

### E2E Dev Workflow Tests (`test/e2e/cli/`)
- Run `gofront init test-project` in a temporary directory.
- Verify `npm run check` and `npm run test` pass out of the box in the scaffolded project.
- Verify `gofront build` produces an optimized release directory with correct assets.
