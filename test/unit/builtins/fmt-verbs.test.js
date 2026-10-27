// GoFront test suite — fmt verbs: %T, %U, %q on runes, %#v, flags, %[n] and
// %*d, 64-bit integers and the MISSING/EXTRA forms (both backends)

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	assertProgramOutput,
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

test("%#08x and %#06o zero-pad accounts for prefix width", () => {
	assertEqual(
		parity(`return fmt.Sprintf("%#08x|%#06o", 255, 10)`),
		"0x0000ff|000012",
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

// ── Real-Go conformance (expected output captured from go run) ──

test("real Go output: fmt/any on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"errors"
	"fmt"
)

type P struct{ A int }

type Color int

func (c Color) String() string { return "color" }

type Named string

func show(v any) {
	fmt.Println(v)
	fmt.Println(fmt.Sprint(v))
	fmt.Printf("%v\\n", v)
}

func main() {
	show(5)
	show("hi")
	show(2.5)
	show(true)
	show(int8(-3))
	show(uint64(1 << 40))
	show(float32(1.5))
	show('x')
	show([]int{1, 2})
	show(P{3})
	show(&P{4})
	show([]string{"a", "b"})
	show(map[string]int{"a": 1})
	show(errors.New("boom"))
	show(Color(1))
	show(Named("n"))
	show([]P{{1}, {2}})
	show([]any{1, "a", nil})
	var n any
	show(n)
	fmt.Println("a", n, 3)

	var a any = 7
	fmt.Printf("%d|%v|%5d|%x\\n", a, a, a, a)
	var c any = Color(1)
	fmt.Printf("%d|%v|%s\\n", c, c, c)

	fmt.Println(fmt.Sprintf("%v", nil))
	fmt.Println(fmt.Sprint(nil), fmt.Sprintln(nil) == "<nil>\\n")
	fmt.Printf("%v %v\\n", nil, a)

	xs := []any{1, "a", 2.5}
	fmt.Println(fmt.Sprintf("%d %s %.1f", xs...))
	fmt.Println(xs...)
	fmt.Print(xs...)
	fmt.Println()
	fmt.Println(fmt.Sprint(xs...), fmt.Sprintln(xs...) == "1 a 2.5\\n")
	args := []any{"x", 4}
	fmt.Printf("%s=%d\\n", args...)
	fmt.Println("pre", xs)

	var e error = errors.New("err")
	var ea any = e
	fmt.Println(ea, e)
	var s fmt.Stringer = Color(0)
	fmt.Println(s)
}
`,
		`5
5
5
hi
hi
hi
2.5
2.5
2.5
true
true
true
-3
-3
-3
1099511627776
1099511627776
1099511627776
1.5
1.5
1.5
120
120
120
[1 2]
[1 2]
[1 2]
{3}
{3}
{3}
&{4}
&{4}
&{4}
[a b]
[a b]
[a b]
map[a:1]
map[a:1]
map[a:1]
boom
boom
boom
color
color
color
n
n
n
[{1} {2}]
[{1} {2}]
[{1} {2}]
[1 a <nil>]
[1 a <nil>]
[1 a <nil>]
<nil>
<nil>
<nil>
a <nil> 3
7|7|    7|7
1|color|color
<nil>
<nil> true
<nil> 7
1 a 2.5
1 a 2.5
1a2.5
1a2.5 true
x=4
pre [1 a 2.5]
err err
color
`,
	);
});

test("real Go output: fmt/basic on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type point struct {
	X, Y int
}

func main() {
	fmt.Println("hello", 42, true, 2.5)
	fmt.Printf("%d|%5d|%-5d|%05d\\n", 7, 7, 7, 7)
	fmt.Printf("%s|%q|%v\\n", "go", "go", "go")
	fmt.Printf("%x|%X|%o|%b\\n", 255, 255, 8, 5)
	fmt.Printf("%.2f|%8.3f|%.1f\\n", 3.14159, 2.5, 1234.5678)
	fmt.Printf("%t|%c\\n", false, 'A')
	fmt.Printf("%v|%+v\\n", point{1, 2}, point{1, 2})
	fmt.Printf("%v|%v\\n", []int{1, 2, 3}, []string{"a", "b"})
	fmt.Printf("%%|%v%%\\n", 50)
	s := fmt.Sprintf("%03d-%s", 9, "x")
	fmt.Println(s, len(s))
	fmt.Print("no newline yet, ")
	fmt.Print("then one")
	fmt.Println()
	fmt.Println(fmt.Sprintf("%v|%6.2f|%-6s|", true, -1.5, "ab"))
}
`,
		`hello 42 true 2.5
7|    7|7    |00007
go|"go"|go
ff|FF|10|101
3.14|   2.500|1234.6
false|A
{1 2}|{X:1 Y:2}
[1 2 3]|[a b]
%|50%
009-x 5
no newline yet, then one
true| -1.50|ab    |
`,
	);
});

