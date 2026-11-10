// GoFront test suite — 64-bit compound assignments with untyped constants

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertProgramOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

section("int64 — untyped constant operands of compound assignments");

test("uint64 += untyped constant above 2^32", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

const half = 1 << 51

func main() {
	var b uint64 = 1
	b += half
	fmt.Println(b)
}
`,
		"2251799813685249\n",
	);
});

test("int64 -= untyped constant", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

const half = 1 << 51

func main() {
	var c int64 = 1
	c -= half
	fmt.Println(c)
}
`,
		"-2251799813685247\n",
	);
});

test("uint64 |= and *= with untyped constants", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

const half = 1 << 51
const three = 1 + 2

func main() {
	var b uint64 = 1
	b |= half
	fmt.Println(b)
	b *= three
	fmt.Println(b)
}
`,
		"2251799813685249\n6755399441055747\n",
	);
});

test("map element of 64-bit type with a constant operand", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

const half = 1 << 51

func main() {
	m := map[string]uint64{"a": 1}
	m["a"] += half
	fmt.Println(m["a"])
}
`,
		"2251799813685249\n",
	);
});

section("int64 — compound assignments in for post statements");

test("uint64 += untyped constant in a for post statement", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

const half = 1 << 51

func main() {
	var b uint64 = 1
	for i := 0; i < 1; b += half {
		i++
	}
	fmt.Println(b)
}
`,
		"2251799813685249\n",
	);
});

test("int64 -= untyped constant in a for post statement", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

const half = 1 << 51

func main() {
	var n int64 = 0
	for i := 0; i < 2; n -= half {
		i++
	}
	fmt.Println(n)
}
`,
		"-4503599627370496\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
