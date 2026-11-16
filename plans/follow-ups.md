# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Test runner:** a directory passed as a file argument fails at worker import instead of a usage error. Repro: `node test/unit/run.js fixtures/harness` → got exit 1 `ERR_UNSUPPORTED_DIR_IMPORT`, want exit 2. (PR #217, test-harness-hardening Phase 3, Low)
- **Test runner:** an invalid `--grep`/`TEST_GREP` regex is not validated at startup. Repro: `TEST_PARALLEL=0 node test/unit/run.js --grep "[" fixtures/harness/pass.test.js` → got uncaught `SyntaxError`, want exit 2 usage error. (PR #217, test-harness-hardening Phase 3, Low)
- **Test runner:** a negative `TEST_FILE_TIMEOUT_MS` times out every file instead of falling back to the default. Repro: `TEST_FILE_TIMEOUT_MS=-1 node test/unit/run.js fixtures/harness/pass.test.js` → got `pass.test.js › timed out`, exit 1, want pass. (PR #217, test-harness-hardening Phase 3, Low)
- **Tests:** `language/value-semantics.test.js` registers the same test name twice. Repro: `grep -n "a scalar-only anonymous struct copy still uses __sclone" test/unit/language/value-semantics.test.js` → got lines 767 and 1125, want one. (PR #217, test-harness-hardening Phase 3, Out of Scope)
