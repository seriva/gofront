// test/unit/wasm/go_semantics.test.js
// Go semantics edge cases that must agree between JS-strict and wasm:
// recover() scoping, defer evaluation, map key identity, generic struct
// literals and nil interface calls.  Every case runs through compileHybrid.

import {
	assertEqual,
	assertProgramOutput,
	assertThrows,
	assertWasmProgramOutput,
	compile,
	compileHybrid,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("Go semantics — recover() scoping");

test("recover() called via a helper returns nil and the panic propagates", () => {
	const src = `
package main

func helper() any { return recover() }

func Run() (s string) {
	defer func() {
		if helper() == nil { s = "nil" } else { s = "recovered" }
	}()
	panic("boom")
}

func Main() string {
	out := "none"
	func() {
		defer func() { r := recover(); out = r.(string) }()
		Run()
	}()
	return out
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "boom");
	assertEqual(jsRes, "boom");
});

test("defer handlePanic() recovers when the named function calls recover directly", () => {
	const src = `
package main

var got string

func handlePanic() {
	if r := recover(); r != nil { got = r.(string) }
}

func handleWithArg(prefix string) {
	if r := recover(); r != nil { got = prefix + r.(string) }
}

func Run() { defer handlePanic(); panic("boom") }
func RunArg() { defer handleWithArg("p:"); panic("bang") }

func Main() string {
	Run()
	a := got
	RunArg()
	return a + "|" + got
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "boom|p:bang");
	assertEqual(jsRes, wasmRes);
});

test("recover() in a closure called by the deferred function does not recover", () => {
	const src = `
package main

func Main() string {
	out := "none"
	func() {
		defer func() { if recover() != nil { out = "outer" } }()
		func() {
			defer func() {
				inner := func() any { return recover() }
				if inner() != nil { out = "inner" }
			}()
			panic("x")
		}()
	}()
	return out
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "outer");
	assertEqual(jsRes, "outer");
});

test("recover() outside any panic returns nil", () => {
	const src = `
package main
func Main() int {
	if recover() == nil { return 1 }
	return 0
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 1n);
	assertEqual(jsRes, 1);
});

test("panic inside a deferred function replaces the in-flight panic", () => {
	const src = `
package main

func Run() (s string) {
	defer func() { s = recover().(string) }()
	defer func() { panic("second") }()
	panic("first")
}

func Main() string { return Run() }
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "second");
	assertEqual(jsRes, "second");
});

section("Go semantics — defer evaluation");

test("deferred pointer-receiver method sees later mutations of a local/field", () => {
	const src = `
package main

type Buf struct { n int }
func (b *Buf) Add(k int) { b.n += k }
type S struct { b Buf }

var out int

func Local() {
	var b Buf
	defer func() { out = b.n }()
	defer b.Add(100)
	b.n = 5
}

func Field() int {
	s := S{}
	defer s.b.Add(100)
	s.b.n = 5
	return 0
}

func Main() int {
	Local()
	s := S{}
	run := func(p *S) { defer p.b.Add(100); p.b.n = 5 }
	run(&s)
	return out*1000 + s.b.n
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 105105n);
	assertEqual(jsRes, 105105);
});

test("deferred value-receiver method and arguments are evaluated at defer time", () => {
	const src = `
package main

type V struct { n int }
func (v V) Get() int { return v.n }

var seen int

func show(x int) { seen = x }

func Main() int {
	v := V{1}
	defer func() { seen = seen*10 + v.Get() }()
	i := 1
	defer show(i)
	i = 2
	v.n = 7
	return 0
}

func Check() int { Main(); return seen }
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Check");
	// show(1) runs first (seen=1), then the closure reads the live v (7).
	assertEqual(wasmRes, 17n);
	assertEqual(jsRes, 17);
});

section("Go semantics — map keys");

test("struct map keys compare field-wise", () => {
	const src = `
package main

type P struct { X, Y int }
type Q struct { Name string; P P }

func Main() int {
	m := map[P]int{}
	m[P{1, 2}] = 10
	m[P{1, 2}] = 20
	m[P{2, 1}] = 5
	q := map[Q]int{}
	q[Q{"a", P{1, 1}}] = 1
	q[Q{"a", P{1, 1}}] += 1
	q[Q{"b", P{1, 1}}] = 7
	_, ok := m[P{9, 9}]
	r := len(m)*1000 + m[P{1, 2}]*10 + len(q)
	if ok { r += 100000 }
	delete(m, P{1, 2})
	return r*10 + len(m)
}
`;
	// WASM-only: the JS backend stringifies struct keys (documented divergence).
	const { wasm, stringTable } = compileHybrid(src);
	assertEqual(runWasm(wasm, { stringTable }).exports.Main(), 22021n);
});

test("NaN keys never match; -0 and +0 are the same key", () => {
	const src = `
package main
import "math"

func Main() int {
	m := map[float64]int{}
	m[math.NaN()] = 1
	m[math.NaN()] = 2
	m[0.0] = 3
	m[math.Copysign(0, -1)] = 4
	_, ok := m[math.NaN()]
	r := len(m)*10 + m[0.0]
	if ok { r += 100 }
	return r
}
`;
	// WASM-only: JS Map treats NaN as a single key (documented divergence).
	const { wasm, stringTable } = compileHybrid(src);
	assertEqual(runWasm(wasm, { stringTable }).exports.Main(), 34n);
});

test("array map keys compare element-wise and match in wasm", () => {
	const src = `
package main

func Main() string {
	m := map[[2]int]string{}
	m[[2]int{1, 2}] = "first"
	m[[2]int{3, 4}] = "second"
	if m[[2]int{1, 2}] != "first" || m[[2]int{3, 4}] != "second" {
		return "fail lookup"
	}
	if len(m) != 2 {
		return "fail len"
	}
	return "ok"
}
`;
	const { wasm, stringTable } = compileHybrid(src);
	assertEqual(runWasm(wasm, { stringTable }).exports.Main(), "ok");
});

test("array map keys with -0 and +0 hash equal and NaN never matches", () => {
	const src = `
package main
import "math"

func Main() int {
	m := map[[2]float64]int{}
	m[[2]float64{0.0, 1.0}] = 1
	m[[2]float64{math.Copysign(0, -1), 1.0}] = 2
	m[[2]float64{math.NaN(), 1.0}] = 10
	m[[2]float64{math.NaN(), 1.0}] = 20
	// 0.0 and -0.0 should overwrite, so 1 key for (0, 1). Two NaNs produce 2 distinct keys. Total = 3.
	return len(m)*10 + m[[2]float64{0.0, 1.0}]
}
`;
	const { wasm, stringTable } = compileHybrid(src);
	assertEqual(runWasm(wasm, { stringTable }).exports.Main(), 32n);
});

test("interface map keys support scalars, strings, and panics on unhashable dynamic types", () => {
	const src = `
package main

func Main() string {
	m := map[any]string{}
	m[1] = "one"
	m[2] = "two"
	m["hello"] = "world"
	if m[1] != "one" || m[2] != "two" || m["hello"] != "world" || len(m) != 3 {
		return "fail lookup"
	}
	return "ok"
}
`;
	const { wasm, stringTable } = compileHybrid(src);
	assertEqual(runWasm(wasm, { stringTable }).exports.Main(), "ok");

	const unhashableSrc = `
package main

func Main() {
	m := map[any]int{}
	m[[]int{1, 2}] = 42
}
`;
	assertThrows(() => {
		const { wasm: uWasm, stringTable: uStr } = compileHybrid(unhashableSrc);
		runWasm(uWasm, { stringTable: uStr }).exports.Main();
	}, "runtime error: hash of unhashable type");
});

test("boxed scalars in any and map[any] differentiate distinct types", () => {
	const src = `
package main

func Main() string {
	var a any = int32(1)
	var b any = true
	if a == b {
		return "fail scalar equality"
	}
	m := map[any]string{}
	m[int32(1)] = "int32"
	m[true] = "bool"
	if m[int32(1)] != "int32" || m[true] != "bool" || len(m) != 2 {
		return "fail map differentiation"
	}
	return "ok"
}
`;
	const { wasm, stringTable } = compileHybrid(src);
	assertEqual(runWasm(wasm, { stringTable }).exports.Main(), "ok");
});

test("map[any] handles comparable structs and panics on unhashable structs", () => {
	const src = `
package main

type Point struct {
	X int
	Y int
}

type WithSlice struct {
	Nums []int
}

func Main() string {
	m := map[any]int{}
	m[Point{1, 2}] = 42
	if m[Point{1, 2}] != 42 {
		return "fail struct lookup"
	}
	// Pointer to unhashable struct is comparable and hashable by pointer address
	ws := &WithSlice{Nums: []int{1, 2}}
	m[ws] = 100
	if m[ws] != 100 {
		return "fail pointer to unhashable lookup"
	}
	return "ok"
}
`;
	const { wasm, stringTable } = compileHybrid(src);
	assertEqual(runWasm(wasm, { stringTable }).exports.Main(), "ok");

	const unhashableStructSrc = `
package main

type WithSlice struct {
	Nums []int
}

func Main() {
	m := map[any]int{}
	m[WithSlice{Nums: []int{1, 2}}] = 42
}
`;
	assertThrows(() => {
		const { wasm: uWasm, stringTable: uStr } =
			compileHybrid(unhashableStructSrc);
		runWasm(uWasm, { stringTable: uStr }).exports.Main();
	}, "runtime error: hash of unhashable type");
});

section("Go semantics — generics and interfaces");

test("generic struct literal inside a generic function", () => {
	const src = `
package main

type Pair[K comparable, V any] struct { Key K; Val V }
func (p Pair[K, V]) Get() V { return p.Val }
func MakePair[K comparable, V any](k K, v V) Pair[K, V] { return Pair[K, V]{Key: k, Val: v} }

func Main() int {
	p := MakePair("x", 7)
	q := Pair[int, int]{Key: 1, Val: 2}
	return p.Get()*10 + q.Get()
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 72n);
	assertEqual(jsRes, 72);
});

test("method call on a nil interface panics with Go's message in both backends", () => {
	const src = `
package main

type Shape interface { Area() int }
type Sq struct { s int }
func (q Sq) Area() int { return q.s * q.s }

func Main() string {
	var sh Shape
	defer func() { _ = recover() }()
	sh.Area()
	return "no panic"
}

func Raw() int {
	var sh Shape
	return sh.Area()
}
`;
	const h = compileHybrid(src);
	// run() swallows errors when both backends throw the same message, so a
	// passing parity run already proves both panic identically. Check the
	// message explicitly against the wasm export too.
	h.run("Raw");
	const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
	assertThrows(
		() => exports.Raw(),
		"runtime error: invalid memory address or nil pointer dereference",
	);
	const { wasmRes } = h.run("Main");
	assertEqual(wasmRes, "");
});

test("a local value symbol is not usable as a type", () => {
	const { errors } = compile(`
package main
func Main() int {
	T := 5
	var x T
	_ = x
	return T
}
`);
	assertEqual(errors.length > 0, true);
	assertEqual(errors[0].message.includes("Unknown type 'T'"), true);
});

section("Go semantics — package constant expressions");

test("constant expressions fold at compile time and match JS", () => {
	const src = `
package main

const Base = 10
const Derived = Base * 2
const Early = 4
const Later = Early + 1
const Len = len("abc") * 2
const Shift = 1 << 4
const Ratio = 7 / 2.0
const Greeting = "hi, " + "there"
const Big = Shift > 8 && Base != 3

func Main() string {
	s := ""
	if Big { s = Greeting }
	return s + string(rune('0'+Derived/10)) + string(rune('0'+Later)) +
		string(rune('0'+Len)) + string(rune('A'+Shift/4)) + string(rune('0'+int(Ratio)))
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, "hi, there256E3");
});

test("folded string constants are not start-function globals", () => {
	const { wat } = compileHybrid(
		`
package main

const N = len("abc") * 2

func Main() int { return N }
`,
		{ emitWat: true },
	);
	assertEqual(wat.includes("(start"), false);
});

test("a constant that cannot be folded becomes a start-initialised global", () => {
	const src = `
package main

import "math"

const Tau = math.Pi * 2
const Half = Tau / 2

func Main() int { return int(Half * 100) }
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, 314);
});

