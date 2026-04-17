import {
	assertContains,
	assertEqual,
	assertErrorContains,
	compile,
	Lexer,
	runJs,
	section,
	test,
} from "../helpers.js";

// ── Phase 1 — Lexer ─────────────────────────────────────────

section("Complex: Lexer — imaginary literals");

test("lexer: 3i produces IMAG token", () => {
	const tokens = new Lexer("3i").tokenize();
	assertEqual(tokens[0].type, "IMAG");
	assertEqual(tokens[0].value, "3");
});

test("lexer: 1.5i produces IMAG token", () => {
	const tokens = new Lexer("1.5i").tokenize();
	assertEqual(tokens[0].type, "IMAG");
	assertEqual(tokens[0].value, "1.5");
});

test("lexer: 0i produces IMAG token", () => {
	const tokens = new Lexer("0i").tokenize();
	assertEqual(tokens[0].type, "IMAG");
	assertEqual(tokens[0].value, "0");
});

test("lexer: 1_000i strips underscores", () => {
	const tokens = new Lexer("1_000i").tokenize();
	assertEqual(tokens[0].type, "IMAG");
	assertEqual(tokens[0].value, "1000");
});

test("lexer: semicolon inserted after imaginary literal", () => {
	const tokens = new Lexer("3i\n").tokenize();
	assertEqual(tokens[0].type, "IMAG");
	assertEqual(tokens[1].type, ";");
});

// ── Phase 2–3 — Types and parsing ───────────────────────────

section("Complex: Types and parsing");

test("complex128 is a valid type", () => {
	const { errors } = compile(`package main
func main() {
	var z complex128
	_ = z
}`);
	assertEqual(errors.length, 0);
});

test("complex64 is a valid type", () => {
	const { errors } = compile(`package main
func main() {
	var z complex64
	_ = z
}`);
	assertEqual(errors.length, 0);
});

test("imaginary literal has untyped complex type", () => {
	const { errors } = compile(`package main
func main() {
	z := 3i
	_ = z
}`);
	assertEqual(errors.length, 0);
});

test("var z complex128 zero value", () => {
	const { js, errors } = compile(`package main
func main() {
	var z complex128
	println(z)
}`);
	assertEqual(errors.length, 0);
	assertContains(js, "re: 0, im: 0");
});

// ── Phase 4 — Builtins ──────────────────────────────────────

section("Complex: Builtins");

