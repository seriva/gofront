// test/unit/wasm/defer_recover.test.js
// Tests for Task H4.4: Defer & Recover in WASM backend and JS-strict parity.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileFiles, evictParseCache } from "../../../src/compiler.js";
import {
	assertAllTargetsOutput,
	assertEqual,
	assertJsTargetsOutput,
	assertProgramOutput,
	assertValidWasm,
	compileHybrid,
	compileWasm,
	runWasm,
	section,
	test,
} from "../helpers.js";

// Compiles `source` twice on one path for each target, as `gofront dev` does
// when the file is unchanged: the second type-check sees the lowered syntax
// tree the first compile left in the parse cache, so a deferred call's
// hoisted temporaries must type-check again.
function assertRecompiles(source, targets = ["js", "both", "wasm"]) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-defer-"));
	try {
		const goPath = join(dir, "main.go");
		writeFileSync(goPath, source);
		for (const target of targets) {
			try {
				compileFiles([goPath], { forceTarget: target });
				const second = compileFiles([goPath], { forceTarget: target });
				if (target === "wasm") assertValidWasm(second.wasm);
			} catch (e) {
				throw new Error(`${target}: second compile failed: ${e.message}`);
			} finally {
				evictParseCache(goPath);
			}
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// `assertAllTargetsOutput` plus a second compile of the same file.
async function assertDeferOutput(source, expected) {
	await assertAllTargetsOutput(source, expected);
	assertRecompiles(source);
}

// The same for programs only the JS targets (`js` and the JS side of `both`)
// run correctly.
async function assertDeferJsOutput(source, expected) {
	await assertJsTargetsOutput(source, expected);
	assertRecompiles(source, ["js", "both"]);
}

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

section("Recoverable nil traps");

test("nil dereferences, nil func calls and other traps are recoverable panics", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type N struct{ v int }

func (n N) Val() int { return n.v }
func (n *N) Inc()    { n.v++ }

type S struct{ A int }

type St struct{ cb func() int }

type H func()

func try(name string, f func()) {
	defer func() { fmt.Println(name, "recovered:", recover() != nil) }()
	f()
}

func nested(f func()) {
	defer func() { recover() }()
	func() { f() }()
}

func Bump(old int) (res int) {
	defer func() { res = old + 1 }()
	return 0
}

func main() {
	var np *N
	try("value method on nil pointer", func() { fmt.Println(np.Val()) })
	try("pointer method on nil pointer", func() { np.Inc() })
	var p *S
	try("deref nil struct pointer", func() { _ = *p })
	try("field of nil pointer", func() { fmt.Println(p.A) })
	var ip *int
	try("deref nil int pointer", func() { fmt.Println(*ip) })
	var fn func()
	try("nil func", func() { fn() })
	var h H
	try("nil named func", func() { h() })
	var st St
	try("nil func field", func() { st.cb() })
	fs := make([]func() int, 2)
	try("nil func element", func() { fs[1]() })
	z := 0
	try("division by zero", func() { fmt.Println(1 / z) })
	try("index out of range", func() { var xs []int; _ = xs[3] })
	try("nil map write", func() { var m map[string]int; m["a"] = 1 })
	nested(func() { var q *S; _ = *q })
	fmt.Println(Bump(1))
}
`,
		`value method on nil pointer recovered: true
pointer method on nil pointer recovered: true
deref nil struct pointer recovered: true
field of nil pointer recovered: true
deref nil int pointer recovered: true
nil func recovered: true
nil named func recovered: true
nil func field recovered: true
nil func element recovered: true
division by zero recovered: true
index out of range recovered: true
nil map write recovered: true
2
`,
	);
});

section("Runtime panics recover as error values");

test("a recovered index-out-of-range panic is an error with the Go message", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	defer func() {
		r := recover()
		e, ok := r.(error)
		fmt.Println(ok)
		if ok {
			fmt.Println(e.Error())
		}
	}()
	a := []int{1}
	i := 5
	fmt.Println(a[i])
}
`,
		"true\nruntime error: index out of range [5] with length 1\n",
	);
});

