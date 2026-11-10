// test/unit/types/array-length.test.js
// Constant array lengths must be non-negative.

import {
	assertAllTargetsOutput,
	assertErrorContains,
	compile,
	compileWasm,
	section,
	test,
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
