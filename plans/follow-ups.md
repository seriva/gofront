# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/bs-loop` reviewers and by any agent session. Open items only: `/bs-plan follow-ups` re-probes them, groups them by root cause, and moves each into a plan (as a fix task or a deferred row), deleting it here.

Each entry names its root cause (the mechanism that produces it, not the path that exposed it) and its route: the open plan whose scope covers that root, or `unrouted`. Entries with the same root sit together. A defect with the same root as the task being fixed is part of that task and never lands here (`/bs-loop` **Follow-ups**).

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Root: `<root-slug>` (<mechanism, with `file:symbol`>). Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>) → <plan-slug | unrouted>
-->
