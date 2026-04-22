# E2E Testing Plan

## Goal

Add end-to-end tests that run the three example apps (Simple, Reactive, Gom) in a real
browser and verify the full user-facing feature set: adding todos, toggling, deleting,
filtering, priority mode, drag-and-drop reordering, and localStorage persistence. The
tests must cover all three apps with a shared test suite, proving that each rendering
approach (vanilla DOM, reactive signals, gom built-in) produces identical behaviour.

---

## Tool choice

**Playwright** — the right fit because:

- Headless Chromium, Firefox, and WebKit in a single runner.
- First-class `waitFor*` helpers handle async rendering (signals batching, `await loadTodos()`).
- `page.evaluate()` lets tests inspect localStorage and trigger JS directly.
- Zero config for static-file serving via `playwright.config.js`.
- Output is CI-friendly; screenshots and traces on failure with no extra setup.

No framework wrapper needed — plain Playwright + Node.js ESM, consistent with the rest
of the project.

---

## Selector strategy

The DOM audit confirmed all three apps share the same class names and `data-*` attributes.
Build a thin selector layer so tests never have hardcoded strings:

```js
// test/e2e/selectors.js
export const S = {
  input:        '.todo-input',
  addBtn:       '[data-action="add"]',
  priorityBtn:  '[data-action="priority"]',
  todoItem:     '.todo-item',
  checkbox:     (id) => `[data-action="toggle"][data-todo-id="${id}"]`,
  deleteBtn:    (id) => `[data-action="delete"][data-todo-id="${id}"]`,
  filterAll:    '[data-action="filter"][data-filter="0"]',
  filterActive: '[data-action="filter"][data-filter="1"]',
  filterDone:   '[data-action="filter"][data-filter="2"]',
  clearBtn:     '[data-action="clear-completed"]',
  badge:        '.badge',
  highBadge:    '.high-badge',
  syncStatus:   '.sync-status',
};
```

**Two areas that need per-app handling:**

1. **Stats bar** — Simple embeds urgency counts in the header badge; Reactive mounts into
   `#stats-bar`; Gom renders `.stats-bar`. Write a per-app `statsCount(page)` helper
   rather than a shared selector.

2. **Reactive scoped CSS** — outer containers (`.card`, `.header`) get dynamically-scoped
   class names. Use semantic element selectors (`header`, `footer`, `ul.todo-list`) for
   structural assertions in the Reactive app.

---

## Test infrastructure

```
test/e2e/
  playwright.config.js   ← project definitions (one per app), base URL, timeouts
  selectors.js           ← shared S object
  helpers.js             ← addTodo(), toggleTodo(), clearStorage(), etc.
  fixtures/
    app.fixture.js       ← beforeEach: build app, start static server, clear localStorage
  simple.spec.js         ← Simple-specific overrides (if any)
  reactive.spec.js       ← Reactive-specific overrides (if any)
  gom.spec.js            ← Gom-specific overrides (if any)
  shared.spec.js         ← parameterized suite run against all three apps
```

### Playwright projects (one per app)

```js
// playwright.config.js
export default {
  projects: [
    { name: 'simple',   use: { baseURL: 'http://localhost:3001' } },
    { name: 'reactive', use: { baseURL: 'http://localhost:3002' } },
    { name: 'gom',      use: { baseURL: 'http://localhost:3003' } },
  ],
  webServer: [
    { command: 'npx serve example/simple   -p 3001', url: 'http://localhost:3001' },
    { command: 'npx serve example/reactive -p 3002', url: 'http://localhost:3002' },
    { command: 'npx serve example/gom      -p 3003', url: 'http://localhost:3003' },
  ],
};
```

Each project runs `shared.spec.js` plus its own `<app>.spec.js` for any app-specific
assertions.

---

## Shared test suite (shared.spec.js)

Run identically against all three apps via Playwright projects.

### Section 1 — Todo CRUD
- Add a todo → item appears in list
- Add todo with empty input → rejected (no item added)
- Add todo exceeding max length → rejected
- Toggle todo → item gets `.done` class
- Toggle done todo → `.done` class removed
- Delete todo → item removed from list
- Add multiple todos → all appear in correct order

### Section 2 — Filtering
- Filter "Active" → only incomplete todos visible
- Filter "Completed" → only done todos visible
- Filter "All" → all todos visible
- Active filter count updates after toggle
- Clear completed → removes all done todos, active remain

### Section 3 — Priority mode
- Click priority button → button gets `.on` class, input gets `.high` class
- Add todo in priority mode → item gets `.high` class and `.badge`
- Click priority button again → mode off, subsequent todos are normal

### Section 4 — Persistence
- Add todos, reload page → todos still present (localStorage)
- Toggle todo, reload → done state preserved
- Clear completed, reload → cleared todos stay gone

### Section 5 — Drag-and-drop reordering
- Drag first item below second → order swapped
- Drag last item above first → item moves to top

### Section 6 — Sync status
- After add → `.sync-status` shows saving then saved state
- After toggle → saving → saved cycle visible

---

## App-specific test files

### simple.spec.js
- Verify `injectStyles()` created a `<style>` tag in `<head>`
- Stats display in header badge (urgency count)

### reactive.spec.js
- Loading placeholder visible before todos load, gone after
- Signal batching: rapid toggles settle to correct state
- Stats bar mounted into `#stats-bar`

### gom.spec.js
- `gom.Style` injected `<style>` into `<head>` via `MountTo`
- `.high-badge` absent from DOM when no urgent todos (uses `gom.If`, no hidden span)
- Stats bar present as `.stats-bar`

---

## Build step

E2E tests run against the compiled `app.js` files, not source. Add a pre-E2E build step:

```js
// playwright.config.js
globalSetup: './test/e2e/global-setup.js',
```

```js
// test/e2e/global-setup.js
import { execSync } from 'node:child_process';
export default function() {
  execSync('npm run build:simple && npm run build:reactive && npm run build:gom');
}
```

This ensures E2E always tests the current compiled output.

---

## npm scripts

```json
"test:e2e":        "playwright test",
"test:e2e:ui":     "playwright test --ui",
"test:e2e:simple": "playwright test --project=simple",
```

The existing `npm test` (unit suite) stays unchanged. E2E runs separately — too slow for
the pre-commit hook. Add to CI only.

---

## CI integration

Run unit tests on every push (fast, ~5s). Run E2E on PRs to main and nightly:

```yaml
# .github/workflows/e2e.yml
- run: npx playwright install --with-deps chromium
- run: npm run test:e2e
```

---

## Dependencies to add (when implementing)

```sh
npm install --save-dev @playwright/test serve
npx playwright install chromium
```

`serve` is the zero-config static file server used in `webServer`. No other new runtime
dependencies.

---

## Open questions

- **Drag-and-drop in Playwright** — simulated via `dragAndDrop()` API; needs verification
  that the `dragover` / `drop` event sequence matches what the apps listen for.
- **Reactive async timing** — `computedAsync` signals may need explicit `waitFor`
  assertions rather than immediate checks; calibrate timeouts during implementation.
- **localStorage isolation** — Playwright contexts are isolated by default; confirm
  `clearStorage()` in `beforeEach` is still needed or can be dropped.
