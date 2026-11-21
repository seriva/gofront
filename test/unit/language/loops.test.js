// GoFront test suite — Zero-Allocation for range loops (Phase 2)

import {
	assert,
	assertAllTargetsOutput,
	assertEqual,
	assertProgramOutput,
	assertWasmProgramOutput,
	compile,
	compileHybrid,
	compileWasm,
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

section("Multi-variable three-clause for (Task 0.19a)");

test("for i, j := 0, 10; …; i, j = i+1, j-1 matches Go on both backends", () => {
	const res = compileHybrid(`
package main

func Main() int {
	s := 0
	for i, j := 0, 10; i < j; i, j = i+1, j-1 {
		s = s*10 + (j - i)
	}
	return s
}
`).run("Main");
	assertEqual(res.jsRes, 108642);
	assertEqual(res.wasmRes, 108642n);
});

test("for i, j := 0, 0; …; i, j = j, i+j swaps in the post statement", () => {
	const res = compileHybrid(`
package main

func Main() int {
	n := 0
	for i, j := 0, 1; i < 20; i, j = j, i+j {
		n = n*100 + i
	}
	return n
}
`).run("Main");
	assertEqual(res.jsRes, 1010203050813);
	assertEqual(res.wasmRes, 1010203050813n);
});

section("Shadowed loop variable");

test("i := i inside a three-clause for body", async () => {
	const src = `package main

import "fmt"

func main() {
	guard := 0
	for i := 0; i < 2; i++ {
		guard++
		if guard > 10 {
			panic("loop guard")
		}
		i := i
		fmt.Println(i)
	}
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0\n1");
	await assertProgramOutput(src, "0\n1\n");
});

test("a shadowing := that reads the outer variable in nested blocks", () => {
	const { js, errors } = compile(`package main

import "fmt"

func main() {
	x := 1
	{
		x := x + 1
		fmt.Println(x)
	}
	if x := x * 5; x > 2 {
		fmt.Println(x)
	}
	fmt.Println(x)
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2\n5\n1");
});

test("integer /= in a for post statement truncates", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	w := 345
	for ; w > 100; w /= 10 {
	}
	fmt.Println(w)
}
`,
		"34\n",
	);
});

section("Integer range over a 64-bit or unsigned count");

test("range over a count of 2^32 or more runs to the break", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	n := (1 << 32) + 1
	c := 0
	for i := range n {
		if i == 3 {
			break
		}
		c++
	}
	fmt.Println(c)
	last := -1
	for i := range n {
		last = i
		if i == 5 {
			break
		}
	}
	fmt.Println(last)
	var fs []func() int
	for i := range n {
		fs = append(fs, func() int { return i })
		if i == 2 {
			break
		}
	}
	fmt.Println(len(fs), fs[0](), fs[2]())
}
`,
		"3\n5\n3 0 2\n",
	);
});

test("range over a negative or zero 64-bit count does not run", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	n := -(1 << 32)
	z := 0
	c := 0
	for range n {
		c++
	}
	for range z {
		c++
	}
	for range int64(n) {
		c++
	}
	fmt.Println(c)
}
`,
		"0\n",
	);
});

test("range over a uint32 or uint count at or above 2^31 runs to the break", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	u32 := uint32(1) << 31
	var u uint = 1 << 40
	c := 0
	for i := range u32 {
		if i == 3 {
			break
		}
		c++
	}
	fmt.Println(c)
	c = 0
	for i := range u {
		if i == 3 {
			break
		}
		c++
	}
	fmt.Println(c)
	var fs []func() uint32
	for i := range u32 {
		fs = append(fs, func() uint32 { return i })
		if i == 1 {
			break
		}
	}
	fmt.Println(fs[0](), fs[1]())
}
`,
		"3\n3\n0 1\n",
	);
});

test("range over a uint64 or int64 count runs to the break on wasm", async () => {
	await assertWasmProgramOutput(
		`package main

import "fmt"

func main() {
	u64 := uint64(1) << 63
	var i64 int64 = 1 << 40
	c := 0
	for i := range u64 {
		if i == 3 {
			break
		}
		c++
	}
	fmt.Println(c)
	c = 0
	for i := range i64 {
		if i == 3 {
			break
		}
		c++
	}
	fmt.Println(c)
	var fs []func() uint64
	for i := range u64 {
		fs = append(fs, func() uint64 { return i })
		if i == 1 {
			break
		}
	}
	fmt.Println(fs[0](), fs[1]())
}
`,
		"3\n3\n0 1\n",
	);
});

test("range over a small count still counts exactly", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var u8 uint8 = 4
	var u32 uint32 = 3
	n, sum := 5, 0
	xs := []int{1, 2, 3}
	for i := range n {
		sum += i
	}
	for i := range u8 {
		sum += int(i)
	}
	for i := range u32 {
		sum += int(i)
	}
	for i := range len(xs) {
		sum += i
	}
	for i := range 10 {
		sum += i
	}
	fmt.Println(sum)
}
`,
		"67\n",
	);
});

test("range over len() or a small constant keeps the i32 loop", () => {
	const { wat, errors } = compileWasm(
		`package main

func Main(xs []int) int {
	s := 0
	for i := range len(xs) {
		s += i
	}
	for i := range 10 {
		s += i
	}
	return s
}
`,
		{ emitWat: true },
	);
	assert(errors.length === 0, "compiles");
	assert(wat.includes("i32.ge_s"), "the i32 loop test is missing");
	assert(!wat.includes("i64.ge_s"), "len()/constant range used an i64 loop");
	assert(!wat.includes("i64.ge_u"), "len()/constant range used an i64 loop");
});

test("range over an unproven 64-bit count uses an i64 loop", () => {
	const { wat, errors } = compileWasm(
		`package main

func Main(n int) int {
	s := 0
	for i := range n {
		s += i
	}
	return s
}
`,
		{ emitWat: true },
	);
	assert(errors.length === 0, "compiles");
	assert(wat.includes("i64.ge_s"), "expected an i64 signed loop test");
});
