// GoFront test suite — codegen regressions from the 1.3.x review

import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

function run(src) {
	const { js, errors } = compile(src);
	assertEqual(errors.map((e) => e.message).join("\n"), "");
	return { js, out: runJs(js) };
}

section("Operator precedence (JS vs Go)");

test("bitwise & binds tighter than == (Go) — parenthesized in JS", () => {
	const { out } = run(`package main
func main() {
	a := 6
	b := 3
	println(a&b == 2)
}`);
	assertEqual(out, "true");
});

test("shift binds tighter than + (Go) — parenthesized in JS", () => {
	const { out } = run(`package main
func main() {
	a := 6
	println(a<<1 + 1)
}`);
	assertEqual(out, "13");
});

test("| and ^ share precedence in Go (left-assoc)", () => {
	const { out } = run(`package main
func main() {
	a, b, c := 6, 3, 2
	println(a | b ^ c)
}`);
	assertEqual(out, "5");
});

test("&^ inside + keeps grouping", () => {
	const { out } = run(`package main
func main() {
	a, b, c := 6, 3, 2
	println(a + (b &^ c))
	println(a &^ (b | c))
}`);
	assertEqual(out, "7\n4");
});

test("right-nested same-precedence ops keep parentheses", () => {
	const { out } = run(`package main
func main() {
	a, b, c := 10, 4, 3
	println(a - (b - c), a - b - c)
}`);
	assertEqual(out, "9 3");
});

test("double negation does not become a decrement", () => {
	const { js, out } = run(`package main
func main() {
	a := 6
	println(- -a, a)
}`);
	assert(!js.includes("--a"), `unexpected decrement in:\n${js}`);
	assertEqual(out, "6 6");
});

section("Range loops");

test("two assign-form range loops in one block compile and run", () => {
	const { out } = run(`package main
func main() {
	s := []int{1, 2, 3}
	var i, v int
	for i, v = range s {
	}
	for i, v = range s {
	}
	println(i, v)
}`);
	assertEqual(out, "2 3");
});

test("modifying the range index in the body does not affect iteration", () => {
	const { out } = run(`package main
func main() {
	c := 0
	for i := range []int{1, 2, 3} {
		i += 10
		c++
	}
	for i := range 3 {
		i++
		c++
	}
	println(c)
}`);
	assertEqual(out, "6");
});

test("range body may shadow the loop variables", () => {
	const { out } = run(`package main
func main() {
	sum := 0
	for i, v := range []int{7, 8} {
		sum += i
		{
			i := v * 2
			sum += i
		}
	}
	println(sum)
}`);
	assertEqual(out, "31");
});

test("range over sized integer types", () => {
	const { out } = run(`package main
func main() {
	var n int32 = 3
	c := 0
	for range n {
		c++
	}
	for i := range n {
		c += int(i)
	}
	println(c)
}`);
	assertEqual(out, "6");
});

section("Typed arrays and sized numbers");

test("append to a nil []float32 keeps a Float32Array", () => {
	const { out } = run(`package main
func main() {
	var fs []float32
	fs = append(fs, 1, 2, 3)
	println(len(fs[1:]))
}`);
	assertEqual(out, "2");
});

test("[]int32 and []rune conversions from string decode code points", () => {
	const { out } = run(`package main
func main() {
	r := []int32("héllo")
	q := []rune("héllo")
	println(len(r), len(q), string(q))
}`);
	assertEqual(out, "5 5 héllo");
});

test("rune and int32 are the same type", () => {
	const { errors } = compile(`package main
func main() {
	var r []rune = []int32{65}
	var x int32 = 'a'
	var y rune = x
	_ = r
	_ = y
}`);
	assertEqual(errors.length, 0);
});

test("[]float64 stays a plain JS array", () => {
	const { js, out } = run(`package main
func main() {
	xs := []float64{1.5, 2.5}
	ys := make([]float64, 2)
	println(len(xs), len(ys))
}`);
	assert(!js.includes("Float64Array"), `unexpected Float64Array:\n${js}`);
	assertEqual(out, "2 2");
});

test("[]float64 is not assignable to Float64Array", () => {
	const { errors } = compile(`package main
func main() {
	var f Float64Array = []float64{1}
	_ = f
}`);
	assertErrorContains(errors, "Cannot assign");
});

test("sized integer conversions wrap", () => {
	const { out } = run(`package main
func main() {
	x := 300
	y := -1
	z := 200
	w := 40000
	println(uint8(x), uint32(y), int8(z), int16(w), int32(y))
}`);
	assertEqual(out, "44 4294967295 -56 -25536 -1");
});

section("Structs");

test("struct field named value is a normal field", () => {
	const { out } = run(`package main
type Input struct {
	value string
	n     int
}
func main() {
	i := Input{value: "hi", n: 1}
	println(i.value, i.n)
}`);
	assertEqual(out, "hi 1");
});

test("JS reserved words are valid Go identifiers", () => {
	const { out } = run(`package main
type T struct{ in int }
func delete2(in int) int { return in * 2 }
func main() {
	in := 5
	new := T{in: in}
	println(delete2(new.in))
}`);
	assertEqual(out, "10");
});
