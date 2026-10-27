import {
	assertEqual,
	assertErrorContains,
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
