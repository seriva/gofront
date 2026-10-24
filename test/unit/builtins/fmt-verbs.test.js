// GoFront test suite — fmt verbs: %T, %U, %q on runes, %#v, flags, %[n] and
// %*d, 64-bit integers and the MISSING/EXTRA forms (both backends)

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	compile,
	compileHybrid,
	instantiateWasm,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

function runJsBody(body, decls = "") {
	const { js, errors } = compile(`package main
import "fmt"
${decls}
func main() {
${body}
}`);
	assertEqual(errors.length, 0, errors.join("\n"));
	return runJs(js);
}

// Runs `body` (which returns a string) on the JS and the WASM backend and
// returns the shared result.
function parity(body, decls = "") {
	const src = `package main
import "fmt"
${decls}
func Main() string {
${body}
}`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	return jsRes;
}

section("fmt %p");

test("%p prints %!p(T=value): there are no addresses", () => {
	assertEqual(
		parity(`return fmt.Sprintf("%p|%p", 5, "s")`),
		"%!p(int=5)|%!p(string=s)",
	);
});

test("%p of a pointer prints the bad-verb form with its pointee", () => {
	assertEqual(
		parity(
			`p := &P{1}
	return fmt.Sprintf("%p", p)`,
			"type P struct{ X int }",
		),
		"%!p(*main.P=&{1})",
	);
});

section("fmt %T and %#v");

test("%T uses the static type of each operand", () => {
	assertEqual(
		parity(
			`var r rune = 'x'
	var b byte = 1
	return fmt.Sprintf("%T %T %T %T %T", r, b, 1.5, []string{}, map[string]int{})`,
		),
		"int32 uint8 float64 []string map[string]int",
	);
});

test("%T of an any operand uses the dynamic type", () => {
	assertEqual(
		parity(
			`var a any = P{1}
	var b any = &P{2}
	var c any = "s"
	return fmt.Sprintf("%T %T %T %T", a, b, c, nil)`,
			"type P struct{ X int }",
		),
		"main.P *main.P string <nil>",
	);
});

test("%#v prints Go syntax", () => {
	assertEqual(
		parity(
			`var nilS []int
	return fmt.Sprintf("%#v %#v %#v %#v", P{1, "a"}, []int{1, 2}, map[string]int{"a": 1}, nilS)`,
			"type P struct {\n\tX int\n\tY string\n}",
		),
		'main.P{X:1, Y:"a"} []int{1, 2} map[string]int{"a":1} []int(nil)',
	);
});

section("fmt flags, indexes and widths");

test("%[n] indexes, %*d and %.*f", () => {
	assertEqual(
		parity(
			`return fmt.Sprintf("%[2]d %[1]d|%[3]*d|%.*f", 1, 2, 5, 42, 2, 3.14159)`,
		),
		"2 1|   42|3.14",
	);
});

test("%+d, % d, %#x, %U and %q on runes", () => {
	assertEqual(
		parity(`return fmt.Sprintf("%+d|% d|%#x|%U|%q", 5, 5, 255, 'A', 'x')`),
		"+5| 5|0xff|U+0041|'x'",
	);
});

section("fmt 64-bit integers and operand errors");

test("uint64 above 2^63 formats exactly in WASM", () => {
	const src = `package main
import "fmt"
func Main() string {
	var u uint64 = 1<<63 + 5
	return fmt.Sprintf("%d %x %o", u, u, u)
}`;
	const { wasm, stringTable } = compileHybrid(src);
	const { exports } = instantiateWasm(wasm, { stringTable });
	assertEqual(
		exports.Main(),
		"9223372036854775813 8000000000000005 1000000000000000000005",
	);
	// JS Number precision limit: prints the nearest Number.
	assertEqual(
		runJsBody(`var u uint64 = 1<<63 + 5
	fmt.Println(fmt.Sprintf("%d %x %o", u, u, u))`),
		"9223372036854775808 8000000000000000 1000000000000000000000",
	);
});

test("negative int64 prints a sign, not two's complement, under %x", () => {
	assertEqual(
		parity(
			`var n int64 = -255
	return fmt.Sprintf("%d %x %b", n, n, n)`,
		),
		"-255 -ff -11111111",
	);
});

test("MISSING, EXTRA, BADINDEX and NOVERB forms match Go", () => {
	assertEqual(
		parity(
			`return fmt.Sprintf("%d %s", 1) + "|" + fmt.Sprintf("%d", 1, "a", 2.5) + "|" + fmt.Sprintf("%[3]d", 1) + "|" + fmt.Sprintf("%")`,
		),
		"1 %!s(MISSING)|1%!(EXTRA string=a, float64=2.5)|%!d(BADINDEX)|%!(NOVERB)",
	);
});

test("an unknown verb prints the bad-verb form", () => {
	assertEqual(parity(`return fmt.Sprintf("%z", 3)`), "%!z(int=3)");
});

test("JS: Printf with a wrong-type operand prints the bad-verb form", () => {
	assertEqual(
		runJsBody(`fmt.Printf("%d|%s\\n", "x", 5)`),
		"%!d(string=x)|%!s(int=5)\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
