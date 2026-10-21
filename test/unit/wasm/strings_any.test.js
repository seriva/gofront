// test/unit/wasm/strings_any.test.js
// Tests for Phase 4c: Strings & Any in WASM and JS-strict parity.

import {
	assertContains,
	assertEqual,
	compileHybrid,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Strings — Literals, Concatenation, and Compound Assign");

test("String literal, concatenation, and compound assignment", () => {
	const src = `
package main

func Main() string {
	a := "hello"
	b := "world"
	res := a + " " + b
	res += "!"
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "hello world!");
	assertEqual(wasmRes, jsRes);
});

test("Default zero value of string is empty string", () => {
	const src = `
package main

func Main() int64 {
	var s string
	return int64(len(s))
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 0n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Strings — Comparisons");

test("String comparisons ==, !=, <, <=, >, >=", () => {
	const src = `
package main

func Main() int64 {
	a := "apple"
	b := "banana"
	a2 := "app" + "le"

	var r int64
	if a == a2 { r += 1 }
	if a != b  { r += 10 }
	if a < b   { r += 100 }
	if a <= a2 { r += 1000 }
	if b > a   { r += 10000 }
	if b >= a  { r += 100000 }
	return r
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 111111n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Strings — Length and Indexing");

test("String len and byte indexing", () => {
	const src = `
package main

func Main() int64 {
	s := "GoFront"
	l := int64(len(s))
	c0 := int64(s[0]) // 'G' = 71
	c1 := int64(s[1]) // 'o' = 111
	return l*10000 + c0*100 + c1
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// l=7, c0=71, c1=111 -> 70000 + 7100 + 111 = 77211
	assertEqual(wasmRes, 77211n);
	assertEqual(wasmRes, jsRes);
});

test("String index out of range traps with panic", () => {
	const src = `
package main

func Main() int64 {
	s := "abc"
	return int64(s[10])
}
`;
	const h = compileHybrid(src);
	let caught = false;
	try {
		const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(e.message.includes("index out of range"), true);
	}
	assertEqual(caught, true);
});

section("WASM Strings — Sub-slicing");

test("String slicing s[low:high]", () => {
	const src = `
package main

func Main() string {
	s := "Hello, World!"
	sub1 := s[0:5]
	sub2 := s[7:12]
	return sub1 + " " + sub2
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "Hello World");
	assertEqual(wasmRes, jsRes);
});

test("String slice bounds out of range traps with panic", () => {
	const src = `
package main

func Main() string {
	s := "hello"
	return s[2:10]
}
`;
	const h = compileHybrid(src);
	let caught = false;
	try {
		const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(e.message.includes("slice bounds out of range"), true);
	}
	assertEqual(caught, true);
});

section("WASM Strings — Conversions & Range Loops");

test("String conversion from rune and string range loop", () => {
	const src = `
package main

func Main() int64 {
	s := "ABCD"
	var sumRune int64
	var sumIdx int64
	for i, r := range s {
		sumIdx += int64(i)
		sumRune += int64(r)
	}
	// 'A'(65) + 'B'(66) + 'C'(67) + 'D'(68) = 266
	// sumIdx = 0 + 1 + 2 + 3 = 6
	return sumRune + sumIdx
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// 266 + 6 = 272
	assertEqual(wasmRes, 272n);
	assertEqual(wasmRes, jsRes);
});

test("string(codePoint) conversion", () => {
	const src = `
package main

func Main() string {
	a := string(72) // 'H'
	b := string(105) // 'i'
	return a + b
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "Hi");
	assertEqual(wasmRes, jsRes);
});

section("WASM Any — Boxing & Type Assertions");

test("Any holding scalar int64 with type assertion", () => {
	const src = `
package main

func Main() int64 {
	var a any = int64(42)
	v := a.(int64)
	return v + 8
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 50n);
	assertEqual(wasmRes, jsRes);
});

test("Any comma-ok type assertion succeeds and fails cleanly", () => {
	const src = `
package main

func Main() int64 {
	var a any = int64(100)

	v1, ok1 := a.(int64)
	v2, ok2 := a.(string)

	var score int64
	if ok1 { score += v1 }       // +100
	if !ok2 && v2 == "" { score += 50 } // +50
	return score
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 150n);
	assertEqual(wasmRes, jsRes);
});

test("Any type assertion failure traps with panic", () => {
	const src = `
package main

func Main() int64 {
	var a any = "not a number"
	v := a.(int64)
	return v
}
`;
	const h = compileHybrid(src);
	let caught = false;
	try {
		const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(e.message.includes("type assertion failed"), true);
	}
	assertEqual(caught, true);
});

test("Any holding string with type assertion", () => {
	const src = `
package main

func Main() string {
	var a any = "hello from any"
	s, ok := a.(string)
	if ok {
		return s + "!"
	}
	return "failed"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "hello from any!");
	assertEqual(wasmRes, jsRes);
});

test("Any holding struct pointer and slice", () => {
	const src = `
package main

type Point struct {
	X int64
	Y int64
}

func Main() int64 {
	pt := &Point{X: 10, Y: 20}
	var a any = pt
	p := a.(*Point)

	s := []int64{100, 200}
	var b any = s
	s2 := b.([]int64)

	return p.X + p.Y + s2[0] + s2[1]
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// 10 + 20 + 100 + 200 = 330
	assertEqual(wasmRes, 330n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Any — Type Switch & Standard Switch");

test("Type switch on any", () => {
	const src = `
package main

type Point struct {
	X int64
}

func Check(x any) int64 {
	switch v := x.(type) {
	case int64:
		return v * 10
	case string:
		return int64(len(v)) * 100
	case *Point:
		return v.X * 1000
	default:
		return -1
	}
}

func Main() int64 {
	r1 := Check(int64(5))       // 50
	r2 := Check("hello")        // 500
	r3 := Check(&Point{X: 7})   // 7000
	r4 := Check(true)           // -1
	return r1 + r2 + r3 + r4
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// 50 + 500 + 7000 - 1 = 7549
	assertEqual(wasmRes, 7549n);
	assertEqual(wasmRes, jsRes);
});

test("Standard value switch and tagless switch", () => {
	const src = `
package main

func Eval(x int64) int64 {
	var r int64
	switch x {
	case 1:
		r = 10
	case 2, 3:
		r = 20
	default:
		r = 99
	}

	switch {
	case x > 5:
		r += 500
	default:
		r += 100
	}
	return r
}

func Main() int64 {
	return Eval(1) + Eval(2) + Eval(10)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	// Eval(1) = 10 + 100 = 110
	// Eval(2) = 20 + 100 = 120
	// Eval(10) = 99 + 500 = 599
	// Total = 110 + 120 + 599 = 829
	assertEqual(wasmRes, 829n);
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib Phase 3 — strings.Cut, CutPrefix, CutSuffix");

test("strings.Cut, CutPrefix, CutSuffix", () => {
	const src = `
package main

import "strings"

func Main() string {
	b1, a1, ok1 := strings.Cut("user:password", ":")
	b2, a2, ok2 := strings.Cut("user-password", ":")
	ap1, ok3 := strings.CutPrefix("hello world", "hello ")
	ap2, ok4 := strings.CutPrefix("hello world", "bye ")
	as1, ok5 := strings.CutSuffix("hello world", " world")
	as2, ok6 := strings.CutSuffix("hello world", " bye")

	out := ""
	if ok1 { out += b1 + "|" + a1 + ";" }
	if !ok2 { out += b2 + "|" + a2 + ";" }
	if ok3 { out += ap1 + ";" }
	if !ok4 { out += ap2 + ";" }
	if ok5 { out += as1 + ";" }
	if !ok6 { out += as2 }
	return out
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(
		wasmRes,
		"user|password;user-password|;world;hello world;hello;hello world",
	);
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib Phase 3 — strings.SplitN, SplitAfter, SplitAfterN");

test("strings.SplitN, SplitAfter, SplitAfterN with nil slices on n == 0", () => {
	const src = `
package main

import "strings"

func Main() string {
	s0 := strings.SplitN("a:b:c:d", ":", 0)
	s2 := strings.SplitN("a:b:c:d", ":", 2)
	sNeg := strings.SplitN("a:b:c", ":", -1)
	sa := strings.SplitAfter("a:b:c", ":")
	san := strings.SplitAfterN("a:b:c:d", ":", 2)
	san0 := strings.SplitAfterN("a:b:c", ":", 0)

	out := ""
	if s0 == nil { out += "nil0|" }
	out += strings.Join(s2, ",") + "|"
	out += strings.Join(sNeg, ",") + "|"
	out += strings.Join(sa, ",") + "|"
	out += strings.Join(san, ",")
	if san0 == nil { out += "|nilsan0" }
	return out
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "nil0|a,b:c:d|a,b,c|a:,b:,c|a:,b:c:d|nilsan0");
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib Phase 3 — strings.LastIndexAny, IndexFunc, LastIndexFunc");

test("strings.LastIndexAny, IndexFunc, LastIndexFunc", () => {
	const src = `
package main

import "strings"

func Main() int64 {
	i1 := strings.LastIndexAny("gofront", "no")
	i2 := strings.LastIndexAny("gofront", "xyz")
	isO := func(r rune) bool { return r == 'o' }
	i3 := strings.IndexFunc("gofront", isO)
	i4 := strings.LastIndexFunc("gofront", isO)
	i5 := strings.IndexFunc("xyz", isO)
	return int64(i1*100000000 + (i2+2)*1000000 + i3*10000 + i4*100 + (i5+2))
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib Phase 3 — strings.TrimFunc, TrimLeftFunc, TrimRightFunc");

test("strings.TrimFunc, TrimLeftFunc, TrimRightFunc", () => {
	const src = `
package main

import "strings"

func Main() string {
	isDash := func(r rune) bool { return r == '-' }
	t := strings.TrimFunc("--hello--", isDash)
	tl := strings.TrimLeftFunc("--hello--", isDash)
	tr := strings.TrimRightFunc("--hello--", isDash)
	return t + "|" + tl + "|" + tr
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "hello|hello--|--hello");
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib Phase 3 — strings.Map (rune mapping & negative drop)");

test("strings.Map drops rune on negative return", () => {
	const src = `
package main

import "strings"

func Main() string {
	dropVowels := func(r rune) rune {
		if r == 'a' || r == 'e' || r == 'i' || r == 'o' || r == 'u' {
			return -1
		}
		if r >= 'a' && r <= 'z' {
			return r - 32
		}
		return r
	}
	return strings.Map(dropVowels, "hello world!")
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "HLL WRLD!");
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib Phase 3 — strings.NewReplacer & Replace");

test("strings.NewReplacer and Replace", () => {
	const src = `
package main

import "strings"

func Main() string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return r.Replace("<b>Tom & Jerry</b>")
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;");
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib Phase 3 — strings.Builder");

test("strings.Builder lifecycle: WriteString, WriteByte, WriteRune, Write, String, Len, Reset, Grow", () => {
	const src = `
package main

import (
	"strconv"
	"strings"
)

func Main() string {
	var b strings.Builder
	b.WriteString("hello")
	b.WriteByte(' ')
	b.WriteRune('A')
	b.Write([]byte(" world!"))
	s1 := b.String()
	l1 := b.Len()
	b.Grow(100)
	b.Reset()
	s2 := b.String()
	l2 := b.Len()
	b.WriteString("after reset")
	s3 := b.String()
	return s1 + "|" + strconv.Itoa(l1) + "|" + s2 + "|" + strconv.Itoa(l2) + "|" + s3
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "hello A world!|14||0|after reset");
	assertEqual(wasmRes, jsRes);
});

test("strings.Builder copy-by-value after first write panics in WASM", () => {
	const src = `
package main

import "strings"

func Main() string {
	var b1 strings.Builder
	b1.WriteString("hello")
	b2 := b1
	b2.WriteString("world")
	return b2.String()
}
`;
	const { wasm, stringTable } = compileHybrid(src);
	const { exports } = runWasm(wasm, { stringTable });
	let threw = false;
	try {
		exports.Main();
	} catch (e) {
		threw = true;
		assertContains(
			e.message,
			"strings: illegal use of non-zero Builder copied by value",
		);
	}
	assertEqual(threw, true);
});

section("WASM stdlib Phase 3 — strconv additions");

test("strconv.Unquote & ErrSyntax with errors.Is", () => {
	const src = `
package main

import (
	"errors"
	"strconv"
)

func Main() string {
	q := strconv.Quote("hello")
	s1, err1 := strconv.Unquote(q)
	if err1 != nil { return "err1" }

	s2, err2 := strconv.Unquote("invalid")
	isSyntax := errors.Is(err2, strconv.ErrSyntax)

	res := s1 + "|" + s2 + "|"
	if isSyntax { res += "syntax_ok" }
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "hello||syntax_ok");
	assertEqual(wasmRes, jsRes);
});

test("strconv.AppendInt, AppendFloat, and byte slice conversions", () => {
	const src = `
package main

import "strconv"

func Main() string {
	var b []byte
	b = strconv.AppendInt(b, 42, 10)
	b = append(b, ' ')
	b = strconv.AppendFloat(b, 2.718, 'f', 2, 64)
	return string(b)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "42 2.72");
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib Phase 3 — Edge Cases & Regression Probes");

test("strings.NewReplacer single-pass scanner & zero-value Replacer", () => {
	const src = `
package main

import "strings"

func Main() string {
	r := strings.NewReplacer("ab", "1", "a", "2", "bc", "3")
	s1 := r.Replace("abc")
	var zero strings.Replacer
	s2 := zero.Replace("hello")
	return s1 + "|" + s2
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "1c|hello");
	assertEqual(wasmRes, jsRes);
});

test("[]byte(s) and string(b) UTF-8 multi-byte conversions without stdlib import", () => {
	const src = `
package main

func Main() string {
	b := []byte("世")
	s := string(b)
	b2 := []byte{0xe4, 0xb8, 0x96}
	s2 := string(b2)
	res := s + "|" + s2
	if len(b) == 3 {
		res += "|len3"
	}
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "世|世|len3");
	assertEqual(wasmRes, jsRes);
});

test("strings.Builder WriteByte, WriteRune, and Cap methods", () => {
	const src = `
package main

import (
	"strconv"
	"strings"
)

func Main() string {
	var b strings.Builder
	c0 := b.Cap()
	err1 := b.WriteByte(65)
	n2, err2 := b.WriteRune(66)
	c1 := b.Cap()
	res := b.String() + "|" + strconv.Itoa(c0) + "|" + strconv.Itoa(c1)
	if err1 == nil { res += "|e1_nil" }
	if err2 == nil { res += "|e2_nil" }
	if n2 == 1 { res += "|n2_1" }
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "AB|0|2|e1_nil|e2_nil|n2_1");
	assertEqual(wasmRes, jsRes);
});

test("strings.SplitN with empty sep and strings.SplitAfter edge cases", () => {
	const src = `
package main

import (
	"strconv"
	"strings"
)

func Main() string {
	p1 := strings.SplitN("abc", "", 2)
	p2 := strings.SplitN("abc", "", 1)
	p3 := strings.SplitN("abc", "", 3)
	after1 := strings.SplitAfter("", ":")
	after2 := strings.SplitAfter("a:b:", ":")
	after3 := strings.SplitAfterN("a:b:c", ":", 2)
	return p1[0] + "," + p1[1] + "|" + p2[0] + "|" + p3[0] + "," + p3[1] + "," + p3[2] + "|" +
		strconv.Itoa(len(after1)) + ":" + after1[0] + "|" +
		strconv.Itoa(len(after2)) + ":" + after2[0] + after2[1] + "[" + after2[2] + "]|" +
		after3[0] + "," + after3[1]
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "a,bc|abc|a,b,c|1:|3:a:b:[]|a:,b:c");
	assertEqual(wasmRes, jsRes);
});

test("strings.TrimFunc and TrimLeftFunc with astral surrogate pair characters", () => {
	const src = `
package main

import "strings"

func Main() string {
	fn := func(r rune) bool {
		return r == 0x1F680
	}
	s := strings.TrimFunc("🚀hello🚀", fn)
	sL := strings.TrimLeftFunc("🚀hello🚀", fn)
	sR := strings.TrimRightFunc("🚀hello🚀", fn)
	return s + "|" + sL + "|" + sR
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "hello|hello🚀|🚀hello");
	assertEqual(wasmRes, jsRes);
});

test("strconv.ErrSyntax identity equality & errors.Is cause matching", () => {
	const src = `
package main

import (
	"errors"
	"strconv"
)

func Main() string {
	same := strconv.ErrSyntax == strconv.ErrSyntax
	_, errAtoi := strconv.Atoi("notanumber")
	isAtoi := errors.Is(errAtoi, strconv.ErrSyntax)
	_, errParseInt := strconv.ParseInt("invalid", 10, 64)
	isParseInt := errors.Is(errParseInt, strconv.ErrSyntax)
	_, errUnquote := strconv.Unquote("badquote")
	isUnquote := errors.Is(errUnquote, strconv.ErrSyntax)
	res := ""
	if same { res += "same_ok" }
	if isAtoi { res += "|atoi_ok" }
	if isParseInt { res += "|parseint_ok" }
	if isUnquote { res += "|unquote_ok" }
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "same_ok|atoi_ok|parseint_ok|unquote_ok");
	assertEqual(wasmRes, jsRes);
});

section("WASM fmt — composite %v and %+v parity (Phase 5)");

test("fmt.Sprintf %v with slices and arrays", () => {
	const src = `
package main

import "fmt"

func Main() string {
	s1 := []int{1, 2, 3}
	s2 := []string{"hello", "world"}
	s3 := []bool{true, false, true}
	s4 := []float64{1.5, 2.5}
	s5 := []int{}
	var s6 []int
	a1 := [3]int{10, 20, 30}
	a2 := [2]string{"foo", "bar"}

	return fmt.Sprintf("%v|%v|%v|%v|%v|%v|%v|%v", s1, s2, s3, s4, s5, s6, a1, a2)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(
		wasmRes,
		"[1 2 3]|[hello world]|[true false true]|[1.5 2.5]|[]|[]|[10 20 30]|[foo bar]",
	);
	assertEqual(wasmRes, jsRes);
});

test("fmt.Sprintf %v with maps", () => {
	const src = `
package main

import "fmt"

func Main() string {
	m1 := map[string]int{"a": 1, "b": 2}
	m2 := map[string]string{"foo": "bar"}
	m3 := map[int]string{1: "one", 2: "two"}
	m4 := map[string]int{}
	var m5 map[string]int

	return fmt.Sprintf("%v|%v|%v|%v|%v", m1, m2, m3, m4, m5)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(
		wasmRes,
		"map[a:1 b:2]|map[foo:bar]|map[1:one 2:two]|map[]|map[]",
	);
	assertEqual(wasmRes, jsRes);
});

test("fmt.Sprintf %v and %+v with structs and struct pointers", () => {
	const src = `
package main

import "fmt"

type Point struct {
	X int
	Y int
}

func Main() string {
	p := Point{10, 20}
	ptr := &Point{30, 40}
	var nilPtr *Point

	v1 := fmt.Sprintf("%v|%+v", p, p)
	v2 := fmt.Sprintf("%v|%+v", ptr, ptr)
	v3 := fmt.Sprintf("%v|%+v", nilPtr, nilPtr)
	return v1 + "|" + v2 + "|" + v3
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "{10 20}|{X:10 Y:20}|&{30 40}|&{X:30 Y:40}|<nil>|<nil>");
	assertEqual(wasmRes, jsRes);
});

test("fmt.Sprintf %v and %+v with nested struct pointers and value structs", () => {
	const src = `
package main

import "fmt"

type Node struct {
	Val  int
	Next *Node
}

type Inner struct {
	N int
}

type Outer struct {
	Val int
	In  Inner
}

func Main() string {
	n := &Node{Val: 1, Next: &Node{Val: 2, Next: nil}}
	nVal := Node{Val: 10, Next: &Node{Val: 20, Next: nil}}
	o := Outer{Val: 100, In: Inner{N: 42}}
	oPtr := &Outer{Val: 200, In: Inner{N: 84}}

	s1 := fmt.Sprintf("%v|%+v", n, n)
	s2 := fmt.Sprintf("%v|%+v", nVal, nVal)
	s3 := fmt.Sprintf("%v|%+v", o, o)
	s4 := fmt.Sprintf("%v|%+v", oPtr, oPtr)
	return s1 + "|" + s2 + "|" + s3 + "|" + s4
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(
		wasmRes,
		"&{1 0x2}|&{Val:1 Next:0x2}|{10 0x1}|{Val:10 Next:0x1}|{100 {42}}|{Val:100 In:{N:42}}|&{200 {84}}|&{Val:200 In:{N:84}}",
	);
	assertEqual(wasmRes, jsRes);
});

test("fmt.Sprintf %v and %+v with slices and maps of structs and pointers", () => {
	const src = `
package main

import "fmt"

type Item struct {
	Name string
	Qty  int
}

func Main() string {
	items := []Item{{"apple", 5}, {"banana", 10}}
	itemPtrs := []*Item{&Item{"cherry", 15}, &Item{"date", 20}}
	mItems := map[string]Item{"first": {"fig", 25}}

	s1 := fmt.Sprintf("%v|%+v", items, items)
	s2 := fmt.Sprintf("%v|%+v", itemPtrs, itemPtrs)
	s3 := fmt.Sprintf("%v|%+v", mItems, mItems)
	return s1 + "|" + s2 + "|" + s3
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(
		wasmRes,
		"[{apple 5} {banana 10}]|[{Name:apple Qty:5} {Name:banana Qty:10}]|[0x1 0x2]|[0x1 0x2]|map[first:{fig 25}]|map[first:{Name:fig Qty:25}]",
	);
	assertEqual(wasmRes, jsRes);
});

test("fmt.Sprintf %v with single-field struct named value", () => {
	const src = `
package main

import "fmt"

type Wrapper struct {
	value int
}

func Main() string {
	w := Wrapper{value: 42}
	return fmt.Sprintf("%v|%+v", w, w)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "{42}|{value:42}");
	assertEqual(wasmRes, jsRes);
});

test("fmt.Sprintf %v with recursive tree struct", () => {
	const src = `
package main

import "fmt"

type Tree struct {
	Val int
	Children []Tree
}

func Main() string {
	t := Tree{Val: 1, Children: []Tree{}}
	return fmt.Sprintf("%v", t)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "{1 []}");
	assertEqual(wasmRes, jsRes);
});

test("fmt.Sprintf %v with pointer to scalar and nil pointer", () => {
	const src = `
package main

import "fmt"

func Main() string {
	v := 42
	ptr := &v
	var nilPtr *int
	return fmt.Sprintf("%v|%v", ptr, nilPtr)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "0x1|<nil>");
	assertEqual(wasmRes, jsRes);
});

test("fmt.Sprintf %v with map of struct pointers", () => {
	const src = `
package main

import "fmt"

type Point struct {
	X int
	Y int
}

func Main() string {
	m := map[string]*Point{"p": &Point{1, 2}}
	return fmt.Sprintf("%v", m)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "map[p:0x1]");
	assertEqual(wasmRes, jsRes);
});

test("fmt.Sprintf %v with sorted map integer keys", () => {
	const src = `
package main

import "fmt"

func Main() string {
	m := map[int]string{10: "ten", 2: "two"}
	return fmt.Sprintf("%v", m)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "map[2:two 10:ten]");
	assertEqual(wasmRes, jsRes);
});

test("fmt.Sprintf %+v with sibling struct pointer fields", () => {
	const src = `
package main

import "fmt"

type Sub struct {
	P *int
}

type Pair struct {
	A Sub
	B Sub
}

func Main() string {
	v1 := 10
	v2 := 20
	p := Pair{A: Sub{P: &v1}, B: Sub{P: &v2}}
	return fmt.Sprintf("%+v", p)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "{A:{P:0x1} B:{P:0x2}}");
	assertEqual(wasmRes, jsRes);
});

section("WASM []rune conversions (Task 0.12)");

test("[]rune(s) decodes code points; string(r[i]) and string(r) round-trip", () => {
	const src = `
package main

func Main() {
    r := []rune("héllo")
    println(len(r), r[1], string(r[1]))
    println(string(r) == "héllo", string(r))
    e := []rune("")
    println(len(e), string(e) == "")
    w := []rune("a😀b")
    println(len(w), w[1], string(w[1:]))
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.output, "5 233 é\ntrue héllo\n0 true\n3 128512 😀b");
});

test("[]rune slices support append, index writes, range and slicing", () => {
	const src = `
package main

func Main() {
    r := []rune("héllo")
    r = append(r, 'x')
    r[0] = 'H'
    println(len(r), string(r))
    n := 0
    for _, c := range r[1:3] {
        n += int(c)
    }
    println(n, string(r[:2]))
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.output, "6 Héllox\n341 Hé");
});
