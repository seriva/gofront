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
	"cannot take the address of a scalar field, element or package-level variable in a wasm package";

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
};

for (const target of ["wasm", "both"]) {
	for (const [name, body] of Object.entries(cases)) {
		test(`${target}: ${name} is rejected`, () => {
			const src = `//gofront:target ${target}\npackage main\n${body}\n`;
			const { errors } = compileWasm(src);
			assertErrorContains(errors, MSG);
			const hint = errors.map((e) => e.message).join("\n");
			if (!hint.includes("parent struct pointer"))
				throw new Error(`missing hint: ${hint}`);
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
var pkgStruct P
func Main() int {
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
	return a.V + b.N + c.A + x + int(k) + d.V
}`;
	const { errors } = compileWasm(src);
	assertEqual(errors.length, 0);
});