section("WASM Defer — closures in switch clauses");

test("deferred closures capture clause locals of different types", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	for i := 1; i <= 2; i++ {
		switch i {
		case 1:
			s := "zero"
			defer func() { fmt.Println("deferred", s) }()
		case 2:
			s := i
			defer func() { fmt.Println("deferred2", s-1) }()
		}
	}
}
`,
		"deferred2 1\ndeferred zero\n",
	);
});

test("deferred closure in a switch clause inside a loop", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	for i := 1; i <= 2; i++ {
		switch i {
		case 1, 2:
			s := i
			defer func() {
				if s == 1 {
					fmt.Println("deferred zero")
				} else {
					fmt.Println("deferred2", s-1)
				}
			}()
		}
	}
}
`,
		"deferred2 1\ndeferred zero\n",
	);
});

section("Non-string panic values");

test("panic and recover preserve error values", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type rt string

func (e rt) Error() string { return "boom" }

func main() {
	defer func() {
		r := recover()
		fmt.Println(r)
		e, ok := r.(rt)
		fmt.Println(ok, string(e))
	}()
	panic(error(rt("q")))
}
`,
		"boom\ntrue q\n",
	);
});

section("Host imports that throw");

test("a host import that throws is recoverable and returns the message", () => {
	const src = `package main

func Main() (res string) {
	defer func() {
		r := recover()
		if s, ok := r.(string); ok {
			res = s
		} else {
			res = "other"
		}
	}()
	s := "abc"
	n := 0
	if s+s == "x" {
		n = 1
	}
	if n == 0 {
		return "no panic"
	}
	return "x"
}`;
	const { wasm, stringTable } = compileWasm(src);
	const { exports } = runWasm(wasm, {
		stringTable,
		extraImports: {
			env: {
				str_concat: () => {
					throw new Error("host boom");
				},
			},
		},
	});
	assertEqual(exports.Main(), "host boom");
});

section("Panic values keep their type");

test("a user string panic that reads like a runtime error is not an error", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	defer func() {
		r := recover()
		_, ok := r.(error)
		_, isStr := r.(string)
		fmt.Println(ok, isStr, r)
	}()
	panic("runtime error: foo")
}
`,
		"false true runtime error: foo\n",
	);
});

