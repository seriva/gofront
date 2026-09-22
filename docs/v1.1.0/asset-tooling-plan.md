# Frontend Asset Management & Vendor Bundling — Design Plan

**Version:** v1.1.0  
**Status:** Draft  

---

## Goal

Expand GoFront from a standalone transpiler into a self-sufficient frontend development toolchain by adding native asset copying (`assetCopy`), vendor dependency bundling (`gofront vendor` / `gofront prep`), and SPA route fallback in `gofront --serve`.

Currently, GoFront compiles `.go` and `.templ` files cleanly to JavaScript, but real-world browser applications still require external tooling (or bespoke scripts) to copy static assets (fonts, stylesheets, images) from `node_modules` and bundle external npm packages (`.d.ts` imports) for the browser. This plan adds these capabilities directly to GoFront while preserving its zero-runtime-dependencies core principle.

---

## Out of Scope

- **Adding mandatory dependencies to GoFront:** GoFront's `dependencies` in `package.json` must remain empty (`{}`). Vendor bundling will utilize dynamic imports of user-provided bundlers (e.g. Rolldown / esbuild) or pure Node.js ESM copying.
- **CSS Preprocessors / Image Optimization:** SASS, PostCSS, image resizing, or SVG minification remain outside GoFront's core scope.
- **Server-Side Rendering:** GoFront remains a frontend development and build target.

---

## Approach

### 1. Native Asset Copying (`src/asset-manager.js`)

Add a dedicated, zero-dependency asset manager built with standard `node:fs` (`cpSync`, `copyFileSync`, `mkdirSync`, `statSync`):
- Reads the `"assetCopy"` configuration array from `package.json` (or `gofront.json`):
  ```json
  "assetCopy": [
    { "source": "node_modules/@fontsource/raleway/files", "dest": "app/fonts" },
    { "source": "node_modules/prismjs/themes", "dest": "app/css/prism-themes" }
  ]
  ```
- Supports both individual files and directory trees.
- Executable via the new `gofront prep` command, or automatically via `--copy-assets` during build/serve.

### 2. Dev Server SPA Route Fallback (`src/dev-server.js`)

Enhance GoFront's built-in live reload server:
- When a requested URL is not found on disk:
  - If the path has no file extension (e.g., `/blog`, `/projects`, `/about`), automatically fallback to serving `index.html` with `200 OK` and `text/html`.
  - If the path has a file extension (e.g., `.js`, `.css`, `.png`), return `404 Not Found`.
- Ensures client-side SPA routers work out of the box during development without proxy servers or external wrappers.

### 3. Vendor Dependency Bundler (`src/vendor.js` / `gofront prep`)

Provide a built-in workflow to package external JavaScript dependencies for browser consumption:
- `gofront prep` (or `gofront vendor`):
  1. Inspects external npm dependencies in `package.json` or imported `.d.ts` packages.
  2. Dynamically loads a bundler (`rolldown` or `esbuild`) from the consumer's `devDependencies`.
  3. Bundles them into single ES modules in the destination vendor folder (e.g., `app/vendor.js` or `app/vendor/*.js`).
  4. If no bundler is installed in the project, outputs an informative message suggesting `npm install --save-dev rolldown`.

### 4. CLI Orchestration (`src/cli-core.js` & `src/index.js`)

In accordance with GoFront's architectural rules:
- `src/index.js` only handles CLI argument routing:
  - `gofront prep` — runs asset copying and vendor bundling.
  - `gofront <input> -o <out> --copy-assets` — compiles and synchronizes assets.
  - `gofront <input> -o <out> --serve` — automatically activates SPA fallback.
- All execution logic resides in `src/cli-core.js`, `src/asset-manager.js`, and `src/dev-server.js`.

---

## Tasks

### Task 1: SPA Fallback in Dev Server
- Modify `src/dev-server.js` to inspect path extensions when files do not exist and serve `index.html`.
- Add unit test in `test/unit/compiler/dev-server.test.js`.

### Task 2: Asset Copy Manager
- Create `src/asset-manager.js` with `copyAssets(projectDir, config)`.
- Support directory recursive copy and file single copy with directory creation.
- Add unit tests in `test/unit/compiler/asset-manager.test.js`.

### Task 3: Vendor Bundling & Prep Command
- Create `src/vendor.js` with dynamic bundler invocation.
- Add `handlePrep(targetDir)` in `src/cli-core.js` orchestrating asset copy and vendor bundling.
- Wire `gofront prep` command in `src/index.js`.
- Add tests in `test/unit/compiler/prep.test.js`.

---

## Edge Cases

- **Missing Source Path:** When an `assetCopy` source does not exist (e.g., dependency not yet installed), log an informative warning instead of crashing.
- **Directory Traversal / Destination Overwrite:** Ensure destination paths are contained within the project directory.
- **Dev Server Query Strings & Hashes:** Strip query parameters (`?v=1`) before checking file existence and extensions.
- **Zero-Dependency Guarantee:** Ensure all core functionality runs on stock Node.js 20+ without requiring external npm packages.

---

## Test Plan

### Unit Tests
- `test/unit/compiler/asset-manager.test.js`: verify file copying, recursive directory copying, and graceful handling of missing sources.
- `test/unit/compiler/dev-server.test.js`: verify SPA fallback returns `index.html` for clean URLs and 404 for missing static assets.
- `test/unit/compiler/prep.test.js`: verify `gofront prep` reads `package.json` config and executes asset copy.

### Quality Gates
- Run `npm run check` (Biome lint/format + Sentrux architectural boundaries).
- Run `npm run test:unit` and `npm run test:e2e`.
