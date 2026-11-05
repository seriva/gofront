// GoFront test suite — native registry self-check
//
// Every `//gofront:native <name>` in stdlib/ must be a closed-set name
// (NATIVES) with an implementation in both backend registries, unless it is
// listed below as single-target.  A registry entry no Go file names is dead.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertEqual, section, test } from "../helpers.js";

// Other test files register throwaway natives in the shared registries, and a
// worker keeps modules between files. A query string gives this check its own
// untouched copy of each registry, whatever ran before it.
const { JS_NATIVES } = await import(
	"../../../src/backend/js/natives.js?pristine"
);
const { WASM_NATIVES } = await import(
	"../../../src/backend/wasm/natives.js?pristine"
);
const { NATIVES } = await import("../../../src/typechecker/types.js?pristine");

const STDLIB_ROOT = fileURLToPath(new URL("../../../stdlib", import.meta.url));

// Natives that exist on one backend only; the other runs the Go body.
const JS_ONLY = new Set([
	// Host array and string primitives with no WASM import.
	"slices.Index",
	"slices.Contains",
	"slices.Clone",
	"slices.Reverse",
	"slices.Sort",
	"sort.Ints",
	"sort.Strings",
	"utf8.RuneCountInString",
	"bytes.IndexByte",
	"bytes.Equal",
	"bytes.Compare",
	"strings.Split",
	"strings.Join",
	"strings.Repeat",
	"strings.Fields",
	// The encoder's buffer writes: the Go bodies serve WASM.
	"jsonrt.putString",
	"jsonrt.putInt",
	"jsonrt.putUint",
	"jsonrt.putFloat",
	"jsonrt.putQuoted",
	"jsonrt.readStr",
	"jsonrt.readNum",
	"jsonrt.CheckValid",
	"jsonrt.LooksFloat32",
]);
// math/bits natives that only the WASM instructions serve: JS declines the
// 64-bit and `uint` widths (BigInt and imprecise Numbers) and runs the Go body.
const WASM_ONLY = new Set(
	["Len", "LeadingZeros", "TrailingZeros", "OnesCount"].flatMap((f) => [
		`bits.${f}`,
		`bits.${f}64`,
	]),
);

// Native names declared in the `.go` files under `dir`, recursively.
export function declaredNatives(dir) {
	const names = new Set();
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			for (const n of declaredNatives(p)) names.add(n);
		} else if (e.name.endsWith(".go")) {
			const src = readFileSync(p, "utf8");
			for (const m of src.matchAll(/^\s*\/\/gofront:native\s+(\S+)/gm))
				names.add(m[1]);
		}
	}
	return names;
}

// Human-readable problems between declared names and the registries.
export function nativeProblems(
	declared,
	{ js, wasm, closed, jsOnly, wasmOnly },
) {
	const problems = [];
	for (const n of declared) {
		if (!closed.has(n)) problems.push(`'${n}' is not in NATIVES`);
		if (!js.has(n) && !wasmOnly.has(n))
			problems.push(`'${n}' has no JS native`);
		if (!wasm.has(n) && !jsOnly.has(n))
			problems.push(`'${n}' has no WASM native`);
	}
	for (const [label, reg] of [
		["NATIVES", closed],
		["JS native", js],
		["WASM native", wasm],
	])
		for (const n of reg)
			if (!declared.has(n))
				problems.push(`${label} '${n}' is named by no Go file`);
	for (const n of jsOnly)
		if (wasm.has(n)) problems.push(`'${n}' is JS-only but has a WASM native`);
	for (const n of wasmOnly)
		if (js.has(n)) problems.push(`'${n}' is WASM-only but has a JS native`);
	return problems;
}

const real = () => ({
	js: new Set(JS_NATIVES.keys()),
	wasm: new Set(WASM_NATIVES.keys()),
	closed: NATIVES,
	jsOnly: JS_ONLY,
	wasmOnly: WASM_ONLY,
});

section("native registry self-check");

test("every stdlib native is registered and every registry entry is used", () => {
	assertEqual(
		nativeProblems(declaredNatives(STDLIB_ROOT), real()).join("; "),
		"",
	);
});

test("an unregistered native name is reported", () => {
	const declared = new Set([...declaredNatives(STDLIB_ROOT), "fake.Missing"]);
	const problems = nativeProblems(declared, real());
	assertEqual(
		problems.sort().join("; "),
		[
			"'fake.Missing' has no JS native",
			"'fake.Missing' has no WASM native",
			"'fake.Missing' is not in NATIVES",
		].join("; "),
	);
});

test("a registry entry no Go file names is reported", () => {
	const declared = declaredNatives(STDLIB_ROOT);
	declared.delete("strings.Index");
	const problems = nativeProblems(declared, real());
	assertEqual(problems.length, 3, `problems: ${problems.join("; ")}`);
});
