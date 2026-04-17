// GoFront test suite — range-over-iterator functions (Go 1.23)

import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
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
	assert(errors.length > 0, "expected an error for ranging over a plain func");
});
