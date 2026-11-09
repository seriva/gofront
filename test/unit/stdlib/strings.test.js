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

test("search functions find what Go finds (ASCII)", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

func main() {
	fmt.Println(strings.Index("chicken", "ken"), strings.Index("chicken", "dmr"), strings.Index("abc", ""), strings.Index("", ""), strings.Index("", "a"))
	fmt.Println(strings.LastIndex("go gopher", "go"), strings.LastIndex("go gopher", "rodent"), strings.LastIndex("abc", ""), strings.LastIndex("", ""))
	fmt.Println(strings.IndexByte("golang", 'g'), strings.IndexByte("gophers", 'h'), strings.IndexByte("golang", 'x'), strings.LastIndexByte("go gopher", 'o'), strings.LastIndexByte("abc", 'z'))
	fmt.Println(strings.IndexRune("chicken", 'k'), strings.IndexRune("chicken", 'd'), strings.IndexRune("chicken", utf8.RuneError), strings.IndexRune("abc", -1), strings.IndexRune("abc", 0x110000), strings.IndexRune("a\\x00b", 0))
	fmt.Println(strings.IndexAny("golang", "ly"), strings.IndexAny("golang", "xyz"), strings.IndexAny("", "go"), strings.IndexAny("go", ""))
	fmt.Println(strings.LastIndexAny("go gopher", "go"), strings.LastIndexAny("go gopher", "rodent"), strings.LastIndexAny("go gopher", "fail"), strings.LastIndexAny("go", ""))
	fmt.Println(strings.Contains("seafood", "foo"), strings.Contains("seafood", "bar"), strings.Contains("seafood", ""), strings.Contains("", ""))
	fmt.Println(strings.ContainsAny("team", "i"), strings.ContainsAny("fail", "ui"), strings.ContainsAny("foo", ""), strings.ContainsAny("", ""))
	fmt.Println(strings.ContainsRune("aardvark", 97), strings.ContainsRune("timeout", 'a'), strings.ContainsRune("abc", -5))
	fmt.Println(strings.HasPrefix("Gopher", "Go"), strings.HasPrefix("Gopher", "C"), strings.HasPrefix("Gopher", ""), strings.HasPrefix("Go", "Gopher"))
	fmt.Println(strings.HasSuffix("Amigo", "go"), strings.HasSuffix("Amigo", "O"), strings.HasSuffix("Amigo", "Ami"), strings.HasSuffix("Amigo", ""))
	fmt.Println(strings.Count("cheese", "e"), strings.Count("five", ""), strings.Count("aaaa", "aa"), strings.Count("", ""), strings.Count("", "a"))
}
`,
		`4 -1 0 0 -1
3 -1 3 0
0 3 -1 4 -1
4 -1 -1 -1 -1 1
2 -1 -1 -1
4 8 -1 -1
true false true true
false true false false
true false false
true false true false
true false false true
3 5 2 1 0
`,
	);
});

test("an offset from a search slices the string it came from", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strings"
)

func main() {
	s := "héllo wörld ✓ 😀 end"
	fmt.Println(s[strings.Index(s, "wörld"):])
	fmt.Println(s[strings.LastIndex(s, "e"):])
	fmt.Println(s[strings.IndexRune(s, '✓'):], s[:strings.IndexByte(s, 'w')])
	fmt.Println(s[strings.IndexAny(s, "✓😀"):], s[strings.LastIndexAny(s, "ö✓"):])
	fmt.Println(strings.Count(s, ""), strings.Count(s, "l"), strings.Count("😀😀", ""))
	fmt.Println(strings.ContainsRune(s, 0x1F600), strings.ContainsAny(s, "😀x"), strings.ContainsRune(s, '✗'))
	fmt.Println(strings.HasPrefix(s, "hé"), strings.HasSuffix(s, "😀 end"))
}
`,
		`wörld ✓ 😀 end
end
✓ 😀 end héllo 
✓ 😀 end ✓ 😀 end
20 3 3
true true false
true true
`,
	);
});

test("split, join, repeat and replace follow Go", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strings"
)

