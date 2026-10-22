import { fileURLToPath } from "node:url";
import {
	assertContains,
	assertEqual,
	assertErrorContains,
	compile,
	compileHybrid,
	compileHybridProject,
	compileWasm,
	runJs,
	runWasm,
	section,
	summarize,
	test,
} from "../helpers.js";

// ── Phase 1: [...]T size inference ──────────────────────────

section("[...]T size inference");

test("[...]int infers size from element count", () => {
	const { js, errors } = compile(`
package main
func main() {
	arr := [...]int{10, 20, 30}
	println(len(arr))
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("[...]string composite literal compiles and runs", () => {
	const { js, errors } = compile(`
package main
func main() {
	arr := [...]string{"a", "b", "c"}
	println(arr[0], arr[1], arr[2])
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a b c");
});

test("typeStr for inferred array prints size, not null", () => {
	// If size inference works, assigning [...]int to []int should mention [3]int, not [null]int
	const { errors } = compile(`
package main
func main() {
	arr := [...]int{1, 2, 3}
	var s []int
	s = arr
	_ = s
}
`);
	assertErrorContains(errors, "[3]int");
});

// ── Phase 2: Reject append on arrays ────────────────────────

section("Reject append on arrays");

test("error: append on [3]int", () => {
	const { errors } = compile(`
package main
func main() {
	arr := [3]int{1, 2, 3}
	arr = append(arr, 4)
	_ = arr
}
`);
	assertErrorContains(errors, "cannot append to array");
});

test("error: append on named array type", () => {
	const { errors } = compile(`
package main
type Trio [3]int
func main() {
	var t Trio
	t = append(t, 4)
	_ = t
}
`);
	assertErrorContains(errors, "cannot append to array");
});

test("append on []int still works", () => {
	const { js, errors } = compile(`
package main
func main() {
	s := []int{1, 2}
	s = append(s, 3)
	println(s[2])
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

// ── Phase 3: Compile-time bounds checking ───────────────────

section("Compile-time bounds checking");

test("error: constant index out of bounds", () => {
	const { errors } = compile(`
package main
func main() {
	arr := [3]int{10, 20, 30}
	x := arr[5]
	_ = x
}
`);
	assertErrorContains(errors, "invalid array index 5");
	assertErrorContains(errors, "out of bounds");
});

test("error: negative constant index", () => {
	const { errors } = compile(`
package main
func main() {
	arr := [3]int{10, 20, 30}
	x := arr[-1]
	_ = x
}
`);
	assertErrorContains(errors, "invalid array index -1");
	assertErrorContains(errors, "must not be negative");
});

test("no error: constant index within bounds", () => {
	const { js, errors } = compile(`
package main
func main() {
	arr := [3]int{10, 20, 30}
	x := arr[2]
	println(x)
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "30");
});

test("no error: variable index (not checked at compile time)", () => {
	const { js, errors } = compile(`
package main
func main() {
	arr := [3]int{10, 20, 30}
	i := 1
	x := arr[i]
	println(x)
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "20");
});

// ── Phase 4: Composite literal element count validation ─────

section("Composite literal element count validation");

test("error: too many elements in [3]int{1,2,3,4}", () => {
	const { errors } = compile(`
package main
func main() {
	arr := [3]int{1, 2, 3, 4}
	_ = arr
}
`);
	assertErrorContains(errors, "array index");
	assertErrorContains(errors, "out of bounds");
});

test("error: keyed element index out of bounds [3]int{5: 1}", () => {
	const { errors } = compile(`
package main
func main() {
	arr := [3]int{5: 1}
	_ = arr
}
`);
	assertErrorContains(errors, "array index");
	assertErrorContains(errors, "out of bounds");
});

function keyErrors(body, prelude = "") {
	return compile(`
package main
${prelude}
func main() {
${body}
}
`).errors;
}

test("error: non-constant keyed array index", () => {
	const errors = keyErrors(`	k := 1
	a := [3]int{k: 2}
	_ = a`);
	assertErrorContains(errors, "index k must be integer constant");
});

test("error: negative keyed array index", () => {
	const errors = keyErrors(`	a := [3]int{-1: 2}
	_ = a`);
	assertErrorContains(errors, "must be non-negative integer constant");
});

test("error: duplicate keyed array index", () => {
	const errors = keyErrors(`	a := [3]int{0: 1, 0: 2}
	_ = a`);
	assertErrorContains(errors, "duplicate index 0 in array or slice literal");
});

test("error: keyed index duplicating a positional element", () => {
	const errors = keyErrors(`	a := [3]int{1, 0: 2}
	_ = a`);
	assertErrorContains(errors, "duplicate index 0 in array or slice literal");
});

test("error: constant keyed index out of bounds", () => {
	const errors = keyErrors(
		`	a := [3]int{K: 2}
	_ = a`,
		"const K = 3",
	);
	assertErrorContains(errors, "array index 3 out of bounds");
});

test("no error: keyed array indices from constants and iota", () => {
	const errors = keyErrors(
		`	a := [3]string{B: "b", A: "a", C - 1 + 1: "c"}
	b := [4]int{int(A) + 1: 1, K * 2: 2}
	_, _ = a, b`,
		"const (\n\tA = iota\n\tB\n\tC\n)\n\nconst K = 1",
	);
	assertEqual(errors.length, 0);
});

test("no error: exact element count matches", () => {
	const { js, errors } = compile(`
package main
func main() {
	arr := [3]int{10, 20, 30}
	println(arr[0], arr[1], arr[2])
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10 20 30");
});

test("no error: sparse init within bounds [5]int{2: 10, 4: 20}", () => {
	const { errors } = compile(`
package main
func main() {
	arr := [5]int{2: 10, 4: 20}
	_ = arr
}
`);
	assertEqual(errors.length, 0);
});

// ── Phase 5: Assignment compatibility ───────────────────────

section("Array assignment compatibility");

test("error: assign [4]int to [3]int", () => {
	const { errors } = compile(`
package main
func main() {
	var a [3]int
	var b [4]int
	a = b
	_ = a
}
`);
	assertErrorContains(errors, "different array lengths");
});

test("error: assign []int to [3]int", () => {
	const { errors } = compile(`
package main
func main() {
	var a [3]int
	s := []int{1, 2, 3}
	a = s
	_ = a
}
`);
	assertErrorContains(errors, "Cannot assign []int to [3]int");
});

test("error: assign [3]int to []int", () => {
	const { errors } = compile(`
package main
func main() {
	var s []int
	a := [3]int{1, 2, 3}
	s = a
	_ = s
}
`);
	assertErrorContains(errors, "Cannot assign [3]int to []int");
});

test("no error: assign [3]int to [3]int", () => {
	const { js, errors } = compile(`
package main
func main() {
	a := [3]int{1, 2, 3}
	var b [3]int
	b = a
	println(b[0], b[1], b[2])
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 2 3");
});

// ── Phase 6: Compile-time len() ─────────────────────────────

section("Compile-time len()");

test("len([3]int{...}) compiles to constant 3", () => {
	const { js, errors } = compile(`
package main
func main() {
	arr := [3]int{10, 20, 30}
	println(len(arr))
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
	// Should emit the constant 3, not __len(arr)
	assertContains(js, "3");
});

test("len([]int{...}) still uses __len helper", () => {
	const { js, errors } = compile(`
package main
func main() {
	s := []int{10, 20, 30}
	println(len(s))
}
`);
	assertEqual(errors.length, 0);
	assertContains(js, "__len");
});

// ── Phase 8: Slicing arrays produces slices ─────────────────

section("Slicing arrays produces slices");

test("arr[1:3] on [5]int produces []int (can append)", () => {
	const { js, errors } = compile(`
package main
func main() {
	arr := [5]int{10, 20, 30, 40, 50}
	s := arr[1:3]
	s = append(s, 99)
	println(len(s))
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

// ── End-to-end tests ────────────────────────────────────────

section("Array end-to-end");

test("range over array works correctly", () => {
	const { js, errors } = compile(`
package main
func main() {
	arr := [3]string{"a", "b", "c"}
	for i, v := range arr {
		println(i, v)
	}
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 a\n1 b\n2 c");
});

test("nested arrays [2][3]int", () => {
	const { js, errors } = compile(`
package main
func main() {
	arr := [2][3]int{{1, 2, 3}, {4, 5, 6}}
	println(arr[0][0], arr[1][2])
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 6");
});

// ── Slice → Array conversion ([N]T(slice)) ─────────────────

section("Slice to array conversion");

test("[3]int(slice) converts slice to array type", () => {
	const { js, errors } = compile(`
package main
func main() {
	s := []int{1, 2, 3, 4, 5}
	a := [3]int(s)
	println(a[0], a[1], a[2])
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 2 3");
});

test("[3]int(slice) codegen emits .slice(0, 3)", () => {
	const { js, errors } = compile(`
package main
func main() {
	s := []int{10, 20, 30, 40}
	a := [2]int(s)
	println(a[0], a[1])
}
`);
	assertEqual(errors.length, 0);
	assertContains(js, ".slice(0, 2)");
	assertEqual(runJs(js), "10 20");
});

test("error: [3]int(stringVal) rejected", () => {
	const { errors } = compile(`
package main
func main() {
	s := "hello"
	a := [3]int(s)
	_ = a
}
`);
	assertErrorContains(errors, "cannot convert");
});

test("error: [3]int([]string{...}) element type mismatch", () => {
	const { errors } = compile(`
package main
func main() {
	s := []string{"a", "b", "c"}
	a := [3]int(s)
	_ = a
}
`);
	assertErrorContains(errors, "cannot convert");
});

test("array to slice conversion works", () => {
	const { js, errors } = compile(`
package main
func main() {
	a := [3]int{1, 2, 3}
	s := []int(a)
	println(s[0], s[1], s[2])
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 2 3");
});

section("Constant folder only folds real constants");

function hybridMain(body, prelude = "") {
	return compileHybrid(`package main
${prelude}
${body}
`).run("Main");
}

test("param shadowing a package const is not folded as the const", () => {
	const res = hybridMain(
		`func get(a [4]int, size int) int { return a[size-1] }

func Main() int { return get([4]int{1, 2, 3, 4}, 2) }`,
		"const size = 8",
	);
	assertEqual(res.jsRes, 2);
});

test("local shadowing a package const is not folded as the const", () => {
	const res = hybridMain(
		`func Main() int {
	a := [4]int{5, 6, 7, 8}
	n := 1
	return a[n-1] + a[n]
}`,
		"const n = 10",
	);
	assertEqual(res.jsRes, 11);
});

test("loop var shadowing a package const is not folded as the const", () => {
	const res = hybridMain(
		`func Main() int {
	a := [4]int{1, 2, 3, 4}
	s := 0
	for i := 0; i < 2; i++ {
		s += a[i+1]
	}
	return s
}`,
		"const i = 7",
	);
	assertEqual(res.jsRes, 5);
});

test("bare shadowing index is not folded as the const", () => {
	const res = hybridMain(
		`func Main() int {
	a := [4]int{1, 2, 3, 4}
	K := 3
	return a[K]
}`,
		"const K = 9",
	);
	assertEqual(res.jsRes, 4);
});

test("^uint8(0) index is not folded as -1", () => {
	const src = `package main

func Main() int {
	var a [256]int
	a[^uint8(0)] = 3
	return a[255]
}
`;
	assertEqual(compile(src).errors.length, 0);
	// JS backend: ^uint8(0) evaluates to -1 at runtime (pre-existing, also on
	// base), so only the WASM result is checked here.
	const { wasm, stringTable, errors } = compileWasm(src);
	assertEqual(errors.length, 0);
	assertEqual(runWasm(wasm, { stringTable }).exports.Main(), 3n);
});

test("typed uint8 const index from ^uint8(0) compiles", () => {
	const { errors } = compile(`package main

const M uint8 = ^uint8(0)

func main() {
	var a [256]int
	a[M] = 1
	_ = a
}
`);
	assertEqual(errors.length, 0);
});

test("^uint8(0) array literal key places the value at 255", () => {
	const res = hybridMain(`func Main() int {
	a := [256]int{^uint8(0): 3}
	return a[255]*10 + a[0]
}`);
	assertEqual(res.jsRes, 30);
});

test("wide bitwise constant index is not folded with 32-bit ops", () => {
	const { errors } = compile(`package main

const Big = 1 << 40

func main() {
	var a [4]int
	_ = a[(Big|1)-Big]
}
`);
	assertEqual(errors.length, 0);
});

test("cross-package constant array key places the value", async () => {
	const { mod } = await compileHybridProject(
		{
			"consts/c.go": `//gofront:target both
package consts

const K = 2
`,
			"main.go": `package main

import "./consts"

func Main() int {
	a := [3]int{consts.K: 5}
	return a[2]*10 + a[0]
}
`,
		},
		{ exports: ["Main"] },
	);
	assertEqual(mod.Main(), 50);
});

test("integral float literal array key places the value", () => {
	const res = hybridMain(`func Main() int {
	a := [3]int{2.0: 5}
	return a[2]*10 + a[0]
}`);
	assertEqual(res.jsRes, 50);
});

test("integral untyped float const array key places the value", () => {
	const res = hybridMain(
		`func Main() int {
	a := [3]int{K: 5}
	return a[2]*10 + a[0]
}`,
		"const K = 2.0",
	);
	assertEqual(res.jsRes, 50);
});

test("constant builtin call array key compiles", () => {
	const { errors } = compile(`package main

const K = len("abc")

func main() {
	a := [4]int{K: 5}
	b := [4]int{len("ab"): 1}
	_, _ = a, b
}
`);
	assertEqual(errors.length, 0);
});

test("error: variable array key is still rejected", () => {
	const { errors } = compile(`package main

func main() {
	k := 1
	a := [3]int{k: 2}
	_ = a
}
`);
	assertErrorContains(errors, "index k must be integer constant");
});

test("error: non-builtin call array key is rejected", () => {
	const { errors } = compile(`package main

func f() int { return 1 }

func main() {
	a := [3]int{f(): 2}
	_ = a
}
`);
	assertErrorContains(errors, "must be integer constant");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}

test("error: duplicate keyed slice index (Task 0.19b)", () => {
	const errors = keyErrors(`	s := []int{1, 0: 2}
	_ = s`);
	assertErrorContains(errors, "duplicate index 0 in array or slice literal");
});

test("error: non-constant keyed slice index (Task 0.19b)", () => {
	const errors = keyErrors(`	k := 1
	s := []int{k: 2}
	_ = s`);
	assertErrorContains(errors, "index k must be integer constant");
});