test("real Go output: fmt/errors on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	// Missing arguments
	fmt.Println(fmt.Sprintf("%d %s", 1))
	fmt.Println(fmt.Sprintf("%d"))

	// Extra arguments
	fmt.Println(fmt.Sprintf("%d", 1, "a", 2.5))

	// Explicit argument index out of range
	fmt.Println(fmt.Sprintf("%[3]d", 1))
	fmt.Println(fmt.Sprintf("%[0]d", 1))

	// Incomplete format
	fmt.Println(fmt.Sprintf("%"))

	// Unknown verb
	fmt.Println(fmt.Sprintf("%z", 3))
	fmt.Println(fmt.Sprintf("%Y", "str"))
}
`,
		`1 %!s(MISSING)
%!d(MISSING)
1%!(EXTRA string=a, float64=2.5)
%!d(BADINDEX)
%!d(BADINDEX)
%!(NOVERB)
%!z(int=3)
%!Y(string=str)
`,
	);
});

test("real Go output: fmt/print on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"errors"
	"fmt"
	"strings"
)

type name string

func main() {
	// Print adds a space only between two operands when neither is a string.
	fmt.Print("a", "b", 1, 2, "c")
	fmt.Println()
	fmt.Print(1, 2, 3)
	fmt.Println()
	fmt.Print("x", 1, "y", 2.5, true, false, 'a')
	fmt.Println()
	var v any = "s"
	var n any
	fmt.Print(v, 1, v, n, n)
	fmt.Println()
	fmt.Print(name("p"), name("q"), 7)
	fmt.Println()

	// Sprint follows the same rule, Sprintln always separates.
	fmt.Println(fmt.Sprint("a", 1, 2, "b", 3.5, true, false) + "|")
	fmt.Println(fmt.Sprint() + "|")
	fmt.Println(fmt.Sprint("only") + "|")
	fmt.Print(fmt.Sprintln("a", 1, "b", 2, 3))
	fmt.Print(fmt.Sprintln())
	fmt.Println(len(fmt.Sprintln()))

	// Append* write into a []byte.
	b := []byte("x=")
	b = fmt.Append(b, 1, 2, "z")
	b = fmt.Appendf(b, "|%03d|%s", 7, "w")
	b = fmt.Appendln(b, "end", 9)
	fmt.Print(string(b))
	fmt.Println(len(b))
	c := fmt.Append(nil, "n", "m")
	fmt.Println(string(c), len(c))

	// error operands are not strings: Sprint/Print/Append space them.
	e1 := errors.New("a")
	e2 := errors.New("b")
	fmt.Println(fmt.Sprint(e1, e2) + "|")
	fmt.Println(fmt.Sprint(e1, 1, "x", e2) + "|")
	fmt.Println(fmt.Sprint("s", e1, "t") + "|")
	fmt.Print(e1, e2, "z")
	fmt.Println()
	fmt.Println(string(fmt.Append(nil, e1, e2)))

	// Append reuses spare capacity of dst, like append.
	sb := make([]byte, 2, 10)
	sc := fmt.Append(sb, "xy")
	sd := fmt.Append(sb, "zw")
	fmt.Println(len(sc), cap(sc) >= 4, string(sc[2:]), string(sd[2:]))
	hs := []byte("hello")
	hs2 := fmt.Append(hs[:2], "Z")
	fmt.Println(string(hs), string(hs2))
	hs3 := fmt.Appendf(hs[:1], "%s", "J")
	hs4 := fmt.Appendln(hs[:3], "K")
	fmt.Println(string(hs), string(hs3), len(hs4))
	// A full destination reallocates and leaves the original alone.
	fb := []byte("ab")
	fb2 := fmt.Append(fb[:2:2], "cd")
	fmt.Println(string(fb), string(fb2))

	// A result that does not fit in the spare capacity reallocates as a
	// whole: the caller's backing array stays untouched, however the
	// encoded bytes are chunked.
	long := strings.Repeat("k", 10000)
	for _, capacity := range []int{9000, 8192, 8193, 20000, 10000, 9999} {
		lb := make([]byte, 0, capacity)
		full := lb[:cap(lb)]
		for _, fn := range []int{0, 1, 2} {
			var out []byte
			switch fn {
			case 0:
				out = fmt.Append(lb, long)
			case 1:
				out = fmt.Appendf(lb, "%s", long)
			default:
				out = fmt.Appendln(lb, long)
			}
			sum := 0
			for _, x := range full {
				sum += int(x)
			}
			fmt.Println(capacity, fn, len(out), sum)
		}
	}
	// Fits exactly: written in place. One byte too long: untouched.
	base := make([]byte, 10, 20)
	fmt.Println(len(fmt.Append(base, "0123456789")), string(base[:cap(base)][10:20]))
	base2 := make([]byte, 10, 20)
	out2 := fmt.Append(base2, "0123456789A")
	tail := 0
	for _, x := range base2[:cap(base2)][10:20] {
		tail += int(x)
	}
	fmt.Println(len(out2), tail)
}
`,
		`ab1 2c
1 2 3
x1y2.5 true false 97
s1s<nil> <nil>
pq7
a1 2b3.5 true false|
|
only|
a 1 b 2 3

1
x=1 2z|007|wend 9
18
nm 2
a b|
a 1xb|
sat|
a bz
a b
4 true zw zw
heZlo heZ
hJZK
 hJ 5
ab abcd
9000 0 10000 0
9000 1 10000 0
9000 2 10001 0
8192 0 10000 0
8192 1 10000 0
8192 2 10001 0
8193 0 10000 0
8193 1 10000 0
8193 2 10001 0
20000 0 10000 1070000
20000 1 10000 1070000
20000 2 10001 1070010
10000 0 10000 1070000
10000 1 10000 1070000
10000 2 10001 1070000
9999 0 10000 0
9999 1 10000 0
9999 2 10001 0
20 0123456789
21 0
`,
	);
});

