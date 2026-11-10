// GoFront test suite — float32 constants are rounded to float32

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

section("float32 constants");

test("an untyped constant compared with and assigned to a float32", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func score(x, i float32) float32 { return i / (x * x) }

func main() {
	v := score(10, 1)
	fmt.Println(v == 0.01)
	var c float32 = 0.01
	fmt.Println(v == c)
}
`,
		"true\ntrue\n",
	);
});

test("a float32 constant widens to its float32 value", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var c float32 = 0.01
	fmt.Println(float64(c))
}
`,
		"0.009999999776482582\n",
	);
});

test("a typed float32 constant equals the rounded quotient", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

const k float32 = 0.1

func main() {
	var f float32 = 1
	fmt.Println(f/10 == k)
}
`,
		"true\n",
	);
});

test("float64 constants keep their value", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var a float64 = 0.01
	fmt.Println(a == 0.01)
	fmt.Println(0.01 == 0.01)
}
`,
		"true\ntrue\n",
	);
});

test("constants used as operands, arguments and named constants round", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

const half = 0.1

func f(x float32) float32 { return x }

func main() {
	var v float32 = 3
	fmt.Println(float64(v*0.1), float64(f(0.1)), float64(f(half)), float64(f(16777217)))
}
`,
		"0.30000001192092896 0.10000000149011612 0.10000000149011612 1.6777216e+07\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
