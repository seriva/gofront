// GoFront test suite — strings (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("strings (Go-source)");

test("Reader reads, seeks and unreads like Go", async () => {
	await assertFourWay(
		`package main

import (
	"bytes"
	"fmt"
	"io"
	"strings"
)

func main() {
	r := strings.NewReader("héllo wörld")
	fmt.Println(r.Len(), r.Size())
	b, err := r.ReadByte()
	fmt.Println(b, err)
	fmt.Println(r.UnreadByte(), r.UnreadByte())
	ch, sz, err := r.ReadRune()
	fmt.Println(string(ch), sz, err)
	ch, sz, err = r.ReadRune()
	fmt.Println(string(ch), sz, err, r.Len())
	fmt.Println(r.UnreadRune(), r.UnreadRune())
	pos, err := r.Seek(-5, io.SeekEnd)
	fmt.Println(pos, err)
	rest, err := io.ReadAll(r)
	fmt.Println(string(rest), err, r.Len())
	pos, err = r.Seek(1, io.SeekStart)
	fmt.Println(pos, err)
	pos, err = r.Seek(2, io.SeekCurrent)
	fmt.Println(pos, err)
	_, err = r.Seek(-10, io.SeekStart)
	fmt.Println(err)
	_, err = r.Seek(0, 9)
	fmt.Println(err)

	p := make([]byte, 4)
	n, err := r.ReadAt(p, 7)
	fmt.Println(n, string(p[:n]), err)
	n, err = r.ReadAt(p, 100)
	fmt.Println(n, err)
	n, err = r.ReadAt(p, -1)
	fmt.Println(n, err)
	n, err = r.ReadAt(p, 11)
	fmt.Println(n, err)

	var buf bytes.Buffer
	r.Reset("fresh")
	m, err := r.WriteTo(&buf)
	fmt.Println(m, err, buf.String(), r.Len())
	m, err = r.WriteTo(&buf)
	fmt.Println(m, err)

	var zero strings.Reader
	n, err = zero.Read(p)
	fmt.Println(n, err, zero.Len(), zero.Size())

	r2 := strings.NewReader("abcdef")
	small := make([]byte, 4)
	for {
		n, err := r2.Read(small)
		fmt.Println(n, string(small[:n]), err)
		if err != nil {
			break
		}
	}
	data, _ := io.ReadAll(strings.NewReader(""))
	fmt.Println(len(data), data == nil)

	var rr io.Reader = strings.NewReader("x")
	_, isSeeker := rr.(io.Seeker)
	_, isRS := rr.(io.RuneScanner)
	_, isBS := rr.(io.ByteScanner)
	_, isRA := rr.(io.ReaderAt)
	fmt.Println(isSeeker, isRS, isBS, isRA)

	e := strings.NewReader("日本語")
	for {
		c, size, err := e.ReadRune()
		if err != nil {
			fmt.Println(err)
			break
		}
		fmt.Print(string(c), size, " ")
	}
	var sr io.ReadSeeker = strings.NewReader("seek")
	sr.Seek(2, io.SeekStart)
	tail, _ := io.ReadAll(sr)
	fmt.Println(string(tail))
}
`,
		`13 13
104 <nil>
<nil> strings.Reader.UnreadByte: at beginning of string
h 1 <nil>
é 2 <nil> 10
<nil> strings.Reader.UnreadRune: previous operation was not ReadRune
8 <nil>
örld <nil> 0
1 <nil>
3 <nil>
strings.Reader.Seek: negative position
strings.Reader.Seek: invalid whence
4 wör <nil>
0 EOF
0 strings.Reader.ReadAt: negative offset
2 EOF
5 <nil> fresh 0
0 <nil>
0 EOF 0 0
4 abcd <nil>
2 ef <nil>
0  EOF
0 false
true true true true
日3 本3 語3 EOF
ek
`,
	);
});

test("Replacer follows argument order and Go's empty-match rule", async () => {
	await assertFourWay(
		`package main

import (
	"bytes"
	"fmt"
	"strings"
)

type failWriter struct{ left int }

func (f *failWriter) Write(p []byte) (int, error) {
	if len(p) > f.left {
		n := f.left
		f.left = 0
		return n, fmt.Errorf("full")
	}
	f.left -= len(p)
	return len(p), nil
}

func main() {
	fmt.Println(strings.NewReplacer("a", "1", "b", "2").Replace("abcab"))
	fmt.Println(strings.NewReplacer("ab", "1", "a", "2", "bc", "3").Replace("abc"))
	fmt.Println(strings.NewReplacer("a", "1", "ab", "2").Replace("abab"))
	fmt.Println(strings.NewReplacer("a", "1", "a", "2").Replace("aa"))
	fmt.Println(strings.NewReplacer("a", "1", "", "X").Replace("ab"))
	fmt.Println(strings.NewReplacer("", "X").Replace("ab"))
	fmt.Println(strings.NewReplacer("", "X").Replace(""))
	fmt.Println(strings.NewReplacer("", "X", "a", "1").Replace("a"))
	fmt.Println(strings.NewReplacer("<", "&lt;", ">", "&gt;", "&", "&amp;").Replace("<a & b>"))
	fmt.Println(strings.NewReplacer("a", "").Replace("banana"))
	fmt.Println(strings.NewReplacer("日", "sun", "本", "base").Replace("日本語"))
	fmt.Println(strings.NewReplacer().Replace("same"))
	var zero strings.Replacer
	fmt.Println(zero.Replace("zero"))

	r := strings.NewReplacer("a", "1", "b", "22", "<", "&lt;")
	var buf bytes.Buffer
	n, err := r.WriteString(&buf, "abc<abc")
	fmt.Println(n, err, buf.String())
	var sb strings.Builder
	n, err = r.WriteString(&sb, "")
	fmt.Println(n, err, sb.String())
	n, err = r.WriteString(&sb, "ba")
	fmt.Println(n, err, sb.String())
	n, err = r.WriteString(&failWriter{left: 3}, "abababab")
	fmt.Println(n, err)

	func() {
		defer func() { fmt.Println("recovered:", recover()) }()
		strings.NewReplacer("a")
	}()
	args := []string{"x", "y"}
	rr := strings.NewReplacer(args...)
	args[0] = "q"
	fmt.Println(rr.Replace("xq"))
}
`,
		`12c12
1c
1b1b
11
1XbX
XaXbX
X
X1X
&lt;a &amp; b&gt;
bnn
sunbase語
same
zero
12 <nil> 122c&lt;122c
0 <nil> 
3 <nil> 221
3 full
recovered: strings.NewReplacer: odd argument count
yq
`,
	);
});
