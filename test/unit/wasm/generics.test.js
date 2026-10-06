// test/unit/wasm/generics.test.js
// Tests for Phase H4 Task H4.2: Generics monomorphisation in WASM and JS-strict parity.

import {
	assertEqual,
	compileHybrid,
	compileWasm,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Generics — Functions & Instantiation");

test("Identity generic function with int and string", () => {
	const src = `
package main

func Identity[T any](x T) T {
	return x
}

func Main() string {
	a := Identity(42)
	b := Identity("hello")
	if a == 42 && b == "hello" {
		return "ok"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("Pair generic function with multiple type params and multi-value returns", () => {
	const src = `
package main

func Pair[T any, U any](a T, b U) (T, U) {
	return a, b
}

func Main() string {
	x, y := Pair(100, "stars")
	if x == 100 && y == "stars" {
		return "matched"
	}
	return "mismatch"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "matched");
	assertEqual(jsRes, wasmRes);
});

test("Explicit instantiation syntax Identity[int](99)", () => {
	const src = `
package main

func Identity[T any](x T) T {
	return x
}

func Main() int {
	return Identity[int](99)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 99);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Multiple generic calls in sequence with different types", () => {
	const src = `
package main

func Wrap[T any](x T) T {
	return x
}

func Main() string {
	a := Wrap(1)
	b := Wrap("two")
	c := Wrap(true)
	if a == 1 && b == "two" && c {
		return "all_good"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "all_good");
	assertEqual(jsRes, wasmRes);
});

section("WASM Generics — Structs & Methods");

test("Generic struct composite literals and field access", () => {
	const src = `
package main

type Box[T any] struct {
	Value T
}

func Main() string {
	b1 := Box[int]{Value: 42}
	b2 := Box[string]{Value: "world"}
	if b1.Value == 42 && b2.Value == "world" {
		return "boxed"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "boxed");
	assertEqual(jsRes, wasmRes);
});

test("Generic struct with pointer receiver methods (Stack)", () => {
	const src = `
package main

type Stack[T any] struct {
	items []T
}

func (s *Stack[T]) Push(v T) {
	s.items = append(s.items, v)
}

func (s *Stack[T]) Peek() T {
	return s.items[len(s.items)-1]
}

func (s *Stack[T]) Size() int {
	return len(s.items)
}

func Main() int {
	s := Stack[int]{items: []int{}}
	s.Push(10)
	s.Push(20)
	s.Push(30)
	if s.Size() == 3 {
		return s.Peek()
	}
	return -1
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 30);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Generic struct with value receiver method", () => {
	const src = `
package main

type Holder[T any] struct {
	Val T
}

func (h Holder[T]) Get() T {
	return h.Val
}

func Main() string {
	h := Holder[string]{Val: "gold"}
	return h.Get()
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "gold");
	assertEqual(jsRes, wasmRes);
});

test("Nested generic structs Box[Box[int]]", () => {
	const src = `
package main

type Box[T any] struct {
	Value T
}

func Main() int {
	inner := Box[int]{Value: 77}
	outer := Box[Box[int]]{Value: inner}
	return outer.Value.Value
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 77);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Slice of generic structs", () => {
	const src = `
package main

type Pair[T any, U any] struct {
	Key   T
	Value U
}

func Main() string {
	pairs := []Pair[string, int]{
		Pair[string, int]{Key: "a", Value: 1},
		Pair[string, int]{Key: "b", Value: 2},
	}
	if len(pairs) == 2 && pairs[0].Key == "a" && pairs[1].Value == 2 {
		return "pairs_ok"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "pairs_ok");
	assertEqual(jsRes, wasmRes);
});

section("WASM Generics — Higher-Order Functions & Slices");

test("Generic Filter with closure predicate", () => {
	const src = `
package main

func Filter[T any](items []T, pred func(T) bool) []T {
	var out []T
	for _, item := range items {
		if pred(item) {
			out = append(out, item)
		}
	}
	return out
}

func Main() int {
	nums := []int{1, 2, 3, 4, 5, 6}
	evens := Filter(nums, func(n int) bool { return n%2 == 0 })
	sum := 0
	for _, n := range evens {
		sum += n
	}
	return sum
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 12);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Generic Map transforming slice types T -> U", () => {
	const src = `
package main

func Map[T any, U any](items []T, f func(T) U) []U {
	var out []U
	for _, item := range items {
		out = append(out, f(item))
	}
	return out
}

func Main() string {
	nums := []int{1, 2, 3}
	words := Map(nums, func(n int) string {
		if n == 1 {
			return "one"
		}
		if n == 2 {
			return "two"
		}
		return "three"
	})
	res := ""
	for _, w := range words {
		res += w + ","
	}
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "one,two,three,");
	assertEqual(jsRes, wasmRes);
});

test("Generic Reduce accumulator", () => {
	const src = `
package main

func Reduce[T any, U any](items []T, init U, f func(U, T) U) U {
	acc := init
	for _, item := range items {
		acc = f(acc, item)
	}
	return acc
}

func Main() int {
	items := []int{1, 2, 3, 4}
	return Reduce(items, 10, func(acc int, n int) int { return acc + n })
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 20);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Generic function returning slice Repeat[T]", () => {
	const src = `
package main

func Repeat[T any](x T, n int) []T {
	var out []T
	for i := 0; i < n; i++ {
		out = append(out, x)
	}
	return out
}

func Main() int {
	strs := Repeat("go", 5)
	return len(strs)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 5);
	assertEqual(Number(jsRes), Number(wasmRes));
});

test("Generic function passed as closure value to another function", () => {
	const src = `
package main

func Identity[T any](x T) T {
	return x
}

func Apply(f func(int) int, x int) int {
	return f(x)
}

func Main() int {
	return Apply(Identity[int], 99)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 99);
	assertEqual(Number(jsRes), Number(wasmRes));
});

section("WASM Generics — Constraints & Type Assertions");

test("Comparable constraint Equal[T comparable]", () => {
	const src = `
package main

func Equal[T comparable](a T, b T) bool {
	return a == b
}

func Main() string {
	b1 := Equal(1, 1)
	b2 := Equal(1, 2)
	b3 := Equal("hello", "hello")
	b4 := Equal("hello", "world")
	if b1 && !b2 && b3 && !b4 {
		return "comparable_ok"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "comparable_ok");
	assertEqual(jsRes, wasmRes);
});

test("Interface constraint Show[T Stringer]", () => {
	const src = `
package main

type Stringer interface {
	String() string
}

type Name struct {
	first string
}

func (n Name) String() string {
	return n.first
}

func Show[T Stringer](x T) string {
	return x.String()
}

func Main() string {
	return Show(Name{first: "Alice"})
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "Alice");
	assertEqual(jsRes, wasmRes);
});

test("Union constraint Add[T Addable] with ~int | ~string", () => {
	const src = `
package main

type Addable interface {
	~int | ~string
}

func Add[T Addable](a T, b T) T {
	return a + b
}

func Main() string {
	n := Add(10, 20)
	s := Add("foo", "bar")
	if n == 30 && s == "foobar" {
		return "union_ok"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "union_ok");
	assertEqual(jsRes, wasmRes);
});

test("Type assertion on generic struct boxed in any (hybrid parity)", () => {
	const src = `
package main

type Box[T any] struct {
	Value T
}

func Main() string {
	var a any = Box[int]{Value: 42}
	b, ok := a.(Box[int])
	_, notOk := a.(int)
	if ok && !notOk && b.Value == 42 {
		return "assert_ok"
	}
	return "fail"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "assert_ok");
	assertEqual(jsRes, wasmRes);
});

test("WASM strict distinction between Box[int] and Box[string] in assertions and type switches", () => {
	const src = `
package main

type Box[T any] struct {
	Value T
}

func Inspect(x any) string {
	switch v := x.(type) {
	case Box[int]:
		if v.Value == 10 {
			return "box_int"
		}
		return "box_int_other"
	case Box[string]:
		return "box_string:" + v.Value
	default:
		return "unknown"
	}
}

func Main() string {
	var a any = Box[int]{Value: 42}
	_, okInt := a.(Box[int])
	_, okStr := a.(Box[string])
	s1 := Inspect(Box[int]{Value: 10})
	s2 := Inspect(Box[string]{Value: "hi"})
	s3 := Inspect(123)
	if okInt && !okStr && s1 == "box_int" && s2 == "box_string:hi" && s3 == "unknown" {
		return "wasm_monomorph_strict"
	}
	return "fail"
}
`;
	const { wasm, stringTable } = compileWasm(src);
	const { exports } = runWasm(wasm, { stringTable });
	const res = exports.Main();
	assertEqual(res, "wasm_monomorph_strict");
});
