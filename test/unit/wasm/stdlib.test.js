// test/unit/wasm/stdlib.test.js
// WASM stdlib coverage: errors, fmt, strconv, strings, unicode/utf8, sort,
// math extras and `any` equality — all checked for JS/WASM parity.

import {
	assertEqual,
	assertThrows,
	compileHybrid,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM stdlib — errors & fmt");

test("errors.New / fmt.Errorf %w / errors.Is / errors.Unwrap", () => {
	const src = `
package main

import (
	"errors"
	"fmt"
)

var ErrNotFound = errors.New("not found")

func find(k string) (int, error) {
	if k == "a" {
		return 1, nil
	}
	return 0, fmt.Errorf("find %s: %w", k, ErrNotFound)
}

func Main() string {
	v, err := find("a")
	if err != nil {
		return "unexpected"
	}
	_, err = find("zz")
	if err == nil {
		return "expected error"
	}
	if !errors.Is(err, ErrNotFound) {
		return "Is failed"
	}
	if errors.Unwrap(err) != ErrNotFound {
		return "Unwrap failed"
	}
	return fmt.Sprintf("%s|%d|%v", err.Error(), v, errors.Unwrap(ErrNotFound) == nil)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "find zz: not found|1|true");
	assertEqual(wasmRes, jsRes);
});

test("fmt.Println / fmt.Printf print errors and primitives identically", () => {
	const src = `
package main

import (
	"errors"
	"fmt"
)

func Main() {
	err := errors.New("boom")
	fmt.Println("err:", err, 42, true)
	fmt.Printf("%d %s %v %.2f\\n", 7, "x", err, 1.5)
}
`;
	const { output } = compileHybrid(src).run("Main");
	assertEqual(output, "err: boom 42 true\n7 x boom 1.50");
});

test("error values compare by identity and nil", () => {
	const src = `
package main

import "errors"

var A = errors.New("same")
var B = errors.New("same")

func Main() string {
	out := ""
	var e error
	if e == nil {
		out += "1"
	}
	e = A
	if e != nil {
		out += "2"
	}
	if e == A {
		out += "3"
	}
	if e != B {
		out += "4"
	}
	if errors.Is(e, B) {
		out += "5"
	}
	return out
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "12345");
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib — strconv");

test("strconv parse/format round-trips with Go-style errors", () => {
	const src = `
package main

import (
	"fmt"
	"strconv"
)

func Main() string {
	n, err := strconv.Atoi("42")
	if err != nil {
		return "e1"
	}
	_, err = strconv.Atoi("4x2")
	if err == nil {
		return "e2"
	}
	f, _ := strconv.ParseFloat("2.5", 64)
	b, _ := strconv.ParseBool("true")
	i, _ := strconv.ParseInt("-ff", 16, 64)
	return fmt.Sprintf("%d %v %v %d %s %s %s %s %s", n, f, b, i,
		strconv.FormatFloat(1.5, 'f', 2, 64), strconv.FormatBool(false),
		strconv.FormatInt(255, 2), strconv.Quote("a\\"b"), err.Error())
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(
		wasmRes,
		'42 2.5 true -255 1.50 false 11111111 "a\\"b" strconv.Atoi: parsing "4x2": invalid syntax',
	);
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib — strings & unicode/utf8");

test("strings Split/Fields/Join/Trim*/Replace/Title/Index*", () => {
	const src = `
package main

import "strings"

func Main() string {
	parts := strings.Split("a,b,c", ",")
	f := strings.Fields("  x  y z ")
	out := strings.Join(parts, "-") + "|" + strings.Join(f, "+")
	out += "|" + strings.Trim("xxhixx", "x") + "|" + strings.TrimPrefix("prefix-body", "prefix-")
	out += "|" + strings.TrimSuffix("a.go", ".go") + "|" + strings.Replace("aaaa", "a", "b", 2)
	out += "|" + strings.Title("hello world")
	if strings.ContainsRune("héllo", 'é') && strings.IndexByte("abc", 'c') == 2 &&
		strings.ContainsAny("abc", "xyzc") && strings.IndexAny("golang", "ln") == 2 &&
		strings.LastIndexByte("abcabc", 'b') == 4 {
		out += "|ok"
	}
	return out + "|" + strings.TrimLeft("--x--", "-") + "|" + strings.TrimRight("--x--", "-")
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "a-b-c|x+y+z|hi|body|a|bbaa|Hello World|ok|x--|--x");
	assertEqual(wasmRes, jsRes);
});

test("unicode/utf8 functions and constants", () => {
	const src = `
package main

import (
	"fmt"
	"unicode/utf8"
)

func Main() string {
	s := "héllo, 世界"
	r, size := utf8.DecodeRuneInString("世界")
	lr, lsize := utf8.DecodeLastRuneInString("世界")
	return fmt.Sprintf("%d %d %d %d %d %v %v %d %d %d", utf8.RuneCountInString(s),
		utf8.RuneLen('世'), r, size, utf8.RuneError, utf8.ValidString(s),
		utf8.ValidRune(0xD800), lr, lsize, utf8.MaxRune)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "9 3 19990 1 65533 true false 30028 1 1114111");
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib — sort & math extras");

test("sort.Ints/Strings/Slice/Search/*AreSorted", () => {
	const src = `
package main

import (
	"fmt"
	"sort"
)

type P struct {
	Name string
	Age  int
}

func Main() string {
	xs := []int{5, 2, 9, 1}
	sort.Ints(xs)
	ss := []string{"b", "a", "c"}
	sort.Strings(ss)
	ps := []P{{"x", 30}, {"y", 20}, {"z", 25}}
	sort.Slice(ps, func(i, j int) bool { return ps[i].Age < ps[j].Age })
	idx := sort.Search(len(xs), func(i int) bool { return xs[i] >= 5 })
	desc := sort.SliceIsSorted(ps, func(i, j int) bool { return ps[i].Age > ps[j].Age })
	return fmt.Sprintf("%d%d%d%d %s%s%s %s%s%s %d %v %v", xs[0], xs[1], xs[2], xs[3],
		ss[0], ss[1], ss[2], ps[0].Name, ps[1].Name, ps[2].Name, idx,
		sort.IntsAreSorted(xs), desc)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "1259 abc yzx 2 true false");
	assertEqual(wasmRes, jsRes);
});

test("math.Exp2 / Signbit / Dim / Remainder", () => {
	const src = `
package main

import (
	"fmt"
	"math"
)

func Main() string {
	return fmt.Sprintf("%v %v %v %v %v %v %v",
		math.Exp2(3), math.Signbit(-1.0), math.Dim(5, 3), math.Dim(3, 5),
		math.Remainder(10.0, 3.0), math.Remainder(-10.0, 3.0), math.Remainder(9.0, 3.0))
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "8 true 2 0 1 -1 0");
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib — slices (Phase 4)");

test("slices.Compare", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

func Main() string {
	c1 := slices.Compare([]int{1, 2, 3}, []int{1, 2, 3})
	c2 := slices.Compare([]int{1, 2}, []int{1, 3})
	c3 := slices.Compare([]int{1, 3}, []int{1, 2})
	c4 := slices.Compare([]int{1, 2}, []int{1, 2, 3})
	c5 := slices.Compare([]int{1, 2, 3}, []int{1, 2})
	var nil1 []int
	var nil2 []int
	c6 := slices.Compare(nil1, nil2)
	c7 := slices.Compare(nil1, []int{1})
	c8 := slices.Compare([]int{1}, nil1)
	return fmt.Sprintf("%d %d %d %d %d %d %d %d", c1, c2, c3, c4, c5, c6, c7, c8)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "0 -1 1 -1 1 0 -1 1");
	assertEqual(wasmRes, jsRes);
});

test("slices.SortFunc & SortStableFunc", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

type Item struct {
	Name string
	Val  int
}

func Main() string {
	s := []int{5, 2, 8, 1, 9}
	slices.SortFunc(s, func(a, b int) int { return a - b })

	items := []Item{
		{"a", 2},
		{"b", 1},
		{"c", 2},
		{"d", 1},
	}
	slices.SortStableFunc(items, func(a, b Item) int { return a.Val - b.Val })

	return fmt.Sprintf("%d %d %d %d %d %s%s%s%s", s[0], s[1], s[2], s[3], s[4], items[0].Name, items[1].Name, items[2].Name, items[3].Name)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "1 2 5 8 9 bdac");
	assertEqual(wasmRes, jsRes);
});

test("slices.IsSorted & IsSortedFunc", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

func Main() string {
	b1 := slices.IsSorted([]int{1, 2, 3, 4})
	b2 := slices.IsSorted([]int{1, 3, 2})
	b3 := slices.IsSorted([]string{"apple", "banana", "cherry"})
	b4 := slices.IsSorted([]string{"banana", "apple"})

	cmp := func(a, b int) int { return b - a } // descending
	b5 := slices.IsSortedFunc([]int{4, 3, 2, 1}, cmp)
	b6 := slices.IsSortedFunc([]int{1, 2, 3, 4}, cmp)

	return fmt.Sprintf("%v %v %v %v %v %v", b1, b2, b3, b4, b5, b6)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "true false true false true false");
	assertEqual(wasmRes, jsRes);
});

test("slices.Min, Max, MinFunc, MaxFunc", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

type Person struct {
	Name string
	Age  int
}

func Main() string {
	nums := []int{3, 1, 4, 1, 5, 9, 2, 6}
	minN := slices.Min(nums)
	maxN := slices.Max(nums)

	strs := []string{"cat", "zebra", "apple", "dog"}
	minS := slices.Min(strs)
	maxS := slices.Max(strs)

	people := []Person{{"Alice", 30}, {"Bob", 20}, {"Charlie", 40}}
	byAge := func(a, b Person) int { return a.Age - b.Age }
	youngest := slices.MinFunc(people, byAge)
	oldest := slices.MaxFunc(people, byAge)

	return fmt.Sprintf("%d %d %s %s %s %s", minN, maxN, minS, maxS, youngest.Name, oldest.Name)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "1 9 apple zebra Bob Charlie");
	assertEqual(wasmRes, jsRes);
});

test("slices.Compact & CompactFunc", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
	"strings"
)

func Main() string {
	s1 := []int{1, 1, 2, 2, 2, 3, 4, 4, 1}
	c1 := slices.Compact(s1)

	s2 := []string{"a", "A", "b", "B", "b"}
	c2 := slices.CompactFunc(s2, func(a, b string) bool {
		return strings.EqualFold(a, b)
	})

	return fmt.Sprintf("%d %d %d %d %d %s %s", c1[0], c1[1], c1[2], c1[3], c1[4], c2[0], c2[1])
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "1 2 3 4 1 a b");
	assertEqual(wasmRes, jsRes);
});

test("slices.Concat", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

func Main() string {
	a := []int{1, 2}
	b := []int{3, 4}
	c := []int{5}
	res := slices.Concat(a, b, c)

	var n1 []string
	var n2 []string
	res2 := slices.Concat(n1, []string{"hello"}, n2, []string{"world"})

	return fmt.Sprintf("%d %d %d %d %d %s %s", res[0], res[1], res[2], res[3], res[4], res2[0], res2[1])
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "1 2 3 4 5 hello world");
	assertEqual(wasmRes, jsRes);
});

test("slices.Delete & DeleteFunc", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

func Main() string {
	s1 := []int{1, 2, 3, 4, 5, 6}
	s1 = slices.Delete(s1, 1, 4) // keeps s1[0] and s1[4:], so [1, 5, 6]

	s2 := []int{1, 2, 3, 4, 5, 6, 7, 8}
	s2 = slices.DeleteFunc(s2, func(n int) bool { return n%2 == 0 }) // delete evens

	return fmt.Sprintf("%d %d %d %d %d %d %d", s1[0], s1[1], s1[2], s2[0], s2[1], s2[2], s2[3])
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "1 5 6 1 3 5 7");
	assertEqual(wasmRes, jsRes);
});

test("slices.Insert & Replace", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

func Main() string {
	s := []int{1, 2, 5}
	s = slices.Insert(s, 2, 3, 4) // [1 2 3 4 5]

	s2 := []int{1, 2, 3, 4, 5}
	s2 = slices.Replace(s2, 1, 4, 20, 30, 40) // [1 20 30 40 5]

	return fmt.Sprintf("%d %d %d %d %d %d %d %d %d %d", s[0], s[1], s[2], s[3], s[4], s2[0], s2[1], s2[2], s2[3], s2[4])
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "1 2 3 4 5 1 20 30 40 5");
	assertEqual(wasmRes, jsRes);
});

test("slices.Grow & Clip", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

func Main() string {
	s := []int{1, 2, 3}
	s2 := slices.Grow(s, 10)
	s2 = append(s2, 4)

	s3 := slices.Clip(s2)

	return fmt.Sprintf("%d %d %d %d %d", len(s2), len(s3), s2[0], s2[3], s3[3])
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "4 4 1 4 4");
	assertEqual(wasmRes, jsRes);
});

test("slices.Grow & Clip capacity behavior in WASM", () => {
	const src = `
package main

import (
	"slices"
)

func Main() int {
	s := []int{1, 2, 3}
	s2 := slices.Grow(s, 10)
	if cap(s2) < len(s2)+10 {
		return 1
	}
	s3 := slices.Clip(s2)
	if len(s3) != cap(s3) {
		return 2
	}
	return 0
}
`;
	const { wasm, stringTable } = compileHybrid(src);
	const { exports } = runWasm(wasm, { stringTable });
	assertEqual(exports.Main(), 0);
});

test("slices unsigned integer comparisons (Compare, Min, Max, IsSorted)", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

func Main() string {
	a := []uint32{0x80000000, 1}
	c := slices.Compare([]uint32{0x80000000}, []uint32{1})
	minU := slices.Min(a)
	maxU := slices.Max(a)
	sorted := slices.IsSorted([]uint32{1, 0x80000000})

	a64 := []uint64{0x8000000000000000, 1}
	c64 := slices.Compare([]uint64{0x8000000000000000}, []uint64{1})
	min64 := slices.Min(a64)
	max64 := slices.Max(a64)

	return fmt.Sprintf("%d %d %d %v %d %d %d", c, minU, maxU, sorted, c64, min64, max64)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "1 1 2147483648 true 1 1 9223372036854776000");
	assertEqual(wasmRes, jsRes);
});

test("slices.Insert & Replace on struct values (in-place right shift)", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

type Point struct {
	X int
	Y int
}

func Main() string {
	s := make([]Point, 3, 10)
	s[0] = Point{1, 1}
	s[1] = Point{2, 2}
	s[2] = Point{3, 3}
	s = slices.Insert(s, 0, Point{9, 9})

	s2 := make([]Point, 4, 10)
	s2[0] = Point{1, 1}
	s2[1] = Point{2, 2}
	s2[2] = Point{3, 3}
	s2[3] = Point{4, 4}
	s2 = slices.Replace(s2, 1, 2, Point{8, 8}, Point{9, 9})

	return fmt.Sprintf("%d %d %d %d | %d %d %d %d %d",
		s[0].X, s[1].X, s[2].X, s[3].X,
		s2[0].X, s2[1].X, s2[2].X, s2[3].X, s2[4].X)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "9 1 2 3 | 1 8 9 3 4");
	assertEqual(wasmRes, jsRes);
});

test("slices.Concat with 0 arguments", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

func Main() string {
	var s []int = slices.Concat()
	return fmt.Sprintf("%v", s == nil)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "true");
	assertEqual(wasmRes, jsRes);
});

test("slices.SortFunc & SortStableFunc & Reverse on nil slices", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

func Main() string {
	var s1 []int
	slices.SortFunc(s1, func(a, b int) int { return a - b })
	var s2 []int
	slices.SortStableFunc(s2, func(a, b int) int { return a - b })
	var s3 []int
	slices.Sort(s3)
	var s4 []int
	slices.Reverse(s4)
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(wasmRes, jsRes);
});

test("slices float NaN and signbit semantics (Compare, Min, Max, IsSorted)", () => {
	const src = `
package main

import (
	"fmt"
	"math"
	"slices"
)

func Main() string {
	c1 := slices.Compare([]float64{math.NaN()}, []float64{math.NaN()})
	c2 := slices.Compare([]float64{math.NaN()}, []float64{1.0})
	c3 := slices.Compare([]float64{1.0}, []float64{math.NaN()})
	sorted1 := slices.IsSorted([]float64{1.0, math.NaN(), 2.0})
	min0 := slices.Min([]float64{0.0, -0.0})
	max0 := slices.Max([]float64{-0.0, 0.0})
	return fmt.Sprintf("%d %d %d %v %v %v", c1, c2, c3, sorted1, math.Signbit(min0), math.Signbit(max0))
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "0 -1 1 false true false");
	assertEqual(wasmRes, jsRes);
});

test("math.Remainder edge cases (half-integers and infinite y)", () => {
	const src = `
package main

import (
	"fmt"
	"math"
)

func Main() string {
	r1 := math.Remainder(5.0, 2.0)
	r2 := math.Remainder(3.0, 2.0)
	r3 := math.Remainder(2.5, 2.0)
	r4 := math.Remainder(10.0, math.Inf(1))
	return fmt.Sprintf("%v %v %v %v", r1, r2, r3, r4)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "1 -1 0.5 10");
	assertEqual(wasmRes, jsRes);
});

test("slices out of bounds error parity", () => {
	const testPanics = [
		`package main; import "slices"; func Main() { slices.Insert([]int{1, 2}, 5, 99) }`,
		`package main; import "slices"; func Main() { slices.Delete([]int{1, 2}, 1, 5) }`,
		`package main; import "slices"; func Main() { slices.Replace([]int{1, 2}, 1, 5, 99) }`,
		`package main; import "slices"; func Main() { slices.Grow([]int{1, 2}, -1) }`,
	];
	for (const src of testPanics) {
		const res = compileHybrid(src).run("Main");
		// run() verifies both WASM and JS throw matching error messages
		assertEqual(res.jsRes, undefined);
		assertEqual(res.wasmRes, undefined);
	}
});

section("WASM — any equality");

test("== and != on any compare boxed values, strings and nil", () => {
	const src = `
package main

func Main() string {
	var a any = "x"
	var b any = "x"
	var c any = 3
	var d any = nil
	var e any = 3
	out := ""
	if a == b {
		out += "1"
	}
	if a != c {
		out += "2"
	}
	if d == nil {
		out += "3"
	}
	if a != d {
		out += "4"
	}
	if c == e {
		out += "5"
	}
	return out
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "12345");
	assertEqual(wasmRes, jsRes);
});

section("WASM stdlib — Phase 6: unicode, math/rand, html, path, bytes");

test("unicode functions: ASCII and Unicode parity", () => {
	const src = `
package main

import (
	"fmt"
	"unicode"
)

func Main() string {
	res := fmt.Sprintf("%v|%v|%v|%v|%v|%v|%v|%v|%c|%c",
		unicode.IsLetter('a') && unicode.IsLetter('Ж'),
		unicode.IsDigit('5') && !unicode.IsDigit('a'),
		unicode.IsSpace(' ') && unicode.IsSpace('\\n') && !unicode.IsSpace('a'),
		unicode.IsUpper('A') && unicode.IsUpper('Ω') && !unicode.IsUpper('a'),
		unicode.IsLower('a') && unicode.IsLower('ω') && !unicode.IsLower('A'),
		unicode.IsPunct('!') && unicode.IsPunct('?') && !unicode.IsPunct('a'),
		unicode.IsControl('\\n') && !unicode.IsControl('a'),
		unicode.IsPrint('a') && unicode.IsPrint(' ') && !unicode.IsPrint(0),
		unicode.ToUpper('g'),
		unicode.ToLower('G'),
	)
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "true|true|true|true|true|true|true|true|G|g");
	assertEqual(wasmRes, jsRes);
});

test("math/rand functions: Float, Int, Seed, Shuffle, Perm", () => {
	const src = `
package main

import (
	"fmt"
	"math/rand"
)

func Main() string {
	rand.Seed(42)
	f64 := rand.Float64()
	f32 := rand.Float32()
	n := rand.Intn(100)
	i := rand.Int()
	i31 := rand.Int31()
	i63 := rand.Int63()

	arr := []int{10, 20, 30, 40, 50}
	rand.Shuffle(len(arr), func(i, j int) {
		arr[i], arr[j] = arr[j], arr[i]
	})

	perm := rand.Perm(5)

	return fmt.Sprintf("%v|%v|%v|%v|%v|%v|%d|%d",
		f64 >= 0 && f64 < 1.0,
		f32 >= 0 && f32 < 1.0,
		n >= 0 && n < 100,
		i >= 0,
		i31 >= 0,
		i63 >= 0,
		len(arr),
		len(perm),
	)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "true|true|true|true|true|true|5|5");
	assertEqual(wasmRes, jsRes);
});

test("html EscapeString and UnescapeString", () => {
	const src = `
package main

import (
	"fmt"
	"html"
)

func Main() string {
	raw := "<b>Hello & 'World' \\"123\\"</b>"
	esc := html.EscapeString(raw)
	unesc := html.UnescapeString(esc)
	unescHex := html.UnescapeString("&#x27;test&#x27;")
	return fmt.Sprintf("%s|%s|%s", esc, unesc, unescHex)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(
		wasmRes,
		"&lt;b&gt;Hello &amp; &#39;World&#39; &#34;123&#34;&lt;/b&gt;|<b>Hello & 'World' \"123\"</b>|'test'",
	);
	assertEqual(wasmRes, jsRes);
});

test("path & filepath functions: Base, Dir, Ext, Clean, IsAbs, Join, Split, Match, ErrBadPattern", () => {
	const src = `
package main

import (
	"errors"
	"fmt"
	"path"
	"path/filepath"
)

func Main() string {
	b := path.Base("/a/b/c.txt")
	d := path.Dir("/a/b/c.txt")
	ext := path.Ext("/a/b/c.txt")
	clean := path.Clean("/a/b/../c/./d")
	abs := path.IsAbs("/a/b")
	notAbs := path.IsAbs("a/b")
	joined := path.Join("a", "b", "c")
	emptyJoin := path.Join()
	emptyClean := path.Clean("")
	dir, file := path.Split("/foo/bar/baz.go")

	matched, err := path.Match("*.txt", "foo.txt")
	_, badErr := path.Match("[a-", "foo.txt")
	isBad := errors.Is(badErr, path.ErrBadPattern)

	fpBase := filepath.Base("/x/y/z.png")
	fpJoined := filepath.Join("x", "y")

	return fmt.Sprintf("%s|%s|%s|%s|%v|%v|%s|%s|%s|%s|%s|%v|%v|%v|%s|%s",
		b, d, ext, clean, abs, notAbs, joined, emptyJoin, emptyClean, dir, file,
		matched, err == nil, isBad, fpBase, fpJoined,
	)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(
		wasmRes,
		"c.txt|/a/b|.txt|/a/c/d|true|false|a/b/c||.|/foo/bar/|baz.go|true|true|true|z.png|x/y",
	);
	assertEqual(wasmRes, jsRes);
});

test("bytes package functions: Equal, Contains, Prefixes, Trims, Split, Join, Replace, Cut, Fields", () => {
	const src = `
package main

import (
	"bytes"
	"fmt"
)

func Main() string {
	b1 := []byte("hello world")
	b2 := []byte("hello")
	eq := bytes.Equal(b1, b2)
	hasP := bytes.HasPrefix(b1, b2)
	hasS := bytes.HasSuffix(b1, []byte("world"))
	idx := bytes.Index(b1, []byte("lo"))
	idxB := bytes.IndexByte(b1, 'o')
	lastIdxB := bytes.LastIndexByte(b1, 'o')
	cnt := bytes.Count(b1, []byte("l"))
	rep := string(bytes.Repeat([]byte("ab"), 3))
	up := string(bytes.ToUpper([]byte("abc!")))
	low := string(bytes.ToLower([]byte("ABC!")))
	trimSp := string(bytes.TrimSpace([]byte("  xyz  ")))
	trimPref := string(bytes.TrimPrefix([]byte("foobar"), []byte("foo")))
	trimSuff := string(bytes.TrimSuffix([]byte("foobar"), []byte("bar")))
	trim := string(bytes.Trim([]byte("xxfooxx"), "x"))
	cutBefore, cutAfter, found := bytes.Cut(b1, []byte(" "))
	replaced := string(bytes.ReplaceAll([]byte("a-b-c"), []byte("-"), []byte(":")))
	split := bytes.Split([]byte("x,y,z"), []byte(","))
	joined := string(bytes.Join(split, []byte(";")))
	fields := bytes.Fields([]byte("one  two   three"))

	return fmt.Sprintf("%v|%v|%v|%d|%d|%d|%d|%s|%s|%s|%s|%s|%s|%s|%s|%s|%v|%s|%d|%s|%d",
		eq, hasP, hasS, idx, idxB, lastIdxB, cnt, rep, up, low, trimSp,
		trimPref, trimSuff, trim, string(cutBefore), string(cutAfter), found,
		replaced, len(split), joined, len(fields),
	)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(
		wasmRes,
		"false|true|true|3|4|7|3|ababab|ABC!|abc!|xyz|bar|foo|foo|hello|world|true|a:b:c|3|x;y;z|3",
	);
	assertEqual(wasmRes, jsRes);
});

test("bytes.Buffer methods: WriteString, WriteByte, WriteRune, Write, String, Bytes, Len, Cap, Reset, Grow", () => {
	const src = `
package main

import (
	"bytes"
	"fmt"
)

func Main() string {
	var buf bytes.Buffer
	buf.WriteString("hello")
	buf.WriteByte(' ')
	buf.WriteRune('世')
	buf.WriteRune('界')
	buf.Write([]byte("!"))

	l := buf.Len()
	s := buf.String()
	b := buf.Bytes()
	c := buf.Cap()

	buf.Grow(50)
	c2 := buf.Cap()

	buf.Reset()
	l2 := buf.Len()
	s2 := buf.String()

	return fmt.Sprintf("%d|%s|%d|%v|%v|%d|%s", l, s, len(b), c >= l, c2 >= l + 50, l2, s2)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "13|hello 世界!|13|true|true|0|");
	assertEqual(wasmRes, jsRes);
});

test("Phase 6 edge cases: composite literals, variadic Join, UTF-8 byte operations, invalid runes, caseless unicode", () => {
	const src = `
package main

import (
	"bytes"
	"fmt"
	"path"
	"unicode"
)

func Main() string {
	// 1. Composite literal bytes.Buffer{} and &bytes.Buffer{}
	var b1 = bytes.Buffer{}
	b1.WriteString("hello")
	var b2 = &bytes.Buffer{}
	b2.WriteString("world")

	// 2. Variadic path.Join(parts...)
	parts := []string{"usr", "local", "bin"}
	joined := path.Join(parts...)

	// 3. Multi-byte runes in bytes functions
	bData := []byte("你好世界")
	hasRune := bytes.ContainsRune(bData, '世')
	hasAny := bytes.ContainsAny(bData, "界x")
	trimmed := bytes.Trim([]byte("【你好世界】"), "【】")
	trimmedLeft := bytes.TrimLeft([]byte("【你好"), "【")
	trimmedRight := bytes.TrimRight([]byte("你好】"), "】")
	trimmedFunc := bytes.TrimFunc([]byte("  你好  "), func(r rune) bool {
		return unicode.IsSpace(r)
	})
	mapped := bytes.Map(func(r rune) rune {
		if r == 'h' {
			return 'H'
		} else if r == 'e' {
			return -1
		}
		return r
	}, []byte("hello"))

	// 4. Invalid rune in WriteRune
	var b3 bytes.Buffer
	b3.WriteRune(-1)

	// 5. Caseless unicode
	zhongUpper := unicode.IsUpper('中')
	zhongLower := unicode.IsLower('中')

	return fmt.Sprintf("%s|%s|%s|%v|%v|%s|%s|%s|%s|%s|%s|%v|%v",
		b1.String(),
		b2.String(),
		joined,
		hasRune,
		hasAny,
		string(trimmed),
		string(trimmedLeft),
		string(trimmedRight),
		string(trimmedFunc),
		string(mapped),
		b3.String(),
		zhongUpper,
		zhongLower,
	)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(
		wasmRes,
		"hello|world|usr/local/bin|true|true|你好世界|你好|你好|你好|Hllo|\uFFFD|false|false",
	);
	assertEqual(wasmRes, jsRes);
});

test("Phase 6 negative bounds panics parity", () => {
	const testPanic = (goCode, expectedSubstring) => {
		const src = `
package main

import (
	"bytes"
	"math/rand"
)

func Main() {
	${goCode}
}
`;
		const h = compileHybrid(src);
		h.run("Main");
		const wasmInst = runWasm(h.wasm, { stringTable: h.stringTable });
		assertThrows(() => wasmInst.exports.Main(), expectedSubstring);
	};

	testPanic("rand.Intn(0)", "invalid argument to Intn");
	testPanic("rand.Perm(-1)", "invalid argument to Perm");
	testPanic(
		"rand.Shuffle(-1, func(i, j int){})",
		"invalid argument to Shuffle",
	);
	testPanic(
		"var b bytes.Buffer; b.Grow(-1)",
		"bytes.Buffer.Grow: negative count",
	);
});