section("Go semantics — fallthrough and multi-value assignment");

test("fallthrough runs every fallen-through body in each switch shape", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func chain() int {
	v := 0
	switch 3 {
	case 3:
		v += 100
		fallthrough
	case 2:
		v += 10
		fallthrough
	case 1:
		v++
	}
	return v
}

func tagless(n int) string {
	out := ""
	switch {
	case n > 0:
		out += "p"
		fallthrough
	case n > 10:
		out += "big?"
		fallthrough
	default:
		out += "."
	}
	return out
}

func middleDefault(x int) string {
	out := ""
	switch x {
	case 1:
		out += "one"
	default:
		out += "def"
		fallthrough
	case 3:
		out += "three"
	}
	return out
}

func nested(s string) (r string) {
outer:
	for i := 0; i < 3; i++ {
		switch t := s + "x"; t {
		case "ax", "bx":
			r += "1"
			switch i {
			case 0:
				r += "z"
				fallthrough
			case 1:
				if i == 1 {
					break outer
				}
				r += "y"
			}
			fallthrough
		case "cx":
			r += "2"
			continue outer
		default:
			r += "d"
		}
		r += "|"
	}
	return
}

func main() {
	fmt.Println(chain())
	fmt.Println(tagless(1), tagless(-1), tagless(11))
	fmt.Println(middleDefault(1), middleDefault(2), middleDefault(3))
	fmt.Println(nested("a"), nested("c"), nested("q"))
}
`,
		`111
pbig?. . pbig?.
one defthree three
1zy21 222 d|d|d|
`,
	);
});

test("multi-value results assign to indexes, fields, derefs, map entries and mixed := targets", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func add(a, b int) (int, int) { return a + b, a - b }

func addc(x, y, c uint32) (uint32, uint32) {
	s := uint64(x) + uint64(y) + uint64(c)
	return uint32(s), uint32(s >> 32)
}

type P struct{ A, B int }

func idx(n int) int { fmt.Println("idx", n); return n }

func main() {
	w := make([]int, 10)
	w[2*3], w[2*3+1] = add(1, 2)
	fmt.Println(w[6], w[7])
	var x, y, c0 uint32 = 0xffffffff, 0, 1
	h, c1 := addc(x, y, 0)
	h, c2 := addc(h, 0, c0)
	fmt.Println(h, c1, c2)
	m := map[string]int{}
	var p P
	pp := &p
	m["a"], pp.B = add(5, 1)
	fmt.Println(m, p)
	q := new(int)
	*q, p.A = add(9, 2)
	fmt.Println(*q, p)
	_, p.B = add(1, 1)
	fmt.Println(p)
	arr := [3]int{}
	arr[idx(1)], arr[idx(2)] = add(8, 3)
	fmt.Println(arr)
	k, e := add(1, 1)
	k, f := add(k, e)
	fmt.Println(k, e, f)
	v := 10
	if true {
		v, z := add(7, 1)
		fmt.Println(v, z)
	}
	fmt.Println(v)
	ps := []P{{1, 2}, {3, 4}}
	ps[0].A, ps[1].B = add(4, 4)
	fmt.Println(ps)
	k, z := add(5, 5)
	fmt.Println(k, z)
}
`,
		`3 -1
0 0 1
map[a:6] {0 4}
11 {7 4}
{7 0}
idx 1
idx 2
[0 11 5]
2 0 2
8 6
10
[{8 2} {3 0}]
10 0
`,
	);
});

