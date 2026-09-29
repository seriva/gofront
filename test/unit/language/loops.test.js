// GoFront test suite — Zero-Allocation for range loops (Phase 2)

import {
	assert,
	assertEqual,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

section("Zero-Allocation for range loops (Phase 2)");

test("for i, v := range slice emits indexed loop without .entries()", () => {
	const { js, errors } = compile(`package main
func main() {
	nums := []int{10, 20, 30}
	for i, v := range nums {
		println(i, v)
	}
}`);
	assertEqual(errors.length, 0);
	assert(!js.includes(".entries()"), "should not emit .entries() on slice");
	assert(js.includes("__len0"), "should emit cached length register __len0");
	assertEqual(runJs(js), "0 10\n1 20\n2 30");
});

test("for range over nil slice executes zero times without crashing", () => {
	const { js, errors } = compile(`package main
func main() {
	var s []int
	count := 0
	for i, v := range s {
		count += i + v
	}
	println("count:", count)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "count: 0");
});

test("for range value reassignment v = clean(v) is allowed (let v)", () => {
	const { js, errors } = compile(`package main
func main() {
	items := []int{1, 2, 3}
	for _, v := range items {
		v = v * 10
		println(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10\n20\n30");
});

test("for range AssignStmt form does not emit duplicate let", () => {
	const { js, errors } = compile(`package main
func main() {
	var i int
	var v int
	items := []int{100, 200}
	for i, v = range items {
		println(i, v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 100\n1 200");
});

test("for range index only ignores elements", () => {
	const { js, errors } = compile(`package main
func main() {
	items := []int{5, 6, 7}
	for i := range items {
		println(i)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0\n1\n2");
});

test("for range blank value for i, _ := range items", () => {
	const { js, errors } = compile(`package main
func main() {
	items := []int{5, 6, 7}
	for i, _ := range items {
		println(i)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0\n1\n2");
});

test("for range value only for _, v := range items", () => {
	const { js, errors } = compile(`package main
func main() {
	items := []int{5, 6, 7}
	for _, v := range items {
		println(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5\n6\n7");
});

test("for range both blank for _, _ = range items", () => {
	const { js, errors } = compile(`package main
func main() {
	items := []int{5, 6, 7}
	c := 0
	for _, _ = range items {
		c++
	}
	println(c)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("for range items without variables executes len times", () => {
	const { js, errors } = compile(`package main
func main() {
	items := []int{5, 6, 7}
	c := 0
	for range items {
		c++
	}
	println(c)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("nested for range loops do not collide on loop registers", () => {
	const { js, errors } = compile(`package main
func main() {
	matrix := [][]int{
		{1, 2},
		{3, 4},
	}
	for rowIdx, row := range matrix {
		for colIdx, val := range row {
			println(rowIdx, colIdx, val)
		}
	}
}`);
	assertEqual(errors.length, 0);
	assert(js.includes("__arr0"), "should use __arr0 for outer loop");
	assert(js.includes("__arr1"), "should use __arr1 for inner loop");
	assertEqual(runJs(js), "0 0 1\n0 1 2\n1 0 3\n1 1 4");
});

test("map range still uses Object.keys / Object.entries", () => {
	const { js, errors } = compile(`package main
func main() {
	m := map[string]int{"a": 1}
	for k, v := range m {
		println(k, v)
	}
}`);
	assertEqual(errors.length, 0);
	assert(js.includes("Object.entries"), "map range should use Object.entries");
	assertEqual(runJs(js), "a 1");
});
