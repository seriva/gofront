// test/unit/wasm/stdlib.test.js
// WASM stdlib coverage: errors, fmt, strconv, strings, unicode/utf8, sort,
// math extras and `any` equality — all checked for JS/WASM parity.

import { assertEqual, compileHybrid, section, test } from "../helpers.js";

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

test("math.Exp2 / Signbit / Dim", () => {
	const src = `
package main

import (
	"fmt"
	"math"
)

func Main() string {
	return fmt.Sprintf("%v %v %v %v", math.Exp2(3), math.Signbit(-1.0), math.Dim(5, 3), math.Dim(3, 5))
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "8 true 2 0");
	assertEqual(wasmRes, jsRes);
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