test("complex(r, i) compiles and runs", () => {
	const { js, errors } = compile(`package main
func main() {
	z := complex(3, 4)
	println(real(z), imag(z))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3 4");
});

test("real(z) returns float64", () => {
	const { js, errors } = compile(`package main
func main() {
	z := complex(5, 7)
	r := real(z)
	println(r)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("imag(z) returns float64", () => {
	const { js, errors } = compile(`package main
func main() {
	z := complex(5, 7)
	i := imag(z)
	println(i)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "7");
});

test("error: complex() with wrong number of args", () => {
	const { errors } = compile(`package main
func main() {
	z := complex(1)
	_ = z
}`);
	assertErrorContains(errors, "complex() requires exactly 2 arguments");
});

test("error: real() on non-complex type", () => {
	const { errors } = compile(`package main
func main() {
	x := 5
	r := real(x)
	_ = r
}`);
	assertErrorContains(errors, "cannot use int as complex in real()");
});

test("error: imag() on non-complex type", () => {
	const { errors } = compile(`package main
func main() {
	x := "hello"
	i := imag(x)
	_ = i
}`);
	assertErrorContains(errors, "cannot use string as complex in imag()");
});

test("error: complex() with non-numeric args", () => {
	const { errors } = compile(`package main
func main() {
	z := complex("a", "b")
	_ = z
}`);
	assertErrorContains(errors, "as float in complex()");
});

// ── Phase 5 — Arithmetic and codegen ────────────────────────

section("Complex: Arithmetic and codegen");

test("complex addition", () => {
	const { js, errors } = compile(`package main
func main() {
	a := complex(1, 2)
	b := complex(3, 4)
	c := a + b
	println(real(c), imag(c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "4 6");
});

test("complex subtraction", () => {
	const { js, errors } = compile(`package main
func main() {
	a := complex(5, 7)
	b := complex(2, 3)
	c := a - b
	println(real(c), imag(c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3 4");
});

test("complex multiplication", () => {
	const { js, errors } = compile(`package main
func main() {
	a := complex(1, 2)
	b := complex(3, 4)
	c := a * b
	println(real(c), imag(c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "-5 10");
});

test("complex division", () => {
	const { js, errors } = compile(`package main
func main() {
	a := complex(10, 0)
	b := complex(2, 0)
	c := a / b
	println(real(c), imag(c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5 0");
});

test("complex equality", () => {
	const { js, errors } = compile(`package main
func main() {
	a := complex(1, 2)
	b := complex(1, 2)
	if a == b {
		println("equal")
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "equal");
});

test("complex inequality", () => {
	const { js, errors } = compile(`package main
func main() {
	a := complex(1, 2)
	b := complex(3, 4)
	if a != b {
		println("not equal")
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "not equal");
});

test("error: complex less-than comparison", () => {
	const { errors } = compile(`package main
func main() {
	a := complex(1, 2)
	b := complex(3, 4)
	if a < b {
		println("less")
	}
}`);
	assertErrorContains(errors, "invalid operation");
});

test("error: complex modulo", () => {
	const { errors } = compile(`package main
func main() {
	a := complex(1, 2)
	b := complex(3, 4)
	c := a % b
	_ = c
}`);
	assertErrorContains(errors, "invalid operation");
});

test("real + imaginary literal produces complex", () => {
	const { js, errors } = compile(`package main
func main() {
	z := 1 + 2i
	println(real(z), imag(z))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 2");
});

test("int * complex promotes int to complex", () => {
	const { js, errors } = compile(`package main
func main() {
	z := complex(1, 2)
	w := 3 * z
	println(real(w), imag(w))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3 6");
});

// ── Phase 6 — Formatting ────────────────────────────────────

section("Complex: Formatting");

test("fmt.Sprintf %v formats complex", () => {
	const { js, errors } = compile(`package main
import "fmt"
func main() {
	z := complex(3, 4)
	s := fmt.Sprintf("%v", z)
	println(s)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "(3+4i)");
});

test("fmt.Sprintf %v formats complex with negative imag", () => {
	const { js, errors } = compile(`package main
import "fmt"
func main() {
	z := complex(1, -2)
	s := fmt.Sprintf("%v", z)
	println(s)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "(1-2i)");
});

// ── Phase 7 — Conversions ───────────────────────────────────

section("Complex: Conversions");

test("complex128(intVal) wraps as complex", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 5
	z := complex128(x)
	println(real(z), imag(z))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5 0");
});

test("complex64 to complex128 conversion", () => {
	const { js, errors } = compile(`package main
func main() {
	var z complex64 = complex(1, 2)
	w := complex128(z)
	println(real(w), imag(w))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 2");
});

test("error: float64(complexVal) rejected", () => {
	const { errors } = compile(`package main
func main() {
	z := complex(1, 2)
	f := float64(z)
	_ = f
}`);
	assertErrorContains(errors, "use real() or imag()");
});

// ── Phase 8 — Compound assignment ───────────────────────────

section("Complex: Compound assignment");

test("+= on complex variable", () => {
	const { js, errors } = compile(`package main
func main() {
	z := complex(1, 2)
	z += complex(3, 4)
	println(real(z), imag(z))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "4 6");
});

test("*= on complex variable", () => {
	const { js, errors } = compile(`package main
func main() {
	z := complex(1, 2)
	z *= complex(3, 4)
	println(real(z), imag(z))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "-5 10");
});

// ── End-to-end ──────────────────────────────────────────────

section("Complex: End-to-end");

test("complex conjugate function", () => {
	const { js, errors } = compile(`package main
func conj(z complex128) complex128 {
	return complex(real(z), -imag(z))
}
func main() {
	z := complex(3, 4)
	c := conj(z)
	println(real(c), imag(c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3 -4");
});

test("complex absolute value via real and imag", () => {
	const { js, errors } = compile(`package main
func abs(z complex128) float64 {
	r := real(z)
	i := imag(z)
	return r*r + i*i
}
func main() {
	z := complex(3, 4)
	println(abs(z))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "25");
});

test("untyped int assigned to complex128 var", () => {
	const { js, errors } = compile(`package main
func main() {
	var z complex128 = 5
	println(real(z), imag(z))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5 0");
});

test("imaginary literal multiplication", () => {
	const { js, errors } = compile(`package main
func main() {
	z := 1 + 2i
	w := z * 3i
	println(real(w), imag(w))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "-6 3");
});

test("unary minus on complex", () => {
	const { js, errors } = compile(`package main
func main() {
	z := complex(3, 4)
	w := -z
	println(real(w), imag(w))
}`);
	assertEqual(errors.length, 0);
	// -z should negate both parts: -3, -4
	// Actually with current impl, unary minus on complex object won't work trivially
	// Let's handle via the unary check allowing complex
	assertEqual(runJs(js), "-3 -4");
});
