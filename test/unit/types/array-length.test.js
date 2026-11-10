// test/unit/types/array-length.test.js
// Constant array lengths must be non-negative, and a package used only in a
// constant array length counts as used on every compile of a cached file.

import { join } from "node:path";
import { compileFiles, evictParseCache } from "../../../src/compiler.js";
import {
	assertAllTargetsOutput,
	assertErrorContains,
	assertProgramOutput,
	compile,
	compileWasm,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("Array length checks");

function errorsOn(target, src) {
	if (target === "wasm") return compileWasm(src).errors ?? [];
	return compile(src, { target }).errors ?? [];
}

const NEGATIVE = [
	[
		"literal [-1]int",
		"package main\nfunc main() {\n\tvar a [-1]int\n\t_ = a\n}",
	],
	[
		"named constant -1",
		"package main\nconst n = -1\nfunc main() {\n\tvar a [n]int\n\t_ = a\n}",
	],
	[
		"math.MinInt8",
		'package main\nimport "math"\nfunc main() {\n\tvar a [math.MinInt8]int\n\t_ = a\n}',
	],
];

for (const [name, src] of NEGATIVE) {
	for (const target of ["js", "both", "wasm"]) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(errorsOn(target, src), "invalid array length");
		});
	}
}

test("[math.MaxInt8]int and [0]int stay valid", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"fmt"
	"math"
)

func main() {
	var a [math.MaxInt8]int
	var b [0]int
	fmt.Println(len(a), len(b), math.MaxInt8)
}
`,
		"127 0 127\n",
	);
});

const ARRAY_LEN_ONLY_IMPORT = `package main

import (
	"fmt"
	"math"
)

func main() {
	var a [math.MaxInt8]int
	fmt.Println(len(a))
}
`;

test("a package used only in an array length stays used on recompiles", () => {
	withTempDir({ "main.go": ARRAY_LEN_ONLY_IMPORT }, (dir) => {
		const goPath = join(dir, "main.go");
		try {
			for (const target of ["js", "wasm", "both"])
				compileFiles([goPath], { forceTarget: target });
		} finally {
			evictParseCache(goPath);
		}
	});
});

test("a package used only in an array length runs on both targets", async () => {
	await assertProgramOutput(ARRAY_LEN_ONLY_IMPORT, "127\n");
});

test("a negative array length is reported on recompiles", () => {
	const src =
		'package main\nimport "math"\nfunc main() {\n\tvar a [math.MinInt8]int\n\t_ = a\n}\n';
	withTempDir({ "main.go": src }, (dir) => {
		const goPath = join(dir, "main.go");
		try {
			for (const target of ["js", "wasm"]) {
				let msg = "";
				try {
					compileFiles([goPath], { forceTarget: target });
				} catch (e) {
					msg = e.message;
				}
				assertErrorContains([{ message: msg }], "invalid array length");
			}
		} finally {
			evictParseCache(goPath);
		}
	});
});
