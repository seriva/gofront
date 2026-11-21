// test/unit/wasm/structs.test.js
// Tests for Phase 4a: Structs, Pointers, and Methods in WASM.

import { goTypeKey } from "../../../src/backend/wasm/types.js";
import {
	assert,
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	assertProgramOutput,
	assertWasmProgramOutput,
	compile,
	compileHybrid,
	compileWasm,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Structs — mathx.Vec3 Operations & Methods");

test("mathx.Vec3 vector math, methods, and chaining parity", () => {
	const src = `
package main

import "math"

type Vec3 struct {
	X float32
	Y float32
	Z float32
}

func NewVec3(x, y, z float32) *Vec3 {
	return &Vec3{X: x, Y: y, Z: z}
}

func (out *Vec3) Set(x, y, z float32) *Vec3 {
	out.X = x
	out.Y = y
	out.Z = z
	return out
}

func (out *Vec3) Add(a, b *Vec3) *Vec3 {
	out.X = a.X + b.X
	out.Y = a.Y + b.Y
	out.Z = a.Z + b.Z
	return out
}

func (out *Vec3) Scale(s float32) *Vec3 {
	out.X = out.X * s
	out.Y = out.Y * s
	out.Z = out.Z * s
	return out
}

func (out *Vec3) Dot(b *Vec3) float32 {
	return out.X*b.X + out.Y*b.Y + out.Z*b.Z
}

func (out *Vec3) Length() float32 {
	return float32(math.Sqrt(float64(out.X*out.X + out.Y*out.Y + out.Z*out.Z)))
}

func Main() float32 {
	v1 := NewVec3(1.0, 2.0, 3.0)
	v2 := NewVec3(4.0, 5.0, 6.0)
	var v3 Vec3
	v3.Add(v1, v2) // (5, 7, 9)
	v3.Scale(2.0)  // (10, 14, 18) -> sum = 42

	dot := v1.Dot(v2) // 1*4 + 2*5 + 3*6 = 32
	l := NewVec3(3.0, 4.0, 0.0).Length() // 5.0

	// Test chaining
	var v4 Vec3
	v4.Set(1.0, 1.0, 1.0).Scale(10.0) // (10, 10, 10) -> sum = 30

	return (v3.X + v3.Y + v3.Z) + dot + l + (v4.X + v4.Y + v4.Z) // 42 + 32 + 5 + 30 = 109
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 109);
	assertEqual(res.jsRes, 109);
});

section("WASM Structs — Pointer vs Value Semantics");

test("Struct assignment clones values, preserving immutability of source", () => {
	const src = `
package main

type Point struct {
	X int
	Y int
}

func Main() int {
	p1 := Point{X: 10, Y: 20}
	p2 := p1
	p2.X = 999
	p2.Y = 888

	// p1 must not have been mutated
	return p1.X + p1.Y
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 30n);
	assertEqual(res.jsRes, 30);
});

test("Pass-by-value vs pass-by-pointer in functions", () => {
	const src = `
package main

type Point struct {
	X int
	Y int
}

func MutateByVal(p Point) {
	p.X = 100
}

func MutateByPtr(p *Point) {
	p.X = 200
}

func Main() int {
	val := Point{X: 10, Y: 20}
	MutateByVal(val)
	afterVal := val.X // 10

	ptr := &Point{X: 10, Y: 20}
	MutateByPtr(ptr)
	afterPtr := ptr.X // 200

	return afterVal + afterPtr
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 210n);
	assertEqual(res.jsRes, 210);
});

test("Dereferencing struct pointer creates a clone value", () => {
	const src = `
package main

type Point struct {
	X int
	Y int
}

func Main() int {
	ptr := &Point{X: 10, Y: 20}
	val := *ptr
	val.X = 500

	return ptr.X + val.X // 10 + 500 = 510
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 510n);
	assertEqual(res.jsRes, 510);
});

section("WASM Structs — Rec Groups & Recursive Structs");

test("Recursive linked list struct with traversal loop and nil checks", () => {
	const src = `
package main

type Node struct {
	Val  int
	Next *Node
}

func Main() int {
	n3 := &Node{Val: 30, Next: nil}
	n2 := &Node{Val: 20, Next: n3}
	n1 := &Node{Val: 10, Next: n2}

	sum := 0
	curr := n1
	for curr != nil {
		sum = sum + curr.Val
		curr = curr.Next
	}
	return sum
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 60n);
	assertEqual(res.jsRes, 60);
});

test("Mutually recursive structs in rec group", () => {
	const src = `
package main

type Parent struct {
	Id    int
	Child *Child
}

type Child struct {
	Id     int
	Parent *Parent
}

func Main() int {
	p := &Parent{Id: 1, Child: nil}
	c := &Child{Id: 2, Parent: p}
	p.Child = c

	return p.Id + p.Child.Id + c.Parent.Id
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 4n);
	assertEqual(res.jsRes, 4);
});

section("WASM Structs — Embedded Structs & Method Promotion");

test("Embedded struct fields and promoted method calls", () => {
	const src = `
package main

type Base struct {
	Val int
}

func (b *Base) GetVal() int {
	return b.Val
}

type Derived struct {
	Base
	Extra int
}

func Main() int {
	d := &Derived{Base: Base{Val: 42}, Extra: 10}
	mVal := d.GetVal() // promoted method: 42
	fVal := d.Val      // promoted field: 42
	eVal := d.Extra    // direct field: 10

	d.Val = 100 // mutate promoted field
	afterMut := d.GetVal() // 100

	return mVal + fVal + eVal + afterMut // 42 + 42 + 10 + 100 = 194
}
`;

	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 194n);
	assertEqual(res.jsRes, 194);
});

