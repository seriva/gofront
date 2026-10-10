// test/unit/wasm/go_semantics.test.js
// Go semantics edge cases that must agree between JS-strict and wasm:
// recover() scoping, defer evaluation, map key identity, generic struct
// literals and nil interface calls.  Every case runs through compileHybrid.

import {
	assertEqual,
	assertThrows,
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

test("array and interface map keys report a planned limitation", () => {
	assertThrows(
		() =>
			compileHybrid(`
package main
func Main() int { m := map[[2]int]int{}; m[[2]int{1, 2}] = 1; return len(m) }
`).run("Main"),
		"planned",
	);
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