func main() {
	fmt.Printf("%q\\n", strings.Split("a,b,c", ","))
	fmt.Printf("%q\\n", strings.Split("a man a plan a canal panama", "a "))
	fmt.Printf("%q\\n", strings.Split(" xyz ", ""))
	fmt.Printf("%q\\n", strings.Split("", "Bernardo O'Higgins"))
	fmt.Printf("%q\\n", strings.Split("", ""))
	fmt.Printf("%q\\n", strings.SplitN("a,b,c,d", ",", 2))
	fmt.Printf("%q %v\\n", strings.SplitN("a,b", ",", 0), strings.SplitN("a,b", ",", 0) == nil)
	fmt.Printf("%q\\n", strings.SplitN("a,b,c,d", "", 3))
	fmt.Printf("%q\\n", strings.SplitN("a,b,c,d", ",", -1))
	fmt.Printf("%q\\n", strings.SplitN("a,b,c,d", ",", 10))
	fmt.Printf("%q\\n", strings.SplitAfter("a,b,c", ","))
	fmt.Printf("%q\\n", strings.SplitAfterN("a,b,c,d", ",", 2))
	fmt.Printf("%q\\n", strings.SplitAfter("abc", ""))
	fmt.Println(strings.Join([]string{"foo", "bar", "baz"}, ", ") + "|" + strings.Join(nil, ",") + "|" + strings.Join([]string{"x"}, ",") + "|" + strings.Join([]string{"", ""}, "-"))
	fmt.Println(strings.Repeat("na", 2)+"|"+strings.Repeat("", 5)+"|"+strings.Repeat("ab", 0)+"|"+strings.Repeat("-", 3))
	fmt.Println(strings.Replace("oink oink oink", "k", "ky", 2))
	fmt.Println(strings.Replace("oink oink oink", "oink", "moo", -1))
	fmt.Println(strings.Replace("abc", "", "-", -1), strings.Replace("abc", "", "-", 2), strings.Replace("", "", "-", -1), strings.Replace("abc", "", "-", 10))
	fmt.Println(strings.Replace("abc", "b", "$&", -1), strings.Replace("abc", "b", "b", -1), strings.Replace("aaa", "a", "b", 0), strings.Replace("aaa", "a", "b", 5))
	fmt.Println(strings.ReplaceAll("a$b$", "$", "$$"), strings.ReplaceAll("banana", "an", ""), strings.ReplaceAll("abc", "x", "y"))
	b, a, ok := strings.Cut("Gopher", "ph")
	fmt.Println(b, a, ok)
	b, a, ok = strings.Cut("Gopher", "Badger")
	fmt.Println(b, a, ok)
	b, a, ok = strings.Cut("Gopher", "")
	fmt.Println(b, a, ok)
	rest, ok := strings.CutPrefix("Gopher", "Go")
	fmt.Println(rest, ok)
	rest, ok = strings.CutPrefix("Gopher", "ph")
	fmt.Println(rest, ok)
	rest, ok = strings.CutSuffix("Gopher", "er")
	fmt.Println(rest, ok)
	rest, ok = strings.CutSuffix("Gopher", "")
	fmt.Println(rest, ok)
	fmt.Printf("%q\\n", strings.Fields("  foo bar  baz   "))
	fmt.Printf("%q %q %d\\n", strings.Fields(""), strings.Fields(" \\t\\n\\v\\f\\r "), len(strings.Fields("a\\u00a0b\\u3000c")))
	fmt.Printf("%q\\n", strings.FieldsFunc("  foo1;bar2,baz3...", func(c rune) bool { return c == ';' || c == ',' || c == '.' || c == ' ' }))

	func() {
		defer func() { fmt.Println(recover()) }()
		n := -1
		strings.Repeat("x", n)
	}()
}
`,
		`["a" "b" "c"]
["" "man " "plan " "canal panama"]
[" " "x" "y" "z" " "]
[""]
[]
["a" "b,c,d"]
[] true
["a" "," "b,c,d"]
["a" "b" "c" "d"]
["a" "b" "c" "d"]
["a," "b," "c"]
["a," "b,c,d"]
["a" "b" "c"]
foo, bar, baz||x|-
nana|||---
oinky oinky oink
moo moo moo
-a-b-c- -a-bc - -a-b-c-
a$&c abc aaa bbb
a$$b$$ ba abc
Go er true
Gopher  false
 Gopher true
