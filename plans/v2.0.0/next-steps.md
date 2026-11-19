# v2.0.0: Next Steps

**Written:** 2026-11-18, on `feat/checker-go-rules` at `564d9663` with the fuzzer, object-kind and underlying-type work uncommitted in the working tree. **Updated:** 2026-11-19 after checker-go-rules Phase 14 and the follow-up sweep (merge `1e1b5709`).

This is a working checklist, not a design plan. Delete it once step 4 is under way; the plans and [`roadmap.md`](../roadmap.md) stay the source of truth.

---

## 1. Commit the current work

Everything is uncommitted on `feat/checker-go-rules`. It splits into four commits, in this order:

- [x] **Object kinds and addressability:** the `Scope` change in `src/typechecker/types.js`, the namespace `_kinds` tables, and the fixtures `assign_package_members.go`, `assign_imported_members/`, `assign_dot_imported_names/`, `addr_dts_nested_type_name/`, `assign_imported_variables/`, `assign_dts_namespace_members/`.
- [x] **Underlying types:** `_underlyingOver` and `_genericUnderlyingOver` in `src/typechecker/index.js`, the call in `src/typechecker/resolve.js`, and the fixtures `defined_over_defined_types.go`, `range_func_defined_over_defined.go`, `defined_chain_slice.go`, `generic_defined_over_generic.go`, `copy_defined_chain_elem_mismatch.go`.
- [x] **Fuzzer:** everything under `test/fuzz/`, `test/unit/cli/checkfuzz.test.js` and the `fuzz:check` script in `package.json`.
- [x] **Docs and plans:** `CHANGELOG.md`, `docs/architecture.md`, `docs/go-compatibility.md`, `plans/follow-ups.md`, `plans/roadmap.md` and both checker plans.

The fuzzer goes after the two source commits because its baseline was written with both applied: on an earlier commit `npm run fuzz:check` fails, and so does the baseline sample in `checkfuzz.test.js` when Go is on `PATH`.

## 2. Finish checker Go rules (Phases 16–28)

Plan: [`checker-go-rules-plan.md`](checker-go-rules-plan.md). Phases 1–15 are done (Phase 9 took `R9` from 2,079 baseline entries to 370). Run each remaining phase as before, plus the fuzzer gate below after each one.

- [ ] **Phases 16–21** (review follow-ups of 2026-11-18): type-parameter operands, builtins on type parameters, `comparable`, generic types over a struct, non-boolean condition wording, redeclaring `true`/`false`/`nil`. Phase 16 should remove most of the remaining 370 `R9` entries.
- [ ] **Phases 22–28** (sweep of 2026-11-19): type-parameter values (Phase 22 should remove the 889 `type-param-value` entries), core types, constraint type sets, builtin arity, local type scope, names used as values (Phase 27 removes the 21 `type-as-value` entries and carries the docs update), generated Go and shadowed builtins.
- [ ] **Route the ledger's remaining entries** (8 `unrouted` in [`follow-ups.md`](../follow-ups.md), from Phases 11–14) with `/bs-plan follow-ups` before the epic merges.

### Fuzzer gate, after each phase

1. `npm run fuzz:check` (needs `go` on `PATH`; on this machine add `/usr/local/go/bin`). Since 2026-11-19 the grid has a `range` section (216 cases; 25 `R18` and 3 `O4` lines).
2. `npm run fuzz:check -- --write-baseline`.
3. Check that `git diff test/fuzz/check-baseline.txt` only removes lines. An added line is a regression or a newly exposed gap: look at it with `npm run fuzz:check -- --show <key>`.

## 3. Triage before operand rules Phase 2

Plan: [`checker-operand-rules-plan.md`](checker-operand-rules-plan.md) (Phase 1, the fuzzer, is done; Phase 9, comparable types, was added on 2026-11-19).

- [x] **Schedule the four causes no plan covered** (2026-11-19): `type-param-value` → checker-go-rules Phase 22; `wasm-iface-equality` → [`codegen-fixes-plan.md`](codegen-fixes-plan.md) Phase 3; `type-as-value` → checker-go-rules Phase 27; `parser-conversion-type` was already [`names-panics-type-exprs-plan.md`](names-panics-type-exprs-plan.md) Task 4.2.
- [ ] **Check the template-level tags.** `TAG_RULES` in `test/fuzz/checkfuzz.js` tags a whole template with one root. The largest group is `O5` with 1,711 entries; confirm one rule really covers it.
- [x] **Route the other new ledger entries** (2026-11-19): `wasm-defined-pointer` → codegen-fixes Phase 5; `generic-defined-over-struct` → checker-go-rules Phase 19; predeclared constants → checker-go-rules Phase 21.

## 4. Then, per the roadmap

- [ ] Merge the `feat/checker-go-rules` epic to `main`.
- [ ] Operand rules Phases 2–9. Each phase removes its `O<n>` entries from the baseline; the plan is done when only `excluded:` entries are left.
- [ ] [`diagnostic-text-plan.md`](diagnostic-text-plan.md): Phases 1–3 can start any time (text only); Phase 4 waits for operand rules Phase 2. Each phase removes `// pending:` headers from conformance cases; Task 1.1 adds `npm run conformance:go`, a second Go-backed gate.
- [ ] [`codegen-fixes-plan.md`](codegen-fixes-plan.md): independent of the checker plans (JS statement emission, `wasm` codegen); can start now. Phase 3 removes the 94 `wasm-iface-equality` entries.
- [ ] Checker and compiler lane continues: JS names, `wasm` panics and type expressions → package scope → incremental builds (after `go-embed`) → JS dead-code elimination.
- [ ] `wasm` lane, independent of the checker work and can start now: `wasm` struct types → value stores.
- [ ] Web lane, after checker Go rules merges: typed web platform → `gom` signals.

---

## Where the fuzzer baseline lives

`test/fuzz/check-baseline.txt`, tracked in git next to the fuzzer (5,794 entries, 281 KB on 2026-11-19; 7,690 when written).

- One line per known disagreement: `<section>:<template>:<kinds>:<class> # <tag>`.
- The tag is the root cause (`O1`–`O8`, `R8`, `R9`, `W1`, or a root slug from `plans/follow-ups.md`) or `excluded: <why>` for a difference that is by design.
- `--write-baseline` rewrites it from the current run. A line that stays keeps its tag, so a tag edited by hand survives; a new line gets the tag of its template.
- `--baseline <file>` points a run at another file, for a scratch comparison.
- `npm test` does not re-run the whole grid. The fuzzer's `--self-test` always runs and checks that every baseline line names a real case, a known class and a tag. When Go is on `PATH`, `checkfuzz.test.js` also checks a 400-case sample against the baseline; without Go (as in CI) that test is skipped.
