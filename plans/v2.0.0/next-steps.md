# v2.0.0: Next Steps

**Written:** 2026-11-18, on `feat/checker-go-rules` at `564d9663` with the fuzzer, object-kind and underlying-type work uncommitted in the working tree.

This is a working checklist, not a design plan. Delete it once step 4 is under way; the plans and [`roadmap.md`](../roadmap.md) stay the source of truth.

---

## 1. Commit the current work

Everything is uncommitted on `feat/checker-go-rules`. It splits into four commits, in this order:

- [x] **Object kinds and addressability:** the `Scope` change in `src/typechecker/types.js`, the namespace `_kinds` tables, and the fixtures `assign_package_members.go`, `assign_imported_members/`, `assign_dot_imported_names/`, `addr_dts_nested_type_name/`, `assign_imported_variables/`, `assign_dts_namespace_members/`.
- [x] **Underlying types:** `_underlyingOver` and `_genericUnderlyingOver` in `src/typechecker/index.js`, the call in `src/typechecker/resolve.js`, and the fixtures `defined_over_defined_types.go`, `range_func_defined_over_defined.go`, `defined_chain_slice.go`, `generic_defined_over_generic.go`, `copy_defined_chain_elem_mismatch.go`.
- [x] **Fuzzer:** everything under `test/fuzz/`, `test/unit/cli/checkfuzz.test.js` and the `fuzz:check` script in `package.json`.
- [x] **Docs and plans:** `CHANGELOG.md`, `docs/architecture.md`, `docs/go-compatibility.md`, `plans/follow-ups.md`, `plans/roadmap.md` and both checker plans.

The fuzzer goes after the two source commits because its baseline was written with both applied: on an earlier commit `npm run fuzz:check` fails, and so does the baseline sample in `checkfuzz.test.js` when Go is on `PATH`.

## 2. Finish checker Go rules (Phases 6–14)

Plan: [`checker-go-rules-plan.md`](checker-go-rules-plan.md). Run each phase as before, plus the fuzzer gate below after each one.

- [ ] **Phase 6** (type structure): only R6.3 and R6.4 are left; the Task 6.3 sweep is tidying.
- [ ] **Phase 7** (range over integers): unchanged. The grid has no `range` section, so this phase is not under the fuzzer gate unless one is added first.
- [ ] **Phase 8** (predeclared names): unchanged in scope; it can read the object kind from `Scope` instead of matching names.
- [ ] **Phase 9** (generics): 2,079 baseline entries tagged `R9` are operators on type parameters, so this phase should remove most of them.
- [ ] **Phase 10** (backends): only R6.5 (JS range over a defined string) is left; R6.8 already passes.
- [ ] **Phases 11–14** (diagnostics, universe `error`, docs): unchanged.

### Fuzzer gate, after each phase

1. `npm run fuzz:check` (needs `go` on `PATH`; on this machine add `/usr/local/go/bin`).
2. `npm run fuzz:check -- --write-baseline`.
3. Check that `git diff test/fuzz/check-baseline.txt` only removes lines. An added line is a regression or a newly exposed gap: look at it with `npm run fuzz:check -- --show <key>`.

## 3. Triage before operand rules Phase 2

Plan: [`checker-operand-rules-plan.md`](checker-operand-rules-plan.md) (Phase 1, the fuzzer, is done).

- [ ] **Schedule or exclude the four causes no plan covers**, listed in [`follow-ups.md`](../follow-ups.md): `type-param-value` (889 baseline entries), `wasm-iface-equality` (94), `type-as-value` (21), `parser-conversion-type` (10). `/design-plan follow-ups` is the place for this.
- [ ] **Check the template-level tags.** `TAG_RULES` in `test/fuzz/checkfuzz.js` tags a whole template with one root. The largest group is `O5` with 1,712 entries; confirm one rule really covers it.
- [ ] **Route the other new ledger entries:** `wasm-defined-pointer`, `generic-defined-over-struct`, and predeclared constants shadowed by a variable.

## 4. Then, per the roadmap

- [ ] Merge the `feat/checker-go-rules` epic to `main`.
- [ ] Operand rules Phases 2–8. Each phase removes its `O<n>` entries from the baseline; the plan is done when only `excluded:` entries are left.
- [ ] Checker and compiler lane continues: JS names, `wasm` panics and type expressions → package scope → incremental builds (after `go-embed`) → JS dead-code elimination.
- [ ] `wasm` lane, independent of the checker work and can start now: `wasm` struct types → value stores.
- [ ] Web lane, after checker Go rules merges: typed web platform → `gom` signals.

---

## Where the fuzzer baseline lives

`test/fuzz/check-baseline.txt`, tracked in git next to the fuzzer (7,690 entries, 371 KB).

- One line per known disagreement: `<section>:<template>:<kinds>:<class> # <tag>`.
- The tag is the root cause (`O1`–`O8`, `R8`, `R9`, `W1`, or a root slug from `plans/follow-ups.md`) or `excluded: <why>` for a difference that is by design.
- `--write-baseline` rewrites it from the current run. A line that stays keeps its tag, so a tag edited by hand survives; a new line gets the tag of its template.
- `--baseline <file>` points a run at another file, for a scratch comparison.
- `npm test` does not re-run the whole grid. The fuzzer's `--self-test` always runs and checks that every baseline line names a real case, a known class and a tag. When Go is on `PATH`, `checkfuzz.test.js` also checks a 400-case sample against the baseline; without Go (as in CI) that test is skipped.