pher true
Gopher false
Goph true
Gopher true
["foo" "bar" "baz"]
[] [] 3
["foo1" "bar2" "baz3"]
strings: negative Repeat count
`,
	);
});

test("case mapping, folding and trimming follow Go", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strings"
	"unicode"
)

func main() {
	fmt.Println(strings.ToUpper("Gopher"), strings.ToLower("Gopher"), strings.ToUpper("héllo ✓"), strings.ToLower("ÀÉ"), strings.ToUpper(""))
	fmt.Println(strings.ToTitle("loud noises"), strings.ToTitle("ǆ"), strings.ToTitle("ǅ"))
	fmt.Println(strings.Title("hello wORLD"), strings.Title("her royal highness"), strings.Title("o'neil is_here 3d"))
	fmt.Println(strings.EqualFold("Go", "GO"), strings.EqualFold("σ", "ς"), strings.EqualFold("K", "\\u212a"), strings.EqualFold("Go", "Gx"), strings.EqualFold("ß", "SS"), strings.EqualFold("", ""), strings.EqualFold("a", ""))
	fmt.Printf("[%s] [%s] [%s]\\n", strings.TrimSpace(" \\t\\n Hello, Gophers \\n\\t\\r\\n"), strings.TrimSpace("\\u00a0x\\u3000"), strings.TrimSpace("   "))
	fmt.Println(strings.Trim("¡¡¡Hello, Gophers!!!", "!¡"), strings.TrimLeft("xxhixx", "x"), strings.TrimRight("xxhixx", "x"), "["+strings.Trim("abc", "")+"]", "["+strings.Trim("", "x")+"]", "["+strings.Trim("xxx", "x")+"]")
	fmt.Println(strings.Trim("😀x😀", "😀"), strings.TrimLeft("😀😀x", "😀"), strings.TrimRight("x😀😀", "😀a"))
	fmt.Println(strings.TrimPrefix("¡¡¡Hello, Gophers!!!", "¡¡¡Hello, "), strings.TrimSuffix("a.go", ".go"), strings.TrimPrefix("abc", ""), strings.TrimSuffix("abc", ""), strings.TrimSuffix("abc", "bc"), strings.TrimPrefix("abc", "x"))
	digit := func(r rune) bool { return unicode.IsDigit(r) }
	letter := func(r rune) bool { return unicode.IsLetter(r) }
	fmt.Println(strings.TrimFunc("123abc456", digit), strings.TrimLeftFunc("123abc456", digit), strings.TrimRightFunc("123abc456", digit), "["+strings.TrimFunc("123", digit)+"]")
	fmt.Println(strings.IndexFunc("Hello, world", unicode.IsUpper2), strings.IndexFunc("123", letter), strings.LastIndexFunc("go 123", letter), strings.LastIndexFunc("", letter), strings.ContainsFunc("a1", digit))
	fmt.Println(strings.Map(func(r rune) rune {
		switch r {
		case 'a':
			return 'A'
		case 'x':
			return -1
		}
		return r
	}, "banana xx"))
	fmt.Println(strings.Map(func(r rune) rune { return r + 1 }, "HAL"), strings.ToValidUTF8("a\\uFFFDb", "?"))
	up := strings.ToUpper
	fmt.Println(up("f"))
}
`.replace(
			"unicode.IsUpper2",
			"func(r rune) bool { return unicode.IsUpper(r) }",
		),
		`GOPHER gopher HÉLLO ✓ àé 
LOUD NOISES ǅ ǅ
Hello WORLD Her Royal Highness O'Neil Is_here 3d
true true true false false true false
[Hello, Gophers] [x] []
Hello, Gophers hixx xxhi [abc] [] []
x x x
Gophers!!! a abc abc a abc
abc abc456 123abc []
0 -1 1 -1 true
bAnAnA 
IBM a�b
F
`,
	);
});

test("ToUpper and ToLower keep single-rune mappings (ß stays ß)", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strings"
	"unicode"
)

func main() {
	fmt.Println(strings.ToUpper("ß"), strings.ToLower("ẞ"), strings.ToUpper("straße"))
	fmt.Println(string(unicode.ToUpper('ß')), string(unicode.ToLower('ẞ')), unicode.ToUpper('ß') == 'ß')
}
`,
		`ß ß STRAßE
ß ß true
`,
	);
});

test("Builder writes, grows, resets and rejects copies like Go", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strings"
)

func main() {
	var b strings.Builder
	fmt.Println(b.Len(), b.Cap(), b.String() == "")
	n, err := b.WriteString("世界")
	fmt.Println(n, err, b.Len())
	fmt.Println(b.WriteByte('!'))
	r, _ := b.WriteRune('é')
	fmt.Println(r, b.String(), b.Len())
	b.Grow(100)
	fmt.Println(b.Cap()-b.Len() >= 100)
	m, _ := b.Write([]byte("xy"))
	fmt.Println(m, b.String())
	fmt.Fprintf(&b, "%d-%s", 7, "z")
	fmt.Println(b.String())
	b.Reset()
	fmt.Println(b.Len(), b.String() == "")

	var z strings.Builder
	z2 := z
	z2.WriteString("ok")
	fmt.Println(z2.String())

	var c1 strings.Builder
	c1.WriteString("a")
	c2 := c1
	func() {
		defer func() { fmt.Println("recovered:", recover()) }()
		c2.WriteString("b")
	}()
	c2.Reset()
	c2.WriteString("ok2")
	fmt.Println(c2.String())

	func() {
		defer func() { fmt.Println("recovered:", recover()) }()
		var g strings.Builder
		g.Grow(-1)
	}()
}
`,
		`0 0 true
6 <nil> 6
<nil>
2 世界!é 9
true
2 世界!éxy
世界!éxy7-z
0 true
ok
recovered: strings: illegal use of non-zero Builder copied by value
ok2
recovered: strings.Builder.Grow: negative count
`,
	);
});
