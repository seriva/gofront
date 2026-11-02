// GoFront test suite — io (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import {
	assertErrorContains,
	assertFourWay,
	compile,
	section,
	test,
} from "../helpers.js";

section("io (Go-source)");

test("readers, writers, copies and wrappers", async () => {
	await assertFourWay(
		`package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

type upper struct{ n int }

func (u *upper) Write(p []byte) (int, error) {
	u.n += len(p)
	fmt.Print(strings.ToUpper(string(p)))
	return len(p), nil
}

type slow struct{ s string }

func (r *slow) Read(p []byte) (int, error) {
	if len(r.s) == 0 {
		return 0, io.EOF
	}
	p[0] = byte(r.s[0])
	r.s = r.s[1:]
	return 1, nil
}

type failW struct{}

func (failW) Write(p []byte) (int, error) { return 0, errors.New("boom") }

func main() {
	b, err := io.ReadAll(bytes.NewReader(nil))
	fmt.Println(len(b), err)
	b, err = io.ReadAll(&io.LimitedReader{R: strings.NewReader("hello"), N: 3})
	fmt.Println(string(b), err)
	p := make([]byte, 10)
	sr := io.NewSectionReader(strings.NewReader("hello world"), 6, 5)
	n, err := sr.Read(p)
	fmt.Println(n, string(p[:n]), err)
	n, err = sr.Read(p)
	fmt.Println(n, err, err == io.EOF)
	fmt.Println(sr.Size())

	var sb strings.Builder
	c, err := io.Copy(&sb, &slow{"abcdef"})
	fmt.Println(c, err, sb.String())
	var buf bytes.Buffer
	c, err = io.CopyN(&buf, strings.NewReader("hello world"), 5)
	fmt.Println(c, err, buf.String())
	c, err = io.CopyN(&buf, strings.NewReader("hi"), 5)
	fmt.Println(c, err)
	nn, err := io.WriteString(&buf, "!!")
	fmt.Println(nn, err, buf.String())
	nn, err = io.WriteString(&upper{}, "shout\\n")
	fmt.Println(nn, err)
	nn, err = io.WriteString(os.Stdout, "stdout\\n")
	fmt.Println(nn, err)
	nn, err = io.WriteString(io.Discard, "gone")
	fmt.Println(nn, err)
	c, err = io.Copy(failW{}, strings.NewReader("x"))
	fmt.Println(c, err)

	full := make([]byte, 4)
	k, err := io.ReadFull(strings.NewReader("ab"), full)
	fmt.Println(k, err, err == io.ErrUnexpectedEOF)
	k, err = io.ReadFull(strings.NewReader(""), full)
	fmt.Println(k, err)
	k, err = io.ReadAtLeast(strings.NewReader("abcdef"), full, 2)
	fmt.Println(k, err)
	k, err = io.ReadAtLeast(strings.NewReader("abcdef"), make([]byte, 1), 2)
	fmt.Println(k, err)

	mr := io.MultiReader(strings.NewReader("ab"), &slow{"cd"}, strings.NewReader("ef"))
	b, err = io.ReadAll(mr)
	fmt.Println(string(b), err)

	var b1, b2 bytes.Buffer
	mw := io.MultiWriter(&b1, &b2)
	fmt.Fprintf(mw, "x=%d", 5)
	io.WriteString(mw, "!")
	fmt.Println(b1.String(), b2.String())

	var tee bytes.Buffer
	tr := io.TeeReader(strings.NewReader("tee"), &tee)
	b, _ = io.ReadAll(tr)
	fmt.Println(string(b), tee.String())

	rc := io.NopCloser(strings.NewReader("nop"))
	b, _ = io.ReadAll(rc)
	fmt.Println(string(b), rc.Close())

	var r io.Reader = strings.NewReader("iface")
	_, isWT := r.(io.WriterTo)
	_, isBR := r.(io.ByteReader)
	_, isSeek := r.(io.Seeker)
	fmt.Println(isWT, isBR, isSeek)
	var w io.Writer = &buf
	_, isSW := w.(io.StringWriter)
	fmt.Println(isSW)

	fmt.Fprintf(&buf, "|%s", "f")
	fmt.Fprintln(&sb, "ln", 1)
	fmt.Fprint(&upper{}, "up\\n")
	fmt.Fprintln(os.Stdout, "to stdout")
	cnt, err := fmt.Fprint(failW{}, "x")
	fmt.Println(cnt, err)
	fmt.Println(buf.String(), sb.String())
	var lr io.Reader = io.LimitReader(strings.NewReader("abcdef"), 4)
	b, _ = io.ReadAll(lr)
	fmt.Println(string(b))
}
`,
		`0 <nil>
hel <nil>
5 world <nil>
0 EOF true
5
6 <nil> abcdef
5 <nil> hello
2 EOF
2 <nil> hellohi!!
SHOUT
6 <nil>
stdout
7 <nil>
4 <nil>
0 boom
2 unexpected EOF true
0 EOF
4 <nil>
0 short buffer
abcdef <nil>
x=5! x=5!
tee tee
nop <nil>
true true true
true
UP
to stdout
0 boom
hellohi!!|f abcdefln 1

abcd
`,
	);
});

test("fmt.Fprint rejects a value that is not an io.Writer", () => {
	const { errors } = compile(`package main
import "fmt"
type NotWriter struct{}
func main() { fmt.Fprintf(NotWriter{}, "x") }`);
	assertErrorContains(errors, "NotWriter does not implement io.Writer");
});

test("io.Pipe reports why it is unavailable", () => {
	const { errors } = compile(`package main
import "io"
func main() { r, w := io.Pipe(); _, _ = r, w }`);
	assertErrorContains(errors, "io.Pipe is not available");
});

test("a value is checked against io.Reader", () => {
	const { errors } = compile(`package main
import "io"
func main() { var r io.Reader = 5; _ = r }`);
	assertErrorContains(errors, "does not implement io.Reader");
});
