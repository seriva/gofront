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

test("functions match Go on both targets", async () => {
	await assertFourWay(
		`package main

import (
	"bytes"
	"fmt"
	"unicode/utf8"
)

func show(parts [][]byte) {
	for _, p := range parts {
		fmt.Print("[", string(p), "]")
	}
	fmt.Println(len(parts))
}

func main() {
	fmt.Println(bytes.IndexRune([]byte{'a', 0xff, 'b'}, utf8.RuneError))
	fmt.Println(string(bytes.ToTitle([]byte("hello ǆ"))))
	fmt.Println(bytes.Index([]byte("héllo wörld"), []byte("wö")))
	fmt.Println(bytes.Equal(nil, []byte{}), bytes.Compare([]byte("a"), []byte("b")), bytes.Compare(nil, nil), bytes.Compare([]byte("b"), []byte("a")))
	fmt.Println(bytes.Count([]byte("cheese"), []byte("e")), bytes.Count([]byte("five"), nil))
	show(bytes.Split([]byte("a,b,c"), []byte(",")))
	show(bytes.Fields([]byte("  foo bar  baz   ")))
	fmt.Println(string(bytes.Replace([]byte("oink oink oink"), []byte("k"), []byte("ky"), 2)))
	fmt.Println(string(bytes.Replace([]byte("ab"), nil, []byte("X"), -1)))
	fmt.Println(string(bytes.TrimSpace([]byte(" \\t\\n a lone gopher \\n\\t\\r\\n"))))
	fmt.Println(string(bytes.Trim([]byte("¡¡¡Hello, Gophers!!!"), "!¡")))
	fmt.Println(string(bytes.Map(func(r rune) rune {
		if r == 'a' {
			return -1
		}
		return r + 1
	}, []byte("abc"))))
	fmt.Println(string(bytes.Join([][]byte{[]byte("a"), []byte("b")}, []byte("-"))))
	fmt.Println(string(bytes.Repeat([]byte("na"), 2)))
	fmt.Println(string(bytes.ToUpper([]byte("héllo"))), string(bytes.ToLower([]byte("HÉLLO"))))
	fmt.Println(bytes.LastIndex([]byte("go gopher"), []byte("go")), bytes.LastIndexByte([]byte("abca"), 'a'), bytes.ContainsRune([]byte("abc"), 'b'), bytes.ContainsAny([]byte("abc"), "xyzc"))
	before, after, ok := bytes.Cut([]byte("k=v"), []byte("="))
	fmt.Println(string(before), string(after), ok)
	fmt.Println(string(bytes.ToValidUTF8([]byte{'a', 0xff, 0xfe, 'b'}, []byte("?"))))
	fmt.Println(bytes.HasPrefix([]byte("golang"), []byte("go")), bytes.HasSuffix([]byte("golang"), []byte("ng")), bytes.Contains([]byte("seafood"), []byte("foo")))
}
`,
		`1
HELLO ǅ
7
true -1 0 1
3 5
[a][b][c]3
[foo][bar][baz]3
oinky oinky oink
XaXbX
a lone gopher
Hello, Gophers
cd
a-b
nana
HÉLLO héllo
3 3 true true
k v true
a?b
true true true
`,
	);
});

test("Buffer reads, writes and unreads like Go", async () => {
	await assertFourWay(
		`package main

import (
	"bytes"
	"fmt"
	"io"
	"strings"
)

func main() {
	var b bytes.Buffer
	n, _ := fmt.Fprint(&b, "héé")
	fmt.Println(n, b.Len(), b.String())
	b.WriteByte('!')
	b.WriteRune('世')
	b.WriteString("x")
	b.Write([]byte("yz"))
	fmt.Println(b.String(), b.Len())

	p := make([]byte, 3)
	k, err := b.Read(p)
	fmt.Println(k, err, string(p))
	r, sz, err := b.ReadRune()
	fmt.Println(string(r), sz, err)
	fmt.Println(b.UnreadRune(), b.UnreadRune())
	c, _ := b.ReadByte()
	fmt.Println(c, b.UnreadByte(), b.Len())
	line, err := b.ReadString('x')
	fmt.Println(line, err)
	rest, err := b.ReadString('x')
	fmt.Println(rest, err)
	_, err = b.ReadByte()
	fmt.Println(err)

	b.Reset()
	b.WriteString("0123456789")
	fmt.Println(string(b.Next(4)), b.Len())
	b.Truncate(2)
	fmt.Println(b.String())

	nb := bytes.NewBufferString("abc")
	var sb strings.Builder
	m, _ := nb.WriteTo(&sb)
	fmt.Println(m, sb.String(), nb.Len())

	var rb bytes.Buffer
	m, err = rb.ReadFrom(strings.NewReader("from reader"))
	fmt.Println(m, err, rb.String())
	all, err := io.ReadAll(&rb)
	fmt.Println(string(all), err, rb.Len())

	fmt.Println(string(bytes.NewBuffer([]byte("xy")).Bytes()))

	var a bytes.Buffer
	a.WriteString("x")
	cp := a
	cp.WriteString("y")
	fmt.Println(a.String(), cp.String())
	pa := &a
	pa.WriteString("z")
	var w io.Writer = &a
	w.Write([]byte("!"))
	fmt.Println(a.String())
	bm := map[string]*bytes.Buffer{"k": new(bytes.Buffer)}
	bm["k"].WriteString("v")
	vm := map[string]bytes.Buffer{"k": {}}
	v := vm["k"]
	v.WriteString("q")
	orig := vm["k"]
	fmt.Println(bm["k"].String(), orig.Len(), v.String())
}
`,
		`5 5 héé
héé!世xyz 12
3 <nil> hé
é 2 <nil>
<nil> bytes.Buffer: UnreadRune: previous operation was not a successful ReadRune
195 <nil> 9
é!世x <nil>
yz EOF
EOF
0123 6
45
3 abc 0
11 <nil> from reader
from reader <nil> 0
xy
x xy
xz!
v 0 q
`,
	);
});

test("method call on a nil *bytes.Buffer", async () => {
	await assertFourWay(
		`package main

import (
	"bytes"
	"fmt"
)

func main() {
	var b *bytes.Buffer
	fmt.Println(b.String())
}
`,
		"<nil>\n",
	);
});
