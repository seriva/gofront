// test/unit/wasm/defer_recover.test.js
// Tests for Task H4.4: Defer & Recover in WASM backend and JS-strict parity.

import { assertEqual, compileHybrid, section, test } from "../helpers.js";

section("WASM Defer — LIFO Execution Order");

test("Multiple defers execute in LIFO order", () => {
	const src = `
package main

var order []int

func record(x int) {
	order = append(order, x)
}

func Run() {
	order = nil
	defer record(1)
	defer record(2)
	defer record(3)
	record(0)
}

func Main() int {
	Run()
	return order[0]*1000 + order[1]*100 + order[2]*10 + order[3]
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 321n);
	assertEqual(res.jsRes, 321);
});

test("Defers execute on early return", () => {
	const src = `
package main

var logStr string

func Run(early bool) string {
	logStr = ""
	defer func() {
		logStr = logStr + "D1;"
	}()
	if early {
		return logStr + "Early;"
	}
	defer func() {
		logStr = logStr + "D2;"
	}()
	return logStr + "Normal;"
}

func Main() string {
	r1 := Run(true)
	s1 := logStr
	r2 := Run(false)
	s2 := logStr
	return r1 + "|" + s1 + "|" + r2 + "|" + s2
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	// When early=true:
	// return logStr + "Early;" evaluates to "Early;" before D1 runs.
	// Then D1 runs: logStr becomes "D1;".
	// When early=false:
	// returns "Normal;" before D2 and D1 run.
	// D2 runs (logStr = "D2;"), then D1 runs (logStr = "D2;D1;").
	assertEqual(res.wasmRes, "Early;|D1;|Normal;|D2;D1;");
	assertEqual(res.jsRes, "Early;|D1;|Normal;|D2;D1;");
});

test("Defers inside loops execute in reverse order", () => {
	const src = `
package main

var out string

func appendStr(s string) {
	out = out + s
}

func Run() string {
	out = ""
	for i := 0; i < 3; i++ {
		v := i
		defer func() {
			if v == 0 {
				out = out + "0"
			} else if v == 1 {
				out = out + "1"
			} else {
				out = out + "2"
			}
		}()
	}
	out = out + "start:"
	return out
}

func Main() string {
	ret := Run()
	return ret + "|" + out
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	// LIFO: loop 0, 1, 2 queued defers; they run 2, 1, 0
	assertEqual(res.wasmRes, "start:|start:210");
	assertEqual(res.jsRes, "start:|start:210");
});

test("Deferred function arguments are evaluated when defer statement is executed", () => {
	const src = `
package main

var result int

func save(x int) {
	result = x
}

func Run() int {
	x := 10
	defer save(x)
	x = 20
	return x
}

func Main() int {
	ret := Run()
	return ret*100 + result
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	// ret is 20, result is 10 (evaluated at defer time) -> 2010
	assertEqual(res.wasmRes, 2010n);
	assertEqual(res.jsRes, 2010);
});

section("WASM Defer — Named Return Values");

test("Defer can read and mutate named return values", () => {
	const src = `
package main

func Compute() (res int) {
	defer func() {
		res = res + 5
	}()
	return 10
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Compute");
	// return 10 sets res = 10, defer adds 5 -> 15
	assertEqual(res.wasmRes, 15n);
	assertEqual(res.jsRes, 15);
});

test("Naked return with defer mutating named return values", () => {
	const src = `
package main

func Compute() (res int) {
	res = 40
	defer func() {
		res = res + 2
	}()
	return
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Compute");
	assertEqual(res.wasmRes, 42n);
	assertEqual(res.jsRes, 42);
});

test("Multiple named returns mutated in defer", () => {
	const src = `
package main

func SwapAndInc(a int, b int) (x int, y int) {
	defer func() {
		x = x + 10
		y = y + 20
	}()
	return b, a
}

func Main() int {
	x, y := SwapAndInc(1, 2)
	// x should be 2 + 10 = 12
	// y should be 1 + 20 = 21
	return x*100 + y
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1221n);
	assertEqual(res.jsRes, 1221);
});

section("WASM Recover — Basic Recovery");

test("recover() catches panic and function returns normally", () => {
	const src = `
package main

func SafeDiv(a int, b int) (res int) {
	defer func() {
		if r := recover(); r != nil {
			res = -1
		}
	}()
	if b == 0 {
		panic("divide by zero")
	}
	return a / b
}

func Main() int {
	ok := SafeDiv(10, 2)
	bad := SafeDiv(10, 0)
	return ok*100 + bad
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	// ok is 5, bad is -1 -> 500 - 1 = 499
	assertEqual(res.wasmRes, 499n);
	assertEqual(res.jsRes, 499);
});

test("recover() returns nil when there is no panic", () => {
	const src = `
package main

var wasNil bool

func Run() {
	defer func() {
		r := recover()
		wasNil = (r == nil)
	}()
}

func Main() int {
	Run()
	if wasNil {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("recover() outside of defer returns nil", () => {
	const src = `
package main

func Main() int {
	r := recover()
	if r == nil {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("recover() recovers panic message string", () => {
	const src = `
package main

func CatchMessage() (msg string) {
	defer func() {
		if r := recover(); r != nil {
			msg = r.(string)
		}
	}()
	panic("custom panic message")
	return "unreached"
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("CatchMessage");
	assertEqual(res.wasmRes, "custom panic message");
	assertEqual(res.jsRes, "custom panic message");
});

section("WASM Panic & Recover — Unwinding & Propagation");

test("Unrecovered panic unwinds through defers and propagates to caller", () => {
	const src = `
package main

var trace string

func inner() {
	defer func() {
		trace = trace + "inner_defer;"
	}()
	panic("inner_panic")
}

func outer() string {
	defer func() {
		if r := recover(); r != nil {
			trace = trace + "recovered:" + r.(string) + ";"
		}
	}()
	defer func() {
		trace = trace + "outer_defer;"
	}()
	inner()
	return "unreached"
}

func Main() string {
	trace = ""
	outer()
	return trace
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, "inner_defer;outer_defer;recovered:inner_panic;");
	assertEqual(res.jsRes, "inner_defer;outer_defer;recovered:inner_panic;");
});

test("Unrecovered panic rethrows to JS host with original message", () => {
	const src = `
package main

var deferRan bool

func Run() {
	defer func() {
		deferRan = true
	}()
	panic("uncaught wasm panic")
}
`;
	const hybrid = compileHybrid(src);
	// Both JS and WASM will throw "uncaught wasm panic"
	hybrid.run("Run");
});

test("Runtime error (integer divide by zero) can be recovered", () => {
	const src = `
package main

func SafeDiv(a int, b int) int {
	var recovered bool
	defer func() {
		if r := recover(); r != nil {
			recovered = true
		}
	}()
	v := a / b
	return v
}

func Main() int {
	return SafeDiv(10, 0)
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 0n);
	assertEqual(res.jsRes, 0);
});

section("WASM Defer — Regression Tests (Review Findings)");

test("Blank identifier in named returns with defer and naked return", () => {
	const src = `
package main

func Run() (a int, _ string, b int) {
	defer func() {
		a = a + 1
		b = b + 2
	}()
	a = 10
	b = 20
	return
}

func Main() int {
	a, _, b := Run()
	return a*100 + b
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1122n);
	assertEqual(res.jsRes, 1122);
});

test("Nested panic & recover preserves outer unrecovered panic on stack", () => {
	const src = `
package main

var trace string

func inner() {
	defer func() {
		if r := recover(); r != nil {
			trace = trace + "inner_rec:" + r.(string) + ";"
		}
	}()
	panic("inner_panic")
}

func outer() {
	defer func() {
		if r := recover(); r != nil {
			trace = trace + "outer_rec:" + r.(string) + ";"
		}
	}()
	defer func() {
		trace = trace + "outer_defer1;"
		inner()
	}()
	panic("outer_panic")
}

func Main() string {
	trace = ""
	outer()
	return trace
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(
		res.wasmRes,
		"outer_defer1;inner_rec:inner_panic;outer_rec:outer_panic;",
	);
	assertEqual(
		res.jsRes,
		"outer_defer1;inner_rec:inner_panic;outer_rec:outer_panic;",
	);
});

test("Multi-value call arguments in defer: defer f(g())", () => {
	const src = `
package main

func pair() (int, int) {
	return 10, 20
}

var sum int

func add(a int, b int) {
	sum = a + b
}

func Run() {
	defer add(pair())
}

func Main() int {
	Run()
	return sum
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 30n);
	assertEqual(res.jsRes, 30);
});

test("Method receiver and function variable evaluation hoisted at defer time", () => {
	const src = `
package main

type Counter struct {
	val int
}

func (c *Counter) Add(x int) {
	c.val = c.val + x
}

var res1 int
var res2 int

func RunReceiver() {
	c1 := &Counter{val: 10}
	c2 := &Counter{val: 100}
	c := c1
	defer c.Add(5)
	c = c2
	res1 = c1.val
	res2 = c2.val
}

var out int

func RunFnVar() {
	f1 := func() { out = 10 }
	f2 := func() { out = 20 }
	f := f1
	defer f()
	f = f2
}

func Main() int {
	RunReceiver()
	RunFnVar()
	return res1*10000 + res2*10 + out
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	// In RunReceiver: at return time, res1 is 10, res2 is 100.
	// After defer c1.Add(5) runs, c1.val becomes 15, c2.val remains 100.
	// In RunFnVar: f1() runs in defer, out becomes 10.
	// Return value: 10 * 10000 + 100 * 10 + 10 = 101010
	assertEqual(res.wasmRes, 101010n);
	assertEqual(res.jsRes, 101010);
});

test("Explicit panic with integer variable matches JS error message", () => {
	const src = `
package main

func Fail(code int) {
	panic(code)
}

func Main() {
	Fail(404)
}
`;
	const hybrid = compileHybrid(src);
	hybrid.run("Main");
});
