// test/unit/wasm/golden.test.js
// Golden WAT and size-budget tests.  The golden fixture pins the instruction
// sequences the backend emits for a small representative program; the size
// budget catches accidental growth of the per-module runtime baseline.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	assert,
	assertEqual,
	compileWasm,
	FIXTURES,
	section,
	test,
} from "../helpers.js";

section("WASM — golden WAT");

const GOLDEN_SRC = `package main

type Vec struct {
	X, Y float64
}

func (v Vec) Dot(o Vec) float64 { return v.X*o.X + v.Y*o.Y }

func Add(a, b int) int { return a + b }

func Sum(xs []int) int {
	t := 0
	for _, x := range xs {
		t += x
	}
	return t
}

func Main() float64 {
	v := Vec{1, 2}
	return v.Dot(Vec{3, 4}) + float64(Add(1, 2)) + float64(Sum([]int{1, 2, 3}))
}
`;

const GOLDEN_FUNCS = ["Vec_Dot", "Add", "Sum", "Main"];
const GOLDEN_FILE = join(FIXTURES, "wasm", "golden.wat");

// Function/type indices shift whenever the runtime import table changes, so
// they are normalised; the instruction sequences themselves must match.
function normalize(text) {
	return text
		.replace(/\$f\d+/g, "$f")
		.replace(/\$t\d+/g, "$t")
		.replace(/\bcall \d+/g, "call N")
		.replace(
			/\b(struct\.(?:new|get|set)|array\.(?:new|get|set|new_default|len|new_fixed)|ref\.(?:cast|test)) \$t\b/g,
			"$1 $t",
		);
}

function extractFuncs(wat, names) {
	const lines = wat.split("\n");
	const out = [];
	for (const name of names) {
		const start = lines.findIndex((l) => l.includes(`(export "${name}")`));
		assert(start >= 0, `function ${name} not found in WAT`);
		let end = start + 1;
		while (end < lines.length && lines[end] !== "  )") end++;
		out.push(lines.slice(start, end + 1).join("\n"));
	}
	return normalize(out.join("\n"));
}

test("user function bodies match the golden WAT fixture", () => {
	const { wat, errors } = compileWasm(GOLDEN_SRC, { emitWat: true });
	assertEqual(errors?.length ?? 0, 0);
	const actual = extractFuncs(wat, GOLDEN_FUNCS);
	if (process.env.UPDATE_GOLDEN) {
		writeFileSync(GOLDEN_FILE, `${actual}\n`);
	}
	const expected = readFileSync(GOLDEN_FILE, "utf8").trimEnd();
	if (actual !== expected) {
		throw new Error(
			`golden WAT mismatch (run with UPDATE_GOLDEN=1 to accept)\n--- expected\n${expected}\n--- actual\n${actual}`,
		);
	}
});

section("WASM — size budget");

test("runtime baseline of a minimal module stays within budget", () => {
	const { wasm } = compileWasm(`package main
func Main() int { return 1 }
`);
	// Imports + panic runtime + trampolines.  Bump deliberately, not by accident.
	const BUDGET = 3 * 1024;
	assert(
		wasm.length <= BUDGET,
		`minimal module is ${wasm.length} bytes, budget ${BUDGET}`,
	);
});

test("golden program stays within budget", () => {
	const { wasm } = compileWasm(GOLDEN_SRC);
	const BUDGET = 6 * 1024;
	assert(
		wasm.length <= BUDGET,
		`golden module is ${wasm.length} bytes, budget ${BUDGET}`,
	);
});
