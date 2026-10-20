// test/unit/wasm/pointers.test.js
// Tests for Task 0.1b: Accessor refs for &s.F and &xs[i] / &arr[i]

import { assertEqual, compileHybrid, section, test } from "../helpers.js";

section("WASM Pointers — Accessor Refs for Fields and Elements");

test("set(&s.X, 7) mutates struct scalar field through pointer parameter", () => {
	const src = `
package main

type S struct {
	X int
	Y int
}

func set(p *int, v int) {
	*p = v
}

func Main() int {
	s := S{X: 1, Y: 2}
	set(&s.X, 7)
	return s.X*10 + s.Y
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 72n);
	assertEqual(res.jsRes, 72);
});

test("*(&xs[1]) = 9 mutates slice element through dereference assignment", () => {
	const src = `
package main

func Main() int {
	xs := []int{10, 20, 30}
	*(&xs[1]) = 9
	return xs[0] + xs[1] + xs[2]
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 49n);
	assertEqual(res.jsRes, 49);
});

test("&s.Inner.X mutates nested struct scalar field through accessor ref", () => {
	const src = `
package main

type Inner struct {
	X int
}

type Outer struct {
	Inner Inner
	Y     int
}

func set(p *int, v int) {
	*p = v
}

func Main() int {
	s := Outer{Inner: Inner{X: 1}, Y: 2}
	set(&s.Inner.X, 7)
	return s.Inner.X*10 + s.Y
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 72n);
	assertEqual(res.jsRes, 72);
});

test("&arr[0].X and *(&arr[1].Y) mutate array element fields", () => {
	const src = `
package main

type Item struct {
	X int
	Y int
}

func set(p *int, v int) {
	*p = v
}

func Main() int {
	arr := [2]Item{{X: 1, Y: 2}, {X: 3, Y: 4}}
	set(&arr[0].X, 7)
	*(&arr[1].Y) = 9
	return arr[0].X*1000 + arr[0].Y*100 + arr[1].X*10 + arr[1].Y
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 7239n);
	assertEqual(res.jsRes, 7239);
});

test("p := &xs[1]; xs = xs[1:]; *p = 9 preserves backing array aliasing after reslicing", () => {
	const src = `
package main

func Main() int32 {
	xs := []int32{10, 20, 30}
	p := &xs[1]
	xs = xs[1:]
	*p = 9
	return xs[0]
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 9);
	assertEqual(res.jsRes, 9);
});

test("reading *p through accessor ref reads struct field", () => {
	const src = `
package main

type S struct {
	X int
}

func get(p *int) int {
	return *p
}

func Main() int {
	s := S{X: 42}
	return get(&s.X)
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 42n);
	assertEqual(res.jsRes, 42);
});

test("reading *p through accessor ref reads slice element", () => {
	const src = `
package main

func get(p *int32) int32 {
	return *p
}

func Main() int32 {
	xs := []int32{10, 20, 30}
	return get(&xs[2])
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 30);
	assertEqual(res.jsRes, 30);
});

test("*(&arr[1]) = 99 on fixed-size array element", () => {
	const src = `
package main

func Main() int {
	arr := [3]int{10, 20, 30}
	*(&arr[1]) = 99
	return arr[1]
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 99n);
	assertEqual(res.jsRes, 99);
});

test("p == q for two separate &s.X evaluates to true", () => {
	const src = `
package main

type S struct {
	X int
	Y int
}

func Main() int {
	s := S{X: 1, Y: 2}
	p := &s.X
	q := &s.X
	if p == q {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("p == q for &s.X and &s.Y evaluates to false", () => {
	const src = `
package main

type S struct {
	X int
	Y int
}

func Main() int {
	s := S{X: 1, Y: 2}
	p := &s.X
	q := &s.Y
	if p == q {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 0n);
	assertEqual(res.jsRes, 0);
});

test("p != q for &s.X and &s.Y evaluates to true", () => {
	const src = `
package main

type S struct {
	X int
	Y int
}

func Main() int {
	s := S{X: 1, Y: 2}
	p := &s.X
	q := &s.Y
	if p != q {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("p == q for &s.X and &x (box) evaluates to false", () => {
	const src = `
package main

type S struct {
	X int
}

func Main() int {
	s := S{X: 1}
	x := 1
	p := &s.X
	q := &x
	if p == q {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 0n);
	assertEqual(res.jsRes, 0);
});

test("p := &xs[1]; xs = append(xs, 4); *p = 9 preserves old backing array", () => {
	const src = `
package main

func Main() int {
	xs := []int{10, 20, 30}
	p := &xs[1]
	xs = append(xs, 4)
	*p = 99
	// xs was reallocated on append; p points to the old backing array.
	// xs[1] should still be 20, not 99.
	return xs[1]
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 20n);
	assertEqual(res.jsRes, 20);
});

test("struct field of type *int holding accessor ref survives struct copy", () => {
	const src = `
package main

type Other struct {
	X int
}

type Holder struct {
	P *int
}

func Main() int {
	other := Other{X: 10}
	s1 := Holder{P: &other.X}
	s2 := s1
	*s2.P = 99
	return other.X
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 99n);
	assertEqual(res.jsRes, 99);
});

test("struct equality when fields are scalar pointers holding accessor refs", () => {
	const src = `
package main

type Target struct {
	X int
	Y int
}

type RefHolder struct {
	P *int
}

func Main() int {
	t := Target{X: 1, Y: 2}
	h1 := RefHolder{P: &t.X}
	h2 := RefHolder{P: &t.X}
	h3 := RefHolder{P: &t.Y}

	eq12 := h1 == h2
	eq13 := h1 == h3

	res := 0
	if eq12 {
		res += 1
	}
	if !eq13 {
		res += 10
	}
	return res
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 11n);
	assertEqual(res.jsRes, 11);
});
