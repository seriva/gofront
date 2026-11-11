// GoFront test suite — range assignment into address-taken variables

import { fileURLToPath } from "node:url";
import { assertProgramOutput, section, summarize, test } from "../helpers.js";

section("Range assignment: address-taken map range variables");

test("for _, v = range m with &v taken stores through the box", async () => {
	await assertProgramOutput(
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
	await assertProgramOutput(
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
	await assertProgramOutput(
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

test("for k, v = range m with only &v taken still assigns k", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	m := map[string]int{"a": 1}
	var k string
	var v int
	p := &v
	for k, v = range m {
	}
	fmt.Println(k, *p)
}
`,
		"a 1\n",
	);
});

test("for k, v = range m with only &k taken still assigns v", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	m := map[string]int{"a": 1}
	var k string
	var v int
	p := &k
	for k, v = range m {
	}
	fmt.Println(*p, v)
}
`,
		"a 1\n",
	);
});

section("Range assignment: address-taken slice and string range variables");

test("for _, v = range s with &v taken stores through the box", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	s := []int{10, 20}
	var v int
	p := &v
	for _, v = range s {
	}
	fmt.Println(*p)
}
`,
		"20\n",
	);
});

test("for _, r = range str with &r taken stores through the box", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	var r rune
	p := &r
	for _, r = range "ab" {
	}
	fmt.Println(*p)
}
`,
		"98\n",
	);
});

test("for i = range s with &i taken stores through the box", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	s := []int{10, 20}
	var i int
	p := &i
	for i = range s {
	}
	fmt.Println(*p)
}
`,
		"1\n",
	);
});

test("for i, v = range str with &i and &v taken stores both", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	var i int
	var r rune
	pi, pr := &i, &r
	for i, r = range "xé" {
	}
	fmt.Println(*pi, *pr)
}
`,
		"1 233\n",
	);
});

test("for i, v = range array with &v taken stores through the box", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	a := [3]int{1, 2, 3}
	var i, v int
	pi, pv := &i, &v
	for i, v = range a {
	}
	fmt.Println(*pi, *pv)
}
`,
		"2 3\n",
	);
});

test("for i = range n with &i taken stores through the box", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	var i int
	p := &i
	for i = range 3 {
	}
	fmt.Println(*p)
}
`,
		"2\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
