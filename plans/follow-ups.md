# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Build script:** `scripts/build-examples.js` calls `process.exit(...)` inside `try { } finally { rmSync(tmp) }`, so the temp `gofront-examples-*` dir leaks on a build or parse failure. Repro: make a minified example bundle invalid and run `npm run build` → got leftover `gofront-examples-*` in the OS temp dir, want it removed. (PR #200, release-bundle-fixes Phase 1, Low)
- **Minifier:** whitespace between a decimal integer and `.` is dropped, so `123 .toString()` becomes a syntax error. Repro: `node -e 'import("./src/cli/minifier.js").then(m=>console.log(m.minify("123 .toString()")))'` → got `123.toString()`, want `123 .toString()`. (PR #200, release-bundle-fixes Phase 1, Out of Scope)