test("panic with a defined string error type keeps its type and Error method", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type rt string

func (rt) Error() string { return "boom" }

func main() {
	defer func() {
		r := recover()
		fmt.Println(r)
		_, ok := r.(rt)
		fmt.Println(ok)
	}()
	panic(rt("q"))
}
`,
		"boom\ntrue\n",
	);
});

section("WASM Defer — untyped constant arguments");

test("untyped constants take the parameter type of a deferred call", async () => {
	const src = `package main

import "fmt"

func f(x float64, n int8, s float32) { fmt.Println(x, n, s) }

func main() {
	defer f(2, 3, 1)
	fmt.Println("body")
}
`;
	await assertAllTargetsOutput(src, "body\n2 3 1\n");
});

section("WASM Defer — constants and nil for the callee's parameter");

test("untyped constants take a defined parameter type", async () => {
	const src = `package main

import "fmt"

type MyFloat float64
type MyInt int
type MyS string

func f(x MyFloat, n MyInt, s MyS) { fmt.Println(x, n, s) }

func main() {
	defer f(2.5, 3, "a")
	fmt.Println("body")
}
`;
	await assertDeferOutput(src, "body\n2.5 3 a\n");
});

test("a named constant and a constant expression take the parameter type", async () => {
	const src = `package main

import "fmt"

type MyFloat float64

const k = 1.5

func f(x MyFloat, y MyFloat) { fmt.Println(x, y) }

func main() {
	defer f(k, k*2+1)
	fmt.Println("body")
}
`;
	await assertDeferOutput(src, "body\n1.5 4\n");
});

test("an untyped bool value is computed at the defer statement", async () => {
	const src = `package main

import "fmt"

func f(b bool) { fmt.Println(b) }

func main() {
	x := 1
	defer f(x == 1)
	x = 2
}
`;
	await assertDeferOutput(src, "true\n");
});

test("defer f(nil) for every nilable parameter type", async () => {
	const src = `package main

import "fmt"

func fp(p *int)               { fmt.Println("ptr", p == nil) }
func fs(p fmt.Stringer)       { fmt.Println("stringer", p == nil) }
func fe(p error)              { fmt.Println("error", p == nil) }
func fa(p any)                { fmt.Println("any", p == nil) }
func fl(p []int)              { fmt.Println("slice", p == nil) }
func fm(p map[string]int)     { fmt.Println("map", p == nil) }
func ff(p func())             { fmt.Println("func", p == nil) }

func main() {
	defer fp(nil)
	defer fs(nil)
	defer fe(nil)
	defer fa(nil)
	defer fl(nil)
	defer fm(nil)
	defer ff(nil)
	fmt.Println("body")
}
`;
	await assertDeferOutput(
		src,
		"body\nfunc true\nmap true\nslice true\nany true\nerror true\nstringer true\nptr true\n",
	);
});

test("a typed nil variable is still evaluated at the defer statement", async () => {
	const src = `package main

import "fmt"

func f(p *int) { fmt.Println(p == nil) }

func main() {
	var p *int
	defer f(p)
	v := 1
	p = &v
}
`;
	await assertDeferOutput(src, "true\n");
});

section("WASM Defer — inferred generic callees");

test("constants for an inferred generic callee take the declared parameter type", async () => {
	const src = `package main

import "fmt"

func id[T any](x T, y complex128) { fmt.Println(x, y) }
func idf[T any](x T, y float64)   { fmt.Println(x, y) }

func main() {
	defer id(1, 2)
	defer idf("a", 2)
	defer id[int](1, 2)
	fmt.Println("body")
}
`;
	await assertDeferOutput(src, "body\n1 (2+0i)\na 2\n1 (2+0i)\n");
});

section("Defer — variadic and spread arguments (JS targets)");

test("a spread argument of a deferred call stays a slice", async () => {
	const src = `package main

import "fmt"

func f(ys ...int)               { fmt.Println(ys) }
func g(a int, ys ...int)        { fmt.Println(a, ys) }
func h(ys ...string)            { fmt.Println(ys) }

func main() {
	s := []int{1, 2}
	defer f(s...)
	t := []int{1, 2, 3}
	defer g(0, t...)
	u := []string{"a", "b"}
	defer h(u...)
	fmt.Println("body")
}
`;
	await assertDeferJsOutput(src, "body\n[a b]\n0 [1 2 3]\n[1 2]\n");
});

test("deferred variadic arguments are evaluated at the defer statement", async () => {
	const src = `package main

import "fmt"

func f(ys ...int) { fmt.Println(ys) }

func main() {
	x := 1
	defer f(x, x+1)
	x = 5
	s := []int{1, 2}
	defer f(s...)
	s[0] = 9
	s = nil
	defer f()
	fmt.Println("body", x, s)
}
`;
	await assertDeferJsOutput(src, "body 5 []\n[]\n[9 2]\n[1 2]\n");
});

section("WASM Defer — variadic callees on every target");

test("a deferred call of a variadic float64 function", async () => {
	const src = `package main

import "fmt"

func f(ys ...float64) { fmt.Println(ys) }

func main() {
	x := 4.0
	defer f(x)
	x = 5
	fmt.Println("body", x)
}
`;
	await assertDeferOutput(src, "body 5\n[4]\n");
});

test("a deferred call of a variadic int function with none, one, many and spread arguments", async () => {
	const src = `package main

import "fmt"

func f(ys ...int)        { fmt.Println("f", ys) }
func g(a int, ys ...int) { fmt.Println("g", a, ys) }

func main() {
	s := []int{7, 8, 9}
	defer f()
	defer f(1)
	defer f(1, 2, 3)
	defer f(s...)
	defer g(0)
	defer g(0, 5)
	defer g(0, s...)
	s[0] = 70
	fmt.Println("body")
}
`;
	await assertDeferOutput(
		src,
		"body\ng 0 [70 8 9]\ng 0 [5]\ng 0 []\nf [70 8 9]\nf [1 2 3]\nf [1]\nf []\n",
	);
});

test("a deferred call of a variadic string function", async () => {
	const src = `package main

import "fmt"

func f(ys ...string) { fmt.Println(len(ys), ys) }

func main() {
	u := []string{"x", "y"}
	defer f("a", "b", "c")
	defer f(u...)
	fmt.Println("body")
}
`;
	await assertDeferOutput(src, "body\n2 [x y]\n3 [a b c]\n");
});

test("a deferred call of a variadic any function and fmt.Println", async () => {
	const src = `package main

import "fmt"

func f(ys ...any) { fmt.Println(len(ys), ys) }

func main() {
	defer f(1, "a")
	defer fmt.Println("x", 1)
	defer fmt.Printf("%d-%s\\n", 2, "b")
	fmt.Println("body")
}
`;
	await assertDeferOutput(src, "body\n2-b\nx 1\n2 [1 a]\n");
});

test("deferred variadic method and func literal calls", async () => {
	const src = `package main

import "fmt"

type T struct{ n int }

func (t T) m(ys ...int)   { fmt.Println("m", t.n, ys) }
func (t *T) p(ys ...int)  { fmt.Println("p", t.n, ys) }

func main() {
	tv := T{n: 1}
	defer tv.m(1, 2)
	defer tv.p(3)
	defer func(ys ...int) { fmt.Println("lit", ys) }(1, 2)
	defer func(ys ...int) { fmt.Println("lit", ys) }()
	fmt.Println("body")
}
`;
	await assertDeferOutput(src, "body\nlit []\nlit [1 2]\np 1 [3]\nm 1 [1 2]\n");
});

section("Deferred non-constant untyped arguments take the parameter's type");

const DEFER_BOOL_PRELUDE = `package main

import "fmt"

type B bool

func f(b B)        { fmt.Println("f", b) }
func fb(b bool)    { fmt.Println("fb", b) }
func fa(a any)     { fmt.Printf("fa %T %v\\n", a, a) }
func fv(bs ...B)   { fmt.Println("fv", bs) }

type T struct{}

func (T) m(b B) { fmt.Println("m", b) }

`;

test("defer f(x == 1) with defined and plain bool parameters", async () => {
	await assertDeferOutput(
		`${DEFER_BOOL_PRELUDE}func main() {
	x := 1
	defer f(x == 1)
	defer fb(x == 2)
	defer fa(x == 1)
}
`,
		"fa bool true\nfb false\nf true\n",
	);
});

test("defer with a comparison for a method, variadic and closure parameter", async () => {
	await assertDeferOutput(
		`${DEFER_BOOL_PRELUDE}func main() {
	x := 1
	var t T
	defer t.m(x == 1)
	defer fv(x == 1, x < 0)
	defer func(b B) { fmt.Println("lit", b) }(x == 1)
}
`,
		"lit true\nfv [true false]\nm true\n",
	);
});

test("defer f(1 << n) takes int8, uint8, int64 and any parameters", async () => {
	await assertDeferOutput(
		`package main

import "fmt"

func a(z int8)   { fmt.Println("int8", z) }
func b(z uint8)  { fmt.Println("uint8", z) }
func c(z int64)  { fmt.Println("int64", z) }
func d(z any)    { fmt.Printf("%T %v\\n", z, z) }

func main() {
	n := 3
	defer a(1 << n)
	defer b(1 << n)
	defer c(1 << n)
	defer d(1 << n)
}
`,
		"int 8\nint64 8\nuint8 8\nint8 8\n",
	);
});
