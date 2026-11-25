// GoFront test suite — range-over-iterator functions (Go 1.23)

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

// ── Phase 1 — Basic correctness ─────────────────────────────

section("Range-over-iterator: basic");

test("range over 0-param iterator", () => {
	const { js, errors } = compile(`package main
func main() {
	count := 0
	iter := func(yield func() bool) {
		yield()
		yield()
		yield()
	}
	for range iter {
		count = count + 1
	}
	console.log(count)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("range over 1-param iterator (key only)", () => {
	const { js, errors } = compile(`package main
func main() {
	iter := func(yield func(int) bool) {
		yield(10)
		yield(20)
		yield(30)
	}
	sum := 0
	for k := range iter {
		sum = sum + k
	}
	console.log(sum)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "60");
});

test("range over 2-param iterator (key and value)", () => {
	const { js, errors } = compile(`package main
func main() {
	iter := func(yield func(int, string) bool) {
		yield(0, "a")
		yield(1, "b")
		yield(2, "c")
	}
	for i, v := range iter {
		console.log(i, v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 a\n1 b\n2 c");
});

test("range over factory function returning iterator", () => {
	const { js, errors } = compile(`package main
func Counter(n int) func(yield func(int) bool) {
	return func(yield func(int) bool) {
		for i := 0; i < n; i++ {
			if !yield(i) { return }
		}
	}
}
func main() {
	sum := 0
	for v := range Counter(5) {
		sum = sum + v
	}
	console.log(sum)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
});

test("range over inline function literal", () => {
	const { js, errors } = compile(`package main
func main() {
	sum := 0
	for v := range func(yield func(int) bool) { yield(1); yield(2); yield(3) } {
		sum = sum + v
	}
	console.log(sum)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "6");
});

test("iterator that yields 0 elements — body never runs", () => {
	const { js, errors } = compile(`package main
func main() {
	iter := func(yield func(int) bool) {}
	ran := false
	for _ = range iter {
		ran = true
	}
	console.log(ran)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "false");
});

// ── Phase 2 — Break propagation ─────────────────────────────

section("Range-over-iterator: break");

test("break exits iterator loop", () => {
	const { js, errors } = compile(`package main
func main() {
	iter := func(yield func(int) bool) {
		yield(1)
		yield(2)
		yield(3)
	}
	for v := range iter {
		if v == 2 { break }
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1");
});

test("break stops iterator from invoking yield again", () => {
	const { js, errors } = compile(`package main
func main() {
	count := 0
	iter := func(yield func(int) bool) {
		for i := 0; i < 100; i++ {
			if !yield(i) { return }
		}
	}
	for v := range iter {
		count = count + 1
		if v == 2 { break }
	}
	console.log(count)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("break in nested if inside iterator body", () => {
	const { js, errors } = compile(`package main
func main() {
	iter := func(yield func(int) bool) {
		for i := 0; i < 10; i++ {
			if !yield(i) { return }
		}
	}
	for v := range iter {
		if v > 0 {
			if v == 3 { break }
		}
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0\n1\n2");
});

// ── Phase 3 — Continue propagation ──────────────────────────

section("Range-over-iterator: continue");

test("continue skips rest of body but iterates further", () => {
	const { js, errors } = compile(`package main
func main() {
	iter := func(yield func(int) bool) {
		for i := 0; i < 5; i++ {
			if !yield(i) { return }
		}
	}
	for v := range iter {
		if v == 2 { continue }
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0\n1\n3\n4");
});

// ── Phase 4 — Return propagation ────────────────────────────

section("Range-over-iterator: return");

test("return inside iterator loop returns from outer function", () => {
	const { js, errors } = compile(`package main
func find() string {
	iter := func(yield func(string) bool) {
		yield("a")
		yield("b")
		yield("c")
	}
	for v := range iter {
		if v == "b" { return v }
	}
	return "not found"
}
func main() {
	console.log(find())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "b");
});

test("return with value propagates correctly", () => {
	const { js, errors } = compile(`package main
func sum3() int {
	iter := func(yield func(int) bool) {
		for i := 1; i <= 10; i++ {
			if !yield(i) { return }
		}
	}
	total := 0
	for v := range iter {
		total = total + v
		if total >= 6 { return total }
	}
	return total
}
func main() {
	console.log(sum3())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "6");
});

test("return with multi-value propagates correctly", () => {
	const { js, errors } = compile(`package main
func findPair() (int, string) {
	iter := func(yield func(int, string) bool) {
		yield(1, "one")
		yield(2, "two")
		yield(3, "three")
	}
	for k, v := range iter {
		if k == 2 { return k, v }
	}
	return 0, ""
}
func main() {
	k, v := findPair()
	console.log(k, v)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2 two");
});

// ── Phase 5 — Edge cases ────────────────────────────────────

section("Range-over-iterator: edge cases");

test("blank var _ in range iterator", () => {
	const { js, errors } = compile(`package main
func main() {
	iter := func(yield func(int, string) bool) {
		yield(0, "x")
		yield(1, "y")
	}
	for _, v := range iter {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "x\ny");
});

test("nested iterator loops iterate independently", () => {
	const { js, errors } = compile(`package main
func main() {
	iter := func(yield func(int) bool) {
		yield(1)
		yield(2)
	}
	for a := range iter {
		for b := range iter {
			console.log(a, b)
		}
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 1\n1 2\n2 1\n2 2");
});

test("break in inner loop does not break outer loop", () => {
	const { js, errors } = compile(`package main
func main() {
	outer := func(yield func(int) bool) {
		yield(1)
		yield(2)
	}
	inner := func(yield func(int) bool) {
		for i := 0; i < 5; i++ {
			if !yield(i) { return }
		}
	}
	for a := range outer {
		for b := range inner {
			if b == 1 { break }
		}
		console.log(a)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2");
});

test("assign form (without :=) in range iterator", () => {
	const { js, errors } = compile(`package main
func main() {
	iter := func(yield func(int) bool) {
		yield(10)
		yield(20)
	}
	v := 0
	for v = range iter {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10\n20");
});

// ── Phase 6 — TypeChecker errors ────────────────────────────

section("Range-over-iterator: type errors");

test("error: too many loop variables for 1-param yield", () => {
	const { errors } = compile(`package main
func main() {
	iter := func(yield func(int) bool) { yield(1) }
	for a, b, c := range iter {
		_ = a
		_ = b
		_ = c
	}
}`);
	assertErrorContains(errors, "too many loop variables");
});

test("error: range over plain func is rejected", () => {
	const { errors } = compile(`package main
func main() {
	f := func(x int) int { return x }
	for v := range f {
		_ = v
	}
}`);
	assertErrorContains(errors, "cannot range over func");
});

section("Range over a defined string type");

test("range over a defined string type decodes runes", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
type Word string
func main() {
	for i, r := range Word("ab") {
		fmt.Printf("%v:%c ", i, r)
	}
	fmt.Println()
	for i, r := range Word("é") {
		fmt.Println(i, r)
	}
	type W2 Word
	for i, r := range W2("hé") {
		fmt.Println(i, r)
	}
}`,
		"0:a 1:b \n0 233\n0 104\n1 233\n",
	);
});

section("Range over a function-typed type parameter");

test("range over a type parameter with an iterator core type", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
func run[F ~func(func(int) bool)](fn F) { for x := range fn { fmt.Println(x) } }
func run2[F ~func(func(int) bool)](fn F) { var x int; for x = range fn { fmt.Println(x) } }
func main() {
	run(func(y func(int) bool) { y(7) })
	run2(func(y func(int) bool) { y(8) })
}`,
		"7\n8\n",
	);
});

test("range over a type parameter with a pointer-to-array core type", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
func f[T ~*[3]int](p T) int {
	s := 0
	for i := range p { s += i }
	return s
}
func g[T ~*[3]int](p T) int {
	s := 0
	for i, v := range p { s += i + v }
	return s
}
func h[T ~*[3]int](p T) int {
	s := 0
	for range p { s++ }
	return s
}
func k[T ~*[3]int](p T) int {
	var i, v int
	for i, v = range p { i += v }
	return i
}
func main() {
	a := [3]int{10, 20, 30}
	fmt.Println(f(&a), g(&a), h(&a), k(&a))
}`,
		"3 63 3 32\n",
	);
});

test("a non-iterator func range reports one error", () => {
	const { errors } = compile(`package main
func fn(int) {}
func main() { for x := range fn { _ = x + 1 } }`);
	assertErrorContains(errors, "not an iterator function");
	assertEqual(errors.length, 1);
});

section("Range over a string without variables");

test("a zero-variable string range runs once per rune", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
type Word string
func main() {
	c := 0
	for range Word("😀") {
		c++
	}
	fmt.Println(c)
	c = 0
	for range "😀é" {
		c++
	}
	fmt.Println(c)
	s := "😀"
	c = 0
	for range s {
		c++
	}
	fmt.Println(c)
}`,
		"1\n2\n1\n",
	);
});

test("a blank-variable string range and the index form are unchanged", async () => {
	await assertAllTargetsOutput(
		`package main
import "fmt"
func main() {
	c := 0
	for _ = range "😀é" {
		c++
	}
	fmt.Println(c)
	for i := range "😀é" {
		fmt.Println(i)
	}
}`,
		"2\n0\n2\n",
	);
});

section("Range over 64-bit integers (J5.2)");

test("range over int64, uint64, defined int64 and generic ~int64 counts", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type MyInt64 int64

func findThree[T ~int64](limit T) T {
	var hit T = -1
	for i := range limit {
		if i == 3 {
			hit = i
		}
	}
	return hit
}

func main() {
	var a int64 = -1
	for i := range int64(5) {
		if i == 3 {
			a = i
		}
	}

	var b uint64 = 99
	for i := range uint64(5) {
		if i == 3 {
			b = i
		}
	}

	var n int64 = 4
	var c int64 = -1
	for i := range n {
		if i == 2 {
			c = i
		}
	}

	d := findThree(int64(5))

	var m MyInt64 = 4
	var e MyInt64 = -1
	for i := range m {
		if i == 2 {
			e = i
		}
	}

	// Capture, assign to existing var, and zero-var forms
	var fs []func() int64
	for i := range int64(3) {
		fs = append(fs, func() int64 { return i })
	}
	var assigned int64
	for assigned = range int64(4) {
	}
	zeroVar := 0
	for range int64(3) {
		zeroVar++
	}

	fmt.Println(a, b, c, d, e)
	fmt.Println(fs[0](), fs[1](), fs[2](), assigned, zeroVar)
}
`,
		"3 3 2 3 2\n0 1 2 3 3\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
