// GoFront test suite — type inference, conversions, pointer types

import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

section("Type errors — condition and operator checks");

test("if condition must be bool — non-bool raises error", () => {
	const { errors } = compile(`package main
func main() {
	x := 42
	if x { console.log("bad") }
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "bool");
});

test("for condition must be bool — non-bool raises error", () => {
	const { errors } = compile(`package main
func main() {
	x := 1
	for x {
		break
	}
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "bool");
});

test("invalid binary op — string minus string is an error", () => {
	const { errors } = compile(`package main
func main() {
	s := "hello" - "world"
	console.log(s)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Invalid operation");
});

test("no new variables on left side of := is an error", () => {
	const { errors } = compile(`package main
func main() {
	x := 1
	x := 2
	console.log(x)
}`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "no new variables");
});

test("cannot index a bool value", () => {
	const { errors } = compile(`package main
func main() {
	b := true
	console.log(b[0])
}`);
	assertErrorContains(errors, "Cannot index");
});

test("cannot slice an int value", () => {
	const { errors } = compile(`package main
func main() {
	n := 42
	console.log(n[1:3])
}`);
	assertErrorContains(errors, "Cannot slice");
});

// ═════════════════════════════════════════════════════════════
// dts-parser unit tests
// ═════════════════════════════════════════════════════════════

section("TypeChecker — error messages");

test("missing return value in non-void function is an error", () => {
	const { errors } = compile(`package main
func greet() string {
	return
}
func main() { console.log(greet()) }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "Missing return value");
});

test("type error message includes array type notation [3]int", () => {
	const { errors } = compile(`package main
func f(a [3]int) {}
func main() { f("hello") }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "[3]int");
});

test("type error message includes map type notation", () => {
	const { errors } = compile(`package main
func f(m map[string]int) {}
func main() { f("hello") }`);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "map[string]int");
});

test("positional struct initialization type-checks elements", () => {
	// GoFront processes non-KV elements in a struct composite lit — just ensure no crash
	const { errors } = compile(`package main
type Point struct { X int; Y int }
func main() {
	p := Point{1, 2}
	console.log(p.X)
}`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════
// CodeGen — new(T) for basic types
// ═════════════════════════════════════════════════════════════

section("new(T) for basic types");

test("new(int) zero value is 0", () => {
	const js = compile(`package main
func main() {
	p := new(int)
	console.log(p.value)
}`).js;
	assertEqual(runJs(js), "0");
});

test("new(string) zero value is empty string", () => {
	const js = compile(`package main
func main() {
	p := new(string)
	console.log(p.value)
}`).js;
	assertEqual(runJs(js), "");
});

test("new(bool) zero value is false", () => {
	const js = compile(`package main
func main() {
	p := new(bool)
	console.log(p.value)
}`).js;
	assertEqual(runJs(js), "false");
});

test("new(float64) zero value is 0", () => {
	const js = compile(`package main
func main() {
	p := new(float64)
	console.log(p.value)
}`).js;
	assertEqual(runJs(js), "0");
});

// ═════════════════════════════════════════════════════════════
// CodeGen — type conversions
// ═════════════════════════════════════════════════════════════

section("Type conversions");

test("bool(x) converts non-zero int to true", () => {
	const js = compile(`package main
func main() {
	console.log(bool(1))
	console.log(bool(0))
}`).js;
	assertEqual(runJs(js), "true\nfalse");
});

test("[]int(slice) generic slice conversion", () => {
	// []int conversion of a non-string value — exercises the generic Array.from path
	const js = compile(`package main
func main() {
	src := []int{1, 2, 3}
	dst := []int(src)
	console.log(len(dst))
	console.log(dst[0])
}`).js;
	assertEqual(runJs(js), "3\n1");
});

// ═════════════════════════════════════════════════════════════
// Type assertion — comma-ok with error type
// ═════════════════════════════════════════════════════════════

section("Type assertion — error type");

test("type assert comma-ok on error type — string value is false", () => {
	const js = compile(`package main
func main() {
	var x any = "some error"
	_, ok := x.(error)
	console.log(ok)
}`).js;
	assertEqual(runJs(js), "false");
});

test("type assert comma-ok on error type — non-string value is false", () => {
	const js = compile(`package main
func main() {
	var x any = 42
	_, ok := x.(error)
	console.log(ok)
}`).js;
	assertEqual(runJs(js), "false");
});

// ═════════════════════════════════════════════════════════════
// Lexer — tab escape in strings
// ═════════════════════════════════════════════════════════════

section("TypeChecker — pointer type field access");

test("new(T) returns a pointer whose .value is the zero value of T", () => {
	const js = compile(`package main
func main() {
	p := new(int)
	q := new(string)
	r := new(bool)
	console.log(p.value)
	console.log(q.value)
	console.log(r.value)
}`).js;
	assertEqual(runJs(js), "0\n\nfalse");
});

test("arrays have correct string representation in error messages", () => {
	// [3]int should appear as [3]int, not [object Object]int
	const { errors } = compile(`package main
func f(a [3]int) {}
func main() { f("hello") }`);
	assert(errors.length > 0, "expected type error");
	assertErrorContains(errors, "[3]int");
});

// ═════════════════════════════════════════════════════════════
// TypeChecker — make() with various types
// ═════════════════════════════════════════════════════════════

section("TypeChecker — make and new builtins");

test("make(map[string]int) compiles and runs", () => {
	const js = compile(`package main
func main() {
	m := make(map[string]int)
	m["a"] = 1
	console.log(m["a"])
}`).js;
	assertEqual(runJs(js), "1");
});

test("new(struct) zero-initialises all fields", () => {
	const js = compile(`package main
type Point struct { X int; Y int }
func main() {
	p := new(Point)
	console.log(p.value.X)
	console.log(p.value.Y)
}`).js;
	assertEqual(runJs(js), "0\n0");
});

// ── Unused variable detection ─────────────────────────────────

section("Unused variables");

test("unused := variable is an error", () => {
	const { errors } = compile(`package main
func main() {
  x := 1
}`);
	assertErrorContains(errors, "'x' declared and not used");
});

test("unused var declaration is an error", () => {
	const { errors } = compile(`package main
func main() {
  var x int
}`);
	assertErrorContains(errors, "'x' declared and not used");
});

test("used variable is fine", () => {
	const { js } = compile(`package main
func main() {
  x := 42
  console.log(x)
}`);
	assertEqual(runJs(js), "42");
});

test("blank identifier _ is exempt from unused check", () => {
	const { js } = compile(`package main
func main() {
  _, ok := 1, true
  console.log(ok)
}`);
	assertEqual(runJs(js), "true");
});

test("unused variable in if-init is an error", () => {
	const { errors } = compile(`package main
func main() {
  if x := 1; true {
    console.log("yes")
  }
}`);
	assertErrorContains(errors, "'x' declared and not used");
});

test("used variable in if-init is fine", () => {
	const { js } = compile(`package main
func main() {
  if x := 1; x > 0 {
    console.log("positive")
  }
}`);
	assertEqual(runJs(js), "positive");
});

test("unused variable inside for body is an error", () => {
	const { errors } = compile(`package main
func main() {
  for i := 0; i < 1; i++ {
    y := 99
  }
}`);
	assertErrorContains(errors, "'y' declared and not used");
});

test("function params are not flagged as unused", () => {
	const { js } = compile(`package main
func f(x int) {
  console.log("ok")
}
func main() {
  f(1)
}`);
	assertEqual(runJs(js), "ok");
});

test("unused const is not flagged", () => {
	const { js } = compile(`package main
func main() {
  const c = 42
  console.log("ok")
}`);
	assertEqual(runJs(js), "ok");
});

test("multiple unused variables reported", () => {
	const { errors } = compile(`package main
func main() {
  a := 1
  b := 2
}`);
	assertErrorContains(errors, "'a' declared and not used");
	assertErrorContains(errors, "'b' declared and not used");
});

test("circular type alias does not crash", () => {
	const { errors } = compile(`package main
type A = B
type B = A
func main() {}`);
	assertErrorContains(errors, "Unknown type");
});

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
