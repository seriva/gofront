// test/unit/wasm/arrays.test.js
// Tests for Task 0.8a: fixed-size arrays are values in WASM (copy on every
// assignment, call, return, store and load), matching the JS backend.

import { inspect } from "node:util";
import { HELPER_SLICE, HELPER_SV } from "../../../src/backend/js/runtime.js";
import {
	assert,
	assertEqual,
	assertValidWasm,
	compile,
	compileHybrid,
	compileHybridProject,
	compileWasm,
	runJs,
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

section("WASM Arrays — equality");

parity(
	"== compares array elements, not identity",
	`	a := [2]int{1, 2}
	b := a
	b[0] = 1
	if a == b {
		return 1
	}
	return 0`,
	1,
);

parity(
	"!= compares array elements, not identity",
	`	a := [2]int{1, 2}
	b := a
	r := 0
	if a != b {
		r += 1
	}
	b[1] = 3
	if a != b {
		r += 10
	}
	return r`,
	10,
);

parity(
	"== on nested string arrays compares element-wise",
	`	a := [2][2]string{{"a", "b"}, {"c", "d"}}
	b := a
	b[0][0] = "a"
	r := 0
	if a == b {
		r += 1
	}
	b[1][1] = "x"
	if a == b {
		r += 10
	}
	return r`,
	1,
);

parity(
	"== on float arrays treats NaN as unequal",
	`	a := [2]float64{math.NaN(), 1}
	b := a
	c := [2]float64{0.5, 1}
	d := c
	r := 0
	if a == b {
		r += 1
	}
	if c == d {
		r += 10
	}
	return r`,
	10,
	`import "math"`,
);

parity(
	"== on arrays of structs compares fields",
	`	a := [2]P{{1, 2}, {3, 4}}
	b := a
	b[0].X = 1
	r := 0
	if a == b {
		r += 1
	}
	b[1].Y = 5
	if a != b {
		r += 10
	}
	return r`,
	11,
	"type P struct {\n\tX int\n\tY float64\n}",
);

parity(
	"struct == compares array fields element-wise",
	`	s := S{[2]int{1, 2}, 3}
	t := s
	t.A[0] = 1
	r := 0
	if s == t {
		r += 1
	}
	t.A[1] = 7
	if s != t {
		r += 10
	}
	return r`,
	11,
	"type S struct {\n\tA [2]int\n\tN int\n}",
);

section("WASM Arrays — loads from maps and interfaces copy");

parity(
	"comma-ok map load copies the array",
	`	m := map[string][2]int{"a": {1, 2}}
	v, ok := m["a"]
	v[0] = 9
	if !ok {
		return -1
	}
	return m["a"][0]*10 + v[0]`,
	19,
);

parity(
	"comma-ok map load in assign form copies the array",
	`	m := map[string][2]int{"a": {1, 2}}
	var v [2]int
	var ok bool
	v, ok = m["a"]
	v[0] = 9
	if !ok {
		return -1
	}
	return m["a"][0]*10 + v[0]`,
	19,
);

parity(
	"comma-ok type assertion copies the array",
	`	var x any = [2]int{1, 2}
	b, _ := x.([2]int)
	b[0] = 9
	c := x.([2]int)
	return c[0]*10 + b[0]`,
	19,
);

parity(
	"type switch binding copies the array",
	`	var x any = [2]int{1, 2}
	r := 0
	switch v := x.(type) {
	case [2]int:
		v[0] = 9
		r = v[0]
	}
	c := x.([2]int)
	return c[0]*10 + r`,
	19,
);

section("WASM Arrays — deep copies");

parity(
	"array of anonymous structs copies the elements",
	`	a := [2]struct{ X int }{{1}, {2}}
	b := a
	b[0].X = 9
	return a[0].X*10 + b[0].X`,
	19,
);

parity(
	"struct copy clones nested value-struct fields",
	`	s := S{In{[2]int{1, 2}}}
	t := s
	t.In.A[0] = 9
	return s.In.A[0]*10 + t.In.A[0]`,
	19,
	"type In struct {\n\tA [2]int\n}\n\ntype S struct {\n\tIn In\n}",
);

section("WASM Arrays — JS copies match WASM");

parity(
	"generic identity returns a copy of an array argument",
	`	a := [2]int{1, 2}
	b := id(a)
	b[0] = 9
	return a[0]*10 + b[0]`,
	19,
	"func id[T any](v T) T { return v }",
);

parity(
	"variadic array arguments are copies",
	`	a := [2]int{1, 2}
	f(a)
	return a[0]`,
	1,
	"func f(xs ...[2]int) {\n\txs[0][0] = 9\n}",
);

parity(
	"append with a spread of arrays copies the elements",
	`	xs := [][2]int{{1, 2}}
	var dst [][2]int
	dst = append(dst, xs...)
	dst[0][0] = 9
	return xs[0][0]*10 + dst[0][0]`,
	19,
);

parity(
	"array conversion copies",
	`	a := [2]int{1, 2}
	b := [2]int(a)
	b[0] = 9
	return a[0]*10 + b[0]`,
	19,
);

parity(
	"map range value with an array field is a copy",
	`	m := map[int]S{1: {[2]int{1, 2}}}
	for _, v := range m {
		v.A[0] = 9
	}
	return m[1].A[0]`,
	1,
	"type S struct {\n\tA [2]int\n}",
);

section("Arrays — composite literals are zero-filled to their length");

parity(
	"partial array literal pads with zeros",
	`	a := [3]int{1}
	return a[0]*100 + a[1]*10 + a[2] + len(a)`,
	103,
);

parity(
	"empty array literal equals the zero array",
	`	a := [3]int{}
	var b [3]int
	if a == b {
		return a[2] + 1
	}
	return 0`,
	1,
);

parity(
	"keyed array literal places elements by index",
	`	a := [5]int{2: 7}
	b := [5]int{1, 3: 4, 5}
	return a[0] + a[2]*10 + a[4] + b[0]*10000 + b[1]*1000 + b[2]*100 + b[3]*10 + b[4]`,
	10115,
);

parity(
	"keyed array literal with a named constant index",
	`	a := [5]int{K: 7}
	return a[0]*10 + a[2]`,
	7,
	"const K = 2",
);

parity(
	"keyed array literal with a constant expression index",
	`	a := [5]int{1 + 1: 7, 3: 8}
	return a[0]*100 + a[2]*10 + a[3]`,
	78,
);

parity(
	"ellipsis array length uses a named constant key",
	`	a := [...]int{K: 7}
	return len(a)*10 + a[4]`,
	57,
	"const K = 4",
);

parity(
	"positional elements follow a constant key",
	`	a := [...]int{K: 1, 2}
	return len(a)*10 + a[2]`,
	32,
	"const K = 1",
);

parity(
	"keyed nested array literal pads the inner arrays",
	`	x := [3][2]int{1: {5}}
	return x[0][1] + x[1][0]*10 + x[1][1] + x[2][1] + len(x[2])`,
	52,
);

parity(
	"ellipsis array literal with an index key",
	`	a := [...]int{4: 1}
	return len(a)*10 + a[3] + a[4]`,
	51,
);

parity(
	"ellipsis array length counts elements after a key",
	`	a := [...]int{1, 3: 4, 5}
	return len(a)*10 + a[4]`,
	55,
);

parity(
	"nested array literal pads inner and outer arrays",
	`	x := [2][3]int{{1}}
	var z [2][3]int
	z[0][0] = 1
	if x == z {
		return x[0][2] + x[1][2] + 1
	}
	return 0`,
	1,
);

parity(
	"array of structs literal pads with zero structs",
	`	ps := [3]P{{1}}
	ps[2].X += 5
	return ps[0].X*10 + ps[2].X`,
	15,
	"type P struct {\n\tX int\n}",
);

parity(
	"string array literal pads with empty strings",
	`	s := [3]string{"a"}
	return len(s[0] + s[1] + s[2])`,
	1,
);

parity(
	"bool array literal pads with false",
	`	b := [2]bool{true}
	if b[0] && !b[1] {
		return 1
	}
	return 0`,
	1,
);

parity(
	"float array literal pads with zeros",
	`	f := [3]float64{1.5}
	return int(f[0]*2 + f[1] + f[2])`,
	3,
);

parity(
	"large sparse array literal keeps given elements and zero slots",
	`	a := [1000]int{1: 2, 999: 3}
	b := [...]int{500: 4, 5}
	ps := [100]P{7: {9}}
	ps[8].X++
	return a[0] + a[1]*10 + a[998] + a[999]*100 + len(b)*1000 + b[501]*1000000 + ps[7].X*10000000 + ps[8].X*100000000`,
	195502320,
	"type P struct {\n\tX int\n}",
);

// JS only: WASM keeps array.new_fixed (limited to 10000 elements).
test("large mostly-zero array literals are not expanded slot by slot (js)", () => {
	const { js, errors } = compile(`package main

func main() {
	b := [100000]byte{}
	c := [65536]int{1: 2, 65535: 3}
	d := [64]string{"x"}
	println(len(b), b[99999], c[0], c[1], c[65535], len(c), d[0] + d[63] + "|")
}
`);
	assertEqual(errors.length, 0);
	assert(js.length < 5000, `output is ${js.length} bytes`);
	assertEqual(runJs(js), "100000 0 0 2 3 65536 x|");
});

test("small array literals stay inline (js)", () => {
	const { js, errors } = compile(`package main

func main() {
	a := [3]int{1}
	println(a[0], a[2])
}
`);
	assertEqual(errors.length, 0);
	assert(js.includes("[1, 0, 0]"), "inline literal");
});

// JS only: a named array type literal does not compile in WASM yet.
test("named array type literal pads with zeros (js)", () => {
	const { js, errors } = compile(`package main

type V [3]int

func main() {
	v := V{1}
	var w V
	w[0] = 1
	println(v == w, v[2] + 1)
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true 1");
});

section("Struct arguments to generic and variadic parameters are copies");

parity(
	"struct passed to a generic parameter is a copy",
	`	a := P{1}
	s := Push(nil, a)
	a.X = 9
	return s[0].X`,
	1,
	"type P struct {\n\tX int\n}\n\nfunc Push[T any](s []T, v T) []T { return append(s, v) }",
);

parity(
	"callee mutating a variadic struct argument leaves the caller unchanged",
	`	a := P{1}
	f(a)
	return a.X`,
	1,
	"type P struct {\n\tX int\n}\n\nfunc f(xs ...P) { xs[0].X = 9 }",
);

parity(
	"variadic struct with an array field is copied deeply",
	`	a := Q{[2]int{1, 2}}
	f(a, a)
	return a.A[0]*10 + a.A[1]`,
	12,
	"type Q struct {\n\tA [2]int\n}\n\nfunc f(xs ...Q) {\n\txs[0].A[0] = 9\n\txs[1].A[1] = 9\n}",
);

parity(
	"f(s...) still passes the caller's slice",
	`	s := []P{{1}}
	f(s...)
	return s[0].X`,
	9,
	"type P struct {\n\tX int\n}\n\nfunc f(xs ...P) { xs[0].X = 9 }",
);

section("Slice aliasing and multi-value assignment (Task 0.19a)");

parity(
	"s := b[:] aliases the slice's backing store",
	`	b := []int{1, 2, 3}
	s := b[:]
	s[0] = 9
	return b[0]`,
	9,
);

parity(
	"s := b[0:] aliases the slice's backing store",
	`	b := []int{1, 2, 3}
	s := b[0:]
	s[1] = 8
	return b[1]`,
	8,
);

parity(
	"s := a[:] aliases the array",
	`	a := [3]int{1, 2, 3}
	s := a[:]
	s[2] = 7
	a[0] = 5
	return a[2]*10 + s[0]`,
	75,
);

parity(
	"append to b[:] does not grow b",
	`	b := []int{1, 2, 3}
	s := append(b[:], 4)
	return len(b)*10 + len(s)`,
	34,
);

parity(
	"x, y = y, x swaps scalars",
	`	x, y := 1, 2
	x, y = y, x
	return x*10 + y`,
	21,
);

parity(
	"a, b = b, a swaps arrays",
	`	a := [2]int{1, 2}
	b := [2]int{3, 4}
	a, b = b, a
	return a[0]*1000 + a[1]*100 + b[0]*10 + b[1]`,
	3412,
);

parity(
	"xs[0], xs[1] = xs[1], xs[0] swaps slice elements",
	`	xs := []int{1, 2}
	xs[0], xs[1] = xs[1], xs[0]
	return xs[0]*10 + xs[1]`,
	21,
);

parity(
	"multi-value assignment evaluates every right-hand side first",
	`	i, j, k := 1, 2, 3
	i, j, k = j+k, i+k, i+j
	return i*100 + j*10 + k`,
	543,
);

parity(
	"x, y := 2, x on a redeclared x reads the old x",
	`	x := 1
	x, y := 2, x
	return x*10 + y`,
	21,
);

parity(
	"x, y := 2, f() runs f before the redeclared x is assigned",
	`	x := 1
	f := func() int { return x }
	x, y := 2, f()
	return x*10 + y`,
	21,
);

parity(
	"lo, hi := 0, len(xs) and a, b = b, len(xs) keep their values",
	`	xs := []int{1, 2, 3}
	lo, hi := 0, len(xs)
	a, b := 5, 6
	a, b = b, len(xs)
	return lo*1000 + hi*100 + a*10 + b`,
	363,
);

section("Array type completion (Task 0.19b)");

parity(
	"named array type: literal, index and assignment",
	`	v := V{1, 2, 3}
	w := v
	w[0] = 9
	return v[0]*100 + w[0]*10 + len(v)`,
	193,
	"type V [3]int",
);

parity(
	"named array type: comparison",
	`	a := V{1, 2, 3}
	b := V{1, 2, 3}
	c := V{1, 2, 4}
	r := 0
	if a == b {
		r += 10
	}
	if a != c {
		r++
	}
	return r`,
	11,
	"type V [3]int",
);

parity(
	"named array type: value and pointer methods",
	`	v := V{1, 2, 3}
	v.Scale(2)
	return v.Sum()`,
	12,
	"type V [3]int\n\nfunc (v V) Sum() int { return v[0] + v[1] + v[2] }\n\nfunc (v *V) Scale(k int) {\n\tfor i := range v {\n\t\tv[i] *= k\n\t}\n}",
);

parity(
	"pointer to array: index, write and dereference",
	`	a := [3]int{1, 2, 3}
	p := &a
	p[1] = 7
	b := *p
	b[0] = 9
	return a[0]*100 + a[1]*10 + p[2] + len(p)*1000`,
	3173,
);

parity(
	"pointer to array: assignment through *p",
	`	a := [2]int{1, 2}
	p := &a
	*p = [2]int{5, 6}
	return a[0]*10 + a[1]`,
	56,
);

parity(
	"keyed slice literal",
	`	s := []int{2: 7, 4: 1}
	return len(s)*100 + s[2]*10 + s[4] + s[0]`,
	571,
);

parity(
	"keyed slice literal with positional elements after a key",
	`	s := []int{1, 3: 4, 5}
	return len(s)*1000 + s[0]*100 + s[3]*10 + s[4]`,
	5145,
);

parity(
	"keyed nested array literal with elided types",
	`	a := [2][3]int{1: {2: 5}}
	b := a
	b[1][2] = 9
	return a[1][2]*100 + a[0][0]*10 + b[1][2]`,
	509,
);

parity(
	"keyed elements evaluate in source order",
	`	n := 0
	next := func() int {
		n++
		return n
	}
	a := [3]int{2: next(), 0: next(), 1: next()}
	s := []int{2: next(), 0: next()}
	return a[0]*10000 + a[1]*1000 + a[2]*100 + s[0]*10 + s[2]`,
	23154,
);

test("array literal over 10000 elements compiles to a valid module", () => {
	const elems = Array.from({ length: 10050 }, (_, i) => String(i % 7)).join(
		", ",
	);
	const src = `
package main

var big = [10050]int{${elems}}

func Main() int {
	return big[10049]*10 + big[13]
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, (10049 % 7) * 10 + (13 % 7));
	assertEqual(res.wasmRes, BigInt((10049 % 7) * 10 + (13 % 7)));
});

parity(
	"pointer to array sees a later assignment to the array",
	`	a := [2]int{1, 2}
	p := &a
	a = [2]int{3, 4}
	p[1] = 9
	return a[0]*10 + a[1] + p[0]*100`,
	339,
);

section("WASM Arrays — named array types and swaps (review fixes)");

const namedV = "type V [3]int";

parity(
	"range over a named array value",
	`	v := V{1, 2, 3}
	n := 0
	for i, x := range v {
		n += i * x
	}
	return n`,
	8,
	namedV,
);

parity(
	"range over a pointer to a named array",
	`	v := V{1, 2, 3}
	p := &v
	n := 0
	for i, x := range p {
		n += i * x
	}
	return n`,
	8,
	namedV,
);

parity(
	"zero value of a named array has its full length",
	`	var w V
	w[1] = 2
	return w[1]*10 + len(w)`,
	23,
	namedV,
);

parity(
	"named array struct field zero value",
	`	h := H{}
	h.v[1] = 4
	return h.v[1]`,
	4,
	`${namedV}\n\ntype H struct{ v V }`,
);

parity(
	"array of named arrays zero value",
	`	var m [2]V
	m[1][2] = 5
	return m[1][2]`,
	5,
	namedV,
);

parity(
	"named array passed and returned by value",
	`	var w V
	w = f(w)
	return w[2]`,
	7,
	`${namedV}\n\nfunc f(v V) V {\n\tv[2] = 7\n\treturn v\n}`,
);

parity(
	"swap of address-taken arrays",
	`	a := [2]int{1, 2}
	b := [2]int{3, 4}
	p := &a
	a, b = b, a
	return a[0]*1000 + b[0]*100 + p[0]`,
	3103,
);

parity(
	"swap of two address-taken arrays",
	`	a := [2]int{1, 2}
	b := [2]int{3, 4}
	p := &a
	q := &b
	a, b = b, a
	return a[0]*1000 + b[0]*100 + p[0]*10 + q[0]`,
	3131,
);

parity(
	"element store before a parallel array read sees the old array",
	`	a := [2]int{1, 2}
	var b [2]int
	a[0], b = 9, a
	return a[0]*10 + b[0]`,
	91,
);

function mainCopies(src) {
	const res = compileHybrid(src, { emitWat: true });
	const start = res.wat.indexOf('(export "Main")');
	const main = res.wat.slice(start, res.wat.indexOf("\n  (func", start));
	return { res, copies: (main.match(/array\.copy/g) ?? []).length };
}

test("plain array swap copies each array once", () => {
	const { res, copies } = mainCopies(`
package main

func Main() int {
	a := [2]int{1, 2}
	b := [2]int{3, 4}
	a, b = b, a
	return a[0]*10 + b[0]
}
`);
	assertEqual(res.run("Main").wasmRes, 31n);
	assertEqual(copies, 2);
});

test("slice element array swap copies each array once", () => {
	const { res, copies } = mainCopies(`
package main

func Main() int {
	s := [][2]int{{1, 2}, {3, 4}}
	s[0], s[1] = s[1], s[0]
	return s[0][0]*10 + s[1][0]
}
`);
	assertEqual(res.run("Main").wasmRes, 31n);
	assertEqual(copies, 2);
});

test("JS compile of a 200000-element slice literal", () => {
	const elems = Array.from({ length: 200000 }, (_, i) => String(i % 7)).join(
		",",
	);
	const src = `
package main

var big = []byte{${elems}}

func Main() int {
	return len(big)
}
`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assert(js.length > 0, "emitted JS");
});

test("WASM compile of a 200000-element slice literal", () => {
	const elems = Array.from({ length: 200000 }, (_, i) => String(i % 7)).join(
		",",
	);
	const src = `
package main

var big = []int{${elems}}

func Main() int {
	return len(big)
}
`;
	const { wasm, errors } = compileWasm(src);
	assertEqual(errors?.length ?? 0, 0);
	assertValidWasm(wasm);
});

test("type check of a 200000-element [...]int literal", () => {
	const elems = Array.from({ length: 200000 }, (_, i) => String(i % 7)).join(
		",",
	);
	const src = `
package main

var big = [...]int{${elems}}

func Main() int {
	return len(big)
}
`;
	const { errors } = compile(src);
	assertEqual(errors.length, 0);
});

section("Slice views share the backing store (Task 0.20)");

parity(
	"p[:2] and p[:] of a pointer to an array alias the array",
	`	v := [3]int{1, 2, 3}
	p := &v
	q := p[:2]
	q[0] = 9
	r := p[:]
	r[1] = 8
	return v[0]*10 + v[1]`,
	98,
);

parity(
	"b[i:] aliases the slice in both directions",
	`	b := []int{1, 2, 3}
	s := b[1:]
	s[0] = 9
	b[2] = 7
	return b[1]*10 + s[1]`,
	97,
);

parity(
	"b[:n] aliases the slice",
	`	b := []int{1, 2, 3}
	s := b[:2]
	s[1] = 9
	return b[1]*10 + len(s)`,
	92,
);

parity(
	"b[i:j] of a view aliases the original",
	`	b := []int{1, 2, 3, 4}
	s := b[1:3]
	t := s[1:]
	t[0] = 5
	return b[2]*100 + len(t)*10 + cap(t)`,
	512,
);

parity(
	"a[i:j] of an array aliases the array",
	`	a := [4]int{1, 2, 3, 4}
	s := a[1:3]
	s[1] = 9
	a[1] = 7
	return a[2]*10 + s[0]`,
	97,
);

parity(
	"cap of partial slices",
	`	b := []int{1, 2, 3, 4}
	return cap(b[1:])*1000 + cap(b[:1])*100 + cap(b[1:2])*10 + cap(b[0:1:2])`,
	3432,
);

parity(
	"append within capacity writes into the shared store",
	`	b := []int{1, 2, 3}
	s := b[:1]
	s = append(s, 9)
	s[0] = 5
	return b[0]*100 + b[1]*10 + len(s)`,
	592,
);

parity(
	"append beyond capacity reallocates",
	`	b := []int{1, 2, 3}
	s := b[1:]
	s = append(s, 4)
	s[0] = 9
	return b[1]*10 + len(s)`,
	23,
);

parity(
	"three-index slice limits capacity for append",
	`	b := []int{1, 2, 3}
	s := b[0:1:1]
	s = append(s, 9)
	return b[1]*10 + cap(b[0:1:2])`,
	22,
);

parity(
	"reslicing up to capacity extends a view",
	`	b := []int{1, 2, 3}
	s := b[:1]
	t := s[:3]
	t[2] = 9
	return b[2]*10 + len(t)`,
	93,
);

parity(
	"range, copy and append(spread) over views",
	`	b := []int{1, 2, 3, 4}
	sum := 0
	for _, x := range b[1:3] {
		sum += x
	}
	n := copy(b[2:], []int{8, 9, 10})
	c := append([]int{}, b[1:]...)
	return sum*1000 + n*100 + c[1]*10 + len(c)`,
	5283,
);

parity(
	"byte slice views share and append within capacity",
	`	b := []byte{1, 2, 3}
	s := b[:1]
	s = append(s, 9)
	t := b[1:]
	t[1] = 7
	return int(b[1])*100 + int(b[2])*10 + cap(s)`,
	973,
);

parity(
	"byte array views alias the array",
	`	a := [3]byte{1, 2, 3}
	s := a[1:]
	s[0] = 9
	return int(a[1])*10 + len(s)`,
	92,
);

parity(
	"struct slice views alias elements",
	`	ps := []P{{1}, {2}, {3}}
	s := ps[1:]
	s[0] = P{7}
	s[1].X = 8
	return ps[1].X*10 + ps[2].X`,
	78,
	"type P struct {\n\tX int\n}",
);

parity(
	"make with a capacity: reslicing and append share the store",
	`	m := make([]int, 1, 4)
	t := m[:3]
	t[2] = 5
	m = append(m, 7)
	return cap(m)*1000 + len(t)*100 + t[1]*10 + m[1]*0 + t[2]`,
	4375,
);

parity(
	"make with a capacity of byte and pointer elements",
	`	b := make([]byte, 2, 8)
	u := b[:6]
	u[5] = 7
	b = append(b, 1, 2, 3, 4)
	ps := make([]*int, 1, 3)
	n := 0
	if ps[0] == nil {
		n = 1
	}
	return int(b[5])*1000 + cap(b)*100 + cap(ps)*10 + n`,
	4831,
);

parity(
	"x = x[i:j] within the length keeps the elements",
	`	x := []int{1, 2, 3, 4}
	x = x[:3]
	x = x[1:]
	x[0] = 9
	return x[0]*100 + x[1]*10 + len(x)`,
	932,
);

parity(
	"x = x[:n] beyond the length reslices up to the capacity",
	`	b := []int{1, 2, 3}
	x := b[:1]
	x = x[:3]
	x[2] = 9
	return b[2]*10 + len(x)`,
	93,
);

parity(
	"x = x[:2]; x = x[:4] keeps the capacity",
	`	x := []int{1, 2, 3, 4}
	x = x[:2]
	x[0] = 9
	x = x[:4]
	return x[0]*1000 + x[3]*100 + len(x)*10 + cap(x)`,
	9444,
);

parity(
	"append after x = x[:n] writes into the old store",
	`	b := []int{1, 2, 3, 4}
	x := b
	x = x[:2]
	x = append(x, 7)
	return b[2]*100 + len(x)*10 + cap(x)`,
	734,
);

parity(
	"cap after x = x[i:j] counts from the old capacity",
	`	x := make([]int, 4, 6)
	x = x[1:3]
	y := []int{1, 2, 3, 4, 5}
	y = y[:1]
	y = y[:0]
	return cap(x)*100 + cap(y)*10 + len(y)`,
	550,
);

// Writes through a `x = x[lo:hi]` copy reach the old array in program order
// (`__rcs`), so extending the copy agrees with Go however the writes through
// the copy and through other slices of the old array interleave.
parity(
	"copy write then alias write to the same index: the alias wins",
	`	b := []int{1, 2, 3, 4}
	x := b
	x = x[:2]
	x[0] = 5
	b[0] = 7
	x = x[:4]
	return x[0]*10 + b[0]`,
	77,
);

parity(
	"alias write then copy write of the old value: the copy wins",
	`	b := []int{1, 2, 3, 4}
	x := b
	x = x[:2]
	b[0] = 100
	x[0] = 1
	x = x[:4]
	return x[0]*1000 + b[0]`,
	1001,
);

parity(
	"x[i] op= v, x[i]++ and x[len(x)-1] = v write through the copy",
	`	b := []int{1, 2, 3, 4, 5}
	x := b
	x = x[:3]
	x[1] += 4
	x[0]++
	x[len(x)-1] = 8
	b[1] = 9
	b[0] = 7
	x = append(x, 6)
	return x[0]*10000 + x[1]*1000 + x[2]*100 + x[3]*10 + b[2]`,
	79868,
);

parity(
	"left-hand index calls run left to right when one is bound to a temporary",
	`	log := 0
	f := func(v int) int {
		log = log*10 + v
		return 0
	}
	a := []int{0}
	x := []int{0, 0, 0}
	x = x[:2]
	a[f(1)], x[f(2)] = 1, 2
	return log*10 + x[0]`,
	122,
);

parity(
	"the slice operand of a written-through index is read before the call",
	`	s := &S{buf: []int{0, 0, 0, 0}}
	al := s.buf
	s.buf = s.buf[:2]
	s.buf[0] = s.reset()
	s.buf = s.buf[:4]
	return al[0]*100 + s.buf[0]*10 + len(s.alt)`,
	902,
	`type S struct {
	buf []int
	alt []int
}

func (s *S) reset() int {
	s.alt = s.buf
	s.buf = []int{0, 0, 0, 0}
	s.buf = s.buf[:2]
	return 9
}`,
);

test("a both package with bound index temporaries compiles to JS and WASM", async () => {
	const lib = `//gofront:target both
package lib

type S struct {
	Buf []int
	N   int
}

func (s *S) next() int { s.N++; return 9 }

func Run() int {
	x := []int{0, 0, 0, 0, 0}
	al := x
	x = x[:3]
	al[0] = 7
	k := 2
	x[k+0], k = 5, 0
	s := &S{Buf: []int{1, 2, 3, 4, 5}}
	s.Buf = s.Buf[:3]
	s.Buf[s.N] = s.next()
	s.Buf = s.Buf[:5]
	x = x[:5]
	return x[0]*100 + x[2]*10 + k
}
`;
	const { mod } = await compileHybridProject(
		{
			"lib/lib.go": lib,
			"w/w.go": `//gofront:target wasm
package w

import "../lib"

func WRun() int { return lib.Run() }
`,
			"main.go": `package main

import (
	"./lib"
	"./w"
)

func Main() int { return lib.Run()*1000 + w.WRun() }
`,
		},
		{ exports: ["Main"] },
	);
	assertEqual(mod.Main(), 750750);
});

parity(
	"an index with a call is evaluated once and written through",
	`	b := []int{1, 2, 3, 4}
	x := b
	x = x[:3]
	k := 0
	next := func() int {
		k++
		return k
	}
	x[next()] = 5
	b[1] = 8
	x = x[:4]
	return x[1]*100 + b[1]*10 + k`,
	881,
);

parity(
	"a write to a chain another LHS field reassigns goes to the old slice",
	`	p := &S{buf: []int{1, 2, 3, 4}}
	al := p.buf
	p.buf = p.buf[:3]
	o := []int{10, 20, 30, 40}
	oal := o
	o = o[:3]
	oal[0] = 99
	p.buf[0], p.buf = 5, o
	return al[0]*10000 + oal[0]*10 + len(p.buf)`,
	50993,
	"type S struct{ buf []int }",
);

parity(
	"a write to a chain another LHS deref reassigns goes to the old slice",
	`	p := &S{buf: []int{1, 2, 3, 4}}
	pb := &p.buf
	al := p.buf
	p.buf = p.buf[:3]
	o := []int{10, 20, 30, 40}
	oal := o
	o = o[:3]
	oal[0] = 99
	p.buf[0], *pb = 5, o
	return al[0]*10000 + oal[0]*10 + len(p.buf)`,
	50993,
	"type S struct{ buf []int }",
);

parity(
	"a written-through element survives an older copy's append",
	`	x := []int{1, 2, 3, 4, 5}
	orig := x
	x = x[:4]
	y := x
	x = x[:3]
	x[0] = 9
	y = append(y, 100)
	return orig[0]*1000 + y[0]*10 + orig[4]/100`,
	9091,
);

parity(
	"a written-through element survives an older copy's reslice",
	`	x := []int{1, 2, 3, 4, 5}
	orig := x
	x = x[:4]
	y := x
	x = x[:3]
	x[2] = 7
	y = y[:2]
	return orig[2]*10 + len(y)`,
	72,
);

parity(
	"a bound LHS index is evaluated after its operand",
	`	x := []int{1, 2, 3}
	x = x[:2]
	arr := []int{0, 0}
	tr := 0
	get := func() []int {
		tr = tr*10 + 1
		return arr
	}
	g := func() int {
		tr = tr*10 + 2
		return 1
	}
	f := func() int {
		tr = tr*10 + 3
		return 4
	}
	get()[g()], x[0] = f(), 6
	return tr*100 + arr[1]*10 + x[0]`,
	12346,
);

parity(
	"a bound LHS index that reassigns its operand writes the old slice",
	`	a := []int{0, 0}
	old := a
	x := []int{1, 2, 3}
	x = x[:2]
	g := func() int {
		a = []int{0, 0}
		return 1
	}
	a[g()], x[0] = 5, 6
	return old[1]*1000 + a[1]*100 + x[0]`,
	5006,
);

parity(
	"an index changed by another LHS is written through at its old value",
	`	x := []int{0, 0, 0, 0, 0}
	al := x
	x = x[:3]
	al[0] = 7
	c := &cnt{i: 2}
	x[c.i], c.i = 5, 0
	x = x[:5]
	return x[0]*100000 + x[1]*10000 + x[2]*1000 + x[3]*100 + x[4]*10 + al[2]`,
	705005,
	"type cnt struct{ i int }",
);

parity(
	"an index changed by the RHS is written through at the written element",
	`	s := &rbuf{buf: []int{0, 0, 0, 0, 0}}
	ob := s.buf
	s.buf = s.buf[:3]
	ob[1] = 7
	s.buf[s.n] = s.next()
	s.buf = s.buf[:5]
	return s.buf[0]*10000 + s.buf[1]*1000 + s.buf[2]*100 + s.buf[3]*10 + s.buf[4]`,
	97000,
	`type rbuf struct {
	buf []int
	n   int
}

func (s *rbuf) next() int {
	s.n++
	return 9
}`,
);

parity(
	"x = x[lo:] copy writes through to the old array",
	`	x := []int{1, 2, 3, 4, 5}
	al := x
	x = x[1:]
	x[0] = 9
	y := []int{1, 2, 3}
	ay := y
	y = y[1:len(y)]
	y[1] = 8
	return al[0]*1000000 + al[1]*100000 + al[2]*10000 + ay[0]*100 + ay[1]*10 + ay[2] + len(x)*10000000 + cap(x)*100000000`,
	441930128,
);

parity(
	"q = q[1:] then q[0] = v writes through to the old array",
	`	q := []int{1, 2, 3}
	all := q
	q = q[1:]
	q[0] = 20
	return all[0]*1000 + all[1]*10 + all[2]`,
	1203,
);

parity(
	"q = q[1:] queue-pop loop writes through to the old array",
	`	q := []int{1, 2, 3, 4, 5}
	all := q
	sum := 0
	for len(q) > 0 {
		v := q[0]
		q = q[1:]
		if len(q) > 0 {
			q[0] += v
		}
		sum = sum*10 + v
	}
	return sum*1000 + all[2]*100 + all[3]*10 + all[4] - all[1]`,
	13715000 + 600 + 100 + 15 - 3,
);

parity(
	"field chain copy writes through in methods and loops",
	`	s := &stk{items: []int{1, 2, 3, 4}}
	b := s.items
	s.pop()
	s.set(1, 6)
	b[1] = 9
	for i := 0; i < 1; s.items[0]++ {
		i++
	}
	b[0] = 3
	s.items = s.items[:4]
	return s.items[0]*100 + s.items[1]*10 + b[0]`,
	393,
	`type stk struct{ items []int }

func (s *stk) pop() { s.items = s.items[:len(s.items)-1] }

func (s *stk) set(i, v int) { s.items[i] = v }`,
);

parity(
	"x = x[:n] on a parameter keeps the caller's store",
	`	a := []int{1, 2, 3, 4}
	dbl(a, 2)
	return a[0]*10 + a[1]`,
	24,
	`func dbl(xs []int, n int) {
	xs = xs[:n]
	for i := range xs {
		xs[i] *= 2
	}
}`,
);

parity(
	"range over a view reads the right elements and writes go to the store",
	`	b := []int{1, 2, 3, 4, 5}
	v := b[1:4]
	sum := 0
	for i, x := range v {
		sum = sum*10 + x
		v[i] = x * 2
	}
	return sum*1000 + b[1]*100 + b[3]*10 + b[4]`,
	234485,
);

test("x = x[:n] within the length copies a plain array in JS (documented)", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []int{1, 2, 3}
	x := b
	x = x[:2]
	x[0] = 9
	println(b[0], len(x), cap(x))
	f := []byte{1, 2, 3}
	g := f
	g = g[:2]
	g[0] = 9
	println(f[0], cap(g))
}`);
	assertEqual(errors.length, 0);
	assert(js.includes("x = __reslice(x, 0, 2)"), "self reslice uses __reslice");
	// The write through the copy reaches the old array (`__rcs`), as in Go.
	assert(js.includes("__rcs(x, 0)"), "index write through a copy is synced");
	assertEqual(runJs(js), "9 2 3\n9 3");
});

test("slice views print their elements", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []int{1, 2, 3, 4}
	println(b[1:3], b[:0], len(b[:0]), cap(b[:0]))
}`);
	assertEqual(errors.length, 0);
	// Node's console shows the elements, not the Proxy's backing fields.
	const out = [];
	const console = {
		log: (...a) =>
			out.push(
				a.map((x) => (typeof x === "string" ? x : inspect(x))).join(" "),
			),
	};
	runJs(js, { console });
	assertEqual(out.join("\n"), "[ 2, 3 ] [] 0 4");
});

