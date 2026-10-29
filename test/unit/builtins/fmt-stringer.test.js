// GoFront test suite — fmt Stringer / error dispatch for %v and %s (JS backend)

import { fileURLToPath } from "node:url";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	assertProgramOutput,
	compile,
	compileHybrid,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

function run(body, decls = "", imports = '"fmt"') {
	const { js, errors } = compile(`package main
import (${imports})
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

const PSTYPES = `
type PS struct{ N int }
func (p *PS) String() string { return "ps" }
type PW struct {
	V PS
	v PS
}
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

section("fmt Stringer: runtime errors behind unexported fields");

test("errors.New and Errorf values in unexported fields print their message", () => {
	const out = run(
		`r := Res{1, fmt.Errorf("bad %d", 3), []error{errors.New("e1")}}
fmt.Println(r)
fmt.Println(fmt.Sprintf("%+v", r))
fmt.Println(&r)`,
		`type Res struct {
	val  int
	err  error
	errs []error
}`,
		'"fmt"; "errors"',
	);
	assertEqual(
		out,
		"{1 bad 3 [e1]}\n{val:1 err:bad 3 errs:[e1]}\n&{1 bad 3 [e1]}",
	);
	assert(!out.includes("return"), "function source leaked");
});

test("an embedded error interface is promoted to Error", () => {
	assertEqual(
		run(
			`fmt.Println(EW{errors.New("x"), 1}, &EW{errors.New("y"), 2})
fmt.Println(fmt.Sprintf("%v|%s", EW{errors.New("z"), 3}, EW{errors.New("z"), 3}))
fmt.Println([]EW{{errors.New("a"), 4}})`,
			`type EW struct {
	error
	Code int
}`,
			'"fmt"; "errors"',
		),
		"x y\nz|z\n[a]",
	);
});

test("an embedded fmt.Stringer is promoted to String", () => {
	assertEqual(
		run(
			`fmt.Println(SW{Red, 1})`,
			`${TYPES}
type SW struct {
	fmt.Stringer
	N int
}`,
		),
		"red",
	);
});

test("a declared Error wins over the embedded one", () => {
	assertEqual(
		run(
			`fmt.Println(OW{errors.New("inner")})`,
			`type OW struct{ error }
func (o OW) Error() string { return "outer" }`,
			'"fmt"; "errors"',
		),
		"outer",
	);
});

section("fmt Stringer: %#v");

test("%#v does not call String and prints Go syntax", () => {
	assertEqual(
		run(
			`fmt.Println(fmt.Sprintf("%#v|%v", Green, Green))
fmt.Println(fmt.Sprintf("%#v", []Color{Red, Green}))`,
			TYPES,
		),
		"1|green\n[]main.Color{0, 1}",
	);
});

test("%#v of a struct with a value-receiver String prints Go syntax, not String", () => {
	assertEqual(
		run(
			`fmt.Println(fmt.Sprintf("%#v|%v", VS{1}, VS{1}))`,
			`type VS struct{ n int }
func (v VS) String() string { return fmt.Sprintf("vs%d", v.n) }`,
		),
		"main.VS{n:1}|vs1",
	);
});

section("fmt Stringer: pointer tag does not leak to nested values");

test("a value in a slice stays a value after its address was taken", () => {
	assertEqual(
		run(
			`ps := []PS{{1}, {2}}
fmt.Println(&ps[0])
fmt.Println(ps)
fmt.Println(fmt.Sprintf("%v|%s", ps[1], &ps[1]))`,
			PSTYPES,
		),
		"ps\n[{1} {2}]\n{2}|ps",
	);
});

test("a struct value field stays a value after its address was taken", () => {
	assertEqual(
		run(
			`w := PW{PS{4}, PS{5}}
p := &w.V
fmt.Println(p)
fmt.Println(w)
fmt.Println(&w)
ws := []PW{{PS{1}, PS{2}}}
q := &ws[0].V
fmt.Println(q, ws)`,
			PSTYPES,
		),
		"ps\n{{4} {5}}\n&{{4} {5}}\nps [{{1} {2}}]",
	);
});

test("a pointer slice and a pointer field still dispatch", () => {
	assertEqual(
		run(
			`fmt.Println([]*PS{&PS{1}, &PS{2}}, PH{&PS{3}})`,
			`${PSTYPES}
type PH struct{ P *PS }`,
		),
		"[ps ps] {ps}",
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

test("fmt.Append of nothing onto a nil slice stays nil (P17)", () => {
	const out = run(
		`fmt.Println(fmt.Append(nil) == nil, fmt.Append(nil, "") == nil, fmt.Append(nil, "x") == nil)`,
	);
	assertEqual(out, "true true false");
});

test("a nil pointer with a pointer-receiver String uses it for %v, %s and %q but not %#v", () => {
	const o = run(
		`var p *C
	fmt.Printf("%v|%s|%#v|%q\\n", p, p, p, p)`,
		'type C struct{ n int }\nfunc (c *C) String() string { return "c" }',
	);
	assertEqual(o, 'c|c|<nil>|"c"\n');
});

// Runs `body` (which returns a string) on the js target, as a `both` package
// and on WebAssembly, and returns the result when all three agree.
function allTargets(body, decls = "") {
	const src = `package main
import "fmt"
${decls}
func Main() string {
${body}
}`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	const both = compile(
		`//gofront:target both\n${src}\nfunc main() { fmt.Print(Main()) }`,
	);
	assertEqual(both.errors.length, 0, both.errors.join("\n"));
	assertEqual(runJs(both.js), jsRes);
	return jsRes;
}

const NIL_C = `type C struct{ n int }
func (c *C) String() string { return "c" }`;

section("fmt Stringer: nil pointers (all targets)");

test("nil elements of a pointer slice call a pointer-receiver String", () => {
	assertEqual(allTargets("return fmt.Sprint([]*C{nil, {1}})", NIL_C), "[c c]");
});

test("a nil *G[int] with a pointer-receiver String prints through it", () => {
	assertEqual(
		allTargets(
			`var g *G[int]
	return fmt.Sprint(g) + "|" + fmt.Sprintf("%v|%s", g, []*G[int]{nil, {1}})`,
			`type G[T any] struct{ v T }
func (g *G[T]) String() string { return "g" }`,
		),
		"g|g|[g g]",
	);
});

test("a nil pointer to a type with a value-receiver String prints <nil>", () => {
	assertEqual(
		allTargets(
			`var p *Color
	var v *V
	return fmt.Sprint(p) + "|" + fmt.Sprintf("%v|%s|%v", p, v, []*Color{nil})`,
			`type Color int
func (c Color) String() string { return "col" }
type V struct{ n int }
func (v V) String() string { return "v" }`,
		),
		"<nil>|<nil>|<nil>|[<nil>]",
	);
});

test("nil pointers in maps and struct fields use String and Error", () => {
	assertEqual(
		allTargets(
			`return fmt.Sprint(map[string]*C{"a": nil}, W{}) + "|" + fmt.Sprintf("%s|%q|%v", []*E{nil}, []*E{nil}, W{})`,
			`${NIL_C}
type E struct{ n int }
func (e *E) Error() string { return "e" }
type V struct{ n int }
func (v V) String() string { return "v" }
type W struct{ P *C; Q *V; R *E }`,
		),
		'map[a:c] {c <nil> e}|[e]|["e"]|{c <nil> e}',
	);
});

test("a String that dereferences its nil receiver prints <nil> (js)", () => {
	assertEqual(
		run(
			`var c *C
fmt.Println(fmt.Sprint(c, []*C{nil, {2}}))`,
			`type C struct{ n int }
func (c *C) String() string { return fmt.Sprint("c", c.n) }`,
		),
		"<nil> [<nil> c2]",
	);
});

test("%s and %q reach the String of non-nil pointers in slices and maps", () => {
	assertEqual(
		allTargets(
			`return fmt.Sprintf("%s|%v|%q|%s", []*C{{1}}, []*C{{1}}, []*C{{1}}, map[string]*C{"a": {1}})`,
			NIL_C,
		),
		'[c]|[c]|["c"]|map[a:c]',
	);
});

section("fmt Stringer: through a type parameter (all targets)");

const TP_DECLS = `type Color int
func (c Color) String() string { return "col" }
type P struct{ N int }
func (p P) String() string { return "P!" }
type Pt struct{ N int }
func (p *Pt) String() string { return "Pt!" }
type L []Color
func Show[T any](x T) string { return fmt.Sprint(x) }
func Showf[T any](x T) string { return fmt.Sprintf("%v|%s|%d|%+v", x, x, x, x) }
func Wrap[T any](x T) string { return Show(x) }`;

test("Sprint of a type-parameter value uses the type argument's String", () => {
	assertEqual(allTargets("return Show(Color(2))", TP_DECLS), "col");
});

test("String dispatch through a type parameter covers named, struct, pointer, slice and map arguments", () => {
	assertEqual(
		allTargets(
			`return Show(Color(2)) + " " + Show(P{1}) + " " + Show(&Pt{1}) + " " + Show(L{1}) + " " + Show(map[string]Color{"a": 1}) + " " + Showf(Color(2)) + " " + Showf(P{1}) + " " + Wrap(Color(1)) + " " + Show(3) + " " + Show("s") + " " + Show([]string{"a"})`,
			TP_DECLS,
		),
		"col P! Pt! [col] map[a:col] col|col|2|col P!|P!|{1}|P! col 3 s [a]",
	);
});

test("plain maps, nil slices and pointers print as Go through a type parameter", () => {
	assertEqual(
		allTargets(
			`var ns []int
	var nm map[string]int
	return Show(map[string]int{"a": 1}) + " " + Show([]int{1}) + " " + Show(S{1, map[string]int{"z": 1}}) + " " + Show(ns) + " " + Show(nm) + " " + Show(&S{2, nil})`,
			`type S struct{ A int; M map[string]int }
func Show[T any](x T) string { return fmt.Sprint(x) }`,
		),
		"map[a:1] [1] {1 map[z:1]} [] map[] &{2 map[]}",
	);
});

section(
	"fmt: typed formatting composes with Stringer dispatch (js, both, wasm)",
);

// Runs a whole program on the js target, as a `both` package and on
// WebAssembly and compares with the text real Go printed.
async function realGo(source, expected) {
	const js = compile(source);
	assertEqual(js.errors.length, 0, js.errors.join("\n"));
	let out = "";
	runJs(js.js, {
		console: {
			log: (...a) => {
				out += `${a.join(" ")}\n`;
			},
		},
		process: {
			stdout: {
				write: (t) => {
					out += t;
				},
			},
		},
	});
	assertEqual(out, expected);
	await assertProgramOutput(source, expected);
}

test("Stringers inside containers, typed floats and nil pointers of named types match real Go", async () => {
	await realGo(
		`package main

import "fmt"

type Dir int

func (Dir) String() string { return "D" }

type N2 int

func (n N2) String() string { return [...]string{"N", "E"}[n] }

type NS []int

func (NS) String() string { return "NS" }

type M map[string]int

func (M) String() string { return "M" }

type Temp float64

func (t Temp) String() string { return fmt.Sprintf("%.1f°C", float64(t)) }

type Color int

func (c Color) String() string { return "c" }

type PS struct{ F float64 }

func (p *PS) String() string { return "ps" }

type It struct{ V PS }

func main() {
	fmt.Printf("%s=%v\\n", "k", []Dir{1})
	fmt.Printf("%s %v\\n", "n", []NS{{1}})
	fmt.Printf("%s %v\\n", "n", []M{{"a": 1}})
	fmt.Printf("%q %v\\n", []string{"a"}, []Dir{1})
	fmt.Printf("%s %v\\n", "x", [][]Dir{{1}})
	fmt.Printf("%s %v\\n", "x", [2]Dir{})
	fmt.Printf("%s %v\\n", "x", map[string][]Dir{"a": {1}})
	fmt.Printf("%v|%s\\n", [2]N2{0, 1}, [2]N2{0, 1})
	fmt.Println([]Temp{1.5})
	fmt.Println(map[string]Temp{"a": 3})
	fmt.Println([2]Temp{})
	fmt.Println(map[Dir]float64{1: 0.5})
	fmt.Printf("%v\\n", struct{ T Temp }{1})
	fmt.Println([]float64{1e6, 2.5}, map[string]float64{"a": 1e6})
	var p *Color
	var x any = p
	fmt.Println(x == nil)
	_, ok := x.(*Color)
	fmt.Println(ok)
	switch x.(type) {
	case *Color:
		fmt.Println("ptr")
	default:
		fmt.Println("default")
	}
	var s fmt.Stringer = p
	fmt.Println(s == nil)
	fmt.Println(p)
	it := It{PS{2}}
	fmt.Println(&it.V, it.V)
}
`,
		`k=[D]
n [NS]
n [M]
["a"] [D]
x [[D]]
x [D D]
x map[a:[D]]
[N E]|[N E]
[1.5°C]
map[a:3.0°C]
[0.0°C 0.0°C]
map[D:0.5]
{1.0°C}
[1e+06 2.5] map[a:1e+06]
false
true
ptr
false
<nil>
ps {2}
`,
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
