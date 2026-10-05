// test/unit/wasm/closures.test.js
// Tests for Phase 4d: Closures, Function Values, and Trampolines in WASM.

import {
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
