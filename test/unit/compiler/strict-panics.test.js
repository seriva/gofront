// GoFront test suite — strict-mode runtime panics (Task 0.16a)
//
// `both` packages panic in JS exactly where WASM does: out-of-range slice,
// array and string indexing, writes to a nil map, and field access through a
// nil struct pointer.  `js` packages keep JavaScript's behaviour.

import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	compile,
	compileHybrid,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

// A `both` package whose Main recovers and returns the panic message.
function recovered(body, decls = "") {
	return `package main
import "fmt"
type P struct{ X int }
func three() int { return 3 }
${decls}
func Main() (res string) {
	defer func() {
		if r := recover(); r != nil { res = fmt.Sprintf("%v", r) }
	}()
	${body}
	return "nopanic"
}`;
}

function panicMessage(body, decls) {
	const res = compileHybrid(recovered(body, decls)).run("Main");
	assertEqual(res.jsRes, res.wasmRes, "JS and WASM disagree");
	return res.jsRes;
}

section("Strict panics — index out of range");

test("xs[5] on a 3-element slice", () => {
	assertEqual(
		panicMessage("xs := []int{1, 2, 3}; i := 5; _ = xs[i]"),
		"runtime error: index out of range [5] with length 3",
	);
});

test("xs[-1]", () => {
	assertEqual(
		panicMessage("xs := []int{1, 2, 3}; i := -1; _ = xs[i]"),
		"runtime error: index out of range [-1]",
	);
});

test("s[len(s)] on a string", () => {
	assertEqual(
		panicMessage(`s := "abc"; _ = s[len(s)]`),
		"runtime error: index out of range [3] with length 3",
	);
});

test("arr[i] with a runtime i out of range (read and write)", () => {
	assertEqual(
		panicMessage("var a [3]int; i := 4; _ = a[i]"),
		"runtime error: index out of range [4] with length 3",
	);
	assertEqual(
		panicMessage("var a [3]int; a[three()] = 1"),
		"runtime error: index out of range [3] with length 3",
	);
});

test("writes, compound assignments and ++ out of range", () => {
	assertEqual(
		panicMessage("xs := []int{1, 2, 3}; xs[three()] = 1"),
		"runtime error: index out of range [3] with length 3",
	);
	assertEqual(
		panicMessage("xs := []int{1, 2, 3}; xs[three()] += 1"),
		"runtime error: index out of range [3] with length 3",
	);
	assertEqual(
		panicMessage("xs := []float64{1}; i := 1; xs[i]++"),
		"runtime error: index out of range [1] with length 1",
	);
});

test("index into a resliced slice and a nil slice", () => {
	assertEqual(
		panicMessage("xs := []int{1, 2, 3}; ys := xs[1:]; _ = ys[2]"),
		"runtime error: index out of range [2] with length 2",
	);
	assertEqual(
		panicMessage("var xs []int; _ = xs[0]"),
		"runtime error: index out of range [0] with length 0",
	);
});

test("in-range reads and writes are unchanged", () => {
	assertEqual(
		panicMessage(`xs := []int{1, 2, 3}
	xs[1] += 10
	xs[2]++
	s := "abc"
	var a [2]int
	a[1] = 7
	if xs[1] + xs[2] + int(s[2]) + a[1] != 12 + 4 + 99 + 7 { return "bad" }`),
		"nopanic",
	);
});

test("an unrecovered index panic has the same message on both backends", () => {
	const h = compileHybrid(`package main
func Main() int { xs := []int{1}; i := 2; return xs[i] }`);
	let err = null;
	try {
		h.run("Main");
	} catch (e) {
		err = e;
	}
	assertEqual(err, null, "compileHybrid compares both messages");
});

section("Strict panics — nil maps and nil pointers");

test("a write to a nil map panics", () => {
	assertEqual(
		panicMessage(`var m map[string]int; m["k"] = 1`),
		"assignment to entry in nil map",
	);
	assertEqual(
		panicMessage(`var m map[string]int; m["k"] += 1`),
		"assignment to entry in nil map",
	);
	assertEqual(
		panicMessage(`var m map[string]int; m["k"]++`),
		"assignment to entry in nil map",
	);
});

test("a nil map field and a missing inner map panic on write", () => {
	assertEqual(
		panicMessage(`var h H; h.M["k"] = 1`, "type H struct{ M map[string]int }"),
		"assignment to entry in nil map",
	);
	assertEqual(
		panicMessage(`mm := map[string]map[string]int{}; mm["a"]["b"] = 1`),
		"assignment to entry in nil map",
	);
});

test("reads, comma-ok, len, range and delete on a nil map do not panic", () => {
	assertEqual(
		panicMessage(`var m map[string]int
	v, ok := m["k"]
	n := 0
	for range m { n++ }
	delete(m, "k")
	if v != 0 || ok || m["x"] != 0 || len(m) != 0 || n != 0 { return "bad" }`),
		"nopanic",
	);
});

test("writes to a made map still work", () => {
	assertEqual(
		panicMessage(`m := map[string]int{}
	m["a"] = 1
	m["a"] += 2
	m["a"]++
	if m["a"] != 4 { return "bad" }`),
		"nopanic",
	);
});

