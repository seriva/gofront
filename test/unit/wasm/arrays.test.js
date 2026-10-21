// test/unit/wasm/arrays.test.js
// Tests for Task 0.8a: fixed-size arrays are values in WASM (copy on every
// assignment, call, return, store and load), matching the JS backend.

import {
	assert,
	assertEqual,
	compileHybrid,
	section,
	test,
} from "../helpers.js";

section("WASM Arrays — value semantics");

function parity(name, body, expected, prelude = "") {
	test(name, () => {
		const src = `
package main
${prelude}
func Main() int {
${body}
}
`;
		const res = compileHybrid(src).run("Main");
		assertEqual(res.jsRes, expected);
		assertEqual(res.wasmRes, BigInt(expected));
	});
}

parity(
	"b := a; b[0] = 9 leaves a unchanged",
	`	a := [3]int{1, 2, 3}
	b := a
	b[0] = 9
	return a[0]*10 + b[0]`,
	19,
);

parity(
	"b = a assignment copies",
	`	a := [3]int{1, 2, 3}
	var b [3]int
	b = a
	b[1] = 9
	return a[1]*10 + b[1]`,
	29,
);

parity(
	"callee mutating its array parameter leaves caller unchanged",
	`	a := [3]int{1, 2, 3}
	mut(a)
	return a[0]`,
	1,
	`func mut(a [3]int) { a[0] = 9 }`,
);

parity(
	"returned global array is a copy",
	`	b := get()
	b[0] = 9
	return g[0]`,
	1,
	`var g = [2]int{1, 2}
func get() [2]int { return g }`,
);

parity(
	"array inside struct copies with the struct",
	`	s := S{A: [2]int{1, 2}}
	t := s
	t.A[0] = 9
	return s.A[0]*10 + t.A[0]`,
	19,
	`type S struct { A [2]int }`,
);

parity(
	"a := s.A loads a copy of a struct field",
	`	s := S{A: [2]int{1, 2}}
	a := s.A
	a[0] = 9
	return s.A[0]`,
	1,
	`type S struct { A [2]int }`,
);

parity(
	"s.A = a stores a copy into a struct field",
	`	a := [2]int{1, 2}
	s := S{}
	s.A = a
	a[0] = 9
	return s.A[0]`,
	1,
	`type S struct { A [2]int }`,
);

parity(
	"struct literal field stores a copy",
	`	a := [2]int{1, 2}
	s := S{A: a}
	a[0] = 9
	return s.A[0]`,
	1,
	`type S struct { A [2]int }`,
);

parity(
	"nested arrays copy deeply",
	`	a := [2][3]int{{1, 2, 3}, {4, 5, 6}}
	b := a
	b[1][2] = 9
	return a[1][2]*10 + b[1][2]`,
	69,
);

parity(
	"range over array iterates a copy",
	`	a := [3]int{1, 2, 3}
	sum := 0
	for i, v := range a {
		a[2] = 100
		sum += v
		_ = i
	}
	return sum*1000 + a[2]`,
	6100,
);

parity(
	"a := m[k]; a[0] = 9 leaves the map unchanged",
	`	m := map[string][2]int{"x": {5, 6}}
	a := m["x"]
	a[0] = 9
	return m["x"][0]`,
	5,
);

parity(
	"m[k] = a stores a copy into the map",
	`	a := [2]int{5, 6}
	m := map[string][2]int{}
	m["x"] = a
	a[0] = 9
	return m["x"][0]`,
	5,
);

parity(
	"a := xs[0]; a[0] = 9 leaves the slice unchanged",
	`	xs := [][2]int{{5, 6}}
	a := xs[0]
	a[0] = 9
	return xs[0][0]`,
	5,
);

parity(
	"xs[0] = a and append store copies",
	`	a := [2]int{5, 6}
	xs := make([][2]int, 1)
	xs[0] = a
	xs = append(xs, a)
	a[0] = 9
	return xs[0][0]*10 + xs[1][0]`,
	55,
);

parity(
	"xs[0][0] = 9 writes through in place",
	`	xs := [][2]int{{5, 6}}
	xs[0][0] = 9
	return xs[0][0]`,
	9,
);

parity(
	"array stored in an interface is a copy",
	`	a := [2]int{5, 6}
	var x any = a
	a[0] = 9
	b := x.([2]int)
	b[1] = 9
	c := x.([2]int)
	return c[0]*10 + c[1]`,
	56,
);

parity(
	"array of structs copies the structs",
	`	a := [2]P{{X: 1}, {X: 2}}
	b := a
	b[0].X = 9
	return a[0].X*10 + b[0].X`,
	19,
	`type P struct { X int }`,
);

