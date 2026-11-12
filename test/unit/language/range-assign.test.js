// GoFront test suite — range assignment into address-taken variables

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertErrorContains,
	assertJsProgramOutput,
	assertProgramOutput,
	assertValidWasm,
	assertWasmProgramOutput,
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

section("Range assignment: targets of interface type");

test("an index or value assigned into a declared any is boxed", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var a any
	for a = range []int{5, 6} {
	}
	fmt.Println(a)
	for _, a = range []int{5, 6} {
	}
	fmt.Println(a)
	for a = range 3 {
	}
	fmt.Println(a)
	for _, a = range [2]string{"x", "y"} {
	}
	fmt.Println(a)
}
`,
		"1\n6\n2\ny\n",
	);
});

test("string and map ranges assign into any targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var a, b any
	for a, b = range "hi" {
	}
	fmt.Println(a, b)
	for a, b = range map[string]int{"k": 3} {
	}
	fmt.Println(a, b)
	var s any
	for s = range map[string]int{"k": 3} {
	}
	_, isStr := s.(string)
	fmt.Println(s, isStr)
}
`,
		"1 105\nk 3\nk true\n",
	);
});

test("range assigns into fmt.Stringer and error targets", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"errors"
	"fmt"
)

type N int

func (n N) String() string { return fmt.Sprintf("N%d", int(n)) }

func main() {
	var s fmt.Stringer
	for _, s = range []fmt.Stringer{N(1), N(2)} {
	}
	fmt.Println(s)
	var e error
	for _, e = range []error{errors.New("a"), errors.New("b")} {
	}
	fmt.Println(e)
}
`,
		"N2\nb\n",
	);
});

test("a range over a slice of a defined type assigns into fmt.Stringer on WebAssembly", async () => {
	await assertWasmProgramOutput(
		`package main

import "fmt"

type N int

func (n N) String() string { return fmt.Sprintf("N%d", int(n)) }

func main() {
	var s fmt.Stringer
	for _, s = range []N{3, 4} {
	}
	fmt.Println(s)
}
`,
		"N4\n",
	);
});

test("a captured any target and a ranged any keep boxing", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var a any
	f := func() { fmt.Println(a) }
	for _, a = range []int{7, 8} {
	}
	f()
	p := &a
	for a = range 4 {
	}
	fmt.Println(*p)
}
`,
		"8\n3\n",
	);
});

section("Range assignment: into interface-typed variables");

const RANGE_BOX_PRELUDE = `package main

import "fmt"

type N int

func (n N) String() string { return fmt.Sprintf("N%d", int(n)) }

type S string

func (s S) String() string { return "S" + string(s) }

type P struct{ X int }

func (p P) String() string { return fmt.Sprintf("P%d", p.X) }
`;

for (const [name, body, want] of [
	[
		"slice element",
		"for _, s = range []N{3, 4} {\n\t}\n\tfmt.Println(s)",
		"N4\n",
	],
	[
		"map value",
		'for _, s = range map[string]N{"a": 3} {\n\t}\n\tfmt.Println(s)',
		"N3\n",
	],
	[
		"map key",
		"for s = range map[N]bool{5: true} {\n\t}\n\tfmt.Println(s)",
		"N5\n",
	],
	[
		"defined string element",
		'for _, s = range []S{"a", "b"} {\n\t}\n\tfmt.Println(s)',
		"Sb\n",
	],
	[
		"struct element",
		"for _, s = range []P{{1}, {2}} {\n\t}\n\tfmt.Println(s)",
		"P2\n",
	],
	[
		"pointer element",
		"for _, s = range []*P{{1}, {2}} {\n\t}\n\tfmt.Println(s)",
		"P2\n",
	],
	[
		"define form stored afterwards",
		"for _, v := range []N{3, 4} {\n\t\ts = v\n\t}\n\tfmt.Println(s)",
		"N4\n",
	],
]) {
	test(`range assignment of a ${name} into a fmt.Stringer`, async () => {
		await assertAllTargetsOutput(
			`${RANGE_BOX_PRELUDE}
func main() {
	var s fmt.Stringer
	${body}
}
`,
			want,
		);
	});
}

