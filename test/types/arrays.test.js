import { fileURLToPath } from "node:url";
import {
	assertContains,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
