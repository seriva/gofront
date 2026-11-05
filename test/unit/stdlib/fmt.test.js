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