section("Go semantics — switch clause scopes");

test("fallthrough clauses and plain clauses each declare their own names", async () => {
	await assertWasmProgramOutput(
		`
package main

import "fmt"

func f(k int) {
	x := 10
	switch k {
	case 1:
		x := 20
		_ = x
		fallthrough
	case 2:
		fmt.Println("x", x)
	}
	fmt.Println("after", x)
}

func g() {
	x := 1
	switch x := x + 1; x {
	case 2:
		x := x * 100
		fmt.Println(x)
		fallthrough
	case 3:
		fmt.Println("three", x)
	}
}

func h(k int) {
	x := 5
	switch k {
	case 1:
		x := 7
		fmt.Println(x)
	case 2:
		fmt.Println("c2", x)
	}
	var fs []func() int
	switch k {
	case 1:
		v := 3
		fs = append(fs, func() int { v++; return v })
		fallthrough
	case 2:
		v := 9
		fs = append(fs, func() int { return v })
	}
	for _, q := range fs {
		fmt.Println(q())
	}
	var i any = k
	switch i.(type) {
	case int:
		y := 1
		fmt.Println("y", y)
	default:
		fmt.Println("default", x)
	}
}

func main() {
	f(1)
	f(2)
	g()
	h(1)
	h(2)
}
`,
		`x 10
after 10
x 10
after 10
200
three 2
7
4
9
y 1
c2 5
9
y 1
`,
	);
});