test("real Go output: fmt/stringer on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"errors"
	"fmt"
)

type Celsius float64

func (c Celsius) String() string { return fmt.Sprintf("%.1fC", float64(c)) }

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

type MyErr struct{ Code int }

func (e *MyErr) Error() string { return fmt.Sprintf("myerr %d", e.Code) }

type ValErr struct{ Msg string }

func (e ValErr) Error() string { return "valerr " + e.Msg }

type Holder struct {
	P    Point
	C    Color
	Name string
}

type Level string

func (l Level) String() string { return "L:" + string(l) }

type Pair struct {
	A Color
	b Color
	P Point
	q Point
}

type Both struct{ N int }

func (b Both) Error() string  { return "both-error" }
func (b Both) String() string { return "both-string" }

type PtrHolder struct{ C *Counter }

type PS struct{ N int }

func (p *PS) String() string { return "ps" }

type PW struct{ V PS }

type EW struct {
	error
	Code int
}

type NC struct{ N int }

func (c *NC) String() string { return "c" }

type NV struct{ N int }

func (v NV) String() string { return "v" }

type NE struct{ N int }

func (e *NE) Error() string { return "ne" }

func main() {
	fmt.Println(Celsius(36.6), Red, Green)
	fmt.Printf("%v|%s|%d\\n", Green, Green, Green)
	fmt.Println(Point{1, 2})
	p := Point{3, 4}
	fmt.Println(&p)
	fmt.Printf("%v|%s|%+v\\n", p, p, p)

	c := Counter{5}
	fmt.Println(&c)
	fmt.Printf("%v|%s\\n", &c, &c)
	fmt.Println(c)

	var err error = &MyErr{7}
	fmt.Println(err)
	fmt.Printf("%v|%s\\n", err, err)
	fmt.Println(ValErr{"x"}, &ValErr{"y"})
	wrapped := fmt.Errorf("wrap: %w", err)
	fmt.Println(wrapped, errors.Unwrap(wrapped))

	fmt.Println([]Color{Red, Green})
	fmt.Println([]Point{{1, 2}, {3, 4}})
	fmt.Println(map[string]Color{"a": Green, "b": Red})
	fmt.Println(map[Color]int{Green: 1, Red: 2})
	fmt.Println(Holder{Point{5, 6}, Green, "h"})
	fmt.Printf("%+v\\n", Holder{Point{5, 6}, Red, "h"})
	fmt.Println([]error{err, ValErr{"z"}})
	fmt.Println(fmt.Sprint(Red, Green), fmt.Sprintln(Point{0, 0}))
	var a any = Point{9, 9}
	fmt.Println(a)
	var nilErr error
	fmt.Println(nilErr)

	fmt.Printf("[%6v][%-6s][%6s]\\n", Green, Red, Point{1, 2})
	fmt.Println([]Level{"a", "b"}, [2]Color{Red, Green}, [][]Color{{Red}, {Green, Red}})
	fmt.Println(Pair{Red, Green, Point{1, 2}, Point{3, 4}})
	fmt.Printf("%+v\\n", Pair{Green, Red, Point{1, 2}, Point{3, 4}})
	fmt.Println(Both{1}, []Both{{2}})
	fmt.Println([]Counter{{1}, {2}})
	fmt.Println(PtrHolder{&Counter{8}})
	fmt.Println(map[string][]Color{"x": {Green}})
	var s fmt.Stringer = &c
	fmt.Println(s)
	s = Red
	fmt.Println(s, s.String())

	fmt.Printf("%#v|%v\\n", Green, Green)

	ps := []PS{{1}, {2}}
	fmt.Println(&ps[0])
	fmt.Println(ps)
	w := PW{PS{4}}
	pv := &w.V
	fmt.Println(pv)
	fmt.Println(w, &w)
	ws := []PW{{PS{5}}}
	fmt.Println(&ws[0].V, ws)

	fmt.Println(EW{errors.New("x"), 1}, &EW{errors.New("y"), 2})
	fmt.Println([]EW{{errors.New("z"), 3}})
	fmt.Printf("%v|%s\\n", EW{errors.New("v"), 4}, EW{errors.New("s"), 5})

	var nc *NC
	var nv *NV
	var ne *NE
	fmt.Println(nc, nv, ne)
	fmt.Println(fmt.Sprint(nc), fmt.Sprintf("%v|%s", nc, nv))
}
`,
		`36.6C red green
