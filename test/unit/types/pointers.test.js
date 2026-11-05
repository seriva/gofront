import {
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	assertWasmProgramOutput,
	compile,
	compileWasm,
	runJs,
	section,
	test,
} from "../helpers.js";

section("Pointers into scalar storage in wasm/both packages");

const MSG =
	"cannot take the address of a field, element or package-level variable of type";

const cases = {
	"&s.X (int field)": `
type S struct{ X int }
func Main() int { s := S{}; p := &s.X; *p = 1; return s.X }`,
	"&xs[i] ([]float64)": `
func Main() int { xs := []float64{1, 2}; p := &xs[1]; *p = 3; return int(xs[1]) }`,
	"&arr[i] ([4]int32)": `
func Main() int { var arr [4]int32; p := &arr[1]; *p = 3; return int(arr[1]) }`,
	"&s.A[1] (array field)": `
type S struct{ A [2]int }
func Main() int { s := S{}; p := &s.A[1]; *p = 3; return s.A[1] }`,
	"&g (package-level int)": `
var g int
func Main() int { p := &g; *p = 5; return g }`,
	"s.Count.Inc() (named scalar field)": `
type C int
func (c *C) Inc() { *c++ }
type S struct{ Count C }
func Main() int { s := S{}; s.Count.Inc(); return int(s.Count) }`,
	"xs[i].Inc() (named scalar element)": `
type C int
func (c *C) Inc() { *c++ }
func Main() int { xs := []C{1, 2}; xs[0].Inc(); return int(xs[0]) }`,
	"g.Inc() (package-level named scalar)": `
type C int
func (c *C) Inc() { *c++ }
var g C
func Main() int { g.Inc(); return int(g) }`,
	"&s.E (error field)": `
import "errors"
type S struct{ E error }
func set(p *error) { *p = errors.New("x") }
func Main() int { s := S{}; set(&s.E); if s.E == nil { return 0 }; return 1 }`,
	"&es[0] ([]error element)": `
import "errors"
func set(p *error) { *p = errors.New("x") }
func Main() int { es := make([]error, 1); set(&es[0]); if es[0] == nil { return 0 }; return 1 }`,
	"&s.Sh (interface field)": `
type Shape interface{ Area() int }
type Sq struct{ N int }
func (q Sq) Area() int { return q.N }
type S struct{ Sh Shape }
func set(p *Shape) { *p = Sq{2} }
func Main() int { s := S{}; set(&s.Sh); return s.Sh.Area() }`,
	"&s.P (pointer field)": `
type S struct{ P *int }
func Main() int { s := S{}; x := 3; pp := &s.P; *pp = &x; return *s.P }`,
	"&s.F (func field)": `
type S struct{ F func() int }
func Main() int { s := S{}; pf := &s.F; *pf = func() int { return 4 }; return s.F() }`,
	"s.M.Reset() (named map field)": `
type M map[string]int
func (m *M) Reset() { *m = M{"z": 9} }
type S struct{ M M }
func Main() int { s := S{}; s.M.Reset(); return s.M["z"] }`,
	"&s.V (simd.F32x4 field)": `
import "gofront/simd"
type S struct{ V simd.F32x4 }
func Main() int { s := S{}; p := &s.V; *p = simd.Splat(2); return int(s.V.Lane(0)) }`,
};

for (const target of ["wasm", "both"]) {
	for (const [name, body] of Object.entries(cases)) {
		test(`${target}: ${name} is rejected`, () => {
			const src = `//gofront:target ${target}\npackage main\n${body}\n`;
			const { errors } = compile(src);
			assertErrorContains(errors, MSG);
			const hint = errors.map((e) => e.message).join("\n");
			if (!hint.includes("parent struct pointer"))
				throw new Error(`missing hint: ${hint}`);
			assertErrorContains(errors, `in a ${target} package`);
			if (!/at line \d+:\d+/.test(hint))
				throw new Error(`missing location: ${hint}`);
		});
	}
}

const FUNC_MSG = "cannot take the address of a variable of func type";

const funcCases = {
	"&g (func local)": `
type F func() int
func Main() int { g := F(func() int { return 1 }); p := &g; *p = func() int { return 5 }; return g() }`,
	"f.Set() (pointer method on a named func local)": `
type F func() int
func (f *F) Set() { *f = func() int { return 5 } }
func Main() int { var f F = func() int { return 1 }; f.Set(); return f() }`,
};

for (const target of ["wasm", "both"]) {
	for (const [name, body] of Object.entries(funcCases)) {
		test(`${target}: ${name} is rejected`, () => {
			const src = `//gofront:target ${target}\npackage main\n${body}\n`;
			const { errors } = compile(src);
			assertErrorContains(errors, FUNC_MSG);
			assertErrorContains(errors, `in a ${target} package`);
		});
	}
}

test("js: writes through a pointer to a func variable reach it", () => {
	const src = `package main
type F func() int
func (f *F) Set() { *f = func() int { return 5 } }
func setF(p *F) { *p = func() int { return 6 } }
func main() {
	g := F(func() int { return 1 })
	pg := &g
	pg.Set()
	var f F = func() int { return 1 }
	f.Set()
	h := F(func() int { return 1 })
	setF(&h)
	println(g(), f(), h())
}`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5 5 6");
});

test("js package still mutates through pointer to scalar field", () => {
	const src = `package main
type S struct{ X int }
func main() { s := S{}; p := &s.X; *p = 7; println(s.X) }`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "7");
});