test("range assignment into an any keeps the defined type", async () => {
	await assertAllTargetsOutput(
		`${RANGE_BOX_PRELUDE}
func main() {
	var a any
	for _, a = range []N{3, 4} {
	}
	_, ok := a.(N)
	fmt.Println(ok, a)
	for a = range map[S]bool{"k": true} {
	}
	_, ok = a.(S)
	fmt.Println(ok)
}
`,
		"true N4\ntrue\n",
	);
});

test("range assignment into an element of an interface slice boxes the value", async () => {
	await assertAllTargetsOutput(
		`${RANGE_BOX_PRELUDE}
func main() {
	out := make([]fmt.Stringer, 1)
	for _, out[0] = range []N{3, 4} {
	}
	fmt.Println(out[0])
}
`,
		"N4\n",
	);
});

section("Range assignment: non-identifier targets");

for (const [name, decls, body, want] of [
	[
		"map entry",
		"m := map[string]N{}",
		'for _, m["a"] = range []N{3, 4} {\n\t}\n\tfmt.Println(m["a"])',
		"N4\n",
	],
	[
		"struct field",
		"var s struct{ v int }",
		"for _, s.v = range []int{3, 4} {\n\t}\n\tfmt.Println(s.v)",
		"4\n",
	],
	[
		"pointer deref",
		"x := 0\n\tp := &x",
		"for _, *p = range []int{3, 4} {\n\t}\n\tfmt.Println(x)",
		"4\n",
	],
	[
		"any slice element from ints",
		"out := make([]any, 1)",
		"for _, out[0] = range []int{3, 4} {\n\t}\n\tfmt.Println(out[0])",
		"4\n",
	],
	[
		"int slice element",
		"out := make([]int, 1)",
		"for _, out[0] = range []int{3, 4} {\n\t}\n\tfmt.Println(out[0])",
		"4\n",
	],
	[
		"key into a slice element",
		"out := make([]int, 1)",
		"for out[0] = range []int{3, 4} {\n\t}\n\tfmt.Println(out[0])",
		"1\n",
	],
	[
		"key and value into elements",
		"ks := make([]int, 1)\n\tvs := make([]string, 1)",
		'for ks[0], vs[0] = range []string{"a", "b"} {\n\t}\n\tfmt.Println(ks[0], vs[0])',
		"1 b\n",
	],
	[
		"stringer slice element from a map",
		"out := make([]fmt.Stringer, 1)",
		'for _, out[0] = range map[string]N{"a": 3} {\n\t}\n\tfmt.Println(out[0])',
		"N3\n",
	],
]) {
	test(`range assignment into a ${name}`, async () => {
		await assertAllTargetsOutput(
			`${RANGE_BOX_PRELUDE}
func main() {
	${decls}
	${body}
}
`,
			want,
		);
	});
}

test("range assignment into an element builds a valid WASM module", () => {
	const { wasm, errors } = compileWasm(`package main

func main() {
	out := make([]int, 1)
	for _, out[0] = range []int{3, 4} {
	}
	_ = out
}
`);
	if (errors.length > 0) throw new Error(errors[0].message);
	assertValidWasm(wasm);
});

section("Range assignment: range-over-func into interface variables");

const ITER_PRELUDE = `${RANGE_BOX_PRELUDE}
func seq(yield func(N) bool) {
	yield(N(10))
}

func seq2(yield func(int, N) bool) {
	yield(1, N(10))
}
`;

test("range-over-func assignment into a Stringer boxes the value", async () => {
	await assertAllTargetsOutput(
		`${ITER_PRELUDE}
func main() {
	var s fmt.Stringer
	for s = range seq {
	}
	fmt.Println(s)
}
`,
		"N10\n",
	);
});

test("two-value range-over-func assignment boxes the second value", async () => {
	await assertAllTargetsOutput(
		`${ITER_PRELUDE}
func main() {
	var k int
	var s fmt.Stringer
	for k, s = range seq2 {
	}
	fmt.Println(k, s)
}
`,
		"1 N10\n",
	);
});

