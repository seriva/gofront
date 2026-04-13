---
description: Verify changes with lint and tests before completing any task
---

# Verification Workflow

// turbo-all

Run these commands (in order) before considering **any** task complete.

1. Run the linter:
```bash
npm run check
```
This must exit with no errors. Fix any reported issues before moving on.

2. Run the tests:
```bash
npm test
```
This must complete successfully with all tests passing. If it fails, fix the issues and re-run all steps from the top.

3. Verify CLI execution (Integration Check):
```bash
node index.js version
```
This ensures the core CLI can still run without syntax or initialization errors.

Only after all commands exit cleanly is the task considered done.