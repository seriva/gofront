// GoFront test suite — exact constant expressions (Tasks 0.13a/0.13b)

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	assertErrorContains,
	compile,
	compileHybrid,
	compileHybridProject,
	compileWasm,
	runWasm,
	section,
	summarize,
	test,
} from "../helpers.js";

function wasmLines(src) {
	const { wasm, stringTable, errors } = compileWasm(src);
	assertEqual(errors?.length ?? 0, 0);
	const { exports, lines } = runWasm(wasm, { stringTable });
	exports.Main();
	return lines.join("\n");
}

section("Constants — shared folder (Task 0.13a)");

test("int64 constant expressions are exact in WASM", () => {
	const out = wasmLines(`package main

import "math"

func Main() {
	var a int64 = 1 << 40
	var b int64 = 1 << 62
	var c int64 = math.MaxInt64
	var d int64 = math.MaxUint64 >> 1
	var e int64 = -1 << 63
	var f int64 = 1e18 + 1
	println(a, b, c)
	println(d, e, f)
}
`);
	assertEqual(
		out,
		"1099511627776 4611686018427387904 9223372036854775807\n" +
			"9223372036854775807 -9223372036854775808 1000000000000000001",
	);
});

test("untyped constants may overflow intermediately: big >> 98 == 4", () => {
	const out = wasmLines(`package main

const big = 1 << 100
const scaled = big / (1 << 90)

func Main() {
	var x = big >> 98
	println(x, scaled)
}
`);
	assertEqual(out, "4 1024");
});

test("typed constants follow their type: ^uint8(0), uint64 above 2^63", () => {
	const out = wasmLines(`package main

import "strconv"

const M uint8 = ^uint8(0)

func Main() {
	println(M, ^uint16(1))
	var u uint64 = uint64(1<<63 + 5)
	println(strconv.FormatUint(u, 10))
}
`);
	assertEqual(out, "255 65534\n9223372036854775813");
});

test("error: int32(1 << 40) overflows", () => {
	const { errors } = compile(`package main

func main() {
	x := int32(1 << 40)
	_ = x
}
`);
	assertErrorContains(errors, "constant 1099511627776 overflows int32");
});

test("error: var x int8 = 200 overflows", () => {
	const { errors } = compile(`package main

func main() {
	var x int8 = 200
	_ = x
}
`);
	assertErrorContains(
		errors,
		"cannot use 200 (untyped int constant) as int8 value in variable declaration (overflows)",
	);
});

test("error: typed constant arithmetic overflows its type", () => {
	const { errors } = compile(`package main

const a int8 = 100
const b = a * 2

func main() {}
`);
	assertErrorContains(errors, "constant 200 overflows int8");
});

test("error: constant division by zero", () => {
	const { errors } = compile(`package main

const k = 1 / 0

func main() {}
`);
	assertErrorContains(errors, "invalid operation: division by zero");
});

test("valid programs at the edges do not report overflow", () => {
	const { errors } = compile(`package main

import "math"

const big = 1 << 100

func main() {
	var a int8 = -128
	var b uint64 = math.MaxUint64
	var c int64 = math.MinInt64
	var d = big >> 98
	var e float64 = big
	_, _, _, _, _ = a, b, c, d, e
}
`);
	assertEqual(errors.map((e) => e.message).join("\n"), "");
});

test("constant builtin keys resolve to their index", () => {
	const res = compileHybrid(`package main

const K = len("abc")

func Main() int {
	a := [5]int{K: 5, len("a"): 1}
	b := [4]int{min(3, 2): 7}
	return a[3]*100 + a[1]*10 + b[2]
}
`).run("Main");
	assertEqual(res.jsRes, 517);
});

test("error: duplicate index through a folded builtin key", () => {
	const { errors } = compile(`package main

func main() {
	a := [5]int{3: 1, len("abc"): 2}
	_ = a
}
`);
	assertErrorContains(errors, "duplicate index 3 in array or slice literal");
});

test("dot-imported constant array key places the value", async () => {
	const { mod } = await compileHybridProject(
		{
			"consts/c.go": `//gofront:target both
package consts

const K = 2
`,
			"main.go": `package main

import . "./consts"

func Main() int {
	a := [3]int{K: 5}
	return a[2]*10 + a[0]
}
`,
		},
		{ exports: ["Main"] },
	);
	assertEqual(mod.Main(), 50);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
