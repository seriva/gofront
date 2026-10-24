// GoFront test suite — fmt Stringer / error dispatch for %v and %s (JS backend)

import { fileURLToPath } from "node:url";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

function run(body, decls = "") {
	const { js, errors } = compile(`package main
import "fmt"
${decls}
func main() {
${body}
}`);
	assertEqual(errors.length, 0, errors.join("\n"));
	return runJs(js);
}

const TYPES = `
type Color int
const (
	Red Color = iota
	Green
)
func (c Color) String() string {
	if c == Red {
		return "red"
	}
	return "green"
}
type Point struct{ X, Y int }
func (p Point) String() string { return fmt.Sprintf("(%d,%d)", p.X, p.Y) }
type Counter struct{ N int }
func (c *Counter) String() string { return fmt.Sprintf("counter=%d", c.N) }
type ValErr struct{ Msg string }
func (e ValErr) Error() string { return "valerr " + e.Msg }
type PtrErr struct{ Code int }
func (e *PtrErr) Error() string { return fmt.Sprintf("ptrerr %d", e.Code) }
`;

section("fmt Stringer: named non-struct types");

test("a value-receiver String is used by %v, %s and Println", () => {
	assertEqual(
		run(
			`fmt.Println(Green)
fmt.Println(fmt.Sprintf("%v|%s|%d", Green, Red, Green))`,
			TYPES,
		),
		"green\ngreen|red|1",
	);
});

test("Sprint and Sprintf use String", () => {
	assertEqual(
		run(
			`fmt.Println(fmt.Sprint(Red, Green), fmt.Sprintf("<%s>", Green))`,
			TYPES,
		),
		"red green <green>",
	);
});

test("width applies to the String result", () => {
	assertEqual(
		run(`fmt.Println(fmt.Sprintf("[%6v][%-6s]", Green, Red))`, TYPES),
		"[ green][red   ]",
	);
});

section("fmt Stringer: value vs pointer receivers");

test("value receiver applies to a value and to a pointer", () => {
	assertEqual(
		run(
			`p := Point{3, 4}
fmt.Println(p, &p, Point{1, 2})
fmt.Println(fmt.Sprintf("%v|%s|%+v", p, &p, p))`,
			TYPES,
		),
		"(3,4) (3,4) (1,2)\n(3,4)|(3,4)|(3,4)",
	);
});

test("pointer receiver applies to a pointer only", () => {
	assertEqual(
		run(
			`c := Counter{5}
fmt.Println(&c)
fmt.Println(c)
fmt.Println(fmt.Sprintf("%v|%s|%v", &c, &c, c))`,
			TYPES,
		),
		"counter=5\n{5}\ncounter=5|counter=5|{5}",
	);
});

test("pointer-receiver Error is not used for the value", () => {
	assertEqual(
		run(
			`e := PtrErr{7}
fmt.Println(&e, e)
var err error = &e
fmt.Println(err)
fmt.Println(fmt.Sprintf("%v|%s", err, err))`,
			TYPES,
		),
		"ptrerr 7 {7}\nptrerr 7\nptrerr 7|ptrerr 7",
	);
});

test("value-receiver Error applies to a value and a pointer", () => {
	assertEqual(
		run(`fmt.Println(ValErr{"x"}, &ValErr{"y"})`, TYPES),
		"valerr x valerr y",
	);
});

test("Error wins over String", () => {
	assertEqual(
		run(
			`fmt.Println(Both{1}, &Both{2})`,
			`type Both struct{ N int }
func (b Both) Error() string  { return "err" }
func (b Both) String() string { return "str" }`,
		),
		"err err",
	);
});

test("a value tagged as a pointer earlier is still a value later", () => {
	assertEqual(
		run(
			`c := Counter{1}
fmt.Println(&c)
fmt.Println(c)
fmt.Println(&c)`,
			TYPES,
		),
		"counter=1\n{1}\ncounter=1",
	);
});

test("String that takes an argument is not a Stringer", () => {
	assertEqual(
		run(
			`fmt.Println(T{1})`,
			`type T struct{ N int }
func (t T) String(prefix string) string { return prefix }`,
		),
		"{1}",
	);
});