test("range over a plain slice unwraps a view once", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []int{1, 2, 3, 4, 5}
	s := 0
	for _, x := range b[1:4] {
		s += x
	}
	for i := range b {
		s += i
	}
	println(s)
}`);
	assertEqual(errors.length, 0);
	assert(js.includes("__v0 = __arr0?.[__sv]"), "range unwraps the view");
	assertEqual((js.match(/\?\.\[__sv\]/g) ?? []).length, 1);
	assertEqual(runJs(js), "19");
});

test("slice view Proxy contract for JS callers", () => {
	const mk = new Function(`${HELPER_SV}\n${HELPER_SLICE}\nreturn __slice;`)();
	const b = [1, 2, 3, 4];
	const v = mk(b, 1, 3);
	let err = null;
	try {
		Object.freeze(v);
	} catch (e) {
		err = e;
	}
	assert(err instanceof TypeError, "freeze throws a TypeError");
	Object.defineProperty(v, "0", { value: 9 });
	assertEqual(b[1], 9);
	assertEqual(Reflect.defineProperty(v, "1", { get: () => 1 }), false);
	assertEqual(Reflect.defineProperty(v, "5", { value: 1 }), false);
	v.push(7);
	assertEqual(v.length, 2);
	const a = Array.from(v);
	assert(Array.isArray(a) && a.length === 2 && a[0] === 9 && a[1] === 3);
	assertEqual(Object.getPrototypeOf(a), Array.prototype);
});

parity(
	"reslicing an x = x[:n] copy keeps writes made through other slices",
	`	a := []int{1, 2, 3, 4}
	b := a
	a = a[:3]
	b[0] = 100
	a = a[:2]
	return b[0]`,
	100,
);

parity(
	"extending an x = x[:n] copy keeps writes made through other slices",
	`	a := []int{1, 2, 3, 4}
	b := a
	a = a[:2]
	b[0] = 100
	a = a[:4]
	return a[0]*1000 + b[0]`,
	100100,
);

parity(
	"extending an x = x[:n] copy keeps writes through both slices",
	`	a := []int{1, 2, 3, 4}
	b := a
	a = a[:2]
	a[1] = 7
	b[0] = 100
	b[3] = 5
	a = a[:4]
	return a[0]*10000 + a[1]*1000 + b[1]*100 + a[3]*10 + len(a)`,
	1007754,
);

parity(
	"append onto an x = x[:n] copy keeps writes through both slices",
	`	a := []int{1, 2, 3, 4}
	b := a
	a = a[:2]
	a[0] = 9
	b[3] = 5
	a = append(a, 8)
	return b[0]*1000 + b[2]*100 + b[3]*10 + len(a)`,
	9853,
);

parity(
	"three-index slice of an x = x[:n] copy limits the capacity",
	`	b := []int{1, 2, 3, 4}
	x := b
	x = x[:2]
	y := x[0:2:2]
	c := cap(y)
	y = append(y, 9)
	return c*10 + b[2]`,
	23,
);

parity(
	"reslicing an x = x[:n] copy again keeps writes to the dropped elements",
	`	a := []int{1, 2, 3, 4}
	b := a
	a = a[:3]
	a[2] = 7
	a = a[:2]
	b[1] = 8
	a = a[:3]
	return a[1]*100 + a[2]*10 + b[2]`,
	877,
);

section("Package-level arrays and named lengths (Task 0.28)");

test("&g on a package-level array aliases it (P21)", () => {
	const res = compileHybrid(`package main

var g [2]int

func Main() int {
	p := &g
	p[0] = 5
	return g[0]
}
`).run("Main");
	assertEqual(res.jsRes, 5);
	assertEqual(Number(res.wasmRes), 5);
});

test("a package-level array starts as its zero array (P22)", () => {
	const res = compileHybrid(`package main

type V [3]int
type S struct{ A, B int }

var g [2]int
var v V
var s [2]S

func Main() int {
	g[1] = 1
	v[2] = 7
	s[1].B = 4
	return g[1] + len(g) + v[2]*10 + s[1].B*100
}
`).run("Main");
	assertEqual(res.jsRes, 473);
	assertEqual(Number(res.wasmRes), 473);
});

test("[N]T with a named constant N has length N (P23)", () => {
	const res = compileHybrid(`package main

var g [N]int

const N = 3

type T struct{ a [N + 1]int }

func Main() int {
	var a [N]int
	a[2] = 4
	var t T
	g[1] = 1
	return len(a) + a[2] + len(g)*10 + len(t.a)*100 + g[1]
}
`).run("Main");
	assertEqual(res.jsRes, 438);
	assertEqual(Number(res.wasmRes), 438);
});
