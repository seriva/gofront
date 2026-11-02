// GoFront test suite — bytes (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("bytes (Go-source)");

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
	r := bytes.NewReader([]byte{0xff, 'a'})
	ch, sz, err := r.ReadRune()
	fmt.Println(ch, sz, err)
	b, err := r.ReadByte()
	fmt.Println(string(b), err)
	_, err = r.ReadByte()
	fmt.Println(err)
	fmt.Println(r.UnreadByte(), r.Len(), r.Size())

	src := []byte("héllo")
	br := bytes.NewReader(src)
	fmt.Println(br.Len(), br.Size())
	ch, sz, err = br.ReadRune()
	fmt.Println(string(ch), sz, err)
	ch, sz, err = br.ReadRune()
	fmt.Println(string(ch), sz, err)
	fmt.Println(br.UnreadRune(), br.UnreadRune())
	all, err := io.ReadAll(br)
	fmt.Println(string(all), err)
	src[0] = 'J'
	br.Seek(0, io.SeekStart)
	all, _ = io.ReadAll(br)
	fmt.Println(string(all))

	p := make([]byte, 3)
	n, err := br.ReadAt(p, 4)
	fmt.Println(n, string(p[:n]), err)
	n, err = br.ReadAt(p, 6)
	fmt.Println(n, err)
	pos, err := br.Seek(-2, io.SeekEnd)
	fmt.Println(pos, err)
	pos, err = br.Seek(-20, io.SeekCurrent)
	fmt.Println(pos, err)

	var sb strings.Builder
	br.Reset([]byte("reset"))
	m, err := br.WriteTo(&sb)
	fmt.Println(m, err, sb.String())

	empty, err := io.ReadAll(bytes.NewReader(nil))
	fmt.Println(len(empty), err)
	var nilReader bytes.Reader
	n, err = nilReader.Read(p)
	fmt.Println(n, err)

	var rd io.Reader = bytes.NewReader([]byte("iface"))
	_, isWT := rd.(io.WriterTo)
	_, isSeeker := rd.(io.Seeker)
	fmt.Println(isWT, isSeeker)
	lr := io.LimitReader(bytes.NewReader([]byte("limited")), 3)
	l, _ := io.ReadAll(lr)
	fmt.Println(string(l))
	sec := io.NewSectionReader(bytes.NewReader([]byte("0123456789")), 2, 5)
	s, _ := io.ReadAll(sec)
	fmt.Println(string(s), sec.Size())
}
`,
		`65533 1 <nil>
a <nil>
EOF
<nil> 1 2
6 6
h 1 <nil>
é 2 <nil>
<nil> bytes.Reader.UnreadRune: previous operation was not ReadRune
éllo <nil>
Jéllo
2 lo EOF
0 EOF
4 <nil>
0 bytes.Reader.Seek: negative position
5 <nil> reset
0 <nil>
0 EOF
true true
lim
23456 5
`,
	);
});
