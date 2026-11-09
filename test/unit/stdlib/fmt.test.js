// GoFront test suite — fmt (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("fmt (Go-source)");

test("Fprint family writes through io.Writer", async () => {
	await assertFourWay(
		`package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"strings"
)

type counter struct{ n int }

func (c *counter) Write(p []byte) (int, error) {
	c.n += len(p)
	os.Stdout.Write(p)
	return len(p), nil
}

type upper struct{ w io.Writer }

func (u upper) Write(p []byte) (int, error) {
	return u.w.Write(bytes.ToUpper(p))
}

func main() {
	var buf bytes.Buffer
	var sb strings.Builder
	n, err := fmt.Fprintf(&buf, "%d-%s|", 7, "x")
	fmt.Println(n, err)
	n, err = fmt.Fprintln(&sb, "a", 1, true)
	fmt.Println(n, err)
	n, err = fmt.Fprint(&sb, "b", 2, "c")
	fmt.Println(n, err)
	fmt.Println(buf.String(), sb.String())

	c := &counter{}
	fmt.Fprintf(c, "hello %v\\n", []int{1, 2})
	fmt.Fprintln(c, "world")
	fmt.Fprint(c, "end\\n")
	fmt.Println(c.n)

	n, err = fmt.Fprintf(os.Stdout, "stdout %s\\n", "ok")
	fmt.Println(n, err)

	var w io.Writer = &buf
	fmt.Fprintf(w, "via iface %d", 1)
	fmt.Println(buf.String())

	u := upper{&buf}
	fmt.Fprintf(u, "loud %s", "abc")
	fmt.Println(buf.String())

	n, err = fmt.Fprintf(io.Discard, "%d", 12345)
	fmt.Println(n, err)
	mw := io.MultiWriter(&buf, &sb)
	fmt.Fprintf(mw, "[%s]", "both")
	fmt.Println(buf.String())
	fmt.Println(sb.String())
}
`,
		`4 <nil>
9 <nil>
3 <nil>
7-x| a 1 true
b2c
hello [1 2]
world
end
22
stdout ok
10 <nil>
7-x|via iface 1
7-x|via iface 1LOUD ABC
5 <nil>
7-x|via iface 1LOUD ABC[both]
a 1 true
b2c[both]
`,
	);
});

test("Fprint spaces non-string operands and %#v calls GoString", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strings"
)

type T struct{}

func (T) GoString() string { return "pkg.T" }

func main() {
	var sb strings.Builder
	n, _ := fmt.Fprint(&sb, "b", 2, 3, "c")
	fmt.Println(n, sb.String())
	fmt.Printf("%#v\\n", T{})
}
`,
		`5 b2 3c
pkg.T
`,
	);
});

test("Print, Sprint, Fprint and Append format every kind like Go", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

type Celsius float64

func (c Celsius) String() string { return fmt.Sprintf("%.1f°C", float64(c)) }

type Point struct{ X, Y int }

type Named struct {
	Name string
	Pt   *Point
	Temp Celsius
	tags []string
	m    map[string]int
}

type Shape interface{ Area() int }

type Rect struct{ W, H int }

func (r Rect) Area() int { return r.W * r.H }

type GoS struct{ n int }

func (g GoS) GoString() string { return "GoS!" }

func two() (int, string) { return 4, "x" }

func main() {
	fmt.Println("hi", 3, true, 2.5, float32(1e6), 1e6, uint8(200), int64(-5), 'a', 3.0)
	fmt.Println(Point{1, 2}, &Point{3, 4}, Celsius(36.6), []Celsius{1, 2.5}, [2]bool{true})
	fmt.Println(map[string]int{"b": 2, "a": 1}, map[Point]string{{2, 1}: "b", {1, 9}: "a"})
	fmt.Println(Named{"n", nil, 20, []string{"a"}, nil}, []Shape{Rect{2, 3}}, GoS{1})
	var x any = Point{5, 6}
	var e error = errors.New("boom")
	var np *Point
	var sh Shape
	fmt.Println(x, e, np, sh, nil, []any{1, "a", nil, 2.5, Point{1, 1}})
	fmt.Println(two())
	fmt.Println(fmt.Sprint("a", 1, 2, "b", "c", 3.5, 4), fmt.Sprint(), fmt.Sprintln("a", 1)+"|")
	var sb strings.Builder
	n, err := fmt.Fprintln(&sb, "to builder", Point{7, 8})
	fmt.Print(sb.String(), n, err, "\\n")
	fmt.Fprint(os.Stdout, "stdout ", 1, 2, "\\n")
	b := fmt.Append([]byte("x:"), 1, "a", 2, 3)
	b = fmt.Appendln(b, Point{1, 2})
	fmt.Print(string(b))
	fmt.Println([]byte("hi"), [3]byte{1, 2, 3}, []string{"a b", "c"}, struct {
		A int
		B string
	}{1, "z"})
	fmt.Println(int8(-3), uint64(1<<63), uintptr(7), complex(1, -2), complex64(complex(0.5, 2)))
	fmt.Println(float32(0.1), 0.1, 100000.0, 1234567.0, 1e21, 1e-5, -0.0)
}
`,
		`hi 3 true 2.5 1e+06 1e+06 200 -5 97 3
{1 2} &{3 4} 36.6°C [1.0°C 2.5°C] [true false]
map[a:1 b:2] map[{1 9}:a {2 1}:b]
{n <nil> 20.0°C [a] map[]} [{2 3}] {1}
{5 6} boom <nil> <nil> <nil> [1 a <nil> 2.5 {1 1}]
4 x
a1 2bc3.5 4  a 1
|
to builder {7 8}
17 <nil>
stdout 1 2
x:1a2 3{1 2}
[104 105] [1 2 3] [a b c] {1 z}
-3 9223372036854775808 7 (1-2i) (0.5+2i)
0.1 0.1 100000 1.234567e+06 1e+21 1e-05 0
`,
	);
});