test("fmt.Stringer is a usable interface type", () => {
	assertEqual(
		run(
			`c := Counter{5}
var s fmt.Stringer = &c
fmt.Println(s)
s = Red
fmt.Println(s, s.String())`,
			TYPES,
		),
		"counter=5\nred red",
	);
});

section("fmt Stringer: nested values");

test("slices, arrays and maps of named values", () => {
	assertEqual(
		run(
			`fmt.Println([]Color{Red, Green})
fmt.Println([2]Color{Green, Red})
fmt.Println([][]Color{{Red}, {Green, Red}})
fmt.Println(map[string]Color{"a": Green, "b": Red})
fmt.Println(map[Color]int{Green: 1, Red: 2})
fmt.Println(map[string][]Color{"x": {Green}})`,
			TYPES,
		),
		"[red green]\n[green red]\n[[red] [green red]]\nmap[a:green b:red]\nmap[red:2 green:1]\nmap[x:[green]]",
	);
});

test("slices of structs and of errors", () => {
	assertEqual(
		run(
			`fmt.Println([]Point{{1, 2}, {3, 4}})
fmt.Println([]Counter{{1}, {2}})
fmt.Println([]error{&PtrErr{1}, ValErr{"z"}})`,
			TYPES,
		),
		"[(1,2) (3,4)]\n[{1} {2}]\n[ptrerr 1 valerr z]",
	);
});

test("struct fields: exported use String, unexported do not", () => {
	assertEqual(
		run(
			`h := H{Green, Red, Point{1, 2}, Point{3, 4}, []Color{Red}, []Color{Green}}
fmt.Println(h)
fmt.Println(fmt.Sprintf("%+v", h))
fmt.Println(&h)`,
			`${TYPES}
type H struct {
	A Color
	b Color
	P Point
	q Point
	S []Color
	t []Color
}`,
		),
		"{green 0 (1,2) {3 4} [red] [1]}\n" +
			"{A:green b:0 P:(1,2) q:{X:3 Y:4} S:[red] t:[1]}\n" +
			"&{green 0 (1,2) {3 4} [red] [1]}",
	);
});

test("a struct nested in a struct and a pointer field", () => {
	assertEqual(
		run(
			`fmt.Println(Outer{Inner{Green}, &Counter{8}})`,
			`${TYPES}
type Inner struct{ C Color }
type Outer struct {
	I Inner
	P *Counter
}`,
		),
		"{{green} counter=8}",
	);
});

test("a promoted pointer-receiver String is marked in the class metadata", () => {
	// Positional literals and promoted-method calls of embedding structs are
	// not reliable on JS yet, so only the emitted metadata is checked.
	const { js, errors } = compile(`package main
import "fmt"
${TYPES}
type PW struct {
	Counter
	N int
}
type VW struct {
	Point
	N int
}
func main() { fmt.Println(PW{}, VW{}) }`);
	assertEqual(errors.length, 0, errors.join("\n"));
	assertContains(js, 'PW.prototype, "__pr", { value: ["String"] }');
	assert(
		!js.includes('VW.prototype, "__pr"'),
		"value-receiver String is not marked",
	);
});

test("named string and slice types with String", () => {
	assertEqual(
		run(
			`fmt.Println([]Level{"a", "b"}, Words{"x", "y"})`,
			`type Level string
func (l Level) String() string { return "L:" + string(l) }
type Words []string
func (w Words) String() string { return "words" }`,
		),
		"[L:a L:b] words",
	);
});

test("values without String are unchanged", () => {
	assertEqual(
		run(
			`fmt.Println([]int{1, 2}, map[string]int{"a": 1}, P{1}, &P{2}, []string{"a"})
var e error
fmt.Println(e)`,
			"type P struct{ X int }",
		),
		"[1 2] map[a:1] {1} &{2} [a]\n<nil>",
	);
});

section("fmt Stringer: checker");

test("a type missing String does not satisfy fmt.Stringer", () => {
	const { errors } = compile(`package main
import "fmt"
type T struct{}
func main() {
	var s fmt.Stringer = T{}
	fmt.Println(s)
}`);
	assertErrorContains(errors, "does not implement");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
