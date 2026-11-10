// GoFront test suite — range assignment into address-taken variables

import { fileURLToPath } from "node:url";
import { assertJsTargetsOutput, section, summarize, test } from "../helpers.js";

section("Range assignment: address-taken map range variables (JS)");

test("for _, v = range m with &v taken stores through the box", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func main() {
	m := map[string]int{"a": 1}
	var v int
	p := &v
	for _, v = range m {
	}
	fmt.Println(*p)
}
`,
		"1\n",
	);
});

test("for k = range m with &k taken stores the key through the box", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func main() {
	m := map[string]int{"a": 1}
	var k string
	p := &k
	for k = range m {
	}
	fmt.Println(*p)
}
`,
		"a\n",
	);
});

test("key and value both assigned into address-taken variables", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func main() {
	m := map[int]int{7: 9}
	var k, v int
	pk, pv := &k, &v
	for k, v = range m {
	}
	fmt.Println(*pk, *pv)
}
`,
		"7 9\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
