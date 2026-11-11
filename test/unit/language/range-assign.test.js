// GoFront test suite — range assignment into address-taken variables

import { fileURLToPath } from "node:url";
import {
	assertErrorContains,
	assertProgramOutput,
	compile,
	compileWasm,
	section,
	summarize,
	test,
} from "../helpers.js";

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

section("Range assignment: the index of a string, slice or array range is int");

function rangeErrorsOn(target, src) {
	if (target === "wasm") return compileWasm(src).errors ?? [];
	return compile(src, { target }).errors ?? [];
}

for (const [name, src, want] of [
	[
		"for i = range s with i int32 and s a string",
		'package main\nfunc main() {\n\tvar i int32\n\tfor i = range "abc" {\n\t\t_ = i\n\t}\n}',
		"Cannot assign int to int32",
	],
	[
		"for i = range s with i int32 and s a slice",
		"package main\nfunc main() {\n\tvar i int32\n\tfor i = range []int{1, 2} {\n\t\t_ = i\n\t}\n}",
		"Cannot assign int to int32",
	],
	[
		"for i = range a with i int32 and a an array pointer",
		"package main\nfunc main() {\n\ta := [2]int{1, 2}\n\tvar i int32\n\tfor i = range &a {\n\t\t_ = i\n\t}\n}",
		"Cannot assign int to int32",
	],
	[
		"for i, _ = range s with i a defined int type",
		'package main\ntype MyInt int\nfunc main() {\n\tvar i MyInt\n\tfor i, _ = range []string{"a"} {\n\t\t_ = i\n\t}\n}',
		"Cannot assign int to MyInt",
	],
]) {
	for (const target of ["js", "both", "wasm"]) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(rangeErrorsOn(target, src), want);
		});
	}
}

test("range 3 into int32, a string range into int and map keys still assign", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	var i int32
	for i = range 3 {
	}
	fmt.Println(i)
	var j int
	for j = range "abc" {
	}
	fmt.Println(j)
	var k string
	for k = range map[string]int{"a": 1} {
	}
	fmt.Println(k)
}
`,
		"2\n2\na\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