section("WASM Structs — Nil Pointer Trapping");

test("Dereferencing nil struct pointer traps with runtime panic", () => {
	const src = `
package main

type Node struct {
	Val int
}

func Main() int {
	var n *Node
	return n.Val
}
`;

	const { wasm, stringTable } = compileWasm(src);
	let threw = false;
	try {
		const { exports } = runWasm(wasm, { stringTable });
		exports.Main();
	} catch (e) {
		threw = true;
		assertEqual(
			e.message,
			"runtime error: invalid memory address or nil pointer dereference",
		);
	}
	assertEqual(threw, true);
});

test("Nil method receiver that is never dereferenced succeeds in WASM", () => {
	const src = `
package main

type Helper struct {
	dummy int
}

func (h *Helper) Answer() int64 {
	return 42
}

func Main() int64 {
	var h *Helper
	return h.Answer()
}
`;
	const { wasm, stringTable } = compileWasm(src);
	const { exports } = runWasm(wasm, { stringTable });
	assertEqual(exports.Main(), 42n);
});

section("WASM Structs — package-level zero values");

test("package-level struct var zero-inits nested struct, any and string fields", () => {
	const src = `
package main

type Vec3 struct {
	X, Y, Z float64
}

type Result struct {
	Point  Vec3
	Hit    bool
	Shape  any
	Label  string
	Next   *Result
	Normal Vec3
}

var scratch Result

func Main() int {
	scratch.Point.X = 2
	scratch.Normal.Y = 3
	n := 0
	if scratch.Shape == nil && scratch.Next == nil && len(scratch.Label) == 0 {
		n = 1
	}
	return n + int(scratch.Point.X) + int(scratch.Normal.Y)
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 6n);
	assertEqual(res.jsRes, 6);
});

test("a variable or field of an anonymous struct type starts as a zero struct", () => {
	const src = `
package main

type T struct {
	Name  string
	Inner struct{ N int }
}

func Main() int {
	var anon struct{ X, Y int }
	var t T
	anon.X = 3
	t.Inner.N += 4
	return anon.X + anon.Y + t.Inner.N + len(t.Name)
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.wasmRes, 7n);
	assertEqual(res.jsRes, 7);
});

section("WASM Globals — initialisation order and zero values");