test("range-over-func assignment into an any keeps the defined type", async () => {
	await assertAllTargetsOutput(
		`${ITER_PRELUDE}
func main() {
	var a any
	for a = range seq {
	}
	_, ok := a.(N)
	fmt.Println(ok)
	var k any
	var v any
	for k, v = range seq2 {
	}
	_, okv := v.(N)
	fmt.Println(k, okv)
}
`,
		"true\n1 true\n",
	);
});

test("range-over-func define form is unchanged", async () => {
	await assertAllTargetsOutput(
		`${ITER_PRELUDE}
func main() {
	for s := range seq {
		var x fmt.Stringer = s
		fmt.Println(x)
	}
}
`,
		"N10\n",
	);
});

section("Range assignment: range-over-func into non-identifier targets");

for (const [name, decls, body, want] of [
	[
		"a slice element of an interface",
		"out := make([]fmt.Stringer, 1)",
		"for out[0] = range seq {\n\t}\n\tfmt.Println(out[0].String())",
		"N10\n",
	],
	[
		"a struct field of an interface",
		"var s struct{ v fmt.Stringer }",
		"for s.v = range seq {\n\t}\n\tfmt.Println(s.v)",
		"N10\n",
	],
	[
		"a map entry of an interface",
		"m := map[string]fmt.Stringer{}",
		'for m["a"] = range seq {\n\t}\n\tfmt.Println(m["a"])',
		"N10\n",
	],
	[
		"a pointer deref of an interface",
		"var v fmt.Stringer\n\tp := &v",
		"for *p = range seq {\n\t}\n\tfmt.Println(v, *p == v)",
		"N10 true\n",
	],
	[
		"an any slice element keeping the defined type",
		"a := make([]any, 1)",
		"for a[0] = range seq {\n\t}\n\t_, ok := a[0].(N)\n\tfmt.Println(ok)",
		"true\n",
	],
	[
		"an index and an interface element (two values)",
		"ks := make([]int, 1)\n\tout := make([]fmt.Stringer, 1)",
		"for ks[0], out[0] = range seq2 {\n\t}\n\tfmt.Println(ks[0], out[0])",
		"1 N10\n",
	],
	[
		"an interface element from a struct yield value",
		"out := make([]fmt.Stringer, 1)",
		"for out[0] = range seqP {\n\t}\n\tfmt.Println(out[0])",
		"P7\n",
	],
	[
		"a non-interface slice element",
		"ks := make([]int, 1)",
		"for ks[0] = range seqInt {\n\t}\n\tfmt.Println(ks[0])",
		"5\n",
	],
]) {
	test(`range-over-func assignment into ${name}`, async () => {
		await assertAllTargetsOutput(
			`${ITER_PRELUDE}
func seqP(yield func(P) bool) {
	yield(P{7})
}

func seqInt(yield func(int) bool) {
	yield(5)
}

func main() {
	${decls}
	${body}
}
`,
			want,
		);
	});
}

section("Range assignment: a deref target counts as a use");

test("range-over-func assignment through a pointer used nowhere else compiles", async () => {
	await assertAllTargetsOutput(
		`${ITER_PRELUDE}
func main() {
	var v fmt.Stringer
	p := &v
	for *p = range seq {
	}
	fmt.Println(v)
}
`,
		"N10\n",
	);
});

test("range-over-func assignment through an int pointer used nowhere else compiles", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	yield(5)
}

func main() {
	var v int
	p := &v
	for *p = range seq {
	}
	fmt.Println(v)
}
`,
		"5\n",
	);
});

for (const target of ["js", "both", "wasm"]) {
	test(`an unused pointer without a range loop still reports declared and not used (${target})`, () => {
		const src = `package main

func main() {
	var v int
	p := &v
}
`;
		const errors =
			target === "wasm"
				? compileWasm(src).errors
				: compile(src, { target }).errors;
		assertErrorContains(errors, "'p' declared and not used");
	});

	test(`an unused pointer next to a range-over-func loop on another target still reports it (${target})`, () => {
		const src = `package main

func seq(yield func(int) bool) {
	yield(5)
}

func main() {
	var v, w int
	p := &v
	q := &w
	for *p = range seq {
	}
}
`;
		const errors =
			target === "wasm"
				? compileWasm(src).errors
				: compile(src, { target }).errors;
		assertErrorContains(errors, "'q' declared and not used");
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