test("a local variable named like a user type is a value in the standard library", async () => {
	// strconv's float formatting has a local named upper; the user's type
	// of that name must not turn it into a type reference.
	await assertFourWay(
		`package main

import "fmt"

type upper struct{ n int }

func main() {
	fmt.Println(0.1, 1e21, upper{1})
}
`,
		`0.1 1e+21 {1}
`,
	);
});

test("%p of maps and slices, %w outside Errorf and a verb that does not fit errors.New", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"
	"strings"
)

type M map[string]int

func main() {
	fmt.Println(fmt.Sprintf("%p", map[string]int(nil)), fmt.Sprintf("%p", []int(nil)), fmt.Sprintf("%p", []byte(nil)))
	m := map[string]int{"a": 1}
	s := []int{1, 2}
	var x any = s
	a, c := fmt.Sprintf("%p", m), fmt.Sprintf("%p", s)
	fmt.Println(strings.HasPrefix(a, "0x"), strings.HasPrefix(c, "0x"), a != "0x0", c != "0x0")
	fmt.Println(a == fmt.Sprintf("%p", m), c == fmt.Sprintf("%p", s), a != c, fmt.Sprintf("%p", x) == c, fmt.Sprintf("%p", M(m)) == a)
	fmt.Println(fmt.Sprintf("%p", [2]int{}))
	fmt.Println(fmt.Sprintf("%w", errors.New("e1")))
	fmt.Println(fmt.Sprintf("%d", errors.New("e1")))
	var e error = errors.New("e2")
	fmt.Println(fmt.Sprintf("%t|%w|%s", e, e, e))
	fmt.Println(fmt.Errorf("x: %w", e))
}
`,
		`0x0 0x0 0x0
true true true true
true true true true true
%!p([2]int=[0 0])
%!w(*errors.errorString=&{e1})
&{%!d(string=e1)}
&{%!t(string=e2)}|%!w(*errors.errorString=&{e2})|e2
x: e2
`,
	);
});

test("generic struct values built inside generic functions print with their type", async () => {
	await assertFourWay(
		`package main

import "fmt"

type Box[T any] struct{ V T }

func wrap[T any](v T) any { return Box[T]{v} }
func outer[T any](v T) any { return wrap(v) }
func ptr[T any](v T) any { return &Box[T]{v} }

func main() {
	fmt.Println(wrap(1.5))
	fmt.Printf("%T\\n", wrap(2))
	fmt.Printf("%T %v\\n", outer("s"), outer(true))
	fmt.Printf("%T %v\\n", wrap(Box[int]{3}), wrap(Box[int]{3}))
	fmt.Printf("%v %T\\n", ptr(4), ptr(4))
}
`,
		`{1.5}
main.Box[int]
main.Box[string] {true}
main.Box[main.Box[int]] {{3}}
&{4} *main.Box[int]
`,
	);
});
