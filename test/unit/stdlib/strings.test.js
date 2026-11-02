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
