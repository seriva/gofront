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

test("x <<= n accepts any integer count type", () => {
	const res = compileHybrid(`package main

func Main() int {
	x := 1
	var n uint = 3
	x <<= n
	var m uint8 = 1
	x >>= m
	y := int64(1) << m
	return x*100 + int(y)
}
`).run("Main");
	assertEqual(res.jsRes, 402);
	assertEqual(Number(res.wasmRes), 402);
});

test("a shift has the type of its left operand", () => {
	const res = compileHybrid(`package main

func Main() int64 {
	var x int64 = 1
	var n uint16 = 40
	return x << n
}
`).run("Main");
	assertEqual(Number(res.jsRes), 1099511627776);
	assertEqual(Number(res.wasmRes), 1099511627776);
});

test("error: negative constant shift count", () => {
	const { errors } = compile(`package main

func main() {
	x := 1
	const s = -1
	console.log(x << s)
}
`);
	assertErrorContains(errors, "invalid shift count");
});

test("error: negative constant shift count in <<=", () => {
	const { errors } = compile(`package main

func main() {
	x := 1
	x <<= -2
	console.log(x)
}
`);
	assertErrorContains(errors, "invalid shift count");
});

test("error: float shift count", () => {
	const { errors } = compile(`package main

func main() {
	x := 1
	var f float64 = 3
	console.log(x << f)
}
`);
	assertErrorContains(errors, "not an integer type");
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

section("Constants — JS backend emits folded values (Task 0.13b)");

test("JS emits the folded literal for 1 << 40", () => {
	const { js, warnings } = compile(`package main

const x = 1 << 40

func main() {
	var a int64 = 1 << 40
	println(a, x)
}
`);
	assertEqual(js.includes("1099511627776"), true);
	assertEqual(js.includes("1 << 40"), false);
	assertEqual(warnings.length, 0);
});

test("float64(x * 1000) with x = 1 << 40 matches on both backends", () => {
	const res = compileHybrid(`package main

const x = 1 << 40

func Main() float64 {
	var y int64 = 1 << 40
	if float64(y*1000) != float64(x*1000) {
		return -1
	}
	return float64(x * 1000)
}
`).run("Main");
	assertEqual(res.jsRes, 1099511627776000);
});

test("1 << 62 and math.MaxInt64 / 2 match on both backends", () => {
	const res = compileHybrid(`package main

import "math"

func Main() float64 {
	var a int64 = 1 << 62
	var b int64 = math.MaxInt64 / 2
	return float64(a) + float64(b)
}
`).run("Main");
	assertEqual(res.jsRes, 2 ** 62 * 2);
});

test("a[^uint8(0)] indexes element 255 on both backends", () => {
	const res = compileHybrid(`package main

func Main() int {
	var a [256]int
	for i := range a {
		a[i] = i * 2
	}
	return a[^uint8(0)]
}
`).run("Main");
	assertEqual(res.jsRes, 510);
});

test("warning: 1<<63 + 5 exceeds JS Number precision", () => {
	const src = `package main

func main() {
	var u uint64 = uint64(1<<63 + 5)
	println(u)
}
`;
	const { js, warnings } = compile(src);
	assertEqual(js.includes("9223372036854775808"), true);
	assertErrorContains(
		warnings.map((message) => ({ message })),
		"constant 9223372036854775813 exceeds JS Number precision",
	);
	const both = compile(src, { target: "both" });
	assertErrorContains(
		both.warnings.map((message) => ({ message })),
		"constant 9223372036854775813 exceeds JS Number precision",
	);
});

section("Constants — review fixes (overflow contexts, precision warning)");

const mainWith = (body, imports = "") =>
	`package main\n${imports}\nfunc main() {\n${body}\n}\n`;

test("error: x := 1 << 63 overflows int (M2)", () => {
	const { errors } = compile(mainWith("x := 1 << 63\nprintln(x)"));
	assertErrorContains(
		errors,
		"(untyped int constant 9223372036854775808) as int value in variable declaration (overflows)",
	);
});

test("error: x := math.MaxUint64 overflows int (M2)", () => {
	const { errors } = compile(
		mainWith("x := math.MaxUint64\nprintln(x)", 'import "math"'),
	);
	assertErrorContains(
		errors,
		"(untyped int constant 18446744073709551615) as int value in variable declaration (overflows)",
	);
});

test("error: x = 300 into int8 overflows (M2)", () => {
	const { errors } = compile(mainWith("var x int8\nx = 300\nprintln(x)"));
	assertErrorContains(
		errors,
		"cannot use 300 (untyped int constant) as int8 value in assignment (overflows)",
	);
});

test("error: x + 300 with x int8 overflows int8 (M2)", () => {
	const { errors } = compile(
		mainWith("var x int8 = 1\ny := x + 300\nprintln(y)"),
	);
	assertErrorContains(errors, "300 (untyped int constant) overflows int8");
});

test("error: println(1 << 64) overflows int (M2)", () => {
	const { errors } = compile(mainWith("println(1 << 64)"));
	assertErrorContains(
		errors,
		"as int value in argument to built-in println (overflows)",
	);
	const viaAny = compile(`package main

func f(v any) {}

func main() {
	f(1 << 64)
}
`);
	assertErrorContains(viaAny.errors, "as int value in argument (overflows)");
});

test("shift-assign counts beyond the operand type do not overflow", () => {
	const { errors } = compile(
		mainWith(
			"var x int8 = 1\nx <<= 300\nvar y uint8 = 64\ny >>= 200\nprintln(x, y)",
		),
	);
	assertEqual(errors.length, 0);
});

test("in-range constants in the same contexts still compile (M2)", () => {
	const { errors } = compile(
		mainWith(
			"x := 1 << 62\nvar y int8\ny = 127\nz := y + 1\nvar u uint64 = math.MaxUint64\nprintln(x, y, z, u, 1<<62, x < math.MaxInt64)",
			'import "math"',
		),
	);
	assertEqual(errors.length, 0);
});

test("warning: integral float and named constants in integer contexts (M3)", () => {
	const msgs = (src) => compile(src).warnings.map((message) => ({ message }));
	assertErrorContains(
		msgs(mainWith("var x int64 = 1e18 + 1\nprintln(x)")),
		"constant 1000000000000000001 exceeds JS Number precision",
	);
	assertErrorContains(
		msgs(mainWith("var x int64 = math.MaxInt64\nprintln(x)", 'import "math"')),
		"constant 9223372036854775807 exceeds JS Number precision",
	);
	// Float contexts and exactly representable values stay quiet.
	const quiet = compile(
		mainWith(
			"var f float64 = 1e18 + 1\nvar x int64 = 1e18\nvar u uint64 = 1 << 63\nprintln(f, x, u, math.MaxInt32)",
			'import "math"',
		),
	);
	assertEqual(quiet.warnings.length, 0);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