parity(
	"global array assignment copies",
	`	b := g
	b[0] = 9
	g2 = g
	g2[1] = 7
	return g[0]*10 + g[1]`,
	12,
	`var g = [2]int{1, 2}
var g2 [2]int`,
);

parity(
	"closure capturing an array copy",
	`	a := [2]int{1, 2}
	b := a
	f := func() { b[0] = 9 }
	f()
	return a[0]*10 + b[0]`,
	19,
);

parity(
	"copy survives a later write to the source",
	`	a := [3]int{1, 2, 3}
	b := a
	a[0] = 9
	return a[0]*10 + b[0]`,
	91,
);

parity(
	"returned local array is independent of later writes",
	`	a := make3()
	b := a
	b[2] = 9
	return a[2]*10 + b[2]`,
	39,
	`func make3() [3]int { return [3]int{1, 2, 3} }`,
);

parity(
	"range value over a slice of arrays is a copy",
	`	xs := [][2]int{{1, 2}, {3, 4}}
	for _, v := range xs {
		v[0] = 9
	}
	return xs[0][0]*10 + xs[1][0]`,
	13,
);

parity(
	"range value over a map of arrays is a copy",
	`	m := map[string][2]int{"x": {1, 2}}
	for _, v := range m {
		v[0] = 9
	}
	return m["x"][0]`,
	1,
);

parity(
	"row store into a 2D array copies the row",
	`	var grid [2][2]int
	row := [2]int{1, 2}
	grid[0] = row
	row[0] = 9
	return grid[0][0]*10 + row[0]`,
	19,
);

parity(
	"zero-valued nested array is writable",
	`	var a [2][3]int
	a[1][2] = 5
	b := a
	b[1][2] = 7
	return a[1][2]*10 + b[1][2]`,
	57,
);

parity(
	"make([][N]T) elements are zero arrays",
	`	xs := make([][2]int, 2)
	xs[1][0] = 5
	a := xs[0]
	a[1] = 7
	return xs[1][0]*100 + xs[0][1]*10 + a[1]`,
	507,
);

parity(
	"a := p.A through a struct pointer copies",
	`	s := &S{A: [2]int{1, 2}}
	a := s.A
	a[0] = 9
	return s.A[0]*10 + a[0]`,
	19,
	`type S struct { A [2]int }`,
);

parity(
	"[N]float32 copies on assignment",
	`	a := [2]float32{1.5, 2.5}
	b := a
	b[0] = 9
	return int(a[0]*10 + b[0])`,
	24,
);

parity(
	"copy() between slices of arrays copies the elements",
	`	src := [][2]int{{1, 2}}
	dst := make([][2]int, 1)
	copy(dst, src)
	src[0][0] = 9
	return dst[0][0]`,
	1,
);

parity(
	"captured array variable reassigned in a closure copies",
	`	a := [2]int{1, 2}
	var b [2]int
	f := func() { b = a }
	f()
	a[0] = 9
	return b[0]`,
	1,
);

test("[N]simd.F32x4 copies on assignment", () => {
	const src = `
package main

import "gofront/simd"

func Main() float64 {
	a := [2]simd.F32x4{simd.Splat(1), simd.Splat(2)}
	b := a
	b[0] = simd.Splat(9)
	return float64(a[0].Lane(0)*10 + b[0].Lane(0))
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 19);
	assertEqual(res.wasmRes, 19);
});

section("WASM Arrays — clone elision");

test("copy between unmutated locals is elided", () => {
	const src = `
package main

func Main() int {
	a := [3]int{1, 2, 3}
	b := a
	return a[0] + b[2]
}
`;
	const res = compileHybrid(src, { emitWat: true });
	assertEqual(res.run("Main").jsRes, 4);
	assert(
		!res.wat.includes("array.copy"),
		"elided copy must not emit array.copy",
	);
});

test("copy stays when the source is mutated afterwards", () => {
	const src = `
package main

func Main() int {
	a := [3]int{1, 2, 3}
	b := a
	a[0] = 9
	return a[0]*10 + b[0]
}
`;
	const res = compileHybrid(src, { emitWat: true });
	assertEqual(res.run("Main").jsRes, 91);
	assert(res.wat.includes("array.copy"), "copy must remain");
});

test("range over an unmutated local array does not copy it", () => {
	const src = `
package main

func Main() int {
	a := [3]int{1, 2, 3}
	s := 0
	for _, v := range a {
		s += v
	}
	return s
}
`;
	const res = compileHybrid(src, { emitWat: true });
	assertEqual(res.run("Main").jsRes, 6);
	assert(!res.wat.includes("array.copy"), "range copy must be elided");
});