test("p.X through a nil pointer panics with Go's message (JS, recovered)", () => {
	const { js, errors } = compile(recovered("var p *P; _ = p.X"), {
		target: "both",
	});
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(`${js}\nconsole.log(Main());`),
		"runtime error: invalid memory address or nil pointer dereference",
	);
});

test("an unrecovered nil dereference has the same message on both backends", () => {
	const h = compileHybrid(`package main
type P struct{ X int }
func Main() int { var p *P; p.X = 3; return p.X }`);
	let err = null;
	try {
		h.run("Main");
	} catch (e) {
		err = e;
	}
	assertEqual(err, null, "compileHybrid compares both messages");
});

section("Strict panics — index-check elision (Task 0.16b)");

// JS for a `both` package whose Main is `body`, and its bounds helper calls.
function boundsChecks(body, params = "xs []int") {
	const { js, errors } = compile(
		`package main
func three() int { return 3 }
func Main(${params}) int {
	s := 0
	${body}
	return s
}`,
		{ target: "both" },
	);
	assertEqual(errors.map((e) => e.message).join("\n"), "");
	const main = js.slice(js.indexOf("function Main("));
	return (main.match(/__at\(|__ix\(/g) ?? []).length;
}

test("for i := range xs { xs[i] = 0 } emits no check", () => {
	assertEqual(boundsChecks("for i := range xs { xs[i] = 0 }"), 0);
	assertEqual(
		boundsChecks("for i, v := range xs { xs[i] += v; s += xs[i] }"),
		0,
	);
});

test("for i := 0; i < len(xs); i++ { s += xs[i] } emits no check", () => {
	assertEqual(boundsChecks("for i := 0; i < len(xs); i++ { s += xs[i] }"), 0);
	assertEqual(boundsChecks("for i := 1; i < len(xs); i++ { xs[i]++ }"), 0);
});

test("constant in-range indexes into arrays emit no check", () => {
	assertEqual(
		boundsChecks("var a [3]int; a[0] = 1; a[2] = a[0] + a[1]; s = a[2]", ""),
		0,
	);
});

test("a body that reassigns xs or i keeps the checks", () => {
	assert(boundsChecks("for i := range xs { xs = xs[1:]; s += xs[i] }") > 0);
	assert(boundsChecks("for i := range xs { i += 1; s += xs[i] }") > 0);
	assert(
		boundsChecks("for i := 0; i < len(xs); i++ { xs = nil; s += xs[i] }") > 0,
	);
	assert(boundsChecks("for i := 0; i < len(xs); i++ { i++; s += xs[i] }") > 0);
});

test("other indexes keep their checks", () => {
	// A different slice, an offset index, a shadowing declaration, a slice
	// written by a closure, an address-taken slice, and a slice index.
	assert(boundsChecks("for i := range xs { s += ys[i] }", "xs, ys []int") > 0);
	assert(boundsChecks("for i := range xs { s += xs[i+1] }") > 0);
	assert(boundsChecks("for i := range xs { xs := xs[:1]; s += xs[i] }") > 0);
	assert(
		boundsChecks(
			"f := func() { xs = nil }; for i := range xs { f(); s += xs[i] }",
		) > 0,
	);
	assert(
		boundsChecks("p := &xs; for i := range xs { *p = nil; s += xs[i] }") > 0,
	);
	assert(boundsChecks("for i := 0; i <= len(xs); i++ { s += xs[i] }") > 0);
	assert(boundsChecks("for i := -1; i < len(xs); i++ { s += xs[i] }") > 0);
	assert(boundsChecks("s = xs[0]") > 0);
});

test("a package-level slice keeps its checks (only locals are analysed)", () => {
	const { js, errors } = compile(
		`package main
var xs = []int{1, 2, 3}
func Main() int {
	s := 0
	for i := range xs { s += xs[i] }
	return s
}`,
		{ target: "both" },
	);
	assertEqual(errors.length, 0);
	assert(js.slice(js.indexOf("function Main(")).includes("__at("));
});

test("elided loops still compute the same results (parity)", () => {
	const h = compileHybrid(`package main
func Main() int {
	xs := []int{1, 2, 3, 4}
	s := 0
	for i := range xs { xs[i] *= 2 }
	for i := 0; i < len(xs); i++ { s += xs[i] }
	var a [3]int
	a[0] = s
	a[2] = a[0] + 1
	return a[2]
}`);
	assertEqual(Number(h.run("Main").wasmRes), 21);
});

section("Strict panics — js packages are unchanged");

test("a js package emits no bounds, nil-map or nil-pointer helpers", () => {
	const { js, errors } = compile(
		`package main
type P struct{ X int }
func main() {
	xs := []int{1, 2, 3}
	i := 1
	xs[i] = xs[i] + 1
	s := "abc"
	var m map[string]int
	m = map[string]int{}
	m["k"] = 1
	p := &P{}
	p.X = int(s[i])
	console.log(xs[i], p.X, m["k"])
}`,
		{ target: "js" },
	);
	assertEqual(errors.length, 0);
	for (const helper of ["__at(", "__ix(", "__nilmap", "__mw(", "__nilcall("])
		assert(!js.includes(helper), `unexpected ${helper} in js output`);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