test("package variables and constants initialise in dependency order", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func compute() int { return 2 }

var x1 = y1 + 1
var y1 = compute()

const (
	A = B + 1
	B = C * 2
	C = 3
)

var z1 = A + 1

type P struct{ A, B int }

var big [100]P

type Q struct{ X [3]int }

var q Q

type T struct{ n int }

func (t T) Get() int  { return t.n + base }
func (t *T) Ptr() int { return t.n*2 + base }

var (
	a    = T{1}.Get()
	b    = (&T{2}).Ptr()
	c    = func() int { return d + 1 }()
	d    = helper()
	e    = sum(f, g)
	f    = 10
	g    = h * 2
	h    = 4
	base = 100
	m    = map[string]int{"k": base}
	s    = []int{base, h}
)

func sum(x, y int) int { return x + y }
func helper() int      { return h + g }

func main() {
	fmt.Println(x1, y1, z1, big[99].B, q.X[1])
	fmt.Println(a, b, c, d, e, f, g, h, base, m, s)
}
`,
		`3 2 8 0 0
101 104 13 12 18 10 8 4 100 map[k:100] [100 4]
`,
	);
});

test("multi-value initialisers, blank variables and large zero arrays", async () => {
	await assertWasmProgramOutput(
		`package main

import "fmt"

var q, r = pair()
var u, v = v2, 3
var v2 = 7
var rows [200]struct{ N int }
var order []string

func pair() (int, int) { return base + 1, 2 }

var base = 10
var _ = trace("blank")

func trace(s string) int { order = append(order, s); return 0 }

func init() { order = append(order, "init") }

func main() {
	fmt.Println(q, r, u, v, v2, rows[199].N, order)
}
`,
		`11 2 7 3 7 0 [blank init]
`,
	);
});

test("an initialisation cycle through variables, functions or methods is an error", () => {
	const cases = [
		["var a = a + 1", "initialization cycle: a refers to itself"],
		[
			"var a = f()\nvar b = a + 1\nfunc f() int { return b }",
			"initialization cycle for a",
		],
		[
			"type T struct{}\nfunc (T) M() int { return a }\nvar a = T{}.M()",
			"initialization cycle for a",
		],
		[
			"var a = func() int { return b }()\nvar b = a",
			"initialization cycle for a",
		],
	];
	for (const [decls, msg] of cases) {
		for (const target of ["js", "wasm"]) {
			const { errors } = compile(
				`//gofront:target ${target}\npackage main\n\n${decls}\n\nfunc main() { println(1) }\n`,
			);
			assertErrorContains(errors, msg);
		}
	}
});

test("a local shadow of a package variable is not an initialisation cycle", () => {
	const { errors } = compile(
		`package main

var a = g()

func g() int { a := 5; return a }

func main() { println(a) }
`,
	);
	assertEqual(errors.length, 0);
});

section("WASM Structs — complex fields and string zero values");

test("a complex128 field of an exported struct is assignable", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type S struct{ C complex128 }

func main() {
	var s S
	s.C = complex(1, 1)
	fmt.Println(s.C, s)
}
`,
		"(1+1i) {(1+1i)}\n",
	);
});

test("string arrays and slices start as empty strings", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type T struct {
	S string
	A [2]string
}

func main() {
	var a [2]string
	b := make([]string, 2)
	c := make([]string, 1, 4)
	c = c[:3]
	var t T
	e := new([3]string)
	g := make([][2]string, 2)
	var arr [2][2]string
	fmt.Println(a, b, c, t, *e, g, arr)
	fmt.Println(a[0] == "", b[1] == "", len(c[2]), c[2]+"!", t.A[1] == "", e[2] == "", g[1][0] == "")
	fmt.Printf("%q %q\\n", a, b)
}
`,
		'[ ] [ ] [  ] { [ ]} [  ] [[ ] [ ]] [[ ] [ ]]\ntrue true 0 ! true true true\n["" ""] ["" ""]\n',
	);
});

test("anonymous struct with an embedded struct keeps the embedded field", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ N int }

func main() {
	v := struct {
		P
		M int
	}{P: P{5}, M: 6}
	fmt.Println(v.N, v.P.N, v.M)
	w := struct {
		P
		M int
	}{P{5}, 6}
	fmt.Println(w.N, w.P.N, w.M)
}
`,
		"5 5 6\n5 5 6\n",
	);
});

test("anonymous struct with an embedded struct and a pointer field", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ N int }

func main() {
	y := struct {
		P
		M *P
	}{P{1}, &P{2}}
	y.N = 5
	fmt.Println(y.N, y.M.N)
}
`,
		"5 2\n",
	);
});

test("slice of anonymous structs with an embedded struct", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ N int }

func main() {
	xs := []struct {
		P
		M int
	}{{P{1}, 2}}
	fmt.Println(xs[0].N, xs[0].M)
}
`,
		"1 2\n",
	);
});

test("anonymous struct embedding a pointer promotes through it", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type P struct{ N int }

func main() {
	v := struct{ *P }{&P{5}}
	fmt.Println(v.N)
	v.N = 6
	fmt.Println(v.P.N)
}
`,
		"5\n6\n",
	);
});

test("anonymous struct embedding a generic instance", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Inner[A any] struct{ Y A }

type S[A any] struct {
	Inner[A]
	X A
}

type W[B any] S[B]

func main() {
	v := struct {
		Inner[int]
		X int
	}{Inner: Inner[int]{Y: 11}, X: 22}
	fmt.Println(v.Y, v.X, v.Inner.Y)
	w := W[int]{Inner: Inner[int]{Y: 11}, X: 22}
	fmt.Println(w.Y, w.X, w.Inner.Y)
}
`,
		"11 22 11\n11 22 11\n",
	);
});

test("conversion between a named and an anonymous embedding struct", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type E struct{ V int }
type A struct{ E }

func main() {
	a := A{E{11}}
	u := struct{ E }(a)
	b := A(u)
	fmt.Println(u.V, b.V)
}
`,
		"11 11\n",
	);
});

