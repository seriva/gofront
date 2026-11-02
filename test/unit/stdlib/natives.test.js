// GoFront test suite — JS natives of slices and sort
//
// A native replaces the call with host code only where it agrees with the Go
// body; every other instantiation calls the Go function.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileFiles } from "../../../src/compiler.js";
import {
	assertContains,
	assertEqual,
	assertFourWay,
	section,
	test,
} from "../helpers.js";

function jsOf(source) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-native-"));
	try {
		writeFileSync(join(dir, "main.go"), source);
		return compileFiles([join(dir, "main.go")], { forceTarget: "both" }).js;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const count = (text, needle) => text.split(needle).length - 1;

section("slices and sort natives (JS)");

test("primitive slices use the host search, sort and reverse", () => {
	const js = jsOf(`package main

import (
	"slices"
	"sort"
)

func main() {
	xs := []int{3, 1, 2}
	ss := []string{"b", "a"}
	slices.Sort(xs)
	sort.Strings(ss)
	sort.Ints(xs)
	slices.Reverse(xs)
	println(slices.Index(xs, 2), slices.Contains(ss, "a"), len(slices.Clone(xs)))
}
`);
	assertContains(js, "(a, b) => a - b");
	assertContains(js, ".indexOf(2)");
	assertContains(js, ".reverse()");
	assertContains(js, "?.slice() ?? null");
});

test("floats, structs and other elements call the Go body", () => {
	const js = jsOf(`package main

import "slices"

type P struct{ A int }

func main() {
	f := []float64{2, 1}
	slices.Sort(f)
	ps := []P{{1}}
	println(slices.Index(ps, P{1}), slices.Contains(ps, P{2}))
}
`);
	assertEqual(count(js, "(a, b) => a - b"), 0);
	assertEqual(count(js, ".indexOf(__"), 0);
	assertContains(js, "Sort$$slices(");
	assertContains(js, "Index$$slices(");
});

test("a native agrees with its Go body on nil, empty and named slices", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math"
	"slices"
	"sort"
)

type IDs []int

func next() int { fmt.Print("."); return 1 }

func main() {
	var n []int
	var s []string
	sort.Ints(n)
	sort.Strings(s)
	slices.Sort(n)
	slices.Reverse(n)
	fmt.Println(slices.Contains(n, 1), slices.Index(s, "a"), slices.Clone(n) == nil, slices.Clone([]int{}) != nil)
	ids := IDs{3, 1, 2}
	slices.Sort(ids)
	fmt.Println(ids, slices.Index(ids, 2), slices.Contains(ids, 5))
	f := []float64{math.NaN(), 1}
	fmt.Println(slices.Contains(f, math.NaN()), slices.Index(f, 1))
	a, b := slices.Index([]int{1, 2}, next()), slices.Contains([]int{1}, next())
	fmt.Println(a, b)
}
`,
		`false -1 true true
[1 2 3] 1 false
false 1
..0 true
`,
	);
});

section("strings natives (JS)");

test("search, split and trim functions use the host primitives", () => {
	const js = jsOf(`package main

import "strings"

func main() {
	s := "a,b,c"
	println(strings.Index(s, ","), strings.Contains(s, "b"), strings.HasPrefix(s, "a"), strings.HasSuffix(s, "c"))
	println(len(strings.Split(s, ",")), strings.Join([]string{"x"}, "-"), strings.ToUpper(s), strings.TrimSpace(s))
	println(strings.Replace(s, ",", ";", 1), strings.TrimPrefix(s, "a"), strings.Repeat(s, 2))
}
`);
	assertContains(js, ".indexOf(");
	assertContains(js, ".includes(");
	assertContains(js, ".startsWith(");
	assertContains(js, ".endsWith(");
	assertContains(js, ".toUpperCase()");
	assertContains(js, "s.split(sep)");
});

test("a string native used as a value calls the Go body", () => {
	const js = jsOf(`package main

import "strings"

func main() {
	f := strings.Index
	println(f("abc", "c"))
}
`);
	assertContains(js, "Index$$strings(");
});

test("a string native evaluates each argument once, in order", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strings"
)

func s(v string) string { fmt.Print(v, " "); return v }
func n(v int) int       { fmt.Print(v, " "); return v }

func main() {
	a := strings.Replace(s("a.b.c"), s("."), s("-"), n(1))
	fmt.Println(a)
	b, c := strings.Trim(s("xhx"), s("x")), strings.Count(s("aa"), s("a"))
	fmt.Println(b, c)
	d, e := strings.IndexRune(s("hello"), 'l'), strings.ContainsAny(s("abc"), s("c"))
	fmt.Println(d, e)
}
`,
		`a.b.c . - 1 a-b.c
xhx x aa a h 2
hello abc c 2 true
`,
	);
});

test("a string native agrees with its Go body on empty and non-ASCII input", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strings"
)

func main() {
	var empty string
	fmt.Println(strings.Index(empty, empty), strings.Contains(empty, empty), strings.Count(empty, empty), strings.HasPrefix(empty, empty), strings.LastIndex(empty, empty))
	fmt.Println(strings.TrimSpace(empty) == "", strings.Trim(empty, "x") == "", strings.ToUpper(empty) == "", strings.Join(nil, "x") == "")
	fmt.Println(strings.ReplaceAll("a😀b", "", "|"), strings.Count("😀😀", ""), strings.Trim("😀a😀", "😀"), strings.Split("a😀b", "") [1] == "😀")
	fmt.Println(strings.Replace("a.b", ".", "$1", -1), strings.ReplaceAll("aaa", "a", "$&$&"))
	fmt.Println(strings.Fields(" a\\u0085b\\u2003c ")[1], len(strings.Fields("\\u00a0 \\u3000")))
	fmt.Println(strings.TrimSpace("\\u0085 x \\u2029") == "x", strings.IndexRune("abc", 0xD800), strings.ContainsRune("abc", 0xD800))
}
`,
		`0 true 1 true 0
true true true true
|a|😀|b| 3 a true
a$1b $&$&$&$&$&$&
b 0
true -1 false
`,
	);
});