green|green|1
(1,2)
(3,4)
(3,4)|(3,4)|(3,4)
counter=5
counter=5|counter=5
{5}
myerr 7
myerr 7|myerr 7
valerr x valerr y
wrap: myerr 7 myerr 7
[red green]
[(1,2) (3,4)]
map[a:green b:red]
map[red:2 green:1]
{(5,6) green h}
{P:(5,6) C:red Name:h}
[myerr 7 valerr z]
red green (0,0)

(9,9)
<nil>
[ green][red   ][ (1,2)]
[L:a L:b] [red green] [[red] [green red]]
{red 1 (1,2) {3 4}}
{A:green b:0 P:(1,2) q:{X:3 Y:4}}
both-error [both-error]
[{1} {2}]
{counter=8}
map[x:[green]]
counter=5
red red
1|green
ps
[{1} {2}]
ps
{{4}} &{{4}}
ps [{{5}}]
x y
[z]
v|s
c <nil> ne
c c|<nil>
`,
	);
});

test("real Go output: fmt/verbs on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type P struct {
	X int
	Y string
}

type Color int

func (c Color) String() string { return "color" }

type Celsius float64

type Pair struct {
	A, B int
}

func main() {
	// %T on static types
	var i int = 1
	var i8 int8 = 2
	var u uint = 3
	var u64 uint64 = 4
	var f float64 = 1.5
	var f32 float32 = 2.5
	var r rune = 'x'
	var b byte = 7
	fmt.Printf("%T %T %T %T %T %T %T %T\\n", i, i8, u, u64, f, f32, r, b)
	fmt.Printf("%T %T %T\\n", "s", true, nil)
	fmt.Printf("%T %T %T %T\\n", P{}, &P{}, Color(1), Celsius(2))
	fmt.Printf("%T %T %T\\n", []int{1}, map[string]int{}, []string{})
	fmt.Printf("%T %T\\n", [2]int{}, []P{})
	var a any = 5
	var s any = "s"
	var p any = P{1, "a"}
	var pp any = &P{1, "a"}
	fmt.Printf("%T %T %T %T\\n", a, s, p, pp)

	// %U and %c
	fmt.Printf("%U %U %U\\n", 'A', 0x1F600, r)
	fmt.Printf("%#U\\n", 'A')
	fmt.Printf("%c%c\\n", 72, 'i')

	// %q on runes, strings
	fmt.Printf("%q %q %q\\n", 'x', '\\n', r)
	fmt.Printf("%q %q\\n", "hi", "a\\"b")
	fmt.Printf("%q\\n", i)

	// %#v
	fmt.Printf("%#v %#v %#v %#v\\n", 1, "s", 2.5, true)
	fmt.Printf("%#v\\n", P{1, "a"})
	fmt.Printf("%#v\\n", &P{1, "a"})
	fmt.Printf("%#v %#v\\n", []int{1, 2}, []string{"a", "b"})
	fmt.Printf("%#v\\n", map[string]int{"a": 1})
	fmt.Printf("%#v\\n", [2]int{1, 2})
	fmt.Printf("%#v %#v\\n", Color(3), Celsius(2))
	fmt.Printf("%#v\\n", []P{{1, "a"}})
	fmt.Printf("%#v\\n", Pair{1, 2})

	// %#x %#o %#b and friends
	fmt.Printf("%#x %#X %#o %#b\\n", 255, 255, 8, 5)
	fmt.Printf("%x %X %o %b\\n", 255, 255, 8, 5)
	fmt.Printf("%#x\\n", "hi")
	fmt.Printf("% x|%# x\\n", "hi", "hi")

	// %+d and "% d"
	fmt.Printf("%+d %+d %+d\\n", 5, -5, 0)
	fmt.Printf("% d|% d|% d\\n", 5, -5, 0)
	fmt.Printf("%+5d|%-+5d|%+05d\\n", 5, 5, 5)
	fmt.Printf("%+.2f %+.1f\\n", 1.5, -1.5)

	// %x on byte slices and strings
	bs := []byte("hello")
	fmt.Printf("%x %X\\n", bs, bs)
	fmt.Printf("% x\\n", bs)
	fmt.Printf("%x\\n", "hello")
	fmt.Printf("%s %v\\n", bs, bs)

	// %e %E %G
	fmt.Printf("%e %E\\n", 1234.5678, 1234.5678)
	fmt.Printf("%.2e\\n", 1234.5678)
	fmt.Printf("%g %G\\n", 1e21, 1e-7)

	// explicit argument indexes
	fmt.Printf("%[2]d %[1]d\\n", 1, 2)
	fmt.Printf("%[1]d %[1]x %[1]o\\n", 10)
	fmt.Printf("%[2]s %s\\n", "a", "b")

	// width and precision from arguments
	fmt.Printf("%*d|\\n", 5, 42)
	fmt.Printf("%-*d|\\n", 5, 42)
	fmt.Printf("%.*f|\\n", 2, 3.14159)
	fmt.Printf("%*.*f|\\n", 8, 3, 3.14159)

	// %p text is covered by a unit test (addresses differ per run)
	fmt.Printf("%v %d\\n", true, []int{1, 2})
	fmt.Printf("%5t|%-7t|\\n", true, false)
	fmt.Printf("%6.2f|%-8.3f|%08.3f\\n", 3.14159, 2.5, -2.5)
	fmt.Printf("%5s|%-5s|%.2s\\n", "ab", "ab", "abcdef")
	fmt.Printf("%5c|%-3c|\\n", 'x', 'y')
}
`,
		`int int8 uint uint64 float64 float32 int32 uint8
string bool <nil>
main.P *main.P main.Color main.Celsius
[]int map[string]int []string
[2]int []main.P
int string main.P *main.P
U+0041 U+1F600 U+0078
U+0041 'A'
Hi
'x' '\\n' 'x'
"hi" "a\\"b"
'\\x01'
1 "s" 2.5 true
main.P{X:1, Y:"a"}
&main.P{X:1, Y:"a"}
[]int{1, 2} []string{"a", "b"}
map[string]int{"a":1}
[2]int{1, 2}
3 2
[]main.P{main.P{X:1, Y:"a"}}
main.Pair{A:1, B:2}
0xff 0XFF 010 0b101
ff FF 10 101
0x6869
68 69|0x68 0x69
+5 -5 +0
 5|-5| 0
   +5|+5   |+0005
+1.50 -1.5
68656c6c6f 68656C6C6F
68 65 6c 6c 6f
68656c6c6f
hello [104 101 108 108 111]
1.234568e+03 1.234568E+03
1.23e+03
1e+21 1E-07
2 1
10 a 12
b %!s(MISSING)
   42|
42   |
3.14|
   3.142|
true [1 2]
 true|false  |
  3.14|2.500   |-002.500
   ab|ab   |ab
    x|y  |
`,
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
