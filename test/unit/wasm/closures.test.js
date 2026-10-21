// test/unit/wasm/closures.test.js
// Tests for Phase 4d: Closures, Function Values, and Trampolines in WASM.

import {
	assert,
	assertEqual,
	compileHybrid,
	compileWasm,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Closures — Basic Function Literals");

test("Anonymous function literal without captures", () => {
	const src = `
package main

func Main() int {
	f := func(x int, y int) int {
		return x + y
	}
	return f(20, 22)
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 42n);
	assertEqual(res.jsRes, 42);
});

test("Immediately invoked function literal", () => {
	const src = `
package main

func Main() int {
	return func(a int) int {
		return a * 3
	}(14)
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 42n);
	assertEqual(res.jsRes, 42);
});

section("WASM Closures — Read-Only Captures");

test("Closure capturing read-only variables", () => {
	const src = `
package main

func Main() int {
	multiplier := 10
	offset := 5
	f := func(x int) int {
		return x*multiplier + offset
	}
	return f(3)
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 35n);
	assertEqual(res.jsRes, 35);
});

test("Closure capturing multiple types (int, string, bool)", () => {
	const src = `
package main

func Main() string {
	prefix := "Result: "
	count := 42
	flag := true

	f := func() string {
		if flag && count > 0 {
			return prefix + "active"
		}
		return prefix + "inactive"
	}
	return f()
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, "Result: active");
	assertEqual(res.jsRes, "Result: active");
});

section("WASM Closures — Mutated Captures & Shared State");

test("Closure mutating captured variable (Counter)", () => {
	const src = `
package main

func Main() int {
	count := 0
	inc := func() int {
		count++
		return count
	}

	a := inc()
	b := inc()
	c := inc()
	return a*100 + b*10 + c
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 123n);
	assertEqual(res.jsRes, 123);
});

test("Outer function mutates variable after closure creation", () => {
	const src = `
package main

func Main() int {
	x := 10
	read := func() int {
		return x
	}
	x = 50
	return read()
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 50n);
	assertEqual(res.jsRes, 50);
});

test("Multiple closures sharing the same mutated variable", () => {
	const src = `
package main

func Main() int {
	val := 100
	add := func(delta int) {
		val += delta
	}
	sub := func(delta int) {
		val -= delta
	}
	get := func() int {
		return val
	}

	add(50)
	sub(20)
	add(10)
	return get()
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 140n);
	assertEqual(res.jsRes, 140);
});

section("WASM Closures — Higher-Order Functions");

test("Function returning a closure (Adder generator)", () => {
	const src = `
package main

func MakeAdder(base int) func(int) int {
	return func(x int) int {
		return base + x
	}
}

func Main() int {
	add10 := MakeAdder(10)
	add25 := MakeAdder(25)

	return add10(5) + add25(5)
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 45n);
	assertEqual(res.jsRes, 45);
});

test("Independent closure instances maintain distinct heap state", () => {
	const src = `
package main

func MakeCounter(start int) func() int {
	c := start
	return func() int {
		c++
		return c
	}
}

func Main() int {
	c1 := MakeCounter(10)
	c2 := MakeCounter(100)

	v1 := c1() // 11
	v2 := c1() // 12
	v3 := c2() // 101
	v4 := c1() // 13

	return v1 + v2 + v3 + v4
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 137n);
	assertEqual(res.jsRes, 137);
});

test("Passing closures as arguments (Callbacks)", () => {
	const src = `
package main

func Apply(val int, f func(int) int) int {
	return f(val)
}

func Main() int {
	double := func(x int) int {
		return x * 2
	}
	triple := func(x int) int {
		return x * 3
	}
	return Apply(5, double) + Apply(5, triple)
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 25n);
	assertEqual(res.jsRes, 25);
});

test("Higher-order filter function on slices", () => {
	const src = `
package main

func Filter(s []int, pred func(int) bool) []int {
	res := make([]int, 0)
	for _, v := range s {
		if pred(v) {
			res = append(res, v)
		}
	}
	return res
}

func Main() int {
	nums := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	evens := Filter(nums, func(x int) bool {
		return x%2 == 0
	})

	sum := 0
	for _, v := range evens {
		sum += v
	}
	return sum
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 30n);
	assertEqual(res.jsRes, 30);
});

section("WASM Closures — Named Functions as Values");

test("Top-level named function passed as function value", () => {
	const src = `
package main

func Add(a, b int) int {
	return a + b
}

func Multiply(a, b int) int {
	return a * b
}

func Compute(a, b int, op func(int, int) int) int {
	return op(a, b)
}

func Main() int {
	res1 := Compute(6, 7, Add)
	res2 := Compute(6, 7, Multiply)
	return res1 + res2
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 55n);
	assertEqual(res.jsRes, 55);
});

test("Top-level named function assigned to local variable", () => {
	const src = `
package main

func Cube(x int) int {
	return x * x * x
}

func Main() int {
	f := Cube
	return f(4)
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 64n);
	assertEqual(res.jsRes, 64);
});

section("WASM Closures — Multi-Value Returns");

test("Closure returning multiple values", () => {
	const src = `
package main

func Main() int {
	divMod := func(n, d int) (int, int) {
		return n / d, n % d
	}

	q, r := divMod(17, 5)
	return q*10 + r
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 32n);
	assertEqual(res.jsRes, 32);
});

section("WASM Closures — Any Interface & Type Assertions");

test("Closure boxed into any and type asserted back", () => {
	const src = `
package main

func Main() int {
	var a any = func(x int) int {
		return x * 11
	}

	f, ok := a.(func(int) int)
	if !ok {
		return -1
	}
	return f(4)
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 44n);
	assertEqual(res.jsRes, 44);
});

section("WASM Closures — Closures Inside Methods");

test("Closure in a method captures receiver and mutated local", () => {
	const src = `
package main

type Counter struct{ n int32 }

func (c *Counter) Run() int32 {
	step := int32(2)
	add := func() { c.n += step; step++ }
	add()
	add()
	return c.n + step
}

func Main() int32 {
	c := &Counter{}
	return c.Run()
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.wasmRes, 9);
	assertEqual(res.jsRes, 9);
});

section("WASM Closures — Nil Closure Trapping");

test("Calling nil function pointer traps with runtime panic", () => {
	const src = `
package main

func Main() int {
	var f func() int
	return f()
}
`;
	let threwWasm = false;
	try {
		const { wasm, stringTable } = compileWasm(src);
		const { exports } = runWasm(wasm, { stringTable });
		exports.Main();
	} catch (err) {
		threwWasm = true;
		assertEqual(
			err.message.includes("nil pointer dereference") ||
				err.message.includes("null"),
			true,
		);
	}
	assertEqual(threwWasm, true);
});

section("WASM Closures — Per-iteration loop variables (Go 1.22)");

test("closures in a three-clause for capture a distinct i per iteration", () => {
	const src = `
package main

func Main() int {
	var fs []func() int
	for i := 0; i < 3; i++ {
		fs = append(fs, func() int { return i })
	}
	return fs[0]()*100 + fs[1]()*10 + fs[2]()
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 12);
});

test("a closure writing i affects its own iteration and the post statement sees it", () => {
	const src = `
package main

func Main() int {
	s := 0
	for i := 0; i < 10; i++ {
		inc := func() { i += 2 }
		inc()
		s = s*10 + i
	}
	return s
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 2591);
});

test("a later write through one iteration's closure leaves the others alone", () => {
	const src = `
package main

func Main() int {
	var gets []func() int
	var sets []func()
	for i := 0; i < 3; i++ {
		gets = append(gets, func() int { return i })
		sets = append(sets, func() { i = 100 })
	}
	sets[0]()
	return gets[0]()*100 + gets[1]()*10 + gets[2]()
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 10012);
});

test("continue still gets a fresh per-iteration variable", () => {
	const src = `
package main

func Main() int {
	var fs []func() int
	for i := 0; i < 4; i++ {
		if i%2 == 1 {
			continue
		}
		fs = append(fs, func() int { return i })
	}
	return fs[0]()*10 + fs[1]()
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 2);
});

test("an uncaptured loop variable stays a plain local (no struct.new in the loop)", () => {
	const src = `
package main

func Main() int {
	s := 0
	for i := 0; i < 10; i++ {
		s += i
	}
	return s
}
`;
	const res = compileHybrid(src, { emitWat: true });
	assertEqual(res.run("Main").jsRes, 45);
	const start = res.wat.indexOf('(export "Main")');
	const main = res.wat.slice(start, res.wat.indexOf("\n  (func", start));
	assert(
		!main.includes("struct.new"),
		`unexpected struct.new in Main:\n${main}`,
	);
});

test("a hot uncaptured loop does not allocate when another loop captures the same name", () => {
	const src = `
package main

func Main() int {
	s := 0
	for i := 0; i < 1000; i++ {
		s += i * 2
	}
	f := func() int { return 0 }
	for i := 0; i < 2; i++ {
		f = func() int { return i }
	}
	return s + f()
}
`;
	const res = compileHybrid(src, { emitWat: true });
	assertEqual(res.run("Main").jsRes, 999001);
	const start = res.wat.indexOf('(export "Main")');
	const main = res.wat.slice(start, res.wat.indexOf("\n  (func", start));
	const at = main.indexOf("loop");
	const firstLoop = main.slice(at, main.indexOf("br 0", at));
	assert(
		!firstLoop.includes("struct.new"),
		`first loop allocates:\n${firstLoop}`,
	);
});

test("captured struct and array loop variables get a per-iteration copy", () => {
	const src = `
package main

type Pt struct{ X int }

func Main() int {
	var fs []func() int
	for p := (Pt{0}); p.X < 3; p.X++ {
		fs = append(fs, func() int { return p.X })
	}
	var gs []func() int
	for a := [1]int{0}; a[0] < 3; a[0]++ {
		gs = append(gs, func() int { return a[0] })
	}
	return (fs[0]()*100+fs[1]()*10+fs[2]())*1000 + gs[0]()*100 + gs[1]()*10 + gs[2]()
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 12012);
});

section("Per-iteration loop variables — address-of (Go 1.22)");

test("&i in a three-clause for points at a distinct i per iteration", () => {
	const src = `
package main

func Main() int {
	var ps []*int
	for i := 0; i < 3; i++ {
		ps = append(ps, &i)
	}
	return *ps[0]*100 + *ps[1]*10 + *ps[2]
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 12);
});

test("a write through &i is seen by the post statement", () => {
	const src = `
package main

func Main() int {
	s := 0
	for i := 0; i < 10; i++ {
		p := &i
		*p += 2
		s = s*10 + i
	}
	return s
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 2591);
});

test("&p of a struct loop variable points at a distinct struct per iteration", () => {
	const src = `
package main

type P struct{ X int }

func Main() int {
	var ps []*P
	for p := (P{0}); p.X < 3; p.X++ {
		ps = append(ps, &p)
	}
	return ps[0].X*100 + ps[1].X*10 + ps[2].X
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 12);
});

test("&p.X of a struct loop variable points into that iteration's struct", () => {
	const src = `
package main

type P struct{ X int }

func Main() int {
	var ps []*int
	for p := (P{0}); p.X < 3; p.X++ {
		ps = append(ps, &p.X)
	}
	return *ps[0]*100 + *ps[1]*10 + *ps[2]
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 12);
});
