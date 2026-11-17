// GoFront test suite — numeric operands need identical types
//
// Arithmetic and comparison operands, `%` and the bit operators, and the
// implicit int -> float64 conversion. Each rule is checked on every target
// (`js`, `both`, `wasm`). The per-case corpus lives in
// test/unit/fixtures/conformance; this file covers the generic-code,
// defined-type and untyped-constant edges.

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	compile,
	section,
	summarize,
	test,
} from "../helpers.js";

const TARGETS = ["js", "both", "wasm"];

function rejectsEverywhere(source, message) {
	for (const target of TARGETS) {
		const { errors } = compile(source, { target });
		try {
			assertErrorContains(errors, message);
		} catch (e) {
			e.message = `${target}: ${e.message}`;
			throw e;
		}
	}
}

function acceptsEverywhere(source) {
	for (const target of TARGETS) {
		const { errors } = compile(source, { target });
		assertEqual(errors.length, 0, `${target}: ${errors?.[0]}`);
	}
}

section("Arithmetic operands (identical types)");

test("mixed int and float64 operands are a mismatch with a position", () => {
	const { errors } = compile(`package main
func main() {
	a := 1
	f := 2.5
	_ = a + f
}`);
	assertErrorContains(
		errors,
		"invalid operation: a + f (mismatched types int and float64)",
	);
	assertErrorContains(errors, "at line 5:");
});

test("compound assignment of a different integer type is rejected", () => {
	rejectsEverywhere(
		`package main
func main() {
	var a int32 = 1
	var b int64 = 2
	a += b
	_ = a
}`,
		"int64",
	);
});

test("defined type result keeps its type through an untyped constant", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
type Celsius float64
func main() {
	var a Celsius = 1.5
	g := a * 1.5
	h := g + a
	var k Celsius = h
	fmt.Println(h, k)
}
`,
		"3.75 3.75\n",
	);
});

test("an integer variable times an integral float constant stays an integer", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
func main() {
	x := 3
	y := x * 2.0
	var z int = y
	fmt.Println(z)
}
`,
		"6\n",
	);
});

test("Celsius + float64 (typed) is a mismatch, Celsius + 1.5 is valid", () => {
	rejectsEverywhere(
		`package main
type Celsius float64
func main() {
	var c Celsius = 1
	f := 2.5
	_ = c + f
}`,
		"mismatched types Celsius and float64",
	);
	acceptsEverywhere(`package main
type Celsius float64
func main() {
	var c Celsius = 1
	_ = c + 1.5
	_ = 1.5 + c
}`);
});

test("int64 << uint8 and float32 arithmetic stay valid", () => {
	acceptsEverywhere(`package main
func main() {
	var a int64 = 1
	var n uint8 = 3
	var f, g float32 = 1, 2
	_ = a << n
	_ = f * g
}`);
});

test("generic arithmetic over a type parameter is unchanged", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
type Number interface{ ~int | ~float64 }
type Celsius float64
func Sum[T Number](xs []T) T {
	var s T
	for _, x := range xs {
		s = s + x
	}
	return s * 2
}
func Scale[T Number](x T, k T) T { return x*k + T(1) }
func main() {
	fmt.Println(Sum([]int{1, 2, 3}), Sum([]float64{0.5, 1}), Sum([]Celsius{1, 2}))
	fmt.Println(Scale(2, 3), Scale(1.5, 2))
}
`,
		"12 3 6\n7 4\n",
	);
});

test("a generic call result mixed with another numeric type is a mismatch", () => {
	rejectsEverywhere(
		`package main
type Number interface{ ~int | ~float64 }
func Id[T Number](x T) T { return x }
func main() {
	i := 1
	_ = Id(2.5) + i
}`,
		"mismatched types float64 and int",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