test("appending a named struct to a slice of anonymous structs", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type A struct{ X int }

func main() {
	var s []struct{ X int }
	s = append(s, A{5})
	fmt.Println(len(s), s[0].X)
}
`,
		"1 5\n",
	);
});

test("struct field names with underscores stay distinct from shorter names", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type A struct{ X int }

func main() {
	var u struct{ X int } = A{5}
	fmt.Println(u.X)
	a := struct{ A_int int }{1}
	b := struct{ A int }{2}
	fmt.Println(a.A_int, b.A)
}
`,
		"5\n1 2\n",
	);
});

test("embedded alias of an anonymous struct promotes its fields", async () => {
	await assertWasmProgramOutput(
		`package main

import "fmt"

type A = struct{ N int }

func main() {
	v := struct{ A }{A{5}}
	fmt.Println(v.N, v.A.N)
}
`,
		"5 5\n",
	);
});

test("named struct embedding an alias of an anonymous struct promotes its fields", async () => {
	await assertWasmProgramOutput(
		`package main

import "fmt"

type A = struct{ N int }
type S struct{ A }

func main() {
	v := S{A{5}}
	fmt.Println(v.N, v.A.N)
}
`,
		"5 5\n",
	);
});

section("WASM type keys");

test("goTypeKey gives distinct identifier-safe keys to distinct types", () => {
	const int = { kind: "basic", name: "int" };
	const str = { kind: "basic", name: "string" };
	const P = { kind: "named", name: "P" };
	const st = (...fields) => ({
		kind: "struct",
		_structFields: fields.map((f) => ({
			names: f.embedded ? [] : [f.name],
			type: f.type,
			embedded: f.embedded,
		})),
	});
	const fn = (params, returns, variadic = false) => ({
		kind: "func",
		params,
		returns,
		variadic,
	});
	const iface = (...methods) => ({
		kind: "interface",
		methods: new Map(methods.map(([n, sig]) => [n, sig])),
	});
	const types = {
		aInt: st({ name: "A_int", type: int }),
		a: st({ name: "A", type: int }),
		aInt2: st({ name: "A", type: { kind: "named", name: "int_x" } }),
		embedP: st({ embedded: true, name: "P", type: P }),
		namedP: st({ name: "P", type: P }),
		nested: st({ name: "S", type: st({ name: "A", type: int }) }),
		twoFields: st({ name: "A", type: int }, { name: "B", type: int }),
		fnInt: fn([int], [int]),
		fnStr: fn([str], [int]),
		fnRetStr: fn([int], [str]),
		fnVar: fn([{ kind: "slice", elem: int }], [int], true),
		fnPlain: fn([{ kind: "slice", elem: int }], [int]),
		ifaceM: iface(["M", fn([], [int])]),
		ifaceK: iface(["K", fn([], [int])]),
		ifaceMStr: iface(["M", fn([], [str])]),
		sliceWord: { kind: "named", name: "sl" },
		sliceInt: { kind: "slice", elem: { kind: "named", name: "int" } },
		qualified: { kind: "named", name: "time.Duration" },
		underscore: { kind: "named", name: "time_Duration" },
	};
	const seen = new Map();
	for (const [name, t] of Object.entries(types)) {
		const key = goTypeKey(t);
		assert(
			/^[A-Za-z0-9_$]+$/.test(key),
			`${name} key ${key} is not an identifier`,
		);
		assert(!seen.has(key), `${name} and ${seen.get(key)} share the key ${key}`);
		seen.set(key, name);
	}
	// Identical types written twice share one key, tags and field order aside.
	assertEqual(goTypeKey(st({ name: "A", type: int })), goTypeKey(types.a));
	assertEqual(goTypeKey(iface()), "any");
	assertEqual(
		goTypeKey(iface(["M", fn([], [int])], ["K", fn([], [int])])),
		goTypeKey(iface(["K", fn([], [int])], ["M", fn([], [int])])),
	);
});

test("anonymous structs differing only in underscores keep distinct layouts", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type int_x int

func main() {
	a := struct{ A_int int }{1}
	b := struct{ A int_x }{2}
	c := struct{ A int }{3}
	m := map[struct{ A_int int }]int{a: 4}
	fmt.Println(a.A_int, b.A, c.A, m[a])
}
`,
		"1 2 3 4\n",
	);
});