section("Go semantics — nil pointer inside an interface");

test("a value-receiver call through a nil pointer to a named type is a recoverable panic", async () => {
	await assertWasmProgramOutput(
		`
package main

import "fmt"

type Getter interface{ Get() int }
type PGetter interface{ PGet() int }

type MyInt int

func (m MyInt) Get() int { return int(m) }
func (m *MyInt) PGet() int {
	if m == nil {
		return -1
	}
	return int(*m)
}

type Names []string

func (n Names) Get() int { return len(n) }

type Label string

func (l Label) Get() int { return len(l) }

type Ratio float64

func (r Ratio) Get() int { return int(r) }

func try(name string, f func()) {
	defer func() { fmt.Println(name, "rec:", recover()) }()
	f()
}

func main() {
	try("int", func() {
		var np *MyInt
		var g Getter = np
		var pg PGetter = np
		fmt.Println(g != nil, g == nil, pg.PGet())
		_, ok := g.(*MyInt)
		fmt.Println(ok)
		fmt.Println(g.Get())
	})
	try("slice", func() {
		var np *Names
		var g Getter = np
		fmt.Println(g != nil)
		fmt.Println(g.Get())
	})
	try("string", func() {
		var np *Label
		var g Getter = np
		fmt.Println(g.Get())
	})
	try("float", func() {
		var np *Ratio
		var g Getter = np
		fmt.Println(g.Get())
	})
	v := MyInt(4)
	var g Getter = &v
	var pg PGetter = &v
	fmt.Println(g.Get(), pg.PGet())
}
`,
		`true false -1
true
int rec: runtime error: invalid memory address or nil pointer dereference
true
slice rec: runtime error: invalid memory address or nil pointer dereference
string rec: runtime error: invalid memory address or nil pointer dereference
float rec: runtime error: invalid memory address or nil pointer dereference
4 4
`,
	);
});
