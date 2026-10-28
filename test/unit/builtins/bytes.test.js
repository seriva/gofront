// GoFront test suite — bytes standard library shim

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	assertErrorContains,
	assertProgramOutput,
	compile,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

section("bytes package");

test("bytes.Contains", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello world")
	console.log(bytes.Contains(b, []byte("world")))
	console.log(bytes.Contains(b, []byte("xyz")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("bytes.HasPrefix", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello")
	console.log(bytes.HasPrefix(b, []byte("hel")))
	console.log(bytes.HasPrefix(b, []byte("xyz")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("bytes.HasSuffix", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello")
	console.log(bytes.HasSuffix(b, []byte("llo")))
	console.log(bytes.HasSuffix(b, []byte("xyz")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("bytes.Index", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello")
	console.log(bytes.Index(b, []byte("ll")))
	console.log(bytes.Index(b, []byte("xyz")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2\n-1");
});

test("bytes.Join", () => {
	const { js, errors } = compile(`package main
func main() {
	parts := [][]byte{[]byte("a"), []byte("b"), []byte("c")}
	result := bytes.Join(parts, []byte("-"))
	console.log(string(result))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a-b-c");
});

test("bytes.Split", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("a,b,c")
	parts := bytes.Split(b, []byte(","))
	console.log(len(parts))
	console.log(string(parts[0]))
	console.log(string(parts[1]))
	console.log(string(parts[2]))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\na\nb\nc");
});

test("bytes.Replace", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("aaa")
	result := bytes.Replace(b, []byte("a"), []byte("b"), 2)
	console.log(string(result))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "bba");
});

test("bytes.ToUpper", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello")
	console.log(string(bytes.ToUpper(b)))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "HELLO");
});

test("bytes.ToLower", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("HELLO")
	console.log(string(bytes.ToLower(b)))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("bytes.TrimSpace", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("  hello  ")
	console.log(string(bytes.TrimSpace(b)))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("bytes.Equal", () => {
	const { js, errors } = compile(`package main
func main() {
	a := []byte("hello")
	b := []byte("hello")
	c := []byte("world")
	console.log(bytes.Equal(a, b))
	console.log(bytes.Equal(a, c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("bytes.Count", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("banana")
	console.log(bytes.Count(b, []byte("a")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("bytes.Repeat", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("ab")
	console.log(string(bytes.Repeat(b, 3)))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ababab");
});

test("error: bytes.Contains with wrong arg types", () => {
	const { errors } = compile(`package main
func main() {
	bytes.Contains("hello", "world")
}`);
	assertErrorContains(errors, "Cannot assign");
});

// ═════════════════════════════════════════════════════════════
// bytes additions (Feature 5)
// ═════════════════════════════════════════════════════════════

section("bytes additions");

test("bytes.ReplaceAll", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("aaa")
	result := bytes.ReplaceAll(b, []byte("a"), []byte("b"))
	console.log(string(result))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "bbb");
});

test("bytes.TrimPrefix", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello world")
	result := bytes.TrimPrefix(b, []byte("hello "))
	console.log(string(result))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "world");
});

test("bytes.TrimSuffix", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello world")
	result := bytes.TrimSuffix(b, []byte(" world"))
	console.log(string(result))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("bytes.IndexByte", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello")
	console.log(bytes.IndexByte(b, 'l'))
	console.log(bytes.IndexByte(b, 'z'))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2\n-1");
});

test("bytes.LastIndex", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello world hello")
	idx := bytes.LastIndex(b, []byte("hello"))
	console.log(idx)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "12");
});

test("bytes.LastIndexByte", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello")
	console.log(bytes.LastIndexByte(b, 'l'))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("bytes.ContainsAny", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello")
	console.log(bytes.ContainsAny(b, "aeiou"))
	console.log(bytes.ContainsAny(b, "xyz"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("bytes.Map transforms bytes", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte{65, 66, 67}
	result := bytes.Map(func(r rune) rune { return r + 1 }, b)
	console.log(result[0])
	console.log(result[1])
	console.log(result[2])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "66\n67\n68");
});

test("bytes.Cut found", () => {
	const { js, errors } = compile(`package main
func main() {
	before, after, found := bytes.Cut([]byte("user:password"), []byte(":"))
	console.log(string(before))
	console.log(string(after))
	console.log(found)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "user\npassword\ntrue");
});

test("bytes.Cut not found", () => {
	const { js, errors } = compile(`package main
func main() {
	bef, aft, found := bytes.Cut([]byte("hello"), []byte(":"))
	console.log(len(bef))
	console.log(len(aft))
	console.log(found)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5\n0\nfalse");
});

test("bytes.Fields splits on whitespace", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("  foo bar  baz  ")
	f := bytes.Fields(b)
	console.log(len(f))
	console.log(string(f[0]))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\nfoo");
});

test("bytes.SplitN", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("a,b,c,d")
	parts := bytes.SplitN(b, []byte(","), 3)
	console.log(len(parts))
	console.log(string(parts[0]))
	console.log(string(parts[1]))
	console.log(string(parts[2]))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\na\nb\nc,d");
});

test("bytes.Index byte offset with non-ASCII input (P48)", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("héllo")
	console.log(bytes.Index(b, []byte("l")))
	console.log(bytes.Index(b, []byte("é")))
	console.log(bytes.LastIndex(b, []byte("l")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\n1\n4");
});

test("bytes.NewBuffer and NewBufferString", () => {
	const { js, errors } = compile(`package main
import "bytes"
func main() {
	b1 := bytes.NewBuffer([]byte("hello"))
	b2 := bytes.NewBufferString("world")
	console.log(b1.String())
	console.log(b2.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello\nworld");
});

test("bytes.Buffer method gaps", () => {
	const { js, errors } = compile(`package main
import "bytes"
func main() {
	b := bytes.NewBufferString("hello\\nworld\\n")
	ch, _ := b.ReadByte()
	console.log(string(ch))
	_ = b.UnreadByte()
	ch, _ = b.ReadByte()
	console.log(string(ch))
	line, _ := b.ReadString('\n')
	console.log(line)
	nxt := b.Next(3)
	console.log(string(nxt))
	p, _ := b.Peek(2)
	console.log(string(p))
	console.log(b.Len())
	b.Truncate(1)
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "h\nh\nello\n\nwor\nld\n3\nl");
});

test("bytes.ToValidUTF8", () => {
	const { js, errors } = compile(`package main
import "bytes"
func main() {
	res := bytes.ToValidUTF8([]byte{'a', 0xff, 'b'}, []byte("X"))
	console.log(string(res))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "aXb");
});

test("bytes search functions handle nil slices per Go semantics", () => {
	const { js, errors } = compile(`package main
import (
	"bytes"
	"fmt"
)
func main() {
	b := []byte("hello")
	fmt.Println(bytes.Index(b, nil), bytes.Contains(b, nil))
	fmt.Println(bytes.Index(nil, []byte("")), bytes.Contains(nil, []byte("")))
	fmt.Println(bytes.LastIndex(b, nil), bytes.Count(b, nil))
	fmt.Println(bytes.LastIndex(nil, []byte("")), bytes.Count(nil, []byte("")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 true\n0 true\n5 6\n0 1");
});

test("bytes.Buffer.UnreadByte after Read and write resets", () => {
	const { js, errors } = compile(`package main
import (
	"bytes"
	"fmt"
)
func main() {
	buf := bytes.NewBufferString("hello")
	p := make([]byte, 2)
	buf.Read(p)
	err := buf.UnreadByte()
	fmt.Println("unread err:", err != nil)
	b, _ := buf.ReadByte()
	fmt.Println(string(b), b)

	buf.WriteString("xyz")
	err = buf.UnreadByte()
	fmt.Println("unread after write err:", err != nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		"unread err: false\ne 101\nunread after write err: true",
	);
});

// ── Real-Go conformance (expected output captured from go run) ──

test("real Go output: bytes/buffer on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"bytes"
	"fmt"
	"io"
)

func main() {
	b := bytes.NewBufferString("hello world\\nline 2\\n")
	fmt.Println(b.Len())

	buf := make([]byte, 5)
	n, err := b.Read(buf)
	fmt.Printf("%d %s %v\\n", n, string(buf[:n]), err)

	ch, err := b.ReadByte()
	fmt.Printf("%c %v\\n", ch, err)

	err = b.UnreadByte()
	fmt.Println(err == nil)
	ch, err = b.ReadByte()
	fmt.Printf("%c %v\\n", ch, err)

	b2 := bytes.NewBufferString("héllo")
	rn, rsz, err := b2.ReadRune()
	fmt.Printf("%c %d %v\\n", rn, rsz, err)
	err = b2.UnreadRune()
	fmt.Println(err == nil)
	rn, rsz, err = b2.ReadRune()
	fmt.Printf("%c %d %v\\n", rn, rsz, err)

	line, err := b.ReadString('\\n')
	fmt.Printf("%s %v\\n", line, err)

	lineBytes, err := b.ReadBytes('\\n')
	fmt.Printf("%s %v\\n", string(lineBytes), err)

	b3 := bytes.NewBufferString("1234567890")
	nxt := b3.Next(4)
	fmt.Printf("%s %d\\n", string(nxt), b3.Len())

	b3.Truncate(2)
	fmt.Printf("%d %s\\n", b3.Len(), b3.String())

	fmt.Println(b3.Available() >= 0, len(b3.AvailableBuffer()))

	b4 := bytes.NewBufferString("abcdef")
	p, err := b4.Peek(3)
	fmt.Printf("%s %v %d\\n", string(p), err, b4.Len())

	b5 := bytes.NewBuffer([]byte("init slice"))
	fmt.Println(b5.String())

	b5.Reset()
	b5.Grow(10)
	fmt.Println(b5.Len(), b5.Cap() >= 10)

	r := bytes.NewReader([]byte("reader test"))
	fmt.Println(r.Len(), r.Size())
	rb, _ := r.ReadByte()
	fmt.Printf("%c\\n", rb)
	_ = r.UnreadByte()
	rb, _ = r.ReadByte()
	fmt.Printf("%c\\n", rb)
	pos, _ := r.Seek(2, io.SeekStart)
	fmt.Println(pos)
	rbuf := make([]byte, 4)
	rn2, _ := r.ReadAt(rbuf, 0)
	fmt.Printf("%d %s\\n", rn2, string(rbuf[:rn2]))
}
`,
		`19
5 hello <nil>
  <nil>
true
  <nil>
h 1 <nil>
true
h 1 <nil>
world
 <nil>
line 2
 <nil>
1234 6
2 56
true 0
abc <nil> 6
init slice
0 true
11 11
r
r
2
4 read
`,
	);
});

test("real Go output: bytes/index on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"bytes"
	"fmt"
)

func main() {
	b := []byte("héllo")
	fmt.Println(bytes.Index(b, []byte("l")))
	fmt.Println(bytes.Index(b, []byte("é")))
	fmt.Println(bytes.Index(b, []byte("")))
	fmt.Println(bytes.Index(b, []byte("xyz")))
	fmt.Println(bytes.Index([]byte("abcabcabc"), []byte("cab")))
	fmt.Println(bytes.Index([]byte("aaaaaaab"), []byte("aaab")))

	fmt.Println(bytes.LastIndex(b, []byte("l")))
	fmt.Println(bytes.LastIndex(b, []byte("")))
	fmt.Println(bytes.LastIndex([]byte("abcabcabc"), []byte("abc")))

	fmt.Println(bytes.Contains(b, []byte("é")))
	fmt.Println(bytes.Contains(b, []byte("x")))

	fmt.Println(bytes.Count(b, []byte("l")))
	fmt.Println(bytes.Count(b, []byte("")))

	fmt.Println(string(bytes.ToValidUTF8([]byte("abc"), []byte("X"))))
	fmt.Println(string(bytes.ToValidUTF8([]byte{0x61, 0xff, 0x62}, []byte("X"))))
	fmt.Println(string(bytes.ToValidUTF8([]byte{0x61, 0xff, 0xfe, 0x62}, []byte("X"))))
	fmt.Println(string(bytes.ToValidUTF8([]byte{0xff}, []byte(""))))
}
`,
		`3
1
0
-1
2
4
4
6
6
true
false
2
6
abc
aXb
aXb

`,
	);
});

test("real Go output: bytes/search on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"bytes"
	"fmt"
	"unicode"
	"unicode/utf8"
)

func b(s string) []byte { return []byte(s) }

func main() {
	fmt.Println(bytes.Compare(b("a"), b("b")), bytes.Compare(b("b"), b("a")), bytes.Compare(b("abc"), b("abc")))
	fmt.Println(bytes.Compare(b("ab"), b("abc")), bytes.Compare(b("abc"), b("ab")), bytes.Compare(nil, []byte{}))
	fmt.Println(bytes.Compare([]byte{0xff}, []byte{0x7f}))

	fmt.Println(bytes.EqualFold(b("Go"), b("GO")), bytes.EqualFold(b("Go"), b("Gx")), bytes.EqualFold(b("Straße"), b("STRASSE")))
	fmt.Println(bytes.EqualFold(b("Σ"), b("ς")), bytes.EqualFold(b("K"), b("K")), bytes.EqualFold(b("é"), b("É")))
	fmt.Println(bytes.EqualFold([]byte{0xff}, []byte{0xff}), bytes.EqualFold([]byte{0xff}, b("�")), bytes.EqualFold(b("a"), b("ab")))

	h := b("héllo, wörld")
	fmt.Println(bytes.IndexRune(h, 'l'), bytes.IndexRune(h, 'ö'), bytes.IndexRune(h, 'z'), bytes.IndexRune(h, 0xD800), bytes.IndexRune(h, -1))
	inv := []byte{'a', 0xff, 'b', 0xe2, 0x82}
	fmt.Println(bytes.IndexRune(inv, utf8.RuneError), bytes.IndexRune(b("ab"), utf8.RuneError), bytes.IndexRune(b("a�b"), utf8.RuneError))

	fmt.Println(bytes.IndexAny(h, "ö,"), bytes.IndexAny(h, "xyz"), bytes.IndexAny(h, ""), bytes.IndexAny(nil, "a"))
	fmt.Println(bytes.IndexAny(inv, "�"), bytes.IndexAny(inv, "b"), bytes.IndexAny(b("日本語"), "語本"))
	fmt.Println(bytes.LastIndexAny(h, "lo"), bytes.LastIndexAny(h, "é"), bytes.LastIndexAny(h, "xyz"), bytes.LastIndexAny(h, ""))
	fmt.Println(bytes.LastIndexAny(inv, "�"), bytes.LastIndexAny(inv, "a"), bytes.LastIndexAny(b("日本語"), "日本"))

	isUpper := func(r rune) bool { return unicode.IsUpper(r) }
	isRuneErr := func(r rune) bool { return r == utf8.RuneError }
	w := b("abÇdÉf")
	fmt.Println(bytes.IndexFunc(w, isUpper), bytes.LastIndexFunc(w, isUpper), bytes.IndexFunc(b("abc"), isUpper), bytes.LastIndexFunc(nil, isUpper))
	fmt.Println(bytes.IndexFunc(inv, isRuneErr), bytes.LastIndexFunc(inv, isRuneErr))
	fmt.Println(bytes.ContainsFunc(w, isUpper), bytes.ContainsFunc(b("abc"), isUpper), bytes.ContainsFunc(inv, isRuneErr))

	rest, ok := bytes.CutPrefix(b("foobar"), b("foo"))
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutPrefix(b("foobar"), b("bar"))
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutPrefix(b("foo"), nil)
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutPrefix(b("fo"), b("foo"))
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutSuffix(b("foobar"), b("bar"))
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutSuffix(b("foobar"), b("foo"))
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutSuffix(b("foo"), nil)
	fmt.Println(string(rest), ok)
	rest, ok = bytes.CutSuffix(b("oo"), b("foo"))
	fmt.Println(string(rest), ok)
}
`,
		`-1 1 0
-1 1 0
1
true false false
true true true
true true false
3 9 -1 -1 -1
1 -1 1
6 -1 -1 -1
1 2 3
12 1 -1 -1
4 0 3
2 5 -1 -1
1 4
true false true
bar true
foobar false
foo true
fo false
foo true
foobar false
foo true
oo false
`,
	);
});

test("real Go output: bytes/seq on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"bytes"
	"fmt"
	"slices"
	"strings"
	"unicode"
)

// show prints each element of a sequence of byte slices as a quoted string.
func show(label string, parts [][]byte) {
	out := make([]string, len(parts))
	for i, p := range parts {
		out[i] = string(p)
	}
	fmt.Println(label, "["+strings.Join(out, "|")+"]")
}

// vis makes newlines visible: the fmt %q verb does not escape them yet.
func vis(b []byte) string { return "<" + strings.ReplaceAll(string(b), "\\n", "\\\\n") + ">" }

func isDigit(r rune) bool { return unicode.IsDigit(r) }

func main() {
	// Lines keeps the terminators; no line for an empty slice.
	for l := range bytes.Lines([]byte("one\\ntwo\\n\\nthree")) {
		fmt.Println("line", vis(l))
	}
	fmt.Println(len(slices.Collect(bytes.Lines(nil))), len(slices.Collect(bytes.Lines([]byte("\\n")))))

	// SplitSeq / SplitAfterSeq
	show("split", slices.Collect(bytes.SplitSeq([]byte("a,b,,c"), []byte(","))))
	show("after", slices.Collect(bytes.SplitAfterSeq([]byte("a,b,,c"), []byte(","))))
	show("multi", slices.Collect(bytes.SplitSeq([]byte("a--b--c"), []byte("--"))))
	show("empty", slices.Collect(bytes.SplitSeq([]byte(""), []byte(","))))
	show("explode", slices.Collect(bytes.SplitSeq([]byte("abc"), nil)))
	show("explode after", slices.Collect(bytes.SplitAfterSeq([]byte("abc"), []byte(""))))
	show("trailing", slices.Collect(bytes.SplitSeq([]byte("trailing,"), []byte(","))))
	show("runes", slices.Collect(bytes.SplitSeq([]byte("日本語"), nil)))
	show("utf8 sep", slices.Collect(bytes.SplitSeq([]byte("héllo wörld"), []byte("ö"))))

	// An invalid or truncated encoding is one byte wide.
	for p := range bytes.SplitSeq([]byte{0xff, 'a', 0xc3, 0xa9, 0xe2, 0x82, 0xed, 0xa0, 0x80}, nil) {
		fmt.Print(len(p), " ")
	}
	fmt.Println()

	// FieldsSeq / FieldsFuncSeq
	show("fields", slices.Collect(bytes.FieldsSeq([]byte("  foo bar\\t baz\\n"))))
	fmt.Println(len(slices.Collect(bytes.FieldsSeq([]byte("   ")))), len(slices.Collect(bytes.FieldsSeq(nil))))
	show("unicode space", slices.Collect(bytes.FieldsSeq([]byte("α β γ"))))
	show("func", slices.Collect(bytes.FieldsFuncSeq([]byte("  foo1bar2  baz  "), isDigit)))
	isSep := func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }
	show("func sep", slices.Collect(bytes.FieldsFuncSeq([]byte("a1,b2;; c3"), isSep)))

	// The sequences give what the slice functions return.
	s := []byte("x=1;y=2;;z=3")
	same := func(a, b [][]byte) bool {
		if len(a) != len(b) {
			return false
		}
		for i := range a {
			if !bytes.Equal(a[i], b[i]) {
				return false
			}
		}
		return true
	}
	fmt.Println(same(slices.Collect(bytes.SplitSeq(s, []byte(";"))), bytes.Split(s, []byte(";"))))
	fmt.Println(same(slices.Collect(bytes.FieldsSeq([]byte(" a b  c "))), bytes.Fields([]byte(" a b  c "))))

	// The yielded slices alias the input and have their capacity clipped, so
	// appending to one leaves the input intact.
	data := []byte("ab,cd,ef")
	for part := range bytes.SplitSeq(data, []byte(",")) {
		part = append(part, 'X')
		_ = part
	}
	fmt.Println(string(data))
	for line := range bytes.Lines([]byte("p\\nq\\n")) {
		fmt.Println(len(line), cap(line))
	}
	for f := range bytes.FieldsSeq(data) {
		fmt.Println(len(f), cap(f))
	}

	// Early break stops the iteration.
	n := 0
	for part := range bytes.SplitSeq([]byte("a b c d e"), []byte(" ")) {
		n++
		if string(part) == "c" {
			break
		}
	}
	fmt.Println("visited", n)
	for l := range bytes.Lines([]byte("x\\ny\\n")) {
		fmt.Println("first line", vis(l))
		break
	}
}
`,
		`line <one\\n>
line <two\\n>
line <\\n>
line <three>
0 1
split [a|b||c]
after [a,|b,|,|c]
multi [a|b|c]
empty []
explode [a|b|c]
explode after [a|b|c]
trailing [trailing|]
runes [日|本|語]
utf8 sep [héllo w|rld]
1 1 2 1 1 1 1 1 
fields [foo|bar|baz]
0 0
unicode space [α|β|γ]
func [  foo|bar|  baz  ]
func sep [a1|b2|c3]
true
true
ab,cd,ef
2 2
2 2
8 8
visited 3
first line <x\\n>
`,
	);
});

test("real Go output: bytes/split on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"bytes"
	"fmt"
	"unicode"
)

func show(parts [][]byte) {
	line := fmt.Sprintf("%d [", len(parts))
	for i, p := range parts {
		if i > 0 {
			line += "|"
		}
		line += fmt.Sprint(p)
	}
	fmt.Println(line+"]", parts == nil)
}

func main() {
	s := []byte("a,b,c,d")
	sep := []byte(",")
	show(bytes.SplitAfter(s, sep))
	for _, n := range []int{-1, 0, 1, 2, 3, 4, 5, 10} {
		show(bytes.SplitAfterN(s, sep, n))
	}
	show(bytes.SplitAfter([]byte("abc"), nil))
	show(bytes.SplitAfter([]byte("héj"), []byte{}))
	for _, n := range []int{-1, 0, 1, 2, 3, 4, 10} {
		show(bytes.SplitAfterN([]byte("héj"), nil, n))
	}
	show(bytes.SplitAfter([]byte{0xff, 'a', 0xe2, 0x82}, nil))
	show(bytes.SplitAfter(nil, sep))
	show(bytes.SplitAfter(nil, nil))
	show(bytes.SplitAfter([]byte("xx,yy,"), sep))
	show(bytes.SplitAfter([]byte("a--b----c"), []byte("--")))

	part := bytes.SplitAfterN(s, sep, 2)[0]
	fmt.Println(len(part), cap(part))

	fmt.Println(bytes.Runes([]byte("héllo, 世界")))
	fmt.Println(bytes.Runes([]byte{'a', 0xff, 'b'}), len(bytes.Runes(nil)))

	fmt.Println(bytes.Title([]byte("hello wörld, ñandú_x 3d a-b")))
	fmt.Println(bytes.Title([]byte("")))
	fmt.Println(bytes.Title([]byte{'a', 0xff, 'b'}))

	isSpace := func(r rune) bool { return unicode.IsSpace(r) }
	isDigit := func(r rune) bool { return unicode.IsDigit(r) }
	fmt.Println(bytes.TrimLeftFunc([]byte("  \\t hi  "), isSpace))
	fmt.Println(bytes.TrimRightFunc([]byte("  \\t hi  \\n"), isSpace))
	fmt.Println(bytes.TrimLeftFunc([]byte("123abc456"), isDigit))
	fmt.Println(bytes.TrimRightFunc([]byte("123abc456"), isDigit))
	fmt.Println(bytes.TrimRightFunc([]byte("héllo世"), func(r rune) bool { return r == '世' || r == 'o' }))
	r := bytes.TrimLeftFunc([]byte("   "), isSpace)
	fmt.Println(r == nil, len(r))
	r = bytes.TrimRightFunc([]byte("   "), isSpace)
	fmt.Println(r == nil, len(r))
	fmt.Println(len(bytes.TrimRightFunc(nil, isSpace)))

	fmt.Println(bytes.MinRead, bytes.ErrTooLarge)
}
`,
		`4 [[97 44]|[98 44]|[99 44]|[100]] false
4 [[97 44]|[98 44]|[99 44]|[100]] false
0 [] true
1 [[97 44 98 44 99 44 100]] false
2 [[97 44]|[98 44 99 44 100]] false
3 [[97 44]|[98 44]|[99 44 100]] false
4 [[97 44]|[98 44]|[99 44]|[100]] false
4 [[97 44]|[98 44]|[99 44]|[100]] false
4 [[97 44]|[98 44]|[99 44]|[100]] false
3 [[97]|[98]|[99]] false
3 [[104]|[195 169]|[106]] false
3 [[104]|[195 169]|[106]] false
0 [] true
1 [[104 195 169 106]] false
2 [[104]|[195 169 106]] false
3 [[104]|[195 169]|[106]] false
3 [[104]|[195 169]|[106]] false
3 [[104]|[195 169]|[106]] false
4 [[255]|[97]|[226]|[130]] false
1 [[]] false
0 [] false
3 [[120 120 44]|[121 121 44]|[]] false
4 [[97 45 45]|[98 45 45]|[45 45]|[99]] false
2 2
[104 233 108 108 111 44 32 19990 30028]
[97 65533 98] 0
[72 101 108 108 111 32 87 195 182 114 108 100 44 32 195 145 97 110 100 195 186 95 120 32 51 100 32 65 45 66]
[]
[65 239 191 189 98]
[104 105 32 32]
[32 32 9 32 104 105]
[97 98 99 52 53 54]
[49 50 51 97 98 99]
[104 195 169 108 108]
true 0
false 0
0
512 bytes.Buffer: too large
`,
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
