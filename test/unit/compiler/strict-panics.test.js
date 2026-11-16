// GoFront test suite — strict-mode runtime panics (Task 0.16a)
//
// `both` packages panic in JS exactly where WASM does: out-of-range slice,
// array and string indexing, writes to a nil map, and field access through a
// nil struct pointer.  `js` packages keep JavaScript's behaviour.

import { fileURLToPath } from "node:url";
import {
	assert,
	assertAllTargetsOutput,
	assertEqual,
	assertProgramOutput,
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

test("p.X through a nil pointer panics with Go's message (recovered)", () => {
	for (const body of [
		"var p *P; _ = p.X",
		"var p *P; p.X = 1",
		"var p *P; p.X += 1",
		"var p *P; p.X++",
		"var p *P; _ = readX(p)",
	]) {
		assertEqual(
			panicMessage(body, "func readX(p *P) int { return p.X }"),
			"runtime error: invalid memory address or nil pointer dereference",
			body,
		);
	}
});

test("p.X through a non-nil pointer is unchanged", () => {
	assertEqual(
		panicMessage(`p := &P{X: 2}
	p.X = 3
	p.X += 1
	p.X++
	if p.X != 5 { return "bad" }`),
		"nopanic",
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

test("a range value variable or type-switch binding that shadows keeps the checks", () => {
	// Each body indexes a shadowing xs or i, so the loop proves nothing.
	const a =
		"xs := [][]int{{1}, {2}, {3}}; for i, xs := range xs { s += xs[i] }";
	const b =
		"for i := range xs { switch xs := other.(type) { case []int: s += xs[i] } }";
	const c =
		"for i := range xs { _ = i; switch i := other.(type) { case int: s += xs[i] } }";
	assert(boundsChecks(a, "") > 0);
	assert(boundsChecks(b, "xs []int, other any") > 0);
	assert(boundsChecks(c, "xs []int, other any") > 0);
	assertEqual(
		panicMessage(`s := 0; ${a}; _ = s`),
		"runtime error: index out of range [1] with length 1",
	);
	assertEqual(
		panicMessage(
			`s := 0; xs := []int{1, 2, 3}; var other any = []int{7}; ${b}; _ = s`,
		),
		"runtime error: index out of range [1] with length 1",
	);
	assertEqual(
		panicMessage(
			`s := 0; xs := []int{1, 2, 3}; var other any = 9; ${c}; _ = s`,
		),
		"runtime error: index out of range [9] with length 3",
	);
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

section("Nil dereference panics with Go's message");

const NIL_DEREF =
	"runtime error: invalid memory address or nil pointer dereference";

function recoveredNilDeref(body, decls = "") {
	const src = `package main
import "fmt"
type S struct{ A int }
type T struct{ A int }
${decls}
func main() {
	defer func() { fmt.Println(recover()) }()
	${body}
}`;
	const outs = [];
	for (const target of ["js", "both"]) {
		const { js, errors } = compile(src, { target });
		assertEqual(errors.map((e) => e.message).join("\n"), "");
		outs.push(runJs(js));
	}
	assertEqual(outs[0], outs[1], "js and both disagree");
	return outs[0];
}

for (const [name, body] of [
	["a field read through a nil struct pointer", "var p *S; _ = p.A"],
	["assigning through a nil struct pointer", "var p *T; *p = T{1}"],
	[
		"dereferencing a nil pointer held in an any",
		"var e any = (*T)(nil); x := *e.(*T); fmt.Println(x)",
	],
	["assigning through a nil int pointer", "var p *int; *p = 3"],
	["indexing a nil array pointer", "var ap *[3]int; fmt.Println(ap[1])"],
	["copying a nil array pointer", "var ap *[3]int; a := *ap; fmt.Println(a)"],
]) {
	test(`${name} recovers Go's nil dereference message`, () => {
		assertEqual(recoveredNilDeref(body), NIL_DEREF);
	});
}

test("a TypeError that is not a null access keeps its own message", () => {
	assertEqual(
		recoveredNilDeref(`var f func(); f()`).includes("nil pointer dereference"),
		false,
	);
});

section("Strict panics — make with a negative length or capacity");

test("make([]T, n) with negative n panics with Go's message", () => {
	assertEqual(
		panicMessage("n := -1; _ = make([]int, n)"),
		"runtime error: makeslice: len out of range",
	);
	assertEqual(
		panicMessage("n := -1; _ = make([]P, n)"),
		"runtime error: makeslice: len out of range",
	);
});

test("make([]T, 0, n) with negative n panics with Go's cap message", () => {
	assertEqual(
		panicMessage("n := -1; _ = make([]int, 0, n)"),
		"runtime error: makeslice: cap out of range",
	);
	assertEqual(
		panicMessage("n := 3; c := 1; _ = make([]int, n, c)"),
		"runtime error: makeslice: cap out of range",
	);
});

test("make with valid lengths is unchanged", () => {
	assertEqual(
		panicMessage(
			'n := 2; xs := make([]int, n, n+1); if len(xs) != 2 || cap(xs) != 3 { return "bad" }',
		),
		"nopanic",
	);
});

section("Slice-bounds panics carry Go's bounds text");

// Runs each closure and prints the panic it recovers.
const TRY = `func try(name string, f func()) {
	defer func() { fmt.Println(name, recover()) }()
	f()
}
`;

const SLICE_PRELUDE = `package main

import "fmt"

${TRY}`;

test("a slice with low above high names both bounds", async () => {
	await assertAllTargetsOutput(
		`${SLICE_PRELUDE}
func main() {
	xs := []int{1, 2, 3}
	lo, hi := 2, 1
	try("p06", func() { _ = xs[lo:hi] })
	try("ok", func() { _ = xs[1:2] })
}
`,
		"p06 runtime error: slice bounds out of range [2:1]\nok <nil>\n",
	);
});

test("a slice high above the capacity names the capacity", async () => {
	await assertAllTargetsOutput(
		`${SLICE_PRELUDE}
func main() {
	xs := []int{1, 2, 3}
	n := 5
	try("p07", func() { _ = xs[:n] })
}
`,
		"p07 runtime error: slice bounds out of range [:5] with capacity 3\n",
	);
});

test("two- and three-index slices of a slice with capacity", async () => {
	await assertAllTargetsOutput(
		`${SLICE_PRELUDE}
func main() {
	xs := make([]int, 3, 5)
	a, b, c, neg, nine := 4, 2, 1, -1, 9
	try("lo above len", func() { _ = xs[a:] })
	try("max above cap", func() { _ = xs[:b:nine] })
	try("high above max", func() { _ = xs[:b:c] })
	try("low above high", func() { _ = xs[a:b:a] })
	try("negative low", func() { _ = xs[neg:] })
	try("negative high", func() { _ = xs[:neg] })
	try("negative max", func() { _ = xs[:b:neg] })
	try("negative 3-index high", func() { _ = xs[:neg:a] })
	try("negative 3-index low", func() { _ = xs[neg:b:a] })
	try("high above cap", func() { _ = xs[:6+c-c] })
	try("ok", func() { _ = xs[:5] })
}
`,
		`lo above len runtime error: slice bounds out of range [4:3]
max above cap runtime error: slice bounds out of range [::9] with capacity 5
high above max runtime error: slice bounds out of range [:2:1]
low above high runtime error: slice bounds out of range [4:2:]
negative low runtime error: slice bounds out of range [-1:]
negative high runtime error: slice bounds out of range [:-1]
negative max runtime error: slice bounds out of range [::-1]
negative 3-index high runtime error: slice bounds out of range [:-1:]
negative 3-index low runtime error: slice bounds out of range [-1::]
high above cap runtime error: slice bounds out of range [:6] with capacity 5
ok <nil>
`,
	);
});

test("slicing an array or an array pointer names the length", async () => {
	await assertAllTargetsOutput(
		`${SLICE_PRELUDE}
func main() {
	var arr [3]int
	p := &arr
	lo, hi, n := 2, 1, 7
	try("arr low above high", func() { _ = arr[lo:hi] })
	try("arr high", func() { _ = arr[:n] })
	try("arr max", func() { _ = arr[:lo:n] })
	try("ptr high", func() { _ = p[:n] })
	try("ok", func() { _ = arr[1:3] })
}
`,
		`arr low above high runtime error: slice bounds out of range [2:1]
arr high runtime error: slice bounds out of range [:7] with length 3
arr max runtime error: slice bounds out of range [::7] with length 3
ptr high runtime error: slice bounds out of range [:7] with length 3
ok <nil>
`,
	);
});

test("slice calls on slices keep the same emitted call", () => {
	const { js } = compile(`package main
func main() {
	xs := []int{1, 2, 3}
	lo, hi := 1, 2
	ys := xs[lo:hi]
	zs := xs[:hi:3]
	_, _ = ys, zs
}
`);
	assert(js.includes("__slice(xs, lo, hi)"), "2-index slice call changed");
	assert(js.includes("__slice(xs, 0, hi, 3)"), "3-index slice call changed");
});

section("String slicing in both packages checks its bounds");

test("a string slice out of range panics with Go's text in a both package", async () => {
	await assertProgramOutput(
		`${SLICE_PRELUDE}
func main() {
	s := "abc"
	lo, hi, n, neg := 2, 1, 7, -1
	try("low above high", func() { _ = s[lo:hi] })
	try("high above length", func() { _ = s[:n] })
	try("low above length", func() { _ = s[n:] })
	try("negative low", func() { _ = s[neg:] })
	try("negative high", func() { _ = s[:neg] })
	try("ok", func() { fmt.Println(s[1:], s[:2], s[1:2], s[:], s[3:]) })
}
`,
		`low above high runtime error: slice bounds out of range [2:1]
high above length runtime error: slice bounds out of range [:7] with length 3
low above length runtime error: slice bounds out of range [7:3]
negative low runtime error: slice bounds out of range [-1:]
negative high runtime error: slice bounds out of range [:-1]
bc ab b abc 
ok <nil>
`,
	);
});

test("an in-range string slice in a js package emits the same s.slice call", () => {
	const src = `package main
func main() {
	s := "abc"
	lo, hi := 1, 2
	a, b := s[lo:hi], s[lo:]
	_, _ = a, b
}
`;
	const { js } = compile(src);
	assert(js.includes("s.slice(lo, hi)"), "2-index string slice changed");
	assert(js.includes("s.slice(lo)"), "1-index string slice changed");
	assert(!js.includes("__sslice"), "js package must not use the checked form");
	const strict = compile(src, { strict: true }).js;
	assert(strict.includes("__sslice(s, lo, hi)"), "both package is unchecked");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