test("both: struct-typed addresses and locals still compile", () => {
	const src = `//gofront:target both
package main
type Item struct{ V int }
type Inner struct{ N int }
type Outer struct{ In Inner }
type C int
func (c *C) Inc() { *c++ }
type P struct{ A int }
type Grid struct{ Cells [2]int }
func fill(a *[2]int) { a[1] = 3 }
var pkgStruct P
func Main() int {
	g := Grid{}
	fill(&g.Cells)
	items := []Item{{1}, {2}}
	a := &items[1]
	o := Outer{}
	b := &o.In
	c := &pkgStruct
	var x int
	px := &x
	var k C
	k.Inc()
	d := &Item{V: 4}
	*px = 1
	return a.V + b.N + c.A + x + int(k) + d.V + g.Cells[1]
}`;
	const { errors } = compileWasm(src);
	assertEqual(errors.length, 0);
});

section("Map elements are not addressable");

const MAP_MSG = "cannot take the address of a map element";

const mapCases = {
	"&m[k]": `
func main() { m := map[string]int{}; p := &m["a"]; _ = p }`,
	"&m[k].f (struct value)": `
type P struct{ X int }
func main() { m := map[string]P{}; p := &m["a"].X; _ = p }`,
	"&m[k][i] (array value)": `
func main() { m := map[string][2]int{}; p := &(m["a"][0]); _ = p }`,
	"m[k].M() (pointer method on struct value)": `
type P struct{ X int }
func (p *P) Bump() { p.X++ }
func main() { m := map[string]P{}; m["a"].Bump() }`,
	"m[k].M() (pointer method on named scalar)": `
type C int
func (c *C) Inc() { *c++ }
func main() { m := map[string]C{}; m["a"].Inc() }`,
};

for (const target of ["js", "both"]) {
	for (const [name, body] of Object.entries(mapCases)) {
		test(`${target}: ${name} is rejected`, () => {
			const src = `//gofront:target ${target}\npackage main\n${body}\n`;
			const { errors } = compile(src);
			assertErrorContains(errors, MAP_MSG);
			const text = errors.map((e) => e.message).join("\n");
			if (!/at line \d+:\d+/.test(text))
				throw new Error(`missing location: ${text}`);
		});
	}
}

test("js: members promoted through an embedded pointer of a map value compile", () => {
	const src = `package main
type In struct{ X int }
func (p *In) Bump() { p.X++ }
type V struct{ *In }
type Mid struct{ V }
func main() {
	m := map[string]V{"a": {&In{1}}}
	m["a"].Bump()
	mm := map[string]Mid{"a": {V{&In{1}}}}
	mm["a"].Bump()
	mm["a"].Bump()
	println(m["a"].X, mm["a"].X)
}`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2 3");
});

test("js: addresses through map values that are pointers or slices compile", () => {
	const src = `package main
type P struct{ X int }
func (p *P) Bump() { p.X++ }
func main() {
	mp := map[string]*P{"a": {1}}
	ms := map[string][]int{"a": {1, 2}}
	q := &mp["a"].X
	r := &ms["a"][1]
	mp["a"].Bump()
	*q += 5
	*r = 6
	println(mp["a"].X, ms["a"][1])
}`;
	const { js, errors } = compile(src);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "7 6");
});

section("Parenthesised pointer-type and nil conversions");

test("(*S)(&b) converts between pointer types with identical fields in js", () => {
	const { js, errors } = compile(`package main
type Base struct{ n int }
type S Base
func main() {
	b := Base{1}
	p := (*S)(&b)
	println(p.n)
	p.n = 5
	println(b.n)
	q := (*Base)(p)
	println(q.n)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n5\n5");
});

test("(*S)(&b) between distinct struct types is rejected in wasm packages", () => {
	const src = `package main
type Base struct{ n int }
type S Base
func main() {
	b := Base{1}
	p := (*S)(&b)
	println(p.n)
}`;
	for (const target of ["wasm", "both"])
		assertErrorContains(
			compile(src, { target }).errors,
			"pointers to distinct struct types cannot share storage",
		);
});

test("(*S)(&b) still rejects structs with different fields", () => {
	const { errors } = compile(`package main
type Base struct{ n int }
type S struct{ n string }
func main() {
	b := Base{1}
	_ = (*S)(&b)
}`);
	assertErrorContains(errors, "cannot convert *Base to *S");
});

test("(*T)(nil), NS(nil), F(nil), (*int)(nil) and M(nil) run on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ n int }
type NS []int
type F func()
type M map[string]int
type P *int

func main() {
	var t *T = (*T)(nil)
	a := NS(nil)
	b := F(nil)
	c := (*int)(nil)
	d := M(nil)
	e := P(nil)
	fmt.Println(t == nil, a == nil, b == nil, c == nil, d == nil, e == nil)
	fmt.Println(len(a), len(d))
}
`,
		"true true true true true true\n0 0\n",
	);
});

test("var x I = (*T)(nil) compiles on every target and is non-nil in wasm", async () => {
	const src = `package main

import "fmt"

type I interface{ M() bool }
type T struct{}

func (*T) M() bool { return true }

func main() {
	var x I = (*T)(nil)
	fmt.Println(x != nil)
}
`;
	assertEqual(compile(src).errors.length, 0);
	await assertWasmProgramOutput(src, "true\n");
});

test("int(nil) and string(nil) stay conversion errors", () => {
	assertErrorContains(
		compile("package main\nfunc main() { _ = int(nil) }").errors,
		"cannot convert nil",
	);
	assertErrorContains(
		compile("package main\nfunc main() { _ = (*int)(1) }").errors,
		"cannot convert",
	);
});
