// GoFront test suite — slice bounds-check elimination in `both` packages
//
// A length proof (`_ = xs[K]`, `if len(xs) > K { … }`, or an early return on
// a short slice) lets constant indexes 0..K emit a plain `xs[i]` instead of
// an `__at`/`__ix` helper call.

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	compile,
	compileHybrid,
	section,
	summarize,
	test,
} from "../helpers.js";

// Bounds helper calls in the JS of `func F(<params>) int { <body> }`.
function checks(body, params = "xs []int", decls = "") {
	const { js, errors } = compile(
		`package main
${decls}
func F(${params}) int {
	${body}
}`,
		{ target: "both" },
	);
	assertEqual(errors.map((e) => e.message).join("\n"), "");
	const fn = js.slice(js.indexOf("function F("));
	return (fn.match(/__at\(|__ix\(/g) ?? []).length;
}

section("Bounds — slice length hints");

test("_ = xs[15] elides xs[0] through xs[15] afterwards", () => {
	const body = Array.from({ length: 16 }, (_, k) => `s += xs[${k}]`).join("\n");
	// Only the hint itself keeps its check.
	assertEqual(checks(`_ = xs[15]\ns := 0\n${body}\nreturn s`), 1);
});

test("indexes above the hint and non-constant indexes keep their checks", () => {
	assertEqual(checks("_ = xs[3]\nreturn xs[3] + xs[4]"), 2);
	assertEqual(checks("_ = xs[3]\nreturn xs[0] + xs[i]", "xs []int, i int"), 2);
});

test("indexes before the hint keep their checks", () => {
	assertEqual(checks("a := xs[0]\n_ = xs[3]\nreturn a + xs[1]"), 2);
});

test("writes through a hinted slice are elided", () => {
	assertEqual(checks("_ = xs[2]\nxs[0] = 1\nxs[2] += xs[1]\nreturn 0"), 1);
});

test("a hint on a local slice works", () => {
	assertEqual(checks("ys := xs[1:]\n_ = ys[2]\nreturn ys[0] + ys[2]"), 1);
});

test("a reassigned slice keeps its checks", () => {
	assertEqual(
		checks("_ = xs[2]\nxs = xs[1:]\nreturn xs[0] + xs[1]"),
		3, // hint + both reads
	);
});

test("a slice reassigned in a closure keeps its checks", () => {
	assertEqual(
		checks("_ = xs[2]\nf := func() { xs = nil }\nf()\nreturn xs[0]"),
		2,
	);
});

test("a shadowing declaration keeps the checks", () => {
	assertEqual(
		checks("_ = xs[2]\n{ xs := []int{1}; return xs[0] }\n", "xs []int"),
		2,
	);
});

test("an address-taken slice keeps its checks", () => {
	assertEqual(checks("_ = xs[2]\np := &xs\n_ = p\nreturn xs[0]"), 2);
});

section("Bounds — length guards");

test("if len(xs) > K elides xs[0]..xs[K] in the body only", () => {
	assertEqual(
		checks("if len(xs) > 2 { return xs[0] + xs[2] }\nreturn xs[0]"),
		1,
	);
});

test("len(xs) >= K and K < len(xs) forms", () => {
	assertEqual(checks("if len(xs) >= 3 { return xs[0] + xs[2] }\nreturn 0"), 0);
	assertEqual(checks("if 2 < len(xs) { return xs[0] + xs[2] }\nreturn 0"), 0);
	assertEqual(checks("if len(xs) >= 3 { return xs[3] }\nreturn 0"), 1);
});

test("an early return on a short slice proves the rest of the block", () => {
	assertEqual(checks("if len(xs) <= 2 { return 0 }\nreturn xs[0] + xs[2]"), 0);
	assertEqual(checks("if len(xs) < 3 { return 0 }\nreturn xs[0] + xs[2]"), 0);
	assertEqual(checks("if len(xs) < 3 { return 0 }\nreturn xs[3]"), 1);
});

test("a guard whose body does not exit proves nothing afterwards", () => {
	assertEqual(checks("s := 0\nif len(xs) < 3 { s = 1 }\nreturn xs[0] + s"), 1);
});

test("a guard with an else branch is not used after the statement", () => {
	assertEqual(
		checks("if len(xs) < 3 { return 0 } else { _ = 1 }\nreturn xs[0]"),
		1,
	);
	assertEqual(
		checks("if len(xs) < 3 { _ = 1 } else { return 5 }\nreturn xs[0]"),
		1,
	);
});

test("a shadowed len keeps the checks", () => {
	assertEqual(
		checks(
			"len := func([]int) int { return 99 }\nif len(xs) > 2 { return xs[2] }\nreturn 0",
		),
		1,
	);
});

section("Bounds — parity and panics");

test("a hinted slice still panics at the hint with Go's message", () => {
	const res = compileHybrid(`package main
import "fmt"
func Main() (res string) {
	defer func() { res = fmt.Sprint(recover()) }()
	xs := []float32{1, 2, 3}
	_ = xs[3]
	return fmt.Sprint(xs[0] + xs[1] + xs[2])
}`).run("Main");
	assertEqual(res.jsRes, res.wasmRes);
	assertEqual(res.jsRes, "runtime error: index out of range [3] with length 3");
});

test("elided indexes compute the same results on JS and WASM", () => {
	const res = compileHybrid(`package main
func dot(a, b []float32) float32 {
	_ = a[3]
	_ = b[3]
	return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]
}
func sum(xs []int) int {
	if len(xs) < 2 {
		return -1
	}
	return xs[0] + xs[1]
}
func Main() int {
	d := dot([]float32{1, 2, 3, 4}, []float32{5, 6, 7, 8})
	return int(d)*100 + sum([]int{3, 4}) + sum([]int{9})
}`).run("Main");
	assertEqual(res.jsRes, res.wasmRes);
	assertEqual(res.jsRes, 7006);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
