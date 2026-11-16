# Follow-ups

Bugs noticed outside the task at hand, each with a repro so it can be re-checked later. Written by `/dev-loop` reviewers and by any agent session. Open items only: `/design-plan follow-ups` re-probes them and moves each into a plan (as a fix task or a deferred row), deleting it here.

<!-- Entry format (one line each):
- **<Area>:** <defect in one sentence>. Repro: `<snippet or command>` → got `<actual>`, want `<expected>`. (<PR #N or branch>, <plan-slug Phase N | standalone>, <Low | Out of Scope>)
-->
- **Untyped third-party imports:** an import with no resolvable types warns "treating as any" but any use of it is then rejected as undefined. Repro: `import "nope/zzz"; func main() { zzz.F() }` via `compileFiles` → got `warning: cannot find types for 'nope/zzz', treating as any` then `Type error … Undefined: 'zzz'`, want it to compile with `zzz` typed as `any` (or no "treating as any" claim). (design-plan review 2026-11-13, standalone, Out of Scope)
- **Named basic types:** a method-less named basic type named after a JS built-in is emitted as `class Map` and crashes at module load. Repro: `package main; import "fmt"; type Map int; func main() { var x Map = 5; fmt.Println(x) }` → got `ReferenceError: Cannot access 'Map' before initialization`, want `5`. (PR #203, js-codegen-fixes Phase 1, Out of Scope)
- **Method call on a variable named after its type:** a local or parameter whose name equals its named type compiles but the method call reads the class instead of the variable. Repro: `type T int; func (n T) Dbl() T { return n*2 }; func f() int { var T T = 4; return int(T.Dbl()) }` → got `T.$Dbl is not a function` at runtime, want `8` (base: `Too few arguments: expected 1, got 0`). (feat/js-codegen-fixes-phase-1, js-codegen-fixes Phase 1, Out of Scope)
