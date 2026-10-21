// test/unit/wasm/arrays.test.js
// Tests for Task 0.8a: fixed-size arrays are values in WASM (copy on every
// assignment, call, return, store and load), matching the JS backend.

import {
	assert,
	assertEqual,
	compile,
	compileHybrid,
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
